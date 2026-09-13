import { definePiboCoreContributions } from "./builtin.js";
import type { PluginSetupContext } from "./host.js";

export const coreSkillContributionId = (name: string) => `skill-${name}`;
export const coreActionContributionId = (name: string) => `action-${name}`;

/** Ordinary PluginHost setup for the built-in skills and gateway actions formerly registered by pibo.core. */
export function setupCore(context: PluginSetupContext): void {
	definePiboCoreContributions({
		addSkill(skill) { context.register(coreSkillContributionId(skill.name), skill); },
		addGatewayAction(action) { context.register(coreActionContributionId(action.name), action); },
	});
}
