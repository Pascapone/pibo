import assert from "node:assert/strict";
import test from "node:test";
import { ChatEventLog } from "../dist/apps/chat/event-log.js";
import { SqlitePiboSessionStore } from "../dist/sessions/sqlite-store.js";

test("batch unread counts match per-session unread counts", () => {
	const log = new ChatEventLog(":memory:");
	try {
		const sessions = ["s1", "s2", "s3"];
		log.appendEvent({ piboSessionId: "s1", eventType: "user.message.accepted", actorType: "user", actorId: "user:other", retentionClass: "chat_message", payload: { type: "user.message.accepted" } });
		log.appendEvent({ piboSessionId: "s1", eventId: "turn1:assistant_message", eventType: "assistant_message", actorType: "assistant", retentionClass: "chat_message", payload: { type: "assistant_message" } });
		log.appendEvent({ piboSessionId: "s1", eventId: "turn1:message_finished", eventType: "message_finished", actorType: "assistant", retentionClass: "chat_message", payload: { type: "message_finished" } });
		log.appendEvent({ piboSessionId: "s2", eventType: "user.message.accepted", actorType: "user", actorId: "user:me", retentionClass: "chat_message", payload: { type: "user.message.accepted" } });
		log.appendEvent({ piboSessionId: "s2", eventId: "turn2:assistant_message", eventType: "assistant_message", actorType: "assistant", retentionClass: "chat_message", payload: { type: "assistant_message" } });
		log.appendEvent({ piboSessionId: "s2", eventId: "turn2:message_finished", eventType: "message_finished", actorType: "assistant", retentionClass: "chat_message", payload: { type: "message_finished" } });
		log.markSessionRead("s2", "user:me", 4);

		const batch = log.countUnreadMessagesBySession({ piboSessionIds: sessions, principalId: "user:me" });
		for (const id of sessions) {
			assert.equal(
				batch.get(id) ?? 0,
				log.countUnreadMessages({ piboSessionId: id, principalId: "user:me", afterStreamId: log.getSessionReadCursor(id, "user:me") ?? 0 }),
				id,
			);
		}
		assert.equal(batch.get("s1"), 2);
		assert.equal(batch.get("s2"), 1);
		assert.equal(batch.has("s3"), false);
	} finally {
		log.close();
	}
});

test("sqlite session find applies indexed filters before semantic matching", () => {
	const store = new SqlitePiboSessionStore(":memory:");
	try {
		store.create({ id: "a", piSessionId: "pa", channel: "web", kind: "chat", profile: "p1", ownerScope: "u1", metadata: { room: "r1" }, activeModel: { provider: "openai", id: "m1" } });
		store.create({ id: "b", piSessionId: "pb", channel: "web", kind: "chat", profile: "p2", ownerScope: "u2", parentId: "a", metadata: { room: "r2" } });

		assert.deepEqual(store.find({ ownerScope: "u1" }).map((session) => session.id), ["a"]);
		assert.deepEqual(store.find({ parentId: null }).map((session) => session.id), ["a"]);
		assert.deepEqual(store.find({ parentId: "a" }).map((session) => session.id), ["b"]);
		assert.deepEqual(store.find({ ids: ["b", "missing"] }).map((session) => session.id), ["b"]);
		assert.deepEqual(store.find({ metadata: { room: "r1" } }).map((session) => session.id), ["a"]);
		assert.deepEqual(store.find({ activeModel: { provider: "openai", id: "m1" } }).map((session) => session.id), ["a"]);
	} finally {
		store.close();
	}
});
