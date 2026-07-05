import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatEventCommandService } from "../dist/apps/chat/data/event-command-service.js";
import { ChatReadStateService } from "../dist/apps/chat/data/read-state-service.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../dist/apps/chat/data/session-query-service.js";
import { ChatTimelineQueryService } from "../dist/apps/chat/data/timeline-query-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";

function tempStore(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	return new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });
}

function session(id, roomId = "room_1") {
	return {
		id,
		piSessionId: `pi_${id}`,
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "default",
			title: "Test Session",
		metadata: { chatRoomId: roomId },
		createdAt: "2026-05-09T00:00:00.000Z",
		updatedAt: "2026-05-09T00:00:01.000Z",
	};
}

test("V2-native chat services cover rooms, sessions, timeline, commands, and read state", () => {
	const store = tempStore("pibo-chat-v2-services-");
	const rooms = new ChatRoomService(store);
	const sessions = new ChatSessionQueryService(store);
	const timeline = new ChatTimelineQueryService(store);
	const commands = new ChatEventCommandService(store);
	const readState = new ChatReadStateService(store);

	const room = rooms.ensureDefaultRoom();
	const piboSession = session("ps_test", room.id);
	sessions.upsertSession(piboSession);
	assert.ok(
		store.db.prepare("PRAGMA index_list(event_log)").all().some((row) => row.name === "idx_event_log_session_sequence_stream"),
		"event_log has a session-sequence index for trace tail pages",
	);
	assert.deepEqual(
		sessions.upsertSessionsIfChanged([piboSession]),
		{ checked: 1, written: 0, skipped: 1 },
		"unchanged session indexing is a no-op",
	);
	assert.deepEqual(
		sessions.upsertSessionsIfChanged([{ ...piboSession, title: "Renamed", updatedAt: "2026-05-09T00:00:02.000Z" }]),
		{ checked: 1, written: 1, skipped: 0 },
		"changed session metadata is still written",
	);

	const accepted = commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventType: "user.message.accepted",
		actorType: "user",
		actorId: "user:test",
		clientTxnId: "txn_1",
		retentionClass: "chat_message",
		payload: { type: "user.message.accepted", piboSessionId: piboSession.id, roomId: room.id, text: "hello", clientTxnId: "txn_1" },
	});
	const duplicate = commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventType: "user.message.accepted",
		actorType: "user",
		actorId: "user:test",
		clientTxnId: "txn_1",
		retentionClass: "chat_message",
		payload: { type: "user.message.accepted", piboSessionId: piboSession.id, roomId: room.id, text: "ignored", clientTxnId: "txn_1" },
	});
	commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventType: "assistant_message",
		actorType: "assistant",
		actorId: "assistant:test",
		retentionClass: "chat_message",
		payload: { type: "assistant_message", piboSessionId: piboSession.id, text: "world" },
	});

	assert.equal(duplicate.streamId, accepted.streamId);
	assert.equal(sessions.getSession(piboSession.id).piboSessionId, piboSession.id);
	assert.equal(timeline.listEvents({ roomId: room.id }).length, 2);
	assert.deepEqual(timeline.listTraceEvents({ piboSessionId: piboSession.id }).map((event) => event.type), ["user.message.accepted", "assistant_message"]);
	assert.equal(timeline.getLatestEventSequence(piboSession.id), 2);
	assert.equal(readState.countUnreadMessagesBySession({ piboSessionIds: [piboSession.id] }).get(piboSession.id), 2);
	readState.markSessionRead(piboSession.id, timeline.getLatestStreamId({ piboSessionId: piboSession.id }));
	assert.equal(readState.countUnreadMessagesBySession({ piboSessionIds: [piboSession.id] }).has(piboSession.id), false);

	store.close();
});
