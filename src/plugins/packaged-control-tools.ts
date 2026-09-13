import { PIBO_GOAL_TOOL_NAMES } from "../loops/tools.js";
import { PIBO_RUN_TOOL_NAMES } from "../runs/tools.js";
import { PIBO_AGENT_TOOL_NAMES } from "../subagents/tool.js";
import type { PluginSetupContext } from "./host.js";

function registerGeneratedTools(context: PluginSetupContext, names: readonly string[], family: string): void {
	for (const name of names) {
		context.register(name, {
			name,
			description: `${family} session tool. Its controller-bound definition is generated only for the routed session.`,
		});
	}
}

export function setupRunControl(context: PluginSetupContext): void {
	registerGeneratedTools(context, PIBO_RUN_TOOL_NAMES, "Yielded-run control");
	context.register("settings", {});
}

export function setupGoalControl(context: PluginSetupContext): void {
	registerGeneratedTools(context, PIBO_GOAL_TOOL_NAMES, "Persisted goal control");
	context.register("settings", {});
}

export function setupAgentDelegation(context: PluginSetupContext): void {
	registerGeneratedTools(context, PIBO_AGENT_TOOL_NAMES, "Session-owned delegated-agent management");
	context.register("settings", {});
}
