import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { OutputCompactor } from "../dist/apps/chat/output-compactor.js";
import { ChatTimelineQueryService } from "../dist/apps/chat/data/timeline-query-service.js";
import { LocalCliSessionSource } from "../dist/cli-session/localSessionSource.js";
import { OutputRenderSequencer } from "../dist/core/output-render-sequence.js";
import { OutputPersistenceRetryQueue } from "../dist/core/output-persistence-retry.js";
import { PiboSessionRouter } from "../dist/core/session-router.js";
import { ChatDataIngestService } from "../dist/data/ingest-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";
import { compareTraceNodes } from "../dist/shared/trace-nodes.js";
import { eventTraceOrder, historyTraceOrder } from "../dist/shared/trace-order.js";
import { qualifiedToolNodeId } from "../dist/shared/trace-tool-identity.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";

const fixedNow = "2026-08-30T00:00:00.000Z";

function temporaryDatabase(prefix) {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	return { directory, databasePath: path.join(directory, "pibo.sqlite") };
}

function waitFor(predicate, timeoutMs = 1_000) {
	return new Promise((resolve, reject) => {
		const startedAt = performance.now();
		const poll = () => {
			if (predicate()) return resolve();
			if (performance.now() - startedAt >= timeoutMs) return reject(new Error(`condition not met within ${timeoutMs}ms`));
			setTimeout(poll, 10);
		};
		poll();
	});
}

function permutations(values) {
	if (values.length <= 1) return [values];
	return values.flatMap((value, index) => permutations(values.filter((_, candidate) => candidate !== index)).map((rest) => [value, ...rest]));
}

test("durable output part indices survive context-guard sequencer restart", () => {
	const { directory, databasePath } = temporaryDatabase("pibo-context-guard-output-identity-");
	let dataStore;
	try {
		dataStore = new PiboDataStore(databasePath);
		let sessionStore = new PiboDataSessionStore(dataStore);
		const session = sessionStore.create({ id: "ps-context-guard-output", channel: "test", kind: "chat", profile: "base" });
		let ingest = new ChatDataIngestService(dataStore);
		const firstSequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: sessionStore });
		const firstFinal = firstSequencer.position({
			type: "assistant_message",
			piboSessionId: session.id,
			eventId: "turn-context-guard",
			assistantIndex: 0,
			text: "Answer before compaction",
		});
		ingest.ingestOutputEvent({ session, event: firstFinal });
		for (const event of [
			{ type: "compaction_start", reason: "context_guard", compactionIndex: 0 },
			{ type: "compaction_end", reason: "context_guard", compactionIndex: 0, aborted: false },
		]) {
			ingest.ingestOutputEvent({
				session,
				event: firstSequencer.position({ ...event, piboSessionId: session.id, eventId: "turn-context-guard" }),
			});
		}
		dataStore.close();

		dataStore = new PiboDataStore(databasePath);
		sessionStore = new PiboDataSessionStore(dataStore);
		ingest = new ChatDataIngestService(dataStore);
		const reopenedSession = sessionStore.get(session.id);
		assert.ok(reopenedSession);
		const resumedSequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: sessionStore });
		const resumedFinal = resumedSequencer.position({
			type: "assistant_message",
			piboSessionId: session.id,
			eventId: "turn-context-guard",
			assistantIndex: 0,
			text: "Final answer after compaction",
		});
		assert.equal(resumedFinal.assistantIndex, 1);
		assert.equal(ingest.ingestOutputEvent({ session: reopenedSession, event: resumedFinal }).duplicate, false);

		const replay = resumedSequencer.position(resumedFinal);
		assert.equal(replay.assistantIndex, 1);
		assert.equal(ingest.ingestOutputEvent({ session: reopenedSession, event: replay }).duplicate, true);
		const events = dataStore.eventLog.listEvents({ sessionId: session.id });
		assert.deepEqual(events.filter((event) => event.type === "assistant_message").map((event) => event.attributes.assistantIndex), [0, 1]);
		assert.deepEqual(dataStore.messages.listMessages(session.id).map((message) => message.contentPreview), [
			"Answer before compaction",
			"Final answer after compaction",
		]);
		assert.equal(events.filter((event) => event.type === "pibo.output.identity_collision").length, 0);
	} finally {
		dataStore?.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("multi-response turns keep distinct output parts across repeated content and sequencer restart", () => {
	const { directory, databasePath } = temporaryDatabase("pibo-repeated-output-parts-");
	let dataStore;
	try {
		dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		const session = sessionStore.create({ id: "ps-repeated-output-parts", channel: "test", kind: "chat", profile: "base" });
		const ingest = new ChatDataIngestService(dataStore);
		const compactor = new OutputCompactor();
		const downstreamSequencer = new OutputRenderSequencer(() => 2);
		let routerSequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: sessionStore });
		const positionedEvents = [];
		const emit = (event) => {
			const routed = routerSequencer.position({ piboSessionId: session.id, eventId: "turn-many-cycles", ...event });
			const downstream = downstreamSequencer.position(routed);
			for (const key of ["assistantIndex", "thinkingIndex", "usageIndex", "compactionIndex"]) {
				if (key in routed) assert.equal(downstream[key], routed[key], `${key} changed downstream for ${event.type}`);
			}
			positionedEvents.push(downstream);
			const prepared = compactor.prepare(downstream);
			for (const persistedEvent of prepared.persistedEvents) {
				ingest.ingestOutputEvent({ session, event: persistedEvent });
			}
			prepared.ack();
			return downstream;
		};

		emit({ type: "message_started", text: "exercise many cycles", source: "user" });
		for (let cycle = 0; cycle < 50; cycle += 1) {
			if (cycle === 25) routerSequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: sessionStore });
			const producerIndex = cycle < 25 ? cycle : cycle - 25;
			const thinkingStarted = emit({ type: "thinking_started", thinkingIndex: producerIndex, contentIndex: 0 });
			const thinkingDelta = emit({ type: "thinking_delta", thinkingIndex: producerIndex, contentIndex: 0, text: " repeated reasoning fragment" });
			const thinkingFinished = emit({ type: "thinking_finished", thinkingIndex: producerIndex, contentIndex: 0, text: "same reasoning response" });
			assert.equal(thinkingDelta.thinkingIndex, thinkingStarted.thinkingIndex);
			assert.equal(thinkingFinished.thinkingIndex, thinkingStarted.thinkingIndex);

			const assistantDelta = emit({ type: "assistant_delta", assistantIndex: producerIndex, contentIndex: 1, text: " repeated assistant fragment" });
			const assistantMessage = emit({ type: "assistant_message", assistantIndex: producerIndex, contentIndex: 1, text: "same assistant response" });
			assert.equal(assistantMessage.assistantIndex, assistantDelta.assistantIndex);
			emit({ type: "assistant_usage", usageIndex: producerIndex, totalTokens: cycle + 1 });

			const toolCallId = `tool-${cycle}`;
			emit({ type: "tool_call", toolCallId, toolName: "read", args: { cycle }, argsComplete: true });
			emit({ type: "tool_execution_started", toolCallId, toolName: "read", args: { cycle } });
			emit({ type: "tool_execution_finished", toolCallId, toolName: "read", result: { cycle }, isError: false });
		}
		emit({ type: "message_finished", source: "user" });

		const stored = dataStore.eventLog.listEvents({ sessionId: session.id, limit: 1_000 });
		const byType = (type) => stored.filter((event) => event.type === type);
		assert.equal(byType("message_started").length, 1);
		assert.equal(byType("thinking_started").length, 50);
		assert.equal(byType("thinking_finished").length, 50);
		assert.deepEqual(byType("thinking_started").map((event) => event.attributes.thinkingIndex), Array.from({ length: 50 }, (_, index) => index));
		assert.deepEqual(byType("thinking_finished").map((event) => event.attributes.thinkingIndex), Array.from({ length: 50 }, (_, index) => index));
		assert.equal(byType("assistant_message").length, 50);
		assert.deepEqual(byType("assistant_message").map((event) => event.attributes.assistantIndex), Array.from({ length: 50 }, (_, index) => index));
		assert.deepEqual(byType("assistant_usage").map((event) => event.attributes.usageIndex), Array.from({ length: 50 }, (_, index) => index));
		assert.equal(byType("tool_call").length, 50);
		assert.equal(byType("tool_execution_started").length, 50);
		assert.equal(byType("tool_execution_finished").length, 50);
		assert.equal(byType("message_finished").length, 1);
		assert.equal(byType("pibo.output.identity_collision").length, 0);
		assert.equal(positionedEvents.filter((event) => event.type === "thinking_started").length, 50);
	} finally {
		dataStore?.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("durable render high-water survives stale metadata writes across SQLite connections", () => {
	const { directory, databasePath } = temporaryDatabase("pibo-high-water-race-");
	let firstDataStore;
	let secondDataStore;
	try {
		firstDataStore = new PiboDataStore(databasePath);
		secondDataStore = new PiboDataStore(databasePath);
		const firstStore = new PiboDataSessionStore(firstDataStore);
		const secondStore = new PiboDataSessionStore(secondDataStore);
		firstStore.create({ id: "ps-high-water-race", channel: "test", kind: "chat", profile: "base", metadata: { marker: "original" } });
		assert.equal(firstStore.claimOutputRenderSequence("ps-high-water-race", 1_000_000), 1_000_000);
		const staleMetadata = structuredClone(secondStore.get("ps-high-water-race").metadata);
		assert.equal(firstStore.claimOutputRenderSequence("ps-high-water-race", 9_000_000), 9_000_000);
		firstDataStore.eventLog.appendEvent({
			sessionId: "ps-high-water-race",
			sessionSequence: 9_000_000,
			topic: "pibo.output",
			type: "execution_result",
			source: "test",
			retentionClass: "trace_event",
			attributes: { renderSequence: 9_000_000 },
		});
		secondStore.update("ps-high-water-race", { metadata: { ...staleMetadata, marker: "stale-write" } });
		firstDataStore.close();
		secondDataStore.close();
		firstDataStore = undefined;
		secondDataStore = undefined;

		const reopenedDataStore = new PiboDataStore(databasePath);
		try {
			const reopenedStore = new PiboDataSessionStore(reopenedDataStore);
			const sequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: reopenedStore });
			const event = sequencer.position({ type: "execution_result", piboSessionId: "ps-high-water-race", eventId: "after-reopen", action: "status", result: {} });
			assert.ok(event.renderSequence > 9_000_000, String(event.renderSequence));
		} finally {
			reopenedDataStore.close();
		}
	} finally {
		firstDataStore?.close();
		secondDataStore?.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("local CLI automatically retries one failed final without producer replay", async () => {
	const dataStore = new PiboDataStore(":memory:");
	const sessionStore = new PiboDataSessionStore(dataStore);
	const originalAppend = dataStore.eventLog.appendEvent.bind(dataStore.eventLog);
	let failFirstFinal = true;
	dataStore.eventLog.appendEvent = (input) => {
		if (failFirstFinal && input.type === "assistant_message") {
			failFirstFinal = false;
			throw new Error("injected once-only final failure");
		}
		return originalAppend(input);
	};
	const listeners = new Set();
	const router = {
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		async emit() { throw new Error("not used"); },
	};
	const source = new LocalCliSessionSource({ dataStore, sessionStore, router, now: () => fixedNow });
	try {
		const created = await source.createSession({ title: "Automatic retry", profile: "base" });
		const emit = (event) => {
			for (const listener of listeners) listener({ piboSessionId: created.id, eventId: "turn-auto-retry", ...event });
		};
		emit({ type: "assistant_delta", assistantIndex: 0, text: "persist me once" });
		emit({ type: "assistant_message", assistantIndex: 0, text: "" });
		await waitFor(() => dataStore.eventLog.listEvents({ sessionId: created.id }).filter((event) => event.type === "assistant_message").length === 1);
		const finals = dataStore.eventLog.listEvents({ sessionId: created.id }).filter((event) => event.type === "assistant_message");
		assert.equal(finals.length, 1);
		assert.equal(finals[0].previewText, "persist me once");
	} finally {
		await source.close();
		dataStore.close();
	}
});

test("persistence retry queue bounds pending jobs and dead letters deterministically", async () => {
	const retries = new OutputPersistenceRetryQueue({ maxPending: 2, maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1, maxDeadLetters: 2 });
	for (const key of ["one", "two", "overflow"]) {
		retries.enqueue({ key, run() { throw new Error(`failed:${key}`); } });
	}
	assert.equal(retries.debugState().pending, 2);
	assert.deepEqual(retries.debugState().deadLetters.map((entry) => entry.key), ["overflow"]);
	await retries.drain();
	assert.equal(retries.debugState().pending, 0);
	assert.deepEqual(retries.debugState().deadLetters.map((entry) => entry.key), ["one", "two"]);
	retries.dispose();
});

test("legacy NULL session sequences remain reachable through tail and before pages after reopen", () => {
	const { directory, databasePath } = temporaryDatabase("pibo-null-sequence-");
	try {
		let dataStore = new PiboDataStore(databasePath);
		for (const [index, sessionSequence] of [undefined, 1, undefined, 2].entries()) {
			const eventId = `turn-${index + 1}`;
			dataStore.eventLog.appendEvent({
				sessionId: "ps-null-pages",
				sessionSequence,
				topic: "pibo.output",
				type: "assistant_message",
				source: "test",
				eventId,
				idempotencyKey: `legacy-page-${index + 1}`,
				retentionClass: "chat_message",
				attributes: { inlinePayload: { type: "assistant_message", piboSessionId: "ps-null-pages", eventId, assistantIndex: 0, text: `answer-${index + 1}` } },
				createdAt: `2026-08-30T00:00:0${index}.000Z`,
			});
		}
		dataStore.db.exec("PRAGMA user_version = 6");
		dataStore.close();
		dataStore = new PiboDataStore(databasePath);
		try {
			const timeline = new ChatTimelineQueryService(dataStore);
			const pages = [];
			let beforeSequence;
			for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
				const page = timeline.listTraceEvents({ piboSessionId: "ps-null-pages", limit: 2, beforeSequence });
				if (!page.length) break;
				pages.unshift(page);
				beforeSequence = Math.min(...page.map((event) => event.eventSequence));
			}
			const events = pages.flat();
			assert.deepEqual(events.map((event) => event.payload.eventId), ["turn-1", "turn-2", "turn-3", "turn-4"]);
			assert.deepEqual(events.map((event) => event.eventSequence), [1, 2, 3, 4]);
			assert.equal(new Set(events.map((event) => event.id)).size, 4);
		} finally {
			dataStore.close();
		}
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("active sequencer and compactor sessions survive capacity while completed states remain bounded", () => {
	let tick = 1;
	const sequencer = new OutputRenderSequencer(() => tick++);
	const compactor = new OutputCompactor();
	sequencer.position({ type: "assistant_delta", piboSessionId: "ps-parallel", eventId: "turn-parallel-one", assistantIndex: 0, text: "one" });
	const parallelActive = sequencer.position({ type: "assistant_delta", piboSessionId: "ps-parallel", eventId: "turn-parallel-two", assistantIndex: 0, text: "two" });
	sequencer.position({ type: "message_finished", piboSessionId: "ps-parallel", eventId: "turn-parallel-one", source: "user" });
	let firstPosition;
	for (let index = 0; index < 1_025; index += 1) {
		const sessionId = `ps-active-${index}`;
		const eventId = `turn-active-${index}`;
		const positioned = sequencer.position({ type: "assistant_delta", piboSessionId: sessionId, eventId, assistantIndex: 0, text: index === 0 ? "kept" : "x" });
		compactor.prepare(positioned).ack();
		if (index === 0) firstPosition = positioned.renderSequence;
	}
	const final = sequencer.position({ type: "assistant_message", piboSessionId: "ps-active-0", eventId: "turn-active-0", assistantIndex: 0, text: "" });
	const prepared = compactor.prepare(final);
	assert.equal(final.renderSequence, firstPosition);
	assert.equal(prepared.persistedEvents[0].text, "kept");
	prepared.ack();
	assert.ok(sequencer.debugState().sessionCount >= 1_025);

	for (let index = 0; index < 1_100; index += 1) {
		const sessionId = `ps-complete-${index}`;
		const eventId = `turn-complete-${index}`;
		sequencer.position({ type: "assistant_delta", piboSessionId: sessionId, eventId, assistantIndex: 0, text: "done" });
		sequencer.position({ type: "assistant_message", piboSessionId: sessionId, eventId, assistantIndex: 0, text: "done" });
		sequencer.position({ type: "message_finished", piboSessionId: sessionId, eventId, source: "user" });
		compactor.prepare({ type: "assistant_delta", piboSessionId: sessionId, eventId, assistantIndex: 0, text: "done" }).ack();
		compactor.prepare({ type: "assistant_message", piboSessionId: sessionId, eventId, assistantIndex: 0, text: "done" }).ack();
	}
	assert.ok(sequencer.debugState().completedSessionCount <= 1_024, JSON.stringify(sequencer.debugState()));
	assert.ok(compactor.debugState().completedSessionCount <= 1_024, JSON.stringify(compactor.debugState()));
	const parallelFinal = sequencer.position({ type: "assistant_message", piboSessionId: "ps-parallel", eventId: "turn-parallel-two", assistantIndex: 0, text: "two" });
	assert.equal(parallelFinal.renderSequence, parallelActive.renderSequence);
});

test("concurrent and restarted sequencers reserve distinct raw output parts", () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-part-race-");
	let firstDataStore;
	let secondDataStore;
	try {
		firstDataStore = new PiboDataStore(databasePath);
		secondDataStore = new PiboDataStore(databasePath);
		const firstStore = new PiboDataSessionStore(firstDataStore);
		const secondStore = new PiboDataSessionStore(secondDataStore);
		const session = firstStore.create({ id: "ps-output-part-race", channel: "test", kind: "chat", profile: "base" });
		const firstSequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: firstStore });
		const secondSequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: secondStore });
		const base = { piboSessionId: "ps-output-part-race", eventId: "same-turn", assistantIndex: 0 };
		const first = firstSequencer.position({ ...base, type: "assistant_delta", text: "first" });
		const second = secondSequencer.position({ ...base, type: "assistant_delta", text: "second" });
		assert.deepEqual([first.assistantIndex, second.assistantIndex], [0, 1]);
		new ChatDataIngestService(firstDataStore).ingestOutputEvent({ session, event: first });
		const restarted = new OutputRenderSequencer({ now: () => 2, highWaterStore: secondStore });
		const third = restarted.position({ ...base, type: "assistant_delta", text: "third" });
		assert.equal(third.assistantIndex, 2);
		const downstream = new OutputRenderSequencer({ now: () => 2, highWaterStore: secondStore });
		assert.equal(downstream.position(first).assistantIndex, 0);
	} finally {
		firstDataStore?.close();
		secondDataStore?.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("completed-turn replay restores the supplied identity among identical parts", () => {
	const { directory, databasePath } = temporaryDatabase("pibo-output-part-replay-");
	let dataStore;
	try {
		dataStore = new PiboDataStore(databasePath);
		const sessionStore = new PiboDataSessionStore(dataStore);
		const session = sessionStore.create({ id: "ps-output-part-replay", channel: "test", kind: "chat", profile: "base" });
		const ingest = new ChatDataIngestService(dataStore);
		const sequencer = new OutputRenderSequencer({ now: () => 1, highWaterStore: sessionStore });
		const base = { piboSessionId: session.id, eventId: "same-completed-turn", text: "identical" };
		for (const assistantIndex of [0, 1]) {
			ingest.ingestOutputEvent({
				session,
				event: sequencer.position({ ...base, type: "assistant_message", assistantIndex }),
			});
		}
		ingest.ingestOutputEvent({
			session,
			event: sequencer.position({ ...base, type: "message_finished", source: "user" }),
		});
		const replaySequencer = new OutputRenderSequencer({ now: () => 2, highWaterStore: sessionStore });
		const replay = replaySequencer.position({ ...base, type: "assistant_message", assistantIndex: 1 });
		assert.equal(replay.assistantIndex, 1);
		assert.equal(ingest.ingestOutputEvent({ session, event: replay }).duplicate, true);
	} finally {
		dataStore?.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("two routers reserve distinct durable tool invocations and restart continues the ordinal", async () => {
	const { directory, databasePath } = temporaryDatabase("pibo-tool-ordinal-");
	let firstDataStore;
	let secondDataStore;
	try {
		firstDataStore = new PiboDataStore(databasePath);
		secondDataStore = new PiboDataStore(databasePath);
		const firstStore = new PiboDataSessionStore(firstDataStore);
		const secondStore = new PiboDataSessionStore(secondDataStore);
		firstStore.create({ id: "ps-tool-routers", channel: "test", kind: "chat", profile: "base" });
		const firstRouter = new PiboSessionRouter({ sessionStore: firstStore, persistSession: false, routedSessionIdleTimeoutMs: false });
		const secondRouter = new PiboSessionRouter({ sessionStore: secondStore, persistSession: false, routedSessionIdleTimeoutMs: false });
		const firstEvents = [];
		const secondEvents = [];
		firstRouter.subscribe((event) => firstEvents.push(event));
		secondRouter.subscribe((event) => secondEvents.push(event));
		const base = { piboSessionId: "ps-tool-routers", eventId: "same-turn", toolCallId: "reused-tool", toolName: "read" };
		firstRouter.emitOutput({ ...base, type: "tool_call", args: { invocation: 1 }, argsComplete: true });
		secondRouter.emitOutput({ ...base, type: "tool_call", args: { invocation: 2 }, argsComplete: true });
		firstRouter.emitOutput({ ...base, type: "tool_execution_updated", args: {}, partialResult: "one" });
		secondRouter.emitOutput({ ...base, type: "tool_execution_updated", args: {}, partialResult: "two" });
		firstRouter.emitOutput({ ...base, type: "tool_execution_finished", result: "one", isError: false });
		secondRouter.emitOutput({ ...base, type: "tool_execution_finished", result: "two", isError: false });
		assert.deepEqual(new Set(firstEvents.map((event) => event.toolInvocationOrdinal)), new Set([0]));
		assert.deepEqual(new Set(secondEvents.map((event) => event.toolInvocationOrdinal)), new Set([1]));
		assert.notEqual(
			qualifiedToolNodeId("reused-tool", "same-turn", firstEvents[0].toolInvocationOrdinal),
			qualifiedToolNodeId("reused-tool", "same-turn", secondEvents[0].toolInvocationOrdinal),
		);
		const combinedView = buildTraceViewFromEvents({
			session: { id: "ps-tool-routers", piSessionId: "pi-tool-routers" },
			events: [...firstEvents, ...secondEvents].map((payload, index) => ({
				id: `stored-tool-${index}`,
				piboSessionId: payload.piboSessionId,
				eventSequence: index + 1,
				streamId: index + 1,
				type: payload.type,
				createdAt: `2026-08-30T00:00:${String(index).padStart(2, "0")}.000Z`,
				payload,
			})),
		});
		const toolNodes = combinedView.nodes.flatMap((node) => [node, ...node.children]).filter((node) => node.type === "tool.call");
		assert.deepEqual(new Set(toolNodes.map((node) => node.id)), new Set([
			qualifiedToolNodeId("reused-tool", "same-turn", 0),
			qualifiedToolNodeId("reused-tool", "same-turn", 1),
		]));
		assert.deepEqual(new Set(toolNodes.map((node) => node.output)), new Set(["one", "two"]));
		const ingest = new ChatDataIngestService(firstDataStore);
		ingest.ingestOutputEvent({ session: firstStore.get("ps-tool-routers"), actorId: "test", event: firstEvents[0] });
		ingest.ingestOutputEvent({ session: firstStore.get("ps-tool-routers"), actorId: "test", event: secondEvents[0] });
		firstDataStore.db.prepare("DELETE FROM session_tool_invocation_counters WHERE pibo_session_id = ?").run("ps-tool-routers");
		await firstRouter.disposeAll();
		await secondRouter.disposeAll();
		firstDataStore.close();
		secondDataStore.close();
		firstDataStore = undefined;
		secondDataStore = undefined;

		const reopenedDataStore = new PiboDataStore(databasePath);
		try {
			const reopenedStore = new PiboDataSessionStore(reopenedDataStore);
			const restartedRouter = new PiboSessionRouter({ sessionStore: reopenedStore, persistSession: false, routedSessionIdleTimeoutMs: false });
			const restartedEvents = [];
			restartedRouter.subscribe((event) => { restartedEvents.push(event); });
			restartedRouter.emitOutput({ ...base, type: "tool_call", args: { invocation: 3 }, argsComplete: true });
			assert.equal(restartedEvents.at(-1).toolInvocationOrdinal, 2);
			restartedRouter.emitOutput({ ...base, type: "tool_execution_updated", args: {}, partialResult: "replayed-two", toolInvocationOrdinal: 1 });
			restartedRouter.emitOutput({ ...base, type: "tool_execution_finished", result: "replayed-two", isError: false, toolInvocationOrdinal: 1 });
			assert.deepEqual(restartedEvents.slice(-2).map((event) => event.toolInvocationOrdinal), [1, 1]);
			await restartedRouter.disposeAll();
		} finally {
			reopenedDataStore.close();
		}
	} finally {
		firstDataStore?.close();
		secondDataStore?.close();
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

test("truly anonymous 1 MiB live event projection remains below the long-task budget", () => {
	const payload = {
		id: "live-instance:large-event:1",
		piboSessionId: "ps-large-projection",
		type: "execution_result",
		createdAt: fixedNow,
		payload: { type: "execution_result", piboSessionId: "ps-large-projection", action: "inspect", result: { padding: "x".repeat(1024 * 1024) } },
	};
	const startedAt = performance.now();
	const view = buildTraceViewFromEvents({ session: { id: "ps-large-projection", piSessionId: "pi-large" }, events: [payload] });
	const elapsedMs = performance.now() - startedAt;
	assert.equal(view.nodes.length, 1);
	assert.ok(elapsedMs < 50, `projection took ${elapsedMs.toFixed(1)}ms`);
});

test("mixed transcript, product, event, and execution chronology is total across every permutation", () => {
	const node = (id, type, source, orderKey) => ({ id, piboSessionId: "ps-order", type, title: id, status: "done", source, stableKey: id, orderKey, children: [] });
	const nodes = [
		node("transcript-user", "user.message", "transcript", { ...historyTraceOrder(0, 0, "user.message", "transcript"), chronologyMs: 1_000 }),
		node("product-answer", "assistant.message", "product-history", { ...historyTraceOrder(1, 0, "assistant.message", "product-history"), chronologyMs: 2_000 }),
		node("event-status", "execution.command", "event-log", { ...eventTraceOrder(99, "execution.command"), chronologyMs: 3_000 }),
		node("event-lifecycle", "agent.turn", "event-log", { ...eventTraceOrder(2, "agent.turn"), chronologyMs: 3_500 }),
		node("transcript-next-user", "user.message", "transcript", { ...historyTraceOrder(2, 0, "user.message", "transcript"), chronologyMs: 4_000 }),
	];
	const expected = nodes.map((entry) => entry.id);
	for (const permutation of permutations(nodes)) {
		assert.deepEqual([...permutation].sort(compareTraceNodes).map((entry) => entry.id), expected);
	}
});

test("product history without user rows keeps explicit turn boundaries and execution chronology", () => {
	const historyEntries = [
		{ id: "product:first", type: "message", source: "product", role: "assistant", turnId: "turn-one", assistantIndex: 0, sequence: 3, createdAt: "2026-08-30T01:00:02.000Z", content: "first answer" },
		{ id: "product:second", type: "message", source: "product", role: "assistant", turnId: "turn-two", assistantIndex: 0, sequence: 8, createdAt: "2026-08-30T01:00:07.000Z", content: "second answer" },
	];
	const stored = (eventSequence, createdAt, payload) => ({
		id: `stored-${eventSequence}`,
		piboSessionId: "ps-product-boundaries",
		eventSequence,
		streamId: eventSequence,
		createdAt,
		type: payload.type,
		payload: { piboSessionId: "ps-product-boundaries", renderSequence: Date.parse(createdAt) * 1_000, ...payload },
	});
	const events = [
		stored(1, "2026-08-30T01:00:00.000Z", { type: "message_queued", eventId: "turn-one", text: "first user", source: "user" }),
		stored(3, "2026-08-30T01:00:02.000Z", { type: "assistant_message", eventId: "turn-one", assistantIndex: 0, text: "first answer" }),
		stored(5, "2026-08-30T01:00:04.000Z", { type: "execution_result", eventId: "between", action: "checkpoint", result: { ok: true } }),
		stored(6, "2026-08-30T01:00:05.000Z", { type: "message_queued", eventId: "turn-two", text: "second user", source: "user" }),
		stored(8, "2026-08-30T01:00:07.000Z", { type: "assistant_message", eventId: "turn-two", assistantIndex: 0, text: "second answer" }),
	];
	const view = buildTraceViewFromEvents({
		session: { id: "ps-product-boundaries", piSessionId: "pi-product-boundaries" },
		events,
		historyEntries,
		status: "idle",
	});
	const roots = view.nodes.filter((node) => node.type !== "agent.turn");
	assert.deepEqual(roots.map((node) => node.type), ["user.message", "assistant.message", "execution.command", "user.message", "assistant.message"]);
	assert.deepEqual(roots.filter((node) => node.type === "assistant.message").map((node) => node.output), ["first answer", "second answer"]);
	assert.equal(new Set(roots.map((node) => node.id)).size, roots.length);
});
