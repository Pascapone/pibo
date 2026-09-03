import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { redactSensitiveText } from "../../core/sensitive-data-redaction.js";
import { randomUUID } from "node:crypto";
import {
	OMP_RPC_CHUNK_PAYLOAD_BYTES,
	OMP_RPC_MAX_FRAME_BYTES,
	OMP_RPC_PROTOCOL_VERSION,
	type OmpRpcChunkFrame,
	type OmpRpcClientSideChannel,
	type OmpRpcCommand,
	type OmpRpcFrame,
	type OmpRpcReadyFrame,
	type OmpRpcResponse,
} from "./protocol-types.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PENDING_REQUESTS = 128;
const DEFAULT_MAX_STDERR_BYTES = 256 * 1024;

export type OmpRpcClientState =
	| "starting"
	| "initializing"
	| "ready"
	| "closing"
	| "closed"
	| "failed";

export type OmpRpcClientErrorCode =
	| "aborted"
	| "closed"
	| "message_too_large"
	| "pending_limit"
	| "process_exited"
	| "protocol_error"
	| "serialization_error"
	| "spawn_failed"
	| "timeout"
	| "write_failed"
	| "chunk_invalid";

export class OmpRpcClientError extends Error {
	constructor(
		readonly code: OmpRpcClientErrorCode,
		message: string,
		options: ErrorOptions & { cause?: unknown } = {},
	) {
		super(message, options);
		this.name = "OmpRpcClientError";
	}
}

export class OmpRpcResponseError extends Error {
	constructor(
		readonly command: string,
		readonly error: string,
		readonly errorCode?: string,
		options: ErrorOptions = {},
	) {
		super(`OMP RPC command "${command}" failed: ${error}`, options);
		this.name = "OmpRpcResponseError";
	}
}

export type OmpRpcClientOptions = {
	startupTimeoutMs?: number;
	requestTimeoutMs?: number;
	shutdownTimeoutMs?: number;
	maxMessageBytes?: number;
	maxPendingRequests?: number;
	maxStderrBytes?: number;
};

export type OmpRpcClientSnapshot = {
	state: OmpRpcClientState;
	ready: boolean;
	pendingRequests: number;
	protocolVersion: number;
};

export type OmpRpcFrameListener = (frame: OmpRpcFrame) => void;
export type OmpRpcSideChannelListener = (frame: OmpRpcClientSideChannel) => void;
export type OmpRpcDiagnosticListener = (message: string) => void;

type PendingRequest = {
	command: OmpRpcCommand["type"];
	resolve: (response: OmpRpcResponse) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
	const d = {} as Deferred<T>;
	d.promise = new Promise<T>((resolve, reject) => {
		d.resolve = resolve;
		d.reject = reject;
	});
	return d;
}

function isOmpRpcSideChannel(frame: OmpRpcFrame): boolean {
	const type = (frame as { type?: unknown }).type;
	return type === "host_tool_result"
		|| type === "host_tool_update"
		|| type === "host_uri_result"
		|| type === "extension_ui_response";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseReadyFrame(value: unknown): OmpRpcReadyFrame {
	if (!isRecord(value) || value.type !== "ready") {
		throw new OmpRpcClientError("protocol_error", "OMP child did not emit a ready frame on startup.");
	}
	return value as unknown as OmpRpcReadyFrame;
}

export class OmpRpcClient {
	private child?: ChildProcessWithoutNullStreams;
	private stdoutBuffer = Buffer.alloc(0);
	private state: OmpRpcClientState = "starting";
	private protocolVersion = 1;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly chunks = new Map<string, { count: number; byteLength: number; parts: Buffer[] }>();
	private readonly frameListeners = new Set<OmpRpcFrameListener>();
	private readonly sideChannelListeners = new Set<OmpRpcSideChannelListener>();
	private readonly diagnosticListeners = new Set<OmpRpcDiagnosticListener>();
	private stderrBytes = 0;
	private readonly startupTimeoutMs: number;
	private readonly requestTimeoutMs: number;
	private readonly shutdownTimeoutMs: number;
	private readonly maxMessageBytes: number;
	private readonly maxPendingRequests: number;
	private readonly maxStderrBytes: number;

	constructor(private readonly options: OmpRpcClientOptions = {}) {
		this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
		this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
		this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
		this.maxPendingRequests = options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS;
		this.maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;
	}

	get snapshot(): OmpRpcClientSnapshot {
		return {
			state: this.state,
			ready: this.state === "ready",
			pendingRequests: this.pending.size,
			protocolVersion: this.protocolVersion,
		};
	}

	get process(): ChildProcessWithoutNullStreams | undefined {
		return this.child;
	}

	get connected(): boolean {
		return this.state === "ready";
	}

	subscribeFrames(listener: OmpRpcFrameListener): () => void {
		this.frameListeners.add(listener);
		return () => this.frameListeners.delete(listener);
	}

	subscribeSideChannels(listener: OmpRpcSideChannelListener): () => void {
		this.sideChannelListeners.add(listener);
		return () => this.sideChannelListeners.delete(listener);
	}

	subscribeDiagnostics(listener: OmpRpcDiagnosticListener): () => void {
		this.diagnosticListeners.add(listener);
		return () => this.diagnosticListeners.delete(listener);
	}

	/**
	 * Redact likely credential material before surfacing a diagnostic, so OMP
	 * stderr (which may echo prompts or provider keys) cannot leak secrets.
	 */
	private static redactDiagnostic(message: string): string {
		return redactSensitiveText(message);
	}

	private emitDiagnostic(message: string): void {
		for (const listener of this.diagnosticListeners) listener(OmpRpcClient.redactDiagnostic(message));
	}

	/**
	 * Spawn the OMP child in `--mode rpc` and wait for the `ready` frame, then
	 * negotiate protocol v2 (confirms frame encoder upgrade for large frames).
	 */
	async connect(command: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
		if (this.state === "ready") return;
		const ready = deferred<OmpRpcReadyFrame>();

		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(command[0], command.slice(1), {
				cwd: options.cwd,
				env: options.env,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (error) {
			this.state = "failed";
			throw new OmpRpcClientError("spawn_failed", `Failed to spawn OMP child: ${String(error)}`, { cause: error });
		}
		this.child = child;

		let startupTimer: NodeJS.Timeout | undefined;
		child.stderr.on("data", (chunk: Buffer) => {
			this.stderrBytes += chunk.length;
			if (this.stderrBytes <= this.maxStderrBytes) {
				this.emitDiagnostic(chunk.toString("utf8"));
			}
		});
		child.once("error", (error: NodeJS.ErrnoException) => {
			const code = error.code === "ENOENT" ? "spawn_failed" : "process_exited";
			this.state = "failed";
			ready.reject(new OmpRpcClientError(code, `OMP child process error: ${error.message}`, { cause: error }));
		});
		child.once("close", (code, signal) => {
			this.state = "closed";
			this.rejectAll(
				new OmpRpcClientError(
					"process_exited",
					`OMP child process exited (code=${String(code)}, signal=${String(signal)})`,
				),
			);
			ready.reject(new OmpRpcClientError("process_exited", "OMP child process exited before becoming ready."));
		});
		child.stdout.on("data", (chunk: Buffer) => this.onStdoutData(Buffer.from(chunk)));

		// Wait for ready frame.
		const unsubscribe = this.subscribeFrames((frame) => {
			if (frame.type === "ready") {
				unsubscribe();
				ready.resolve(frame);
			}
		});

		startupTimer = setTimeout(() => {
			ready.reject(new OmpRpcClientError("timeout", "Timed out waiting for the OMP ready frame."));
		}, this.startupTimeoutMs);

		this.state = "initializing";
		let startup: OmpRpcReadyFrame;
		try {
			startup = await ready.promise;
		} catch (error) {
			this.state = "failed";
			this.closeProcess();
			throw error;
		} finally {
			if (startupTimer) clearTimeout(startupTimer);
		}

		// Mark ready before negotiation so the client can send the handshake.
		this.state = "ready";
		this.protocolVersion = startup.protocolVersion;
		try {
			await this.request({ type: "negotiate_protocol", protocolVersion: OMP_RPC_PROTOCOL_VERSION }, "negotiate_protocol");
			this.protocolVersion = OMP_RPC_PROTOCOL_VERSION;
		} catch (error) {
			this.state = "failed";
			this.closeProcess();
			throw new OmpRpcClientError("protocol_error", `OMP protocol negotiation failed: ${String(error)}`, { cause: error });
		}
	}

	private onStdoutData(chunk: Buffer): void {
		this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
		let newlineIndex: number;
		while ((newlineIndex = this.stdoutBuffer.indexOf(0x0a)) !== -1) {
			const line = this.stdoutBuffer.subarray(0, newlineIndex).toString("utf8").trim();
			this.stdoutBuffer = this.stdoutBuffer.subarray(newlineIndex + 1);
			if (line.length === 0) continue;
			this.handleLine(line);
		}
	}

	private handleLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			this.emitDiagnostic(`OMP emitted a malformed JSON line on stdout (ignored).`);
			return;
		}
		if (!isRecord(parsed)) {
			this.emitDiagnostic(`OMP emitted a non-object JSON line on stdout (ignored).`);
			return;
		}
		// Reassemble oversized chunked frames first.
		if (parsed.type === "rpc_chunk") {
			const reassembled = this.consumeChunk(parsed as unknown as OmpRpcChunkFrame);
			if (reassembled === undefined) return; // waiting for more chunks
			try {
				parsed = JSON.parse(reassembled);
			} catch {
				this.emitDiagnostic(`OMP chunk reassembly produced invalid JSON (ignored).`);
				return;
			}
		}
		const frame = parsed as OmpRpcFrame;
		for (const listener of this.frameListeners) listener(frame);
		if (isOmpRpcSideChannel(frame)) {
			const sideChannel = frame as unknown as OmpRpcClientSideChannel;
			for (const listener of this.sideChannelListeners) listener(sideChannel);
		}
		if (this.isResponse(frame)) {
			this.resolveResponse(frame);
		}
	}

	private isSideChannel(frame: OmpRpcFrame): boolean {
		const type = (frame as { type?: unknown }).type;
		return (
			type === "host_tool_result" ||
			type === "host_tool_update" ||
			type === "host_uri_result" ||
			type === "extension_ui_response"
		);
	}

	private isResponse(frame: OmpRpcFrame): frame is OmpRpcResponse {
		return (frame as { type?: string }).type === "response";
	}

	private consumeChunk(frame: OmpRpcChunkFrame): string | undefined {
		// Validate frame bounds first so an out-of-range index can never create a
		// sparse array that Buffer.concat later turns into an uncaught TypeError.
		if (!Number.isSafeInteger(frame.index) || frame.index < 0 || frame.index >= frame.count) {
			this.chunks.delete(frame.chunkId);
			this.emitDiagnostic(`OMP chunk frame has an invalid index ${frame.index} (dropped).`);
			return undefined;
		}
		let decoded: Buffer;
		try {
			decoded = Buffer.from(frame.data, "base64");
			// Reject invalid base64 (empty/garbage) before it becomes a hole.
			if (frame.data.length === 0 && frame.byteLength > 0) {
				this.chunks.delete(frame.chunkId);
				this.emitDiagnostic(`OMP chunk frame carries empty base64 payload (dropped).`);
				return undefined;
			}
		} catch {
			this.chunks.delete(frame.chunkId);
			this.emitDiagnostic(`OMP chunk frame base64 decode failed (dropped).`);
			return undefined;
		}
		const existing = this.chunks.get(frame.chunkId);
		if (existing) {
			if (existing.count !== frame.count || existing.byteLength !== frame.byteLength) {
				this.chunks.delete(frame.chunkId);
				this.emitDiagnostic(`OMP chunk frame metadata mismatch (dropped).`);
				return undefined;
			}
			// Must be the next in-order chunk; reject duplicates/holes/out-of-order.
			if (frame.index !== existing.parts.length) {
				this.chunks.delete(frame.chunkId);
				this.emitDiagnostic(`OMP chunk frame arrived out of order (expected index ${existing.parts.length}, got ${frame.index}); dropped.`);
				return undefined;
			}
			existing.parts.push(decoded);
		} else {
			if (frame.index !== 0) {
				this.emitDiagnostic(`OMP chunk frame sequence did not start at index 0 (dropped).`);
				return undefined;
			}
			this.chunks.set(frame.chunkId, { count: frame.count, byteLength: frame.byteLength, parts: [decoded] });
		}
		const acc = this.chunks.get(frame.chunkId)!;
		if (acc.parts.length < acc.count) return undefined;
		this.chunks.delete(frame.chunkId);
		const full = Buffer.concat(acc.parts);
		if (full.length !== acc.byteLength) {
			this.emitDiagnostic(`OMP chunk reassembly length mismatch (dropped).`);
			return undefined;
		}
		return full.toString("utf8");
	}

	private resolveResponse(response: OmpRpcResponse): void {
		const id = response.id;
		if (id === undefined) {
			// Responses without an id that still carry command info are protocol
			// telemetry; emit as diagnostic rather than dropping silently.
			this.emitDiagnostic(`OMP response without an id (command=${response.command as string}).`);
			return;
		}
		const entry = this.pending.get(id);
		if (!entry) return; // late/superseded response
		this.pending.delete(id);
		clearTimeout(entry.timer);
		entry.resolve(response);
	}

	private rejectAll(error: Error): void {
		for (const [id, entry] of Array.from(this.pending.entries())) {
			this.pending.delete(id);
			clearTimeout(entry.timer);
			entry.reject(error);
		}
	}

	/**
	 * Send a command and await its correlated response. Always matches on `id`
	 * (never queue order) — OMP dispatches `bash` concurrently and side-channel
	 * frames overtake the serial queue.
	 */
	async request<T extends OmpRpcCommand>(command: T, label: string): Promise<OmpRpcResponse> {
		if (this.state !== "ready") {
			throw new OmpRpcClientError("closed", `Cannot send OMP command "${label}": client is not ready.`);
		}
		if (this.pending.size >= this.maxPendingRequests) {
			throw new OmpRpcClientError("pending_limit", "Too many pending OMP RPC requests.");
		}
		const id = (command.id ?? randomUUID()) as string;
		const withId = { ...command, id };
		let serialized: string;
		try {
			serialized = JSON.stringify(withId);
		} catch (error) {
			throw new OmpRpcClientError("serialization_error", `Failed to serialize OMP command "${label}": ${String(error)}`);
		}
		if (Buffer.byteLength(serialized, "utf8") > this.maxMessageBytes) {
			throw new OmpRpcClientError("message_too_large", `OMP command "${label}" exceeds the message size limit.`);
		}

		const response = deferred<OmpRpcResponse>();
		const timer = setTimeout(() => {
			this.pending.delete(id);
			response.reject(new OmpRpcClientError("timeout", `OMP command "${label}" timed out.`));
		}, this.requestTimeoutMs);

		this.pending.set(id, {
			command: command.type,
			resolve: response.resolve,
			reject: response.reject,
			timer,
		});

		try {
			await this.writeLine(serialized);
		} catch (error) {
			this.pending.delete(id);
			clearTimeout(timer);
			response.reject(error);
		}

		const result = await response.promise;
		if (result["success" as keyof OmpRpcResponse] === false) {
			const err = result as unknown as { error: string; code?: string };
			throw new OmpRpcResponseError(label, err.error ?? "unknown error", err.code);
		}
		return result;
	}

	private async writeLine(line: string): Promise<void> {
		return await new Promise<void>((resolveWrite, rejectWrite) => {
			if (!this.child || this.child.stdin.destroyed) {
				rejectWrite(new OmpRpcClientError("write_failed", "OMP child stdin is closed."));
				return;
			}
			this.child.stdin.write(`${line}\n`, (error) => {
				if (error) rejectWrite(new OmpRpcClientError("write_failed", `Failed to write to OMP child: ${error.message}`, { cause: error }));
				else resolveWrite();
			});
		});
	}

	get stderr(): string[] {
		return []; // diagnostics already streamed via listeners; retained for symmetry
	}

/**
	 * Send a fire-and-forget side-channel frame to OMP (host_tool_result,
	 * host_tool_update, host_uri_result, extension_ui_response). These overtake
	 * the serial command queue and do not receive a correlated `response`.
	 */
	async sendSideChannel(frame: OmpRpcClientSideChannel, label: string): Promise<void> {
		if (this.state !== "ready") {
			throw new OmpRpcClientError("closed", `Cannot send OMP side-channel frame "${label}": client is not ready.`);
		}
		let serialized: string;
		try {
			serialized = JSON.stringify(frame);
		} catch (error) {
			throw new OmpRpcClientError("serialization_error", `Failed to serialize OMP frame "${label}": ${String(error)}`);
		}
		if (Buffer.byteLength(serialized, "utf8") > this.maxMessageBytes) {
			throw new OmpRpcClientError("message_too_large", `OMP frame "${label}" exceeds the message size limit.`);
		}
		await this.writeLine(serialized);
	}

	async close(): Promise<void> {
		if (this.state === "ready") {
			this.state = "closing";
		}
		this.closeProcess();
	}

	private closeProcess(): void {
		if (this.child && !this.child.killed) {
			try {
				this.child.kill("SIGTERM");
			} catch {
				// ignore
			}
			const child = this.child;
			// Ensure the child is reaped even on platforms where SIGTERM is
			// ignored (freeing any cwd lock for temp cleanup).
			const timer = setTimeout(() => {
				if (child && !child.killed) {
					try {
						child.kill("SIGKILL");
					} catch {
						// ignore
					}
				}
			}, this.shutdownTimeoutMs);
			timer.unref();
		}
		this.state = "closed";
		this.rejectAll(new OmpRpcClientError("aborted", "OMP client closed."));
	}

	dispose(): void {
		this.closeProcess();
	}
}

/** Convenience for oversized-frames logic parity; retained as a documented limit. */
export const OMP_MAX_CHUNK_PAYLOAD_BYTES = OMP_RPC_CHUNK_PAYLOAD_BYTES;
export const OMP_DEFAULT_MAX_FRAME_BYTES = OMP_RPC_MAX_FRAME_BYTES;