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
	agentsController?: unknown;
	runToolController?: unknown;
	codeRuntimeToolController?: unknown;
	portableTools?: PiboPortableToolSession;
	resources?: PiboRuntimeResourceSession;
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
	validateProfile(input: ValidateAgentRuntimeProfileInput): readonly AgentRuntimeDiagnostic[];
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
	/** Read persisted fork candidates without opening a runtime; undefined retains the live fallback. */
	readForkCandidates?(input: ResolveAgentRuntimeBindingInput): Promise<AgentRuntimeForkCandidate[] | undefined>;
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
	setModel?(model: ModelProfile): Promise<ModelProfile>;
	compact?(customInstructions?: string): Promise<unknown>;
	respondToApproval?(requestId: string, decision: string): Promise<void>;
	respondToUserInput?(requestId: string, answers: PiboJsonObject): Promise<void>;
};

export type AgentRuntimeCompatibilityMetadata = {
	/** Deprecated product raw-event shape emitted while compatibility consumers migrate. */
	productRawEventType?: "pi_event";
};

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
