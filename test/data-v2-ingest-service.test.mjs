import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { storedPiboEventFromV2Row } from "../dist/apps/chat/data/chat-data-mappers.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { ChatDataIngestService, PiboOutputIdentityCollisionError } from "../dist/data/ingest-service.js";
import { ChatHistoryQueryService } from "../dist/apps/chat/data/history-query-service.js";
import { ChatTimelineQueryService } from "../dist/apps/chat/data/timeline-query-service.js";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";

function makeSession(overrides = {}) {
	const now = "2026-05-08T12:00:00.000Z";
	return {
		id: "ps_ingest_test",
		piSessionId: "pi_ingest_test",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "base",
			workspace: "/tmp",
		createdAt: now,
		updatedAt: now,
		metadata: {},
		...overrides,
	};
}

function eventRow(sequence, type, attributes = {}, previewText = null) {
	return {
		stream_id: sequence,
		session_id: "ps_part_identity",
		session_sequence: sequence,
		room_id: "room_part_identity",
		type,
		actor_type: "assistant",
		actor_id: "agent:test",
		event_id: "turn-part-identity",
		idempotency_key: `${type}:${sequence}`,
		retention_class: type.endsWith("_delta") ? "live_delta" : "trace_event",
		preview_text: previewText,
		attributes_json: JSON.stringify(attributes),
		created_at: `2026-05-08T12:00:${String(sequence).padStart(2, "0")}.000Z`,
	};
}

test("chat data ingest writes user messages idempotently", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const input = {
			session: makeSession(),
			roomId: "room_ingest_test",
			actorId: "user:test",
			text: "hello v2 ingest",
			clientTxnId: "txn-1",
			legacyEvent: {
				streamId: 11,
				eventId: "legacy-event-1",
				createdAt: "2026-05-08T12:01:00.000Z",
			},
		};

		const first = ingest.ingestUserMessageAccepted(input);
		const second = ingest.ingestUserMessageAccepted(input);

		assert.equal(first.duplicate, false);
		assert.equal(second.duplicate, true);
		assert.equal(second.messageId, first.messageId);

		const events = store.eventLog.listEvents({ sessionId: input.session.id });
		const messages = store.messages.listMessages(input.session.id);
		const navigation = store.navigation.getSession(input.session.id);
		const session = store.db.prepare("SELECT * FROM sessions WHERE id = ?").get(input.session.id);

		assert.equal(events.length, 1);
		assert.equal(events[0].type, "user.message.accepted");
		assert.equal(events[0].idempotencyKey, "chat:user.accepted:room_ingest_test:user:test:txn-1");
		assert.equal(events[0].previewText, "hello v2 ingest");
		assert.equal(messages.length, 1);
		assert.equal(messages[0].id, first.messageId);
		assert.equal(messages[0].sourceStreamId, events[0].streamId);
		assert.equal(messages[0].contentPreview, "hello v2 ingest");
		assert.equal(messages[0].attributes.inlineText, "hello v2 ingest");
		assert.equal(navigation?.lastMessagePreview, "hello v2 ingest");
		assert.equal(session?.room_id, "room_ingest_test");
	} finally {
		store.close();
	}
});

test("chat data ingest records repeated user messages without client transaction id", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_repeated_user_message", piSessionId: "pi_repeated_user_message" });
		const input = {
			session,
			roomId: "room_repeated_user_message",
			actorId: "user:test",
			text: "same intentional message",
		};

		const first = ingest.ingestUserMessageAccepted(input);
		const second = ingest.ingestUserMessageAccepted(input);

		assert.equal(first.duplicate, false);
		assert.equal(second.duplicate, false);
		assert.notEqual(second.messageId, first.messageId);

		const events = store.eventLog.listEvents({ sessionId: session.id });
		const messages = store.messages.listMessages(session.id);
		assert.equal(events.length, 2);
		assert.deepEqual(events.map((event) => event.idempotencyKey), [undefined, undefined]);
		assert.deepEqual(events.map((event) => event.sessionSequence), [1, 2]);
		assert.equal(messages.length, 2);
		assert.deepEqual(messages.map((message) => message.sequence), [1, 2]);
		assert.deepEqual(messages.map((message) => message.contentPreview), ["same intentional message", "same intentional message"]);
	} finally {
		store.close();
	}
});

test("chat data ingest externalizes large user message payloads", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const text = "x".repeat(20 * 1024);
		ingest.ingestUserMessageAccepted({
			session: makeSession({ id: "ps_large_message", piSessionId: "pi_large_message" }),
			roomId: "room_large_message",
			actorId: "user:test",
			text,
			clientTxnId: "txn-large",
		});

		const [message] = store.messages.listMessages("ps_large_message");
		assert.ok(message.contentPayloadRef);
		assert.equal(message.attributes.inlineText, undefined);
		assert.equal(store.payloads.readPayloadText(message.contentPayloadRef), text);
	} finally {
		store.close();
	}
});

test("chat data ingest shadows assistant messages and observations idempotently", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_output", piSessionId: "pi_output" });
		const input = {
			session,
			roomId: "room_output",
			actorId: "agent:test",
			legacyStreamId: 42,
			createdAt: "2026-05-08T12:02:00.000Z",
			event: {
				type: "assistant_message",
				piboSessionId: session.id,
				eventId: "run-output-1",
				assistantIndex: 0,
				text: "assistant shadow",
			},
		};

		const first = ingest.ingestOutputEvent(input);
		const second = ingest.ingestOutputEvent(input);

		assert.equal(first.duplicate, false);
		assert.equal(second.duplicate, true);
		assert.equal(second.streamId, first.streamId);

		const events = store.eventLog.listEvents({ sessionId: session.id });
		const messages = store.messages.listMessages(session.id);
		const observations = store.observations.listObservations(session.id);
		assert.equal(events.length, 1);
		assert.equal(events[0].type, "assistant_message");
		assert.equal(events[0].idempotencyKey, "pibo.output:ps_output:assistant_message:run-output-1:0");
		assert.equal(messages.length, 1);
		assert.equal(messages[0].role, "assistant");
		assert.equal(messages[0].contentPreview, "assistant shadow");
		assert.equal(observations.length, 1);
		assert.equal(observations[0].kind, "message");
		assert.equal(observations[0].eventStreamId, events[0].streamId);
	} finally {
		store.close();
	}
});

test("chat data ingest round-trips immutable render sequence metadata", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-render-sequence-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_render_sequence", piSessionId: "pi_render_sequence" });
		const input = {
			session,
			roomId: "room_render_sequence",
			actorId: "agent:test",
			event: {
				type: "assistant_message",
				piboSessionId: session.id,
				eventId: "turn-render-sequence",
				assistantIndex: 0,
				text: "stable",
				renderSequence: 1_234_567,
			},
		};
		const first = ingest.ingestOutputEvent(input);
		const replay = ingest.ingestOutputEvent({
			...input,
			event: { ...input.event, renderSequence: 9_999_999 },
		});
		const row = store.eventLog.listEvents({ sessionId: session.id })[0];
		const mapped = storedPiboEventFromV2Row({
			stream_id: row.streamId,
			session_id: row.sessionId,
			session_sequence: row.sessionSequence,
			room_id: row.roomId ?? null,
			type: row.type,
			actor_type: row.actorType ?? null,
			actor_id: row.actorId ?? null,
			event_id: row.eventId ?? null,
			idempotency_key: row.idempotencyKey ?? null,
			retention_class: row.retentionClass,
			payload_ref: row.payloadRef ?? null,
			preview_text: row.previewText ?? null,
			attributes_json: JSON.stringify(row.attributes ?? {}),
			created_at: row.createdAt,
		}, store.payloads);

		assert.equal(row.attributes.renderSequence, 1_234_567);
		assert.equal(first.duplicate, false);
		assert.equal(replay.duplicate, true);
		assert.equal(mapped.renderSequence, 1_234_567);
		assert.equal(mapped.payload.renderSequence, 1_234_567);
	} finally {
		store.close();
	}
});

test("chat data ingest preserves post-compaction output and repeated lifecycle events", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_compaction_continue", piSessionId: "pi_compaction_continue" });
		const output = [
			{ type: "assistant_message", piboSessionId: session.id, eventId: "turn-1", assistantIndex: 0, text: "before compaction" },
			{ type: "assistant_usage", piboSessionId: session.id, eventId: "turn-1", usageIndex: 0, inputTokens: 10, outputTokens: 2, totalTokens: 12 },
			{ type: "compaction_start", piboSessionId: session.id, eventId: "turn-1", compactionIndex: 0, reason: "context_guard" },
			{ type: "compaction_end", piboSessionId: session.id, eventId: "turn-1", compactionIndex: 0, reason: "context_guard", result: { summary: "compact" }, aborted: false },
			{ type: "assistant_message", piboSessionId: session.id, eventId: "turn-1", assistantIndex: 1, text: "final answer" },
			{ type: "assistant_usage", piboSessionId: session.id, eventId: "turn-1", usageIndex: 1, inputTokens: 6, outputTokens: 3, totalTokens: 9 },
			{ type: "message_finished", piboSessionId: session.id, eventId: "turn-1" },
		];

		for (const [index, event] of output.entries()) {
			const result = ingest.ingestOutputEvent({
				session,
				roomId: "room_compaction_continue",
				actorId: "agent:test",
				createdAt: `2026-05-08T12:03:0${index}.000Z`,
				event,
			});
			assert.equal(result.duplicate, false);
		}

		const replay = ingest.ingestOutputEvent({
			session,
			roomId: "room_compaction_continue",
			actorId: "agent:test",
			event: output[4],
		});
		assert.equal(replay.duplicate, true, "an exact replay should remain idempotent");

		const rows = store.eventLog.listEvents({ sessionId: session.id });
		assert.deepEqual(rows.map((event) => event.type), output.map((event) => event.type));
		assert.equal(new Set(rows.map((event) => event.idempotencyKey)).size, output.length);
		assert.deepEqual(store.messages.listMessages(session.id).map((message) => message.contentPreview), ["before compaction", "final answer"]);
		assert.equal(rows.find((event) => event.type === "message_finished").streamId > rows.findLast((event) => event.type === "assistant_message").streamId, true);

		const mappedUsage = storedPiboEventFromV2Row({
			...eventRow(20, "assistant_usage", rows[5].attributes),
			attributes_json: JSON.stringify(rows[5].attributes),
		});
		const mappedCompaction = storedPiboEventFromV2Row({
			...eventRow(21, "compaction_end", rows[3].attributes),
			attributes_json: JSON.stringify({ ...rows[3].attributes, inlinePayload: { summary: "compact" } }),
		});
		assert.equal(mappedUsage.payload.usageIndex, 1);
		assert.equal(mappedCompaction.payload.compactionIndex, 0);
		assert.equal(mappedCompaction.payload.result.summary, "compact");
	} finally {
		store.close();
	}
});

test("chat data ingest records output identity collisions instead of silently dropping them", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_identity_collision", piSessionId: "pi_identity_collision" });
		const base = {
			session,
			roomId: "room_identity_collision",
			actorId: "agent:test",
		};
		ingest.ingestOutputEvent({
			...base,
			event: { type: "assistant_message", piboSessionId: session.id, eventId: "turn-1", assistantIndex: 0, text: "first" },
		});

		assert.throws(
			() => ingest.ingestOutputEvent({
				...base,
				event: { type: "assistant_message", piboSessionId: session.id, eventId: "turn-1", assistantIndex: 0, text: "different" },
			}),
			(error) => error instanceof PiboOutputIdentityCollisionError && error.code === "pibo_output_identity_collision",
		);

		const rows = store.eventLog.listEvents({ sessionId: session.id });
		assert.deepEqual(rows.map((event) => event.type), ["assistant_message", "pibo.output.identity_collision"]);
		assert.equal(rows[1].topic, "pibo.diagnostic");
		assert.equal(rows[1].attributes.outputIdempotencyKey, rows[0].idempotencyKey);
		assert.notEqual(rows[1].attributes.existingFingerprint, rows[1].attributes.incomingFingerprint);
	} finally {
		store.close();
	}
});

test("non-lifecycle output after message_finished does not reopen the persisted session", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_lifecycle_status", piSessionId: "pi_lifecycle_status" });
		const input = { session, roomId: "room_lifecycle_status", actorId: "agent:test" };
		ingest.ingestOutputEvent({ ...input, event: { type: "message_started", piboSessionId: session.id, eventId: "turn-status", text: "run", source: "user" } });
		ingest.ingestOutputEvent({ ...input, event: { type: "message_finished", piboSessionId: session.id, eventId: "turn-status", source: "user" } });
		ingest.ingestOutputEvent({ ...input, event: { type: "execution_result", piboSessionId: session.id, eventId: "status-result", action: "status", result: { ok: true } } });
		const row = store.db.prepare("SELECT status FROM sessions WHERE id = ?").get(session.id);
		assert.equal(row.status, "idle");
		assert.equal(store.navigation.getSession(session.id)?.status, "idle");
	} finally {
		store.close();
	}
});

test("v2 event mapper preserves assistant and reasoning part identities", () => {
	const rows = [
		eventRow(1, "message_started", {}, "start"),
		eventRow(2, "thinking_started", { thinkingIndex: 0, contentIndex: 4 }),
		eventRow(3, "thinking_delta", { thinkingIndex: 0, contentIndex: 4, inlinePayload: "first" }, "first"),
		eventRow(4, "thinking_finished", { thinkingIndex: 0, contentIndex: 4 }, "first"),
		eventRow(5, "thinking_started", { thinkingIndex: 1, contentIndex: 8 }),
		eventRow(6, "thinking_finished", { thinkingIndex: 1, contentIndex: 8 }, "second"),
		eventRow(7, "thinking_started", { thinkingIndex: 2, contentIndex: 12 }),
		eventRow(8, "thinking_finished", { thinkingIndex: 2, contentIndex: 12 }, "third"),
		eventRow(9, "assistant_delta", { assistantIndex: 0, contentIndex: 5, inlinePayload: "answer" }, "answer"),
		eventRow(10, "assistant_message", { assistantIndex: 0, contentIndex: 5 }, "answer"),
		eventRow(11, "message_finished"),
	];
	const events = rows.map(storedPiboEventFromV2Row).filter(Boolean);
	const byStreamId = new Map(events.map((event) => [event.streamId, event]));

	for (const [streamId, thinkingIndex, contentIndex] of [
		[2, 0, 4],
		[3, 0, 4],
		[4, 0, 4],
		[5, 1, 8],
		[6, 1, 8],
		[7, 2, 12],
		[8, 2, 12],
	]) {
		assert.equal(byStreamId.get(streamId).payload.thinkingIndex, thinkingIndex);
		assert.equal(byStreamId.get(streamId).payload.contentIndex, contentIndex);
	}
	for (const streamId of [9, 10]) {
		assert.equal(byStreamId.get(streamId).payload.assistantIndex, 0);
		assert.equal(byStreamId.get(streamId).payload.contentIndex, 5);
	}

	for (const [sequence, type, optionalFields] of [
		[20, "assistant_message", ["assistantIndex", "contentIndex"]],
		[21, "thinking_started", ["thinkingIndex", "contentIndex"]],
		[22, "thinking_finished", ["thinkingIndex", "contentIndex"]],
	]) {
		const legacy = storedPiboEventFromV2Row(eventRow(sequence, type, {}, "legacy"));
		for (const field of optionalFields) assert.equal(Object.hasOwn(legacy.payload, field), false);
	}

	const view = buildTraceViewFromEvents({
		session: { id: "ps_part_identity", piSessionId: "pi_part_identity", title: "Part identity" },
		events,
		status: "running",
	});
	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.deepEqual(turn.children.map((node) => node.id), [
		"event:thinking:turn-part-identity:thinking:0",
		"event:thinking:turn-part-identity:thinking:1",
		"event:thinking:turn-part-identity:thinking:2",
		"event:assistant:turn-part-identity:assistant:0",
	]);
});

test("chat data ingest keeps progressive tool call argument snapshots", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_tool_args", piSessionId: "pi_tool_args" });
		const baseInput = {
			session,
			roomId: "room_tool_args",
			legacyStreamId: 12,
			createdAt: "2026-05-08T12:02:00.000Z",
		};

		ingest.ingestOutputEvent({
			...baseInput,
			event: {
				type: "tool_call",
				piboSessionId: session.id,
				eventId: "run-tool-args",
				toolCallId: "tool-args-1",
				toolName: "read",
				args: { path: "READ" },
				argsComplete: false,
			},
		});
		ingest.ingestOutputEvent({
			...baseInput,
			legacyStreamId: 13,
			event: {
				type: "tool_call",
				piboSessionId: session.id,
				eventId: "run-tool-args",
				toolCallId: "tool-args-1",
				toolName: "read",
				args: { path: "README.md" },
				argsComplete: true,
				intent: "Reviewing project documentation",
			},
		});

		const events = store.eventLog.listEvents({ sessionId: session.id });
		assert.equal(events.length, 2);
		assert.deepEqual(events.map((event) => event.attributes.argsComplete), [false, true]);
		assert.deepEqual(events.map((event) => event.attributes.intent), [undefined, "Reviewing project documentation"]);
	} finally {
		store.close();
	}
});

test("chat data ingest shadows tool output into observations", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_tool", piSessionId: "pi_tool" });
		ingest.ingestOutputEvent({
			session,
			roomId: "room_tool",
			event: {
				type: "tool_execution_finished",
				piboSessionId: session.id,
				eventId: "run-tool-1",
				toolCallId: "tool-1",
				toolName: "read",
				result: { ok: true },
				isError: false,
			},
		});

		const events = store.eventLog.listEvents({ sessionId: session.id });
		const observations = store.observations.listObservations(session.id);
		assert.equal(events.length, 1);
		assert.equal(events[0].type, "tool_execution_finished");
		assert.equal(observations.length, 1);
		assert.equal(observations[0].kind, "tool");
		assert.equal(observations[0].name, "read");
		assert.equal(observations[0].status, "completed");
		assert.deepEqual(observations[0].attributes.toolCallId, "tool-1");
	} finally {
		store.close();
	}
});

test("persisted subagent session fields survive V2 ingest and trace reload", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-ingest-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const session = makeSession({ id: "ps_subagent_parent", piSessionId: "pi_subagent_parent" });
		const common = { session, roomId: "room_subagent", createdAt: "2026-05-08T12:02:00.000Z" };
		ingest.ingestOutputEvent({
			...common,
			event: {
				type: "tool_call",
				piboSessionId: session.id,
				eventId: "run-subagent-1",
				toolCallId: "tool-subagent-1",
				toolName: "pibo_subagent_explorer",
				args: { message: "Inspect the persisted path", threadKey: "persisted" },
				argsComplete: true,
			},
		});
		ingest.ingestOutputEvent({
			...common,
			createdAt: "2026-05-08T12:02:01.000Z",
			event: {
				type: "subagent_session",
				piboSessionId: session.id,
				toolCallId: "tool-subagent-1",
				toolName: "pibo_subagent_explorer",
				subagentName: "explorer",
				childPiboSessionId: "ps_subagent_child",
				threadKey: "persisted",
			},
		});

		const rows = store.db.prepare("SELECT * FROM event_log WHERE session_id = ? ORDER BY stream_id").all(session.id);
		const events = rows.map(storedPiboEventFromV2Row).filter(Boolean);
		assert.equal(events[1].payload.type, "subagent_session");
		assert.equal(events[1].payload.piboSessionId, session.id);
		assert.equal(events[1].payload.toolCallId, "tool-subagent-1");
		assert.equal(events[1].payload.toolName, "pibo_subagent_explorer");
		assert.equal(events[1].payload.subagentName, "explorer");
		assert.equal(events[1].payload.childPiboSessionId, "ps_subagent_child");
		assert.equal(events[1].payload.threadKey, "persisted");

		const view = buildTraceViewFromEvents({
			session: { id: session.id, piSessionId: session.piSessionId, title: "Parent" },
			events,
			status: "running",
		});
		assert.equal(view.nodes.length, 1);
		assert.equal(view.nodes[0].type, "agent.delegation");
		assert.equal(view.nodes[0].linkedPiboSessionId, "ps_subagent_child");
		assert.equal(view.nodes[0].input.message, "Inspect the persisted path");
		assert.equal(view.nodes[0].input.threadKey, "persisted");
		assert.equal(view.nodes[0].input.subagentName, "explorer");
	} finally {
		store.close();
	}
});

test("product history reconstructs full routed messages without native transcript data", () => {
	const store = new PiboDataStore(":memory:", { payloadRootDir: mkdtempSync(join(tmpdir(), "pibo-product-history-payloads-")) });
	try {
		const ingest = new ChatDataIngestService(store);
		const history = new ChatHistoryQueryService(store);
		const timeline = new ChatTimelineQueryService(store);
		const session = makeSession({
			id: "ps_product_history",
			piSessionId: "pi_product_history",
			runtimeBinding: {
				piboSessionId: "ps_product_history",
				runtimeInstanceId: "runtime-fixture",
				adapterId: "fixture",
				nativeSessionId: "native-product-history",
				state: "bound",
				revision: 1,
				createdAt: "2026-05-08T12:00:00.000Z",
				updatedAt: "2026-05-08T12:00:00.000Z",
			},
		});
		const userText = `user:${"u".repeat(20_000)}`;
		const reasoningText = `reasoning:${"r".repeat(18_000)}`;
		const toolResult = { content: `tool:${"t".repeat(20_000)}`, details: { status: "completed" } };
		const assistantText = `assistant:${"a".repeat(24_000)}`;
		ingest.ingestUserMessageAccepted({
			session,
			roomId: "room_product_history",
			actorId: "user:test",
			text: userText,
			clientTxnId: "txn-product-history",
			legacyEvent: { eventId: "accepted-product-history", createdAt: "2026-05-08T12:00:01.000Z" },
		});
		for (const [createdAt, event] of [
			["2026-05-08T12:00:01.100Z", { type: "message_queued", piboSessionId: session.id, eventId: "turn-product-history", queuedMessages: 1, text: userText, source: "user" }],
			["2026-05-08T12:00:01.200Z", { type: "message_started", piboSessionId: session.id, eventId: "turn-product-history", text: userText, source: "user" }],
			["2026-05-08T12:00:01.300Z", { type: "thinking_finished", piboSessionId: session.id, eventId: "turn-product-history", thinkingIndex: 0, contentIndex: 0, text: reasoningText }],
			["2026-05-08T12:00:01.400Z", { type: "tool_call", piboSessionId: session.id, eventId: "turn-product-history", toolCallId: "tool-product-history", toolName: "read", args: { path: "large.txt" }, argsComplete: true }],
			["2026-05-08T12:00:01.500Z", { type: "tool_execution_finished", piboSessionId: session.id, eventId: "turn-product-history", toolCallId: "tool-product-history", toolName: "read", result: toolResult, isError: false }],
			["2026-05-08T12:00:02.000Z", { type: "assistant_message", piboSessionId: session.id, eventId: "turn-product-history", assistantIndex: 0, contentIndex: 0, text: assistantText }],
			["2026-05-08T12:00:02.100Z", { type: "message_finished", piboSessionId: session.id, eventId: "turn-product-history" }],
		]) {
			ingest.ingestOutputEvent({ session, roomId: "room_product_history", createdAt, event });
		}

		const historyEntries = history.listProductHistoryEntries({ piboSessionId: session.id, limit: 20 });
		const events = timeline.listTraceEvents({ piboSessionId: session.id, limit: 20 });
		assert.equal(historyEntries.length, 2);
		assert.equal(historyEntries[0].type, "message");
		assert.equal(historyEntries[0].content, userText);
		assert.equal(historyEntries[1].type, "message");
		assert.equal(historyEntries[1].content, assistantText);
		assert.equal(events.find((event) => event.type === "thinking_finished")?.payload.text, reasoningText);
		assert.deepEqual(events.find((event) => event.type === "tool_execution_finished")?.payload.result, toolResult);
		assert.equal(events.find((event) => event.type === "assistant_message")?.payload.text, assistantText);

		const view = buildTraceViewFromEvents({
			session: { id: session.id, piSessionId: session.piSessionId, title: "Product history" },
			historyEntries,
			events,
			status: "idle",
		});
		const user = view.nodes.find((node) => node.type === "user.message");
		const turn = view.nodes.find((node) => node.type === "agent.turn");
		const assistant = turn?.children.find((node) => node.type === "assistant.message")
			?? view.nodes.find((node) => node.type === "assistant.message");
		const reasoning = turn?.children.find((node) => node.type === "model.reasoning")
			?? view.nodes.find((node) => node.type === "model.reasoning");
		const tool = turn?.children.find((node) => node.type === "tool.call")
			?? view.nodes.find((node) => node.type === "tool.call");
		assert.equal(user?.output, userText);
		assert.equal(user?.source, "product-history");
		assert.equal(reasoning?.output, reasoningText);
		assert.deepEqual(tool?.output, toolResult);
		assert.equal(assistant?.output, assistantText);
		assert.equal(assistant?.source, "product-history");
		assert.equal(view.nodes.flatMap((node) => [node, ...node.children]).filter((node) => node.type === "assistant.message").length, 1);
	} finally {
		store.close();
	}
});
