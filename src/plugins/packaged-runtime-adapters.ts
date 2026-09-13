import { CODEX_NATIVE_ADAPTER_ID, CODEX_NATIVE_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/codex-native/adapter.js";
import { OMP_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/omp/adapter.js";
import { PI_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/pi/adapter.js";
import { AgentRuntimeAdapterRegistry } from "../agent-runtime/registry.js";
import type { AgentRuntimeAdapter, AgentRuntimeInstanceDefinition } from "../agent-runtime/types.js";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import { createOpenAiCodexSpeechProvider } from "../speech/openai-codex.js";
import type { PluginSetupContext } from "./host.js";

const piRuntimeInstance = (): AgentRuntimeInstanceDefinition => ({ id: "pi", adapterId: "pi", displayName: "Pi Coding Agent" });

export function setupPiRuntime(context: PluginSetupContext): void {
	context.register("driver", PI_AGENT_RUNTIME_DRIVER);
	context.register("instance", piRuntimeInstance());
}

const codexNativeRuntimeInstance = (): AgentRuntimeInstanceDefinition => ({ id: "codex-native", adapterId: CODEX_NATIVE_ADAPTER_ID, displayName: "Native Codex App Server" });

export function setupCodexNativeRuntime(context: PluginSetupContext): void {
	context.register("driver", CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	context.register("instance", codexNativeRuntimeInstance());
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

/** Read-only/debug adapter resolution without constructing a second plugin registry. */
export function createBuiltinRuntimeAdapter(instanceId: string): AgentRuntimeAdapter | undefined {
	const registry = new AgentRuntimeAdapterRegistry();
	for (const driver of [PI_AGENT_RUNTIME_DRIVER, CODEX_NATIVE_AGENT_RUNTIME_DRIVER, OMP_AGENT_RUNTIME_DRIVER]) registry.registerDriver(driver);
	const definition = [piRuntimeInstance(), codexNativeRuntimeInstance(), ompRuntimeInstance()].find((item) => item.id === instanceId);
	return definition ? registry.registerInstance(definition) : undefined;
}
