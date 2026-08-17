import { OMP_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/omp/adapter.js";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import { definePiboPlugin } from "./registry.js";

export const OMP_RUNTIME_INSTANCE_ID = "omp-native";
export const OMP_PROFILE_NAME = "orp";

/**
 * Resolve the OMP CLI entry for the default configured instance.
 *
 * The operator must point Pibo at an Oh My Pi install. We honour (in order):
 *   PIBO_OMP_CLI       absolute path to the OMP CLI entry (clover cli.ts / dist/cli.js)
 *   OMP_HOME           absolute directory containing `src/cli.ts`
 * If neither is set, ompEntry stays empty and `diagnose` reports it clearly; the
 * adapter refuses to spawn until configured. We never invent a workspace-relative
 * default.
 */
function defaultOmpEntry(): string {
	const cli = process.env.PIBO_OMP_CLI;
	if (cli && (cli.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(cli))) return cli.trim();
	const home = process.env.OMP_HOME;
	if (home && (home.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(home))) {
		return `${home.replace(/[\\/]+$/, "")}${process.platform === "win32" ? "\\" : "/"}packages/coding-agent/src/cli.ts`;
	}
	return "";
}

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
				ompEntry: defaultOmpEntry(),
				defaultProvider: "alibaba-token-plan",
				defaultModel: "deepseek-v4-flash-0731",
				environmentAllowlist: ["PATH", "SystemRoot", "WINDIR", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY"],
				apiKeyEnvironment: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY", "BAILIAN_TOKEN_PLAN_API_KEY"],
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