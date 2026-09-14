import { createPiboGatewaySendTool } from "../gateway/tool.js";
import type { PluginSetupContext } from "./host.js";
import { definePluginSessionToolProvider } from "./runtime.js";
import { registrationsForSelectedTools } from "./packaged-session-tool-helpers.js";

export function setupGatewayTools(context: PluginSetupContext): void {
	context.register("session-tools", definePluginSessionToolProvider({
		createSession(providerContext) {
			return { tools: registrationsForSelectedTools(providerContext, [createPiboGatewaySendTool()]) };
		},
	}));
	context.register("settings", {});
}
