import type { PiboJsonObject } from "./events.js";
import type { PiboThinkingLevel } from "./thinking.js";
import {
	normalizePiboToolDefinition,
	type LegacyPiToolDefinitionLike,
	type PiboToolDefinition,
	type PiboToolDefinitionContext,
} from "../tools/contract.js";

/** @deprecated Use PiboToolDefinitionContext from tools/contract. */
export type ToolDefinitionContext = PiboToolDefinitionContext;

export type ToolProfile = {
	name: string;
	description?: string;
	enabled?: boolean;
	yieldable?: boolean;
	pluginId?: string;
	definition?: PiboToolDefinition;
	createDefinition?: (context: ToolDefinitionContext) => PiboToolDefinition;
	providerTool?: ProviderToolProfile;
	builtInPiboTool?: "runtime" | "codex_browser";
};

/** Compatibility input accepted from plugins that still register Pi-shaped definitions. */
export type ToolProfileRegistration = Omit<ToolProfile, "definition" | "createDefinition"> & {
	definition?: PiboToolDefinition | LegacyPiToolDefinitionLike;
	createDefinition?: (
		context: ToolDefinitionContext,
	) => PiboToolDefinition | LegacyPiToolDefinitionLike;
};

export function normalizeToolProfile(tool: ToolProfileRegistration): ToolProfile {
	const { definition, createDefinition, ...profile } = tool;
	return {
		...profile,
		...(definition ? { definition: normalizePiboToolDefinition(definition) } : {}),
		...(createDefinition
			? {
				createDefinition: (context: ToolDefinitionContext) => normalizePiboToolDefinition(createDefinition(context)),
			}
			: {}),
	};
}

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
	model?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	runtimeOptions?: PiboJsonObject;
	enabled?: boolean;
	/** @deprecated Compatibility-only. Does not limit delegated request or yielded-run lifetime. */
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
export const DEFAULT_AGENT_RUNTIME_INSTANCE_ID = "pi";
export const DEFAULT_BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;
export type BuiltinToolName = (typeof DEFAULT_BUILTIN_TOOL_NAMES)[number];

export type ToolPackageProfile = {
	runControl?: boolean;
	codexCompat?: boolean;
	goalControl?: boolean;
};

export type ModelProfile = {
	provider: string;
	id: string;
};

function cloneSubagentProfile(subagent: SubagentProfile): SubagentProfile {
	return {
		...subagent,
		...(subagent.model ? { model: { ...subagent.model } } : {}),
		...(subagent.runtimeOptions ? { runtimeOptions: structuredClone(subagent.runtimeOptions) } : {}),
	};
}

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
	runtimeInstanceId?: string;
	runtimeOptions?: PiboJsonObject;
	sessionId?: string;
	parentSessionId?: string;
	model?: ModelProfile;
	mainModel?: ModelProfile;
	subagentModel?: ModelProfile;
	thinkingLevel?: PiboThinkingLevel;
	mainThinkingLevel?: PiboThinkingLevel;
	subagentThinkingLevel?: PiboThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	skills?: readonly SkillProfile[];
	tools?: readonly ToolProfileRegistration[];
	subagents?: readonly SubagentProfile[];
	mcpServers?: readonly string[];
	piPackages?: readonly PiPackageProfile[];
	contextFiles?: readonly ContextFileProfile[];
	builtinTools?: BuiltinToolsMode;
	builtinToolNames?: readonly string[];
	autoContextFiles?: boolean;
	nativeSubagents?: boolean;
	toolPackages?: ToolPackageProfile;
};

export class InitialSessionContext {
	readonly profileName: string;
	readonly runtimeInstanceId: string;
	readonly runtimeOptions: PiboJsonObject;
	readonly sessionId?: string;
	readonly parentSessionId?: string;
	readonly model?: ModelProfile;
	readonly mainModel?: ModelProfile;
	readonly subagentModel?: ModelProfile;
	readonly thinkingLevel?: PiboThinkingLevel;
	readonly mainThinkingLevel?: PiboThinkingLevel;
	readonly subagentThinkingLevel?: PiboThinkingLevel;
	readonly fast?: boolean;
	readonly mainFast?: boolean;
	readonly subagentFast?: boolean;
	readonly skills: readonly SkillProfile[];
	readonly tools: readonly ToolProfile[];
	readonly subagents: readonly SubagentProfile[];
	readonly mcpServers: readonly string[];
	readonly piPackages: readonly PiPackageProfile[];
	readonly contextFiles: readonly ContextFileProfile[];
	readonly builtinTools: BuiltinToolsMode;
	readonly builtinToolNames: readonly string[];
	readonly autoContextFiles: boolean;
	readonly nativeSubagents?: boolean;
	readonly toolPackages: ToolPackageProfile;

	constructor(options: InitialSessionContextOptions) {
		this.profileName = options.profileName;
		this.runtimeInstanceId = options.runtimeInstanceId ?? DEFAULT_AGENT_RUNTIME_INSTANCE_ID;
		this.runtimeOptions = structuredClone(options.runtimeOptions ?? {});
		this.sessionId = options.sessionId;
		this.parentSessionId = options.parentSessionId;
		this.model = options.model ? { ...options.model } : undefined;
		this.mainModel = options.mainModel ? { ...options.mainModel } : undefined;
		this.subagentModel = options.subagentModel ? { ...options.subagentModel } : undefined;
		this.thinkingLevel = options.thinkingLevel;
		this.mainThinkingLevel = options.mainThinkingLevel;
		this.subagentThinkingLevel = options.subagentThinkingLevel;
		this.fast = options.fast;
		this.mainFast = options.mainFast;
		this.subagentFast = options.subagentFast;
		this.skills = [...(options.skills ?? [])];
		this.tools = (options.tools ?? []).map(normalizeToolProfile);
		this.subagents = (options.subagents ?? []).map(cloneSubagentProfile);
		this.mcpServers = [...(options.mcpServers ?? [])];
		this.piPackages = [...(options.piPackages ?? [])];
		this.contextFiles = [...(options.contextFiles ?? [])];
		this.builtinTools = options.builtinTools ?? "default";
		this.builtinToolNames = [...(options.builtinToolNames ?? DEFAULT_BUILTIN_TOOL_NAMES)];
		this.autoContextFiles = options.autoContextFiles ?? true;
		this.nativeSubagents = options.nativeSubagents;
		this.toolPackages = { ...(options.toolPackages ?? {}) };
	}
}

export class InitialSessionContextBuilder {
	private readonly profileName: string;
	private runtimeInstanceId = DEFAULT_AGENT_RUNTIME_INSTANCE_ID;
	private runtimeOptions: PiboJsonObject = {};
	private sessionId?: string;
	private parentSessionId?: string;
	private model?: ModelProfile;
	private mainModel?: ModelProfile;
	private subagentModel?: ModelProfile;
	private thinkingLevel?: PiboThinkingLevel;
	private mainThinkingLevel?: PiboThinkingLevel;
	private subagentThinkingLevel?: PiboThinkingLevel;
	private fast?: boolean;
	private mainFast?: boolean;
	private subagentFast?: boolean;
	private skills: SkillProfile[] = [];
	private tools: ToolProfile[] = [];
	private subagents: SubagentProfile[] = [];
	private mcpServers: string[] = [];
	private piPackages: PiPackageProfile[] = [];
	private contextFiles: ContextFileProfile[] = [];
	private builtinTools: BuiltinToolsMode = "default";
	private builtinToolNames: string[] = [...DEFAULT_BUILTIN_TOOL_NAMES];
	private autoContextFiles = true;
	private nativeSubagents?: boolean;
	private toolPackages: ToolPackageProfile = {};

	constructor(profileName: string) {
		this.profileName = profileName;
	}

	withAgentRuntime(instanceId: string, options: PiboJsonObject = {}): this {
		this.runtimeInstanceId = instanceId;
		this.runtimeOptions = structuredClone(options);
		return this;
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

	withThinkingLevel(level: PiboThinkingLevel): this {
		this.thinkingLevel = level;
		return this;
	}

	withMainThinkingLevel(level: PiboThinkingLevel): this {
		this.mainThinkingLevel = level;
		return this;
	}

	withSubagentThinkingLevel(level: PiboThinkingLevel): this {
		this.subagentThinkingLevel = level;
		return this;
	}

	withFastMode(enabled: boolean): this {
		this.fast = enabled;
		return this;
	}

	withMainFastMode(enabled: boolean): this {
		this.mainFast = enabled;
		return this;
	}

	withSubagentFastMode(enabled: boolean): this {
		this.subagentFast = enabled;
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

	withNativeSubagents(enabled: boolean | undefined): this {
		this.nativeSubagents = enabled;
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

	addTool(tool: ToolProfileRegistration): this {
		this.tools.push(normalizeToolProfile(tool));
		return this;
	}

	addTools(tools: readonly ToolProfileRegistration[]): this {
		this.tools.push(...tools.map(normalizeToolProfile));
		return this;
	}

	addSubagent(subagent: SubagentProfile): this {
		this.subagents.push(cloneSubagentProfile(subagent));
		return this;
	}

	addSubagents(subagents: readonly SubagentProfile[]): this {
		this.subagents.push(...subagents.map(cloneSubagentProfile));
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
			runtimeInstanceId: this.runtimeInstanceId,
			runtimeOptions: this.runtimeOptions,
			sessionId: this.sessionId,
			parentSessionId: this.parentSessionId,
			model: this.model,
			mainModel: this.mainModel,
			subagentModel: this.subagentModel,
			thinkingLevel: this.thinkingLevel,
			mainThinkingLevel: this.mainThinkingLevel,
			subagentThinkingLevel: this.subagentThinkingLevel,
			fast: this.fast,
			mainFast: this.mainFast,
			subagentFast: this.subagentFast,
			skills: this.skills,
			tools: this.tools,
			subagents: this.subagents,
			mcpServers: this.mcpServers,
			piPackages: this.piPackages,
			contextFiles: this.contextFiles,
			builtinTools: this.builtinTools,
			builtinToolNames: this.builtinToolNames,
			autoContextFiles: this.autoContextFiles,
			nativeSubagents: this.nativeSubagents,
			toolPackages: this.toolPackages,
		});
	}
}
