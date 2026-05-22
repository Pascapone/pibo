import assert from "node:assert/strict";
import test from "node:test";
import { buildTraceViewFromEvents, patchTraceViewWithEvent } from "../dist/shared/trace-engine.js";

function createEvent(overrides) {
	return {
		id: `event-${overrides.seq ?? Math.random().toString(36).slice(2)}`,
		piboSessionId: "chat:test",
		createdAt: `2026-04-29T08:00:${String(overrides.seq ?? 0).padStart(2, "0")}.000Z`,
		eventSequence: overrides.seq ?? 0,
		streamId: overrides.streamId ?? 1,
		streamFrameIndex: overrides.streamFrameIndex ?? 0,
		...overrides,
		payload: {
			piboSessionId: "chat:test",
			...overrides.payload,
		},
	};
}

function createBaseView(events = [], status = "running") {
	return buildTraceViewFromEvents({
		session: { id: "chat:test", piSessionId: "pi-test" },
		events,
		status,
		includeRawEvents: true,
	});
}

function applyLiveEvents(baseView, events, sessionStatus = "running") {
	return events.reduce((view, event) => patchTraceViewWithEvent(view, event, sessionStatus), baseView);
}

function flatNodes(view) {
	return view.nodes.flatMap((node) => [node, ...node.children.flatMap((child) => [child, ...child.children])]);
}

function nodeLabels(nodes) {
	return nodes.flatMap((node) => [node.title, ...nodeLabels(node.children ?? [])]);
}

test("live event patching preserves transcript history", () => {
	const baseView = buildTraceViewFromEvents({
		session: { id: "chat:test", piSessionId: "pi-test" },
		status: "running",
		transcriptEntries: [
			{
				id: "entry-user-1",
				type: "message",
				timestamp: "2026-04-29T08:00:00.000Z",
				message: { role: "user", content: [{ type: "text", text: "first" }] },
			},
			{
				id: "entry-assistant-1",
				type: "message",
				timestamp: "2026-04-29T08:00:02.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "answer" }], stopReason: "stop" },
			},
		],
		events: [],
		includeRawEvents: true,
	});

	const patched = applyLiveEvents(baseView, [
		createEvent({ seq: 1, type: "message_started", payload: { type: "message_started", eventId: "turn-2", text: "second", source: "user" } }),
		createEvent({ seq: 2, type: "assistant_delta", streamFrameIndex: 1, payload: { type: "assistant_delta", eventId: "turn-2", text: "live" } }),
	]);

	const nodes = flatNodes(patched);
	assert.ok(nodes.some((node) => node.type === "user.message" && node.output === "first"));
	assert.ok(nodes.some((node) => node.type === "assistant.message" && node.output === "answer"));
	assert.ok(nodes.some((node) => node.type === "assistant.message" && node.output === "live"));
});

test("execution commands are sorted by wall-clock time among persisted transcript nodes", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "chat:test", piSessionId: "pi-test" },
		status: "idle",
		transcriptEntries: [
			{
				id: "entry-user-1",
				type: "message",
				timestamp: "2026-04-29T08:00:00.000Z",
				message: { role: "user", content: [{ type: "text", text: "first" }] },
			},
			{
				id: "entry-assistant-1",
				type: "message",
				timestamp: "2026-04-29T08:00:02.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "answer" }], stopReason: "stop" },
			},
			{
				id: "entry-user-2",
				type: "message",
				timestamp: "2026-04-29T08:00:04.000Z",
				message: { role: "user", content: [{ type: "text", text: "second" }] },
			},
		],
		events: [
			createEvent({
				seq: 99,
				type: "execution_result",
				createdAt: "2026-04-29T08:00:03.000Z",
				payload: { type: "execution_result", eventId: "cmd-status", action: "status", result: { ok: true } },
			}),
		],
	});

	assert.deepEqual(nodeLabels(view.nodes), ["User Message", "Agent Message", "status", "User Message"]);
});

test("execution commands issued during streaming attach to the active turn", () => {
	const view = createBaseView([
		createEvent({ seq: 1, type: "message_started", createdAt: "2026-04-29T08:00:00.000Z", payload: { type: "message_started", eventId: "turn-1", text: "Hello", source: "user" } }),
		createEvent({ seq: 2, type: "thinking_delta", createdAt: "2026-04-29T08:00:02.000Z", payload: { type: "thinking_delta", eventId: "turn-1", text: "Thinking" } }),
		createEvent({ seq: 3, type: "execution_result", createdAt: "2026-04-29T08:00:03.000Z", payload: { type: "execution_result", eventId: "cmd-status", action: "status", result: { ok: true } } }),
		createEvent({ seq: 4, type: "assistant_delta", createdAt: "2026-04-29T08:00:04.000Z", payload: { type: "assistant_delta", eventId: "turn-1", text: "Done" } }),
	], "running");

	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.ok(turn, "expected active turn");
	assert.deepEqual(turn.children.map((node) => node.title), ["Thinking", "status", "Agent Message"]);
});

test("execution commands after an errored turn remain chronological root nodes", () => {
	const view = createBaseView([
		createEvent({ seq: 1, type: "message_started", createdAt: "2026-04-29T08:00:00.000Z", payload: { type: "message_started", eventId: "turn-1", text: "Hello", source: "user" } }),
		createEvent({ seq: 2, type: "session_error", createdAt: "2026-04-29T08:00:01.000Z", payload: { type: "session_error", eventId: "turn-1", error: "boom" } }),
		createEvent({ seq: 3, type: "execution_result", createdAt: "2026-04-29T08:00:02.000Z", payload: { type: "execution_result", eventId: "cmd-thinking", action: "thinking", result: { level: "high" } } }),
	], "idle");

	assert.deepEqual(view.nodes.map((node) => node.title), ["Agent Turn", "Session Error", "thinking"]);
	assert.equal(view.nodes.find((node) => node.title === "thinking")?.parentId, undefined);
});

test("persisted user message with optimistic event id keeps one trace node", () => {
	const clientTxnId = "web-client-txn-1";
	const baseView = createBaseView([
		{
			id: `optimistic:user-message:${clientTxnId}`,
			piboSessionId: "chat:test",
			createdAt: "2026-04-29T08:00:00.000Z",
			eventSequence: 1,
			type: "message_queued",
			payload: {
				type: "message_queued",
				piboSessionId: "chat:test",
				eventId: clientTxnId,
				clientTxnId,
				queuedMessages: 1,
				text: "hello optimistic",
				source: "user",
			},
		},
	], "running");
	const before = flatNodes(baseView).filter((node) => node.type === "user.message");
	assert.equal(before.length, 1);
	assert.equal(before[0].id, `event:message_queued:${clientTxnId}`);

	const patched = patchTraceViewWithEvent(baseView, createEvent({
		seq: 2,
		streamId: 20,
		type: "message_queued",
		payload: { type: "message_queued", eventId: clientTxnId, text: "hello optimistic", source: "user", queuedMessages: 1 },
	}), "running");
	const after = flatNodes(patched).filter((node) => node.type === "user.message");
	assert.equal(after.length, 1);
	assert.equal(after[0].id, `event:message_queued:${clientTxnId}`);
});

test("optimistic user echo is ignored once the transcript entry exists", () => {
	const clientTxnId = "web-client-txn-transcript-1";
	const baseView = buildTraceViewFromEvents({
		session: { id: "chat:test", piSessionId: "pi-test" },
		status: "running",
		transcriptEntries: [
			{
				id: "pi-transcript-entry-1",
				type: "message",
				timestamp: "2026-04-29T08:00:00.000Z",
				message: { role: "user", content: [{ type: "text", text: "hello persisted optimistic" }] },
			},
		],
		events: [],
		includeRawEvents: true,
	});

	const patched = patchTraceViewWithEvent(baseView, createEvent({
		seq: 2,
		streamId: 20,
		type: "message_queued",
		payload: { type: "message_queued", eventId: clientTxnId, text: "hello persisted optimistic", source: "user", queuedMessages: 1 },
	}), "running");

	const users = flatNodes(patched).filter((node) => node.type === "user.message");
	assert.equal(users.length, 1);
	assert.equal(users[0].id, "entry:pi-transcript-entry-1");
	assert.equal(users[0].source, "transcript");
});

test("live stream simulation: thinking -> assistant -> tool -> finish", () => {
	const baseView = createBaseView([]);

	const streamEvents = [
		createEvent({ seq: 1, type: "message_started", payload: { type: "message_started", eventId: "turn-1", text: "Hello", source: "user" } }),
		createEvent({ seq: 2, type: "thinking_delta", streamFrameIndex: 1, payload: { type: "thinking_delta", eventId: "turn-1", text: "Let" } }),
		createEvent({ seq: 3, type: "thinking_delta", streamFrameIndex: 2, payload: { type: "thinking_delta", eventId: "turn-1", text: " me" } }),
		createEvent({ seq: 4, type: "thinking_delta", streamFrameIndex: 3, payload: { type: "thinking_delta", eventId: "turn-1", text: " think" } }),
		createEvent({ seq: 5, type: "thinking_finished", streamFrameIndex: 4, payload: { type: "thinking_finished", eventId: "turn-1", text: "Let me think about this..." } }),
		createEvent({ seq: 6, type: "assistant_delta", streamFrameIndex: 5, payload: { type: "assistant_delta", eventId: "turn-1", text: "Hello" } }),
		createEvent({ seq: 7, type: "assistant_delta", streamFrameIndex: 6, payload: { type: "assistant_delta", eventId: "turn-1", text: " there" } }),
		createEvent({ seq: 8, type: "assistant_delta", streamFrameIndex: 7, payload: { type: "assistant_delta", eventId: "turn-1", text: "," } }),
		createEvent({ seq: 9, type: "assistant_delta", streamFrameIndex: 8, payload: { type: "assistant_delta", eventId: "turn-1", text: " how" } }),
		createEvent({ seq: 10, type: "assistant_delta", streamFrameIndex: 9, payload: { type: "assistant_delta", eventId: "turn-1", text: " can" } }),
		createEvent({ seq: 11, type: "assistant_delta", streamFrameIndex: 10, payload: { type: "assistant_delta", eventId: "turn-1", text: " I" } }),
		createEvent({ seq: 12, type: "assistant_delta", streamFrameIndex: 11, payload: { type: "assistant_delta", eventId: "turn-1", text: " help" } }),
		createEvent({ seq: 13, type: "assistant_delta", streamFrameIndex: 12, payload: { type: "assistant_delta", eventId: "turn-1", text: " you" } }),
		createEvent({ seq: 14, type: "assistant_delta", streamFrameIndex: 13, payload: { type: "assistant_delta", eventId: "turn-1", text: " today" } }),
		createEvent({ seq: 15, type: "assistant_delta", streamFrameIndex: 14, payload: { type: "assistant_delta", eventId: "turn-1", text: "?" } }),
		createEvent({ seq: 16, type: "tool_call", streamFrameIndex: 15, payload: { type: "tool_call", toolCallId: "tc-1", toolName: "read", args: { path: "README.md" } } }),
		createEvent({ seq: 17, type: "tool_execution_finished", streamFrameIndex: 16, payload: { type: "tool_execution_finished", toolCallId: "tc-1", toolName: "read", result: "# Hello\n" } }),
		createEvent({ seq: 18, type: "message_finished", streamFrameIndex: 17, payload: { type: "message_finished", eventId: "turn-1", text: "Hello there, how can I help you today?" } }),
	];

	// Simulate incremental application with session still running after message_finished
	const midView = applyLiveEvents(baseView, streamEvents.slice(0, 15), "running");
	const finalView = applyLiveEvents(midView, streamEvents.slice(15), "running");

	const flat = flatNodes(finalView);

	const turn = flat.find((n) => n.type === "agent.turn");
	assert.ok(turn, "expected agent.turn node");
	assert.equal(turn.status, "done", "turn should be done after message_finished");

	const reasoning = flat.find((n) => n.type === "model.reasoning");
	assert.ok(reasoning, "expected model.reasoning node");
	assert.equal(reasoning.output, "Let me think about this...");
	assert.equal(reasoning.status, "done");

	const assistant = flat.find((n) => n.type === "assistant.message");
	assert.ok(assistant, "expected assistant.message node");
	assert.equal(assistant.output, "Hello there, how can I help you today?");
	// assistant_delta nodes keep "running" while sessionStatus is "running";
	// they transition to "done" only when sessionStatus becomes "idle" or an assistant_message arrives
	assert.equal(assistant.status, "running");

	const tool = flat.find((n) => n.type === "tool.call");
	assert.ok(tool, "expected tool.call node");
	assert.equal(tool.status, "done");
	assert.deepEqual(tool.output, "# Hello\n");

	assert.equal(finalView.rawEvents.length, streamEvents.length);
	assert.equal(finalView.latestStreamId, 1);

	// Note: in App.tsx the sessionStatus comes from bootstrap; when bootstrap
	// refreshes to "idle" the liveEvents.reduce recomputes with "idle" and the
	// assistant_delta node transitions to "done". That transition is covered by
	// the existing unit tests for mergeAssistantDeltaEvent.
});

test("query refresh mid-stream empties live events when backend caught up", () => {
	const streamEvents = [
		createEvent({ seq: 1, type: "message_started", payload: { type: "message_started", eventId: "turn-1", text: "Hello", source: "user" } }),
		createEvent({ seq: 2, type: "thinking_delta", streamFrameIndex: 1, payload: { type: "thinking_delta", eventId: "turn-1", text: "Let" } }),
		createEvent({ seq: 3, type: "thinking_delta", streamFrameIndex: 2, payload: { type: "thinking_delta", eventId: "turn-1", text: " me" } }),
		createEvent({ seq: 4, type: "thinking_delta", streamFrameIndex: 3, payload: { type: "thinking_delta", eventId: "turn-1", text: " think" } }),
		createEvent({ seq: 5, type: "thinking_finished", streamFrameIndex: 4, payload: { type: "thinking_finished", eventId: "turn-1", text: "Let me think about this..." } }),
		createEvent({ seq: 6, type: "assistant_delta", streamFrameIndex: 5, payload: { type: "assistant_delta", eventId: "turn-1", text: "Hello" } }),
		createEvent({ seq: 7, type: "assistant_delta", streamFrameIndex: 6, payload: { type: "assistant_delta", eventId: "turn-1", text: " there" } }),
		createEvent({ seq: 8, type: "assistant_delta", streamFrameIndex: 7, payload: { type: "assistant_delta", eventId: "turn-1", text: "," } }),
		createEvent({ seq: 9, type: "assistant_delta", streamFrameIndex: 8, payload: { type: "assistant_delta", eventId: "turn-1", text: " how" } }),
		createEvent({ seq: 10, type: "assistant_delta", streamFrameIndex: 9, payload: { type: "assistant_delta", eventId: "turn-1", text: " can" } }),
		createEvent({ seq: 11, type: "assistant_delta", streamFrameIndex: 10, payload: { type: "assistant_delta", eventId: "turn-1", text: " I" } }),
		createEvent({ seq: 12, type: "assistant_delta", streamFrameIndex: 11, payload: { type: "assistant_delta", eventId: "turn-1", text: " help" } }),
		createEvent({ seq: 13, type: "assistant_delta", streamFrameIndex: 12, payload: { type: "assistant_delta", eventId: "turn-1", text: " you" } }),
		createEvent({ seq: 14, type: "assistant_delta", streamFrameIndex: 13, payload: { type: "assistant_delta", eventId: "turn-1", text: " today" } }),
		createEvent({ seq: 15, type: "assistant_delta", streamFrameIndex: 14, payload: { type: "assistant_delta", eventId: "turn-1", text: "?" } }),
		createEvent({ seq: 16, type: "tool_call", streamFrameIndex: 15, payload: { type: "tool_call", toolCallId: "tc-1", toolName: "read", args: { path: "README.md" } } }),
		createEvent({ seq: 17, type: "tool_execution_finished", streamFrameIndex: 16, payload: { type: "tool_execution_finished", toolCallId: "tc-1", toolName: "read", result: "# Hello\n" } }),
		createEvent({ seq: 18, type: "message_finished", streamFrameIndex: 17, payload: { type: "message_finished", eventId: "turn-1", text: "Hello there, how can I help you today?" } }),
	];

	const midPoint = 9;
	const firstHalf = streamEvents.slice(0, midPoint);
	const secondHalf = streamEvents.slice(midPoint);

	// Simulate live application of first half
	const baseView = createBaseView([]);
	const midView = applyLiveEvents(baseView, firstHalf, "running");

	// Simulate query refresh: backend now has ALL events persisted
	const refreshedBase = createBaseView(streamEvents, "running");

	// Live events that are already in persisted base should be dropped
	const persistedIds = new Set(refreshedBase.rawEvents.map((e) => e.id));
	const remainingLive = secondHalf.filter((e) => !persistedIds.has(e.id));

	assert.equal(remainingLive.length, 0, "all second-half events should be persisted now");

	// Apply remaining live events (none) on top of refreshed base
	const finalView = applyLiveEvents(refreshedBase, remainingLive, "running");

	// Final view should match the fully persisted view
	assert.equal(finalView.nodes.length, refreshedBase.nodes.length);
	assert.equal(finalView.rawEvents.length, streamEvents.length);

	const flat = flatNodes(finalView);
	const assistant = flat.find((n) => n.type === "assistant.message");
	assert.ok(assistant);
	assert.equal(assistant.output, "Hello there, how can I help you today?");

	const tool = flat.find((n) => n.type === "tool.call");
	assert.ok(tool);
	assert.equal(tool.status, "done");
});

test("query refresh with partial overlap keeps unpersisted live events", () => {
	const streamEvents = [
		createEvent({ seq: 1, type: "message_started", payload: { type: "message_started", eventId: "turn-1", text: "Hello", source: "user" } }),
		createEvent({ seq: 2, type: "thinking_delta", streamFrameIndex: 1, payload: { type: "thinking_delta", eventId: "turn-1", text: "Let" } }),
		createEvent({ seq: 3, type: "thinking_delta", streamFrameIndex: 2, payload: { type: "thinking_delta", eventId: "turn-1", text: " me" } }),
		createEvent({ seq: 4, type: "thinking_finished", streamFrameIndex: 3, payload: { type: "thinking_finished", eventId: "turn-1", text: "Let me think..." } }),
		createEvent({ seq: 5, type: "assistant_delta", streamFrameIndex: 4, payload: { type: "assistant_delta", eventId: "turn-1", text: "Hello" } }),
		createEvent({ seq: 6, type: "assistant_delta", streamFrameIndex: 5, payload: { type: "assistant_delta", eventId: "turn-1", text: " world" } }),
		createEvent({ seq: 7, type: "message_finished", streamFrameIndex: 6, payload: { type: "message_finished", eventId: "turn-1", text: "Hello world" } }),
	];

	// Apply all as live
	const liveView = applyLiveEvents(createBaseView([]), streamEvents, "running");

	// Now simulate that only first 3 events were persisted on server
	const persistedEvents = streamEvents.slice(0, 3);
	const newBase = createBaseView(persistedEvents, "running");

	// The remaining live events should still be applied on top
	const remainingLive = streamEvents.slice(3);
	const finalView = applyLiveEvents(newBase, remainingLive, "running");

	const flat = flatNodes(finalView);
	const assistant = flat.find((n) => n.type === "assistant.message");
	assert.ok(assistant);
	assert.equal(assistant.output, "Hello world");
});

test("trace projection handles Unicode events without browser Buffer", () => {
	const view = createBaseView([
		createEvent({
			seq: 1,
			type: "tool_execution_updated",
			payload: {
				type: "tool_execution_updated",
				toolCallId: "tc-1",
				toolName: "bash",
				partialResult: { content: [{ type: "text", text: "This site can’t be reached – ä" }] },
			},
		}),
	]);

	assert.ok(flatNodes(view).some((node) => node.type === "tool.call"));
});

test("trace projection ignores replayed stream frames", () => {
	const events = [
		createEvent({ seq: 1, streamId: 10, streamFrameIndex: 0, type: "message_started", payload: { type: "message_started", eventId: "turn-1", text: "Hello", source: "user" } }),
		createEvent({ seq: 2, streamId: 11, streamFrameIndex: 1, type: "assistant_delta", payload: { type: "assistant_delta", eventId: "turn-1", text: "Hello" } }),
		createEvent({ seq: 3, streamId: 11, streamFrameIndex: 1, type: "assistant_delta", payload: { type: "assistant_delta", eventId: "turn-1", text: "Hello" }, id: "replayed-stream-frame" }),
		createEvent({ seq: 4, streamId: 12, streamFrameIndex: 0, type: "assistant_delta", payload: { type: "assistant_delta", eventId: "turn-1", text: " world" } }),
	];

	const view = createBaseView(events, "running");
	const assistant = flatNodes(view).find((n) => n.type === "assistant.message");

	assert.ok(assistant);
	assert.equal(assistant.output, "Hello world");
	assert.equal(view.latestStreamId, 12);
	assert.equal(view.rawEvents.length, 3);
});

test("patchTraceViewWithEvent performance stays under 16ms per event", () => {
	const baseView = createBaseView([]);

	// Build a larger stream: 50+ delta events
	const events = [
		createEvent({ seq: 1, type: "message_started", payload: { type: "message_started", eventId: "turn-1", text: "Hello", source: "user" } }),
	];

	for (let i = 0; i < 25; i++) {
		events.push(
			createEvent({
				seq: 2 + i,
				type: "thinking_delta",
				streamFrameIndex: i,
				payload: { type: "thinking_delta", eventId: "turn-1", text: ` thought-${i}` },
			}),
		);
	}

	events.push(
		createEvent({ seq: 27, type: "thinking_finished", streamFrameIndex: 25, payload: { type: "thinking_finished", eventId: "turn-1", text: "All done thinking." } }),
	);

	for (let i = 0; i < 25; i++) {
		events.push(
			createEvent({
				seq: 28 + i,
				type: "assistant_delta",
				streamFrameIndex: 26 + i,
				payload: { type: "assistant_delta", eventId: "turn-1", text: ` delta-${i}` },
			}),
		);
	}

	events.push(
		createEvent({ seq: 53, type: "tool_call", streamFrameIndex: 51, payload: { type: "tool_call", toolCallId: "tc-1", toolName: "read", args: {} } }),
		createEvent({ seq: 54, type: "tool_execution_finished", streamFrameIndex: 52, payload: { type: "tool_execution_finished", toolCallId: "tc-1", toolName: "read", result: "ok" } }),
		createEvent({ seq: 55, type: "message_finished", streamFrameIndex: 53, payload: { type: "message_finished", eventId: "turn-1", text: "Final." } }),
	);

	let currentView = baseView;
	const times = [];

	for (const event of events) {
		const start = performance.now();
		currentView = patchTraceViewWithEvent(currentView, event, "running");
		const end = performance.now();
		times.push(end - start);
	}

	const avg = times.reduce((a, b) => a + b, 0) / times.length;
	const max = Math.max(...times);

	// Assert average and max both stay well under 16ms
	assert.ok(avg < 16, `average patch time ${avg}ms should be < 16ms`);
	assert.ok(max < 16, `max patch time ${max}ms should be < 16ms`);

	// Also verify the final view is correct
	const flat = flatNodes(currentView);
	const assistant = flat.find((n) => n.type === "assistant.message");
	assert.ok(assistant);
	assert.equal(assistant.output, events.filter((e) => e.type === "assistant_delta").map((e) => e.payload.text).join(""));
});

test("incremental patch produces same result as full build for 50+ event stream", () => {
	const events = [
		createEvent({ seq: 1, type: "message_started", payload: { type: "message_started", eventId: "turn-1", text: "Hello", source: "user" } }),
	];

	for (let i = 0; i < 25; i++) {
		events.push(
			createEvent({
				seq: 2 + i,
				type: "thinking_delta",
				streamFrameIndex: i,
				payload: { type: "thinking_delta", eventId: "turn-1", text: ` thought-${i}` },
			}),
		);
	}

	events.push(
		createEvent({ seq: 27, type: "thinking_finished", streamFrameIndex: 25, payload: { type: "thinking_finished", eventId: "turn-1", text: "All done thinking." } }),
	);

	for (let i = 0; i < 25; i++) {
		events.push(
			createEvent({
				seq: 28 + i,
				type: "assistant_delta",
				streamFrameIndex: 26 + i,
				payload: { type: "assistant_delta", eventId: "turn-1", text: ` delta-${i}` },
			}),
		);
	}

	events.push(
		createEvent({ seq: 53, type: "tool_call", streamFrameIndex: 51, payload: { type: "tool_call", toolCallId: "tc-1", toolName: "read", args: {} } }),
		createEvent({ seq: 54, type: "tool_execution_finished", streamFrameIndex: 52, payload: { type: "tool_execution_finished", toolCallId: "tc-1", toolName: "read", result: "ok" } }),
		createEvent({ seq: 55, type: "message_finished", streamFrameIndex: 53, payload: { type: "message_finished", eventId: "turn-1", text: "Final." } }),
	);

	const fullView = createBaseView(events, "running");
	const incrementalView = events.reduce((view, event) => patchTraceViewWithEvent(view, event, "running"), createBaseView([], "running"));

	assert.equal(fullView.nodes.length, incrementalView.nodes.length);
	for (let i = 0; i < fullView.nodes.length; i++) {
		assert.equal(fullView.nodes[i].type, incrementalView.nodes[i].type);
		assert.equal(fullView.nodes[i].output, incrementalView.nodes[i].output);
		assert.equal(fullView.nodes[i].status, incrementalView.nodes[i].status);
		assert.equal(fullView.nodes[i].children.length, incrementalView.nodes[i].children.length);
	}
});
