import { InitialSessionContextBuilder } from "../../core/profiles.js";
import type { PiboProfileDefinition } from "../../plugins/types.js";
import type { CustomAgentDefinition } from "./agent-store.js";

export type CustomAgentProfileOptions = {
	missingReferenceMode?: "warn" | "silent";
};

export function createCustomAgentProfileDefinition(agent: CustomAgentDefinition, options: CustomAgentProfileOptions = {}): PiboProfileDefinition {
	const shouldWarnMissingReferences = options.missingReferenceMode !== "silent";
	return {
		name: agent.profileName,
		aliases: [agent.id, `custom-agent:${agent.id}`],
		description: agent.description || agent.displayName,
		create(context) {
			const builder = new InitialSessionContextBuilder(agent.profileName)
				.withBuiltinTools(agent.builtinTools)
				.withBuiltinToolNames(agent.builtinToolNames)
				.withAutoContextFiles(agent.autoContextFiles)
				.withMcpServers(agent.mcpServers)
				.withPiPackages(agent.piPackages.map((id) => ({ id })))
				.withToolPackages({ runControl: agent.runControl });
			if (agent.mainModel) builder.withMainModel(agent.mainModel);
			if (agent.subagentModel) builder.withSubagentModel(agent.subagentModel);
			if (agent.thinkingLevel) builder.withThinkingLevel(agent.thinkingLevel);
			if (agent.mainThinkingLevel) builder.withMainThinkingLevel(agent.mainThinkingLevel);
			if (agent.subagentThinkingLevel) builder.withSubagentThinkingLevel(agent.subagentThinkingLevel);
			if (agent.fast !== undefined) builder.withFastMode(agent.fast);
			if (agent.mainFast !== undefined) builder.withMainFastMode(agent.mainFast);
			if (agent.subagentFast !== undefined) builder.withSubagentFastMode(agent.subagentFast);

			for (const skillName of agent.skills) {
				try {
					builder.addSkill(context.getSkill(skillName));
				} catch (error) {
					if (!isUnknownSkillError(error, skillName)) throw error;
					if (shouldWarnMissingReferences) console.warn(`Skipping unknown skill "${skillName}" for custom agent "${agent.profileName}"`);
				}
			}
			for (const contextFileKey of agent.contextFiles) {
				try {
					builder.addContextFile(context.getContextFile(contextFileKey));
				} catch (error) {
					if (!isUnknownContextFileError(error, contextFileKey)) throw error;
					if (shouldWarnMissingReferences) console.warn(`Skipping unknown context file "${contextFileKey}" for custom agent "${agent.profileName}"`);
				}
			}
			for (const toolName of agent.nativeTools) builder.addTool(context.getTool(toolName));
			for (const subagent of agent.subagents) builder.addSubagent(subagent);

			return builder.createSession();
		},
	};
}

function isUnknownContextFileError(error: unknown, contextFileKey: string): boolean {
	return error instanceof Error && error.message === `Unknown context file "${contextFileKey}"`;
}

function isUnknownSkillError(error: unknown, skillName: string): boolean {
	return error instanceof Error && error.message === `Unknown skill "${skillName}"`;
}
