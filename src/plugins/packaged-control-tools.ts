import type { PiboExecutionEvent } from "../core/events.js";
import { createPiboLoopChannel, PiboLoopServiceController } from "../loops/channel.js";
import { parsePiboSessionGoalCommand } from "../loops/plugin.js";
import { createBuiltInLoopStopConditions } from "../loops/stopping.js";
import { PIBO_GOAL_TOOL_NAMES } from "../loops/tools.js";
import { PIBO_RUN_TOOL_NAMES } from "../runs/tools.js";
import { PIBO_AGENT_TOOL_NAMES } from "../subagents/tool.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_LOOP_SERVICE, PIBO_PRODUCT_OPTIONS_SERVICE, type PiboPluginProductOptions } from "./product-services.js";

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

export function setupGoalControl(context: PluginSetupContext): () => Promise<void> {
	const options = context.services.require<PiboPluginProductOptions>(PIBO_PRODUCT_OPTIONS_SERVICE);
	const controller = new PiboLoopServiceController(options);
	context.services.provide(PIBO_LOOP_SERVICE, controller);
	registerGeneratedTools(context, PIBO_GOAL_TOOL_NAMES, "Persisted goal control");
	context.register("settings", {});
	context.register("service", controller);
	context.register("channel", createPiboLoopChannel(options, controller));
	context.register("goal-action", {
		name: "goal",
		description: "Create or update the session Goal Loop. Use /goal pause or /goal resume to control it.",
		slashCommands: ["goal"],
		execute(actionContext: { piboSessionId: string }, event: PiboExecutionEvent) {
			const service = controller.require();
			const command = parsePiboSessionGoalCommand(event);
			if (command.operation === "pause") return service.pauseSessionGoal(actionContext.piboSessionId);
			if (command.operation === "resume") return service.resumeSessionGoal(actionContext.piboSessionId);
			return service.setSessionGoal(actionContext.piboSessionId, command.objective);
		},
	});
	for (const condition of createBuiltInLoopStopConditions()) context.register(`stop-${condition.type}`, condition);
	return () => controller.stop();
}

export function setupAgentDelegation(context: PluginSetupContext): void {
	registerGeneratedTools(context, PIBO_AGENT_TOOL_NAMES, "Session-owned delegated-agent management");
	context.register("settings", {});
}
