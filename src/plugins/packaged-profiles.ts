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
