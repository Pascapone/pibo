import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
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
	RUN_REMINDER_MAX_DURATION_MS,
	RuntimeRoutedSession as RoutedSession,
	type PiboMessagePreflight,
} from "../agent-runtime/routed-session.js";
import { runtimeSessionErrorDetails } from "./session-errors.js";
import type {
	PiboAssistantMessageEvent,
	PiboEventListener,
	PiboExecutionEvent,
	PiboForkCandidate,
	PiboJsonObject,
	PiboInputEvent,
	PiboMessageEvent,
	PiboMessageProvenance,
	PiboOutputEvent,
	PiboSessionOperationResult,
	PiboSessionStatus,
} from "./events.js";
import { OutputRenderSequencer, outputRenderHighWaterStore } from "./output-render-sequence.js";
import {
	normalizePiboAgentSessionName,
	type PiboAgentObservation,
	type PiboAgentObserveInput,
	type PiboAgentsController,
	type PiboManagedAgent,
} from "../subagents/tool.js";
import {
	piboAgentObservationDetails,
	piboAgentObservationKind,
	piboAgentObservationRole,
	piboAgentObservationSourceFromEvent,
	piboAgentObservationText,
} from "../subagents/observations.js";
import {
	piboAgentObservationCursorScopeKey,
	preparePiboAgentObservationQuery,
	selectPiboAgentObservationPage,
} from "../subagents/observation-query.js";
import { PiboRunRegistry, type PiboRunNotification, type PiboRunRegistryEvent, type PiboRunSnapshot } from "../runs/registry.js";
import { PiboRunCancellationError, PiboRunCancelledError, PiboRunExecutionTimeoutError, waitForRunCancellationSettlement } from "../runs/lifecycle.js";
import { PiboRunResourceLimitError } from "../runs/resource-isolation.js";
import { createPiboSignalRegistry } from "../signals/registry.js";
import type { PiboSignalPatch, PiboSignalRegistry, PiboSignalSnapshot, PiboSignalStatusSnapshot } from "../signals/types.js";
import type { PiboRunToolController } from "../runs/tools.js";
import { createDefaultPiboReliabilityStore, type PiboReliabilityStore } from "../reliability/store.js";
import {
	PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES,
	InMemoryPiboSessionStore,
	createPiboSessionId,
	type CreatePiboSessionInput,
	type PiboSession,
	type PiboSessionStore,
} from "../sessions/store.js";
import { createAgentRuntimeBindingPersistence } from "../sessions/runtime-binding-persistence.js";
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
import { loadPiboGatewaySettings } from "./gateway-settings.js";
import { loadPiboUserSettings } from "./user-settings.js";
import {
	PIBO_INITIAL_MODEL_FALLBACKS_METADATA_KEY,
	resolvePiboSessionActiveModel,
	resolvePiboSessionModelFallbacks,
	withPiboSessionModelFallbacksMetadata,
} from "./session-model.js";
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
	"profile" | "agentsController" | "runToolController" | "resources"
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

const DEFAULT_SUBAGENT_MAX_DEPTH = 1;
const MAX_SUBAGENT_THREAD_KEY_BYTES = 512;
const MAX_AGENT_OBSERVATIONS = 5_000;
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

export function resolvePiboSessionInitialRuntimeOptions(session: Pick<PiboSession, "metadata">): PiboJsonObject | undefined {
	const value = session.metadata?.initialRuntimeOptions;
	return value && typeof value === "object" && !Array.isArray(value)
		? structuredClone(value)
		: undefined;
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

function subagentRequestEventKey(piboSessionId: string, eventId: string): string {
	return `${piboSessionId}\u0000${eventId}`;
}

function profileForSession(
	baseProfile: InitialSessionContext,
	runtimeInstanceId: string,
	nativeSessionId: string | undefined,
	parentNativeSessionId: string | undefined,
	subagentDepth: number,
	runtimeOptionsOverride?: PiboJsonObject,
): InitialSessionContext {
	const usesProfileRuntime = baseProfile.runtimeInstanceId === runtimeInstanceId;
	const options: InitialSessionContextOptions = {
		profileName: baseProfile.profileName,
		runtimeInstanceId,
		runtimeOptions: usesProfileRuntime
			? { ...baseProfile.runtimeOptions, ...runtimeOptionsOverride }
			: {},
		sessionId: nativeSessionId,
		parentSessionId: parentNativeSessionId,
		model: usesProfileRuntime ? baseProfile.model : undefined,
		mainModel: usesProfileRuntime ? baseProfile.mainModel : undefined,
		mainModelFallbacks: usesProfileRuntime ? baseProfile.mainModelFallbacks : undefined,
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
			instruction: [
				`This autonomous run-reminder turn stops after ${RUN_REMINDER_MAX_DURATION_MS / 60_000} minutes of wall-clock time.`,
				"Handle the listed runs promptly, then finish the turn. Do not start new subagents, yielded runs, or other long-running work from this reminder; leave larger follow-up work for a separate user-initiated or Goal continuation turn.",
				"Use pibo_run_read for completed, failed, or timed_out runs. Use pibo_run_wait, pibo_run_status, pibo_run_cancel, or pibo_run_ack for runs you still need to manage.",
			].join(" "),
		}),
		"</pibo_run_notification>",
	].join("\n");
}

function isRunReminderServiceMessage(event: PiboMessageEvent): boolean {
	return event.source === "service" && event.text.startsWith("<pibo_run_notification>");
}

function isRunReminderContextPressureError(event: Extract<PiboOutputEvent, { type: "session_error" }>): boolean {
	return event.errorDetails?.category === "context_overflow"
		|| event.errorDetails?.code === "context_length_exceeded"
		|| event.errorDetails?.code === "run_reminder_limit_exceeded";
}

function runReminderRecoveryGroupKey(notification: PiboRunNotification): string {
	if (notification.origin) return `origin:${JSON.stringify(notification.origin)}`;
	const runIds = [
		...notification.completed,
		...notification.failed,
		...notification.timedOut,
		...notification.cancelled,
		...notification.running,
	].map((run) => run.runId).sort();
	return `runs:${JSON.stringify(runIds)}`;
}

function yieldedRunOrigin(event: Pick<PiboMessageEvent, "id" | "provenance"> | undefined) {
	if (!event?.id || event.provenance?.kind !== "loop-run") return undefined;
	return {
		eventId: event.provenance.rootEventId ?? event.id,
		provenance: {
			kind: event.provenance.kind,
			jobId: event.provenance.jobId,
			runId: event.provenance.runId,
		} satisfies PiboMessageProvenance,
	};
}

function runReminderProvenance(notification: PiboRunNotification): PiboMessageProvenance | undefined {
	const origin = notification.origin;
	if (!origin || origin.provenance.kind !== "loop-run") return undefined;
	return {
		...origin.provenance,
		cause: "run-reminder",
		rootEventId: origin.eventId,
	};
}

function isTerminalRunStatus(status: string): boolean {
	return status === "completed" || status === "failed" || status === "timed_out" || status === "cancelled";
}

function asJsonObject(value: PiboJsonObject | undefined): PiboJsonObject {
	return value ?? {};
}

const DERIVED_SESSION_RECONCILIATION_METADATA_KEY = "pibo.sessionIdentityReconciliation.v1";

function unresolvedDerivedSessionSource(session: PiboSession): string | undefined {
	const marker = session.metadata?.[DERIVED_SESSION_RECONCILIATION_METADATA_KEY];
	if (!marker || typeof marker !== "object" || Array.isArray(marker)) return undefined;
	return marker.state === "cleanup-required" && typeof marker.sourcePiboSessionId === "string"
		? marker.sourcePiboSessionId
		: undefined;
}

function derivedSessionMetadata(value: PiboJsonObject | undefined): PiboJsonObject {
	const metadata = { ...asJsonObject(value) };
	for (const key of [
		DERIVED_SESSION_RECONCILIATION_METADATA_KEY,
		"workflowSessionKind",
		"subagentName",
		"subagentToolName",
		"agentStatus",
		"threadKey",
	]) {
		delete metadata[key];
	}
	return metadata;
}

function matchesDerivedSessionIntent(session: PiboSession, input: CreatePiboSessionInput): boolean {
	const binding = session.runtimeBinding;
	const expectedBinding = input.runtimeBinding;
	if (!binding || !expectedBinding) return false;
	const expectedPiSessionId = expectedBinding.adapterId === "pi" ? expectedBinding.nativeSessionId ?? "" : "";
	return session.id === input.id
		&& session.piSessionId === expectedPiSessionId
		&& session.channel === input.channel
		&& session.kind === input.kind
		&& session.profile === input.profile
		&& session.parentId === input.parentId
		&& session.originId === input.originId
		&& session.workspace === input.workspace
		&& (session.title === input.title || (input.title === undefined && session.title === "Untitled Session"))
		&& isDeepStrictEqual(session.metadata ?? {}, input.metadata ?? {})
		&& isDeepStrictEqual(session.activeModel, input.activeModel)
		&& binding.piboSessionId === input.id
		&& binding.runtimeInstanceId === expectedBinding.runtimeInstanceId
		&& binding.adapterId === expectedBinding.adapterId
		&& binding.nativeSessionId === expectedBinding.nativeSessionId
		&& binding.state === (expectedBinding.state ?? "unbound")
		&& binding.protocol === expectedBinding.protocol
		&& binding.protocolVersion === expectedBinding.protocolVersion
		&& binding.adapterVersion === expectedBinding.adapterVersion
		&& isDeepStrictEqual(binding.locator, expectedBinding.locator)
		&& isDeepStrictEqual(binding.metadata ?? {}, expectedBinding.metadata ?? {});
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

type RunReminderDelivery = {
	piboSessionId: string;
	generation: number;
	notification: PiboRunNotification;
};

type RunReminderRecoveryState = {
	generation: number;
	groups: Set<string>;
};

type UnresolvedDerivedSessionTransition = {
	piboSessionId: string;
	cause: unknown;
};

type StoredAgentObservation = PiboAgentObservation & {
	managingParentId: string;
};

type ActiveSubagentRequestSettlement =
	| { status: "fulfilled" }
	| { status: "rejected"; reason: unknown };

type ActiveSubagentRequest = {
	agentId: string;
	requestId: string;
	abortController: AbortController;
	settled: Promise<ActiveSubagentRequestSettlement>;
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
	private readonly outputRenderSequencer: OutputRenderSequencer;
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
	private readonly activeSubagentRequests = new Map<string, Set<ActiveSubagentRequest>>();
	private readonly subagentRequestIdsByEvent = new Map<string, string>();
	private readonly agentObservations: StoredAgentObservation[] = [];
	private readonly agentObservationHighWaterByParent = new Map<string, number>();
	private readonly agentObservationEvictedThroughByParent = new Map<string, number>();
	private readonly agentObservationAutoCursorFallback = new Map<string, number>();
	private nextAgentObservationSequence = 1;
	private readonly scheduledRunReminders = new Map<string, ScheduledRunReminder>();
	private readonly runReminderDeliveries = new Map<string, RunReminderDelivery>();
	private readonly deferredRunReminders = new Map<string, number>();
	private readonly runReminderRecoveries = new Map<string, RunReminderRecoveryState>();
	private readonly runReminderGenerations = new Map<string, number>();
	private readonly runCancellationHandlers = new Map<string, () => Promise<void>>();
	private readonly activeRunExecutions = new Set<string>();
	private readonly quiescingSessions = new Set<string>();
	private readonly unresolvedDerivedSessionTransitions = new Map<string, UnresolvedDerivedSessionTransition>();
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
		this.outputRenderSequencer = new OutputRenderSequencer({
			highWaterStore: outputRenderHighWaterStore(this.sessionStore),
		});
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
		const recoveredRunReminderControllers = new Set<string>();
		for (const run of this.runRegistry.listAll({ includeConsumed: true, includeDetached: true })) {
			this.signalRegistry.project({ type: "run_changed", run, reason: "recovered" });
			if (options.recoverInterruptedRuntimeState && isTerminalRunStatus(run.status) && this.sessionStore.get(run.controllerPiboSessionId)) {
				recoveredRunReminderControllers.add(run.controllerPiboSessionId);
			}
		}
		for (const piboSessionId of recoveredRunReminderControllers) this.scheduleRunReminder(piboSessionId, false);
	}

	subscribe(listener: PiboEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async emit(event: PiboInputEvent): Promise<PiboOutputEvent> {
		if (this.closing) throw new Error("Pibo session router is disposed.");
		let messageSignalAccepted = false;
		const acceptMessageSignal = () => {
			if (event.type !== "message" || !event.id || messageSignalAccepted) return;
			messageSignalAccepted = true;
			this.signalRegistry.project({ type: "message_accepted", piboSessionId: event.piboSessionId, eventId: event.id, source: event.source });
		};
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
			// Cold runtime creation and steering retain their established eager
			// signal lifecycle. Cached queued messages are accepted inside the
			// routed session's synchronous admission boundary so an identity
			// reservation can reject without first publishing acceptance.
			if (event.delivery === "steer" || (!this.sessions.has(event.piboSessionId) && !this.pendingSessions.has(event.piboSessionId))) {
				acceptMessageSignal();
			}
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
				if (event.delivery === "steer") return await session.steerMessage(event);
				const output = session.enqueueMessage(event, acceptMessageSignal);
				// Test doubles and compatibility shims may ignore the optional
				// callback; production routed sessions invoke it before queueing.
				acceptMessageSignal();
				return output;
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

			let output: PiboOutputEvent;
			if (event.action === "abort") {
				const [sessionAbort, childAbort] = await Promise.allSettled([
					session.executeAction(event),
					this.abortActiveSubagentSessions(event.piboSessionId),
				]);
				if (sessionAbort.status === "rejected" && childAbort.status === "rejected") {
					throw new AggregateError([sessionAbort.reason, childAbort.reason], "Failed to abort the session and its active subagent requests.");
				}
				if (sessionAbort.status === "rejected") throw sessionAbort.reason;
				if (childAbort.status === "rejected") throw childAbort.reason;
				output = sessionAbort.value;
			} else {
				output = await session.executeAction(event);
			}
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
			if (!session) continue;
			this.signalRegistry.project({ type: "session_disposed", piboSessionId: id, reason: "kill" });
			try {
				killed.push(await session.kill());
			} catch (error) {
				failures.push(error);
			}
		}
		if (options?.includeRuns) {
			const runs = ids.flatMap((id) => this.runRegistry.listActiveControllerRuns(id));
			try {
				const cancelled = await this.cancelRunsAfterSettlement(runs, "Pibo session subtree was killed.");
				cancelledRuns.push(...cancelled.map((run) => run.runId));
			} catch (error) {
				failures.push(error);
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

		let releaseStart: (() => void) | undefined;
		const startGate = new Promise<void>((resolve) => {
			releaseStart = resolve;
		});
		const operation = (async () => {
			await startGate;
			const runCancellationResults = options.cancelRuns
				? await Promise.allSettled([
					this.cancelRunsAfterSettlement(
						ids.flatMap((id) => this.runRegistry.listActiveControllerRuns(id)),
						reason,
					),
				])
				: [];
			const pending = ids.map((id) => this.pendingSessions.get(id)).filter((value): value is Promise<RoutedSession> => Boolean(value));
			if (pending.length > 0) await Promise.allSettled(pending);
			const sessions = ids.flatMap((id) => {
				const session = this.sessions.get(id);
				return session ? [{ id, session }] : [];
			});
			const failures: unknown[] = runCancellationResults.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
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
				this.outputRenderSequencer.disposeSession(id);
				this.signalRegistry.project({ type: "session_disposed", piboSessionId: id, reason });
			}
			await this.telemetryWriter?.flush();
		}
	}

	private descendantSessionIds(parentId: string): string[] {
		const childrenByParent = new Map<string, PiboSession[]>();
		for (const session of this.sessionStore.list?.() ?? []) {
			if (!session.parentId) continue;
			const children = childrenByParent.get(session.parentId) ?? [];
			children.push(session);
			childrenByParent.set(session.parentId, children);
		}
		const output: string[] = [];
		const seen = new Set([parentId]);
		const stack = [...(childrenByParent.get(parentId) ?? [])].reverse();
		while (stack.length > 0) {
			const session = stack.pop()!;
			if (seen.has(session.id)) continue;
			seen.add(session.id);
			output.push(session.id);
			const children = childrenByParent.get(session.id);
			if (children) stack.push(...[...children].reverse());
		}
		return output;
	}

	private async killChildSessions(parentId: string, options?: { includeRuns?: boolean }): Promise<{ killed: string[]; cancelledRuns: string[] }> {
		const killed: string[] = [];
		const cancelledRuns: string[] = [];
		for (const id of this.descendantSessionIds(parentId)) {
			const childSession = this.sessions.get(id);
			if (childSession) killed.push(await childSession.kill());
			if (!options?.includeRuns) continue;
			const runs = this.runRegistry.listActiveControllerRuns(id);
			const cancelled = await this.cancelRunsAfterSettlement(runs, `Child Pibo session "${id}" was killed.`);
			cancelledRuns.push(...cancelled.map((run) => run.runId));
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

	getSessionRuntimeProfile(piboSessionId: string): InitialSessionContext {
		const session = this.resolvePiboSession(piboSessionId);
		const binding = this.resolveSessionRuntimeBinding(session);
		const parent = session.parentId ? this.resolvePiboSession(session.parentId) : undefined;
		const parentBinding = parent ? this.resolveSessionRuntimeBinding(parent) : undefined;
		const parentNativeSessionId = parentBinding
			&& parentBinding.runtimeInstanceId === binding.runtimeInstanceId
			&& parentBinding.adapterId === binding.adapterId
			? parentBinding.nativeSessionId
			: undefined;
		return profileForSession(
			createPiboProfileFromRegistryOrDefault(this.pluginRegistry, session.profile),
			binding.runtimeInstanceId,
			binding.nativeSessionId,
			parentNativeSessionId,
			this.getSubagentDepth(session.id),
			resolvePiboSessionInitialRuntimeOptions(session),
		);
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
			resolvePiboSessionInitialRuntimeOptions(session),
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
		if (switchingRuntime) {
			this.sessionStore.update(piboSessionId, {
				activeModel: null,
				metadata: withPiboSessionModelFallbacksMetadata(session.metadata, []),
			});
		}
		return structuredClone(persisted);
	}

	getSessionRuntimeStatus(piboSessionId: string): PiboSessionStatus | undefined {
		const status = this.sessions.get(piboSessionId)?.getStatus();
		return status ? this.withPersistedRuntimeBinding(status) : undefined;
	}

	async getSessionStatusSnapshot(piboSessionId: string, options?: { activate?: boolean }): Promise<PiboSessionStatus | undefined> {
		const session = options?.activate === false ? this.sessions.get(piboSessionId) : await this.getOrCreateSession(piboSessionId);
		if (!session) {
			this.resolvePiboSession(piboSessionId);
			return undefined;
		}
		try {
			return this.withPersistedRuntimeBinding(await session.getStatusSnapshot());
		} finally {
			// Passive header polling must neither create nor indefinitely retain a runtime.
			if (options?.activate !== false) this.scheduleIdleSessionEvictionIfIdle(piboSessionId);
		}
	}

	async getSessionForkCandidates(piboSessionId: string): Promise<PiboForkCandidate[]> {
		const canReadPersisted = () => !this.closing
			&& !this.quiescingSessions.has(piboSessionId)
			&& !this.disposingSessions.has(piboSessionId)
			&& !this.sessions.has(piboSessionId)
			&& !this.pendingSessions.has(piboSessionId);
		if (canReadPersisted()) {
			const record = this.resolvePiboSession(piboSessionId);
			const binding = this.resolveSessionRuntimeBinding(record);
			const adapter = this.resolveAgentRuntimeRegistry(binding.runtimeInstanceId).requireAgentRuntimeAdapter(binding.runtimeInstanceId);
			if (binding.state === "bound" && adapter.descriptor.id === binding.adapterId
				&& adapter.descriptor.capabilities.lifecycle.fork && adapter.readForkCandidates) {
				const workspace = record.workspace ?? this.options.cwd ?? getDefaultPiboWorkspace();
				const candidates = await adapter.readForkCandidates({ binding, workspace });
				const current = this.resolvePiboSession(piboSessionId);
				if (candidates !== undefined && canReadPersisted() && current.workspace === record.workspace
					&& runtimeBindingsEqual(binding, this.resolveSessionRuntimeBinding(current))) return candidates;
			}
		}
		const session = await this.getOrCreateSession(piboSessionId);
		try {
			return await session.getForkCandidates();
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
		timeoutMs?: number,
		signal?: AbortSignal,
	): Promise<PiboAssistantMessageEvent> {
		const eventWithId: PiboMessageEvent = { ...event, id: event.id ?? randomUUID() };

		return await new Promise<PiboAssistantMessageEvent>((resolve, reject) => {
			let settled = false;
			let dispatchPromise: Promise<PiboOutputEvent> | undefined;
			let lastAssistantMessage: PiboAssistantMessageEvent | undefined;
			let timeout: NodeJS.Timeout | undefined;
			const claimSettlement = (): boolean => {
				if (settled) return false;
				settled = true;
				if (timeout) clearTimeout(timeout);
				signal?.removeEventListener("abort", onAbort);
				unsubscribe();
				return true;
			};
			const finish = (result: PiboAssistantMessageEvent | Error): void => {
				if (!claimSettlement()) return;
				if (result instanceof Error) reject(result);
				else resolve(result);
			};
			const rejectAfterMessageCancellation = (error: Error): void => {
				if (!claimSettlement()) return;
				void (async () => {
					try {
						await dispatchPromise;
						await this.cancelSessionMessage(eventWithId.piboSessionId, eventWithId.id!);
					} catch (cancellationError) {
						reject(new PiboRunCancellationError(
							`Failed to cancel subagent request "${eventWithId.id}" in Pibo session "${eventWithId.piboSessionId}".`,
							{ cause: cancellationError },
						));
						return;
					}
					reject(error);
				})();
			};
			const onAbort = () => {
				rejectAfterMessageCancellation(subagentAbortError());
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
				finish(subagentAbortError());
				return;
			}
			signal?.addEventListener("abort", onAbort, { once: true });
			if (timeoutMs !== undefined) {
				timeout = setTimeout(() => {
					rejectAfterMessageCancellation(new PiboRunExecutionTimeoutError(
						`Timed out waiting for assistant reply from Pibo session "${eventWithId.piboSessionId}"`,
						"lifetime",
					));
				}, timeoutMs);
			}

			dispatchPromise = this.emit(eventWithId);
			dispatchPromise.catch((error) => {
				finish(error instanceof Error ? error : new Error(String(error)));
			});
		});
	}

	private async cancelSessionMessage(piboSessionId: string, eventId: string): Promise<void> {
		const session = this.sessions.get(piboSessionId);
		if (!session || !await session.cancelMessage(eventId)) {
			throw new Error(`Pibo session "${piboSessionId}" no longer owns message "${eventId}".`);
		}
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
			const runCancellationResult = await Promise.allSettled([
				this.cancelRunsAfterSettlement(this.runRegistry.listActiveRuns(), "Pibo session router was disposed."),
			]);
			this.scheduledRunReminders.clear();
			const closeResult = await Promise.allSettled([this.runtimeRegistry.closeAll({ force: true })]);
			const disposeResults = await Promise.allSettled(sessions.map(([id, session]) => this.disposeRoutedSession(id, session, "router disposed")));
			for (const [id, session] of sessions) {
				if (this.sessions.get(id) === session) this.sessions.delete(id);
				this.signalRegistry.project({ type: "session_disposed", piboSessionId: id, reason: "router disposed" });
			}
			const failures = [
				...runCancellationResult.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason),
				...closeResult.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason),
				...disposeResults.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason),
			];
			if (failures.length > 0) throw new AggregateError(failures, "Failed to dispose all Pibo sessions");
		} finally {
			const authDisposals = await Promise.allSettled([
				this.pluginRegistry.disposeAgentRuntimeAuth(),
				...(this.compatibilityRuntimeRegistry ? [this.compatibilityRuntimeRegistry.disposeAgentRuntimeAuth()] : []),
			]);
			const ownedPluginRegistries = this.options.pluginRegistry === undefined
				? [this.pluginRegistry]
				: this.compatibilityRuntimeRegistry ? [this.compatibilityRuntimeRegistry] : [];
			const webAppDisposals = await Promise.allSettled(
				ownedPluginRegistries.flatMap((registry) => registry.getWebApps().map((app) => app.dispose?.())),
			);
			await this.portableToolService.dispose();
			await this.runtimeResourceService.dispose();
			this.runtimeResourceSessions.clear();
			this.activeSubagentRequests.clear();
			this.subagentRequestIdsByEvent.clear();
			this.outputRenderSequencer.disposeAll();
			this.agentObservations.length = 0;
			this.agentObservationHighWaterByParent.clear();
			this.agentObservationEvictedThroughByParent.clear();
			this.agentObservationAutoCursorFallback.clear();
			await this.telemetryWriter?.dispose();
			const lifecycleFailures = [...authDisposals, ...webAppDisposals]
				.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
			if (lifecycleFailures.length > 0) {
				throw new AggregateError(lifecycleFailures, "Failed to dispose runtime authentication controllers or web apps.");
			}
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
		await this.resetCachedSession(piboSessionId);
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
		let binding = this.resolveSessionRuntimeBinding(piboSession);
		const parent = piboSession.parentId ? this.resolvePiboSession(piboSession.parentId) : undefined;
		const parentBinding = parent ? this.resolveSessionRuntimeBinding(parent) : undefined;
		const parentModelScopeId = parent ? parentBinding?.nativeSessionId ?? parent.id : undefined;
		const modelDefaults = this.resolveModelDefaults();
		const initialThinkingLevel = resolvePiboSessionInitialThinkingLevel(piboSession);
		const sessionProfile = this.getSessionRuntimeProfile(piboSession.id);
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
		const modelFallbacks = changesRuntimeModelNamespace
			? []
			: this.ensureSessionModelFallbacks(piboSession, sessionProfile, parentModelScopeId, activeModel);
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
		const agentsController = this.createAgentsController(piboSession.id);
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
			agentsController,
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
		const bindingSync = { expectedRevision: binding.revision };
		const runtimeBindingPersistence = createAgentRuntimeBindingPersistence(this.sessionStore, {
			piboSessionId: piboSession.id,
			onPersisted: (updated) => {
				binding = updated;
				bindingSync.expectedRevision = updated.revision;
				const updatedSession = this.sessionStore.get(piboSession.id);
				if (updatedSession) this.signalRegistry.project({ type: "session_created", session: updatedSession });
			},
		});
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
					agentsController,
					runToolController,
					codeRuntimeToolController,
					portableTools,
					resources,
					...(runtimeBindingPersistence ? { runtimeBindingPersistence } : {}),
					compatibility: {
						persistSession: this.options.persistSession,
						piPackageStoreCwd: this.options.piPackageStoreCwd,
						thinkingLevel: initialThinkingLevel ?? this.options.thinkingLevel,
						retryDefaults: resolvePiboSessionRetryDefaults(piboSession.kind, this.options.retryDefaults),
						extensionFactories: [
							...(telemetryExtension ? [telemetryExtension] : []),
							...(this.options.extensionFactories ?? []),
						],
						modelDefaults,
						initialFastMode,
						providerFallbacksEnabled: modelFallbacks.length > 0,
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
				bindingSync.expectedRevision = binding.revision;
			}
		} catch (error) {
			await runtimeSession.dispose().catch(() => {});
			portableTools.dispose();
			if (this.portableToolSessions.get(piboSession.id) === portableTools) this.portableToolSessions.delete(piboSession.id);
			await resources.dispose();
			if (this.runtimeResourceSessions.get(piboSession.id) === resources) this.runtimeResourceSessions.delete(piboSession.id);
			throw error;
		}
		const resourceInspection = resources.getInspection();
		const statusResources = {
			enabledSkills: [...new Set(resourceInspection.skills.map((skill) => skill.name))],
			contextFiles: [...new Set(resourceInspection.context.map((contribution) => (
				contribution.sourcePath ?? contribution.path ?? contribution.label
			)).filter((value): value is string => Boolean(value)))],
		};
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
				onBeforeSessionIdentityOperation: (event) => this.retryUnresolvedDerivedSessionCompensation(event.piboSessionId),
				onKillChildren: (id, opts) => this.killChildSessions(id, opts),
				onStateChange: (state) => {
					this.signalRegistry.project({
						type: "session_processing_changed",
						piboSessionId: piboSession.id,
						processing: state.processing,
						queuedMessages: state.queuedMessages,
					});
					if (!state.processing && state.queuedMessages === 0 && !state.disposed && !state.sessionIdentityOperationInFlight) {
						this.syncLiveSessionRuntimeBinding(piboSession.id, runtimeSession, bindingSync);
						this.scheduleRunReminder(piboSession.id, false);
					}
					if (state.disposed || state.processing || state.queuedMessages > 0 || state.sessionIdentityOperationInFlight) this.clearIdleSessionTimer(piboSession.id);
					else this.scheduleIdleSessionEvictionIfIdle(piboSession.id);
				},
				onMessagesInterrupted: (messages, reason) => {
					this.telemetryRecorder?.recordMessagesInterrupted(messages, {
						session: this.sessionStore.get(piboSession.id),
						status: this.sessions.get(piboSession.id)?.getStatus(),
					}, reason);
					this.handleInterruptedRunReminders(messages);
				},
				messagePreflight: this.options.messagePreflight,
				modelFallbacks,
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
				statusResources,
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

	private syncLiveSessionRuntimeBinding(
		piboSessionId: string,
		runtimeSession: { getBinding(): RuntimeSessionBinding },
		state: { expectedRevision: number | undefined },
	): void {
		const session = this.sessionStore.get(piboSessionId);
		if (!session) return;
		try {
			const persisted = this.resolveSessionRuntimeBinding(session);
			const updated = this.persistSessionRuntimeBinding(
				session,
				withPersistedPortableHistoryAuditMetadata(persisted, runtimeSession.getBinding()),
				{ expectedRevision: state.expectedRevision },
			);
			state.expectedRevision = updated.revision;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const reset = this.resetCachedSession(piboSessionId, "runtime binding synchronization failed");
			this.emitOutput({
				type: "session_error",
				piboSessionId,
				error: `Failed to persist the live runtime binding: ${message}`,
				errorDetails: runtimeSessionErrorDetails(message),
			});
			void reset.catch((resetError) => {
				const resetMessage = resetError instanceof Error ? resetError.message : String(resetError);
				this.emitOutput({
					type: "session_error",
					piboSessionId,
					error: `Failed to discard a runtime after binding synchronization failed: ${resetMessage}`,
					errorDetails: runtimeSessionErrorDetails(resetMessage),
				});
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

	private ensureSessionModelFallbacks(
		piboSession: PiboSession,
		profile: InitialSessionContext,
		parentPiSessionId: string | undefined,
		activeModel: ModelProfile | undefined,
	): ModelProfile[] {
		const modelFallbacks = resolvePiboSessionModelFallbacks({
			profile,
			piboSession,
			parentPiSessionId,
			activeModel,
		});
		if (piboSession.metadata?.[PIBO_INITIAL_MODEL_FALLBACKS_METADATA_KEY] === undefined) {
			this.sessionStore.update(piboSession.id, {
				metadata: withPiboSessionModelFallbacksMetadata(piboSession.metadata, modelFallbacks),
			});
		}
		return modelFallbacks;
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
		const currentNativeSessionId = result.current.piSessionId || undefined;
		const currentBinding: RuntimeSessionBinding = {
			...previousBinding,
			...liveBinding,
			piboSessionId: source.id,
			nativeSessionId: currentNativeSessionId,
			state: currentNativeSessionId ? "bound" : "unbound",
			locator: currentNativeSessionId && result.current.sessionFile
				? { kind: "local-file", value: result.current.sessionFile }
				: currentNativeSessionId
					? liveBinding?.locator ?? previousBinding.locator
					: undefined,
			metadata: currentNativeSessionId ? liveBinding?.metadata ?? previousBinding.metadata : undefined,
		};

		if (event.action === "session.fork" || event.action === "session.clone") {
			const action = event.action as "session.fork" | "session.clone";
			let transitionError: unknown;
			try {
				const created = this.createDerivedSession(result, action, currentBinding);
				result.piboSessionId = created.id;
			} catch (error) {
				transitionError = error;
			}
			if (result.sourceSessionUnchanged) {
				if (transitionError) throw transitionError;
				return;
			}
			// Identity-moving forks and clones transfer the live native handle to the
			// derived session, so the source must be reopened from its persisted binding.
			try {
				await this.resetCachedSession(event.piboSessionId);
			} catch (resetError) {
				if (transitionError) {
					throw new AggregateError([transitionError, resetError], `Failed to persist and reset ${action}.`);
				}
				throw resetError;
			}
			if (transitionError) throw transitionError;
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
		const input: CreatePiboSessionInput = {
			id: createPiboSessionId(),
			channel: source.channel,
			kind: "branch",
			profile: source.profile,
			parentId: source.parentId,
			originId: source.id,
			runtimeBinding: {
				runtimeInstanceId: currentBinding.runtimeInstanceId,
				adapterId: currentBinding.adapterId,
				nativeSessionId: currentBinding.nativeSessionId,
				state: currentBinding.state,
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
				...derivedSessionMetadata(source.metadata),
				originAction: action,
				originRuntimeNativeSessionId: result.previous.piSessionId,
				...(currentBinding.adapterId === "pi" ? { originPiSessionId: result.previous.piSessionId } : {}),
			},
		};
		let created: PiboSession;
		try {
			created = this.sessionStore.create(input);
		} catch (error) {
			let persisted: PiboSession | undefined;
			try {
				persisted = this.sessionStore.get(input.id!);
			} catch (lookupError) {
				const failure = new AggregateError(
					[error, lookupError],
					`Branch persistence for "${input.id}" failed and its commit state could not be reconciled.`,
				);
				this.unresolvedDerivedSessionTransitions.set(source.id, { piboSessionId: input.id!, cause: failure });
				throw failure;
			}
			if (!persisted) throw error;
			if (matchesDerivedSessionIntent(persisted, input)) return persisted;
			return this.rejectDerivedSessionAfterCompensation(source.id, input.id!, error);
		}
		if (matchesDerivedSessionIntent(created, input)) return created;
		return this.rejectDerivedSessionAfterCompensation(
			source.id,
			input.id!,
			new Error(`Session store returned a branch that does not match the intended derivation "${input.id}".`),
		);
	}

	private retryUnresolvedDerivedSessionCompensation(sourcePiboSessionId: string): void {
		const remembered = this.unresolvedDerivedSessionTransitions.get(sourcePiboSessionId);
		const persisted = this.sessionStore.find({ originId: sourcePiboSessionId })
			.filter((session) => unresolvedDerivedSessionSource(session) === sourcePiboSessionId)
			.map((session) => ({
				piboSessionId: session.id,
				cause: new Error(`Branch "${session.id}" has a persisted session identity reconciliation marker.`),
			}));
		const unresolved = [
			...(remembered ? [remembered] : []),
			...persisted.filter((candidate) => candidate.piboSessionId !== remembered?.piboSessionId),
		];
		for (const candidate of unresolved) {
			try {
				if (!this.sessionStore.get(candidate.piboSessionId)) {
					if (remembered?.piboSessionId === candidate.piboSessionId) {
						this.unresolvedDerivedSessionTransitions.delete(sourcePiboSessionId);
					}
					continue;
				}
				if (!this.sessionStore.delete) throw new Error("Session store does not support compensating deletion.");
				this.sessionStore.delete(candidate.piboSessionId);
				if (this.sessionStore.get(candidate.piboSessionId)) {
					throw new Error(`Compensating deletion left branch "${candidate.piboSessionId}" persisted.`);
				}
				if (remembered?.piboSessionId === candidate.piboSessionId) {
					this.unresolvedDerivedSessionTransitions.delete(sourcePiboSessionId);
				}
			} catch (error) {
				this.unresolvedDerivedSessionTransitions.set(sourcePiboSessionId, candidate);
				throw new AggregateError(
					[candidate.cause, error],
					`Branch "${candidate.piboSessionId}" still requires compensation; refusing another session identity operation for source "${sourcePiboSessionId}".`,
				);
			}
		}
	}

	private persistDerivedSessionReconciliationMarker(sourcePiboSessionId: string, piboSessionId: string): void {
		const residual = this.sessionStore.get(piboSessionId);
		if (!residual) return;
		const updated = this.sessionStore.update(piboSessionId, {
			metadata: {
				...(residual.metadata ?? {}),
				[DERIVED_SESSION_RECONCILIATION_METADATA_KEY]: {
					state: "cleanup-required",
					sourcePiboSessionId,
				},
			},
		});
		if (!updated || unresolvedDerivedSessionSource(updated) !== sourcePiboSessionId) {
			throw new Error(`Failed to persist the reconciliation marker for branch "${piboSessionId}".`);
		}
	}

	private rejectDerivedSessionAfterCompensation(sourcePiboSessionId: string, piboSessionId: string, cause: unknown): never {
		let cleanupError: unknown;
		try {
			if (!this.sessionStore.delete) {
				throw new Error("Session store does not support compensating deletion.");
			}
			this.sessionStore.delete(piboSessionId);
			if (this.sessionStore.get(piboSessionId)) {
				throw new Error(`Compensating deletion left branch "${piboSessionId}" persisted.`);
			}
		} catch (error) {
			cleanupError = error;
		}
		if (cleanupError) {
			let markerError: unknown;
			try {
				this.persistDerivedSessionReconciliationMarker(sourcePiboSessionId, piboSessionId);
			} catch (error) {
				markerError = error;
			}
			const failure = new AggregateError(
				[cause, cleanupError, ...(markerError ? [markerError] : [])],
				`Branch persistence for "${piboSessionId}" was inconsistent and compensation failed.`,
			);
			this.unresolvedDerivedSessionTransitions.set(sourcePiboSessionId, { piboSessionId, cause: failure });
			throw failure;
		}
		throw cause;
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

	private trackActiveSubagent(parentPiboSessionId: string, request: ActiveSubagentRequest): () => void {
		let requests = this.activeSubagentRequests.get(parentPiboSessionId);
		if (!requests) {
			requests = new Set();
			this.activeSubagentRequests.set(parentPiboSessionId, requests);
		}
		requests.add(request);
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			const current = this.activeSubagentRequests.get(parentPiboSessionId);
			if (!current) return;
			current.delete(request);
			if (current.size === 0) this.activeSubagentRequests.delete(parentPiboSessionId);
		};
	}

	private async abortActiveSubagentSessions(parentPiboSessionId: string): Promise<void> {
		const requests = [...(this.activeSubagentRequests.get(parentPiboSessionId) ?? [])];
		for (const request of requests) request.abortController.abort();
		const settlements = await Promise.all(requests.map(async (request) => await request.settled));
		const failures = settlements.flatMap((settlement) => settlement.status === "rejected" ? [settlement.reason] : []);
		if (failures.length > 0) throw new AggregateError(failures, "Failed to cancel active subagent requests.");
	}

	private createAgentsController(parentPiboSessionId: string): PiboAgentsController {
		return {
			sendMessage: async ({ subagent, sessionName, message, threadKey, toolCallId, requestId, parentProvenance, signal }) => {
				if (signal?.aborted) throw subagentAbortError();
				if (typeof requestId !== "string" || !requestId.trim()) throw new Error("Delegated agent requestId is required.");
				this.assertSubagentDepth(parentPiboSessionId, subagent);
				const normalizedSessionName = normalizePiboAgentSessionName(sessionName);
				const child = this.resolveSubagentSession(parentPiboSessionId, subagent, normalizedSessionName, threadKey);
				const resolvedThreadKey = typeof child.metadata?.threadKey === "string" ? child.metadata.threadKey : "";
				const loopJobId = parentProvenance?.kind === "loop-run"
					? parentProvenance.jobId
					: parentProvenance?.kind === "subagent-request"
						? parentProvenance.loopJobId
						: undefined;
				const loopRunId = parentProvenance?.kind === "loop-run"
					? parentProvenance.runId
					: parentProvenance?.kind === "subagent-request"
						? parentProvenance.loopRunId
						: undefined;
				const event: PiboMessageEvent = {
					type: "message",
					piboSessionId: child.id,
					text: message,
					source: "actor",
					id: randomUUID(),
					provenance: {
						kind: "subagent-request",
						requestId,
						controllerPiboSessionId: parentPiboSessionId,
						...(loopJobId ? { loopJobId } : {}),
						...(loopRunId ? { loopRunId } : {}),
					},
				};
				this.subagentRequestIdsByEvent.set(subagentRequestEventKey(child.id, event.id!), requestId);

				this.emitOutput({
					type: "subagent_session",
					piboSessionId: parentPiboSessionId,
					requestId,
					toolCallId,
					toolName: "pibo_agents_send_message",
					subagentName: subagent.name,
					childPiboSessionId: child.id,
					threadKey: resolvedThreadKey,
				});

				const parentAbortController = new AbortController();
				const requestSignal = signal
					? AbortSignal.any([signal, parentAbortController.signal])
					: parentAbortController.signal;
				let resolveSettled: ((settlement: ActiveSubagentRequestSettlement) => void) | undefined;
				const settled = new Promise<ActiveSubagentRequestSettlement>((resolve) => {
					resolveSettled = resolve;
				});
				const untrack = this.trackActiveSubagent(parentPiboSessionId, {
					agentId: child.id,
					requestId,
					abortController: parentAbortController,
					settled,
				});
				let settlement: ActiveSubagentRequestSettlement = { status: "fulfilled" };
				try {
					const reply = await this.emitMessageAndWaitForReply(event, undefined, requestSignal);
					return {
						requestId,
						agentId: child.id,
						name: subagent.name,
						profile: child.profile,
						threadKey: resolvedThreadKey,
						eventId: event.id!,
						finalMessage: reply.text,
						reply,
					};
				} catch (error) {
					const confirmedParentCancellation = parentAbortController.signal.aborted
						&& error instanceof Error
						&& error.name === "AbortError";
					if (!confirmedParentCancellation) settlement = { status: "rejected", reason: error };
					throw error;
				} finally {
					this.subagentRequestIdsByEvent.delete(subagentRequestEventKey(child.id, event.id!));
					untrack();
					resolveSettled?.(settlement);
				}
			},
			listAgents: () => this.listManagedAgents(parentPiboSessionId),
			observe: (input) => this.observeManagedAgents(parentPiboSessionId, input),
			killAgent: async (agentId) => await this.killManagedAgent(parentPiboSessionId, agentId),
		};
	}

	private listManagedAgents(parentPiboSessionId: string): PiboManagedAgent[] {
		return this.sessionStore.find({
			channel: "pibo.subagents",
			kind: "subagent",
			parentId: parentPiboSessionId,
		}).map((session) => {
			const live = this.sessions.get(session.id)?.getStatus();
			const killed = session.metadata?.agentStatus === "killed";
			const running = !killed && Boolean(live && (live.processing || live.streaming || live.queuedMessages > 0));
			return {
				agentId: session.id,
				name: typeof session.metadata?.subagentName === "string" ? session.metadata.subagentName : session.profile,
				profile: session.profile,
				...(session.title ? { sessionName: session.title } : {}),
				...(typeof session.metadata?.threadKey === "string" ? { threadKey: session.metadata.threadKey } : {}),
				status: killed ? "killed" : running ? "running" : "idle",
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
				...(session.activeModel ? { activeModel: { ...session.activeModel } } : {}),
			};
		});
	}

	private requireManagedAgent(parentPiboSessionId: string, agentId: string): PiboSession {
		const session = this.sessionStore.get(agentId);
		if (
			!session
			|| session.parentId !== parentPiboSessionId
			|| session.channel !== "pibo.subagents"
			|| session.kind !== "subagent"
		) {
			throw new Error(`Agent "${agentId}" is not owned by Pibo session "${parentPiboSessionId}".`);
		}
		return session;
	}

	private observeManagedAgents(parentPiboSessionId: string, input: PiboAgentObserveInput) {
		for (const agentId of input.agentIds ?? []) this.requireManagedAgent(parentPiboSessionId, agentId);
		const baseQuery = preparePiboAgentObservationQuery(input);
		const cursorScope = piboAgentObservationCursorScopeKey(baseQuery.filters);
		const explicitAfterSequence = input.afterSequence !== undefined;
		const savedAfterSequence = baseQuery.cursorMode === "auto" && !explicitAfterSequence
			? this.getAgentObservationAutoCursor(parentPiboSessionId, cursorScope)
			: undefined;
		const query = savedAfterSequence === undefined
			? baseQuery
			: preparePiboAgentObservationQuery({ ...input, afterSequence: savedAfterSequence });
		const observations = this.agentObservations;
		const evictedThrough = this.agentObservationEvictedThroughByParent.get(parentPiboSessionId) ?? 0;
		const sourceHighWater = Math.max(
			evictedThrough,
			this.agentObservationHighWaterByParent.get(parentPiboSessionId) ?? 0,
		);
		function* ordered(): IterableIterator<PiboAgentObservation> {
			const start = query.scanOrder === "asc" ? 0 : observations.length - 1;
			const end = query.scanOrder === "asc" ? observations.length : -1;
			const step = query.scanOrder === "asc" ? 1 : -1;
			for (let index = start; index !== end; index += step) {
				const { managingParentId, ...observation } = observations[index]!;
				if (managingParentId === parentPiboSessionId) yield observation;
			}
		}
		const page = selectPiboAgentObservationPage(ordered(), query, { evictedThrough });
		if (query.cursorMode === "history") return page;

		const initialSnapshot = !explicitAfterSequence && savedAfterSequence === undefined;
		const nextAfterSequence = initialSnapshot || !page.truncated
			? Math.max(page.nextAfterSequence, sourceHighWater)
			: page.nextAfterSequence;
		const advancedAfterSequence = this.advanceAgentObservationAutoCursor(
			parentPiboSessionId,
			cursorScope,
			nextAfterSequence,
		);
		return {
			...page,
			autoCursorSequence: advancedAfterSequence,
		};
	}

	private getAgentObservationAutoCursor(parentPiboSessionId: string, cursorScope: string): number | undefined {
		if (this.sessionStore.getAgentObservationAutoCursor) {
			return this.sessionStore.getAgentObservationAutoCursor(parentPiboSessionId, cursorScope);
		}
		return this.agentObservationAutoCursorFallback.get(JSON.stringify([parentPiboSessionId, cursorScope]));
	}

	private advanceAgentObservationAutoCursor(parentPiboSessionId: string, cursorScope: string, sequence: number): number {
		if (this.sessionStore.advanceAgentObservationAutoCursor) {
			return this.sessionStore.advanceAgentObservationAutoCursor(parentPiboSessionId, cursorScope, sequence);
		}
		const key = JSON.stringify([parentPiboSessionId, cursorScope]);
		const advanced = Math.max(this.agentObservationAutoCursorFallback.get(key) ?? 0, sequence);
		this.agentObservationAutoCursorFallback.delete(key);
		this.agentObservationAutoCursorFallback.set(key, advanced);
		const prefix = `${JSON.stringify([parentPiboSessionId]).slice(0, -1)},`;
		let scopeCount = 0;
		for (const existingKey of this.agentObservationAutoCursorFallback.keys()) {
			if (existingKey.startsWith(prefix)) scopeCount += 1;
		}
		for (const existingKey of this.agentObservationAutoCursorFallback.keys()) {
			if (scopeCount <= PIBO_AGENT_OBSERVATION_AUTO_CURSOR_MAX_SCOPES) break;
			if (!existingKey.startsWith(prefix)) continue;
			this.agentObservationAutoCursorFallback.delete(existingKey);
			scopeCount -= 1;
		}
		return advanced;
	}

	private async killManagedAgent(parentPiboSessionId: string, agentId: string) {
		const child = this.requireManagedAgent(parentPiboSessionId, agentId);
		const ids = [agentId, ...this.descendantSessionIds(agentId)];
		const idSet = new Set(ids);
		const activeParentRunIds = new Set(
			[...(this.activeSubagentRequests.get(parentPiboSessionId) ?? [])]
				.filter((request) => idSet.has(request.agentId))
				.map((request) => request.requestId),
		);
		const cancellableRuns = this.runRegistry.listAll({ includeConsumed: true, includeDetached: true })
			.filter((run) => !isTerminalRunStatus(run.status) && (
				idSet.has(run.controllerPiboSessionId)
				|| (run.controllerPiboSessionId === parentPiboSessionId && activeParentRunIds.has(run.runId))
			));
		const reason = `killed by parent ${parentPiboSessionId}`;
		await this.cancelRunsAfterSettlement(
			cancellableRuns.filter((run) => run.controllerPiboSessionId === parentPiboSessionId),
			reason,
		);
		await Promise.allSettled(ids.flatMap((id) => this.sessions.has(id)
			? [this.emit({ type: "execution", piboSessionId: id, action: "abort", id: randomUUID() })]
			: []));
		if (child.metadata?.agentStatus !== "killed") {
			this.sessionStore.update(agentId, {
				metadata: {
					...(child.metadata ?? {}),
					agentStatus: "killed",
					killedAt: new Date().toISOString(),
				},
			});
		}
		await this.disposeSessionSubtree(agentId, reason, { cancelRuns: true });
		const cancelledRuns = cancellableRuns.flatMap((run) => {
			const current = this.runRegistry.status(run.controllerPiboSessionId, run.runId);
			return current.status === "cancelled" ? [run.runId] : [];
		});
		return { agentId, killed: ids, cancelledRuns };
	}

	private async invokeRunCancellationHandler(run: PiboRunSnapshot): Promise<void> {
		const cancel = this.runCancellationHandlers.get(run.runId);
		if (!cancel) {
			const current = this.runRegistry.status(run.controllerPiboSessionId, run.runId);
			if (isTerminalRunStatus(current.status) || !this.activeRunExecutions.has(run.runId)) return;
			throw new PiboRunCancellationError(`Yielded run "${run.runId}" has active execution but does not expose a cancellation handler.`);
		}
		await cancel();
		if (this.runCancellationHandlers.get(run.runId) === cancel) this.runCancellationHandlers.delete(run.runId);
	}

	private async invokeRunCancellationHandlers(runs: readonly PiboRunSnapshot[]): Promise<void> {
		const results = await Promise.allSettled(runs.map((run) => this.invokeRunCancellationHandler(run)));
		const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
		if (failures.length > 0) throw new AggregateError(failures, "Failed to terminate yielded runs.");
	}

	private async cancelRunsAfterSettlement(runs: readonly PiboRunSnapshot[], reason: string): Promise<PiboRunSnapshot[]> {
		const results = await Promise.allSettled(runs.map(async (run) => {
			await this.invokeRunCancellationHandler(run);
			const current = this.runRegistry.status(run.controllerPiboSessionId, run.runId);
			return isTerminalRunStatus(current.status)
				? current
				: this.runRegistry.cancel(run.controllerPiboSessionId, run.runId, reason);
		}));
		const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
		if (failures.length > 0) throw new AggregateError(failures, "Failed to terminate yielded runs before cancellation settlement.");
		return results.flatMap((result) => result.status === "fulfilled" && result.value.status === "cancelled" ? [result.value] : []);
	}

	private createRunToolController(parentPiboSessionId: string): PiboRunToolController {
		return {
			startToolRun: ({ toolName, params, completionPolicy, retryable, maxAttempts, timeoutMs, serviceWarning, resources, execute, cancel }) => {
				const admission = this.gatewayWorkAdmission.reserve(`yielded run ${toolName}`, {
					sessionId: parentPiboSessionId,
					gatewaySettings: loadPiboGatewaySettings(),
				});
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
						origin: yieldedRunOrigin(this.sessions.get(parentPiboSessionId)?.getActiveMessage?.()),
					});
				} catch (error) {
					admission.release();
					throw error;
				}
				this.activeRunExecutions.add(run.runId);
				const cancellation: {
					state: "none" | "pending" | "confirmed" | "failed";
					decision?: Promise<void>;
				} = { state: "none" };
				let resolveRunTaskSettled: (() => void) | undefined;
				const runTaskSettled = new Promise<void>((resolve) => { resolveRunTaskSettled = resolve; });
				if (cancel) {
					let cancellationAttempt: Promise<void> | undefined;
					this.runCancellationHandlers.set(run.runId, () => {
						cancellationAttempt ??= (async () => {
							cancellation.state = "pending";
							let resolveDecision: (() => void) | undefined;
							cancellation.decision = new Promise<void>((resolve) => { resolveDecision = resolve; });
							try {
								await waitForRunCancellationSettlement(Promise.resolve().then(cancel));
								cancellation.state = "confirmed";
								resolveDecision?.();
								await waitForRunCancellationSettlement(runTaskSettled);
							} catch (error) {
								cancellation.state = "failed";
								throw error;
							} finally {
								resolveDecision?.();
							}
						})();
						return cancellationAttempt;
					});
				}

				void (async () => {
					try {
						const result = await execute(run.runId);
						if (resources) this.runRegistry.updateResources(run.runId, resources);
						const completed = this.runRegistry.complete(run.runId, result);
						if (completed) this.handleTerminalRunReminder(parentPiboSessionId, completed.runId, reminderGeneration);
					} catch (error) {
						if (error instanceof PiboRunCancelledError) {
							if (cancellation.state === "pending") await cancellation.decision;
							if (cancellation.state === "confirmed") return;
						}
						const message = error instanceof Error ? error.message : String(error);
						if (resources) this.runRegistry.updateResources(run.runId, resources);
						const terminalRun = error instanceof PiboRunExecutionTimeoutError
							? this.runRegistry.timeOut(run.runId, message, error.timeoutPhase)
							: error instanceof PiboRunResourceLimitError
								? this.runRegistry.resourceLimit(run.runId, message, error.resources)
								: this.runRegistry.fail(run.runId, message);
						if (terminalRun) this.handleTerminalRunReminder(parentPiboSessionId, terminalRun.runId, reminderGeneration);
					} finally {
						this.runCancellationHandlers.delete(run.runId);
						this.activeRunExecutions.delete(run.runId);
						admission.release();
						resolveRunTaskSettled?.();
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
				const current = this.runRegistry.status(parentPiboSessionId, runId);
				try {
					if (!isTerminalRunStatus(current.status)) await this.invokeRunCancellationHandlers([current]);
					return this.runRegistry.cancel(parentPiboSessionId, runId);
				} finally {
					this.refreshQueuedRunReminders(parentPiboSessionId);
				}
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
		sessionName: string,
		threadKey?: string,
	): PiboSession {
		const targetProfile = resolvePiboProfileNameFromRegistryOrDefault(this.pluginRegistry, subagent.targetProfile);
		const parent = this.resolvePiboSession(parentPiboSessionId);
		const resolvedThreadKey = resolveSubagentThreadKey(threadKey);
		const identityMetadata: PiboJsonObject = {
			subagentName: subagent.name,
			threadKey: resolvedThreadKey,
		};
		const metadata: PiboJsonObject = withWorkflowSessionKind({
			...identityMetadata,
			subagentToolName: "pibo_agents_send_message",
			agentStatus: "active",
		}, "subagent");
		const parentChatRoomId = typeof parent.metadata?.chatRoomId === "string" ? parent.metadata.chatRoomId : undefined;
		if (parentChatRoomId) metadata.chatRoomId = parentChatRoomId;
		const newSessionMetadata: PiboJsonObject = withPiboSessionModelFallbacksMetadata({
			...metadata,
			...(subagent.thinkingLevel ? { initialThinkingLevel: subagent.thinkingLevel } : {}),
			...(subagent.runtimeOptions && Object.keys(subagent.runtimeOptions).length > 0
				? { initialRuntimeOptions: structuredClone(subagent.runtimeOptions) }
				: {}),
		}, subagent.modelFallbacks ?? []);
		const existing = this.sessionStore.find({
			channel: "pibo.subagents",
			kind: "subagent",
			parentId: parent.id,
			profile: targetProfile,
			metadata: identityMetadata,
		}).find((candidate) => candidate.metadata?.agentStatus !== "killed");
		if (existing) {
			const updatedMetadata = withWorkflowSessionKind(
				{
					...(existing.metadata ?? {}),
					subagentToolName: "pibo_agents_send_message",
					agentStatus: "active",
					...(parentChatRoomId ? { chatRoomId: parentChatRoomId } : {}),
				},
				"subagent",
			);
			if (existing.title !== sessionName || JSON.stringify(updatedMetadata) !== JSON.stringify(existing.metadata ?? {})) {
				return this.sessionStore.update(existing.id, { title: sessionName, metadata: updatedMetadata }) ?? existing;
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
			title: sessionName,
			metadata: newSessionMetadata,
			activeModel: subagent.model,
		});
		this.signalRegistry.project({ type: "session_created", session: childSession });
		if (subagent.model) return childSession;
		const activeModel = resolvePiboSessionActiveModel({
			profile: childProfile,
			piboSession: childSession,
			parentPiSessionId: this.resolveSessionRuntimeBinding(parent).nativeSessionId ?? parent.id,
			modelDefaults: this.resolveModelDefaults(),
		});
		return activeModel ? this.sessionStore.update(childSession.id, { activeModel }) ?? childSession : childSession;
	}

	private recordAgentObservation(event: PiboOutputEvent, session: PiboSession | undefined): void {
		if (!session || session.kind !== "subagent" || session.channel !== "pibo.subagents" || !session.parentId) return;
		const name = typeof session.metadata?.subagentName === "string" ? session.metadata.subagentName : session.profile;
		const source = piboAgentObservationSourceFromEvent(event);
		const role = piboAgentObservationRole(source);
		const text = piboAgentObservationText(source);
		const provenance = "provenance" in event ? event.provenance : undefined;
		const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
		const requestId = provenance?.kind === "subagent-request"
			? provenance.requestId
			: eventId
				? this.subagentRequestIdsByEvent.get(subagentRequestEventKey(session.id, eventId))
				: undefined;
		const sequence = this.sessionStore.claimAgentObservationSequence?.(
			session.parentId,
			this.nextAgentObservationSequence,
		) ?? this.nextAgentObservationSequence;
		this.nextAgentObservationSequence = Math.max(this.nextAgentObservationSequence, sequence + 1);
		const observation: StoredAgentObservation = {
			managingParentId: session.parentId,
			sequence,
			createdAt: new Date().toISOString(),
			...(requestId ? { requestId } : {}),
			agentId: session.id,
			name,
			...(typeof session.metadata?.threadKey === "string" ? { threadKey: session.metadata.threadKey } : {}),
			eventType: event.type,
			kind: piboAgentObservationKind(event.type),
			...(role ? { role } : {}),
			...(text ? { text } : {}),
			...("toolName" in event && typeof event.toolName === "string" ? { toolName: event.toolName } : {}),
			...("toolCallId" in event && typeof event.toolCallId === "string" ? { toolCallId: event.toolCallId } : {}),
			...(event.type === "tool_execution_finished" ? { isError: event.isError } : event.type === "session_error" ? { isError: true } : {}),
			details: piboAgentObservationDetails(event),
		};
		this.agentObservations.push(observation);
		this.agentObservationHighWaterByParent.set(
			session.parentId,
			Math.max(this.agentObservationHighWaterByParent.get(session.parentId) ?? 0, sequence),
		);
		if (this.agentObservations.length > MAX_AGENT_OBSERVATIONS) {
			const evicted = this.agentObservations.splice(0, this.agentObservations.length - MAX_AGENT_OBSERVATIONS);
			for (const item of evicted) {
				this.agentObservationEvictedThroughByParent.set(
					item.managingParentId,
					Math.max(this.agentObservationEvictedThroughByParent.get(item.managingParentId) ?? 0, item.sequence),
				);
			}
		}
	}

	private readonly emitOutput = (event: PiboOutputEvent): void => {
		const positionedEvent = this.outputRenderSequencer.position(event);
		const session = this.sessionStore.get(positionedEvent.piboSessionId);
		this.recordAgentObservation(positionedEvent, session);
		this.telemetryRecorder?.recordOutput(positionedEvent, { session, status: this.sessions.get(positionedEvent.piboSessionId)?.getStatus() });
		this.signalRegistry.project({ type: "pibo_output", event: positionedEvent, session });
		this.pluginRegistry.notifyEvent(positionedEvent);
		for (const listener of this.listeners) {
			try {
				listener(positionedEvent);
			} catch (error) {
				console.error("[pibo] output listener failed", error);
			}
		}

		this.handleRunReminderOutput(positionedEvent);
		if (positionedEvent.type === "message_finished" && positionedEvent.source !== "service") {
			this.scheduleRunReminder(positionedEvent.piboSessionId, true);
		}
	};

	private handleRunReminderOutput(event: PiboOutputEvent): void {
		if (event.type === "message_finished") {
			const delivery = event.eventId ? this.runReminderDeliveries.get(event.eventId) : undefined;
			if (event.eventId) this.runReminderDeliveries.delete(event.eventId);
			if (delivery) {
				this.clearRunReminderRecovery(delivery);
				this.scheduleRunReminder(delivery.piboSessionId, false, delivery.generation);
			}
			return;
		}
		if (event.type === "session_error") {
			const eventId = event.eventId;
			if (!eventId) return;
			const delivery = this.runReminderDeliveries.get(eventId);
			if (!delivery) return;
			this.runReminderDeliveries.delete(eventId);
			if (event.errorDetails?.code === "loop_continuation_invalidated") {
				this.suppressRunReminderDelivery(delivery);
				return;
			}
			if (
				!isRunReminderContextPressureError(event)
				|| this.closing
				|| this.quiescingSessions.has(delivery.piboSessionId)
				|| delivery.generation !== this.runReminderGeneration(delivery.piboSessionId)
			) {
				this.runRegistry.releaseNotification(delivery.piboSessionId, delivery.notification);
				return;
			}

			if (this.hasRunReminderRecovery(delivery)) {
				this.suppressRunReminderDelivery(delivery);
				return;
			}

			this.runRegistry.releaseNotification(delivery.piboSessionId, delivery.notification);
			if (!this.runRegistry.hasPendingNotification(delivery.piboSessionId)) return;

			this.recordRunReminderRecovery(delivery);
			const alreadyDeferred = this.deferredRunReminders.get(delivery.piboSessionId) === delivery.generation;
			this.deferredRunReminders.set(delivery.piboSessionId, delivery.generation);
			this.sessions.get(delivery.piboSessionId)?.removeQueuedMessages(isRunReminderServiceMessage);
			if (!alreadyDeferred) this.queueRunReminderRecoveryCompaction(delivery.piboSessionId, delivery.generation);
			return;
		}
		if (event.type !== "compaction_end" || event.aborted || event.errorMessage) return;
		const generation = this.deferredRunReminders.get(event.piboSessionId);
		if (generation === undefined) return;
		this.deferredRunReminders.delete(event.piboSessionId);
		if (this.closing || this.quiescingSessions.has(event.piboSessionId)) return;
		if (generation !== this.runReminderGeneration(event.piboSessionId)) return;
		this.scheduleRunReminder(event.piboSessionId, true, generation);
	}

	private suppressRunReminderDelivery(delivery: RunReminderDelivery): void {
		const released = this.runRegistry.releaseNotification(delivery.piboSessionId, delivery.notification);
		for (const run of released) this.runRegistry.suppressNotification(delivery.piboSessionId, run.runId);
		this.clearRunReminderRecovery(delivery);
		this.deferredRunReminders.delete(delivery.piboSessionId);
		this.sessions.get(delivery.piboSessionId)?.removeQueuedMessages(isRunReminderServiceMessage);
		this.scheduleRunReminder(delivery.piboSessionId, false, delivery.generation);
	}

	private hasRunReminderRecovery(delivery: RunReminderDelivery): boolean {
		const recovery = this.runReminderRecoveries.get(delivery.piboSessionId);
		return recovery?.generation === delivery.generation
			&& recovery.groups.has(runReminderRecoveryGroupKey(delivery.notification));
	}

	private recordRunReminderRecovery(delivery: RunReminderDelivery): void {
		let recovery = this.runReminderRecoveries.get(delivery.piboSessionId);
		if (!recovery || recovery.generation !== delivery.generation) {
			recovery = { generation: delivery.generation, groups: new Set() };
			this.runReminderRecoveries.set(delivery.piboSessionId, recovery);
		}
		recovery.groups.add(runReminderRecoveryGroupKey(delivery.notification));
	}

	private clearRunReminderRecovery(delivery: RunReminderDelivery): void {
		const recovery = this.runReminderRecoveries.get(delivery.piboSessionId);
		if (!recovery || recovery.generation !== delivery.generation) return;
		recovery.groups.delete(runReminderRecoveryGroupKey(delivery.notification));
		if (recovery.groups.size === 0) this.runReminderRecoveries.delete(delivery.piboSessionId);
	}

	private queueRunReminderRecoveryCompaction(piboSessionId: string, generation: number): void {
		const session = this.sessions.get(piboSessionId);
		if (!session) return;
		const eventId = randomUUID();
		void session.executeAction({
			type: "execution",
			piboSessionId,
			id: eventId,
			action: "compact",
			params: {
				customInstructions: "Preserve the current task and pending yielded-run lifecycle, and leave enough context for the deferred run notification.",
			},
		}).catch((error) => {
			if (this.closing || this.quiescingSessions.has(piboSessionId)) return;
			if (generation !== this.runReminderGeneration(piboSessionId)) return;
			const message = error instanceof Error ? error.message : String(error);
			this.emitOutput({
				type: "session_error",
				piboSessionId,
				eventId,
				error: message,
				errorDetails: runtimeSessionErrorDetails(message),
			});
		});
	}

	private handleInterruptedRunReminders(messages: readonly PiboMessageEvent[]): void {
		for (const message of messages) {
			if (!isRunReminderServiceMessage(message) || !message.id) continue;
			const delivery = this.runReminderDeliveries.get(message.id);
			if (!delivery) continue;
			this.runReminderDeliveries.delete(message.id);
			this.runRegistry.releaseNotification(delivery.piboSessionId, delivery.notification);
		}
	}

	private projectKnownSessionSignals(): void {
		const sessions = this.sessionStore.list?.() ?? [];
		const depthBySessionId = new Map(sessions.map((session) => [session.id, this.getSubagentDepth(session.id)]));
		sessions.sort((left, right) => (depthBySessionId.get(left.id) ?? 0) - (depthBySessionId.get(right.id) ?? 0));
		for (const session of sessions) {
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
			this.deferredRunReminders.delete(piboSessionId);
			this.runReminderRecoveries.delete(piboSessionId);
			for (const [eventId, delivery] of this.runReminderDeliveries) {
				if (delivery.piboSessionId === piboSessionId) this.runReminderDeliveries.delete(eventId);
			}
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
		const deferredGeneration = this.deferredRunReminders.get(piboSessionId);
		if (deferredGeneration === expectedGeneration) return;
		if (deferredGeneration !== undefined) this.deferredRunReminders.delete(piboSessionId);
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

		let notification: PiboRunNotification | undefined;
		let eventId: string | undefined;
		try {
			const session = await this.getOrCreateSession(piboSessionId);
			if (this.closing || this.quiescingSessions.has(piboSessionId) || expectedGeneration !== this.runReminderGeneration(piboSessionId)) return;
			notification = this.runRegistry.createNotification(piboSessionId, { includeAlreadyNotified: scheduled.includeAlreadyNotified });
			if (!notification) return;
			eventId = randomUUID();
			this.runReminderDeliveries.set(eventId, { piboSessionId, generation: expectedGeneration, notification });
			session.enqueueMessage({
				type: "message",
				piboSessionId,
				text: formatRunReminderMessage(notification),
				source: "service",
				id: eventId,
				provenance: runReminderProvenance(notification),
			});
		} catch (error) {
			if (eventId) this.runReminderDeliveries.delete(eventId);
			if (notification) this.runRegistry.releaseNotification(piboSessionId, notification);
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
