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
			const enabledSkillByName = new Map<string, UserSkill>();
			for (const skill of manager.list("all")) {
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
