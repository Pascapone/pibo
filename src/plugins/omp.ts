import { OMP_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/omp/adapter.js";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import { definePiboPlugin } from "./registry.js";

export const OMP_RUNTIME_INSTANCE_ID = "omp-native";
export const OMP_PROFILE_NAME = "orp";

export const piboOmpPlugin = definePiboPlugin({
	id: "pibo.orp",
	name: "Pibo Oh My Pi",
	register(api) {
		api.registerAgentRuntimeDriver(OMP_AGENT_RUNTIME_DRIVER);
		api.registerAgentRuntimeInstance({
			id: OMP_RUNTIME_INSTANCE_ID,
			adapterId: OMP_AGENT_RUNTIME_DRIVER.descriptor.id,
			displayName: "Oh My Pi Native",
			config: {
				bunExecutable: "bun",
				ompEntry: "src/cli.ts",
				environmentAllowlist: ["PATH", "SystemRoot", "WINDIR", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY"],
				apiKeyEnvironment: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"],
			},
		});
		api.registerProfile({
			name: OMP_PROFILE_NAME,
			description: "Oh My Pi native runtime profile. Uses the OMP engine (can1357/oh-my-pi) via its RPC bridge; OMP owns its native tools, base prompt, and sessions; Pibo delivers selected portable tools, skills, and context files.",
			create() {
				return new InitialSessionContextBuilder(OMP_PROFILE_NAME)
					.withAgentRuntime(OMP_RUNTIME_INSTANCE_ID)
					.withBuiltinTools("disabled")
					.withBuiltinToolNames([])
					.withToolPackages({ goalControl: true })
					.createSession();
			},
		});
	},
});