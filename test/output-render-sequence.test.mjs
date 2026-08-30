import assert from "node:assert/strict";
import test from "node:test";
import { OutputRenderSequencer } from "../dist/core/output-render-sequence.js";
import { OutputCompactor } from "../dist/apps/chat/output-compactor.js";
import { chatStreamFramesFromOutputEvent, createChatStreamState } from "../dist/apps/chat/stream.js";

test("output render sequencer reuses segment positions across interleaved lifecycle events", () => {
	const sequencer = new OutputRenderSequencer(() => 1_000);
	const base = { piboSessionId: "ps-sequence", eventId: "turn-1" };
	const assistantDelta = sequencer.position({ ...base, type: "assistant_delta", assistantIndex: 0, text: "a" });
	const toolStarted = sequencer.position({ ...base, type: "tool_execution_started", toolCallId: "tool-1", toolName: "read", args: {} });
	const assistantDeltaAgain = sequencer.position({ ...base, type: "assistant_delta", assistantIndex: 0, text: "b" });
	const toolFinished = sequencer.position({ ...base, type: "tool_execution_finished", toolCallId: "tool-1", toolName: "read", result: "ok", isError: false });
	const reasoning = sequencer.position({ ...base, type: "thinking_delta", thinkingIndex: 0, text: "why" });
	const assistantFinal = sequencer.position({ ...base, type: "assistant_message", assistantIndex: 0, text: "ab" });

	assert.equal(assistantDelta.renderSequence, assistantDeltaAgain.renderSequence);
	assert.equal(assistantDelta.renderSequence, assistantFinal.renderSequence);
	assert.equal(toolStarted.renderSequence, toolFinished.renderSequence);
	assert.ok(assistantDelta.renderSequence < toolStarted.renderSequence);
	assert.ok(toolStarted.renderSequence < reasoning.renderSequence);
});

test("output render sequencer is monotonic when the wall clock does not advance", () => {
	const sequencer = new OutputRenderSequencer(() => 2_000);
	const first = sequencer.position({ type: "execution_result", piboSessionId: "ps-sequence", eventId: "one", action: "status", result: {} });
	const second = sequencer.position({ type: "execution_result", piboSessionId: "ps-sequence", eventId: "two", action: "status", result: {} });
	assert.equal(second.renderSequence, first.renderSequence + 1);
});

test("output render sequencer preserves a segment position for late recovery after turn completion", () => {
	const sequencer = new OutputRenderSequencer(() => 50);
	const first = sequencer.position({ type: "assistant_delta", piboSessionId: "ps_late", eventId: "turn_late", assistantIndex: 0, text: "first" });
	sequencer.position({ type: "message_finished", piboSessionId: "ps_late", eventId: "turn_late", source: "user" });
	const recovered = sequencer.position({ type: "assistant_message", piboSessionId: "ps_late", eventId: "turn_late", assistantIndex: 0, text: "first recovered" });

	assert.equal(recovered.renderSequence, first.renderSequence);
});

test("stream frames and boundary compaction preserve the original render sequence", () => {
	const delta = {
		type: "assistant_delta",
		piboSessionId: "ps-sequence",
		eventId: "turn-boundary",
		assistantIndex: 0,
		text: "partial",
		renderSequence: 77,
	};
	const frames = chatStreamFramesFromOutputEvent(delta, createChatStreamState());
	assert.ok(frames.length > 0);
	assert.ok(frames.every((frame) => frame.renderSequence === 77));

	const compactor = new OutputCompactor();
	compactor.compact(delta);
	const boundary = compactor.compact({
		type: "message_finished",
		piboSessionId: "ps-sequence",
		eventId: "turn-boundary",
		renderSequence: 88,
	});
	assert.equal(boundary.persistedEvents.find((event) => event.type === "assistant_message")?.renderSequence, 77);
});
