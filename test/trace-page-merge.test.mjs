import assert from "node:assert/strict";
import test from "node:test";
import { checkTraceView } from "../dist/debug/trace.js";
import { mergeOlderTracePage, mergeRefreshedTracePage } from "../dist/shared/trace-page-merge.js";

test("mergeOlderTracePage dedupes overlapping nested timeline nodes", () => {
	const current = traceView({
		nodes: [
			node("turn-1", {
				type: "agent.turn",
				children: [
					node("assistant-1", {
						parentId: "turn-1",
						type: "assistant.message",
						output: "current assistant text",
					}),
					node("tool-2", {
						parentId: "turn-1",
						type: "tool.call",
						title: "bash",
					}),
				],
			}),
		],
		nextBeforeSequence: 100,
	});
	const older = traceView({
		nodes: [
			node("assistant-1", {
				parentId: "turn-1",
				type: "assistant.message",
				output: "older duplicate assistant text",
			}),
			node("turn-1", {
				type: "agent.turn",
				children: [
					node("tool-1", {
						parentId: "turn-1",
						type: "tool.call",
						title: "read",
					}),
					node("assistant-1", {
						parentId: "turn-1",
						type: "assistant.message",
						output: "older duplicate assistant text",
					}),
				],
			}),
		],
		nextBeforeSequence: 50,
	});

	const merged = mergeOlderTracePage(current, older);
	const flat = flattenNodes(merged.nodes);
	const ids = flat.map((entry) => entry.id);

	assert.equal(ids.filter((id) => id === "assistant-1").length, 1);
	assert.deepEqual(new Set(ids), new Set(["turn-1", "tool-1", "assistant-1", "tool-2"]));
	assert.equal(flat.find((entry) => entry.id === "assistant-1")?.output, "current assistant text");
	assert.equal(merged.nextBeforeSequence, 50);
	assert.equal(merged.hasOlderEvents, true);
});

test("mergeRefreshedTracePage preserves the loaded history window while refreshing the tail", () => {
	const current = traceView({
		version: "old-version",
		nodes: [
			node("older-only", { startedAt: "2026-07-05T00:00:00.000Z" }),
			node("shared", { title: "old shared", startedAt: "2026-07-05T00:01:00.000Z" }),
		],
		firstEventSequence: 10,
		nextBeforeSequence: 9,
		hasOlderEvents: true,
		eventLimit: 100,
	});
	const refreshed = traceView({
		version: "new-version",
		nodes: [
			node("shared", { title: "new shared", startedAt: "2026-07-05T00:01:00.000Z" }),
			node("new-tail", { startedAt: "2026-07-05T00:02:00.000Z" }),
		],
		firstEventSequence: 50,
		nextBeforeSequence: 49,
		hasOlderEvents: true,
		eventLimit: 50,
	});

	const merged = mergeRefreshedTracePage(current, refreshed);
	assert.equal(merged.version, "new-version");
	assert.deepEqual(merged.nodes.map((entry) => entry.id), ["older-only", "shared", "new-tail"]);
	assert.equal(merged.nodes.find((entry) => entry.id === "shared")?.title, "new shared");
	assert.equal(merged.firstEventSequence, 10);
	assert.equal(merged.nextBeforeSequence, 9);
	assert.equal(merged.eventLimit, 100);
});

test("mergeRefreshedTracePage keeps render positions stable across live to history source handoff", () => {
	const current = traceView({
		nodes: [
			node("first", { source: "live", startedAt: undefined, orderKey: { ...liveOrder(90), renderSequence: 10 } }),
			node("second", { source: "live", startedAt: undefined, orderKey: { ...liveOrder(80), renderSequence: 20 } }),
		],
	});
	const refreshed = traceView({
		nodes: [
			node("first", { source: "transcript", startedAt: "2026-07-05T00:02:00.000Z", orderKey: { ...transcriptOrder(9), renderSequence: 10 } }),
			node("second", { source: "event-log", startedAt: "2026-07-05T00:01:00.000Z", orderKey: { ...eventOrder(1), renderSequence: 20 } }),
		],
	});

	const merged = mergeRefreshedTracePage(current, refreshed);
	assert.deepEqual(merged.nodes.map((entry) => entry.id), ["first", "second"]);
	assert.deepEqual(merged.nodes.map((entry) => entry.orderKey.renderSequence), [10, 20]);
});

test("mergeRefreshedTracePage retains a same-entry transcript part split from the refreshed tail", () => {
	const startedAt = "2026-07-05T00:01:00.000Z";
	const currentNodes = Array.from({ length: 51 }, (_, contentPartIndex) => node(`part-${contentPartIndex}`, {
		type: "model.reasoning",
		source: "transcript",
		startedAt,
		orderKey: {
			sourceRank: 0,
			turnSeq: 7,
			transcriptIndex: 7,
			contentPartIndex,
			phaseRank: 3,
		},
	}));
	const current = traceView({ nodes: currentNodes });
	const refreshed = traceView({ nodes: currentNodes.slice(1) });

	const merged = mergeRefreshedTracePage(current, refreshed);

	assert.equal(flattenNodes(merged.nodes).length, 51);
	assert.equal(flattenNodes(merged.nodes)[0]?.id, "part-0");
});

test("mergeRefreshedTracePage replaces stale tail nodes without dropping loaded history", () => {
	const current = traceView({
		nodes: [
			node("older-event", { source: "event-log", orderKey: eventOrder(10), startedAt: "2026-07-05T00:00:00.000Z" }),
			node("older-run-notification", { type: "execution.command", source: "event-log", stableKey: "run-notification:old", orderKey: eventOrder(15), startedAt: "2026-07-05T00:00:10.000Z" }),
			node("older-yielded-run", { type: "yielded.run", source: "event-log", orderKey: eventOrder(20), startedAt: "2026-07-05T00:00:20.000Z" }),
			node("entry:legacy-run-notification", { type: "yielded.run", source: "transcript", stableKey: "entry:legacy-run-notification", orderKey: transcriptOrder(-1), startedAt: "2026-07-05T00:00:25.000Z" }),
			node("older-transcript", { source: "transcript", orderKey: transcriptOrder(0), startedAt: "2026-07-05T00:00:30.000Z" }),
			node("shared", { source: "event-log", orderKey: eventOrder(50), startedAt: "2026-07-05T00:01:00.000Z" }),
			node("stale-notification", { type: "execution.command", source: "event-log", orderKey: eventOrder(55), startedAt: "2026-07-05T00:01:30.000Z" }),
			node("stale-yielded-run", { type: "yielded.run", source: "live", orderKey: liveOrder(100), startedAt: "2026-07-05T00:01:40.000Z" }),
		],
		firstEventSequence: 10,
	});
	const refreshed = traceView({
		nodes: [
			node("shared", { source: "event-log", orderKey: eventOrder(50), startedAt: "2026-07-05T00:01:00.000Z", title: "fresh shared" }),
			node("new-tail", { source: "event-log", orderKey: eventOrder(60), startedAt: "2026-07-05T00:02:00.000Z" }),
		],
		firstEventSequence: 50,
	});

	const merged = mergeRefreshedTracePage(current, refreshed);
	assert.deepEqual(merged.nodes.map((entry) => entry.id), [
		"older-event",
		"older-run-notification",
		"older-yielded-run",
		"entry:legacy-run-notification",
		"older-transcript",
		"shared",
		"new-tail",
	]);
	assert.equal(merged.nodes.find((entry) => entry.id === "shared")?.title, "fresh shared");
});

test("mergeRefreshedTracePage drops event turn scaffolds superseded by transcript content", () => {
	const current = traceView({
		nodes: [
			node("transcript-assistant", {
				type: "assistant.message",
				source: "transcript",
				eventId: "settled-turn",
				startedAt: "2026-07-05T00:00:00.000Z",
				orderKey: transcriptOrder(1),
			}),
			node("stale-turn", {
				type: "agent.turn",
				source: "event-log",
				eventId: "settled-turn",
				orderKey: eventOrder(10),
				children: [node("retained-child", {
					type: "execution.result",
					source: "event-log",
					parentId: "stale-turn",
					orderKey: eventOrder(11),
				})],
			}),
			node("event-only-turn", {
				type: "agent.turn",
				source: "event-log",
				eventId: "event-only-turn",
				orderKey: eventOrder(20),
			}),
		],
		firstEventSequence: 10,
	});
	const refreshed = traceView({
		nodes: [node("new-tail", {
			source: "event-log",
			startedAt: "2026-07-05T00:02:00.000Z",
			orderKey: eventOrder(50),
		})],
		firstEventSequence: 50,
	});

	const merged = mergeRefreshedTracePage(current, refreshed);
	assert.deepEqual(flattenNodes(merged.nodes).map((entry) => entry.id), [
		"transcript-assistant",
		"retained-child",
		"event-only-turn",
		"new-tail",
	]);
	assert.equal(merged.nodes.find((entry) => entry.id === "retained-child")?.parentId, undefined);
	assert.equal(checkTraceView(merged).issues.some((issue) => issue.code === "missing_parent"), false);
});

test("mergeRefreshedTracePage refreshes the raw-event tail without dropping loaded history", () => {
	const current = traceView({
		rawEvents: [
			rawEvent("older", 10, "tool_call", { phase: "older" }),
			rawEvent("shared", 20, "tool_execution_started", { phase: "stale" }),
			rawEvent("stale-tail", 25, "message_queued", { phase: "stale-only" }),
		],
	});
	const refreshed = traceView({
		rawEvents: [
			rawEvent("shared", 20, "tool_execution_started", { phase: "fresh" }),
			rawEvent("new-tail", 30, "tool_execution_finished", { phase: "new" }),
		],
	});

	const merged = mergeRefreshedTracePage(current, refreshed);
	assert.deepEqual(merged.rawEvents.map((event) => event.id), ["older", "shared", "new-tail"]);
	assert.equal(merged.rawEvents[1].payload.phase, "fresh");
	assert.equal(merged.rawEvents.some((event) => event.id === "stale-tail"), false);
});

test("mergeOlderTracePage carries string cursors across transcript continuation pages", () => {
	const current = traceView({
		nodes: [node("compact", { type: "execution.compaction" })],
		nextBeforeSequence: 1,
		nextBeforeCursor: "transcript:4000:Y3V0b2Zm",
	});
	const older = traceView({
		nodes: [node("entry-old", { type: "user.message", source: "transcript" })],
		beforeCursor: "transcript:4000:Y3V0b2Zm",
		nextBeforeSequence: undefined,
		nextBeforeCursor: "transcript:2000:Y3V0b2Zm",
		hasOlderEvents: true,
	});

	const merged = mergeOlderTracePage(current, older);

	assert.equal(merged.beforeCursor, "transcript:4000:Y3V0b2Zm");
	assert.equal(merged.nextBeforeCursor, "transcript:2000:Y3V0b2Zm");
	assert.equal(merged.hasOlderEvents, true);
	assert.deepEqual(flattenNodes(merged.nodes).map((entry) => entry.id), ["compact", "entry-old"]);
});

function traceView(overrides = {}) {
	return {
		piboSessionId: "ps_test",
		piSessionId: "pi_test",
		title: "Test",
		version: "v1",
		latestStreamId: 1,
		eventCount: 0,
		eventLimit: 50,
		pageSize: 50,
		firstEventSequence: 1,
		lastEventSequence: 100,
		nextBeforeSequence: undefined,
		hasOlderEvents: true,
		nodes: [],
		rawEvents: [],
		...overrides,
	};
}

function eventOrder(eventSequence) {
	return { sourceRank: 1, turnSeq: eventSequence, eventSequence, phaseRank: 4 };
}

function transcriptOrder(transcriptIndex) {
	return { sourceRank: 0, turnSeq: transcriptIndex, transcriptIndex, contentPartIndex: 0, phaseRank: 4 };
}

function liveOrder(streamId) {
	return { sourceRank: 2, turnSeq: streamId, streamId, streamFrameIndex: 0, phaseRank: 7 };
}

function rawEvent(id, eventSequence, type, payload = {}) {
	return {
		id,
		piboSessionId: "ps_test",
		createdAt: `2026-07-05T00:00:${String(eventSequence).padStart(2, "0")}.000Z`,
		eventSequence,
		type,
		payload,
	};
}

function node(id, overrides = {}) {
	return {
		id,
		type: "tool.call",
		title: id,
		status: "done",
		startedAt: "2026-07-05T00:00:00.000Z",
		children: [],
		...overrides,
	};
}

function flattenNodes(nodes) {
	const result = [];
	const stack = [...nodes].reverse();
	while (stack.length) {
		const current = stack.pop();
		result.push(current);
		for (let index = current.children.length - 1; index >= 0; index -= 1) {
			stack.push(current.children[index]);
		}
	}
	return result;
}
