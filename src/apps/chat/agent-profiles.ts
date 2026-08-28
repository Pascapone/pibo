import { InitialSessionContextBuilder, type InitialSessionContext } from "../../core/profiles.js";
import type { PiboProfileDefinition } from "../../plugins/types.js";
import type { CustomAgentDefinition } from "./agent-store.js";

export type CustomAgentProfileOptions = {
	missingReferenceMode?: "warn" | "silent";
};

export function createCustomAgentProfileDefinition(agent: CustomAgentDefinition, options: CustomAgentProfileOptions = {}): PiboProfileDefinition {
	const shouldWarnMissingReferences = options.missingReferenceMode !== "silent";
	return {
		name: agent.profileName,
		aliases: uniqueAliases([agent.id, `custom-agent:${agent.id}`, ...(agent.profileAliases ?? [])], agent.profileName),
		description: agent.description || agent.displayName,
		create(context) {
			const builder = createCustomAgentBuilder(agent);

			for (const skillName of agent.skills) {
				try {
					builder.addSkill(context.getSkill(skillName));
				} catch (error) {
					if (!isUnknownSkillError(error, skillName)) throw error;
					const message = `Unknown skill "${skillName}" referenced by custom agent "${agent.profileName}"`;
					builder.addDiagnostic({
						severity: "warning",
						code: "custom_agent_unknown_skill",
						message,
						resourceKind: "skill",
						resourceName: skillName,
					});
					if (shouldWarnMissingReferences) console.warn(`Skipping unknown skill "${skillName}" for custom agent "${agent.profileName}"`);
				}
			}
			for (const contextFileKey of agent.contextFiles) {
				try {
					builder.addContextFile(context.getContextFile(contextFileKey));
				} catch (error) {
					if (!isUnknownContextFileError(error, contextFileKey)) throw error;
					const message = `Unknown context file "${contextFileKey}" referenced by custom agent "${agent.profileName}"`;
					builder.addDiagnostic({
						severity: "warning",
						code: "custom_agent_unknown_context_file",
						message,
						resourceKind: "context-file",
						resourceName: contextFileKey,
					});
					if (shouldWarnMissingReferences) console.warn(`Skipping unknown context file "${contextFileKey}" for custom agent "${agent.profileName}"`);
				}
			}
			for (const toolName of agent.nativeTools) builder.addTool(context.getTool(toolName));
			for (const subagent of agent.subagents) builder.addSubagent(subagent);

			return builder.createSession();
		},
	};
}

export function createCustomAgentRuntimeValidationProfile(agent: CustomAgentDefinition): InitialSessionContext {
	const builder = createCustomAgentBuilder(agent);
	for (const skillName of agent.skills) builder.addSkill({ name: skillName, path: skillName });
	for (const contextFileKey of agent.contextFiles) builder.addContextFile({ key: contextFileKey, path: contextFileKey });
	for (const toolName of agent.nativeTools) builder.addTool({ name: toolName });
	for (const subagent of agent.subagents) builder.addSubagent(subagent);
	return builder.createSession();
}

function createCustomAgentBuilder(agent: CustomAgentDefinition): InitialSessionContextBuilder {
	const builder = new InitialSessionContextBuilder(agent.profileName)
		.withAgentRuntime(agent.runtimeInstanceId, agent.runtimeOptions)
		.withBuiltinTools(agent.builtinTools)
		.withBuiltinToolNames(agent.builtinToolNames)
		.withAutoContextFiles(agent.autoContextFiles)
		.withNativeSubagents(agent.nativeSubagents)
		.withMcpServers(agent.mcpServers)
		.withPiPackages(agent.piPackages.map((id) => ({ id })))
		.withToolPackages({ runControl: agent.runControl, goalControl: agent.goalControl ?? true });
	if (agent.mainModel) builder.withMainModel(agent.mainModel);
	builder.withMainModelFallbacks(agent.mainModelFallbacks ?? []);
	if (agent.subagentModel) builder.withSubagentModel(agent.subagentModel);
	if (agent.thinkingLevel) builder.withThinkingLevel(agent.thinkingLevel);
	if (agent.mainThinkingLevel) builder.withMainThinkingLevel(agent.mainThinkingLevel);
	if (agent.subagentThinkingLevel) builder.withSubagentThinkingLevel(agent.subagentThinkingLevel);
	if (agent.fast !== undefined) builder.withFastMode(agent.fast);
	if (agent.mainFast !== undefined) builder.withMainFastMode(agent.mainFast);
	if (agent.subagentFast !== undefined) builder.withSubagentFastMode(agent.subagentFast);
	return builder;
}

function uniqueAliases(aliases: readonly string[], profileName: string): string[] {
	return [...new Set(aliases.filter((alias) => alias && alias !== profileName))];
}

function isUnknownContextFileError(error: unknown, contextFileKey: string): boolean {
	return error instanceof Error && error.message === `Unknown context file "${contextFileKey}"`;
}

function isUnknownSkillError(error: unknown, skillName: string): boolean {
	return error instanceof Error && error.message === `Unknown skill "${skillName}"`;
}
