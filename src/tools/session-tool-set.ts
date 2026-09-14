import { wrapPluginToolHooks, type RuntimePluginHook, type PluginHookScope } from "../agent-runtime/plugin-hooks.js";
import type { PluginQualifiedId } from "../plugins/manifest.js";
import type {
	InitialSessionContext,
	ToolDefinitionContext,
	ToolProfile,
} from "../core/profiles.js";
import type { PiboToolDefinition } from "./contract.js";

export type SessionToolDefinitionRegistration = { contributionId?: PluginQualifiedId; definition: PiboToolDefinition; direct?: boolean; yieldable?: boolean };

export type CreatePiboSessionToolDefinitionsOptions = {
	profile: InitialSessionContext;
	pluginHooks?: readonly RuntimePluginHook[];
	pluginHookScope?: Omit<PluginHookScope, "toolName" | "toolCallId" | "signal">;
	toolContext?: ToolDefinitionContext;
	/** Adapter-private tools may be targeted by augment providers but are never exposed directly. */
	nativeYieldableTools?: readonly PiboToolDefinition[];
	/** Generation-pinned tools supplied by selected public session tool providers. */
	sessionToolDefinitions?: readonly SessionToolDefinitionRegistration[];
	/** Later provider phase for meta-tools built from the already wrapped yieldable catalog. */
	createAugmentedSessionToolDefinitions?: (availableTools: readonly PiboToolDefinition[]) => readonly SessionToolDefinitionRegistration[];
};

export type MaterializedPiboProfileTool = {
	profile: ToolProfile;
	definition: PiboToolDefinition;
};

export function materializePiboProfileTools(
	profile: Pick<InitialSessionContext, "tools">,
	context: ToolDefinitionContext = {},
): MaterializedPiboProfileTool[] {
	return profile.tools
		.filter((tool) => tool.enabled !== false)
		.flatMap((tool): MaterializedPiboProfileTool[] => {
			if (tool.createDefinition) return [{ profile: tool, definition: tool.createDefinition(context) }];
			if (tool.definition) return [{ profile: tool, definition: tool.definition }];
			return [];
		});
}

function uniqueDefinitions(definitions: readonly PiboToolDefinition[]): PiboToolDefinition[] {
	const names = new Set<string>();
	for (const definition of definitions) {
		if (names.has(definition.name)) throw new Error(`Session tool name conflict: ${definition.name}`);
		names.add(definition.name);
	}
	return [...definitions];
}

export function createPiboSessionToolDefinitions(
	options: CreatePiboSessionToolDefinitionsOptions,
): PiboToolDefinition[] {
	const wrap = (tool: PiboToolDefinition): PiboToolDefinition => options.pluginHooks && options.pluginHookScope
		? wrapPluginToolHooks(tool, options.pluginHooks, options.pluginHookScope)
		: tool;
	const materializedProfileTools = materializePiboProfileTools(options.profile, options.toolContext);
	const sessionTools = [...(options.sessionToolDefinitions ?? [])];
	const wrappedDirectDefinitions = [
		...(options.nativeYieldableTools ?? []),
		...materializedProfileTools.filter((tool) => tool.profile.direct !== false).map((tool) => tool.definition).map(wrap),
		...sessionTools.filter((tool) => tool.direct !== false).map((tool) => tool.definition).map(wrap),
	];
	const yieldableTools = [
		...(options.nativeYieldableTools ?? []),
		...materializedProfileTools.filter((tool) => tool.profile.yieldable !== false).map((tool) => tool.definition).map(wrap),
		...sessionTools.filter((tool) => tool.yieldable !== false).map((tool) => tool.definition).map(wrap),
	];
	const augmentedSessionTools = [...(options.createAugmentedSessionToolDefinitions?.(uniqueDefinitions(yieldableTools)) ?? [])];
	return uniqueDefinitions([
		...wrappedDirectDefinitions,
		...augmentedSessionTools.map((tool) => tool.definition).map(wrap),
	]);
}
