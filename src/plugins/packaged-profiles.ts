import { InitialSessionContextBuilder } from "../core/profiles.js";
import type { PluginSetupContext } from "./host.js";
import type { PiboProfileBuildContext } from "./types.js";

export function setupBuiltinProfiles(context: PluginSetupContext): void {
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
}
