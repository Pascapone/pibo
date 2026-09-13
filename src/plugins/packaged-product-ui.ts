import type { PluginSetupContext } from "./host.js";

const PRODUCT_UI_CONTRIBUTIONS = ["user-resources", "agent-designer", "settings", "workflows", "cron", "loops"] as const;

export function setupProductUi(context: PluginSetupContext): void {
	for (const id of PRODUCT_UI_CONTRIBUTIONS) context.register(id, {});
}

export function setupStandardShell(context: PluginSetupContext): void {
	context.register("shell", {});
}
