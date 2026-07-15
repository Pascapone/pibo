import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
	compactAgentDelegationTask,
	extractAgentDelegationName,
	formatAgentDelegationDuration,
	resolveAgentDelegationStatus,
} from "../dist/session-ui/index.js";
import { buildCompactTerminalRows } from "../dist/session-ui/terminalRows.js";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";

function childSignal(overrides = {}) {
	return {
		localStatus: "idle",
		aggregateStatus: "idle",
		isLocalActive: false,
		hasActiveDescendant: false,
		isTreeActive: false,
		isSettled: true,
		hasError: false,
		hasErrorDescendant: false,
		...overrides,
	};
}

test("delegation helpers map child signals and extract display content", () => {
	assert.equal(resolveAgentDelegationStatus(childSignal({ localStatus: "running", isTreeActive: true })), "running");
	assert.equal(resolveAgentDelegationStatus(childSignal({ isSettled: false })), "running");
	assert.equal(resolveAgentDelegationStatus(childSignal(), "running"), "running");
	assert.equal(resolveAgentDelegationStatus(childSignal({ aggregateStatus: "done" })), "completed");
	assert.equal(resolveAgentDelegationStatus(childSignal({ localStatus: "error", hasError: true })), "failed");
	assert.equal(resolveAgentDelegationStatus(childSignal({ aggregateStatus: "cancelled" })), "cancelled");
	assert.equal(resolveAgentDelegationStatus(undefined, "error"), "failed");
	assert.equal(resolveAgentDelegationStatus(childSignal({ localStatus: "running", isTreeActive: true }), "done", true), "completed");
	assert.equal(resolveAgentDelegationStatus(childSignal({ aggregateStatus: "cancelled" }), "done", true), "completed");
	assert.equal(resolveAgentDelegationStatus(childSignal({ localStatus: "error", hasError: true }), "done", true), "completed");
	assert.equal(resolveAgentDelegationStatus(childSignal({ aggregateStatus: "cancelled" }), "error", true), "failed");
	assert.equal(extractAgentDelegationName({ message: "inspect" }, "pibo_subagent_explorer"), "Explorer");
	assert.equal(extractAgentDelegationName({ subagentName: "code_worker" }, "pibo_subagent_worker"), "Code Worker");
	assert.equal(compactAgentDelegationTask({ message: "Inspect the trace merge" }), "Inspect the trace merge");
	assert.equal(formatAgentDelegationDuration(65_000), "1m 5s");
});

test("terminal delegation rows preserve card metadata and task content", () => {
	const rows = buildCompactTerminalRows({
		piboSessionId: "ps-root",
		piSessionId: "pi-root",
		title: "Root",
		version: "1",
		nodes: [{
			id: "tool-delegation",
			piboSessionId: "ps-root",
			type: "agent.delegation",
			title: "pibo_subagent_worker",
			status: "error",
			startedAt: "2026-01-01T00:00:00.000Z",
			completedAt: "2026-01-01T00:00:05.000Z",
			durationMs: 5_000,
			summary: "worker",
			input: { message: "Implement the focused fix", threadKey: "issue-268", subagentName: "worker" },
			linkedPiboSessionId: "ps-child",
			children: [],
		}],
		rawEvents: [],
	}, { showThinking: true });

	assert.equal(rows.length, 1);
	assert.equal(rows[0].kind, "agent.delegation");
	assert.equal(rows[0].status, "error");
	assert.equal(rows[0].errorKind, "tool");
	assert.equal(rows[0].title, "pibo_subagent_worker");
	assert.equal(rows[0].summary, "worker");
	assert.equal(rows[0].linkedPiboSessionId, "ps-child");
	assert.equal(rows[0].startedAt, "2026-01-01T00:00:00.000Z");
	assert.equal(rows[0].completedAt, "2026-01-01T00:00:05.000Z");
	assert.equal(rows[0].durationMs, 5_000);
	assert.equal(rows[0].input.message, "Implement the focused fix");
});

test("subagent session materialization enriches delegation without replacing raw arguments", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps-root", piSessionId: "pi-root", title: "Root" },
		status: "running",
		events: [
			{
				id: "event-tool",
				piboSessionId: "ps-root",
				eventSequence: 1,
				type: "tool_call",
				createdAt: "2026-01-01T00:00:00.000Z",
				payload: {
					type: "tool_call",
					piboSessionId: "ps-root",
					eventId: "turn-1",
					toolCallId: "tool-1",
					toolName: "pibo_subagent_explorer",
					args: { message: "Find the trace path", threadKey: "research" },
				},
			},
			{
				id: "event-link",
				piboSessionId: "ps-root",
				eventSequence: 2,
				type: "subagent_session",
				createdAt: "2026-01-01T00:00:01.000Z",
				payload: {
					type: "subagent_session",
					piboSessionId: "ps-root",
					toolCallId: "tool-1",
					toolName: "pibo_subagent_explorer",
					subagentName: "explorer",
					childPiboSessionId: "ps-child",
					threadKey: "research",
				},
			},
		],
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "agent.delegation");
	assert.deepEqual(view.nodes[0].input, {
		message: "Find the trace path",
		threadKey: "research",
		subagentName: "explorer",
	});
	assert.equal(view.nodes[0].linkedPiboSessionId, "ps-child");
});

test("legacy subagent link events without a tool call id do not create duplicate cards", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps-root", piSessionId: "pi-root", title: "Root" },
		status: "idle",
		events: [
			{
				id: "event-tool",
				piboSessionId: "ps-root",
				eventSequence: 1,
				type: "tool_execution_finished",
				createdAt: "2026-01-01T00:00:00.000Z",
				payload: {
					type: "tool_execution_finished",
					piboSessionId: "ps-root",
					eventId: "turn-legacy",
					toolCallId: "tool-legacy",
					toolName: "pibo_subagent_explorer",
					args: { message: "Inspect legacy delegation", threadKey: "legacy" },
					result: "failed",
					isError: true,
				},
			},
			{
				id: "event-link",
				piboSessionId: "ps-root",
				eventSequence: 2,
				type: "subagent_session",
				createdAt: "2026-01-01T00:00:01.000Z",
				payload: {
					type: "subagent_session",
					piboSessionId: "ps-root",
					toolName: "pibo_subagent_explorer",
					subagentName: "explorer",
					childPiboSessionId: "ps-child",
					threadKey: "legacy",
				},
			},
		],
	});

	assert.equal(view.nodes.length, 1);
	assert.equal(view.nodes[0].type, "agent.delegation");
	assert.equal(view.nodes[0].status, "error");
	assert.equal(view.nodes[0].linkedPiboSessionId, "ps-child");
	assert.equal(view.nodes[0].input.message, "Inspect legacy delegation");
});

test("legacy subagent links attach to the newest reused-child delegation", () => {
	const view = buildTraceViewFromEvents({
		session: { id: "ps-root", piSessionId: "pi-root", title: "Root" },
		status: "idle",
		events: [
			{
				id: "event-tool-1",
				piboSessionId: "ps-root",
				eventSequence: 1,
				type: "tool_execution_finished",
				createdAt: "2026-01-01T00:00:00.000Z",
				payload: {
					type: "tool_execution_finished",
					piboSessionId: "ps-root",
					eventId: "turn-1",
					toolCallId: "tool-1",
					toolName: "pibo_subagent_explorer",
					args: { message: "First pass", threadKey: "reused" },
					result: "done",
					isError: false,
				},
			},
			{
				id: "event-link-1",
				piboSessionId: "ps-root",
				eventSequence: 2,
				type: "subagent_session",
				createdAt: "2026-01-01T00:00:01.000Z",
				payload: {
					type: "subagent_session",
					piboSessionId: "ps-root",
					toolName: "pibo_subagent_explorer",
					subagentName: "explorer",
					childPiboSessionId: "ps-child",
					threadKey: "reused",
				},
			},
			{
				id: "event-tool-2",
				piboSessionId: "ps-root",
				eventSequence: 3,
				type: "tool_execution_finished",
				createdAt: "2026-01-01T00:00:02.000Z",
				payload: {
					type: "tool_execution_finished",
					piboSessionId: "ps-root",
					eventId: "turn-2",
					toolCallId: "tool-2",
					toolName: "pibo_subagent_explorer",
					args: { message: "Second pass", threadKey: "reused" },
					result: "done",
					isError: false,
				},
			},
			{
				id: "event-link-2",
				piboSessionId: "ps-root",
				eventSequence: 4,
				type: "subagent_session",
				createdAt: "2026-01-01T00:00:03.000Z",
				payload: {
					type: "subagent_session",
					piboSessionId: "ps-root",
					toolName: "pibo_subagent_explorer",
					subagentName: "explorer",
					childPiboSessionId: "ps-child",
					threadKey: "reused",
				},
			},
		],
	});

	assert.equal(view.nodes.length, 2);
	assert.deepEqual(view.nodes.map((node) => node.linkedPiboSessionId), ["ps-child", "ps-child"]);
	assert.deepEqual(view.nodes.map((node) => node.input.message), ["First pass", "Second pass"]);
});

test("terminal and trace share AgentDelegationCard and full signals are threaded", () => {
	const compact = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"), "utf8");
	const span = fs.readFileSync(path.resolve("src/apps/chat-ui/src/tracing/SpanNode.tsx"), "utf8");
	const app = fs.readFileSync(path.resolve("src/apps/chat-ui/src/App.tsx"), "utf8");
	const pane = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-trace-pane.tsx"), "utf8");
	const props = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-trace-view-props.ts"), "utf8");
	const traceView = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-views/TraceSessionView.tsx"), "utf8");
	const timeline = fs.readFileSync(path.resolve("src/apps/chat-ui/src/tracing/TraceTimeline.tsx"), "utf8");

	assert.match(compact, /<AgentDelegationCard/);
	assert.match(span, /span\.spanType === "agent\.delegation"[\s\S]*<AgentDelegationCard/);
	assert.match(app, /signals=\{sessionSignals \?\? undefined\}/);
	assert.match(pane, /signals\?: PiboSignalSnapshot/);
	assert.match(props, /signals: input\.signals/);
	assert.match(props, /adaptTrace\(input\.currentTraceView\.piboSessionId/);
	assert.match(traceView, /signals=\{signals\}/);
	assert.match(timeline, /signals=\{signals\}/);
});
