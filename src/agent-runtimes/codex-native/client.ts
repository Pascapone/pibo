import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
	CodexAppServerClientInfo,
	CodexAppServerInitializeCapabilities,
	CodexAppServerInitializeResponse,
	CodexAppServerRequestId,
	CodexAppServerRpcError,
	CodexAppServerServerNotification,
	CodexAppServerServerRequest,
} from "./protocol-types.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;
const DEFAULT_KILL_TIMEOUT_MS = 500;
const DEFAULT_MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PENDING_REQUESTS = 128;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_MAX_DIAGNOSTICS = 50;
const DEFAULT_OVERLOAD_RETRIES = 3;
const DEFAULT_OVERLOAD_RETRY_BASE_MS = 100;
const DEFAULT_OVERLOAD_RETRY_MAX_MS = 2_000;
const DEFAULT_OVERLOAD_RETRY_JITTER = 0.2;
const CODEX_APP_SERVER_OVERLOADED = -32001;

export type CodexAppServerClientState =
	| "starting"
	| "initializing"
	| "ready"
	| "closing"
	| "closed"
	| "failed";

export type CodexAppServerClientErrorCode =
	| "aborted"
	| "closed"
	| "message_too_large"
	| "pending_limit"
	| "process_exited"
	| "protocol_error"
	| "serialization_error"
	| "spawn_failed"
	| "timeout"
	| "write_failed";

export class CodexAppServerClientError extends Error {
	readonly code: CodexAppServerClientErrorCode;

	constructor(code: CodexAppServerClientErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CodexAppServerClientError";
		this.code = code;
	}
}

export class CodexAppServerServerRequestCancelledError extends Error {
	constructor(message = "Codex App Server request was resolved before the client response.") {
		super(message);
		this.name = "CodexAppServerServerRequestCancelledError";
	}
}

export class CodexAppServerRpcResponseError extends Error {
	readonly rpcCode: number;
	readonly data?: unknown;

	constructor(error: CodexAppServerRpcError) {
		super(redactCodexAppServerDiagnostic(error.message));
		this.name = "CodexAppServerRpcResponseError";
		this.rpcCode = error.code;
		this.data = error.data;
	}
}

export type CodexAppServerDiagnostic = {
	level: "warning" | "error";
	code: string;
	message: string;
};

export type CodexAppServerRequestOptions = {
	timeoutMs?: number;
	signal?: AbortSignal;
	retryOverloaded?: boolean;
};

export type CodexAppServerOverloadRetryOptions = {
	maxRetries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	jitterRatio?: number;
};

export type CodexAppServerClientOptions = {
	command: string;
	args?: readonly string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	clientInfo: CodexAppServerClientInfo;
	capabilities?: CodexAppServerInitializeCapabilities;
	startupTimeoutMs?: number;
	requestTimeoutMs?: number;
	shutdownTimeoutMs?: number;
	killTimeoutMs?: number;
	maxMessageBytes?: number;
	maxPendingRequests?: number;
	maxStderrBytes?: number;
	overloadRetry?: CodexAppServerOverloadRetryOptions;
	random?: () => number;
	onDiagnostic?: (diagnostic: CodexAppServerDiagnostic) => void;
};

export type CodexAppServerClientSnapshot = {
	state: CodexAppServerClientState;
	pid?: number;
	pendingRequests: number;
	writeBackpressureCount: number;
	stderrBytes: number;
	stderrTruncated: boolean;
};

export type CodexAppServerNotificationListener = (
	notification: CodexAppServerServerNotification,
) => void;

export type CodexAppServerRequestHandler = (
	request: CodexAppServerServerRequest,
) => unknown | Promise<unknown>;

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
	signal?: AbortSignal;
	onAbort?: () => void;
};

type ProcessClose = {
	code: number | null;
	signal: NodeJS.Signals | null;
};

type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: Error) => void;
};

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || selected <= 0) {
		throw new Error(`${name} must be a positive safe integer`);
	}
	return selected;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || selected < 0) {
		throw new Error(`${name} must be a non-negative safe integer`);
	}
	return selected;
}

function boundedRatio(value: number | undefined, fallback: number, name: string): number {
	const selected = value ?? fallback;
	if (!Number.isFinite(selected) || selected < 0 || selected > 1) {
		throw new Error(`${name} must be between 0 and 1`);
	}
	return selected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRequestId(value: unknown): value is CodexAppServerRequestId {
	return typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}

function requestIdKey(value: CodexAppServerRequestId): string {
	return `${typeof value}:${String(value)}`;
}

function validateInitializeResponse(value: unknown): CodexAppServerInitializeResponse {
	if (!isRecord(value)) throw new CodexAppServerClientError("protocol_error", "Codex initialize returned a non-object result");
	const { codexHome, platformFamily, platformOs, userAgent } = value;
	for (const [field, fieldValue] of Object.entries({ codexHome, platformFamily, platformOs, userAgent })) {
		if (typeof fieldValue !== "string") {
			throw new CodexAppServerClientError("protocol_error", `Codex initialize result is missing ${field}`);
		}
	}
	return {
		codexHome: codexHome as string,
		platformFamily: platformFamily as string,
		platformOs: platformOs as string,
		userAgent: userAgent as string,
	};
}

function redactCodexAppServerDiagnostic(value: string): string {
	return value
		.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
		.replace(/\b(?:sk|pk|ghp|github_pat|pibo)[-_][A-Za-z0-9_-]{8,}\b/g, "[redacted]")
		.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
		.replace(/\b(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|token|secret|password)\b(\s*["']?\s*[:=]\s*["']?)([^\s"'&,}]+)/gi, "$1$2[redacted]")
		.slice(0, 4_000);
}

function validateClientOptions(options: CodexAppServerClientOptions): void {
	if (!options.command.trim()) throw new Error("command is required");
	if (!options.clientInfo.name.trim() || !options.clientInfo.version.trim()) {
		throw new Error("clientInfo.name and clientInfo.version are required");
	}
	positiveInteger(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, "startupTimeoutMs");
	positiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs");
	positiveInteger(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS, "shutdownTimeoutMs");
	positiveInteger(options.killTimeoutMs, DEFAULT_KILL_TIMEOUT_MS, "killTimeoutMs");
	positiveInteger(options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES, "maxMessageBytes");
	positiveInteger(options.maxPendingRequests, DEFAULT_MAX_PENDING_REQUESTS, "maxPendingRequests");
	nonNegativeInteger(options.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES, "maxStderrBytes");
	nonNegativeInteger(options.overloadRetry?.maxRetries, DEFAULT_OVERLOAD_RETRIES, "overloadRetry.maxRetries");
	nonNegativeInteger(options.overloadRetry?.baseDelayMs, DEFAULT_OVERLOAD_RETRY_BASE_MS, "overloadRetry.baseDelayMs");
	nonNegativeInteger(options.overloadRetry?.maxDelayMs, DEFAULT_OVERLOAD_RETRY_MAX_MS, "overloadRetry.maxDelayMs");
	boundedRatio(options.overloadRetry?.jitterRatio, DEFAULT_OVERLOAD_RETRY_JITTER, "overloadRetry.jitterRatio");
}

function serializeMessage(message: unknown, maxMessageBytes: number): string {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(message);
	} catch (error) {
		throw new CodexAppServerClientError("serialization_error", "Codex App Server message is not JSON serializable", { cause: error });
	}
	if (serialized === undefined) {
		throw new CodexAppServerClientError("serialization_error", "Codex App Server message serialized to undefined");
	}
	if (Buffer.byteLength(serialized, "utf8") > maxMessageBytes) {
		throw new CodexAppServerClientError("message_too_large", `Codex App Server message exceeds ${maxMessageBytes} bytes`);
	}
	return `${serialized}\n`;
}

function timeoutError(label: string): CodexAppServerClientError {
	return new CodexAppServerClientError("timeout", `${label} timed out`);
}

async function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(timeoutError(label)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (delayMs <= 0) return;
	if (signal?.aborted) throw new CodexAppServerClientError("aborted", "Codex App Server request was aborted");
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, delayMs);
		const onAbort = () => {
			cleanup();
			reject(new CodexAppServerClientError("aborted", "Codex App Server request was aborted"));
		};
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export class CodexAppServerClient {
	readonly initializeResponse: CodexAppServerInitializeResponse;

	private readonly process: ChildProcessWithoutNullStreams;
	private readonly startupTimeoutMs: number;
	private readonly requestTimeoutMs: number;
	private readonly shutdownTimeoutMs: number;
	private readonly killTimeoutMs: number;
	private readonly maxMessageBytes: number;
	private readonly maxPendingRequests: number;
	private readonly maxStderrBytes: number;
	private readonly overloadMaxRetries: number;
	private readonly overloadBaseDelayMs: number;
	private readonly overloadMaxDelayMs: number;
	private readonly overloadJitterRatio: number;
	private readonly random: () => number;
	private readonly onDiagnostic?: (diagnostic: CodexAppServerDiagnostic) => void;
	private readonly pending = new Map<string, PendingRequest>();
	private readonly notificationListeners = new Set<CodexAppServerNotificationListener>();
	private readonly diagnosticListeners = new Set<(diagnostic: CodexAppServerDiagnostic) => void>();
	private readonly diagnostics: CodexAppServerDiagnostic[] = [];
	private readonly spawned = deferred<void>();
	private readonly processClosed = deferred<ProcessClose>();
	private readonly stderrChunks: Buffer[] = [];
	private stdoutBuffer = Buffer.alloc(0);
	private stderrBytes = 0;
	private stderrTruncated = false;
	private nextRequestId = 0;
	private writeTail: Promise<void> = Promise.resolve();
	private writeBackpressureCount = 0;
	private state: CodexAppServerClientState = "starting";
	private processCloseResult?: ProcessClose;
	private serverRequestHandler?: CodexAppServerRequestHandler;
	private closePromise?: Promise<void>;
	private stopPromise?: Promise<void>;

	private constructor(process: ChildProcessWithoutNullStreams, options: CodexAppServerClientOptions, initializeResponse: CodexAppServerInitializeResponse) {
		this.process = process;
		this.initializeResponse = initializeResponse;
		this.startupTimeoutMs = positiveInteger(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, "startupTimeoutMs");
		this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS, "requestTimeoutMs");
		this.shutdownTimeoutMs = positiveInteger(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS, "shutdownTimeoutMs");
		this.killTimeoutMs = positiveInteger(options.killTimeoutMs, DEFAULT_KILL_TIMEOUT_MS, "killTimeoutMs");
		this.maxMessageBytes = positiveInteger(options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES, "maxMessageBytes");
		this.maxPendingRequests = positiveInteger(options.maxPendingRequests, DEFAULT_MAX_PENDING_REQUESTS, "maxPendingRequests");
		this.maxStderrBytes = nonNegativeInteger(options.maxStderrBytes, DEFAULT_MAX_STDERR_BYTES, "maxStderrBytes");
		this.overloadMaxRetries = nonNegativeInteger(options.overloadRetry?.maxRetries, DEFAULT_OVERLOAD_RETRIES, "overloadRetry.maxRetries");
		this.overloadBaseDelayMs = nonNegativeInteger(options.overloadRetry?.baseDelayMs, DEFAULT_OVERLOAD_RETRY_BASE_MS, "overloadRetry.baseDelayMs");
		this.overloadMaxDelayMs = nonNegativeInteger(options.overloadRetry?.maxDelayMs, DEFAULT_OVERLOAD_RETRY_MAX_MS, "overloadRetry.maxDelayMs");
		this.overloadJitterRatio = boundedRatio(options.overloadRetry?.jitterRatio, DEFAULT_OVERLOAD_RETRY_JITTER, "overloadRetry.jitterRatio");
		this.random = options.random ?? Math.random;
		this.onDiagnostic = options.onDiagnostic;
	}

	static async start(options: CodexAppServerClientOptions): Promise<CodexAppServerClient> {
		validateClientOptions(options);
		const process = spawn(options.command, [...(options.args ?? [])], {
			cwd: options.cwd,
			env: options.env ?? globalThis.process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const placeholder: CodexAppServerInitializeResponse = {
			codexHome: "",
			platformFamily: "",
			platformOs: "",
			userAgent: "",
		};
		const client = new CodexAppServerClient(process, options, placeholder);
		client.attachProcessListeners();
		const deadline = Date.now() + client.startupTimeoutMs;

		try {
			await waitWithTimeout(client.spawned.promise, client.startupTimeoutMs, "Codex App Server spawn");
			client.state = "initializing";
			const initializeResult = await client.requestWithRetry<unknown>(
				"initialize",
				{
					clientInfo: { ...options.clientInfo },
					capabilities: options.capabilities ? structuredClone(options.capabilities) : { experimentalApi: false },
				},
				{
					timeoutMs: Math.max(1, deadline - Date.now()),
					retryOverloaded: true,
				},
				true,
			);
			const initializeResponse = validateInitializeResponse(initializeResult);
			Object.assign(client.initializeResponse, initializeResponse);
			Object.freeze(client.initializeResponse);
			await waitWithTimeout(
				client.writeMessage({ method: "initialized" }, true),
				Math.max(1, deadline - Date.now()),
				"Codex App Server initialized notification",
			);
			client.state = "ready";
			return client;
		} catch (error) {
			const normalized = client.normalizeStartError(error);
			client.failAll(normalized);
			await client.stopProcess(false).catch(() => {});
			throw normalized;
		}
	}

	get snapshot(): CodexAppServerClientSnapshot {
		return {
			state: this.state,
			...(this.process.pid !== undefined ? { pid: this.process.pid } : {}),
			pendingRequests: this.pending.size,
			writeBackpressureCount: this.writeBackpressureCount,
			stderrBytes: this.stderrBytes,
			stderrTruncated: this.stderrTruncated,
		};
	}

	getStderrDiagnostic(): string {
		return redactCodexAppServerDiagnostic(Buffer.concat(this.stderrChunks).toString("utf8"));
	}

	getDiagnostics(): readonly CodexAppServerDiagnostic[] {
		return this.diagnostics.map((diagnostic) => ({ ...diagnostic }));
	}

	subscribeNotifications(listener: CodexAppServerNotificationListener): () => void {
		this.notificationListeners.add(listener);
		return () => this.notificationListeners.delete(listener);
	}

	subscribeDiagnostics(listener: (diagnostic: CodexAppServerDiagnostic) => void): () => void {
		this.diagnosticListeners.add(listener);
		return () => this.diagnosticListeners.delete(listener);
	}

	setServerRequestHandler(handler: CodexAppServerRequestHandler | undefined): void {
		this.serverRequestHandler = handler;
	}

	async request<TResult = unknown, TParams = unknown>(
		method: string,
		params?: TParams,
		options: CodexAppServerRequestOptions = {},
	): Promise<TResult> {
		this.assertReady();
		if (method === "initialize") {
			throw new CodexAppServerClientError("protocol_error", "Codex App Server initialize may only be sent once during startup");
		}
		return await this.requestWithRetry<TResult>(method, params, options, false);
	}

	async notify<TParams = unknown>(method: string, params?: TParams): Promise<void> {
		this.assertReady();
		if (method === "initialized") {
			throw new CodexAppServerClientError("protocol_error", "Codex App Server initialized may only be sent once during startup");
		}
		await this.writeMessage({ method, ...(params === undefined ? {} : { params }) }, false);
	}

	async close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closePromise = this.closeUnsafe();
		return this.closePromise;
	}

	private attachProcessListeners(): void {
		this.process.once("spawn", () => this.spawned.resolve());
		this.process.once("error", (error) => {
			const wrapped = new CodexAppServerClientError("spawn_failed", "Codex App Server process failed to start", { cause: error });
			this.spawned.reject(wrapped);
			if (this.state !== "closing" && this.state !== "closed") {
				this.state = "failed";
				this.failAll(wrapped);
				this.emitDiagnostic({ level: "error", code: "codex_process_error", message: wrapped.message });
			}
		});
		this.process.once("close", (code, signal) => this.handleProcessClose(code, signal));
		this.process.stdout.on("data", (chunk: Buffer | string) => this.handleStdoutChunk(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
		this.process.stderr.on("data", (chunk: Buffer | string) => this.captureStderr(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
	}

	private normalizeStartError(error: unknown): Error {
		if (error instanceof Error) return error;
		return new CodexAppServerClientError("spawn_failed", "Codex App Server startup failed");
	}

	private assertReady(): void {
		if (this.state === "ready") return;
		throw new CodexAppServerClientError("closed", `Codex App Server client is ${this.state}`);
	}

	private async requestWithRetry<TResult>(
		method: string,
		params: unknown,
		options: CodexAppServerRequestOptions,
		allowBeforeReady: boolean,
	): Promise<TResult> {
		if (!allowBeforeReady) this.assertReady();
		const timeoutMs = positiveInteger(options.timeoutMs, this.requestTimeoutMs, "request timeoutMs");
		const deadline = Date.now() + timeoutMs;
		const maxRetries = options.retryOverloaded === false ? 0 : this.overloadMaxRetries;
		let attempt = 0;

		while (true) {
			if (options.signal?.aborted) {
				throw new CodexAppServerClientError("aborted", "Codex App Server request was aborted");
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) throw timeoutError(`Codex App Server ${method} request`);
			try {
				return await this.requestOnce<TResult>(method, params, remaining, options.signal, allowBeforeReady);
			} catch (error) {
				if (!(error instanceof CodexAppServerRpcResponseError) || error.rpcCode !== CODEX_APP_SERVER_OVERLOADED || attempt >= maxRetries) {
					throw error;
				}
				const delayMs = this.overloadDelay(attempt);
				attempt += 1;
				if (delayMs >= deadline - Date.now()) throw timeoutError(`Codex App Server ${method} request`);
				await sleep(delayMs, options.signal);
			}
		}
	}

	private overloadDelay(attempt: number): number {
		const exponential = Math.min(this.overloadMaxDelayMs, this.overloadBaseDelayMs * 2 ** attempt);
		const jitter = exponential * this.overloadJitterRatio * (this.random() * 2 - 1);
		return Math.max(0, Math.round(exponential + jitter));
	}

	private async requestOnce<TResult>(
		method: string,
		params: unknown,
		timeoutMs: number,
		signal: AbortSignal | undefined,
		allowBeforeReady: boolean,
	): Promise<TResult> {
		if (!allowBeforeReady) this.assertReady();
		if (this.state === "closing" || this.state === "closed" || this.state === "failed") {
			throw new CodexAppServerClientError("closed", `Codex App Server client is ${this.state}`);
		}
		if (this.pending.size >= this.maxPendingRequests) {
			throw new CodexAppServerClientError("pending_limit", `Codex App Server pending request limit ${this.maxPendingRequests} reached`);
		}

		const id = this.allocateRequestId();
		const key = requestIdKey(id);
		let pending!: PendingRequest;
		const response = new Promise<unknown>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.settlePending(key, undefined, timeoutError(`Codex App Server ${method} request`));
			}, timeoutMs);
			pending = { resolve, reject, timer, signal };
			if (signal) {
				pending.onAbort = () => {
					this.settlePending(key, undefined, new CodexAppServerClientError("aborted", "Codex App Server request was aborted"));
				};
				signal.addEventListener("abort", pending.onAbort, { once: true });
			}
		});
		this.pending.set(key, pending);
		void response.catch(() => {});
		if (signal?.aborted) {
			this.settlePending(key, undefined, new CodexAppServerClientError("aborted", "Codex App Server request was aborted"));
			return await response as TResult;
		}

		try {
			await this.writeMessage({ id, method, ...(params === undefined ? {} : { params }) }, allowBeforeReady);
		} catch (error) {
			this.settlePending(
				key,
				undefined,
				error instanceof Error ? error : new CodexAppServerClientError("write_failed", "Codex App Server request write failed"),
			);
		}
		return await response as TResult;
	}

	private allocateRequestId(): number {
		const id = this.nextRequestId;
		this.nextRequestId = this.nextRequestId >= Number.MAX_SAFE_INTEGER ? 0 : this.nextRequestId + 1;
		return id;
	}

	private writeMessage(message: unknown, allowBeforeReady: boolean): Promise<void> {
		if (!allowBeforeReady && this.state !== "ready") {
			return Promise.reject(new CodexAppServerClientError("closed", `Codex App Server client is ${this.state}`));
		}
		const line = serializeMessage(message, this.maxMessageBytes);
		const write = this.writeTail.then(() => this.writeLine(line, allowBeforeReady));
		this.writeTail = write.catch(() => {});
		return write;
	}

	private async writeLine(line: string, allowBeforeReady: boolean): Promise<void> {
		if (this.state === "closing" || this.state === "closed" || this.state === "failed") {
			throw new CodexAppServerClientError("closed", `Codex App Server client is ${this.state}`);
		}
		if (!allowBeforeReady && this.state !== "ready") {
			throw new CodexAppServerClientError("closed", `Codex App Server client is ${this.state}`);
		}
		if (allowBeforeReady && this.state !== "initializing" && this.state !== "ready") {
			throw new CodexAppServerClientError("closed", `Codex App Server client is ${this.state}`);
		}
		if (this.process.stdin.destroyed || !this.process.stdin.writable) {
			throw new CodexAppServerClientError("write_failed", "Codex App Server stdin is not writable");
		}
		let accepted: boolean;
		try {
			accepted = this.process.stdin.write(line, "utf8");
		} catch (error) {
			throw new CodexAppServerClientError("write_failed", "Codex App Server stdin write failed", { cause: error });
		}
		if (accepted) return;
		this.writeBackpressureCount += 1;
		await new Promise<void>((resolve, reject) => {
			const onDrain = () => {
				cleanup();
				resolve();
			};
			const onError = (error: Error) => {
				cleanup();
				reject(new CodexAppServerClientError("write_failed", "Codex App Server stdin write failed", { cause: error }));
			};
			const onClose = () => {
				cleanup();
				reject(new CodexAppServerClientError("process_exited", "Codex App Server exited while a write was waiting for drain"));
			};
			const cleanup = () => {
				this.process.stdin.removeListener("drain", onDrain);
				this.process.stdin.removeListener("error", onError);
				this.process.removeListener("close", onClose);
			};
			this.process.stdin.once("drain", onDrain);
			this.process.stdin.once("error", onError);
			this.process.once("close", onClose);
		});
	}

	private handleStdoutChunk(chunk: Buffer): void {
		if (this.state === "closed") return;
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf(0x0a, offset);
			const end = newline < 0 ? chunk.length : newline;
			const fragment = chunk.subarray(offset, end);
			if (this.stdoutBuffer.length + fragment.length > this.maxMessageBytes) {
				this.protocolFailure("Codex App Server stdout message exceeded the configured byte limit", "codex_message_too_large", "message_too_large");
				return;
			}
			if (fragment.length > 0) this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, fragment]);
			if (newline < 0) return;
			const line = this.stdoutBuffer.length > 0 && this.stdoutBuffer.at(-1) === 0x0d
				? this.stdoutBuffer.subarray(0, -1)
				: this.stdoutBuffer;
			this.stdoutBuffer = Buffer.alloc(0);
			if (line.length > 0) this.handleStdoutLine(line);
			if (this.state === "failed") return;
			offset = newline + 1;
		}
	}

	private handleStdoutLine(line: Buffer): void {
		let message: unknown;
		try {
			message = JSON.parse(line.toString("utf8"));
		} catch {
			this.protocolFailure("Codex App Server emitted malformed JSON", "codex_malformed_json");
			return;
		}
		if (!isRecord(message)) {
			this.protocolFailure("Codex App Server emitted a non-object JSON message", "codex_invalid_message");
			return;
		}

		if (typeof message.method === "string") {
			if (Object.hasOwn(message, "id")) {
				if (!isRequestId(message.id)) {
					this.protocolFailure("Codex App Server emitted a request with an invalid id", "codex_invalid_request_id");
					return;
				}
				void this.handleServerRequest({
					id: message.id,
					method: message.method,
					...(Object.hasOwn(message, "params") ? { params: message.params as never } : {}),
				});
				return;
			}
			this.handleNotification({
				method: message.method,
				...(Object.hasOwn(message, "params") ? { params: message.params as never } : {}),
			});
			return;
		}

		if (!Object.hasOwn(message, "id") || !isRequestId(message.id)) {
			this.protocolFailure("Codex App Server emitted a response without a valid id", "codex_invalid_response_id");
			return;
		}
		const hasResult = Object.hasOwn(message, "result");
		const hasError = Object.hasOwn(message, "error");
		if (hasResult === hasError) {
			this.protocolFailure("Codex App Server response must contain exactly one of result or error", "codex_invalid_response");
			return;
		}
		const key = requestIdKey(message.id);
		if (!this.pending.has(key)) {
			this.emitDiagnostic({ level: "warning", code: "codex_unknown_response_id", message: "Codex App Server returned an unknown or expired request id" });
			return;
		}
		if (hasError) {
			if (!isRecord(message.error) || typeof message.error.code !== "number" || typeof message.error.message !== "string") {
				this.protocolFailure("Codex App Server returned a malformed error response", "codex_invalid_error_response");
				return;
			}
			this.settlePending(key, undefined, new CodexAppServerRpcResponseError({
				code: message.error.code,
				message: message.error.message,
				...(Object.hasOwn(message.error, "data") ? { data: message.error.data as never } : {}),
			}));
			return;
		}
		this.settlePending(key, message.result, undefined);
	}

	private handleNotification(notification: CodexAppServerServerNotification): void {
		for (const listener of [...this.notificationListeners]) {
			try {
				listener(notification);
			} catch {
				this.emitDiagnostic({ level: "warning", code: "codex_notification_listener_failed", message: "A Codex App Server notification listener failed" });
			}
		}
	}

	private async handleServerRequest(request: CodexAppServerServerRequest): Promise<void> {
		const handler = this.serverRequestHandler;
		if (!handler) {
			await this.writeMessage({
				id: request.id,
				error: { code: -32601, message: `Unsupported server request method: ${request.method}` },
			}, true).catch(() => {});
			return;
		}
		try {
			const result = await handler(request);
			await this.writeMessage({ id: request.id, result: result === undefined ? null : result }, true);
		} catch (error) {
			if (error instanceof CodexAppServerServerRequestCancelledError) return;
			const message = redactCodexAppServerDiagnostic(error instanceof Error ? error.message : "Server request handler failed");
			await this.writeMessage({ id: request.id, error: { code: -32000, message } }, true).catch(() => {});
		}
	}

	private settlePending(key: string, value: unknown, error: Error | undefined): void {
		const pending = this.pending.get(key);
		if (!pending) return;
		this.pending.delete(key);
		clearTimeout(pending.timer);
		if (pending.signal && pending.onAbort) pending.signal.removeEventListener("abort", pending.onAbort);
		if (error) pending.reject(error);
		else pending.resolve(value);
	}

	private failAll(error: Error): void {
		for (const key of [...this.pending.keys()]) this.settlePending(key, undefined, error);
	}

	private protocolFailure(
		message: string,
		diagnosticCode: string,
		errorCode: CodexAppServerClientErrorCode = "protocol_error",
	): void {
		if (this.state === "failed" || this.state === "closing" || this.state === "closed") return;
		this.state = "failed";
		const error = new CodexAppServerClientError(errorCode, message);
		this.emitDiagnostic({ level: "error", code: diagnosticCode, message });
		this.failAll(error);
		void this.stopProcess(false).catch(() => {});
	}

	private captureStderr(chunk: Buffer): void {
		if (this.maxStderrBytes === 0) {
			this.stderrTruncated = this.stderrTruncated || chunk.length > 0;
			return;
		}
		const remaining = this.maxStderrBytes - this.stderrBytes;
		if (remaining <= 0) {
			this.stderrTruncated = true;
			return;
		}
		const selected = chunk.subarray(0, remaining);
		this.stderrChunks.push(selected);
		this.stderrBytes += selected.length;
		if (selected.length < chunk.length) this.stderrTruncated = true;
	}

	private handleProcessClose(code: number | null, signal: NodeJS.Signals | null): void {
		if (this.processCloseResult) return;
		const result = { code, signal };
		this.processCloseResult = result;
		this.processClosed.resolve(result);
		const expected = this.state === "closing" || this.state === "closed";
		if (expected) {
			this.state = "closed";
			this.failAll(new CodexAppServerClientError("closed", "Codex App Server client closed"));
			return;
		}
		this.state = "failed";
		const suffix = this.getStderrDiagnostic();
		const error = new CodexAppServerClientError(
			"process_exited",
			`Codex App Server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})${suffix ? `: ${suffix}` : ""}`,
		);
		this.failAll(error);
		this.emitDiagnostic({ level: "error", code: "codex_process_exited", message: error.message });
	}

	private emitDiagnostic(diagnostic: CodexAppServerDiagnostic): void {
		const safe = { ...diagnostic, message: redactCodexAppServerDiagnostic(diagnostic.message) };
		this.diagnostics.push(safe);
		if (this.diagnostics.length > DEFAULT_MAX_DIAGNOSTICS) this.diagnostics.shift();
		try {
			this.onDiagnostic?.(safe);
		} catch {
			// Diagnostics must not destabilize the transport.
		}
		for (const listener of [...this.diagnosticListeners]) {
			try {
				listener(safe);
			} catch {
				// Diagnostics must not destabilize the transport.
			}
		}
	}

	private async closeUnsafe(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closing";
		this.failAll(new CodexAppServerClientError("closed", "Codex App Server client is closing"));
		await this.stopProcess(true);
		this.state = "closed";
	}

	private stopProcess(graceful: boolean): Promise<void> {
		if (this.stopPromise) return this.stopPromise;
		this.stopPromise = this.stopProcessUnsafe(graceful);
		return this.stopPromise;
	}

	private async stopProcessUnsafe(graceful: boolean): Promise<void> {
		if (this.processCloseResult) return;
		if (graceful) {
			if (!this.process.stdin.destroyed) this.process.stdin.end();
			if (await this.waitForProcessClose(this.shutdownTimeoutMs)) return;
		} else if (!this.process.stdin.destroyed) {
			this.process.stdin.destroy();
		}

		this.process.kill("SIGTERM");
		if (await this.waitForProcessClose(this.killTimeoutMs)) return;
		this.process.kill("SIGKILL");
		await this.waitForProcessClose(this.killTimeoutMs);
	}

	private async waitForProcessClose(timeoutMs: number): Promise<boolean> {
		if (this.processCloseResult) return true;
		let timer: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				this.processClosed.promise.then(() => true),
				new Promise<boolean>((resolve) => {
					timer = setTimeout(() => resolve(false), timeoutMs);
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}
