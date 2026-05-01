import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export type ToolProfile = {
	name: string;
	description?: string;
	enabled?: boolean;
	yieldable?: boolean;
	definition?: ToolDefinition;
};

export type SubagentProfile = {
	name: string;
	description?: string;
	targetProfile: string;
	enabled?: boolean;
	timeoutMs?: number;
	maxDepth?: number;
};

export type SkillProfile = {
	name: string;
	path: string;
	enabled?: boolean;
};

export type ContextFileScope = "global" | "agent";
export type ContextFileSource = "plugin" | "managed";

export type ContextFileProfile = {
	key?: string;
	path: string;
	label?: string;
	enabled?: boolean;
	scope?: ContextFileScope;
	source?: ContextFileSource;
	agentProfileName?: string;
};

export type BuiltinToolsMode = "default" | "disabled";

export type ToolPackageProfile = {
	runControl?: boolean;
};

export type InitialSessionContextOptions = {
	profileName: string;
	sessionId?: string;
	parentSessionId?: string;
	skills?: readonly SkillProfile[];
	tools?: readonly ToolProfile[];
	subagents?: readonly SubagentProfile[];
	contextFiles?: readonly ContextFileProfile[];
	builtinTools?: BuiltinToolsMode;
	autoContextFiles?: boolean;
	toolPackages?: ToolPackageProfile;
};

export class InitialSessionContext {
	readonly profileName: string;
	readonly sessionId?: string;
	readonly parentSessionId?: string;
	readonly skills: readonly SkillProfile[];
	readonly tools: readonly ToolProfile[];
	readonly subagents: readonly SubagentProfile[];
	readonly contextFiles: readonly ContextFileProfile[];
	readonly builtinTools: BuiltinToolsMode;
	readonly autoContextFiles: boolean;
	readonly toolPackages: ToolPackageProfile;

	constructor(options: InitialSessionContextOptions) {
		this.profileName = options.profileName;
		this.sessionId = options.sessionId;
		this.parentSessionId = options.parentSessionId;
		this.skills = [...(options.skills ?? [])];
		this.tools = [...(options.tools ?? [])];
		this.subagents = [...(options.subagents ?? [])];
		this.contextFiles = [...(options.contextFiles ?? [])];
		this.builtinTools = options.builtinTools ?? "default";
		this.autoContextFiles = options.autoContextFiles ?? true;
		this.toolPackages = { ...(options.toolPackages ?? {}) };
	}
}

export class InitialSessionContextBuilder {
	private readonly profileName: string;
	private sessionId?: string;
	private parentSessionId?: string;
	private skills: SkillProfile[] = [];
	private tools: ToolProfile[] = [];
	private subagents: SubagentProfile[] = [];
	private contextFiles: ContextFileProfile[] = [];
	private builtinTools: BuiltinToolsMode = "default";
	private autoContextFiles = true;
	private toolPackages: ToolPackageProfile = {};

	constructor(profileName: string) {
		this.profileName = profileName;
	}

	withSessionId(sessionId: string): this {
		this.sessionId = sessionId;
		return this;
	}

	withParentSessionId(parentSessionId: string): this {
		this.parentSessionId = parentSessionId;
		return this;
	}

	withBuiltinTools(mode: BuiltinToolsMode): this {
		this.builtinTools = mode;
		return this;
	}

	withAutoContextFiles(enabled: boolean): this {
		this.autoContextFiles = enabled;
		return this;
	}

	withToolPackages(packages: ToolPackageProfile): this {
		this.toolPackages = { ...packages };
		return this;
	}

	addSkill(skill: SkillProfile): this {
		this.skills.push(skill);
		return this;
	}

	addSkills(skills: readonly SkillProfile[]): this {
		this.skills.push(...skills);
		return this;
	}

	addTool(tool: ToolProfile): this {
		this.tools.push(tool);
		return this;
	}

	addTools(tools: readonly ToolProfile[]): this {
		this.tools.push(...tools);
		return this;
	}

	addSubagent(subagent: SubagentProfile): this {
		this.subagents.push(subagent);
		return this;
	}

	addSubagents(subagents: readonly SubagentProfile[]): this {
		this.subagents.push(...subagents);
		return this;
	}

	addContextFile(contextFile: ContextFileProfile): this {
		this.contextFiles.push(contextFile);
		return this;
	}

	addContextFiles(contextFiles: readonly ContextFileProfile[]): this {
		this.contextFiles.push(...contextFiles);
		return this;
	}

	createSession(): InitialSessionContext {
		return new InitialSessionContext({
			profileName: this.profileName,
			sessionId: this.sessionId,
			parentSessionId: this.parentSessionId,
			skills: this.skills,
			tools: this.tools,
			subagents: this.subagents,
			contextFiles: this.contextFiles,
			builtinTools: this.builtinTools,
			autoContextFiles: this.autoContextFiles,
			toolPackages: this.toolPackages,
		});
	}
}
