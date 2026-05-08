import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { ChatWebReadModel } from "../dist/apps/chat/read-model.js";
import { chatStreamFramesFromOutputEvent, createChatStreamState } from "../dist/apps/chat/stream.js";
import { buildSessionNodes, buildTraceView, traceNodesFromEntries } from "../dist/apps/chat/trace.js";
import { compareTraceOrder, liveTraceOrder, parseTraceStreamFrameId } from "../dist/shared/trace-order.js";

function createTestSession(overrides = {}) {
	return {
		id: "chat:test",
		piSessionId: "missing-session-id",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "codex-compat-openai-web",
		createdAt: "2026-04-29T08:00:00.000Z",
		updatedAt: "2026-04-29T08:00:00.000Z",
		...overrides,
	};
}

function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function createPersistedPiSession(cwd) {
	const manager = SessionManager.create(cwd);
	manager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "previous question" }],
	});
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "previous answer" }],
		stopReason: "stop",
	});
	return manager.getSessionId();
}

function createPersistedRunningPiSession(cwd) {
	const manager = SessionManager.create(cwd);
	manager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "previous question" }],
	});
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "previous answer" }],
		stopReason: "stop",
	});
	manager.appendMessage({
		role: "user",
		content: [{ type: "text", text: "active question" }],
	});
	manager.appendMessage({
		role: "assistant",
		content: [{ type: "text", text: "transcript partial" }],
	});
	return manager.getSessionId();
}

function flattenTraceNodes(nodes) {
	return nodes.flatMap((node) => [node, ...flattenTraceNodes(node.children ?? [])]);
}

function visibleChatStreamFrames(event, state) {
	return chatStreamFramesFromOutputEvent(event, state).filter((frame) => frame.type !== "RAW_EVENT");
}

test("chat read model resets interrupted running sessions on open", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-chat-read-"));
	const dbPath = join(dir, "web-chat.sqlite");
	const session = createTestSession();

	let readModel = new ChatWebReadModel(dbPath);
	readModel.upsertSession(session);
	readModel.recordEvent(
		{
			type: "assistant_delta",
			piboSessionId: session.id,
			eventId: "turn-1",
			text: "partial",
		},
		session,
	);
	assert.equal(readModel.listSessions().find((item) => item.piboSessionId === session.id)?.status, "running");
	readModel.close();

	readModel = new ChatWebReadModel(dbPath);
	assert.equal(readModel.listSessions().find((item) => item.piboSessionId === session.id)?.status, "idle");
	readModel.close();
});

test("chat stream adapter emits AGUI-style start delta and end frames", () => {
	const state = createChatStreamState();

	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "assistant_delta", piboSessionId: "chat:test", eventId: "turn-1", text: "hel" },
			state,
		),
		[
			{ type: "TEXT_MESSAGE_START", messageId: "turn-1", runId: "turn-1", role: "assistant" },
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "turn-1", runId: "turn-1", delta: "hel" },
		],
	);
	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "assistant_delta", piboSessionId: "chat:test", eventId: "turn-1", text: "lo" },
			state,
		),
		[{ type: "TEXT_MESSAGE_CONTENT", messageId: "turn-1", runId: "turn-1", delta: "lo" }],
	);
	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "assistant_message", piboSessionId: "chat:test", eventId: "turn-1", text: "hello" },
			state,
		),
		[{ type: "TEXT_MESSAGE_END", messageId: "turn-1", runId: "turn-1", finalText: "hello" }],
	);
});

test("chat stream adapter keeps separate assistant text content parts for one turn", () => {
	const state = createChatStreamState();

	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "assistant_delta", piboSessionId: "chat:test", eventId: "turn-1", contentIndex: 1, text: "first" },
			state,
		),
		[
			{ type: "TEXT_MESSAGE_START", messageId: "turn-1:assistant:1", runId: "turn-1", role: "assistant" },
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "turn-1:assistant:1", runId: "turn-1", delta: "first" },
		],
	);
	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "assistant_delta", piboSessionId: "chat:test", eventId: "turn-1", contentIndex: 5, text: "second" },
			state,
		),
		[
			{ type: "TEXT_MESSAGE_START", messageId: "turn-1:assistant:5", runId: "turn-1", role: "assistant" },
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "turn-1:assistant:5", runId: "turn-1", delta: "second" },
		],
	);
});

test("chat stream adapter prefers assistant message index over reused content index", () => {
	const state = createChatStreamState();

	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "assistant_delta", piboSessionId: "chat:test", eventId: "turn-1", assistantIndex: 0, contentIndex: 1, text: "plan" },
			state,
		),
		[
			{ type: "TEXT_MESSAGE_START", messageId: "turn-1:assistant:0", runId: "turn-1", role: "assistant" },
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "turn-1:assistant:0", runId: "turn-1", delta: "plan" },
		],
	);
	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "assistant_delta", piboSessionId: "chat:test", eventId: "turn-1", assistantIndex: 1, contentIndex: 1, text: "final" },
			state,
		),
		[
			{ type: "TEXT_MESSAGE_START", messageId: "turn-1:assistant:1", runId: "turn-1", role: "assistant" },
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "turn-1:assistant:1", runId: "turn-1", delta: "final" },
		],
	);
});

test("chat stream adapter emits progressive tool argument and result frames", () => {
	const state = createChatStreamState();

	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "tool_call", piboSessionId: "chat:test", eventId: "turn-1", toolCallId: "tc-1", toolName: "read", args: { path: "READ" }, argsComplete: false },
			state,
		),
		[
			{ type: "TOOL_CALL_START", toolCallId: "tc-1", toolName: "read", args: { path: "READ" }, runId: "turn-1" },
			{ type: "TOOL_CALL_ARGS", toolCallId: "tc-1", toolName: "read", args: { path: "READ" }, argsComplete: false, runId: "turn-1", sourceEventType: "tool_call" },
		],
	);
	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "tool_execution_updated", piboSessionId: "chat:test", eventId: "turn-1", toolCallId: "tc-1", toolName: "read", args: { path: "README.md" }, partialResult: "loading" },
			state,
		),
		[
			{ type: "TOOL_CALL_ARGS", toolCallId: "tc-1", toolName: "read", args: { path: "README.md" }, argsComplete: true, runId: "turn-1", partialResult: "loading", sourceEventType: "tool_execution_updated" },
		],
	);
	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "tool_execution_finished", piboSessionId: "chat:test", eventId: "turn-1", toolCallId: "tc-1", toolName: "read", result: "ok", isError: false },
			state,
		),
		[{ type: "TOOL_CALL_RESULT", toolCallId: "tc-1", toolName: "read", result: "ok", isError: false, runId: "turn-1" }],
	);
});

test("live trace order uses SSE stream id before frame index", () => {
	assert.deepEqual(parseTraceStreamFrameId("58722:1"), { streamId: 58722, frameIndex: 1 });
	assert.equal(parseTraceStreamFrameId("58722"), undefined);
	assert.equal(parseTraceStreamFrameId("58722:nope"), undefined);

	const first = liveTraceOrder(58722, 1, "tool.call");
	const second = liveTraceOrder(58723, 0, "model.reasoning");
	assert.equal(compareTraceOrder(first, second) < 0, true);
});

test("chat stream adapter keeps separate reasoning content parts for one turn", () => {
	const state = createChatStreamState();

	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "thinking_delta", piboSessionId: "chat:test", eventId: "turn-1", contentIndex: 0, text: "first" },
			state,
		),
		[
			{ type: "REASONING_MESSAGE_START", messageId: "turn-1:thinking:0", runId: "turn-1" },
			{ type: "REASONING_MESSAGE_CONTENT", messageId: "turn-1:thinking:0", runId: "turn-1", delta: "first" },
		],
	);
	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "thinking_delta", piboSessionId: "chat:test", eventId: "turn-1", contentIndex: 2, text: "second" },
			state,
		),
		[
			{ type: "REASONING_MESSAGE_START", messageId: "turn-1:thinking:2", runId: "turn-1" },
			{ type: "REASONING_MESSAGE_CONTENT", messageId: "turn-1:thinking:2", runId: "turn-1", delta: "second" },
		],
	);
});

test("chat stream adapter prefers pibo thinking segments over repeated provider content indexes", () => {
	const state = createChatStreamState();

	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "thinking_delta", piboSessionId: "chat:test", eventId: "turn-1", contentIndex: 0, thinkingIndex: 0, text: "first" },
			state,
		),
		[
			{ type: "REASONING_MESSAGE_START", messageId: "turn-1:thinking:0", runId: "turn-1" },
			{ type: "REASONING_MESSAGE_CONTENT", messageId: "turn-1:thinking:0", runId: "turn-1", delta: "first" },
		],
	);
	assert.deepEqual(
		visibleChatStreamFrames(
			{ type: "thinking_delta", piboSessionId: "chat:test", eventId: "turn-1", contentIndex: 0, thinkingIndex: 1, text: "second" },
			state,
		),
		[
			{ type: "REASONING_MESSAGE_START", messageId: "turn-1:thinking:1", runId: "turn-1" },
			{ type: "REASONING_MESSAGE_CONTENT", messageId: "turn-1:thinking:1", runId: "turn-1", delta: "second" },
		],
	);
});

test("chat read model ignores live-only deltas when limiting session event history", () => {
	const readModel = new ChatWebReadModel(":memory:");
	const session = createTestSession();
	readModel.upsertSession(session);

	for (let index = 0; index < 1005; index += 1) {
		readModel.recordEvent(
			{
				type: "assistant_delta",
				piboSessionId: session.id,
				eventId: "turn-1",
				text: `delta-${index}`,
			},
			session,
		);
	}
	readModel.recordEvent(
		{
			type: "assistant_message",
			piboSessionId: session.id,
			eventId: "turn-1",
			text: "final",
		},
		session,
	);

	const events = readModel.listEvents(session.id, 1000);
	assert.equal(events.length, 1);
	assert.equal(events.at(-1)?.type, "assistant_message");
	assert.equal(events.at(-1)?.payload.type, "assistant_message");

	const allEvents = readModel.listAllEvents(session.id);
	assert.equal(allEvents.length, 1);
	assert.equal(allEvents.at(-1)?.payload.type, "assistant_message");
	assert.deepEqual(readModel.countEventsByType({ eventTypes: ["assistant_delta"] }), []);
	readModel.close();
});

test("chat read model only promotes sessions on user input and final assistant output", () => {
	const readModel = new ChatWebReadModel(":memory:");
	const older = createTestSession({ id: "chat:older", createdAt: "2026-04-29T08:00:00.000Z", updatedAt: "2026-04-29T08:00:00.000Z" });
	const newer = createTestSession({ id: "chat:newer", createdAt: "2026-04-29T09:00:00.000Z", updatedAt: "2026-04-29T09:00:00.000Z" });
	readModel.upsertSession(older);
	readModel.upsertSession(newer);
	assert.deepEqual(readModel.listSessions().map((item) => item.piboSessionId), ["chat:newer", "chat:older"]);

	readModel.recordEvent({ type: "assistant_delta", piboSessionId: older.id, eventId: "turn-1", text: "streaming" }, older);
	assert.equal(readModel.listSessions().find((item) => item.piboSessionId === older.id)?.lastActivityAt, undefined);
	assert.deepEqual(readModel.listSessions().map((item) => item.piboSessionId), ["chat:newer", "chat:older"]);

	readModel.recordEvent({ type: "message_queued", piboSessionId: older.id, eventId: "turn-1", queuedMessages: 1, text: "hello" }, older);
	const userActivityAt = readModel.listSessions().find((item) => item.piboSessionId === older.id)?.lastActivityAt;
	assert.ok(userActivityAt);
	assert.deepEqual(readModel.listSessions().map((item) => item.piboSessionId), ["chat:older", "chat:newer"]);

	readModel.recordEvent({ type: "message_started", piboSessionId: newer.id, eventId: "turn-2", messageId: "message-2" }, newer);
	assert.equal(readModel.listSessions().find((item) => item.piboSessionId === newer.id)?.lastActivityAt, undefined);
	assert.deepEqual(readModel.listSessions().map((item) => item.piboSessionId), ["chat:older", "chat:newer"]);

	readModel.recordEvent({ type: "tool_execution_updated", piboSessionId: newer.id, eventId: "turn-2", toolCallId: "tool-1", toolName: "read", args: {}, partialResult: "chunk" }, newer);
	assert.equal(readModel.listSessions().find((item) => item.piboSessionId === newer.id)?.lastActivityAt, undefined);
	assert.deepEqual(readModel.listSessions().map((item) => item.piboSessionId), ["chat:older", "chat:newer"]);

	sleepSync(2);
	readModel.recordEvent({ type: "assistant_message", piboSessionId: newer.id, eventId: "turn-2", text: "final" }, newer);
	const assistantActivityAt = readModel.listSessions().find((item) => item.piboSessionId === newer.id)?.lastActivityAt;
	assert.ok(assistantActivityAt);
	assert.deepEqual(readModel.listSessions().map((item) => item.piboSessionId), ["chat:newer", "chat:older"]);
	readModel.close();
});

test("session nodes order by navigation activity instead of transcript metadata", async () => {
	const readModel = new ChatWebReadModel(":memory:");
	const cwd = mkdtempSync(join(tmpdir(), "pibo-chat-order-"));
	try {
		const older = createTestSession({
			id: "chat:older",
			createdAt: "2026-04-29T08:00:00.000Z",
			updatedAt: "2026-04-29T12:00:00.000Z",
		});
		const newer = createTestSession({
			id: "chat:newer",
			createdAt: "2026-04-29T09:00:00.000Z",
			updatedAt: "2026-04-29T09:00:00.000Z",
		});
		readModel.upsertSession(older);
		readModel.upsertSession(newer);

		let nodes = await buildSessionNodes([older, newer], readModel.listSessions(), cwd);
		assert.deepEqual(nodes.map((node) => node.piboSessionId), ["chat:newer", "chat:older"]);

		readModel.recordEvent({ type: "message_started", piboSessionId: older.id, eventId: "turn-1", messageId: "message-1" }, older);
		nodes = await buildSessionNodes([older, newer], readModel.listSessions(), cwd);
		assert.deepEqual(nodes.map((node) => node.piboSessionId), ["chat:newer", "chat:older"]);

		readModel.recordEvent({ type: "message_queued", piboSessionId: older.id, eventId: "turn-1", queuedMessages: 1, text: "hello" }, older);
		nodes = await buildSessionNodes([older, newer], readModel.listSessions(), cwd);
		assert.deepEqual(nodes.map((node) => node.piboSessionId), ["chat:older", "chat:newer"]);
	} finally {
		readModel.close();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("session nodes use chat turn status instead of raw runtime processing status", async () => {
	const readModel = new ChatWebReadModel(":memory:");
	const cwd = mkdtempSync(join(tmpdir(), "pibo-chat-status-"));
	try {
		const session = createTestSession();
		readModel.upsertSession(session);
		readModel.recordEvent({ type: "message_started", piboSessionId: session.id, eventId: "turn-1", text: "hello" }, session);
		readModel.recordEvent({ type: "message_finished", piboSessionId: session.id, eventId: "turn-1" }, session);

		const nodes = await buildSessionNodes([session], readModel.listSessions(), cwd, new Map(), new Map([[session.id, {
			piboSessionId: session.id,
			queuedMessages: 0,
			processing: true,
			streaming: true,
			activeTools: [],
			cwd,
			disposed: false,
		}]]));

		assert.equal(nodes[0].status, "idle");
	} finally {
		readModel.close();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("chat read model assigns stable per-session event sequence for durable events", () => {
	const readModel = new ChatWebReadModel(":memory:");
	const session = createTestSession();
	readModel.upsertSession(session);

	readModel.recordEvent({ type: "assistant_delta", piboSessionId: session.id, eventId: "turn-1", text: "a" }, session);
	readModel.recordEvent({ type: "assistant_delta", piboSessionId: session.id, eventId: "turn-1", text: "b" }, session);
	readModel.recordEvent({ type: "assistant_message", piboSessionId: session.id, eventId: "turn-1", text: "ab" }, session);

	assert.deepEqual(
		readModel.listEvents(session.id).map((event) => event.eventSequence),
		[1],
	);
	readModel.close();
});

test("chat read model migrates existing events before creating sequence index", () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-chat-read-migrate-"));
	const dbPath = join(dir, "web-chat.sqlite");
	const session = createTestSession();
	const db = new DatabaseSync(dbPath);
	try {
		db.exec(`
			CREATE TABLE web_chat_sessions (
				pibo_session_id TEXT PRIMARY KEY,
				pi_session_id TEXT NOT NULL,
				parent_id TEXT,
				profile TEXT NOT NULL,
				channel TEXT NOT NULL,
				kind TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				last_activity_at TEXT,
				status TEXT NOT NULL DEFAULT 'idle'
			);

			CREATE TABLE web_chat_events (
				id TEXT PRIMARY KEY,
				pibo_session_id TEXT NOT NULL,
				event_id TEXT,
				type TEXT NOT NULL,
				created_at TEXT NOT NULL,
				payload_json TEXT NOT NULL
			);
		`);
		db.prepare(
			"INSERT INTO web_chat_events (id, pibo_session_id, event_id, type, created_at, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
		).run(
			"event-1",
			session.id,
			"turn-1",
			"assistant_delta",
			"2026-04-29T08:00:00.000Z",
			JSON.stringify({ type: "assistant_delta", piboSessionId: session.id, eventId: "turn-1", text: "legacy" }),
		);
	} finally {
		db.close();
	}

	const readModel = new ChatWebReadModel(dbPath);
	try {
		assert.deepEqual(
			readModel.listEvents(session.id).map((event) => event.eventSequence),
			[1],
		);
		readModel.recordEvent({ type: "assistant_message", piboSessionId: session.id, eventId: "turn-1", text: "final" }, session);
		assert.deepEqual(
			readModel.listEvents(session.id).map((event) => event.eventSequence),
			[1, 2],
		);
	} finally {
		readModel.close();
		rmSync(dir, { recursive: true, force: true });
	}
});

test("chat read model keeps sessions running after live thinking finishes", () => {
	const readModel = new ChatWebReadModel(":memory:");
	const session = createTestSession();
	readModel.recordEvent(
		{
			type: "thinking_finished",
			piboSessionId: session.id,
			eventId: "turn-1",
			text: "finished reasoning",
		},
		session,
	);

	assert.equal(readModel.listSessions().find((item) => item.piboSessionId === session.id)?.status, "running");
	readModel.close();
});

test("chat read model keeps parent sessions running after subagent link events", () => {
	const readModel = new ChatWebReadModel(":memory:");
	const session = createTestSession();
	readModel.recordEvent(
		{
			type: "subagent_session",
			piboSessionId: session.id,
			toolCallId: "tool-1",
			toolName: "pibo_subagent_explorer",
			subagentName: "explorer",
			childPiboSessionId: "ps_child",
			threadKey: "qa",
		},
		session,
	);

	assert.equal(readModel.listSessions().find((item) => item.piboSessionId === session.id)?.status, "running");
	readModel.close();
});

test("chat session nodes sort new sessions without activity first", async () => {
	const older = createTestSession({
		id: "chat:older",
		piSessionId: "missing-older-session-id",
		createdAt: "2026-04-29T08:00:00.000Z",
		updatedAt: "2026-04-29T08:00:00.000Z",
	});
	const newer = createTestSession({
		id: "chat:newer",
		piSessionId: "missing-newer-session-id",
		createdAt: "2026-04-29T09:00:00.000Z",
		updatedAt: "2026-04-29T09:00:00.000Z",
	});

	const nodes = await buildSessionNodes([older, newer], []);

	assert.deepEqual(
		nodes.map((node) => node.piboSessionId),
		["chat:newer", "chat:older"],
	);
});

test("chat session nodes expose origin sessions for fork navigation", async () => {
	const origin = createTestSession({ id: "chat:origin" });
	const fork = createTestSession({
		id: "chat:fork",
		originId: origin.id,
		createdAt: "2026-04-29T09:00:00.000Z",
		updatedAt: "2026-04-29T09:00:00.000Z",
	});

	const nodes = await buildSessionNodes([origin, fork], []);
	const originNode = nodes.find((node) => node.piboSessionId === origin.id);
	const forkNode = nodes.find((node) => node.piboSessionId === fork.id);

	assert.equal(forkNode?.originId, origin.id);
	assert.deepEqual(
		originNode?.derivedSessions.map((session) => session.piboSessionId),
		[fork.id],
	);
});

test("chat trace preserves assistant content part order", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "assistant-1",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:00.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "first reason" },
					{ type: "text", text: "then answer" },
				],
				stopReason: "stop",
			},
		},
	]);

	assert.deepEqual(
		nodes.map((node) => node.type),
		["model.reasoning", "assistant.message"],
	);
	assert.equal(nodes[0].output, "first reason");
	assert.equal(nodes[1].output, "then answer");
	assert.equal(nodes[0].parentId, undefined);
	assert.equal(nodes[1].parentId, undefined);
});

test("chat trace assigns stable order metadata to persisted nodes", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "assistant-1",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:00.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "first reason" },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
					{ type: "text", text: "then answer" },
				],
				stopReason: "toolUse",
			},
		},
	]);

	assert.deepEqual(
		nodes.map((node) => [node.type, node.source, node.stableKey, node.orderKey?.contentPartIndex]),
		[
			["model.reasoning", "transcript", "entry:assistant-1:thinking:0", 0],
			["tool.call", "transcript", "tool:tool-1", 1],
			["assistant.message", "transcript", "entry:assistant-1:response:2", 2],
		],
	);
});

test("chat trace skips empty assistant reasoning entries", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "assistant-empty-reasoning",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:00.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "" },
					{ type: "thinking", thinking: " \n\t" },
					{ type: "text", text: "visible answer" },
				],
				stopReason: "stop",
			},
		},
	]);

	assert.deepEqual(
		nodes.map((node) => node.type),
		["assistant.message"],
	);
	assert.equal(nodes[0].output, "visible answer");
});

test("chat trace skips empty live reasoning events", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		status: "running",
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "thinking_finished",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "thinking_finished",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "",
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_message",
				createdAt: "2026-04-29T08:00:02.000Z",
				payload: {
					type: "assistant_message",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "visible answer",
				},
			},
		],
		cwd: process.cwd(),
	});

	assert.deepEqual(
		view.nodes.map((node) => node.type),
		["assistant.message"],
	);
	assert.equal(view.nodes[0].output, "visible answer");
});

test("chat trace aggregates live assistant deltas into a streaming response node", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		status: "running",
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "message_started",
				createdAt: "2026-04-29T08:00:00.000Z",
				payload: {
					type: "message_started",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "hello",
					source: "user",
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_delta",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "assistant_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "Hello",
				},
			},
			{
				id: "event-3",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_delta",
				createdAt: "2026-04-29T08:00:02.000Z",
				payload: {
					type: "assistant_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: " world",
				},
			},
		],
		cwd: process.cwd(),
	});

	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.ok(turn);
	assert.equal(turn.status, "running");
	assert.equal(turn.children.length, 1);
	assert.equal(turn.children[0].type, "assistant.message");
	assert.equal(turn.children[0].status, "running");
	assert.equal(turn.children[0].output, "Hello world");
});

test("chat trace keeps separate live assistant messages when content index is reused", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		status: "running",
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "message_started",
				createdAt: "2026-04-29T08:00:00.000Z",
				payload: {
					type: "message_started",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "hello",
					source: "user",
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_delta",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "assistant_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					assistantIndex: 0,
					contentIndex: 1,
					text: "plan",
				},
			},
			{
				id: "event-3",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_message",
				createdAt: "2026-04-29T08:00:02.000Z",
				payload: {
					type: "assistant_message",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					assistantIndex: 0,
					contentIndex: 1,
					text: "plan",
				},
			},
			{
				id: "event-4",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_delta",
				createdAt: "2026-04-29T08:00:03.000Z",
				payload: {
					type: "assistant_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					assistantIndex: 1,
					contentIndex: 1,
					text: "final",
				},
			},
		],
		cwd: process.cwd(),
	});

	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.ok(turn);
	const assistants = turn.children.filter((node) => node.type === "assistant.message");
	assert.equal(assistants.length, 2);
	assert.equal(assistants[0].output, "plan");
	assert.equal(assistants[0].status, "done");
	assert.equal(assistants[1].output, "final");
	assert.equal(assistants[1].status, "running");
});

test("chat trace replaces live assistant deltas with the final assistant message", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "message_started",
				createdAt: "2026-04-29T08:00:00.000Z",
				payload: {
					type: "message_started",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "hello",
					source: "user",
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_delta",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "assistant_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "partial",
				},
			},
			{
				id: "event-3",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_message",
				createdAt: "2026-04-29T08:00:02.000Z",
				payload: {
					type: "assistant_message",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "final answer",
				},
			},
		],
		cwd: process.cwd(),
	});

	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.ok(turn);
	assert.equal(turn.status, "done");
	assert.equal(turn.children.length, 1);
	assert.equal(turn.children[0].status, "done");
	assert.equal(turn.children[0].output, "final answer");
});

test("chat trace aggregates live thinking deltas into a reasoning node", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		status: "running",
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "message_started",
				createdAt: "2026-04-29T08:00:00.000Z",
				payload: {
					type: "message_started",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "think",
					source: "user",
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "thinking_delta",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "thinking_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "first",
				},
			},
			{
				id: "event-3",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "thinking_delta",
				createdAt: "2026-04-29T08:00:02.000Z",
				payload: {
					type: "thinking_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: " thought",
				},
			},
		],
		cwd: process.cwd(),
	});

	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.ok(turn);
	assert.equal(turn.children.length, 1);
	assert.equal(turn.children[0].type, "model.reasoning");
	assert.equal(turn.children[0].status, "running");
	assert.equal(turn.children[0].output, "first thought");
});

test("chat trace keeps live deltas when the start event fell outside retained history", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-chat-trace-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(dir, "agent");

	try {
		const piSessionId = createPersistedPiSession(dir);
		const session = createTestSession({ piSessionId, workspace: dir });
		const view = await buildTraceView({
			session,
			sessions: [session],
			status: "running",
			events: [
				{
					id: "event-1",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					type: "thinking_delta",
					createdAt: "2026-04-29T08:00:01.000Z",
					payload: {
						type: "thinking_delta",
						piboSessionId: "chat:test",
						eventId: "turn-1",
						text: "live thinking",
					},
				},
				{
					id: "event-2",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					type: "assistant_delta",
					createdAt: "2026-04-29T08:00:02.000Z",
					payload: {
						type: "assistant_delta",
						piboSessionId: "chat:test",
						eventId: "turn-1",
						text: "live answer",
					},
				},
			],
			cwd: dir,
		});

		const allNodes = flattenTraceNodes(view.nodes);
		assert.ok(allNodes.some((node) => node.type === "model.reasoning" && node.output === "live thinking"));
		assert.ok(allNodes.some((node) => node.type === "assistant.message" && node.output === "live answer"));
	} finally {
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
		rmSync(dir, { recursive: true, force: true });
	}
});

test("chat trace uses event log instead of duplicating the running transcript suffix", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-chat-running-trace-"));
	const piSessionId = createPersistedRunningPiSession(dir);
	const session = createTestSession({ piSessionId });

	const trace = await buildTraceView({
		session,
		sessions: [session],
		cwd: dir,
		status: "running",
		events: [
			{
				id: "event:queued",
				type: "message_queued",
				payload: {
					type: "message_queued",
					piboSessionId: session.id,
					eventId: "turn-active",
					text: "active question",
					source: "user",
				},
				createdAt: "2026-05-02T12:00:00.000Z",
				eventSequence: 1,
			},
			{
				id: "event:started",
				type: "message_started",
				payload: {
					type: "message_started",
					piboSessionId: session.id,
					eventId: "turn-active",
					text: "active question",
					source: "user",
				},
				createdAt: "2026-05-02T12:00:01.000Z",
				eventSequence: 2,
			},
			{
				id: "event:delta",
				type: "assistant_delta",
				payload: {
					type: "assistant_delta",
					piboSessionId: session.id,
					eventId: "turn-active",
					text: "live partial",
				},
				createdAt: "2026-05-02T12:00:02.000Z",
				eventSequence: 3,
			},
		],
	});

	const flat = flattenTraceNodes(trace.nodes);
	assert.equal(flat.filter((node) => node.type === "user.message" && node.summary === "active question").length, 1);
	assert.equal(flat.filter((node) => node.type === "assistant.message" && node.summary === "live partial").length, 1);
	assert.equal(flat.some((node) => node.type === "assistant.message" && node.summary === "transcript partial"), false);

	rmSync(dir, { recursive: true, force: true });
});

test("chat trace replaces live thinking deltas with finished reasoning text", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		status: "running",
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "message_started",
				createdAt: "2026-04-29T08:00:00.000Z",
				payload: {
					type: "message_started",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "think",
					source: "user",
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "thinking_delta",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "thinking_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "partial",
				},
			},
			{
				id: "event-3",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "thinking_finished",
				createdAt: "2026-04-29T08:00:02.000Z",
				payload: {
					type: "thinking_finished",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "final reasoning",
				},
			},
		],
		cwd: process.cwd(),
	});

	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.ok(turn);
	assert.equal(turn.children.length, 1);
	assert.equal(turn.children[0].status, "done");
	assert.equal(turn.children[0].output, "final reasoning");
});

test("chat trace keeps multiple live thinking blocks ordered around tools", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		status: "running",
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "message_started",
				createdAt: "2026-04-29T08:00:00.000Z",
				eventSequence: 1,
				payload: {
					type: "message_started",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "search",
					source: "user",
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "thinking_finished",
				createdAt: "2026-04-29T08:00:01.000Z",
				eventSequence: 2,
				payload: {
					type: "thinking_finished",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					contentIndex: 0,
					thinkingIndex: 0,
					text: "first reasoning",
				},
			},
			{
				id: "event-3",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "tool_execution_finished",
				createdAt: "2026-04-29T08:00:02.000Z",
				eventSequence: 3,
				payload: {
					type: "tool_execution_finished",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					toolCallId: "tool-1",
					toolName: "web_search",
					result: { ok: true },
					isError: false,
				},
			},
			{
				id: "event-4",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "thinking_finished",
				createdAt: "2026-04-29T08:00:03.000Z",
				eventSequence: 4,
				payload: {
					type: "thinking_finished",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					contentIndex: 0,
					thinkingIndex: 1,
					text: "second reasoning",
				},
			},
		],
		cwd: process.cwd(),
	});

	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.ok(turn);
	assert.deepEqual(
		turn.children.map((node) => [node.type, node.output]),
		[
			["model.reasoning", "first reasoning"],
			["tool.call", { ok: true }],
			["model.reasoning", "second reasoning"],
		],
	);
	assert.deepEqual(
		turn.children.map((node) => node.stableKey),
		["reasoning:turn-1:thinking:0", "tool:tool-1", "reasoning:turn-1:thinking:1"],
	);
});

test("chat trace closes interrupted live assistant deltas when the session is idle", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		status: "idle",
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "message_started",
				createdAt: "2026-04-29T08:00:00.000Z",
				payload: {
					type: "message_started",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "hello",
					source: "user",
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "turn-1",
				type: "assistant_delta",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "assistant_delta",
					piboSessionId: "chat:test",
					eventId: "turn-1",
					text: "partial answer",
				},
			},
		],
		cwd: process.cwd(),
	});

	const turn = view.nodes.find((node) => node.type === "agent.turn");
	assert.ok(turn);
	assert.equal(turn.status, "done");
	assert.equal(turn.children[0].status, "done");
	assert.equal(turn.children[0].output, "partial answer");
});

test("chat trace ignores stale streamed tool-call deltas after transcript persistence", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pibo-chat-trace-stale-tool-"));
	try {
		const piSessionId = createPersistedPiSession(dir);
		const session = createTestSession({ piSessionId, workspace: dir });
		const view = await buildTraceView({
			session,
			sessions: [session],
			status: "idle",
			events: [
				{
					id: "event-tool-call",
					piboSessionId: session.id,
					eventSequence: 1,
					eventId: "turn-stale",
					type: "tool_call",
					createdAt: "2026-04-29T08:01:00.000Z",
					payload: {
						type: "tool_call",
						piboSessionId: session.id,
						eventId: "turn-stale",
						toolCallId: "call_stale",
						toolName: "pibo_subagent_sub_agent",
						args: { message: "partial" },
					},
				},
			],
		});

		assert.equal(flattenTraceNodes(view.nodes).some((node) => node.toolCallId === "call_stale"), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("chat trace hides internal fork and switch execution results", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		events: [
			{
				id: "event-1",
				piboSessionId: "chat:test",
				eventId: "fork-1",
				type: "execution_result",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "execution_result",
					piboSessionId: "chat:test",
					eventId: "fork-1",
					action: "session.fork",
					result: { selectedText: "edit me" },
				},
			},
			{
				id: "event-2",
				piboSessionId: "chat:test",
				eventId: "switch-1",
				type: "execution_result",
				createdAt: "2026-04-29T08:00:02.000Z",
				payload: {
					type: "execution_result",
					piboSessionId: "chat:test",
					eventId: "switch-1",
					action: "session.switch",
					result: { ok: true },
				},
			},
			{
				id: "event-3",
				piboSessionId: "chat:test",
				eventId: "status-1",
				type: "execution_result",
				createdAt: "2026-04-29T08:00:03.000Z",
				payload: {
					type: "execution_result",
					piboSessionId: "chat:test",
					eventId: "status-1",
					action: "status",
					result: { ok: true },
				},
			},
		],
		cwd: process.cwd(),
	});

	assert.deepEqual(
		view.nodes.map((node) => [node.type, node.title]),
		[["execution.command", "status"]],
	);
});

test("chat trace renders run notifications as yielded run nodes", async () => {
	const session = createTestSession();
	const view = await buildTraceView({
		session,
		sessions: [session],
		status: "running",
		events: [
			{
				id: "event-1",
				piboSessionId: session.id,
				type: "message_queued",
				createdAt: "2026-04-29T08:00:00.000Z",
				payload: {
					type: "message_queued",
					piboSessionId: session.id,
					eventId: "service-1",
					queuedMessages: 1,
					source: "service",
					text: [
						"<pibo_run_notification>",
						JSON.stringify({
							completed: [],
							failed: [
								{
									runId: "run_1",
									kind: "tool",
									status: "failed",
									toolName: "pibo_subagent_explorer",
									summary: "pibo_subagent_explorer run failed.",
								},
							],
							cancelled: [],
							running: [],
							instruction: "Use pibo_run_read for completed or failed runs.",
						}),
						"</pibo_run_notification>",
					].join("\n"),
				},
			},
			{
				id: "event-2",
				piboSessionId: session.id,
				type: "message_started",
				createdAt: "2026-04-29T08:00:00.010Z",
				payload: {
					type: "message_started",
					piboSessionId: session.id,
					eventId: "service-1",
					source: "service",
					text: "<pibo_run_notification>{}</pibo_run_notification>",
				},
			},
		],
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "yielded.run");
	assert.equal(view.nodes[0].status, "error");
	assert.equal(view.nodes[0].runId, "run_1");
	assert.match(view.nodes[0].summary, /1 failed/);
});

test("chat trace shows async subagent runs under pibo_run_start tool calls", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "assistant-tools",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:01.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "tool-1",
						name: "pibo_run_start",
						arguments: {
							toolName: "pibo_subagent_explorer",
							arguments: { message: "inspect auth", threadKey: "qa" },
							completionPolicy: "tracked",
						},
					},
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "result-1",
			parentId: "assistant-tools",
			timestamp: "2026-04-29T08:00:02.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-1",
				toolName: "pibo_run_start",
				content: [{ type: "text", text: "Started yielded run run_1." }],
				details: {
					runId: "run_1",
					kind: "tool",
					ownerPiboSessionId: "chat:test",
					status: "running",
					completionPolicy: "tracked",
					consumed: false,
					toolName: "pibo_subagent_explorer",
					createdAt: "2026-04-29T08:00:02.000Z",
					updatedAt: "2026-04-29T08:00:02.000Z",
				},
				isError: false,
			},
		},
	]);

	assert.equal(nodes.length, 1);
	assert.equal(nodes[0].type, "tool.call");
	assert.equal(nodes[0].title, "pibo_run_start");
	assert.equal(nodes[0].children.length, 1);
	assert.equal(nodes[0].children[0].type, "agent.async");
	assert.equal(nodes[0].children[0].title, "explorer");
	assert.equal(nodes[0].children[0].runId, "run_1");
	assert.equal(nodes[0].children[0].input.startedBy, "pibo_run_start");
});

test("chat trace updates async subagent runs from later run-control snapshots", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "assistant-start",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:01.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "tool-start",
						name: "pibo_run_start",
						arguments: {
							toolName: "pibo_subagent_explorer",
							arguments: { message: "inspect auth" },
							completionPolicy: "tracked",
						},
					},
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "result-start",
			parentId: "assistant-start",
			timestamp: "2026-04-29T08:00:02.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-start",
				toolName: "pibo_run_start",
				content: [{ type: "text", text: "Started yielded run run_1." }],
				details: {
					runId: "run_1",
					kind: "tool",
					status: "running",
					toolName: "pibo_subagent_explorer",
					updatedAt: "2026-04-29T08:00:02.000Z",
				},
				isError: false,
			},
		},
		{
			type: "message",
			id: "assistant-wait",
			parentId: "result-start",
			timestamp: "2026-04-29T08:00:03.000Z",
			message: {
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "tool-wait",
						name: "pibo_run_wait",
						arguments: { runId: "run_1" },
					},
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "result-wait",
			parentId: "assistant-wait",
			timestamp: "2026-04-29T08:00:04.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-wait",
				toolName: "pibo_run_wait",
				content: [{ type: "text", text: "Run run_1 reached completed." }],
				details: {
					runId: "run_1",
					kind: "tool",
					status: "completed",
					toolName: "pibo_subagent_explorer",
					updatedAt: "2026-04-29T08:00:04.000Z",
					completedAt: "2026-04-29T08:00:04.000Z",
				},
				isError: false,
			},
		},
	]);

	assert.equal(nodes[0].children[0].type, "agent.async");
	assert.equal(nodes[0].children[0].status, "done");
	assert.equal(nodes[0].children[0].completedAt, "2026-04-29T08:00:04.000Z");
	assert.equal(nodes[0].children[0].output.status, "completed");
});

test("chat trace links repeated subagent calls to their exact child sessions", async () => {
	const parent = createTestSession();
	const childDirect = createTestSession({
		id: "ps_child_direct",
		piSessionId: "pi_child_direct",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "sub-agent",
		parentId: parent.id,
		metadata: {
			subagentName: "sub-agent",
			subagentToolName: "pibo_subagent_sub_agent",
			threadKey: "direct-thread",
		},
	});
	const childAsync = createTestSession({
		id: "ps_child_async",
		piSessionId: "pi_child_async",
		channel: "pibo.subagents",
		kind: "subagent",
		profile: "sub-agent",
		parentId: parent.id,
		metadata: {
			subagentName: "sub-agent",
			subagentToolName: "pibo_subagent_sub_agent",
			threadKey: "async-thread",
		},
	});

	const view = await buildTraceView({
		session: parent,
		sessions: [parent, childAsync, childDirect],
		events: [
			{
				id: "event-1",
				piboSessionId: parent.id,
				eventId: "turn-1",
				type: "tool_execution_started",
				createdAt: "2026-04-29T08:00:00.000Z",
				payload: {
					type: "tool_execution_started",
					piboSessionId: parent.id,
					eventId: "turn-1",
					toolCallId: "tool-direct",
					toolName: "pibo_subagent_sub_agent",
					args: { message: "inspect directly" },
				},
			},
			{
				id: "event-2",
				piboSessionId: parent.id,
				type: "subagent_session",
				createdAt: "2026-04-29T08:00:01.000Z",
				payload: {
					type: "subagent_session",
					piboSessionId: parent.id,
					toolCallId: "tool-direct",
					toolName: "pibo_subagent_sub_agent",
					subagentName: "sub-agent",
					childPiboSessionId: childDirect.id,
					threadKey: "direct-thread",
				},
			},
			{
				id: "event-3",
				piboSessionId: parent.id,
				eventId: "turn-1",
				type: "tool_execution_finished",
				createdAt: "2026-04-29T08:00:02.000Z",
				payload: {
					type: "tool_execution_finished",
					piboSessionId: parent.id,
					eventId: "turn-1",
					toolCallId: "tool-direct",
					toolName: "pibo_subagent_sub_agent",
					result: { content: [{ type: "text", text: "direct done" }] },
					isError: false,
				},
			},
			{
				id: "event-4",
				piboSessionId: parent.id,
				eventId: "turn-1",
				type: "tool_execution_started",
				createdAt: "2026-04-29T08:00:03.000Z",
				payload: {
					type: "tool_execution_started",
					piboSessionId: parent.id,
					eventId: "turn-1",
					toolCallId: "tool-run-start",
					toolName: "pibo_run_start",
					args: {
						toolName: "pibo_subagent_sub_agent",
						arguments: { message: "inspect async" },
						completionPolicy: "tracked",
					},
				},
			},
			{
				id: "event-5",
				piboSessionId: parent.id,
				type: "subagent_session",
				createdAt: "2026-04-29T08:00:04.000Z",
				payload: {
					type: "subagent_session",
					piboSessionId: parent.id,
					toolCallId: "tool-run-start",
					toolName: "pibo_subagent_sub_agent",
					subagentName: "sub-agent",
					childPiboSessionId: childAsync.id,
					threadKey: "async-thread",
				},
			},
			{
				id: "event-6",
				piboSessionId: parent.id,
				eventId: "turn-1",
				type: "tool_execution_finished",
				createdAt: "2026-04-29T08:00:05.000Z",
				payload: {
					type: "tool_execution_finished",
					piboSessionId: parent.id,
					eventId: "turn-1",
					toolCallId: "tool-run-start",
					toolName: "pibo_run_start",
					result: {
						details: {
							runId: "run_async",
							kind: "tool",
							status: "running",
							toolName: "pibo_subagent_sub_agent",
						},
					},
					isError: false,
				},
			},
		],
	});

	const allNodes = flattenTraceNodes(view.nodes);
	const direct = allNodes.find((node) => node.toolCallId === "tool-direct");
	const async = allNodes.find((node) => node.type === "agent.async" && node.runId === "run_async");

	assert.equal(direct?.linkedPiboSessionId, childDirect.id);
	assert.equal(async?.linkedPiboSessionId, childAsync.id);
});

test("chat trace groups tool calls with the final assistant response", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "user-1",
			parentId: "root",
			timestamp: "2026-04-29T08:00:00.000Z",
			message: {
				role: "user",
				content: [{ type: "text", text: "read files" }],
			},
		},
		{
			type: "message",
			id: "assistant-tools",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:01.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "plan" },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "RULES.md" } },
					{ type: "toolCall", id: "tool-2", name: "read", arguments: { path: "package.json" } },
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "result-1",
			parentId: "assistant-tools",
			timestamp: "2026-04-29T08:00:02.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-1",
				toolName: "read",
				content: [{ type: "text", text: "rules" }],
				isError: false,
			},
		},
		{
			type: "message",
			id: "result-2",
			parentId: "result-1",
			timestamp: "2026-04-29T08:00:03.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-2",
				toolName: "read",
				content: [{ type: "text", text: "package" }],
				isError: false,
			},
		},
		{
			type: "message",
			id: "assistant-final",
			parentId: "result-2",
			timestamp: "2026-04-29T08:00:04.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "final answer" }],
				stopReason: "stop",
			},
		},
	]);

	assert.deepEqual(
		nodes.map((node) => node.type),
		["user.message", "model.reasoning", "tool.call", "tool.call", "assistant.message"],
	);
	assert.deepEqual(
		nodes.slice(2, 4).map((node) => [node.type, node.toolCallId, node.output.content[0].text]),
		[
			["tool.call", "tool-1", "rules"],
			["tool.call", "tool-2", "package"],
		],
	);
	const response = nodes[4];
	assert.equal(response.output, "final answer");
	assert.equal(response.children.length, 0);
});

test("chat trace keeps final assistant response after intermediate assistant text and tools", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "assistant-progress",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:01.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "plan" },
					{ type: "text", text: "I will inspect first." },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "result-1",
			parentId: "assistant-progress",
			timestamp: "2026-04-29T08:00:02.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-1",
				toolName: "read",
				content: [{ type: "text", text: "readme" }],
				isError: false,
			},
		},
		{
			type: "message",
			id: "assistant-final",
			parentId: "result-1",
			timestamp: "2026-04-29T08:00:03.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "final answer" }],
				stopReason: "stop",
			},
		},
	]);

	assert.deepEqual(
		nodes.map((node) => [node.type, node.output]),
		[
			["model.reasoning", "plan"],
			["assistant.message", "I will inspect first."],
			["tool.call", { content: [{ type: "text", text: "readme" }] }],
			["assistant.message", "final answer"],
		],
	);
});

test("chat trace preserves interleaved persisted reasoning and tool order", () => {
	const nodes = traceNodesFromEntries("chat:test", [
		{
			type: "message",
			id: "assistant-first-tools",
			parentId: "user-1",
			timestamp: "2026-04-29T08:00:01.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "think before first tool" },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "RULES.md" } },
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "result-1",
			parentId: "assistant-first-tools",
			timestamp: "2026-04-29T08:00:02.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-1",
				toolName: "read",
				content: [{ type: "text", text: "rules" }],
				isError: false,
			},
		},
		{
			type: "message",
			id: "assistant-second-tools",
			parentId: "result-1",
			timestamp: "2026-04-29T08:00:03.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "think after first tool" },
					{ type: "toolCall", id: "tool-2", name: "read", arguments: { path: "GLOSSARY.md" } },
					{ type: "toolCall", id: "tool-3", name: "read", arguments: { path: "DESIGN.md" } },
				],
				stopReason: "toolUse",
			},
		},
		{
			type: "message",
			id: "result-2",
			parentId: "assistant-second-tools",
			timestamp: "2026-04-29T08:00:04.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-2",
				toolName: "read",
				content: [{ type: "text", text: "glossary" }],
				isError: false,
			},
		},
		{
			type: "message",
			id: "result-3",
			parentId: "result-2",
			timestamp: "2026-04-29T08:00:05.000Z",
			message: {
				role: "toolResult",
				toolCallId: "tool-3",
				toolName: "read",
				content: [{ type: "text", text: "design" }],
				isError: false,
			},
		},
		{
			type: "message",
			id: "assistant-final",
			parentId: "result-3",
			timestamp: "2026-04-29T08:00:06.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "think before final" },
					{ type: "text", text: "final answer" },
				],
				stopReason: "stop",
			},
		},
	]);

	assert.deepEqual(
		nodes.map((node) => [node.type, node.toolCallId, node.output]),
		[
			["model.reasoning", undefined, "think before first tool"],
			["tool.call", "tool-1", { content: [{ type: "text", text: "rules" }] }],
			["model.reasoning", undefined, "think after first tool"],
			["tool.call", "tool-2", { content: [{ type: "text", text: "glossary" }] }],
			["tool.call", "tool-3", { content: [{ type: "text", text: "design" }] }],
			["model.reasoning", undefined, "think before final"],
			["assistant.message", undefined, "final answer"],
		],
	);
});
