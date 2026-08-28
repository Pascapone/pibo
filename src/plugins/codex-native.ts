import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
} from "../agent-runtimes/codex-native/adapter.js";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import { createOpenAiCodexSpeechProvider } from "../speech/openai-codex.js";
import { definePiboPlugin } from "./registry.js";

export const CODEX_NATIVE_RUNTIME_INSTANCE_ID = "codex-native";
export const CODEX_NATIVE_PROFILE_NAME = "codex-native";

export const piboCodexNativePlugin = definePiboPlugin({
	id: "pibo.codex-native",
	name: "Pibo Native Codex",
	register(api) {
		api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
		api.registerAgentRuntimeInstance({
			id: CODEX_NATIVE_RUNTIME_INSTANCE_ID,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			displayName: "Native Codex App Server",
		});
		api.registerSpeechProvider(createOpenAiCodexSpeechProvider());
		api.registerProfile({
			name: CODEX_NATIVE_PROFILE_NAME,
			description: "Native Codex App Server profile. Distinct from the Pi-backed Codex compatibility profile.",
			create() {
				return new InitialSessionContextBuilder(CODEX_NATIVE_PROFILE_NAME)
					.withAgentRuntime(CODEX_NATIVE_RUNTIME_INSTANCE_ID)
					.withBuiltinTools("disabled")
					.withBuiltinToolNames([])
					.withToolPackages({ goalControl: true })
					.createSession();
			},
		});
	},
});
