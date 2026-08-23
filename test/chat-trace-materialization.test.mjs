import assert from "node:assert/strict";
import test from "node:test";
import { buildTraceViewFromEvents } from "./helpers/pi-history.mjs";
import { storedPiboEventFromV2Row } from "../dist/apps/chat/data/chat-data-mappers.js";
import { createTraceViewVersion } from "../dist/apps/chat/trace.js";

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
