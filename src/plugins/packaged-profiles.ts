import { InitialSessionContextBuilder } from "../core/profiles.js";
import type { PluginSetupContext } from "./host.js";

export function setupBuiltinProfiles(context: PluginSetupContext): void {
	context.register("base", {
		name: "base",
		description: "Base agent with only the four Pi built-in tools.",
		create() {
			return new InitialSessionContextBuilder("base")
				.withBuiltinToolNames(["read", "bash", "edit", "write"])
				.withToolPackages({ goalControl: true })
				.createSession();
		},
	});
}
