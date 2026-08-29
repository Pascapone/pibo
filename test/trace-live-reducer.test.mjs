import assert from "node:assert/strict";
import test from "node:test";
import { applyTraceLiveEvents } from "../dist/shared/trace-live-reducer.js";
import { buildTraceViewFromEvents, patchTraceViewWithEvents } from "../dist/shared/trace-engine.js";
import { qualifiedToolNodeId } from "../dist/shared/trace-tool-identity.js";

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

test("live and persisted events keep relative render order across trace refresh", () => {
	let sequence = 120;
	const liveEvents = applyTraceLiveEvents({
		currentEvents: [],
		streamEvents: [
			{ type: "RAW_EVENT", streamId: 500, streamFrameIndex: 0, createdAt: "2026-08-14T15:38:00.000Z", event: { type: "assistant_message", piboSessionId: "ps-live", eventId: "prelude-1", assistantIndex: 0, text: "prelude 1", renderSequence: 120 } },
			{ type: "RAW_EVENT", streamId: 501, streamFrameIndex: 0, createdAt: "2026-08-14T15:38:01.000Z", event: { type: "assistant_message", piboSessionId: "ps-live", eventId: "prelude-2", assistantIndex: 0, text: "prelude 2", renderSequence: 121 } },
			{ type: "RAW_EVENT", streamId: 502, streamFrameIndex: 0, createdAt: "2026-08-14T15:38:07.565Z", event: { type: "execution_result", piboSessionId: "ps-live", eventId: "status-late", action: "status", result: { processing: true }, renderSequence: 122 } },
			{ type: "RAW_EVENT", streamId: 503, streamFrameIndex: 0, createdAt: "2026-08-14T15:38:08.000Z", event: { type: "assistant_delta", piboSessionId: "ps-live", eventId: "active-turn", assistantIndex: 0, text: "active", renderSequence: 123 } },
		],
		piboSessionId: "ps-live",
		nextSequence: () => sequence++,
		now: () => "2026-08-14T15:39:00.000Z",
	});
	const liveView = buildTraceViewFromEvents({
		session: { id: "ps-live", piSessionId: "pi-live" },
		events: liveEvents,
		status: "running",
		includeRawEvents: true,
	});
	assert.deepEqual(liveView.nodes.map((node) => node.id), [
		"event:assistant:prelude-1:assistant:0",
		"event:assistant:prelude-2:assistant:0",
		"event:execution_result:status-late",
		"event:assistant:active-turn:assistant:0",
	]);
	assert.deepEqual(liveView.nodes.map((node) => node.orderKey?.sourceRank), [2, 2, 2, 2]);

	const persistedStatus = {
		id: "persisted-status",
		piboSessionId: "ps-live",
		eventSequence: 6,
		type: "execution_result",
		eventId: "status-late",
		renderSequence: 122,
		createdAt: "2026-08-14T15:38:07.565Z",
		payload: { type: "execution_result", piboSessionId: "ps-live", eventId: "status-late", action: "status", result: { processing: true }, renderSequence: 122 },
	};
	const refreshedBase = buildTraceViewFromEvents({
		session: { id: "ps-live", piSessionId: "pi-live" },
		events: [persistedStatus],
		status: "running",
		includeRawEvents: true,
	});
	const remainingLiveEvents = liveEvents.filter((event) => event.eventId !== "status-late");
	const refreshedView = patchTraceViewWithEvents(refreshedBase, remainingLiveEvents, "running");
	assert.deepEqual(refreshedView.nodes.map((node) => node.id), liveView.nodes.map((node) => node.id));
});

test("same-timestamp transient text tool and reasoning segments retain assigned render positions", () => {
	let sequence = 1;
	const events = applyTraceLiveEvents({
		currentEvents: [],
		streamEvents: [
			{ type: "RAW_EVENT", createdAt: "2026-08-29T10:00:00.000Z", event: { type: "assistant_delta", piboSessionId: "ps-live", eventId: "turn-ordered", assistantIndex: 0, text: "before", renderSequence: 1 } },
			{ type: "RAW_EVENT", createdAt: "2026-08-29T10:00:00.000Z", event: { type: "tool_execution_started", piboSessionId: "ps-live", eventId: "turn-ordered", toolCallId: "tool-1", toolName: "read", args: {}, renderSequence: 2 } },
			{ type: "RAW_EVENT", createdAt: "2026-08-29T10:00:00.000Z", event: { type: "thinking_delta", piboSessionId: "ps-live", eventId: "turn-ordered", thinkingIndex: 1, text: "after", renderSequence: 3 } },
		],
		piboSessionId: "ps-live",
		nextSequence: () => sequence++,
		now: () => "2026-08-29T10:00:00.000Z",
	});
	const view = buildTraceViewFromEvents({
		session: { id: "ps-live", piSessionId: "pi-live" },
		events,
		status: "running",
		includeRawEvents: true,
	});
	const children = view.nodes.find((node) => node.id === "turn:turn-ordered")?.children ?? view.nodes;

	assert.deepEqual(children.filter((node) => ["assistant.message", "tool.call", "model.reasoning"].includes(node.type)).map((node) => node.type), [
		"assistant.message",
		"tool.call",
		"model.reasoning",
	]);
	assert.deepEqual(events.map((event) => event.renderSequence), [1, 2, 3]);
});

test("late replay keeps the server event timestamp and stable terminal order", () => {
	let sequence = 1;
	const originalCreatedAt = "2026-08-10T18:16:01.000Z";
	const receivedAt = "2026-08-10T18:21:00.000Z";
	const overlayEvents = applyTraceLiveEvents({
		currentEvents: [],
		streamEvents: [{
			type: "TOOL_CALL_RESULT",
			streamId: 100,
			streamFrameIndex: 0,
			createdAt: originalCreatedAt,
			toolCallId: "late-replayed-tool",
			toolName: "read",
			result: "ok",
			isError: false,
			runId: "turn-replayed",
		}],
		piboSessionId: "ps-live",
		nextSequence: () => sequence++,
		now: () => receivedAt,
	});

	assert.equal(overlayEvents[0]?.createdAt, originalCreatedAt);

	const baseTrace = {
		piboSessionId: "ps-live",
		piSessionId: "pi-live",
		title: "Live replay ordering",
		version: "base",
		latestStreamId: 99,
		nodes: [{
			id: "entry:final:response",
			piboSessionId: "ps-live",
			type: "assistant.message",
			title: "Agent Message",
			status: "done",
			startedAt: "2026-08-10T18:20:33.000Z",
			completedAt: "2026-08-10T18:20:33.000Z",
			output: "Final response",
			source: "transcript",
			stableKey: "entry:final:response:0",
			children: [],
		}],
		rawEvents: [],
	};
	const liveTrace = patchTraceViewWithEvents(baseTrace, overlayEvents, "idle");

	assert.deepEqual(liveTrace.nodes.map((node) => node.id), [
		qualifiedToolNodeId("late-replayed-tool", "turn-replayed", 0),
		"entry:final:response",
	]);
});

test("execution_result event updates existing node output for model menu", () => {
	let sequence = 1;
	// First, create a node without output (simulating a transcript echo)
	const baseEvents = applyTraceLiveEvents({
		currentEvents: [],
		streamEvents: [
			{ type: "RAW_EVENT", streamId: 1, streamFrameIndex: 0, createdAt: "2026-08-16T15:00:00.000Z", event: { type: "message_started", piboSessionId: "ps-live", eventId: "turn-model", text: "/model" } },
			{ type: "RAW_EVENT", streamId: 2, streamFrameIndex: 0, createdAt: "2026-08-16T15:00:01.000Z", event: { type: "execution_result", piboSessionId: "ps-live", eventId: "model-result", action: "model", result: undefined } },
		],
		piboSessionId: "ps-live",
		nextSequence: () => sequence++,
		now: () => "2026-08-16T15:00:02.000Z",
	});

	const baseView = buildTraceViewFromEvents({
		session: { id: "ps-live", piSessionId: "pi-live" },
		events: baseEvents,
		status: "running",
		includeRawEvents: true,
	});

	const modelNode = baseView.nodes.flatMap((node) => [node, ...node.children]).find((node) => node.id === "event:execution_result:model-result");
	assert.ok(modelNode, "model node should exist");
	assert.equal(modelNode.output, undefined, "initial output should be undefined");

	// Now, simulate the actual execution_result event with show_model_menu
	const updatedEvents = applyTraceLiveEvents({
		currentEvents: baseEvents,
		streamEvents: [
			{ type: "RAW_EVENT", streamId: 3, streamFrameIndex: 0, createdAt: "2026-08-16T15:00:01.500Z", event: { type: "execution_result", piboSessionId: "ps-live", eventId: "model-result", action: "model", result: { action: "show_model_menu", providers: [{ id: "openai", label: "OpenAI", models: [{ id: "gpt-4", label: "GPT-4" }] }] } } },
		],
		piboSessionId: "ps-live",
		nextSequence: () => sequence++,
		now: () => "2026-08-16T15:00:02.000Z",
	});

	const updatedView = buildTraceViewFromEvents({
		session: { id: "ps-live", piSessionId: "pi-live" },
		events: updatedEvents,
		status: "running",
		includeRawEvents: true,
	});

	const updatedModelNode = updatedView.nodes.flatMap((node) => [node, ...node.children]).find((node) => node.id === "event:execution_result:model-result");
	assert.ok(updatedModelNode, "updated model node should exist");
	assert.ok(updatedModelNode.output, "output should be defined after update");
	assert.equal(updatedModelNode.output.action, "show_model_menu", "output should have show_model_menu action");
	assert.ok(Array.isArray(updatedModelNode.output.providers), "output should have providers array");
});
