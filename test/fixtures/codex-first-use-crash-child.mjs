#!/usr/bin/env node
import { join } from "node:path";
import { AgentRuntimeAdapterRegistry } from "../../dist/agent-runtime/registry.js";
import { InitialSessionContextBuilder } from "../../dist/core/profiles.js";
import { PiboDataSessionStore } from "../../dist/sessions/pibo-data-store.js";
import { createAgentRuntimeBindingPersistence } from "../../dist/sessions/runtime-binding-persistence.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
} from "../../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../../dist/agent-runtimes/codex-native/config.js";

const [dbPath, root, appServerFixturePath, piboSessionId] = process.argv.slice(2);
if (!dbPath || !root || !appServerFixturePath || !piboSessionId) {
	throw new Error("Expected database path, test root, App Server fixture path, and Pibo Session id.");
}

const instanceId = "codex-native-crash-recovery";
const profile = new InitialSessionContextBuilder("codex-native-crash-recovery-profile")
	.withAgentRuntime(instanceId)
	.withBuiltinTools("disabled")
	.withAutoContextFiles(false)
	.withToolPackages({ goalControl: false })
	.createSession();
const registry = new AgentRuntimeAdapterRegistry();
registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
registry.registerInstance({
	id: instanceId,
	adapterId: CODEX_NATIVE_ADAPTER_ID,
	config: parseCodexNativeRuntimeConfig({
		executable: appServerFixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: ["PATH"],
		diagnosticTimeoutMs: 1_000,
		startupTimeoutMs: 2_000,
		requestTimeoutMs: 2_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
	}),
});

const store = new PiboDataSessionStore(dbPath);
const piboSession = store.get(piboSessionId);
const binding = store.getRuntimeBinding(piboSessionId);
if (!piboSession || !binding) throw new Error("Crash fixture Pibo Session is missing.");
const runtimeBindingPersistence = createAgentRuntimeBindingPersistence(store, { piboSessionId });
if (!runtimeBindingPersistence) throw new Error("Crash fixture store did not receive audited binding persistence.");

const session = await registry.openSession(instanceId, {
	piboSession,
	profile,
	binding,
	workspace: root,
	productContext: {
		piboSessionId,
		getActiveMessage: () => ({ id: "codex-crash-first-message", source: "user" }),
	},
	services: {
		runtimeBindingPersistence,
		compatibility: {
			testOnlyFirstUseFailpoints: {
				afterNativeTerminalDurable: () => process.exit(86),
			},
		},
	},
});

await session.prompt({ text: "durable first turn before binding promotion", source: "rpc" });
throw new Error("Codex first-use crash failpoint did not terminate the child process.");
