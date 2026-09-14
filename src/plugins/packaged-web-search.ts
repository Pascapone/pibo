import { createWebSearchToolProfile } from "../tools/web-search.js";
import type { PluginSetupContext } from "./host.js";

export function setupWebSearch(context: PluginSetupContext): void {
	context.register("web_search", createWebSearchToolProfile());
	context.register("settings", {});
}
