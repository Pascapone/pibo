import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";
import { PiboRunRegistry } from "../dist/runs/registry.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

async function settleMicrotasks() {
	for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function createFixture(name) {
	const root = await mkdtemp(join(tmpdir(), `${name}-`));
	const dataStore = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const sessionStore = new PiboDataSessionStore(dataStore);
	const reliabilityStore = new PiboReliabilityStore(join(root, "pibo-events.sqlite"));
	const roomId = "room_restart_recovery";
	const session = sessionStore.create({
		id: "ps_restart_recovery",
		piSessionId: "11111111-2222-4333-8444-555555555555",
		channel: "pibo.chat",
		kind: "chat",
		profile: "base",
		title: "Interrupted review",
		metadata: { chatRoomId: roomId },
	});
	dataStore.navigation.upsertSession({
		roomId,
		sessionId: session.id,
		rootSessionId: session.id,
		title: session.title,
		profile: session.profile,
		status: "running",
		lastActivityAt: "2026-08-09T14:34:51.070Z",
		sortKey: "2026-08-09T14:34:51.070Z",
		updatedAt: "2026-08-09T14:34:51.070Z",
	});
	return {
		root,
		dataStore,
		sessionStore,
		reliabilityStore,
		roomId,
		session,
		async close() {
			reliabilityStore.close();
			dataStore.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}

function seedInterruptedRuntime(fixture, { timeoutAt, retryable = false, maxAttempts = 1 } = {}) {
	const { dataStore, reliabilityStore, roomId, session } = fixture;
	const ingest = new ChatDataIngestService(dataStore);
	const eventId = "evt_restart_main";
	const turnId = `turn_${eventId}`;
	const reminderEventId = "evt_restart_reminder";
	const reminderTurnId = `turn_${reminderEventId}`;
	const startedAt = "2026-08-09T14:34:27.522Z";

	ingest.ingestOutputEvent({
		session,
		roomId,
		event: { type: "message_queued", piboSessionId: session.id, eventId, queuedMessages: 1, text: "Run the build", source: "user" },
		createdAt: startedAt,
	});
	ingest.ingestOutputEvent({
		session,
		roomId,
		event: { type: "message_started", piboSessionId: session.id, eventId, text: "Run the build", source: "user" },
		createdAt: startedAt,
	});
	ingest.ingestOutputEvent({
		session,
		roomId,
		event: { type: "message_queued", piboSessionId: session.id, eventId: reminderEventId, queuedMessages: 1, text: "<pibo_run_notification>{}</pibo_run_notification>", source: "service" },
		createdAt: "2026-08-09T14:34:51.070Z",
	});

	dataStore.telemetry.upsertTurn({
		turnId,
		piboSessionId: session.id,
		rootSessionId: session.id,
		roomId,
		eventId,
		source: "user",
		status: "running",
		currentPhase: "tool_execution",
		queuedAt: startedAt,
		startedAt,
		lastProgressAt: "2026-08-09T14:34:51.070Z",
		queueDepth: 1,
	});
	for (const [phaseId, name, toolCallId] of [
		[`${turnId}:provider_stream:request`, "provider_stream", undefined],
		[`${turnId}:tool_execution:one`, "tool_execution", "call_one"],
		[`${turnId}:tool_execution:two`, "tool_execution", "call_two"],
	]) {
		dataStore.telemetry.upsertPhase({ phaseId, turnId, piboSessionId: session.id, rootSessionId: session.id, roomId, name, status: "open", startedAt, lastProgressAt: "2026-08-09T14:34:51.070Z", eventId, toolCallId });
	}
	dataStore.telemetry.upsertProviderRequest({
		providerRequestId: "pr_restart_open",
		piboSessionId: session.id,
		rootSessionId: session.id,
		roomId,
		turnId,
		phaseId: `${turnId}:provider_stream:request`,
		provider: "openai-codex",
		api: "openai-responses",
		model: "gpt-5.6-sol",
		status: "streaming",
		startedAt,
	});
	for (const toolCallId of ["call_one", "call_two"]) {
		dataStore.telemetry.upsertToolCall({
			toolCallId,
			piboSessionId: session.id,
			rootSessionId: session.id,
			roomId,
			turnId,
			providerRequestId: "pr_restart_open",
			toolName: "bash",
			status: "executing",
			argsStartedAt: startedAt,
			argsCompletedAt: startedAt,
			executionStartedAt: startedAt,
			argsBytes: 2,
			parseStatus: "complete",
			safeArgKeys: ["command"],
			eventId,
		});
	}
	dataStore.telemetry.upsertTurn({
		turnId: reminderTurnId,
		piboSessionId: session.id,
		rootSessionId: session.id,
		roomId,
		eventId: reminderEventId,
		source: "system",
		status: "queued",
		currentPhase: "queued",
		queuedAt: "2026-08-09T14:34:51.070Z",
		queueDepth: 1,
	});
	dataStore.telemetry.upsertPhase({
		phaseId: `${reminderTurnId}:queued`,
		turnId: reminderTurnId,
		piboSessionId: session.id,
		rootSessionId: session.id,
		roomId,
		name: "queued",
		status: "open",
		startedAt: "2026-08-09T14:34:51.070Z",
		eventId: reminderEventId,
	});

	const run = reliabilityStore.createRun({
		runId: "run_restart_recovery",
		controllerPiboSessionId: session.id,
		toolName: "bash",
		completionPolicy: "tracked",
		retryable,
		maxAttempts,
		timeoutMs: 60_000,
		workerId: "run-registry:previous-runtime",
	});
	if (timeoutAt) reliabilityStore.updateRun(run.runId, { timeoutAt });
	return { eventId, turnId, reminderEventId, reminderTurnId, runId: run.runId };
}

function rows(db, sql, ...params) {
	return db.prepare(sql).all(...params);
}

test("startup recovery terminalizes interrupted yielded-run session state atomically and idempotently", async () => {
	const fixture = await createFixture("pibo-runtime-restart-timeout");
	try {
		const ids = seedInterruptedRuntime(fixture, { timeoutAt: "2026-08-09T14:44:27.522Z" });
		const observerRouter = new PiboSessionRouter({ sessionStore: fixture.sessionStore, persistSession: false });
		try {
			assert.equal(fixture.dataStore.telemetry.getTurn(ids.turnId).status, "running", "non-authoritative routers must not reconcile gateway state");
		} finally {
			await observerRouter.disposeAll();
		}
		const router = new PiboSessionRouter({ sessionStore: fixture.sessionStore, reliabilityStore: fixture.reliabilityStore, recoverInterruptedRuntimeState: true });
		try {
			const run = fixture.reliabilityStore.getRun(ids.runId);
			assert.equal(run.status, "timed_out");
			assert.equal(run.timeoutPhase, "lifetime");

			const main = fixture.dataStore.telemetry.getTurn(ids.turnId);
			const reminder = fixture.dataStore.telemetry.getTurn(ids.reminderTurnId);
			assert.equal(main.status, "timeout");
			assert.equal(main.currentPhase, "timeout");
			assert.ok(main.completedAt);
			assert.equal(reminder.status, "aborted");
			assert.equal(reminder.currentPhase, "abort");
			assert.ok(reminder.completedAt);
			assert.deepEqual(fixture.dataStore.telemetry.listOpenPhasesForTurn(ids.turnId), []);
			assert.deepEqual(fixture.dataStore.telemetry.listOpenPhasesForTurn(ids.reminderTurnId), []);
			assert.deepEqual(fixture.dataStore.telemetry.listActiveProviderRequestsForTurn(ids.turnId), []);
			assert.deepEqual(fixture.dataStore.telemetry.listActiveToolCallsForTurn(ids.turnId), []);
			assert.equal(fixture.dataStore.telemetry.getProviderRequest("pr_restart_open").status, "timeout");
			assert.equal(fixture.dataStore.telemetry.getToolCall("call_one").status, "timeout");
			assert.equal(fixture.dataStore.telemetry.getToolCall("call_two").status, "timeout");

			const sessionRow = fixture.dataStore.db.prepare("SELECT status FROM sessions WHERE id = ?").get(fixture.session.id);
			assert.equal(sessionRow.status, "error");
			assert.equal(fixture.dataStore.navigation.getSession(fixture.session.id).status, "error");
			const errors = rows(fixture.dataStore.db, "SELECT event_id, attributes_json FROM event_log WHERE session_id = ? AND type = 'session_error' ORDER BY stream_id", fixture.session.id);
			assert.deepEqual(errors.map((row) => row.event_id), [ids.eventId, ids.reminderEventId]);
			assert.ok(errors.every((row) => JSON.parse(row.attributes_json).errorDetails.category === "runtime_restart"));
			assert.equal(fixture.dataStore.telemetry.listStaleWork({ now: "2026-08-09T16:00:00.000Z", thresholdMs: 1 }).length, 0);
			const signal = router.snapshotSignalSession(fixture.session.id);
			assert.equal(signal.sessions[fixture.session.id].localStatus, "error");
			assert.equal(signal.sessions[fixture.session.id].aggregateStatus, "error");
		} finally {
			await router.disposeAll();
		}

		const secondRouter = new PiboSessionRouter({ sessionStore: fixture.sessionStore, reliabilityStore: fixture.reliabilityStore, recoverInterruptedRuntimeState: true });
		try {
			const errors = rows(fixture.dataStore.db, "SELECT event_id FROM event_log WHERE session_id = ? AND type = 'session_error'", fixture.session.id);
			assert.equal(errors.length, 2, "repeated startup must not duplicate recovery events");
		} finally {
			await secondRouter.disposeAll();
		}
	} finally {
		await fixture.close();
	}
});

test("startup recovery aborts non-expired retryable work without changing already-terminal turns", async () => {
	const fixture = await createFixture("pibo-runtime-restart-retry");
	try {
		const ids = seedInterruptedRuntime(fixture, { timeoutAt: "2099-01-01T00:00:00.000Z", retryable: true, maxAttempts: 2 });
		fixture.dataStore.telemetry.upsertTurn({
			turnId: "turn_already_done",
			piboSessionId: fixture.session.id,
			rootSessionId: fixture.session.id,
			roomId: fixture.roomId,
			eventId: "evt_already_done",
			source: "user",
			status: "ok",
			currentPhase: "finish",
			queuedAt: "2026-08-09T13:00:00.000Z",
			startedAt: "2026-08-09T13:00:00.000Z",
			completedAt: "2026-08-09T13:01:00.000Z",
		});

		const router = new PiboSessionRouter({ sessionStore: fixture.sessionStore, reliabilityStore: fixture.reliabilityStore, recoverInterruptedRuntimeState: true });
		try {
			assert.equal(fixture.reliabilityStore.getRun(ids.runId).status, "queued");
			assert.equal(fixture.dataStore.telemetry.getTurn(ids.turnId).status, "aborted");
			assert.equal(fixture.dataStore.telemetry.getTurn(ids.reminderTurnId).status, "aborted");
			assert.equal(fixture.dataStore.telemetry.getTurn("turn_already_done").status, "ok");
		} finally {
			await router.disposeAll();
		}
	} finally {
		await fixture.close();
	}
});

test("startup schedules persisted terminal run notifications once across router restarts", async () => {
	const root = await mkdtemp(join(tmpdir(), "pibo-recovered-run-notifications-"));
	const dataPath = join(root, "pibo.sqlite");
	const reliabilityPath = join(root, "pibo-events.sqlite");
	const piboSessionId = "ps_recovered_run_notifications";
	let dataStore;
	let reliabilityStore;
	let current;
	try {
		dataStore = new PiboDataStore(dataPath, { payloadRootDir: join(root, "payloads") });
		new PiboDataSessionStore(dataStore).create({
			id: piboSessionId,
			piSessionId: "22222222-3333-4444-8555-666666666666",
			channel: "pibo.chat-web",
			kind: "chat",
			profile: "base",
		});
		dataStore.close();

		reliabilityStore = new PiboReliabilityStore(reliabilityPath);
		const oldRegistry = new PiboRunRegistry({ store: reliabilityStore, workerId: "run-registry:before-notification-restart" });
		const completed = oldRegistry.startToolRun({ controllerPiboSessionId: piboSessionId, toolName: "completed-check", completionPolicy: "tracked" });
		oldRegistry.complete(completed.runId, { text: "durable completed result" });
		const interrupted = oldRegistry.startToolRun({ controllerPiboSessionId: piboSessionId, toolName: "interrupted-check", completionPolicy: "tracked" });
		reliabilityStore.close();

		async function startRouter() {
			dataStore = new PiboDataStore(dataPath, { payloadRootDir: join(root, "payloads") });
			const sessionStore = new PiboDataSessionStore(dataStore);
			reliabilityStore = new PiboReliabilityStore(reliabilityPath);
			const messages = [];
			const router = new PiboSessionRouter({
				sessionStore,
				reliabilityStore,
				recoverInterruptedRuntimeState: true,
				persistSession: true,
			});
			const scheduledAtConstruction = router.scheduledRunReminders.size;
			router.getOrCreateSession = async () => ({
				enqueueMessage(event) {
					messages.push(event);
					return { type: "message_queued", piboSessionId: event.piboSessionId, eventId: event.id, queuedMessages: messages.length };
				},
			});
			await settleMicrotasks();
			return { router, messages, scheduledAtConstruction };
		}

		current = await startRouter();
		assert.equal(current.scheduledAtConstruction, 1, "startup must coalesce both terminal rows into one scheduled controller reminder");
		assert.equal(current.messages.length, 1);
		assert.match(current.messages[0].text, new RegExp(completed.runId));
		assert.match(current.messages[0].text, new RegExp(interrupted.runId));
		assert.equal(reliabilityStore.getRun(completed.runId).status, "completed");
		assert.equal(reliabilityStore.getRun(interrupted.runId).status, "failed");
		assert.equal(reliabilityStore.getRun(completed.runId).notifiedStatus, "completed");
		assert.equal(reliabilityStore.getRun(interrupted.runId).notifiedStatus, "failed");
		assert.equal(reliabilityStore.getRun(completed.runId).consumed, false);
		assert.equal(reliabilityStore.getRun(interrupted.runId).consumed, false);
		assert.equal(current.router.runRegistry.hasPendingNotification(piboSessionId), false);

		current.router.emitOutput({ type: "message_finished", piboSessionId, eventId: current.messages[0].id, source: "service" });
		await settleMicrotasks();
		assert.equal(current.messages.length, 1, "finishing the startup reminder must not duplicate its current notified state");
		assert.equal(current.router.runReminderDeliveries.size, 0);

		current.router.emitOutput({ type: "message_finished", piboSessionId, eventId: "ordinary-turn-control", source: "user" });
		await settleMicrotasks();
		assert.equal(current.messages.length, 2, "ordinary turn-end must preserve the established unconsumed-run reminder behavior");
		assert.match(current.messages[1].text, new RegExp(completed.runId));
		assert.match(current.messages[1].text, new RegExp(interrupted.runId));

		current.router.runRegistry.read(piboSessionId, completed.runId);
		current.router.runRegistry.read(piboSessionId, interrupted.runId);
		current.router.emitOutput({ type: "message_finished", piboSessionId, eventId: current.messages[1].id, source: "service" });
		await settleMicrotasks();
		assert.equal(reliabilityStore.getRun(completed.runId).consumed, true);
		assert.equal(reliabilityStore.getRun(interrupted.runId).consumed, true);
		assert.equal(current.router.runReminderDeliveries.size, 0);

		await current.router.disposeAll();
		reliabilityStore.close();
		dataStore.close();
		current = await startRouter();
		assert.equal(current.scheduledAtConstruction, 0);
		assert.equal(current.messages.length, 0, "consumed notifications must not return on a later restart");
		current.router.emitOutput({ type: "message_finished", piboSessionId, eventId: "later-ordinary-turn-control", source: "user" });
		await settleMicrotasks();
		assert.equal(current.messages.length, 0);
	} finally {
		if (current) await current.router.disposeAll().catch(() => {});
		try { reliabilityStore?.close(); } catch {}
		try { dataStore?.close(); } catch {}
		await rm(root, { recursive: true, force: true });
	}
});
