import assert from "node:assert/strict";
import test from "node:test";
import { createMinimalAgentRuntimeCapabilities } from "../dist/agent-runtime/capabilities.js";
import { RuntimeRoutedSession } from "../dist/agent-runtime/routed-session.js";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PIBO_PROVIDER_RECOVERY_PROMPT } from "../dist/core/provider-recovery.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 1_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for routed runtime output");
		await delay(5);
	}
}

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}

function createFakeRuntimeFixture(routerOptions = {}) {
	const fakeDriver = createFakeAgentRuntimeDriver({
		adapterId: "router-fake",
		script: (input) => ({
			events: [
				{ type: "assistant_delta", text: `${input.text}:delta` },
				{ type: "assistant_message", text: `${input.text}:final` },
			],
		}),
	});
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.router-fake",
				register(api) {
					api.registerAgentRuntimeDriver(fakeDriver);
					api.registerAgentRuntimeInstance({ id: "router-fake", adapterId: "router-fake" });
					api.registerProfile({
						name: "router-fake-profile",
						create() {
							return new InitialSessionContextBuilder("router-fake-profile")
								.withAgentRuntime("router-fake")
								.withBuiltinTools("disabled")
								.withAutoContextFiles(false)
								.withToolPackages({ goalControl: false })
								.createSession();
						},
					});
				},
			}),
		],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_router_fake",
		runtimeBinding: { runtimeInstanceId: "router-fake", adapterId: "router-fake", state: "unbound" },
		channel: "test",
		kind: "chat",
		profile: "router-fake-profile",
		workspace: process.cwd(),
	});
	return {
		registry,
		store,
		router: new PiboSessionRouter({
			persistSession: false,
			pluginRegistry: registry,
			sessionStore: store,
			...routerOptions,
		}),
	};
}

test("generic routed orchestration queues and correlates a non-Pi fake adapter", async () => {
	const fixture = createFakeRuntimeFixture();
	const events = [];
	let portableTools;
	fixture.router.subscribe((event) => events.push(event));
	try {
		const first = fixture.router.emit({
			type: "message",
			piboSessionId: "ps_router_fake",
			id: "fake-message-1",
			text: "one",
			source: "user",
		});
		const second = fixture.router.emit({
			type: "message",
			piboSessionId: "ps_router_fake",
			id: "fake-message-2",
			text: "two",
			source: "user",
		});
		assert.equal((await first).type, "message_queued");
		assert.equal((await second).type, "message_queued");
		await waitFor(() => events.filter((event) => event.type === "message_finished").length === 2);

		assert.deepEqual(
			events.filter((event) => event.type === "assistant_message").map((event) => [event.eventId, event.text]),
			[
				["fake-message-1", "one:final"],
				["fake-message-2", "two:final"],
			],
		);
		const status = await fixture.router.emit({
			type: "execution",
			piboSessionId: "ps_router_fake",
			action: "status",
		});
		assert.equal(status.result.streaming, false);
		assert.equal(status.result.cwd, process.cwd());
		const adapter = fixture.registry.requireAgentRuntimeAdapter("router-fake");
		portableTools = adapter.openInputs[0].services.portableTools;
		assert.equal(portableTools.piboSessionId, "ps_router_fake");
		assert.equal(portableTools.runtimeInstanceId, "router-fake");
		assert.equal(portableTools.adapterId, "router-fake");
		assert.deepEqual(portableTools.createDefinitions(), []);
	} finally {
		await fixture.router.disposeAll();
	}
	assert.throws(() => portableTools.createDefinitions(), /disposed/);
});

test("generic routed session preserves output identities across successful compaction", async () => {
	const listeners = new Set();
	const runtimeSession = {
		adapterId: "compaction-fake",
		runtimeInstanceId: "compaction-fake",
		cwd: process.cwd(),
		capabilities: createMinimalAgentRuntimeCapabilities(),
		getBinding: () => ({
			piboSessionId: "ps_compaction",
			runtimeInstanceId: "compaction-fake",
			adapterId: "compaction-fake",
			state: "bound",
		}),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async prompt() {
			for (const listener of listeners) {
				listener({ type: "reasoning_started" });
				listener({ type: "reasoning_finished", text: "before reasoning" });
				listener({ type: "assistant_message", text: "before compaction" });
				listener({ type: "compaction_start", reason: "context_guard" });
				listener({ type: "compaction_end", reason: "context_guard", result: { summary: "compact" }, aborted: false });
				listener({ type: "reasoning_started" });
				listener({ type: "reasoning_finished", text: "after reasoning" });
				listener({ type: "assistant_message", text: "after compaction" });
			}
		},
		async abort() {},
		async dispose() {},
		getStatus: () => ({ streaming: false, enabledTools: [], cwd: process.cwd() }),
	};
	const events = [];
	const routed = new RuntimeRoutedSession(
		"ps_compaction",
		runtimeSession,
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
	);
	try {
		routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_compaction",
			id: "compaction-message",
			text: "continue after compaction",
			source: "user",
		});
		await waitFor(() => events.some((event) => event.type === "message_finished"));
		assert.deepEqual(
			events.filter((event) => event.type === "thinking_finished").map((event) => event.thinkingIndex),
			[0, 1],
		);
		assert.deepEqual(
			events.filter((event) => event.type === "assistant_message").map((event) => event.assistantIndex),
			[0, 1],
		);
		assert.deepEqual(
			events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end").map((event) => event.eventId),
			["compaction-message", "compaction-message"],
		);
	} finally {
		await routed.dispose();
	}
});

test("generic model switching preserves Pibo reasoning when a runtime reapplies its own default", async () => {
	const originalModel = { provider: "openai-codex", id: "gpt-5.6-sol" };
	const targetModel = { provider: "openai-codex", id: "gpt-6-astra" };
	let activeModel = originalModel;
	let reasoning = "high";
	const reasoningChanges = [];
	const runtimeSession = {
		adapterId: "reasoning-reset-fake",
		runtimeInstanceId: "reasoning-reset-fake",
		cwd: process.cwd(),
		capabilities: {
			...createMinimalAgentRuntimeCapabilities(),
			models: { catalog: true, switchInSession: true },
			reasoning: { supported: true, values: ["low", "medium", "high", "max"] },
		},
		controls: {
			getReasoning() {
				return { value: reasoning, availableValues: ["low", "medium", "high", "max"], supported: true };
			},
			setReasoning(value) {
				reasoning = value;
				reasoningChanges.push(value);
				return this.getReasoning();
			},
			async setModel(model) {
				activeModel = { ...model };
				reasoning = "max";
				return { ...model };
			},
		},
		getBinding: () => ({ piboSessionId: "ps_reasoning_reset", runtimeInstanceId: "reasoning-reset-fake", adapterId: "reasoning-reset-fake", state: "bound" }),
		subscribe() { return () => {}; },
		async prompt() {},
		async abort() {},
		async dispose() {},
		getStatus: () => ({
			streaming: false,
			enabledTools: [],
			cwd: process.cwd(),
			activeModel: { ...activeModel },
			reasoning: { value: reasoning, availableValues: ["low", "medium", "high", "max"], supported: true },
		}),
	};
	const routed = new RuntimeRoutedSession(
		"ps_reasoning_reset",
		runtimeSession,
		() => {},
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
	);
	try {
		assert.deepEqual(await routed.setModel(targetModel), targetModel);
		assert.deepEqual(routed.getActiveModel(), targetModel);
		assert.equal(routed.getStatus().thinkingLevel, "high");
		assert.deepEqual(reasoningChanges, ["high"]);
	} finally {
		await routed.dispose();
	}
});

test("generic routed orchestration tries ordered provider fallbacks and restores the primary model", async () => {
	const primary = { provider: "openai", id: "gpt-primary" };
	const fallbackOne = { provider: "anthropic", id: "claude-fallback" };
	const fallbackTwo = { provider: "moonshot", id: "kimi-fallback" };
	const listeners = new Set();
	const prompts = [];
	const modelSwitches = [];
	let activeModel = primary;
	let turn = 0;
	const runtimeSession = {
		adapterId: "fallback-fake",
		runtimeInstanceId: "fallback-fake",
		cwd: process.cwd(),
		capabilities: {
			...createMinimalAgentRuntimeCapabilities(),
			models: { catalog: true, switchInSession: true },
		},
		controls: {
			async setModel(model) {
				activeModel = { ...model };
				modelSwitches.push({ ...model });
				return { ...model };
			},
		},
		getBinding: () => ({ piboSessionId: "ps_fallback", runtimeInstanceId: "fallback-fake", adapterId: "fallback-fake", state: "bound" }),
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async prompt(input) {
			prompts.push({ ...input, model: { ...activeModel } });
			turn += 1;
			for (const listener of listeners) listener({ type: "turn_started", turnId: `turn-${turn}` });
			if (activeModel.provider !== "moonshot") {
				const details = {
					category: "provider_transport",
					errorClass: "provider_transport",
					code: "network_error",
					origin: "provider",
					retryable: true,
					provider: activeModel.provider,
					model: activeModel.id,
				};
				for (const listener of listeners) listener({ type: "turn_failed", turnId: `turn-${turn}`, message: "connection reset", details });
				throw new Error("connection reset");
			}
			for (const listener of listeners) {
				listener({ type: "assistant_message", text: "fallback succeeded" });
				listener({ type: "turn_completed", turnId: `turn-${turn}`, status: "completed" });
			}
		},
		async abort() {},
		async dispose() {},
		getStatus: () => ({ streaming: false, enabledTools: [], cwd: process.cwd(), activeModel: { ...activeModel } }),
	};
	const events = [];
	const routed = new RuntimeRoutedSession(
		"ps_fallback",
		runtimeSession,
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		{ modelFallbacks: [fallbackOne, fallbackTwo] },
	);
	try {
		routed.enqueueMessage({ type: "message", piboSessionId: "ps_fallback", id: "fallback-message", text: "do the work", source: "user" });
		await waitFor(() => events.some((event) => event.type === "message_finished"));
		assert.deepEqual(prompts.map((prompt) => [prompt.text, prompt.model]), [
			["do the work", primary],
			[PIBO_PROVIDER_RECOVERY_PROMPT, fallbackOne],
			[PIBO_PROVIDER_RECOVERY_PROMPT, fallbackTwo],
		]);
		assert.deepEqual(modelSwitches, [fallbackOne, fallbackTwo, primary]);
		assert.equal(events.some((event) => event.type === "session_error"), false);
		assert.equal(events.find((event) => event.type === "assistant_message")?.text, "fallback succeeded");
	} finally {
		await routed.dispose();
	}
});

test("provider fallback does not retry context or runtime failures", async () => {
	const primary = { provider: "openai", id: "gpt-primary" };
	const listeners = new Set();
	const modelSwitches = [];
	const runtimeSession = {
		adapterId: "fallback-fake",
		runtimeInstanceId: "fallback-fake",
		cwd: process.cwd(),
		capabilities: { ...createMinimalAgentRuntimeCapabilities(), models: { catalog: true, switchInSession: true } },
		controls: { async setModel(model) { modelSwitches.push(model); return model; } },
		getBinding: () => ({ piboSessionId: "ps_no_fallback", runtimeInstanceId: "fallback-fake", adapterId: "fallback-fake", state: "bound" }),
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		async prompt() {
			const details = { category: "context_overflow", errorClass: "provider_context", code: "context_length_exceeded", origin: "provider", retryable: false };
			for (const listener of listeners) listener({ type: "turn_failed", message: "context window exceeded", details });
		},
		async abort() {},
		async dispose() {},
		getStatus: () => ({ streaming: false, enabledTools: [], cwd: process.cwd(), activeModel: primary }),
	};
	const events = [];
	const routed = new RuntimeRoutedSession(
		"ps_no_fallback",
		runtimeSession,
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		{ modelFallbacks: [{ provider: "anthropic", id: "claude-fallback" }] },
	);
	try {
		routed.enqueueMessage({ type: "message", piboSessionId: "ps_no_fallback", id: "no-fallback-message", text: "too large", source: "user" });
		await waitFor(() => events.some((event) => event.type === "session_error"));
		assert.deepEqual(modelSwitches, []);
		assert.equal(events.some((event) => event.type === "message_finished"), false);
	} finally {
		await routed.dispose();
	}
});

test("generic routed requests remain cancellable during asynchronous message preflight", async () => {
	const preflightStarted = deferred();
	const releasePreflight = deferred();
	const fixture = createFakeRuntimeFixture({
		messagePreflight: async () => {
			preflightStarted.resolve();
			await releasePreflight.promise;
			return { allowed: true };
		},
	});
	const events = [];
	fixture.router.subscribe((event) => events.push(event));
	try {
		const controller = new AbortController();
		let settled = false;
		const waiting = fixture.router.emitMessageAndWaitForReply({
			type: "message",
			piboSessionId: "ps_router_fake",
			id: "fake-message-preflight-cancelled",
			text: "cancel before prompt",
			source: "actor",
		}, 30_000, controller.signal).finally(() => { settled = true; });
		await preflightStarted.promise;
		controller.abort();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(settled, false);
		assert.equal(fixture.registry.requireAgentRuntimeAdapter("router-fake").sessions[0].prompts.length, 0);

		releasePreflight.resolve();
		await assert.rejects(waiting, (error) => error instanceof Error && error.name === "AbortError");
		assert.equal(fixture.registry.requireAgentRuntimeAdapter("router-fake").sessions[0].prompts.length, 0);
		assert.equal(events.some((event) => event.type === "message_started" && event.eventId === "fake-message-preflight-cancelled"), false);
	} finally {
		releasePreflight.resolve();
		await fixture.router.disposeAll();
	}
});

test("generic router rejects profile selections the runtime cannot deliver", async () => {
	const fixture = createFakeRuntimeFixture();
	fixture.registry.upsertProfile({
		name: "unsupported-portable-profile",
		create() {
			return new InitialSessionContextBuilder("unsupported-portable-profile")
				.withAgentRuntime("router-fake")
				.addTool({ name: "pibo-tool" })
				.createSession();
		},
	});
	fixture.store.create({
		id: "ps_router_unsupported",
		runtimeBinding: { runtimeInstanceId: "router-fake", adapterId: "router-fake", state: "unbound" },
		channel: "test",
		kind: "chat",
		profile: "unsupported-portable-profile",
		workspace: process.cwd(),
	});
	try {
		await assert.rejects(
			() => fixture.router.emit({ type: "execution", piboSessionId: "ps_router_unsupported", action: "status" }),
			/Runtime profile validation failed: .*Pibo-managed tools/,
		);
	} finally {
		await fixture.router.disposeAll();
	}
});

test("generic routed controls reject unadvertised adapter capabilities explicitly", async () => {
	const fixture = createFakeRuntimeFixture();
	try {
		await assert.rejects(
			() => fixture.router.emit({
				type: "execution",
				piboSessionId: "ps_router_fake",
				action: "session.clone",
			}),
			(error) => error?.name === "AgentRuntimeCapabilityUnavailableError"
				&& /native session clone/.test(error.message),
		);
	} finally {
		await fixture.router.disposeAll();
	}
});

test("fork identity reads and transitions reject queued or active routed work", async () => {
	const releasePrompt = deferred();
	const releaseFork = deferred();
	const releasePersistence = deferred();
	let streaming = false;
	let candidateReads = 0;
	let forks = 0;
	let persistenceStarted = false;
	const binding = {
		piboSessionId: "ps_fork_race",
		runtimeInstanceId: "fork-race",
		adapterId: "fork-race",
		nativeSessionId: "native-source",
		state: "bound",
	};
	const runtimeSession = {
		adapterId: "fork-race",
		runtimeInstanceId: "fork-race",
		cwd: process.cwd(),
		capabilities: {
			...createMinimalAgentRuntimeCapabilities(),
			lifecycle: { ...createMinimalAgentRuntimeCapabilities().lifecycle, fork: true },
		},
		controls: {
			getForkCandidates() {
				candidateReads += 1;
				return [{ entryId: "native-user", text: "prompt" }];
			},
			async forkSession() {
				forks += 1;
				await releaseFork.promise;
				return {
					previous: { adapterId: "fork-race", runtimeInstanceId: "fork-race", nativeSessionId: "native-source", cwd: process.cwd() },
					current: { adapterId: "fork-race", runtimeInstanceId: "fork-race", nativeSessionId: "native-fork", cwd: process.cwd() },
					cancelled: false,
				};
			},
		},
		getBinding: () => ({ ...binding }),
		subscribe: () => () => {},
		async prompt() {
			streaming = true;
			await releasePrompt.promise;
			streaming = false;
		},
		async abort() {
			releasePrompt.resolve();
			streaming = false;
		},
		async dispose() {
			releasePrompt.resolve();
			streaming = false;
		},
		getStatus: () => ({ streaming, enabledTools: [], cwd: process.cwd() }),
	};
	const routed = new RuntimeRoutedSession(
		"ps_fork_race",
		runtimeSession,
		() => {},
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		{
			async onSessionOperation() {
				persistenceStarted = true;
				await releasePersistence.promise;
			},
		},
	);
	try {
		routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_fork_race",
			id: "fork-race-message",
			text: "prompt",
			source: "service",
		});
		await waitFor(() => routed.getStatus().processing && routed.getStatus().streaming);
		await assert.rejects(() => routed.getForkCandidates(), /must be idle to inspect fork candidates/);
		await assert.rejects(() => routed.forkSession("native-user"), /must be idle to fork/);
		assert.equal(candidateReads, 0);
		assert.equal(forks, 0);

		releasePrompt.resolve();
		await waitFor(() => !routed.getStatus().processing && routed.getStatus().queuedMessages === 0);
		const forkAction = routed.executeAction({
			type: "execution",
			piboSessionId: "ps_fork_race",
			action: "session.fork",
			params: { entryId: "native-user" },
		});
		await waitFor(() => forks === 1);
		assert.throws(() => routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_fork_race",
			id: "fork-race-during-native-transition",
			text: "must not cross the native transition",
			source: "service",
		}), /session identity operation is in progress/);
		releaseFork.resolve();
		await waitFor(() => persistenceStarted);
		assert.throws(() => routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_fork_race",
			id: "fork-race-during-persistence",
			text: "must not cross product persistence",
			source: "service",
		}), /session identity operation is in progress/);
		releasePersistence.resolve();
		await forkAction;
	} finally {
		releasePrompt.resolve();
		releaseFork.resolve();
		releasePersistence.resolve();
		await routed.dispose();
	}
});

test("running-safe fork controls snapshot completed history without interrupting the source turn", async () => {
	const releasePrompt = deferred();
	let streaming = false;
	let idleForks = 0;
	let runningForks = 0;
	const persistedOperations = [];
	const binding = {
		piboSessionId: "ps_running_fork",
		runtimeInstanceId: "running-fork",
		adapterId: "running-fork",
		nativeSessionId: "native-source",
		state: "bound",
	};
	const runtimeSession = {
		adapterId: "running-fork",
		runtimeInstanceId: "running-fork",
		cwd: process.cwd(),
		capabilities: {
			...createMinimalAgentRuntimeCapabilities(),
			lifecycle: { ...createMinimalAgentRuntimeCapabilities().lifecycle, fork: true, forkWhileRunning: true },
		},
		controls: {
			getForkCandidates() {
				throw new Error("idle candidate reader must not run");
			},
			getForkCandidatesWhileRunning() {
				return [{ entryId: "completed-user", text: "completed prompt" }];
			},
			async forkSession() {
				idleForks += 1;
				throw new Error("idle fork must not run");
			},
			async forkSessionWhileRunning(entryId) {
				runningForks += 1;
				assert.equal(entryId, "completed-user");
				return {
					previous: { adapterId: "running-fork", runtimeInstanceId: "running-fork", nativeSessionId: "native-source", cwd: process.cwd() },
					current: { adapterId: "running-fork", runtimeInstanceId: "running-fork", nativeSessionId: "native-fork", cwd: process.cwd() },
					cancelled: false,
					sourceSessionUnchanged: true,
				};
			},
		},
		getBinding: () => ({ ...binding }),
		subscribe: () => () => {},
		async prompt() {
			streaming = true;
			await releasePrompt.promise;
			streaming = false;
		},
		async abort() {
			releasePrompt.resolve();
			streaming = false;
		},
		async dispose() {
			releasePrompt.resolve();
			streaming = false;
		},
		getStatus: () => ({ streaming, enabledTools: [], cwd: process.cwd() }),
	};
	const routed = new RuntimeRoutedSession(
		"ps_running_fork",
		runtimeSession,
		() => {},
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		{ onSessionOperation: async (result) => persistedOperations.push(structuredClone(result)) },
	);
	try {
		routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_running_fork",
			id: "active-message",
			text: "active prompt",
			source: "user",
		});
		await waitFor(() => routed.getStatus().processing && routed.getStatus().streaming);

		assert.deepEqual(await routed.getForkCandidates(), [{ entryId: "completed-user", text: "completed prompt" }]);
		const forked = await routed.executeAction({
			type: "execution",
			piboSessionId: "ps_running_fork",
			action: "session.fork",
			params: { entryId: "completed-user" },
		});
		assert.equal(forked.result.current.piSessionId, "native-fork");
		assert.equal(forked.result.sourceSessionUnchanged, true);
		assert.equal(runningForks, 1);
		assert.equal(idleForks, 0);
		assert.equal(routed.getStatus().streaming, true, "source turn remains active after the snapshot fork");
		assert.equal(routed.getRuntimeBinding().nativeSessionId, "native-source");
		assert.equal(persistedOperations.length, 1);
		assert.equal(persistedOperations[0].sourceSessionUnchanged, true);
	} finally {
		releasePrompt.resolve();
		await routed.dispose();
	}
});

test("fork-candidate page reads serialize accepted message drain behind OMP-style idle work", async () => {
	const releaseCandidates = deferred();
	let operationInFlight = false;
	let candidateReads = 0;
	let prompts = 0;
	let aborts = 0;
	const outputs = [];
	const routedStates = [];
	const runtimeSession = {
		adapterId: "omp-race-fixture",
		runtimeInstanceId: "omp-race-fixture",
		cwd: process.cwd(),
		capabilities: {
			...createMinimalAgentRuntimeCapabilities(),
			lifecycle: { ...createMinimalAgentRuntimeCapabilities().lifecycle, fork: true },
		},
		controls: {
			async getForkCandidates() {
				candidateReads += 1;
				operationInFlight = true;
				try {
					await releaseCandidates.promise;
					return [{ entryId: "omp-user-1", text: "page prompt" }];
				} finally {
					operationInFlight = false;
				}
			},
		},
		getBinding: () => ({
			piboSessionId: "ps_omp_candidate_race",
			runtimeInstanceId: "omp-race-fixture",
			adapterId: "omp-race-fixture",
			nativeSessionId: "omp-native-source",
			state: "bound",
		}),
		subscribe: () => () => {},
		async prompt() {
			prompts += 1;
			if (operationInFlight) throw new Error("OMP session is busy with another operation");
		},
		async abort() { aborts += 1; },
		async dispose() {},
		getStatus: () => ({ streaming: false, enabledTools: [], cwd: process.cwd() }),
	};
	const routed = new RuntimeRoutedSession(
		"ps_omp_candidate_race",
		runtimeSession,
		(event) => outputs.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		{ onStateChange: (state) => routedStates.push(state) },
	);
	try {
		const firstRead = routed.getForkCandidates();
		const secondRead = routed.getForkCandidates();
		await waitFor(() => operationInFlight);
		assert.equal(candidateReads, 1, "concurrent page readers share one reserved native read");
		let queuedMessageAccepted = false;
		const queued = routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_omp_candidate_race",
			id: "send-during-candidate-read",
			text: "must wait behind candidate discovery",
			source: "user",
		}, () => { queuedMessageAccepted = true; });
		assert.equal(queued.type, "message_queued");
		assert.equal(queuedMessageAccepted, true, "candidate discovery may accept only into the serialized routed queue");
		assert.equal(outputs.some((event) => event.type === "message_queued" && event.eventId === "send-during-candidate-read"), true);
		assert.equal(prompts, 0);
		await routed.executeAction({
			type: "execution",
			piboSessionId: "ps_omp_candidate_race",
			id: "abort-during-candidate-read",
			action: "abort",
		});
		assert.equal(aborts, 1, "abort remains available while a read-only identity reservation is pending");
		assert.equal(operationInFlight, true, "abort does not corrupt the independent candidate read");

		releaseCandidates.resolve();
		assert.deepEqual(await firstRead, [{ entryId: "omp-user-1", text: "page prompt" }]);
		assert.deepEqual(await secondRead, [{ entryId: "omp-user-1", text: "page prompt" }]);
		await waitFor(() => prompts === 1 && !routed.getStatus().processing);
		routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_omp_candidate_race",
			id: "send-after-candidate-read",
			text: "accepted after reservation",
			source: "user",
		});
		await waitFor(() => prompts === 2 && !routed.getStatus().processing);
		assert.equal(outputs.some((event) => event.type === "session_error"), false);
		assert.equal(routedStates.some((state) => state.sessionIdentityOperationInFlight), true);
		assert.equal(routedStates.at(-1).sessionIdentityOperationInFlight, false, "unlock is observable for reminder and eviction scheduling");
	} finally {
		releaseCandidates.resolve();
		await routed.dispose();
	}
});

test("adapter-shared auth mutations recycle every affected configured runtime session", async () => {
	const baseDriver = createFakeAgentRuntimeDriver({ adapterId: "router-shared-auth-fake" });
	baseDriver.descriptor.capabilities.auth = {
		status: true,
		methods: [{ id: "api_key", completion: "immediate" }],
		cancel: false,
		logout: true,
		credentialScope: "adapter-shared",
	};
	const adapters = new Map();
	const createBase = baseDriver.create.bind(baseDriver);
	const authDriver = {
		...baseDriver,
		create(input) {
			const adapter = Object.assign(createBase(input), {
				async getAuthStatus() {
					return [{
						id: "fixture-provider",
						state: "disconnected",
						configured: false,
						methods: [{ id: "api_key", completion: "immediate" }],
					}];
				},
				async startAuth(authInput) {
					return { providerId: authInput.providerId, state: "connected", configured: true };
				},
				async logoutAuth(authInput) {
					return { providerId: authInput.providerId, state: "disconnected", configured: false };
				},
			});
			adapters.set(input.instanceId, adapter);
			return adapter;
		},
	};
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.router-shared-auth-fake",
				register(api) {
					api.registerAgentRuntimeDriver(authDriver);
					for (const runtimeInstanceId of ["router-shared-a", "router-shared-b"]) {
						api.registerAgentRuntimeInstance({ id: runtimeInstanceId, adapterId: "router-shared-auth-fake" });
						api.registerProfile({
							name: `${runtimeInstanceId}-profile`,
							create() {
								return new InitialSessionContextBuilder(`${runtimeInstanceId}-profile`)
									.withAgentRuntime(runtimeInstanceId)
									.withBuiltinTools("disabled")
									.withAutoContextFiles(false)
									.withToolPackages({ goalControl: false })
									.createSession();
							},
						});
					}
				},
			}),
		],
	});
	const store = new InMemoryPiboSessionStore();
	for (const suffix of ["a", "b"]) {
		store.create({
			id: `ps_router_shared_${suffix}`,
			runtimeBinding: {
				runtimeInstanceId: `router-shared-${suffix}`,
				adapterId: "router-shared-auth-fake",
				nativeSessionId: `router-shared-${suffix}-native`,
				state: "bound",
			},
			channel: "test",
			kind: "chat",
			profile: `router-shared-${suffix}-profile`,
			workspace: process.cwd(),
		});
	}
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try {
		await router.getSessionStatusSnapshot("ps_router_shared_a");
		await router.getSessionStatusSnapshot("ps_router_shared_b");
		assert.equal(adapters.get("router-shared-a").sessions[0].disposeCalls, 0);
		assert.equal(adapters.get("router-shared-b").sessions[0].disposeCalls, 0);

		await router.startAgentRuntimeAuth("router-shared-a", {
			providerId: "fixture-provider",
			method: "api_key",
			apiKey: "deterministic-fixture-key",
		});

		assert.equal(adapters.get("router-shared-a").sessions[0].disposeCalls, 1);
		assert.equal(adapters.get("router-shared-b").sessions[0].disposeCalls, 1);
	} finally {
		await router.disposeAll();
	}
});

test("runtime login and model menus use the active adapter's real auth status without hiding unauthenticated models", async () => {
	const baseDriver = createFakeAgentRuntimeDriver({ adapterId: "router-auth-fake" });
	let authStatusFails = false;
	baseDriver.descriptor.capabilities.models.catalog = true;
	baseDriver.descriptor.capabilities.auth = {
		status: true,
		methods: [{ id: "api_key", completion: "immediate" }],
		cancel: false,
		logout: true,
		credentialScope: "runtime-instance",
	};
	const createBase = baseDriver.create.bind(baseDriver);
	const authDriver = {
		...baseDriver,
		create(input) {
			return Object.assign(createBase(input), {
				async listModels() {
					return {
						runtimeInstanceId: input.instanceId,
						models: [{ id: "fixture-model", provider: "fixture-provider", displayName: "Fixture Model" }],
					};
				},
				async getAuthStatus() {
					if (authStatusFails) throw new Error("deterministic auth status failure");
					return [{
						id: "fixture-provider",
						displayName: "Fixture Provider",
						state: "disconnected",
						configured: false,
						methods: [{ id: "api_key", completion: "immediate" }],
					}];
				},
				async startAuth(authInput) {
					return { providerId: authInput.providerId, state: "connected", configured: true, details: { accountType: "api_key" } };
				},
				async logoutAuth(authInput) {
					return { providerId: authInput.providerId, state: "disconnected", configured: false };
				},
			});
		},
	};
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.router-auth-fake",
				register(api) {
					api.registerAgentRuntimeDriver(authDriver);
					api.registerAgentRuntimeInstance({ id: "router-auth-fake", adapterId: "router-auth-fake" });
					api.registerProfile({
						name: "router-auth-profile",
						create() {
							return new InitialSessionContextBuilder("router-auth-profile")
								.withAgentRuntime("router-auth-fake")
								.withBuiltinTools("disabled")
								.withAutoContextFiles(false)
								.withToolPackages({ goalControl: false })
								.createSession();
						},
					});
				},
			}),
		],
	});
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: "ps_router_auth_fake",
		runtimeBinding: { runtimeInstanceId: "router-auth-fake", adapterId: "router-auth-fake", state: "unbound" },
		channel: "test",
		kind: "chat",
		profile: "router-auth-profile",
		workspace: process.cwd(),
	});
	const router = new PiboSessionRouter({ persistSession: false, pluginRegistry: registry, sessionStore: store });
	try {
		const login = await router.emit({ type: "execution", piboSessionId: "ps_router_auth_fake", action: "login" });
		assert.equal(login.result.runtimeInstanceId, "router-auth-fake");
		assert.deepEqual(login.result.providers.map(({ id, configured, authMethods }) => ({ id, configured, authMethods })), [
			{ id: "fixture-provider", configured: false, authMethods: ["api_key"] },
		]);

		authStatusFails = true;
		const model = await router.emit({ type: "execution", piboSessionId: "ps_router_auth_fake", action: "model" });
		assert.equal(model.result.providers[0].authConfigured, false);
		assert.deepEqual(model.result.providers[0].models.map(({ id }) => id), ["fixture-model"]);
	} finally {
		await router.disposeAll();
	}
});
