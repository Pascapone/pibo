import type { PiboJsonObject, PiboJsonValue } from "../core/events.js";
import type { InitialSessionContext, ModelProfile } from "../core/profiles.js";
import type { PiboSession } from "../sessions/store.js";
import type { AgentRuntimeCapabilities, AgentRuntimeSessionCapabilities } from "./capabilities.js";
import type {
	AgentRuntimeApprovalRequest,
	AgentRuntimeEventListener,
	AgentRuntimeSemanticEvent,
	AgentRuntimeUserInputRequest,
} from "./events.js";

export type AgentRuntimeAdapterId = string;
export type AgentRuntimeInstanceId = string;

export type AgentRuntimeTransport = "embedded" | "stdio-rpc" | "socket-rpc" | "remote";

export type AgentRuntimeBindingState = "unbound" | "bound" | "missing" | "error";

export type AgentRuntimeBindingLocator = {
	kind: "local-file" | "local-directory" | "uri" | "remote" | "adapter-resolved";
	value?: string;
};

export type RuntimeSessionBinding = {
	piboSessionId: string;
	runtimeInstanceId: AgentRuntimeInstanceId;
	adapterId: AgentRuntimeAdapterId;
	nativeSessionId?: string;
	state: AgentRuntimeBindingState;
	protocol?: string;
	protocolVersion?: string;
	adapterVersion?: string;
	locator?: AgentRuntimeBindingLocator;
	metadata?: PiboJsonObject;
	revision?: number;
	createdAt?: string;
	updatedAt?: string;
};

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

export type AgentRuntimeProductContext = {
	piboSessionId: string;
	piboRoomId?: string;
	timezone?: string;
	getActiveMessage?: () => { id?: string; source?: string; provenance?: unknown } | undefined;
};

export type AgentRuntimeOpenServices = {
	subagentRunner?: unknown;
	runToolController?: unknown;
	codeRuntimeToolController?: unknown;
	telemetry?: unknown;
	compatibility?: unknown;
};

export type OpenAgentRuntimeSessionInput = {
	piboSession: PiboSession;
	profile: InitialSessionContext;
	binding?: RuntimeSessionBinding;
	workspace: string;
	activeModel?: ModelProfile;
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

export type AgentRuntimeDeliveryReport = {
	contributionId: string;
	status: "delivered" | "degraded" | "unsupported" | "failed";
	mode: string;
	fidelity: "exact" | "equivalent" | "lossy" | "none";
	target?: string;
	diagnostic?: string;
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

export type AgentRuntimeAuthStatus = {
	id: string;
	displayName?: string;
	configured: boolean;
	details?: PiboJsonObject;
};

export type AgentRuntimeHistoryEntry = {
	id: string;
	type: string;
	createdAt?: string;
	turnId?: string;
	role?: string;
	content?: PiboJsonValue;
	metadata?: PiboJsonObject;
};

export type AgentRuntimeHistoryPage = {
	entries: readonly AgentRuntimeHistoryEntry[];
	nextCursor?: string;
};

export type ReadAgentRuntimeHistoryInput = {
	binding: RuntimeSessionBinding;
	cursor?: string;
	limit?: number;
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
	readHistory?(input: ReadAgentRuntimeHistoryInput): Promise<AgentRuntimeHistoryPage>;
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
	getForkCandidates?(): AgentRuntimeForkCandidate[];
	forkSession?(entryId: string): Promise<AgentRuntimeSessionOperationResult>;
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

export interface AgentRuntimeSession {
	readonly adapterId: AgentRuntimeAdapterId;
	readonly runtimeInstanceId: AgentRuntimeInstanceId;
	readonly cwd: string;
	readonly capabilities: AgentRuntimeSessionCapabilities;
	readonly controls?: AgentRuntimeControls;
	readonly pendingApproval?: AgentRuntimeApprovalRequest;
	readonly pendingUserInput?: AgentRuntimeUserInputRequest;

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
