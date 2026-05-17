import { randomUUID } from "node:crypto";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { createDefaultPiboDataSessionStore } from "../sessions/pibo-data-store.js";
import type { PiboSession, PiboSessionStore } from "../sessions/store.js";
import type { PiboEventListener, PiboExecutionEvent, PiboInputEvent, PiboJsonValue, PiboOutputEvent, PiboSessionStatus } from "../core/events.js";
import { getDefaultPiboWorkspace } from "../core/workspace.js";
import { buildTraceView } from "../apps/chat/trace.js";
import { storedPiboEventFromV2Row, type EventLogRow } from "../apps/chat/data/chat-data-mappers.js";
import { ChatDataIngestService } from "../data/ingest-service.js";
import { ChatRoomService } from "../apps/chat/data/room-service.js";
import type { StoredPiboEventLogRow } from "../data/event-log.js";
import type { PiboDataStore } from "../data/pibo-store.js";
import { buildSlashCommandCatalog, normalizeCommandErrorDescriptor, normalizeCommandResultDescriptor, type SlashCommandDescriptor } from "../session-ui/index.js";
import type { PiboSessionTraceView, PiboTraceNode, PiboTraceNodeStatus } from "../shared/trace-types.js";
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
	type RepairLegacyUserUnknownSessionsInput,
	type RepairLegacyUserUnknownSessionsResult,
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
	dataStore?: PiboDataStore;
	ownsDataStore?: boolean;
	agentSummaries?: readonly CliAgentSummary[];
	ownerSummaries?: readonly CliOwnerSummary[];
};

export const CLI_ROOT_RECOVERY_OWNER_SCOPE = "local:root";
export const CLI_ROOT_RECOVERY_OWNER_LABEL = "Root recovery";

export class LocalCliSessionSource implements CliSessionSource {
	private ownerScope: string;
	private activeOwner: CliOwnerSummary;
	private readonly discoveredOwners: readonly CliOwnerSummary[];
	private readonly sessionStore: PiboSessionStore;
	private readonly ownsSessionStore: boolean;
	private readonly roomProvider?: CliRoomProvider;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly router?: LocalCliSessionRouter;
	private readonly ownsRouter: boolean;
	private readonly unsubscribeRouter?: () => void;
	private readonly now: () => string;
	private readonly statusMessage?: string;
	private readonly dataStore?: PiboDataStore;
	private readonly ownsDataStore: boolean;
	private readonly ingestService?: ChatDataIngestService;
	private readonly roomService?: ChatRoomService;
	private readonly agentSummaries?: readonly CliAgentSummary[];
	private readonly traceViews = new Map<string, PiboSessionTraceView>();
	private readonly listeners = new Map<string, Set<CliSessionUpdateListener>>();
	private readonly openHandles = new Set<{ sessionId: string; close: () => void }>();
	private closed = false;

	constructor(options: LocalCliSessionSourceOptions = {}) {
		this.sessionStore = options.sessionStore ?? createDefaultPiboDataSessionStore();
		this.ownsSessionStore = options.ownsSessionStore ?? options.sessionStore === undefined;
		this.roomProvider = options.roomProvider;
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
		this.router = options.router;
		this.ownsRouter = options.ownsRouter ?? false;
		this.unsubscribeRouter = this.router?.subscribe((event) => this.handleRouterEvent(event));
		this.now = options.now ?? (() => new Date().toISOString());
		this.statusMessage = options.statusMessage;
		this.dataStore = options.dataStore;
		this.ownsDataStore = options.ownsDataStore === true;
		this.ingestService = options.dataStore ? new ChatDataIngestService(options.dataStore) : undefined;
		this.roomService = options.dataStore ? new ChatRoomService(options.dataStore) : undefined;
		this.agentSummaries = options.agentSummaries ? [...options.agentSummaries] : undefined;
		const ownerContext = resolveCliOwnerContext({
			explicitOwnerScope: options.ownerScope,
			sessionStore: this.sessionStore,
			dataStore: this.dataStore,
			ownerSummaries: options.ownerSummaries,
		});
		this.activeOwner = ownerContext.activeOwner;
		this.ownerScope = ownerContext.activeOwner.ownerScope;
		this.discoveredOwners = ownerContext.owners;
	}

	async getActiveOwner(): Promise<CliOwnerSummary> {
		this.assertOpen();
		return cloneJson(this.activeOwner);
	}

	async setActiveOwner(ownerScope: string): Promise<CliOwnerSummary> {
		this.assertOpen();
		const normalized = normalizeOwnerScope(ownerScope);
		const owner = this.discoveredOwners.find((candidate) => candidate.ownerScope === normalized) ?? ownerSummaryForScope(normalized, { explicit: true });
		this.activeOwner = cloneJson(owner);
		this.ownerScope = this.activeOwner.ownerScope;
		this.ensureDefaultRoomForOwner(this.ownerScope);
		return cloneJson(this.activeOwner);
	}

	async listOwners(): Promise<readonly CliOwnerSummary[]> {
		this.assertOpen();
		return this.discoveredOwners.map(cloneJson);
	}

	async listRooms(input: { ownerScope?: string } = {}): Promise<readonly CliRoomSummary[]> {
		this.assertOpen();
		const ownerScope = normalizeOwnerScope(input.ownerScope ?? this.ownerScope);
		if (this.roomProvider) {
			return ensureDefaultRoomSummary(ownerScope, (await this.roomProvider.listRooms({ ownerScope })).map(cloneJson));
		}
		if (this.roomService) {
			const defaultRoom = this.roomService.ensureDefaultRoom({ ownerScope, principalId: ownerScope, name: "Personal Chat" });
			const rooms = mergeRoomSummaries([
				...this.roomService.listRooms(ownerScope).map((room) => ({
					id: room.id,
					title: room.name,
					description: room.topic,
					ownerScope: room.ownerScope,
					isDefault: room.id === defaultRoom.id || room.metadata.default === true,
				})),
				...deriveRoomsFromSessions(this.readSessions(ownerScope)),
			]);
			return ensureDefaultRoomSummary(ownerScope, rooms).map(cloneJson);
		}
		return ensureDefaultRoomSummary(ownerScope, deriveRoomsFromSessions(this.readSessions(ownerScope))).map(cloneJson);
	}

	async listSessions(input: { roomId?: string; ownerScope?: string } = {}): Promise<readonly CliSessionSummary[]> {
		this.assertOpen();
		const ownerScope = normalizeOwnerScope(input.ownerScope ?? this.ownerScope);
		const defaultRoomId = this.ensureDefaultRoomForOwner(ownerScope).id;
		return this.readSessions(ownerScope)
			.filter((session) => input.roomId === undefined || roomIdFromSession(session, defaultRoomId) === input.roomId)
			.map((session) => sessionToSummary(session, defaultRoomId));
	}

	async createSession(input: CreateCliSessionInput = {}): Promise<CliSessionSummary> {
		this.assertOpen();
		const agent = input.agentId ? this.resolveAgent(input.agentId) : undefined;
		const profile = this.resolveProfile(input.profile ?? agent?.profileName ?? agent?.id ?? this.defaultProfileName());
		const ownerScope = normalizeOwnerScope(input.ownerScope ?? this.ownerScope);
		const room = input.roomId ? await this.findRoomSummary(ownerScope, input.roomId) : this.ensureDefaultRoomForOwner(ownerScope);
		const roomId = input.roomId ?? room?.id;
		const metadata = buildSessionMetadata(roomId, "idle", room?.title);
		const session = this.sessionStore.create({
			channel: "cli-session-ui",
			kind: "chat",
			profile,
			ownerScope,
			workspace: input.workspace ?? getDefaultPiboWorkspace(),
			title: input.title?.trim() || "New CLI session",
			metadata,
		});
		if (roomId) this.upsertSessionNavigation(session, roomId, undefined, "idle");
		this.traceViews.set(session.id, emptyTraceView(session));
		const summary = sessionToSummary(session, this.ensureDefaultRoomForOwner(ownerScope).id);
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
		const traceView = await this.loadTraceView(session);
		this.traceViews.set(sessionId, traceView);
		return {
			session: sessionToSummary(session, this.ensureDefaultRoomForOwner(normalizeOwnerScope(session.ownerScope)).id),
			traceView: cloneJson(traceView),
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
		const session = this.resolveSession(sessionId);
		const eventId = randomUUID();
		this.ingestUserMessage(session, eventId, trimmed);
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
		if (this.agentSummaries) return this.agentSummaries.map(cloneJson);
		return this.pluginRegistry.getProfileInfos().map((profile) => ({
			id: profile.name,
			name: profile.name,
			description: profile.description,
			profileName: profile.name,
		}));
	}

	async listSlashCommands(): Promise<readonly SlashCommandDescriptor[]> {
		this.assertOpen();
		return this.buildSlashCommands().map(cloneJson);
	}

	async executeSlashCommand(input: ExecuteCliSlashCommandInput): Promise<ExecuteCliSlashCommandResult> {
		this.assertOpen();
		const command = normalizeCommandName(input.command);
		const descriptor = this.findSlashCommand(command);
		const actionName = descriptor.actionName ?? descriptor.id;
		const session = input.sessionId ? this.resolveSession(input.sessionId) : undefined;
		if (descriptor.support === "browser-only" || descriptor.support === "product-area" || descriptor.support === "deferred") {
			const rawResult = { supported: false, unsupportedReason: descriptor.unsupportedReason ?? `${descriptor.slash} is not supported in the terminal.` };
			return { command, actionName, descriptor: normalizeCommandResultDescriptor(command, rawResult), rawResult };
		}
		try {
			const rawResult = await this.executeLocalSlashAction({ command, actionName, session, args: input.args });
			const openSessionId = sessionIdFromActionResult(rawResult);
			const roomId = roomIdFromActionResult(rawResult) ?? (openSessionId ? roomIdFromSession(this.sessionStore.get(openSessionId) ?? session ?? ({} as PiboSession)) : undefined);
			if (openSessionId) this.upsertDerivedSessionNavigation(openSessionId, roomId);
			return { command, actionName, descriptor: normalizeCommandResultDescriptor(command, rawResult), rawResult, openSessionId, roomId };
		} catch (error) {
			return { command, actionName, descriptor: normalizeCommandErrorDescriptor(command, error), rawResult: { error: error instanceof Error ? error.message : String(error) } };
		}
	}

	async setSessionAgent(sessionId: string, agentId: string): Promise<CliSessionSummary> {
		this.assertOpen();
		const session = this.resolveSession(sessionId);
		const agent = this.resolveAgent(agentId);
		if (agent.profileName === session.profile || agent.id === session.profile) return sessionToSummary(session, this.ensureDefaultRoomForOwner(normalizeOwnerScope(session.ownerScope)).id);
		throw new CliSourceError("unsupported", "Changing an existing local session profile is not supported by the CLI source. Use /new after selecting the desired profile, or start a new session with that profile.");
	}

	async repairLegacyUserUnknownSessions(input: RepairLegacyUserUnknownSessionsInput = {}): Promise<RepairLegacyUserUnknownSessionsResult> {
		this.assertOpen();
		const ownerScope = normalizeOwnerScope(input.ownerScope ?? this.ownerScope);
		if (ownerScope === "user:unknown") throw new CliSourceError("invalid_owner", "Refusing to repair legacy sessions to user:unknown. Select a real owner first.");
		const room = input.roomId ? await this.findRoomSummary(ownerScope, input.roomId) : this.ensureDefaultRoomForOwner(ownerScope);
		const roomId = input.roomId ?? room?.id;
		const requestedIds = input.sessionIds ? new Set(input.sessionIds) : undefined;
		const candidates = (this.sessionStore.list ? this.sessionStore.list() : this.sessionStore.find({ ownerScope: "user:unknown" }))
			.filter((session) => session.ownerScope === "user:unknown")
			.filter((session) => requestedIds === undefined || requestedIds.has(session.id));
		let repaired = 0;
		const repairedIds: string[] = [];
		for (const session of candidates) {
			if (!isLegacyCliUnknownSession(session)) continue;
			const status = statusFromSession(session) === "unknown" ? "idle" : statusFromSession(session);
			const metadata = { ...(session.metadata ?? {}), ...buildSessionMetadata(roomId, status, room?.title), repairedFromOwnerScope: "user:unknown", repairedAt: this.now() };
			const updated = this.sessionStore.update(session.id, { ownerScope, metadata }) ?? { ...session, ownerScope, metadata, updatedAt: this.now() };
			if (this.dataStore && roomId) this.dataStore.sessions.upsertSession({ session: updated, roomId, status, lastActivityAt: updated.updatedAt });
			if (roomId) this.upsertSessionNavigation(updated, roomId, undefined, status);
			repaired += 1;
			repairedIds.push(session.id);
		}
		return { ownerScope, roomId, scanned: candidates.length, repaired, skipped: candidates.length - repaired, sessionIds: repairedIds };
	}

	async getStatus(input: { sessionId?: string } = {}): Promise<CliRuntimeStatus> {
		this.assertOpen();
		if (input.sessionId) {
			const session = this.resolveSession(input.sessionId);
			return this.buildStatus(session);
		}
		const sessions = this.readSessions(this.ownerScope);
		const rooms = this.roomProvider ? "supported" : "supported";
		return {
			source: "local/direct",
			mode: "local",
			connected: true,
			rooms,
			activeOwnerScope: this.activeOwner.ownerScope,
			activeOwnerLabel: this.activeOwner.label,
			activeRoomId: this.ensureDefaultRoomForOwner(this.ownerScope).id,
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
		if (this.ownsDataStore) this.dataStore?.close();
	}

	listenerCount(sessionId?: string): number {
		if (sessionId) return this.listeners.get(sessionId)?.size ?? 0;
		let count = 0;
		for (const listeners of this.listeners.values()) count += listeners.size;
		return count;
	}

	private buildSlashCommands(): SlashCommandDescriptor[] {
		return buildSlashCommandCatalog(this.pluginRegistry.getGatewayActionInfos().map((action) => ({
			name: action.name,
			description: action.description,
			slashCommands: action.slashCommands,
		})));
	}

	private findSlashCommand(command: string): SlashCommandDescriptor {
		const slash = `/${command}`;
		const descriptor = this.buildSlashCommands().find((candidate) => candidate.slash === slash || candidate.aliases?.includes(slash as `/${string}`));
		if (!descriptor) throw new CliSourceError("unsupported", `No slash command found for /${command}`);
		return descriptor;
	}

	private async executeLocalSlashAction(input: { command: string; actionName: string; session?: PiboSession; args?: string }): Promise<unknown> {
		if (input.command === "status") {
			if (input.session && this.router) {
				const event: PiboExecutionEvent = {
					type: "execution",
					piboSessionId: input.session.id,
					action: input.actionName,
					id: randomUUID(),
				};
				const output = await this.router.emit(event);
				if (output.type === "execution_result") return output.result;
			}
			const status = input.session ? this.buildStatus(input.session) : await this.getStatus();
			return { ...status, activeModel: input.session?.activeModel };
		}
		if (input.command === "session-current") {
			if (!input.session) return { supported: false, unsupportedReason: "No session is open." };
			return sessionMetadataResult(input.session, this.ensureDefaultRoomForOwner(normalizeOwnerScope(input.session.ownerScope)).id);
		}
		if (input.command === "sessions") {
			const roomId = input.session ? roomIdFromSession(input.session, this.ensureDefaultRoomForOwner(normalizeOwnerScope(input.session.ownerScope)).id) : undefined;
			return (await this.listSessions({ ownerScope: input.session?.ownerScope ?? this.ownerScope, roomId })).map((session) => ({
				id: session.id,
				title: session.title,
				roomId: session.roomId,
				profile: session.profile,
				status: session.status,
				updatedAt: session.updatedAt,
			}));
		}
		if (input.command === "download") return terminalDownloadResult(input.args);
		if (input.command === "upload") return terminalUploadResult(input.args);
		if (!input.session) return { supported: false, unsupportedReason: `/${input.command} requires an open session.` };
		if (input.command === "login" && loginAuthMethodFromArgs(input.args) === "api_key") return terminalApiKeyLoginInstructions(input.args);
		if (!this.router) {
			return { supported: false, unsupportedReason: `/${input.command} requires a routed local runtime. Open a local routed session or use a debug PTY mocked router.` };
		}
		const action = routedActionNameForSlash(input.command, input.actionName, input.args);
		const params = executionParamsForSlash(input.command, input.args);
		const event: PiboExecutionEvent = {
			type: "execution",
			piboSessionId: input.session.id,
			action,
			id: randomUUID(),
			...(params !== undefined ? { params } : {}),
		};
		const output = await this.router.emit(event);
		if (output.type !== "execution_result") throw new CliSourceError("action_failed", `Action /${input.command} did not return an execution result.`);
		return output.result;
	}

	private upsertDerivedSessionNavigation(sessionId: string, resultRoomId: string | undefined): void {
		const session = this.sessionStore.get(sessionId);
		if (!session) return;
		const roomId = resultRoomId ?? roomIdFromSession(session);
		if (!roomId) return;
		this.upsertSessionNavigation(session, roomId, undefined, statusFromSession(session) === "unknown" ? "idle" : statusFromSession(session));
	}

	private readSessions(ownerScope = this.ownerScope): PiboSession[] {
		const sessions = this.sessionStore.list ? this.sessionStore.list() : this.sessionStore.find({});
		return sessions
			.filter((session) => session.ownerScope === ownerScope)
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
		const summary = this.agentSummaries?.find((candidate) => candidate.id === agentId || candidate.profileName === agentId || candidate.name === agentId);
		if (summary) return cloneJson(summary);
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
		this.ingestOutputEvent(session, event);
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
		this.emit(sessionId, { type: "trace", session: sessionToSummary(session, this.ensureDefaultRoomForOwner(normalizeOwnerScope(session.ownerScope)).id), traceView: cloneJson(traceView) });
	}

	private appendRawEvent(sessionId: string, event: PiboOutputEvent): void {
		const session = this.resolveSession(sessionId);
		const traceView = cloneJson(this.traceViews.get(sessionId) ?? emptyTraceView(session));
		traceView.rawEvents.push(storedEvent(event, this.now(), traceView.rawEvents.length + 1));
		traceView.eventCount = traceView.rawEvents.length;
		traceView.version = `local-${traceView.rawEvents.length}-${session.updatedAt}`;
		this.traceViews.set(sessionId, traceView);
		this.emit(sessionId, { type: "trace", session: sessionToSummary(session, this.ensureDefaultRoomForOwner(normalizeOwnerScope(session.ownerScope)).id), traceView: cloneJson(traceView) });
	}

	private updateSessionStatus(sessionId: string, status: CliSessionSummary["status"]): void {
		const session = this.resolveSession(sessionId);
		const updated = this.sessionStore.update(sessionId, { metadata: { ...(session.metadata ?? {}), status } }) ?? session;
		const summary = sessionToSummary(updated, this.ensureDefaultRoomForOwner(normalizeOwnerScope(updated.ownerScope)).id);
		this.emit(sessionId, { type: "session", session: summary, status: this.buildStatus(updated) });
	}

	private async loadTraceView(session: PiboSession): Promise<PiboSessionTraceView> {
		if (!this.dataStore) return cloneJson(this.traceViews.get(session.id) ?? emptyTraceView(session));
		const rows = this.dataStore.eventLog.listEvents({ sessionId: session.id, limit: 500 });
		const events = rows
			.map((row) => storedPiboEventFromV2Row(eventLogRowToV2MapperRow(row)))
			.filter((event) => event !== undefined)
			.map(normalizeStoredEventForCliTrace);
		return await buildTraceView({
			session,
			sessions: this.readSessions(),
			events,
			status: statusFromSession(session) === "running" ? "running" : statusFromSession(session) === "error" ? "error" : "idle",
			cwd: session.workspace ?? getDefaultPiboWorkspace(),
		});
	}

	private ingestUserMessage(session: PiboSession, eventId: string, text: string): void {
		const roomId = roomIdFromSession(session);
		if (!this.ingestService || !roomId) return;
		try {
			this.ingestService.ingestUserMessageAccepted({
				session,
				roomId,
				actorId: this.ownerScope ?? session.ownerScope ?? "cli",
				text,
				clientTxnId: eventId,
				legacyEvent: { eventId, createdAt: this.now() },
			});
		} catch {
			// Persistence is best-effort; live local rendering still proceeds through router events.
		}
	}

	private ingestOutputEvent(session: PiboSession, event: PiboOutputEvent): void {
		if (!this.ingestService) return;
		try {
			this.ingestService.ingestOutputEvent({
				session,
				roomId: roomIdFromSession(session),
				actorId: session.profile,
				event,
				createdAt: this.now(),
			});
		} catch {
			// Persistence is best-effort; live local rendering still proceeds through in-memory trace updates.
		}
	}

	private buildStatus(session: PiboSession): CliRuntimeStatus {
		const runtime = this.router?.getSessionRuntimeStatus?.(session.id);
		return {
			source: "local/direct",
			mode: "local",
			connected: true,
			rooms: "supported",
			activeOwnerScope: this.activeOwner.ownerScope,
			activeOwnerLabel: this.activeOwner.label,
			sessions: "supported",
			agents: "supported",
			activeRoomId: roomIdFromSession(session) ?? this.ensureDefaultRoomForOwner(this.ownerScope).id,
			activeSessionId: session.id,
			activeAgentId: session.profile,
			activeModel: session.activeModel,
			queuedMessages: runtime?.queuedMessages,
			processing: runtime?.processing,
			streaming: runtime?.streaming,
			cwd: runtime?.cwd,
			thinkingLevel: runtime?.thinkingLevel,
			fastMode: runtime?.fastMode,
			contextUsage: runtime?.contextUsage,
			providerUsage: runtime?.providerUsage,
			warnings: runtime?.warnings,
			errors: runtime?.errors,
			message: redactCliSecretText(runtime ? `Runtime ready; queued=${runtime.queuedMessages} processing=${runtime.processing} streaming=${runtime.streaming}` : this.statusMessage ?? "Local CLI source ready."),
			updatedAt: this.now(),
		};
	}

	private async findRoomSummary(ownerScope: string, roomId: string): Promise<CliRoomSummary | undefined> {
		return (await this.listRooms({ ownerScope })).find((room) => room.id === roomId);
	}

	private ensureDefaultRoomForOwner(ownerScope: string): CliRoomSummary {
		if (this.roomService) {
			const room = this.roomService.ensureDefaultRoom({ ownerScope, principalId: ownerScope, name: "Personal Chat" });
			return { id: room.id, title: room.name, description: room.topic, ownerScope: room.ownerScope, isDefault: true };
		}
		return defaultCliRoomSummary(ownerScope);
	}

	private upsertSessionNavigation(session: PiboSession, roomId: string, lastMessagePreview: string | undefined, status: string): void {
		if (!this.dataStore) return;
		const now = this.now();
		this.dataStore.navigation.upsertSession({
			ownerScope: normalizeOwnerScope(session.ownerScope),
			roomId,
			sessionId: session.id,
			rootSessionId: rootSessionIdFromSession(session),
			parentId: session.parentId,
			originId: session.originId,
			title: session.title || lastMessagePreview || "Untitled Session",
			profile: session.profile,
			status,
			lastActivityAt: now,
			lastMessagePreview,
			sortKey: now,
			updatedAt: now,
		});
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

function sessionToSummary(session: PiboSession, defaultRoomId?: string): CliSessionSummary {
	return {
		id: session.id,
		title: session.title?.trim() || session.id,
		roomId: roomIdFromSession(session, defaultRoomId),
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
			ownerScope: session.ownerScope,
		});
	}
	return [...rooms.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function roomIdFromSession(session: PiboSession, defaultRoomId?: string): string | undefined {
	return stringMetadata(session, "chatRoomId") ?? stringMetadata(session, "roomId") ?? defaultRoomId;
}

function statusFromSession(session: PiboSession): CliSessionSummary["status"] {
	const status = session.metadata?.status;
	return status === "idle" || status === "running" || status === "error" ? status : "unknown";
}

function stringMetadata(session: PiboSession, key: string): string | undefined {
	const value = session.metadata?.[key];
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function buildSessionMetadata(roomId: string | undefined, status: CliSessionSummary["status"], roomName?: string): PiboSession["metadata"] {
	if (!roomId) return { status, source: "pibo tui:sessions" };
	return roomName
		? { chatRoomId: roomId, roomId, chatRoomName: roomName, status, source: "pibo tui:sessions" }
		: { chatRoomId: roomId, roomId, status, source: "pibo tui:sessions" };
}

function rootSessionIdFromSession(session: PiboSession): string {
	return session.parentId ? (typeof session.metadata?.rootSessionId === "string" ? session.metadata.rootSessionId : session.parentId) : session.id;
}

function isLegacyCliUnknownSession(session: PiboSession): boolean {
	return session.ownerScope === "user:unknown" && (session.channel === "cli-session-ui" || session.metadata?.source === "pibo tui:sessions");
}

function eventLogRowToV2MapperRow(row: StoredPiboEventLogRow): EventLogRow {
	return {
		stream_id: row.streamId,
		session_id: row.sessionId ?? null,
		session_sequence: row.sessionSequence ?? null,
		room_id: row.roomId ?? null,
		type: row.type,
		actor_type: row.actorType ?? null,
		actor_id: row.actorId ?? null,
		event_id: row.eventId ?? null,
		idempotency_key: row.idempotencyKey ?? null,
		retention_class: row.retentionClass,
		preview_text: row.previewText ?? null,
		attributes_json: JSON.stringify(row.attributes ?? {}),
		created_at: row.createdAt,
	};
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

function normalizeStoredEventForCliTrace<T extends { payload: unknown }>(event: T): T {
	const payload = event.payload as { type?: string; text?: string; clientTxnId?: string };
	if (payload?.type !== "user.message.accepted") return event;
	return {
		...event,
		payload: {
			type: "message_queued",
			piboSessionId: (event.payload as { piboSessionId?: string }).piboSessionId,
			eventId: payload.clientTxnId,
			text: payload.text ?? "",
			source: "ui",
			queuedMessages: 0,
		},
	} as T;
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

function resolveCliOwnerContext(input: { explicitOwnerScope?: string; sessionStore: PiboSessionStore; dataStore?: PiboDataStore; ownerSummaries?: readonly CliOwnerSummary[] }): { activeOwner: CliOwnerSummary; owners: readonly CliOwnerSummary[] } {
	const owners = new Map<string, CliOwnerSummary>();
	const addOwner = (owner: CliOwnerSummary, options: { explicit?: boolean } = {}) => {
		const ownerScope = normalizeOwnerScope(owner.ownerScope);
		if (!options.explicit && ownerScope === "user:unknown") return;
		owners.set(ownerScope, { ...owner, ownerScope });
	};
	if (input.explicitOwnerScope) addOwner(ownerSummaryForScope(input.explicitOwnerScope, { explicit: true }), { explicit: true });
	for (const owner of input.ownerSummaries ?? []) addOwner(owner);
	const sessions = input.sessionStore.list ? input.sessionStore.list() : input.sessionStore.find({});
	for (const session of sessions) if (session.ownerScope) addOwner(ownerSummaryForScope(session.ownerScope));
	for (const ownerScope of discoverOwnerScopesFromDataStore(input.dataStore)) addOwner(ownerSummaryForScope(ownerScope));
	addOwner(rootRecoveryOwnerSummary(), { explicit: true });
	const ownerList = [...owners.values()].sort(compareOwners);
	const explicit = input.explicitOwnerScope ? ownerList.find((owner) => owner.ownerScope === normalizeOwnerScope(input.explicitOwnerScope)) : undefined;
	const activeOwner = explicit ?? ownerList.find((owner) => owner.kind !== "legacy") ?? rootRecoveryOwnerSummary();
	return { activeOwner, owners: ownerList.some((owner) => owner.ownerScope === activeOwner.ownerScope) ? ownerList : [activeOwner, ...ownerList] };
}

function discoverOwnerScopesFromDataStore(dataStore: PiboDataStore | undefined): string[] {
	if (!dataStore) return [];
	const scopes = new Set<string>();
	for (const table of ["rooms", "session_navigation", "sessions"] as const) {
		try {
			const rows = dataStore.db.prepare(`SELECT DISTINCT owner_scope FROM ${table} WHERE owner_scope IS NOT NULL AND owner_scope <> ''`).all() as Array<{ owner_scope?: string }>;
			for (const row of rows) if (row.owner_scope) scopes.add(row.owner_scope);
		} catch {
			// Discovery is best-effort because older/local databases may not have every table.
		}
	}
	try {
		const rows = dataStore.db.prepare("SELECT DISTINCT actor_id FROM event_log WHERE actor_id IS NOT NULL AND actor_id <> ''").all() as Array<{ actor_id?: string }>;
		for (const row of rows) if (row.actor_id && looksLikeOwnerScope(row.actor_id)) scopes.add(row.actor_id);
	} catch {
		// Best-effort discovery only.
	}
	return [...scopes];
}

function rootRecoveryOwnerSummary(): CliOwnerSummary {
	return {
		ownerScope: CLI_ROOT_RECOVERY_OWNER_SCOPE,
		label: CLI_ROOT_RECOVERY_OWNER_LABEL,
		description: "Local host-root recovery owner with no Web email requirement",
		kind: "root-recovery",
		isFallback: true,
	};
}

function ownerSummaryForScope(ownerScope: string, options: { explicit?: boolean } = {}): CliOwnerSummary {
	const normalized = normalizeOwnerScope(ownerScope);
	if (normalized === CLI_ROOT_RECOVERY_OWNER_SCOPE) return rootRecoveryOwnerSummary();
	if (normalized === "user:unknown") {
		return {
			ownerScope: normalized,
			label: "Legacy user:unknown",
			description: options.explicit ? "Explicitly selected legacy owner scope" : "Legacy owner scope",
			kind: "legacy",
		};
	}
	if (normalized.startsWith("user:")) {
		return {
			ownerScope: normalized,
			label: `Web user ${normalized.slice("user:".length)}`,
			description: "Discovered local Web owner scope",
			kind: "web-user",
		};
	}
	return {
		ownerScope: normalized,
		label: normalized,
		description: "Discovered local owner scope",
		kind: "local",
	};
}

function compareOwners(left: CliOwnerSummary, right: CliOwnerSummary): number {
	return ownerRank(left) - ownerRank(right) || left.label.localeCompare(right.label) || left.ownerScope.localeCompare(right.ownerScope);
}

function ownerRank(owner: CliOwnerSummary): number {
	if (owner.kind === "web-user") return 0;
	if (owner.kind === "local") return 1;
	if (owner.kind === "root-recovery") return 2;
	return 3;
}

function looksLikeOwnerScope(value: string): boolean {
	return value.startsWith("user:") || value.startsWith("local:");
}

function normalizeOwnerScope(value: string | undefined): string {
	const trimmed = value?.trim();
	return trimmed || CLI_ROOT_RECOVERY_OWNER_SCOPE;
}

function mergeRoomSummaries(rooms: readonly CliRoomSummary[]): CliRoomSummary[] {
	const byId = new Map<string, CliRoomSummary>();
	for (const room of rooms) {
		const existing = byId.get(room.id);
		byId.set(room.id, existing ? { ...room, description: existing.description ?? room.description, isDefault: existing.isDefault === true || room.isDefault === true } : room);
	}
	return [...byId.values()];
}

function ensureDefaultRoomSummary(ownerScope: string, rooms: readonly CliRoomSummary[]): CliRoomSummary[] {
	const defaultRoom = rooms.find((room) => room.isDefault === true || room.title === "Personal Chat");
	const normalizedRooms = rooms.map((room) => ({ ...room, ownerScope: room.ownerScope ?? ownerScope, isDefault: defaultRoom ? room.id === defaultRoom.id || room.isDefault === true : room.isDefault === true }));
	if (defaultRoom) return normalizedRooms;
	return [defaultCliRoomSummary(ownerScope), ...normalizedRooms];
}

function defaultCliRoomSummary(ownerScope: string): CliRoomSummary {
	return {
		id: cliDefaultRoomIdForOwner(ownerScope),
		title: "Personal Chat",
		description: ownerScope === CLI_ROOT_RECOVERY_OWNER_SCOPE ? "Root recovery Personal Chat" : "Default Personal Chat room",
		ownerScope,
		isDefault: true,
	};
}

export function cliDefaultRoomIdForOwner(ownerScope: string): string {
	return `room_cli_personal_${Buffer.from(ownerScope).toString("base64url")}`;
}

function normalizeCommandName(command: string): string {
	return command.trim().replace(/^\/+/, "").toLowerCase();
}

function routedActionNameForSlash(command: string, actionName: string, args: string | undefined): string {
	if (command === "fork-candidates" && args?.trim()) return "session.fork";
	if (command === "login" && loginAuthMethodFromArgs(args) === "device_code") return "login.start";
	return actionName;
}

function executionParamsForSlash(command: string, args: string | undefined): PiboJsonValue | undefined {
	const trimmed = args?.trim();
	if (command === "compact" && trimmed) return { customInstructions: trimmed };
	if (command === "thinking" && trimmed) return { level: trimmed };
	if (command === "model" && trimmed) {
		const [provider, model] = trimmed.includes("/") ? trimmed.split("/", 2) : [undefined, trimmed];
		return provider ? { provider, model } : { model };
	}
	if (command === "login" && trimmed) {
		const [provider, method] = parseSlashSelectionArgs(trimmed);
		if (method === "device_code") return { provider };
	}
	if (command === "fork-candidates" && trimmed) return { entryId: trimmed };
	if (command === "fast" && trimmed) return { mode: trimmed };
	return undefined;
}

function loginAuthMethodFromArgs(args: string | undefined): string | undefined {
	const trimmed = args?.trim();
	if (!trimmed) return undefined;
	return parseSlashSelectionArgs(trimmed)[1];
}

function parseSlashSelectionArgs(value: string): [string, string | undefined] {
	const [left, right] = value.includes("/") ? value.split("/", 2) : value.split(/\s+/, 2);
	return [left ?? "", right];
}

function terminalApiKeyLoginInstructions(args: string | undefined): Record<string, unknown> {
	const [provider] = parseSlashSelectionArgs(args?.trim() ?? "");
	return {
		message: `${provider || "Provider"} API-key login requires secret input. The Ink CLI will not echo or collect secrets in this flow; set credentials through provider environment variables or Web Settings, then run /login again.`,
		supported: true,
	};
}

function terminalDownloadResult(args: string | undefined): Record<string, unknown> {
	const target = args?.trim();
	if (!target) return { supported: false, unsupportedReason: "Usage: /download <path>. In a terminal, use shell tools such as cat, cp, scp, or rsync for server paths; browser download APIs are Web-only." };
	return { message: `Terminal download for ${target}: this path is already on the server. Use shell tools such as cat, cp, scp, or rsync to copy it; browser download APIs are not used by the CLI.` };
}

function terminalUploadResult(args: string | undefined): Record<string, unknown> {
	const target = args?.trim();
	if (!target) return { supported: false, unsupportedReason: "Usage: /upload <path>. Browser file picker upload is Web-only; from SSH, copy files with scp/rsync or place them under ~/.pibo/uploads." };
	return { message: `Terminal upload for ${target}: copy or move the file to ~/.pibo/uploads, or use Web /upload for browser file selection. The CLI did not copy file contents or echo secrets.` };
}

function sessionMetadataResult(session: PiboSession, defaultRoomId?: string): Record<string, unknown> {
	return {
		piboSessionId: session.id,
		piSessionId: session.piSessionId,
		title: session.title,
		profile: session.profile,
		ownerScope: session.ownerScope,
		roomId: roomIdFromSession(session, defaultRoomId),
		workspace: session.workspace,
		status: statusFromSession(session),
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

function sessionIdFromActionResult(value: unknown): string | undefined {
	const unwrapped = unwrapActionResult(value);
	if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) return undefined;
	const record = unwrapped as Record<string, unknown>;
	return typeof record.piboSessionId === "string" ? record.piboSessionId : typeof record.sessionId === "string" ? record.sessionId : undefined;
}

function roomIdFromActionResult(value: unknown): string | undefined {
	const unwrapped = unwrapActionResult(value);
	if (!unwrapped || typeof unwrapped !== "object" || Array.isArray(unwrapped)) return undefined;
	const record = unwrapped as Record<string, unknown>;
	return typeof record.roomId === "string" ? record.roomId : undefined;
}

function unwrapActionResult(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const record = value as Record<string, unknown>;
	if (record.ok === true && "result" in record) return record.result;
	if (record.success === true && "data" in record) return record.data;
	return value;
}

function cloneJson<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}
