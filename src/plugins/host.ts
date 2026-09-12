import { resolvePluginServiceProviders } from "./service-providers.js";
import { qualifyPluginContribution, type PluginDiagnostic, type PluginInstallation, type PluginManifest } from "./manifest.js";
import { freezePluginValue, isPluginRecord, parsePluginManifest, pluginDiagnostic, PluginValidationError, satisfiesPluginVersion } from "./schema.js";
import { PluginScope, type PluginDisposer } from "./scope.js";
import { PluginContributionRegistry, PluginServiceRegistry } from "./services.js";

export type PluginSetupContext = {
	manifest: PluginManifest;
	scope: PluginScope;
	services: {
		get<T = unknown>(id: string): T | undefined;
		require<T = unknown>(id: string): T;
		/** Returns false for a provider explicitly replaced by the composition. */
		provide<T>(id: string, value: T): boolean;
	};
	isServiceProvider(id: string): boolean;
	register<T>(localId: string, value: T): PluginDisposer;
	registerResource<T>(kind: string, key: string, value: T): PluginDisposer;
};
export type PluginDefinition = {
	installation: PluginInstallation;
	setup(context: PluginSetupContext): void | PluginDisposer | Promise<void | PluginDisposer>;
};
export type PluginActivationInput = { plugins: readonly PluginDefinition[]; providers?: Record<string, string> };
export type PluginActivationPlan = { order: string[]; providers: Record<string, string>; diagnostics: PluginDiagnostic[]; valid: boolean };

/** Complete graph validation happens before invoking any setup callback. */
export function planPluginActivation(input: PluginActivationInput): PluginActivationPlan {
	const diagnostics: PluginDiagnostic[] = [];
	const plugins = new Map<string, PluginDefinition>();
	const edges = new Map<string, Set<string>>();
	const providers: Record<string, string> = Object.create(null);
	const claims = new Map<string, { pluginId: string; version: string; replaces?: string[] }[]>();
	const fail = (code: string, message: string, path: string[]) => diagnostics.push({ ...pluginDiagnostic(code, message, path), pluginId: path[0] });
	for (const plugin of input.plugins) {
		const i = plugin.installation;
		try { parsePluginManifest(i.manifest); } catch (error) {
			if (error instanceof PluginValidationError) { diagnostics.push(...error.diagnostics); continue; }
			throw error;
		}
		if (plugins.has(i.pluginId)) { fail("duplicate-plugin", `Multiple revisions/definitions for ${i.pluginId}`, [i.pluginId]); continue; }
		if (i.pluginId !== i.manifest.id || i.version !== i.manifest.version || !i.revision || !i.contentHash) fail("revision-mismatch", "Installation identity does not match manifest", [i.pluginId]);
		if (!i.enabled || !["installed", "active", "pending-activation"].includes(i.state)) fail("plugin-not-activatable", `Plugin ${i.pluginId} is ${i.state} or disabled`, [i.pluginId]);
		plugins.set(i.pluginId, plugin);
		edges.set(i.pluginId, new Set());
		for (const service of i.manifest.services?.provides ?? []) {
			const entries = claims.get(service.id) ?? [];
			entries.push({ pluginId: i.pluginId, ...service }); claims.set(service.id, entries);
		}
	}
	const servicePlan = resolvePluginServiceProviders([...plugins.values()].map((plugin) => plugin.installation), input.providers);
	Object.assign(providers, servicePlan.providers);
	diagnostics.push(...servicePlan.diagnostics);
	for (const [id, plugin] of plugins) {
		for (const dependency of plugin.installation.manifest.dependencies ?? []) {
			const target = plugins.get(dependency.id);
			if (!target) { if (!dependency.optional) fail("missing-plugin-dependency", `Missing plugin ${dependency.id}`, [id, dependency.id]); continue; }
			if (!satisfiesPluginVersion(target.installation.version, dependency.version)) fail("plugin-version-conflict", `Plugin ${dependency.id} does not satisfy ${dependency.version}`, [id, dependency.id]);
			edges.get(id)!.add(dependency.id);
		}
		for (const requirement of plugin.installation.manifest.services?.requires ?? []) {
			const provider = providers[requirement.id];
			if (!provider) { if (!requirement.optional) fail("missing-service", `Missing service ${requirement.id}`, [id, requirement.id]); continue; }
			const declaration = claims.get(requirement.id)!.find((entry) => entry.pluginId === provider)!;
			if (!satisfiesPluginVersion(declaration.version, requirement.version)) fail("service-version-conflict", `Service ${requirement.id} does not satisfy ${requirement.version}`, [id, requirement.id, provider]);
			if (provider !== id) edges.get(id)!.add(provider);
		}
	}
	// Validate contribution identity/dependency contracts before any backend setup import/effect.
	const contributionEdges = new Map<string, string[]>();
	for (const [id, plugin] of plugins) for (const contribution of plugin.installation.manifest.contributions) {
		contributionEdges.set(qualifyPluginContribution(id, contribution.id), [...contribution.dependsOn ?? []]);
	}
	const contributionVisited = new Set<string>();
	function visitContribution(id: string, path: string[]): void {
		if (path.includes(id)) { fail("contribution-cycle", "Contribution dependency cycle", [...path, id]); return; }
		if (contributionVisited.has(id)) return;
		const dependencies = contributionEdges.get(id);
		if (!dependencies) { fail("missing-contribution-dependency", `Missing contribution ${id}`, [...path, id]); return; }
		for (const dependency of [...dependencies].sort()) visitContribution(dependency, [...path, id]);
		contributionVisited.add(id);
	}
	for (const id of [...contributionEdges.keys()].sort()) visitContribution(id, []);
	const order: string[] = [];
	const visited = new Set<string>();
	const active = new Set<string>();
	function visit(id: string, path: string[]) {
		if (active.has(id)) { fail("dependency-cycle", `Dependency cycle ${[...path, id].join(" -> ")}`, [...path, id]); return; }
		if (visited.has(id)) return;
		active.add(id);
		for (const dependency of [...edges.get(id) ?? []].sort()) visit(dependency, [...path, id]);
		active.delete(id); visited.add(id); order.push(id);
	}
	for (const id of [...plugins.keys()].sort()) visit(id, []);
	return freezePluginValue({ order, providers, diagnostics, valid: !diagnostics.some((d) => d.severity === "error") });
}

export class PluginHost {
	readonly contributions = new PluginContributionRegistry();
	readonly services = new PluginServiceRegistry(this.contributions);
	private state: "idle" | "starting" | "active" | "stopping" | "failed" = "idle";
	private scopes: PluginScope[] = [];
	private installations: PluginInstallation[] = [];
	private diagnostics: PluginDiagnostic[] = [];
	private stopPromise?: Promise<void>;

	inspect() {
		return freezePluginValue({ state: this.state, plugins: structuredClone(this.installations), diagnostics: structuredClone(this.diagnostics) });
	}

	async start(input: PluginActivationInput): Promise<void> {
		if (this.state !== "idle") throw new Error(`Plugin host is ${this.state}; stop/drain before activating another revision`);
		const plan = planPluginActivation(input);
		this.diagnostics = [...plan.diagnostics];
		if (!plan.valid) throw new PluginValidationError(plan.diagnostics);
		const plugins = new Map(input.plugins.map((plugin) => [plugin.installation.pluginId, {
			installation: freezePluginValue(structuredClone(plugin.installation)), setup: plugin.setup,
		}]));
		this.state = "starting"; this.stopPromise = undefined;
		try {
			for (const id of plan.order) {
				const definition = plugins.get(id)!;
				const installation = definition.installation;
				const manifest = installation.manifest;
				const scope = new PluginScope(id, `${id}@${installation.revision}`);
				this.scopes.push(scope);
				const requireDeclared = (serviceId: string) => {
					scope.assertOpen();
					if (!manifest.services?.requires?.some((entry) => entry.id === serviceId) && !manifest.services?.provides?.some((entry) => entry.id === serviceId)) throw new Error(`${id} did not declare service ${serviceId}`);
				};
				const cleanup = await definition.setup({
					manifest, scope,
					isServiceProvider: (serviceId) => plan.providers[serviceId] === id,
					services: {
						get: <T>(serviceId: string) => { requireDeclared(serviceId); return this.services.get<T>(serviceId); },
						require: <T>(serviceId: string) => { requireDeclared(serviceId); return this.services.require<T>(serviceId); },
						provide: (serviceId, value) => {
							scope.assertOpen();
							const declaration = manifest.services?.provides?.find((entry) => entry.id === serviceId);
							if (!declaration) throw new Error(`${id} did not declare provider ${serviceId}`);
							if (plan.providers[serviceId] !== id) return false;
							this.services.provide(scope, serviceId, declaration.version, value); return true;
						},
					},
					register: (localId, value) => {
						const contribution = manifest.contributions.find((entry) => entry.id === localId);
						if (!contribution) throw new Error(`${id} did not declare contribution ${localId}`);
						if (contribution.kind === "tool" && isPluginRecord(value) && value.name !== undefined && value.name !== (contribution.name ?? contribution.id)) throw new Error(`Tool ${id}/${localId} name differs from its manifest`);
						return this.contributions.register(scope, "contribution", qualifyPluginContribution(id, localId), { contribution, installation, value });
					},
					registerResource: (kind, key, value) => {
						if (["service", "contribution"].includes(kind)) throw new Error(`Use the declared ${kind} registration API`);
						return this.contributions.register(scope, kind, key, value);
					},
				});
				if (cleanup !== undefined) scope.defer(cleanup);
				for (const service of manifest.services?.provides ?? []) if (plan.providers[service.id] === id && this.services.get(service.id) === undefined) throw new Error(`${id} did not provide declared service ${service.id}`);
				this.installations.push(installation);
			}
			this.state = "active";
		} catch (error) {
			this.diagnostics.push(pluginDiagnostic("activation-failed", error instanceof Error ? error.message : String(error), this.scopes.map((scope) => scope.pluginId)));
			try { await this.cleanup(); this.state = "idle"; }
			catch (cleanupError) { this.state = "failed"; throw new AggregateError([error, cleanupError], "Plugin activation and rollback failed"); }
			throw error;
		}
	}

	/** Session children use the same root ownership and are disposed before provider teardown. */
	createSessionScope(pluginId: string, piboSessionId: string, generation: string): PluginScope {
		if (this.state !== "active") throw new Error(`Plugin host is ${this.state}`);
		const root = this.scopes.find((scope) => scope.pluginId === pluginId);
		if (!root) throw new Error(`Plugin ${pluginId} is not active`);
		if (!piboSessionId || !generation) throw new Error("Session and generation identities are required");
		return root.child(`${piboSessionId}/${generation}`);
	}

	stop(): Promise<void> {
		if (this.stopPromise) return this.stopPromise;
		if (this.state === "starting") return Promise.reject(new Error("Plugin host is starting"));
		if (this.state === "failed") return Promise.reject(new PluginValidationError(this.diagnostics));
		this.state = "stopping";
		this.stopPromise = this.cleanup().then(() => { this.state = "idle"; }, (error) => { this.state = "failed"; throw error; });
		return this.stopPromise;
	}

	private async cleanup(): Promise<void> {
		const errors: unknown[] = [];
		for (const scope of this.scopes.splice(0).reverse()) {
			try { await scope.dispose(); } catch (error) {
				errors.push(error);
				this.diagnostics.push(pluginDiagnostic("cleanup-failed", `Cleanup failed for ${scope.instanceId}`, [scope.pluginId, scope.instanceId]));
			}
		}
		if (errors.length) throw new AggregateError(errors, "Plugin host cleanup failed; activation/replacement remains blocked");
		this.installations = [];
	}
}
