import assert from "node:assert/strict";
import test from "node:test";
import { checkTraceView } from "../dist/debug/trace.js";
import { buildTraceViewFromEvents, flattenTraceNodes, patchTraceViewWithEvents } from "../dist/shared/trace-engine.js";

const session = { id: "ps-mixed", piSessionId: "pi-mixed", title: "Long mixed trace" };

function at(second) {
	return new Date(Date.UTC(2026, 7, 4, 8, 0, second)).toISOString();
}

function storedEvent(sequence, second, payload) {
	return {
		id: `event-${sequence}`,
		piboSessionId: session.id,
		eventSequence: sequence,
		type: payload.type,
		createdAt: at(second),
		payload: { piboSessionId: session.id, ...payload },
	};
}

function transcriptEntries(turnCount) {
	return Array.from({ length: turnCount }, (_, index) => {
		const turn = index + 1;
		const assistantContent = [
			...(turn % 10 === 0 ? [{ type: "toolCall", id: `tool-${turn}`, name: "bash", arguments: { command: `echo ${turn}` } }] : []),
			{ type: "text", text: `answer ${turn}` },
		];
		return [
			{
				id: `user-${turn}`,
				type: "message",
				timestamp: at(turn * 2),
				message: { role: "user", content: [{ type: "text", text: `question ${turn}` }] },
			},
			{
				id: `assistant-${turn}`,
				type: "message",
				timestamp: at(turn * 2 + 1),
				message: { role: "assistant", status: "completed", content: assistantContent },
			},
		];
	}).flat();
}

function turnTimings(turnCount) {
	return Array.from({ length: turnCount }, (_, index) => {
		const turn = index + 1;
		return {
			eventId: `turn-${turn}`,
			userText: `question ${turn}`,
			startedAt: at(turn * 2),
			completedAt: at(turn * 2 + 1),
			durationMs: 1000,
		};
	});
}

function stableKeys(view) {
	return flattenTraceNodes(view.nodes).map((node) => node.stableKey);
}

test("long mixed-source trace remains monotonic across late results, compaction, errors, and subagents", () => {
	const events = [];
	let sequence = 1;
	for (let turn = 1; turn <= 60; turn += 1) {
		const eventId = `turn-${turn}`;
		events.push(storedEvent(sequence++, turn * 2, {
			type: "message_queued",
			eventId,
			source: "user",
			text: `question ${turn}`,
		}));
		if (turn % 10 === 0) {
			const toolCallId = `tool-${turn}`;
			events.push(storedEvent(sequence++, turn * 2 + 0.1, {
				type: "tool_call",
				eventId,
				toolCallId,
				toolName: "bash",
				args: { command: `echo ${turn}` },
				argsComplete: true,
			}));
			events.push(storedEvent(sequence++, turn * 2 + 0.8, {
				type: "tool_execution_finished",
				eventId,
				toolCallId,
				toolName: "bash",
				result: `done ${turn}`,
				isError: false,
			}));
		}
		if (turn % 15 === 0) {
			events.push(storedEvent(sequence++, turn * 2 + 0.2, {
				type: "execution_result",
				eventId,
				action: "session.status",
				result: { turn },
			}));
		}
		if (turn % 20 === 0) {
			events.push(storedEvent(sequence++, turn * 2 + 0.3, {
				type: "compaction_start",
				reason: "auto",
			}));
			events.push(storedEvent(sequence++, turn * 2 + 0.7, {
				type: "compaction_end",
				reason: "auto",
				result: { removed: turn },
				aborted: false,
			}));
		}
		if (turn % 25 === 0) {
			events.push(storedEvent(sequence++, turn * 2 + 0.4, {
				type: "subagent_session",
				eventId,
				toolCallId: `subagent-${turn}`,
				toolName: "pibo_subagent_researcher",
				subagentName: "researcher",
				childPiboSessionId: `ps-child-${turn}`,
			}));
		}
	}
	events.push(storedEvent(sequence++, 121.5, {
		type: "session_error",
		eventId: "turn-60",
		error: "late provider failure",
		errorDetails: { userMessage: "The provider disconnected." },
	}));

	const view = buildTraceViewFromEvents({
		session,
		transcriptEntries: transcriptEntries(60),
		turnTimings: turnTimings(60),
		events,
		status: "idle",
	});
	const checks = checkTraceView(view);

	assert.equal(flattenTraceNodes(view.nodes).length > 120, true);
	assert.deepEqual(checks, { status: "ok", issues: [] });
	assert.equal(flattenTraceNodes(view.nodes).some((node) => node.type === "tool.call"), true);
	assert.equal(flattenTraceNodes(view.nodes).some((node) => node.type === "execution.compaction"), true);
	assert.equal(flattenTraceNodes(view.nodes).some((node) => node.type === "agent.delegation"), true);
	assert.equal(flattenTraceNodes(view.nodes).some((node) => node.type === "error"), true);
});

test("late mixed-source updates preserve the relative order of already confirmed concepts", () => {
	const initial = buildTraceViewFromEvents({
		session,
		transcriptEntries: transcriptEntries(12),
		turnTimings: turnTimings(12),
		events: [
			storedEvent(1, 20, {
				type: "tool_call",
				eventId: "turn-10",
				toolCallId: "tool-10",
				toolName: "bash",
				args: { command: "echo 10" },
				argsComplete: true,
			}),
			storedEvent(2, 21, { type: "compaction_start", reason: "auto" }),
		],
		status: "running",
		includeRawEvents: true,
	});
	const before = stableKeys(initial);

	const patched = patchTraceViewWithEvents(initial, [
		storedEvent(3, 19, {
			type: "tool_execution_finished",
			eventId: "turn-10",
			toolCallId: "tool-10",
			toolName: "bash",
			result: "done",
			isError: false,
		}),
		storedEvent(4, 18, {
			type: "compaction_end",
			reason: "auto",
			result: { removed: 4 },
			aborted: false,
		}),
		storedEvent(5, 17, {
			type: "subagent_session",
			eventId: "turn-10",
			toolCallId: "late-subagent",
			toolName: "pibo_subagent_researcher",
			subagentName: "researcher",
			childPiboSessionId: "ps-child-late",
		}),
		storedEvent(6, 16, {
			type: "execution_result",
			eventId: "turn-10",
			action: "session.status",
			result: { ok: true },
		}),
		storedEvent(7, 15, {
			type: "session_error",
			eventId: "turn-10",
			error: "late error",
			errorDetails: { userMessage: "Late error" },
		}),
	], "idle");

	const afterExistingOnly = stableKeys(patched).filter((key) => before.includes(key));
	assert.deepEqual(afterExistingOnly, before);
	assert.deepEqual(checkTraceView(patched), { status: "ok", issues: [] });
	assert.equal(flattenTraceNodes(patched.nodes).find((node) => node.stableKey === "tool:tool-10")?.status, "done");
	assert.equal(flattenTraceNodes(patched.nodes).find((node) => node.type === "execution.compaction")?.status, "done");
});
