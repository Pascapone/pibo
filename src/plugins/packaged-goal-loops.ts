import type { PiboExecutionEvent } from "../core/events.js";
import { createPiboLoopChannel, PiboLoopServiceController } from "../loops/channel.js";
import { parsePiboSessionGoalCommand } from "../loops/plugin.js";
import { createBuiltInLoopStopConditions } from "../loops/stopping.js";
import { createPiboGoalToolDefinitions } from "../loops/tools.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_LOOP_SERVICE, PIBO_PRODUCT_OPTIONS_SERVICE, type PiboPluginProductOptions } from "./product-services.js";
import { PIBO_SESSION_GOAL_STORE_SERVICE, definePluginSessionToolProvider } from "./runtime.js";
import { registrationsForSelectedTools } from "./packaged-session-tool-helpers.js";

export function setupGoalControl(context: PluginSetupContext): () => Promise<void> {
	const options = context.services.require<PiboPluginProductOptions>(PIBO_PRODUCT_OPTIONS_SERVICE);
	const controller = new PiboLoopServiceController(options);
	context.services.provide(PIBO_LOOP_SERVICE, controller);
	context.register("session-tools", definePluginSessionToolProvider({
		createSession(providerContext) {
			const storePath = providerContext.services.get<string>(PIBO_SESSION_GOAL_STORE_SERVICE);
			return { tools: registrationsForSelectedTools(providerContext, createPiboGoalToolDefinitions(providerContext, storePath ? { storePath } : {})) };
		},
	}));
	context.register("settings", {});
	context.register("loops", {});
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
