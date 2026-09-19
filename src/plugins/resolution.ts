import { resolvePluginServiceProviders } from "./service-providers.js";
import type { AgentPluginSelectionEntry, EffectivePluginContribution, EffectivePluginPlan, IndependentPluginResource, PluginBuildProvenanceNode, PluginResolutionInput, PluginRuntimeTarget } from "./contributions.js";
import { qualifyPluginContribution, type PluginContribution, type PluginDiagnostic, type PluginInstallation, type PluginJsonObject, type PluginRuntimeRequirement } from "./manifest.js";
import { canonicalPluginJson, freezePluginValue, isPluginRecord, pluginDiagnostic, PluginValidationError, satisfiesPluginVersion, validatePluginConfig, validatePluginManifest } from "./schema.js";
import { validateAgentPluginSelection } from "./selection.js";

export function pluginRuntimeIncompatibilities(requirement: PluginRuntimeRequirement | undefined, runtime: PluginRuntimeTarget): string[] {
	if (!requirement) return [];
	const reasons: string[] = [];
	if (requirement.adapterIds && !requirement.adapterIds.includes(runtime.adapterId)) reasons.push(`Adapter ${runtime.adapterId} is not supported`);
	if (requirement.instanceIds && !requirement.instanceIds.includes(runtime.instanceId)) reasons.push(`Runtime instance ${runtime.instanceId} is not supported`);
	for (const capability of requirement.capabilities ?? []) {
		let value: unknown = runtime.capabilities;
		for (const key of capability.split(".")) value = isPluginRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
		if (value !== true) reasons.push(`Runtime capability ${capability} is required`);
	}
	for (const mode of requirement.deliveryModes ?? []) if (!runtime.deliveryModes?.includes(mode)) reasons.push(`Delivery mode ${mode} is required`);
	return reasons;
}

/** One pure, import-free resolution for preview, activation, browser availability and inspection. */
export function resolvePluginContributions(input: PluginResolutionInput): EffectivePluginPlan {
	const selectionDiagnostics = validateAgentPluginSelection(input.selection);
	if (selectionDiagnostics.length) throw new PluginValidationError(selectionDiagnostics);
	const diagnostics: PluginDiagnostic[] = [];
	const nodes: PluginBuildProvenanceNode[] = [];
	const candidates = new Map<string, { installation: PluginInstallation; contribution: PluginContribution; entry?: AgentPluginSelectionEntry; node: PluginBuildProvenanceNode }>();
	const selected = new Map<string, EffectivePluginContribution>();
	const entries = new Map(input.selection.plugins.map((entry) => [entry.pluginId, entry]));
	const installations = new Map<string, PluginInstallation>();
	const pluginConfigurations: Record<string, PluginJsonObject> = Object.create(null);
	const fail = (code: string, message: string, path: string[], required = true, attribution?: string) => {
		const diagnostic = pluginDiagnostic(code, message, path, required ? "error" : "warning");
		const attributed = attribution ?? path[0];
		if (attributed) diagnostic.pluginId = attributed.split("/")[0];
		if (attributed?.includes("/")) diagnostic.contributionId = attributed;
		diagnostics.push(diagnostic);
	};
	if (input.catalog.schemaVersion !== 1) fail("catalog-schema-version", "Only catalog version 1 is supported", ["catalog"]);
	if ((input.kind ?? "preview") === "generation" && (!input.piboSessionId || !input.generation)) fail("missing-generation-identity", "Generation plans require a fixed Pibo Session and generation", ["generation"]);
	const configTargets = new Set<string>();
	for (const config of input.configurations ?? []) {
		const target = config.target;
		const identity = canonicalPluginJson(target);
		if (configTargets.has(identity)) fail("duplicate-configuration-scope", "Only one configuration revision per target is allowed", [target.pluginId, target.scope]);
		configTargets.add(identity);
		if (target.scope === "agent" && target.agentId !== input.agentId || target.scope === "session" && target.piboSessionId !== input.piboSessionId) fail("configuration-scope-mismatch", "Configuration target does not belong to this resolution", [target.pluginId, target.scope]);
	}
	const groups = new Map<string, PluginInstallation[]>();
	for (const installation of input.catalog.installations) {
		const group = groups.get(installation.pluginId) ?? [];
		group.push(installation); groups.set(installation.pluginId, group);
	}
	const usable = (i: PluginInstallation) => i.enabled && ["active", "installed", "pending-activation"].includes(i.state);
	for (const [id, group] of [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
		const active = group.filter((i) => i.state === "active" && i.enabled);
		const choices = active.length ? active : group.filter(usable);
		if (choices.length > 1) fail("multiple-plugin-revisions", `Multiple activatable revisions of ${id}`, [id, ...choices.map((i) => i.revision).sort()]);
		const installation = [...(choices.length ? choices : group)].sort((a, b) => a.revision < b.revision ? -1 : a.revision > b.revision ? 1 : 0)[0];
		const manifestErrors = validatePluginManifest(installation.manifest);
		if (manifestErrors.length) { diagnostics.push(...manifestErrors); continue; }
		if (installation.manifest.id !== id || installation.version !== installation.manifest.version) { fail("revision-mismatch", "Installation identity differs from manifest", [id]); continue; }
		installations.set(id, installation);
		const entry = entries.get(id);
		const global = usable(installation) && choices.length === 1;
		const revisionAccepted = !entry || entry.revision === installation.revision || input.acceptedRevisions?.[id]?.includes(entry.revision) === true;
		if (entry?.enabled && !revisionAccepted) fail("selection-revision-migration-required", `Selection accepted ${entry.revision}, not ${installation.revision}; explicit migration is required`, [id, entry.revision, installation.revision]);
		if (entry?.enabled && !global) fail("plugin-unavailable", `Selected plugin ${id} is ${installation.state} or disabled`, [id]);
		const configurations = (input.configurations ?? []).filter((config) => config.target.pluginId === id && (config.target.scope === "app" || config.target.scope === "agent" && config.target.agentId === input.agentId || config.target.scope === "session" && config.target.piboSessionId === input.piboSessionId));
		const mergedConfig: PluginJsonObject = Object.fromEntries([
			...configurations.filter((config) => config.target.scope === "app").map((config) => config.values),
			entry?.config ?? {},
			...configurations.filter((config) => config.target.scope === "agent").map((config) => config.values),
			...configurations.filter((config) => config.target.scope === "session").map((config) => config.values),
		].flatMap((values) => Object.entries(values)));
		pluginConfigurations[id] = mergedConfig;
		if ((entry?.enabled || global && installation.manifest.contributions.some((c) => c.scope === "app" && (c.required || c.defaultEnabled))) && installation.manifest.config) diagnostics.push(...validatePluginConfig(installation.manifest.config.schema, mergedConfig, [id, "config"]));
		for (const key of Object.keys(entry?.contributions ?? {})) if (!installation.manifest.contributions.some((c) => c.id === key && c.scope === "agent")) fail("unknown-contribution-selection", `Unknown agent contribution ${id}/${key}; reference is retained`, [id, key], entry?.enabled === true);
		for (const key of Object.keys(entry?.contributionConfig ?? {})) if (!installation.manifest.contributions.some((c) => c.id === key)) fail("unknown-contribution-config", `Unknown configuration target ${id}/${key}`, [id, key], entry?.enabled === true);
		for (const contribution of installation.manifest.contributions) {
			const qid = qualifyPluginContribution(id, contribution.id);
			const agentEnabled = entry?.enabled === true;
			const known = entry && Object.hasOwn(entry.contributions, contribution.id);
			const wanted = contribution.scope === "app" ? contribution.required || contribution.defaultEnabled : agentEnabled && entry.contributions[contribution.id] === true;
			let status: PluginBuildProvenanceNode["status"] = "disabled";
			let reason = !global ? `Plugin ${installation.state}${installation.enabled ? "" : ", globally disabled"}` : contribution.scope === "agent" && !agentEnabled ? "Plugin not selected by agent" : !wanted ? known ? "Explicitly disabled" : "Not in accepted selection snapshot" : "Selected";
			let conflict = false;
			if (contribution.scope === "agent" && agentEnabled && contribution.required && (!known || entry.contributions[contribution.id] !== true)) {
				conflict = true; status = "required-conflict";
				reason = known ? "Required contribution cannot be disabled" : "New required contribution requires explicit selection migration";
				fail(known ? "required-contribution-disabled" : "new-required-contribution", reason, [qid]);
			}
			const effective = wanted && global && (contribution.scope === "app" || revisionAccepted) && !conflict;
			if (effective) status = contribution.context.kind === "none" ? "no-context" : "selected";
			if (wanted && !revisionAccepted && contribution.scope === "agent") { status = "required-conflict"; reason = "Selection revision requires explicit migration"; }
			const node: PluginBuildProvenanceNode = {
				schemaVersion: 1, id: qid, kind: contribution.kind, origin: "plugin", pluginId: id, pluginRevision: installation.revision, contributionId: qid,
				context: contribution.context, status, selected: effective, installed: installation.state !== "uninstalled", globallyActive: global, agentSelected: agentEnabled,
				required: contribution.required, selectionReason: reason, order: contribution.order ?? nodes.length, predecessors: [...contribution.dependsOn ?? []],
				configurationRevisions: configurations.map((config) => ({ scope: config.target.scope, revision: config.revision })),
				fallback: contribution.title ?? contribution.name ?? qid,
			};
			nodes.push(node); candidates.set(qid, { installation, contribution, entry, node });
			if (effective) {
				const config = entry?.contributionConfig?.[contribution.id] ?? {};
				if (contribution.configSchema) diagnostics.push(...validatePluginConfig(contribution.configSchema, config, [qid, "config"]));
				selected.set(qid, { id: qid, pluginId: id, pluginRevision: installation.revision, contribution, config, required: contribution.required, selectionReason: contribution.scope === "app" ? "infrastructure" : contribution.required ? "required" : "explicit", dependencyPath: [qid] });
			}
		}
	}
	for (const entry of input.selection.plugins) if (!installations.has(entry.pluginId)) {
		fail("missing-plugin", `Plugin ${entry.pluginId} is not installed; draft reference is retained`, [entry.pluginId], entry.enabled);
		nodes.push({ schemaVersion: 1, id: entry.pluginId, kind: "plugin", origin: "plugin", pluginId: entry.pluginId, pluginRevision: entry.revision, context: { kind: "none", reason: "Manifest unavailable" }, status: "unknown", selected: false, installed: false, globallyActive: false, agentSelected: entry.enabled, selectionReason: "Missing plugin", order: nodes.length, predecessors: [], fallback: `Missing plugin ${entry.pluginId}` });
	}
	// Plugin dependencies describe infrastructure, never implicitly enable that plugin's agent tools.
	const infrastructure = new Set<string>();
	const packageVisiting = new Set<string>();
	const externalServiceClaims = Object.fromEntries(Object.entries(input.serviceProviders ?? {})
		.filter(([, owner]) => !installations.has(owner))
		.flatMap(([id, owner]) => input.services?.[id] ? [[id, { owner, version: input.services[id] }]] : []));
	const servicePlan = resolvePluginServiceProviders([...installations.values()].filter(usable), input.serviceProviders, externalServiceClaims);
	diagnostics.push(...servicePlan.diagnostics);
	const recordedServices = new Set<string>();
	function pinServiceOwner(serviceId: string, consumerId: string, path: string[], required = true): boolean {
		const owner = servicePlan.providers[serviceId];
		const provider = owner ? installations.get(owner) : undefined;
		const declaredVersion = input.services?.[serviceId];
		if (!owner || !declaredVersion) {
			fail("service-owner-unavailable", `Service ${serviceId} has no active provider`, [...path, serviceId], required); return false;
		}
		const declaration = provider?.manifest.services?.provides?.find((service) => service.id === serviceId);
		if (provider && (!declaration || !usable(provider))) {
			fail("service-owner-unavailable", `Service ${serviceId} has no installed provider revision`, [...path, serviceId], required); return false;
		}
		if (declaration && declaration.version !== declaredVersion) {
			fail("service-owner-version-mismatch", `Service ${serviceId} differs from its declared provider ${owner}`, [...path, serviceId, owner], required); return false;
		}
		if (provider && owner !== consumerId) visitPackage(owner, [...path, serviceId]);
		if (!recordedServices.has(serviceId)) {
			recordedServices.add(serviceId);
			nodes.push({ schemaVersion: 1, id: `service:${serviceId}`, kind: "service", origin: "plugin", ...(provider ? { pluginId: owner, pluginRevision: provider.revision } : {}),
				context: { kind: "none", reason: provider ? "Infrastructure service; agent contributions remain independently selected" : "Core service available through the public host contract" }, status: "no-context", selected: true,
				installed: true, globallyActive: true, agentSelected: provider ? entries.get(owner)?.enabled === true : false, required,
				selectionReason: `Service dependency of ${path.join(" -> ")}`, order: nodes.length, predecessors: [], fallback: serviceId });
		}
		return true;
	}
	function visitPackage(id: string, path: string[]): void {
		if (packageVisiting.has(id)) { fail("plugin-dependency-cycle", "Plugin dependency cycle", [...path, id]); return; }
		if (infrastructure.has(id)) return;
		const installation = installations.get(id);
		if (!installation || !usable(installation)) return;
		packageVisiting.add(id);
		for (const dependency of installation.manifest.dependencies ?? []) {
			const target = installations.get(dependency.id);
			if (!target || !usable(target)) {
				if (!dependency.optional) fail("missing-plugin-dependency", `Missing plugin dependency ${dependency.id}`, [...path, id, dependency.id]);
				continue;
			}
			if (!satisfiesPluginVersion(target.version, dependency.version)) fail("plugin-version-conflict", `Plugin ${dependency.id} does not satisfy ${dependency.version}`, [...path, id, dependency.id]);
			visitPackage(dependency.id, [...path, id]);
		}
		for (const requirement of installation.manifest.services?.requires ?? []) {
			const version = input.services?.[requirement.id];
			if (!version && requirement.optional) continue;
			if (!version || !satisfiesPluginVersion(version, requirement.version)) { fail("plugin-service-unavailable", `Required service ${requirement.id}@${requirement.version} is unavailable`, [...path, id, requirement.id]); continue; }
			pinServiceOwner(requirement.id, id, [...path, id]);
		}
		packageVisiting.delete(id); infrastructure.add(id);
	}
	// Pure system packages can own services without declaring an agent contribution.
	for (const installation of installations.values()) if (usable(installation) && !installation.manifest.contributions.some((c) => c.scope === "agent")) visitPackage(installation.pluginId, []);
	for (const entry of input.selection.plugins) if (entry.enabled) visitPackage(entry.pluginId, []);
	for (const candidate of selected.values()) if (candidate.contribution.scope === "app") visitPackage(candidate.pluginId, []);
	// Expand only dependencies whose accepted snapshot left the target undecided.
	// Explicit tool or plugin disablement always wins and remains visible in diagnostics.
	const explicitlySelected = new Set(selected.keys());
	const blockedDependencies = new Map<string, { code: string; reason: string }>();
	function dependencyActivationBlock(candidate: NonNullable<ReturnType<typeof candidates.get>>): { code: string; reason: string } | undefined {
		if (!candidate.node.globallyActive) {
			return { code: "contribution-dependency-plugin-unavailable", reason: `Dependency plugin ${candidate.installation.pluginId} is unavailable or globally disabled` };
		}
		const entry = candidate.entry;
		if (!entry) return { code: "contribution-dependency-unaccepted", reason: `Dependency ${candidate.node.id} is absent from the accepted agent selection` };
		if (entry.dependencyPolicy === "deny" || entry.dependencyPolicy === undefined && entry.enabled === false) {
			return { code: "contribution-dependency-plugin-disabled", reason: `Dependency plugin ${entry.pluginId} is explicitly disabled for this agent` };
		}
		const explicit = entry.explicitContributions;
		const explicitlyDecided = explicit ? Object.hasOwn(explicit, candidate.contribution.id) : Object.hasOwn(entry.contributions, candidate.contribution.id);
		const explicitlyEnabled = explicit ? explicit[candidate.contribution.id] === true : entry.contributions[candidate.contribution.id] === true;
		if (explicitlyDecided && !explicitlyEnabled) {
			return { code: "contribution-dependency-disabled", reason: `Dependency ${candidate.node.id} is explicitly disabled for this agent` };
		}
		return undefined;
	}
	function requireDependencies(id: string, path: string[]): void {
		const contribution = selected.get(id);
		if (!contribution || path.includes(id)) return;
		for (const dependency of contribution.contribution.dependsOn ?? []) {
			let target = selected.get(dependency);
			const candidate = candidates.get(dependency);
			const activationBlock = candidate ? dependencyActivationBlock(candidate) : undefined;
			if (!target && activationBlock) blockedDependencies.set(`${id}\u0000${dependency}`, activationBlock);
			if (!target && candidate?.node.globallyActive && !activationBlock) {
				const config = candidate.entry?.contributionConfig?.[candidate.contribution.id] ?? {};
				if (candidate.contribution.configSchema) diagnostics.push(...validatePluginConfig(candidate.contribution.configSchema, config, [dependency, "config"]));
				target = {
					id: dependency,
					pluginId: candidate.installation.pluginId,
					pluginRevision: candidate.installation.revision,
					contribution: candidate.contribution,
					config,
					required: true,
					selectionReason: "dependency",
					dependencyPath: [...path, id, dependency],
				};
				selected.set(dependency, target);
				candidate.node.selected = true;
				candidate.node.status = candidate.contribution.context.kind === "none" ? "no-context" : "selected";
				candidate.node.selectionReason = "dependency";
			}
			if (target) {
				if (contribution.required && !target.required) {
					target.required = true;
					target.selectionReason = "dependency";
					target.dependencyPath = [...path, id, dependency];
				}
				if ((contribution.required || !explicitlySelected.has(dependency)) && candidate) candidate.node.required = true;
				requireDependencies(dependency, [...path, id]);
			}
		}
	}
	for (const id of [...selected.keys()]) requireDependencies(id, []);
	const ordered: EffectivePluginContribution[] = [];
	const visited = new Set<string>(); const visiting = new Set<string>(); const unavailable = new Set<string>();
	function visit(id: string, path: string[]): boolean {
		if (visiting.has(id)) { fail("contribution-cycle", "Contribution dependency cycle", [...path, id]); unavailable.add(id); return false; }
		if (visited.has(id)) return !unavailable.has(id);
		const contribution = selected.get(id);
		if (!contribution) return false;
		visiting.add(id);
		const candidate = candidates.get(id)!;
		const reasons: string[] = [];
		for (const dependency of contribution.contribution.dependsOn ?? []) if (contribution.contribution.scope === "app" && candidates.get(dependency)?.contribution.scope === "agent" || !visit(dependency, [...path, id])) {
			const blocked = blockedDependencies.get(`${id}\u0000${dependency}`);
			reasons.push(blocked?.reason ?? `Dependency ${dependency} is unavailable`);
			fail(blocked?.code ?? "contribution-dependency-unavailable", reasons.at(-1)!, [...path, id, dependency], contribution.required);
		}
		for (const dependency of candidate.installation.manifest.dependencies ?? []) {
			const target = installations.get(dependency.id);
			if (!target || !usable(target) || !satisfiesPluginVersion(target.version, dependency.version)) {
				if (!dependency.optional) { reasons.push(`Plugin dependency ${dependency.id}@${dependency.version} is unavailable`); fail("plugin-dependency-unavailable", reasons.at(-1)!, [id, dependency.id], contribution.required); }
			}
		}
		const runtimeReasons = contribution.contribution.scope === "agent" ? pluginRuntimeIncompatibilities(contribution.contribution.runtime, input.runtime) : [];
		// The path keeps the dependency chain contract; attribution names the failing contribution itself.
		for (const reason of runtimeReasons) { reasons.push(reason); fail("runtime-unsupported", reason, contribution.dependencyPath, contribution.required, id); }
		for (const service of contribution.contribution.services ?? []) {
			const version = input.services?.[service.id];
			if (!version || !satisfiesPluginVersion(version, service.version)) {
				if (!service.optional) { reasons.push(`Service ${service.id}@${service.version} is unavailable`); fail("contribution-service-unavailable", reasons.at(-1)!, [id, service.id], contribution.required); }
			} else if (!pinServiceOwner(service.id, contribution.pluginId, [id], contribution.required)) reasons.push(`Service owner for ${service.id} is unavailable`);
		}
		visiting.delete(id); visited.add(id);
		if (reasons.length || unavailable.has(id)) {
			unavailable.add(id); candidate.node.selected = false;
			candidate.node.status = contribution.required ? "required-conflict" : "unsupported";
			candidate.node.selectionReason = reasons.join("; ") || "Dependency cycle";
			return false;
		}
		candidate.node.selectionReason = contribution.selectionReason;
		ordered.push(contribution); return true;
	}
	for (const id of [...selected.keys()].sort((a, b) => (selected.get(a)!.contribution.order ?? 0) - (selected.get(b)!.contribution.order ?? 0) || (a < b ? -1 : a > b ? 1 : 0))) visit(id, []);

	const replacements = new Set<string>();
	const names = new Map<string, EffectivePluginContribution[]>();
	for (const contribution of ordered) {
		const c = contribution.contribution;
		const name = c.name ?? (c.kind === "tool" ? c.id : undefined);
		if (!name && !c.replaces?.length && !Object.hasOwn(input.providers ?? {}, c.kind) && !ordered.some((entry) => entry.contribution.replaces?.includes(contribution.id))) continue;
		const key = name ? `${c.kind}:${name}` : c.kind;
		const claims = names.get(key) ?? []; claims.push(contribution); names.set(key, claims);
	}
	for (const [key, claims] of names) {
		const provider = input.providers?.[key];
		if (claims.length < 2 && !provider) continue;
		const chosen = claims.find((claim) => claim.id === provider);
		if (!chosen || claims.some((claim) => claim !== chosen && !chosen.contribution.replaces?.includes(claim.id))) {
			fail("contribution-name-conflict", `Conflicting ${key}; explicit provider choice and replacement declarations required`, claims.map((claim) => claim.id)); continue;
		}
		for (const claim of claims) if (claim !== chosen) {
			replacements.add(claim.id); const node = candidates.get(claim.id)!.node;
			node.selected = false; node.status = "replaced"; node.selectionReason = `Explicitly replaced by ${chosen.id}`;
		}
	}
	for (const [key, provider] of Object.entries(input.providers ?? {})) if (!names.has(key)) fail("unknown-contribution-provider", `Selected provider ${provider} has no ${key} claim`, [provider]);
	// A replacement does not secretly satisfy a dependency on a different qualified contribution.
	for (const contribution of ordered) if (!replacements.has(contribution.id)) for (const dependency of contribution.contribution.dependsOn ?? []) if (replacements.has(dependency)) fail("replaced-dependency", `Dependency ${dependency} was explicitly replaced; migrate the dependency contract`, [contribution.id, dependency]);
	const effective = ordered.filter((entry) => !replacements.has(entry.id));
	const resources: IndependentPluginResource[] = [];
	const references = new Map<string, string>();
	const resourceNames = new Map<string, string>();
	for (const contribution of effective) {
		const c = contribution.contribution;
		const name = c.name ?? (c.kind === "tool" ? c.id : undefined);
		if (name) resourceNames.set(`${c.kind}:${name}`, contribution.id);
	}
	for (const [index, contribution] of effective.entries()) candidates.get(contribution.id)!.node.order = index;
	const resourceIds = new Set(nodes.map((node) => node.id));
	for (const resource of input.resources ?? []) {
		if (resourceIds.has(resource.id)) fail("duplicate-resource-id", `Resource identity ${resource.id} is not unique`, [resource.id]);
		resourceIds.add(resource.id);
		const key = canonicalPluginJson([resource.kind, resource.reference, resource.contentHash ?? null]);
		const previous = references.get(key);
		const nameKey = `${resource.kind}:${resource.name}`;
		const conflict = resourceNames.get(nameKey);
		if (!previous && conflict) fail("resource-name-conflict", `Independent resource ${resource.name} conflicts with ${conflict}`, [resource.id, conflict]);
		const node: PluginBuildProvenanceNode = {
			schemaVersion: 1, id: resource.id, kind: resource.kind, origin: resource.origin, context: resource.context,
			status: previous ? "deduplicated" : conflict ? "required-conflict" : resource.context.kind === "none" ? "no-context" : "selected",
			selected: !previous && !conflict, selectionReason: previous ? `Exact reference deduplicated with ${previous}` : conflict ? `Name conflict with ${conflict}` : "Independent resource selection",
			order: resource.order ?? nodes.length, predecessors: previous ? [previous] : [], fallback: resource.name,
		};
		nodes.push(node);
		if (!previous) { references.set(key, resource.id); resourceNames.set(nameKey, resource.id); if (!conflict) resources.push(resource); }
	}
	const usedPlugins = new Set([...effective.map((c) => c.pluginId), ...infrastructure]);
	for (const entry of input.selection.plugins) if (entry.enabled && installations.has(entry.pluginId)) usedPlugins.add(entry.pluginId);
	const plan: EffectivePluginPlan = {
		schemaVersion: 1, kind: input.kind ?? "preview", catalogRevision: input.catalog.revision, selectionRevision: input.selectionRevision,
		...(input.piboSessionId ? { piboSessionId: input.piboSessionId } : {}), ...(input.generation ? { generation: input.generation } : {}),
		runtime: input.runtime, selection: input.selection,
		plugins: [...usedPlugins].sort().map((id) => { const i = installations.get(id)!; return { pluginId: id, revision: i.revision, version: i.version, contentHash: i.contentHash }; }),
		contributions: effective, resources, configurations: input.configurations ?? [], pluginConfigurations, nodes,
		diagnostics, valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
	};
	return freezePluginValue(structuredClone(plan));
}

export function assertEffectivePluginPlan(plan: EffectivePluginPlan): EffectivePluginPlan {
	if (!plan.valid || plan.diagnostics.some((diagnostic) => diagnostic.severity === "error")) throw new PluginValidationError(plan.diagnostics);
	return plan;
}

export class PluginContributionResolver {
	resolve(input: PluginResolutionInput): EffectivePluginPlan { return resolvePluginContributions(input); }
}
