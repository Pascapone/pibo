import type { PiboOutputEvent, PiboSessionStatus } from "../core/events.js";
import type { PiboChannel } from "../channels/types.js";
import type { PiboAuthService } from "../auth/types.js";
import type { ContextFileProfile, InitialSessionContext, SkillProfile, ToolProfile } from "../core/profiles.js";

export type PiboProfileBuildContext = {
	getTool(name: string): ToolProfile;
	getTools(names: readonly string[]): ToolProfile[];
	getSkill(name: string): SkillProfile;
	getContextFile(key: string): ContextFileProfile;
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
};

export type PiboGatewayAction = {
	name: string;
	description?: string;
	slashCommands?: readonly string[];
	hidden?: boolean;
	execute(context: PiboGatewayActionContext): Promise<unknown> | unknown;
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
	registerSkill(skill: SkillProfile): void;
	registerContextFile(contextFile: ContextFileProfile): void;
	registerProfile(profile: PiboProfileDefinition): void;
	registerGatewayAction(action: PiboGatewayAction): void;
	registerChannel(channel: PiboChannel): void;
	registerAuthService(service: PiboAuthService): void;
	onEvent(listener: PiboPluginEventListener): void;
};

export type PiboPlugin = {
	id: string;
	name?: string;
	register(api: PiboPluginApi): void;
};
