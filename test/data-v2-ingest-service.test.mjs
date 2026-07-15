import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { storedPiboEventFromV2Row } from "../dist/apps/chat/data/chat-data-mappers.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
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
			},
		});

		const events = store.eventLog.listEvents({ sessionId: session.id });
		assert.equal(events.length, 2);
		assert.deepEqual(events.map((event) => event.attributes.argsComplete), [false, true]);
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
