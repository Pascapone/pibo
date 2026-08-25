import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { messageTurnTimingsFromEvents } from "../dist/shared/trace-event-projection.js";
import { buildTraceViewFromEvents } from "./helpers/pi-history.mjs";
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

test("queued turn timing closes on session_error without inventing a start time", () => {
	assert.deepEqual(messageTurnTimingsFromEvents([
		event(1, "message_queued", "2026-07-14T10:00:00.000Z", { eventId: "turn-failed", text: "Fail later", source: "user", queuedMessages: 1 }),
		event(2, "session_error", "2026-07-14T10:00:02.000Z", { eventId: "turn-failed", error: "provider failed" }),
	]), [{
		eventId: "turn-failed",
		userText: "Fail later",
		startedAt: undefined,
		completedAt: "2026-07-14T10:00:02.000Z",
		durationMs: undefined,
	}]);
});

test("turn projection metadata preserves visible reasoning and assistant part indices", () => {
	assert.deepEqual(messageTurnTimingsFromEvents([
		event(1, "message_queued", "2026-07-14T10:00:00.000Z", { eventId: "turn-parts", text: "Inspect", source: "user", queuedMessages: 1 }),
		event(2, "thinking_finished", "2026-07-14T10:00:01.000Z", { eventId: "turn-parts", thinkingIndex: 0, contentIndex: 0, text: "" }),
		event(3, "thinking_finished", "2026-07-14T10:00:02.000Z", { eventId: "turn-parts", thinkingIndex: 1, contentIndex: 0, text: "Visible reasoning" }),
		event(4, "assistant_message", "2026-07-14T10:00:03.000Z", { eventId: "turn-parts", assistantIndex: 2, contentIndex: 1, text: "Visible answer" }),
	]), [{
		eventId: "turn-parts",
		userText: "Inspect",
		startedAt: undefined,
		completedAt: undefined,
		durationMs: undefined,
		reasoningIndices: [1],
		assistantIndices: [2],
	}]);
});

test("transcript projection keeps a nonzero reasoning identity when an empty earlier phase is omitted", () => {
	const transcriptEntries = [
		{
			id: "entry-user-parts",
			type: "message",
			timestamp: "2026-07-14T10:00:00.000Z",
			message: { role: "user", content: [{ type: "text", text: "Inspect" }] },
		},
		{
			id: "entry-assistant-parts",
			type: "message",
			timestamp: "2026-07-14T10:00:03.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Visible reasoning" },
					{ type: "text", text: "Visible answer" },
				],
				stopReason: "stop",
			},
		},
	];
	const projected = view([
		event(1, "message_queued", "2026-07-14T10:00:00.000Z", { eventId: "turn-parts", text: "Inspect", source: "user", queuedMessages: 1 }),
		event(2, "thinking_finished", "2026-07-14T10:00:01.000Z", { eventId: "turn-parts", thinkingIndex: 0, contentIndex: 0, text: "" }),
		event(3, "thinking_finished", "2026-07-14T10:00:02.000Z", { eventId: "turn-parts", thinkingIndex: 1, contentIndex: 0, text: "Visible reasoning" }),
		event(4, "assistant_message", "2026-07-14T10:00:03.000Z", { eventId: "turn-parts", assistantIndex: 2, contentIndex: 1, text: "Visible answer" }),
	], "idle", transcriptEntries);
	const reasoning = projected.nodes.find((node) => node.type === "model.reasoning");
	const assistant = projected.nodes.find((node) => node.type === "assistant.message");

	assert.equal(reasoning?.id, "event:thinking:turn-parts:thinking:1");
	assert.equal(reasoning?.stableKey, "reasoning:turn-parts:thinking:1");
	assert.equal(assistant?.id, "event:assistant:turn-parts:assistant:2");
	assert.equal(assistant?.stableKey, "assistant:turn-parts:assistant:2");
});

test("open persisted turn keeps reasoning and assistant identities when message_finished arrives", () => {
	const transcriptEntries = [
		{
			id: "entry-user-open",
			type: "message",
			timestamp: "2026-07-14T10:00:00.000Z",
			message: { role: "user", content: [{ type: "text", text: "Keep identity" }] },
		},
		{
			id: "entry-assistant-open",
			type: "message",
			timestamp: "2026-07-14T10:00:02.000Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Plan first" },
					{ type: "text", text: "Still working" },
				],
				stopReason: "stop",
			},
		},
	];
	const activeEvents = [
		event(1, "message_started", "2026-07-14T10:00:01.000Z", { eventId: "turn-open", text: "Keep identity", source: "user" }),
		event(2, "thinking_finished", "2026-07-14T10:00:02.000Z", { eventId: "turn-open", thinkingIndex: 0, contentIndex: 0, text: "Plan first" }),
		event(3, "assistant_message", "2026-07-14T10:00:03.000Z", { eventId: "turn-open", assistantIndex: 0, contentIndex: 1, text: "Still working" }),
	];
	const open = view(activeEvents, "idle", transcriptEntries);
	const completed = view([
		...activeEvents,
		event(4, "message_finished", "2026-07-14T10:00:04.000Z", { eventId: "turn-open", source: "user" }),
	], "idle", transcriptEntries);
	const openReasoning = open.nodes.find((node) => node.type === "model.reasoning");
	const openAssistant = open.nodes.find((node) => node.type === "assistant.message");
	const completedReasoning = completed.nodes.find((node) => node.type === "model.reasoning");
	const completedAssistant = completed.nodes.find((node) => node.type === "assistant.message");

	assert.equal(openReasoning?.id, "event:thinking:turn-open:thinking:0");
	assert.equal(openReasoning?.stableKey, "reasoning:turn-open:thinking:0");
	assert.equal(openAssistant?.id, "event:assistant:turn-open:assistant:0");
	assert.equal(openAssistant?.stableKey, "assistant:turn-open:assistant:0");
	assert.equal(openAssistant?.source, "transcript");
	assert.equal(completedReasoning?.id, openReasoning?.id);
	assert.equal(completedReasoning?.stableKey, openReasoning?.stableKey);
	assert.equal(completedAssistant?.id, openAssistant?.id);
	assert.equal(completedAssistant?.stableKey, openAssistant?.stableKey);
});

test("persisted transcript keeps queued user time and final turn timing after reload", () => {
	const transcriptEntries = [
		{
			id: "entry-user",
			type: "message",
			timestamp: "2026-07-14T10:00:30.000Z",
			message: { role: "user", content: [{ type: "text", text: "Use a tool" }] },
		},
		{
			id: "entry-assistant-intermediate",
			type: "message",
			timestamp: "2026-07-14T10:00:35.000Z",
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
			timestamp: "2026-07-14T10:00:37.000Z",
			message: { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: "ok", isError: false },
		},
		{
			id: "entry-assistant-final",
			type: "message",
			timestamp: "2026-07-14T10:00:39.000Z",
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
		event(2, "message_started", "2026-07-14T10:00:30.000Z", { eventId: "turn-1", text: "Use a tool", source: "user" }),
		event(3, "message_finished", "2026-07-14T10:00:40.000Z", { eventId: "turn-1", source: "user" }),
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
	assert.equal(assistants[1].completedAt, "2026-07-14T10:00:40.000Z");
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

test("Compact Terminal preserves message timing and the animated working footer layout", () => {
	const source = fs.readFileSync(path.resolve("src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"), "utf8");
	assert.match(source, /Footer: isStreaming \|\| showGoalIndicator[\s\S]*TerminalStreamingFooter startedAt=\{activeTurnStartedAt\} isWorking=\{isStreaming\} goal=\{sessionGoal\}/);
	assert.match(source, /components=\{virtuosoComponents\}/);
	assert.doesNotMatch(source, /\{isStreaming \? <TerminalStreamingFooter startedAt=\{activeTurnStartedAt\} \/> : null\}/);
	assert.match(source, /useSessionActivity\(\{/);
	assert.match(source, /signal: selectedSessionSignal/);
	assert.match(source, /const isStreaming = sessionActivity\.isTurnActive/);
	assert.doesNotMatch(source, /useStableActiveTurn|findLatestActiveTurnTerminal|selectedTrace\?\.status/);
	assert.match(source, /data-pibo-component="TerminalStreamingFooter"/);
	assert.match(source, /aria-label=\{footerAriaLabel\}[\s\S]*aria-hidden="true"/);
	assert.match(source, /goalTokenUsage \? `Tokens \$\{goalTokenUsage\}` : undefined/);
	assert.match(source, /flex-wrap[\s\S]*justify-between[\s\S]*compact-terminal-working-scramble[\s\S]*SessionGoalIndicator/, "Working and Goal status should share the responsive animated footer div");
	assert.match(source, /justify-between[\s\S]*compact-terminal-working-scramble[\s\S]*SessionGoalIndicator/, "Working and Goal status should share the same right-aligned footer div");
	assert.match(source, /const WORKING_SCRAMBLE_TARGET = "Working\.\.\."/);
	assert.match(source, /const \{ chars, activeIndex \} = useWorkingScramble\(WORKING_SCRAMBLE_TARGET, isWorking\)/);
	assert.match(source, /if \(!enabled \|\| window\.matchMedia/, "The scramble interval should run only for a visible working state");
	assert.match(source, /\{elapsed \? <span[\s\S]*\{elapsed\}<\/span> : null\}[\s\S]*compact-terminal-working-scramble/, "The existing elapsed timer should stay before the animated label");
	assert.match(source, /className=\{index === activeIndex \? "compact-terminal-working-scramble-active" : undefined\}/);
	assert.match(source, /function useWorkingScramble/);
	assert.match(source, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
	const styles = fs.readFileSync(path.resolve("src/apps/chat-ui/src/styles.css"), "utf8");
	assert.match(styles, /\.compact-terminal-working-scramble/);
	assert.match(styles, /\.compact-terminal-working-scramble \{[\s\S]*width: 10ch/);
	assert.match(styles, /\.compact-terminal-working-scramble > span \{[\s\S]*width: 1ch/);
	assert.match(styles, /\.compact-terminal-working-scramble-active/);
	assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
	assert.doesNotMatch(styles, /\.compact-terminal-working-label/);
	assert.match(source, /row\.kind === "message\.assistant"[\s\S]*TerminalMessageMetadata/);
	assert.match(source, /row\.kind === "message\.user"[\s\S]*TerminalMessageMetadata/);
	assert.equal((source.match(/<TerminalMessageMetadata/g) ?? []).length, 2);
});
