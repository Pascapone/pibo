import type { PiboExecutionEvent } from "../core/events.js";
import type { SubagentProfile } from "../core/profiles.js";
import { createPiboLoopChannel, PiboLoopServiceController } from "../loops/channel.js";
import { parsePiboSessionGoalCommand } from "../loops/plugin.js";
import { createBuiltInLoopStopConditions } from "../loops/stopping.js";
import { createPiboGoalToolDefinitions } from "../loops/tools.js";
import { createRunToolDefinitions, type PiboRunToolController } from "../runs/tools.js";
import { createAgentToolDefinitions, type PiboAgentsController } from "../subagents/tool.js";
import type { PiboToolDefinition } from "../tools/contract.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_LOOP_SERVICE, PIBO_PRODUCT_OPTIONS_SERVICE, type PiboPluginProductOptions } from "./product-services.js";
import {
	PIBO_SESSION_AGENT_TARGETS_SERVICE,
	PIBO_SESSION_DELEGATION_FACTORY_SERVICE,
	PIBO_SESSION_GOAL_STORE_SERVICE,
	PIBO_SESSION_RUN_CONTROL_FACTORY_SERVICE,
	definePluginSessionToolProvider,
	type PluginSessionServiceFactory,
	type PluginSessionToolProviderContext,
	type PluginSessionToolRegistration,
} from "./runtime.js";

function registrationsForSelectedTools(context: PluginSessionToolProviderContext, definitions: readonly PiboToolDefinition[]): PluginSessionToolRegistration[] {
	const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition] as const));
	return context.selectedTools.map((selected) => {
		const definition = definitionsByName.get(selected.name);
		if (!definition) throw new Error(`First-party provider ${context.plugin.contributionId} cannot materialize selected tool ${selected.contributionId}`);
		return { contributionId: selected.contributionId, definition };
	});
}

export function setupRunControl(context: PluginSetupContext): void {
	context.register("session-tools", definePluginSessionToolProvider({
		phase: "augment",
		includeNativeTools: true,
		createSession(providerContext) {
			const controller = providerContext.services.require<PluginSessionServiceFactory<PiboRunToolController>>(PIBO_SESSION_RUN_CONTROL_FACTORY_SERVICE).create();
			const definitions = createRunToolDefinitions(providerContext.availableTools.map((tool) => tool.definition), controller);
			return { tools: registrationsForSelectedTools(providerContext, definitions) };
		},
	}));
	context.register("settings", {});
}

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
	context.register("session-tools", definePluginSessionToolProvider({
		createSession(providerContext) {
			const controller = providerContext.services.require<PluginSessionServiceFactory<PiboAgentsController>>(PIBO_SESSION_DELEGATION_FACTORY_SERVICE).create();
			const agents = providerContext.services.require<readonly SubagentProfile[]>(PIBO_SESSION_AGENT_TARGETS_SERVICE);
			return { tools: registrationsForSelectedTools(providerContext, createAgentToolDefinitions(agents, controller)) };
		},
	}));
	context.register("settings", {});
}
