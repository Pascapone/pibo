import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginDefinition } from "./host.js";
import type { PluginInstallation } from "./manifest.js";
import { verifyPluginArtifact } from "./sources.js";
import { PluginValidationError } from "./store.js";

/**
 * Lazy definition for the single core host. Constructing/cataloguing this definition never imports code.
 * Backend entry modules export `setup(context: PluginSetupContext)`; setup may return a disposer.
 * The host validates the complete graph before calling setup, so dependency failures cannot import entries.
 */
export function createStagedPluginDefinition(installation: PluginInstallation): PluginDefinition {
	return {
		installation,
		async setup(context) {
			if (context.manifest.id !== installation.pluginId) throw new PluginValidationError("Plugin setup ownership differs from staged artifact");
			await verifyPluginArtifact(installation);
			const backend = installation.manifest.entrypoints?.backend;
			if (!backend) return;
			const root = resolve(installation.artifactPath!); const entry = resolve(root, backend);
			if (!entry.startsWith(`${root}${sep}`)) throw new PluginValidationError("Backend entry escapes staged artifact");
			const module = await import(pathToFileURL(entry).href) as { setup?: PluginDefinition["setup"] };
			if (typeof module.setup !== "function") throw new PluginValidationError("Backend entry must export setup(context)");
			return module.setup(context);
		},
	};
}
