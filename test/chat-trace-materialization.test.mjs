import assert from "node:assert/strict";
import test from "node:test";
import { buildTraceViewFromEvents } from "./helpers/pi-history.mjs";
import { storedPiboEventFromV2Row } from "../dist/apps/chat/data/chat-data-mappers.js";
import { createTraceViewVersion } from "../dist/apps/chat/trace.js";
import { traceTimelinePageFromView } from "../dist/apps/chat/trace-v2.js";
import { flattenTraceNodes } from "../dist/shared/trace-engine.js";
import { buildCompactTerminalRows } from "../dist/session-ui/terminalRows.js";

const now = "2026-01-01T00:00:00.000Z";

function session(overrides = {}) {
	return {
		id: "ps_root",
		piSessionId: "pi_root",
		channel: "chat-web",
		kind: "chat",
		profile: "default",
		createdAt: now,
		updatedAt: now,
		metadata: {},
		...overrides,
	};
}

function storedEvent(sequence, text) {
	return outputEvent(sequence, {
		type: "message_queued",
		eventId: `turn-${sequence}`,
		piboSessionId: "ps_root",
		source: "user",
		text,
	});
}

function outputEvent(sequence, payload) {
	return {
		id: `event-${sequence}`,
		piboSessionId: payload.piboSessionId ?? "ps_root",
		eventSequence: sequence,
		type: payload.type,
		createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)).toISOString(),
		payload,
	};
}

function assertMessageProjectionIds(view, legacyIds, terminalIds) {
	const legacyMessages = flattenTraceNodes(view.nodes)
		.filter((node) => node.type === "user.message" || node.type === "assistant.message");
	assert.deepEqual(legacyMessages.map((node) => node.id), legacyIds);

	const timelineMessages = traceTimelinePageFromView({ trace: view, payloadStore: {}, limit: 50 }).nodes
		.filter((node) => node.type === "user.message" || node.type === "assistant.message");
	assert.deepEqual(timelineMessages.map((node) => node.nodeId), legacyIds);

	const terminalMessages = buildCompactTerminalRows(view, { showThinking: true })
		.filter((row) => row.kind === "message.user" || row.kind === "message.assistant");
	assert.deepEqual(terminalMessages.map((row) => row.id), terminalIds);
}

function runNotificationText(notification) {
	return `<pibo_run_notification>${JSON.stringify(notification)}</pibo_run_notification>`;
}

test("trace engine omits raw events by default", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [storedEvent(1, "hello")],
	});

	assert.equal(view.rawEvents.length, 0);
	assert.deepEqual(view.nodes.map((node) => node.type), ["user.message"]);
});

test("raw event tail is opt-in and bounded", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [storedEvent(1, "one"), storedEvent(2, "two"), storedEvent(3, "three")],
		includeRawEvents: true,
		rawEventsLimit: 2,
	});

	assert.deepEqual(view.rawEvents.map((event) => event.id), ["event-2", "event-3"]);
	assert.deepEqual(view.nodes.map((node) => node.summary), ["one", "two", "three"]);
});

test("transcript assistant duration uses persisted turn timing when tail events omit message_started", () => {
	const startedAt = "2026-01-01T00:00:02.000Z";
	const completedAt = "2026-01-01T00:00:10.000Z";
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		transcriptEntries: [
			{
				id: "entry-user",
				type: "message",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: [{ type: "text", text: "hello" }] },
			},
			{
				id: "entry-assistant",
				type: "message",
				timestamp: "2026-01-01T00:00:09.000Z",
				message: { role: "assistant", status: "completed", content: [{ type: "text", text: "world" }] },
			},
		],
		// This models a reload where the bounded trace tail still has the finish
		// event but no longer has the matching message_started event.
		events: [
			{
				id: "event-finished",
				piboSessionId: "ps_root",
				eventSequence: 200,
				type: "message_finished",
				createdAt: completedAt,
				payload: { type: "message_finished", piboSessionId: "ps_root", eventId: "turn-duration" },
			},
		],
		turnTimings: [{ eventId: "turn-duration", userText: "hello", startedAt, completedAt, durationMs: 8000 }],
	});

	const user = view.nodes.find((node) => node.type === "user.message");
	const assistant = view.nodes.find((node) => node.type === "assistant.message");
	assert.equal(user?.id, "event:message_queued:turn-duration");
	assert.equal(user?.entryId, "entry-user");
	assert.equal(assistant?.completedAt, completedAt);
	assert.equal(assistant?.durationMs, 8000);
});

test("persisted turn timings keep repeated user identities stable beyond the bounded event tail", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		transcriptEntries: [
			{
				id: "entry-user-one",
				type: "message",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
			},
			{
				id: "entry-user-two",
				type: "message",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
			},
		],
		events: [],
		turnTimings: [
			{ eventId: "turn-one", userText: "same prompt", completedAt: "2026-01-01T00:00:03.000Z" },
			{ eventId: "turn-two", userText: "same prompt", completedAt: "2026-01-01T00:00:04.000Z" },
		],
	});

	const users = view.nodes.filter((node) => node.type === "user.message");
	assert.deepEqual(users.map((node) => node.id), [
		"event:message_queued:turn-one",
		"event:message_queued:turn-two",
	]);
	assert.deepEqual(users.map((node) => node.entryId), ["entry-user-one", "entry-user-two"]);
});

test("bounded-tail user events preserve repeated prompt identities assigned from full history", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		transcriptEntries: [
			{
				id: "entry-user-one",
				type: "message",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
			},
			{
				id: "entry-assistant-one",
				type: "message",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "first answer" }] },
			},
			{
				id: "entry-user-two",
				type: "message",
				timestamp: "2026-01-01T00:00:03.000Z",
				message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
			},
			{
				id: "entry-assistant-two",
				type: "message",
				timestamp: "2026-01-01T00:00:04.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "second answer" }] },
			},
		],
		events: [outputEvent(200, {
			type: "message_queued",
			eventId: "turn-two",
			piboSessionId: "ps_root",
			source: "user",
			text: "same prompt",
			queuedMessages: 1,
		})],
		turnTimings: [
			{ eventId: "turn-one", userText: "same prompt", completedAt: "2026-01-01T00:00:02.000Z" },
			{ eventId: "turn-two", userText: "same prompt", completedAt: "2026-01-01T00:00:04.000Z" },
		],
	});

	const users = view.nodes.filter((node) => node.type === "user.message");
	const assistants = view.nodes.filter((node) => node.type === "assistant.message");
	assert.deepEqual(users.map((node) => node.id), [
		"event:message_queued:turn-one",
		"event:message_queued:turn-two",
	]);
	assert.deepEqual(users.map((node) => node.entryId), ["entry-user-one", "entry-user-two"]);
	assert.deepEqual(assistants.map((node) => node.output), ["first answer", "second answer"]);
});

test("matched native runtime turns use stable product identity across legacy, V2, and terminal projections", () => {
	const historyEntries = [
		{
			id: "codex:thread:runtime-X:user-X",
			type: "message",
			source: "native",
			createdAt: "2026-01-01T00:00:02.000Z",
			turnId: "runtime-X",
			nativeTurnId: "runtime-X",
			nativeEntryId: "user-X",
			role: "user",
			content: "stable prompt",
		},
		{
			id: "codex:thread:runtime-X:assistant-X",
			type: "message",
			source: "native",
			createdAt: "2026-01-01T00:00:05.000Z",
			turnId: "runtime-X",
			nativeTurnId: "runtime-X",
			nativeEntryId: "assistant-X",
			role: "assistant",
			content: [
				{ type: "reasoning", text: "stable reasoning" },
				{ type: "tool_call", toolCallId: "tool-X", toolName: "read", input: { path: "stable.txt" } },
				{ type: "text", text: "stable answer" },
			],
			status: "complete",
		},
		{
			id: "codex:thread:runtime-X:tool-X",
			type: "message",
			source: "native",
			createdAt: "2026-01-01T00:00:05.500Z",
			turnId: "runtime-X",
			nativeTurnId: "runtime-X",
			nativeEntryId: "tool-X",
			role: "tool",
			content: "stable result",
			toolCallId: "tool-X",
			toolName: "read",
			result: { content: "stable result" },
			status: "complete",
		},
	];
	const events = [
		outputEvent(1, { type: "message_queued", piboSessionId: "ps_root", eventId: "stable-Y", source: "user", text: "stable prompt" }),
		outputEvent(2, { type: "message_started", piboSessionId: "ps_root", eventId: "stable-Y", source: "user", text: "stable prompt" }),
		outputEvent(3, { type: "tool_call", piboSessionId: "ps_root", eventId: "stable-Y", toolCallId: "tool-X", toolName: "read", args: { path: "stable.txt" } }),
		outputEvent(4, { type: "thinking_finished", piboSessionId: "ps_root", eventId: "stable-Y", thinkingIndex: 0, text: "stable reasoning" }),
		outputEvent(5, { type: "assistant_message", piboSessionId: "ps_root", eventId: "stable-Y", assistantIndex: 0, contentIndex: 0, text: "stable answer" }),
		outputEvent(6, { type: "message_finished", piboSessionId: "ps_root", eventId: "stable-Y", source: "user" }),
	];
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events,
		historyEntries,
		status: "idle",
	});
	const legacyNodes = flattenTraceNodes(view.nodes);
	const legacyMessages = legacyNodes.filter((node) => node.type === "user.message" || node.type === "assistant.message");
	assert.deepEqual(legacyMessages.map((node) => node.id), [
		"event:message_queued:stable-Y",
		"event:assistant:stable-Y:assistant:0",
	]);
	assert.deepEqual(legacyMessages.map((node) => node.eventId), ["stable-Y", "stable-Y"]);
	assert.deepEqual(legacyMessages.map((node) => node.nativeTurnId), ["runtime-X", "runtime-X"]);
	assert.deepEqual(legacyMessages.map((node) => node.entryId), ["user-X", "assistant-X"]);
	assert.equal(legacyNodes.filter((node) => node.type === "model.reasoning").length, 1);
	assert.equal(legacyNodes.filter((node) => node.toolCallId === "tool-X").length, 1);
	assert.ok(legacyNodes
		.filter((node) => node.type === "model.reasoning" || node.toolCallId === "tool-X")
		.every((node) => node.eventId === "stable-Y" && node.nativeTurnId === "runtime-X"));

	const timeline = traceTimelinePageFromView({ trace: view, payloadStore: {}, limit: 50 });
	const timelineMessages = timeline.nodes.filter((node) => node.type === "user.message" || node.type === "assistant.message");
	assert.deepEqual(timelineMessages.map((node) => node.nodeId), [
		"event:message_queued:stable-Y",
		"event:assistant:stable-Y:assistant:0",
	]);
	assert.deepEqual(timelineMessages.map((node) => node.nativeTurnId), ["runtime-X", "runtime-X"]);

	const terminalMessages = buildCompactTerminalRows(view, { showThinking: true })
		.filter((row) => row.kind === "message.user" || row.kind === "message.assistant");
	assert.deepEqual(terminalMessages.map((row) => row.id), [
		"event:message_queued:stable-Y",
		"terminal:assistant:stable-Y:assistant:0",
	]);
});

test("steering keeps split native outputs on the base product turn with monotonic indices", () => {
	const historyEntries = [
		{
			id: "codex:thread:runtime-X:user-base",
			type: "message",
			source: "native",
			createdAt: "2026-01-01T00:00:02.000Z",
			turnId: "runtime-X",
			nativeTurnId: "runtime-X",
			nativeEntryId: "user-base",
			role: "user",
			content: "base prompt",
		},
		{
			id: "codex:thread:runtime-X:assistant-base",
			type: "message",
			source: "native",
			createdAt: "2026-01-01T00:00:03.000Z",
			turnId: "runtime-X",
			nativeTurnId: "runtime-X",
			nativeEntryId: "assistant-base",
			role: "assistant",
			content: [
				{ type: "reasoning", text: "base reasoning" },
				{ type: "text", text: "base answer" },
			],
			status: "complete",
		},
		{
			id: "codex:thread:runtime-X:user-steer",
			type: "message",
			source: "native",
			createdAt: "2026-01-01T00:00:05.000Z",
			turnId: "runtime-X",
			nativeTurnId: "runtime-X",
			nativeEntryId: "user-steer",
			role: "user",
			content: "steering prompt",
		},
		{
			id: "codex:thread:runtime-X:assistant-steered",
			type: "message",
			source: "native",
			createdAt: "2026-01-01T00:00:07.000Z",
			turnId: "runtime-X",
			nativeTurnId: "runtime-X",
			nativeEntryId: "assistant-steered",
			role: "assistant",
			content: [
				{ type: "reasoning", text: "steered reasoning" },
				{ type: "tool_call", toolCallId: "tool-steered", toolName: "read", input: { path: "steered.txt" } },
				{ type: "text", text: "steered answer" },
			],
			status: "complete",
		},
		{
			id: "codex:thread:runtime-X:tool-steered",
			type: "message",
			source: "native",
			createdAt: "2026-01-01T00:00:08.000Z",
			turnId: "runtime-X",
			nativeTurnId: "runtime-X",
			nativeEntryId: "tool-steered",
			role: "tool",
			content: "steered result",
			toolCallId: "tool-steered",
			toolName: "read",
			result: { content: "steered result" },
			status: "complete",
		},
	];
	const events = [
		outputEvent(1, { type: "message_queued", piboSessionId: "ps_root", eventId: "stable-base", source: "user", text: "base prompt" }),
		outputEvent(2, { type: "message_started", piboSessionId: "ps_root", eventId: "stable-base", source: "user", text: "base prompt" }),
		outputEvent(3, { type: "thinking_finished", piboSessionId: "ps_root", eventId: "stable-base", thinkingIndex: 0, text: "base reasoning" }),
		outputEvent(4, { type: "assistant_message", piboSessionId: "ps_root", eventId: "stable-base", assistantIndex: 0, text: "base answer" }),
		outputEvent(5, { type: "message_steered", piboSessionId: "ps_root", eventId: "stable-steer", activeEventId: "stable-base", source: "user", text: "steering prompt" }),
		outputEvent(6, { type: "thinking_finished", piboSessionId: "ps_root", eventId: "stable-base", thinkingIndex: 1, text: "steered reasoning" }),
		outputEvent(7, { type: "tool_call", piboSessionId: "ps_root", eventId: "stable-base", toolCallId: "tool-steered", toolName: "read", args: { path: "steered.txt" } }),
		outputEvent(8, { type: "tool_execution_finished", piboSessionId: "ps_root", eventId: "stable-base", toolCallId: "tool-steered", toolName: "read", result: { content: "steered result" }, isError: false }),
		outputEvent(9, { type: "assistant_message", piboSessionId: "ps_root", eventId: "stable-base", assistantIndex: 1, text: "steered answer" }),
		outputEvent(10, { type: "message_finished", piboSessionId: "ps_root", eventId: "stable-base", source: "user" }),
	];
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events,
		historyEntries,
		status: "idle",
	});
	const nodes = flattenTraceNodes(view.nodes);
	const users = nodes.filter((node) => node.type === "user.message");
	const assistants = nodes.filter((node) => node.type === "assistant.message");
	const reasoning = nodes.filter((node) => node.type === "model.reasoning");
	const tool = nodes.find((node) => node.toolCallId === "tool-steered");
	assert.deepEqual(users.map((node) => ({ id: node.id, eventId: node.eventId, parentId: node.parentId, nativeTurnId: node.nativeTurnId })), [
		{ id: "event:message_queued:stable-base", eventId: "stable-base", parentId: undefined, nativeTurnId: "runtime-X" },
		{ id: "event:message_steered:stable-steer", eventId: "stable-steer", parentId: "event:message:stable-base", nativeTurnId: "runtime-X" },
	]);
	assert.deepEqual(assistants.map((node) => ({ id: node.id, eventId: node.eventId, parentId: node.parentId, nativeTurnId: node.nativeTurnId })), [
		{ id: "event:assistant:stable-base:assistant:0", eventId: "stable-base", parentId: undefined, nativeTurnId: "runtime-X" },
		{ id: "event:assistant:stable-base:assistant:1", eventId: "stable-base", parentId: undefined, nativeTurnId: "runtime-X" },
	]);
	assert.deepEqual(reasoning.map((node) => ({ id: node.id, eventId: node.eventId, nativeTurnId: node.nativeTurnId })), [
		{ id: "event:thinking:stable-base:thinking:0", eventId: "stable-base", nativeTurnId: "runtime-X" },
		{ id: "event:thinking:stable-base:thinking:1", eventId: "stable-base", nativeTurnId: "runtime-X" },
	]);
	assert.deepEqual(
		{ id: tool?.id, eventId: tool?.eventId, parentId: tool?.parentId, nativeTurnId: tool?.nativeTurnId, status: tool?.status },
		{ id: "tool:tool-steered", eventId: "stable-base", parentId: undefined, nativeTurnId: "runtime-X", status: "done" },
	);

	const timeline = traceTimelinePageFromView({ trace: view, payloadStore: {}, limit: 50 });
	const timelineSteer = timeline.nodes.find((node) => node.nodeId === "event:message_steered:stable-steer");
	assert.deepEqual(
		{ eventId: timelineSteer?.eventId, parentId: timelineSteer?.parentId, nativeTurnId: timelineSteer?.nativeTurnId },
		{ eventId: "stable-steer", parentId: "event:message:stable-base", nativeTurnId: "runtime-X" },
	);
	assert.ok(timeline.nodes
		.filter((node) => node.type === "assistant.message" || node.type === "model.reasoning" || node.toolCallId === "tool-steered")
		.every((node) => node.eventId === "stable-base" && node.nativeTurnId === "runtime-X"));
	assert.deepEqual(timeline.nodes
		.filter((node) => node.type === "assistant.message" || node.type === "model.reasoning")
		.map((node) => node.nodeId)
		.sort(), [
			"event:assistant:stable-base:assistant:0",
			"event:thinking:stable-base:thinking:0",
			"event:assistant:stable-base:assistant:1",
			"event:thinking:stable-base:thinking:1",
		].sort());
	const terminalMessages = buildCompactTerminalRows(view, { showThinking: true })
		.filter((row) => row.kind === "message.user" || row.kind === "message.assistant");
	assert.deepEqual(terminalMessages.map((row) => row.id), [
		"event:message_queued:stable-base",
		"terminal:assistant:stable-base:assistant:0",
		"event:message_steered:stable-steer",
		"terminal:assistant:stable-base:assistant:1",
	]);
});

test("ambiguous repeated prompt timings fail closed to native identity", () => {
	const historyEntries = [
		{ id: "native:user", type: "message", source: "native", createdAt: "2026-01-01T00:00:01.000Z", turnId: "runtime-old", nativeTurnId: "runtime-old", nativeEntryId: "user-old", role: "user", content: "identical prompt" },
		{ id: "native:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:00:02.000Z", turnId: "runtime-old", nativeTurnId: "runtime-old", nativeEntryId: "assistant-old", role: "assistant", content: "old answer", status: "complete" },
	];
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries,
		turnTimings: [
			{ eventId: "stable-old", userText: "identical prompt" },
			{ eventId: "stable-new", userText: "identical prompt" },
		],
	});
	const messages = flattenTraceNodes(view.nodes)
		.filter((node) => node.type === "user.message" || node.type === "assistant.message");
	assert.deepEqual(messages.map((node) => node.id), [
		"event:message_queued:runtime-old",
		"event:assistant:runtime-old:assistant:0",
	]);
	assert.deepEqual(messages.map((node) => node.eventId), ["runtime-old", "runtime-old"]);
	assert.deepEqual(messages.map((node) => node.nativeTurnId), ["runtime-old", "runtime-old"]);
});

test("missing timestamp evidence fails a unique prompt match closed across projections", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries: [
			{ id: "native:missing:user", type: "message", source: "native", createdAt: "2026-01-01T00:00:01.000Z", turnId: "runtime-missing", nativeTurnId: "runtime-missing", nativeEntryId: "user-missing", role: "user", content: "missing timestamp prompt" },
			{ id: "native:missing:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:00:02.000Z", turnId: "runtime-missing", nativeTurnId: "runtime-missing", nativeEntryId: "assistant-missing", role: "assistant", content: "missing timestamp answer", status: "complete" },
		],
		turnTimings: [{ eventId: "stable-missing", userText: "missing timestamp prompt" }],
	});

	assertMessageProjectionIds(view, [
		"event:message_queued:runtime-missing",
		"event:assistant:runtime-missing:assistant:0",
	], [
		"event:message_queued:runtime-missing",
		"terminal:assistant:runtime-missing:assistant:0",
	]);
	assert.ok(flattenTraceNodes(view.nodes)
		.filter((node) => node.type === "user.message" || node.type === "assistant.message")
		.every((node) => node.eventId === "runtime-missing" && node.nativeTurnId === "runtime-missing"));
});

test("over-five-minute start and completion evidence fails closed across projections", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries: [
			{ id: "native:distant:user", type: "message", source: "native", createdAt: "2026-01-01T00:20:00.000Z", turnId: "runtime-distant", nativeTurnId: "runtime-distant", nativeEntryId: "user-distant", role: "user", content: "distant prompt" },
			{ id: "native:distant:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:21:00.000Z", turnId: "runtime-distant", nativeTurnId: "runtime-distant", nativeEntryId: "assistant-distant", role: "assistant", content: "distant answer", status: "complete" },
		],
		turnTimings: [{
			eventId: "stable-distant",
			userText: "distant prompt",
			startedAt: "2026-01-01T00:00:00.000Z",
			completedAt: "2026-01-01T00:01:00.000Z",
		}],
	});

	assertMessageProjectionIds(view, [
		"event:message_queued:runtime-distant",
		"event:assistant:runtime-distant:assistant:0",
	], [
		"event:message_queued:runtime-distant",
		"terminal:assistant:runtime-distant:assistant:0",
	]);
});

test("partial and implementation-dependent timestamps cannot authorize product identity", () => {
	const invalidTimestamps = [
		["date-only", "2026-01-01"],
		["timezone-less", "2026-01-01T00:00:00"],
		["space-separated", "2026-01-01 00:00:00Z"],
		["slash-date", "01/01/2026 00:00:00 GMT"],
		["month-only", "2026-01"],
		["invalid-calendar-date", "2026-02-30T00:00:00Z"],
		["non-finite", "Infinity"],
	];

	for (const [suffix, timestamp] of invalidTimestamps) {
		const runtimeId = `runtime-partial-${suffix}`;
		const view = buildTraceViewFromEvents({
			session: { id: "ps_root", piSessionId: "", title: "Root" },
			events: [],
			historyEntries: [
				{ id: `native:${suffix}:user`, type: "message", source: "native", createdAt: timestamp, turnId: runtimeId, nativeTurnId: runtimeId, nativeEntryId: `user-${suffix}`, role: "user", content: `partial timestamp ${suffix}` },
				{ id: `native:${suffix}:assistant`, type: "message", source: "native", createdAt: "2026-01-01T00:00:01.000Z", turnId: runtimeId, nativeTurnId: runtimeId, nativeEntryId: `assistant-${suffix}`, role: "assistant", content: `${suffix} answer`, status: "complete" },
			],
			turnTimings: [{
				eventId: `stable-partial-${suffix}`,
				userText: `partial timestamp ${suffix}`,
				startedAt: timestamp,
			}],
		});

		assertMessageProjectionIds(view, [
			`event:message_queued:${runtimeId}`,
			`event:assistant:${runtimeId}:assistant:0`,
		], [
			`event:message_queued:${runtimeId}`,
			`terminal:assistant:${runtimeId}:assistant:0`,
		]);
	}
});

test("explicit UTC and offset timestamps retain bounded reconciliation", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries: [
			{ id: "native:boundary:user", type: "message", source: "native", createdAt: "2026-01-01T00:05:00Z", sequence: 0, turnId: "runtime-boundary", nativeTurnId: "runtime-boundary", nativeEntryId: "user-boundary", role: "user", content: "five minute boundary" },
			{ id: "native:boundary:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:05:01Z", sequence: 1, turnId: "runtime-boundary", nativeTurnId: "runtime-boundary", nativeEntryId: "assistant-boundary", role: "assistant", content: "boundary answer", status: "complete" },
			{ id: "native:offset:user", type: "message", source: "native", createdAt: "2026-01-01T00:10:00Z", sequence: 2, turnId: "runtime-offset", nativeTurnId: "runtime-offset", nativeEntryId: "user-offset", role: "user", content: "explicit offset" },
			{ id: "native:offset:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:10:01Z", sequence: 3, turnId: "runtime-offset", nativeTurnId: "runtime-offset", nativeEntryId: "assistant-offset", role: "assistant", content: "offset answer", status: "complete" },
			{ id: "native:valid-completion:user", type: "message", source: "native", createdAt: "not a timestamp", sequence: 4, turnId: "runtime-valid-completion", nativeTurnId: "runtime-valid-completion", nativeEntryId: "user-valid-completion", role: "user", content: "valid completion" },
			{ id: "native:valid-completion:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:20:00-04:00", sequence: 5, turnId: "runtime-valid-completion", nativeTurnId: "runtime-valid-completion", nativeEntryId: "assistant-valid-completion", role: "assistant", content: "valid completion answer", status: "complete" },
		],
		turnTimings: [
			{ eventId: "stable-boundary", userText: "five minute boundary", startedAt: "2026-01-01T00:00:00Z" },
			{ eventId: "stable-offset", userText: "explicit offset", startedAt: "2026-01-01T02:40:00+02:30" },
			{ eventId: "stable-valid-completion", userText: "valid completion", startedAt: "also invalid", completedAt: "2026-01-01T04:20:00Z" },
		],
	});

	assertMessageProjectionIds(view, [
		"event:message_queued:stable-boundary",
		"event:assistant:stable-boundary:assistant:0",
		"event:message_queued:stable-offset",
		"event:assistant:stable-offset:assistant:0",
		"event:message_queued:stable-valid-completion",
		"event:assistant:stable-valid-completion:assistant:0",
	], [
		"event:message_queued:stable-boundary",
		"terminal:assistant:stable-boundary:assistant:0",
		"event:message_queued:stable-offset",
		"terminal:assistant:stable-offset:assistant:0",
		"event:message_queued:stable-valid-completion",
		"terminal:assistant:stable-valid-completion:assistant:0",
	]);
});

test("equal best evidence split across start and completion endpoints fails closed", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries: [
			{ id: "native:cross-tie:user", type: "message", source: "native", createdAt: "2026-01-01T00:10:00.000Z", turnId: "runtime-cross-tie", nativeTurnId: "runtime-cross-tie", nativeEntryId: "user-cross-tie", role: "user", content: "cross endpoint tie" },
			{ id: "native:cross-tie:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:20:00.000Z", turnId: "runtime-cross-tie", nativeTurnId: "runtime-cross-tie", nativeEntryId: "assistant-cross-tie", role: "assistant", content: "cross endpoint answer", status: "complete" },
		],
		turnTimings: [
			{ eventId: "stable-by-start", userText: "cross endpoint tie", startedAt: "2026-01-01T00:09:59.000Z", completedAt: "2026-01-01T00:00:00.000Z" },
			{ eventId: "stable-by-completion", userText: "cross endpoint tie", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:20:01.000Z" },
		],
	});

	assertMessageProjectionIds(view, [
		"event:message_queued:runtime-cross-tie",
		"event:assistant:runtime-cross-tie:assistant:0",
	], [
		"event:message_queued:runtime-cross-tie",
		"terminal:assistant:runtime-cross-tie:assistant:0",
	]);
});

test("non-monotonic matches fail each native turn closed without splitting outputs", () => {
	const historyEntries = [
		...[
			["new", "2026-01-01T00:20:00.000Z", "2026-01-01T00:20:01.000Z"],
			["old", "2026-01-01T00:10:00.000Z", "2026-01-01T00:10:01.000Z"],
		].flatMap(([suffix, userAt, assistantAt]) => [
			{ id: `native:${suffix}:user`, type: "message", source: "native", createdAt: userAt, sequence: suffix === "new" ? 0 : 3, turnId: `runtime-${suffix}`, nativeTurnId: `runtime-${suffix}`, nativeEntryId: `user-${suffix}`, role: "user", content: "out of order prompt" },
			{
				id: `native:${suffix}:assistant`,
				type: "message",
				source: "native",
				createdAt: assistantAt,
				sequence: suffix === "new" ? 1 : 4,
				turnId: `runtime-${suffix}`,
				nativeTurnId: `runtime-${suffix}`,
				nativeEntryId: `assistant-${suffix}`,
				role: "assistant",
				content: [
					{ type: "reasoning", text: `${suffix} reasoning` },
					{ type: "tool_call", toolCallId: `tool-${suffix}`, toolName: "read", input: { path: `${suffix}.txt` } },
					{ type: "text", text: `${suffix} answer` },
				],
				status: "complete",
			},
			{ id: `native:${suffix}:tool`, type: "message", source: "native", createdAt: assistantAt, sequence: suffix === "new" ? 2 : 5, turnId: `runtime-${suffix}`, nativeTurnId: `runtime-${suffix}`, nativeEntryId: `tool-${suffix}`, role: "tool", content: `${suffix} result`, toolCallId: `tool-${suffix}`, toolName: "read", result: { content: `${suffix} result` }, status: "complete" },
		]),
	];
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries,
		turnTimings: [
			{ eventId: "stable-old", userText: "out of order prompt", startedAt: "2026-01-01T00:10:00.000Z", completedAt: "2026-01-01T00:10:01.000Z" },
			{ eventId: "stable-new", userText: "out of order prompt", startedAt: "2026-01-01T00:20:00.000Z", completedAt: "2026-01-01T00:20:01.000Z" },
		],
	});

	assertMessageProjectionIds(view, [
		"event:message_queued:runtime-new",
		"event:assistant:runtime-new:assistant:0",
		"event:message_queued:runtime-old",
		"event:assistant:runtime-old:assistant:0",
	], [
		"event:message_queued:runtime-new",
		"terminal:assistant:runtime-new:assistant:0",
		"event:message_queued:runtime-old",
		"terminal:assistant:runtime-old:assistant:0",
	]);
	for (const suffix of ["new", "old"]) {
		const outputNodes = flattenTraceNodes(view.nodes).filter((node) =>
			node.nativeTurnId === `runtime-${suffix}` &&
			(node.type === "assistant.message" || node.type === "model.reasoning" || node.toolCallId === `tool-${suffix}`)
		);
		assert.ok(outputNodes.length >= 3);
		assert.ok(outputNodes.every((node) => node.eventId === `runtime-${suffix}`));
	}
});

test("conflicting product owners fail one native turn closed as a unit", () => {
	const historyEntries = [
		...[
			["one", "first owner prompt", "2026-01-01T00:10:00.000Z", "2026-01-01T00:10:01.000Z"],
			["two", "second owner prompt", "2026-01-01T00:20:00.000Z", "2026-01-01T00:20:01.000Z"],
		].flatMap(([suffix, prompt, userAt, assistantAt], turnIndex) => [
			{ id: `native:conflict:${suffix}:user`, type: "message", source: "native", createdAt: userAt, sequence: turnIndex * 2, turnId: "runtime-conflict", nativeTurnId: "runtime-conflict", nativeEntryId: `user-conflict-${suffix}`, role: "user", content: prompt },
			{ id: `native:conflict:${suffix}:assistant`, type: "message", source: "native", createdAt: assistantAt, sequence: turnIndex * 2 + 1, turnId: "runtime-conflict", nativeTurnId: "runtime-conflict", nativeEntryId: `assistant-conflict-${suffix}`, role: "assistant", content: `${suffix} conflict answer`, status: "complete" },
		]),
	];
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries,
		turnTimings: [
			{ eventId: "stable-owner-one", userText: "first owner prompt", startedAt: "2026-01-01T00:10:00.000Z", completedAt: "2026-01-01T00:10:01.000Z" },
			{ eventId: "stable-owner-two", userText: "second owner prompt", startedAt: "2026-01-01T00:20:00.000Z", completedAt: "2026-01-01T00:20:01.000Z" },
		],
	});

	const legacyMessages = flattenTraceNodes(view.nodes)
		.filter((node) => node.type === "user.message" || node.type === "assistant.message");
	assert.equal(legacyMessages.filter((node) => node.type === "assistant.message").length, 2);
	assert.ok(legacyMessages.some((node) => node.type === "user.message"));
	assert.ok(legacyMessages.every((node) =>
		node.eventId === "runtime-conflict" && node.nativeTurnId === "runtime-conflict"
	));
	assert.deepEqual(legacyMessages
		.filter((node) => node.type === "assistant.message")
		.map((node) => node.id), [
			"event:assistant:runtime-conflict:assistant:0",
			"event:assistant:runtime-conflict:assistant:1",
		]);
	const timelineMessages = traceTimelinePageFromView({ trace: view, payloadStore: {}, limit: 50 }).nodes
		.filter((node) => node.type === "user.message" || node.type === "assistant.message");
	assert.ok(timelineMessages.every((node) => node.eventId === "runtime-conflict"));
	const terminalMessages = buildCompactTerminalRows(view, { showThinking: true })
		.filter((row) => row.kind === "message.user" || row.kind === "message.assistant");
	assert.ok(terminalMessages.every((row) => !row.id.includes("stable-owner")));
});

test("multiple native exact claims for one product identity fail closed without projection loss", () => {
	const historyEntries = ["a", "b"].flatMap((suffix, turnIndex) => {
		const runtimeId = `runtime-exact-${suffix}`;
		const sequence = turnIndex * 3;
		return [
			{ id: `native:exact:${suffix}:user`, type: "message", source: "native", createdAt: `2026-01-01T00:0${turnIndex}:00.000Z`, sequence, turnId: "stable-shared-exact", nativeTurnId: runtimeId, nativeEntryId: `user-exact-${suffix}`, role: "user", content: `exact collision ${suffix}` },
			{
				id: `native:exact:${suffix}:assistant`,
				type: "message",
				source: "native",
				createdAt: `2026-01-01T00:0${turnIndex}:01.000Z`,
				sequence: sequence + 1,
				turnId: "stable-shared-exact",
				nativeTurnId: runtimeId,
				nativeEntryId: `assistant-exact-${suffix}`,
				role: "assistant",
				content: [
					{ type: "reasoning", text: `exact ${suffix} reasoning` },
					{ type: "tool_call", toolCallId: `tool-exact-${suffix}`, toolName: "read", input: { path: `${suffix}.txt` } },
					{ type: "text", text: `exact ${suffix} answer` },
				],
				status: "complete",
			},
			{ id: `native:exact:${suffix}:tool`, type: "message", source: "native", createdAt: `2026-01-01T00:0${turnIndex}:02.000Z`, sequence: sequence + 2, turnId: "stable-shared-exact", nativeTurnId: runtimeId, nativeEntryId: `tool-exact-${suffix}`, role: "tool", content: `exact ${suffix} result`, toolCallId: `tool-exact-${suffix}`, toolName: "read", result: { content: `exact ${suffix} result` }, status: "complete" },
		];
	});
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries,
		turnTimings: [{ eventId: "stable-shared-exact", userText: "irrelevant for exact identity" }],
	});

	assertMessageProjectionIds(view, [
		"event:message_queued:runtime-exact-a",
		"event:assistant:runtime-exact-a:assistant:0",
		"event:message_queued:runtime-exact-b",
		"event:assistant:runtime-exact-b:assistant:0",
	], [
		"event:message_queued:runtime-exact-a",
		"terminal:assistant:runtime-exact-a:assistant:0",
		"event:message_queued:runtime-exact-b",
		"terminal:assistant:runtime-exact-b:assistant:0",
	]);
	const legacyNodes = flattenTraceNodes(view.nodes);
	assert.equal(legacyNodes.filter((node) => node.type === "user.message" || node.type === "assistant.message").length, 4);
	assert.equal(traceTimelinePageFromView({ trace: view, payloadStore: {}, limit: 50 }).nodes
		.filter((node) => node.type === "user.message" || node.type === "assistant.message").length, 4);
	assert.equal(buildCompactTerminalRows(view, { showThinking: true })
		.filter((row) => row.kind === "message.user" || row.kind === "message.assistant").length, 4);
	for (const suffix of ["a", "b"]) {
		const runtimeId = `runtime-exact-${suffix}`;
		const turnNodes = legacyNodes.filter((node) => node.nativeTurnId === runtimeId);
		assert.ok(turnNodes.length >= 4);
		assert.ok(turnNodes.every((node) => node.eventId === runtimeId));
	}
});

test("exact identity and unique bounded endpoint evidence remain authoritative", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries: [
			{ id: "native:exact:user", type: "message", source: "native", createdAt: "2026-01-01T00:00:01.000Z", turnId: "stable-exact", nativeTurnId: "runtime-exact", nativeEntryId: "user-exact", role: "user", content: "exact prompt" },
			{ id: "native:exact:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:00:02.000Z", turnId: "stable-exact", nativeTurnId: "runtime-exact", nativeEntryId: "assistant-exact", role: "assistant", content: "exact answer", status: "complete" },
			{ id: "native:bounded:user", type: "message", source: "native", createdAt: "2026-01-01T00:10:00.000Z", turnId: "runtime-bounded", nativeTurnId: "runtime-bounded", nativeEntryId: "user-bounded", role: "user", content: "bounded prompt" },
			{ id: "native:bounded:assistant", type: "message", source: "native", createdAt: "2026-01-01T00:10:02.000Z", turnId: "runtime-bounded", nativeTurnId: "runtime-bounded", nativeEntryId: "assistant-bounded", role: "assistant", content: "bounded answer", status: "complete" },
		],
		turnTimings: [
			{ eventId: "stable-exact", userText: "different text without timestamps" },
			{ eventId: "stable-bounded", userText: "bounded prompt", completedAt: "2026-01-01T00:10:03.000Z" },
		],
	});

	assertMessageProjectionIds(view, [
		"event:message_queued:stable-exact",
		"event:assistant:stable-exact:assistant:0",
		"event:message_queued:stable-bounded",
		"event:assistant:stable-bounded:assistant:0",
	], [
		"event:message_queued:stable-exact",
		"terminal:assistant:stable-exact:assistant:0",
		"event:message_queued:stable-bounded",
		"terminal:assistant:stable-bounded:assistant:0",
	]);
});

test("repeated identical native turns retain distinct matched product identities", () => {
	const historyEntries = [
		...[
			["one", "2026-01-01T00:00:01.000Z", "2026-01-01T00:00:03.000Z"],
			["two", "2026-01-01T00:00:04.000Z", "2026-01-01T00:00:06.000Z"],
		].flatMap(([suffix, userAt, assistantAt]) => [
			{
				id: `codex:thread:runtime-${suffix}:user-${suffix}`,
				type: "message",
				source: "native",
				createdAt: userAt,
				turnId: `runtime-${suffix}`,
				nativeTurnId: `runtime-${suffix}`,
				nativeEntryId: `user-${suffix}`,
				role: "user",
				content: "identical prompt",
			},
			{
				id: `codex:thread:runtime-${suffix}:assistant-${suffix}`,
				type: "message",
				source: "native",
				createdAt: assistantAt,
				turnId: `runtime-${suffix}`,
				nativeTurnId: `runtime-${suffix}`,
				nativeEntryId: `assistant-${suffix}`,
				role: "assistant",
				content: "identical answer",
				status: "complete",
			},
		]),
	];
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "", title: "Root" },
		events: [],
		historyEntries,
		turnTimings: [
			{ eventId: "stable-one", userText: "identical prompt", completedAt: "2026-01-01T00:00:03.000Z" },
			{ eventId: "stable-two", userText: "identical prompt", completedAt: "2026-01-01T00:00:06.000Z" },
		],
	});
	const messages = flattenTraceNodes(view.nodes)
		.filter((node) => node.type === "user.message" || node.type === "assistant.message");
	assert.deepEqual(messages.map((node) => node.id), [
		"event:message_queued:stable-one",
		"event:assistant:stable-one:assistant:0",
		"event:message_queued:stable-two",
		"event:assistant:stable-two:assistant:0",
	]);
	assert.deepEqual(messages.map((node) => node.nativeTurnId), [
		"runtime-one",
		"runtime-one",
		"runtime-two",
		"runtime-two",
	]);
});

test("active repeated prompts do not reuse settled canonical transcript identities", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		status: "running",
		transcriptEntries: [
			{
				id: "entry-user-one",
				type: "message",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
			},
			{
				id: "entry-assistant-one",
				type: "message",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "first answer" }] },
			},
			{
				id: "entry-user-two",
				type: "message",
				timestamp: "2026-01-01T00:00:03.000Z",
				message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
			},
			{
				id: "entry-assistant-two",
				type: "message",
				timestamp: "2026-01-01T00:00:04.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "second answer" }] },
			},
		],
		events: [outputEvent(5, {
			type: "message_queued",
			eventId: "turn-three",
			piboSessionId: "ps_root",
			source: "user",
			text: "same prompt",
			queuedMessages: 1,
		})],
		turnTimings: [
			{ eventId: "turn-one", userText: "same prompt", completedAt: "2026-01-01T00:00:02.000Z" },
			{ eventId: "turn-two", userText: "same prompt", completedAt: "2026-01-01T00:00:04.000Z" },
		],
	});

	assert.deepEqual(view.nodes.filter((node) => node.type === "user.message").map((node) => node.id), [
		"event:message_queued:turn-one",
		"event:message_queued:turn-two",
		"event:message_queued:turn-three",
	]);
	assert.deepEqual(view.nodes.filter((node) => node.type === "assistant.message").map((node) => node.output), [
		"first answer",
		"second answer",
	]);
});

test("canonical steering identity wins before repeated-text fallback", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		transcriptEntries: [
			{
				id: "entry-user-one",
				type: "message",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
			},
			{
				id: "entry-user-two",
				type: "message",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: { role: "user", content: [{ type: "text", text: "same prompt" }] },
			},
		],
		events: [outputEvent(3, {
			type: "message_steered",
			eventId: "turn-two",
			activeEventId: "active-turn",
			piboSessionId: "ps_root",
			source: "user",
			text: "same prompt",
		})],
		turnTimings: [
			{ eventId: "turn-one", userText: "same prompt", completedAt: "2026-01-01T00:00:01.500Z" },
			{ eventId: "turn-two", userText: "same prompt", userMessageType: "message_steered" },
		],
	});

	const users = view.nodes.filter((node) => node.type === "user.message");
	assert.deepEqual(users.map((node) => node.id), [
		"event:message_queued:turn-one",
		"event:message_steered:turn-two",
	]);
	assert.equal(users[0]?.parentId, undefined);
	assert.equal(users[1]?.parentId, "event:message:active-turn");
});

test("legacy transcript run notifications render yielded-run nodes", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		transcriptEntries: [
			{
				id: "entry-run-note",
				type: "message",
				timestamp: now,
				message: {
					role: "user",
					content: [
						{
							type: "text",
							text: runNotificationText({
								completed: [{ runId: "run_done" }],
								failed: [{ runId: "run_failed" }],
								timedOut: [{ runId: "run_timed_out", status: "timed_out" }],
							}),
						},
					],
				},
			},
		],
		events: [],
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "yielded.run");
	assert.equal(view.nodes[0].title, "Run Notification");
	assert.equal(view.nodes[0].status, "error");
	assert.equal(view.nodes[0].summary, "1 completed, 1 failed, 1 timed out");
	assert.equal(view.nodes[0].source, "transcript");
	assert.equal(view.nodes[0].runId, undefined);
});

test("service run notification events render running yielded-run nodes", () => {
	const event = storedEvent(1, runNotificationText({ running: [{ runId: "run_active" }] }));
	event.payload.source = "service";

	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [event],
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "yielded.run");
	assert.equal(view.nodes[0].status, "running");
	assert.equal(view.nodes[0].summary, "1 running");
	assert.equal(view.nodes[0].runId, "run_active");
	assert.equal(view.nodes[0].source, "event-log");
});

test("subagent tool events link likely child sessions by tool name and thread key", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		sessions: [
			{
				id: "ps_child",
				parentId: "ps_root",
				updatedAt: now,
				metadata: { subagentToolName: "pibo_subagent_researcher", threadKey: "qa" },
			},
		],
		events: [
			{
				id: "event-subagent-tool",
				piboSessionId: "ps_root",
				eventSequence: 1,
				type: "tool_call",
				createdAt: now,
				payload: {
					type: "tool_call",
					piboSessionId: "ps_root",
					eventId: "turn-1",
					toolCallId: "tool-subagent",
					toolName: "pibo_subagent_researcher",
					args: { message: "inspect", threadKey: "qa" },
				},
			},
		],
		status: "running",
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "agent.delegation");
	assert.equal(view.nodes[0].linkedPiboSessionId, "ps_child");
});

test("event-log projection nests turn, reasoning, and assistant content with final statuses", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [
			outputEvent(1, {
				type: "message_queued",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
				source: "user",
				text: "hello",
			}),
			outputEvent(2, {
				type: "message_started",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
				text: "hello",
			}),
			outputEvent(3, {
				type: "thinking_delta",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
				thinkingIndex: 0,
				text: "plan ",
			}),
			outputEvent(4, {
				type: "thinking_delta",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
				thinkingIndex: 0,
				text: "answer",
			}),
			outputEvent(5, {
				type: "thinking_finished",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
				thinkingIndex: 0,
				text: "plan answer",
			}),
			outputEvent(6, {
				type: "assistant_delta",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
				assistantIndex: 0,
				text: "hel",
			}),
			outputEvent(7, {
				type: "assistant_delta",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
				assistantIndex: 0,
				text: "lo",
			}),
			outputEvent(8, {
				type: "assistant_message",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
				assistantIndex: 0,
				text: "hello",
			}),
			outputEvent(9, {
				type: "message_finished",
				piboSessionId: "ps_root",
				eventId: "turn-projection",
			}),
		],
		status: "running",
	});

	assert.deepEqual(view.nodes.map((node) => node.type), ["user.message", "agent.turn"]);
	const turn = view.nodes[1];
	assert.equal(turn.id, "event:message:turn-projection");
	assert.equal(turn.status, "done");
	assert.equal(turn.completedAt, "2026-01-01T00:00:09.000Z");
	assert.deepEqual(turn.children.map((node) => node.type), ["model.reasoning", "assistant.message"]);
	assert.equal(turn.children[0].id, "event:thinking:turn-projection:thinking:0");
	assert.equal(turn.children[0].status, "done");
	assert.equal(turn.children[0].output, "plan answer");
	assert.equal(turn.children[1].id, "event:assistant:turn-projection:assistant:0");
	assert.equal(turn.children[1].status, "done");
	assert.equal(turn.children[1].output, "hello");
});

test("event-log projection merges tool lifecycle updates and compaction lifecycle", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [
			outputEvent(1, {
				type: "message_started",
				piboSessionId: "ps_root",
				eventId: "turn-tools",
				text: "run tool",
			}),
			outputEvent(2, {
				type: "tool_call",
				piboSessionId: "ps_root",
				eventId: "turn-tools",
				toolCallId: "tool-1",
				toolName: "bash",
				args: { command: "pwd" },
				argsComplete: true,
			}),
			outputEvent(3, {
				type: "tool_execution_started",
				piboSessionId: "ps_root",
				eventId: "turn-tools",
				toolCallId: "tool-1",
				toolName: "bash",
				args: { command: "pwd" },
			}),
			outputEvent(4, {
				type: "tool_execution_updated",
				piboSessionId: "ps_root",
				eventId: "turn-tools",
				toolCallId: "tool-1",
				toolName: "bash",
				args: { command: "pwd" },
				partialResult: "working",
			}),
			outputEvent(5, {
				type: "tool_execution_finished",
				piboSessionId: "ps_root",
				eventId: "turn-tools",
				toolCallId: "tool-1",
				toolName: "bash",
				result: { stderr: "boom" },
				isError: true,
			}),
			outputEvent(6, {
				type: "compaction_start",
				piboSessionId: "ps_root",
				reason: "manual",
			}),
			outputEvent(7, {
				type: "compaction_end",
				piboSessionId: "ps_root",
				reason: "manual",
				result: { removed: 2 },
				aborted: false,
			}),
		],
		status: "running",
	});

	assert.deepEqual(view.nodes.map((node) => node.type), ["agent.turn", "execution.compaction"]);
	const tool = view.nodes[0].children[0];
	assert.equal(tool.type, "tool.call");
	assert.equal(tool.id, "tool:tool-1");
	assert.equal(tool.status, "error");
	assert.deepEqual(tool.input, { command: "pwd" });
	assert.deepEqual(tool.output, { stderr: "boom" });
	assert.equal(tool.error, '{"stderr":"boom"}');
	assert.equal(tool.completedAt, "2026-01-01T00:00:05.000Z");

	const compaction = view.nodes[1];
	assert.equal(compaction.type, "execution.compaction");
	assert.equal(compaction.status, "done");
	assert.equal(compaction.summary, "Compacted");
	assert.deepEqual(compaction.output, { removed: 2 });
	assert.equal(compaction.completedAt, "2026-01-01T00:00:07.000Z");
});

test("idle Pi history keeps persisted tool intent metadata and sanitized arguments", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		transcriptEntries: [
			{
				id: "entry-user",
				type: "message",
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: [{ type: "text", text: "Read the file" }] },
			},
			{
				id: "entry-assistant",
				type: "message",
				timestamp: "2026-01-01T00:00:02.000Z",
				message: {
					role: "assistant",
					content: [{
						type: "toolCall",
						id: "tool-intent",
						name: "read",
						arguments: { i: "Reviewing project documentation", path: "README.md" },
					}],
				},
			},
			{
				id: "entry-result",
				type: "message",
				timestamp: "2026-01-01T00:00:03.000Z",
				message: { role: "toolResult", toolCallId: "tool-intent", toolName: "read", content: [{ type: "text", text: "ok" }] },
			},
		],
		events: [outputEvent(1, {
			type: "tool_execution_started",
			piboSessionId: "ps_root",
			toolCallId: "tool-intent",
			toolName: "read",
			args: { path: "README.md" },
			intent: "Reviewing project documentation",
		})],
		status: "idle",
	});

	const tool = view.nodes.flatMap((node) => [node, ...node.children]).find((node) => node.toolCallId === "tool-intent");
	assert.equal(tool?.intent, "Reviewing project documentation");
	assert.deepEqual(tool?.input, { path: "README.md" });
	assert.deepEqual(tool?.output, { content: [{ type: "text", text: "ok" }] });
});

test("v2 event mapper preserves session error details for trace rendering", () => {
	const event = storedPiboEventFromV2Row({
		stream_id: 42,
		session_id: "ps_root",
		session_sequence: 7,
		room_id: "room_1",
		topic: "pibo.output",
		type: "session_error",
		source: "actor",
		actor_type: "agent",
		actor_id: "agent",
		turn_id: "turn_1",
		event_id: "turn_1",
		tool_call_id: null,
		run_id: null,
		workflow_run_id: null,
		idempotency_key: "err_1",
		retention_class: "trace_event",
		payload_ref: null,
		preview_text: "WebSocket error",
		attributes_json: JSON.stringify({
			error: "WebSocket error",
			errorDetails: { provider: "openai-codex", model: "gpt-5.5" },
		}),
		created_at: now,
	});

	assert.equal(event.payload.type, "session_error");
	assert.equal(event.payload.error, "WebSocket error");
	assert.equal(event.payload.errorDetails.errorClass, "provider_transport");
	assert.equal(event.payload.errorDetails.code, "websocket_error");
	assert.equal(event.payload.errorDetails.provider, "openai-codex");
	assert.equal(event.payload.errorDetails.model, "gpt-5.5");

	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [event],
	});

	assert.equal(view.nodes[0].type, "error");
	assert.equal(view.nodes[0].title, "Session Error");
	assert.equal(view.nodes[0].error, "WebSocket error");
	assert.equal(view.nodes[0].input.errorClass, "provider_transport");
	assert.equal(view.nodes[0].input.code, "websocket_error");
});

test("trace version changes for transcript metadata", () => {
	const base = {
		session: session(),
		sessions: [session()],
		events: [storedEvent(1, "hello")],
		status: "idle",
		latestStreamId: 7,
	};
	const first = createTraceViewVersion({
		...base,
		metadata: { sessionPath: "/tmp/session.jsonl", sessionSize: 10, sessionMtimeMs: 100, modified: now },
	});
	const second = createTraceViewVersion({
		...base,
		metadata: { sessionPath: "/tmp/session.jsonl", sessionSize: 11, sessionMtimeMs: 100, modified: now },
	});

	assert.notEqual(first, second);
});

test("trace version changes when child or origin sessions change", () => {
	const root = session();
	const child = session({ id: "ps_child", piSessionId: "pi_child", parentId: "ps_root" });
	const fork = session({ id: "ps_fork", piSessionId: "pi_fork", originId: "ps_root" });
	const first = createTraceViewVersion({
		session: root,
		sessions: [root, child, fork],
		events: [],
		status: "idle",
	});
	const second = createTraceViewVersion({
		session: root,
		sessions: [root, { ...child, updatedAt: "2026-01-01T00:01:00.000Z" }, fork],
		events: [],
		status: "idle",
	});
	const third = createTraceViewVersion({
		session: root,
		sessions: [root, child, { ...fork, originId: "ps_child" }],
		events: [],
		status: "idle",
	});

	assert.notEqual(first, second);
	assert.notEqual(first, third);
});

test("event projection gives repeated compactions distinct stable keys", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [
			outputEvent(1, { type: "compaction_start", piboSessionId: "ps_root", reason: "auto" }),
			outputEvent(2, { type: "compaction_end", piboSessionId: "ps_root", reason: "auto", aborted: false }),
			outputEvent(3, { type: "compaction_start", piboSessionId: "ps_root", reason: "auto" }),
			outputEvent(4, { type: "compaction_end", piboSessionId: "ps_root", reason: "auto", aborted: false }),
		],
		status: "idle",
	});

	const compactions = view.nodes.filter((node) => node.type === "execution.compaction");
	assert.equal(compactions.length, 2);
	assert.deepEqual(compactions.map((node) => node.stableKey), ["compaction:sequence:1", "compaction:sequence:3"]);
	assert.equal(new Set(compactions.map((node) => node.stableKey)).size, 2);
});

test("event projection does not emit subagent:undefined identities for incomplete legacy events", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps_root", piSessionId: "pi_root", title: "Root" },
		events: [
			outputEvent(1, { type: "subagent_session", piboSessionId: "ps_root", toolName: "pibo_subagent_researcher", subagentName: "researcher" }),
			outputEvent(2, { type: "subagent_session", piboSessionId: "ps_root", toolName: "pibo_subagent_researcher", subagentName: "researcher" }),
		],
		status: "idle",
	});

	const delegations = view.nodes.filter((node) => node.type === "agent.delegation");
	assert.equal(delegations.length, 2);
	assert.deepEqual(delegations.map((node) => node.stableKey), ["subagent:event:sequence:1", "subagent:event:sequence:2"]);
	assert.equal(delegations.some((node) => node.stableKey === "subagent:undefined"), false);
});
