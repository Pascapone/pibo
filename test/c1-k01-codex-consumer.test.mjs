import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
} from "../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../dist/agent-runtimes/codex-native/config.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboSession } from "../dist/sessions/store.js";

// C K01 consumer proof (G1): a plugin-side consumer opens a NON-pi runtime
// session through the registry/driver seam (the same entry a plugin uses),
// then exercises acceptance-vs-settlement, abort and dispose. No network, no
// model runs: the codex fixture binary answers as the runtime executable and
// provider env is scrubbed. UNRUN at authoring time (host resource pause);
// first resource-cleared run validates and then strengthens terminal-shape
// assertions only from observed fixture behavior.

const agentDir = mkdtempSync(join(tmpdir(), "pibo-c1-k01-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"]) {
	delete process.env[name];
}
test.after(() => {
	rmSync(agentDir, { recursive: true, force: true });
});

const codexFixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));

function failAfter(ms, label) {
	let timer;
	const promise = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
		timer.unref?.();
	});
	return { promise, cancel: () => clearTimeout(timer) };
}

async function withBound(promise, ms, label) {
	const bound = failAfter(ms, label);
	try {
		return await Promise.race([promise, bound.promise]);
	} finally {
		bound.cancel();
	}
}

async function openConsumerCodexSession(t, suffix) {
	const root = await mkdtemp(join(tmpdir(), "pibo-c1-k01-codex-"));
	await chmod(codexFixturePath, 0o755);
	const instanceId = `codex-native-c1-${suffix}`;
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({
		id: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex C1 Consumer",
		config: parseCodexNativeRuntimeConfig({
			executable: codexFixturePath,
			homeRoot: join(root, "runtime-state"),
			environmentAllowlist: ["PATH"],
			diagnosticTimeoutMs: 1_000,
			startupTimeoutMs: process.platform === "win32" ? 5_000 : 2_000,
			requestTimeoutMs: 2_000,
			shutdownTimeoutMs: 100,
			killTimeoutMs: 100,
		}),
	});
	const profile = new InitialSessionContextBuilder(`c1-k01-${suffix}`)
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	const binding = {
		piboSessionId: `ps_c1_k01_${suffix}`,
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
	const piboSession = createPiboSession({
		id: binding.piboSessionId,
		channel: "test",
		kind: "chat",
		profile: profile.profileName,
		workspace: root,
		runtimeBinding: binding,
	});
	const session = await registry.openSession(instanceId, {
		piboSession,
		profile,
		binding,
		workspace: root,
		productContext: { piboSessionId: piboSession.id },
	});
	t.after(async () => {
		await session.dispose().catch(() => {});
		await rm(root, { recursive: true, force: true });
	});
	return session;
}

test("c1-k01 consumer prompt acceptance settles after abort with at most one terminal", async (t) => {
	const session = await openConsumerCodexSession(t, "lifecycle");
	const events = [];
	session.subscribe((event) => events.push(event));
	const promptPromise = session.prompt({ text: "consumer hello", source: "rpc" });
	assert.equal(typeof promptPromise?.then, "function", "prompt acceptance returns a pending settlement");
	await session.abort();
	await withBound(promptPromise, 10_000, "consumer prompt after abort");
	const terminals = events.filter((event) => event.type === "turn_completed" || event.type === "turn_failed");
	assert.ok(terminals.length <= 1, `at most one terminal result, got ${terminals.length}`);
	await session.dispose();
});

test("c1-k01 consumer session rejects use after dispose", async (t) => {
	const session = await openConsumerCodexSession(t, "disposed");
	await session.dispose();
	await assert.rejects(session.prompt({ text: "too late", source: "rpc" }), /disposed/);
	await assert.rejects(session.abort(), /disposed/);
	assert.throws(() => session.subscribe(() => {}), /disposed/);
});
