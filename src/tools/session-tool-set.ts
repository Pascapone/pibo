import type {
	InitialSessionContext,
	ToolDefinitionContext,
	ToolProfile,
} from "../core/profiles.js";
import { createPiboGoalToolDefinitions, PIBO_GOAL_TOOL_NAMES } from "../loops/tools.js";
import { createRunToolDefinitions, type PiboRunToolController } from "../runs/tools.js";
import { createAgentToolDefinitions, type PiboAgentsController } from "../subagents/tool.js";
import {
	CODEX_BROWSER_TOOL_NAMES,
	createCodexBrowserToolDefinitions,
	type CodexBrowserToolController,
	type CodexBrowserToolName,
} from "./codex-browser.js";
import { createCodexCompatToolDefinitions } from "./codex-compat.js";
import type { PiboToolDefinition } from "./contract.js";
import { createRuntimeToolDefinition, type PiboRuntimeToolController } from "./runtime/tool.js";

export type CreatePiboSessionToolDefinitionsOptions = {
	profile: InitialSessionContext;
	toolContext?: ToolDefinitionContext;
	agentsController?: PiboAgentsController;
	runToolController?: PiboRunToolController;
	runtimeToolController?: PiboRuntimeToolController;
	codexBrowserController?: CodexBrowserToolController;
	/** Adapter-private tools exposed only when the adapter explicitly supports native-tool yielding. */
	nativeYieldableTools?: readonly PiboToolDefinition[];
};

export function isRuntimeToolProfile(tool: ToolProfile): boolean {
	return tool.builtInPiboTool === "runtime" || tool.name === "runtime";
}

export function isEnabledRuntimeToolProfile(tool: ToolProfile): boolean {
	return tool.enabled !== false && isRuntimeToolProfile(tool);
}

export function isCodexBrowserToolProfile(tool: ToolProfile): boolean {
	return tool.builtInPiboTool === "codex_browser" || CODEX_BROWSER_TOOL_NAMES.includes(tool.name as CodexBrowserToolName);
}

export function isEnabledCodexBrowserToolProfile(tool: ToolProfile): boolean {
	return tool.enabled !== false && isCodexBrowserToolProfile(tool);
}

export function isGeneratedPiboTool(name: string): boolean {
	return name === "runtime"
		|| name.startsWith("pibo_agents_")
		|| name.startsWith("pibo_run_")
		|| PIBO_GOAL_TOOL_NAMES.includes(name as (typeof PIBO_GOAL_TOOL_NAMES)[number]);
}

function hasEnabledToolDefinition(tool: ToolProfile): tool is ToolProfile & (
	{ definition: PiboToolDefinition }
	| { createDefinition: (context: ToolDefinitionContext) => PiboToolDefinition }
) {
	return tool.enabled !== false && (tool.definition !== undefined || tool.createDefinition !== undefined);
}

function getToolDefinition(
	tool: ToolProfile & (
		{ definition: PiboToolDefinition }
		| { createDefinition: (context: ToolDefinitionContext) => PiboToolDefinition }
	),
	context: ToolDefinitionContext = {},
): PiboToolDefinition {
	if (tool.definition) return tool.definition;
	return tool.createDefinition!(context);
}

/** Assemble the selected Pibo-managed tool set without importing any harness package. */
export function createPiboSessionToolDefinitions(
	options: CreatePiboSessionToolDefinitionsOptions,
): PiboToolDefinition[] {
	const { profile } = options;
	const runtimeProfileTool = profile.tools.find(isEnabledRuntimeToolProfile);
	const runtimeTool = runtimeProfileTool && options.runtimeToolController
		? createRuntimeToolDefinition(options.runtimeToolController)
		: undefined;
	const selectedCodexBrowserToolNames = profile.tools
		.filter(isEnabledCodexBrowserToolProfile)
		.map((tool) => tool.name as CodexBrowserToolName);
	const codexBrowserTools = options.codexBrowserController
		? createCodexBrowserToolDefinitions(options.codexBrowserController, selectedCodexBrowserToolNames)
		: [];
	const profileTools = profile.tools
		.filter((tool) => !isRuntimeToolProfile(tool) && !isCodexBrowserToolProfile(tool))
		.filter(hasEnabledToolDefinition);
	const profileToolDefinitions = profileTools.map((tool) => getToolDefinition(tool, options.toolContext));
	const codexCompatTools = profile.toolPackages.codexCompat === true
		? createCodexCompatToolDefinitions()
		: [];
	const goalTools = profile.toolPackages.goalControl !== false
		? createPiboGoalToolDefinitions(options.toolContext ?? {})
		: [];
	const agentTools = options.agentsController
		? createAgentToolDefinitions(profile.subagents, options.agentsController)
		: [];
	const nativeYieldableTools = [...(options.nativeYieldableTools ?? [])];
	const yieldableTools = [
		...nativeYieldableTools,
		...profileTools
			.filter((tool) => tool.yieldable !== false)
			.map((tool) => getToolDefinition(tool, options.toolContext)),
		...(runtimeTool && runtimeProfileTool?.yieldable !== false ? [runtimeTool] : []),
		...codexBrowserTools.filter((definition) => profile.tools.find((tool) => tool.name === definition.name)?.yieldable !== false),
		...agentTools,
		...codexCompatTools,
	];
	const runTools = profile.toolPackages.runControl === true
		&& options.runToolController
		&& yieldableTools.length > 0
		? createRunToolDefinitions(yieldableTools, options.runToolController)
		: [];

	return [
		...nativeYieldableTools,
		...profileToolDefinitions,
		...(runtimeTool ? [runtimeTool] : []),
		...codexBrowserTools,
		...agentTools,
		...codexCompatTools,
		...goalTools,
		...runTools,
	];
}
