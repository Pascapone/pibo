import { createHash } from "node:crypto";
import type { PluginConfigurationSnapshot, PluginSessionTabset } from "./manifest.js";
import { PluginMigrationJournal, type PluginMigrationStage } from "./migration-journal.js";
import { pluginJson, PluginConflictError, type PluginStore } from "./store.js";

/**
 * Owners map legacy selection/tab ownership; this coordinator never guesses it from last-selected room/agent.
 * Configurations and tabs supplied here are already explicitly mapped SDK values. Unknown legacy bytes remain
 * in the private backup; they never become an installation or execute a legacy package.
 */
export async function migratePluginProductState(options: {
	store: PluginStore;
	id: string;
	legacyBytes: Uint8Array;
	backupRoot: string;
	configurations: readonly PluginConfigurationSnapshot[];
	tabsets: readonly PluginSessionTabset[];
	/** AgentStore/MCP owner stages implement their own idempotent transactions and exact-selection checks. */
	ownerStages: PluginMigrationStage[];
	dryRun?: boolean;
	afterStageWrite?: (stageId: string) => void | Promise<void>;
}) {
	const stages: PluginMigrationStage[] = [...options.ownerStages];
	for (const configuration of options.configurations) {
		const expected = { ...configuration, revision: 1 };
		const identity = createHash("sha256").update(pluginJson(expected)).digest("hex");
		stages.push({
			id: `plugin-config:${identity}`,
			isApplied: () => pluginJson(options.store.getConfig(configuration.target) ?? null) === pluginJson(expected),
			apply: () => {
				if (options.store.getConfig(configuration.target)) throw new PluginConflictError("Migration cannot overwrite an existing plugin configuration; retain both sources for explicit reconciliation");
				options.store.putConfig(configuration, 0);
			},
		});
	}
	for (const tabset of options.tabsets) {
		const expected = { ...tabset, revision: 1 };
		stages.push({
			id: `plugin-tabs:${tabset.piboSessionId}:${createHash("sha256").update(pluginJson(expected)).digest("hex")}`,
			isApplied: () => pluginJson(options.store.getTabset(tabset.piboSessionId) ?? null) === pluginJson(expected),
			apply: () => {
				if (options.store.getTabset(tabset.piboSessionId)) throw new PluginConflictError("Migration cannot overwrite an existing session tabset or infer ownership from global selection");
				options.store.putTabset(tabset, 0);
			},
		});
	}
	const result = await new PluginMigrationJournal(options.store).run({ id: options.id, backup: options.legacyBytes, backupRoot: options.backupRoot, stages, dryRun: options.dryRun, afterStageWrite: options.afterStageWrite });
	if (!options.dryRun) return result;
	return {
		...result,
		configurations: options.configurations.map((next) => ({ before: options.store.getConfig(next.target) ?? null, after: { ...next, revision: 1 } })),
		tabsets: options.tabsets.map((next) => ({ before: options.store.getTabset(next.piboSessionId) ?? null, after: { ...next, revision: 1 } })),
		unknownLegacyPackages: "Preserved only in backup; no executable installation is inferred",
	};
}
