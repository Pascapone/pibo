import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ChatEventLog } from "../dist/apps/chat/event-log.js";
import { ChatWebReadModel } from "../dist/apps/chat/read-model.js";
import { PiboReliabilityStore } from "../dist/reliability/store.js";

function tempDir() {
	return mkdtempSync(join(tmpdir(), "pibo-chat-persistence-"));
}

function session(id = "ps_test") {
	return {
		id,
		piSessionId: `pi_${id}`,
		profile: "test-profile",
		channel: "web",
		kind: "chat",
		createdAt: "2026-05-07T00:00:00.000Z",
		updatedAt: "2026-05-07T00:00:00.000Z",
	};
}

function outputEvent(piboSessionId, type, eventId) {
	return { type, piboSessionId, eventId, text: `${type} body` };
}

test("persisted chat events keep the same order in event log and read model", () => {
	const dir = tempDir();
	try {
		const eventLog = new ChatEventLog(join(dir, "web-chat.sqlite"));
		const readModel = new ChatWebReadModel(join(dir, "read-model.sqlite"));
		const currentSession = session();
		const accepted = eventLog.appendEvent({
			roomId: "room-1",
			piboSessionId: currentSession.id,
			eventId: "event-1",
			eventType: "assistant_message",
			actorType: "assistant",
			retentionClass: "chat_message",
			payload: outputEvent(currentSession.id, "assistant_message", "event-1"),
		});
		readModel.recordEvent(outputEvent(currentSession.id, "assistant_message", "event-1"), currentSession, accepted.streamId);
		const finished = eventLog.appendEvent({
			roomId: "room-1",
			piboSessionId: currentSession.id,
			eventId: "event-2",
			eventType: "message_finished",
			actorType: "assistant",
			retentionClass: "chat_message",
			payload: outputEvent(currentSession.id, "message_finished", "event-2"),
		});
		readModel.recordEvent(outputEvent(currentSession.id, "message_finished", "event-2"), currentSession, finished.streamId);

		assert.deepEqual(eventLog.listEvents({ piboSessionId: currentSession.id }).map((event) => event.streamId), [accepted.streamId, finished.streamId]);
		assert.deepEqual(readModel.listAllEvents(currentSession.id).map((event) => event.streamId), [accepted.streamId, finished.streamId]);
		assert.deepEqual(readModel.listAllEvents(currentSession.id).map((event) => event.eventSequence), [1, 2]);

		eventLog.close();
		readModel.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("duplicate client transactions and reliability idempotency return existing events", () => {
	const dir = tempDir();
	try {
		const eventLog = new ChatEventLog(join(dir, "web-chat.sqlite"));
		const reliabilityStore = new PiboReliabilityStore(join(dir, "pibo-events.sqlite"));
		const first = eventLog.appendEvent({
			roomId: "room-1",
			piboSessionId: "ps_test",
			eventType: "user.message.accepted",
			actorType: "user",
			actorId: "user:1",
			clientTxnId: "txn-1",
			retentionClass: "chat_message",
			payload: { text: "hello" },
		});
		const duplicate = eventLog.appendEvent({
			roomId: "room-1",
			piboSessionId: "ps_test",
			eventType: "user.message.accepted",
			actorType: "user",
			actorId: "user:1",
			clientTxnId: "txn-1",
			retentionClass: "chat_message",
			payload: { text: "hello again" },
		});

		assert.equal(duplicate.streamId, first.streamId);
		assert.equal(eventLog.listEvents({ piboSessionId: "ps_test" }).length, 1);

		const audit = reliabilityStore.appendOnce({
			topic: "pibo.output",
			eventId: "evt-fixed",
			idempotencyKey: "idem-1",
			payload: { ok: true },
		});
		const duplicateAudit = reliabilityStore.appendOnce({
			topic: "pibo.output",
			eventId: "evt-fixed",
			idempotencyKey: "idem-1",
			payload: { ok: false },
		});
		assert.equal(duplicateAudit.streamId, audit.streamId);
		assert.equal(reliabilityStore.list({ topic: "pibo.output" }).length, 1);

		eventLog.close();
		reliabilityStore.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("read cursors only move forward", () => {
	const dir = tempDir();
	try {
		const eventLog = new ChatEventLog(join(dir, "web-chat.sqlite"));
		eventLog.markSessionRead("ps_test", "user:1", 10);
		eventLog.markSessionRead("ps_test", "user:1", 5);
		assert.equal(eventLog.getSessionReadCursor("ps_test", "user:1"), 10);
		eventLog.markSessionRead("ps_test", "user:1", 15);
		assert.equal(eventLog.getSessionReadCursor("ps_test", "user:1"), 15);
		eventLog.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
