import path from "node:path";
import { ChatRoomService } from "../../dist/apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../../dist/apps/chat/data/session-query-service.js";
import { OutputRenderSequencer } from "../../dist/core/output-render-sequence.js";
import { ChatDataIngestService, outputPersistenceDeliveryKey } from "../../dist/data/ingest-service.js";
import { PiboDataStore } from "../../dist/data/pibo-store.js";
import { PiboReliabilityStore } from "../../dist/reliability/store.js";
import { PiboDataSessionStore } from "../../dist/sessions/pibo-data-store.js";

const home = process.argv[2];
if (!home) throw new Error("usage: node stream-render-rereview2-browser-seed.mjs <pibo-home>");

const databasePath = path.join(home, "pibo.sqlite");
const payloadRootDir = path.join(home, "payloads");
let store = new PiboDataStore(databasePath, { payloadRootDir });
const rooms = new ChatRoomService(store);
let sessions = new ChatSessionQueryService(store);
let sessionStore = new PiboDataSessionStore(store);
let ingest = new ChatDataIngestService(store);
const room = rooms.ensureDefaultRoom({ name: "Streaming determinism evidence" });
const session = {
	id: "ps_stream_render_rereview2_browser",
	channel: "pibo.chat-web",
	kind: "chat",
	profile: "base",
	title: "STREAM REREVIEW2 · legacy + chronology + reused tools",
	metadata: { chatRoomId: room.id, roomId: room.id },
	createdAt: "2026-08-29T18:00:00.000Z",
	updatedAt: "2026-08-29T18:00:30.000Z",
};

sessions.upsertSession(session);

for (const [index, sessionSequence] of [undefined, 1, undefined, 2].entries()) {
	const eventId = `legacy-browser-${index + 1}`;
	const event = {
		type: "assistant_message",
		piboSessionId: session.id,
		eventId,
		assistantIndex: 0,
		text: `Legacy hydrated segment ${index + 1}`,
	};
	store.eventLog.appendEvent({
		sessionId: session.id,
		sessionSequence,
		roomId: room.id,
		topic: "pibo.output",
		type: event.type,
		source: "browser-evidence-v6",
		actorType: "assistant",
		eventId,
		idempotencyKey: `browser-legacy-${index + 1}`,
		retentionClass: "chat_message",
		previewText: event.text,
		attributes: { inlinePayload: event },
		createdAt: `2026-08-29T18:00:0${index}.000Z`,
	});
}

let clock = Date.parse("2026-08-29T18:01:00.000Z");
let sequencer = new OutputRenderSequencer({ now: () => clock, highWaterStore: sessionStore });
function persist(event, createdAt) {
	clock = Date.parse(createdAt);
	const positioned = sequencer.position({ piboSessionId: session.id, ...event });
	const stored = ingest.ingestOutputEvent({ session, roomId: room.id, event: positioned, createdAt });
	sessions.recordEvent(positioned, session, stored.streamId, createdAt);
	return positioned;
}

persist({ type: "message_queued", eventId: "browser-turn-one", text: "First user turn", source: "user" }, "2026-08-29T18:01:00.000Z");
persist({ type: "message_started", eventId: "browser-turn-one", text: "First user turn", source: "user" }, "2026-08-29T18:01:01.000Z");
persist({ type: "assistant_message", eventId: "browser-turn-one", assistantIndex: 0, text: "First assistant answer" }, "2026-08-29T18:01:02.000Z");
persist({
	type: "tool_execution_finished",
	eventId: "browser-turn-one",
	toolCallId: "browser-reused-tool",
	toolName: "read",
	result: { content: [{ type: "text", text: "A".repeat(1024 * 1024) }], details: { invocation: "first", path: "first.txt" } },
	isError: false,
}, "2026-08-29T18:01:03.000Z");
persist({ type: "tool_execution_started", eventId: "browser-turn-one", toolCallId: "browser-reused-tool", toolName: "read", args: { path: "first.txt" } }, "2026-08-29T18:01:04.000Z");
persist({ type: "tool_call", eventId: "browser-turn-one", toolCallId: "browser-reused-tool", toolName: "read", args: { path: "first.txt" }, argsComplete: true }, "2026-08-29T18:01:05.000Z");
persist({ type: "message_finished", eventId: "browser-turn-one", source: "user" }, "2026-08-29T18:01:06.000Z");

persist({ type: "execution_result", eventId: "browser-execution", action: "workflow checkpoint", result: { status: "ok" } }, "2026-08-29T18:01:07.000Z");

persist({ type: "message_queued", eventId: "browser-turn-two", text: "Second user turn", source: "user" }, "2026-08-29T18:01:08.000Z");
persist({ type: "message_started", eventId: "browser-turn-two", text: "Second user turn", source: "user" }, "2026-08-29T18:01:09.000Z");
persist({ type: "assistant_message", eventId: "browser-turn-two", assistantIndex: 0, text: "Second assistant answer" }, "2026-08-29T18:01:10.000Z");
persist({ type: "tool_call", eventId: "browser-turn-two", toolCallId: "browser-reused-tool", toolName: "read", args: { path: "second.txt" }, argsComplete: true }, "2026-08-29T18:01:11.000Z");
persist({ type: "tool_execution_started", eventId: "browser-turn-two", toolCallId: "browser-reused-tool", toolName: "read", args: { path: "second.txt" } }, "2026-08-29T18:01:12.000Z");
persist({ type: "tool_execution_finished", eventId: "browser-turn-two", toolCallId: "browser-reused-tool", toolName: "read", result: { content: [{ type: "text", text: "second invocation" }], details: { invocation: "second", path: "second.txt" } }, isError: false }, "2026-08-29T18:01:13.000Z");
persist({ type: "message_finished", eventId: "browser-turn-two", source: "user" }, "2026-08-29T18:01:14.000Z");

persist({ type: "tool_call", eventId: "browser-restart-turn", toolCallId: "browser-restart-tool", toolName: "read", args: { path: "before-restart.txt" }, argsComplete: true }, "2026-08-29T18:01:15.000Z");
store.close();
store = new PiboDataStore(databasePath, { payloadRootDir });
sessions = new ChatSessionQueryService(store);
sessionStore = new PiboDataSessionStore(store);
ingest = new ChatDataIngestService(store);
sequencer = new OutputRenderSequencer({ now: () => clock, highWaterStore: sessionStore });
persist({ type: "tool_execution_started", eventId: "browser-restart-turn", toolCallId: "browser-restart-tool", toolName: "read", args: { path: "before-restart.txt" } }, "2026-08-29T18:01:16.000Z");
persist({ type: "tool_execution_updated", eventId: "browser-restart-turn", toolCallId: "browser-restart-tool", toolName: "read", args: { path: "before-restart.txt" }, partialResult: "resumed after reopen" }, "2026-08-29T18:01:17.000Z");
persist({ type: "tool_execution_finished", eventId: "browser-restart-turn", toolCallId: "browser-restart-tool", toolName: "read", result: "restart lifecycle attached to ordinal zero", isError: false }, "2026-08-29T18:01:18.000Z");

const onePixelPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let legacyImageEventOffset = 0;
function appendLegacyImageLifecycle({ eventId, toolCallId, ambiguous }) {
	const payload = store.payloads.writePayload({
		value: { content: [{ type: "image", data: onePixelPng, mimeType: "image/png" }], padding: "x".repeat(300 * 1024) },
		contentType: "application/json",
		retentionClass: "trace_event",
	});
	const append = (type, payloadRef) => store.eventLog.appendEvent({
		sessionId: session.id,
		roomId: room.id,
		topic: "pibo.output",
		type,
		source: "browser-legacy-payload",
		actorType: "assistant",
		eventId,
		toolCallId,
		retentionClass: "trace_event",
		payloadRef,
		previewText: "legacy image fixture",
		attributes: {
			eventIdentityScoped: true,
			semanticEventId: eventId,
			toolCallId,
			toolName: "image",
			isError: false,
		},
		createdAt: new Date(Date.parse("2026-08-29T18:01:19.000Z") + legacyImageEventOffset++ * 1000).toISOString(),
	});
	append("tool_execution_started");
	if (ambiguous) append("tool_execution_started");
	append("tool_execution_finished", payload.id);
}
appendLegacyImageLifecycle({ eventId: "browser-legacy-valid-turn", toolCallId: "browser-legacy-valid-image", ambiguous: false });
appendLegacyImageLifecycle({ eventId: "browser-legacy-ambiguous-turn", toolCallId: "browser-legacy-ambiguous-image", ambiguous: true });

const retryEvent = persist({
	type: "assistant_message",
	eventId: "browser-reliability-retry",
	assistantIndex: 0,
	text: "Reliability retry delivered once",
}, "2026-08-29T18:01:30.000Z");
const retryRow = store.eventLog.findByIdempotencyKey(outputPersistenceDeliveryKey(retryEvent));
if (!retryRow) throw new Error("failed to seed retry V2 event");

store.db.exec("PRAGMA user_version = 6");
store.close();

const reliability = new PiboReliabilityStore(path.join(home, "pibo-events.sqlite"));
const retryKey = JSON.stringify([outputPersistenceDeliveryKey(retryEvent)]);
reliability.enqueue({
	queue: "output-persistence",
	idempotencyKey: retryKey,
	payload: {
		key: retryKey,
		piboSessionId: session.id,
		eventId: outputPersistenceDeliveryKey(retryEvent),
		state: {
			version: 1,
			piboSessionId: session.id,
			roomId: room.id,
			actorId: session.id,
			deliveries: [{
				event: retryEvent,
				v2: { streamId: retryRow.streamId, createdAt: retryRow.createdAt, eventId: retryEvent.eventId },
			}],
		},
	},
	maxAttempts: 5,
});
reliability.close();

process.stdout.write(`${JSON.stringify({ home, databasePath, roomId: room.id, piboSessionId: session.id })}\n`);
