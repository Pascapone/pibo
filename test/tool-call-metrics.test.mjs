import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { storedPiboEventFromV2Row } from "../dist/apps/chat/data/chat-data-mappers.js";
import { traceTimelinePageFromView } from "../dist/apps/chat/trace-v2.js";
import { estimateToolPayloadTokens, ToolCallMetricsCollector } from "../dist/shared/tool-call-metrics.js";
import { RuntimeRoutedSession } from "../dist/agent-runtime/routed-session.js";
import { buildTraceViewFromEvents, patchTraceViewWithEvents } from "../dist/shared/trace-engine.js";
import { applyTraceLiveEvents } from "../dist/shared/trace-live-reducer.js";
import { buildCompactTerminalRows } from "../dist/session-ui/terminalRows.js";
import { chatStreamFramesFromOutputEvent, createChatStreamState } from "../dist/apps/chat/stream.js";

const metrics = { durationMs: 1234, inputTokens: 12, outputTokens: 23456, tokenBasis: "chars/4" };

test("estimates are cheap, bounded and honest about unavailable payloads", () => {
	assert.equal(estimateToolPayloadTokens(""), 0);
	assert.equal(estimateToolPayloadTokens("x".repeat(4_000_000)), 1_000_000);
	assert.equal(estimateToolPayloadTokens(undefined), undefined);
	assert.equal(estimateToolPayloadTokens([{ type: "image", data: "base64" }]), undefined);
	assert.equal(estimateToolPayloadTokens(Array(20_000).fill(1)), undefined);
	const cycle = {}; cycle.self = cycle;
	assert.equal(estimateToolPayloadTokens(cycle), undefined);
	let deep = {}; for (let i = 0; i < 100; i++) deep = { deep };
	assert.equal(estimateToolPayloadTokens(deep), undefined);
});

test("collector separates parallel calls, releases state, and excludes result metadata", () => {
	const collector = new ToolCallMetricsCollector();
	collector.start("a", "abcd", 10);
	collector.start("a", "ignored", 100);
	collector.start("b", "abcdefgh", 20);
	assert.deepEqual(collector.finish("a", { content: "abcdefgh", details: "x".repeat(10000) }, 1010), {
		durationMs: 1000, inputTokens: 1, outputTokens: 2, tokenBasis: "chars/4",
	});
	assert.equal(collector.finish("a", "", 2000).durationMs, undefined);
	assert.equal(collector.finish("b", "", 220).durationMs, 200);
	collector.start("c", "abcd", 0);
	collector.clear();
	assert.equal(collector.finish("c", "", 30).inputTokens, undefined);
});

test("generic runtime emits per-call diagnostics without using assistant usage", () => {
	let listener;
	const output = [];
	new RuntimeRoutedSession("ps_metrics", {
		getStatus: () => ({}),
		subscribe: (callback) => { listener = callback; return () => {}; },
	}, (event) => output.push(event), {});
	listener({ type: "tool_execution_started", toolCallId: "call", toolName: "bash", args: { command: "printf test" } });
	listener({ type: "usage", usage: { inputTokens: 999999, outputTokens: 99999, totalTokens: 1099998 } });
	listener({ type: "tool_execution_finished", toolCallId: "call", toolName: "bash", result: { content: "test" }, isError: true });
	const finish = output.find((event) => event.type === "tool_execution_finished");
	assert.equal(finish.isError, true);
	assert.ok(finish.toolMetrics.durationMs >= 0);
	assert.equal(finish.toolMetrics.inputTokens, estimateToolPayloadTokens({ command: "printf test" }));
	assert.equal(finish.toolMetrics.outputTokens, 1);
});

function events() {
	return [
		{ type: "tool_execution_started", toolCallId: "call", toolName: "read", args: { path: "one" } },
		{ type: "tool_execution_finished", toolCallId: "call", toolName: "read", result: "result", isError: false, toolMetrics: metrics },
	].map((event, index) => ({
		id: `stored-${index}`, eventSequence: index + 1, piboSessionId: "ps_metrics", type: event.type,
		createdAt: `2026-09-05T10:00:0${index}.000Z`,
		payload: { ...event, piboSessionId: "ps_metrics", eventId: "turn" },
	}));
}

function view(stored) {
	return buildTraceViewFromEvents({ session: { id: "ps_metrics", piSessionId: "pi_metrics" }, events: stored, status: "idle" });
}

test("metrics survive persistence serialization, live frames, patches and all display modes", () => {
	const stored = events();
	const replay = view(JSON.parse(JSON.stringify(stored)));
	const patched = patchTraceViewWithEvents(view(stored.slice(0, 1)), stored.slice(1), "idle");
	const state = createChatStreamState();
	const streamEvents = stored.flatMap((event) => chatStreamFramesFromOutputEvent(event.payload, state));
	let sequence = 0;
	const live = view(applyTraceLiveEvents({ currentEvents: [], streamEvents, piboSessionId: "ps_metrics", nextSequence: () => ++sequence, now: () => "2026-09-05T10:00:00.000Z" }));
	for (const trace of [replay, patched, live]) {
		for (const mode of ["default", "slim", "intent"]) {
			for (const node of trace.nodes.flatMap((node) => [node, ...node.children])) if (node.toolCallId) node.intent = "Read one file";
			const rows = buildCompactTerminalRows(trace, { showThinking: false, debugMode: true, toolDisplayMode: mode });
			const tool = rows.find((row) => row.isToolCall);
			assert.deepEqual(tool?.toolMetrics, metrics, mode);
		}
		assert.equal(buildCompactTerminalRows(trace, { showThinking: false, debugMode: true, toolDisplayMode: "hide" }).filter((row) => row.isToolCall).length, 0);
	}
});

test("durable ingestion retains metrics outside large payloads through restart and timeline compaction", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-tool-metrics-"));
	const path = join(root, "pibo.sqlite");
	const options = { payloadRootDir: join(root, "payloads") };
	let store = new PiboDataStore(path, options);
	try {
		const session = { id: "ps_metrics", piSessionId: "pi_metrics", channel: "test", kind: "chat", profile: "base", createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z" };
		const ingest = new ChatDataIngestService(store);
		const stored = events();
		stored[1].payload.result = "x".repeat(100_000);
		for (const event of stored) ingest.ingestOutputEvent({ session, roomId: "room_metrics", event: event.payload, createdAt: event.createdAt });
		store.close();
		store = new PiboDataStore(path, options);
		const reloaded = store.db.prepare("SELECT * FROM event_log WHERE session_id = ? ORDER BY stream_id").all(session.id);
		assert.ok(reloaded[1].payload_ref, "large output is stored separately");
		const trace = view(reloaded.map((row) => storedPiboEventFromV2Row(row, store.payloads)));
		const tool = buildCompactTerminalRows(trace, { showThinking: false, debugMode: true }).find((row) => row.isToolCall);
		assert.deepEqual(tool.toolMetrics, metrics);
		const page = traceTimelinePageFromView({ trace, payloadStore: store.payloads, limit: 50 });
		assert.deepEqual(page.nodes.find((node) => node.toolCallId).toolMetrics, metrics);
	} finally {
		store.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("debug ungroups exploration so every invocation has its own metrics; legacy stays unavailable", () => {
	const trace = { piboSessionId: "ps_metrics", nodes: [1, 2].map((i) => ({
		id: `tool-${i}`, toolCallId: `call-${i}`, type: "tool.call", title: "read", status: "done",
		input: { path: `file-${i}` }, output: "text", children: [], toolMetrics: i === 1 ? metrics : undefined,
	})), rawEvents: [] };
	assert.equal(buildCompactTerminalRows(trace, { showThinking: false }).length, 1);
	const rows = buildCompactTerminalRows(trace, { showThinking: false, debugMode: true });
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0].toolMetrics, metrics);
	assert.equal(rows[1].toolMetrics, undefined);
});

test("status strip renders estimated tokens, zero, missing values and subsecond duration", () => {
	execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
		import assert from 'node:assert/strict';
		import React from 'react';
		import { renderToStaticMarkup } from 'react-dom/server';
		import { TerminalToolMetrics } from './src/apps/chat-ui/src/session-views/compact-terminal/TerminalToolMetrics.tsx';
		import { traceViewFromTimelinePage } from './src/apps/chat-ui/src/tracing/trace-v2-adapter.ts';
		globalThis.React = React;
		const render = (metrics) => renderToStaticMarkup(React.createElement(TerminalToolMetrics, { metrics }));
		const markup = render({ durationMs: 42, inputTokens: 0, outputTokens: 23456, tokenBasis: 'chars/4' });
		assert.match(markup, /Time 42 ms/);
		assert.match(markup, /In ≈0/);
		assert.match(markup, /Out ≈23,456 tokens/);
		assert.match(render(), /Time —/);
		assert.match(render(), /Out — tokens/);
		assert.match(render({ durationMs: 1234 }), /Time 1.2 s/);
		const metrics = ${JSON.stringify(metrics)};
		const view = traceViewFromTimelinePage({ nodes: [{ nodeId: 'tool', type: 'tool.call', toolMetrics: metrics }], cursor: {} });
		assert.deepEqual(view.nodes[0].toolMetrics, metrics);
	`], { cwd: process.cwd(), stdio: "pipe" });
});
