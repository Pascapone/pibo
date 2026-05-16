import { randomUUID } from "node:crypto";
import {
	InitialSessionContext,
	type InitialSessionContextOptions,
	type SubagentProfile,
} from "./profiles.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { createPiboRuntime, type PiboRuntimeOptions } from "./runtime.js";
import { RoutedSession } from "./routed-session.js";
import type {
	PiboAssistantMessageEvent,
	PiboEventListener,
	PiboExecutionEvent,
	PiboJsonObject,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionOperationResult,
	PiboSessionStatus,
} from "./events.js";
import { createSubagentToolName, type PiboSubagentRunner } from "../subagents/tool.js";
import { PiboRunRegistry, type PiboRunNotification, type PiboRunRegistryEvent, type PiboRunSnapshot } from "../runs/registry.js";
import { createPiboSignalRegistry } from "../signals/registry.js";
import type { PiboSignalPatch, PiboSignalRegistry, PiboSignalSnapshot } from "../signals/types.js";
import type { PiboRunToolController } from "../runs/tools.js";
import { createDefaultPiboReliabilityStore, type PiboReliabilityStore } from "../reliability/store.js";
import {
	InMemoryPiboSessionStore,
	type PiboSession,
	type PiboSessionStore,
} from "../sessions/store.js";
import { getDefaultPiboWorkspace } from "./workspace.js";
import { loadPiboModelDefaults, selectRequestedFastMode, type PiboModelDefaults } from "./model-defaults.js";
import { loadPiboUserSettings } from "./user-settings.js";
import { resolvePiboSessionActiveModel } from "./session-model.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "./thinking.js";
import { RuntimeSessionRegistry } from "../tools/runtime/registry.js";
import { withWorkflowSessionKind } from "../sessions/workflow-session-kind.js";
import { PiboRuntimeTelemetryRecorder } from "./runtime-telemetry.js";
import { createPiboProviderTelemetryExtension } from "./provider-telemetry.js";
import type { TelemetryStore } from "../data/telemetry.js";

export type {
	PiboEventListener,
	PiboEventSource,
	PiboExecutionAction,
	PiboExecutionEvent,
	PiboInputEvent,
	PiboMessageEvent,
	PiboOutputEvent,
	PiboSessionStatus,
} from "./events.js";

export type PiboSessionRouterOptions = Omit<
	PiboRuntimeOptions,
	"profile" | "subagentRunner" | "runToolController"
> & {
	profile?: InitialSessionContext;
	pluginRegistry?: PiboPluginRegistry;
	sessionStore?: PiboSessionStore;
	forwardPiEvents?: boolean;
	reliabilityStore?: PiboReliabilityStore;
	signalRegistry?: PiboSignalRegistry;
	/** Product-level model defaults. Used as Chat Web main/subagent defaults before Pi fallback. */
	modelDefaults?: PiboModelDefaults | (() => PiboModelDefaults);
	/** Optional pibo.sqlite telemetry store for best-effort runtime queue/turn lifecycle capture. */
	telemetryStore?: TelemetryStore;
};

const DEFAULT_SUBAGENT_REPLY_TIMEOUT_MS = 10 * 60 * 1000;

export function resolvePiboSessionInitialThinkingLevel(session: Pick<PiboSession, "metadata">): PiboThinkingLevel | undefined {
	const value = session.metadata?.initialThinkingLevel;
	return typeof value === "string" && isPiboThinkingLevel(value) ? value : undefined;
}

export function resolvePiboSessionInitialFastMode(session: Pick<PiboSession, "metadata">): boolean | undefined {
	const value = session.metadata?.initialFastMode;
	return typeof value === "boolean" ? value : undefined;
}

function profileForSession(
	baseProfile: InitialSessionContext,
	piSessionId: string,
	parentPiSessionId?: string,
): InitialSessionContext {
	const options: InitialSessionContextOptions = {
		profileName: baseProfile.profileName,
		sessionId: piSessionId,
		parentSessionId: parentPiSessionId,
		model: baseProfile.model,
		mainModel: baseProfile.mainModel,
		subagentModel: baseProfile.subagentModel,
		thinkingLevel: baseProfile.thinkingLevel,
		mainThinkingLevel: baseProfile.mainThinkingLevel,
		subagentThinkingLevel: baseProfile.subagentThinkingLevel,
		fast: baseProfile.fast,
		mainFast: baseProfile.mainFast,
		subagentFast: baseProfile.subagentFast,
		skills: baseProfile.skills,
		tools: baseProfile.tools,
		subagents: baseProfile.subagents,
		contextFiles: baseProfile.contextFiles,
		piPackages: baseProfile.piPackages,
		builtinTools: baseProfile.builtinTools,
		builtinToolNames: baseProfile.builtinToolNames,
		autoContextFiles: baseProfile.autoContextFiles,
		toolPackages: baseProfile.toolPackages,
	};

	return new InitialSessionContext(options);
}

function formatRunReminderMessage(notification: PiboRunNotification): string {
	return [
		"<pibo_run_notification>",
		JSON.stringify({
			completed: notification.completed.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
			})),
			failed: notification.failed.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
			})),
			cancelled: notification.cancelled.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
			})),
			running: notification.running.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
			})),
			instruction:
				"Use pibo_run_read for completed or failed runs. Use pibo_run_wait, pibo_run_status, pibo_run_cancel, or pibo_run_ack for runs you still need to manage.",
		}),
		"</pibo_run_notification>",
	].join("\n");
}

function isRunReminderServiceMessage(event: PiboMessageEvent): boolean {
	return event.source === "service" && event.text.startsWith("<pibo_run_notification>");
}

function isTerminalRunStatus(status: string): boolean {
	return status === "completed" || status === "failed" || status === "cancelled";
}

function asJsonObject(value: PiboJsonObject | undefined): PiboJsonObject {
	return value ?? {};
}

function shouldResetSessionAfterAction(action: string): boolean {
	return action === "login.complete" || action === "login.apikey" || action === "logout";
}

function userIdFromOwnerScope(ownerScope: string | undefined): string | undefined {
	if (!ownerScope) return undefined;
	return ownerScope.startsWith("user:") ? ownerScope.slice("user:".length) : ownerScope;
}

function piboRoomIdFromMetadata(metadata: PiboJsonObject | undefined): string | undefined {
	const value = metadata?.chatRoomId;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

type TelemetrySessionStore = PiboSessionStore & { getTelemetryStore?: () => TelemetryStore | undefined };

function telemetryStoreFromSessionStore(store: PiboSessionStore): TelemetryStore | undefined {
	return (store as TelemetrySessionStore).getTelemetryStore?.();
}

export class PiboSessionRouter {
	private readonly sessions = new Map<string, RoutedSession>();
	private readonly pendingSessions = new Map<string, Promise<RoutedSession>>();
	private readonly listeners = new Set<PiboEventListener>();
	private readonly runRegistry: PiboRunRegistry;
	private readonly signalRegistry: PiboSignalRegistry;
	private readonly runtimeRegistry: RuntimeSessionRegistry;
	private readonly scheduledRunReminders = new Map<string, boolean>();
	private readonly baseProfile: InitialSessionContext;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly sessionStore: PiboSessionStore;
	private readonly reliabilityStore?: PiboReliabilityStore;
	private readonly telemetryStore?: TelemetryStore;
	private readonly telemetryRecorder?: PiboRuntimeTelemetryRecorder;

	constructor(private readonly options: PiboSessionRouterOptions = {}) {
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
		this.sessionStore = options.sessionStore ?? new InMemoryPiboSessionStore();
		this.telemetryStore = options.telemetryStore ?? telemetryStoreFromSessionStore(this.sessionStore);
		this.telemetryRecorder = this.telemetryStore ? new PiboRuntimeTelemetryRecorder(this.telemetryStore) : undefined;
		const defaultProfileName = this.pluginRegistry.getProfileNames().includes("codex-compat-openai-web")
			? "codex-compat-openai-web"
			: this.pluginRegistry.getProfileNames()[0];
		this.baseProfile = options.profile ?? this.pluginRegistry.createProfile(defaultProfileName ?? "codex-compat-openai-web");
		this.reliabilityStore = options.reliabilityStore ?? (options.persistSession === false ? undefined : createDefaultPiboReliabilityStore());
		this.signalRegistry = options.signalRegistry ?? createPiboSignalRegistry();
		this.runtimeRegistry = new RuntimeSessionRegistry({ cwd: options.cwd ?? getDefaultPiboWorkspace() });
		this.runRegistry = new PiboRunRegistry({ store: this.reliabilityStore });
		this.runRegistry.subscribe((event) => this.projectRunRegistryEvent(event));
		for (const run of this.runRegistry.listAll({ includeConsumed: true, includeDetached: true })) {
			this.signalRegistry.project({ type: "run_changed", run, reason: "recovered" });
		}
	}

	subscribe(listener: PiboEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async emit(event: PiboInputEvent): Promise<PiboOutputEvent> {
		const session = await this.getOrCreateSession(event.piboSessionId);

		if (event.type === "message") {
			return session.enqueueMessage(event);
		}

		const output = await session.executeAction(event);
		if (event.action === "abort") {
			this.signalRegistry.project({ type: "session_interrupted", piboSessionId: event.piboSessionId, reason: "abort action" });
		}
		if (event.action === "dispose") {
			this.disposeSignalSubtree(event.piboSessionId, "dispose action");
		} else if (shouldResetSessionAfterAction(event.action)) {
			await this.resetCachedSession(event.piboSessionId, "provider auth changed");
		}
		return output;
	}

	async killSession(piboSessionId: string, options?: { includeRuns?: boolean }): Promise<{ killed: string[]; cancelledRuns: string[] }> {
		const killed: string[] = [];
		const cancelledRuns: string[] = [];
		const session = this.sessions.get(piboSessionId);
		if (session) {
			killed.push(await session.kill());
			if (options?.includeRuns) {
				const runs = this.runRegistry.cancelOwnerRuns(piboSessionId);
				cancelledRuns.push(...runs.map((r) => r.runId));
			}
			await this.runtimeRegistry.closeOwnerSessions(piboSessionId, { force: true });
			this.signalRegistry.project({ type: "session_interrupted", piboSessionId, reason: "kill" });
			const children = await this.killChildSessions(piboSessionId, options);
			killed.push(...children.killed);
			cancelledRuns.push(...children.cancelledRuns);
		}
		return { killed, cancelledRuns };
	}

	private disposeSignalSubtree(piboSessionId: string, reason: string): void {
		const descendants = this.descendantSessionIds(piboSessionId);
		for (const id of [piboSessionId, ...descendants]) {
			this.runRegistry.cancelOwnerRuns(id);
			void this.runtimeRegistry.closeOwnerSessions(id, { force: true });
			this.signalRegistry.project({ type: "session_disposed", piboSessionId: id, reason });
			this.scheduledRunReminders.delete(id);
			this.sessions.delete(id);
		}
	}

	private descendantSessionIds(parentId: string): string[] {
		const output: string[] = [];
		for (const session of this.sessionStore.list?.() ?? []) {
			if (session.parentId !== parentId) continue;
			output.push(session.id, ...this.descendantSessionIds(session.id));
		}
		return output;
	}

	private async killChildSessions(parentId: string, options?: { includeRuns?: boolean }): Promise<{ killed: string[]; cancelledRuns: string[] }> {
		const killed: string[] = [];
		const cancelledRuns: string[] = [];
		const allSessions = this.sessionStore.list?.() ?? [];
		for (const session of allSessions) {
			if (session.parentId === parentId) {
				const childSession = this.sessions.get(session.id);
				if (childSession) {
					killed.push(await childSession.kill());
				}
				if (options?.includeRuns) {
					const runs = this.runRegistry.cancelOwnerRuns(session.id);
					cancelledRuns.push(...runs.map((r) => r.runId));
				}
				const nested = await this.killChildSessions(session.id, options);
				killed.push(...nested.killed);
				cancelledRuns.push(...nested.cancelledRuns);
			}
		}
		return { killed, cancelledRuns };
	}

	getPiboSessionIds(): string[] {
		return [...this.sessions.keys()];
	}

	getSessionRuntimeStatus(piboSessionId: string): PiboSessionStatus | undefined {
		return this.sessions.get(piboSessionId)?.getStatus();
	}

	listSessionRuntimeStatuses(): PiboSessionStatus[] {
		return [...this.sessions.values()].map((session) => session.getStatus());
	}

	listRuns(options: { includeConsumed?: boolean; includeDetached?: boolean } = {}): PiboRunSnapshot[] {
		return this.runRegistry.listAll(options);
	}

	getSignalRegistry(): PiboSignalRegistry {
		return this.signalRegistry;
	}

	snapshotSignalSession(piboSessionId: string): PiboSignalSnapshot {
		this.projectKnownSessionSignals();
		return this.signalRegistry.snapshotSession(piboSessionId);
	}

	snapshotSignalTree(rootPiboSessionId: string): PiboSignalSnapshot {
		this.projectKnownSessionSignals();
		return this.signalRegistry.snapshotTree(rootPiboSessionId);
	}

	subscribeSignalTree(rootPiboSessionId: string, listener: (patch: PiboSignalPatch) => void): () => void {
		return this.signalRegistry.subscribe(rootPiboSessionId, listener);
	}

	async emitMessageAndWaitForReply(
		event: PiboMessageEvent,
		timeoutMs = 120000,
	): Promise<PiboAssistantMessageEvent> {
		const eventWithId: PiboMessageEvent = { ...event, id: event.id ?? randomUUID() };

		return await new Promise<PiboAssistantMessageEvent>((resolve, reject) => {
			let settled = false;
			const unsubscribe = this.subscribe((output) => {
				if (
					output.piboSessionId !== eventWithId.piboSessionId ||
					!("eventId" in output) ||
					output.eventId !== eventWithId.id
				) {
					return;
				}
				if (output.type === "assistant_message") {
					finish(output);
				} else if (output.type === "session_error") {
					finish(new Error(output.error));
				}
			});
			const timeout = setTimeout(() => {
				finish(new Error(`Timed out waiting for assistant reply from Pibo session "${eventWithId.piboSessionId}"`));
			}, timeoutMs);

			const finish = (result: PiboAssistantMessageEvent | Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				unsubscribe();
				if (result instanceof Error) {
					reject(result);
				} else {
					resolve(result);
				}
			};

			this.emit(eventWithId).catch(finish);
		});
	}

	async disposeAll(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		this.runRegistry.cancelAll("Pibo session router was disposed.");
		for (const session of sessions) this.signalRegistry.project({ type: "session_disposed", piboSessionId: session.getStatus().piboSessionId, reason: "router disposed" });
		this.scheduledRunReminders.clear();
		await this.runtimeRegistry.closeAll({ force: true });
		await Promise.all(sessions.map((session) => session.dispose()));
	}

	private async getOrCreateSession(piboSessionId: string): Promise<RoutedSession> {
		const existing = this.sessions.get(piboSessionId);
		if (existing) return existing;

		const pending = this.pendingSessions.get(piboSessionId);
		if (pending) return pending;

		const created = this.createRoutedSession(piboSessionId);
		this.pendingSessions.set(piboSessionId, created);
		try {
			return await created;
		} finally {
			this.pendingSessions.delete(piboSessionId);
		}
	}

	private async createRoutedSession(piboSessionId: string): Promise<RoutedSession> {
		const piboSession = this.resolvePiboSession(piboSessionId);
		this.signalRegistry.project({ type: "session_created", session: piboSession });
		const profile = this.pluginRegistry.createProfile(piboSession.profile);
		const parentPiSessionId = piboSession.parentId
			? this.resolvePiboSession(piboSession.parentId).piSessionId
			: undefined;
		const modelDefaults = this.resolveModelDefaults();
		const activeModel = this.ensureSessionActiveModel(piboSession, profile, parentPiSessionId, modelDefaults);
		const initialThinkingLevel = resolvePiboSessionInitialThinkingLevel(piboSession);
		const userSettings = loadPiboUserSettings(piboSession.ownerScope ?? "user:unknown");
		const telemetryExtension = this.telemetryStore
			? createPiboProviderTelemetryExtension({ store: this.telemetryStore, session: piboSession, model: activeModel })
			: undefined;
		const runtime = await createPiboRuntime({
			cwd: piboSession.workspace ?? this.options.cwd,
			persistSession: this.options.persistSession,
			thinkingLevel: initialThinkingLevel ?? this.options.thinkingLevel,
			profile: profileForSession(profile, piboSession.piSessionId, parentPiSessionId),
			extensionFactories: [
				...(telemetryExtension ? [telemetryExtension] : []),
				...(this.options.extensionFactories ?? []),
			],
			subagentRunner: this.createSubagentRunner(piboSession.id),
			runToolController: this.createRunToolController(piboSession.id),
			runtimeToolController: this.runtimeRegistry.createController(piboSession.id),
			modelDefaults,
			activeModel,
			sessionContext: {
				userId: userIdFromOwnerScope(piboSession.ownerScope),
				ownerScope: piboSession.ownerScope,
				piboSessionId: piboSession.id,
				piboRoomId: piboRoomIdFromMetadata(piboSession.metadata),
				timezone: userSettings.timezone,
			},
		});
		const initialFastMode = resolvePiboSessionInitialFastMode(piboSession) ?? selectRequestedFastMode(profileForSession(profile, piboSession.piSessionId, parentPiSessionId), modelDefaults) ?? false;
		const session = new RoutedSession(
			piboSession.id,
			runtime,
			this.emitOutput,
			this.pluginRegistry,
			this.options.forwardPiEvents ?? false,
			this.telemetryRecorder
				? (id, event, context) => this.telemetryRecorder?.recordPiEvent(id, event, { session: this.sessionStore.get(id), status: context.status, activeEventId: context.activeEventId })
				: undefined,
			initialFastMode,
			(result, event) => this.handleSessionOperation(result, event),
			(id, opts) => this.killChildSessions(id, opts),
			(state) => this.signalRegistry.project({ type: "session_processing_changed", piboSessionId: piboSession.id, processing: state.processing, queuedMessages: state.queuedMessages }),
		);
		this.sessions.set(piboSession.id, session);
		return session;
	}

	private ensureSessionActiveModel(
		piboSession: PiboSession,
		profile: InitialSessionContext,
		parentPiSessionId: string | undefined,
		modelDefaults: PiboModelDefaults,
	) {
		const activeModel = resolvePiboSessionActiveModel({
			profile,
			piboSession,
			parentPiSessionId,
			modelDefaults,
		});
		if (!piboSession.activeModel && activeModel) {
			this.sessionStore.update(piboSession.id, { activeModel });
		}
		return activeModel;
	}

	private resolveModelDefaults(): PiboModelDefaults {
		if (typeof this.options.modelDefaults === "function") return this.options.modelDefaults();
		if (this.options.modelDefaults) return this.options.modelDefaults;
		return loadPiboModelDefaults(this.options.cwd ?? process.cwd());
	}

	private async handleSessionOperation(
		result: PiboSessionOperationResult,
		event: PiboExecutionEvent,
	): Promise<void> {
		if (result.cancelled) return;

		if (event.action === "session.fork" || event.action === "session.clone") {
			const action = event.action as "session.fork" | "session.clone";
			const created = this.createDerivedSession(result, action);
			result.piboSessionId = created.id;
			await this.resetCachedSession(event.piboSessionId);
			return;
		}

		this.sessionStore.update(event.piboSessionId, {
			piSessionId: result.current.piSessionId,
			workspace: result.current.cwd,
		});
	}

	private createDerivedSession(
		result: PiboSessionOperationResult,
		action: "session.fork" | "session.clone",
	): PiboSession {
		const source = this.resolvePiboSession(result.piboSessionId);
		return this.sessionStore.create({
			channel: source.channel,
			kind: "branch",
			profile: source.profile,
			ownerScope: source.ownerScope,
			parentId: source.kind === "subagent" ? source.parentId : undefined,
			originId: source.id,
			piSessionId: result.current.piSessionId,
			workspace: result.current.cwd,
			title: source.title,
			activeModel: source.activeModel,
			metadata: {
				...asJsonObject(source.metadata),
				originAction: action,
				originPiSessionId: result.previous.piSessionId,
			},
		});
	}

	private async resetCachedSession(piboSessionId: string, reason?: string): Promise<void> {
		const cached = this.sessions.get(piboSessionId);
		this.sessions.delete(piboSessionId);
		await this.runtimeRegistry.closeOwnerSessions(piboSessionId, { force: true });
		await cached?.dispose();
		if (reason) this.signalRegistry.project({ type: "session_disposed", piboSessionId, reason });
	}

	private resolvePiboSession(piboSessionId: string): PiboSession {
		const existing = this.sessionStore.get(piboSessionId);
		if (existing) return existing;

		const created = this.sessionStore.create({
			id: piboSessionId,
			channel: "pibo.runtime",
			kind: "runtime",
			profile: this.baseProfile.profileName,
			workspace: this.options.cwd ?? getDefaultPiboWorkspace(),
		});
		this.signalRegistry.project({ type: "session_created", session: created });
		return created;
	}

	private createSubagentRunner(parentPiboSessionId: string): PiboSubagentRunner {
		return {
			runSubagent: async ({ subagent, message, threadKey, toolCallId }) => {
				this.assertSubagentDepth(parentPiboSessionId, subagent);
				const child = this.resolveSubagentSession(parentPiboSessionId, subagent, threadKey);
				const toolName = createSubagentToolName(subagent.name);

				const event: PiboMessageEvent = {
					type: "message",
					piboSessionId: child.id,
					text: message,
					source: "actor",
					id: randomUUID(),
				};

				this.emitOutput({
					type: "subagent_session",
					piboSessionId: parentPiboSessionId,
					toolCallId,
					toolName,
					subagentName: subagent.name,
					childPiboSessionId: child.id,
					threadKey: typeof child.metadata?.threadKey === "string" ? child.metadata.threadKey : undefined,
				});

				const reply = await this.emitMessageAndWaitForReply(
					event,
					subagent.timeoutMs ?? DEFAULT_SUBAGENT_REPLY_TIMEOUT_MS,
				);
				return { piboSessionId: child.id, eventId: event.id!, reply };
			},
		};
	}

	private createRunToolController(parentPiboSessionId: string): PiboRunToolController {
		return {
			startToolRun: ({ toolName, params, completionPolicy, retryable, maxAttempts, execute }) => {
				const run = this.runRegistry.startToolRun({
					ownerPiboSessionId: parentPiboSessionId,
					toolName,
					params,
					completionPolicy,
					retryable,
					maxAttempts,
				});

				void (async () => {
					try {
						const result = await execute();
						const completed = this.runRegistry.complete(run.runId, result);
						if (completed) this.scheduleRunReminder(parentPiboSessionId, false);
					} catch (error) {
						const failed = this.runRegistry.fail(
							run.runId,
							error instanceof Error ? error.message : String(error),
						);
						if (failed) this.scheduleRunReminder(parentPiboSessionId, false);
					}
				})();

				return run;
			},
			listRuns: (options) => this.runRegistry.list(parentPiboSessionId, options),
			getRunStatus: (runId) => this.runRegistry.status(parentPiboSessionId, runId),
			waitForRun: (runId, timeoutMs) => this.runRegistry.wait(parentPiboSessionId, runId, timeoutMs),
			readRun: (runId) => {
				const run = this.runRegistry.read(parentPiboSessionId, runId);
				if (run.consumed && isTerminalRunStatus(run.status)) {
					this.refreshQueuedRunReminders(parentPiboSessionId);
				}
				return run;
			},
			cancelRun: async (runId) => {
				const cancelled = this.runRegistry.cancel(parentPiboSessionId, runId);
				this.refreshQueuedRunReminders(parentPiboSessionId);
				return cancelled;
			},
			ackRun: (runId) => {
				const run = this.runRegistry.ack(parentPiboSessionId, runId);
				this.refreshQueuedRunReminders(parentPiboSessionId);
				return run;
			},
		};
	}

	private assertSubagentDepth(parentPiboSessionId: string, subagent: SubagentProfile): void {
		const maxDepth = subagent.maxDepth ?? 3;
		if (this.getSubagentDepth(parentPiboSessionId) >= maxDepth) {
			throw new Error(
				`Subagent "${subagent.name}" exceeded max depth ${maxDepth} from Pibo session "${parentPiboSessionId}"`,
			);
		}
	}

	private getSubagentDepth(piboSessionId: string): number {
		let depth = 0;
		let current = this.sessionStore.get(piboSessionId);
		const seen = new Set<string>();
		while (current?.parentId) {
			if (seen.has(current.parentId)) break;
			seen.add(current.parentId);
			depth += 1;
			current = this.sessionStore.get(current.parentId);
		}
		return depth;
	}

	private resolveSubagentSession(
		parentPiboSessionId: string,
		subagent: SubagentProfile,
		threadKey?: string,
	): PiboSession {
			const targetProfile = this.pluginRegistry.resolveProfileName(subagent.targetProfile);
			const parent = this.resolvePiboSession(parentPiboSessionId);
			const resolvedThreadKey = threadKey?.trim() ? threadKey.trim() : randomUUID();
			const baseMetadata: PiboJsonObject = {
				subagentName: subagent.name,
				subagentToolName: createSubagentToolName(subagent.name),
				threadKey: resolvedThreadKey,
			};
			const metadata: PiboJsonObject = withWorkflowSessionKind(baseMetadata, "subagent");
			const parentChatRoomId = typeof parent.metadata?.chatRoomId === "string" ? parent.metadata.chatRoomId : undefined;
			if (parentChatRoomId) metadata.chatRoomId = parentChatRoomId;
			const legacyMetadata: PiboJsonObject = { ...baseMetadata };
			const legacyMetadataWithChatRoom: PiboJsonObject | undefined = parentChatRoomId
				? { ...baseMetadata, chatRoomId: parentChatRoomId }
				: undefined;
			const findExisting = (candidate: PiboJsonObject | undefined): PiboSession | undefined => candidate
				? this.sessionStore.find({
					channel: "pibo.subagents",
					kind: "subagent",
					parentId: parent.id,
					profile: targetProfile,
					metadata: candidate,
				})[0]
				: undefined;
			const existing = findExisting(metadata) ?? findExisting(legacyMetadataWithChatRoom) ?? findExisting(legacyMetadata);
			if (existing) {
				const updatedMetadata = withWorkflowSessionKind(
					{
						...(existing.metadata ?? {}),
						...(parentChatRoomId ? { chatRoomId: parentChatRoomId } : {}),
					},
					"subagent",
				);
				if (JSON.stringify(updatedMetadata) !== JSON.stringify(existing.metadata ?? {})) {
					return this.sessionStore.update(existing.id, { metadata: updatedMetadata }) ?? existing;
				}
				return existing;
			}

			const childProfile = this.pluginRegistry.createProfile(targetProfile);
			const childSession = this.sessionStore.create({
				channel: "pibo.subagents",
				kind: "subagent",
				profile: targetProfile,
				ownerScope: parent.ownerScope,
				parentId: parent.id,
				workspace: parent.workspace,
				metadata,
			});
			this.signalRegistry.project({ type: "session_created", session: childSession });
			const activeModel = resolvePiboSessionActiveModel({
				profile: childProfile,
				piboSession: childSession,
				parentPiSessionId: parent.piSessionId,
				modelDefaults: this.resolveModelDefaults(),
			});
			return activeModel ? this.sessionStore.update(childSession.id, { activeModel }) ?? childSession : childSession;
		}

	private readonly emitOutput = (event: PiboOutputEvent): void => {
		const session = this.sessionStore.get(event.piboSessionId);
		this.telemetryRecorder?.recordOutput(event, { session, status: this.sessions.get(event.piboSessionId)?.getStatus() });
		this.signalRegistry.project({ type: "pibo_output", event, session });
		this.pluginRegistry.notifyEvent(event);
		for (const listener of this.listeners) {
			listener(event);
		}

		if (event.type === "message_finished" && event.source !== "service") {
			this.scheduleRunReminder(event.piboSessionId, true);
		}
	};

	private projectKnownSessionSignals(): void {
		for (const session of this.sessionStore.list?.() ?? []) {
			this.signalRegistry.project({ type: "session_created", session });
		}
	}

	private projectRunRegistryEvent(event: PiboRunRegistryEvent): void {
		if (event.type === "run_removed") {
			this.signalRegistry.project({ type: "run_removed", runId: event.runId, ownerPiboSessionId: event.ownerPiboSessionId });
			return;
		}
		this.signalRegistry.project({ type: "run_changed", run: event.run, previousStatus: "previousStatus" in event ? event.previousStatus : undefined, reason: "reason" in event ? event.reason : event.type });
	}

	private scheduleRunReminder(piboSessionId: string, includeAlreadyNotified: boolean): void {
		if (!this.runRegistry.hasPendingNotification(piboSessionId, { includeAlreadyNotified })) return;
		const previous = this.scheduledRunReminders.get(piboSessionId);
		if (previous !== undefined) {
			this.scheduledRunReminders.set(piboSessionId, previous || includeAlreadyNotified);
			return;
		}

		this.scheduledRunReminders.set(piboSessionId, includeAlreadyNotified);
		queueMicrotask(() => {
			void this.deliverRunReminder(piboSessionId);
		});
	}

	private refreshQueuedRunReminders(piboSessionId: string): void {
		const removed = this.sessions.get(piboSessionId)?.removeQueuedMessages(isRunReminderServiceMessage) ?? 0;
		if (removed > 0) this.scheduleRunReminder(piboSessionId, true);
	}

	private async deliverRunReminder(piboSessionId: string): Promise<void> {
		const includeAlreadyNotified = this.scheduledRunReminders.get(piboSessionId) ?? false;
		this.scheduledRunReminders.delete(piboSessionId);
		const notification = this.runRegistry.createNotification(piboSessionId, { includeAlreadyNotified });
		if (!notification) return;

		try {
			const session = await this.getOrCreateSession(piboSessionId);
			session.enqueueMessage({
				type: "message",
				piboSessionId,
				text: formatRunReminderMessage(notification),
				source: "service",
				id: randomUUID(),
			});
		} catch (error) {
			this.emitOutput({
				type: "session_error",
				piboSessionId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
