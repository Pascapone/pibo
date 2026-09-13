import type { InitialSessionContext } from "../core/profiles.js";
import type { AgentPluginSelection } from "./contributions.js";
import type { PluginDiagnostic, PluginInstallation, PluginJsonObject } from "./manifest.js";
import { freezePluginValue, isPluginJson, isPluginRecord, parsePluginManifest, pluginDiagnostic, PluginValidationError } from "./schema.js";

export function validateAgentPluginSelection(value: unknown): PluginDiagnostic[] {
	const diagnostics: PluginDiagnostic[] = [];
	const fail = (message: string, path: string[]) => diagnostics.push(pluginDiagnostic("invalid-plugin-selection", message, path));
	if (!isPluginRecord(value) || !isPluginJson(value) || value.schemaVersion !== 1 || !Array.isArray(value.plugins)) return [pluginDiagnostic("invalid-plugin-selection", "Expected schemaVersion 1 and plugins array of finite JSON", ["selection"])];
	const ids = new Set<string>();
	for (const [index, entry] of value.plugins.entries()) {
		const path = ["selection", String(index)];
		if (!isPluginRecord(entry) || typeof entry.pluginId !== "string" || !entry.pluginId || typeof entry.enabled !== "boolean" || typeof entry.revision !== "string" || !entry.revision || !isPluginRecord(entry.config) || !isPluginRecord(entry.contributions) || Object.values(entry.contributions).some((value) => typeof value !== "boolean")) { fail("Plugin selection requires pluginId, enabled, revision, contributions and config", path); continue; }
		if (ids.has(entry.pluginId)) fail(`Duplicate plugin selection ${entry.pluginId}`, path);
		ids.add(entry.pluginId);
		if (entry.contributionConfig !== undefined && (!isPluginRecord(entry.contributionConfig) || Object.values(entry.contributionConfig).some((config) => !isPluginRecord(config)))) fail("contributionConfig must map local IDs to JSON objects", path);
	}
	return diagnostics;
}

/** Defaults are materialized once, for this explicitly supplied set only. Never use on a stored selection. */
export function createAgentPluginSelection(installations: readonly PluginInstallation[]): AgentPluginSelection {
	const selection: AgentPluginSelection = { schemaVersion: 1, plugins: installations.filter((installation) => parsePluginManifest(installation.manifest).contributions.some((c) => c.scope === "agent")).map((installation) => {
		const manifest = parsePluginManifest(installation.manifest);
		const schema = manifest.config?.schema;
		const config: PluginJsonObject = isPluginRecord(schema?.default) ? structuredClone(schema.default) as PluginJsonObject : {};
		if (isPluginRecord(schema?.properties)) for (const [key, property] of Object.entries(schema.properties)) {
			if (!Object.hasOwn(config, key) && isPluginRecord(property) && Object.hasOwn(property, "default")) config[key] = structuredClone(property.default) as PluginJsonObject[string];
		}
		const contributions = Object.fromEntries(manifest.contributions.filter((c) => c.scope === "agent").map((c) => [c.id, c.required || c.defaultEnabled]));
		return { pluginId: installation.pluginId, revision: installation.revision, enabled: Object.values(contributions).some(Boolean), contributions, config };
	}) };
	const diagnostics = validateAgentPluginSelection(selection);
	if (diagnostics.length) throw new PluginValidationError(diagnostics);
	// New selections can adopt dependencies. Existing selections are never run through this helper.
	const entries = new Map(selection.plugins.map((entry) => [entry.pluginId, entry]));
	const seen = new Set<string>();
	function include(pluginId: string, localId: string): void {
		const id = `${pluginId}/${localId}`;
		if (seen.has(id)) return;
		seen.add(id);
		const installation = installations.find((item) => item.pluginId === pluginId);
		const contribution = installation?.manifest.contributions.find((item) => item.id === localId);
		if (!contribution) return;
		for (const dependency of contribution.dependsOn ?? []) {
			const [owner, local] = dependency.split("/");
			const entry = entries.get(owner);
			if (entry && Object.hasOwn(entry.contributions, local)) { entry.contributions[local] = true; include(owner, local); }
		}
	}
	for (const entry of selection.plugins) for (const [id, selected] of Object.entries(entry.contributions)) if (selected) include(entry.pluginId, id);
	return freezePluginValue(selection);
}

/** One-time legacy-profile migration into explicit package/revision bindings. */
export function createAgentPluginSelectionForProfile(installations: readonly PluginInstallation[], profile: InitialSessionContext): AgentPluginSelection {
	const selection = structuredClone(createAgentPluginSelection(installations));
	const entries = new Map(selection.plugins.map((entry) => [entry.pluginId, entry]));
	for (const entry of selection.plugins) {
		const installation = installations.find((item) => item.pluginId === entry.pluginId);
		for (const contribution of installation?.manifest.contributions ?? []) {
			if (contribution.scope === "agent" && Object.hasOwn(entry.contributions, contribution.id)) {
				entry.contributions[contribution.id] = contribution.required;
			}
		}
		entry.enabled = Object.values(entry.contributions).some(Boolean);
	}
	const enableContribution = (pluginId: string, contributionId: string): void => {
		const entry = entries.get(pluginId);
		if (!entry || !Object.hasOwn(entry.contributions, contributionId)) return;
		entry.enabled = true;
		entry.contributions[contributionId] = true;
	};
	const setFamily = (pluginId: string, enabled: boolean): void => {
		const entry = entries.get(pluginId);
		if (!entry) return;
		for (const id of Object.keys(entry.contributions)) entry.contributions[id] = enabled;
		entry.enabled = enabled;
	};
	for (const tool of profile.tools) {
		if (tool.enabled === false) continue;
		for (const installation of installations) {
			const contribution = installation.manifest.contributions.find((candidate) => candidate.scope === "agent" && candidate.kind === "tool" && candidate.name === tool.name);
			if (contribution) enableContribution(installation.pluginId, contribution.id);
		}
	}
	if (profile.contextFiles.some((item) => item.enabled !== false && (item.key === "Pibo Native Tooling" || item.label === "Pibo Native Tooling"))) enableContribution("pibo.browser-tools", "native-tooling-context");
	if (profile.contextFiles.some((item) => item.enabled !== false && (item.key === "Codex Base Prompt" || item.label === "Codex Base Prompt"))) enableContribution("pibo.codex-compat", "base-prompt");
	if (profile.mcpServers.length > 0) {
		enableContribution("pibo.mcp-cli", "adapter");
		const entry = entries.get("pibo.mcp-cli");
		if (entry) (entry.contributionConfig ??= {}).adapter = { selectedServers: [...profile.mcpServers] };
	}
	setFamily("pibo.run-control", profile.toolPackages.runControl === true);
	setFamily("pibo.goal-control", profile.toolPackages.goalControl !== false);
	setFamily("pibo.agent-delegation", profile.subagents.some((subagent) => subagent.enabled !== false));
	if (profile.toolPackages.codexCompat === true) setFamily("pibo.codex-compat", true);
	const seen = new Set<string>();
	const includeDependencies = (pluginId: string, contributionId: string): void => {
		const key = `${pluginId}/${contributionId}`;
		if (seen.has(key)) return;
		seen.add(key);
		const installation = installations.find((item) => item.pluginId === pluginId);
		const contribution = installation?.manifest.contributions.find((item) => item.id === contributionId);
		if (!contribution) return;
		for (const dependency of contribution.dependsOn ?? []) {
			const [owner, localId] = dependency.split("/");
			enableContribution(owner!, localId!);
			includeDependencies(owner!, localId!);
		}
	};
	for (const entry of selection.plugins) {
		for (const [contributionId, enabled] of Object.entries(entry.contributions)) {
			if (enabled) includeDependencies(entry.pluginId, contributionId);
		}
	}
	const diagnostics = validateAgentPluginSelection(selection);
	if (diagnostics.length) throw new PluginValidationError(diagnostics);
	return freezePluginValue(selection);
}
