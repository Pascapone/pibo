import { createHashlineToolDefinition } from "../tools/hashline.js";
import { normalizePiboToolDefinition } from "../tools/contract.js";
import type { PluginSetupContext } from "./host.js";
import { definePluginSessionToolProvider } from "./runtime.js";
import { registrationsForSelectedTools } from "./packaged-session-tool-helpers.js";

export function setupFileEditing(context: PluginSetupContext): void {
	context.register("session-tools", definePluginSessionToolProvider({
		createSession(providerContext) {
			return { tools: registrationsForSelectedTools(providerContext, [normalizePiboToolDefinition(createHashlineToolDefinition(providerContext.cwd))]) };
		},
	}));
	context.register("settings", {});
}
