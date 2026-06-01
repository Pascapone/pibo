import type { SaveCustomAgentInput } from "../api-agent-designer";
import type { AgentCatalog, BootstrapData, CustomAgent, ModelProfile, ThinkingLevel } from "../types";

export type AgentDraft = SaveCustomAgentInput & {
	id?: string;
	profileName?: string;
	archivedAt?: string;
	hardPinnedModel?: ModelProfile;
	thinkingLevel?: ThinkingLevel;
	mainThinkingLevel?: ThinkingLevel;
	subagentThinkingLevel?: ThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
	brokenContextFiles?: string[];
	source: "custom" | "profile";
};

export function createBlankAgentDraft(catalog?: AgentCatalog, displayName = "new-agent"): AgentDraft {
	return {
		displayName,
		description: "",
		nativeTools: [],
		skills: hasBuiltinSkill(catalog, "pi-agent-harness") ? ["pi-agent-harness"] : [],
		contextFiles: [],
		subagents: [],
		mcpServers: [],
		piPackages: [],
		mainModel: undefined,
		subagentModel: undefined,
		thinkingLevel: undefined,
		mainThinkingLevel: undefined,
		subagentThinkingLevel: undefined,
		fast: false,
		mainFast: false,
		subagentFast: false,
		builtinTools: "default",
		builtinToolNames: [...DEFAULT_BUILTIN_TOOL_NAMES],
		autoContextFiles: true,
		runControl: false,
		brokenContextFiles: [],
		hardPinnedModel: undefined,
		source: "custom",
	};
}

export function uniqueDraftAgentName(usedNames: Iterable<string>): string {
	const used = new Set([...usedNames].map((name) => name.trim()).filter(Boolean));
	const baseName = "new-agent";
	if (!used.has(baseName)) return baseName;
	for (let index = 1; ; index += 1) {
		const candidate = `${baseName}-${index}`;
		if (!used.has(candidate)) return candidate;
	}
}

export function agentToDraft(agent: CustomAgent): AgentDraft {
	return {
		id: agent.id,
		profileName: agent.profileName,
		displayName: agent.displayName,
		description: agent.description ?? "",
		nativeTools: agent.nativeTools,
		skills: agent.skills,
		contextFiles: agent.contextFiles,
		subagents: agent.subagents,
		mcpServers: agent.mcpServers,
		piPackages: agent.piPackages ?? [],
		mainModel: agent.mainModel,
		subagentModel: agent.subagentModel,
		thinkingLevel: agent.thinkingLevel,
		mainThinkingLevel: agent.mainThinkingLevel,
		subagentThinkingLevel: agent.subagentThinkingLevel,
		fast: agent.fast ?? false,
		mainFast: agent.mainFast ?? false,
		subagentFast: agent.subagentFast ?? false,
		builtinTools: agent.builtinTools,
		builtinToolNames: normalizeBuiltinToolNames(agent.builtinToolNames, agent.builtinTools),
		autoContextFiles: agent.autoContextFiles ?? true,
		runControl: agent.runControl,
		brokenContextFiles: agent.brokenContextFiles ?? [],
		archivedAt: agent.archivedAt,
		hardPinnedModel: undefined,
		source: "custom",
	};
}

export function profileToDraft(profile: BootstrapData["agents"][number], catalog?: AgentCatalog): AgentDraft {
	return {
		displayName: profile.name,
		description: profile.description ?? "",
		nativeTools: profile.nativeTools ?? [],
		skills: profile.skills ?? (hasBuiltinSkill(catalog, "pi-agent-harness") ? ["pi-agent-harness"] : []),
		contextFiles: profile.contextFiles ?? [],
		subagents: profile.subagents ?? [],
		mcpServers: profile.mcpServers ?? [],
		piPackages: profile.piPackages ?? [],
		mainModel: profile.mainModel ?? profile.model,
		subagentModel: profile.subagentModel ?? profile.model,
		thinkingLevel: profile.thinkingLevel,
		mainThinkingLevel: profile.mainThinkingLevel ?? profile.thinkingLevel,
		subagentThinkingLevel: profile.subagentThinkingLevel ?? profile.thinkingLevel,
		fast: profile.fast ?? false,
		mainFast: profile.mainFast ?? profile.fast ?? false,
		subagentFast: profile.subagentFast ?? profile.fast ?? false,
		builtinTools: profile.builtinTools ?? "default",
		builtinToolNames: normalizeBuiltinToolNames(profile.builtinToolNames, profile.builtinTools),
		autoContextFiles: profile.autoContextFiles ?? true,
		runControl: profile.runControl ?? false,
		brokenContextFiles: [],
		hardPinnedModel: profile.model,
		profileName: profile.name,
		source: "profile",
	};
}

export function copyProfileToDraft(profile: BootstrapData["agents"][number], catalog?: AgentCatalog): AgentDraft {
	const draft = profileToDraft(profile, catalog);
	return {
		...draft,
		displayName: `${profile.name}-copy`,
		id: undefined,
		hardPinnedModel: undefined,
		profileName: undefined,
		source: "custom",
	};
}

export function copyCustomAgentToDraft(agent: CustomAgent): AgentDraft {
	const draft = agentToDraft(agent);
	return {
		...draft,
		displayName: `${agent.profileName}-copy`,
		id: undefined,
		profileName: undefined,
		archivedAt: undefined,
		source: "custom",
	};
}

export function uniqueProfileOptions(
	agents: BootstrapData["agents"],
	customAgents: CustomAgent[],
): Array<{ value: string; label: string }> {
	const options = new Map<string, string>();
	for (const agent of agents) options.set(agent.name, agent.name);
	for (const agent of customAgents) options.set(agent.profileName, agent.displayName);
	return [...options.entries()].map(([value, label]) => ({ value, label }));
}

export function validateAgentName(name: string): string | null {
	if (!name.trim()) return "Agent name is required.";
	if (name.length > 120) return "Agent name is too long.";
	if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
		return "Use lowercase kebab-case only, for example test-agent.";
	}
	return null;
}

export function toggleName(names: string[], name: string): string[] {
	return names.includes(name) ? names.filter((item) => item !== name) : [...names, name];
}

export function normalizeBuiltinToolNames(names: string[] | undefined, mode: "default" | "disabled" = "default"): string[] {
	if (mode === "disabled") return [];
	const selected = new Set(names ?? DEFAULT_BUILTIN_TOOL_NAMES);
	return DEFAULT_BUILTIN_TOOL_NAMES.filter((name) => selected.has(name));
}

export type NativeToolCatalogItem = AgentCatalog["nativeTools"][number];
export type ContextFileCatalogItem = AgentCatalog["contextFiles"][number];
export type PiPackageCatalogItem = AgentCatalog["piPackages"][number];
export type SkillCatalogItem = AgentCatalog["skills"][number];
export type CatalogGroupKind = "builtin" | "plugin" | "custom" | "user";
const CODEX_COMPAT_TOOL_NAMES = new Set([
	"apply_patch",
	"web_search",
	"view_image",
]);
export const DEFAULT_BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;
export const BUILTIN_TOOL_DESCRIPTIONS: Record<(typeof DEFAULT_BUILTIN_TOOL_NAMES)[number], string> = {
	read: "Read workspace files.",
	bash: "Run shell commands.",
	edit: "Edit existing files.",
	write: "Create or overwrite files.",
};
export const CATALOG_GROUP_RENDER_LIMIT = 100;

export type CatalogGroup<T> = {
	key: string;
	title: string;
	description: string;
	kind: CatalogGroupKind;
	items: T[];
	selectedCount: number;
	totalCount: number;
	defaultOpen: boolean;
};

export function buildNativeToolGroups(tools: NativeToolCatalogItem[], selectedNames: string[]): CatalogGroup<NativeToolCatalogItem>[] {
	const selected = new Set(selectedNames);
	const groups = new Map<string, CatalogGroup<NativeToolCatalogItem>>();
	for (const tool of tools) {
		const pluginId = tool.pluginId ?? (CODEX_COMPAT_TOOL_NAMES.has(tool.name) ? "pibo.codex-compat" : undefined);
		const pluginName = tool.pluginName ?? (pluginId === "pibo.codex-compat" ? "Codex Compat" : undefined);
		const isNative = !pluginId || pluginId === "pibo.core";
		const key = isNative ? "builtin" : `plugin:${pluginId}`;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: isNative ? "Built-in Tools" : pluginDisplayName(pluginId, pluginName),
			description: isNative ? "Built-in Pibo tool catalog" : pluginId ?? "plugin",
			kind: isNative ? "builtin" : "plugin",
		});
		group.items.push(tool);
		if (selected.has(tool.name)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["builtin", "plugin"]);
}

export function buildSkillGroups(skills: SkillCatalogItem[], selectedNames: string[]): CatalogGroup<SkillCatalogItem>[] {
	const selected = new Set(selectedNames);
	const groups = new Map<string, CatalogGroup<SkillCatalogItem>>();
	for (const skill of skills) {
		const kind = skill.kind;
		const key = kind === "plugin" ? `plugin:${skill.pluginId ?? skill.name}` : kind;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: skillGroupTitle(skill),
			description: skillGroupDescription(skill),
			kind: skill.kind,
		});
		group.items.push(skill);
		if (selected.has(skill.name)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["builtin", "plugin", "user"]);
}

export function buildContextFileGroups(files: ContextFileCatalogItem[], selectedKeys: string[]): CatalogGroup<ContextFileCatalogItem>[] {
	const selected = new Set(selectedKeys);
	const groups = new Map<string, CatalogGroup<ContextFileCatalogItem>>();
	for (const file of files) {
		const isBuiltIn = file.pluginId === "pibo.core";
		const isCustom = !file.pluginId;
		const key = isBuiltIn ? "builtin" : isCustom ? "custom" : `plugin:${file.pluginId}`;
		const group = getOrCreateCatalogGroup(groups, key, {
			title: isBuiltIn ? "Built-in Context Files" : isCustom ? "Custom" : pluginDisplayName(file.pluginId, file.pluginName),
			description: isBuiltIn ? "Pibo built-in context file catalog" : isCustom ? "Loose context files without a plugin namespace" : file.pluginId ?? "plugin",
			kind: isBuiltIn ? "builtin" : isCustom ? "custom" : "plugin",
		});
		group.items.push(file);
		if (selected.has(file.key)) group.selectedCount += 1;
		group.totalCount += 1;
	}
	return finalizeCatalogGroups(groups, ["builtin", "custom", "plugin"]);
}

function getOrCreateCatalogGroup<T>(
	groups: Map<string, CatalogGroup<T>>,
	key: string,
	options: Pick<CatalogGroup<T>, "title" | "description" | "kind">,
): CatalogGroup<T> {
	const existing = groups.get(key);
	if (existing) return existing;
	const created: CatalogGroup<T> = {
		key,
		title: options.title,
		description: options.description,
		kind: options.kind,
		items: [],
		selectedCount: 0,
		totalCount: 0,
		defaultOpen: false,
	};
	groups.set(key, created);
	return created;
}

function finalizeCatalogGroups<T>(
	groups: Map<string, CatalogGroup<T>>,
	kindOrder: CatalogGroupKind[],
): CatalogGroup<T>[] {
	const order = new Map(kindOrder.map((kind, index) => [kind, index]));
	const sorted = [...groups.values()].sort((left, right) => {
		const leftOrder = order.get(left.kind) ?? kindOrder.length;
		const rightOrder = order.get(right.kind) ?? kindOrder.length;
		if (leftOrder !== rightOrder) return leftOrder - rightOrder;
		return left.title.localeCompare(right.title);
	});
	return sorted.map((group) => ({
		...group,
		defaultOpen: false,
	}));
}

function pluginDisplayName(pluginId: string | undefined, pluginName: string | undefined): string {
	if (pluginId === "pibo.codex-compat") return "Codex Compat";
	if (pluginName) return pluginName;
	if (!pluginId) return "Plugin";
	const lastSegment = pluginId.split(".").filter(Boolean).at(-1) ?? pluginId;
	return lastSegment.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function skillGroupTitle(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "Built-in Skills";
	if (skill.kind === "user") return "User Skills";
	return pluginDisplayName(skill.pluginId, skill.pluginName);
}

function skillGroupDescription(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "Pibo-owned built-in skill catalog";
	if (skill.kind === "user") return "User-managed skills";
	return skill.pluginId ?? "plugin";
}

export function skillMeta(skill: SkillCatalogItem): string {
	if (skill.kind === "builtin") return "built-in skill";
	if (skill.kind === "user") return "user skill";
	return skill.pluginName ?? skill.pluginId ?? "plugin skill";
}

function hasBuiltinSkill(catalog: AgentCatalog | undefined, name: string): boolean {
	return catalog?.skills.some((skill) => skill.kind === "builtin" && skill.name === name) ?? false;
}

export function contextFileMeta(contextFile: AgentCatalog["contextFiles"][number]): string {
	const source = contextFile.source ?? "plugin";
	const scope = contextFile.scope ?? "global";
	if (contextFile.pluginId === "pibo.core") return "built-in global";
	if (source === "plugin") return "plugin global";
	if (scope === "agent") return contextFile.agentProfileName ? `agent ${contextFile.agentProfileName}` : "agent local";
	return "managed global";
}

export function isPiPackageSelected(selected: string[], pkg: PiPackageCatalogItem): boolean {
	return selected.includes(pkg.id) || selected.includes(pkg.name);
}

export function togglePiPackageSelection(selected: string[], pkg: PiPackageCatalogItem): string[] {
	if (isPiPackageSelected(selected, pkg)) return selected.filter((name) => name !== pkg.id && name !== pkg.name);
	return [...selected, pkg.id];
}

export function isSelectablePiPackage(pkg: PiPackageCatalogItem): boolean {
	return pkg.enabled && pkg.installStatus === "installed";
}

export function piPackageMeta(pkg: AgentCatalog["piPackages"][number]): string {
	const resources = pkg.resourceTypes.length ? pkg.resourceTypes.join(" + ") : "resources pending";
	const version = pkg.version ? `v${pkg.version}` : pkg.installStatus;
	const diagnostics = pkg.diagnostics.some((diagnostic) => diagnostic.type === "error") ? " / needs attention" : "";
	const enabled = pkg.enabled ? "enabled" : "disabled";
	return `${resources} / ${version} / ${enabled}${diagnostics}`;
}

export function agentDesignerUnavailableMessage(): string {
	return "Agent Designer API unavailable. Restart the Pibo web gateway after pulling/building the latest backend.";
}

export function isNotFoundError(message: string): boolean {
	return message.toLowerCase().includes("not found") || message.includes("404");
}
