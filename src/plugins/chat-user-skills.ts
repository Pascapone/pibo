import { ScopedUserSkillManager } from "../user-skills/manager.js";
import type { UserSkill } from "../user-skills/types.js";

export type PiboChatUserSkillsPluginOptions = {
	globalRoot?: string;
	globalPiboHome?: string;
	workspaceRoot?: string;
};

export type PiboUserSkillContributionSink = {
	addSkill(skill: { name: string; path: string; enabled: true; kind: "user" }): void;
};

/** Registers independent user resources without assigning them fake plugin-contribution ownership. */
export function definePiboChatUserSkillContributions(
	sink: PiboUserSkillContributionSink,
	options: PiboChatUserSkillsPluginOptions = {},
): void {
	const manager = new ScopedUserSkillManager({
		globalRoot: options.globalRoot,
		globalPiboHome: options.globalPiboHome,
		workspaceRoot: options.workspaceRoot ?? process.cwd(),
	});
	const userSkills: UserSkill[] = [];
	for (const [scope, scopedManager] of [["global", manager.global], ["workspace", manager.workspace]] as const) {
		try {
			userSkills.push(...scopedManager.list());
		} catch (error) {
			console.warn(`[pibo] Skipping ${scope} startup user-skill registration: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	const enabledSkillByName = new Map<string, UserSkill>();
	for (const skill of userSkills) {
		if (!skill.enabled) continue;
		const existing = enabledSkillByName.get(skill.name);
		if (!existing || skill.scope === "workspace") enabledSkillByName.set(skill.name, skill);
	}
	for (const skill of enabledSkillByName.values()) sink.addSkill({ name: skill.name, path: skill.path, enabled: true, kind: "user" });
}
