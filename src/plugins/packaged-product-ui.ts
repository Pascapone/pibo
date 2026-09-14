import type { PluginSetupContext } from "./host.js";

export function setupProductUi(context: PluginSetupContext): void {
	for (const contribution of context.manifest.contributions) context.register(contribution.id, {});
}

export function setupStandardShell(context: PluginSetupContext): void {
	context.register("shell", {});
}
