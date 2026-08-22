import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OmpRpcClient } from "../dist/agent-runtimes/omp/client.js";
import { OmpHostToolBridge } from "../dist/agent-runtimes/omp/host-tools.js";
import { OmpRpcTurnController } from "../dist/agent-runtimes/omp/turn.js";
import { OmpThreadController, readOmpAvailableCommands } from "../dist/agent-runtimes/omp/thread.js";
import { parseOmpRuntimeConfig } from "../dist/agent-runtimes/omp/config.js";
import { setOmpModel, readOmpModelCatalog } from "../dist/agent-runtimes/omp/models.js";

const fixturePath = fileURLToPath(new URL("./fixtures/omp-rpc-fake.mjs", import.meta.url));

async function testRoot(t, label) {
	const root = await mkdtemp(join(tmpdir(), `pibo-omp-${label}-`));
	await chmod(fixturePath, 0o755);
	return root;
}

function registerCleanup(t, root, client) {
	t.after(async () => {
		await client?.dispose();
		await new Promise((r) => setTimeout(r, 300));
		await rm(root, { recursive: true, force: true });
	});
}

async function startClient(t, label) {
	const root = await testRoot(t, label);
	const client = new OmpRpcClient({ startupTimeoutMs: 10_000, requestTimeoutMs: 30_000 });
	await client.connect([process.execPath, fixturePath], { cwd: root, env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent") } });
	registerCleanup(t, root, client);
	return client;
}

function responseCommand(response) {
	return response.command;
}

function responseData(response) {
	return response.data;
}

test("OMP RPC client performs ready handshake then protocol negotiation", async (t) => {
	const client = await startClient(t, "handshake");
	assert.equal(client.snapshot.state, "ready");
	assert.equal(client.snapshot.protocolVersion, 2);
	assert.equal(client.connected, true);
});

test("OMP RPC client correlates get_state response by id", async (t) => {
	const client = await startClient(t, "state");
	const response = await client.request({ type: "get_state" }, "get_state");
	assert.equal(responseCommand(response), "get_state");
	const data = responseData(response);
	assert.ok(data && typeof data === "object" && "sessionId" in data);
	assert.equal(data.sessionId, "fake-session-1");
});

test("OMP host-tool bridge sends Pibo input schemas as RPC parameters", async (t) => {
	const client = await startClient(t, "host-tools");
	const bridge = new OmpHostToolBridge(
		client,
		{
			createDefinitions() {
				return [{
					name: "get_goal",
					title: "Get Goal",
					description: "Get the current goal.",
					inputSchema: { type: "object", properties: {} },
					async execute() {
						return { content: [{ type: "text", text: "ok" }] };
					},
				}];
			},
		},
		{ cwd: process.cwd(), runtimeInstanceId: "omp-native", adapterId: "orp" },
		() => {},
	);
	t.after(() => bridge.dispose());

	assert.deepEqual(await bridge.install(), ["get_goal"]);
	assert.deepEqual(bridge.installedNames, ["get_goal"]);
});

test("OMP RPC client surfaces model catalog and switches model", async (t) => {
	const client = await startClient(t, "models");
	const catalog = await readOmpModelCatalog(client, "omp-native");
	assert.equal(catalog.runtimeInstanceId, "omp-native");
	assert.ok(catalog.models.length >= 2);
	assert.equal(catalog.models[0].id, "fake-model");
	assert.equal(catalog.models[0].provider, "fake");

	const switched = await setOmpModel(client, "fake", "fake-small");
	assert.equal(switched.id, "fake-small");
});

test("OMP turn controller completes a local-only slash prompt without awaiting agent_end", async (t) => {
	const client = await startClient(t, "slash");
	const events = [];
	const turn = new OmpRpcTurnController(client, (event) => events.push(event));
	// MUST-FIX #4: prompt with a slash command returns agentInvoked:false and no
	// agent stream follows; prompt() must NOT hang.
	const started = Date.now();
	await turn.prompt("/compact-now");
	const elapsed = Date.now() - started;
	assert.ok(elapsed < 3000, `local-only prompt should resolve quickly, took ${elapsed}ms`);
	assert.equal(turn.streaming, false);
	turn.dispose();
});

test("OMP turn controller streams a real prompt and resolves on terminal agent_end", async (t) => {
	const client = await startClient(t, "turn");
	const events = [];
	const turn = new OmpRpcTurnController(client, (event) => events.push(event));
	await turn.prompt("Hello agent");
	assert.equal(turn.streaming, false);
	const deltas = events.filter((e) => e.type === "assistant_delta");
	assert.ok(deltas.length > 0, "expected assistant_delta events");
	assert.equal(deltas[0].text, "Hello there");
	assert.ok(events.some((e) => e.type === "turn_started"));
	assert.deepEqual(events.find((event) => event.type === "tool_execution_started"), {
		type: "tool_execution_started",
		toolCallId: "tool-intent-1",
		toolName: "read",
		args: { path: "README.md" },
		intent: "Reviewing project documentation",
	});
	turn.dispose();
});

test("OMP turn controller abort interrupts a streaming turn", async (t) => {
	const client = await startClient(t, "abort");
	const turn = new OmpRpcTurnController(client, () => {});
	const promptPromise = turn.prompt("Hello agent");
	await turn.interrupt();
	await promptPromise;
	assert.equal(turn.streaming, false);
	turn.dispose();
});

test("OMP thread controller reads native session snapshot and commands", async (t) => {
	const client = await startClient(t, "thread");
	const threads = new OmpThreadController(client, "/tmp", { sessionId: "fake-session-1" });
	await threads.refresh();
	const snapshot = threads.getSessionSnapshot("omp-native");
	assert.equal(snapshot.adapterId, "orp");
	assert.equal(snapshot.nativeSessionId, "fake-session-1");
	assert.ok(snapshot.locator?.value);

	const commands = await readOmpAvailableCommands(client);
	assert.ok(commands.some((c) => c.name === "compact"));
	assert.ok(commands.some((c) => c.name === "model"));
});

test("OMP RPC client round-trips state in an error-ish environment", async (t) => {
	const client = await startClient(t, "err");
	const state = await client.request({ type: "get_state" }, "get_state");
	assert.ok(state);
});

test("OMP runtime config parses and validates provider defaults", async (t) => {
	const parsed = parseOmpRuntimeConfig({
		bunExecutable: "bun",
		ompEntry: "/opt/omp/src/cli.ts",
		defaultProvider: "openai",
		defaultModel: "gpt-4o",
	});
	assert.equal(parsed.bunExecutable, "bun");
	assert.equal(parsed.ompEntry, "/opt/omp/src/cli.ts");
	assert.equal(parsed.defaultProvider, "openai");
	assert.equal(parsed.defaultModel, "gpt-4o");

	const minimal = parseOmpRuntimeConfig({
		bunExecutable: "bun",
		ompEntry: "/opt/omp/src/cli.ts",
	});
	assert.equal(minimal.defaultProvider, undefined);
	assert.equal(minimal.defaultModel, undefined);
	assert.ok(minimal.environmentAllowlist.length > 0);
	assert.ok(minimal.apiKeyEnvironment.includes("OPENAI_API_KEY"));
});

test("OMP turn controller resolves a stalled stream via the deadline", async (t) => {
	const root = await testRoot(t, "deadline");
	// Spawn a fixture that never emits agent_end and set an aggressive deadline.
	const client = new OmpRpcClient({ startupTimeoutMs: 10_000, requestTimeoutMs: 5_000 });
	await client.connect([process.execPath, fixturePath], {
		cwd: root,
		env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent"), OMP_FAKE_HANG_AFTER_PROMPT: "1", PIBO_OMP_TURN_TIMEOUT_MS: "300" },
	});
	registerCleanup(t, root, client);
	const turn = new OmpRpcTurnController(client, () => {});
	// Deadline is read from the TEST process env (the turn controller lives
	// here), so set it on process.env around the call.
	const had = process.env.PIBO_OMP_TURN_TIMEOUT_MS;
	process.env.PIBO_OMP_TURN_TIMEOUT_MS = "300";
	const started = Date.now();
	try {
		await turn.prompt("stall forever");
	} finally {
		if (had === undefined) delete process.env.PIBO_OMP_TURN_TIMEOUT_MS;
		else process.env.PIBO_OMP_TURN_TIMEOUT_MS = had;
	}
	assert.ok(Date.now() - started < 3000, `expected deadline to resolve <3s, took ${Date.now() - started}ms`);
	assert.equal(turn.streaming, false);
	turn.dispose();
});

test("OMP turn/prompt resolves immediately for local-only slash commands", async (t) => {
	const client = await startClient(t, "slash");
	const turn = new OmpRpcTurnController(client, () => {});
	await turn.prompt("/compact");
	assert.equal(turn.streaming, false);
	turn.dispose();
});

test("OMP RPC client redacts credential material from diagnostics", async (t) => {
	const secret = "sk-abc123XYZsecret99223344";
	const seen = [];
	const client = new OmpRpcClient({ startupTimeoutMs: 10_000, requestTimeoutMs: 5_000 });
	const root = await testRoot(t, "redact");
	const off = client.subscribeDiagnostics((m) => seen.push(m));
	await client.connect([process.execPath, fixturePath], {
		cwd: root,
		env: { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent"), OMP_FAKE_SECRET_ECHO: secret },
	});
	// Allow the stderr echo to flush through the diagnostic pipe.
	await new Promise((r) => setTimeout(r, 400));
	off();
	assert.ok(seen.length > 0, `expected stderr diagnostics, got ${JSON.stringify(seen)}`);
	for (const line of seen) {
		assert.ok(!line.includes(secret), `diagnostic leaked secret: ${line}`);
		assert.ok(line.includes("[redacted]"), `expected redaction marker in: ${line}`);
	}
	registerCleanup(t, root, client);
});

test("OMP client sends set_fast_mode and set_thinking_level wire frames", async (t) => {
	const client = await startClient(t, "ctrl");
	await client.request({ type: "set_fast_mode", enabled: true }, "set_fast_mode");
	await client.request({ type: "set_thinking_level", level: "high" }, "set_thinking_level");
	// Success responses are returned; if the wire shape were wrong the fixture
	// would have replied with an error and these requests would have thrown.
	assert.ok(true);
});