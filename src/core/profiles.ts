import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export type ToolProfile = {
	name: string;
	description?: string;
	enabled?: boolean;
	yieldable?: boolean;
	pluginId?: string;
	definition?: ToolDefinition;
	providerTool?: ProviderToolProfile;
};

export type ProviderToolProfile = WebSearchProviderToolProfile;

export type WebSearchProviderToolProfile = {
	kind: "web_search";
	provider: "openai";
	options?: WebSearchProviderOptions;
};

export type SubagentProfile = {
	name: string;
	description?: string;
	targetProfile: string;
	enabled?: boolean;
	timeoutMs?: number;
	maxDepth?: number;
};

export type SkillSourceKind = "builtin" | "plugin" | "user";

export type SkillProfile = {
	name: string;
	path: string;
	enabled?: boolean;
	kind?: SkillSourceKind;
	pluginId?: string;
};

export type PiPackageProfile = {
	id: string;
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
	pluginId?: string;
	agentProfileName?: string;
};

export type BuiltinToolsMode = "default" | "disabled";
export const DEFAULT_BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;
export type BuiltinToolName = (typeof DEFAULT_BUILTIN_TOOL_NAMES)[number];

export type ToolPackageProfile = {
	runControl?: boolean;
	codexCompat?: boolean;
};

export type ModelProfile = {
	provider: string;
	id: string;
};

export type WebSearchProviderOptions = {
	externalWebAccess?: boolean;
	searchContextSize?: "low" | "medium" | "high";
	allowedDomains?: string[];
	blockedDomains?: string[];
	userLocation?: WebSearchProviderUserLocation;
	includeSources?: boolean;
};

export type WebSearchProviderUserLocation = {
	country?: string;
	region?: string;
	city?: string;
	timezone?: string;
};

export type InitialSessionContextOptions = {
	profileName: string;
	sessionId?: string;
	parentSessionId?: string;
	model?: ModelProfile;
	mainModel?: ModelProfile;
	subagentModel?: ModelProfile;
	skills?: readonly SkillProfile[];
	tools?: readonly ToolProfile[];
	subagents?: readonly SubagentProfile[];
	mcpServers?: readonly string[];
	piPackages?: readonly PiPackageProfile[];
	contextFiles?: readonly ContextFileProfile[];
	builtinTools?: BuiltinToolsMode;
	builtinToolNames?: readonly string[];
	autoContextFiles?: boolean;
	toolPackages?: ToolPackageProfile;
};

export class InitialSessionContext {
	readonly profileName: string;
	readonly sessionId?: string;
	readonly parentSessionId?: string;
	readonly model?: ModelProfile;
	readonly mainModel?: ModelProfile;
	readonly subagentModel?: ModelProfile;
	readonly skills: readonly SkillProfile[];
	readonly tools: readonly ToolProfile[];
	readonly subagents: readonly SubagentProfile[];
	readonly mcpServers: readonly string[];
	readonly piPackages: readonly PiPackageProfile[];
	readonly contextFiles: readonly ContextFileProfile[];
	readonly builtinTools: BuiltinToolsMode;
	readonly builtinToolNames: readonly string[];
	readonly autoContextFiles: boolean;
	readonly toolPackages: ToolPackageProfile;

	constructor(options: InitialSessionContextOptions) {
		this.profileName = options.profileName;
		this.sessionId = options.sessionId;
		this.parentSessionId = options.parentSessionId;
		this.model = options.model ? { ...options.model } : undefined;
		this.mainModel = options.mainModel ? { ...options.mainModel } : undefined;
		this.subagentModel = options.subagentModel ? { ...options.subagentModel } : undefined;
		this.skills = [...(options.skills ?? [])];
		this.tools = [...(options.tools ?? [])];
		this.subagents = [...(options.subagents ?? [])];
		this.mcpServers = [...(options.mcpServers ?? [])];
		this.piPackages = [...(options.piPackages ?? [])];
		this.contextFiles = [...(options.contextFiles ?? [])];
		this.builtinTools = options.builtinTools ?? "default";
		this.builtinToolNames = [...(options.builtinToolNames ?? DEFAULT_BUILTIN_TOOL_NAMES)];
		this.autoContextFiles = options.autoContextFiles ?? true;
		this.toolPackages = { ...(options.toolPackages ?? {}) };
	}
}

export class InitialSessionContextBuilder {
	private readonly profileName: string;
	private sessionId?: string;
	private parentSessionId?: string;
	private model?: ModelProfile;
	private mainModel?: ModelProfile;
	private subagentModel?: ModelProfile;
	private skills: SkillProfile[] = [];
	private tools: ToolProfile[] = [];
	private subagents: SubagentProfile[] = [];
	private mcpServers: string[] = [];
	private piPackages: PiPackageProfile[] = [];
	private contextFiles: ContextFileProfile[] = [];
	private builtinTools: BuiltinToolsMode = "default";
	private builtinToolNames: string[] = [...DEFAULT_BUILTIN_TOOL_NAMES];
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

	withModel(model: ModelProfile): this {
		this.model = { ...model };
		return this;
	}

	withMainModel(model: ModelProfile): this {
		this.mainModel = { ...model };
		return this;
	}

	withSubagentModel(model: ModelProfile): this {
		this.subagentModel = { ...model };
		return this;
	}

	withBuiltinTools(mode: BuiltinToolsMode): this {
		this.builtinTools = mode;
		return this;
	}

	withBuiltinToolNames(names: readonly string[]): this {
		this.builtinToolNames = [...names];
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

	withMcpServers(mcpServers: readonly string[]): this {
		this.mcpServers = [...mcpServers];
		return this;
	}

	withPiPackages(packages: readonly PiPackageProfile[]): this {
		this.piPackages = [...packages];
		return this;
	}

	addPiPackage(pkg: PiPackageProfile): this {
		this.piPackages.push(pkg);
		return this;
	}

	addPiPackages(packages: readonly PiPackageProfile[]): this {
		this.piPackages.push(...packages);
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
			model: this.model,
			mainModel: this.mainModel,
			subagentModel: this.subagentModel,
			skills: this.skills,
			tools: this.tools,
			subagents: this.subagents,
			mcpServers: this.mcpServers,
			piPackages: this.piPackages,
			contextFiles: this.contextFiles,
			builtinTools: this.builtinTools,
			builtinToolNames: this.builtinToolNames,
			autoContextFiles: this.autoContextFiles,
			toolPackages: this.toolPackages,
		});
	}
}
