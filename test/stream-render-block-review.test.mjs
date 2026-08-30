import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { OutputCompactor } from "../dist/apps/chat/output-compactor.js";
import { OutputRenderSequencer } from "../dist/core/output-render-sequence.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { ChatTimelineQueryService } from "../dist/apps/chat/data/timeline-query-service.js";
import { ChatHistoryQueryService } from "../dist/apps/chat/data/history-query-service.js";
import { parseTracePayloadRef } from "../dist/apps/chat/trace-v2.js";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";
import { compareTraceNodes, flattenTraceNodes } from "../dist/shared/trace-nodes.js";
import { compareTraceOrder, eventTraceOrder, liveTraceOrder, transcriptTraceOrder } from "../dist/shared/trace-order.js";
import { mergeOlderTracePage } from "../dist/shared/trace-page-merge.js";
import { parseTraceToolNodeIdentity, qualifiedToolNodeId } from "../dist/shared/trace-tool-identity.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

function permutations(values) {
	if (values.length < 2) return [values];
	return values.flatMap((value, index) => permutations(values.toSpliced(index, 1)).map((tail) => [value, ...tail]));
}

function traceNode(id, orderKey, startedAt = "2026-08-29T12:00:00.000Z") {
	return { id, piboSessionId: "ps-total", type: "tool.call", title: id, status: "done", startedAt, orderKey, children: [] };
}

test("mixed render-sequence ordering is transitive and permutation invariant", () => {
	const entries = [
		traceNode("render-2", { ...transcriptTraceOrder(0, 0, "tool.call"), renderSequence: 2 }),
		traceNode("legacy", eventTraceOrder(1, "tool.call")),
		traceNode("render-1", { ...liveTraceOrder(99, 0, "tool.call"), renderSequence: 1 }),
	];
	for (const ordered of permutations(entries)) {
		assert.deepEqual(ordered.toSorted(compareTraceNodes).map((entry) => entry.id), ["legacy", "render-1", "render-2"]);
	}
	for (const left of entries) for (const middle of entries) for (const right of entries) {
		if (compareTraceNodes(left, middle) <= 0 && compareTraceNodes(middle, right) <= 0) {
			assert.ok(compareTraceNodes(left, right) <= 0, `${left.id} <= ${middle.id} <= ${right.id}`);
		}
		if (compareTraceOrder(left.orderKey, middle.orderKey) <= 0 && compareTraceOrder(middle.orderKey, right.orderKey) <= 0) {
			assert.ok(compareTraceOrder(left.orderKey, right.orderKey) <= 0, `order ${left.id} <= ${middle.id} <= ${right.id}`);
		}
	}
});

test("trace ordering is antisymmetric and transitive across all sequence domains", () => {
	const entries = [
		traceNode("native-legacy", transcriptTraceOrder(4, 0, "tool.call")),
		traceNode("native-confirmed", { ...transcriptTraceOrder(8, 0, "tool.call"), eventSequence: 8 }),
		traceNode("product", { ...transcriptTraceOrder(2, 0, "tool.call"), sourceRank: 1, eventSequence: 2 }),
		traceNode("event", { ...eventTraceOrder(3, "tool.call"), renderSequence: 999 }),
		traceNode("live-first", { ...liveTraceOrder(50, 1, "tool.call"), renderSequence: 10 }),
		traceNode("live-second", { ...liveTraceOrder(1, 0, "tool.call"), renderSequence: 11 }),
	];
	const expected = entries.toSorted(compareTraceNodes).map((entry) => entry.id);
	for (const ordered of permutations(entries.slice(0, 4))) {
		const candidate = [...ordered, ...entries.slice(4)].toSorted(compareTraceNodes).map((entry) => entry.id);
		assert.deepEqual(candidate, expected);
	}
	for (const left of entries) for (const right of entries) {
		assert.equal(compareTraceNodes(left, right) + compareTraceNodes(right, left), 0);
	}
	for (const left of entries) for (const middle of entries) for (const right of entries) {
		if (compareTraceNodes(left, middle) <= 0 && compareTraceNodes(middle, right) <= 0) {
			assert.ok(compareTraceNodes(left, right) <= 0, `${left.id} <= ${middle.id} <= ${right.id}`);
		}
	}
});

test("render sequence survives a durable store restart and wall-clock rollback", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pibo-render-high-water-"));
	const databasePath = path.join(directory, "pibo.sqlite");
	try {
		let dataStore = new PiboDataStore(databasePath);
		let sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: "ps-restart", channel: "test", kind: "chat", profile: "base" });
		const firstSequencer = new OutputRenderSequencer({ now: () => 9_000, highWaterStore: sessionStore });
		const first = firstSequencer.position({ type: "execution_result", piboSessionId: "ps-restart", eventId: "first", action: "one", result: {} });
		dataStore.close();

		dataStore = new PiboDataStore(databasePath);
		sessionStore = new PiboDataSessionStore(dataStore);
		const restartedSequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: sessionStore });
		const second = restartedSequencer.position({ type: "execution_result", piboSessionId: "ps-restart", eventId: "second", action: "two", result: {} });
		assert.ok(second.renderSequence > first.renderSequence, `${second.renderSequence} > ${first.renderSequence}`);
		dataStore.close();
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("render sequence initializes from durable event-log max when legacy metadata has no high-water mark", () => {
	const dataStore = new PiboDataStore(":memory:");
	try {
		const sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: "ps-durable-max", channel: "test", kind: "chat", profile: "base" });
		dataStore.eventLog.appendEvent({
			sessionId: "ps-durable-max",
			sessionSequence: 1,
			topic: "pibo.output",
			type: "assistant_message",
			source: "test",
			retentionClass: "chat_message",
			attributes: { renderSequence: 9_000_000 },
		});
		const sequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: sessionStore });
		const next = sequencer.position({ type: "execution_result", piboSessionId: "ps-durable-max", eventId: "next", action: "next", result: {} });
		assert.equal(next.renderSequence, 9_000_001);
	} finally {
		dataStore.close();
	}
});

test("render sequence initializes above legacy durable event sequence without render metadata", () => {
	const dataStore = new PiboDataStore(":memory:");
	try {
		const sessionStore = new PiboDataSessionStore(dataStore);
		sessionStore.create({ id: "ps-legacy-sequence", channel: "test", kind: "chat", profile: "base" });
		dataStore.eventLog.appendEvent({
			sessionId: "ps-legacy-sequence",
			sessionSequence: 8_000,
			topic: "pibo.output",
			type: "assistant_message",
			source: "test",
			actorType: "assistant",
			retentionClass: "chat_message",
			attributes: {},
			createdAt: "2026-08-29T12:00:00.000Z",
		});
		const sequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: sessionStore });
		const positioned = sequencer.position({ type: "assistant_delta", piboSessionId: "ps-legacy-sequence", eventId: "new", assistantIndex: 0, text: "x" });
		assert.equal(positioned.renderSequence, 8_001);
	} finally {
		dataStore.close();
	}
});

test("tool invocation state machine is permutation-safe and accepts persisted large ordinals", () => {
	const lifecycle = [
		{ type: "tool_call", args: {}, argsComplete: true },
		{ type: "tool_execution_started", args: {} },
		{ type: "tool_execution_updated", args: {}, partialResult: "partial" },
		{ type: "tool_execution_finished", result: "done", isError: false },
	];
	for (const ordered of permutations(lifecycle)) {
		const sequencer = new OutputRenderSequencer(() => 1_000);
		const positioned = ordered.map((event) => sequencer.position({
			...event,
			piboSessionId: "ps-tools",
			eventId: "turn-tools",
			toolCallId: "reused",
			toolName: "read",
		}));
		assert.deepEqual(new Set(positioned.map((event) => event.toolInvocationOrdinal)), new Set([0]), ordered.map((event) => event.type).join(","));
		const next = sequencer.position({ type: "tool_call", piboSessionId: "ps-tools", eventId: "turn-tools", toolCallId: "reused", toolName: "read", args: {}, argsComplete: true });
		assert.equal(next.toolInvocationOrdinal, 1);
	}
	const replay = new OutputRenderSequencer(() => 2_000);
	for (const event of lifecycle) {
		const positioned = replay.position({ ...event, piboSessionId: "ps-tools", eventId: "turn-tools", toolCallId: "reused", toolName: "read", toolInvocationOrdinal: 1_000 });
		assert.equal(positioned.toolInvocationOrdinal, 1_000);
	}
	for (const ordinal of [499, 500, 1_000, 10_000]) {
		assert.deepEqual(parseTraceToolNodeIdentity(qualifiedToolNodeId("same", "turn", ordinal))?.qualifier, { eventId: "turn", invocationOrdinal: ordinal });
	}
});

test("sequencer and compactor retain active state, bound completed state, and support explicit disposal and late recovery", () => {
	const sequencer = new OutputRenderSequencer(() => 3_000);
	const compactor = new OutputCompactor();
	for (let index = 0; index < 1_100; index += 1) {
		const sessionId = `ps-${index}`;
		sequencer.position({ type: "assistant_delta", piboSessionId: sessionId, eventId: `turn-${index}`, assistantIndex: 0, text: "x" });
		compactor.prepare({ type: "assistant_delta", piboSessionId: sessionId, eventId: `turn-${index}`, assistantIndex: 0, text: "x" }).ack();
	}
	assert.ok(sequencer.debugState().sessionCount >= 1_100, JSON.stringify(sequencer.debugState()));
	assert.ok(compactor.debugState().sessionCount >= 1_100, JSON.stringify(compactor.debugState()));
	assert.equal(compactor.debugState().assistantBufferCount, 1_100);
	const oneSession = new OutputRenderSequencer(() => 4_000);
	for (let index = 0; index < 1_100; index += 1) {
		oneSession.position({ type: "execution_result", piboSessionId: "ps-many-turns", eventId: `turn-${index}`, action: `action-${index}`, result: {} });
	}
	assert.ok(oneSession.debugState().positionCount <= 1_024, JSON.stringify(oneSession.debugState()));

	const first = sequencer.position({ type: "assistant_delta", piboSessionId: "ps-late", eventId: "turn-late", assistantIndex: 0, text: "a" });
	sequencer.position({ type: "message_finished", piboSessionId: "ps-late", eventId: "turn-late", source: "user" });
	const recovered = sequencer.position({ type: "assistant_message", piboSessionId: "ps-late", eventId: "turn-late", assistantIndex: 0, text: "a" });
	assert.equal(recovered.renderSequence, first.renderSequence);
	sequencer.disposeSession("ps-late");
	compactor.disposeSession("ps-late");
	assert.equal(sequencer.debugState().sessions.includes("ps-late"), false);
	assert.equal(compactor.debugState().sessions.includes("ps-late"), false);
});

test("compactor prepare/ack retains a complete final across a failed write and retry", () => {
	const compactor = new OutputCompactor();
	compactor.prepare({ type: "assistant_delta", piboSessionId: "ps-retry", eventId: "turn", assistantIndex: 0, text: "complete answer" }).ack();
	const failed = compactor.prepare({ type: "assistant_message", piboSessionId: "ps-retry", eventId: "turn", assistantIndex: 0, text: "" });
	assert.equal(failed.persistedEvents[0].text, "complete answer");
	failed.rollback();
	const retried = compactor.prepare({ type: "assistant_message", piboSessionId: "ps-retry", eventId: "turn", assistantIndex: 0, text: "" });
	assert.equal(retried.persistedEvents[0].text, "complete answer");
	assert.equal(retried.liveEvents[0].text, "complete answer");
	retried.ack();
	assert.equal(compactor.debugState().assistantBufferCount, 0);
});

test("delayed thinking-start acknowledgement cannot overwrite a newer delta buffer", () => {
	const compactor = new OutputCompactor();
	const started = compactor.prepare({ type: "thinking_started", piboSessionId: "ps-thinking-retry", eventId: "turn", thinkingIndex: 0 });
	compactor.prepare({ type: "thinking_delta", piboSessionId: "ps-thinking-retry", eventId: "turn", thinkingIndex: 0, text: "kept reasoning" }).ack();
	started.ack();
	const finished = compactor.prepare({ type: "thinking_finished", piboSessionId: "ps-thinking-retry", eventId: "turn", thinkingIndex: 0, text: "" });
	assert.equal(finished.persistedEvents[0].text, "kept reasoning");
});

test("raw page merge uses durable event or stream sequence before render sequence", () => {
	const rawEvents = [
		{ id: "new-3", piboSessionId: "ps-mixed", eventSequence: 3, renderSequence: 1, type: "assistant_message", createdAt: "", payload: {} },
		{ id: "legacy-1", piboSessionId: "ps-mixed", streamId: 1, renderSequence: 999_999, type: "assistant_message", createdAt: "", payload: {} },
		{ id: "new-2", piboSessionId: "ps-mixed", eventSequence: 2, renderSequence: 5, type: "assistant_message", createdAt: "", payload: {} },
	];
	const base = { piboSessionId: "ps-mixed", piSessionId: "pi", title: "mixed", version: "v", nodes: [], rawEvents: [] };
	for (const page of permutations(rawEvents)) {
		const merged = mergeOlderTracePage(base, { ...base, rawEvents: page });
		assert.deepEqual(merged.rawEvents.map((event) => event.id), ["legacy-1", "new-2", "new-3"]);
	}
});

test("mixed legacy and render-sequenced product history hydrates in durable event order", () => {
	const dataStore = new PiboDataStore(":memory:");
	try {
		const sessionStore = new PiboDataSessionStore(dataStore);
		const session = sessionStore.create({ id: "ps-hydration-order", channel: "test", kind: "chat", profile: "base" });
		const ingest = new ChatDataIngestService(dataStore);
		const roomId = "room-hydration-order";
		const appendTurn = ({ eventId, prompt, answer, renderSequence }) => {
			ingest.ingestUserMessageAccepted({
				session,
				roomId,
				actorId: "user:test",
				text: prompt,
				clientTxnId: eventId,
				legacyEvent: { eventId },
			});
			ingest.ingestOutputEvent({ session, roomId, actorId: "base", event: { type: "message_started", piboSessionId: session.id, eventId, text: prompt, source: "user", ...(renderSequence === undefined ? {} : { renderSequence: renderSequence - 1 }) } });
			ingest.ingestOutputEvent({ session, roomId, actorId: "base", event: { type: "assistant_message", piboSessionId: session.id, eventId, assistantIndex: 0, text: answer, ...(renderSequence === undefined ? {} : { renderSequence }) } });
			ingest.ingestOutputEvent({ session, roomId, actorId: "base", event: { type: "message_finished", piboSessionId: session.id, eventId, source: "user", ...(renderSequence === undefined ? {} : { renderSequence: renderSequence + 1 }) } });
		};
		appendTurn({ eventId: "legacy-turn", prompt: "legacy prompt", answer: "legacy answer" });
		appendTurn({ eventId: "new-turn", prompt: "new prompt", answer: "new answer", renderSequence: 10_000 });

		const timeline = new ChatTimelineQueryService(dataStore);
		const history = new ChatHistoryQueryService(dataStore);
		const view = buildTraceViewFromEvents({
			session: { id: session.id, piSessionId: "pi", title: "hydration" },
			events: timeline.listSessionEvents(session.id),
			historyEntries: history.listProductHistoryEntries({ piboSessionId: session.id }),
			turnTimings: timeline.listMessageTurnTimings(session.id),
		});
		const assistants = flattenTraceNodes(view.nodes).filter((node) => node.type === "assistant.message");
		assert.deepEqual(assistants.map((node) => node.eventId), ["legacy-turn", "new-turn"]);
		assert.deepEqual(assistants.map((node) => node.orderKey.eventSequence), [3, 7]);
		assert.deepEqual(assistants.map((node) => node.output), ["legacy answer", "new answer"]);
		const content = flattenTraceNodes(view.nodes).filter((node) => node.type === "user.message" || node.type === "assistant.message");
		assert.deepEqual(content.map((node) => `${node.eventId}:${node.type}`), [
			"legacy-turn:user.message",
			"legacy-turn:assistant.message",
			"new-turn:user.message",
			"new-turn:assistant.message",
		]);
		assert.deepEqual(content.map((node) => node.orderKey.renderSequence), [undefined, undefined, 9_999, 10_000]);
	} finally {
		dataStore.close();
	}
});

test("fallback projection ids use a bounded digest for large canonical payloads", () => {
	const common = "x".repeat(100_000);
	const events = ["A", "B"].map((suffix, index) => ({
		id: `stored-${index}`,
		piboSessionId: "ps-digest",
		eventSequence: index + 1,
		type: "execution_result",
		createdAt: "2026-08-29T12:00:00.000Z",
		payload: { type: "execution_result", piboSessionId: "ps-digest", action: common + suffix, result: { ok: true } },
	}));
	const view = buildTraceViewFromEvents({ session: { id: "ps-digest", piSessionId: "pi", title: "digest" }, events });
	assert.equal(view.nodes.length, 2);
	assert.equal(new Set(view.nodes.map((node) => node.id)).size, 2);
	assert.ok(view.nodes.every((node) => node.id.length <= 128), view.nodes.map((node) => node.id.length).join(","));
});

test("large payload refs are qualified by turn and ordinal when toolCallId is reused", () => {
	const dataStore = new PiboDataStore(":memory:");
	try {
		const sessionStore = new PiboDataSessionStore(dataStore);
		const session = sessionStore.create({ id: "ps-payload", channel: "test", kind: "chat", profile: "base" });
		const ingest = new ChatDataIngestService(dataStore);
		const payloadIds = [];
		for (const [index, eventId] of ["turn-one", "turn-two"].entries()) {
			ingest.ingestOutputEvent({
				session,
				actorId: "base",
				createdAt: `2026-08-29T12:00:0${index}.000Z`,
				event: {
					type: "tool_execution_finished",
					piboSessionId: session.id,
					eventId,
					toolCallId: "reused",
					toolInvocationOrdinal: 0,
					toolName: "read",
					result: { text: `${eventId}:${"x".repeat(100_000)}` },
					isError: false,
				},
			});
		}
		const timeline = new ChatTimelineQueryService(dataStore);
		const events = timeline.listSessionEvents(session.id).filter((event) => event.type === "tool_execution_finished");
		assert.equal(events.length, 2);
		for (const [index, event] of events.entries()) {
			const eventId = index === 0 ? "turn-one" : "turn-two";
			const expectedNodeId = qualifiedToolNodeId("reused", eventId, 0);
			assert.equal(event.storedPayloadRef?.nodeId, expectedNodeId);
			assert.equal(event.storedPayloadRef?.payloadKind, "output");
			const payloadId = parseTracePayloadRef(event.storedPayloadRef.ref).payloadId;
			payloadIds.push(payloadId);
			assert.equal(timeline.isPayloadAttachedToTraceNode({
				piboSessionId: session.id,
				payloadId,
				nodeId: expectedNodeId,
				payloadKind: "output",
			}), true);
		}
		assert.notEqual(payloadIds[0], payloadIds[1]);
		assert.equal(timeline.isPayloadAttachedToTraceNode({
			piboSessionId: session.id,
			payloadId: payloadIds[0],
			nodeId: qualifiedToolNodeId("reused", "turn-two", 0),
			payloadKind: "output",
		}), false);
	} finally {
		dataStore.close();
	}
});
