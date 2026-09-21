import type { PiboJsonObject } from "../core/events.js";
import type { InitialSessionContext, ModelProfile } from "../core/profiles.js";
import type { PiboPortableToolSession } from "../tools/session-service.js";
import type {
	AgentRuntimeDeliveryReport,
	PiboRuntimeResourceSession,
} from "./resources.js";
export type { AgentRuntimeDeliveryReport } from "./resources.js";
import type { PiboSession } from "../sessions/store.js";
import type {
	AgentRuntimeAdapterId,
	AgentRuntimeBindingLocator,
	AgentRuntimeBindingState,
	AgentRuntimeInstanceId,
	RuntimeSessionBinding,
} from "../sessions/runtime-binding.js";
export type {
	AgentRuntimeAdapterId,
	AgentRuntimeBindingLocator,
	AgentRuntimeBindingState,
	AgentRuntimeInstanceId,
	RuntimeSessionBinding,
} from "../sessions/runtime-binding.js";
import type { AgentRuntimeCapabilities, AgentRuntimeSessionCapabilities } from "./capabilities.js";
import type { AgentRuntimeHistoryHandoff } from "./portable-history.js";
export type {
	AgentRuntimeHistoryHandoff,
	AgentRuntimePortableHistory,
	AgentRuntimePortableHistoryCheckpoint,
	AgentRuntimePortableHistoryProvider,
	PersistedPortableHistoryHandoff,
} from "./portable-history.js";
import type {
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthStatus,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	StartAgentRuntimeAuthInput,
} from "./auth.js";
export type {
	AgentRuntimeAuthCatalog,
	AgentRuntimeAuthCompletionMode,
	AgentRuntimeAuthCredentialScope,
	AgentRuntimeAuthDetails,
	AgentRuntimeAuthMethodCapability,
	AgentRuntimeAuthMethodId,
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthPendingFlow,
	AgentRuntimeAuthState,
	AgentRuntimeAuthStatus,
	AgentRuntimeAuthTarget,
	AgentRuntimeAuthTargetOperationResult,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	StartAgentRuntimeAuthInput,
} from "./auth.js";
import type {
	AgentRuntimeApprovalRequest,
	AgentRuntimeEventListener,
	AgentRuntimeSemanticEvent,
	AgentRuntimeUserInputRequest,
} from "./events.js";
import type {
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryPage,
	AgentRuntimeHistoryReconciliationProof,
	InspectAgentRuntimeHistoryInput,
	ReadAgentRuntimeHistoryInput,
} from "./history.js";
export type {
	AgentRuntimeHistoryContentPart,
	AgentRuntimeHistoryEntry,
	AgentRuntimeHistoryInspection,
	AgentRuntimeHistoryMessageEntry,
	AgentRuntimeHistoryPage,
	AgentRuntimeHistorySource,
	InspectAgentRuntimeHistoryInput,
	ReadAgentRuntimeHistoryInput,
} from "./history.js";

export type AgentRuntimeTransport = "embedded" | "stdio-rpc" | "socket-rpc" | "remote";

export type AgentRuntimeDiagnosticSeverity = "info" | "warning" | "error";

export type AgentRuntimeDiagnostic = {
	severity: AgentRuntimeDiagnosticSeverity;
	code: string;
	message: string;
	path?: string;
	details?: PiboJsonObject;
};

export type AgentRuntimeAdapterDescriptor = {
	id: AgentRuntimeAdapterId;
	displayName: string;
	transport: AgentRuntimeTransport;
	configSchema: PiboJsonObject;
	capabilities: AgentRuntimeCapabilities;
	protocol?: {
		name: string;
		supportedRange?: string;
	};
	supportsMultipleInstances?: boolean;
};

export type AgentRuntimeInstanceDefinition = {
	id: AgentRuntimeInstanceId;
	adapterId: AgentRuntimeAdapterId;
	displayName?: string;
	enabled?: boolean;
	config?: PiboJsonObject;
};

export type AgentRuntimeInstanceInfo = {
	id: AgentRuntimeInstanceId;
	adapterId: AgentRuntimeAdapterId;
	displayName: string;
	enabled: boolean;
	transport: AgentRuntimeTransport;
	capabilities: AgentRuntimeCapabilities;
	configSchema: PiboJsonObject;
	protocol?: AgentRuntimeAdapterDescriptor["protocol"];
};

export type AgentRuntimeInstanceInspection = AgentRuntimeInstanceInfo & {
	available: boolean;
	diagnostics: AgentRuntimeDiagnostic[];
	models?: AgentRuntimeModelCatalog;
	auth?: AgentRuntimeAuthStatus[];
};

export type AgentRuntimeProductContext = {
	piboSessionId: string;
	piboRoomId?: string;
	timezone?: string;
	getActiveMessage?: () => { id?: string; source?: string; provenance?: unknown } | undefined;
};

/** Runtime-authorized opaque capability; structural look-alikes are rejected. */
export type AgentRuntimeBindingPersistence = {
	compareAndSet(
		binding: RuntimeSessionBinding,
		expectedRevision: number,
	): Promise<RuntimeSessionBinding>;
};

export type AgentRuntimeOpenServices = {
	portableTools?: PiboPortableToolSession;
	resources?: PiboRuntimeResourceSession;
	/** Read-through projection over the one product PluginHost; adapters must not create their own registry. */
	capabilityHost?: import("../core/capability-host.js").PiboCapabilityHost;
	runtimeBindingPersistence?: AgentRuntimeBindingPersistence;
	telemetry?: unknown;
	compatibility?: unknown;
};

export type OpenAgentRuntimeSessionInput = {
	piboSession: PiboSession;
	profile: InitialSessionContext;
	binding?: RuntimeSessionBinding;
	workspace: string;
	activeModel?: ModelProfile;
	historyHandoff?: AgentRuntimeHistoryHandoff;
	productContext: AgentRuntimeProductContext;
	services?: AgentRuntimeOpenServices;
};

export type ValidateAgentRuntimeProfileInput = {
	profile: InitialSessionContext;
	workspace?: string;
	/** Effective model selected for this concrete session, including persisted overrides. */
	activeModel?: ModelProfile;
};

export type InspectAgentRuntimeProfileInput = ValidateAgentRuntimeProfileInput & {
	productContext?: AgentRuntimeProductContext;
};

export type AgentRuntimeAssemblyInspection = {
	runtimeInstanceId: AgentRuntimeInstanceId;
	adapterId: AgentRuntimeAdapterId;
	capabilities: AgentRuntimeCapabilities;
	diagnostics: AgentRuntimeDiagnostic[];
	delivery: AgentRuntimeDeliveryReport[];
};

export type AgentRuntimeModelInfo = {
	id: string;
	provider?: string;
	displayName?: string;
	reasoningOptions?: readonly string[];
	options?: PiboJsonObject;
};

export type AgentRuntimeModelCatalog = {
	runtimeInstanceId: AgentRuntimeInstanceId;
	models: readonly AgentRuntimeModelInfo[];
	diagnostics?: readonly AgentRuntimeDiagnostic[];
};

export type ResolveAgentRuntimeBindingInput = {
	binding: RuntimeSessionBinding;
	workspace: string;
};

export interface AgentRuntimeAdapter {
	readonly instanceId: AgentRuntimeInstanceId;
	readonly descriptor: AgentRuntimeAdapterDescriptor;
	readonly config: PiboJsonObject;
	readonly displayName: string;
	readonly enabled: boolean;

	diagnose(): Promise<readonly AgentRuntimeDiagnostic[]>;
	validateProfile(input: ValidateAgentRuntimeProfileInput): readonly AgentRuntimeDiagnostic[] | Promise<readonly AgentRuntimeDiagnostic[]>;
	openSession(input: OpenAgentRuntimeSessionInput): Promise<AgentRuntimeSession>;
	inspectProfile?(input: InspectAgentRuntimeProfileInput): Promise<AgentRuntimeAssemblyInspection>;
	listModels?(): Promise<AgentRuntimeModelCatalog>;
	getAuthStatus?(): Promise<readonly AgentRuntimeAuthStatus[]>;
	startAuth?(input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult>;
	completeAuth?(input: CompleteAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult>;
	cancelAuth?(input: CancelAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult>;
	logoutAuth?(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult>;
	disposeAuth?(): Promise<void>;
	inspectHistory?(input: InspectAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryInspection>;
	readHistory?(input: ReadAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryPage>;
	/** Verify adapter-owned proof identity without teaching Core about concrete runtime implementations. */
	isHistoryReconciliationProof?(proof: AgentRuntimeHistoryReconciliationProof): boolean;
	/** Read persisted fork candidates without opening a runtime; undefined retains the live fallback. */
	readForkCandidates?(input: ResolveAgentRuntimeBindingInput): Promise<AgentRuntimeForkCandidate[] | undefined>;
	/**
	 * Recheck a bound or missing native identity in adapter-owned storage.
	 * Returning `missing` is authoritative absence and may admit checkpointed same-runtime reconstruction;
	 * auth, permission, corruption, ambiguity, unavailability, and transient failures must throw instead.
	 */
	resolveBinding?(input: ResolveAgentRuntimeBindingInput): Promise<RuntimeSessionBinding>;
}

export type AgentRuntimeDriverCreateInput<TConfig> = {
	instanceId: AgentRuntimeInstanceId;
	displayName?: string;
	enabled: boolean;
	config: TConfig;
};

export interface AgentRuntimeDriver<TConfig = PiboJsonObject> {
	readonly descriptor: AgentRuntimeAdapterDescriptor;
	defaultConfig(): TConfig;
	parseConfig(value: PiboJsonObject): TConfig;
	create(input: AgentRuntimeDriverCreateInput<TConfig>): AgentRuntimeAdapter;
}

export type AgentRuntimePromptSource = "interactive" | "rpc";

export type AgentRuntimePromptInput = {
	text: string;
	source: AgentRuntimePromptSource;
	capabilityScope?: string;
};

export type AgentRuntimeContextUsage = {
	tokens?: number;
	contextWindow?: number;
	percent?: number;
} | null;

export type AgentRuntimeProviderUsage = {
	provider?: string;
	planType?: string;
	limits?: readonly { label?: string; usedPercent?: number; remainingPercent?: number; resetsAt?: string }[];
	credits?: { unlimited?: boolean; balance?: string };
} | null;

export type AgentRuntimeStatus = {
	streaming: boolean;
	enabledTools: readonly string[];
	cwd: string;
	activeModel?: ModelProfile;
	reasoning?: {
		value?: string;
		availableValues?: readonly string[];
		supported: boolean;
	};
	fastMode?: {
		mode: "fast" | "normal";
		supported: boolean;
	};
	sandbox?: {
		supported: boolean;
		enabled: boolean;
		mode?: string;
	};
	retry?: PiboJsonObject;
	contextUsage?: AgentRuntimeContextUsage;
	providerUsage?: AgentRuntimeProviderUsage;
	warnings?: readonly string[];
	errors?: readonly string[];
};

export type AgentRuntimeNativeSessionSnapshot = {
	adapterId: AgentRuntimeAdapterId;
	runtimeInstanceId: AgentRuntimeInstanceId;
	nativeSessionId?: string;
	locator?: AgentRuntimeBindingLocator;
	leafId?: string | null;
	cwd: string;
	name?: string;
	parentLocator?: AgentRuntimeBindingLocator;
	metadata?: PiboJsonObject;
};

export type AgentRuntimeNativeSessionInfo = AgentRuntimeNativeSessionSnapshot & {
	createdAt?: string;
	updatedAt?: string;
	messageCount?: number;
	firstMessage?: string;
};

export type AgentRuntimeForkCandidate = {
	entryId: string;
	text: string;
};

export type AgentRuntimeSessionOperationResult = {
	previous: AgentRuntimeNativeSessionSnapshot;
	current: AgentRuntimeNativeSessionSnapshot;
	cancelled: boolean;
	sourceSessionUnchanged?: boolean;
	selectedText?: string;
	editorText?: string;
	summaryEntryId?: string;
};

export type AgentRuntimeSessionTreeNode = {
	entry: PiboJsonObject;
	children: AgentRuntimeSessionTreeNode[];
	label?: string;
	labelTimestamp?: string;
};

export type AgentRuntimeSessionTree = {
	current: AgentRuntimeNativeSessionSnapshot;
	tree: AgentRuntimeSessionTreeNode[];
};

export type AgentRuntimeReasoningResult = {
	value?: string;
	availableValues: string[];
	supported: boolean;
};

export type AgentRuntimeFastModeResult = {
	mode: "fast" | "normal";
	supported: boolean;
	changed?: boolean;
};

export type AgentRuntimeSandboxResult = {
	supported: boolean;
	enabled: boolean;
	mode?: string;
	/**
	 * Effective sandboxed-network posture of this host (Muse: the --sandbox-network
	 * value). Absent means the engine default applies, or the sandbox is disabled
	 * and the network is inherently open.
	 */
	network?: string;
	changed?: boolean;
	restarted?: boolean;
	warning?: string;
};

export type AgentRuntimeControls = {
	getCurrentSession?(): AgentRuntimeNativeSessionSnapshot;
	listSessions?(): Promise<AgentRuntimeNativeSessionInfo[]>;
	getForkCandidates?(): AgentRuntimeForkCandidate[] | Promise<AgentRuntimeForkCandidate[]>;
	getForkCandidatesWhileRunning?(): AgentRuntimeForkCandidate[] | Promise<AgentRuntimeForkCandidate[]>;
	forkSession?(entryId: string): Promise<AgentRuntimeSessionOperationResult>;
	forkSessionWhileRunning?(entryId: string): Promise<AgentRuntimeSessionOperationResult>;
	cloneSession?(): Promise<AgentRuntimeSessionOperationResult>;
	getSessionTree?(): AgentRuntimeSessionTree;
	navigateSessionTree?(params: PiboJsonObject): Promise<AgentRuntimeSessionOperationResult>;
	switchSession?(params: PiboJsonObject): Promise<AgentRuntimeSessionOperationResult>;
	getReasoning?(): AgentRuntimeReasoningResult;
	setReasoning?(value: string): AgentRuntimeReasoningResult;
	cycleReasoning?(): AgentRuntimeReasoningResult;
	getFastMode?(): AgentRuntimeFastModeResult;
	setFastMode?(enabled: boolean): AgentRuntimeFastModeResult;
	getSandbox?(): AgentRuntimeSandboxResult;
	setSandbox?(enabled: boolean): Promise<AgentRuntimeSandboxResult>;
	setModel?(model: ModelProfile): Promise<ModelProfile>;
	compact?(customInstructions?: string): Promise<unknown>;
	respondToApproval?(requestId: string, decision: string): Promise<void>;
	respondToUserInput?(requestId: string, answers: PiboJsonObject): Promise<void>;
};

export type AgentRuntimeCompatibilityMetadata = {
	/** Deprecated product raw-event shape emitted while compatibility consumers migrate. */
	productRawEventType?: "pi_event";
};

/**
 * Session lifecycle contract (K01). Read against the Pi, Codex-native,
 * Muse-native, OMP and Fake adapters; shared rules and per-adapter
 * differences are explicit. Pinned by `test/b1-k01-contract.test.mjs`
 * (Fake behavior, labeled as such) and
 * `test/b1-real-adapter-contract.test.mjs` (real adapter/turn objects).
 *
 * Terminals: at most one terminal event (`turn_completed` xor `turn_failed`)
 * per accepted turn after `turn_started`. `error`/`warning` are diagnostics,
 * not terminals: Pi emits `error` plus `turn_failed` for one failure. OMP
 * local-only turns resolve with no events at all.
 *
 * `prompt()` settles after the turn reaches a terminal state or the turn
 * machinery fails. Whether it additionally REJECTS on failure is
 * adapter- and path-defined: Pi resolves every turn outcome and rejects
 * only enqueue errors; Codex/Muse resolve native terminals (including
 * failed/interrupted) and reject on diagnostic/process/protocol/dispose
 * failures; OMP resolves local and agent_end terminals, resolves without
 * any terminal event on its hard stream deadline, and rejects on protocol
 * failure/dispose; Fake rejects scripted failures. New consumers
 * must derive success/failure from the terminal EVENTS, never from promise
 * settlement alone. The router accepts both styles and dedups via its
 * failure flag.
 *
 * `abort()` REQUESTS cancellation; it does not define the terminal. Pi emits
 * no terminal for a cancelled turn; Fake emits `turn_completed/aborted`
 * synchronously from `abort()` itself; Codex delivers its legitimate
 * `interrupted` terminal asynchronously AFTER `abort()` returns; Muse waits
 * for settlement (bounded, forced local settle on timeout). Never filter
 * events or derive completion from the `abort()` return alone.
 *
 * `dispose()` is idempotent everywhere and ends event delivery; after it
 * settles, no new events are delivered. Dispose during a turn is
 * adapter-defined: Pi emits `turn_failed` for the active message and
 * resolves the prompt; Codex/OMP drop the pending turn and reject the
 * prompt; Muse settles the turn. Resource/credential cleanup lives with
 * `PiboRuntimeResourceSession.dispose()`, not with this handle.
 *
 * `abort()` with no active turn delivers no events (OMP still sends an
 * ineffectual abort request). After `dispose()`, `abort()`
 * throws on Codex/Muse/OMP, is a no-op on Fake, and resolves without effect
 * on Pi (pass-through to the idle harness); `prompt()` throws on
 * Pi/Codex/Muse/OMP after dispose, and `subscribe()` throws on
 * Codex/Muse/OMP but not on Pi/Fake.
 */
export interface AgentRuntimeSession {
	readonly adapterId: AgentRuntimeAdapterId;
	readonly runtimeInstanceId: AgentRuntimeInstanceId;
	readonly cwd: string;
	readonly capabilities: AgentRuntimeSessionCapabilities;
	readonly compatibility?: AgentRuntimeCompatibilityMetadata;
	readonly controls?: AgentRuntimeControls;
	readonly pendingApproval?: AgentRuntimeApprovalRequest;
	readonly pendingUserInput?: AgentRuntimeUserInputRequest;
	readonly pendingApprovals?: readonly AgentRuntimeApprovalRequest[];
	readonly pendingUserInputs?: readonly AgentRuntimeUserInputRequest[];

	getBinding(): RuntimeSessionBinding;
	subscribe(listener: AgentRuntimeEventListener): () => void;
	prompt(input: AgentRuntimePromptInput): Promise<void>;
	steer?(input: AgentRuntimePromptInput): Promise<void>;
	abort(): Promise<void>;
	dispose(): Promise<void>;
	getStatus(): AgentRuntimeStatus;
	getStatusSnapshot?(): Promise<AgentRuntimeStatus>;
	getNativeCompatibilityHandle?(): unknown;
}

export function isAgentRuntimeSemanticEvent(value: unknown): value is AgentRuntimeSemanticEvent {
	return Boolean(value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string");
}
