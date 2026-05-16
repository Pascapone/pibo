import { randomUUID } from "node:crypto";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { createDefaultPiboDataSessionStore } from "../sessions/pibo-data-store.js";
import type { PiboSession, PiboSessionStore } from "../sessions/store.js";
import type { PiboEventListener, PiboInputEvent, PiboOutputEvent, PiboSessionStatus } from "../core/events.js";
import { getDefaultPiboWorkspace } from "../core/workspace.js";
import type { PiboSessionTraceView, PiboTraceNode, PiboTraceNodeStatus } from "../shared/trace-types.js";
import {
	CliSourceError,
	type CliAgentSummary,
	type CliOpenSession,
	type CliRoomSummary,
	type CliRuntimeStatus,
	type CliSessionSource,
	type CliSessionSummary,
	type CliSessionUpdate,
	type CliSessionUpdateListener,
	type CreateCliSessionInput,
} from "./sessionSource.js";

export type CliRoomProvider = {
	listRooms(input?: { ownerScope?: string }): Promise<readonly CliRoomSummary[]> | readonly CliRoomSummary[];
};

export type LocalCliSessionRouter = {
	emit(event: PiboInputEvent): Promise<PiboOutputEvent>;
	subscribe(listener: PiboEventListener): () => void;
	getSessionRuntimeStatus?(piboSessionId: string): PiboSessionStatus | undefined;
	disposeAll?(): Promise<void>;
};

export type LocalCliSessionSourceOptions = {
	ownerScope?: string;
	sessionStore?: PiboSessionStore;
	ownsSessionStore?: boolean;
	roomProvider?: CliRoomProvider;
	pluginRegistry?: PiboPluginRegistry;
	router?: LocalCliSessionRouter;
	ownsRouter?: boolean;
	now?: () => string;
	statusMessage?: string;
};

export class LocalCliSessionSource implements CliSessionSource {
	private readonly ownerScope?: string;
	private readonly sessionStore: PiboSessionStore;
	private readonly ownsSessionStore: boolean;
	private readonly roomProvider?: CliRoomProvider;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly router?: LocalCliSessionRouter;
	private readonly ownsRouter: boolean;
	private readonly unsubscribeRouter?: () => void;
	private readonly now: () => string;
	private readonly statusMessage?: string;
	private readonly traceViews = new Map<string, PiboSessionTraceView>();
	private readonly listeners = new Map<string, Set<CliSessionUpdateListener>>();
	private readonly openHandles = new Set<{ sessionId: string; close: () => void }>();
	private closed = false;

	constructor(options: LocalCliSessionSourceOptions = {}) {
		this.ownerScope = options.ownerScope;
		this.sessionStore = options.sessionStore ?? createDefaultPiboDataSessionStore();
		this.ownsSessionStore = options.ownsSessionStore ?? options.sessionStore === undefined;
		this.roomProvider = options.roomProvider;
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
		this.router = options.router;
		this.ownsRouter = options.ownsRouter ?? false;
		this.unsubscribeRouter = this.router?.subscribe((event) => this.handleRouterEvent(event));
		this.now = options.now ?? (() => new Date().toISOString());
		this.statusMessage = options.statusMessage;
	}

	async listRooms(): Promise<readonly CliRoomSummary[]> {
		this.assertOpen();
		if (this.roomProvider) {
			return (await this.roomProvider.listRooms({ ownerScope: this.ownerScope })).map(cloneJson);
		}
		return deriveRoomsFromSessions(this.readSessions()).map(cloneJson);
	}

	async listSessions(input: { roomId?: string } = {}): Promise<readonly CliSessionSummary[]> {
		this.assertOpen();
		return this.readSessions()
			.filter((session) => input.roomId === undefined || roomIdFromSession(session) === input.roomId)
			.map(sessionToSummary);
	}

	async createSession(input: CreateCliSessionInput = {}): Promise<CliSessionSummary> {
		this.assertOpen();
		const agent = input.agentId ? this.resolveAgent(input.agentId) : undefined;
		const profile = this.resolveProfile(input.profile ?? agent?.profileName ?? agent?.id ?? this.defaultProfileName());
		const metadata = buildSessionMetadata(input.roomId, "idle");
		const session = this.sessionStore.create({
			channel: "cli-session-ui",
			kind: "chat",
			profile,
			ownerScope: input.ownerScope ?? this.ownerScope,
			workspace: input.workspace ?? getDefaultPiboWorkspace(),
			title: input.title?.trim() || "New CLI session",
			metadata,
		});
		this.traceViews.set(session.id, emptyTraceView(session));
		const summary = sessionToSummary(session);
		this.emit(session.id, { type: "session", session: summary, traceView: cloneJson(this.traceViews.get(session.id) ?? null), status: await this.getStatus({ sessionId: session.id }) });
		return summary;
	}

	async openSession(sessionId: string): Promise<CliOpenSession> {
		this.assertOpen();
		const session = this.resolveSession(sessionId);
		let handleClosed = false;
		const handleListeners = new Set<CliSessionUpdateListener>();
		const removeFromSource = () => {
			const sourceListeners = this.listeners.get(sessionId);
			if (!sourceListeners) return;
			for (const listener of handleListeners) sourceListeners.delete(listener);
			if (sourceListeners.size === 0) this.listeners.delete(sessionId);
		};
		const handle = {
			sessionId,
			close: () => {
				if (handleClosed) return;
				handleClosed = true;
				removeFromSource();
				this.openHandles.delete(handle);
			},
		};
		this.openHandles.add(handle);
		return {
			session: sessionToSummary(session),
			traceView: cloneJson(this.traceViews.get(sessionId) ?? emptyTraceView(session)),
			status: await this.getStatus({ sessionId }),
			subscribe: (listener) => {
				if (handleClosed) throw new CliSourceError("session_closed", `CLI session handle for "${sessionId}" is closed`);
				handleListeners.add(listener);
				let sourceListeners = this.listeners.get(sessionId);
				if (!sourceListeners) {
					sourceListeners = new Set();
					this.listeners.set(sessionId, sourceListeners);
				}
				sourceListeners.add(listener);
				return () => {
					handleListeners.delete(listener);
					const listeners = this.listeners.get(sessionId);
					listeners?.delete(listener);
					if (listeners?.size === 0) this.listeners.delete(sessionId);
				};
			},
			close: handle.close,
		};
	}

	async sendMessage(sessionId: string, text: string): Promise<void> {
		this.assertOpen();
		const trimmed = text.trim();
		if (!trimmed) throw new CliSourceError("empty_message", "Message text is empty");
		this.resolveSession(sessionId);
		const eventId = randomUUID();
		if (this.router) {
			try {
				await this.router.emit({ type: "message", piboSessionId: sessionId, id: eventId, text: trimmed, source: "ui" });
			} catch (error) {
				this.recordLocalError(sessionId, eventId, error);
				throw toCliSourceError("send_failed", `Failed to send local CLI message to session "${sessionId}"`, error);
			}
			return;
		}
		this.recordLocalUserMessage(sessionId, eventId, trimmed, "done");
		this.updateSessionStatus(sessionId, "idle");
	}

	async listAgents(): Promise<readonly CliAgentSummary[]> {
		this.assertOpen();
		return this.pluginRegistry.getProfileInfos().map((profile) => ({
			id: profile.name,
			name: profile.name,
			description: profile.description,
			profileName: profile.name,
		}));
	}

	async setSessionAgent(_sessionId: string, agentId: string): Promise<CliSessionSummary> {
		this.assertOpen();
		this.resolveAgent(agentId);
		throw new CliSourceError("unsupported", "Changing an existing local session profile is not supported by the CLI source");
	}

	async getStatus(input: { sessionId?: string } = {}): Promise<CliRuntimeStatus> {
		this.assertOpen();
		if (input.sessionId) {
			const session = this.resolveSession(input.sessionId);
			return this.buildStatus(session);
		}
		const sessions = this.readSessions();
		const rooms = this.roomProvider ? "supported" : deriveRoomsFromSessions(sessions).length > 0 ? "supported" : "unknown";
		return {
			source: "local/direct",
			mode: "local",
			connected: true,
			rooms,
			sessions: "supported",
			agents: "supported",
			message: redactCliSecretText(this.statusMessage ?? `Local CLI source ready; discovered ${sessions.length} session${sessions.length === 1 ? "" : "s"}.`),
			updatedAt: this.now(),
		};
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		for (const handle of [...this.openHandles]) handle.close();
		this.listeners.clear();
		this.unsubscribeRouter?.();
		if (this.ownsRouter) await this.router?.disposeAll?.();
		if (this.ownsSessionStore) this.sessionStore.close?.();
	}

	listenerCount(sessionId?: string): number {
		if (sessionId) return this.listeners.get(sessionId)?.size ?? 0;
		let count = 0;
		for (const listeners of this.listeners.values()) count += listeners.size;
		return count;
	}

	private readSessions(): PiboSession[] {
		const sessions = this.sessionStore.list ? this.sessionStore.list() : this.sessionStore.find({});
		return sessions
			.filter((session) => this.ownerScope === undefined || session.ownerScope === this.ownerScope)
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
	}

	private resolveSession(sessionId: string): PiboSession {
		const session = this.sessionStore.get(sessionId);
		if (!session || (this.ownerScope !== undefined && session.ownerScope !== this.ownerScope)) {
			throw new CliSourceError("session_not_found", `No local Pibo session found for "${sessionId}"`);
		}
		return session;
	}

	private resolveAgent(agentId: string): CliAgentSummary {
		const agent = this.pluginRegistry.getProfileInfos().find((candidate) => candidate.name === agentId || candidate.aliases.includes(agentId));
		if (!agent) throw new CliSourceError("agent_not_found", `No local profile found for "${agentId}"`);
		return { id: agent.name, name: agent.name, description: agent.description, profileName: agent.name };
	}

	private resolveProfile(profile: string): string {
		try {
			return this.pluginRegistry.resolveProfileName(profile);
		} catch (error) {
			throw toCliSourceError("agent_not_found", `No local profile found for "${profile}"`, error);
		}
	}

	private defaultProfileName(): string {
		const names = this.pluginRegistry.getProfileNames();
		return names.includes("pibo-agent") ? "pibo-agent" : names.includes("codex-compat-openai-web") ? "codex-compat-openai-web" : names[0] ?? "pibo-agent";
	}

	private handleRouterEvent(event: PiboOutputEvent): void {
		if (this.closed) return;
		const session = this.sessionStore.get(event.piboSessionId);
		if (!session || (this.ownerScope !== undefined && session.ownerScope !== this.ownerScope)) return;
		this.recordOutputEvent(event);
	}

	private recordOutputEvent(event: PiboOutputEvent): void {
		const sessionId = event.piboSessionId;
		const eventId = "eventId" in event ? event.eventId : undefined;
		if (event.type === "message_queued" || event.type === "message_started") {
			this.recordLocalUserMessage(sessionId, eventId ?? randomUUID(), event.text, event.type === "message_started" ? "running" : "done");
			this.updateSessionStatus(sessionId, "running");
			return;
		}
		if (event.type === "message_finished") {
			this.updateSessionStatus(sessionId, "idle");
			return;
		}
		if (event.type === "assistant_delta") {
			this.upsertTraceNode(sessionId, {
				id: traceNodeId("assistant", eventId, event.assistantIndex ?? event.contentIndex),
				piboSessionId: sessionId,
				type: "assistant.message",
				title: "Agent Message",
				status: "running",
				startedAt: this.now(),
				output: event.text,
				children: [],
			}, { appendOutput: true, rawEvent: event });
			return;
		}
		if (event.type === "assistant_message") {
			this.upsertTraceNode(sessionId, {
				id: traceNodeId("assistant", eventId, event.assistantIndex ?? event.contentIndex),
				piboSessionId: sessionId,
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				startedAt: this.now(),
				completedAt: this.now(),
				output: event.text,
				children: [],
			}, { rawEvent: event });
			return;
		}
		if (event.type === "tool_call" || event.type === "tool_execution_started" || event.type === "tool_execution_updated" || event.type === "tool_execution_finished") {
			const finished = event.type === "tool_execution_finished";
			this.upsertTraceNode(sessionId, {
				id: traceNodeId("tool", event.toolCallId),
				piboSessionId: sessionId,
				eventId,
				toolCallId: event.toolCallId,
				type: finished ? "tool.result" : "tool.call",
				title: event.toolName,
				status: finished ? (event.isError ? "error" : "done") : "running",
				startedAt: this.now(),
				completedAt: finished ? this.now() : undefined,
				input: "args" in event ? event.args : undefined,
				output: finished ? event.result : "partialResult" in event ? event.partialResult : undefined,
				children: [],
			}, { rawEvent: event });
			return;
		}
		if (event.type === "session_error") {
			this.recordLocalError(sessionId, eventId ?? randomUUID(), event.error);
			return;
		}
		this.appendRawEvent(sessionId, event);
	}

	private recordLocalUserMessage(sessionId: string, eventId: string, text: string, status: PiboTraceNodeStatus): void {
		this.upsertTraceNode(sessionId, {
			id: traceNodeId("user", eventId),
			piboSessionId: sessionId,
			eventId,
			type: "user.message",
			title: "User Message",
			status,
			startedAt: this.now(),
			completedAt: status === "done" ? this.now() : undefined,
			output: text,
			children: [],
		}, { rawEvent: { type: "message_queued", piboSessionId: sessionId, eventId, queuedMessages: 0, text, source: "ui" } });
	}

	private recordLocalError(sessionId: string, eventId: string, error: unknown): void {
		this.upsertTraceNode(sessionId, {
			id: traceNodeId("error", eventId),
			piboSessionId: sessionId,
			eventId,
			type: "error",
			title: "CLI source error",
			status: "error",
			startedAt: this.now(),
			completedAt: this.now(),
			error: error instanceof Error ? error.message : String(error),
			children: [],
		}, { rawEvent: { type: "session_error", piboSessionId: sessionId, eventId, error: error instanceof Error ? error.message : String(error) } });
		this.updateSessionStatus(sessionId, "error");
	}

	private upsertTraceNode(sessionId: string, node: PiboTraceNode, options: { appendOutput?: boolean; rawEvent?: PiboOutputEvent } = {}): void {
		const session = this.resolveSession(sessionId);
		const traceView = cloneJson(this.traceViews.get(sessionId) ?? emptyTraceView(session));
		const index = traceView.nodes.findIndex((candidate) => candidate.id === node.id);
		if (index >= 0) {
			const previous = traceView.nodes[index]!;
			const output = options.appendOutput && typeof previous.output === "string" && typeof node.output === "string"
				? previous.output + node.output
				: node.output;
			traceView.nodes[index] = { ...previous, ...node, output, children: node.children ?? previous.children };
		} else {
			traceView.nodes.push(node);
		}
		if (options.rawEvent) traceView.rawEvents.push(storedEvent(options.rawEvent, this.now(), traceView.rawEvents.length + 1));
		traceView.eventCount = traceView.rawEvents.length;
		traceView.version = `local-${traceView.rawEvents.length}-${session.updatedAt}`;
		this.traceViews.set(sessionId, traceView);
		this.emit(sessionId, { type: "trace", session: sessionToSummary(session), traceView: cloneJson(traceView) });
	}

	private appendRawEvent(sessionId: string, event: PiboOutputEvent): void {
		const session = this.resolveSession(sessionId);
		const traceView = cloneJson(this.traceViews.get(sessionId) ?? emptyTraceView(session));
		traceView.rawEvents.push(storedEvent(event, this.now(), traceView.rawEvents.length + 1));
		traceView.eventCount = traceView.rawEvents.length;
		traceView.version = `local-${traceView.rawEvents.length}-${session.updatedAt}`;
		this.traceViews.set(sessionId, traceView);
		this.emit(sessionId, { type: "trace", session: sessionToSummary(session), traceView: cloneJson(traceView) });
	}

	private updateSessionStatus(sessionId: string, status: CliSessionSummary["status"]): void {
		const session = this.resolveSession(sessionId);
		const updated = this.sessionStore.update(sessionId, { metadata: { ...(session.metadata ?? {}), status } }) ?? session;
		const summary = sessionToSummary(updated);
		this.emit(sessionId, { type: "session", session: summary, status: this.buildStatus(updated) });
	}

	private buildStatus(session: PiboSession): CliRuntimeStatus {
		const runtime = this.router?.getSessionRuntimeStatus?.(session.id);
		return {
			source: "local/direct",
			mode: "local",
			connected: true,
			rooms: "supported",
			sessions: "supported",
			agents: "supported",
			activeRoomId: roomIdFromSession(session),
			activeSessionId: session.id,
			activeAgentId: session.profile,
			activeModel: session.activeModel,
			message: redactCliSecretText(runtime ? `Runtime ready; queued=${runtime.queuedMessages} processing=${runtime.processing} streaming=${runtime.streaming}` : this.statusMessage ?? "Local CLI source ready."),
			updatedAt: this.now(),
		};
	}

	private emit(sessionId: string, update: CliSessionUpdate): void {
		const listeners = [...(this.listeners.get(sessionId) ?? [])];
		for (const listener of listeners) listener(update);
	}

	private assertOpen(): void {
		if (this.closed) throw new CliSourceError("source_closed", "Local CLI session source is closed");
	}
}

export function createLocalCliSessionSource(options: LocalCliSessionSourceOptions = {}): LocalCliSessionSource {
	return new LocalCliSessionSource(options);
}

export function redactCliSecretText(text: string): string {
	return text
		.replace(/\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]")
		.replace(/\b(?:sk|pk|pibo|ghp|github_pat)_[A-Za-z0-9_\-]{8,}\b/g, "[redacted]");
}

function sessionToSummary(session: PiboSession): CliSessionSummary {
	return {
		id: session.id,
		title: session.title?.trim() || session.id,
		roomId: roomIdFromSession(session),
		profile: session.profile,
		agentId: session.profile,
		ownerScope: session.ownerScope,
		workspace: session.workspace,
		status: statusFromSession(session),
		model: session.activeModel,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

function deriveRoomsFromSessions(sessions: readonly PiboSession[]): CliRoomSummary[] {
	const rooms = new Map<string, CliRoomSummary>();
	for (const session of sessions) {
		const roomId = roomIdFromSession(session);
		if (!roomId || rooms.has(roomId)) continue;
		rooms.set(roomId, {
			id: roomId,
			title: stringMetadata(session, "chatRoomName") ?? stringMetadata(session, "roomName") ?? roomId,
			description: "Derived from local session metadata",
		});
	}
	return [...rooms.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function roomIdFromSession(session: PiboSession): string | undefined {
	return stringMetadata(session, "chatRoomId") ?? stringMetadata(session, "roomId");
}

function statusFromSession(session: PiboSession): CliSessionSummary["status"] {
	const status = session.metadata?.status;
	return status === "idle" || status === "running" || status === "error" ? status : "unknown";
}

function stringMetadata(session: PiboSession, key: string): string | undefined {
	const value = session.metadata?.[key];
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function buildSessionMetadata(roomId: string | undefined, status: CliSessionSummary["status"]): PiboSession["metadata"] {
	return roomId
		? { chatRoomId: roomId, roomId, status, source: "pibo tui:sessions" }
		: { status, source: "pibo tui:sessions" };
}

function emptyTraceView(session: PiboSession): PiboSessionTraceView {
	return {
		piboSessionId: session.id,
		piSessionId: session.piSessionId,
		title: session.title?.trim() || session.id,
		version: `local-empty-${session.updatedAt}`,
		eventCount: 0,
		nodes: [],
		rawEvents: [],
	};
}

function storedEvent(event: PiboOutputEvent, createdAt: string, eventSequence: number): PiboSessionTraceView["rawEvents"][number] {
	const eventId = "eventId" in event ? event.eventId : undefined;
	return {
		id: eventId ?? `${event.piboSessionId}-${event.type}-${eventSequence}`,
		piboSessionId: event.piboSessionId,
		eventSequence,
		eventId,
		type: event.type,
		createdAt,
		payload: cloneJson(event),
	};
}

function traceNodeId(kind: string, eventId: string | undefined, index?: number): string {
	return ["local", kind, eventId ?? "event", index].filter((part) => part !== undefined).join(":");
}

function toCliSourceError(code: string, message: string, cause: unknown): CliSourceError {
	return cause instanceof CliSourceError ? cause : new CliSourceError(code, message, { cause });
}

function cloneJson<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
