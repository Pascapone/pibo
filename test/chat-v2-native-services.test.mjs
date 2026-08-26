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

test("timeline query retains full-history steering message identity metadata", () => {
	const store = tempStore("pibo-chat-v2-steering-identity-");
	try {
		const rooms = new ChatRoomService(store);
		const sessions = new ChatSessionQueryService(store);
		const timeline = new ChatTimelineQueryService(store);
		const commands = new ChatEventCommandService(store);
		const room = rooms.ensureDefaultRoom();
		const piboSession = session("ps_steering", room.id);
		sessions.upsertSession(piboSession);
		commands.appendEvent({
			roomId: room.id,
			piboSessionId: piboSession.id,
			eventId: "steer-1",
			eventType: "message_steered",
			actorType: "user",
			actorId: "user:test",
			retentionClass: "chat_message",
			payload: {
				type: "message_steered",
				piboSessionId: piboSession.id,
				eventId: "steer-1",
				activeEventId: "turn-1",
				text: "Adjust course",
				source: "user",
			},
			createdAt: "2026-05-09T00:00:02.000Z",
		});

		assert.deepEqual(timeline.listMessageTurnTimings(piboSession.id), [{
			eventId: "steer-1",
			userText: "Adjust course",
			startedAt: undefined,
			completedAt: undefined,
			durationMs: undefined,
			userMessageType: "message_steered",
		}]);
	} finally {
		store.close();
	}
});

test("timeline query preserves deferred payload identity on its exact tool node", () => {
	const store = tempStore("pibo-chat-v2-deferred-image-");
	try {
		const timeline = new ChatTimelineQueryService(store);
		const payload = store.payloads.writePayload({
			value: { content: [{ type: "image", data: "a".repeat(20_000), mimeType: "image/png" }] },
			contentType: "application/json",
			retentionClass: "trace_event",
		});
		store.eventLog.appendEvent({
			sessionId: "ps_deferred",
			sessionSequence: 1,
			roomId: "room_deferred",
			topic: "pibo.output",
			type: "tool_execution_finished",
			source: "actor",
			eventId: "turn-deferred",
			toolCallId: "call-deferred",
			retentionClass: "trace_event",
			payloadRef: payload.id,
			previewText: "read",
			attributes: { toolCallId: "call-deferred", toolName: "read", isError: false },
		});

		const [event] = timeline.listTraceEvents({ piboSessionId: "ps_deferred", includeLive: true });
		assert.equal(event.payload.type, "tool_execution_finished");
		assert.equal(event.storedPayloadRef.nodeId, "tool:call-deferred");
		assert.equal(event.storedPayloadRef.payloadKind, "output");
		assert.equal(event.storedPayloadRef.byteLength, payload.byteSize);
		assert.equal(event.storedPayloadRef.hash, payload.sha256);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred",
			payloadId: payload.id,
			nodeId: "tool:call-deferred",
			payloadKind: "output",
		}), true);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred",
			payloadId: payload.id,
			nodeId: "tool:another-call",
			payloadKind: "output",
		}), false);
	} finally {
		store.close();
	}
});

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
	const eventLogIndexes = store.db.prepare("PRAGMA index_list(event_log)").all();
	assert.ok(
		eventLogIndexes.some((row) => row.name === "idx_event_log_session_sequence_stream"),
		"event_log has a session-sequence index for trace tail pages",
	);
	assert.ok(
		eventLogIndexes.some((row) => row.name === "idx_event_log_unread_session_stream" && row.partial === 1),
		"event_log has a partial unread-message index",
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
	commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventId: "turn_timing",
		eventType: "message_started",
		actorType: "assistant",
		actorId: "assistant:test",
		retentionClass: "chat_message",
		payload: { type: "message_started", piboSessionId: piboSession.id, eventId: "turn_timing", text: "timed prompt" },
		createdAt: "2026-05-09T00:00:02.000Z",
	});
	commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventId: "turn_timing_reasoning",
		eventType: "thinking_finished",
		actorType: "assistant",
		actorId: "assistant:test",
		retentionClass: "trace_event",
		payload: { type: "thinking_finished", piboSessionId: piboSession.id, eventId: "turn_timing", thinkingIndex: 1, contentIndex: 0, text: "Reasoned" },
		createdAt: "2026-05-09T00:00:04.000Z",
	});
	commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventId: "turn_timing_assistant",
		eventType: "assistant_message",
		actorType: "assistant",
		actorId: "assistant:test",
		retentionClass: "chat_message",
		payload: { type: "assistant_message", piboSessionId: piboSession.id, eventId: "turn_timing", assistantIndex: 2, contentIndex: 1, text: "Answered" },
		createdAt: "2026-05-09T00:00:06.000Z",
	});
	commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventId: "turn_timing_done",
		eventType: "message_finished",
		actorType: "assistant",
		actorId: "assistant:test",
		retentionClass: "chat_message",
		payload: { type: "message_finished", piboSessionId: piboSession.id, eventId: "turn_timing" },
		createdAt: "2026-05-09T00:00:07.000Z",
	});
	commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventId: "turn_open",
		eventType: "message_started",
		actorType: "assistant",
		actorId: "assistant:test",
		retentionClass: "chat_message",
		payload: { type: "message_started", piboSessionId: piboSession.id, eventId: "turn_open", text: "open prompt" },
		createdAt: "2026-05-09T00:00:08.000Z",
	});
	commands.appendEvent({
		roomId: room.id,
		piboSessionId: piboSession.id,
		eventId: "turn_queued",
		eventType: "message_queued",
		actorType: "user",
		actorId: "user:test",
		retentionClass: "chat_message",
		payload: { type: "message_queued", piboSessionId: piboSession.id, eventId: "turn_queued", text: "queued prompt", source: "user", queuedMessages: 1 },
		createdAt: "2026-05-09T00:00:09.000Z",
	});

	assert.equal(duplicate.streamId, accepted.streamId);
	assert.equal(sessions.getSession(piboSession.id).piboSessionId, piboSession.id);
	assert.equal(timeline.listEvents({ roomId: room.id }).length, 8);
	assert.deepEqual(timeline.listTraceEvents({ piboSessionId: piboSession.id }).map((event) => event.type), ["user.message.accepted", "assistant_message", "message_started", "thinking_finished", "assistant_message", "message_finished", "message_started", "message_queued"]);
	assert.equal(timeline.getLatestEventSequence(piboSession.id), 8);
	assert.deepEqual(timeline.listMessageTurnTimings(piboSession.id), [{
		eventId: "turn_timing",
		userText: "timed prompt",
		startedAt: "2026-05-09T00:00:02.000Z",
		completedAt: "2026-05-09T00:00:07.000Z",
		durationMs: 5000,
		reasoningIndices: [1],
		assistantIndices: [2],
	}, {
		eventId: "turn_open",
		userText: "open prompt",
		startedAt: "2026-05-09T00:00:08.000Z",
		completedAt: undefined,
		durationMs: undefined,
	}, {
		eventId: "turn_queued",
		userText: "queued prompt",
		startedAt: undefined,
		completedAt: undefined,
		durationMs: undefined,
	}]);
	assert.equal(readState.countUnreadMessagesBySession({ piboSessionIds: [piboSession.id] }).get(piboSession.id), 3);
	readState.markSessionRead(piboSession.id, timeline.getLatestStreamId({ piboSessionId: piboSession.id }));
	assert.equal(readState.countUnreadMessagesBySession({ piboSessionIds: [piboSession.id] }).has(piboSession.id), false);

	store.close();
});
