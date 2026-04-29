import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { ChatWebReadModel } from "../dist/apps/chat/read-model.js";
import { buildTraceView, traceNodesFromEntries } from "../dist/apps/chat/trace.js";

function createTestSession(overrides = {}) {
	return {
		id: "chat:test",
		piSessionId: "missing-session-id",
		channel: "pibo.chat-web",
		kind: "chat",
		profile: "pibo-minimal",
		createdAt: "2026-04-29T08:00:00.000Z",
		updatedAt: "2026-04-29T08:00:00.000Z",
		...overrides,
	};
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

function flattenTraceNodes(nodes) {
	return nodes.flatMap((node) => [node, ...flattenTraceNodes(node.children ?? [])]);
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

test("chat read model keeps newest events when limiting session event history", () => {
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
	assert.equal(events.length, 1000);
	assert.equal(events.at(-1)?.type, "assistant_message");
	assert.equal(events.at(-1)?.payload.type, "assistant_message");
	assert.notEqual(events[0].payload.type === "assistant_delta" ? events[0].payload.text : undefined, "delta-0");
	readModel.close();
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
		["user.message", "model.reasoning", "assistant.message"],
	);
	const response = nodes[2];
	assert.equal(response.output, "final answer");
	assert.equal(response.children.length, 2);
	assert.deepEqual(
		response.children.map((node) => [node.type, node.toolCallId, node.output.content[0].text]),
		[
			["tool.call", "tool-1", "rules"],
			["tool.call", "tool-2", "package"],
		],
	);
});
