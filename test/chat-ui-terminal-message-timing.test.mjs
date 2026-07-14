import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildTraceViewFromEvents } from "../dist/shared/trace-engine.js";
import {
	buildCompactTerminalRows,
	findActiveTurnStartedAt,
	formatTerminalDuration,
} from "../dist/session-ui/terminalRows.js";

function event(sequence, type, createdAt, payload) {
	return {
		id: `event-${sequence}-${type}`,
		piboSessionId: "ps-timing",
		eventSequence: sequence,
		type,
		createdAt,
		payload: { ...payload, type, piboSessionId: "ps-timing" },
	};
}

function view(events, status = "idle", transcriptEntries) {
	return buildTraceViewFromEvents({
		session: { id: "ps-timing", piSessionId: "pi-timing", title: "Timing" },
		status,
		events,
		transcriptEntries,
	});
}

test("active turn timing starts at message_started and freezes at message_finished", () => {
	const active = view([
		event(1, "message_queued", "2026-07-14T10:00:00.000Z", { eventId: "turn-1", text: "Hello", source: "user", queuedMessages: 1 }),
		event(2, "message_started", "2026-07-14T10:00:03.000Z", { eventId: "turn-1", text: "Hello", source: "user" }),
		event(3, "assistant_message", "2026-07-14T10:00:08.000Z", { eventId: "turn-1", text: "Final answer" }),
	], "running");

	assert.equal(findActiveTurnStartedAt(active), "2026-07-14T10:00:03.000Z");
	const activeRows = buildCompactTerminalRows(active, { showThinking: true });
	assert.equal(activeRows.find((row) => row.kind === "message.user")?.startedAt, "2026-07-14T10:00:00.000Z");
	const activeAssistant = activeRows.find((row) => row.kind === "message.assistant");
	assert.equal(activeAssistant?.completedAt, undefined);
	assert.equal(activeAssistant?.durationMs, undefined);
	const activeTurn = active.nodes.find((node) => node.type === "agent.turn");
	assert.equal(activeTurn?.status, "running", "assistant_message must not close the turn before message_finished");
	assert.equal(activeTurn?.completedAt, undefined);

	const completed = view([
		event(1, "message_queued", "2026-07-14T10:00:00.000Z", { eventId: "turn-1", text: "Hello", source: "user", queuedMessages: 1 }),
		event(2, "message_started", "2026-07-14T10:00:03.000Z", { eventId: "turn-1", text: "Hello", source: "user" }),
		event(3, "assistant_message", "2026-07-14T10:00:08.000Z", { eventId: "turn-1", text: "Final answer" }),
		event(4, "message_finished", "2026-07-14T10:00:13.000Z", { eventId: "turn-1", source: "user" }),
	]);

	assert.equal(findActiveTurnStartedAt(completed), undefined);
	const completedAssistant = buildCompactTerminalRows(completed, { showThinking: true })
		.find((row) => row.kind === "message.assistant");
	assert.equal(completedAssistant?.startedAt, "2026-07-14T10:00:03.000Z");
	assert.equal(completedAssistant?.completedAt, "2026-07-14T10:00:13.000Z");
	assert.equal(completedAssistant?.durationMs, 10_000);

	const failed = view([
		event(1, "message_started", "2026-07-14T10:02:00.000Z", { eventId: "turn-error", text: "Fail", source: "user" }),
		event(2, "session_error", "2026-07-14T10:02:01.000Z", { eventId: "turn-error", error: "provider failed" }),
	]);
	assert.equal(findActiveTurnStartedAt(failed), undefined, "terminal errors must not leave the Working footer active");
});

test("persisted transcript keeps queued user time and final turn timing after reload", () => {
	const transcriptEntries = [
		{
			id: "entry-user",
			type: "message",
			timestamp: "2026-07-14T10:00:00.000Z",
			message: { role: "user", content: [{ type: "text", text: "Use a tool" }] },
		},
		{
			id: "entry-assistant-intermediate",
			type: "message",
			timestamp: "2026-07-14T10:00:05.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "I will inspect it." },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
				],
				stopReason: "toolUse",
			},
		},
		{
			id: "entry-tool",
			type: "message",
			timestamp: "2026-07-14T10:00:07.000Z",
			message: { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: "ok", isError: false },
		},
		{
			id: "entry-assistant-final",
			type: "message",
			timestamp: "2026-07-14T10:00:09.000Z",
			message: { role: "assistant", content: [{ type: "text", text: "Done." }], stopReason: "stop" },
		},
		{
			id: "entry-user-without-assistant",
			type: "message",
			timestamp: "2026-07-14T10:01:00.000Z",
			message: { role: "user", content: [{ type: "text", text: "Use a tool" }] },
		},
	];
	const reloaded = view([
		event(1, "message_queued", "2026-07-14T10:00:00.000Z", { eventId: "turn-1", text: "Use a tool", source: "user", queuedMessages: 1 }),
		event(2, "message_started", "2026-07-14T10:00:03.000Z", { eventId: "turn-1", text: "Use a tool", source: "user" }),
		event(3, "message_finished", "2026-07-14T10:00:13.000Z", { eventId: "turn-1", source: "user" }),
		event(4, "message_started", "2026-07-14T10:01:01.000Z", { eventId: "turn-2", text: "Use a tool", source: "user" }),
		event(5, "message_finished", "2026-07-14T10:01:02.000Z", { eventId: "turn-2", source: "user" }),
	], "idle", transcriptEntries);
	const rows = buildCompactTerminalRows(reloaded, { showThinking: true });
	const user = rows.find((row) => row.kind === "message.user");
	const assistants = rows.filter((row) => row.kind === "message.assistant");

	assert.equal(user?.startedAt, "2026-07-14T10:00:00.000Z");
	assert.equal(assistants.length, 2);
	assert.equal(assistants[0].completedAt, undefined, "intermediate assistant text must not receive final timing");
	assert.equal(assistants[0].durationMs, undefined);
	assert.equal(assistants[1].completedAt, "2026-07-14T10:00:13.000Z");
	assert.equal(assistants[1].durationMs, 10_000);
});

test("legacy final assistant keeps an available message time without inventing a duration", () => {
	const reloaded = view([], "idle", [
		{
			id: "entry-user",
			type: "message",
			timestamp: "2026-07-14T10:00:00.000Z",
			message: { role: "user", content: [{ type: "text", text: "Hello" }] },
		},
		{
			id: "entry-assistant",
			type: "message",
			timestamp: "2026-07-14T10:00:04.000Z",
			message: { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop" },
		},
	]);
	const assistant = buildCompactTerminalRows(reloaded, { showThinking: true })
		.find((row) => row.kind === "message.assistant");
	assert.equal(assistant?.completedAt, "2026-07-14T10:00:04.000Z");
	assert.equal(assistant?.durationMs, undefined);
});

test("duration formatting does not wrap after 24 hours", () => {
	assert.equal(formatTerminalDuration(0), "00:00:00");
	assert.equal(formatTerminalDuration(2 * 60 * 60 * 1000 + 17 * 60 * 1000 + 9_000), "02:17:09");
	assert.equal(formatTerminalDuration(27 * 60 * 60 * 1000 + 5_000), "27:00:05");
});

test("Compact Terminal renders timing only on message rows and keeps live updates silent", () => {
	const source = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"), "utf8");
	assert.match(source, /TerminalStreamingFooter startedAt=\{activeTurnStartedAt\}/);
	assert.match(source, /aria-label="Working"[\s\S]*aria-hidden="true"/);
	assert.match(source, /row\.kind === "message\.assistant"[\s\S]*TerminalMessageMetadata/);
	assert.match(source, /row\.kind === "message\.user"[\s\S]*TerminalMessageMetadata/);
	assert.equal((source.match(/<TerminalMessageMetadata/g) ?? []).length, 2);
});
