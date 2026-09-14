import type { SubagentProfile } from "../core/profiles.js";
import { createPiboDelegationController } from "../subagents/controller.js";
import { createAgentToolDefinitions } from "../subagents/tool.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_SESSION_AGENT_TARGETS_SERVICE, definePluginSessionToolProvider } from "./runtime.js";
import { registrationsForSelectedTools } from "./packaged-session-tool-helpers.js";

export function setupAgentDelegation(context: PluginSetupContext): void {
	context.register("session-tools", definePluginSessionToolProvider({
		createSession(providerContext) {
			const controller = createPiboDelegationController(providerContext.services, providerContext.piboSessionId);
			const agents = providerContext.services.require<readonly SubagentProfile[]>(PIBO_SESSION_AGENT_TARGETS_SERVICE);
			return { tools: registrationsForSelectedTools(providerContext, createAgentToolDefinitions(agents, controller)) };
		},
	}));
	context.register("settings", {});
}
