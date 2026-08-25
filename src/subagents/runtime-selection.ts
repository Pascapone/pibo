import {
	selectRequestedSubagentModelProfile,
	selectRequestedSubagentThinkingLevel,
	type PiboModelDefaults,
} from "../core/model-defaults.js";
import type { InitialSessionContext, ModelProfile, SubagentProfile } from "../core/profiles.js";
import type { PiboThinkingLevel } from "../core/thinking.js";

export type PiboSubagentRuntimeSelection = {
	configuredModel?: ModelProfile;
	effectiveModel?: ModelProfile;
	configuredThinkingLevel?: PiboThinkingLevel;
	effectiveThinkingLevel?: PiboThinkingLevel;
};

export type PiboResolvedSubagentRuntimeSelection = PiboSubagentRuntimeSelection & {
	name: string;
	targetProfile: string;
	enabled: boolean;
};

export function resolvePiboSubagentRuntimeSelection(
	subagent: SubagentProfile,
	targetProfile: InitialSessionContext,
	modelDefaults: PiboModelDefaults = {},
): PiboSubagentRuntimeSelection {
	const effectiveModel = subagent.model ?? selectRequestedSubagentModelProfile(targetProfile, modelDefaults);
	const effectiveThinkingLevel = subagent.thinkingLevel ?? selectRequestedSubagentThinkingLevel(targetProfile, modelDefaults);
	return {
		...(subagent.model ? { configuredModel: { ...subagent.model } } : {}),
		...(effectiveModel ? { effectiveModel: { ...effectiveModel } } : {}),
		...(subagent.thinkingLevel ? { configuredThinkingLevel: subagent.thinkingLevel } : {}),
		...(effectiveThinkingLevel ? { effectiveThinkingLevel } : {}),
	};
}

export function resolvePiboSubagentRuntimeSelections(
	subagents: readonly SubagentProfile[],
	targetProfileResolver: ((profileName: string) => InitialSessionContext) | undefined,
	modelDefaults: PiboModelDefaults = {},
): PiboResolvedSubagentRuntimeSelection[] {
	return subagents.map((subagent) => {
		const targetProfile = targetProfileResolver?.(subagent.targetProfile);
		const selection = targetProfile
			? resolvePiboSubagentRuntimeSelection(subagent, targetProfile, modelDefaults)
			: {
				...(subagent.model ? { configuredModel: { ...subagent.model }, effectiveModel: { ...subagent.model } } : {}),
				...(subagent.thinkingLevel ? { configuredThinkingLevel: subagent.thinkingLevel, effectiveThinkingLevel: subagent.thinkingLevel } : {}),
			};
		return {
			name: subagent.name,
			targetProfile: subagent.targetProfile,
			enabled: subagent.enabled !== false,
			...selection,
		};
	});
}
