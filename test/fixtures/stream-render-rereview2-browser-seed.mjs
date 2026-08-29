import path from "node:path";
import { ChatRoomService } from "../../dist/apps/chat/data/room-service.js";
import { ChatSessionQueryService } from "../../dist/apps/chat/data/session-query-service.js";
import { OutputRenderSequencer } from "../../dist/core/output-render-sequence.js";
import { ChatDataIngestService } from "../../dist/data/ingest-service.js";
import { PiboDataStore } from "../../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../../dist/sessions/pibo-data-store.js";

const home = process.argv[2];
if (!home) throw new Error("usage: node stream-render-rereview2-browser-seed.mjs <pibo-home>");

const databasePath = path.join(home, "pibo.sqlite");
const payloadRootDir = path.join(home, "payloads");
const store = new PiboDataStore(databasePath, { payloadRootDir });
const rooms = new ChatRoomService(store);
const sessions = new ChatSessionQueryService(store);
const sessionStore = new PiboDataSessionStore(store);
const ingest = new ChatDataIngestService(store);
const room = rooms.ensureDefaultRoom({ name: "Streaming determinism evidence" });
const session = {
	id: "ps_stream_render_rereview2_browser",
	piSessionId: "pi_stream_render_rereview2_browser",
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
const sequencer = new OutputRenderSequencer({ now: () => clock, highWaterStore: sessionStore });
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

store.db.exec("PRAGMA user_version = 6");
store.close();

process.stdout.write(`${JSON.stringify({ home, databasePath, roomId: room.id, piboSessionId: session.id })}\n`);
