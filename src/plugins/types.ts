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
import type { PiboThinkingLevel } from "../core/thinking.js";
import type { PiboChannel } from "../channels/types.js";
import type { PiboAuthService } from "../auth/types.js";
import type { PiboWebApp } from "../web/types.js";
import type {
	ContextFileProfile,
	BuiltinToolsMode,
	InitialSessionContext,
	SkillProfile,
	SubagentProfile,
	ToolProfile,
} from "../core/profiles.js";

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
	nativeTools: string[];
	skills: string[];
	contextFiles: string[];
	subagents: SubagentProfile[];
	builtinTools: BuiltinToolsMode;
	autoContextFiles: boolean;
	runControl: boolean;
};

export type PiboNativeToolInfo = {
	name: string;
	description?: string;
	yieldable: boolean;
	hasDefinition: boolean;
};

export type PiboSkillInfo = {
	name: string;
	path: string;
};

export type PiboSubagentInfo = {
	name: string;
	description?: string;
	targetProfile: string;
	timeoutMs?: number;
	maxDepth?: number;
};

export type PiboContextFileInfo = {
	key: string;
	label?: string;
	path: string;
	scope?: "global" | "agent";
	source?: "plugin" | "managed";
	agentProfileName?: string;
};

export type PiboCapabilityPackageInfo = {
	name: string;
	description: string;
	toolNames: string[];
};

export type PiboCapabilityCatalog = {
	nativeTools: PiboNativeToolInfo[];
	skills: PiboSkillInfo[];
	subagents: PiboSubagentInfo[];
	contextFiles: PiboContextFileInfo[];
	packages: PiboCapabilityPackageInfo[];
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
	getStatus(): PiboSessionStatus;
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
	setThinkingLevel(level: PiboThinkingLevel): PiboThinkingResult;
	cycleThinkingLevel(): PiboThinkingResult;
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
	registerTool(tool: ToolProfile): void;
	registerTools(tools: readonly ToolProfile[]): void;
	registerSubagent(subagent: SubagentProfile): void;
	registerSubagents(subagents: readonly SubagentProfile[]): void;
	registerSkill(skill: SkillProfile): void;
	registerContextFile(contextFile: ContextFileProfile): void;
	upsertContextFile(contextFile: ContextFileProfile): void;
	removeContextFile(key: string): void;
	registerProfile(profile: PiboProfileDefinition): void;
	registerGatewayAction(action: PiboGatewayAction): void;
	registerChannel(channel: PiboChannel): void;
	registerAuthService(service: PiboAuthService): void;
	registerWebApp(app: PiboWebApp): void;
	onEvent(listener: PiboPluginEventListener): void;
	emitProductEvent(event: PiboProductEventInput): PiboProductEvent;
	onProductEvent(listener: PiboProductEventListener): () => void;
};

export type PiboPlugin = {
	id: string;
	name?: string;
	register(api: PiboPluginApi): void;
};
