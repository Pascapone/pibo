import { randomUUID } from "node:crypto";
import {
	InitialSessionContext,
	type InitialSessionContextOptions,
	type ModelProfile,
	type SubagentProfile,
} from "./profiles.js";
import { createDefaultPiboPluginRegistry, createPiboProfileFromRegistryOrDefault, resolvePiboProfileNameFromRegistryOrDefault, selectDefaultPiboProfileName } from "../plugins/builtin.js";
import type { PiboPluginRegistry } from "../plugins/registry.js";
import type { PiboRuntimeOptions, PiboRuntimeRetryDefaults } from "./runtime.js";
import {
	RuntimeRoutedSession as RoutedSession,
	type PiboMessagePreflight,
} from "../agent-runtime/routed-session.js";
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
import {
	createLegacyPiRuntimeSessionBinding,
	RuntimeSessionBindingConflictError,
	type CreateRuntimeSessionBindingInput,
	type RuntimeSessionBinding,
	type RuntimeSessionBindingRebindInput,
	type RuntimeSessionBindingUpdateOptions,
} from "../sessions/runtime-binding.js";
import { AgentRuntimeBindingMissingError, AgentRuntimeUnavailableError } from "../agent-runtime/errors.js";
import type {
	AgentRuntimeAuthStatus,
	AgentRuntimeAuthTargetOperationResult,
	AgentRuntimeSession,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	StartAgentRuntimeAuthInput,
} from "../agent-runtime/types.js";
import { validateAgentRuntimeProfileCapabilities } from "../agent-runtime/profile-validation.js";
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
import type { PayloadStore } from "../data/payload-store.js";
import { createPiboToolPayloadWriter } from "../tools/payload-writer.js";
import {
	PiboPortableToolService,
	type PiboPortableToolSession,
} from "../tools/session-service.js";
import {
	PiboRuntimeResourceService,
} from "../agent-runtime/resource-service.js";
import type { PiboRuntimeResourceSession } from "../agent-runtime/resources.js";
import {
	PORTABLE_HISTORY_HANDOFF_METADATA_KEY,
	PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY,
	PiboDataPortableHistoryProvider,
	createPortableHistoryHandoffMetadata,
	readPortableHistoryHandoffMetadata,
	withoutPortableHistoryHandoffMetadata,
	withPortableHistoryHandoffMetadata,
	type AgentRuntimeHistoryHandoff,
	type AgentRuntimePortableHistoryProvider,
} from "../agent-runtime/portable-history.js";
import type { PiboDataStore } from "../data/pibo-store.js";

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

export type PiboRuntimeBindingRebindInput = RuntimeSessionBindingRebindInput;

export type PiboSessionRouterOptions = Omit<
	PiboRuntimeOptions,
	"profile" | "subagentRunner" | "runToolController" | "resources"
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
	/** Optional resource service override for isolated adapter generation state. */
	runtimeResourceService?: PiboRuntimeResourceService;
	/** Portable product-history source used for cross-runtime rebind handoff. */
	portableHistoryProvider?: AgentRuntimePortableHistoryProvider;
};

const DEFAULT_SUBAGENT_REPLY_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_SUBAGENT_MAX_DEPTH = 3;
const MAX_SUBAGENT_THREAD_KEY_BYTES = 512;
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

function hasReachedSubagentMaxDepth(subagent: SubagentProfile, depth: number): boolean {
	return depth >= (subagent.maxDepth ?? DEFAULT_SUBAGENT_MAX_DEPTH);
}

function resolveSubagentThreadKey(threadKey: string | undefined): string {
	const normalized = threadKey?.trim();
	if (!normalized) return randomUUID();
	if (Buffer.byteLength(normalized, "utf8") > MAX_SUBAGENT_THREAD_KEY_BYTES) {
		throw new Error(`Subagent thread key exceeds ${MAX_SUBAGENT_THREAD_KEY_BYTES} bytes.`);
	}
	return normalized;
}

function subagentAbortError(): Error {
	const error = new Error("Subagent request was aborted.");
	error.name = "AbortError";
	return error;
}

function profileForSession(
	baseProfile: InitialSessionContext,
	runtimeInstanceId: string,
	nativeSessionId: string | undefined,
	parentNativeSessionId: string | undefined,
	subagentDepth: number,
): InitialSessionContext {
	const usesProfileRuntime = baseProfile.runtimeInstanceId === runtimeInstanceId;
	const options: InitialSessionContextOptions = {
		profileName: baseProfile.profileName,
		runtimeInstanceId,
		runtimeOptions: usesProfileRuntime ? baseProfile.runtimeOptions : {},
		sessionId: nativeSessionId,
		parentSessionId: parentNativeSessionId,
		model: usesProfileRuntime ? baseProfile.model : undefined,
		mainModel: usesProfileRuntime ? baseProfile.mainModel : undefined,
		subagentModel: usesProfileRuntime ? baseProfile.subagentModel : undefined,
		thinkingLevel: baseProfile.thinkingLevel,
		mainThinkingLevel: baseProfile.mainThinkingLevel,
		subagentThinkingLevel: baseProfile.subagentThinkingLevel,
		fast: baseProfile.fast,
		mainFast: baseProfile.mainFast,
		subagentFast: baseProfile.subagentFast,
		skills: baseProfile.skills,
		tools: baseProfile.tools,
		subagents: baseProfile.subagents.filter((subagent) => !hasReachedSubagentMaxDepth(subagent, subagentDepth)),
		mcpServers: baseProfile.mcpServers,
		contextFiles: baseProfile.contextFiles,
		piPackages: baseProfile.piPackages,
		builtinTools: baseProfile.builtinTools,
		builtinToolNames: baseProfile.builtinToolNames,
		autoContextFiles: baseProfile.autoContextFiles,
		nativeSubagents: usesProfileRuntime ? baseProfile.nativeSubagents : undefined,
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

function shouldResetSessionAfterAction(action: string, output?: PiboOutputEvent): boolean {
	if (action === "login.apikey" || action === "logout") return true;
	if (action !== "login.complete") return false;
	const result = output?.type === "execution_result" && output.result && typeof output.result === "object" && !Array.isArray(output.result)
		? output.result as Record<string, unknown>
		: undefined;
	return result?.state !== "pending";
}

function piboRoomIdFromMetadata(metadata: PiboJsonObject | undefined): string | undefined {
	const value = metadata?.chatRoomId;
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function runtimeBindingsEqual(left: RuntimeSessionBinding, right: RuntimeSessionBinding): boolean {
	return left.piboSessionId === right.piboSessionId
		&& left.runtimeInstanceId === right.runtimeInstanceId
		&& left.adapterId === right.adapterId
		&& left.nativeSessionId === right.nativeSessionId
		&& left.state === right.state
		&& left.protocol === right.protocol
		&& left.protocolVersion === right.protocolVersion
		&& left.adapterVersion === right.adapterVersion
		&& JSON.stringify(left.locator ?? null) === JSON.stringify(right.locator ?? null)
		&& JSON.stringify(left.metadata ?? {}) === JSON.stringify(right.metadata ?? {});
}

function withPersistedPortableHistoryAuditMetadata(
	persisted: RuntimeSessionBinding,
	live: RuntimeSessionBinding,
): RuntimeSessionBinding {
	const metadata: PiboJsonObject = { ...(live.metadata ?? {}) };
	for (const key of [PORTABLE_HISTORY_HANDOFF_METADATA_KEY, PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY]) {
		if (Object.prototype.hasOwnProperty.call(persisted.metadata ?? {}, key)) {
			metadata[key] = structuredClone(persisted.metadata![key]!);
		} else {
			delete metadata[key];
		}
	}
	return { ...live, metadata };
}

type TelemetrySessionStore = PiboSessionStore & { getTelemetryStore?: () => TelemetryStore | undefined };
type PayloadSessionStore = PiboSessionStore & { getPayloadStore?: () => PayloadStore | undefined };
type DataSessionStore = PiboSessionStore & { getDataStore?: () => PiboDataStore | undefined };

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

function payloadStoreFromSessionStore(store: PiboSessionStore): PayloadStore | undefined {
	return (store as PayloadSessionStore).getPayloadStore?.();
}

function portableHistoryProviderFromSessionStore(store: PiboSessionStore): AgentRuntimePortableHistoryProvider | undefined {
	const dataStore = (store as DataSessionStore).getDataStore?.();
	return dataStore ? new PiboDataPortableHistoryProvider(dataStore) : undefined;
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
	private readonly portableToolService: PiboPortableToolService;
	private readonly portableToolSessions = new Map<string, PiboPortableToolSession>();
	private readonly runtimeResourceService: PiboRuntimeResourceService;
	private readonly portableHistoryProvider?: AgentRuntimePortableHistoryProvider;
	private readonly runtimeResourceSessions = new Map<string, PiboRuntimeResourceSession>();
	private readonly runtimeAuthFingerprints = new Map<string, string>();
	private readonly activeSubagentChildren = new Map<string, Map<string, number>>();
	private readonly scheduledRunReminders = new Map<string, ScheduledRunReminder>();
	private readonly runReminderGenerations = new Map<string, number>();
	private readonly quiescingSessions = new Set<string>();
	private readonly disposingSessions = new Map<string, Promise<void>>();
	private readonly idleSessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly routedSessionIdleTimeoutMs: number | false;
	private readonly routedSessionDisposeTimeoutMs: number;
	private readonly baseProfile: InitialSessionContext;
	private readonly pluginRegistry: PiboPluginRegistry;
	private readonly compatibilityRuntimeRegistry?: PiboPluginRegistry;
	private readonly sessionStore: PiboSessionStore;
	private readonly reliabilityStore?: PiboReliabilityStore;
	private readonly telemetryStore?: TelemetryStore;
	private readonly telemetryWriter?: AsyncTelemetryWriter;
	private readonly telemetryRecorder?: PiboRuntimeTelemetryRecorder;
	private disposePromise?: Promise<void>;
	private closing = false;

	constructor(private readonly options: PiboSessionRouterOptions = {}) {
		this.pluginRegistry = options.pluginRegistry ?? createDefaultPiboPluginRegistry();
		// Historical custom registries supplied only actions/profiles while runtime creation was implicit.
		// Preserve that composition contract during the adapter migration without branching on adapter ids.
		this.compatibilityRuntimeRegistry = options.pluginRegistry ? createDefaultPiboPluginRegistry() : undefined;
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
		const payloadStore = payloadStoreFromSessionStore(this.sessionStore);
		this.portableToolService = new PiboPortableToolService({
			...(payloadStore ? { payloadWriter: createPiboToolPayloadWriter(payloadStore) } : {}),
		});
		this.runtimeResourceService = options.runtimeResourceService ?? new PiboRuntimeResourceService();
		this.portableHistoryProvider = options.portableHistoryProvider ?? portableHistoryProviderFromSessionStore(this.sessionStore);
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
			if (!teardownAction && this.quiescingSessions.has(event.piboSessionId)) {
				throw new Error(`Pibo session "${event.piboSessionId}" is quiescing.`);
			}
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

			const childAbort = event.action === "abort"
				? this.abortActiveSubagentSessions(event.piboSessionId)
				: undefined;
			const output = await session.executeAction(event);
			await childAbort;
			if (event.action === "kill" || event.action === "kill_all") {
				await this.disposeSessionSubtree(event.piboSessionId, `${event.action} action`, { cancelRuns: event.action === "kill_all" });
				teardownCompleted = true;
			} else if (shouldResetSessionAfterAction(event.action, output)) {
				const runtimeInstanceId = this.getSessionRuntimeBinding(event.piboSessionId)?.runtimeInstanceId;
				if (runtimeInstanceId) {
					await this.resetCachedRuntimeAuthSessions(runtimeInstanceId, "runtime provider auth changed");
				} else {
					await this.resetCachedSession(event.piboSessionId, "runtime provider auth changed");
				}
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

	async disposeSession(piboSessionId: string, reason = "session deleted"): Promise<void> {
		await this.disposeSessionSubtree(piboSessionId, reason, { cancelRuns: true });
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
			const portableTools = this.portableToolSessions.get(piboSessionId);
			portableTools?.dispose();
			if (this.portableToolSessions.get(piboSessionId) === portableTools) this.portableToolSessions.delete(piboSessionId);
			const resources = this.runtimeResourceSessions.get(piboSessionId);
			if (resources) await resources.dispose();
			if (this.runtimeResourceSessions.get(piboSessionId) === resources) this.runtimeResourceSessions.delete(piboSessionId);
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

	async getAgentRuntimeAuthStatus(runtimeInstanceId: string): Promise<readonly AgentRuntimeAuthStatus[]> {
		const registry = this.resolveAgentRuntimeRegistry(runtimeInstanceId);
		const statuses = await registry.getAgentRuntimeAuthStatus(runtimeInstanceId);
		const fingerprint = statuses
			.map((status) => `${status.id}:${status.configured}:${status.details?.accountType ?? ""}:${status.details?.planType ?? ""}`)
			.sort()
			.join("|");
		const previous = this.runtimeAuthFingerprints.get(runtimeInstanceId);
		this.runtimeAuthFingerprints.set(runtimeInstanceId, fingerprint);
		if (previous !== undefined && previous !== fingerprint) {
			await this.resetCachedRuntimeAuthSessions(runtimeInstanceId, "runtime provider auth changed");
		}
		return statuses;
	}

	async startAgentRuntimeAuth(
		runtimeInstanceId: string,
		input: StartAgentRuntimeAuthInput,
	): Promise<AgentRuntimeAuthTargetOperationResult> {
		const registry = this.resolveAgentRuntimeRegistry(runtimeInstanceId);
		const result = await registry.startAgentRuntimeAuth(runtimeInstanceId, input);
		if (result.state !== "pending") {
			await this.resetCachedRuntimeAuthSessions(runtimeInstanceId, "runtime provider auth changed");
		}
		return result;
	}

	async completeAgentRuntimeAuth(
		runtimeInstanceId: string,
		input: CompleteAgentRuntimeAuthInput,
	): Promise<AgentRuntimeAuthTargetOperationResult> {
		const registry = this.resolveAgentRuntimeRegistry(runtimeInstanceId);
		const result = await registry.completeAgentRuntimeAuth(runtimeInstanceId, input);
		if (result.state !== "pending") {
			await this.resetCachedRuntimeAuthSessions(runtimeInstanceId, "runtime provider auth changed");
		}
		return result;
	}

	async cancelAgentRuntimeAuth(
		runtimeInstanceId: string,
		input: CancelAgentRuntimeAuthInput,
	): Promise<AgentRuntimeAuthTargetOperationResult> {
		return await this.resolveAgentRuntimeRegistry(runtimeInstanceId)
			.cancelAgentRuntimeAuth(runtimeInstanceId, input);
	}

	async logoutAgentRuntimeAuth(
		runtimeInstanceId: string,
		input: LogoutAgentRuntimeAuthInput,
	): Promise<AgentRuntimeAuthTargetOperationResult> {
		const result = await this.resolveAgentRuntimeRegistry(runtimeInstanceId)
			.logoutAgentRuntimeAuth(runtimeInstanceId, input);
		await this.resetCachedRuntimeAuthSessions(runtimeInstanceId, "runtime provider auth changed");
		return result;
	}

	getSessionRuntimeBinding(piboSessionId: string): RuntimeSessionBinding | undefined {
		const session = this.sessionStore.get(piboSessionId);
		return session ? structuredClone(this.resolveSessionRuntimeBinding(session)) : undefined;
	}

	async rebindSessionRuntime(
		piboSessionId: string,
		input: PiboRuntimeBindingRebindInput,
	): Promise<RuntimeSessionBinding> {
		if (this.quiescingSessions.has(piboSessionId)) {
			throw new Error(`Pibo session "${piboSessionId}" is already quiescing.`);
		}
		this.quiescingSessions.add(piboSessionId);
		this.clearIdleSessionTimer(piboSessionId);
		try {
			return await this.rebindSessionRuntimeQuiesced(piboSessionId, input);
		} finally {
			this.quiescingSessions.delete(piboSessionId);
			this.scheduleIdleSessionEvictionIfIdle(piboSessionId);
		}
	}

	private async rebindSessionRuntimeQuiesced(
		piboSessionId: string,
		input: PiboRuntimeBindingRebindInput,
	): Promise<RuntimeSessionBinding> {
		const session = this.sessionStore.get(piboSessionId);
		if (!session) throw new Error(`Unknown Pibo session "${piboSessionId}".`);
		const current = this.resolveSessionRuntimeBinding(session);
		const currentRevision = current.revision ?? 1;
		if (currentRevision !== input.expectedRevision) {
			throw new RuntimeSessionBindingConflictError(piboSessionId, input.expectedRevision, currentRevision);
		}
		const liveStatus = this.sessions.get(piboSessionId)?.getStatus();
		if (liveStatus && (liveStatus.processing || liveStatus.streaming || liveStatus.queuedMessages > 0)) {
			throw new Error("A runtime binding can only be repaired or rebound while the session is idle.");
		}
		const registry = this.resolveAgentRuntimeRegistry(input.runtimeInstanceId);
		const adapter = registry.requireAgentRuntimeAdapter(input.runtimeInstanceId);
		const switchingRuntime = current.runtimeInstanceId !== input.runtimeInstanceId
			|| current.adapterId !== adapter.descriptor.id;
		const startsNewNativeSession = switchingRuntime || input.startFresh === true;
		const portableHistoryProvider = this.portableHistoryProvider;
		if (startsNewNativeSession && (input.nativeSessionId || input.state === "bound" || input.locator)) {
			throw new Error("Runtime switches create a new native session; nativeSessionId, bound state, and locator are not accepted.");
		}
		if (switchingRuntime && input.startFresh !== true) {
			if (!adapter.descriptor.capabilities.historyImport) {
				throw new Error(`Runtime instance "${input.runtimeInstanceId}" cannot import portable history. Retry with startFresh: true to discard prior context explicitly.`);
			}
			if (!portableHistoryProvider) {
				throw new Error("Portable Pibo history is unavailable for this session store. Retry with startFresh: true to discard prior context explicitly.");
			}
		}
		const workspace = session.workspace ?? this.options.cwd ?? getDefaultPiboWorkspace();
		const baseProfile = createPiboProfileFromRegistryOrDefault(this.pluginRegistry, session.profile);
		const targetProfile = profileForSession(
			baseProfile,
			input.runtimeInstanceId,
			startsNewNativeSession ? undefined : input.nativeSessionId,
			undefined,
			this.getSubagentDepth(session.id),
		);
		const targetDiagnostics = await adapter.diagnose();
		const unavailableTarget = targetDiagnostics.find((diagnostic) => diagnostic.severity === "error");
		if (unavailableTarget) {
			throw new Error(`Runtime target preflight failed: ${unavailableTarget.message}`);
		}
		const profileDiagnostics = [
			...validateAgentRuntimeProfileCapabilities(targetProfile, adapter.descriptor.capabilities),
			...adapter.validateProfile({ profile: targetProfile, workspace }),
		];
		const invalidProfile = profileDiagnostics.find((diagnostic) => diagnostic.severity === "error");
		if (invalidProfile) throw new Error(`Runtime profile validation failed: ${invalidProfile.message}`);
		let handoffMetadata: ReturnType<typeof createPortableHistoryHandoffMetadata> | undefined;
		if (switchingRuntime && input.startFresh !== true) {
			handoffMetadata = createPortableHistoryHandoffMetadata({
				mode: "import",
				sourceBinding: current,
				targetBinding: {
					runtimeInstanceId: input.runtimeInstanceId,
					adapterId: adapter.descriptor.id,
				},
				checkpoint: portableHistoryProvider!.createCheckpoint(piboSessionId),
			});
		} else if (input.startFresh === true) {
			handoffMetadata = createPortableHistoryHandoffMetadata({
				mode: "fresh",
				sourceBinding: current,
				targetBinding: {
					runtimeInstanceId: input.runtimeInstanceId,
					adapterId: adapter.descriptor.id,
				},
			});
		}
		if (this.sessions.has(piboSessionId) || this.pendingSessions.has(piboSessionId)) {
			await this.resetCachedSession(piboSessionId, "runtime binding rebind");
		}
		const requestedState = startsNewNativeSession
			? "unbound"
			: input.state ?? (input.nativeSessionId ? "bound" : "unbound");
		let next: RuntimeSessionBinding = {
			piboSessionId,
			runtimeInstanceId: input.runtimeInstanceId,
			adapterId: adapter.descriptor.id,
			nativeSessionId: startsNewNativeSession ? undefined : input.nativeSessionId,
			state: requestedState,
			protocol: adapter.descriptor.protocol?.name,
			protocolVersion: current.runtimeInstanceId === input.runtimeInstanceId ? current.protocolVersion : undefined,
			locator: startsNewNativeSession ? undefined : input.locator,
			metadata: handoffMetadata
				? withPortableHistoryHandoffMetadata({}, handoffMetadata)
				: {},
		};
		if (next.state === "bound" && adapter.resolveBinding) {
			next = await adapter.resolveBinding({ binding: next, workspace });
		}
		const mode = (current.state === "missing" || current.state === "error")
			&& current.runtimeInstanceId === next.runtimeInstanceId
			&& current.adapterId === next.adapterId
			&& input.startFresh !== true
			? "repair"
			: "rebind";
		const persisted = this.persistSessionRuntimeBinding(session, next, {
			expectedRevision: input.expectedRevision,
			mode,
		});
		if (switchingRuntime) this.sessionStore.update(piboSessionId, { activeModel: null });
		return structuredClone(persisted);
	}

	getSessionRuntimeStatus(piboSessionId: string): PiboSessionStatus | undefined {
		const status = this.sessions.get(piboSessionId)?.getStatus();
		return status ? this.withPersistedRuntimeBinding(status) : undefined;
	}

	async getSessionStatusSnapshot(piboSessionId: string): Promise<PiboSessionStatus> {
		const session = await this.getOrCreateSession(piboSessionId);
		try {
			return this.withPersistedRuntimeBinding(await session.getStatusSnapshot());
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
		return [...this.sessions.values()].map((session) => this.withPersistedRuntimeBinding(session.getStatus()));
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
		signal?: AbortSignal,
	): Promise<PiboAssistantMessageEvent> {
		const eventWithId: PiboMessageEvent = { ...event, id: event.id ?? randomUUID() };

		return await new Promise<PiboAssistantMessageEvent>((resolve, reject) => {
			let settled = false;
			let messageDispatched = false;
			let lastAssistantMessage: PiboAssistantMessageEvent | undefined;
			let timeout: NodeJS.Timeout | undefined;
			const abortChild = () => {
				if (!messageDispatched) return;
				void this.emit({
					type: "execution",
					piboSessionId: eventWithId.piboSessionId,
					action: "abort",
					id: randomUUID(),
				}).catch(() => {});
			};
			const finish = (result: PiboAssistantMessageEvent | Error): boolean => {
				if (settled) return false;
				settled = true;
				if (timeout) clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
				unsubscribe();
				if (result instanceof Error) reject(result);
				else resolve(result);
				return true;
			};
			const onAbort = () => {
				if (!finish(subagentAbortError())) return;
				abortChild();
			};
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

			if (signal?.aborted) {
				onAbort();
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			timeout = setTimeout(() => {
				const timeoutError = new Error(`Timed out waiting for assistant reply from Pibo session "${eventWithId.piboSessionId}"`);
				if (!finish(timeoutError)) return;
				abortChild();
			}, timeoutMs);

			messageDispatched = true;
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
			const authDisposals = await Promise.allSettled([
				this.pluginRegistry.disposeAgentRuntimeAuth(),
				...(this.compatibilityRuntimeRegistry ? [this.compatibilityRuntimeRegistry.disposeAgentRuntimeAuth()] : []),
			]);
			await this.portableToolService.dispose();
			await this.runtimeResourceService.dispose();
			this.runtimeResourceSessions.clear();
			this.activeSubagentChildren.clear();
			await this.telemetryWriter?.dispose();
			const authFailures = authDisposals.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
			if (authFailures.length > 0) throw new AggregateError(authFailures, "Failed to dispose runtime authentication controllers.");
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
		let binding = this.resolveSessionRuntimeBinding(piboSession);
		const parent = piboSession.parentId ? this.resolvePiboSession(piboSession.parentId) : undefined;
		const parentBinding = parent ? this.resolveSessionRuntimeBinding(parent) : undefined;
		const parentModelScopeId = parent ? parentBinding?.nativeSessionId ?? parent.id : undefined;
		const runtimeParentNativeSessionId = parentBinding
			&& parentBinding.runtimeInstanceId === binding.runtimeInstanceId
			&& parentBinding.adapterId === binding.adapterId
			? parentBinding.nativeSessionId
			: undefined;
		const modelDefaults = this.resolveModelDefaults();
		const initialThinkingLevel = resolvePiboSessionInitialThinkingLevel(piboSession);
		const sessionProfile = profileForSession(
			profile,
			binding.runtimeInstanceId,
			binding.nativeSessionId,
			runtimeParentNativeSessionId,
			this.getSubagentDepth(piboSession.id),
		);
		const persistedHistoryHandoff = readPortableHistoryHandoffMetadata(binding.metadata);
		if (binding.metadata?.[PORTABLE_HISTORY_HANDOFF_METADATA_KEY] !== undefined && !persistedHistoryHandoff) {
			throw new Error("The pending portable history handoff metadata is invalid; refusing to start a contextless target runtime.");
		}
		if (persistedHistoryHandoff
			&& (persistedHistoryHandoff.targetRuntimeInstanceId !== binding.runtimeInstanceId
				|| persistedHistoryHandoff.targetAdapterId !== binding.adapterId)) {
			throw new Error("The pending portable history handoff targets a different runtime binding; refusing to import it.");
		}
		const changesRuntimeModelNamespace = Boolean(persistedHistoryHandoff
			&& (persistedHistoryHandoff.sourceRuntimeInstanceId !== binding.runtimeInstanceId
				|| persistedHistoryHandoff.sourceAdapterId !== binding.adapterId));
		const activeModel = changesRuntimeModelNamespace
			? undefined
			: this.ensureSessionActiveModel(piboSession, sessionProfile, parentModelScopeId, modelDefaults);
		const userSettings = loadPiboUserSettings();
		const telemetryExtension = this.telemetryStore
			? createPiboProviderTelemetryExtension({ store: this.telemetryStore, writer: this.telemetryWriter, session: piboSession, model: activeModel })
			: undefined;
		const runtimeRegistry = this.resolveAgentRuntimeRegistry(binding.runtimeInstanceId);
		const runtimeAdapter = runtimeRegistry.requireAgentRuntimeAdapter(binding.runtimeInstanceId);
		if (runtimeAdapter.descriptor.id !== binding.adapterId) {
			throw new AgentRuntimeUnavailableError(
				binding.runtimeInstanceId,
				`Runtime binding for Pibo session "${piboSession.id}" expects adapter "${binding.adapterId}", but instance "${binding.runtimeInstanceId}" uses "${runtimeAdapter.descriptor.id}".`,
			);
		}
		const workspace = piboSession.workspace ?? this.options.cwd ?? getDefaultPiboWorkspace();
		if (binding.state === "bound" && runtimeAdapter.resolveBinding) {
			const resolved = await runtimeAdapter.resolveBinding({ binding, workspace });
			if (!runtimeBindingsEqual(binding, resolved)) {
				binding = this.persistSessionRuntimeBinding(piboSession, resolved, {
					expectedRevision: binding.revision,
				});
			}
		}
		this.assertOpenableRuntimeBinding(binding);
		const profileDiagnostics = [
			...validateAgentRuntimeProfileCapabilities(sessionProfile, runtimeAdapter.descriptor.capabilities),
			...runtimeAdapter.validateProfile({
				profile: sessionProfile,
				workspace,
			}),
		];
		const invalidProfile = profileDiagnostics.find((diagnostic) => diagnostic.severity === "error");
		if (invalidProfile) {
			throw new Error(`Runtime profile validation failed: ${invalidProfile.message}`);
		}
		let historyHandoff: AgentRuntimeHistoryHandoff | undefined;
		if (persistedHistoryHandoff?.mode === "import") {
			if (!runtimeAdapter.descriptor.capabilities.historyImport) {
				throw new Error(`Runtime instance "${binding.runtimeInstanceId}" no longer supports portable history import.`);
			}
			if (!this.portableHistoryProvider || !persistedHistoryHandoff.checkpoint) {
				throw new Error("Portable Pibo history is unavailable for the pending runtime switch.");
			}
			historyHandoff = {
				mode: "import",
				history: this.portableHistoryProvider.read({
					piboSession,
					sourceBinding: {
						runtimeInstanceId: persistedHistoryHandoff.sourceRuntimeInstanceId,
						adapterId: persistedHistoryHandoff.sourceAdapterId,
					},
					checkpoint: persistedHistoryHandoff.checkpoint,
				}),
			};
		} else if (persistedHistoryHandoff?.mode === "fresh") {
			historyHandoff = { mode: "fresh" };
		}
		const initialFastMode = resolvePiboSessionInitialFastMode(piboSession) ?? selectRequestedFastMode(sessionProfile, modelDefaults) ?? false;
		const subagentRunner = this.createSubagentRunner(piboSession.id);
		const runToolController = this.createRunToolController(piboSession.id);
		const codeRuntimeToolController = this.runtimeRegistry.createController(piboSession.id);
		const sessionGeneration = randomUUID();
		const previousResources = this.runtimeResourceSessions.get(piboSession.id);
		if (previousResources) await previousResources.dispose();
		this.portableToolSessions.get(piboSession.id)?.dispose();
		const portableTools = this.portableToolService.createSession({
			piboSessionId: piboSession.id,
			piboRoomId: piboRoomIdFromMetadata(piboSession.metadata),
			runtimeInstanceId: binding.runtimeInstanceId,
			adapterId: binding.adapterId,
			sessionGeneration,
			profile: sessionProfile,
			cwd: workspace,
			getActiveMessage: () => session?.getActiveMessage(),
			subagentRunner,
			runToolController,
			runtimeToolController: codeRuntimeToolController,
		});
		this.portableToolSessions.set(piboSession.id, portableTools);
		let resources: PiboRuntimeResourceSession;
		try {
			resources = await this.runtimeResourceService.createSession({
				piboSessionId: piboSession.id,
				piboRoomId: piboRoomIdFromMetadata(piboSession.metadata),
				runtimeInstanceId: binding.runtimeInstanceId,
				adapterId: binding.adapterId,
				sessionGeneration,
				profile: sessionProfile,
				cwd: workspace,
				timezone: userSettings.timezone,
				capabilities: runtimeAdapter.descriptor.capabilities,
			});
			this.runtimeResourceSessions.set(piboSession.id, resources);
		} catch (error) {
			portableTools.dispose();
			if (this.portableToolSessions.get(piboSession.id) === portableTools) this.portableToolSessions.delete(piboSession.id);
			throw error;
		}
		let runtimeSession: AgentRuntimeSession;
		try {
			runtimeSession = await runtimeRegistry.openAgentRuntimeSession(binding.runtimeInstanceId, {
				piboSession: {
					...piboSession,
					...(changesRuntimeModelNamespace ? { activeModel: undefined } : {}),
					runtimeBinding: binding,
				},
				profile: sessionProfile,
				binding,
				workspace,
				activeModel,
				historyHandoff,
				productContext: {
					piboSessionId: piboSession.id,
					piboRoomId: piboRoomIdFromMetadata(piboSession.metadata),
					timezone: userSettings.timezone,
					getActiveMessage: () => session?.getActiveMessage(),
				},
				services: {
					subagentRunner,
					runToolController,
					codeRuntimeToolController,
					portableTools,
					resources,
					compatibility: {
						persistSession: this.options.persistSession,
						thinkingLevel: initialThinkingLevel ?? this.options.thinkingLevel,
						retryDefaults: resolvePiboSessionRetryDefaults(piboSession.kind, this.options.retryDefaults),
						extensionFactories: [
							...(telemetryExtension ? [telemetryExtension] : []),
							...(this.options.extensionFactories ?? []),
						],
						modelDefaults,
						initialFastMode,
					},
				},
			});
		} catch (error) {
			portableTools.dispose();
			if (this.portableToolSessions.get(piboSession.id) === portableTools) this.portableToolSessions.delete(piboSession.id);
			await resources.dispose();
			if (this.runtimeResourceSessions.get(piboSession.id) === resources) this.runtimeResourceSessions.delete(piboSession.id);
			if (error instanceof AgentRuntimeBindingMissingError && binding.state === "bound") {
				this.persistSessionRuntimeBinding(piboSession, {
					...binding,
					state: "missing",
					metadata: {
						...(binding.metadata ?? {}),
						diagnosticCode: "runtime_binding_missing",
						diagnosticMessage: "The bound native session is no longer available in the configured runtime instance.",
					},
				}, {
					expectedRevision: binding.revision,
				});
			}
			throw error;
		}
		try {
			let openedBinding = runtimeSession.getBinding();
			if (openedBinding.runtimeInstanceId !== binding.runtimeInstanceId || openedBinding.adapterId !== binding.adapterId) {
				throw new AgentRuntimeUnavailableError(
					binding.runtimeInstanceId,
					`Runtime instance "${binding.runtimeInstanceId}" opened an inconsistent binding for Pibo session "${piboSession.id}".`,
				);
			}
			if (persistedHistoryHandoff) {
				openedBinding = {
					...openedBinding,
					metadata: withoutPortableHistoryHandoffMetadata({
						metadata: openedBinding.metadata,
						handoff: persistedHistoryHandoff,
						history: historyHandoff?.mode === "import" ? historyHandoff.history : undefined,
					}),
				};
			}
			if (changesRuntimeModelNamespace) {
				this.sessionStore.update(piboSession.id, {
					activeModel: runtimeSession.getStatus().activeModel ?? null,
				});
			}
			if (!runtimeBindingsEqual(binding, openedBinding)) {
				binding = this.persistSessionRuntimeBinding(piboSession, openedBinding, {
					expectedRevision: binding.revision,
				});
			}
		} catch (error) {
			await runtimeSession.dispose().catch(() => {});
			portableTools.dispose();
			if (this.portableToolSessions.get(piboSession.id) === portableTools) this.portableToolSessions.delete(piboSession.id);
			await resources.dispose();
			if (this.runtimeResourceSessions.get(piboSession.id) === resources) this.runtimeResourceSessions.delete(piboSession.id);
			throw error;
		}
		session = new RoutedSession(
			piboSession.id,
			runtimeSession,
			this.emitOutput,
			this.pluginRegistry,
			{
				forwardLegacyPiEvents: this.options.forwardPiEvents ?? false,
				onNativeEventTelemetry: this.telemetryRecorder
					? (id, event, context) => this.telemetryRecorder?.recordPiEvent(id, event, {
						session: this.sessionStore.get(id),
						status: context.status,
						activeEventId: context.activeEventId,
					})
					: undefined,
				onSessionOperation: (result, event) => this.handleSessionOperation(result, event),
				onKillChildren: (id, opts) => this.killChildSessions(id, opts),
				onStateChange: (state) => {
					this.signalRegistry.project({
						type: "session_processing_changed",
						piboSessionId: piboSession.id,
						processing: state.processing,
						queuedMessages: state.queuedMessages,
					});
					if (!state.processing && state.queuedMessages === 0 && !state.disposed) {
						this.syncLiveSessionRuntimeBinding(piboSession.id, runtimeSession);
					}
					if (state.disposed || state.processing || state.queuedMessages > 0) this.clearIdleSessionTimer(piboSession.id);
					else this.scheduleIdleSessionEvictionIfIdle(piboSession.id);
				},
				onMessagesInterrupted: (messages, reason) => this.telemetryRecorder?.recordMessagesInterrupted(messages, {
					session: this.sessionStore.get(piboSession.id),
					status: this.sessions.get(piboSession.id)?.getStatus(),
				}, reason),
				messagePreflight: this.options.messagePreflight,
				getRuntimeAuthStatus: () => runtimeRegistry.getAgentRuntimeAuthStatus(binding.runtimeInstanceId),
				startRuntimeAuth: async (input) => {
					const { runtimeInstanceId: _runtimeInstanceId, ...result } = await runtimeRegistry.startAgentRuntimeAuth(binding.runtimeInstanceId, input);
					return result;
				},
				completeRuntimeAuth: async (input) => {
					const { runtimeInstanceId: _runtimeInstanceId, ...result } = await runtimeRegistry.completeAgentRuntimeAuth(binding.runtimeInstanceId, input);
					return result;
				},
				cancelRuntimeAuth: async (input) => {
					const { runtimeInstanceId: _runtimeInstanceId, ...result } = await runtimeRegistry.cancelAgentRuntimeAuth(binding.runtimeInstanceId, input);
					return result;
				},
				logoutRuntimeAuth: async (input) => {
					const { runtimeInstanceId: _runtimeInstanceId, ...result } = await runtimeRegistry.logoutAgentRuntimeAuth(binding.runtimeInstanceId, input);
					return result;
				},
			},
		);
		this.sessions.set(piboSession.id, session);
		return session;
	}

	private resolveAgentRuntimeRegistry(instanceId: string): PiboPluginRegistry {
		if (this.pluginRegistry.getAgentRuntimeAdapter(instanceId)) return this.pluginRegistry;
		if (this.compatibilityRuntimeRegistry?.getAgentRuntimeAdapter(instanceId)) return this.compatibilityRuntimeRegistry;
		throw new Error(`Unknown agent runtime instance "${instanceId}".`);
	}

	private resolveSessionRuntimeBinding(session: PiboSession): RuntimeSessionBinding {
		return this.sessionStore.getRuntimeBinding?.(session.id)
			?? session.runtimeBinding
			?? createLegacyPiRuntimeSessionBinding(session.id, session.piSessionId, session.createdAt);
	}

	private withPersistedRuntimeBinding(status: PiboSessionStatus): PiboSessionStatus {
		const session = this.sessionStore.get(status.piboSessionId);
		if (!session) return status;
		const binding = this.resolveSessionRuntimeBinding(session);
		return {
			...status,
			runtimeBinding: {
				runtimeInstanceId: binding.runtimeInstanceId,
				adapterId: binding.adapterId,
				nativeSessionId: binding.nativeSessionId,
				state: binding.state,
				protocol: binding.protocol,
				protocolVersion: binding.protocolVersion,
				adapterVersion: binding.adapterVersion,
				revision: binding.revision,
			},
		};
	}

	private persistSessionRuntimeBinding(
		session: PiboSession,
		binding: RuntimeSessionBinding,
		options: RuntimeSessionBindingUpdateOptions = {},
	): RuntimeSessionBinding {
		const current = this.resolveSessionRuntimeBinding(session);
		const normalized: RuntimeSessionBinding = { ...structuredClone(binding), piboSessionId: session.id };
		if (runtimeBindingsEqual(current, normalized)) return current;
		const persisted = this.sessionStore.updateRuntimeBinding?.(session.id, normalized, options);
		if (persisted) {
			const updatedSession = this.sessionStore.get(session.id);
			if (updatedSession) this.signalRegistry.project({ type: "session_created", session: updatedSession });
			return persisted;
		}
		const now = new Date().toISOString();
		if (normalized.adapterId === "pi" && normalized.nativeSessionId !== session.piSessionId) {
			this.sessionStore.update(session.id, { piSessionId: normalized.nativeSessionId ?? "" });
		}
		const updatedSession = this.sessionStore.get(session.id);
		if (updatedSession) this.signalRegistry.project({ type: "session_created", session: updatedSession });
		return {
			...normalized,
			revision: (current.revision ?? 1) + 1,
			createdAt: current.createdAt ?? session.createdAt,
			updatedAt: now,
		};
	}

	private syncLiveSessionRuntimeBinding(piboSessionId: string, runtimeSession: { getBinding(): RuntimeSessionBinding }): void {
		const session = this.sessionStore.get(piboSessionId);
		if (!session) return;
		try {
			const persisted = this.resolveSessionRuntimeBinding(session);
			this.persistSessionRuntimeBinding(
				session,
				withPersistedPortableHistoryAuditMetadata(persisted, runtimeSession.getBinding()),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.emitOutput({
				type: "session_error",
				piboSessionId,
				error: `Failed to persist the live runtime binding: ${message}`,
				errorDetails: runtimeSessionErrorDetails(message),
			});
		}
	}

	private assertOpenableRuntimeBinding(binding: RuntimeSessionBinding): void {
		if (binding.state === "missing") {
			throw new AgentRuntimeBindingMissingError(
				binding.piboSessionId,
				binding.runtimeInstanceId,
				binding.nativeSessionId,
			);
		}
		if (binding.state === "error") {
			const diagnostic = typeof binding.metadata?.diagnosticMessage === "string"
				? binding.metadata.diagnosticMessage
				: "The persisted runtime binding is in an error state.";
			throw new AgentRuntimeUnavailableError(
				binding.runtimeInstanceId,
				`Runtime binding for Pibo session "${binding.piboSessionId}" cannot be opened: ${diagnostic}`,
			);
		}
	}

	private createRuntimeBindingInput(profile: InitialSessionContext): CreateRuntimeSessionBindingInput {
		const registry = this.resolveAgentRuntimeRegistry(profile.runtimeInstanceId);
		const adapter = registry.requireAgentRuntimeAdapter(profile.runtimeInstanceId);
		return {
			runtimeInstanceId: profile.runtimeInstanceId,
			adapterId: adapter.descriptor.id,
			state: "unbound",
			protocol: adapter.descriptor.protocol?.name,
		};
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
		const source = this.resolvePiboSession(event.piboSessionId);
		const previousBinding = this.resolveSessionRuntimeBinding(source);
		const liveBinding = this.sessions.get(event.piboSessionId)?.getRuntimeBinding();
		const currentBinding: RuntimeSessionBinding = {
			...previousBinding,
			...liveBinding,
			piboSessionId: source.id,
			nativeSessionId: result.current.piSessionId,
			state: "bound",
			locator: result.current.sessionFile
				? { kind: "local-file", value: result.current.sessionFile }
				: liveBinding?.locator ?? previousBinding.locator,
		};

		if (event.action === "session.fork" || event.action === "session.clone") {
			const action = event.action as "session.fork" | "session.clone";
			const created = this.createDerivedSession(result, action, currentBinding);
			result.piboSessionId = created.id;
			await this.resetCachedSession(event.piboSessionId);
			return;
		}

		this.persistSessionRuntimeBinding(source, currentBinding, {
			expectedRevision: previousBinding.revision,
			mode: "rebind",
		});
		this.sessionStore.update(event.piboSessionId, { workspace: result.current.cwd });
	}

	private createDerivedSession(
		result: PiboSessionOperationResult,
		action: "session.fork" | "session.clone",
		currentBinding: RuntimeSessionBinding,
	): PiboSession {
		const source = this.resolvePiboSession(result.piboSessionId);
		return this.sessionStore.create({
			channel: source.channel,
			kind: "branch",
			profile: source.profile,
			parentId: source.kind === "subagent" ? source.parentId : undefined,
			originId: source.id,
			runtimeBinding: {
				runtimeInstanceId: currentBinding.runtimeInstanceId,
				adapterId: currentBinding.adapterId,
				nativeSessionId: currentBinding.nativeSessionId ?? result.current.piSessionId,
				state: "bound",
				protocol: currentBinding.protocol,
				protocolVersion: currentBinding.protocolVersion,
				adapterVersion: currentBinding.adapterVersion,
				locator: currentBinding.locator,
				metadata: currentBinding.metadata,
			},
			workspace: result.current.cwd,
			title: source.title,
			activeModel: source.activeModel,
			metadata: {
				...asJsonObject(source.metadata),
				originAction: action,
				originRuntimeNativeSessionId: result.previous.piSessionId,
				...(currentBinding.adapterId === "pi" ? { originPiSessionId: result.previous.piSessionId } : {}),
			},
		});
	}

	private runtimeAuthAffectedInstanceIds(runtimeInstanceId: string): string[] {
		const registry = this.resolveAgentRuntimeRegistry(runtimeInstanceId);
		const target = registry.requireAgentRuntimeAdapter(runtimeInstanceId);
		if (target.descriptor.capabilities.auth.credentialScope === "runtime-instance") return [runtimeInstanceId];
		return registry.getAgentRuntimeInstanceIds().filter((candidateId) => {
			const candidate = registry.getAgentRuntimeAdapter(candidateId);
			return candidate?.descriptor.id === target.descriptor.id
				&& candidate.descriptor.capabilities.auth.credentialScope === "adapter-shared";
		});
	}

	private async resetCachedRuntimeAuthSessions(runtimeInstanceId: string, reason: string): Promise<void> {
		const affectedInstanceIds = new Set(this.runtimeAuthAffectedInstanceIds(runtimeInstanceId));
		for (const affectedInstanceId of affectedInstanceIds) this.runtimeAuthFingerprints.delete(affectedInstanceId);
		const ids = [...new Set([...this.sessions.keys(), ...this.pendingSessions.keys()])]
			.filter((piboSessionId) => {
				const boundRuntimeInstanceId = this.getSessionRuntimeBinding(piboSessionId)?.runtimeInstanceId;
				return boundRuntimeInstanceId !== undefined && affectedInstanceIds.has(boundRuntimeInstanceId);
			});
		const results = await Promise.allSettled(ids.map(async (piboSessionId) => await this.resetCachedSession(piboSessionId, reason)));
		const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
		if (failures.length > 0) {
			throw new AggregateError(failures, `Failed to reset cached sessions affected by runtime auth target "${runtimeInstanceId}".`);
		}
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
			runtimeBinding: this.createRuntimeBindingInput(this.baseProfile),
			workspace: this.options.cwd ?? getDefaultPiboWorkspace(),
		});
		this.signalRegistry.project({ type: "session_created", session: created });
		return created;
	}

	private trackActiveSubagent(parentPiboSessionId: string, childPiboSessionId: string): () => void {
		let children = this.activeSubagentChildren.get(parentPiboSessionId);
		if (!children) {
			children = new Map();
			this.activeSubagentChildren.set(parentPiboSessionId, children);
		}
		children.set(childPiboSessionId, (children.get(childPiboSessionId) ?? 0) + 1);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			const current = this.activeSubagentChildren.get(parentPiboSessionId);
			if (!current) return;
			const remaining = (current.get(childPiboSessionId) ?? 1) - 1;
			if (remaining > 0) current.set(childPiboSessionId, remaining);
			else current.delete(childPiboSessionId);
			if (current.size === 0) this.activeSubagentChildren.delete(parentPiboSessionId);
		};
	}

	private async abortActiveSubagentSessions(parentPiboSessionId: string): Promise<void> {
		const childIds = [...(this.activeSubagentChildren.get(parentPiboSessionId)?.keys() ?? [])];
		if (childIds.length === 0) return;
		await Promise.allSettled(childIds.map(async (childPiboSessionId) => await this.emit({
			type: "execution",
			piboSessionId: childPiboSessionId,
			action: "abort",
			id: randomUUID(),
		})));
	}

	private createSubagentRunner(parentPiboSessionId: string): PiboSubagentRunner {
		return {
			runSubagent: async ({ subagent, message, threadKey, toolCallId, signal }) => {
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

				const untrack = this.trackActiveSubagent(parentPiboSessionId, child.id);
				try {
					const reply = await this.emitMessageAndWaitForReply(
						event,
						subagent.timeoutMs ?? DEFAULT_SUBAGENT_REPLY_TIMEOUT_MS,
						signal,
					);
					return { piboSessionId: child.id, eventId: event.id!, reply };
				} finally {
					untrack();
				}
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
		const maxDepth = subagent.maxDepth ?? DEFAULT_SUBAGENT_MAX_DEPTH;
		if (hasReachedSubagentMaxDepth(subagent, this.getSubagentDepth(parentPiboSessionId))) {
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
		const resolvedThreadKey = resolveSubagentThreadKey(threadKey);
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
			runtimeBinding: this.createRuntimeBindingInput(childProfile),
			workspace: parent.workspace,
			metadata,
		});
		this.signalRegistry.project({ type: "session_created", session: childSession });
		const activeModel = resolvePiboSessionActiveModel({
			profile: childProfile,
			piboSession: childSession,
			parentPiSessionId: this.resolveSessionRuntimeBinding(parent).nativeSessionId ?? parent.id,
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
