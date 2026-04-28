import type {
	PiboExecutionEvent,
	PiboForkCandidate,
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

export type PiboGatewayActionContext = {
	sessionKey: string;
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

export type PiboPluginApi = {
	registerTool(tool: ToolProfile): void;
	registerTools(tools: readonly ToolProfile[]): void;
	registerSubagent(subagent: SubagentProfile): void;
	registerSubagents(subagents: readonly SubagentProfile[]): void;
	registerSkill(skill: SkillProfile): void;
	registerContextFile(contextFile: ContextFileProfile): void;
	registerProfile(profile: PiboProfileDefinition): void;
	registerGatewayAction(action: PiboGatewayAction): void;
	registerChannel(channel: PiboChannel): void;
	registerAuthService(service: PiboAuthService): void;
	registerWebApp(app: PiboWebApp): void;
	onEvent(listener: PiboPluginEventListener): void;
};

export type PiboPlugin = {
	id: string;
	name?: string;
	register(api: PiboPluginApi): void;
};
