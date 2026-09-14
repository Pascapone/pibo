import type { PiboToolDefinition } from "../tools/contract.js";
import type { PluginSessionToolProviderContext, PluginSessionToolRegistration } from "./runtime.js";

export function registrationsForSelectedTools(
	context: PluginSessionToolProviderContext,
	definitions: readonly PiboToolDefinition[],
): PluginSessionToolRegistration[] {
	const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition] as const));
	return context.selectedTools.map((selected) => {
		const definition = definitionsByName.get(selected.name);
		if (!definition) throw new Error(`First-party provider ${context.plugin.contributionId} cannot materialize selected tool ${selected.contributionId}`);
		return { contributionId: selected.contributionId, definition };
	});
}
