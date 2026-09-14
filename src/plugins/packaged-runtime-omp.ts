import { OMP_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/omp/adapter.js";
import type { AgentRuntimeInstanceDefinition } from "../agent-runtime/types.js";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import type { PluginSetupContext } from "./host.js";

function defaultOmpEntry(): string {
	const cli = process.env.PIBO_OMP_CLI;
	if (cli && (cli.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(cli))) return cli.trim();
	const home = process.env.OMP_HOME;
	if (home && (home.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(home))) return `${home.replace(/[\\/]+$/, "")}${process.platform === "win32" ? "\\" : "/"}packages/coding-agent/src/cli.ts`;
	return "";
}

const ompRuntimeInstance = (): AgentRuntimeInstanceDefinition => ({
	id: "omp-native",
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

export function setupOmpRuntime(context: PluginSetupContext): void {
	context.register("driver", OMP_AGENT_RUNTIME_DRIVER);
	context.register("instance", ompRuntimeInstance());
	context.register("profile", {
		name: "orp",
		description: "Oh My Pi native runtime profile. Uses the OMP engine through its RPC bridge.",
		create() {
			return new InitialSessionContextBuilder("orp")
				.withAgentRuntime("omp-native")
				.withBuiltinTools("disabled")
				.withBuiltinToolNames([])
				.withToolPackages({ goalControl: true })
				.createSession();
		},
	});
}
