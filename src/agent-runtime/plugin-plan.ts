import { InitialSessionContext, normalizeToolProfile, type ToolProfileRegistration, type SkillProfile, type ContextFileProfile, type SubagentProfile } from "../core/profiles.js";
import type { PluginHost } from "../plugins/host.js";
import type { PluginManager } from "../plugins/manager.js";
import type { PluginStore, PluginGenerationAdmission } from "../plugins/store.js";
import type { PluginInstallation, PluginJsonObject } from "../plugins/manifest.js";
import type { EffectivePluginPlan, IndependentPluginResource, PluginResolutionInput, PluginRuntimeTarget } from "../plugins/contributions.js";
import { assertEffectivePluginPlan, resolvePluginContributions } from "../plugins/resolution.js";
import type { RuntimePluginHook } from "./plugin-hooks.js";
import { catalogPluginServices } from "../plugins/product-services.js";
import type { PiboMcpAdapter } from "../plugins/mcp-adapter.js";

/** Independent resources are not executable plugin selections, including manual child profiles. */
export function independentProfileResources(profile: InitialSessionContext): IndependentPluginResource[] {
	return [
		...profile.skills.filter((item) => item.enabled !== false && item.kind !== "plugin").map((item) => ({ id: `${item.kind === "user" ? "user" : "harness"}:skill:${item.path}`, kind: "skill", name: item.name, origin: item.kind === "user" ? "user" as const : "harness" as const, reference: item.path, context: { kind: "context" as const, stage: "skills", description: item.name, loading: "progressive" as const } })),
		...profile.contextFiles.filter((item) => item.enabled !== false && item.source !== "plugin").map((item) => ({ id: `user:context:${item.path}`, kind: "context-file", name: item.key ?? item.path, origin: "user" as const, reference: item.path, context: { kind: "context" as const, stage: "context", description: item.path, loading: "eager" as const } })),
		...profile.subagents.filter((item) => item.enabled !== false).map((item) => ({ id: `manual:subagent:${item.name}`, kind: "subagent", name: item.name, origin: "manual" as const, reference: item.targetProfile, metadata: JSON.parse(JSON.stringify(item)) as PluginJsonObject, context: { kind: "context" as const, stage: "subagents", description: item.description ?? item.name, loading: "eager" as const } })),
	];
}

export function resolveRuntimePluginPlan(input: Omit<PluginResolutionInput, "selection" | "selectionRevision" | "agentId" | "resources"> & { profile: InitialSessionContext }): EffectivePluginPlan {
	if (!input.profile.pluginSelection) throw new Error("Plugin selection is unknown; migrate this legacy profile before plugin activation.");
	return resolvePluginContributions({ ...input, selection: input.profile.pluginSelection, selectionRevision: input.profile.pluginSelectionRevision, agentId: input.profile.pluginAgentId, resources: independentProfileResources(input.profile) });
}

/** Project only selected host registrations. This never invokes tool factories or imports plugin code. */
export function profileFromPluginPlan(profile: InitialSessionContext, plan: EffectivePluginPlan, host: PluginHost): InitialSessionContext {
	assertEffectivePluginPlan(plan);
	const tools: ToolProfileRegistration[] = profile.tools.filter((item) => !item.pluginId);
	const skills: SkillProfile[] = profile.skills.filter((item) => item.kind !== "plugin");
	const contextFiles: ContextFileProfile[] = profile.contextFiles.filter((item) => item.source !== "plugin");
	const subagents: SubagentProfile[] = [...profile.subagents];
	const mcpServers: string[] = [];
	for (const entry of plan.contributions) {
		// App registrations are usable by the product, never implicit model capabilities.
		if (entry.contribution.scope !== "agent") continue;
		const registration = host.contributions.get<{ installation: PluginInstallation; value: unknown }>("contribution", entry.id);
		const kind = entry.contribution.kind;
		if (!["tool", "skill", "context-file", "subagent", "mcp-server", "mcp-adapter"].includes(kind)) continue;
		if (!registration || registration.installation.revision !== entry.pluginRevision) throw new Error(`Selected contribution ${entry.id} is not loaded at revision ${entry.pluginRevision}`);
		const value = registration.value;
		if (kind === "tool") {
			const tool = normalizeToolProfile(value as ToolProfileRegistration);
			const plugin = Object.freeze({ id: entry.pluginId, contributionId: entry.id, revision: entry.pluginRevision, configuration: plan.pluginConfigurations[entry.pluginId] ?? {}, contributionConfiguration: entry.config });
			const bind = (definition: NonNullable<typeof tool.definition>) => ({ ...definition, inputSchema: structuredClone(definition.inputSchema), execute: (callId: string, input: unknown, signal: AbortSignal | undefined, onUpdate: Parameters<typeof definition.execute>[3], context: Parameters<typeof definition.execute>[4]) => definition.execute(callId, input, signal, onUpdate, { ...context, plugin }) });
			tools.push({ ...tool, enabled: true, ...(tool.definition ? { definition: bind(tool.definition) } : {}), ...(tool.createDefinition ? { createDefinition: (context) => bind(tool.createDefinition!({ ...context, plugin })) } : {}) });
		}
		if (kind === "skill") skills.push({ ...(value as SkillProfile), kind: "plugin", pluginId: entry.pluginId, pluginContributionId: entry.id, required: entry.required, enabled: true });
		if (kind === "context-file") contextFiles.push({ ...(value as ContextFileProfile), source: "plugin", pluginId: entry.pluginId, pluginContributionId: entry.id, required: entry.required, enabled: true });
		if (kind === "subagent") subagents.push({ ...(value as SubagentProfile), enabled: true });
		if (kind === "mcp-adapter") {
			const selectedServers = entry.config.selectedServers;
			if (!Array.isArray(selectedServers) || selectedServers.some((name) => typeof name !== "string" || !name.trim())) throw new Error(`Selected MCP adapter ${entry.id} is missing its migrated selectedServers configuration`);
			mcpServers.push(...selectedServers as string[]);
		}
		// External server configuration/secret resolution stays in the selected adapter and existing resource service.
		if (kind === "mcp-server") mcpServers.push(typeof value === "string" ? value : (value as { name: string }).name);
	}
	const names = new Set(tools.map((tool) => tool.name));
	return new InitialSessionContext({ ...profile, effectivePluginPlan: plan, tools, skills, contextFiles, subagents, mcpServers, toolPackages: {
		runControl: names.has("pibo_run_start"),
		goalControl: names.has("get_goal") || names.has("create_goal") || names.has("update_goal"),
		codexCompat: names.has("codex"),
	} });
}

export function mcpAdapterFromPluginPlan(profile: InitialSessionContext, host: PluginHost): PiboMcpAdapter | undefined {
	const entry = profile.effectivePluginPlan?.contributions.find((candidate) => candidate.contribution.scope === "agent" && candidate.contribution.kind === "mcp-adapter");
	if (!entry) return undefined;
	const registration = host.contributions.get<{ installation: PluginInstallation; value: PiboMcpAdapter }>("contribution", entry.id);
	if (!registration || registration.installation.revision !== entry.pluginRevision) throw new Error(`Selected MCP adapter ${entry.id} is not loaded at revision ${entry.pluginRevision}`);
	return registration.value;
}

export type PluginRuntimeGeneration = { plan: EffectivePluginPlan; profile: InitialSessionContext; admission: PluginGenerationAdmission; hooks: RuntimePluginHook[] };

/** One admission/persistence coordinator around the existing resolver and host, not another engine. */
export class PluginRuntimeCoordinator {
	constructor(readonly options: { store: PluginStore; manager: Pick<PluginManager, "reserveGeneration" | "releaseGenerationAdmission">; host: PluginHost }) {}
	preview(profile: InitialSessionContext, runtime: PluginRuntimeTarget, piboSessionId?: string): EffectivePluginPlan {
		return this.resolve(profile, runtime, piboSessionId);
	}
	private resolve(profile: InitialSessionContext, runtime: PluginRuntimeTarget, piboSessionId?: string, generation?: string): EffectivePluginPlan {
		const installations = this.options.store.listInstallations();
		const configurations = installations.flatMap(({ pluginId }) => [
			this.options.store.getConfig({ scope: "app", pluginId }),
			...(profile.pluginAgentId ? [this.options.store.getConfig({ scope: "agent", pluginId, agentId: profile.pluginAgentId })] : []),
			...(piboSessionId ? [this.options.store.getConfig({ scope: "session", pluginId, piboSessionId })] : []),
		].filter((value) => value !== undefined));
		const serviceState = catalogPluginServices(this.options.host, installations);
		return resolveRuntimePluginPlan({ profile, runtime, catalog: { schemaVersion: 1, revision: installations.reduce((sum, item) => sum + item.stateRevision, 0), installations }, configurations, ...serviceState, kind: generation ? "generation" : "preview", piboSessionId, generation });
	}
	/** Entire method synchronous: retirement cannot interleave between reservation and pinning. */
	reserve(profile: InitialSessionContext, runtime: PluginRuntimeTarget, piboSessionId: string, generation: string): PluginRuntimeGeneration {
		const plan = this.resolve(profile, runtime, piboSessionId, generation);
		assertEffectivePluginPlan(plan);
		const admission = this.options.manager.reserveGeneration({ piboSessionId, generationId: generation, pluginIds: plan.plugins.map((plugin) => plugin.pluginId) });
		try {
			for (const plugin of plan.plugins) if (!admission.plugins.some((pin) => pin.pluginId === plugin.pluginId && pin.revision === plugin.revision)) throw new Error(`Plugin revision changed during admission: ${plugin.pluginId}`);
			const effectiveProfile = profileFromPluginPlan(profile, plan, this.options.host);
			const hooks = plan.contributions.filter((entry) => entry.contribution.scope === "agent" && entry.contribution.kind === "hook").map((entry) => {
				const registration = this.options.host.contributions.get<{ installation: PluginInstallation; value: RuntimePluginHook }>("contribution", entry.id);
				if (!registration || registration.installation.revision !== entry.pluginRevision || registration.value.descriptor.id !== entry.id) throw new Error(`Selected hook unavailable: ${entry.id}`);
				return { ...registration.value, descriptor: { ...registration.value.descriptor, required: entry.required } };
			});
			this.options.store.putGenerationSnapshot({ piboSessionId, generationId: generation, plan, createdAt: new Date().toISOString() });
			return { plan, profile: effectiveProfile, admission, hooks };
		} catch (error) {
			this.options.manager.releaseGenerationAdmission(piboSessionId, generation, admission.revision);
			throw error;
		}
	}
	release(generation: PluginRuntimeGeneration): void {
		this.options.manager.releaseGenerationAdmission(generation.admission.piboSessionId, generation.admission.generationId, generation.admission.revision);
	}
}
