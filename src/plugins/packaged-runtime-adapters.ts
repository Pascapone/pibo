import { CODEX_NATIVE_ADAPTER_ID, CODEX_NATIVE_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/codex-native/adapter.js";
import { OMP_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/omp/adapter.js";
import { PI_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/pi/adapter.js";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import { createOpenAiCodexSpeechProvider } from "../speech/openai-codex.js";
import type { PluginSetupContext } from "./host.js";

export function setupPiRuntime(context: PluginSetupContext): void {
	context.register("driver", PI_AGENT_RUNTIME_DRIVER);
	context.register("instance", { id: "pi", adapterId: "pi", displayName: "Pi Coding Agent" });
}

export function setupCodexNativeRuntime(context: PluginSetupContext): void {
	context.register("driver", CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	context.register("instance", { id: "codex-native", adapterId: CODEX_NATIVE_ADAPTER_ID, displayName: "Native Codex App Server" });
	context.register("speech", createOpenAiCodexSpeechProvider());
	context.register("profile", {
		name: "codex-native",
		description: "Native Codex App Server profile. Distinct from the Pi-backed Codex compatibility profile.",
		create() {
			return new InitialSessionContextBuilder("codex-native")
				.withAgentRuntime("codex-native")
				.withBuiltinTools("disabled")
				.withBuiltinToolNames([])
				.withToolPackages({ goalControl: true })
				.createSession();
		},
	});
}

function defaultOmpEntry(): string {
	const cli = process.env.PIBO_OMP_CLI;
	if (cli && (cli.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(cli))) return cli.trim();
	const home = process.env.OMP_HOME;
	if (home && (home.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(home))) return `${home.replace(/[\\/]+$/, "")}${process.platform === "win32" ? "\\" : "/"}packages/coding-agent/src/cli.ts`;
	return "";
}

export function setupOmpRuntime(context: PluginSetupContext): void {
	context.register("driver", OMP_AGENT_RUNTIME_DRIVER);
	context.register("instance", {
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
