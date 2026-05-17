import type { PiboSessionTraceView, PiboTraceNode } from "../shared/trace-types.js";
import { buildSlashCommandCatalog, normalizeCommandErrorDescriptor, normalizeCommandResultDescriptor, type GatewayCommandCapability, type SlashCommandDescriptor } from "../session-ui/index.js";
import {
	CliSourceError,
	type CliAgentSummary,
	type CliOpenSession,
	type CliOwnerSummary,
	type CliRoomSummary,
	type CliRuntimeStatus,
	type CliSessionSource,
	type CliSessionSummary,
	type CliSessionUpdate,
	type CliSessionUpdateListener,
	type CreateCliSessionInput,
	type ExecuteCliSlashCommandInput,
	type ExecuteCliSlashCommandResult,
} from "./sessionSource.js";

export type FakeCliSessionSourceOptions = {
	owners?: readonly CliOwnerSummary[];
	activeOwnerScope?: string;
	rooms?: readonly CliRoomSummary[];
	sessions?: readonly CliSessionSummary[];
	agents?: readonly CliAgentSummary[];
	commandCapabilities?: readonly GatewayCommandCapability[];
	traceViews?: Readonly<Record<string, PiboSessionTraceView | null>>;
	status?: Partial<CliRuntimeStatus>;
	now?: () => string;
	assistantReply?: string | ((message: string, session: CliSessionSummary) => string | undefined);
	actionHandler?: (input: ExecuteCliSlashCommandInput, source: FakeCliSessionSource) => unknown | Promise<unknown>;
};

export class FakeCliSessionSource implements CliSessionSource {
	private readonly owners: CliOwnerSummary[];
	private activeOwnerScope: string;
	private readonly rooms: CliRoomSummary[];
	private readonly sessions = new Map<string, CliSessionSummary>();
	private readonly agents: CliAgentSummary[];
	private readonly slashCommands: SlashCommandDescriptor[];
	private readonly traceViews = new Map<string, PiboSessionTraceView | null>();
	private readonly listeners = new Map<string, Set<CliSessionUpdateListener>>();
	private readonly openHandles = new Set<{ sessionId: string; close: () => void }>();
	private readonly now: () => string;
	private readonly assistantReply?: string | ((message: string, session: CliSessionSummary) => string | undefined);
	private readonly actionHandler?: (input: ExecuteCliSlashCommandInput, source: FakeCliSessionSource) => unknown | Promise<unknown>;
	private nextSessionNumber = 1;
	private closed = false;
	private statusOverrides: Partial<CliRuntimeStatus>;

	constructor(options: FakeCliSessionSourceOptions = {}) {
		this.now = options.now ?? (() => new Date().toISOString());
		this.assistantReply = options.assistantReply;
		this.actionHandler = options.actionHandler;
		this.owners = [...(options.owners ?? defaultOwners())].map(cloneJson);
		this.activeOwnerScope = options.activeOwnerScope ?? this.owners[0]?.ownerScope ?? "user:fake";
		this.rooms = [...(options.rooms ?? defaultRooms())].map(cloneJson);
		this.agents = [...(options.agents ?? defaultAgents())].map(cloneJson);
		this.slashCommands = buildSlashCommandCatalog(options.commandCapabilities).map(cloneJson);
		for (const session of options.sessions ?? defaultSessions()) {
			this.sessions.set(session.id, cloneJson(session));
		}
		for (const [sessionId, traceView] of Object.entries(options.traceViews ?? defaultTraceViews())) {
			this.traceViews.set(sessionId, cloneTraceView(traceView));
		}
		this.statusOverrides = options.status ?? {};
	}

	async getActiveOwner(): Promise<CliOwnerSummary> {
		this.assertOpen();
		return cloneJson(this.activeOwner());
	}

	async setActiveOwner(ownerScope: string): Promise<CliOwnerSummary> {
		this.assertOpen();
		const owner = this.owners.find((candidate) => candidate.ownerScope === ownerScope);
		if (!owner) throw new CliSourceError("owner_not_found", `No CLI owner fixture found for "${ownerScope}"`);
		this.activeOwnerScope = owner.ownerScope;
		return cloneJson(owner);
	}

	async listOwners(): Promise<readonly CliOwnerSummary[]> {
		this.assertOpen();
		return this.owners.map(cloneJson);
	}

	async listRooms(input: { ownerScope?: string } = {}): Promise<readonly CliRoomSummary[]> {
		this.assertOpen();
		const ownerScope = input.ownerScope ?? this.activeOwnerScope;
		return this.rooms.filter((room) => room.ownerScope === undefined || room.ownerScope === ownerScope).map(cloneJson);
	}

	async listSessions(input: { roomId?: string; ownerScope?: string } = {}): Promise<readonly CliSessionSummary[]> {
		this.assertOpen();
		const ownerScope = input.ownerScope ?? this.activeOwnerScope;
		return [...this.sessions.values()]
			.filter((session) => session.ownerScope === undefined || session.ownerScope === ownerScope)
			.filter((session) => input.roomId === undefined || session.roomId === input.roomId)
			.sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
			.map(cloneJson);
	}

	async createSession(input: CreateCliSessionInput = {}): Promise<CliSessionSummary> {
		this.assertOpen();
		const createdAt = this.now();
		const agent = input.agentId ? this.resolveAgent(input.agentId) : undefined;
		const profile = input.profile ?? agent?.profileName ?? agent?.id ?? "pibo-agent";
		const session: CliSessionSummary = {
			id: `ps_fake_created_${this.nextSessionNumber++}`,
			title: input.title?.trim() || "New CLI session",
			roomId: input.roomId,
			profile,
			agentId: agent?.id ?? input.agentId,
			ownerScope: input.ownerScope ?? this.activeOwnerScope,
			workspace: input.workspace,
			status: "idle",
			createdAt,
			updatedAt: createdAt,
		};
		this.sessions.set(session.id, session);
		this.traceViews.set(session.id, emptyTraceView(session));
		this.emit(session.id, { type: "session", session: cloneJson(session), traceView: cloneTraceView(this.traceViews.get(session.id) ?? null) });
		return cloneJson(session);
	}

	async openSession(sessionId: string): Promise<CliOpenSession> {
		this.assertOpen();
		const session = this.resolveSession(sessionId);
		this.assertSessionOwner(session);
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
			session: cloneJson(session),
			traceView: cloneTraceView(this.traceViews.get(sessionId) ?? null),
			status: this.buildStatus(sessionId),
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
		const session = this.resolveSession(sessionId);
		this.assertSessionOwner(session);
		const updated = { ...session, status: "running" as const, updatedAt: this.now() };
		this.sessions.set(sessionId, updated);
		const existing = this.traceViews.get(sessionId) ?? emptyTraceView(updated);
		const node: PiboTraceNode = {
			id: `node_fake_user_${existing.nodes.length + 1}`,
			piboSessionId: sessionId,
			type: "user.message",
			title: "User Message",
			status: "done",
			startedAt: updated.updatedAt,
			output: trimmed,
			children: [],
		};
		let traceView = { ...existing, nodes: [...existing.nodes, node], eventCount: (existing.eventCount ?? existing.nodes.length) + 1 };
		const reply = typeof this.assistantReply === "function" ? this.assistantReply(trimmed, updated) : this.assistantReply;
		const finalSession = reply
			? { ...updated, status: "idle" as const, updatedAt: this.now() }
			: updated;
		if (reply) {
			const assistantNode: PiboTraceNode = {
				id: `node_fake_assistant_${traceView.nodes.length + 1}`,
				piboSessionId: sessionId,
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				startedAt: finalSession.updatedAt ?? updated.updatedAt,
				output: reply,
				children: [],
			};
			traceView = { ...traceView, nodes: [...traceView.nodes, assistantNode], eventCount: (traceView.eventCount ?? traceView.nodes.length) + 1 };
			this.sessions.set(sessionId, finalSession);
		}
		this.traceViews.set(sessionId, traceView);
		this.emit(sessionId, { type: "session", session: cloneJson(finalSession), status: this.buildStatus(sessionId), traceView: cloneTraceView(traceView) });
		this.emit(sessionId, { type: "trace", session: cloneJson(finalSession), traceView: cloneTraceView(traceView) });
	}

	async listAgents(): Promise<readonly CliAgentSummary[]> {
		this.assertOpen();
		return this.agents.map(cloneJson);
	}

	async listSlashCommands(): Promise<readonly SlashCommandDescriptor[]> {
		this.assertOpen();
		return this.slashCommands.map(cloneJson);
	}

	async executeSlashCommand(input: ExecuteCliSlashCommandInput): Promise<ExecuteCliSlashCommandResult> {
		this.assertOpen();
		const command = normalizeCommandName(input.command);
		const descriptor = this.findSlashCommand(command);
		const actionName = descriptor.actionName ?? descriptor.id;
		if (descriptor.support === "browser-only" || descriptor.support === "product-area" || descriptor.support === "deferred") {
			const result = { supported: false, unsupportedReason: descriptor.unsupportedReason ?? `${descriptor.slash} is not supported in the terminal.` };
			return { command, actionName, descriptor: normalizeCommandResultDescriptor(command, result), rawResult: result };
		}
		try {
			const handledResult = this.actionHandler ? await this.actionHandler({ ...input, command }, this) : undefined;
			const rawResult = handledResult === undefined ? await this.defaultActionResult(command, actionName, input.sessionId, input.args) : handledResult;
			const resultDescriptor = normalizeCommandResultDescriptor(command, rawResult);
			const openSessionId = sessionIdFromActionResult(rawResult);
			return { command, actionName, descriptor: resultDescriptor, rawResult, openSessionId, roomId: roomIdFromActionResult(rawResult) };
		} catch (error) {
			return { command, actionName, descriptor: normalizeCommandErrorDescriptor(command, error), rawResult: { error: error instanceof Error ? error.message : String(error) } };
		}
	}

	async setSessionAgent(sessionId: string, agentId: string): Promise<CliSessionSummary> {
		this.assertOpen();
		const session = this.resolveSession(sessionId);
		this.assertSessionOwner(session);
		const agent = this.resolveAgent(agentId);
		const updated: CliSessionSummary = {
			...session,
			agentId: agent.id,
			profile: agent.profileName ?? agent.id,
			updatedAt: this.now(),
		};
		this.sessions.set(sessionId, updated);
		this.emit(sessionId, { type: "session", session: cloneJson(updated), status: this.buildStatus(sessionId) });
		return cloneJson(updated);
	}

	async getStatus(input: { sessionId?: string } = {}): Promise<CliRuntimeStatus> {
		this.assertOpen();
		return this.buildStatus(input.sessionId);
	}

	setTraceView(sessionId: string, traceView: PiboSessionTraceView | null): void {
		this.assertOpen();
		this.resolveSession(sessionId);
		this.traceViews.set(sessionId, cloneTraceView(traceView));
		this.emit(sessionId, { type: "trace", session: cloneJson(this.resolveSession(sessionId)), traceView: cloneTraceView(traceView) });
	}

	setStatus(status: Partial<CliRuntimeStatus>): void {
		this.assertOpen();
		this.statusOverrides = { ...this.statusOverrides, ...status };
		for (const sessionId of this.listeners.keys()) {
			this.emit(sessionId, { type: "status", status: this.buildStatus(sessionId) });
		}
	}

	listenerCount(sessionId?: string): number {
		if (sessionId) return this.listeners.get(sessionId)?.size ?? 0;
		let count = 0;
		for (const listeners of this.listeners.values()) count += listeners.size;
		return count;
	}

	private defaultActionResult(command: string, actionName: string, sessionId: string | undefined, args: string | undefined): unknown {
		const session = sessionId ? this.resolveSession(sessionId) : undefined;
		if (session) this.assertSessionOwner(session);
		if (command === "status") return this.buildStatus(sessionId);
		if (command === "session-current") return session ? { piboSessionId: session.id, title: session.title, profile: session.profile, roomId: session.roomId, ownerScope: session.ownerScope } : { supported: false, unsupportedReason: "No session is open." };
		if (command === "sessions") return this.listSessions({ roomId: session?.roomId, ownerScope: session?.ownerScope ?? this.activeOwnerScope });
		if (command === "clone") {
			if (!session) return { supported: false, unsupportedReason: "No session is open." };
			const clone: CliSessionSummary = { ...session, id: `ps_fake_clone_${this.nextSessionNumber++}`, title: `${session.title} Clone`, status: "idle", updatedAt: this.now() };
			this.sessions.set(clone.id, clone);
			this.traceViews.set(clone.id, cloneTraceView(this.traceViews.get(session.id) ?? emptyTraceView(session)));
			return { piboSessionId: clone.id, sessionId: clone.id, roomId: clone.roomId, title: clone.title, clonedFrom: session.id };
		}
		if (command === "clear") return { cleared: 0 };
		if (command === "fast") return { mode: args === "off" ? "normal" : "fast", supported: true, changed: true };
		if (command === "compact") return { queued: true, instructions: args?.trim() || undefined };
		if (command === "abort") return { aborted: true };
		if (command === "kill") return { killed: session ? [session.id] : [], cancelledRuns: [] };
		if (command === "kill-all") return { killed: [...this.sessions.values()].filter((candidate) => candidate.ownerScope === undefined || candidate.ownerScope === this.activeOwnerScope).map((candidate) => candidate.id), cancelledRuns: [] };
		return { supported: false, unsupportedReason: `No fake action fixture is registered for ${actionName}.` };
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const handle of [...this.openHandles]) handle.close();
		this.listeners.clear();
	}

	private buildStatus(sessionId?: string): CliRuntimeStatus {
		const session = sessionId ? this.sessions.get(sessionId) : undefined;
		return {
			source: "fake",
			mode: "fake",
			connected: !this.closed,
			rooms: "supported",
			sessions: "supported",
			agents: "supported",
			activeOwnerScope: session?.ownerScope ?? this.activeOwnerScope,
			activeOwnerLabel: this.activeOwner().label,
			activeRoomId: session?.roomId,
			activeSessionId: session?.id,
			activeAgentId: session?.agentId,
			activeModel: session?.model,
			message: "Fake CLI session source fixture",
			updatedAt: this.now(),
			...this.statusOverrides,
		};
	}

	private findSlashCommand(command: string): SlashCommandDescriptor {
		const slash = `/${command}`;
		const descriptor = this.slashCommands.find((candidate) => candidate.slash === slash || candidate.aliases?.includes(slash as `/${string}`));
		if (!descriptor) throw new CliSourceError("unsupported", `No slash command fixture found for /${command}`);
		return descriptor;
	}

	private activeOwner(): CliOwnerSummary {
		return this.owners.find((owner) => owner.ownerScope === this.activeOwnerScope) ?? this.owners[0] ?? { ownerScope: "user:fake", label: "Fake user", description: "Fake CLI session source owner", kind: "web-user" };
	}

	private emit(sessionId: string, update: CliSessionUpdate): void {
		const listeners = [...(this.listeners.get(sessionId) ?? [])];
		for (const listener of listeners) listener(update);
	}

	private resolveSession(sessionId: string): CliSessionSummary {
		const session = this.sessions.get(sessionId);
		if (!session) throw new CliSourceError("session_not_found", `No CLI session fixture found for "${sessionId}"`);
		return session;
	}

	private resolveAgent(agentId: string): CliAgentSummary {
		const agent = this.agents.find((candidate) => candidate.id === agentId || candidate.profileName === agentId);
		if (!agent) throw new CliSourceError("agent_not_found", `No CLI agent fixture found for "${agentId}"`);
		return agent;
	}

	private assertSessionOwner(session: CliSessionSummary): void {
		if (session.ownerScope === undefined || session.ownerScope === this.activeOwnerScope) return;
		throw new CliSourceError("session_owner_mismatch", `Session "${session.id}" belongs to ${session.ownerScope}; active owner is ${this.activeOwnerScope}`);
	}

	private assertOpen(): void {
		if (this.closed) throw new CliSourceError("source_closed", "CLI session source is closed");
	}
}

export function createDefaultFakeCliSessionSource(options: Pick<FakeCliSessionSourceOptions, "assistantReply"> = {}): FakeCliSessionSource {
	return new FakeCliSessionSource({ now: deterministicNow, assistantReply: options.assistantReply });
}

function defaultOwners(): CliOwnerSummary[] {
	return [{ ownerScope: "user:fake", label: "Fake user", description: "Fake CLI session source owner", kind: "web-user" }];
}

function defaultRooms(): CliRoomSummary[] {
	return [{ id: "room_fake_main", title: "Fake Room", description: "Deterministic CLI session source room" }];
}

function defaultAgents(): CliAgentSummary[] {
	return [
		{ id: "pibo-agent", name: "Pibo Agent", description: "Default Pibo coding agent", profileName: "pibo-agent" },
		{ id: "codex-compat-openai-web", name: "Codex Compat", description: "Compatibility profile", profileName: "codex-compat-openai-web" },
	];
}

function defaultSessions(): CliSessionSummary[] {
	return [
		{
			id: "ps_fake_existing",
			title: "Existing fake session",
			roomId: "room_fake_main",
			profile: "pibo-agent",
			agentId: "pibo-agent",
			ownerScope: "user:fake",
			workspace: "/workspace",
			status: "idle",
			createdAt: deterministicNow(),
			updatedAt: deterministicNow(),
		},
	];
}

function defaultTraceViews(): Record<string, PiboSessionTraceView> {
	return {
		ps_fake_existing: {
			piboSessionId: "ps_fake_existing",
			piSessionId: "pi_fake_existing",
			title: "Existing fake session",
			version: "fake-v1",
			eventCount: 2,
			nodes: [
				{
					id: "node_fake_user_1",
					piboSessionId: "ps_fake_existing",
					type: "user.message",
					title: "User Message",
					status: "done",
					startedAt: "2026-05-16T12:00:00.000Z",
					output: "Hello from fake source",
					children: [],
				},
				{
					id: "node_fake_assistant_1",
					piboSessionId: "ps_fake_existing",
					type: "assistant.message",
					title: "Agent Message",
					status: "done",
					startedAt: "2026-05-16T12:00:01.000Z",
					output: "Fake assistant response",
					children: [],
				},
			],
			rawEvents: [],
		},
	};
}

function emptyTraceView(session: CliSessionSummary): PiboSessionTraceView {
	return {
		piboSessionId: session.id,
		piSessionId: `pi_${session.id}`,
		title: session.title,
		version: "fake-v1",
		eventCount: 0,
		nodes: [],
		rawEvents: [],
	};
}

function deterministicNow(): string {
	return "2026-05-16T12:00:00.000Z";
}

function normalizeCommandName(command: string): string {
	return command.trim().replace(/^\/+/, "").toLowerCase();
}

function sessionIdFromActionResult(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	return typeof record.piboSessionId === "string" ? record.piboSessionId : typeof record.sessionId === "string" ? record.sessionId : undefined;
}

function roomIdFromActionResult(value: unknown): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	return typeof record.roomId === "string" ? record.roomId : undefined;
}

function cloneTraceView<T extends PiboSessionTraceView | null | undefined>(value: T): T {
	return cloneJson(value) as T;
}

function cloneJson<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
