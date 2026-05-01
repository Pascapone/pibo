import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatEventLog } from "../dist/apps/chat/event-log.js";
import { PiboRoomStore, chatRoomIdFromMetadata, withChatRoomId } from "../dist/apps/chat/rooms.js";

test("chat event log appends monotone events and queries by cursor and scope", () => {
	const dbPath = join(mkdtempSync(join(tmpdir(), "pibo-chat-events-")), "chat.sqlite");
	const log = new ChatEventLog(dbPath);
	try {
		const first = log.appendEvent({
			roomId: "room_1",
			piboSessionId: "ps_1",
			eventType: "user.message.accepted",
			actorType: "user",
			actorId: "user:1",
			clientTxnId: "txn_1",
			retentionClass: "chat_message",
			payload: { text: "hello" },
		});
		const duplicate = log.appendEvent({
			roomId: "room_1",
			piboSessionId: "ps_1",
			eventType: "user.message.accepted",
			actorType: "user",
			actorId: "user:1",
			clientTxnId: "txn_1",
			retentionClass: "chat_message",
			payload: { text: "hello again" },
		});
		const second = log.appendEvent({
			roomId: "room_1",
			piboSessionId: "ps_2",
			eventType: "assistant_message",
			retentionClass: "chat_message",
			payload: { type: "assistant_message", piboSessionId: "ps_2", text: "done" },
		});

		assert.equal(duplicate.streamId, first.streamId);
		assert.equal(second.streamId, first.streamId + 1);
		assert.deepEqual(log.listEvents({ roomId: "room_1", afterStreamId: first.streamId }).map((event) => event.streamId), [
			second.streamId,
		]);
		assert.deepEqual(log.listEvents({ piboSessionId: "ps_1" }).map((event) => event.streamId), [first.streamId]);
	} finally {
		log.close();
	}
});

test("chat event log counts unread visible messages after session cursors", () => {
	const log = new ChatEventLog(":memory:");
	try {
		log.appendEvent({
			roomId: "room_1",
			piboSessionId: "ps_1",
			eventType: "user.message.accepted",
			actorType: "user",
			actorId: "user:1",
			retentionClass: "chat_message",
			payload: { text: "own message" },
		});
		const assistant = log.appendEvent({
			roomId: "room_1",
			piboSessionId: "ps_1",
			eventType: "assistant_message",
			actorType: "assistant",
			actorId: "user:1",
			retentionClass: "chat_message",
			payload: { type: "assistant_message", piboSessionId: "ps_1", text: "answer" },
		});

		assert.equal(
			log.countUnreadMessages({
				piboSessionId: "ps_1",
				principalId: "user:1",
				afterStreamId: log.getSessionReadCursor("ps_1", "user:1") ?? 0,
			}),
			1,
		);

		log.markSessionRead("ps_1", "user:1", assistant.streamId);
		assert.equal(
			log.countUnreadMessages({
				piboSessionId: "ps_1",
				principalId: "user:1",
				afterStreamId: log.getSessionReadCursor("ps_1", "user:1") ?? 0,
			}),
			0,
		);
	} finally {
		log.close();
	}
});

test("chat event log purges expired events by retention class", () => {
	const log = new ChatEventLog(":memory:");
	try {
		log.appendEvent({
			eventType: "assistant_delta",
			retentionClass: "live_delta",
			createdAt: "2026-01-01T00:00:00.000Z",
			payload: { text: "old" },
		});
		log.appendEvent({
			eventType: "assistant_message",
			retentionClass: "chat_message",
			createdAt: "2026-01-01T00:00:00.000Z",
			payload: { text: "keep" },
		});
		const purged = log.purgeExpired({
			now: new Date("2026-01-02T00:00:00.000Z"),
			policy: { id: "default", deleteLiveDeltasAfterMs: 1 },
		});

		assert.equal(purged, 1);
		assert.deepEqual(log.listEvents().map((event) => event.retentionClass), ["chat_message"]);
	} finally {
		log.close();
	}
});

test("pibo room store manages default rooms, membership, tree, and read cursors", () => {
	const store = new PiboRoomStore(":memory:");
	try {
		const defaultRoom = store.ensureDefaultRoom({ ownerScope: "user:1", principalId: "user:1" });
		const repeated = store.ensureDefaultRoom({ ownerScope: "user:1", principalId: "user:1" });
		const child = store.createRoom({
			ownerScope: "user:1",
			name: "Child",
			parentRoomId: defaultRoom.id,
			metadata: { purpose: "test" },
		});
		store.ensureMember({ roomId: child.id, principalId: "user:1", role: "admin" });
		const member = store.updateReadCursor(child.id, "user:1", 42);

		assert.equal(repeated.id, defaultRoom.id);
		assert.equal(member?.lastReadStreamId, 42);
		assert.equal(store.listRoomTree("user:1")[0].children[0].id, child.id);
		assert.equal(chatRoomIdFromMetadata(withChatRoomId(undefined, child.id)), child.id);
	} finally {
		store.close();
	}
});
