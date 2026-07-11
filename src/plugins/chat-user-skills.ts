import os from "node:os";
import { ScopedUserSkillManager } from "../user-skills/manager.js";
import type { UserSkill } from "../user-skills/types.js";
import { definePiboPlugin } from "./registry.js";

export type PiboChatUserSkillsPluginOptions = {
	globalRoot?: string;
	workspaceRoot?: string;
};

export function createPiboChatUserSkillsPlugin(options: PiboChatUserSkillsPluginOptions = {}) {
	return definePiboPlugin({
		id: "pibo.chat-user-skills",
		name: "Pibo Chat User Skills",
		register(api) {
			const manager = new ScopedUserSkillManager({
				globalRoot: options.globalRoot ?? os.homedir(),
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
			for (const skill of enabledSkillByName.values()) {
				try {
					api.registerSkill({ name: skill.name, path: skill.path, enabled: true, kind: "user" });
				} catch (error) {
					if (!(error instanceof Error) || error.message !== `Duplicate skill "${skill.name}"`) throw error;
				}
			}
		},
	});
}
