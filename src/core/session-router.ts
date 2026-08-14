import { randomUUID } from "node:crypto";
import {
	InitialSessionContext,
	type InitialSessionContextOptions,
	type ModelProfile,
	type SubagentProfile,
} from "./profiles.js";
import { createDefaultPiboPluginRegistry, createPiboProfileFromRegistryOrDefault, resolvePiboProfileNameFromRegistryOrDefault, selectDefaultPiboProfileName } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import { createPiboRuntime, type PiboRuntimeOptions, type PiboRuntimeRetryDefaults } from "./runtime.js";
import { RoutedSession, type PiboMessagePreflight } from "./routed-session.js";
import { runtimeSessionErrorDetails } from "./session-errors.js";
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
import { PiboRunExecutionTimeoutError } from "../runs/lifecycle.js";
import { PiboRunResourceLimitError } from "../runs/resource-isolation.js";
import { createPiboSignalRegistry } from "../signals/registry.js";
import type { PiboSignalPatch, PiboSignalRegistry, PiboSignalSnapshot, PiboSignalStatusSnapshot } from "../signals/types.js";
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
import { GatewayWorkAdmissionController } from "./gateway-resource-guard.js";
import { withWorkflowSessionKind } from "../sessions/workflow-session-kind.js";
import { PiboRuntimeTelemetryRecorder, type ProviderEventTelemetryMode } from "./runtime-telemetry.js";
import { createPiboProviderTelemetryExtension } from "./provider-telemetry.js";
import type { TelemetryStore } from "../data/telemetry.js";
import { AsyncTelemetryWriter } from "../data/telemetry-writer.js";

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
	/** Dispose inactive routed runtimes after this interval while preserving persisted Pibo/Pi Sessions. */
	routedSessionIdleTimeoutMs?: number | false;
	/** Revalidate persisted authority immediately before a queued message starts. */
	messagePreflight?: PiboMessagePreflight;
	/** Reconcile persisted turns left active by a previous authoritative gateway runtime. */
	recoverInterruptedRuntimeState?: boolean;
	/** Runtime identifier included in authoritative recovery diagnostics. */
	runtimeInstanceId?: string;
	/** Maximum time to await one routed runtime disposal before forcing terminal ownership release. */
	routedSessionDisposeTimeoutMs?: number;
};

const DEFAULT_SUBAGENT_REPLY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ROUTED_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_ROUTED_SESSION_DISPOSE_TIMEOUT_MS = 30 * 1000;

export const LOOP_RUNTIME_RETRY_DEFAULTS = {
	enabled: true,
	maxRetries: 7,
	baseDelayMs: 2_000,
} as const satisfies PiboRuntimeRetryDefaults;
/** @deprecated Use LOOP_RUNTIME_RETRY_DEFAULTS. */
export const RALPH_RUNTIME_RETRY_DEFAULTS = LOOP_RUNTIME_RETRY_DEFAULTS;

export function resolvePiboSessionRetryDefaults(
	kind: string,
	configured?: PiboRuntimeRetryDefaults,
): PiboRuntimeRetryDefaults | undefined {
	return configured ?? (kind === "loop" || kind === "ralph" ? LOOP_RUNTIME_RETRY_DEFAULTS : undefined);
}

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
		mcpServers: baseProfile.mcpServers,
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
				resourceLimitReason: run.resources?.limitReason,
				resourceUnit: run.resources?.unitName,
			})),
			timedOut: notification.timedOut.map((run) => ({
				runId: run.runId,
				kind: run.kind,
				status: run.status,
				toolName: run.toolName,
				summary: run.summary,
				timeoutMs: run.timeoutMs,
				timeoutPhase: run.timeoutPhase,
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
				"Use pibo_run_read for completed, failed, or timed_out runs. Use pibo_run_wait, pibo_run_status, pibo_run_cancel, or pibo_run_ack for runs you still need to manage.",
		}),
		"</pibo_run_notification>",
	].join("\n");
}

function isRunReminderServiceMessage(event: PiboMessageEvent): boolean {
	return event.source === "service" && event.capabilityScope === "run-reminder";
}

function isTerminalRunStatus(status: string): boolean {
	return status === "completed" || status === "failed" || status === "timed_out" || status === "cancelled";
}

function asJsonObject(value: PiboJsonObject | undefined): PiboJsonObject {
	return value ?? {};
}

function shouldResetSessionAfterAction(action: string): boolean {
	return action === "login.complete" || action === "login.apikey" || action === "logout";
}

function piboRoomIdFromMetadata(metadata: PiboJsonObject | undefined): string | undefined {
	const value = metadata?.chatRoomId;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

type TelemetrySessionStore = PiboSessionStore & { getTelemetryStore?: () => TelemetryStore | undefined };

type RuntimeRecoverySessionStore = PiboSessionStore & {
	recoverInterruptedRuntimeState?: (input: {
		recoveredRuns: readonly PiboRunSnapshot[];
	}) => Array<{ event: Extract<PiboOutputEvent, { type: "session_error" }> }>;
};

type ScheduledRunReminder = {
	generation: number;
	includeAlreadyNotified: boolean;
};

class PiboSessionDisposalTimeoutError extends Error {
	constructor(readonly piboSessionId: string, readonly timeoutMs: number) {
		super(`Timed out disposing Pibo session "${piboSessionId}" after ${timeoutMs}ms`);
		this.name = "PiboSessionDisposalTimeoutError";
	}
}

function telemetryStoreFromSessionStore(store: PiboSessionStore): TelemetryStore | undefined {
	return (store as TelemetrySessionStore).getTelemetryStore?.();
}

function providerEventTelemetryModeFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderEventTelemetryMode {
	const value = env.PIBO_TELEMETRY_PROVIDER_EVENTS?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "detailed" ? "detailed" : "aggregate";
}

export class PiboSessionRouter {
	private readonly sessions = new Map<string, RoutedSession>();
	private readonly pendingSessions = new Map<string, Promise<RoutedSession>>();
	private readonly listeners = new Set<PiboEventListener>();
	private readonly runRegistry: PiboRunRegistry;
	private readonly gatewayWorkAdmission = new GatewayWorkAdmissionController();
	private readonly signalRegistry: PiboSignalRegistry;
	private readonly runtimeRegistry: RuntimeSessionRegistry;
	private readonly scheduledRunReminders = new Map<string, ScheduledRunReminder>();
	private readonly runReminderGenerations = new Map<string, number>();
	private readonly quiescingSessions = new Set<string>();
	private readonly disposingSessions = new Map<string, Promise<void>>();
	private readonly idleSessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly routedSessionIdleTimeoutMs: number | false;
	private readonly routedSessionDisposeTimeoutMs: number;
	private readonly baseProfile: InitialSessionContext;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly sessionStore: PiboSessionStore;
	private readonly reliabilityStore?: PiboReliabilityStore;
	private readonly telemetryStore?: TelemetryStore;
	private readonly telemetryWriter?: AsyncTelemetryWriter;
	private readonly telemetryRecorder?: PiboRuntimeTelemetryRecorder;
	private disposePromise?: Promise<void>;
	private closing = false;

	constructor(private readonly options: PiboSessionRouterOptions = {}) {
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
		this.sessionStore = options.sessionStore ?? new InMemoryPiboSessionStore();
		this.telemetryStore = options.telemetryStore ?? telemetryStoreFromSessionStore(this.sessionStore);
		this.telemetryWriter = this.telemetryStore ? new AsyncTelemetryWriter(this.telemetryStore) : undefined;
		this.telemetryRecorder = this.telemetryStore
			? new PiboRuntimeTelemetryRecorder(this.telemetryStore, undefined, {
				providerEventMode: providerEventTelemetryModeFromEnv(),
				writer: this.telemetryWriter,
			})
			: undefined;
		const idleTimeoutMs = options.routedSessionIdleTimeoutMs;
		this.routedSessionIdleTimeoutMs = idleTimeoutMs === false
			? false
			: typeof idleTimeoutMs === "number" && Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0
				? idleTimeoutMs
				: DEFAULT_ROUTED_SESSION_IDLE_TIMEOUT_MS;
		const disposeTimeoutMs = options.routedSessionDisposeTimeoutMs;
		this.routedSessionDisposeTimeoutMs = typeof disposeTimeoutMs === "number" && Number.isFinite(disposeTimeoutMs) && disposeTimeoutMs > 0
			? disposeTimeoutMs
			: DEFAULT_ROUTED_SESSION_DISPOSE_TIMEOUT_MS;
		const defaultProfileName = selectDefaultPiboProfileName(this.pluginRegistry);
		this.baseProfile = options.profile ?? createPiboProfileFromRegistryOrDefault(this.pluginRegistry, defaultProfileName);
		this.reliabilityStore = options.reliabilityStore ?? (options.persistSession === false ? undefined : createDefaultPiboReliabilityStore());
		this.signalRegistry = options.signalRegistry ?? createPiboSignalRegistry();
		this.runtimeRegistry = new RuntimeSessionRegistry({ cwd: options.cwd ?? getDefaultPiboWorkspace() });
		this.runRegistry = new PiboRunRegistry({ store: this.reliabilityStore });
		this.runRegistry.subscribe((event) => this.projectRunRegistryEvent(event));
		const recoveredRuntimeState = options.recoverInterruptedRuntimeState
			? (this.sessionStore as RuntimeRecoverySessionStore).recoverInterruptedRuntimeState?.({
				recoveredRuns: this.runRegistry.listRecoveredRuns(),
			}) ?? []
			: [];
		if (recoveredRuntimeState.length > 0 && options.runtimeInstanceId) {
			console.error(`[pibo] authoritative runtime ${options.runtimeInstanceId} recovered ${recoveredRuntimeState.length} interrupted turn(s)`);
		}
		for (const recovery of recoveredRuntimeState) {
			const session = this.sessionStore.get(recovery.event.piboSessionId);
			if (session) this.signalRegistry.project({ type: "session_created", session });
			this.signalRegistry.project({ type: "pibo_output", event: recovery.event });
		}
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
		if (this.closing) throw new Error("Pibo session router is disposed.");
		const teardownAction = event.type === "execution" && (event.action === "dispose" || event.action === "kill" || event.action === "kill_all");
		const teardownIds = teardownAction
			? [event.piboSessionId, ...this.descendantSessionIds(event.piboSessionId)]
			: [];
		if (event.type === "execution" && event.action === "abort") {
			this.invalidateRunReminders([event.piboSessionId]);
		} else if (teardownAction) {
			this.invalidateRunReminders(teardownIds);
		}
		if (event.type === "message" && event.id) {
			const stored = this.sessionStore.get(event.piboSessionId);
			if (stored) this.signalRegistry.project({ type: "session_created", session: stored });
			this.signalRegistry.project({ type: "message_accepted", piboSessionId: event.piboSessionId, eventId: event.id, source: event.source });
		}
		let session: RoutedSession;
		try {
			session = await this.getOrCreateSession(event.piboSessionId);
		} catch (error) {
			if (event.type === "message" && event.id) {
				this.signalRegistry.project({
					type: "pibo_output",
					event: {
						type: "session_error",
						piboSessionId: event.piboSessionId,
						eventId: event.id,
						error: error instanceof Error ? error.message : String(error),
					},
				});
			}
			throw error;
		}
		this.clearIdleSessionTimer(event.piboSessionId);
		let teardownCompleted = false;
		if (teardownAction) this.beginSessionQuiescence(teardownIds);
		try {
			if (event.type === "message") {
				return event.delivery === "steer"
					? await session.steerMessage(event)
					: session.enqueueMessage(event);
			}

			if (event.action === "abort") {
				this.signalRegistry.project({ type: "session_interrupted", piboSessionId: event.piboSessionId, reason: "abort action" });
			} else if (event.action === "dispose" || event.action === "kill" || event.action === "kill_all") {
				this.signalRegistry.project({ type: "session_disposed", piboSessionId: event.piboSessionId, reason: `${event.action} action` });
			}
			if (event.action === "dispose") {
				const output: PiboOutputEvent = {
					type: "execution_result",
					piboSessionId: event.piboSessionId,
					eventId: event.id,
					action: event.action,
					result: { disposed: true },
				};
				this.emitOutput(output);
				await this.disposeSessionSubtree(event.piboSessionId, "dispose action", { cancelRuns: true });
				teardownCompleted = true;
				return output;
			}

			const output = await session.executeAction(event);
			if (event.action === "kill" || event.action === "kill_all") {
				await this.disposeSessionSubtree(event.piboSessionId, `${event.action} action`, { cancelRuns: event.action === "kill_all" });
				teardownCompleted = true;
			} else if (shouldResetSessionAfterAction(event.action)) {
				await this.resetCachedSession(event.piboSessionId, "provider auth changed");
			}
			return output;
		} catch (error) {
			if (teardownAction && !teardownCompleted) {
				await this.disposeSessionSubtree(event.piboSessionId, `${event.action} action failed`, { cancelRuns: event.action === "dispose" || event.action === "kill_all" }).catch(() => {});
			}
			if (event.type === "message" && event.id) {
				this.signalRegistry.project({
					type: "message_rejected",
					piboSessionId: event.piboSessionId,
					eventId: event.id,
				});
				const status = session.getStatus();
				this.signalRegistry.project({
					type: "session_processing_changed",
					piboSessionId: event.piboSessionId,
					processing: status.processing,
					queuedMessages: status.queuedMessages,
				});
			}
			throw error;
		} finally {
			this.scheduleIdleSessionEvictionIfIdle(event.piboSessionId);
		}
	}

	async killSession(piboSessionId: string, options?: { includeRuns?: boolean }): Promise<{ killed: string[]; cancelledRuns: string[] }> {
		const rootSession = this.sessions.get(piboSessionId);
		if (!rootSession) return { killed: [], cancelledRuns: [] };

		const ids = [piboSessionId, ...this.descendantSessionIds(piboSessionId)];
		this.beginSessionQuiescence(ids);
		const killed: string[] = [];
		const cancelledRuns: string[] = [];
		const failures: unknown[] = [];
		for (const id of ids) {
			const session = this.sessions.get(id);
			if (session) {
				this.signalRegistry.project({ type: "session_disposed", piboSessionId: id, reason: "kill" });
				try {
					killed.push(await session.kill());
				} catch (error) {
					failures.push(error);
				}
			}
			if (options?.includeRuns) {
				const runs = this.runRegistry.cancelControllerRuns(id);
				cancelledRuns.push(...runs.map((run) => run.runId));
			}
		}
		try {
			await this.disposeSessionSubtree(piboSessionId, "kill", { cancelRuns: false });
		} catch (error) {
			failures.push(error);
		}
		if (failures.length > 0) throw new AggregateError(failures, `Failed to kill Pibo session subtree "${piboSessionId}"`);
		return { killed, cancelledRuns };
	}

	private async disposeRoutedSession(piboSessionId: string, session: RoutedSession, reason: string): Promise<void> {
		const disposal = Promise.resolve().then(() => session.dispose());
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => reject(new PiboSessionDisposalTimeoutError(piboSessionId, this.routedSessionDisposeTimeoutMs)), this.routedSessionDisposeTimeoutMs);
			timeout.unref?.();
		});
		try {
			await Promise.race([disposal, timedOut]);
		} catch (error) {
			if (error instanceof PiboSessionDisposalTimeoutError) {
				session.forceDispose(`${reason}; bounded disposal timeout`);
				void disposal.catch(() => {});
			}
			throw error;
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private async disposeSessionSubtree(piboSessionId: string, reason: string, options: { cancelRuns: boolean }): Promise<void> {
		const ids = [piboSessionId, ...this.descendantSessionIds(piboSessionId)];
		const existingDisposals = [...new Set(ids.map((id) => this.disposingSessions.get(id)).filter((value): value is Promise<void> => Boolean(value)))];
		if (existingDisposals.length > 0) await Promise.all(existingDisposals);

		this.beginSessionQuiescence(ids);
		if (options.cancelRuns) {
			for (const id of ids) this.runRegistry.cancelControllerRuns(id);
		}

		let releaseStart: (() => void) | undefined;
		const startGate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const operation = (async () => {
			await startGate;
			const pending = ids.map((id) => this.pendingSessions.get(id)).filter((value): value is Promise<RoutedSession> => Boolean(value));
			if (pending.length > 0) await Promise.allSettled(pending);
			const sessions = ids.flatMap((id) => {
				const session = this.sessions.get(id);
				return session ? [{ id, session }] : [];
			});
			const failures: unknown[] = [];
			const closeResults = await Promise.allSettled(ids.map((id) => this.runtimeRegistry.closeControllerSessions(id, { force: true })));
			for (const result of closeResults) {
				if (result.status === "rejected") failures.push(result.reason);
			}
			const disposeResults = await Promise.allSettled(sessions.map(({ id, session }) => this.disposeRoutedSession(id, session, reason)));
			for (const result of disposeResults) {
				if (result.status === "rejected") failures.push(result.reason);
			}
			for (const { id, session } of sessions) {
				if (this.sessions.get(id) === session) this.sessions.delete(id);
			}
			if (failures.length > 0) throw new AggregateError(failures, `Failed to dispose Pibo session subtree "${piboSessionId}"`);
		})();
		for (const id of ids) this.disposingSessions.set(id, operation);
		releaseStart?.();

		try {
			await operation;
		} finally {
			for (const id of ids) {
				if (this.disposingSessions.get(id) === operation) this.disposingSessions.delete(id);
				this.quiescingSessions.delete(id);
				this.signalRegistry.project({ type: "session_disposed", piboSessionId: id, reason });
			}
			await this.telemetryWriter?.flush();
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
					const runs = this.runRegistry.cancelControllerRuns(session.id);
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

	async getSessionStatusSnapshot(piboSessionId: string): Promise<PiboSessionStatus> {
		const session = await this.getOrCreateSession(piboSessionId);
		try {
			return await session.getStatusSnapshot();
		} finally {
			this.scheduleIdleSessionEvictionIfIdle(piboSessionId);
		}
	}

	async setLiveSessionActiveModel(piboSessionId: string, model: ModelProfile | undefined): Promise<ModelProfile | undefined> {
		const session = this.sessions.get(piboSessionId);
		if (!session) return model;
		const status = session.getStatus();
		if (status.processing || status.streaming || status.queuedMessages > 0) {
			throw new Error("Session model can only be changed while the runtime is idle.");
		}
		if (!model) {
			await this.resetCachedSession(piboSessionId);
			return undefined;
		}
		return session.setModel(model);
	}

	reportSessionError(piboSessionId: string, error: string, options: { eventId?: string; source?: "pi" | "pibo" } = {}): void {
		this.signalRegistry.project({ type: "session_created", session: this.resolvePiboSession(piboSessionId) });
		this.emitOutput({
			type: "session_error",
			piboSessionId,
			eventId: options.eventId,
			error,
			errorDetails: runtimeSessionErrorDetails(error),
		});
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

	snapshotSignalStatuses(): PiboSignalStatusSnapshot {
		this.projectKnownSessionSignals();
		return this.signalRegistry.snapshotStatuses();
	}

	subscribeSignalTree(rootPiboSessionId: string, listener: (patch: PiboSignalPatch) => void): () => void {
		return this.signalRegistry.subscribe(rootPiboSessionId, listener);
	}

	subscribeSignalStatuses(listener: (patch: PiboSignalPatch) => void): () => void {
		return this.signalRegistry.subscribeAll(listener);
	}

	async emitMessageAndWaitForReply(
		event: PiboMessageEvent,
		timeoutMs = 120000,
	): Promise<PiboAssistantMessageEvent> {
		const eventWithId: PiboMessageEvent = { ...event, id: event.id ?? randomUUID() };

		return await new Promise<PiboAssistantMessageEvent>((resolve, reject) => {
			let settled = false;
			let lastAssistantMessage: PiboAssistantMessageEvent | undefined;
			let timeout: NodeJS.Timeout | undefined;
			const unsubscribe = this.subscribe((output) => {
				if (
					output.piboSessionId !== eventWithId.piboSessionId ||
					!("eventId" in output) ||
					output.eventId !== eventWithId.id
				) {
					return;
				}
				if (output.type === "assistant_message") {
					lastAssistantMessage = output;
				} else if (output.type === "message_finished") {
					finish(lastAssistantMessage ?? new Error(`Pibo session "${eventWithId.piboSessionId}" finished without an assistant reply`));
				} else if (output.type === "session_error") {
					finish(new Error(output.error));
				}
			});

			const finish = (result: PiboAssistantMessageEvent | Error) => {
				if (settled) return;
				settled = true;
				if (timeout) clearTimeout(timeout);
				unsubscribe();
				if (result instanceof Error) {
					reject(result);
				} else {
					resolve(result);
				}
			};

			timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				unsubscribe();
				const timeoutError = new Error(`Timed out waiting for assistant reply from Pibo session "${eventWithId.piboSessionId}"`);
				reject(timeoutError);
				void this.emit({
					type: "execution",
					piboSessionId: eventWithId.piboSessionId,
					action: "abort",
					id: randomUUID(),
				}).catch(() => {});
			}, timeoutMs);

			this.emit(eventWithId).catch(finish);
		});
	}

	async disposeAll(): Promise<void> {
		if (this.disposePromise) return this.disposePromise;
		this.closing = true;
		this.disposePromise = this.disposeAllUnsafe();
		return this.disposePromise;
	}

	private async disposeAllUnsafe(): Promise<void> {
		try {
			const initialIds = [...new Set([...this.sessions.keys(), ...this.pendingSessions.keys()])];
			this.beginSessionQuiescence(initialIds);
			await Promise.allSettled([...this.pendingSessions.values()]);
			const sessions = [...this.sessions.entries()];
			for (const timer of this.idleSessionTimers.values()) clearTimeout(timer);
			this.idleSessionTimers.clear();
			this.runRegistry.cancelAll("Pibo session router was disposed.");
			this.scheduledRunReminders.clear();
			const closeResult = await Promise.allSettled([this.runtimeRegistry.closeAll({ force: true })]);
			const disposeResults = await Promise.allSettled(sessions.map(([id, session]) => this.disposeRoutedSession(id, session, "router disposed")));
			for (const [id, session] of sessions) {
				if (this.sessions.get(id) === session) this.sessions.delete(id);
				this.signalRegistry.project({ type: "session_disposed", piboSessionId: id, reason: "router disposed" });
			}
			const failures = [
				...closeResult.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason),
				...disposeResults.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason),
			];
			if (failures.length > 0) throw new AggregateError(failures, "Failed to dispose all Pibo sessions");
		} finally {
			await this.telemetryWriter?.dispose();
		}
	}

	private clearIdleSessionTimer(piboSessionId: string): void {
		const timer = this.idleSessionTimers.get(piboSessionId);
		if (timer) clearTimeout(timer);
		this.idleSessionTimers.delete(piboSessionId);
	}

	private scheduleIdleSessionEvictionIfIdle(piboSessionId: string): void {
		if (this.routedSessionIdleTimeoutMs === false) return;
		const session = this.sessions.get(piboSessionId);
		if (!session) return;
		const status = session.getStatus();
		if (status.disposed || status.processing || status.streaming || status.queuedMessages > 0) {
			this.clearIdleSessionTimer(piboSessionId);
			return;
		}
		this.clearIdleSessionTimer(piboSessionId);
		const timer = setTimeout(() => {
			this.idleSessionTimers.delete(piboSessionId);
			void this.evictIdleSession(piboSessionId, session).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				this.emitOutput({
					type: "session_error",
					piboSessionId,
					error: `Failed to dispose idle routed runtime: ${message}`,
					errorDetails: runtimeSessionErrorDetails(message),
				});
			});
		}, this.routedSessionIdleTimeoutMs);
		timer.unref();
		this.idleSessionTimers.set(piboSessionId, timer);
	}

	private async evictIdleSession(piboSessionId: string, expected: RoutedSession): Promise<void> {
		const current = this.sessions.get(piboSessionId);
		if (current !== expected) return;
		const status = current.getStatus();
		if (status.disposed || status.processing || status.streaming || status.queuedMessages > 0) return;
		await this.resetCachedSession(piboSessionId, "routed runtime idle timeout");
	}

	private async getOrCreateSession(piboSessionId: string): Promise<RoutedSession> {
		if (this.closing) throw new Error("Pibo session router is disposed.");
		if (this.quiescingSessions.has(piboSessionId)) {
			throw new Error(`Pibo session "${piboSessionId}" is quiescing.`);
		}
		const disposing = this.disposingSessions.get(piboSessionId);
		if (disposing) {
			await disposing;
			return await this.getOrCreateSession(piboSessionId);
		}
		const existing = this.sessions.get(piboSessionId);
		if (existing) {
			this.clearIdleSessionTimer(piboSessionId);
			return existing;
		}

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
		let session: RoutedSession | undefined;
		this.signalRegistry.project({ type: "session_created", session: piboSession });
		const profile = createPiboProfileFromRegistryOrDefault(this.pluginRegistry, piboSession.profile);
		const parentPiSessionId = piboSession.parentId
			? this.resolvePiboSession(piboSession.parentId).piSessionId
			: undefined;
		const modelDefaults = this.resolveModelDefaults();
		const activeModel = this.ensureSessionActiveModel(piboSession, profile, parentPiSessionId, modelDefaults);
		const initialThinkingLevel = resolvePiboSessionInitialThinkingLevel(piboSession);
		const userSettings = loadPiboUserSettings();
		const telemetryExtension = this.telemetryStore
			? createPiboProviderTelemetryExtension({ store: this.telemetryStore, writer: this.telemetryWriter, session: piboSession, model: activeModel })
			: undefined;
		const runtime = await createPiboRuntime({
			cwd: piboSession.workspace ?? this.options.cwd,
			persistSession: this.options.persistSession,
			thinkingLevel: initialThinkingLevel ?? this.options.thinkingLevel,
			retryDefaults: resolvePiboSessionRetryDefaults(piboSession.kind, this.options.retryDefaults),
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
				piboSessionId: piboSession.id,
				piboRoomId: piboRoomIdFromMetadata(piboSession.metadata),
				timezone: userSettings.timezone,
				getActiveMessage: () => session?.getActiveMessage(),
			},
		});
		const initialFastMode = resolvePiboSessionInitialFastMode(piboSession) ?? selectRequestedFastMode(profileForSession(profile, piboSession.piSessionId, parentPiSessionId), modelDefaults) ?? false;
		session = new RoutedSession(
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
			(state) => {
				this.signalRegistry.project({ type: "session_processing_changed", piboSessionId: piboSession.id, processing: state.processing, queuedMessages: state.queuedMessages });
				if (state.disposed || state.processing || state.queuedMessages > 0) this.clearIdleSessionTimer(piboSession.id);
				else this.scheduleIdleSessionEvictionIfIdle(piboSession.id);
			},
			(messages, reason) => this.telemetryRecorder?.recordMessagesInterrupted(messages, {
				session: this.sessionStore.get(piboSession.id),
				status: this.sessions.get(piboSession.id)?.getStatus(),
			}, reason),
			this.options.messagePreflight,
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
		const existingDisposal = this.disposingSessions.get(piboSessionId);
		if (existingDisposal) await existingDisposal;
		this.clearIdleSessionTimer(piboSessionId);

		let releaseStart: (() => void) | undefined;
		const startGate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const operation = (async () => {
			await startGate;
			const pending = this.pendingSessions.get(piboSessionId);
			if (pending) await Promise.allSettled([pending]);
			const cached = this.sessions.get(piboSessionId);
			const failures: unknown[] = [];
			const closeResult = await Promise.allSettled([this.runtimeRegistry.closeControllerSessions(piboSessionId, { force: true })]);
			if (closeResult[0]?.status === "rejected") failures.push(closeResult[0].reason);
			if (cached) {
				const disposeResult = await Promise.allSettled([this.disposeRoutedSession(piboSessionId, cached, reason ?? "session reset")]);
				if (disposeResult[0]?.status === "rejected") failures.push(disposeResult[0].reason);
				if (this.sessions.get(piboSessionId) === cached) this.sessions.delete(piboSessionId);
			}
			if (failures.length > 0) throw new AggregateError(failures, `Failed to reset Pibo session "${piboSessionId}"`);
		})();
		this.disposingSessions.set(piboSessionId, operation);
		releaseStart?.();
		try {
			await operation;
		} finally {
			if (this.disposingSessions.get(piboSessionId) === operation) this.disposingSessions.delete(piboSessionId);
			await this.telemetryWriter?.flush();
		}
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
			startToolRun: ({ toolName, params, completionPolicy, retryable, maxAttempts, timeoutMs, serviceWarning, resources, execute }) => {
				const admission = this.gatewayWorkAdmission.reserve(`yielded run ${toolName}`);
				if (resources) resources.admission = admission.admission;
				const reminderGeneration = this.runReminderGeneration(parentPiboSessionId);
				let run: PiboRunSnapshot;
				try {
					run = this.runRegistry.startToolRun({
						controllerPiboSessionId: parentPiboSessionId,
						toolName,
						params,
						completionPolicy,
						retryable,
						maxAttempts,
						timeoutMs,
						serviceWarning,
						resources,
					});
				} catch (error) {
					admission.release();
					throw error;
				}

				void (async () => {
					try {
						const result = await execute();
						if (resources) this.runRegistry.updateResources(run.runId, resources);
						const completed = this.runRegistry.complete(run.runId, result);
						if (completed) this.handleTerminalRunReminder(parentPiboSessionId, completed.runId, reminderGeneration);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (resources) this.runRegistry.updateResources(run.runId, resources);
						const terminalRun = error instanceof PiboRunExecutionTimeoutError
							? this.runRegistry.timeOut(run.runId, message, error.timeoutPhase)
							: error instanceof PiboRunResourceLimitError
								? this.runRegistry.resourceLimit(run.runId, message, error.resources)
								: this.runRegistry.fail(run.runId, message);
						if (terminalRun) this.handleTerminalRunReminder(parentPiboSessionId, terminalRun.runId, reminderGeneration);
					} finally {
						admission.release();
					}
				})();

				return run;
			},
			listRuns: (options) => this.runRegistry.list(parentPiboSessionId, options),
			getRunStatus: (runId) => this.runRegistry.status(parentPiboSessionId, runId),
			waitForRun: (runId, timeoutMs) => this.runRegistry.wait(parentPiboSessionId, runId, timeoutMs),
			readRun: (runId) => {
				const run = this.runRegistry.read(parentPiboSessionId, runId);
				if (run.consumed && isTerminalRunStatus(run.status)) this.refreshQueuedRunReminders(parentPiboSessionId);
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
		const targetProfile = resolvePiboProfileNameFromRegistryOrDefault(this.pluginRegistry, subagent.targetProfile);
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

		const childProfile = createPiboProfileFromRegistryOrDefault(this.pluginRegistry, targetProfile);
		const childSession = this.sessionStore.create({
			channel: "pibo.subagents",
			kind: "subagent",
			profile: targetProfile,
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
			this.signalRegistry.project({ type: "run_removed", runId: event.runId, controllerPiboSessionId: event.controllerPiboSessionId });
			return;
		}
		this.signalRegistry.project({ type: "run_changed", run: event.run, previousStatus: "previousStatus" in event ? event.previousStatus : undefined, reason: "reason" in event ? event.reason : event.type });
	}

	private runReminderGeneration(piboSessionId: string): number {
		return this.runReminderGenerations.get(piboSessionId) ?? 0;
	}

	private invalidateRunReminders(piboSessionIds: readonly string[]): void {
		for (const piboSessionId of piboSessionIds) {
			this.runReminderGenerations.set(piboSessionId, this.runReminderGeneration(piboSessionId) + 1);
			this.scheduledRunReminders.delete(piboSessionId);
			try {
				this.sessions.get(piboSessionId)?.removeQueuedMessages(isRunReminderServiceMessage);
			} catch {
				// A concurrently disposed RoutedSession is already quiescent.
			}
			this.runRegistry.suppressControllerNotifications(piboSessionId);
		}
	}

	private beginSessionQuiescence(piboSessionIds: readonly string[]): void {
		this.invalidateRunReminders(piboSessionIds);
		for (const piboSessionId of piboSessionIds) {
			this.quiescingSessions.add(piboSessionId);
			this.clearIdleSessionTimer(piboSessionId);
		}
	}

	private handleTerminalRunReminder(piboSessionId: string, runId: string, generation: number): void {
		if (generation !== this.runReminderGeneration(piboSessionId) || this.quiescingSessions.has(piboSessionId) || this.closing) {
			this.runRegistry.suppressNotification(piboSessionId, runId);
			return;
		}
		this.scheduleRunReminder(piboSessionId, false, generation);
	}

	private scheduleRunReminder(piboSessionId: string, includeAlreadyNotified: boolean, expectedGeneration = this.runReminderGeneration(piboSessionId)): void {
		if (this.closing || this.quiescingSessions.has(piboSessionId)) return;
		if (expectedGeneration !== this.runReminderGeneration(piboSessionId)) return;
		if (!this.runRegistry.hasPendingNotification(piboSessionId, { includeAlreadyNotified })) return;
		const previous = this.scheduledRunReminders.get(piboSessionId);
		if (previous?.generation === expectedGeneration) {
			this.scheduledRunReminders.set(piboSessionId, {
				generation: expectedGeneration,
				includeAlreadyNotified: previous.includeAlreadyNotified || includeAlreadyNotified,
			});
			return;
		}

		this.scheduledRunReminders.set(piboSessionId, { generation: expectedGeneration, includeAlreadyNotified });
		queueMicrotask(() => {
			void this.deliverRunReminder(piboSessionId, expectedGeneration);
		});
	}

	private refreshQueuedRunReminders(piboSessionId: string): void {
		const removed = this.sessions.get(piboSessionId)?.removeQueuedMessages(isRunReminderServiceMessage) ?? 0;
		if (removed > 0) this.scheduleRunReminder(piboSessionId, true);
	}

	private async deliverRunReminder(piboSessionId: string, expectedGeneration: number): Promise<void> {
		const scheduled = this.scheduledRunReminders.get(piboSessionId);
		if (!scheduled || scheduled.generation !== expectedGeneration) return;
		this.scheduledRunReminders.delete(piboSessionId);
		if (this.closing || this.quiescingSessions.has(piboSessionId) || expectedGeneration !== this.runReminderGeneration(piboSessionId)) return;
		const notification = this.runRegistry.createNotification(piboSessionId, { includeAlreadyNotified: scheduled.includeAlreadyNotified });
		if (!notification) return;

		try {
			const session = await this.getOrCreateSession(piboSessionId);
			if (this.closing || this.quiescingSessions.has(piboSessionId) || expectedGeneration !== this.runReminderGeneration(piboSessionId)) return;
			session.enqueueMessage({
				type: "message",
				piboSessionId,
				text: formatRunReminderMessage(notification),
				source: "service",
				capabilityScope: "run-reminder",
				id: randomUUID(),
			});
		} catch (error) {
			if (this.closing || this.quiescingSessions.has(piboSessionId) || expectedGeneration !== this.runReminderGeneration(piboSessionId)) return;
			const message = error instanceof Error ? error.message : String(error);
			this.emitOutput({
				type: "session_error",
				piboSessionId,
				error: message,
				errorDetails: runtimeSessionErrorDetails(message),
			});
		}
	}
}
