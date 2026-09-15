import { fileURLToPath } from "node:url";
import { CodexBrowserSessionController, createCodexBrowserToolDefinitions, type CodexBrowserToolName } from "../tools/codex-browser.js";
import type { PluginSetupContext } from "./host.js";
import { definePluginSessionToolProvider } from "./runtime.js";
import { registrationsForSelectedTools } from "./packaged-session-tool-helpers.js";

export function setupBrowserTools(context: PluginSetupContext): void {
	context.register("session-tools", definePluginSessionToolProvider({
		createSession(providerContext) {
			const controller = new CodexBrowserSessionController({ cwd: providerContext.cwd, piboSessionId: providerContext.piboSessionId });
			return {
				tools: registrationsForSelectedTools(providerContext, createCodexBrowserToolDefinitions(controller, providerContext.selectedTools.map((tool) => tool.name as CodexBrowserToolName))),
				dispose: () => controller.dispose(),
			};
		},
	}));
	context.register("native-tooling-context", {
		key: "Pibo Native Tooling",
		label: "Pibo Native Tooling",
		path: fileURLToPath(new URL("./context/pibo-native-tooling.md", import.meta.url)),
		source: "plugin",
	});
	context.register("settings", {});
}
