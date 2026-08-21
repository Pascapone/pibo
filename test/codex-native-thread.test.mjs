import assert from "node:assert/strict";
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

async function testRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-native-thread-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await chmod(fixturePath, 0o755);
	return root;
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

function profile(instanceId) {
	return new InitialSessionContextBuilder(`profile-${instanceId}`)
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
}

function openInput(instanceId, workspace, binding, piboSessionId = binding.piboSessionId) {
	const selectedProfile = profile(instanceId);
	const piboSession = createPiboSession({
		id: piboSessionId,
		channel: "test",
		kind: "chat",
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
	t.after(() => session.dispose());
	const listed = await session.controls.listSessions();
	assert.ok(listed.some((thread) => thread.nativeSessionId === "thread-source"));
	assert.ok(listed.some((thread) => thread.nativeSessionId === "thread-other"));
	assert.ok(listed.every((thread) => thread.locator?.value === undefined));
	const candidates = session.controls.getForkCandidates();
	assert.deepEqual(candidates.map((candidate) => candidate.entryId), ["turn-a", "turn-b", "turn-c"]);
	assert.doesNotMatch(JSON.stringify(candidates), /fixture-agent-secret/);

	const result = await session.controls.forkSession("turn-b");
	assert.equal(result.previous.nativeSessionId, "thread-source");
	assert.notEqual(result.current.nativeSessionId, "thread-source");
	assert.equal(result.current.leafId, "turn-b");
	assert.equal(result.summaryEntryId, "turn-b");
	const forkBinding = session.getBinding();
	assert.equal(forkBinding.nativeSessionId, result.current.nativeSessionId);
	assert.equal(forkBinding.state, "bound");
	const cloned = await session.controls.cloneSession();
	assert.equal(cloned.previous.nativeSessionId, forkBinding.nativeSessionId);
	assert.notEqual(cloned.current.nativeSessionId, forkBinding.nativeSessionId);
	assert.equal(cloned.current.leafId, "turn-b");
	const cloneBinding = session.getBinding();
	assert.equal(cloneBinding.nativeSessionId, cloned.current.nativeSessionId);
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

test("Codex native unbound thread creation participates in revisioned binding CAS", async (t) => {
	const root = await testRoot(t);
	const { registry, instanceId } = createAdapter(root);
	const store = new InMemoryPiboSessionStore();
	const piboSessionId = "ps_codex_cas";
	store.create({
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
	const initial = store.getRuntimeBinding(piboSessionId);
	assert.equal(initial.revision, 1);
	const first = await registry.openSession(instanceId, openInput(instanceId, root, initial));
	const second = await registry.openSession(instanceId, openInput(instanceId, root, initial));
	t.after(() => Promise.allSettled([first.dispose(), second.dispose()]));
	assert.notEqual(first.getBinding().nativeSessionId, second.getBinding().nativeSessionId);
	const persisted = store.updateRuntimeBinding(piboSessionId, first.getBinding(), { expectedRevision: 1 });
	assert.equal(persisted.revision, 2);
	assert.equal(persisted.nativeSessionId, first.getBinding().nativeSessionId);
	assert.throws(
		() => store.updateRuntimeBinding(piboSessionId, second.getBinding(), { expectedRevision: 1 }),
		/changed concurrently/,
	);
	assert.equal(store.getRuntimeBinding(piboSessionId).nativeSessionId, first.getBinding().nativeSessionId);
});
