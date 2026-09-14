import { PI_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/pi/adapter.js";
import type { AgentRuntimeInstanceDefinition } from "../agent-runtime/types.js";
import type { PluginSetupContext } from "./host.js";

const piRuntimeInstance = (): AgentRuntimeInstanceDefinition => ({ id: "pi", adapterId: "pi", displayName: "Pi Coding Agent" });

export function setupPiRuntime(context: PluginSetupContext): void {
	context.register("driver", PI_AGENT_RUNTIME_DRIVER);
	context.register("instance", piRuntimeInstance());
}
