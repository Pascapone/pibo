import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import * as agentRuntimeTypesModule from "../dist/agent-runtime/types.js";
import {
	AgentRuntimeBindingMissingError,
	AgentRuntimeUnavailableError,
} from "../dist/agent-runtime/errors.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import * as sessionStoreModule from "../dist/sessions/store.js";
import { InMemoryPiboSessionStore, createPiboSession } from "../dist/sessions/store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";
import {
	createAgentRuntimeBindingPersistence,
	isAgentRuntimeBindingPersistence,
} from "../dist/sessions/runtime-binding-persistence.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
	CODEX_NATIVE_THREAD_CAPABILITIES,
	getCodexNativeClient,
} from "../dist/agent-runtimes/codex-native/adapter.js";
import { CodexAppServerRpcResponseError } from "../dist/agent-runtimes/codex-native/client.js";
import { parseCodexNativeRuntimeConfig } from "../dist/agent-runtimes/codex-native/config.js";
import { startCodexNativeAppServer } from "../dist/agent-runtimes/codex-native/process.js";
import { isCodexNativeThreadMissingError } from "../dist/agent-runtimes/codex-native/thread.js";
import {
	isExactCodexNativeFirstUseDeliveryReplay,
	assertCodexNativePendingFirstUseTurn,
	beginCodexNativeFirstUseAttempt,
	canonicalizeCodexNativeFirstUsePrompt,
	codexNativePendingFirstUseOwnerLiveness,
	endCodexNativeFirstUseAttempt,
	hashCanonicalCodexNativeFirstUsePrompt,
	readCodexNativeFirstUseDeliveryReceipt,
	readCodexNativePendingFirstUse,
} from "../dist/agent-runtimes/codex-native/first-use.js";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));
const crashChildFixturePath = fileURLToPath(new URL("./fixtures/codex-first-use-crash-child.mjs", import.meta.url));
const lockChildFixturePath = fileURLToPath(new URL("./fixtures/codex-state-lock-child.mjs", import.meta.url));
const testDisposers = new WeakMap();

async function testRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-native-thread-"));
	const disposers = [];
	testDisposers.set(t, disposers);
	t.after(async () => {
		for (const dispose of disposers.reverse()) await dispose();
		await rm(root, { recursive: true, force: true });
	});
	await chmod(fixturePath, 0o755);
	return root;
}

function registerTestDisposer(t, dispose) {
	const disposers = testDisposers.get(t);
	if (!disposers) throw new Error("Codex native thread test root is not initialized");
	disposers.push(dispose);
}

function persistRouterOutputs(router, store) {
	const ingest = new ChatDataIngestService(store.getDataStore());
	return router.subscribe((event) => {
		const session = store.get(event.piboSessionId);
		if (!session) return;
		ingest.ingestOutputEvent({ session, actorId: session.id, event });
	});
}

async function waitFor(predicate, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for Codex native test state");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function runCrashChild(args) {
	return await runFixtureChild(crashChildFixturePath, args);
}

async function runFixtureChild(path, args) {
	const child = spawn(process.execPath, [path, ...args], {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	const result = await new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	return { ...result, stdout, stderr };
}

async function startReadyFixtureChild(path, args) {
	const child = spawn(process.execPath, [path, ...args], {
		cwd: process.cwd(),
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => { stdout += chunk; });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	await waitFor(() => stdout.includes("ready\n"));
	let stopped = false;
	return {
		child,
		getOutput: () => ({ stdout, stderr }),
		stop: async () => {
			if (stopped) return;
			stopped = true;
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = new Promise((resolve) => child.once("exit", resolve));
			child.kill("SIGKILL");
			await exited;
		},
	};
}

function runtimeConfig(root) {
	return parseCodexNativeRuntimeConfig({
		executable: fixturePath,
		homeRoot: join(root, "runtime-state"),
		environmentAllowlist: ["PATH"],
		diagnosticTimeoutMs: 1_000,
		startupTimeoutMs: process.platform === "win32" ? 5_000 : 2_000,
		requestTimeoutMs: 2_000,
		shutdownTimeoutMs: 100,
		killTimeoutMs: 100,
	});
}

function profile(instanceId, runtimeOptions = {}) {
	return new InitialSessionContextBuilder(`profile-${instanceId}`)
		.withAgentRuntime(instanceId, runtimeOptions)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
}

function storeBindingPersistence(store, piboSessionId, options = {}) {
	const persistence = createAgentRuntimeBindingPersistence(store, { piboSessionId, ...options });
	assert.ok(persistence, "expected an audited built-in runtime-binding persistence capability");
	return persistence;
}

function openInput(instanceId, workspace, binding, piboSessionId = binding.piboSessionId, runtimeOptions = {}, kind = "chat") {
	const selectedProfile = profile(instanceId, runtimeOptions);
	const piboSession = createPiboSession({
		id: piboSessionId,
		channel: "test",
		kind,
		profile: selectedProfile.profileName,
		workspace,
		runtimeBinding: binding,
	});
	return {
		piboSession,
		profile: selectedProfile,
		binding,
		workspace,
		productContext: { piboSessionId },
		services: {},
	};
}

function createAdapter(root, instanceId = "codex-native-test") {
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex Native Test",
		config: runtimeConfig(root),
	});
	return { registry, adapter, instanceId };
}

async function seedThread(config, input) {
	const process = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: input.runtimeInstanceId,
		piboSessionId: `seed-${input.threadId}`,
		sessionGeneration: `seed-${input.threadId}`,
		workspace: input.workspace,
		clientVersion: "thread-test",
	});
	try {
		await process.client.request("test/seedThread", input);
	} finally {
		await process.close();
	}
}

function boundBinding(instanceId, piboSessionId, nativeSessionId) {
	return {
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		nativeSessionId,
		state: "bound",
		protocol: "codex-app-server-v2",
		protocolVersion: "0.153.2",
		revision: 1,
	};
}

function pendingFirstUseMetadata(overrides = {}) {
	return {
		version: 3,
		state: "pending",
		threadId: "thread-pending",
		messageId: "message-pending",
		promptHash: hashCanonicalCodexNativeFirstUsePrompt("pending prompt"),
		attemptId: "11111111-1111-4111-8111-111111111111",
		ownerPid: 2_147_483_647,
		ownerProcessStartId: "2147483647:1",
		ownerProcessInstanceId: "22222222-2222-4222-8222-222222222222",
		...overrides,
	};
}

function deliveredFirstUseReceipt(overrides = {}) {
	return {
		version: 3,
		state: "delivered",
		messageId: "message-delivered",
		promptHash: hashCanonicalCodexNativeFirstUsePrompt("delivered prompt"),
		...overrides,
	};
}

function hashLegacyByteExactPrompt(prompt) {
	return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function linuxProcStat(pid, state, startTicks) {
	return `${pid} (codex owner) ${state} ${Array.from({ length: 18 }, () => "0").join(" ")} ${startTicks}\n`;
}

function seededTurns() {
	return [
		{
			id: "turn-a",
			status: "completed",
			startedAt: 1_780_000_010,
			completedAt: 1_780_000_012,
			items: [
				{ id: "user-a", type: "userMessage", content: [{ type: "text", text: "hello access_token=fixture-user-secret" }] },
				{ id: "reason-a", type: "reasoning", summary: ["Bearer fixture-reasoning-secret"], content: ["analysis"] },
				{
					id: "command-a",
					type: "commandExecution",
					command: "printf secret=fixture-command-secret",
					aggregatedOutput: "secret=fixture-output-secret\nok",
					commandActions: [],
					cwd: "/private/workspace",
					status: "completed",
				},
				{ id: "agent-a", type: "agentMessage", text: "done token=fixture-agent-secret" },
			],
		},
		{
			id: "turn-b",
			status: "completed",
			startedAt: 1_780_000_020,
			completedAt: 1_780_000_021,
			items: [
				{ id: "user-b", type: "userMessage", content: [{ type: "text", text: "continue" }] },
				{ id: "agent-b", type: "agentMessage", text: "second answer" },
			],
		},
		{
			id: "turn-c",
			status: "failed",
			startedAt: 1_780_000_030,
			completedAt: 1_780_000_031,
			error: { message: "provider secret=fixture-provider-secret" },
			items: [{ id: "user-c", type: "userMessage", content: [{ type: "text", text: "fail" }] }],
		},
	];
}

test("Codex native missing-thread detection covers exact stable App Server errors", () => {
	for (const message of [
		"thread not loaded: 00000000-0000-0000-0000-000000000001",
		"thread 00000000-0000-0000-0000-000000000001 not found",
		"no rollout found for thread id 00000000-0000-0000-0000-000000000001",
		"no rollout found for conversation id 00000000-0000-0000-0000-000000000001",
	]) {
		assert.equal(isCodexNativeThreadMissingError(new CodexAppServerRpcResponseError({ code: -32600, message })), true);
	}
	const missingRollout = new CodexAppServerRpcResponseError({
		code: -32600,
		message: "failed to resolve rollout path `/private/fake-codex/thread-missing.jsonl`: file does not exist",
	});
	assert.equal(isCodexNativeThreadMissingError(missingRollout), true);
	assert.match(missingRollout.message, /\[redacted path\]/);
	assert.doesNotMatch(missingRollout.message, /private\/fake-codex|thread-missing\.jsonl/);
	assert.equal(
		isCodexNativeThreadMissingError(new CodexAppServerRpcResponseError({ code: -32600, message: "last turn not found" })),
		false,
	);
});

test("Codex native first-use owner liveness distinguishes active, dead, and ambiguous evidence", () => {
	const external = pendingFirstUseMetadata({ ownerPid: 4242, ownerProcessStartId: "4242:100" });
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "linux", currentPid: 9999, readProcStat: () => linuxProcStat(4242, "S", 100),
	}), "active");
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "linux", currentPid: 9999, readProcStat: () => linuxProcStat(4242, "S", 101),
	}), "dead", "PID reuse proves the recorded owner is dead");
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "linux", currentPid: 9999, readProcStat: () => linuxProcStat(4242, "Z", 100),
	}), "dead", "zombies cannot own a first-use attempt");
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "linux", currentPid: 9999, readProcStat: () => "malformed proc stat",
	}), "ambiguous");
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "linux", currentPid: 9999,
		readProcStat: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
	}), "dead");
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "linux", currentPid: 9999,
		readProcStat: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); },
	}), "ambiguous");
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "darwin", currentPid: 9999, probePid: () => {},
	}), "active");
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "darwin", currentPid: 9999,
		probePid: () => { throw Object.assign(new Error("missing"), { code: "ESRCH" }); },
	}), "dead");
	assert.equal(codexNativePendingFirstUseOwnerLiveness(external, {
		platform: "darwin", currentPid: 9999,
		probePid: () => { throw Object.assign(new Error("denied"), { code: "EPERM" }); },
	}), "ambiguous");

	const owner = beginCodexNativeFirstUseAttempt();
	const sameProcess = pendingFirstUseMetadata({ ...owner, threadId: "thread-same-process" });
	try {
		assert.equal(codexNativePendingFirstUseOwnerLiveness(sameProcess), "active");
	} finally {
		endCodexNativeFirstUseAttempt(owner.attemptId);
	}
	assert.equal(codexNativePendingFirstUseOwnerLiveness(sameProcess), "dead");
});

test("Codex native pending first-use metadata rejects every malformed or unbounded field", () => {
	const bindingFor = (pending) => ({
		piboSessionId: "ps_pending_validation",
		runtimeInstanceId: "codex-native-pending-validation",
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		nativeSessionId: "thread-pending",
		state: "unbound",
		metadata: { codexNativeFirstUse: pending },
	});
	for (const version of [1, 2, 3]) {
		const pending = pendingFirstUseMetadata({ version });
		assert.deepEqual(readCodexNativePendingFirstUse(bindingFor(pending)), pending);
	}
	for (const invalid of [
		{ version: 0 },
		{ version: "1" },
		{ state: "ready" },
		{ threadId: "" },
		{ threadId: "t".repeat(513) },
		{ messageId: "" },
		{ messageId: "m".repeat(513) },
		{ promptHash: "A".repeat(64) },
		{ attemptId: "not-a-uuid" },
		{ ownerPid: 0 },
		{ ownerPid: 1.5 },
		{ ownerPid: 2_147_483_648 },
		{ ownerProcessStartId: "2147483646:1" },
		{ ownerProcessStartId: `2147483647:${"1".repeat(64)}` },
		{ ownerProcessInstanceId: "not-a-uuid" },
		{ unexpected: true },
	]) {
		for (const version of [1, 2, 3]) {
			assert.throws(
				() => readCodexNativePendingFirstUse(bindingFor(pendingFirstUseMetadata({ version, ...invalid }))),
				/metadata is invalid/,
			);
		}
	}
});

test("Codex native delivered first-use receipts are strict, bounded, and version-aware", () => {
	const bindingFor = (receipt, overrides = {}) => ({
		piboSessionId: "ps_delivered_validation",
		runtimeInstanceId: "codex-native-delivered-validation",
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		nativeSessionId: "thread-delivered",
		state: "bound",
		metadata: { codexNativeFirstUse: receipt },
		...overrides,
	});
	for (const version of [1, 2, 3]) {
		const receipt = deliveredFirstUseReceipt({ version });
		assert.deepEqual(readCodexNativeFirstUseDeliveryReceipt(bindingFor(receipt)), receipt);
	}
	for (const invalid of [
		{ version: 0 },
		{ version: "1" },
		{ state: "pending" },
		{ messageId: "" },
		{ messageId: "m".repeat(513) },
		{ promptHash: "A".repeat(64) },
		{ unexpected: true },
		{ ownerPid: process.pid },
	]) {
		assert.throws(
			() => readCodexNativeFirstUseDeliveryReceipt(bindingFor(deliveredFirstUseReceipt(invalid))),
			/receipt is invalid/,
		);
	}
	for (const malformed of [null, [], "delivered", 1]) {
		assert.throws(() => readCodexNativeFirstUseDeliveryReceipt(bindingFor(malformed)), /receipt is invalid/);
	}
	assert.throws(
		() => readCodexNativeFirstUseDeliveryReceipt(bindingFor(deliveredFirstUseReceipt(), { state: "unbound" })),
		/receipt is invalid/,
	);
	assert.throws(
		() => readCodexNativeFirstUseDeliveryReceipt({
			...bindingFor(deliveredFirstUseReceipt()),
			metadata: {
				codexNativeFirstUse: deliveredFirstUseReceipt(),
				piboPendingNativeSession: true,
			},
		}),
		/receipt is invalid/,
	);

	const byteExactPrompt = "caf\u00e9\r\nlegacy";
	const normalizedEquivalent = "cafe\u0301\nlegacy";
	for (const version of [1, 2]) {
		const receipt = deliveredFirstUseReceipt({
			version,
			messageId: `legacy-v${version}`,
			promptHash: hashLegacyByteExactPrompt(byteExactPrompt),
		});
		assert.equal(isExactCodexNativeFirstUseDeliveryReplay(receipt, receipt.messageId, byteExactPrompt), true);
		assert.throws(
			() => isExactCodexNativeFirstUseDeliveryReplay(receipt, receipt.messageId, normalizedEquivalent),
			/delivered message id with a different prompt/,
		);
		assert.equal(isExactCodexNativeFirstUseDeliveryReplay(receipt, "normal-followup", normalizedEquivalent), false);
	}
	const canonical = deliveredFirstUseReceipt({
		messageId: "canonical-delivered",
		promptHash: hashCanonicalCodexNativeFirstUsePrompt(byteExactPrompt),
	});
	assert.equal(
		isExactCodexNativeFirstUseDeliveryReplay(canonical, canonical.messageId, normalizedEquivalent),
		true,
	);
});

test("Codex native canonical first-use prompts normalize line endings and Unicode NFC", () => {
	const composed = "caf\u00e9\r\nnext\rline";
	const decomposed = "cafe\u0301\nnext\nline";
	assert.equal(canonicalizeCodexNativeFirstUsePrompt(composed), "caf\u00e9\nnext\nline");
	assert.equal(canonicalizeCodexNativeFirstUsePrompt(decomposed), "caf\u00e9\nnext\nline");
	assert.equal(
		hashCanonicalCodexNativeFirstUsePrompt(composed),
		hashCanonicalCodexNativeFirstUsePrompt(decomposed),
	);
	assert.notEqual(
		hashCanonicalCodexNativeFirstUsePrompt(composed),
		hashCanonicalCodexNativeFirstUsePrompt(`${decomposed} `),
	);
	const pending = pendingFirstUseMetadata({
		messageId: "canonical-message",
		promptHash: hashCanonicalCodexNativeFirstUsePrompt(composed),
	});
	assert.doesNotThrow(() => assertCodexNativePendingFirstUseTurn(pending, {
		id: pending.threadId,
		turns: [{
			id: "canonical-turn",
			status: "completed",
			items: [{
				id: "canonical-user",
				type: "userMessage",
				clientId: pending.messageId,
				content: [{ type: "text", text: decomposed }],
			}],
		}],
	}));
	assert.throws(() => assertCodexNativePendingFirstUseTurn(pending, {
		id: pending.threadId,
		turns: [{
			id: "different-turn",
			status: "completed",
			items: [{
				id: "different-user",
				type: "userMessage",
				clientId: pending.messageId,
				content: [{ type: "text", text: `${decomposed} ` }],
			}],
		}],
	}), /does not match the persisted prompt hash/);
});

test("Codex App Server fixture recovers a state lock left by a killed owner", async (t) => {
	const root = await testRoot(t);
	const config = runtimeConfig(root);
	const first = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: "codex-native-stale-lock",
		piboSessionId: "ps_codex_stale_lock_first",
		sessionGeneration: "stale-lock-first",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => first.close());
	await assert.rejects(first.client.request("test/exitWithStateLock", {}), /exited unexpectedly|process exited/i);
	const replacement = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: "codex-native-stale-lock",
		piboSessionId: "ps_codex_stale_lock_replacement",
		sessionGeneration: "stale-lock-replacement",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => replacement.close());
	const state = await replacement.client.request("test/getState", {});
	assert.equal(typeof state.nextThread, "number");
	await replacement.close();
});

test("Codex App Server fixture lock excludes live and ambiguous owners and preserves ownership semantics", async (t) => {
	const root = await testRoot(t);
	const lockState = (name) => join(root, `${name}.json`);

	const oldLivePath = lockState("old-live");
	const oldLive = await startReadyFixtureChild(lockChildFixturePath, ["hold-old-live", oldLivePath]);
	registerTestDisposer(t, oldLive.stop);
	const oldLiveContender = await runFixtureChild(lockChildFixturePath, ["try-acquire", oldLivePath]);
	assert.equal(oldLiveContender.code, 0);
	assert.match(oldLiveContender.stdout, /^blocked:Timed out waiting/);
	assert.equal(oldLive.getOutput().stderr, "");
	await oldLive.stop();
	assert.match((await runFixtureChild(lockChildFixturePath, ["try-acquire", oldLivePath])).stdout, /^acquired$/m);

	for (const boundary of [
		"before-owner-write",
		"after-owner-write",
		"after-owner-linked",
		"after-owner-published",
	]) {
		const boundaryPath = lockState(boundary);
		const owner = await startReadyFixtureChild(lockChildFixturePath, [`stall-${boundary}`, boundaryPath]);
		registerTestDisposer(t, owner.stop);
		await owner.stop();
		assert.match(
			(await runFixtureChild(lockChildFixturePath, ["try-acquire", boundaryPath])).stdout,
			/^acquired$/m,
			`a contender must recover after owner death at ${boundary}`,
		);
	}

	const deadPath = lockState("dead");
	assert.equal((await runFixtureChild(lockChildFixturePath, ["acquire-and-exit", deadPath])).code, 23);
	assert.match((await runFixtureChild(lockChildFixturePath, ["try-acquire", deadPath])).stdout, /^acquired$/m);

	const ambiguousPath = lockState("ambiguous");
	assert.equal((await runFixtureChild(lockChildFixturePath, ["acquire-and-exit", ambiguousPath])).code, 23);
	assert.match(
		(await runFixtureChild(lockChildFixturePath, ["try-ambiguous", ambiguousPath])).stdout,
		/^blocked:Timed out waiting/m,
	);
	assert.match((await runFixtureChild(lockChildFixturePath, ["try-acquire", ambiguousPath])).stdout, /^acquired$/m);

	const successorPath = lockState("successor");
	assert.match(
		(await runFixtureChild(lockChildFixturePath, ["successor-token", successorPath])).stdout,
		/^successor-preserved$/m,
	);
	await rm(`${successorPath}.lock`, { recursive: true, force: true });

	const asyncPath = lockState("async");
	assert.match(
		(await runFixtureChild(lockChildFixturePath, ["async-callback", asyncPath])).stdout,
		/^Fixture state-lock callbacks must be synchronous\.:lock-released$/m,
	);
});

test("Codex native driver declares implemented lifecycle, turn-output, and history capabilities", async (t) => {
	const root = await testRoot(t);
	const { registry, adapter, instanceId } = createAdapter(root);
	assert.equal(CODEX_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.id, "codex-native");
	assert.equal(CODEX_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.transport, "stdio-rpc");
	assert.equal(CODEX_NATIVE_AGENT_RUNTIME_DRIVER.descriptor.protocol.name, "codex-app-server-v2");
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.lifecycle.persistent, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.lifecycle.resume, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.lifecycle.listNativeSessions, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.lifecycle.fork, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.lifecycle.clone, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.input.text, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.input.steering, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.output.assistantDeltas, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.output.reasoning, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.output.toolEvents, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.output.usage, true);
	assert.equal(CODEX_NATIVE_THREAD_CAPABILITIES.maintenance.history, true);
	assert.equal(typeof adapter.inspectHistory, "function");
	assert.equal(typeof adapter.readHistory, "function");

	const [inspection] = await registry.inspectInstances();
	assert.equal(inspection.id, instanceId);
	assert.equal(inspection.available, true);
	assert.ok(inspection.diagnostics.some((diagnostic) => diagnostic.code === "codex_native_available"));
	assert.ok(inspection.diagnostics.some((diagnostic) => diagnostic.code === "codex_native_home_ready"));
	assert.equal(
		(await registry.validateProfile({ profile: profile(instanceId), workspace: root })).some((diagnostic) => diagnostic.severity === "error"),
		false,
	);
});

test("Codex native thread sessions bind and list a fresh thread, fail closed after an empty-thread restart, and resume durable threads", async (t) => {
	const root = await testRoot(t);
	const { registry, instanceId } = createAdapter(root);
	const initial = {
		piboSessionId: "ps_codex_start",
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
	const first = await registry.openSession(instanceId, openInput(instanceId, root, initial));
	const firstBinding = first.getBinding();
	assert.equal(firstBinding.state, "bound");
	assert.match(firstBinding.nativeSessionId, /^thread-/);
	assert.equal(firstBinding.protocol, "codex-app-server-v2");
	assert.equal(firstBinding.protocolVersion, "0.153.2");
	assert.equal(firstBinding.locator.kind, "adapter-resolved");
	assert.equal(firstBinding.locator.value, undefined);
	assert.equal(firstBinding.revision, 1);
	assert.equal(first.getStatus().streaming, false);
	const listed = await first.controls.listSessions();
	assert.ok(listed.some((thread) => thread.nativeSessionId === firstBinding.nativeSessionId));
	assert.ok(listed.every((thread) => thread.locator?.value === undefined));
	assert.ok(getCodexNativeClient(first));
	await first.dispose();
	await first.dispose();

	await assert.rejects(
		registry.openSession(instanceId, openInput(instanceId, root, firstBinding)),
		(error) => error instanceof AgentRuntimeBindingMissingError,
	);

	await seedThread(runtimeConfig(root), {
		runtimeInstanceId: instanceId,
		threadId: "thread-durable",
		workspace: root,
		cwd: root,
		preview: "durable",
		turns: seededTurns(),
	});
	const durableBinding = boundBinding(instanceId, "ps_codex_durable", "thread-durable");
	const resumed = await registry.openSession(instanceId, openInput(instanceId, root, durableBinding));
	assert.equal(resumed.getBinding().nativeSessionId, "thread-durable");
	assert.equal(resumed.controls.getCurrentSession().nativeSessionId, "thread-durable");
	await resumed.dispose();
});

test("Codex native thread history is normalized, paginated, redacted, and cursor scoped", async (t) => {
	const root = await testRoot(t);
	const { adapter, instanceId } = createAdapter(root);
	const config = runtimeConfig(root);
	await seedThread(config, {
		runtimeInstanceId: instanceId,
		threadId: "thread-history",
		workspace: root,
		cwd: root,
		name: "password=fixture-title-secret",
		preview: "api_key=fixture-preview-secret first",
		createdAt: 1_780_000_000,
		updatedAt: 1_780_000_040,
		turns: seededTurns(),
	});
	const binding = boundBinding(instanceId, "ps_codex_history", "thread-history");
	const inspection = await adapter.inspectHistory({ binding, workspace: root });
	assert.equal(inspection.available, true);
	assert.equal(inspection.title, "password=[redacted]");
	assert.equal(inspection.firstMessage, "api_key=[redacted] first");
	assert.equal(inspection.locator.kind, "adapter-resolved");
	assert.equal(inspection.locator.value, undefined);

	const newest = await adapter.readHistory({ binding, workspace: root, limit: 2 });
	assert.equal(newest.entries.length, 2);
	assert.equal(newest.hasMore, true);
	assert.ok(newest.nextCursor);
	const older = await adapter.readHistory({ binding, workspace: root, limit: 20, cursor: newest.nextCursor });
	assert.equal(older.hasMore, false);
	const all = [...older.entries, ...newest.entries];
	const serialized = JSON.stringify(all);
	for (const secret of [
		"fixture-user-secret",
		"fixture-reasoning-secret",
		"fixture-command-secret",
		"fixture-output-secret",
		"fixture-agent-secret",
		"fixture-provider-secret",
		"/private/workspace",
		"/private/fake-codex",
	]) {
		assert.doesNotMatch(serialized, new RegExp(secret));
	}
	assert.match(serialized, /\[redacted\]/);
	assert.ok(all.some((entry) => entry.type === "message" && entry.role === "user"));
	assert.ok(all.some((entry) => entry.type === "message" && entry.role === "assistant"));
	assert.ok(all.some((entry) => entry.type === "message" && entry.role === "tool" && entry.toolName === "codex_command"));
	assert.ok(all.some((entry) => entry.type === "message" && entry.status === "error"));

	const before = await adapter.readHistory({
		binding,
		workspace: root,
		limit: 50,
		beforeTimestamp: new Date(1_780_000_025 * 1_000).toISOString(),
	});
	assert.ok(before.entries.every((entry) => Date.parse(entry.createdAt) < 1_780_000_025 * 1_000));
	await assert.rejects(
		adapter.readHistory({ binding, workspace: root, cursor: "codex-history:not-valid", limit: 2 }),
		(error) => error instanceof AgentRuntimeUnavailableError,
	);
});

test("Codex native history inspection reuses recent process-backed metadata and refreshes it after reads", async (t) => {
	const root = await testRoot(t);
	const { adapter, instanceId } = createAdapter(root, "codex-native-history-cache");
	const config = runtimeConfig(root);
	const threadId = "thread-history-cache";
	const binding = boundBinding(instanceId, "ps_codex_history_cache", threadId);
	const seed = async (name, updatedAt) => await seedThread(config, {
		runtimeInstanceId: instanceId,
		threadId,
		workspace: root,
		cwd: root,
		name,
		preview: name,
		createdAt: 1_780_000_000,
		updatedAt,
		turns: seededTurns(),
	});
	await seed("First title", 1_780_000_010);

	const originalNow = Date.now;
	let now = originalNow();
	Date.now = () => now;
	try {
		const first = await adapter.inspectHistory({ binding, workspace: root });
		assert.equal(first.title, "First title");

		await seed("Second title", 1_780_000_020);
		const cached = await adapter.inspectHistory({ binding, workspace: root });
		assert.equal(cached.title, "First title", "a repeated inspection should avoid another app-server startup inside the TTL");

		const page = await adapter.readHistory({ binding, workspace: root, limit: 2 });
		assert.equal(page.inspection.title, "Second title");
		const refreshedByRead = await adapter.inspectHistory({ binding, workspace: root });
		assert.equal(refreshedByRead.title, "Second title", "a full history read should refresh the inspection cache");

		await seed("Third title", 1_780_000_030);
		now += 5_001;
		const expired = await adapter.inspectHistory({ binding, workspace: root });
		assert.equal(expired.title, "Third title");
	} finally {
		Date.now = originalNow;
	}
});

test("Codex native thread controls list and fork through stable App Server methods", async (t) => {
	const root = await testRoot(t);
	const { registry, adapter, instanceId } = createAdapter(root);
	const config = runtimeConfig(root);
	await seedThread(config, {
		runtimeInstanceId: instanceId,
		threadId: "thread-source",
		workspace: root,
		cwd: root,
		name: "Source",
		preview: "first",
		turns: seededTurns(),
	});
	await seedThread(config, {
		runtimeInstanceId: instanceId,
		threadId: "thread-other",
		workspace: root,
		cwd: root,
		name: "Other",
		preview: "other",
		turns: [],
	});
	const sourceBinding = boundBinding(instanceId, "ps_codex_fork", "thread-source");
	const session = await registry.openSession(instanceId, openInput(instanceId, root, sourceBinding));
	registerTestDisposer(t, () => session.dispose());
	const listed = await session.controls.listSessions();
	assert.ok(listed.some((thread) => thread.nativeSessionId === "thread-source"));
	assert.ok(listed.some((thread) => thread.nativeSessionId === "thread-other"));
	assert.ok(listed.every((thread) => thread.locator?.value === undefined));
	const candidates = session.controls.getForkCandidates();
	assert.deepEqual(candidates.map((candidate) => candidate.entryId), ["user-a", "user-b", "user-c"]);
	assert.deepEqual(candidates.slice(1).map((candidate) => candidate.text), ["continue", "fail"]);
	assert.doesNotMatch(JSON.stringify(candidates), /fixture-agent-secret/);

	const firstMessageSession = await registry.openSession(
		instanceId,
		openInput(
			instanceId,
			root,
			boundBinding(instanceId, "ps_codex_first_fork", "thread-source"),
			"ps_codex_first_fork",
			{ permissionMode: "yolo", personality: "pragmatic" },
		),
	);
	registerTestDisposer(t, () => firstMessageSession.dispose());
	const firstMessageResult = await firstMessageSession.controls.forkSession("user-a");
	assert.equal(firstMessageResult.current.nativeSessionId, undefined);
	assert.equal(firstMessageResult.current.leafId, null);
	assert.equal(firstMessageResult.summaryEntryId, "user-a");
	assert.ok(firstMessageResult.selectedText);
	assert.doesNotMatch(firstMessageResult.selectedText, /fixture-user-secret/);
	const firstMessageState = await getCodexNativeClient(firstMessageSession).request("test/getState", {});
	assert.equal(firstMessageState.resourceRequests.some((request) => request.method === "thread/start"), false);
	assert.equal(firstMessageSession.getBinding().nativeSessionId, "thread-source");

	const runningCandidates = session.controls.getForkCandidatesWhileRunning();
	assert.deepEqual(runningCandidates.map((candidate) => candidate.entryId), ["user-a", "user-b", "user-c"]);
	const runningFork = await session.controls.forkSessionWhileRunning("user-c");
	assert.equal(runningFork.previous.nativeSessionId, "thread-source");
	assert.notEqual(runningFork.current.nativeSessionId, "thread-source");
	assert.equal(runningFork.current.leafId, "turn-b");
	assert.equal(runningFork.sourceSessionUnchanged, true);
	assert.equal(session.getBinding().nativeSessionId, "thread-source", "snapshot fork must not adopt the derived thread");

	const result = await session.controls.forkSession("user-c");
	assert.equal(result.previous.nativeSessionId, "thread-source");
	assert.notEqual(result.current.nativeSessionId, "thread-source");
	assert.equal(result.current.leafId, "turn-b");
	assert.equal(result.selectedText, "fail");
	assert.equal(result.summaryEntryId, "user-c");
	const forkBinding = session.getBinding();
	assert.equal(forkBinding.nativeSessionId, result.current.nativeSessionId);
	assert.equal(forkBinding.state, "bound");
	const cloned = await session.controls.cloneSession();
	assert.equal(cloned.previous.nativeSessionId, forkBinding.nativeSessionId);
	assert.notEqual(cloned.current.nativeSessionId, forkBinding.nativeSessionId);
	assert.equal(cloned.current.leafId, "turn-b");
	const cloneBinding = session.getBinding();
	assert.equal(cloneBinding.nativeSessionId, cloned.current.nativeSessionId);
	const lifecycleState = await getCodexNativeClient(session).request("test/getState", {});
	assert.equal(lifecycleState.resourceRequests.filter((request) => request.method === "thread/fork").length, 3);
	const forkHistory = await adapter.readHistory({ binding: cloneBinding, workspace: root, limit: 2 });
	assert.equal(forkHistory.entries.some((entry) => entry.type === "message" && entry.nativeTurnId === "turn-c"), false);
	assert.equal(forkHistory.entries.some((entry) => entry.type === "message" && entry.nativeTurnId === "turn-b"), true);
	assert.ok(forkHistory.nextCursor);

	await assert.rejects(
		adapter.readHistory({ binding: sourceBinding, workspace: root, limit: 2, cursor: forkHistory.nextCursor }),
		(error) => error instanceof AgentRuntimeUnavailableError,
	);
});

test("Codex native binding inspection marks a missing thread without creating a replacement", async (t) => {
	const root = await testRoot(t);
	const { adapter, instanceId } = createAdapter(root);
	const binding = boundBinding(instanceId, "ps_codex_missing", "thread-does-not-exist");
	const resolved = await adapter.resolveBinding({ binding, workspace: root });
	assert.equal(resolved.state, "missing");
	assert.equal(resolved.nativeSessionId, "thread-does-not-exist");
	assert.equal(resolved.metadata.diagnosticCode, "codex_native_thread_missing");
	assert.doesNotMatch(JSON.stringify(resolved), /runtime-state|fake-thread-state|config\.toml/);
	const inspection = await adapter.inspectHistory({ binding: resolved, workspace: root });
	assert.equal(inspection.available, false);
	assert.ok(inspection.diagnostics.some((diagnostic) => diagnostic.code === "codex_native_history_not_found"));
	const page = await adapter.readHistory({ binding: resolved, workspace: root, limit: 20 });
	assert.deepEqual(page.entries, []);
	assert.equal(page.hasMore, false);
	await assert.rejects(
		adapter.openSession(openInput(instanceId, root, resolved)),
		(error) => error instanceof AgentRuntimeBindingMissingError,
	);
});

test("Codex native first-message branches bind only when their first message becomes durable", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-first-message-branch";
	const profileName = "codex-native-first-message-branch-profile";
	const sourcePiboSessionId = "ps_codex_first_message_source";
	const config = runtimeConfig(root);
	await seedThread(config, {
		runtimeInstanceId: instanceId,
		threadId: "thread-first-message-source",
		workspace: root,
		cwd: root,
		name: "First-message source",
		preview: "hello",
		turns: seededTurns(),
	});
	const pluginRegistry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.codex-native-first-message-branch",
			register(api) {
				api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
				api.registerAgentRuntimeInstance({
					id: instanceId,
					adapterId: CODEX_NATIVE_ADAPTER_ID,
					config,
				});
				api.registerProfile({
					name: profileName,
					create() {
						return new InitialSessionContextBuilder(profileName)
							.withAgentRuntime(instanceId)
							.withBuiltinTools("disabled")
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false })
							.createSession();
					},
				});
			},
		})],
	});
	const store = new PiboDataSessionStore(join(root, "first-message-branch.sqlite"));
	registerTestDisposer(t, () => store.close());
	store.create({
		id: sourcePiboSessionId,
		channel: "test",
		kind: "chat",
		profile: profileName,
		workspace: root,
		title: "Durable first-message branch",
		activeModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
		metadata: { chatRoomId: "room_first_message", branchFixture: "preserved" },
		runtimeBinding: boundBinding(instanceId, sourcePiboSessionId, "thread-first-message-source"),
	});
	const resources = new PiboRuntimeResourceService({ rootDir: join(root, "resources") });
	const sourceRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => sourceRouter.disposeAll());
	const forked = await sourceRouter.emit({
		type: "execution",
		piboSessionId: sourcePiboSessionId,
		action: "session.fork",
		params: { entryId: "user-a" },
	});
	assert.equal(forked.type, "execution_result");
	const branchPiboSessionId = forked.result.piboSessionId;
	const branch = store.get(branchPiboSessionId);
	assert.equal(branch.kind, "branch");
	assert.equal(branch.originId, sourcePiboSessionId);
	assert.equal(branch.title, "Durable first-message branch");
	assert.equal(branch.workspace, root);
	assert.deepEqual(branch.activeModel, { provider: "openai-codex", id: "gpt-5.6-sol" });
	assert.equal(branch.metadata.chatRoomId, "room_first_message");
	assert.equal(branch.metadata.branchFixture, "preserved");
	assert.equal(branch.metadata.originAction, "session.fork");
	assert.equal(branch.metadata.originRuntimeNativeSessionId, "thread-first-message-source");
	assert.equal(branch.runtimeBinding.state, "unbound");
	assert.equal(branch.runtimeBinding.nativeSessionId, undefined);
	assert.equal(branch.runtimeBinding.protocol, "codex-app-server-v2");
	assert.equal(branch.runtimeBinding.protocolVersion, "0.153.2");
	assert.equal(store.getRuntimeBinding(sourcePiboSessionId).nativeSessionId, "thread-first-message-source");
	const emptyHistory = await pluginRegistry.requireAgentRuntimeAdapter(instanceId).readHistory({
		binding: branch.runtimeBinding,
		workspace: root,
		limit: 20,
	});
	assert.deepEqual(emptyHistory.entries, []);

	const beforeFirstMessage = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_first_message_inspection",
		sessionGeneration: "before-first-message",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => beforeFirstMessage.close());
	const beforeState = await beforeFirstMessage.client.request("test/getState", {});
	assert.equal(beforeState.resourceRequests.some((request) => request.method === "thread/start"), false);
	await beforeFirstMessage.close();
	await sourceRouter.disposeAll();

	const statusProbeRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => statusProbeRouter.disposeAll());
	const probed = await statusProbeRouter.emit({
		type: "execution",
		piboSessionId: branchPiboSessionId,
		action: "status",
	});
	assert.equal(probed.type, "execution_result");
	assert.equal(probed.result.runtimeBinding.state, "unbound");
	assert.equal(probed.result.runtimeBinding.nativeSessionId, undefined);
	assert.equal(store.getRuntimeBinding(branchPiboSessionId).state, "unbound");
	assert.equal(store.getRuntimeBinding(branchPiboSessionId).nativeSessionId, undefined);
	await statusProbeRouter.disposeAll();

	const firstUseRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => firstUseRouter.disposeAll());
	persistRouterOutputs(firstUseRouter, store);
	const reply = await firstUseRouter.emitMessageAndWaitForReply({
		type: "message",
		piboSessionId: branchPiboSessionId,
		id: "codex-first-message-after-reopen",
		text: "first message after source reset",
		source: "user",
	}, 5_000);
	assert.equal(reply.text, "Codex answer.");
	const durableBranchBinding = store.getRuntimeBinding(branchPiboSessionId);
	assert.equal(durableBranchBinding.state, "bound");
	assert.match(durableBranchBinding.nativeSessionId, /^thread-/);
	assert.notEqual(durableBranchBinding.nativeSessionId, "thread-first-message-source");
	assert.deepEqual(durableBranchBinding.metadata.codexNativeFirstUse, {
		version: 3,
		state: "delivered",
		messageId: "codex-first-message-after-reopen",
		promptHash: hashCanonicalCodexNativeFirstUsePrompt("first message after source reset"),
	});
	assert.equal(durableBranchBinding.metadata.piboPendingNativeSession, undefined);
	assert.equal(store.getRuntimeBinding(sourcePiboSessionId).nativeSessionId, "thread-first-message-source");
	const firstMessageState = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_first_message_durable_inspection",
		sessionGeneration: "after-first-message",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => firstMessageState.close());
	const durableState = await firstMessageState.client.request("test/getState", {});
	assert.equal(durableState.resourceRequests.filter((request) => request.method === "thread/start").length, 2);
	assert.ok(durableState.threads[durableBranchBinding.nativeSessionId]);
	assert.equal(durableState.turnRequests.at(-1).threadId, durableBranchBinding.nativeSessionId);
	await firstMessageState.close();
	await firstUseRouter.disposeAll();

	const reopenedRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => reopenedRouter.disposeAll());
	persistRouterOutputs(reopenedRouter, store);
	const reopened = await reopenedRouter.emit({
		type: "execution",
		piboSessionId: branchPiboSessionId,
		action: "status",
	});
	assert.equal(reopened.type, "execution_result");
	assert.equal(store.getRuntimeBinding(branchPiboSessionId).nativeSessionId, durableBranchBinding.nativeSessionId);
	const normalReplay = await reopenedRouter.emitMessageAndWaitForReply({
		type: "message",
		piboSessionId: branchPiboSessionId,
		id: "codex-first-message-after-reopen",
		text: "first message after source reset",
		source: "user",
	}, 5_000);
	assert.equal(normalReplay.text, "Codex answer.");
	const normalReplayRows = store.getDataStore().eventLog.listEvents({
		sessionId: branchPiboSessionId,
		topic: "pibo.output",
		limit: 100,
	}).filter((event) => event.eventId === "codex-first-message-after-reopen");
	assert.equal(normalReplayRows.filter((event) => event.type === "assistant_message").length, 1);
	assert.equal(normalReplayRows.filter((event) => event.type === "message_finished").length, 1);
	await reopenedRouter.disposeAll();

	const raceBranchRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => raceBranchRouter.disposeAll());
	const raceFork = await raceBranchRouter.emit({
		type: "execution",
		piboSessionId: sourcePiboSessionId,
		action: "session.fork",
		params: { entryId: "user-a" },
	});
	assert.equal(raceFork.type, "execution_result");
	const raceBranchId = raceFork.result.piboSessionId;
	assert.equal(store.getRuntimeBinding(raceBranchId).state, "unbound");
	await raceBranchRouter.disposeAll();

	const raceRouterA = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	const raceRouterB = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => Promise.allSettled([raceRouterA.disposeAll(), raceRouterB.disposeAll()]));
	const raceErrorsA = [];
	const raceErrorsB = [];
	raceRouterA.subscribe((event) => {
		if (event.type === "session_error") raceErrorsA.push(event.error);
	});
	raceRouterB.subscribe((event) => {
		if (event.type === "session_error") raceErrorsB.push(event.error);
	});
	await raceRouterA.emit({ type: "execution", piboSessionId: raceBranchId, action: "status" });
	await raceRouterB.emit({ type: "execution", piboSessionId: raceBranchId, action: "status" });
	assert.equal(store.getRuntimeBinding(raceBranchId).state, "unbound");
	assert.equal(store.getRuntimeBinding(raceBranchId).revision, 1);
	const raceResults = await Promise.allSettled([
		raceRouterA.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: raceBranchId,
			id: "codex-concurrent-first-use-a",
			text: "concurrent first use a",
			source: "user",
		}, 5_000),
		raceRouterB.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: raceBranchId,
			id: "codex-concurrent-first-use-b",
			text: "concurrent first use b",
			source: "user",
		}, 5_000),
	]);
	assert.equal(raceResults.filter((result) => result.status === "fulfilled").length, 1);
	assert.equal(raceResults.filter((result) => result.status === "rejected").length, 1);
	assert.equal(raceResults.find((result) => result.status === "fulfilled")?.value.text, "Codex answer.");
	assert.match(raceResults.find((result) => result.status === "rejected")?.reason?.message ?? "", /changed concurrently/);
	await waitFor(() => [...raceErrorsA, ...raceErrorsB].some((message) => /changed concurrently/.test(message)));
	const raceBinding = store.getRuntimeBinding(raceBranchId);
	assert.equal(raceBinding.state, "bound");
	assert.equal(raceBinding.revision, 3);
	assert.match(raceBinding.nativeSessionId, /^thread-/);
	assert.equal(store.getRuntimeBinding(sourcePiboSessionId).nativeSessionId, "thread-first-message-source");
	const losingRouter = raceErrorsA.some((message) => /changed concurrently/.test(message)) ? raceRouterA : raceRouterB;
	await waitFor(() => losingRouter.listSessionRuntimeStatuses().every((status) => status.piboSessionId !== raceBranchId));
	await losingRouter.emit({ type: "execution", piboSessionId: raceBranchId, action: "status" });
	const followup = await losingRouter.emitMessageAndWaitForReply({
		type: "message",
		piboSessionId: raceBranchId,
		id: "codex-concurrent-winner-followup",
		text: "follow winner after CAS",
		source: "user",
	}, 5_000);
	assert.equal(followup.text, "Codex answer.");
	const raceInspection = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_concurrent_first_use_inspection",
		sessionGeneration: "concurrent-first-use",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => raceInspection.close());
	const raceState = await raceInspection.client.request("test/getState", {});
	assert.equal(
		raceState.turnRequestMessageIds.filter((request) =>
			request.clientUserMessageId === "codex-concurrent-first-use-a"
			|| request.clientUserMessageId === "codex-concurrent-first-use-b").length,
		1,
	);
	assert.equal(
		raceState.turnRequestMessageIds.filter((request) =>
			request.clientUserMessageId === "codex-first-message-after-reopen").length,
		1,
	);
	assert.equal(
		raceState.turnRequestMessageIds.find((request) => request.clientUserMessageId === "codex-concurrent-winner-followup")?.threadId,
		raceBinding.nativeSessionId,
	);
	await raceInspection.close();
	await Promise.all([raceRouterA.disposeAll(), raceRouterB.disposeAll()]);
});

test("runtime-binding persistence authorization is opaque and fixed to original concrete built-in CAS methods", async (t) => {
	const root = await testRoot(t);
	assert.equal("registerAuditedDurableRuntimeBindingCasStore" in sessionStoreModule, false);
	assert.equal("hasAuditedDurableRuntimeBindingCas" in sessionStoreModule, false);
	assert.equal("AGENT_RUNTIME_BINDING_PERSISTENCE_GUARANTEE" in agentRuntimeTypesModule, false);
	const shippedSources = await Promise.all([
		"../dist/sessions/store.js",
		"../dist/sessions/pibo-data-store.js",
		"../dist/sessions/sqlite-store.js",
	].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
	for (const source of shippedSources) {
		assert.doesNotMatch(source, /registerAuditedDurableRuntimeBindingCasStore|hasAuditedDurableRuntimeBindingCas/);
	}

	const fakeCapability = Object.freeze({
		async compareAndSet(binding) { return binding; },
	});
	assert.equal(isAgentRuntimeBindingPersistence(fakeCapability), false);

	for (const [name, Store] of [
		["pibo-data", PiboDataSessionStore],
		["sqlite", SqlitePiboSessionStore],
	]) {
		const storePath = join(root, `${name}.sqlite`);
		const primary = new Store(storePath);
		const beforeMutation = new Store(storePath);
		const piboSessionId = `ps_codex_capability_${name.replaceAll("-", "_")}`;
		primary.create({
			id: piboSessionId,
			channel: "test",
			kind: "branch",
			profile: "codex-capability-test",
			workspace: root,
			runtimeBinding: {
				runtimeInstanceId: "codex-capability-test",
				adapterId: CODEX_NATIVE_ADAPTER_ID,
				state: "unbound",
			},
		});
		t.after(() => {
			primary.close();
			beforeMutation.close();
		});

		assert.equal(createAgentRuntimeBindingPersistence(Object.create(Store.prototype), { piboSessionId }), undefined);
		assert.equal(createAgentRuntimeBindingPersistence(new Proxy(primary, {}), { piboSessionId }), undefined);
		assert.equal(createAgentRuntimeBindingPersistence({ ...primary }, { piboSessionId }), undefined);

		class StoreSubclass extends Store {
			updateRuntimeBinding(...args) {
				return super.updateRuntimeBinding(...args);
			}
		}
		const subclass = new StoreSubclass(join(root, `${name}-subclass.sqlite`));
		t.after(() => subclass.close());
		assert.equal(createAgentRuntimeBindingPersistence(subclass, { piboSessionId }), undefined);

		const originalPrototype = Store.prototype;
		try {
			Object.setPrototypeOf(beforeMutation, {});
			assert.equal(createAgentRuntimeBindingPersistence(beforeMutation, { piboSessionId }), undefined);
		} finally {
			Object.setPrototypeOf(beforeMutation, originalPrototype);
		}

		const originalGet = Store.prototype.get;
		const originalGetRuntimeBinding = Store.prototype.getRuntimeBinding;
		const originalCas = Store.prototype.updateRuntimeBinding;
		let replacementCalls = 0;
		const replacement = () => {
			replacementCalls += 1;
			throw new Error("mutable replacement store method must never run");
		};
		for (const property of ["get", "getRuntimeBinding", "updateRuntimeBinding"]) {
			Object.defineProperty(beforeMutation, property, {
				configurable: true,
				value: replacement,
				writable: true,
			});
			try {
				assert.equal(createAgentRuntimeBindingPersistence(beforeMutation, { piboSessionId }), undefined);
			} finally {
				delete beforeMutation[property];
			}
		}
		Store.prototype.get = replacement;
		Store.prototype.getRuntimeBinding = replacement;
		Store.prototype.updateRuntimeBinding = replacement;
		try {
			assert.equal(createAgentRuntimeBindingPersistence(beforeMutation, { piboSessionId }), undefined);
		} finally {
			Store.prototype.get = originalGet;
			Store.prototype.getRuntimeBinding = originalGetRuntimeBinding;
			Store.prototype.updateRuntimeBinding = originalCas;
		}

		const capability = createAgentRuntimeBindingPersistence(primary, { piboSessionId });
		assert.ok(capability);
		assert.equal(Object.isFrozen(capability), true);
		assert.equal(isAgentRuntimeBindingPersistence(capability), true);
		const current = primary.getRuntimeBinding(piboSessionId);
		for (const property of ["get", "getRuntimeBinding", "updateRuntimeBinding"]) {
			Object.defineProperty(primary, property, {
				configurable: true,
				value: replacement,
				writable: true,
			});
		}
		Store.prototype.get = replacement;
		Store.prototype.getRuntimeBinding = replacement;
		Store.prototype.updateRuntimeBinding = replacement;
		try {
			assert.equal(isAgentRuntimeBindingPersistence(capability), true);
			const updated = await capability.compareAndSet({
				...current,
				state: "bound",
				nativeSessionId: `thread-${name}`,
			}, 1);
			assert.equal(updated.revision, 2);
			assert.equal(updated.nativeSessionId, `thread-${name}`);
			assert.equal(replacementCalls, 0);
		} finally {
			Store.prototype.get = originalGet;
			Store.prototype.getRuntimeBinding = originalGetRuntimeBinding;
			Store.prototype.updateRuntimeBinding = originalCas;
			delete primary.get;
			delete primary.getRuntimeBinding;
			delete primary.updateRuntimeBinding;
		}
	}
});

test("Codex native router rejects absent and structurally similar non-atomic binding CAS before native start", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-no-binding-cas";
	const profileName = "codex-native-no-binding-cas-profile";
	const piboSessionId = "ps_codex_no_binding_cas";
	const config = runtimeConfig(root);
	const pluginRegistry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.codex-native-no-binding-cas",
			register(api) {
				api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
				api.registerAgentRuntimeInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config });
				api.registerProfile({
					name: profileName,
					create() {
						return new InitialSessionContextBuilder(profileName)
							.withAgentRuntime(instanceId)
							.withBuiltinTools("disabled")
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false })
							.createSession();
					},
				});
			},
		})],
	});
	const backing = new InMemoryPiboSessionStore();
	backing.create({
		id: piboSessionId,
		channel: "test",
		kind: "branch",
		profile: profileName,
		workspace: root,
		runtimeBinding: {
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			state: "unbound",
		},
	});
	const storeWithoutBindingUpdates = {
		get: backing.get.bind(backing),
		list: backing.list.bind(backing),
		create: backing.create.bind(backing),
		update: backing.update.bind(backing),
		delete: backing.delete.bind(backing),
		find: backing.find.bind(backing),
		getRuntimeBinding: backing.getRuntimeBinding.bind(backing),
	};
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: storeWithoutBindingUpdates,
		runtimeResourceService: new PiboRuntimeResourceService({ rootDir: join(root, "resources") }),
	});
	registerTestDisposer(t, () => router.disposeAll());
	const assistantReplies = [];
	router.subscribe((event) => {
		if (event.type === "assistant_message") assistantReplies.push(event);
	});
	await assert.rejects(router.emitMessageAndWaitForReply({
		type: "message",
		piboSessionId,
		id: "codex-no-binding-cas-message",
		text: "must fail before native execution",
		source: "user",
	}, 5_000), /requires audited durable cross-process atomic runtime-binding CAS/);
	assert.deepEqual(assistantReplies, []);
	assert.equal(backing.getRuntimeBinding(piboSessionId).revision, 1);
	assert.equal(backing.getRuntimeBinding(piboSessionId).state, "unbound");
	assert.equal(backing.getRuntimeBinding(piboSessionId).nativeSessionId, undefined);

	const nonAtomicSessionId = "ps_codex_non_atomic_binding_cas";
	backing.create({
		id: nonAtomicSessionId,
		channel: "test",
		kind: "branch",
		profile: profileName,
		workspace: root,
		runtimeBinding: {
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			state: "unbound",
		},
	});
	let nonAtomicUpdateCalls = 0;
	const structurallySimilarNonAtomicStore = {
		...storeWithoutBindingUpdates,
		durableRuntimeBindingCas: {
			guarantee: "durable-cross-process-atomic-cas-v1",
			atomicity: "cross-process",
			durability: "durable",
		},
		updateRuntimeBinding(id, nextBinding, { expectedRevision } = {}) {
			nonAtomicUpdateCalls += 1;
			return {
				...structuredClone(nextBinding),
				piboSessionId: id,
				revision: (expectedRevision ?? 1) + 1,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
		},
	};
	const nonAtomicRouters = [0, 1].map((index) => new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: structurallySimilarNonAtomicStore,
		runtimeResourceService: new PiboRuntimeResourceService({ rootDir: join(root, `non-atomic-resources-${index}`) }),
	}));
	registerTestDisposer(t, () => Promise.all(nonAtomicRouters.map((candidate) => candidate.disposeAll())));
	const nonAtomicReplies = [];
	for (const candidate of nonAtomicRouters) {
		candidate.subscribe((event) => {
			if (event.type === "assistant_message") nonAtomicReplies.push(event);
		});
	}
	const nonAtomicResults = await Promise.allSettled(nonAtomicRouters.map((candidate, index) =>
		candidate.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: nonAtomicSessionId,
			id: "codex-non-atomic-same-message",
			text: "identical legitimate first request",
			source: "user",
		}, 5_000 + index)));
	assert.equal(nonAtomicResults.filter((result) => result.status === "fulfilled").length, 0);
	for (const result of nonAtomicResults) {
		assert.equal(result.status, "rejected");
		assert.match(result.reason.message, /requires audited durable cross-process atomic runtime-binding CAS/);
	}
	assert.equal(nonAtomicUpdateCalls, 0, "an unaudited method-shaped provider must never be invoked");
	assert.deepEqual(nonAtomicReplies, []);
	assert.equal(backing.getRuntimeBinding(nonAtomicSessionId).revision, 1);
	assert.equal(backing.getRuntimeBinding(nonAtomicSessionId).state, "unbound");

	let shapedPersistenceCalls = 0;
	const guaranteeShapedPersistence = {
		guarantee: "durable-cross-process-atomic-cas-v1",
		async compareAndSet(nextBinding, expectedRevision) {
			shapedPersistenceCalls += 1;
			return { ...structuredClone(nextBinding), revision: expectedRevision + 1 };
		},
	};
	const directRegistry = createAdapter(root, instanceId).registry;
	const directResults = await Promise.allSettled([0, 1].map(async (index) => {
		const directBinding = {
			piboSessionId: `ps_codex_shaped_persistence_${index}`,
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			state: "unbound",
			revision: 1,
		};
		const input = openInput(instanceId, root, directBinding, directBinding.piboSessionId, {}, "branch");
		input.productContext = {
			piboSessionId: directBinding.piboSessionId,
			getActiveMessage: () => ({ id: "codex-guarantee-shaped-same-message", source: "user" }),
		};
		input.services.runtimeBindingPersistence = guaranteeShapedPersistence;
		return await directRegistry.openSession(instanceId, input);
	}));
	assert.equal(directResults.filter((result) => result.status === "fulfilled").length, 0);
	for (const result of directResults) {
		assert.equal(result.status, "rejected");
		assert.match(result.reason.message, /requires audited durable cross-process atomic runtime-binding CAS/);
	}
	assert.equal(shapedPersistenceCalls, 0, "a guarantee-shaped service must not reach CAS");

	const inspection = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_no_binding_cas_inspection",
		sessionGeneration: "no-binding-cas-inspection",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => inspection.close());
	const state = await inspection.client.request("test/getState", {});
	assert.deepEqual(Object.keys(state.threads), [], "rejection must precede thread/start");
	assert.equal(
		state.turnRequestMessageIds.some((request) => request.clientUserMessageId === "codex-no-binding-cas-message"),
		false,
	);
	assert.equal(
		state.turnRequestMessageIds.some((request) => request.clientUserMessageId === "codex-guarantee-shaped-same-message"),
		false,
	);
	await inspection.close();
});

test("Codex native recovers the exact first turn after a child crashes between native durability and binding promotion", async (t) => {
	const root = await testRoot(t);
	const dbPath = join(root, "pibo.sqlite");
	const piboSessionId = "ps_codex_first_use_crash";
	const instanceId = "codex-native-crash-recovery";
	const profileName = "codex-native-crash-recovery-profile";
	const initialStore = new PiboDataSessionStore(dbPath);
	initialStore.create({
		id: piboSessionId,
		channel: "test",
		kind: "branch",
		profile: profileName,
		workspace: root,
		title: "Crash durable first turn",
		runtimeBinding: {
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			state: "unbound",
			protocol: "codex-app-server-v2",
			protocolVersion: "0.153.2",
		},
	});
	initialStore.close();

	const crashed = await runCrashChild([dbPath, root, fixturePath, piboSessionId]);
	assert.deepEqual(
		{ code: crashed.code, signal: crashed.signal, stdout: crashed.stdout, stderr: crashed.stderr },
		{ code: 86, signal: null, stdout: "", stderr: "" },
	);

	const store = new PiboDataSessionStore(dbPath);
	registerTestDisposer(t, () => store.close());
	const pending = store.getRuntimeBinding(piboSessionId);
	assert.equal(pending.revision, 2);
	assert.equal(pending.state, "unbound");
	assert.match(pending.nativeSessionId, /^thread-/);
	assert.equal(pending.metadata.codexNativeFirstUse.state, "pending");
	assert.equal(pending.metadata.codexNativeFirstUse.messageId, "codex-crash-first-message");
	assert.match(pending.metadata.codexNativeFirstUse.promptHash, /^[a-f0-9]{64}$/);
	assert.equal(pending.metadata.codexNativeFirstUse.threadId, pending.nativeSessionId);
	assert.doesNotMatch(JSON.stringify(pending), /durable first turn before binding promotion/);

	const config = runtimeConfig(root);
	const beforeRecovery = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_crash_before_recovery_inspection",
		sessionGeneration: "crash-before-recovery",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => beforeRecovery.close());
	const beforeState = await beforeRecovery.client.request("test/getState", {});
	assert.equal(beforeState.threads[pending.nativeSessionId].turns.length, 1);
	assert.equal(beforeState.threads[pending.nativeSessionId].turns[0].status, "completed");
	assert.deepEqual(beforeState.turnRequestMessageIds, [{
		threadId: pending.nativeSessionId,
		clientUserMessageId: "codex-crash-first-message",
	}]);
	await beforeRecovery.close();
	const restartRegistry = createAdapter(root, instanceId).registry;
	for (let restart = 0; restart < 2; restart += 1) {
		const recoveredRuntime = await restartRegistry.openSession(
			instanceId,
			openInput(instanceId, root, pending, piboSessionId, {}, "branch"),
		);
		assert.equal(recoveredRuntime.getBinding().state, "bound");
		assert.equal(recoveredRuntime.getBinding().nativeSessionId, pending.nativeSessionId);
		await recoveredRuntime.dispose();
		assert.equal(store.getRuntimeBinding(piboSessionId).state, "unbound");
		assert.equal(store.getRuntimeBinding(piboSessionId).nativeSessionId, pending.nativeSessionId);
	}

	const pluginRegistry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.codex-native-crash-recovery",
			register(api) {
				api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
				api.registerAgentRuntimeInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config });
				api.registerProfile({
					name: profileName,
					create() {
						return new InitialSessionContextBuilder(profileName)
							.withAgentRuntime(instanceId)
							.withBuiltinTools("disabled")
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false })
							.createSession();
					},
				});
			},
		})],
	});
	const resources = new PiboRuntimeResourceService({ rootDir: join(root, "resources") });
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => router.disposeAll());
	persistRouterOutputs(router, store);
	const replayedOutputs = [];
	router.subscribe((event) => {
		if (event.eventId === "codex-crash-first-message") replayedOutputs.push(event);
	});
	const replayed = await router.emit({
		type: "message",
		piboSessionId,
		id: "codex-crash-first-message",
		text: "durable first turn before binding promotion",
		source: "user",
	});
	assert.equal(replayed.type, "message_queued");
	await waitFor(() => replayedOutputs.some((event) => event.type === "message_finished"));
	const afterReplayInspection = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_crash_replay_inspection",
		sessionGeneration: "crash-replay",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => afterReplayInspection.close());
	const afterReplayState = await afterReplayInspection.client.request("test/getState", {});
	assert.equal(
		afterReplayState.turnRequestMessageIds.filter((request) =>
			request.clientUserMessageId === "codex-crash-first-message").length,
		1,
		"cold replay after terminal durability must not start the first native turn twice",
	);
	await afterReplayInspection.close();
	assert.deepEqual(
		replayedOutputs.filter((event) => event.type === "assistant_message").map((event) => event.text),
		["Codex answer."],
	);
	assert.equal(replayedOutputs.filter((event) => event.type === "message_finished").length, 1);
	assert.equal(replayedOutputs.some((event) => event.type === "session_error"), false);
	const replayedProductEvents = store.getDataStore().eventLog.listEvents({
		sessionId: piboSessionId,
		topic: "pibo.output",
		limit: 100,
	});
	assert.equal(replayedProductEvents.filter((event) => event.type === "assistant_message").length, 1);
	assert.equal(replayedProductEvents.filter((event) => event.type === "message_finished").length, 1);
	const recovered = store.getRuntimeBinding(piboSessionId);
	assert.equal(recovered.revision, 3);
	assert.equal(recovered.state, "bound");
	assert.equal(recovered.nativeSessionId, pending.nativeSessionId);
	assert.deepEqual(recovered.metadata.codexNativeFirstUse, {
		version: 3,
		state: "delivered",
		messageId: "codex-crash-first-message",
		promptHash: pending.metadata.codexNativeFirstUse.promptHash,
	});
	assert.equal(recovered.metadata.piboPendingNativeSession, undefined);
	await router.disposeAll();

	const statusRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => statusRouter.disposeAll());
	const status = await statusRouter.emit({ type: "execution", piboSessionId, action: "status" });
	assert.equal(status.type, "execution_result");
	assert.deepEqual(store.getRuntimeBinding(piboSessionId).metadata.codexNativeFirstUse, recovered.metadata.codexNativeFirstUse);
	await statusRouter.disposeAll();

	for (let restart = 0; restart < 2; restart += 1) {
		const replayRouter = new PiboSessionRouter({
			persistSession: false,
			pluginRegistry,
			sessionStore: store,
			runtimeResourceService: resources,
		});
		registerTestDisposer(t, () => replayRouter.disposeAll());
		persistRouterOutputs(replayRouter, store);
		const replay = await replayRouter.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId,
			id: "codex-crash-first-message",
			text: "durable first turn before binding promotion",
			source: "user",
		}, 5_000);
		assert.equal(replay.text, "Codex answer.");
		assert.deepEqual(store.getRuntimeBinding(piboSessionId).metadata.codexNativeFirstUse, recovered.metadata.codexNativeFirstUse);
		await replayRouter.disposeAll();
	}
	const afterRepeatedReplayEvents = store.getDataStore().eventLog.listEvents({
		sessionId: piboSessionId,
		topic: "pibo.output",
		limit: 100,
	}).filter((event) => event.eventId === "codex-crash-first-message");
	assert.equal(afterRepeatedReplayEvents.filter((event) => event.type === "assistant_message").length, 1);
	assert.equal(afterRepeatedReplayEvents.filter((event) => event.type === "message_finished").length, 1);

	const mismatchRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => mismatchRouter.disposeAll());
	await assert.rejects(mismatchRouter.emitMessageAndWaitForReply({
		type: "message",
		piboSessionId,
		id: "codex-crash-first-message",
		text: "different prompt under the delivered message id",
		source: "user",
	}, 5_000), /delivered message id with a different prompt/);
	await mismatchRouter.disposeAll();

	const followupRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => followupRouter.disposeAll());
	const followup = await followupRouter.emitMessageAndWaitForReply({
		type: "message",
		piboSessionId,
		id: "codex-crash-followup",
		text: "continue the recovered native thread",
		source: "user",
	}, 5_000);
	assert.equal(followup.text, "Codex answer.");
	await followupRouter.disposeAll();
	const laterReplayRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	registerTestDisposer(t, () => laterReplayRouter.disposeAll());
	persistRouterOutputs(laterReplayRouter, store);
	const laterReplay = await laterReplayRouter.emitMessageAndWaitForReply({
		type: "message",
		piboSessionId,
		id: "codex-crash-first-message",
		text: "durable first turn before binding promotion",
		source: "user",
	}, 5_000);
	assert.equal(laterReplay.text, "Codex answer.");
	await laterReplayRouter.disposeAll();
	const afterRecovery = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_crash_after_recovery_inspection",
		sessionGeneration: "crash-after-recovery",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => afterRecovery.close());
	const afterState = await afterRecovery.client.request("test/getState", {});
	assert.deepEqual(Object.keys(afterState.threads), [pending.nativeSessionId]);
	assert.equal(afterState.threads[pending.nativeSessionId].turns.length, 2);
	assert.equal(
		afterState.turnRequestMessageIds.filter((request) =>
			request.clientUserMessageId === "codex-crash-first-message").length,
		1,
		"cold replay after terminal durability must not start the first native turn twice",
	);
	assert.equal(
		afterState.turnRequestMessageIds.find((request) => request.clientUserMessageId === "codex-crash-followup")?.threadId,
		pending.nativeSessionId,
	);
	const finalReplayRows = store.getDataStore().eventLog.listEvents({
		sessionId: piboSessionId,
		topic: "pibo.output",
		limit: 100,
	}).filter((event) => event.eventId === "codex-crash-first-message");
	assert.equal(finalReplayRows.filter((event) => event.type === "assistant_message").length, 1);
	assert.equal(finalReplayRows.filter((event) => event.type === "message_finished").length, 1);
	await afterRecovery.close();
});

test("Codex native pending recovery proves exact SQLite message and prompt identity", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-exact-pending";
	const { registry } = createAdapter(root, instanceId);
	const store = new PiboDataSessionStore(join(root, "pibo.sqlite"));
	registerTestDisposer(t, () => store.close());
	const config = runtimeConfig(root);
	const terminalTurn = ({ id, messageId, text, assistantText, extraUserItems = [] }) => ({
		id: `turn-${id}`,
		status: "completed",
		startedAt: 1_780_000_100,
		completedAt: 1_780_000_101,
		items: [
			{
				id: `user-${id}`,
				type: "userMessage",
				...(messageId === null ? {} : { clientId: messageId }),
				content: [{ type: "text", text }],
			},
			...extraUserItems,
			...(assistantText ? [{ id: `agent-${id}`, type: "agentMessage", text: assistantText }] : []),
		],
	});
	const createPendingCase = async ({
		id,
		pending = {},
		turns,
		seed = true,
		metadataVersion = 3,
		includeMarker = metadataVersion !== 1,
		claimedPrompt = `prompt-${id}`,
	}) => {
		const piboSessionId = `ps_codex_exact_${id}`;
		const threadId = `thread-exact-${id}`;
		if (seed) {
			await seedThread(config, {
				runtimeInstanceId: instanceId,
				threadId,
				workspace: root,
				cwd: root,
				preview: id,
				turns,
			});
		}
		store.create({
			id: piboSessionId,
			channel: "test",
			kind: "branch",
			profile: profile(instanceId).profileName,
			workspace: root,
			runtimeBinding: {
				runtimeInstanceId: instanceId,
				adapterId: CODEX_NATIVE_ADAPTER_ID,
				nativeSessionId: threadId,
				state: "unbound",
				protocol: "codex-app-server-v2",
				protocolVersion: "0.153.2",
				metadata: {
					...(includeMarker ? { piboPendingNativeSession: true } : {}),
					codexNativeFirstUse: pendingFirstUseMetadata({
						version: metadataVersion,
						threadId,
						messageId: `message-${id}`,
						promptHash: metadataVersion < 3
							? hashLegacyByteExactPrompt(claimedPrompt)
							: hashCanonicalCodexNativeFirstUsePrompt(claimedPrompt),
						...pending,
					}),
				},
			},
		});
		const binding = store.getRuntimeBinding(piboSessionId);
		const input = openInput(instanceId, root, binding, piboSessionId, {}, "branch");
		input.piboSession = store.get(piboSessionId);
		input.services.runtimeBindingPersistence = storeBindingPersistence(store, piboSessionId);
		return { binding, input, piboSessionId, threadId };
	};

	for (const fallback of [false, true]) {
		const id = fallback ? "exact_hash_fallback" : "exact_client_id";
		const exact = await createPendingCase({
			id,
			turns: [terminalTurn({ id, messageId: fallback ? null : `message-${id}`, text: `prompt-${id}` })],
		});
		const session = await registry.openSession(instanceId, exact.input);
		assert.equal(session.getBinding().state, "bound");
		assert.equal(session.getBinding().nativeSessionId, exact.threadId);
		assert.equal(store.getRuntimeBinding(exact.piboSessionId).state, "unbound");
		await session.dispose();
	}

	for (const metadataVersion of [1, 2]) {
		const id = `exact_legacy_v${metadataVersion}`;
		const exactParent = await createPendingCase({
			id,
			metadataVersion,
			includeMarker: metadataVersion !== 1,
			turns: [terminalTurn({
				id,
				messageId: `message-${id}`,
				text: `prompt-${id}`,
				assistantText: `legacy answer ${metadataVersion}`,
			})],
		});
		const session = await registry.openSession(instanceId, exactParent.input);
		assert.equal(session.getBinding().state, "bound");
		assert.equal(session.getBinding().nativeSessionId, exactParent.threadId);
		assert.equal(store.getRuntimeBinding(exactParent.piboSessionId).metadata.codexNativeFirstUse.version, metadataVersion);
		const migrated = store.updateRuntimeBinding(
			exactParent.piboSessionId,
			session.getBinding(),
			{ expectedRevision: 1 },
		);
		assert.equal(migrated.state, "bound");
		assert.equal(migrated.nativeSessionId, exactParent.threadId);
		assert.deepEqual(migrated.metadata.codexNativeFirstUse, {
			version: metadataVersion,
			state: "delivered",
			messageId: `message-${id}`,
			promptHash: hashLegacyByteExactPrompt(`prompt-${id}`),
		});
		assert.equal(migrated.metadata.piboPendingNativeSession, undefined);
		await session.dispose();
		const replayInput = openInput(instanceId, root, migrated, exactParent.piboSessionId, {}, "branch");
		replayInput.productContext = {
			piboSessionId: exactParent.piboSessionId,
			getActiveMessage: () => ({ id: `message-${id}`, source: "user" }),
		};
		const replaySession = await registry.openSession(instanceId, replayInput);
		const replayEvents = [];
		replaySession.subscribe((event) => replayEvents.push(event));
		await replaySession.prompt({ text: `prompt-${id}`, source: "rpc" });
		assert.deepEqual(
			replayEvents.filter((event) => event.type === "assistant_message").map((event) => event.text),
			[`legacy answer ${metadataVersion}`],
		);
		assert.deepEqual(replaySession.getBinding().metadata.codexNativeFirstUse, migrated.metadata.codexNativeFirstUse);
		await replaySession.dispose();
	}

	const invalidReceiptThreadId = "thread-invalid-delivery-receipt";
	await seedThread(config, {
		runtimeInstanceId: instanceId,
		threadId: invalidReceiptThreadId,
		workspace: root,
		cwd: root,
		turns: [terminalTurn({
			id: "invalid-delivery-receipt",
			messageId: "message-invalid-delivery-receipt",
			text: "prompt-invalid-delivery-receipt",
			assistantText: "receipt answer",
		})],
	});
	for (const [id, receipt, extraMetadata = {}] of [
		["malformed", null],
		["extra", deliveredFirstUseReceipt({
			messageId: "message-invalid-delivery-receipt",
			promptHash: hashCanonicalCodexNativeFirstUsePrompt("prompt-invalid-delivery-receipt"),
			unexpected: true,
		})],
		["oversized", deliveredFirstUseReceipt({ messageId: "m".repeat(513) })],
		["pending-marker", deliveredFirstUseReceipt({
			messageId: "message-invalid-delivery-receipt",
			promptHash: hashCanonicalCodexNativeFirstUsePrompt("prompt-invalid-delivery-receipt"),
		}), { piboPendingNativeSession: true }],
		["contradictory", deliveredFirstUseReceipt({
			messageId: "message-invalid-delivery-receipt",
			promptHash: hashCanonicalCodexNativeFirstUsePrompt("different prompt"),
		})],
	]) {
		const invalidBinding = {
			...boundBinding(instanceId, `ps_invalid_delivery_receipt_${id}`, invalidReceiptThreadId),
			metadata: { codexNativeFirstUse: receipt, ...extraMetadata },
		};
		await assert.rejects(
			registry.openSession(instanceId, openInput(
				instanceId,
				root,
				invalidBinding,
				invalidBinding.piboSessionId,
				{},
				"branch",
			)),
			/receipt is invalid|does not match the persisted prompt hash/,
		);
	}

	const canonicalClaim = "caf\u00e9\r\ncanonical";
	const canonicalHistory = "cafe\u0301\ncanonical";
	const canonical = await createPendingCase({
		id: "canonical_history",
		claimedPrompt: canonicalClaim,
		turns: [terminalTurn({
			id: "canonical_history",
			messageId: "message-canonical_history",
			text: canonicalHistory,
		})],
	});
	const canonicalSession = await registry.openSession(instanceId, canonical.input);
	assert.equal(canonicalSession.getBinding().state, "bound");
	await canonicalSession.dispose();

	const legacyRetry = await createPendingCase({
		id: "legacy_v1_empty_retry",
		metadataVersion: 1,
		includeMarker: false,
		turns: [],
	});
	legacyRetry.input.productContext = {
		piboSessionId: legacyRetry.piboSessionId,
		getActiveMessage: () => ({ id: "message-legacy_v1_empty_retry", source: "user" }),
	};
	const legacyRetrySession = await registry.openSession(instanceId, legacyRetry.input);
	await legacyRetrySession.prompt({ text: "prompt-legacy_v1_empty_retry", source: "rpc" });
	const migratedPending = store.getRuntimeBinding(legacyRetry.piboSessionId);
	assert.equal(migratedPending.revision, 2);
	assert.equal(migratedPending.metadata.piboPendingNativeSession, true);
	assert.equal(migratedPending.metadata.codexNativeFirstUse.version, 3);
	assert.equal(
		migratedPending.metadata.codexNativeFirstUse.promptHash,
		hashCanonicalCodexNativeFirstUsePrompt("prompt-legacy_v1_empty_retry"),
	);
	assert.equal(legacyRetrySession.getBinding().state, "bound");
	assert.equal(legacyRetrySession.getBinding().nativeSessionId, legacyRetry.threadId);
	await legacyRetrySession.dispose();

	const canonicalRetry = await createPendingCase({
		id: "canonical_empty_retry",
		claimedPrompt: canonicalClaim,
		turns: [],
	});
	canonicalRetry.input.productContext = {
		piboSessionId: canonicalRetry.piboSessionId,
		getActiveMessage: () => ({ id: "message-canonical_empty_retry", source: "user" }),
	};
	const canonicalRetrySession = await registry.openSession(instanceId, canonicalRetry.input);
	await canonicalRetrySession.prompt({ text: canonicalHistory, source: "rpc" });
	assert.equal(canonicalRetrySession.getBinding().state, "bound");
	assert.equal(canonicalRetrySession.getBinding().nativeSessionId, canonicalRetry.threadId);
	await canonicalRetrySession.dispose();

	const mismatchedMessage = await createPendingCase({
		id: "message_mismatch",
		turns: [terminalTurn({ id: "message_mismatch", messageId: "another-message", text: "prompt-message_mismatch" })],
	});
	await assert.rejects(registry.openSession(instanceId, mismatchedMessage.input), /does not match the persisted message id/);

	const mismatchedPrompt = await createPendingCase({
		id: "prompt_mismatch",
		turns: [terminalTurn({ id: "prompt_mismatch", messageId: "message-prompt_mismatch", text: "another prompt" })],
	});
	await assert.rejects(registry.openSession(instanceId, mismatchedPrompt.input), /does not match the persisted prompt hash/);

	const unrelated = await createPendingCase({
		id: "unrelated",
		turns: [terminalTurn({ id: "unrelated", messageId: "unrelated-message", text: "unrelated prompt" })],
	});
	await assert.rejects(registry.openSession(instanceId, unrelated.input), /does not match the persisted (?:message id|prompt hash)/);

	const multiple = await createPendingCase({
		id: "multiple",
		turns: [
			terminalTurn({ id: "multiple-a", messageId: "message-multiple", text: "prompt-multiple" }),
			terminalTurn({ id: "multiple-b", messageId: "message-multiple", text: "prompt-multiple" }),
		],
	});
	await assert.rejects(registry.openSession(instanceId, multiple.input), /missing, multiple, or belongs to another thread/);

	const ambiguous = await createPendingCase({
		id: "ambiguous",
		turns: [terminalTurn({
			id: "ambiguous",
			messageId: "message-ambiguous",
			text: "prompt-ambiguous",
			extraUserItems: [{
				id: "user-ambiguous-extra",
				type: "userMessage",
				clientId: "message-ambiguous",
				content: [{ type: "text", text: "prompt-ambiguous" }],
			}],
		})],
	});
	await assert.rejects(registry.openSession(instanceId, ambiguous.input), /ambiguous user input evidence/);

	for (const [id, pending] of [
		["malformed", { attemptId: "not-a-uuid" }],
		["oversized", { messageId: "m".repeat(513) }],
	]) {
		const invalid = await createPendingCase({ id, pending, turns: [], seed: false });
		assert.throws(() => readCodexNativePendingFirstUse(invalid.binding), /metadata is invalid/);
		await assert.rejects(registry.openSession(instanceId, invalid.input), /metadata is invalid/);
	}
	const corruptLegacy = await createPendingCase({
		id: "corrupt_legacy_v1",
		metadataVersion: 1,
		includeMarker: false,
		pending: { promptHash: "not-a-sha256" },
		turns: [],
		seed: false,
	});
	await assert.rejects(registry.openSession(instanceId, corruptLegacy.input), /metadata is invalid/);

	const currentOwner = beginCodexNativeFirstUseAttempt();
	endCodexNativeFirstUseAttempt(currentOwner.attemptId);
	const ambiguousOwner = await createPendingCase({
		id: "ambiguous_owner",
		pending: {
			...currentOwner,
			ownerProcessInstanceId: "33333333-3333-4333-8333-333333333333",
		},
		turns: [],
		seed: false,
	});
	await assert.rejects(registry.openSession(instanceId, ambiguousOwner.input), /ownership is ambiguous/);
	assert.equal(store.getRuntimeBinding(ambiguousOwner.piboSessionId).nativeSessionId, ambiguousOwner.threadId);
	assert.equal(store.getRuntimeBinding(ambiguousOwner.piboSessionId).state, "unbound");

	for (const [id, activeMessageId, promptText] of [
		["retry_message_mismatch", "different-message", "prompt-retry_message_mismatch"],
		["retry_prompt_mismatch", "message-retry_prompt_mismatch", "different prompt"],
	]) {
		const retry = await createPendingCase({ id, turns: [] });
		retry.input.productContext = {
			piboSessionId: retry.piboSessionId,
			getActiveMessage: () => ({ id: activeMessageId, source: "user" }),
		};
		const session = await registry.openSession(instanceId, retry.input);
		await assert.rejects(session.prompt({ text: promptText, source: "rpc" }), /does not match the persisted message id and prompt/);
		await session.dispose();
	}

	const exactRetry = await createPendingCase({ id: "exact_retry", turns: [] });
	exactRetry.input.productContext = {
		piboSessionId: exactRetry.piboSessionId,
		getActiveMessage: () => ({ id: "message-exact_retry", source: "user" }),
	};
	const retrySession = await registry.openSession(instanceId, exactRetry.input);
	await retrySession.prompt({ text: "prompt-exact_retry", source: "rpc" });
	assert.equal(retrySession.getBinding().state, "bound");
	assert.equal(retrySession.getBinding().nativeSessionId, exactRetry.threadId);
	await retrySession.dispose();
});

test("Codex native reconciles pending first use across pre-turn failures, process exit, failed turns, retries, and deletion", async (t) => {
	const root = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "codex-native-pending-boundaries");
	const store = new PiboDataSessionStore(join(root, "pibo.sqlite"));
	registerTestDisposer(t, () => store.close());
	const createBranch = (id) => store.create({
		id,
		channel: "test",
		kind: "branch",
		profile: profile(instanceId).profileName,
		workspace: root,
		runtimeBinding: {
			runtimeInstanceId: instanceId,
			adapterId: CODEX_NATIVE_ADAPTER_ID,
			state: "unbound",
			protocol: "codex-app-server-v2",
			protocolVersion: "0.153.2",
		},
	});
	const openStored = async (id, messageId, failpoints, persistence = storeBindingPersistence(store, id)) => {
		const binding = store.getRuntimeBinding(id);
		const input = openInput(instanceId, root, binding, id, {}, "branch");
		input.piboSession = store.get(id);
		input.productContext = { piboSessionId: id, getActiveMessage: () => ({ id: messageId, source: "user" }) };
		input.services.runtimeBindingPersistence = persistence;
		if (failpoints) input.services.compatibility = { testOnlyFirstUseFailpoints: failpoints };
		return await registry.openSession(instanceId, input);
	};

	const retryId = "ps_codex_pending_retry";
	createBranch(retryId);
	const closedStore = new PiboDataSessionStore(join(root, "pibo.sqlite"));
	const closedPersistence = storeBindingPersistence(closedStore, retryId);
	closedStore.close();
	const beforePending = await openStored(retryId, "pending-retry-message", undefined, closedPersistence);
	await assert.rejects(
		beforePending.prompt({ text: "idempotent pending retry", source: "rpc" }),
		/database is not open|closed/i,
	);
	assert.equal(store.getRuntimeBinding(retryId).revision, 1);
	assert.equal(store.getRuntimeBinding(retryId).nativeSessionId, undefined);
	await beforePending.dispose();

	const afterPending = await openStored(retryId, "pending-retry-message", {
		afterPendingBindingPersisted: () => { throw new Error("fixture failure after pending persistence"); },
	});
	await assert.rejects(
		afterPending.prompt({ text: "idempotent pending retry", source: "rpc" }),
		/fixture failure after pending persistence/,
	);
	const pending = store.getRuntimeBinding(retryId);
	assert.equal(pending.revision, 2);
	assert.equal(pending.state, "unbound");
	assert.match(pending.nativeSessionId, /^thread-/);
	await afterPending.dispose();

	const missingPending = await openStored(retryId, "pending-retry-message");
	const cleared = missingPending.getBinding();
	assert.equal(cleared.state, "unbound");
	assert.equal(cleared.nativeSessionId, undefined);
	assert.equal(cleared.metadata.codexNativeFirstUse, undefined);
	const persistedClear = store.updateRuntimeBinding(retryId, cleared, { expectedRevision: 2 });
	assert.equal(persistedClear.revision, 3);
	await missingPending.dispose();
	const retry = await openStored(retryId, "pending-retry-message");
	await retry.prompt({ text: "idempotent pending retry", source: "rpc" });
	const retryPending = store.getRuntimeBinding(retryId);
	assert.equal(retryPending.revision, 4);
	assert.equal(retryPending.nativeSessionId, retry.getBinding().nativeSessionId);
	const retryBound = store.updateRuntimeBinding(retryId, retry.getBinding(), { expectedRevision: 4 });
	assert.equal(retryBound.revision, 5);
	await retry.dispose();

	const processExitId = "ps_codex_pending_process_exit";
	createBranch(processExitId);
	const exited = await openStored(processExitId, "pending-process-exit-message");
	await assert.rejects(
		exited.prompt({ text: "crash-once exact first request", source: "rpc" }),
		/process exited|exited unexpectedly/i,
	);
	const exitedPending = store.getRuntimeBinding(processExitId);
	assert.equal(exitedPending.revision, 2);
	assert.equal(exitedPending.state, "unbound");
	await exited.dispose();
	const exitedRecovery = await openStored(processExitId, "pending-process-exit-message");
	const exitedClear = exitedRecovery.getBinding();
	assert.equal(exitedClear.nativeSessionId, undefined);
	store.updateRuntimeBinding(processExitId, exitedClear, { expectedRevision: 2 });
	await exitedRecovery.dispose();
	const exitedRetry = await openStored(processExitId, "pending-process-exit-message");
	await exitedRetry.prompt({ text: "crash-once exact first request", source: "rpc" });
	const exitedRetryPending = store.getRuntimeBinding(processExitId);
	store.updateRuntimeBinding(processExitId, exitedRetry.getBinding(), { expectedRevision: exitedRetryPending.revision });
	await exitedRetry.dispose();

	const failedId = "ps_codex_pending_failed_turn";
	createBranch(failedId);
	const failed = await openStored(failedId, "pending-failed-message");
	await failed.prompt({ text: "terminal failure", source: "rpc" });
	const failedPending = store.getRuntimeBinding(failedId);
	assert.equal(failedPending.state, "unbound");
	const failedBound = store.updateRuntimeBinding(failedId, failed.getBinding(), { expectedRevision: failedPending.revision });
	assert.equal(failedBound.state, "bound");
	await failed.dispose();

	const liveOwnerId = "ps_codex_pending_live_owner";
	createBranch(liveOwnerId);
	let releaseLiveOwner;
	let markLiveOwnerReached;
	const liveOwnerReached = new Promise((resolve) => { markLiveOwnerReached = resolve; });
	const liveOwnerRelease = new Promise((resolve) => { releaseLiveOwner = resolve; });
	const liveOwner = await openStored(liveOwnerId, "pending-live-owner-message", {
		afterPendingBindingPersisted: async () => {
			markLiveOwnerReached();
			await liveOwnerRelease;
		},
	});
	const liveOwnerPrompt = liveOwner.prompt({ text: "live owner first request", source: "rpc" });
	await liveOwnerReached;
	const livePending = store.getRuntimeBinding(liveOwnerId);
	assert.equal(livePending.revision, 2);
	await assert.rejects(
		openStored(liveOwnerId, "competing-live-owner-message"),
		/owned by another live router/,
	);
	assert.equal(store.getRuntimeBinding(liveOwnerId).revision, 2);
	assert.equal(store.getRuntimeBinding(liveOwnerId).nativeSessionId, livePending.nativeSessionId);
	releaseLiveOwner();
	await liveOwnerPrompt;
	store.updateRuntimeBinding(liveOwnerId, liveOwner.getBinding(), { expectedRevision: 2 });
	await liveOwner.dispose();

	const deletedId = "ps_codex_pending_deleted";
	createBranch(deletedId);
	const deleted = await openStored(deletedId, "pending-delete-message", {
		afterPendingBindingPersisted: () => { throw new Error("delete pending fixture"); },
	});
	await assert.rejects(deleted.prompt({ text: "pending deletion", source: "rpc" }), /delete pending fixture/);
	const deletedPending = store.getRuntimeBinding(deletedId);
	await deleted.dispose();
	assert.equal(store.delete(deletedId), true);
	store.create({
		id: "ps_codex_pending_deleted_replacement",
		channel: "test",
		kind: "branch",
		profile: profile(instanceId).profileName,
		workspace: root,
		runtimeBinding: {
			...deletedPending,
			piboSessionId: undefined,
			revision: undefined,
			createdAt: undefined,
			updatedAt: undefined,
		},
	});
	assert.equal(store.delete("ps_codex_pending_deleted_replacement"), true);

	const inspection = await startCodexNativeAppServer({
		config: runtimeConfig(root),
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_pending_boundary_inspection",
		sessionGeneration: "pending-boundary-inspection",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => inspection.close());
	const state = await inspection.client.request("test/getState", {});
	assert.equal(
		state.turnRequestMessageIds.filter((request) => request.clientUserMessageId === "pending-retry-message").length,
		1,
	);
	assert.equal(
		state.turnRequestMessageIds.filter((request) => request.clientUserMessageId === "pending-process-exit-message").length,
		2,
	);
	const failedThreadId = failedBound.nativeSessionId;
	assert.equal(state.threads[failedThreadId].turns.at(-1).status, "failed");
	await inspection.close();
});

test("Codex native router resumes a durable binding after restart and marks deletion missing", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-router";
	const profileName = "codex-native-router-profile";
	const piboSessionId = "ps_codex_router";
	const stalePiboSessionId = "ps_codex_router_stale_rollout";
	const config = runtimeConfig(root);
	await seedThread(config, {
		runtimeInstanceId: instanceId,
		threadId: "thread-router",
		workspace: root,
		cwd: root,
		preview: "router durable thread",
		turns: seededTurns(),
	});
	await seedThread(config, {
		runtimeInstanceId: instanceId,
		threadId: "thread-stale-rollout",
		workspace: root,
		cwd: root,
		preview: "stale rollout index",
		turns: seededTurns(),
	});
	const pluginRegistry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.codex-native-router",
			register(api) {
				api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
				api.registerAgentRuntimeInstance({
					id: instanceId,
					adapterId: CODEX_NATIVE_ADAPTER_ID,
					config,
				});
				api.registerProfile({
					name: profileName,
					create() {
						return new InitialSessionContextBuilder(profileName)
							.withAgentRuntime(instanceId)
							.withBuiltinTools("disabled")
							.withAutoContextFiles(false)
							.withToolPackages({ goalControl: false })
							.createSession();
					},
				});
			},
		})],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: piboSessionId,
		channel: "test",
		kind: "chat",
		profile: profileName,
		workspace: root,
		runtimeBinding: boundBinding(instanceId, piboSessionId, "thread-router"),
	});
	store.create({
		id: stalePiboSessionId,
		channel: "test",
		kind: "chat",
		profile: profileName,
		workspace: root,
		runtimeBinding: boundBinding(instanceId, stalePiboSessionId, "thread-stale-rollout"),
	});
	const resources = new PiboRuntimeResourceService({ rootDir: join(root, "resources") });
	const firstRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	const firstStatus = await firstRouter.emit({ type: "execution", piboSessionId, action: "status" });
	assert.equal(firstStatus.type, "execution_result");
	const firstBinding = store.getRuntimeBinding(piboSessionId);
	assert.equal(firstBinding.state, "bound");
	assert.equal(firstBinding.nativeSessionId, "thread-router");
	await firstRouter.disposeAll();

	const secondRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	const resumedStatus = await secondRouter.emit({ type: "execution", piboSessionId, action: "status" });
	assert.equal(resumedStatus.type, "execution_result");
	const resumedBinding = store.getRuntimeBinding(piboSessionId);
	assert.equal(resumedBinding.nativeSessionId, firstBinding.nativeSessionId);
	assert.equal(resumedBinding.state, "bound");
	await secondRouter.disposeAll();

	const maintenance = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_router_maintenance",
		sessionGeneration: "delete-thread",
		workspace: root,
		clientVersion: "thread-test",
	});
	await maintenance.client.request("test/deleteThread", { threadId: firstBinding.nativeSessionId });
	await maintenance.client.request("test/markThreadRolloutMissing", { threadId: "thread-stale-rollout" });
	await maintenance.close();

	const thirdRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	await assert.rejects(
		thirdRouter.emit({ type: "execution", piboSessionId, action: "status" }),
		(error) => error instanceof AgentRuntimeBindingMissingError,
	);
	const missing = store.getRuntimeBinding(piboSessionId);
	assert.equal(missing.state, "missing");
	assert.equal(missing.nativeSessionId, firstBinding.nativeSessionId);
	assert.equal(missing.metadata.diagnosticCode, "codex_native_thread_missing");
	await assert.rejects(
		thirdRouter.emit({ type: "execution", piboSessionId: stalePiboSessionId, action: "status" }),
		(error) => {
			assert.equal(error instanceof AgentRuntimeBindingMissingError, true);
			assert.doesNotMatch(error.message, /private\/fake-codex|thread-stale-rollout\.jsonl/);
			return true;
		},
	);
	const staleMissing = store.getRuntimeBinding(stalePiboSessionId);
	assert.equal(staleMissing.state, "missing");
	assert.equal(staleMissing.nativeSessionId, "thread-stale-rollout");
	assert.equal(staleMissing.metadata.diagnosticCode, "runtime_binding_missing");
	assert.doesNotMatch(JSON.stringify(staleMissing), /private\/fake-codex|thread-stale-rollout\.jsonl/);
	await thirdRouter.disposeAll();

	const inspection = await startCodexNativeAppServer({
		config,
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_router_inspection",
		sessionGeneration: "inspect-state",
		workspace: root,
		clientVersion: "thread-test",
	});
	const state = await inspection.client.request("test/getState", {});
	assert.deepEqual(Object.keys(state.threads), ["thread-stale-rollout"]);
	assert.deepEqual(state.missingRollouts, ["thread-stale-rollout"]);
	await inspection.client.request("test/deleteThread", { threadId: "thread-stale-rollout" });
	await inspection.close();
});

test("Codex native identical first-use contenders select one winner through PiboData and SQLite CAS", async (t) => {
	const root = await testRoot(t);
	const { registry, instanceId } = createAdapter(root);
	for (const [name, Store] of [
		["pibo-data", PiboDataSessionStore],
		["sqlite", SqlitePiboSessionStore],
	]) {
		const dbPath = join(root, `${name}-cas.sqlite`);
		const firstStore = new Store(dbPath);
		const secondStore = new Store(dbPath);
		registerTestDisposer(t, () => {
			firstStore.close();
			secondStore.close();
		});
		const suffix = name.replaceAll("-", "_");
		const piboSessionId = `ps_codex_cas_${suffix}`;
		const messageId = `codex-identical-cas-${name}`;
		firstStore.create({
			id: piboSessionId,
			channel: "test",
			kind: "branch",
			profile: profile(instanceId).profileName,
			workspace: root,
			runtimeBinding: {
				runtimeInstanceId: instanceId,
				adapterId: CODEX_NATIVE_ADAPTER_ID,
				state: "unbound",
			},
		});
		const firstInitial = firstStore.getRuntimeBinding(piboSessionId);
		const secondInitial = secondStore.getRuntimeBinding(piboSessionId);
		assert.equal(firstInitial.revision, 1, `${name} first contender must start at revision 1`);
		assert.equal(secondInitial.revision, 1, `${name} second contender must start at revision 1`);
		const firstInput = openInput(instanceId, root, firstInitial, piboSessionId, {}, "branch");
		const secondInput = openInput(instanceId, root, secondInitial, piboSessionId, {}, "branch");
		firstInput.productContext.getActiveMessage = () => ({ id: messageId, source: "user" });
		secondInput.productContext.getActiveMessage = () => ({ id: messageId, source: "user" });
		firstInput.services.runtimeBindingPersistence = storeBindingPersistence(firstStore, piboSessionId);
		secondInput.services.runtimeBindingPersistence = storeBindingPersistence(secondStore, piboSessionId);
		const first = await registry.openSession(instanceId, firstInput);
		const second = await registry.openSession(instanceId, secondInput);
		registerTestDisposer(t, () => Promise.allSettled([first.dispose(), second.dispose()]));
		assert.equal(first.getBinding().state, "unbound");
		assert.equal(second.getBinding().state, "unbound");
		assert.notEqual(first.controls.getCurrentSession().nativeSessionId, second.controls.getCurrentSession().nativeSessionId);
		const results = await Promise.allSettled([
			first.prompt({ text: "identical legitimate first request", source: "rpc" }),
			second.prompt({ text: "identical legitimate first request", source: "rpc" }),
		]);
		assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, `${name} must select one winner`);
		assert.equal(results.filter((result) => result.status === "rejected").length, 1, `${name} must reject one loser`);
		assert.match(results.find((result) => result.status === "rejected")?.reason?.message ?? "", /changed concurrently/);
		const winner = results[0].status === "fulfilled" ? first : second;
		const loser = winner === first ? second : first;
		assert.equal(winner.getBinding().state, "bound");
		assert.equal(loser.getBinding().state, "unbound");
		const pending = firstStore.getRuntimeBinding(piboSessionId);
		assert.equal(pending.revision, 2);
		assert.equal(pending.state, "unbound");
		assert.equal(pending.nativeSessionId, winner.getBinding().nativeSessionId);
		const persisted = firstStore.updateRuntimeBinding(piboSessionId, winner.getBinding(), { expectedRevision: 2 });
		assert.equal(persisted.revision, 3);
		assert.equal(persisted.nativeSessionId, winner.getBinding().nativeSessionId);
		await Promise.allSettled([first.dispose(), second.dispose()]);
	}
	const inspection = await startCodexNativeAppServer({
		config: runtimeConfig(root),
		runtimeInstanceId: instanceId,
		piboSessionId: "ps_codex_cas_inspection",
		sessionGeneration: "cas-inspection",
		workspace: root,
		clientVersion: "thread-test",
	});
	registerTestDisposer(t, () => inspection.close());
	const state = await inspection.client.request("test/getState", {});
	for (const name of ["pibo-data", "sqlite"]) {
		assert.equal(
			state.turnRequestMessageIds.filter((request) => request.clientUserMessageId === `codex-identical-cas-${name}`).length,
			1,
			`${name} must execute exactly one native first turn`,
		);
	}
	await inspection.close();
});
