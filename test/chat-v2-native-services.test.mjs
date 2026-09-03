import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ChatEventCommandService } from "../dist/apps/chat/data/event-command-service.js";
import { ChatReadStateService } from "../dist/apps/chat/data/read-state-service.js";
import { ChatRoomService } from "../dist/apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../dist/apps/chat/data/session-query-service.js";
import { ChatTimelineQueryService } from "../dist/apps/chat/data/timeline-query-service.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { qualifiedHistoryToolNodeId } from "../dist/shared/trace-tool-identity.js";

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

test("session and navigation activity remain monotonic after stale compatibility projection", () => {
	const store = tempStore("pibo-chat-v2-monotonic-activity-");
	try {
		const rooms = new ChatRoomService(store);
		const sessions = new ChatSessionQueryService(store);
		const ingest = new ChatDataIngestService(store);
		const room = rooms.ensureDefaultRoom();
		const piboSession = session("ps_monotonic", room.id);
		const event = {
			type: "message_finished",
			piboSessionId: piboSession.id,
			eventId: "loop_msg_monotonic",
			source: "service",
		};
		const eventTime = "2026-05-09T00:05:00.000Z";

		sessions.upsertSession(piboSession);
		const stored = ingest.ingestOutputEvent({
			session: piboSession,
			roomId: room.id,
			event,
			createdAt: eventTime,
		});
		sessions.recordEvent(event, piboSession, stored.streamId, eventTime);
		sessions.upsertSession(piboSession);

		assert.equal(sessions.getSession(piboSession.id)?.lastActivityAt, eventTime);
		const navigation = store.navigation.getSession(piboSession.id);
		assert.equal(navigation?.lastActivityAt, eventTime);
		assert.equal(navigation?.sortKey, eventTime);
		assert.deepEqual(sessions.upsertSessionsIfChanged([piboSession]), { checked: 1, written: 0, skipped: 1 });
	} finally {
		store.close();
	}
});

test("permanent session deletion releases externalized payload references and files", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-chat-v2-payload-delete-"));
	const dataPath = join(root, "pibo.sqlite");
	const payloadRoot = join(root, "payloads");
	let store = new PiboDataStore(dataPath, { payloadRootDir: payloadRoot });
	try {
		const rooms = new ChatRoomService(store);
		const sessions = new ChatSessionQueryService(store);
		const ingest = new ChatDataIngestService(store);
		const room = rooms.ensureDefaultRoom();
		const firstSession = session("ps_payload_first", room.id);
		const secondSession = session("ps_payload_second", room.id);
		const text = "shared-large-payload-".repeat(1_200);
		const first = ingest.ingestUserMessageAccepted({ session: firstSession, roomId: room.id, actorId: "user:test", text, clientTxnId: "payload-first" });
		ingest.ingestUserMessageAccepted({ session: secondSession, roomId: room.id, actorId: "user:test", text, clientTxnId: "payload-second" });
		const message = store.db.prepare("SELECT content_payload_ref FROM chat_messages WHERE id = ?").get(first.messageId);
		const payloadId = message.content_payload_ref;
		const payload = store.payloads.getPayload(payloadId);
		const payloadPath = join(payloadRoot, payload.storagePath);
		assert.equal(payload.refCount, 2);
		assert.equal(existsSync(payloadPath), true);

		assert.equal(sessions.deleteSessions([firstSession.id]), 1);
		assert.equal(store.payloads.getPayload(payloadId)?.refCount, 1);
		assert.equal(existsSync(payloadPath), true);
		assert.equal(store.payloads.readPayloadText(payloadId), text);

		assert.equal(sessions.deleteSessions([secondSession.id]), 1);
		assert.equal(store.payloads.getPayload(payloadId), undefined);
		assert.equal(existsSync(payloadPath), false);
		store.close();

		store = new PiboDataStore(dataPath, { payloadRootDir: payloadRoot });
		assert.equal(store.payloads.getPayload(payloadId), undefined);
		assert.equal(existsSync(payloadPath), false);
	} finally {
		store.close();
		rmSync(root, { recursive: true, force: true });
	}
});

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
			startedAt: "2026-05-09T00:00:02.000Z",
			activeEventId: "turn-1",
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
		const providerToolCallId = `history:${encodeURIComponent(JSON.stringify(["legitimate", "provider-id"]))}`;
		const qualifiedNodeId = qualifiedHistoryToolNodeId(providerToolCallId, "turn-deferred", 0);
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
			type: "tool_execution_started",
			source: "actor",
			eventId: "turn-deferred",
			toolCallId: providerToolCallId,
			retentionClass: "trace_event",
			previewText: "read",
			attributes: { toolCallId: providerToolCallId, toolName: "read" },
		});
		store.eventLog.appendEvent({
			sessionId: "ps_deferred",
			sessionSequence: 2,
			roomId: "room_deferred",
			topic: "pibo.output",
			type: "tool_execution_finished",
			source: "actor",
			eventId: "turn-deferred",
			toolCallId: providerToolCallId,
			retentionClass: "trace_event",
			payloadRef: payload.id,
			previewText: "read",
			attributes: { toolCallId: providerToolCallId, toolName: "read", isError: false },
		});

		const event = timeline.listTraceEvents({ piboSessionId: "ps_deferred", includeLive: true })
			.find((candidate) => candidate.type === "tool_execution_finished");
		assert.ok(event);
		assert.equal(event.payload.type, "tool_execution_finished");
		assert.equal(event.storedPayloadRef.nodeId, qualifiedNodeId);
		assert.equal(event.storedPayloadRef.payloadKind, "output");
		assert.equal(event.storedPayloadRef.byteLength, payload.byteSize);
		assert.equal(event.storedPayloadRef.hash, payload.sha256);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred",
			payloadId: payload.id,
			nodeId: `tool:${providerToolCallId}`,
			payloadKind: "output",
		}), true);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred",
			payloadId: payload.id,
			nodeId: qualifiedNodeId,
			payloadKind: "output",
		}), true);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred",
			payloadId: payload.id,
			nodeId: qualifiedHistoryToolNodeId(providerToolCallId, "attacker-controlled-identity", 0),
			payloadKind: "output",
		}), false);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred",
			payloadId: payload.id,
			nodeId: qualifiedHistoryToolNodeId(providerToolCallId, "turn-deferred", 1),
			payloadKind: "output",
		}), false);
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

test("deferred payload authorization fails closed when its SQL evidence exceeds the bound", () => {
	const store = tempStore("pibo-chat-v2-deferred-bound-");
	try {
		const timeline = new ChatTimelineQueryService(store);
		const payload = store.payloads.writePayload({ value: { content: "bounded" }, contentType: "application/json", retentionClass: "trace_event" });
		for (let index = 0; index < 501; index += 1) {
			store.eventLog.appendEvent({
				sessionId: "ps_deferred_bound",
				sessionSequence: index + 1,
				roomId: "room_deferred_bound",
				topic: "pibo.output",
				type: "tool_execution_updated",
				source: "actor",
				eventId: "turn-deferred-bound",
				toolCallId: "bounded-tool",
				retentionClass: "trace_event",
				...(index === 0 ? { payloadRef: payload.id } : {}),
				attributes: { toolCallId: "bounded-tool", toolName: "read" },
			});
		}
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred_bound",
			payloadId: payload.id,
			nodeId: "tool:bounded-tool",
			payloadKind: "output",
		}), false);
	} finally {
		store.close();
	}
});

test("deferred payload authorization validates the complete exact lifecycle before granting", () => {
	const store = tempStore("pibo-chat-v2-deferred-overlap-");
	try {
		const timeline = new ChatTimelineQueryService(store);
		const payload = store.payloads.writePayload({ value: { content: "secret" }, contentType: "application/json", retentionClass: "trace_event" });
		for (const [sequence, type, payloadRef] of [
			[1, "tool_execution_started"],
			[2, "tool_execution_updated", payload.id],
			[3, "tool_execution_started"],
		]) {
			store.eventLog.appendEvent({
				sessionId: "ps_deferred_overlap", sessionSequence: sequence, roomId: "room_deferred_overlap",
				topic: "pibo.output", type, source: "actor", eventId: "turn-deferred-overlap",
				toolCallId: "overlap-tool", retentionClass: "trace_event", ...(payloadRef ? { payloadRef } : {}),
				attributes: { toolCallId: "overlap-tool", toolName: "read" },
			});
		}
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred_overlap", payloadId: payload.id,
			nodeId: qualifiedHistoryToolNodeId("overlap-tool", "turn-deferred-overlap", 0), payloadKind: "output",
		}), false);
	} finally {
		store.close();
	}
});

test("ordinary tool identity requires exactly one unambiguous invocation", () => {
	const store = tempStore("pibo-chat-v2-deferred-ordinary-");
	try {
		const timeline = new ChatTimelineQueryService(store);
		const first = store.payloads.writePayload({ value: { content: "first" }, contentType: "application/json", retentionClass: "trace_event" });
		const second = store.payloads.writePayload({ value: { content: "second" }, contentType: "application/json", retentionClass: "trace_event" });
		for (const [offset, eventId, payloadId] of [[0, "event-a", first.id], [2, "event-b", second.id]]) {
			for (const [delta, type] of [[1, "tool_execution_started"], [2, "tool_execution_finished"]]) {
				store.eventLog.appendEvent({
					sessionId: "ps_deferred_ordinary", sessionSequence: offset + delta, roomId: "room_deferred_ordinary",
					topic: "pibo.output", type, source: "actor", eventId, toolCallId: "same-tool",
					retentionClass: "trace_event", ...(type === "tool_execution_finished" ? { payloadRef: payloadId } : {}),
					attributes: { toolCallId: "same-tool", toolName: "read" },
				});
			}
		}
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred_ordinary", payloadId: first.id, nodeId: "tool:same-tool", payloadKind: "output",
		}), false);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred_ordinary", payloadId: first.id,
			nodeId: qualifiedHistoryToolNodeId("same-tool", "event-a", 0), payloadKind: "output",
		}), true);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: "ps_deferred_ordinary", payloadId: second.id,
			nodeId: qualifiedHistoryToolNodeId("same-tool", "event-b", 0), payloadKind: "output",
		}), true);
	} finally {
		store.close();
	}
});

test("deferred payload SQL seeks the exact session, tool, and event index", (t) => {
	const store = tempStore("pibo-chat-v2-deferred-plan-");
	try {
		const details = store.db.prepare(`
			EXPLAIN QUERY PLAN
			SELECT type, event_id, payload_ref, attributes_json
			FROM event_log
			WHERE session_id = ?
				AND tool_call_id = ?
				AND type IN ('tool_execution_started', 'tool_execution_updated', 'tool_execution_finished')
				AND event_id = ?
			ORDER BY session_sequence ASC, stream_id ASC
			LIMIT ?
		`).all("ps_plan", "tool-plan", "event-plan", 501).map((row) => String(row.detail));
		t.diagnostic(details.join(" | "));
		assert.ok(details.some((detail) =>
			detail.includes("idx_event_log_session_tool_event_sequence_stream")
			&& /session_id=\?.*tool_call_id=\?.*event_id=\?/i.test(detail)));
	} finally {
		store.close();
	}
});

test("message timing query accepts the shared cap and disables reconciliation at cap plus one", () => {
	const store = tempStore("pibo-chat-v2-timing-cap-");
	try {
		const timeline = new ChatTimelineQueryService(store);
		for (const [sessionId, count] of [["ps_timing_cap", 500], ["ps_timing_overflow", 501]]) {
			for (let index = 0; index < count; index += 1) {
				store.eventLog.appendEvent({
					sessionId,
					sessionSequence: index + 1,
					roomId: "room_timing_cap",
					topic: "pibo.output",
					type: "message_queued",
					source: "user",
					eventId: `turn-${index}`,
					retentionClass: "trace_event",
					previewText: `prompt ${index}`,
					attributes: {
						type: "message_queued",
						piboSessionId: sessionId,
						eventId: `turn-${index}`,
						text: `prompt ${index}`,
						source: "user",
						queuedMessages: 1,
					},
				});
			}
		}
		assert.equal(timeline.listMessageTurnTimings("ps_timing_cap").length, 500);
		assert.deepEqual(timeline.listMessageTurnTimings("ps_timing_overflow"), []);
		assert.equal(timeline.scanMessageTurnTimings("ps_timing_cap").overflow, false);
		assert.equal(timeline.scanMessageTurnTimings("ps_timing_overflow").overflow, true);
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
	assert.ok(
		eventLogIndexes.some((row) => row.name === "idx_event_log_session_tool_event_sequence_stream" && row.partial === 1),
		"event_log has a partial exact tool-lifecycle index",
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

test("unread counts drive the partial index from read cursors across deduplicated batches", () => {
	const store = tempStore("pibo-chat-v2-unread-range-");
	try {
		const commands = new ChatEventCommandService(store);
		const readState = new ChatReadStateService(store);
		const roomId = "room_unread_range";
		const targetSessionId = "ps_unread_range_target";
		const missingReadStateSessionId = "ps_unread_range_missing";
		const append = (piboSessionId, eventType, retentionClass = "chat_message") => commands.appendEvent({
			roomId,
			piboSessionId,
			eventType,
			actorType: eventType === "user.message.accepted" ? "user" : "assistant",
			actorId: "test:unread-range",
			retentionClass,
			payload: { type: eventType, piboSessionId, roomId, text: eventType },
		});

		append(targetSessionId, "user.message.accepted");
		const atCursor = append(targetSessionId, "assistant_message");
		readState.markSessionRead(targetSessionId, atCursor.streamId);
		append(targetSessionId, "user.message.accepted");
		append(targetSessionId, "assistant_message");
		append(targetSessionId, "session_error", "trace_event");
		append(targetSessionId, "assistant_delta", "live_event");
		append(missingReadStateSessionId, "assistant_message");

		const fillerIds = Array.from({ length: 399 }, (_, index) => `ps_unread_range_filler_${index}`);
		const uniqueIds = [targetSessionId, ...fillerIds, missingReadStateSessionId];
		let unreadSql;
		const originalPrepare = store.db.prepare.bind(store.db);
		store.db.prepare = (sql) => {
			if (!unreadSql && sql.includes("WITH requested(session_id)")) unreadSql = sql;
			return originalPrepare(sql);
		};
		const counts = readState.countUnreadMessagesBySession({
			piboSessionIds: [...uniqueIds, targetSessionId, missingReadStateSessionId],
		});
		store.db.prepare = originalPrepare;

		assert.deepEqual([...counts.entries()].sort(), [
			[missingReadStateSessionId, 1],
			[targetSessionId, 3],
		]);
		assert.ok(unreadSql, "expected the unread-count query to be captured");
		const details = originalPrepare(`EXPLAIN QUERY PLAN ${unreadSql}`)
			.all(...uniqueIds.slice(0, 400))
			.map((row) => String(row.detail));
		assert.ok(details.some((detail) =>
			detail.includes("idx_event_log_unread_session_stream")
			&& /session_id=\?.*stream_id>\?/i.test(detail)), details.join("\n"));
	} finally {
		store.close();
	}
});
