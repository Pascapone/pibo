import { MUSE_NATIVE_AGENT_RUNTIME_DRIVER, MUSE_NATIVE_ADAPTER_ID } from "../agent-runtimes/muse-native/adapter.js";
import type { AgentRuntimeInstanceDefinition } from "../agent-runtime/types.js";
import { InitialSessionContextBuilder } from "../core/profiles.js";
import type { PluginSetupContext } from "./host.js";

const museNativeRuntimeInstance = (): AgentRuntimeInstanceDefinition => ({
	id: MUSE_NATIVE_ADAPTER_ID,
	adapterId: MUSE_NATIVE_ADAPTER_ID,
	displayName: "Native Muse",
});

export function setupMuseNativeRuntime(context: PluginSetupContext): void {
	context.register("driver", MUSE_NATIVE_AGENT_RUNTIME_DRIVER);
	context.register("instance", museNativeRuntimeInstance());
	context.register("profile", {
		name: MUSE_NATIVE_ADAPTER_ID,
		description: "Native Muse (MSP) profile driven through the Meta Muse TypeScript SDK.",
		create() {
			return new InitialSessionContextBuilder(MUSE_NATIVE_ADAPTER_ID)
				.withAgentRuntime(MUSE_NATIVE_ADAPTER_ID)
				.withBuiltinTools("disabled")
				.withBuiltinToolNames([])
				.withToolPackages({ goalControl: true })
				.createSession();
		},
	});
	// The shared runtime-request gateway actions (runtime.approval.respond,
	// runtime.user_input.respond) stay solely owned by the Codex Native package;
	// a second owner would collide on the shared action names.
	context.register("runtime-requests", {});
}
