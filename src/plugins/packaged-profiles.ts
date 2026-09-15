import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import type { PluginSetupContext } from "./host.js";
import { PIBO_STANDARD_SKILL_NAMES } from "./standard-skills.js";
import type { PiboProfileBuildContext } from "./types.js";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

function packagedSkillPath(name: string): string {
	const packaged = resolve(MODULE_DIRECTORY, "skills", name, "SKILL.md");
	if (existsSync(packaged)) return packaged;
	return resolve(MODULE_DIRECTORY, "../..", "skills", "builtin", name, "SKILL.md");
}

export function setupBuiltinProfiles(context: PluginSetupContext): void {
	for (const name of PIBO_STANDARD_SKILL_NAMES) {
		context.register(name, { name, path: packagedSkillPath(name), kind: "builtin" });
	}
	context.register("base", {
		name: "base",
		description: "Base agent with only the four Pi built-in tools.",
		create(profileContext: PiboProfileBuildContext) {
			return new InitialSessionContextBuilder("base")
				.withBuiltinToolNames(["read", "bash", "edit", "write"])
				.addSkill(profileContext.getSkill("pi-agent-harness"))
				.withToolPackages({ goalControl: true })
				.createSession();
		},
	});
	context.register("gateway-producer", {
		name: "pibo-gateway-producer",
		aliases: ["gateway-producer"],
		description: "Pibo profile that can send messages through the local gateway.",
		create(profileContext: PiboProfileBuildContext) {
			return new InitialSessionContextBuilder("pibo-gateway-producer")
				.withBuiltinToolNames(["read", "bash", "edit", "write"])
				.addSkill(profileContext.getSkill("pi-agent-harness"))
				.addTools(profileContext.getTools(["pibo_gateway_send"]))
				.withToolPackages({ goalControl: true })
				.createSession();
		},
	});
}
