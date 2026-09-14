import { CODEX_NATIVE_ADAPTER_ID, CODEX_NATIVE_AGENT_RUNTIME_DRIVER } from "../agent-runtimes/codex-native/adapter.js";
import { codexRuntimeRequestActions } from "../agent-runtimes/codex-native/gateway-actions.js";
import type { AgentRuntimeInstanceDefinition } from "../agent-runtime/types.js";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import { createOpenAiCodexSpeechProvider } from "../speech/openai-codex.js";
import type { PluginSetupContext } from "./host.js";

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
	context.register("runtime-requests", {});
	const [approvalResponse, userInputResponse] = codexRuntimeRequestActions();
	context.register("approval-response", approvalResponse);
	context.register("user-input-response", userInputResponse);
}
