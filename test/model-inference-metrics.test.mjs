import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { chatStreamFramesFromOutputEvent, createChatStreamState } from "../dist/apps/chat/stream.js";
import { traceTimelinePageFromView } from "../dist/apps/chat/trace-v2.js";
import { buildCompactTerminalRows } from "../dist/session-ui/terminalRows.js";
import { modelInferenceCachedInputTokens, modelInferenceInputTokens, modelInferenceUncachedInputTokens } from "../dist/shared/model-inference-metrics.js";
import { buildTraceViewFromEvents, patchTraceViewWithEvents } from "../dist/shared/trace-engine.js";
import { applyTraceLiveEvents } from "../dist/shared/trace-live-reducer.js";

const metrics = {
	inputTokens: 2_397,
	outputTokens: 300,
	cacheReadTokens: 91_776,
	cacheWriteTokens: 24,
	reasoningTokens: 100,
	totalTokens: 94_497,
};

function events() {
	return [
		{ type: "message_started", text: "Inspect usage", source: "user" },
		{ type: "assistant_message", assistantIndex: 0, text: "Done" },
		{ type: "assistant_usage", usageIndex: 0, ...metrics },
		{ type: "message_finished", source: "user" },
	].map((event, index) => ({
		id: `stored-${index}`,
		eventSequence: index + 1,
		piboSessionId: "ps_model_metrics",
		type: event.type,
		createdAt: `2026-09-08T05:00:0${index}.000Z`,
		payload: { ...event, piboSessionId: "ps_model_metrics", eventId: "turn" },
	}));
}

function view(stored) {
	return buildTraceViewFromEvents({
		session: { id: "ps_model_metrics", piSessionId: "pi_model_metrics" },
		events: stored,
		status: "idle",
	});
}

function flatten(nodes) {
	return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

test("provider usage becomes a durable per-inference trace node across replay, patches, live frames and timeline compaction", () => {
	const stored = events();
	const replay = view(JSON.parse(JSON.stringify(stored)));
	const patched = patchTraceViewWithEvents(view(stored.slice(0, 2)), stored.slice(2), "idle");
	const streamState = createChatStreamState();
	const streamEvents = stored.flatMap((event) => chatStreamFramesFromOutputEvent(event.payload, streamState));
	let sequence = 0;
	const live = view(applyTraceLiveEvents({
		currentEvents: [],
		streamEvents,
		piboSessionId: "ps_model_metrics",
		nextSequence: () => ++sequence,
		now: () => "2026-09-08T05:00:00.000Z",
	}));

	for (const trace of [replay, patched, live]) {
		const owner = flatten(trace.nodes).find((node) => node.modelInferences?.length);
		assert.equal(owner?.modelInferences?.[0]?.id, "turn:usage:0");
		assert.deepEqual(owner?.modelInferences?.[0]?.metrics, metrics);
		assert.equal(typeof owner?.modelInferences?.[0]?.completedAt, "string");
		const rows = buildCompactTerminalRows(trace, { showThinking: false, debugMode: true });
		assert.deepEqual(rows.find((row) => row.kind === "message.assistant")?.modelInferences, owner?.modelInferences);
	}

	const timeline = traceTimelinePageFromView({ trace: replay, payloadStore: { writePayload() { throw new Error("unexpected payload write"); } }, limit: 50 });
	assert.deepEqual(timeline.nodes.find((node) => node.modelInferences?.length)?.modelInferences, [{ id: "turn:usage:0", completedAt: "2026-09-08T05:00:02.000Z", metrics }]);
});

test("usage attaches to the Tool or message span that completed the endpoint response", () => {
	const toolEvents = [
		{ type: "message_started", text: "Read", source: "user" },
		{ type: "tool_execution_started", toolCallId: "call", toolName: "read", args: { path: "README.md" } },
		{ type: "tool_execution_finished", toolCallId: "call", toolName: "read", result: "text", isError: false },
		{ type: "assistant_usage", usageIndex: 0, ...metrics },
		{ type: "message_finished", source: "user" },
	].map((event, index) => ({
		id: `tool-stored-${index}`,
		eventSequence: index + 1,
		piboSessionId: "ps_tool_usage",
		type: event.type,
		createdAt: `2026-09-08T05:10:0${index}.000Z`,
		payload: { ...event, piboSessionId: "ps_tool_usage", eventId: "tool-turn" },
	}));
	const toolTrace = buildTraceViewFromEvents({ session: { id: "ps_tool_usage", piSessionId: "pi_tool_usage" }, events: toolEvents, status: "idle" });
	const toolNode = flatten(toolTrace.nodes).find((node) => node.toolCallId === "call");
	assert.deepEqual(toolNode?.modelInferences?.[0]?.metrics, metrics);
	assert.deepEqual(buildCompactTerminalRows(toolTrace, { showThinking: false, debugMode: true }).find((row) => row.isToolCall)?.modelInferences, toolNode?.modelInferences);

	const legacyOrder = events();
	[legacyOrder[1], legacyOrder[2]] = [legacyOrder[2], legacyOrder[1]];
	legacyOrder.forEach((event, index) => { event.eventSequence = index + 1; });
	const legacyRows = buildCompactTerminalRows(view(legacyOrder), { showThinking: false, debugMode: true });
	assert.deepEqual(legacyRows.find((row) => row.kind === "message.assistant")?.modelInferences?.[0]?.metrics, metrics);
});

test("replay assigns each inference to the output that existed when usage was reported", () => {
	const toolMetrics = { durationMs: 7, inputTokens: 5, outputTokens: 13, tokenBasis: "characters/4" };
	const replayEvents = [
		{ type: "message_started", text: "Read", source: "user" },
		{ type: "tool_call", toolCallId: "call", toolName: "read", args: { path: "/etc/issue" }, argsComplete: true },
		{ type: "assistant_usage", usageIndex: 0, ...metrics },
		{ type: "tool_execution_started", toolCallId: "call", toolName: "read", args: { path: "/etc/issue" } },
		{ type: "tool_execution_finished", toolCallId: "call", toolName: "read", result: "Ubuntu", isError: false, toolMetrics },
		{ type: "assistant_message", assistantIndex: 0, text: "Done" },
		{ type: "assistant_usage", usageIndex: 1, ...metrics },
		{ type: "message_finished", source: "user" },
	].map((event, index) => ({
		id: `replay-stored-${index}`,
		eventSequence: index + 1,
		piboSessionId: "ps_replay_usage",
		type: event.type,
		createdAt: `2026-09-08T05:20:0${index}.000Z`,
		payload: { ...event, piboSessionId: "ps_replay_usage", eventId: "replay-turn" },
	}));
	const replay = buildTraceViewFromEvents({
		session: { id: "ps_replay_usage", piSessionId: "pi_replay_usage" },
		events: replayEvents,
		historyEntries: [{
			id: "product-assistant",
			type: "message",
			source: "product",
			createdAt: "2026-09-08T05:20:05.000Z",
			sequence: 6,
			turnId: "replay-turn",
			role: "assistant",
			content: "Done",
			assistantIndex: 0,
			status: "complete",
		}],
		status: "idle",
	});
	const nodes = flatten(replay.nodes);
	const tool = nodes.find((node) => node.toolCallId === "call");
	const assistant = nodes.find((node) => node.type === "assistant.message");
	assert.deepEqual(tool?.toolMetrics, toolMetrics);
	assert.deepEqual(tool?.modelInferences?.map((record) => record.id), ["replay-turn:usage:0"]);
	assert.deepEqual(assistant?.modelInferences?.map((record) => record.id), ["replay-turn:usage:1"]);
	const rows = buildCompactTerminalRows(replay, { showThinking: false, debugMode: true });
	assert.deepEqual(rows.find((row) => row.isToolCall)?.toolMetrics, toolMetrics);
	assert.deepEqual(rows.find((row) => row.isToolCall)?.modelInferences, tool?.modelInferences);
	assert.deepEqual(rows.find((row) => row.kind === "message.assistant")?.modelInferences, assistant?.modelInferences);
});

test("model and Tool diagnostics can be enabled independently under the global Debug mode", () => {
	const trace = {
		piboSessionId: "ps_features",
		nodes: [
			...([1, 2].map((index) => ({
				id: `tool-${index}`,
				toolCallId: `call-${index}`,
				type: "tool.call",
				title: "read",
				status: "done",
				input: { path: `file-${index}` },
				output: "text",
				children: [],
			}))),
			{
				id: "assistant",
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				output: "Done",
				modelInferences: [{ id: "usage-0", metrics }],
				children: [],
			},
		],
		rawEvents: [],
	};

	const modelOnly = buildCompactTerminalRows(trace, {
		showThinking: false,
		debugMode: true,
		debugFeatures: { toolMetrics: false, modelInferenceMetrics: true },
	});
	assert.equal(modelOnly.filter((row) => row.kind.startsWith("tool.")).length, 1, "Tool rows remain grouped when Tool metrics are disabled");
	assert.deepEqual(modelOnly.find((row) => row.kind === "message.assistant")?.modelInferences, [{ id: "usage-0", metrics }]);

	const toolsOnly = buildCompactTerminalRows(trace, {
		showThinking: false,
		debugMode: true,
		debugFeatures: { toolMetrics: true, modelInferenceMetrics: false },
	});
	assert.equal(toolsOnly.filter((row) => row.kind.startsWith("tool.")).length, 2, "Tool metrics keep invocations separate");
	assert.deepEqual(toolsOnly.find((row) => row.kind === "message.assistant")?.modelInferences, [{ id: "usage-0", metrics }]);
});

test("inference metrics distinguish total input, cache hits, fresh input and output", () => {
	assert.equal(modelInferenceInputTokens(metrics), 94_197);
	assert.equal(modelInferenceCachedInputTokens(metrics), 91_776);
	assert.equal(modelInferenceUncachedInputTokens(metrics), 2_421);
	assert.equal(modelInferenceUncachedInputTokens({ totalTokens: 20000, outputTokens: 0 }), undefined);
	execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
		import assert from "node:assert/strict";
		import React from "react";
		import { renderToStaticMarkup } from "react-dom/server";
		import { TerminalModelInferenceMetrics } from "./src/apps/chat-ui/src/session-views/compact-terminal/TerminalModelInferenceMetrics.tsx";
		globalThis.React = React;
		const markup = renderToStaticMarkup(React.createElement(TerminalModelInferenceMetrics, { metrics: ${JSON.stringify(metrics)} }));
		assert.match(markup, /aria-label="Model inference metrics"/);
		assert.match(markup, />Model</);
		assert.match(markup, />In</);
		assert.match(markup, />94,197</);
		assert.match(markup, />Cached</);
		assert.match(markup, />91,776</);
		assert.match(markup, />Uncached</);
		assert.match(markup, />2,421</);
		assert.match(markup, />Out</);
		assert.match(markup, />300</);
	`], { cwd: process.cwd(), stdio: "pipe" });
});

test("cache collapse comparison survives trace replay and incremental reconstruction without duplicate tool costs", () => {
	const scenario = [
		{ type: "message_started", text: "First", source: "user", eventId: "one" },
		{ type: "assistant_message", text: "Warm", assistantIndex: 0, eventId: "one" },
		{ type: "assistant_usage", usageIndex: 0, eventId: "one", totalTokens: 154514, outputTokens: 259, inputTokens: 154255, cacheReadTokens: 150272 },
		{ type: "message_started", text: "Continue", source: "user", eventId: "two" },
		{ type: "tool_call", toolCallId: "a", toolName: "read", args: {}, argsComplete: true, eventId: "two" },
		{ type: "tool_call", toolCallId: "b", toolName: "read", args: {}, argsComplete: true, eventId: "two" },
		{ type: "assistant_usage", usageIndex: 0, eventId: "two", totalTokens: 154514, outputTokens: 259, inputTokens: 154255, cacheReadTokens: 3712 },
		{ type: "assistant_message", text: "Finished", assistantIndex: 0, eventId: "two" },
		{ type: "assistant_usage", usageIndex: 1, eventId: "two", totalTokens: 156210, outputTokens: 273, inputTokens: 155937, cacheReadTokens: 153984 },
		// A delayed repeat must not move the Tool inference onto the Endturn.
		{ type: "assistant_usage", usageIndex: 0, eventId: "two", totalTokens: 154514, outputTokens: 259, inputTokens: 154255, cacheReadTokens: 3712 },
	].map((event, index) => ({ id: `cache-${index}`, eventSequence: index + 1, piboSessionId: "ps_model_metrics", type: event.type, createdAt: new Date(1788840000000 + index * 1000).toISOString(), payload: { ...event, piboSessionId: "ps_model_metrics" } }));
	for (const trace of [view(scenario), patchTraceViewWithEvents(view(scenario.slice(0, 6)), scenario.slice(6), "idle")]) {
		const records = flatten(trace.nodes).flatMap(node => node.modelInferences ?? []);
		assert.equal(records.length, 3);
		const cold = records.find(record => record.id === "two:usage:0");
		assert.equal(cold.cacheObservation.warning, "possible-cache-collapse");
		assert.equal(cold.cacheObservation.uncachedTokens, 150543);
		assert.equal(cold.cacheObservation.previousInferenceId, "one:usage:0");
		assert.equal(flatten(trace.nodes).find(node => node.modelInferences?.some(record => record.id === cold.id)).type, "tool.call");
		assert.equal(records.find(record => record.id === "two:usage:1").cacheObservation.warning, "none");
	}
});

test("cache comparison observes compaction boundaries during replay", () => {
	const scenario = [
		{ type: "message_started", text: "First", source: "user" },
		{ type: "assistant_message", text: "Warm", assistantIndex: 0 },
		{ type: "assistant_usage", usageIndex: 0, totalTokens: 20100, outputTokens: 100, cacheReadTokens: 18000 },
		{ type: "compaction_start", reason: "manual", compactionIndex: 0 },
		{ type: "compaction_end", reason: "manual", compactionIndex: 0, result: { summary: "Summary" } },
		{ type: "assistant_message", text: "New context", assistantIndex: 1 },
		{ type: "assistant_usage", usageIndex: 1, totalTokens: 20100, outputTokens: 100, cacheReadTokens: 0 },
	].map((event, index) => ({ id: `compact-${index}`, eventSequence: index + 1, piboSessionId: "ps_model_metrics", type: event.type, createdAt: new Date(1788840000000 + index * 1000).toISOString(), payload: { ...event, piboSessionId: "ps_model_metrics", eventId: "turn" } }));
	const record = flatten(view(scenario).nodes).flatMap(node => node.modelInferences ?? []).find(record => record.id === "turn:usage:1");
	assert.equal(record.cacheObservation.warning, "none");
	assert.deepEqual(record.cacheObservation.causes, ["expected-epoch-change"]);
});
