import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiboProviderTelemetryRecorder } from "../dist/core/provider-telemetry.js";
import { PiboRuntimeTelemetryRecorder, turnIdForEvent } from "../dist/core/runtime-telemetry.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { AsyncTelemetryWriter } from "../dist/data/telemetry-writer.js";

function createStore() {
	return new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-telemetry-writer-payloads-")) });
}

function session(id = "ps_async_writer") {
	return {
		id,
		piSessionId: `11111111-2222-4333-8444-${id.slice(-12).padStart(12, "5")}`,
		channel: "pibo.test",
		kind: "chat",
		profile: "test-profile",
		metadata: { chatRoomId: `room_${id}` },
		createdAt: "2026-07-13T00:00:00.000Z",
		updatedAt: "2026-07-13T00:00:00.000Z",
	};
}

function status(piboSessionId, queuedMessages = 0) {
	return {
		piboSessionId,
		queuedMessages,
		processing: queuedMessages > 0,
		streaming: false,
		activeTools: [],
		enabledTools: [],
		cwd: process.cwd(),
		disposed: false,
	};
}

function observeTransactions(store) {
	const originalExec = store.db.exec.bind(store.db);
	let begins = 0;
	let commits = 0;
	store.db.exec = (sql) => {
		if (/^\s*BEGIN\b/i.test(sql)) begins += 1;
		if (/^\s*COMMIT\b/i.test(sql)) commits += 1;
		return originalExec(sql);
	};
	return {
		counts: () => ({ begins, commits }),
		restore: () => { store.db.exec = originalExec; },
	};
}

test("async telemetry writer preserves cross-recorder order in one transaction", async () => {
	const store = createStore();
	const transactions = observeTransactions(store);
	const writer = new AsyncTelemetryWriter(store.telemetry, { flushIntervalMs: 60_000 });
	const currentSession = session();
	const runtime = new PiboRuntimeTelemetryRecorder(store.telemetry, undefined, { writer });
	const provider = new PiboProviderTelemetryRecorder({
		store: store.telemetry,
		writer,
		session: currentSession,
		model: { provider: "openai", id: "gpt-test", api: "openai-responses" },
	});
	const eventId = "evt_async_order";

	try {
		runtime.recordOutput({ type: "message_queued", piboSessionId: currentSession.id, eventId, queuedMessages: 1, text: "hello", source: "user" }, { session: currentSession, status: status(currentSession.id, 1), at: "2026-07-13T00:00:01.000Z" });
		runtime.recordOutput({ type: "message_started", piboSessionId: currentSession.id, eventId, text: "hello", source: "user" }, { session: currentSession, status: status(currentSession.id), at: "2026-07-13T00:00:02.000Z" });
		provider.recordRequestStart({ model: "gpt-test", service_tier: "priority", input: "not retained" }, { at: "2026-07-13T00:00:03.000Z" });
		provider.recordResponse({ status: 200, headers: { authorization: "not retained" }, at: "2026-07-13T00:00:04.000Z" });
		runtime.recordOutput({ type: "assistant_delta", piboSessionId: currentSession.id, eventId, assistantIndex: 0, contentIndex: 0, text: "answer" }, { session: currentSession, status: status(currentSession.id), at: "2026-07-13T00:00:05.000Z" });
		provider.recordMessageEnd({ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "not retained" }] }, { at: "2026-07-13T00:00:06.000Z" });
		runtime.recordOutput({ type: "message_finished", piboSessionId: currentSession.id, eventId, source: "user" }, { session: currentSession, status: status(currentSession.id), at: "2026-07-13T00:00:07.000Z" });

		assert.equal(store.telemetry.getTurnTimeline(turnIdForEvent(eventId)), undefined);
		await writer.flush();

		const timeline = store.telemetry.getTurnTimeline(turnIdForEvent(eventId));
		assert.ok(timeline);
		assert.equal(timeline.turn.queuedAt, "2026-07-13T00:00:01.000Z");
		assert.equal(timeline.turn.startedAt, "2026-07-13T00:00:02.000Z");
		assert.equal(timeline.turn.completedAt, "2026-07-13T00:00:07.000Z");
		assert.equal(timeline.turn.status, "ok");
		assert.equal(timeline.providerRequests.length, 1);
		assert.equal(timeline.providerRequests[0].status, "completed");
		assert.equal(timeline.providerRequests[0].startedAt, "2026-07-13T00:00:03.000Z");
		assert.equal(timeline.providerRequests[0].completedAt, "2026-07-13T00:00:06.000Z");
		assert.deepEqual(transactions.counts(), { begins: 1, commits: 1 });
	} finally {
		await writer.dispose();
		transactions.restore();
		store.close();
	}
});

test("async telemetry writer flushes automatically after its batching window", async () => {
	const store = createStore();
	const transactions = observeTransactions(store);
	const writer = new AsyncTelemetryWriter(store.telemetry, { flushIntervalMs: 5 });
	let complete;
	const completed = new Promise((resolve) => { complete = resolve; });

	try {
		writer.enqueue(() => complete());
		assert.deepEqual(transactions.counts(), { begins: 0, commits: 0 });
		await completed;
		assert.deepEqual(transactions.counts(), { begins: 1, commits: 1 });
	} finally {
		await writer.dispose();
		transactions.restore();
		store.close();
	}
});

test("async telemetry writer bounds its queue without dropping ordered work", async () => {
	const store = createStore();
	const transactions = observeTransactions(store);
	const errors = [];
	const writer = new AsyncTelemetryWriter(store.telemetry, {
		flushIntervalMs: 60_000,
		maxPendingOperations: 3,
		onError: (error) => errors.push(error),
	});
	const order = [];

	try {
		writer.enqueue(() => order.push(1));
		writer.enqueue(() => { throw new Error("isolated telemetry failure"); });
		writer.enqueue(() => order.push(3));
		assert.deepEqual(order, [1, 3]);
		assert.equal(errors.length, 1);
		assert.deepEqual(transactions.counts(), { begins: 1, commits: 1 });

		writer.enqueue(() => order.push(4));
		await writer.dispose();
		assert.deepEqual(order, [1, 3, 4]);
		assert.deepEqual(transactions.counts(), { begins: 2, commits: 2 });
		assert.equal(writer.enqueue(() => order.push(5)), false);
		assert.deepEqual(order, [1, 3, 4]);
		assert.equal(errors.length, 2);
	} finally {
		await writer.dispose();
		transactions.restore();
		store.close();
	}
});

test("async telemetry writer batches concurrent session lifecycle load globally", async () => {
	const store = createStore();
	const transactions = observeTransactions(store);
	const writer = new AsyncTelemetryWriter(store.telemetry, { flushIntervalMs: 60_000, maxPendingOperations: 10_000 });
	const runtime = new PiboRuntimeTelemetryRecorder(store.telemetry, undefined, { writer, progressFlushIntervalMs: 60_000 });
	const sessionCount = 100;

	try {
		for (let index = 0; index < sessionCount; index += 1) {
			const currentSession = session(`ps_load_${index}`);
			const eventId = `evt_load_${index}`;
			runtime.recordOutput({ type: "message_queued", piboSessionId: currentSession.id, eventId, queuedMessages: 1, text: "load", source: "user" }, { session: currentSession, status: status(currentSession.id, 1) });
			runtime.recordOutput({ type: "message_started", piboSessionId: currentSession.id, eventId, text: "load", source: "user" }, { session: currentSession, status: status(currentSession.id) });
			for (let delta = 0; delta < 20; delta += 1) {
				runtime.recordOutput({ type: "assistant_delta", piboSessionId: currentSession.id, eventId, assistantIndex: 0, contentIndex: 0, text: "x" }, { session: currentSession, status: status(currentSession.id) });
			}
			runtime.recordOutput({ type: "message_finished", piboSessionId: currentSession.id, eventId, source: "user" }, { session: currentSession, status: status(currentSession.id) });
		}

		await writer.flush();
		assert.deepEqual(transactions.counts(), { begins: 1, commits: 1 });
		for (let index = 0; index < sessionCount; index += 1) {
			assert.equal(store.telemetry.getTurnTimeline(turnIdForEvent(`evt_load_${index}`)).turn.status, "ok");
		}
	} finally {
		await writer.dispose();
		transactions.restore();
		store.close();
	}
});
