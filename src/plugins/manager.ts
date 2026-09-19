import { randomUUID } from "node:crypto";
import type { PluginConfigurationSnapshot, PluginConfigurationTarget, PluginInstallation } from "./manifest.js";
import { validatePluginConfig } from "./schema.js";
import { planPluginActivation } from "./host.js";
import { LocalPluginSourceResolver, stagePluginSource, verifyPluginArtifact, type PluginSourceInput, type PluginSourceResolver } from "./sources.js";
import { installationArtifact, pluginErrorMessage, PluginConflictError, PluginValidationError, type PluginArtifact, type PluginStore, type StoredPluginInstallation } from "./store.js";
import { hasNewPluginConsumers, pluginDrainBlockers, pluginImpact, type PluginConsumerCollector, type PluginImpact, type PluginOperation, type PluginConsumer } from "./operations.js";

export interface PluginManagerLifecycle {
	/** Delegate to the ONE core host; imports are permitted only here, after verification. */
	activate(artifact: PluginArtifact): Promise<void>;
	/** Optional atomic host composition used only by verified cold-start replacement. */
	activateBatch?(artifacts: readonly PluginArtifact[]): Promise<void>;
	/** Must resolve only after complete cleanup; reject on any retained resource. Never abort runs. */
	deactivate(pluginId: string): Promise<void>;
	/** Restart recovery must prove the real host state; unknown never means successfully stopped. */
	status(pluginId: string): Promise<"active" | "inactive" | "unknown">;
}
export interface PluginManagerOptions {
	store: PluginStore;
	artifactRoot: string;
	collectConsumers?: PluginConsumerCollector;
	lifecycle?: PluginManagerLifecycle;
	sourceResolver?: PluginSourceResolver;
	now?: () => Date;
	/** Fault injection occurs AFTER durable checkpoints; no production hook is required. */
	checkpoint?: (stage: string, operation: PluginOperation) => void | Promise<void>;
	/** Optional explicit compatibility decision. Exact pinned hash otherwise required. */
	isCompatibleRevision?: (pluginId: string, from: string, to: string) => boolean;
	/** Host-owned composition roots included in graph validation but not persisted as managed installations. */
	externalInstallations?: readonly PluginInstallation[];
	/** Explicit core service-provider choices for import-free installation graph validation. */
	providers?: Record<string, string>;
	/** Live core-service metadata; values remain private to the host. */
	coreServices?: Record<string, { owner: string; version: string }> | (() => Record<string, { owner: string; version: string }>);
	/** Verified migration owners omitted only from import-free dependency resolution; lifecycle and persistence remain unchanged. */
	excludedInstallationIds?: ReadonlySet<string>;
}
export interface PluginSessionRecovery {
	piboSessionId: string;
	status: "ready" | "degraded" | "blocked" | "unknown";
	canResume: boolean;
	historyReadable: true;
	diagnostics: { pluginId?: string; code: string; required: boolean; message: string }[];
}
const terminal = new Set(["complete", "cancelled", "committed"]);
export class PluginManager {
	readonly store: PluginStore;
	private readonly sourceResolver: PluginSourceResolver;
	constructor(readonly options: PluginManagerOptions) { this.store = options.store; this.sourceResolver = options.sourceResolver ?? new LocalPluginSourceResolver(); }
	private now(): string { return (this.options.now?.() ?? new Date()).toISOString(); }
	private requireInstallation(id: string): StoredPluginInstallation {
		const installation = this.store.getInstallation(id);
		if (!installation) throw new PluginValidationError(`Plugin is not installed: ${id}`);
		return installation;
	}
	private requireLifecycle(): PluginManagerLifecycle {
		if (!this.options.lifecycle) throw new PluginValidationError("Plugin host lifecycle is unavailable; no executable state was changed");
		return this.options.lifecycle;
	}
	private async impact(id: string): Promise<PluginImpact> {
		if (!this.options.collectConsumers) throw new PluginValidationError("Complete existing-store consumer collector is required; refusing destructive operation");
		return pluginImpact([...await this.options.collectConsumers(id), ...this.admissionConsumers(id)]);
	}
	private admissionConsumers(pluginId: string): PluginConsumer[] {
		return this.store.listAdmissions(pluginId).map((admission) => ({ kind: "session", id: admission.piboSessionId, usage: "active", generation: admission.generationId, revision: admission.plugins.find((plugin) => plugin.pluginId === pluginId)!.revision }));
	}
	private coldReplacementBlockers(pluginId: string, impact: PluginImpact): PluginConsumer[] {
		const admissionKeys = new Set(this.admissionConsumers(pluginId).map((consumer) => `${consumer.id}\0${consumer.generation ?? ""}`));
		return impact.consumers.filter((consumer) =>
			(consumer.kind === "session" && consumer.usage === "active" && admissionKeys.has(`${consumer.id}\0${consumer.generation ?? ""}`))
			|| (["run", "runtime"].includes(consumer.kind) && consumer.usage === "active")
			|| (consumer.kind === "plugin" && ["active", "required"].includes(consumer.usage)),
		);
	}
	private assertNoNewAdmissions(pluginId: string, approved: PluginImpact): void {
		if (hasNewPluginConsumers(approved, pluginImpact(this.admissionConsumers(pluginId)))) throw new PluginConflictError("New generation admission appeared; review a fresh impact plan");
	}
	private updateOperation(operation: PluginOperation, patch: Partial<PluginOperation>): PluginOperation {
		return this.store.putOperation({ ...operation, ...patch }, operation.revision);
	}
	async inspect(source: PluginSourceInput) {
		const result = await this.sourceResolver.resolve(source);
		return { manifest: result.manifest, source: result.source, contentHash: result.contentHash, files: [...result.files.keys()].sort() };
	}
	async install(source: PluginSourceInput, options: { expectedRevision: number; dryRun?: boolean }) {
		const resolved = await this.sourceResolver.resolve(source);
		const previous = this.store.getInstallation(resolved.manifest.id);
		if ((previous?.stateRevision ?? 0) !== options.expectedRevision) throw new PluginConflictError();
		if (previous?.state === "retiring") throw new PluginConflictError("Plugin is retiring; cancel or finish that operation before installing");
		if (previous?.pendingArtifact) throw new PluginConflictError("An update is already pending activation");
		// Use the core's import-free graph validator, not a second dependency/version resolver.
		const candidate: StoredPluginInstallation = { pluginId: resolved.manifest.id, revision: resolved.contentHash, version: resolved.manifest.version, contentHash: resolved.contentHash, source: resolved.source, manifest: resolved.manifest, state: "installed", enabled: true, stateRevision: options.expectedRevision, createdAt: this.now(), updatedAt: this.now() };
		const composition = [...(this.options.externalInstallations ?? []), ...this.store.listInstallations().filter((item) => item.pluginId !== candidate.pluginId && !this.options.excludedInstallationIds?.has(item.pluginId) && !["uninstalled", "failed", "staged"].includes(item.state)).map((item) => ({ ...item, enabled: true })), candidate];
		const coreServices = typeof this.options.coreServices === "function" ? this.options.coreServices() : this.options.coreServices;
		const graph = planPluginActivation({ plugins: composition.map((installation) => ({ installation, setup() {} })), providers: this.options.providers, coreServices });
		if (!graph.valid) throw new PluginValidationError(`Plugin dependency/service graph invalid: ${graph.diagnostics.map((item) => item.message).join("; ")}`);
		if (options.dryRun) return { dryRun: true as const, pluginId: resolved.manifest.id, contentHash: resolved.contentHash, manifest: resolved.manifest, state: previous?.state, expectedRevision: options.expectedRevision };
		let operation = this.store.putOperation<PluginOperation>({ id: randomUUID(), pluginId: resolved.manifest.id, revision: 0, kind: "install", state: "staging", createdAt: this.now(), installationRevision: options.expectedRevision, priorInstallation: previous }, 0);
		await this.options.checkpoint?.("staging", operation);
		try {
			const artifact = await stagePluginSource(resolved, this.options.artifactRoot, this.now());
			operation = this.updateOperation(operation, { artifact });
			await this.options.checkpoint?.("staged", operation);
			const installation = this.store.transaction(() => {
				const input: StoredPluginInstallation = previous?.enabled && previous.state !== "uninstalled"
					? { ...previous, pendingArtifact: artifact, state: "pending-activation", updatedAt: this.now() }
					: { ...artifact, stateRevision: options.expectedRevision, state: "installed", enabled: false, updatedAt: this.now() };
				const value = this.store.putInstallation(input, options.expectedRevision);
				operation = this.updateOperation(operation, { state: "committed", installationRevision: value.stateRevision });
				return value;
			});
			return { installation, operation };
		} catch (error) {
			this.updateOperation(operation, { state: "failed", diagnostic: pluginErrorMessage(error, "Plugin staging failed") });
			throw error;
		}
	}
	assertCanActivate(pluginIds: readonly string[]): void {
		for (const pluginId of pluginIds) {
			const installation = this.store.getInstallation(pluginId);
			if (!installation || !installation.enabled || !["active", "pending-activation"].includes(installation.state)) throw new PluginConflictError(`Plugin cannot accept new work: ${pluginId} (${installation?.state ?? "missing"})`);
		}
	}
	/** Atomically reserves before the first async runtime setup; retirement and reservation use the same DB lock. */
	reserveGeneration(input: { piboSessionId: string; generationId: string; pluginIds: readonly string[] }) {
		return this.store.transaction(() => {
			const pluginIds = [...new Set(input.pluginIds)].sort();
			const existing = this.store.getAdmission(input.piboSessionId, input.generationId);
			if (existing) {
				if (existing.state !== "reserved" || JSON.stringify(existing.plugins.map((plugin) => plugin.pluginId)) !== JSON.stringify(pluginIds)) throw new PluginConflictError("Generation admission cannot be reused or widened");
				return existing;
			}
			this.assertCanActivate(pluginIds);
			return this.store.putAdmission({ piboSessionId: input.piboSessionId, generationId: input.generationId, revision: 0, state: "reserved", plugins: pluginIds.map((pluginId) => ({ pluginId, revision: this.requireInstallation(pluginId).revision })), createdAt: this.now() }, 0);
		});
	}
	/** Caller must complete/dispose runtime resources first. Crash-orphan reservations remain visible blockers. */
	releaseGenerationAdmission(piboSessionId: string, generationId: string, expectedRevision: number) {
		return this.store.transaction(() => {
			const admission = this.store.getAdmission(piboSessionId, generationId);
			if (!admission || admission.state !== "reserved") throw new PluginConflictError("Generation admission is absent or already released");
			return this.store.putAdmission({ ...admission, state: "released" }, expectedRevision);
		});
	}
	/** Non-destructive drain check for boot/update orchestration; same blockers that would stall activation. */
	async listDrainBlockers(pluginId: string): Promise<PluginConsumer[]> {
		return pluginDrainBlockers(await this.impact(pluginId));
	}
	/** Releases superseded reservations for a session that rebinds without a live generation (crash/disposal orphans). Returns the released count. */
	releaseSupersededSessionAdmissions(piboSessionId: string): number {
		return this.store.transaction(() => {
			let released = 0;
			for (const admission of this.store.listSessionAdmissions(piboSessionId)) {
				this.store.putAdmission({ ...admission, state: "released" }, admission.revision);
				released++;
			}
			return released;
		});
	}
	/** Cold-start batch replacement for a verified, caller-transactional cutover. Ordinary live activation keeps the drain protocol below. */
	async activateColdReplacements(inputs: readonly { pluginId: string; expectedRevision: number }[]): Promise<PluginOperation[]> {
		const lifecycle = this.requireLifecycle();
		if (!lifecycle.activateBatch) throw new PluginValidationError("Cold replacement batch lifecycle is unavailable");
		if (!this.store.db.isTransaction) throw new PluginValidationError("Cold replacement requires a caller-owned migration transaction");
		if (inputs.length === 0) return [];
		const unique = new Map(inputs.map((input) => [input.pluginId, input]));
		if (unique.size !== inputs.length) throw new PluginValidationError("Cold replacement plugin IDs must be unique");
		const prepared: { installation: StoredPluginInstallation; artifact: PluginArtifact; impact: PluginImpact }[] = [];
		for (const { pluginId, expectedRevision } of inputs) {
			const installation = this.requireInstallation(pluginId);
			if (installation.stateRevision !== expectedRevision) throw new PluginConflictError();
			if (!["installed", "pending-activation", "failed"].includes(installation.state)) throw new PluginConflictError(`Cannot cold-activate plugin in ${installation.state}`);
			const artifact = installation.pendingArtifact ?? installationArtifact(installation);
			await verifyPluginArtifact(artifact);
			const impact = await this.impact(pluginId);
			const blockers = this.coldReplacementBlockers(pluginId, impact);
			if (blockers.length) throw new PluginConflictError(`Cold cutover replacement is blocked by active consumers: ${blockers.map((consumer) => `${consumer.kind}:${consumer.id}`).join(", ")}`);
			if (await lifecycle.status(pluginId) !== "inactive") throw new PluginConflictError(`Cold cutover requires inactive host resources for ${pluginId}`);
			this.assertNoNewAdmissions(pluginId, impact);
			prepared.push({ installation, artifact, impact });
		}
		let operations = this.store.transaction(() => prepared.map(({ installation, artifact, impact }) => {
			const gate = this.store.putInstallation({ ...installation, state: "retiring", updatedAt: this.now() }, installation.stateRevision);
			return this.store.putOperation<PluginOperation>({ id: randomUUID(), pluginId: installation.pluginId, revision: 0, kind: "activate", state: "activating", createdAt: this.now(), installationRevision: gate.stateRevision, priorInstallation: installation, artifact, impact }, 0);
		}));
		for (const operation of operations) await this.options.checkpoint?.("activating", operation);
		await lifecycle.activateBatch(prepared.map(({ artifact }) => artifact));
		for (const operation of operations) {
			if (await lifecycle.status(operation.pluginId) !== "active") throw new PluginValidationError(`Host did not confirm cold replacement activation for ${operation.pluginId}`);
			const finalBlockers = this.coldReplacementBlockers(operation.pluginId, await this.impact(operation.pluginId));
			if (finalBlockers.length) throw new PluginConflictError(`Active consumers appeared during cold cutover replacement: ${finalBlockers.map((consumer) => `${consumer.kind}:${consumer.id}`).join(", ")}`);
		}
		operations = this.store.transaction(() => operations.map((operation) => {
			const active = this.store.putInstallation({ ...operation.artifact!, state: "active", enabled: true, stateRevision: operation.installationRevision, updatedAt: this.now() }, operation.installationRevision);
			return this.updateOperation(operation, { state: "complete", installationRevision: active.stateRevision, diagnostic: undefined });
		}));
		return operations;
	}

	async activate(pluginId: string, options: { expectedRevision: number }): Promise<PluginOperation> {
		this.requireLifecycle();
		const installation = this.requireInstallation(pluginId);
		if (installation.stateRevision !== options.expectedRevision) throw new PluginConflictError();
		if (!["installed", "pending-activation", "failed"].includes(installation.state)) throw new PluginConflictError(`Cannot activate plugin in ${installation.state}`);
		const artifact = installation.pendingArtifact ?? installationArtifact(installation);
		await verifyPluginArtifact(artifact);
		const impact = await this.impact(pluginId);
		let operation = this.store.transaction(() => {
			this.assertNoNewAdmissions(pluginId, impact);
			const gate = this.store.putInstallation({ ...installation, state: "retiring", updatedAt: this.now() }, options.expectedRevision);
			return this.store.putOperation<PluginOperation>({ id: randomUUID(), pluginId, revision: 0, kind: "activate", state: "draining", createdAt: this.now(), installationRevision: gate.stateRevision, priorInstallation: installation, artifact, impact }, 0);
		});
		await this.options.checkpoint?.("draining", operation);
		operation = await this.resumeOperation(operation.id);
		return operation;
	}
	async planUninstall(pluginId: string, options: { ttlMs?: number } = {}): Promise<PluginOperation> {
		const installation = this.requireInstallation(pluginId);
		if (installation.state === "uninstalled") throw new PluginConflictError("Plugin is already uninstalled");
		if (installation.state === "retiring") throw new PluginConflictError("Cancel or finish the existing retirement before creating a new plan");
		const ttlMs = options.ttlMs ?? 5 * 60_000;
		if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60 * 60_000) throw new PluginValidationError("Plan expiry must be within one hour");
		const impact = await this.impact(pluginId);
		return this.store.transaction(() => {
			if (this.requireInstallation(pluginId).stateRevision !== installation.stateRevision) throw new PluginConflictError();
			return this.store.putOperation<PluginOperation>({ id: randomUUID(), pluginId, revision: 0, kind: "uninstall", state: "prepared", createdAt: this.now(), expiresAt: new Date(Date.parse(this.now()) + ttlMs).toISOString(), installationRevision: installation.stateRevision, priorInstallation: installation, impact }, 0);
		});
	}
	async confirmUninstall(input: { planId: string; pluginIdText: string; expectedRevision: number }): Promise<PluginOperation> {
		this.requireLifecycle();
		let operation = this.store.getOperation<PluginOperation>(input.planId);
		if (!operation || operation.kind !== "uninstall" || operation.state !== "prepared") throw new PluginConflictError("Uninstall plan is missing or already consumed");
		if (input.pluginIdText !== operation.pluginId) throw new PluginValidationError("Type the exact plugin ID to confirm; sessions and results will be retained");
		if (!operation.expiresAt || Date.parse(operation.expiresAt) <= Date.parse(this.now())) throw new PluginConflictError("Uninstall plan expired; create and confirm a new plan");
		if (input.expectedRevision !== operation.installationRevision) throw new PluginConflictError();
		const current = this.requireInstallation(operation.pluginId);
		if (current.stateRevision !== input.expectedRevision) throw new PluginConflictError();
		const impact = await this.impact(operation.pluginId);
		if (impact.fingerprint !== operation.impact?.fingerprint) throw new PluginConflictError("Plugin consumers changed; review and confirm a fresh uninstall plan");
		operation = this.store.transaction(() => {
			this.assertNoNewAdmissions(operation!.pluginId, impact);
			const gate = this.store.putInstallation({ ...current, state: "retiring", updatedAt: this.now() }, input.expectedRevision);
			return this.updateOperation(operation!, { state: "draining", installationRevision: gate.stateRevision, confirmedAt: this.now() });
		});
		await this.options.checkpoint?.("draining", operation);
		return this.resumeOperation(operation.id);
	}
	async resumeOperation(id: string): Promise<PluginOperation> {
		let operation = this.store.getOperation<PluginOperation>(id);
		if (!operation) throw new PluginValidationError("Unknown plugin operation");
		if (terminal.has(operation.state)) return operation;
		if (!["draining", "stopped"].includes(operation.state)) throw new PluginConflictError(`Operation ${operation.state} requires explicit recovery or a new confirmation`);
		const lifecycle = this.requireLifecycle();
		let installation = this.requireInstallation(operation.pluginId);
		if (installation.state !== "retiring" || installation.stateRevision !== operation.installationRevision) throw new PluginConflictError();
		const impact = await this.impact(operation.pluginId);
		if (!operation.impact || hasNewPluginConsumers(operation.impact, impact)) return this.updateOperation(operation, { state: "awaiting-confirmation", diagnostic: "New or changed consumers appeared; cancel this operation, then review and confirm a new plan" });
		const blockers = pluginDrainBlockers(impact);
		if (blockers.length) return this.updateOperation(operation, { diagnostic: `Waiting for existing work/dependent plugins to drain: ${blockers.map((c) => `${c.kind}:${c.id}`).join(", ")}` });
		if (operation.state !== "stopped") {
			operation = this.updateOperation(operation, { state: "stopping", diagnostic: undefined });
			await this.options.checkpoint?.("stopping", operation);
			try {
				await lifecycle.deactivate(operation.pluginId);
				if (await lifecycle.status(operation.pluginId) !== "inactive") throw new PluginValidationError("Plugin cleanup did not prove inactive host state");
			} catch (error) {
				return this.updateOperation(operation, { state: "failed", diagnostic: pluginErrorMessage(error, "Plugin cleanup failed") });
			}
			operation = this.updateOperation(operation, { state: "stopped" });
			await this.options.checkpoint?.("stopped", operation);
		}
		// A second collection after async cleanup prevents stale finalization even if a consumer bypassed admission.
		const finalImpact = await this.impact(operation.pluginId);
		if (hasNewPluginConsumers(operation.impact!, finalImpact) || pluginDrainBlockers(finalImpact).length) return this.updateOperation(operation, { state: "awaiting-confirmation", diagnostic: "Consumers changed during cleanup; no installation was removed" });
		installation = this.requireInstallation(operation.pluginId);
		if (installation.stateRevision !== operation.installationRevision || installation.state !== "retiring") throw new PluginConflictError();
		if (operation.kind === "uninstall") {
			return this.store.transaction(() => {
				if (this.store.listAdmissions(operation!.pluginId).length) throw new PluginConflictError("Generation admission blocks final uninstall");
				const tombstone = this.store.putInstallation({ ...installation, state: "uninstalled", enabled: false, pendingArtifact: undefined, diagnostic: undefined, updatedAt: this.now() }, operation!.installationRevision);
				return this.updateOperation(operation!, { state: "complete", installationRevision: tombstone.stateRevision, diagnostic: undefined });
			});
		}
		if (operation.kind !== "activate" || !operation.artifact) throw new PluginValidationError("Operation has no activation artifact");
		await verifyPluginArtifact(operation.artifact);
		operation = this.updateOperation(operation, { state: "activating" });
		await this.options.checkpoint?.("activating", operation);
		try {
			await lifecycle.activate(operation.artifact!);
			if (await lifecycle.status(operation.pluginId) !== "active") throw new PluginValidationError("Host did not confirm activation");
		} catch (error) {
			return this.updateOperation(operation, { state: "failed", diagnostic: pluginErrorMessage(error, "Plugin activation failed") });
		}
		await this.options.checkpoint?.("activated", operation);
		return this.store.transaction(() => {
			const active = this.store.putInstallation({ ...operation!.artifact!, state: "active", enabled: true, stateRevision: operation!.installationRevision, updatedAt: this.now() }, operation!.installationRevision);
			return this.updateOperation(operation!, { state: "complete", installationRevision: active.stateRevision, diagnostic: undefined });
		});
	}
	async cancelOperation(id: string): Promise<PluginOperation> {
		let operation = this.store.getOperation<PluginOperation>(id);
		if (!operation || terminal.has(operation.state)) throw new PluginConflictError("Operation cannot be cancelled");
		if (operation.state === "prepared") return this.updateOperation(operation, { state: "cancelled" });
		const installation = this.requireInstallation(operation.pluginId);
		if (installation.stateRevision !== operation.installationRevision || installation.state !== "retiring" || !operation.priorInstallation) throw new PluginConflictError();
		const lifecycle = this.requireLifecycle(); const status = await lifecycle.status(operation.pluginId);
		const prior = operation.priorInstallation;
		if (status === "unknown" || ["activating", "stopping", "restoring"].includes(operation.state) || (!prior.enabled && status !== "inactive")) throw new PluginConflictError("Lifecycle is uncertain; recover at a controlled host boundary before restoring prior admission");
		if (prior.enabled && status === "inactive") {
			if (pluginDrainBlockers(await this.impact(operation.pluginId)).length) throw new PluginConflictError("Cannot restore the prior plugin while dependent work is active");
			await verifyPluginArtifact(prior);
			operation = this.updateOperation(operation, { state: "restoring", cancellationRequested: true });
			await this.options.checkpoint?.("restoring", operation);
			try {
				await lifecycle.activate(installationArtifact(prior));
				if (await lifecycle.status(operation.pluginId) !== "active") throw new PluginValidationError("Prior plugin activation was not confirmed");
			} catch (error) {
				return this.updateOperation(operation, { state: "failed", diagnostic: pluginErrorMessage(error, "Restoring prior plugin failed") });
			}
		} else if (prior.enabled && status === "active" && operation.state === "failed") {
			throw new PluginConflictError("Failed transition has active resources of uncertain revision; prove inactive at a controlled host boundary first");
		}
		return this.store.transaction(() => {
			const restored = this.store.putInstallation({ ...prior, updatedAt: this.now() }, installation.stateRevision);
			return this.updateOperation(operation!, { state: "cancelled", installationRevision: restored.stateRevision });
		});
	}
	async recover(): Promise<PluginOperation[]> {
		const results: PluginOperation[] = [];
		for (let operation of this.store.listOperations<PluginOperation>()) {
			if (terminal.has(operation.state) || ["prepared", "awaiting-confirmation"].includes(operation.state)) continue;
			if (operation.kind === "install") {
				if (operation.state === "failed") { results.push(operation); continue; }
				// Committing install and journal completion is one SQLite transaction. Uncommitted stages never execute.
				results.push(this.updateOperation(operation, { state: "failed", diagnostic: "Interrupted staging was not activated; inspect source and retry installation with current CAS revision" }));
				continue;
			}
			const installation = this.requireInstallation(operation.pluginId);
			if (installation.stateRevision !== operation.installationRevision || installation.state !== "retiring") continue;
			if (["stopping", "activating", "restoring", "failed"].includes(operation.state)) {
				const status = await this.requireLifecycle().status(operation.pluginId);
				if (status !== "inactive") {
					results.push(this.updateOperation(operation, { state: "failed", diagnostic: `Interrupted lifecycle has ${status} resources; admission stays closed until controlled host shutdown proves inactive` }));
					continue;
				}
				operation = this.updateOperation(operation, { state: "stopped", diagnostic: "Recovered after host proved inactive; consumer set will be checked again" });
			}
			results.push(operation.cancellationRequested ? await this.cancelOperation(operation.id) : await this.resumeOperation(operation.id));
		}
		return results;
	}
	getConfig(target: PluginConfigurationTarget) { return this.store.getConfig(target); }
	putConfig(configuration: PluginConfigurationSnapshot, expectedRevision: number) {
		const plugin = this.requireInstallation(configuration.target.pluginId);
		if (!plugin.manifest.config || configuration.schemaVersion !== plugin.manifest.config.schemaVersion) throw new PluginValidationError("Plugin configuration schema version is unavailable or incompatible");
		const diagnostics = validatePluginConfig(plugin.manifest.config.schema, configuration.values);
		if (diagnostics.length) throw new PluginValidationError(`Plugin configuration invalid: ${diagnostics.map((d) => d.message).join("; ")}`);
		return this.store.putConfig(configuration, expectedRevision);
	}
	sessionRecovery(piboSessionId: string): PluginSessionRecovery {
		const snapshot = this.store.listGenerationSnapshots(piboSessionId).at(-1);
		if (!snapshot) return { piboSessionId, status: "unknown", canResume: false, historyReadable: true, diagnostics: [{ code: "legacy-dependencies-unknown", required: true, message: "No immutable plugin snapshot exists. Conservatively resolve the original profile before explicit reconfiguration; history remains readable." }] };
		const diagnostics: PluginSessionRecovery["diagnostics"] = [];
		const used = new Map(snapshot.plan.selection.plugins.filter((plugin) => plugin.enabled).map((plugin) => [plugin.pluginId, { pluginId: plugin.pluginId, revision: plugin.revision }]));
		for (const plugin of snapshot.plan.plugins) used.set(plugin.pluginId, plugin);
		for (const selected of used.values()) {
			const pinned = snapshot.plan.plugins.find((p) => p.pluginId === selected.pluginId);
			const required = snapshot.plan.contributions.some((c) => c.pluginId === selected.pluginId && c.required);
			const current = this.store.getInstallation(selected.pluginId);
			const expected = pinned?.revision ?? selected.revision;
			const available = current && current.enabled && ["active", "pending-activation"].includes(current.state);
			const compatible = current && (current.revision === expected || this.options.isCompatibleRevision?.(selected.pluginId, expected, current.revision) === true);
			if (!available || !compatible) diagnostics.push({ pluginId: selected.pluginId, required, code: !available ? "plugin-unavailable" : "plugin-revision-incompatible", message: !available ? `Plugin ${selected.pluginId} is ${current?.state ?? "missing"}; retained history is readable` : `Plugin ${selected.pluginId} requires pinned revision ${expected}; explicit compatibility or a new migrated generation is required` });
		}
		const blocked = diagnostics.some((d) => d.required);
		return { piboSessionId, status: blocked ? "blocked" : diagnostics.length ? "degraded" : "ready", canResume: !blocked, historyReadable: true, diagnostics };
	}
	diagnose(pluginId?: string) {
		return { installations: this.store.listInstallations(pluginId), admissions: this.store.listInstallations(pluginId).flatMap((installation) => this.store.listAdmissions(installation.pluginId)), operations: this.store.listOperations<PluginOperation>().filter((op) => !pluginId || op.pluginId === pluginId), consumerCollectorAvailable: !!this.options.collectConsumers, lifecycleAvailable: !!this.options.lifecycle, sessionsPreserved: true };
	}
}
