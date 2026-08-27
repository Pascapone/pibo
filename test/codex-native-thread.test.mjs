import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import {
	AgentRuntimeBindingMissingError,
	AgentRuntimeUnavailableError,
} from "../dist/agent-runtime/errors.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore, createPiboSession } from "../dist/sessions/store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
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

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));
const crashChildFixturePath = fileURLToPath(new URL("./fixtures/codex-first-use-crash-child.mjs", import.meta.url));
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

async function waitFor(predicate, timeoutMs = 5_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for Codex native test state");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function runCrashChild(args) {
	const child = spawn(process.execPath, [crashChildFixturePath, ...args], {
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

function testBindingPersistence(initialBinding) {
	let current = { ...structuredClone(initialBinding), revision: initialBinding.revision ?? 1 };
	return {
		async compareAndSet(nextBinding, expectedRevision) {
			assert.equal(current.revision, expectedRevision);
			current = {
				...structuredClone(nextBinding),
				revision: expectedRevision + 1,
				createdAt: current.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			return structuredClone(current);
		},
	};
}

function storeBindingPersistence(store, piboSessionId) {
	return {
		async compareAndSet(nextBinding, expectedRevision) {
			const updated = store.updateRuntimeBinding(piboSessionId, nextBinding, { expectedRevision });
			if (!updated) throw new Error(`Pibo Session ${piboSessionId} disappeared during binding CAS`);
			return updated;
		},
	};
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
		services: { runtimeBindingPersistence: testBindingPersistence(binding) },
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
		protocolVersion: "0.147.0",
		revision: 1,
	};
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
	assert.equal(firstBinding.protocolVersion, "0.147.0");
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
	assert.equal(lifecycleState.resourceRequests.filter((request) => request.method === "thread/fork").length, 2);
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
	const store = new InMemoryPiboSessionStore();
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
	assert.equal(branch.runtimeBinding.protocolVersion, "0.147.0");
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
	const reopened = await reopenedRouter.emit({
		type: "execution",
		piboSessionId: branchPiboSessionId,
		action: "status",
	});
	assert.equal(reopened.type, "execution_result");
	assert.equal(store.getRuntimeBinding(branchPiboSessionId).nativeSessionId, durableBranchBinding.nativeSessionId);
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
		raceState.turnRequestMessageIds.find((request) => request.clientUserMessageId === "codex-concurrent-winner-followup")?.threadId,
		raceBinding.nativeSessionId,
	);
	await raceInspection.close();
	await Promise.all([raceRouterA.disposeAll(), raceRouterB.disposeAll()]);
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
			protocolVersion: "0.147.0",
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
	const status = await router.emit({ type: "execution", piboSessionId, action: "status" });
	assert.equal(status.type, "execution_result");
	const recovered = store.getRuntimeBinding(piboSessionId);
	assert.equal(recovered.revision, 3);
	assert.equal(recovered.state, "bound");
	assert.equal(recovered.nativeSessionId, pending.nativeSessionId);
	assert.equal(recovered.metadata.codexNativeFirstUse, undefined);

	const followup = await router.emitMessageAndWaitForReply({
		type: "message",
		piboSessionId,
		id: "codex-crash-followup",
		text: "continue the recovered native thread",
		source: "user",
	}, 5_000);
	assert.equal(followup.text, "Codex answer.");
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
		afterState.turnRequestMessageIds.find((request) => request.clientUserMessageId === "codex-crash-followup")?.threadId,
		pending.nativeSessionId,
	);
	await afterRecovery.close();
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
			protocolVersion: "0.147.0",
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
	const beforePending = await openStored(retryId, "pending-retry-message", undefined, {
		async compareAndSet() { throw new Error("fixture failure before pending persistence"); },
	});
	await assert.rejects(
		beforePending.prompt({ text: "idempotent pending retry", source: "rpc" }),
		/fixture failure before pending persistence/,
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

test("Codex native concurrent first use promotes one branch binding through revisioned CAS", async (t) => {
	const root = await testRoot(t);
	const { registry, instanceId } = createAdapter(root);
	const dbPath = join(root, "pibo.sqlite");
	const firstStore = new PiboDataSessionStore(dbPath);
	const secondStore = new PiboDataSessionStore(dbPath);
	registerTestDisposer(t, () => {
		firstStore.close();
		secondStore.close();
	});
	const piboSessionId = "ps_codex_cas";
	firstStore.create({
		id: piboSessionId,
		channel: "test",
		kind: "chat",
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
	assert.equal(firstInitial.revision, 1);
	assert.equal(secondInitial.revision, 1);
	const persistenceFor = (store) => ({
		async compareAndSet(nextBinding, expectedRevision) {
			const updated = store.updateRuntimeBinding(piboSessionId, nextBinding, { expectedRevision });
			if (!updated) throw new Error("CAS fixture session disappeared");
			return updated;
		},
	});
	const firstInput = openInput(instanceId, root, firstInitial, piboSessionId, {}, "branch");
	const secondInput = openInput(instanceId, root, secondInitial, piboSessionId, {}, "branch");
	firstInput.services.runtimeBindingPersistence = persistenceFor(firstStore);
	secondInput.services.runtimeBindingPersistence = persistenceFor(secondStore);
	const first = await registry.openSession(instanceId, firstInput);
	const second = await registry.openSession(instanceId, secondInput);
	registerTestDisposer(t, () => Promise.allSettled([first.dispose(), second.dispose()]));
	assert.equal(first.getBinding().state, "unbound");
	assert.equal(second.getBinding().state, "unbound");
	assert.notEqual(first.controls.getCurrentSession().nativeSessionId, second.controls.getCurrentSession().nativeSessionId);
	const results = await Promise.allSettled([
		first.prompt({ text: "concurrent first use a", source: "rpc" }),
		second.prompt({ text: "concurrent first use b", source: "rpc" }),
	]);
	assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
	assert.equal(results.filter((result) => result.status === "rejected").length, 1);
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
	assert.equal(state.turnRequests.length, 1);
	await inspection.close();
});
