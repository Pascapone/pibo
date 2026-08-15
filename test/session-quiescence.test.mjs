import assert from "node:assert/strict";
import test from "node:test";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { RoutedSession } from "../dist/core/routed-session.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { PiboPluginRegistry } from "../dist/plugins/registry.js";
import { InMemoryPiboSessionStore } from "../dist/sessions/store.js";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function nextTurn() {
	return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate, message, timeoutMs = 1_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) assert.fail(message);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function createRouterSessionFake(overrides = {}) {
	return {
		enqueued: [],
		removed: 0,
		forcedDisposals: [],
		disposed: false,
		enqueueMessage(event) {
			this.enqueued.push(event);
			return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: this.enqueued.length };
		},
		removeQueuedMessages(predicate) {
			const before = this.enqueued.length;
			this.enqueued = this.enqueued.filter((event) => !predicate(event));
			this.removed += before - this.enqueued.length;
			return before - this.enqueued.length;
		},
		async executeAction(event) {
			return { type: "execution_result", piboSessionId: event.piboSessionId, eventId: event.id, action: event.action, result: { aborted: true } };
		},
		getStatus() {
			return { piboSessionId: "ps_quiescence", queuedMessages: this.enqueued.length, processing: false, streaming: false, activeTools: [], enabledTools: [], cwd: process.cwd(), disposed: this.disposed, thinkingLevel: "off", fastMode: false };
		},
		async kill() {
			return "ps_quiescence";
		},
		async dispose() {
			this.disposed = true;
		},
		forceDispose(reason) {
			this.forcedDisposals.push(reason);
			this.disposed = true;
		},
		...overrides,
	};
}

function createStoredRouter(sessionId = "ps_quiescence", options = {}) {
	const store = new InMemoryPiboSessionStore();
	store.create({
		id: sessionId,
		piSessionId: "11111111-1111-4111-8111-111111111111",
		channel: "pibo.test",
		kind: "chat",
		profile: "base",
		workspace: process.cwd(),
	});
	return new PiboSessionRouter({ persistSession: false, sessionStore: store, routedSessionIdleTimeoutMs: false, ...options });
}

test("abort invalidates an already queued run-reminder microtask", async () => {
	const router = createStoredRouter();
	const session = createRouterSessionFake();
	router.sessions.set("ps_quiescence", session);
	try {
		const run = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_quiescence", toolName: "bash" });
		router.runRegistry.complete(run.runId, { text: "done" });
		router.scheduleRunReminder("ps_quiescence", false);

		await router.emit({ type: "execution", piboSessionId: "ps_quiescence", action: "abort", id: "abort-1" });
		await nextTurn();

		assert.equal(session.enqueued.length, 0);
		assert.equal(router.runRegistry.hasPendingNotification("ps_quiescence", { includeAlreadyNotified: true }), false);
	} finally {
		await router.disposeAll();
	}
});

test("a run that completes after abort cannot re-arm its stale reminder generation", async () => {
	const router = createStoredRouter();
	const session = createRouterSessionFake();
	router.sessions.set("ps_quiescence", session);
	try {
		const generation = router.runReminderGeneration("ps_quiescence");
		const run = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_quiescence", toolName: "bash" });
		router.invalidateRunReminders(["ps_quiescence"]);
		router.runRegistry.complete(run.runId, { text: "late" });
		router.handleTerminalRunReminder("ps_quiescence", run.runId, generation);
		await nextTurn();

		assert.equal(session.enqueued.length, 0);
		assert.equal(router.runRegistry.hasPendingNotification("ps_quiescence", { includeAlreadyNotified: true }), false);
		assert.equal(router.runRegistry.status("ps_quiescence", run.runId).consumed, false);
	} finally {
		await router.disposeAll();
	}
});

test("subtree disposal keeps the routed object owned until disposal settles and blocks recreation", async () => {
	const router = createStoredRouter();
	const disposeGate = deferred();
	let disposeStarted = false;
	const session = createRouterSessionFake({
		async dispose() {
			disposeStarted = true;
			await disposeGate.promise;
			this.disposed = true;
		},
	});
	router.sessions.set("ps_quiescence", session);

	const disposal = router.disposeSessionSubtree("ps_quiescence", "test disposal", { cancelRuns: false });
	await waitFor(() => disposeStarted, "routed disposal did not start");
	assert.equal(router.sessions.get("ps_quiescence"), session);
	assert.equal(router.disposingSessions.has("ps_quiescence"), true);
	await assert.rejects(router.getOrCreateSession("ps_quiescence"), /quiescing/);

	disposeGate.resolve();
	await disposal;
	assert.equal(router.sessions.has("ps_quiescence"), false);
	assert.equal(router.disposingSessions.has("ps_quiescence"), false);
	assert.equal(router.quiescingSessions.has("ps_quiescence"), false);
	await router.disposeAll();
});

test("stuck routed disposal is bounded, forced terminal, and releases subtree ownership", async () => {
	const router = createStoredRouter("ps_quiescence", { routedSessionDisposeTimeoutMs: 25 });
	const neverSettles = deferred();
	let disposeStarted = false;
	const session = createRouterSessionFake({
		async dispose() {
			disposeStarted = true;
			await neverSettles.promise;
		},
	});
	router.sessions.set("ps_quiescence", session);

	const startedAt = Date.now();
	const disposal = router.disposeSessionSubtree("ps_quiescence", "stuck disposal", { cancelRuns: false });
	await waitFor(() => disposeStarted, "stuck routed disposal did not start");
	await assert.rejects(disposal, (error) => error instanceof AggregateError && error.errors.some((cause) => /Timed out disposing Pibo session/.test(String(cause))));
	assert.ok(Date.now() - startedAt < 500, "bounded disposal exceeded its deterministic deadline");
	assert.equal(session.disposed, true);
	assert.equal(session.forcedDisposals.length, 1);
	assert.match(session.forcedDisposals[0], /bounded disposal timeout/);
	assert.equal(router.sessions.has("ps_quiescence"), false);
	assert.equal(router.disposingSessions.has("ps_quiescence"), false);
	assert.equal(router.quiescingSessions.has("ps_quiescence"), false);
	await router.disposeAll();
});

test("forced disposal terminates a real routed session after its normal drain stalls", async () => {
	const router = createStoredRouter("ps_real_stuck", { routedSessionDisposeTimeoutMs: 25 });
	const promptGate = deferred();
	const promptStarted = deferred();
	let abortCalls = 0;
	let runtimeDisposeCalls = 0;
	const session = {
		model: undefined,
		thinkingLevel: "off",
		isStreaming: true,
		settingsManager: {
			getRetrySettings() { return { enabled: false, maxRetries: 0, baseDelayMs: 0 }; },
			getProviderRetrySettings() { return { maxRetryDelayMs: 0 }; },
		},
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
		subscribe() { return () => {}; },
		supportsThinking() { return false; },
		getActiveToolNames() { return []; },
		setActiveToolsByName() {},
		async prompt() {
			promptStarted.resolve();
			await promptGate.promise;
		},
		async abort() {
			abortCalls += 1;
		},
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {
			runtimeDisposeCalls += 1;
		},
	};
	const routed = new RoutedSession(
		"ps_real_stuck",
		runtime,
		() => {},
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		false,
	);
	router.sessions.set("ps_real_stuck", routed);
	routed.enqueueMessage({
		type: "message",
		piboSessionId: "ps_real_stuck",
		id: "stuck-message",
		text: "stuck turn",
		source: "service",
	});
	await promptStarted.promise;

	const startedAt = Date.now();
	await assert.rejects(
		router.disposeSessionSubtree("ps_real_stuck", "real stuck disposal", { cancelRuns: false }),
		(error) => error instanceof AggregateError && error.errors.some((cause) => /Timed out disposing Pibo session/.test(String(cause))),
	);
	assert.ok(Date.now() - startedAt < 500, "bounded disposal exceeded its deterministic deadline");
	assert.deepEqual(routed.getStatus(), {
		piboSessionId: "ps_real_stuck",
		queuedMessages: 0,
		processing: false,
		streaming: false,
		activeTools: [],
		enabledTools: [],
		cwd: process.cwd(),
		disposed: true,
		thinkingLevel: "off",
		fastMode: false,
		retry: {
			enabled: false,
			maxRetries: 0,
			baseDelayMs: 0,
			provider: { maxRetryDelayMs: 0 },
		},
	});
	assert.equal(abortCalls, 2);
	assert.equal(runtimeDisposeCalls, 1);
	assert.equal(router.sessions.has("ps_real_stuck"), false);
	assert.equal(router.disposingSessions.has("ps_real_stuck"), false);
	assert.equal(router.quiescingSessions.has("ps_real_stuck"), false);

	promptGate.resolve();
	await nextTurn();
	await nextTurn();
	assert.equal(runtimeDisposeCalls, 1);
	await router.disposeAll();
});

test("public dispose suppresses late completion from a force-disposed routed turn", async () => {
	const router = createStoredRouter("ps_public_dispose", { routedSessionDisposeTimeoutMs: 25 });
	const promptGate = deferred();
	const promptStarted = deferred();
	const routerEvents = [];
	router.subscribe((event) => routerEvents.push(event));
	let abortCalls = 0;
	let runtimeDisposeCalls = 0;
	const session = {
		model: undefined,
		thinkingLevel: "off",
		isStreaming: true,
		settingsManager: {
			getRetrySettings() { return { enabled: false, maxRetries: 0, baseDelayMs: 0 }; },
			getProviderRetrySettings() { return { maxRetryDelayMs: 0 }; },
		},
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
		subscribe() { return () => {}; },
		supportsThinking() { return false; },
		getActiveToolNames() { return []; },
		setActiveToolsByName() {},
		async prompt() {
			promptStarted.resolve();
			await promptGate.promise;
		},
		async abort() {
			abortCalls += 1;
		},
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {
			runtimeDisposeCalls += 1;
		},
	};
	const routed = new RoutedSession(
		"ps_public_dispose",
		runtime,
		(event) => router.emitOutput(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		false,
	);
	router.sessions.set("ps_public_dispose", routed);
	routed.enqueueMessage({
		type: "message",
		piboSessionId: "ps_public_dispose",
		id: "stuck-public-message",
		text: "stuck turn",
		source: "service",
	});
	await promptStarted.promise;

	const startedAt = Date.now();
	await assert.rejects(
		router.emit({ type: "execution", piboSessionId: "ps_public_dispose", action: "dispose", id: "dispose-stuck" }),
		(error) => error instanceof AggregateError && error.errors.some((cause) => /Timed out disposing Pibo session/.test(String(cause))),
	);
	assert.ok(Date.now() - startedAt < 500, "public dispose exceeded its deterministic deadline");
	assert.equal(routed.getStatus().disposed, true);
	assert.equal(routed.getStatus().processing, false);
	assert.equal(routed.getStatus().streaming, false);
	assert.equal(abortCalls, 2);
	assert.equal(runtimeDisposeCalls, 1);
	assert.equal(router.sessions.has("ps_public_dispose"), false);
	assert.equal(router.disposingSessions.has("ps_public_dispose"), false);
	assert.equal(router.quiescingSessions.has("ps_public_dispose"), false);

	promptGate.resolve();
	await nextTurn();
	await nextTurn();
	assert.equal(
		routerEvents.some((event) => event.type === "message_finished" && event.eventId === "stuck-public-message"),
		false,
		"late prompt settlement must not emit message_finished after forced disposal",
	);
	assert.equal(runtimeDisposeCalls, 1);
	assert.equal(router.sessions.has("ps_public_dispose"), false);
	assert.equal(router.disposingSessions.has("ps_public_dispose"), false);
	assert.equal(router.quiescingSessions.has("ps_public_dispose"), false);
	await router.disposeAll();
});

test("forced disposal suppresses deferred message preflight work", async () => {
	const router = createStoredRouter("ps_deferred_preflight", { routedSessionDisposeTimeoutMs: 25 });
	const preflightGate = deferred();
	const preflightStarted = deferred();
	const routerEvents = [];
	router.subscribe((event) => routerEvents.push(event));
	let abortCalls = 0;
	let runtimeDisposeCalls = 0;
	let promptCalls = 0;
	const session = {
		model: undefined,
		thinkingLevel: "off",
		isStreaming: true,
		settingsManager: {
			getRetrySettings() { return { enabled: false, maxRetries: 0, baseDelayMs: 0 }; },
			getProviderRetrySettings() { return { maxRetryDelayMs: 0 }; },
		},
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
		subscribe() { return () => {}; },
		supportsThinking() { return false; },
		getActiveToolNames() { return []; },
		setActiveToolsByName() {},
		async prompt() {
			promptCalls += 1;
		},
		async abort() {
			abortCalls += 1;
		},
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {
			runtimeDisposeCalls += 1;
		},
	};
	const routed = new RoutedSession(
		"ps_deferred_preflight",
		runtime,
		(event) => router.emitOutput(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		false,
		undefined,
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		async () => {
			preflightStarted.resolve();
			await preflightGate.promise;
			return { allowed: true };
		},
	);
	router.sessions.set("ps_deferred_preflight", routed);
	routed.enqueueMessage({
		type: "message",
		piboSessionId: "ps_deferred_preflight",
		id: "deferred-preflight-message",
		text: "deferred preflight",
		source: "actor",
	});
	await preflightStarted.promise;

	await assert.rejects(
		router.emit({ type: "execution", piboSessionId: "ps_deferred_preflight", action: "dispose", id: "dispose-preflight" }),
		(error) => error instanceof AggregateError && error.errors.some((cause) => /Timed out disposing Pibo session/.test(String(cause))),
	);
	assert.equal(abortCalls, 2);
	assert.equal(runtimeDisposeCalls, 1);
	assert.equal(router.sessions.has("ps_deferred_preflight"), false);
	assert.equal(router.disposingSessions.has("ps_deferred_preflight"), false);
	assert.equal(router.quiescingSessions.has("ps_deferred_preflight"), false);
	const settledEventCount = routerEvents.length;

	preflightGate.resolve();
	await nextTurn();
	await nextTurn();
	const lateEvents = routerEvents.slice(settledEventCount);
	assert.equal(promptCalls, 0, "deferred preflight must not prompt after runtime disposal");
	assert.equal(
		lateEvents.some((event) => event.type === "message_started" && event.eventId === "deferred-preflight-message"),
		false,
		"deferred preflight must not emit message_started after forced disposal",
	);
	assert.equal(runtimeDisposeCalls, 1);
	assert.equal(router.sessions.has("ps_deferred_preflight"), false);
	assert.equal(router.disposingSessions.has("ps_deferred_preflight"), false);
	assert.equal(router.quiescingSessions.has("ps_deferred_preflight"), false);
	await router.disposeAll();
});

test("forced disposal suppresses deferred queued compaction output", async () => {
	const router = createStoredRouter("ps_deferred_compact", { routedSessionDisposeTimeoutMs: 25 });
	const compactGate = deferred();
	const compactStarted = deferred();
	const routerEvents = [];
	router.subscribe((event) => routerEvents.push(event));
	let abortCalls = 0;
	let runtimeDisposeCalls = 0;
	const session = {
		model: undefined,
		thinkingLevel: "off",
		isStreaming: true,
		settingsManager: {
			getRetrySettings() { return { enabled: false, maxRetries: 0, baseDelayMs: 0 }; },
			getProviderRetrySettings() { return { maxRetryDelayMs: 0 }; },
		},
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
		subscribe() { return () => {}; },
		supportsThinking() { return false; },
		getActiveToolNames() { return []; },
		setActiveToolsByName() {},
		async compact() {
			compactStarted.resolve();
			await compactGate.promise;
			return { compacted: true };
		},
		async abort() {
			abortCalls += 1;
		},
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {
			runtimeDisposeCalls += 1;
		},
	};
	const routed = new RoutedSession(
		"ps_deferred_compact",
		runtime,
		(event) => router.emitOutput(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		false,
	);
	router.sessions.set("ps_deferred_compact", routed);
	await router.emit({ type: "execution", piboSessionId: "ps_deferred_compact", action: "compact", id: "deferred-compact" });
	await compactStarted.promise;

	await assert.rejects(
		router.emit({ type: "execution", piboSessionId: "ps_deferred_compact", action: "dispose", id: "dispose-compact" }),
		(error) => error instanceof AggregateError && error.errors.some((cause) => /Timed out disposing Pibo session/.test(String(cause))),
	);
	assert.equal(abortCalls, 2);
	assert.equal(runtimeDisposeCalls, 1);
	assert.equal(router.sessions.has("ps_deferred_compact"), false);
	assert.equal(router.disposingSessions.has("ps_deferred_compact"), false);
	assert.equal(router.quiescingSessions.has("ps_deferred_compact"), false);
	const settledEventCount = routerEvents.length;

	compactGate.resolve();
	await nextTurn();
	await nextTurn();
	const lateEvents = routerEvents.slice(settledEventCount);
	assert.equal(
		lateEvents.some((event) => event.type === "execution_result" && event.action === "compact" && event.eventId === "deferred-compact"),
		false,
		"deferred compaction must not emit execution_result after forced disposal",
	);
	assert.equal(runtimeDisposeCalls, 1);
	assert.equal(router.sessions.has("ps_deferred_compact"), false);
	assert.equal(router.disposingSessions.has("ps_deferred_compact"), false);
	assert.equal(router.quiescingSessions.has("ps_deferred_compact"), false);
	await router.disposeAll();
});

test("handling every notified run clears future reminders", async () => {
	const router = createStoredRouter();
	const session = createRouterSessionFake();
	router.sessions.set("ps_quiescence", session);
	try {
		const first = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_quiescence", toolName: "bash" });
		const second = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_quiescence", toolName: "bash" });
		router.runRegistry.complete(first.runId, { text: "first" });
		router.runRegistry.complete(second.runId, { text: "second" });
		assert.ok(router.runRegistry.createNotification("ps_quiescence"));
		const controller = router.createRunToolController("ps_quiescence");

		controller.readRun(first.runId);
		controller.readRun(second.runId);
		assert.equal(router.runRegistry.hasPendingNotification("ps_quiescence", { includeAlreadyNotified: true }), false);
	} finally {
		await router.disposeAll();
	}
});

test("run-reminder turns retain the normal agent toolset", async () => {
	const router = createStoredRouter("ps_capability");
	const run = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_capability", toolName: "bash" });
	router.runRegistry.complete(run.runId, { text: "done" });
	assert.ok(router.runRegistry.createNotification("ps_capability"));
	const controller = router.createRunToolController("ps_capability");
	const promptGate = deferred();
	const promptStarted = deferred();
	const events = [];
	const activeTools = ["bash", "read", "pibo_run_start", "pibo_run_status", "pibo_run_wait", "pibo_run_read", "pibo_run_cancel", "pibo_run_ack"];
	let toolsAfterFinalRead = [];
	const toolTransitions = [];
	const session = {
		model: undefined,
		thinkingLevel: "off",
		isStreaming: false,
		settingsManager: {
			getRetrySettings() { return { enabled: false, maxRetries: 0, baseDelayMs: 0 }; },
			getProviderRetrySettings() { return { maxRetryDelayMs: 0 }; },
		},
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
		subscribe() { return () => {}; },
		supportsThinking() { return false; },
		getActiveToolNames() { return [...activeTools]; },
		setActiveToolsByName(names) {
			toolTransitions.push([...names]);
		},
		async prompt() {
			assert.equal(controller.readRun(run.runId).consumed, true);
			toolsAfterFinalRead = this.getActiveToolNames();
			promptStarted.resolve();
			await promptGate.promise;
		},
		async abort() {},
	};
	const runtime = {
		cwd: process.cwd(),
		session,
		setRebindSession() {},
		async dispose() {},
	};
	const routed = new RoutedSession(
		"ps_capability",
		runtime,
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		false,
	);
	router.sessions.set("ps_capability", routed);

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "ps_capability",
		id: "reminder-1",
		text: "<pibo_run_notification>{}</pibo_run_notification>",
		source: "service",
	});
	await promptStarted.promise;
	assert.deepEqual(toolsAfterFinalRead, activeTools);
	assert.equal(router.runRegistry.hasPendingNotification("ps_capability", { includeAlreadyNotified: true }), false);

	promptGate.resolve();
	await waitFor(() => events.some((event) => event.type === "message_finished" && event.eventId === "reminder-1"), "run-reminder turn did not finish");
	assert.deepEqual(toolTransitions, []);
	await router.disposeAll();
});

test("run-reminder turns stop repeated identical tool loops", async () => {
	const events = [];
	let listener;
	let aborts = 0;
	const session = {
		model: undefined,
		thinkingLevel: "off",
		isStreaming: false,
		settingsManager: {
			getRetrySettings() { return { enabled: false, maxRetries: 0, baseDelayMs: 0 }; },
			getProviderRetrySettings() { return { maxRetryDelayMs: 0 }; },
		},
		resourceLoader: { getSkills() { return { skills: [] }; } },
		sessionManager: {
			getLeafId() { return null; },
			getHeader() { return undefined; },
		},
		subscribe(next) { listener = next; return () => {}; },
		supportsThinking() { return false; },
		getActiveToolNames() { return ["bash", "pibo_run_status", "pibo_run_ack"]; },
		setActiveToolsByName() {},
		async prompt() {
			for (let index = 0; index < 13; index += 1) {
				listener({
					type: "tool_execution_start",
					toolCallId: `tool-${index}`,
					toolName: "pibo_run_status",
					args: { runId: "run-1" },
				});
			}
		},
		async abort() { aborts += 1; },
	};
	const routed = new RoutedSession(
		"ps_guard",
		{ cwd: process.cwd(), session, setRebindSession() {}, async dispose() {} },
		(event) => events.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		false,
	);

	routed.enqueueMessage({
		type: "message",
		piboSessionId: "ps_guard",
		id: "reminder-guard",
		text: "<pibo_run_notification>{}</pibo_run_notification>",
		source: "service",
	});

	await waitFor(() => events.some((event) => event.type === "session_error" && event.errorDetails?.code === "run_reminder_limit_exceeded"), "run-reminder limit did not stop the turn");
	assert.equal(aborts, 1);
	assert.equal(events.some((event) => event.type === "message_finished" && event.eventId === "reminder-guard"), false);
	await routed.dispose();
});
