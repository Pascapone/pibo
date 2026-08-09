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
		releasedScopes: 0,
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
		releaseRunReminderCapabilityScope() {
			this.releasedScopes += 1;
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

test("handling every notified run cannot release the reminder scope mid-turn", async () => {
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
		assert.equal(session.releasedScopes, 0);
		controller.readRun(second.runId);
		assert.equal(session.releasedScopes, 0);
		assert.equal(router.runRegistry.hasPendingNotification("ps_quiescence", { includeAlreadyNotified: true }), false);
	} finally {
		await router.disposeAll();
	}
});

test("run-reminder turns retain lifecycle-only tools after the final run is read", async () => {
	const router = createStoredRouter("ps_capability");
	const run = router.runRegistry.startToolRun({ controllerPiboSessionId: "ps_capability", toolName: "bash" });
	router.runRegistry.complete(run.runId, { text: "done" });
	assert.ok(router.runRegistry.createNotification("ps_capability"));
	const controller = router.createRunToolController("ps_capability");
	const promptGate = deferred();
	const promptStarted = deferred();
	const events = [];
	const activeTools = ["bash", "read", "pibo_run_start", "pibo_run_status", "pibo_run_wait", "pibo_run_read", "pibo_run_cancel", "pibo_run_ack"];
	let currentTools = [...activeTools];
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
		getActiveToolNames() { return [...currentTools]; },
		setActiveToolsByName(names) {
			currentTools = [...names];
			toolTransitions.push([...names]);
		},
		async prompt() {
			assert.equal(controller.readRun(run.runId).consumed, true);
			toolsAfterFinalRead = [...currentTools];
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
		capabilityScope: "run-reminder",
	});
	await promptStarted.promise;
	assert.deepEqual(toolsAfterFinalRead, ["pibo_run_status", "pibo_run_wait", "pibo_run_read", "pibo_run_cancel", "pibo_run_ack"]);
	assert.equal(toolsAfterFinalRead.includes("bash"), false);
	assert.equal(toolsAfterFinalRead.includes("pibo_run_start"), false);
	assert.equal(router.runRegistry.hasPendingNotification("ps_capability", { includeAlreadyNotified: true }), false);

	promptGate.resolve();
	await waitFor(() => events.some((event) => event.type === "message_finished" && event.eventId === "reminder-1"), "run-reminder turn did not finish");
	assert.deepEqual(currentTools, activeTools);
	assert.deepEqual(toolTransitions, [
		["pibo_run_status", "pibo_run_wait", "pibo_run_read", "pibo_run_cancel", "pibo_run_ack"],
		activeTools,
	]);
	await router.disposeAll();
});
