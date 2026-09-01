import assert from "node:assert/strict";
import test from "node:test";
import { eventTraceOrder, transcriptTraceOrder } from "../dist/shared/trace-order.js";
import { compareTraceNodes } from "../dist/shared/trace-nodes.js";

function node(id, overrides = {}) {
	return {
		id,
		piboSessionId: "ps-test",
		type: "execution.command",
		title: id,
		status: "done",
		children: [],
		...overrides,
	};
}

test("trace node order is monotonic within one projection source even when timestamps regress", () => {
	const first = node("event-1", {
		startedAt: "2026-08-04T08:00:02.000Z",
		orderKey: eventTraceOrder(1, "execution.command"),
	});
	const second = node("event-2", {
		startedAt: "2026-08-04T08:00:01.000Z",
		orderKey: eventTraceOrder(2, "execution.command"),
	});

	assert.deepEqual([second, first].toSorted(compareTraceNodes).map((entry) => entry.id), ["event-1", "event-2"]);
});

test("trace node order does not use mutable timestamps across projection sources", () => {
	const laterTranscript = node("transcript", {
		startedAt: "2026-08-04T08:00:02.000Z",
		orderKey: transcriptTraceOrder(0, 0, "execution.command"),
	});
	const earlierEvent = node("event", {
		startedAt: "2026-08-04T08:00:01.000Z",
		orderKey: eventTraceOrder(100, "execution.command"),
	});

	assert.deepEqual([laterTranscript, earlierEvent].toSorted(compareTraceNodes).map((entry) => entry.id), ["transcript", "event"]);
});

test("same-turn phase remains stable across projection sources", () => {
	const assistant = node("assistant", {
		type: "assistant.message",
		eventId: "turn-1",
		startedAt: "2026-08-04T08:00:00.000Z",
		orderKey: { ...eventTraceOrder(1, "assistant.message"), renderSequence: 5 },
	});
	const reasoning = node("reasoning", {
		type: "model.reasoning",
		eventId: "turn-1",
		startedAt: "2026-08-04T08:00:01.000Z",
		orderKey: { ...transcriptTraceOrder(10, 0, "model.reasoning"), renderSequence: 5 },
	});

	assert.deepEqual([assistant, reasoning].toSorted(compareTraceNodes).map((entry) => entry.id), ["reasoning", "assistant"]);
});

test("same-source event chronology wins across repeated turn phases", () => {
	const laterReasoning = node("reasoning-2", {
		type: "model.reasoning",
		eventId: "turn-1",
		orderKey: eventTraceOrder(5, "model.reasoning"),
	});
	const earlierTool = node("tool-1", {
		type: "tool.call",
		eventId: "turn-1",
		orderKey: eventTraceOrder(4, "tool.call"),
	});

	assert.deepEqual([laterReasoning, earlierTool].toSorted(compareTraceNodes).map((entry) => entry.id), ["tool-1", "reasoning-2"]);
});
