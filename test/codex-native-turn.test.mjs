import assert from "node:assert/strict";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AgentRuntimeAdapterRegistry } from "../dist/agent-runtime/registry.js";
import { exerciseAgentRuntimeAdapterContract } from "../dist/agent-runtime/testing/contract.js";
import { PiboRuntimeResourceService } from "../dist/agent-runtime/resource-service.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore, createPiboSession } from "../dist/sessions/store.js";
import {
	CODEX_NATIVE_ADAPTER_ID,
	CODEX_NATIVE_AGENT_RUNTIME_DRIVER,
	getCodexNativeClient,
} from "../dist/agent-runtimes/codex-native/adapter.js";
import { parseCodexNativeRuntimeConfig } from "../dist/agent-runtimes/codex-native/config.js";

const fixturePath = fileURLToPath(new URL("./fixtures/codex-app-server-thread-fake.mjs", import.meta.url));

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for Codex native turn output");
		await delay(5);
	}
}

async function testRoot(t) {
	const root = await mkdtemp(join(tmpdir(), "pibo-codex-native-turn-"));
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

function profile(instanceId, profileName = `profile-${instanceId}`) {
	return new InitialSessionContextBuilder(profileName)
		.withAgentRuntime(instanceId)
		.withBuiltinTools("disabled")
		.withAutoContextFiles(false)
		.withToolPackages({ goalControl: false })
		.createSession();
}

function unboundBinding(instanceId, piboSessionId) {
	return {
		piboSessionId,
		runtimeInstanceId: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		state: "unbound",
		revision: 1,
	};
}

function openInput(instanceId, workspace, binding, activeMessageId = "pibo-message-1", historyHandoff) {
	const selectedProfile = profile(instanceId);
	const piboSession = createPiboSession({
		id: binding.piboSessionId,
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
		...(historyHandoff ? { historyHandoff } : {}),
		productContext: {
			piboSessionId: piboSession.id,
			getActiveMessage: () => ({ id: activeMessageId, source: "user" }),
		},
	};
}

function createAdapter(root, instanceId = "codex-native-turn-test") {
	const registry = new AgentRuntimeAdapterRegistry();
	registry.registerDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
	const adapter = registry.registerInstance({
		id: instanceId,
		adapterId: CODEX_NATIVE_ADAPTER_ID,
		displayName: "Codex Native Turn Test",
		config: runtimeConfig(root),
	});
	return { registry, adapter, instanceId };
}

async function openFreshSession(t, root, suffix) {
	const fixture = createAdapter(root, `codex-native-${suffix}`);
	const binding = unboundBinding(fixture.instanceId, `ps_${suffix}`);
	const session = await fixture.registry.openSession(fixture.instanceId, openInput(fixture.instanceId, root, binding));
	t.after(() => session.dispose());
	return { ...fixture, binding, session };
}

test("Codex native turn sessions pass the reusable runtime-adapter contract", async (t) => {
	const root = await testRoot(t);
	const { adapter, instanceId } = createAdapter(root, "codex-native-contract");
	const binding = unboundBinding(instanceId, "ps_codex_contract");
	const result = await exerciseAgentRuntimeAdapterContract(
		adapter,
		openInput(instanceId, root, binding, "contract-message"),
		"contract prompt",
	);
	assert.equal(result.events.filter((event) => event.type === "turn_started").length, 1);
	assert.equal(result.events.filter((event) => event.type === "turn_completed").length, 1);
	assert.equal(result.events.some((event) => event.type === "assistant_delta"), true);
	assert.equal(result.events.some((event) => event.type === "assistant_message"), true);
	assert.equal(result.events.some((event) => event.type === "reasoning_delta"), true);
	assert.equal(result.events.some((event) => event.type === "usage"), true);
});

test("Codex native normalizes assistant, reasoning, usage, terminal ordering, and durable restart resume", async (t) => {
	const root = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "codex-native-streaming");
	const binding = unboundBinding(instanceId, "ps_codex_streaming");
	const first = await registry.openSession(instanceId, openInput(instanceId, root, binding, "message-streaming-1"));
	const events = [];
	first.subscribe((event) => events.push(event));
	await first.prompt({ text: "[early] normal", source: "rpc" });

	assert.equal(first.getStatus().streaming, false);
	assert.equal(events.filter((event) => event.type === "turn_started").length, 1);
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 1);
	assert.equal(events.filter((event) => event.type === "turn_failed").length, 0);
	assert.equal(events.filter((event) => event.type === "assistant_delta").map((event) => event.text).join(""), "Codex answer.");
	assert.deepEqual(
		events.filter((event) => event.type === "assistant_message").map((event) => event.text),
		["Codex answer."],
	);
	assert.equal(events.filter((event) => event.type === "reasoning_delta").map((event) => event.text).join(""), "Checking the request.");
	assert.deepEqual(
		events.filter((event) => event.type === "reasoning_finished").map((event) => event.text),
		["Checking the request."],
	);
	assert.deepEqual(events.filter((event) => event.type === "usage").map((event) => event.usage), [{
		inputTokens: 11,
		outputTokens: 7,
		cacheReadTokens: 3,
		cacheWriteTokens: 2,
		reasoningTokens: 2,
		totalTokens: 20,
		contextWindow: 200_000,
	}]);
	const terminalIndex = events.findIndex((event) => event.type === "turn_completed");
	assert.ok(terminalIndex > events.findIndex((event) => event.type === "assistant_message"));
	assert.ok(terminalIndex > events.findIndex((event) => event.type === "usage"));

	const firstBinding = first.getBinding();
	assert.equal(firstBinding.state, "bound");
	assert.equal(firstBinding.metadata.threadStatus, "idle");
	const firstClient = getCodexNativeClient(first);
	const state = await firstClient.request("test/getState", {});
	assert.deepEqual(Object.keys(state.activeTurns), []);
	assert.equal(state.threads[firstBinding.nativeSessionId].turns.length, 1);
	assert.equal(state.threads[firstBinding.nativeSessionId].turns[0].items.at(-1).text, "Codex answer.");
	await first.dispose();

	const resumed = await registry.openSession(instanceId, openInput(instanceId, root, firstBinding, "message-streaming-2"));
	assert.equal(resumed.getBinding().nativeSessionId, firstBinding.nativeSessionId);
	await resumed.prompt({ text: "second prompt", source: "rpc" });
	const resumedState = await getCodexNativeClient(resumed).request("test/getState", {});
	assert.equal(resumedState.threads[firstBinding.nativeSessionId].turns.length, 2);
	assert.equal(resumed.controls.getForkCandidates().length, 2);
	await resumed.dispose();
});

test("Codex native imports portable history with thread/inject_items before the first prompt", async (t) => {
	const root = await testRoot(t);
	const { registry, instanceId } = createAdapter(root, "codex-native-history-import");
	const binding = unboundBinding(instanceId, "ps_codex_history_import");
	const historyHandoff = {
		mode: "import",
		history: {
			version: 1,
			piboSessionId: binding.piboSessionId,
			sourceRuntimeInstanceId: "pi",
			sourceAdapterId: "pi",
			checkpoint: { maxSessionSequence: 4, createdAt: "2026-08-20T00:00:00.000Z" },
			entries: [
				{ id: "u1", type: "message", source: "product", createdAt: "2026-08-20T00:00:00.000Z", role: "user", content: "Portable question", status: "complete" },
				{ id: "a1", type: "message", source: "product", createdAt: "2026-08-20T00:00:01.000Z", role: "assistant", content: [{ type: "tool_call", toolCallId: "call-1", toolName: "lookup", input: { query: "portable" } }], status: "complete" },
				{ id: "t1", type: "message", source: "product", createdAt: "2026-08-20T00:00:02.000Z", role: "tool", content: "portable result", toolCallId: "call-1", toolName: "lookup", result: { answer: "portable" }, status: "complete" },
				{ id: "a2", type: "message", source: "product", createdAt: "2026-08-20T00:00:03.000Z", role: "assistant", content: "Portable answer", status: "complete" },
			],
			truncated: false,
			omittedEntries: 0,
		},
	};
	const session = await registry.openSession(
		instanceId,
		openInput(instanceId, root, binding, "history-message", historyHandoff),
	);
	t.after(() => session.dispose());
	const state = await getCodexNativeClient(session).request("test/getState", {});
	assert.equal(state.injectedItems.length, 1);
	assert.equal(state.injectedItems[0].threadId, session.getBinding().nativeSessionId);
	assert.deepEqual(state.injectedItems[0].items.map((item) => item.type), [
		"message",
		"function_call",
		"function_call_output",
		"message",
	]);
	assert.equal(state.turnRequests.length, 0, "history injection must not fabricate a model turn");
	await session.prompt({ text: "Continue", source: "rpc" });
	assert.equal((await getCodexNativeClient(session).request("test/getState", {})).turnRequests.length, 1);
	await session.dispose();
});

test("Codex native manual compaction uses thread/compact/start and emits balanced Pibo compaction events", async (t) => {
	const root = await testRoot(t);
	const { session } = await openFreshSession(t, root, "compaction");
	const events = [];
	session.subscribe((event) => events.push(event));
	const result = await session.controls.compact("Preserve the active implementation plan.");
	assert.deepEqual(result, {
		native: true,
		method: "thread/compact/start",
		customInstructionsApplied: false,
	});
	assert.equal(events.filter((event) => event.type === "warning").length, 1);
	assert.match(events.find((event) => event.type === "warning").message, /cannot apply custom Pibo compaction instructions/);
	assert.equal(events.filter((event) => event.type === "compaction_start").length, 1);
	assert.equal(events.filter((event) => event.type === "compaction_end").length, 1);
	assert.equal(events.find((event) => event.type === "compaction_end").aborted, false);
	assert.ok(events.findIndex((event) => event.type === "compaction_start") < events.findIndex((event) => event.type === "compaction_end"));
	const state = await getCodexNativeClient(session).request("test/getState", {});
	assert.equal(state.compactionRequests.length, 1);
	assert.equal(state.compactionRequests[0].threadId, session.getBinding().nativeSessionId);
	await session.dispose();
});

test("Codex native compaction start failures still emit one balanced terminal lifecycle", async (t) => {
	const root = await testRoot(t);
	const { session } = await openFreshSession(t, root, "compaction-failure");
	const events = [];
	session.subscribe((event) => events.push(event));
	await getCodexNativeClient(session).request("test/failNextCompaction", {});
	await assert.rejects(() => session.controls.compact(), /fixture compaction failure/);
	assert.equal(events.filter((event) => event.type === "compaction_start").length, 1);
	assert.equal(events.filter((event) => event.type === "compaction_end").length, 1);
	const terminal = events.find((event) => event.type === "compaction_end");
	assert.equal(terminal.aborted, false);
	assert.match(terminal.errorMessage, /fixture compaction failure/);
	assert.equal(session.getStatus().streaming, false);
	await session.controls.compact();
	assert.equal(events.filter((event) => event.type === "compaction_start").length, 2, "the controller must be reusable after a start failure");
	assert.equal(events.filter((event) => event.type === "compaction_end").length, 2);
	await session.dispose();
});

test("Codex native maps native command, file, and MCP item lifecycles with bounded secret redaction", async (t) => {
	const root = await testRoot(t);
	const { session } = await openFreshSession(t, root, "tools");
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "[tools] inspect native work", source: "rpc" });

	const calls = events.filter((event) => event.type === "tool_call");
	const starts = events.filter((event) => event.type === "tool_execution_started");
	const updates = events.filter((event) => event.type === "tool_execution_updated");
	const finishes = events.filter((event) => event.type === "tool_execution_finished");
	assert.deepEqual(calls.map((event) => event.toolName), ["codex_command", "codex_file_change", "native-server/lookup"]);
	assert.deepEqual(starts.map((event) => event.toolCallId), calls.map((event) => event.toolCallId));
	assert.ok(updates.some((event) => event.toolName === "codex_command" && event.partialResult.delta === "o"));
	assert.ok(updates.some((event) => event.toolName === "codex_file_change" && Array.isArray(event.partialResult.changes)));
	assert.ok(updates.some((event) => event.toolName === "native-server/lookup" && event.partialResult.message === "working"));
	assert.equal(finishes.length, 3);
	assert.equal(finishes.every((event) => event.isError === false), true);
	assert.deepEqual(session.getStatus().enabledTools, ["codex_command", "codex_file_change", "native-server/lookup"]);
	assert.equal(Object.hasOwn(calls[0].args, "cwd"), false);
	assert.equal(calls[2].args.arguments.apiKey, "[redacted]");
	assert.equal(finishes[2].result.result.accessToken, "[redacted]");
	assert.doesNotMatch(JSON.stringify(events), /sk-fixture-secret|fixture-token/);
	await session.dispose();
});

test("Codex native uses stable turn/steer and turn/interrupt against the active native turn", async (t) => {
	const root = await testRoot(t);
	const { session } = await openFreshSession(t, root, "control");
	const events = [];
	session.subscribe((event) => events.push(event));

	const steeredPrompt = session.prompt({ text: "[steer] wait", source: "rpc" });
	await waitFor(() => events.some((event) => event.type === "turn_started"));
	assert.equal(session.getStatus().streaming, true);
	const activeState = await getCodexNativeClient(session).request("test/getState", {});
	const active = Object.values(activeState.activeTurns)[0];
	assert.equal(active.clientUserMessageId, "pibo-message-1");
	await session.steer({ text: "continue with the updated instruction", source: "rpc" });
	await steeredPrompt;
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 1);
	assert.deepEqual(events.filter((event) => event.type === "assistant_message").map((event) => event.text), ["Steered answer."]);

	const processBeforeInterrupt = getCodexNativeClient(session).snapshot.pid;
	const interruptedPrompt = session.prompt({ text: "[hold] interrupt me", source: "rpc" });
	await waitFor(() => events.filter((event) => event.type === "turn_started").length === 2);
	await session.abort();
	await interruptedPrompt;
	const processAfterInterrupt = getCodexNativeClient(session).snapshot.pid;
	assert.ok(processBeforeInterrupt);
	assert.ok(processAfterInterrupt);
	assert.notEqual(processAfterInterrupt, processBeforeInterrupt);
	assert.equal(events.filter((event) => event.type === "turn_completed" && event.status === "interrupted").length, 1);
	assert.equal(events.filter((event) => event.type === "turn_failed").length, 0);
	assert.equal(session.getStatus().streaming, false);
	await assert.rejects(session.steer({ text: "too late", source: "rpc" }), /requires an active turn/);
	await session.dispose();
});

test("Codex native emits one redacted terminal failure for provider failure, malformed protocol, and process crash", async (t) => {
	const root = await testRoot(t);
	const provider = await openFreshSession(t, root, "provider-failure");
	const providerEvents = [];
	provider.session.subscribe((event) => providerEvents.push(event));
	await provider.session.prompt({ text: "[failure]", source: "rpc" });
	assert.equal(providerEvents.filter((event) => event.type === "warning").length, 1);
	assert.equal(providerEvents.filter((event) => event.type === "error").length, 1);
	assert.equal(providerEvents.filter((event) => event.type === "turn_failed").length, 1);
	assert.equal(providerEvents.filter((event) => event.type === "turn_completed").length, 0);
	assert.doesNotMatch(JSON.stringify(providerEvents), /fixture-secret/);
	assert.match(providerEvents.find((event) => event.type === "turn_failed").message, /provider failed token=\[redacted\]/);

	const malformed = await openFreshSession(t, root, "malformed");
	const malformedEvents = [];
	malformed.session.subscribe((event) => malformedEvents.push(event));
	await assert.rejects(malformed.session.prompt({ text: "[malformed]", source: "rpc" }), /agent message delta is invalid/);
	assert.equal(malformedEvents.filter((event) => event.type === "turn_failed").length, 1);
	assert.equal(malformedEvents.filter((event) => event.type === "turn_completed").length, 0);

	const crash = await openFreshSession(t, root, "crash");
	const crashEvents = [];
	crash.session.subscribe((event) => crashEvents.push(event));
	await assert.rejects(crash.session.prompt({ text: "[crash]", source: "rpc" }), /exited|closed/i);
	assert.equal(crashEvents.filter((event) => event.type === "turn_failed").length, 1);
	assert.equal(crashEvents.filter((event) => event.type === "turn_completed").length, 0);
	await provider.session.dispose();
	await malformed.session.dispose();
	await crash.session.dispose();
});

test("Codex native ignores foreign and duplicate notifications without duplicating terminal or item completion", async (t) => {
	const root = await testRoot(t);
	const { session } = await openFreshSession(t, root, "duplicate");
	const events = [];
	session.subscribe((event) => events.push(event));
	await session.prompt({ text: "[duplicate]", source: "rpc" });
	assert.equal(events.filter((event) => event.type === "turn_started").length, 1);
	assert.equal(events.filter((event) => event.type === "assistant_message").length, 1);
	assert.equal(events.filter((event) => event.type === "turn_completed").length, 1);
	await session.dispose();
});

test("Codex native events flow through generic routed orchestration with correlation and restart continuity", async (t) => {
	const root = await testRoot(t);
	const instanceId = "codex-native-router-turn";
	const profileName = "codex-native-router-turn-profile";
	const piboSessionId = "ps_codex_router_turn";
	const config = runtimeConfig(root);
	const pluginRegistry = PiboPluginRegistry.create({
		plugins: [piboCorePlugin, definePiboPlugin({
			id: "test.codex-native-router-turn",
			register(api) {
				api.registerAgentRuntimeDriver(CODEX_NATIVE_AGENT_RUNTIME_DRIVER);
				api.registerAgentRuntimeInstance({ id: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, config });
				api.registerProfile({
					name: profileName,
					create() {
						return profile(instanceId, profileName);
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
		runtimeBinding: { runtimeInstanceId: instanceId, adapterId: CODEX_NATIVE_ADAPTER_ID, state: "unbound" },
	});
	const resources = new PiboRuntimeResourceService({ rootDir: join(root, "resources") });
	const firstRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	const firstEvents = [];
	firstRouter.subscribe((event) => firstEvents.push(event));
	const queued = await firstRouter.emit({
		type: "message",
		piboSessionId,
		id: "codex-routed-message-1",
		text: "[tools] routed",
		source: "user",
	});
	assert.equal(queued.type, "message_queued");
	await waitFor(() => firstEvents.some((event) => event.type === "message_finished"));
	assert.deepEqual(firstEvents.filter((event) => event.type === "assistant_message").map((event) => event.text), ["Codex answer."]);
	assert.equal(firstEvents.some((event) => event.type === "thinking_started"), true);
	assert.equal(firstEvents.some((event) => event.type === "thinking_delta"), true);
	assert.equal(firstEvents.some((event) => event.type === "thinking_finished"), true);
	assert.equal(firstEvents.filter((event) => event.type === "tool_call").length, 3);
	assert.equal(firstEvents.filter((event) => event.type === "tool_execution_finished").length, 3);
	assert.deepEqual(firstEvents.filter((event) => event.type === "assistant_usage").map((event) => event.totalTokens), [20]);
	for (const event of firstEvents.filter((event) => [
		"assistant_delta",
		"assistant_message",
		"thinking_started",
		"thinking_delta",
		"thinking_finished",
		"tool_call",
		"tool_execution_started",
		"tool_execution_updated",
		"tool_execution_finished",
		"assistant_usage",
	].includes(event.type))) {
		assert.equal(event.eventId, "codex-routed-message-1");
	}
	const firstBinding = store.getRuntimeBinding(piboSessionId);
	assert.equal(firstBinding.state, "bound");
	assert.match(firstBinding.nativeSessionId, /^thread-/);
	await firstRouter.disposeAll();

	const secondRouter = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry,
		sessionStore: store,
		runtimeResourceService: resources,
	});
	const secondEvents = [];
	secondRouter.subscribe((event) => secondEvents.push(event));
	await secondRouter.emit({
		type: "message",
		piboSessionId,
		id: "codex-routed-message-2",
		text: "restart-resumed",
		source: "user",
	});
	await waitFor(() => secondEvents.some((event) => event.type === "message_finished"));
	assert.equal(store.getRuntimeBinding(piboSessionId).nativeSessionId, firstBinding.nativeSessionId);
	assert.deepEqual(secondEvents.filter((event) => event.type === "assistant_message").map((event) => event.text), ["Codex answer."]);
	await secondRouter.disposeAll();
});
