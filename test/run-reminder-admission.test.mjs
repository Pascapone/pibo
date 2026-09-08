import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMinimalAgentRuntimeCapabilities } from "../dist/agent-runtime/capabilities.js";
import { RuntimeRoutedSession } from "../dist/agent-runtime/routed-session.js";
import { createFakeAgentRuntimeDriver } from "../dist/agent-runtime/testing/fake-adapter.js";
import { traceProjectionStatus } from "../dist/apps/chat/chat-trace-helpers.js";
import { ChatTimelineQueryService } from "../dist/apps/chat/data/timeline-query-service.js";
import { InitialSessionContextBuilder } from "../dist/core/profiles.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { piboCorePlugin } from "../dist/plugins/builtin.js";
import { definePiboPlugin, PiboPluginRegistry } from "../dist/plugins/registry.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";

function deferred() {
	let resolve;
	const promise = new Promise((done) => { resolve = done; });
	return { promise, resolve };
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) assert.fail(message);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function reminderText(state) {
	return `<pibo_run_notification>${JSON.stringify(state)}</pibo_run_notification>`;
}

function createBlockingRoutedFixture(now) {
	const release = deferred();
	const outputs = [];
	const prompts = [];
	let promptIndex = 0;
	let streaming = false;
	const runtimeSession = {
		adapterId: "queue-admission-fake",
		runtimeInstanceId: "queue-admission-fake",
		cwd: process.cwd(),
		capabilities: createMinimalAgentRuntimeCapabilities(),
		getBinding: () => ({
			piboSessionId: "ps_queue_admission",
			runtimeInstanceId: "queue-admission-fake",
			adapterId: "queue-admission-fake",
			state: "bound",
		}),
		subscribe() { return () => {}; },
		async prompt(input) {
			prompts.push(input.text);
			streaming = true;
			promptIndex += 1;
			if (promptIndex === 1) await release.promise;
			streaming = false;
		},
		async abort() { release.resolve(); streaming = false; },
		async dispose() { release.resolve(); streaming = false; },
		getStatus: () => ({ streaming, enabledTools: [], cwd: process.cwd() }),
	};
	const routed = new RuntimeRoutedSession(
		"ps_queue_admission",
		runtimeSession,
		(event) => outputs.push(event),
		PiboPluginRegistry.create({ plugins: [piboCorePlugin] }),
		{ now },
	);
	return { routed, release, outputs, prompts };
}

test("a stale queued run reminder is atomically replaced without poisoning ordinary admission", async () => {
	let now = 1_000;
	const fixture = createBlockingRoutedFixture(() => now);
	try {
		fixture.routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_queue_admission",
			id: "active-user",
			text: "keep working",
			source: "user",
		});
		await waitFor(() => fixture.routed.getStatus().streaming, "active turn did not start");

		fixture.routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_queue_admission",
			id: "reminder-old",
			text: reminderText({ running: [{ runId: "run-1" }] }),
			source: "service",
		});
		now += 10 * 60 * 1000 + 1;
		fixture.routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_queue_admission",
			id: "reminder-current",
			text: reminderText({ completed: [{ runId: "run-1" }] }),
			source: "service",
		});
		fixture.routed.enqueueMessage({
			type: "message",
			piboSessionId: "ps_queue_admission",
			id: "later-user",
			text: "still accept ordinary work",
			source: "user",
		});

		assert.deepEqual(fixture.routed.getStatus().queuedEventIds, ["reminder-current", "later-user"]);
		assert.equal(fixture.routed.getStatus().queuedMessages, 2);
		fixture.release.resolve();
		await waitFor(() => fixture.prompts.length === 3 && !fixture.routed.getStatus().processing, "coalesced queue did not drain");
		assert.deepEqual(fixture.prompts, [
			"keep working",
			reminderText({ completed: [{ runId: "run-1" }] }),
			"still accept ordinary work",
		]);
		assert.equal(fixture.outputs.some((event) => event.type === "session_error"), false);
	} finally {
		fixture.release.resolve();
		await fixture.routed.dispose();
	}
});

test("ordinary runtime queue capacity errors identify each bounded dimension without message content", async (t) => {
	async function withActiveFixture(run) {
		let now = 5_000;
		const fixture = createBlockingRoutedFixture(() => now);
		try {
			fixture.routed.enqueueMessage({ type: "message", piboSessionId: "ps_queue_admission", id: "active", text: "active secret", source: "user" });
			await waitFor(() => fixture.routed.getStatus().streaming, "capacity fixture did not start");
			await run(fixture.routed, { advance(ms) { now += ms; } });
		} finally {
			fixture.release.resolve();
			await fixture.routed.dispose();
		}
	}

	function assertCapacity(error, dimension) {
		assert.equal(error?.code, "runtime_capacity_unavailable");
		assert.equal(error?.dimension, dimension);
		assert.equal(typeof error?.limit, "number");
		assert.deepEqual(Object.keys(error?.current ?? {}).sort(), ["messageBytes", "oldestWaitMs", "queueBytes", "queueCount"]);
		assert.doesNotMatch(error?.message ?? "", /active secret|queued secret/);
		return true;
	}

	await t.test("message_bytes", async () => withActiveFixture(async (routed) => {
		assert.throws(() => routed.enqueueMessage({ type: "message", piboSessionId: "ps_queue_admission", id: "too-large", text: "x".repeat(1024 * 1024 + 1), source: "user" }), (error) => assertCapacity(error, "message_bytes"));
	}));
	await t.test("queue_count", async () => withActiveFixture(async (routed) => {
		for (let index = 0; index < 64; index += 1) routed.enqueueMessage({ type: "message", piboSessionId: "ps_queue_admission", id: `count-${index}`, text: "queued secret", source: "user" });
		assert.throws(() => routed.enqueueMessage({ type: "message", piboSessionId: "ps_queue_admission", id: "count-over", text: "queued secret", source: "user" }), (error) => assertCapacity(error, "queue_count"));
	}));
	await t.test("queue_bytes", async () => withActiveFixture(async (routed) => {
		for (let index = 0; index < 4; index += 1) routed.enqueueMessage({ type: "message", piboSessionId: "ps_queue_admission", id: `bytes-${index}`, text: "x".repeat(1024 * 1024), source: "user" });
		assert.throws(() => routed.enqueueMessage({ type: "message", piboSessionId: "ps_queue_admission", id: "bytes-over", text: "x", source: "user" }), (error) => assertCapacity(error, "queue_bytes"));
	}));
	await t.test("oldest_wait_age", async () => withActiveFixture(async (routed, clock) => {
		routed.enqueueMessage({ type: "message", piboSessionId: "ps_queue_admission", id: "oldest", text: "queued secret", source: "user" });
		clock.advance(10 * 60 * 1000);
		assert.throws(() => routed.enqueueMessage({ type: "message", piboSessionId: "ps_queue_admission", id: "age-over", text: "new", source: "user" }), (error) => assertCapacity(error, "oldest_wait_age"));
	}));
});

test("real routed reminder coalescing keeps persistence, live signals, and trace on the active user turn", async () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-reminder-admission-"));
	const dataStore = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const sessionStore = new PiboDataSessionStore(dataStore);
	const ingest = new ChatDataIngestService(dataStore);
	const roomId = "room_reminder_admission";
	let now = Date.parse("2026-09-08T17:18:39.509Z");
	const fakeDriver = createFakeAgentRuntimeDriver({
		adapterId: "reminder-integration-fake",
		script: (_input, promptIndex) => promptIndex === 1
			? { waitForAbort: true }
			: { events: [{ type: "assistant_message", text: "run state inspected" }] },
	});
	const registry = PiboPluginRegistry.create({
		plugins: [
			piboCorePlugin,
			definePiboPlugin({
				id: "test.reminder-integration",
				register(api) {
					api.registerAgentRuntimeDriver(fakeDriver);
					api.registerAgentRuntimeInstance({ id: "reminder-integration-fake", adapterId: "reminder-integration-fake" });
					api.registerProfile({
						name: "reminder-integration-profile",
						create() {
							return new InitialSessionContextBuilder("reminder-integration-profile")
								.withAgentRuntime("reminder-integration-fake")
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
	const session = sessionStore.create({
		id: "ps_reminder_integration",
		runtimeBinding: { runtimeInstanceId: "reminder-integration-fake", adapterId: "reminder-integration-fake", state: "unbound" },
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "reminder-integration-profile",
		workspace: process.cwd(),
		title: "Reminder integration",
		metadata: { chatRoomId: roomId },
	});
	dataStore.navigation.upsertSession({
		roomId,
		sessionId: session.id,
		rootSessionId: session.id,
		title: session.title,
		profile: session.profile,
		status: "idle",
		lastActivityAt: new Date(now).toISOString(),
		sortKey: new Date(now).toISOString(),
		updatedAt: new Date(now).toISOString(),
	});
	const router = new PiboSessionRouter({
		persistSession: false,
		pluginRegistry: registry,
		sessionStore,
		routedSessionIdleTimeoutMs: false,
		runtimeQueueNow: () => now,
	});
	const outputs = [];
	router.subscribe((event) => {
		outputs.push(event);
		ingest.ingestOutputEvent({ session: sessionStore.get(session.id), roomId, actorId: "integration", event });
	});

	try {
		ingest.ingestUserMessageAccepted({ session, roomId, actorId: "user:test", text: "continue the long task", clientTxnId: "reminder-integration-user" });
		await router.emit({ type: "message", piboSessionId: session.id, id: "active-user-event", text: "continue the long task", source: "user" });
		const adapter = registry.requireAgentRuntimeAdapter("reminder-integration-fake");
		await waitFor(() => adapter.sessions[0]?.prompts.length === 1, "real routed user turn did not start");

		const runOne = router.runRegistry.startToolRun({ controllerPiboSessionId: session.id, toolName: "bash" });
		const runTwo = router.runRegistry.startToolRun({ controllerPiboSessionId: session.id, toolName: "bash" });
		const generation = router.runReminderGeneration(session.id);
		router.scheduleRunReminder(session.id, false, generation);
		await waitFor(() => router.getSessionRuntimeStatus(session.id)?.queuedMessages === 1, "initial reminder was not queued");
		const initialReminderId = router.getSessionRuntimeStatus(session.id).queuedEventIds[0];

		now += 10 * 60 * 1000 + 1;
		router.runRegistry.complete(runOne.runId, { text: "one" });
		router.handleTerminalRunReminder(session.id, runOne.runId, generation);
		await waitFor(() => router.getSessionRuntimeStatus(session.id)?.queuedEventIds[0] !== initialReminderId, "stale reminder was not replaced");
		const secondReminderId = router.getSessionRuntimeStatus(session.id).queuedEventIds[0];
		router.runRegistry.fail(runTwo.runId, "two failed");
		router.handleTerminalRunReminder(session.id, runTwo.runId, generation);
		await waitFor(() => router.getSessionRuntimeStatus(session.id)?.queuedEventIds[0] !== secondReminderId, "latest terminal state was not coalesced");

		const latestReminder = outputs.findLast((event) => event.type === "message_queued" && event.source === "service");
		assert.match(latestReminder.text, new RegExp(runOne.runId));
		assert.match(latestReminder.text, new RegExp(runTwo.runId));
		assert.equal(outputs.filter((event) => event.type === "message_queued" && event.source === "service").length, 3);
		assert.equal(router.getSessionRuntimeStatus(session.id).queuedEventIds.length, 1, "only one effective queued reminder remains");

		// Genuine ordinary queue pressure defers (rather than terminalizes) the
		// replacement, while retaining all current run state for a later retry.
		for (let index = 0; index < 64; index += 1) {
			await router.emit({ type: "message", piboSessionId: session.id, id: `queued-user-${index}`, text: `queued user ${index}`, source: "user" });
		}
		const runThree = router.runRegistry.startToolRun({ controllerPiboSessionId: session.id, toolName: "bash" });
		router.runRegistry.complete(runThree.runId, { text: "three" });
		router.handleTerminalRunReminder(session.id, runThree.runId, generation);
		await waitFor(() => router.getSessionRuntimeStatus(session.id)?.warnings?.some((warning) => warning.includes("queue_count")), "capacity deferral warning was not exposed");

		const runtimeStatus = router.getSessionRuntimeStatus(session.id);
		assert.equal(runtimeStatus.processing, true);
		assert.equal(runtimeStatus.streaming, true);
		assert.equal(runtimeStatus.queuedMessages, 64);
		assert.equal(runtimeStatus.queuedEventIds.some((eventId) => eventId === latestReminder.eventId), false, "deferred stale snapshot was atomically removed");
		assert.equal(outputs.some((event) => event.type === "session_error" && event.errorDetails?.code === "runtime_capacity_unavailable"), false);
		assert.equal(router.runRegistry.hasPendingNotification(session.id), true);
		assert.equal(router.runRegistry.status(session.id, runOne.runId).consumed, false);
		assert.equal(router.runRegistry.status(session.id, runTwo.runId).consumed, false);
		assert.equal(router.runRegistry.status(session.id, runThree.runId).consumed, false);

		const durableSession = dataStore.db.prepare("SELECT status FROM sessions WHERE id = ?").get(session.id);
		const durableNavigation = dataStore.navigation.getSession(session.id);
		assert.equal(durableSession.status, "running");
		assert.equal(durableNavigation.status, "running");
		const signal = router.snapshotSignalSession(session.id).sessions[session.id];
		assert.equal(signal.latestTurn.state, "running");
		assert.equal(signal.hasError, false);
		const timeline = new ChatTimelineQueryService(dataStore);
		const traceEvents = timeline.listAllSessionEvents(session.id);
		const turnTimings = timeline.listMessageTurnTimings(session.id);
		const trace = buildTraceViewFromEvents({
			session: { id: session.id, piSessionId: session.piSessionId, title: session.title },
			events: traceEvents,
			status: "running",
			turnTimings,
		});
		assert.equal(trace.nodes.find((node) => node.id === "event:message:active-user-event")?.status, "running");
		assert.equal(trace.nodes.some((node) => node.type === "agent.turn" && node.status === "error"), false);
		assert.equal(trace.nodes.some((node) => node.title === "Session Error"), false);
		assert.equal(traceProjectionStatus([], "running", turnTimings, runtimeStatus), "running");

		await adapter.sessions[0].abort();
		await waitFor(() => adapter.sessions[0].prompts.length === 66, "pending reminder did not run after queued user work drained");
		await waitFor(() => outputs.some((event) => event.type === "message_finished" && event.source === "service"), "pending reminder did not finish");
		const deliveredReminder = adapter.sessions[0].prompts.at(-1).text;
		assert.match(deliveredReminder, new RegExp(runOne.runId));
		assert.match(deliveredReminder, new RegExp(runTwo.runId));
		assert.match(deliveredReminder, new RegExp(runThree.runId));
		assert.equal(router.getSessionRuntimeStatus(session.id).warnings, undefined, "successful retry clears the deferral warning");
		assert.equal(router.runRegistry.status(session.id, runOne.runId).consumed, false, "delivery must not consume a completed run");
		assert.equal(router.runRegistry.status(session.id, runTwo.runId).consumed, false, "delivery must not acknowledge a failed run");
		assert.equal(router.runRegistry.status(session.id, runThree.runId).consumed, false, "delivery must not consume a later completed run");
	} finally {
		await router.disposeAll();
		dataStore.close();
		rmSync(root, { recursive: true, force: true });
	}
});
