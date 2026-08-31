import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { OutputRenderSequencer } from "../dist/core/output-render-sequence.js";
import { buildTraceViewFromEvents, traceNodesFromHistoryEntries } from "../dist/shared/trace-engine.js";
import { buildCompactTerminalRows } from "../dist/session-ui/terminalRows.js";
import { mergeOlderTracePage, mergeRefreshedTracePage } from "../dist/shared/trace-page-merge.js";
import { parseTraceToolNodeIdentity } from "../dist/shared/trace-tool-identity.js";

const execFileAsync = promisify(execFile);

function storedEvent(eventSequence, payload, overrides = {}) {
	return {
		id: overrides.id ?? `event-${eventSequence}`,
		piboSessionId: payload.piboSessionId,
		eventSequence,
		renderSequence: payload.renderSequence,
		type: payload.type,
		createdAt: overrides.createdAt ?? "2026-08-29T12:00:00.000Z",
		payload,
		...overrides,
	};
}

function traceView(overrides = {}) {
	return {
		piboSessionId: "ps-order",
		piSessionId: "pi-order",
		title: "Order",
		version: "v1",
		eventCount: 0,
		nodes: [],
		rawEvents: [],
		...overrides,
	};
}

test("reused toolCallId stays distinct across turns and matches history plus Terminal identity", () => {
	const piboSessionId = "ps-reused-tool";
	const sequencer = new OutputRenderSequencer(() => 1_000);
	const position = (event) => sequencer.position({ piboSessionId, ...event });
	const livePayloads = [
		position({ type: "message_started", eventId: "turn-one", text: "one", source: "user" }),
		position({ type: "tool_call", eventId: "turn-one", toolCallId: "reused", toolName: "read", args: { path: "one" }, argsComplete: true }),
		position({ type: "tool_execution_started", eventId: "turn-one", toolCallId: "reused", toolName: "read", args: { path: "one" } }),
		position({ type: "tool_execution_updated", eventId: "turn-one", toolCallId: "reused", toolName: "read", args: { path: "one" }, partialResult: "o" }),
		position({ type: "tool_execution_finished", eventId: "turn-one", toolCallId: "reused", toolName: "read", result: "one", isError: false }),
		position({ type: "message_finished", eventId: "turn-one", source: "user" }),
		position({ type: "message_started", eventId: "turn-two", text: "two", source: "user" }),
		position({ type: "tool_call", eventId: "turn-two", toolCallId: "reused", toolName: "read", args: { path: "two" }, argsComplete: true }),
		position({ type: "tool_execution_started", eventId: "turn-two", toolCallId: "reused", toolName: "read", args: { path: "two" } }),
		position({ type: "tool_execution_updated", eventId: "turn-two", toolCallId: "reused", toolName: "read", args: { path: "two" }, partialResult: "t" }),
		position({ type: "tool_execution_finished", eventId: "turn-two", toolCallId: "reused", toolName: "read", result: "two", isError: false }),
		position({ type: "message_finished", eventId: "turn-two", source: "user" }),
	];
	const live = buildTraceViewFromEvents({
		session: { id: piboSessionId, piSessionId: "pi-reused", title: "Reused" },
		events: livePayloads.map((payload, index) => storedEvent(index + 1, payload)),
	});
	const liveTools = live.nodes.flatMap((node) => [node, ...node.children]).filter((node) => node.type === "tool.call");
	assert.equal(liveTools.length, 2);
	assert.deepEqual(liveTools.map((node) => node.parentId), ["event:message:turn-one", "event:message:turn-two"]);
	assert.deepEqual(liveTools.map((node) => node.output), ["one", "two"]);
	assert.deepEqual(liveTools.map((node) => parseTraceToolNodeIdentity(node.id)?.qualifier), [
		{ eventId: "turn-one", invocationOrdinal: 0 },
		{ eventId: "turn-two", invocationOrdinal: 0 },
	]);

	const historyEntries = [
		{ id: "u1", type: "message", source: "product", createdAt: "2026-08-29T12:00:01.000Z", turnId: "turn-one", role: "user", content: "one" },
		{ id: "a1", type: "message", source: "product", createdAt: "2026-08-29T12:00:02.000Z", turnId: "turn-one", role: "assistant", content: [{ type: "tool_call", toolCallId: "reused", toolName: "read", input: { path: "one" } }], status: "complete" },
		{ id: "r1", type: "message", source: "product", createdAt: "2026-08-29T12:00:03.000Z", turnId: "turn-one", role: "tool", toolCallId: "reused", toolName: "read", result: "one", content: "one", status: "complete" },
		{ id: "u2", type: "message", source: "product", createdAt: "2026-08-29T12:00:04.000Z", turnId: "turn-two", role: "user", content: "two" },
		{ id: "a2", type: "message", source: "product", createdAt: "2026-08-29T12:00:05.000Z", turnId: "turn-two", role: "assistant", content: [{ type: "tool_call", toolCallId: "reused", toolName: "read", input: { path: "two" } }], status: "complete" },
		{ id: "r2", type: "message", source: "product", createdAt: "2026-08-29T12:00:06.000Z", turnId: "turn-two", role: "tool", toolCallId: "reused", toolName: "read", result: "two", content: "two", status: "complete" },
	];
	const historyNodes = traceNodesFromHistoryEntries(piboSessionId, historyEntries, [
		{ eventId: "turn-one", userText: "one" },
		{ eventId: "turn-two", userText: "two" },
	]);
	const historyTools = historyNodes.flatMap((node) => [node, ...node.children]).filter((node) => node.type === "tool.call");
	assert.deepEqual(historyTools.map((node) => node.id), liveTools.map((node) => node.id));
	const terminalTools = buildCompactTerminalRows({ ...live, nodes: historyNodes }, { showThinking: true }).filter((row) => row.kind === "tool.call");
	assert.equal(terminalTools.length, 2);
	assert.deepEqual(terminalTools.map((row) => row.id), liveTools.map((node) => `terminal:${node.id}`));
});

test("same-turn reused toolCallId receives monotonic invocation ordinals", () => {
	const sequencer = new OutputRenderSequencer(() => 2_000);
	const base = { piboSessionId: "ps-ordinal", eventId: "turn-ordinal", toolCallId: "same", toolName: "read" };
	const first = sequencer.position({ ...base, type: "tool_call", args: {}, argsComplete: true });
	const firstDone = sequencer.position({ ...base, type: "tool_execution_finished", result: "one", isError: false });
	const second = sequencer.position({ ...base, type: "tool_call", args: {}, argsComplete: true });
	const secondDone = sequencer.position({ ...base, type: "tool_execution_finished", result: "two", isError: false });
	assert.deepEqual([first.toolInvocationOrdinal, firstDone.toolInvocationOrdinal, second.toolInvocationOrdinal, secondDone.toolInvocationOrdinal], [0, 0, 1, 1]);
	assert.notEqual(first.renderSequence, second.renderSequence);
});

test("streamed tool arguments retain one tool invocation identity", () => {
	const sequencer = new OutputRenderSequencer(() => 2_500);
	const base = { piboSessionId: "ps-streamed-tool", eventId: "turn-streamed-tool", toolCallId: "streamed", toolName: "bash" };
	const payloads = [
		sequencer.position({ ...base, type: "tool_call", args: { command: "echo" }, argsComplete: false }),
		sequencer.position({ ...base, type: "tool_call", args: { command: "echo complete" }, argsComplete: true }),
		sequencer.position({ ...base, type: "tool_execution_started", args: { command: "echo complete" } }),
		sequencer.position({ ...base, type: "tool_execution_finished", result: "complete", isError: false }),
	];
	assert.deepEqual(payloads.map((event) => event.toolInvocationOrdinal), [0, 0, 0, 0]);
	assert.equal(new Set(payloads.map((event) => event.renderSequence)).size, 1);
	const view = buildTraceViewFromEvents({
		session: { id: base.piboSessionId, piSessionId: "pi-streamed-tool" },
		events: payloads.map((payload, index) => storedEvent(index + 1, payload)),
	});
	const tools = view.nodes.flatMap((node) => [node, ...node.children]).filter((node) => node.type === "tool.call");
	assert.equal(tools.length, 1);
	assert.deepEqual(tools[0].input, { command: "echo complete" });
	assert.equal(tools[0].output, "complete");
});

test("fallback node identities do not collide after long shared prefixes", () => {
	const common = "x".repeat(512);
	const view = buildTraceViewFromEvents({
		session: { id: "ps-fallback", piSessionId: "pi-fallback", title: "Fallback" },
		events: [
			storedEvent(1, { type: "execution_result", piboSessionId: "ps-fallback", action: common + "A", result: { ok: true } }),
			storedEvent(2, { type: "execution_result", piboSessionId: "ps-fallback", action: common + "B", result: { ok: true } }),
		],
	});
	assert.equal(view.nodes.length, 2);
	assert.equal(new Set(view.nodes.map((node) => node.id)).size, 2);
});

test("overlapping unsorted raw-event pages merge into one deterministic total order", () => {
	const canonical = Array.from({ length: 24 }, (_, index) => ({
		id: `raw-${index + 1}`,
		piboSessionId: "ps-order",
		eventSequence: index + 1,
		type: index % 2 ? "tool_execution_updated" : "assistant_delta",
		createdAt: index % 3 === 0 ? "" : "2026-08-29T12:00:00.000Z",
		payload: { index },
	}));
	const shuffle = (values, seed) => {
		const copy = [...values];
		let state = seed;
		for (let index = copy.length - 1; index > 0; index -= 1) {
			state = (state * 1664525 + 1013904223) >>> 0;
			const swap = state % (index + 1);
			[copy[index], copy[swap]] = [copy[swap], copy[index]];
		}
		return copy;
	};
	for (let seed = 1; seed <= 40; seed += 1) {
		const older = traceView({ rawEvents: shuffle(canonical.slice(0, 16), seed) });
		const current = traceView({ rawEvents: shuffle(canonical.slice(8), seed + 100) });
		const mergedOlder = mergeOlderTracePage(current, older);
		assert.deepEqual(mergedOlder.rawEvents.map((event) => event.id), canonical.map((event) => event.id));
		const refreshed = traceView({ rawEvents: shuffle(canonical.slice(12), seed + 200) });
		const mergedRefreshed = mergeRefreshedTracePage(mergedOlder, refreshed);
		assert.deepEqual(mergedRefreshed.rawEvents.map((event) => event.id), canonical.map((event) => event.id));
	}
});

test("live overlay confirmation qualifies reused toolCallId by event and ordinal", async () => {
	const script = `
		import assert from "node:assert/strict";
		const { trimLiveOverlayForBaseTrace } = await import("./src/apps/chat-ui/src/tracing/live-overlay.ts");
		const { qualifiedToolNodeId } = await import("./src/shared/trace-tool-identity.ts");
		const node = {
			id: qualifiedToolNodeId("same", "turn-one", 0), stableKey: qualifiedToolNodeId("same", "turn-one", 0),
			piboSessionId: "ps-overlay", eventId: "turn-one", toolCallId: "same", toolInvocationOrdinal: 0,
			type: "tool.call", title: "read", status: "done", completedAt: "2026-08-29T12:00:01.000Z", children: [],
		};
		const live = {
			id: "live-turn-two", piboSessionId: "ps-overlay", eventSequence: 2, type: "tool_execution_finished",
			createdAt: "2026-08-29T12:00:02.000Z",
			payload: { type: "tool_execution_finished", piboSessionId: "ps-overlay", eventId: "turn-two", toolCallId: "same", toolInvocationOrdinal: 0, toolName: "read", result: "two", isError: false },
		};
		const base = { piboSessionId: "ps-overlay", nodes: [node], rawEvents: [] };
		assert.deepEqual(trimLiveOverlayForBaseTrace({ piboSessionId: "ps-overlay", events: [live] }, base)?.events, [live]);
		const confirmed = { ...base, nodes: [node, { ...node, id: qualifiedToolNodeId("same", "turn-two", 0), stableKey: qualifiedToolNodeId("same", "turn-two", 0), eventId: "turn-two" }] };
		assert.equal(trimLiveOverlayForBaseTrace({ piboSessionId: "ps-overlay", events: [live] }, confirmed), null);

		const { computeCurrentTraceView } = await import("./src/apps/chat-ui/src/tracing/current-trace-view.ts");
		const emptyBase = { piboSessionId: "ps-overlay", nodes: [], rawEvents: [] };
		const assistant = {
			id: "assistant-one", piboSessionId: "ps-overlay", eventSequence: 1, type: "assistant_delta",
			createdAt: "2026-08-29T12:00:00.000Z",
			payload: { type: "assistant_delta", piboSessionId: "ps-overlay", eventId: "turn-live", assistantIndex: 0, text: "hello" },
		};
		const first = computeCurrentTraceView({ selectedPiboSessionId: "ps-overlay", reconciledBaseTraceView: emptyBase, liveTraceOverlay: { piboSessionId: "ps-overlay", events: [assistant] }, selectedSessionStatus: "running", persistedUserMessageIndexForBaseTrace: new Map() });
		const assistantNode = first.traceView.nodes.find((candidate) => candidate.type === "assistant.message");
		const tool = { ...live, id: "tool-one", payload: { ...live.payload, eventId: "turn-live", toolCallId: "other" } };
		const second = computeCurrentTraceView({ selectedPiboSessionId: "ps-overlay", reconciledBaseTraceView: emptyBase, liveTraceOverlay: { piboSessionId: "ps-overlay", events: [assistant, tool] }, selectedSessionStatus: "running", persistedUserMessageIndexForBaseTrace: new Map(), previousProjection: first.projectionCache });
		assert.equal(second.appliedLiveEventCount, 1);
		assert.equal(second.traceView.nodes.find((candidate) => candidate.type === "assistant.message"), assistantNode);
	`;
	await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], { cwd: process.cwd() });
});
