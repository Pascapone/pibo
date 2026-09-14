import { RuntimeSessionRegistry } from "../tools/runtime/registry.js";
import { createRuntimeToolDefinition } from "../tools/runtime/tool.js";
import type { PluginSetupContext } from "./host.js";
import { definePluginSessionToolProvider } from "./runtime.js";
import { registrationsForSelectedTools } from "./packaged-session-tool-helpers.js";

export function setupCodeRuntime(context: PluginSetupContext): void {
	context.register("session-tools", definePluginSessionToolProvider({
		createSession(providerContext) {
			const registry = new RuntimeSessionRegistry({ cwd: providerContext.cwd });
			return {
				tools: registrationsForSelectedTools(providerContext, [createRuntimeToolDefinition(registry.createController(providerContext.piboSessionId))]),
				dispose: () => registry.closeAll({ force: true }),
			};
		},
	}));
	context.register("settings", {});
}
