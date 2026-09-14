import type { PluginSetupContext } from "./host.js";

export function setupWorkflows(context: PluginSetupContext): void {
	context.register("view", {});
}
