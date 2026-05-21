import assert from "node:assert/strict";
import test from "node:test";
import { applyTraceLiveEvents } from "../dist/shared/trace-live-reducer.js";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";

function apply(streamEvents) {
	let seq = 1;
	return applyTraceLiveEvents({
		currentEvents: [],
		streamEvents,
		piboSessionId: "ps-live",
		nextSequence: () => seq++,
		now: () => "2026-05-21T18:00:00.000Z",
	});
}

test("live reducer keeps multiple frames from the same stream event", () => {
	const events = apply([
		{ type: "RAW_EVENT", streamId: 10, streamFrameIndex: 0, event: { type: "message_started", piboSessionId: "ps-live", eventId: "turn-1", text: "hello" } },
		{ type: "RAW_EVENT", streamId: 11, streamFrameIndex: 0, event: { type: "assistant_delta", piboSessionId: "ps-live", eventId: "turn-1", text: "Hello" } },
		{ type: "RAW_EVENT", streamId: 11, streamFrameIndex: 1, event: { type: "assistant_delta", piboSessionId: "ps-live", eventId: "turn-1", text: " streaming" } },
		{ type: "RAW_EVENT", streamId: 11, streamFrameIndex: 2, event: { type: "assistant_delta", piboSessionId: "ps-live", eventId: "turn-1", text: " world" } },
	]);

	assert.deepEqual(events.filter((event) => event.type === "assistant_delta").map((event) => event.payload.text), ["Hello", " streaming", " world"]);

	const view = buildTraceViewFromEvents({
		session: { id: "ps-live", piSessionId: "pi-live" },
		events,
		status: "running",
		includeRawEvents: true,
	});
	const assistant = view.nodes.flatMap((node) => [node, ...node.children]).find((node) => node.type === "assistant.message");
	assert.equal(assistant?.output, "Hello streaming world");
});

test("live reducer still dedupes replayed stream frames", () => {
	const events = apply([
		{ type: "RAW_EVENT", streamId: 11, streamFrameIndex: 1, event: { type: "assistant_delta", piboSessionId: "ps-live", eventId: "turn-1", text: " streaming" } },
		{ type: "RAW_EVENT", streamId: 11, streamFrameIndex: 1, event: { type: "assistant_delta", piboSessionId: "ps-live", eventId: "turn-1", text: " streaming" } },
	]);

	assert.equal(events.length, 1);
	assert.equal(events[0].payload.text, " streaming");
});
