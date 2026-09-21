import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { CodexNativeTurnController } from "../dist/agent-runtimes/codex-native/turn.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
} from "../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../dist/agent-runtimes/codex-native/config.js";
import { PI_AGENT_RUNTIME_DRIVER } from "../dist/agent-runtimes/pi/adapter.js";
import { OmpRpcTurnController } from "../dist/agent-runtimes/omp/turn.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { createPiboSession } from "../dist/sessions/store.js";

// Real adapter objects, scripted peers: no network, no model runs. The Pi
// session fails locally on missing credentials; provider key env vars are
// scrubbed so the failure cannot turn into a real model call.
const agentDir = mkdtempSync(join(tmpdir(), "pibo-b1-real-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"]) {
	delete process.env[name];
}
test.after(() => {
	rmSync(agentDir, { recursive: true, force: true });
});

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

async function waitForState(predicate, label, timeoutMs = 10_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function scriptedCodexRig() {
	const events = [];
	const requests = [];
	let notify;
	let lastNotify;
	const client = {
		request: async (method, params) => {
			requests.push({ method, params });
			if (method === "turn/start") return { turn: { id: "turn-b1", status: "inProgress", items: [] } };
			if (method === "turn/interrupt") return { ok: true };
			throw new Error(`unexpected codex request ${method}`);
		},
		subscribeNotifications: (callback) => {
			notify = callback;
			lastNotify = callback;
			return () => {
				notify = undefined;
			};
		},
		subscribeDiagnostics: () => () => {},
		close: async () => {},
	};
	const threads = {
		thread: { id: "thread-b1" },
		recordTurn: () => {},
		setStatus: () => {},
	};
	const turns = new CodexNativeTurnController(client, threads, (event) => events.push(event));
	return {
		turns,
		events,
		requests,
		deliver: (method, params) => notify?.({ method, params }),
		deliverLate: (method, params) => lastNotify?.({ method, params }),
	};
}

test("b1-real codex delivers its interrupt terminal after abort returns", async (t) => {
	const rig = scriptedCodexRig();
	t.after(() => rig.turns.dispose());
	const startPromise = rig.turns.start("hello", "msg-b1-codex", {});
	await waitForState(() => rig.turns.streaming, "codex turn start");
	rig.deliver("turn/started", { threadId: "thread-b1", turn: { id: "turn-b1", status: "inProgress", items: [] } });
	assert.deepEqual(rig.events.map((event) => event.type), ["turn_started"]);

	await rig.turns.interrupt();
	assert.deepEqual(
		rig.events.map((event) => event.type),
		["turn_started"],
		"no terminal is required at interrupt() return; the native terminal legitimately arrives later",
	);
	assert.equal(rig.requests.filter((entry) => entry.method === "turn/interrupt").length, 1);

	rig.deliver("turn/completed", {
		threadId: "thread-b1",
		turn: { id: "turn-b1", status: "interrupted", items: [] },
	});
	await withBound(startPromise, 10_000, "codex interrupted start");
	const terminal = rig.events.filter((event) => event.type === "turn_completed" || event.type === "turn_failed");
	assert.equal(terminal.length, 1);
	assert.equal(terminal[0].type, "turn_completed");
	assert.equal(terminal[0].status, "interrupted");
	assert.equal(rig.turns.streaming, false);
});

test("b1-real codex dispose during a turn rejects the start and drops the late terminal", async (t) => {
	const rig = scriptedCodexRig();
	const startPromise = rig.turns.start("hello", "msg-b1-codex-dispose", {});
	await waitForState(() => rig.turns.streaming, "codex turn start");
	rig.deliver("turn/started", { threadId: "thread-b1", turn: { id: "turn-b1", status: "inProgress", items: [] } });
	rig.turns.dispose();
	await assert.rejects(startPromise, /was disposed/);
	const settledCount = rig.events.length;
	rig.deliverLate("turn/completed", {
		threadId: "thread-b1",
		turn: { id: "turn-b1", status: "completed", items: [] },
	});
	assert.equal(rig.events.length, settledCount);
	assert.deepEqual(rig.events.map((event) => event.type), ["turn_started"]);
	t.after(() => rig.turns.dispose());
});

const codexFixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));

async function openCodexSession(t, suffix) {
	const root = await mkdtemp(join(tmpdir(), "pibo-b1-real-codex-"));
	await chmod(codexFixturePath, 0o755);
	const instanceId = `codex-native-b1-${suffix}`;
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	registry.registerInstance({
		id: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex B1 Real",
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
	const profile = new InitialSessionContextBuilder(`b1-real-${suffix}`)
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
	const binding = {
		piboSessionId: `ps_b1_real_${suffix}`,
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

test("b1-real codex session rejects abort, prompt and subscribe after dispose", async (t) => {
	const session = await openCodexSession(t, "disposed");
	await session.abort();
	await session.dispose();
	await session.dispose();
	await assert.rejects(session.abort(), /disposed/);
	await assert.rejects(session.prompt({ text: "too late", source: "rpc" }), /disposed/);
	assert.throws(() => session.subscribe(() => {}), /disposed/);
});

async function openPiSession(t, suffix) {
	const root = await mkdtemp(join(tmpdir(), "pibo-b1-real-pi-"));
	const adapter = PI_AGENT_RUNTIME_DRIVER.create({
		instanceId: "pi-b1-real",
		displayName: "Pi B1 Real",
		enabled: true,
		config: PI_AGENT_RUNTIME_DRIVER.defaultConfig(),
	});
	const profile = new InitialSessionContextBuilder("b1-real-pi").withAgentRuntime("pi-b1-real").createSession();
	const piboSession = createPiboSession({
		id: `ps_b1_real_pi_${suffix}`,
		channel: "test",
		kind: "chat",
		profile: profile.profileName,
		workspace: root,
	});
	const session = await adapter.openSession({
		piboSession,
		profile,
		workspace: root,
		productContext: { piboSessionId: piboSession.id },
		services: { compatibility: { persistSession: false } },
	});
	t.after(async () => {
		await session.dispose().catch(() => {});
		await rm(root, { recursive: true, force: true });
	});
	return session;
}

test("b1-real pi failure resolves the prompt with error plus turn_failed", async (t) => {
	const session = await openPiSession(t, "error");
	const events = [];
	session.subscribe((event) => events.push(event));
	await withBound(session.prompt({ text: "say hello", source: "rpc" }), 90_000, "pi error prompt");
	const failed = events.filter((event) => event.type === "turn_failed");
	const completed = events.filter((event) => event.type === "turn_completed");
	assert.equal(failed.length, 1);
	assert.equal(completed.length, 0);
	assert.ok(failed[0].message.length > 0);
	assert.ok(events.some((event) => event.type === "error"), "pi failure also emits an error diagnostic");
	assert.equal(session.getStatus().streaming, false);
});

test("b1-real pi cancel resolves the prompt with no terminal", async (t) => {
	const session = await openPiSession(t, "cancel");
	const events = [];
	session.subscribe((event) => events.push(event));
	const promptPromise = session.prompt({ text: "say hello", source: "rpc" });
	await session.abort();
	await withBound(promptPromise, 90_000, "pi cancelled prompt");
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 0);
	assert.equal(events.filter((event) => event.type === "turn_failed").length, 0);
	assert.equal(session.getStatus().streaming, false);
});

test("b1-real pi abort after dispose resolves without effect", async (t) => {
	const session = await openPiSession(t, "disposed");
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.dispose();
	await session.dispose();
	await withBound(session.abort(), 30_000, "pi abort after dispose");
	await withBound(session.abort(), 30_000, "pi second abort after dispose");
	assert.deepEqual(events, []);
	await assert.rejects(session.prompt({ text: "too late", source: "rpc" }), /disposed/);
});

function scriptedOmpRig() {
	const events = [];
	const requests = [];
	let frameCallback;
	const client = {
		request: async (payload, label) => {
			requests.push({ payload, label });
			if (payload?.type === "prompt" && scriptedOmpRig.nextPromptData !== undefined) {
				return { data: scriptedOmpRig.nextPromptData };
			}
			return { data: {} };
		},
		subscribeFrames: (callback) => {
			frameCallback = callback;
			return () => {
				frameCallback = undefined;
			};
		},
		subscribeDiagnostics: () => () => {},
	};
	const turn = new OmpRpcTurnController(client, (event) => events.push(event));
	return {
		turn,
		events,
		requests,
		deliver: (frame) => frameCallback?.(frame),
	};
}

test("b1-real omp local slash resolves with no events at all", async (t) => {
	scriptedOmpRig.nextPromptData = { agentInvoked: false };
	const rig = scriptedOmpRig();
	t.after(() => {
		rig.turn.dispose();
		scriptedOmpRig.nextPromptData = undefined;
	});
	await withBound(rig.turn.prompt("/compact"), 10_000, "omp local prompt");
	assert.deepEqual(rig.events, []);
	assert.equal(rig.turn.streaming, false);
});

test("b1-real omp interrupt sends abort, dispose rejects, late frames are ignored", async (t) => {
	scriptedOmpRig.nextPromptData = {};
	const rig = scriptedOmpRig();
	t.after(() => {
		rig.turn.dispose();
		scriptedOmpRig.nextPromptData = undefined;
	});
	const promptPromise = rig.turn.prompt("hello agent");
	await waitForState(() => rig.turn.streaming, "omp agent turn start");
	await rig.turn.interrupt();
	assert.ok(rig.requests.some((entry) => entry.payload?.type === "abort"), "interrupt sends an abort request");
	rig.deliver({ type: "turn_start" });
	rig.deliver({ type: "agent_end", isTerminal: true });
	await withBound(promptPromise, 10_000, "omp interrupted prompt");
	assert.deepEqual(rig.events.map((event) => event.type), ["turn_started"]);
	assert.equal(rig.turn.streaming, false);

	rig.deliver({ type: "turn_end" });
	assert.deepEqual(
		rig.events.map((event) => event.type),
		["turn_started"],
		"frames after turn settlement are ignored once no turn is pending",
	);

	rig.turn.dispose();
	await assert.rejects(rig.turn.prompt("after dispose"), /disposed/);
	await assert.rejects(rig.turn.interrupt(), /disposed/);
});
