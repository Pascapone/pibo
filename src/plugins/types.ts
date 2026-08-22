import type {
	PiboExecutionEvent,
	PiboForkCandidate,
	PiboJsonObject,
	PiboOutputEvent,
	PiboSessionListItem,
	PiboSessionOperationResult,
	PiboSessionStatus,
	PiboSessionSwitchParams,
	PiboSessionTreeNavigateParams,
	PiboSessionTreeResult,
	PiboThinkingResult,
} from "../core/events.js";
import type { CompactionResult } from "@earendil-works/pi-coding-agent";
import type { ContextUsage } from "@earendil-works/pi-coding-agent";
import type { PiboThinkingLevel } from "../core/thinking.js";
import type { PiboChannel } from "../channels/types.js";
import type { PiboAuthService } from "../auth/types.js";
import type { PiboWebApp } from "../web/types.js";
import type {
	ContextFileProfile,
	BuiltinToolsMode,
	InitialSessionContext,
	ModelProfile,
	ProviderToolProfile,
	SkillSourceKind,
	SkillProfile,
	SubagentProfile,
	ToolProfile,
	ToolProfileRegistration,
} from "../core/profiles.js";
import type { PiboPiPackageInfo } from "../pi-packages/types.js";
import type { PiboProviderUsageStatus } from "../auth/openai-codex-usage.js";
import type { PiboTranscriptionProvider } from "../transcription/types.js";
import type { PiboLoopStopConditionDefinition, PiboLoopStopConditionInfo } from "../loops/types.js";
import type {
	AgentRuntimeAuthOperationResult,
	AgentRuntimeAuthStatus,
	AgentRuntimeDriver,
	AgentRuntimeInstanceDefinition,
	AgentRuntimeInstanceInfo,
	AgentRuntimeModelCatalog,
	CancelAgentRuntimeAuthInput,
	CompleteAgentRuntimeAuthInput,
	LogoutAgentRuntimeAuthInput,
	StartAgentRuntimeAuthInput,
} from "../agent-runtime/types.js";
export type { PiboLoopStopConditionDefinition, PiboLoopStopConditionInfo } from "../loops/types.js";
/** @deprecated Use PiboLoopStopConditionDefinition. */
export type PiboRalphStopConditionDefinition = PiboLoopStopConditionDefinition;
/** @deprecated Use PiboLoopStopConditionInfo. */
export type PiboRalphStopConditionInfo = PiboLoopStopConditionInfo;

export type PiboProfileBuildContext = {
	getTool(name: string): ToolProfile;
	getTools(names: readonly string[]): ToolProfile[];
	getSkill(name: string): SkillProfile;
	getContextFile(key: string): ContextFileProfile;
	getSubagent(name: string): SubagentProfile;
	getSubagents(names: readonly string[]): SubagentProfile[];
};

export type PiboProfileDefinition = {
	name: string;
	aliases?: readonly string[];
	description?: string;
	create(context: PiboProfileBuildContext): InitialSessionContext;
};

export type PiboProfileInfo = {
	name: string;
	description?: string;
	aliases: string[];
	runtimeInstanceId: string;
	runtimeOptions: PiboJsonObject;
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: SubagentProfile[];
	mcpServers: string[];
	piPackages: string[];
	model?: ModelProfile;
	mainModel?: ModelProfile;
	subagentModel?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	mainThinkingLevel?: PiboThinkingLevel;
	subagentThinkingLevel?: PiboThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	builtinTools: BuiltinToolsMode;
	builtinToolNames: string[];
	autoContextFiles: boolean;
	nativeSubagents?: boolean;
	runControl: boolean;
	goalControl: boolean;
};

export type PiboNativeToolInfo = {
	name: string;
	description?: string;
	yieldable: boolean;
	hasDefinition: boolean;
	portable: boolean;
	pluginId?: string;
	pluginName?: string;
	providerTool?: ProviderToolProfile;
};

export type PiboSkillInfo = {
	name: string;
	path: string;
	kind: SkillSourceKind;
	pluginId?: string;
	pluginName?: string;
};

export type PiboSubagentInfo = {
	name: string;
	description?: string;
	targetProfile: string;
	model?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	timeoutMs?: number;
	maxDepth?: number;
};

export type PiboContextFileInfo = {
	key: string;
	label?: string;
	path: string;
	scope?: "global" | "agent";
	source?: "plugin" | "managed";
	pluginId?: string;
	pluginName?: string;
	agentProfileName?: string;
};

export type PiboCapabilityPackageInfo = {
	name: string;
	description: string;
	toolNames: string[];
	pluginId?: string;
	pluginName?: string;
};

export type PiboCliToolContextInfo = {
	name: string;
	description: string;
	snippet: string;
};

export type PiboMcpServerInfo = {
	name: string;
	transport: "stdio" | "http";
	description?: string;
	descriptionSource?: "user" | "registry";
	hasDescription: boolean;
	editable: boolean;
};

export type PiboCapabilityCatalog = {
	agentRuntimes: AgentRuntimeInstanceInfo[];
	nativeTools: PiboNativeToolInfo[];
	skills: PiboSkillInfo[];
	subagents: PiboSubagentInfo[];
	contextFiles: PiboContextFileInfo[];
	packages: PiboCapabilityPackageInfo[];
	piboTools: PiboCliToolContextInfo[];
	mcpServers: PiboMcpServerInfo[];
	piPackages: PiboPiPackageInfo[];
	loopStopConditions: PiboLoopStopConditionInfo[];
	/** @deprecated Use loopStopConditions. */
	ralphStopConditions: PiboLoopStopConditionInfo[];
};

export type PiboProductEventSource = "core" | "plugin" | "web" | "filesystem" | "agent";

export type PiboProductEventInput = {
	type: string;
	source: PiboProductEventSource;
	actorId?: string;
	payload: PiboJsonObject;
	id?: string;
	createdAt?: string;
};

export type PiboProductEvent = PiboProductEventInput & {
	id: string;
	createdAt: string;
};

export type PiboGatewayActionContext = {
	piboSessionId: string;
	runtimeInstanceId: string;
	runtimeAuthRequired: boolean;
	getStatus(): PiboSessionStatus;
	getStatusSnapshot(): Promise<PiboSessionStatus>;
	getContextUsage(): ContextUsage | undefined;
	getActiveModel(): ModelProfile | undefined;
	getModelCatalog(): Promise<AgentRuntimeModelCatalog | undefined>;
	getRuntimeAuthStatus(): Promise<readonly AgentRuntimeAuthStatus[]>;
	startRuntimeAuth(input: StartAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult>;
	completeRuntimeAuth(input: CompleteAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult>;
	cancelRuntimeAuth(input: CancelAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult>;
	logoutRuntimeAuth(input: LogoutAgentRuntimeAuthInput): Promise<AgentRuntimeAuthOperationResult>;
	getProviderUsage(): Promise<PiboProviderUsageStatus | undefined>;
	clearQueue(): number;
	abort(): Promise<void>;
	dispose(): Promise<void>;
	getCurrentSession(): PiboSessionOperationResult["current"];
	listSessions(): Promise<PiboSessionListItem[]>;
	getForkCandidates(): PiboForkCandidate[];
	forkSession(entryId: string): Promise<PiboSessionOperationResult>;
	cloneSession(): Promise<PiboSessionOperationResult>;
	getSessionTree(): PiboSessionTreeResult;
	navigateSessionTree(params: PiboSessionTreeNavigateParams): Promise<PiboSessionOperationResult>;
	switchSession(params: PiboSessionSwitchParams): Promise<PiboSessionOperationResult>;
	getThinkingLevel(): PiboThinkingResult;
	setThinkingLevel(level: PiboThinkingLevel): PiboThinkingResult;
	cycleThinkingLevel(): PiboThinkingResult;
	getFastMode(): { mode: "fast" | "normal"; supported: boolean };
	setFastMode(enabled: boolean): { mode: "fast" | "normal"; supported: boolean; changed: boolean };
	setModel(model: ModelProfile): Promise<ModelProfile>;
	compact(customInstructions?: string): Promise<CompactionResult>;
	respondToApproval(requestId: string, decision: string): Promise<void>;
	respondToUserInput(requestId: string, answers: PiboJsonObject): Promise<void>;
	kill(): Promise<{ killed: string[]; cancelledRuns: string[] }>;
	killAll(): Promise<{ killed: string[]; cancelledRuns: string[] }>;
};

export type PiboGatewayAction = {
	name: string;
	description?: string;
	slashCommands?: readonly string[];
	hidden?: boolean;
	execute(context: PiboGatewayActionContext, event: PiboExecutionEvent): Promise<unknown> | unknown;
};

export type PiboGatewayActionInfo = {
	name: string;
	description?: string;
	slashCommands: string[];
};

export type PiboPluginEventListener = (event: PiboOutputEvent) => void;
export type PiboProductEventListener = (event: PiboProductEvent) => void;

export type PiboPluginApi = {
	registerAgentRuntimeDriver<TConfig>(driver: AgentRuntimeDriver<TConfig>): void;
	registerAgentRuntimeInstance(instance: AgentRuntimeInstanceDefinition): void;
	registerTool(tool: ToolProfileRegistration): void;
	registerTools(tools: readonly ToolProfileRegistration[]): void;
	registerSubagent(subagent: SubagentProfile): void;
	registerSubagents(subagents: readonly SubagentProfile[]): void;
	registerSkill(skill: SkillProfile): void;
	registerContextFile(contextFile: ContextFileProfile): void;
	upsertContextFile(contextFile: ContextFileProfile): void;
	removeContextFile(key: string): void;
	registerProfile(profile: PiboProfileDefinition): void;
	upsertProfile(profile: PiboProfileDefinition): void;
	registerGatewayAction(action: PiboGatewayAction): void;
	registerChannel(channel: PiboChannel): void;
	registerAuthService(service: PiboAuthService): void;
	registerTranscriptionProvider(provider: PiboTranscriptionProvider): void;
	registerWebApp(app: PiboWebApp): void;
	registerCapabilityPackage(pkg: PiboCapabilityPackageInfo): void;
	registerLoopStopCondition(condition: PiboLoopStopConditionDefinition): void;
	/** @deprecated Use registerLoopStopCondition. */
	registerRalphStopCondition(condition: PiboLoopStopConditionDefinition): void;
	onEvent(listener: PiboPluginEventListener): void;
	emitProductEvent(event: PiboProductEventInput): PiboProductEvent;
	onProductEvent(listener: PiboProductEventListener): () => void;
};

export type PiboPlugin = {
	id: string;
	name?: string;
	register(api: PiboPluginApi): void;
};
