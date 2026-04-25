import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import type { PiboExecutionAction, PiboOutputEvent } from "../core/events.js";
import type { PiboSessionBinding } from "../sessions/bindings.js";
import {
	DEFAULT_REMOTE_AGENT_HOST,
	DEFAULT_REMOTE_AGENT_PORT,
	encodeRemoteAgentFrame,
	type RemoteAgentCapabilities,
	type RemoteAgentFrame,
	type RemoteAgentInput,
	type RemoteAgentResponseFrame,
} from "./protocol.js";

export type RemoteAgentSessionClientOptions = {
	host?: string;
	port?: number;
	sessionName?: string;
	profile?: string;
};

export type AttachedRemoteAgent = {
	binding: PiboSessionBinding;
	capabilities: RemoteAgentCapabilities;
};

export type RemoteAgentEventListener = (event: PiboOutputEvent) => void;

type PendingResponse = {
	resolve(response: RemoteAgentResponseFrame): void;
	reject(error: Error): void;
};

function parseJsonLine(line: string): RemoteAgentFrame | undefined {
	try {
		return JSON.parse(line) as RemoteAgentFrame;
	} catch {
		return undefined;
	}
}

function isBinding(value: unknown): value is PiboSessionBinding {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { sessionKey?: unknown; originalProfile?: unknown };
	return typeof candidate.sessionKey === "string" && typeof candidate.originalProfile === "string";
}

function isCapabilities(value: unknown): value is RemoteAgentCapabilities {
	if (!value || typeof value !== "object") return false;
	const candidate = value as { actions?: unknown };
	return Array.isArray(candidate.actions);
}

export function createRemoteSlashCommandMap(capabilities: RemoteAgentCapabilities): Map<string, string> {
	const commands = new Map<string, string>();
	for (const action of capabilities.actions) {
		for (const slashCommand of action.slashCommands) {
			commands.set(`/${slashCommand}`, action.name);
		}
	}
	return commands;
}

export class RemoteAgentSessionClient {
	readonly binding: PiboSessionBinding;
	readonly capabilities: RemoteAgentCapabilities;

	private readonly eventListeners = new Set<RemoteAgentEventListener>();
	private readonly pendingResponses = new Map<string, PendingResponse>();
	private buffer = "";

	private constructor(
		private readonly socket: Socket,
		attached: AttachedRemoteAgent,
	) {
		this.binding = attached.binding;
		this.capabilities = attached.capabilities;
		this.socket.on("data", (chunk) => this.handleData(String(chunk)));
		this.socket.once("close", () => this.rejectPendingResponses(new Error("Remote agent connection closed")));
		this.socket.once("error", (error) => this.rejectPendingResponses(error));
	}

	static async connect(options: RemoteAgentSessionClientOptions = {}): Promise<RemoteAgentSessionClient> {
		const resolvedOptions = {
			host: options.host ?? DEFAULT_REMOTE_AGENT_HOST,
			port: options.port ?? DEFAULT_REMOTE_AGENT_PORT,
			sessionName: options.sessionName ?? "default",
			profile: options.profile ?? "pibo-minimal",
		};
		const socket = connect({ host: resolvedOptions.host, port: resolvedOptions.port });
		socket.setEncoding("utf-8");

		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});

		const attached = await attachRemoteAgent(socket, resolvedOptions);
		return new RemoteAgentSessionClient(socket, attached);
	}

	onEvent(listener: RemoteAgentEventListener): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	getSlashCommands(): Map<string, string> {
		return createRemoteSlashCommandMap(this.capabilities);
	}

	sendMessage(text: string): Promise<RemoteAgentResponseFrame> {
		return this.sendInput({ type: "message", text });
	}

	sendExecution(action: PiboExecutionAction): Promise<RemoteAgentResponseFrame> {
		return this.sendInput({ type: "execution", action });
	}

	close(): void {
		this.socket.end();
	}

	private sendInput(input: RemoteAgentInput): Promise<RemoteAgentResponseFrame> {
		return this.sendRequest({ type: "remote_input", id: randomUUID(), input });
	}

	private sendRequest(frame: Extract<RemoteAgentFrame, { id: string }>): Promise<RemoteAgentResponseFrame> {
		if (this.socket.destroyed) {
			return Promise.reject(new Error("Remote agent connection is closed"));
		}

		return new Promise<RemoteAgentResponseFrame>((resolve, reject) => {
			this.pendingResponses.set(frame.id, { resolve, reject });
			this.socket.write(encodeRemoteAgentFrame(frame));
		});
	}

	private handleData(chunk: string): void {
		this.buffer += chunk;
		let newlineIndex = this.buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = this.buffer.slice(0, newlineIndex).trim();
			this.buffer = this.buffer.slice(newlineIndex + 1);
			this.handleFrame(line ? parseJsonLine(line) : undefined);
			newlineIndex = this.buffer.indexOf("\n");
		}
	}

	private handleFrame(frame: RemoteAgentFrame | undefined): void {
		if (!frame) return;

		if (frame.type === "remote_res") {
			const pending = this.pendingResponses.get(frame.id);
			if (!pending) return;
			this.pendingResponses.delete(frame.id);
			if (frame.ok) {
				pending.resolve(frame);
			} else {
				pending.reject(new Error(frame.error?.message ?? "Remote request failed"));
			}
			return;
		}

		if (frame.type === "remote_event") {
			for (const listener of this.eventListeners) {
				listener(frame.payload);
			}
		}
	}

	private rejectPendingResponses(error: Error): void {
		for (const pending of this.pendingResponses.values()) {
			pending.reject(error);
		}
		this.pendingResponses.clear();
	}
}

async function attachRemoteAgent(
	socket: Socket,
	options: Required<RemoteAgentSessionClientOptions>,
): Promise<AttachedRemoteAgent> {
	const id = randomUUID();

	return await new Promise<AttachedRemoteAgent>((resolve, reject) => {
		let buffer = "";
		const cleanup = () => {
			socket.off("data", onData);
			socket.off("error", onError);
			socket.off("close", onClose);
		};
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};
		const onClose = () => {
			cleanup();
			reject(new Error("Remote agent connection closed before attach completed"));
		};
		const onData = (chunk: string | Buffer) => {
			buffer += String(chunk);
			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex).trim();
				buffer = buffer.slice(newlineIndex + 1);
				const frame = line ? parseJsonLine(line) : undefined;
				if (frame?.type === "remote_res" && frame.id === id) {
					cleanup();
					if (!frame.ok) {
						reject(new Error(frame.error?.message ?? "Remote attach failed"));
						return;
					}
					const payload = frame.payload as { binding?: unknown; capabilities?: unknown } | undefined;
					if (!isBinding(payload?.binding)) {
						reject(new Error("Remote attach response did not include a binding"));
						return;
					}
					if (!isCapabilities(payload.capabilities)) {
						reject(new Error("Remote attach response did not include capabilities"));
						return;
					}
					resolve({
						binding: payload.binding,
						capabilities: payload.capabilities,
					});
					return;
				}
				newlineIndex = buffer.indexOf("\n");
			}
		};

		socket.on("data", onData);
		socket.once("error", onError);
		socket.once("close", onClose);
		socket.write(
			encodeRemoteAgentFrame({
				type: "remote_attach",
				id,
				sessionName: options.sessionName,
				profile: options.profile,
			}),
		);
	});
}
