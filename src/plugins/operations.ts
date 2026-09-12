import { createHash } from "node:crypto";
import type { PiboDataStore } from "../data/pibo-store.js";
import type { PluginArtifact, PluginPersistedOperation, StoredPluginInstallation } from "./store.js";
import { pluginJson, PluginValidationError } from "./store.js";

export interface PluginConsumer {
	kind: "session" | "profile" | "run" | "runtime" | "plugin";
	id: string;
	usage: "active" | "required" | "optional" | "historical" | "unknown";
	revision?: string;
	generation?: string;
}
export type PluginConsumerCollector = (pluginId: string) => Promise<PluginConsumer[]>;
export interface PluginImpact {
	consumers: PluginConsumer[];
	fingerprint: string;
	sessionCount: number;
	sessions: Record<PluginConsumer["usage"], string[]>;
	profiles: string[];
	runs: string[];
	runtimes: string[];
	dependentPlugins: string[];
	sessionsPreserved: true;
}
export interface PluginOperation extends PluginPersistedOperation {
	kind: "install" | "activate" | "uninstall";
	state: "prepared" | "staging" | "committed" | "awaiting-confirmation" | "draining" | "stopping" | "stopped" | "activating" | "restoring" | "complete" | "failed" | "cancelled";
	createdAt: string;
	expiresAt?: string;
	installationRevision: number;
	priorInstallation?: StoredPluginInstallation;
	artifact?: PluginArtifact;
	impact?: PluginImpact;
	diagnostic?: string;
	confirmedAt?: string;
	cancellationRequested?: boolean;
}
export function pluginImpact(input: PluginConsumer[]): PluginImpact {
	const unique = new Map<string, PluginConsumer>();
	for (const consumer of input) {
		if (!consumer.id || !["session", "profile", "run", "runtime", "plugin"].includes(consumer.kind) || !["active", "required", "optional", "historical", "unknown"].includes(consumer.usage)) throw new PluginValidationError("Consumer collector returned invalid or incomplete identities");
		unique.set(pluginJson(consumer), consumer);
	}
	const consumers = [...unique].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
	const ids = (kind: PluginConsumer["kind"]) => [...new Set(consumers.filter((c) => c.kind === kind).map((c) => c.id))].sort();
	const sessions = Object.fromEntries(["active", "required", "optional", "historical", "unknown"].map((usage) => [usage, [...new Set(consumers.filter((c) => c.kind === "session" && c.usage === usage).map((c) => c.id))].sort()])) as PluginImpact["sessions"];
	return { consumers, fingerprint: createHash("sha256").update(pluginJson(consumers)).digest("hex"), sessionCount: ids("session").length, sessions, profiles: ids("profile"), runs: ids("run"), runtimes: ids("runtime"), dependentPlugins: ids("plugin"), sessionsPreserved: true };
}
/** A run ending is expected during drain. New consumers or changed dependency revisions require a new plan. */
export function hasNewPluginConsumers(approved: PluginImpact, current: PluginImpact): boolean {
	const previous = new Set(approved.consumers.map((c) => pluginJson(c)));
	return current.consumers.some((c) => !previous.has(pluginJson(c)));
}
export function pluginDrainBlockers(impact: PluginImpact): PluginConsumer[] {
	return impact.consumers.filter((c) => c.usage === "active" || (c.kind === "plugin" && c.usage === "required"));
}

/** Reads existing product sessions. Live runs/runtime and AgentStore stay owned by their existing services. */
export function createPluginConsumerCollector(options: {
	store: PiboDataStore;
	collectLive: PluginConsumerCollector;
	collectProfiles: PluginConsumerCollector;
}): PluginConsumerCollector {
	return async (pluginId) => {
		const consumers: PluginConsumer[] = [...await options.collectLive(pluginId), ...await options.collectProfiles(pluginId)];
		for (const row of options.store.db.prepare("SELECT id FROM sessions").all()) {
			const id = String(row.id); const snapshots = options.store.plugins.listGenerationSnapshots(id);
			if (!snapshots.length) { consumers.push({ kind: "session", id, usage: "unknown" }); continue; }
			const latest = snapshots.at(-1)!;
			for (const snapshot of snapshots) {
				const plugin = snapshot.plan.plugins.find((p) => p.pluginId === pluginId);
				const selected = snapshot.plan.selection.plugins.find((p) => p.pluginId === pluginId && p.enabled);
				if (!plugin && !selected) continue;
				const required = snapshot.plan.contributions.some((c) => c.pluginId === pluginId && c.required);
				consumers.push({ kind: "session", id, usage: snapshot !== latest ? "historical" : required ? "required" : "optional", revision: plugin?.revision ?? selected?.revision, generation: snapshot.generationId });
			}
		}
		for (const installation of options.store.plugins.listInstallations()) {
			if (installation.state === "uninstalled") continue;
			for (const dependency of installation.manifest.dependencies ?? []) if (dependency.id === pluginId) consumers.push({ kind: "plugin", id: installation.pluginId, usage: dependency.optional ? "optional" : "required", revision: installation.revision });
		}
		return pluginImpact(consumers).consumers;
	};
}
