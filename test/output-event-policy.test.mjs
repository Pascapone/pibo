import assert from "node:assert/strict";
import test from "node:test";
import { isPiboOutputEvent } from "../dist/apps/chat/output-event-policy.js";

const base = { piboSessionId: "ps_validator", eventId: "event-validator", renderSequence: 1 };
const variants = [
	[{ ...base, type: "message_queued", queuedMessages: 1, text: "queued" }, "text"],
	[{ ...base, type: "message_steered", queuedMessages: 0, text: "steered" }, "queuedMessages"],
	[{ ...base, type: "message_started", text: "started" }, "text"],
	[{ ...base, type: "message_finished" }, "piboSessionId"],
	[{ ...base, type: "assistant_delta", text: "delta" }, "text"],
	[{ ...base, type: "thinking_started" }, "piboSessionId"],
	[{ ...base, type: "thinking_delta", text: "thought" }, "text"],
	[{ ...base, type: "thinking_finished", text: "done" }, "piboSessionId"],
	[{ ...base, type: "tool_call", toolCallId: "tool-1", toolName: "read", args: {}, argsComplete: true }, "argsComplete"],
	[{ ...base, type: "tool_execution_started", toolCallId: "tool-1", toolName: "read", args: {} }, "args"],
	[{ ...base, type: "tool_execution_updated", toolCallId: "tool-1", toolName: "read", args: {}, partialResult: "part" }, "partialResult"],
	[{ ...base, type: "tool_execution_finished", toolCallId: "tool-1", toolName: "read", result: "done", isError: false }, "isError"],
	[{ ...base, type: "subagent_session", toolName: "subagent", subagentName: "worker", childPiboSessionId: "ps_child" }, "childPiboSessionId"],
	[{ ...base, type: "assistant_message", text: "answer" }, "text"],
	[{ ...base, type: "assistant_usage", totalTokens: 3 }, "totalTokens"],
	[{ ...base, type: "compaction_start", reason: "limit" }, "reason"],
	[{ ...base, type: "compaction_end", reason: "limit", aborted: false }, "aborted"],
	[{ ...base, type: "approval_requested", request: { requestId: "request-1", requestType: "command" } }, "request"],
	[{ ...base, type: "approval_resolved", requestId: "request-1", resolution: "responded" }, "resolution"],
	[{ ...base, type: "user_input_requested", request: { requestId: "request-1", questions: [{ id: "q1", question: "Continue?" }] } }, "request"],
	[{ ...base, type: "user_input_resolved", requestId: "request-1", resolution: "cleared" }, "requestId"],
	[{ ...base, type: "execution_result", action: "status", result: { ok: true } }, "result"],
	[{ ...base, type: "session_error", error: "failed" }, "error"],
	[{ ...base, type: "pi_event", event: { type: "legacy" } }, "event"],
];

test("runtime output validator accepts every declared variant and requires each variant's fields", () => {
	for (const [event, requiredField] of variants) {
		assert.equal(isPiboOutputEvent(event), true, event.type);
		const malformed = { ...event };
		delete malformed[requiredField];
		assert.equal(isPiboOutputEvent(malformed), false, `${event.type} without ${requiredField}`);
	}
	assert.equal(isPiboOutputEvent({ ...base, type: "text_message", text: "legacy" }), false);
	assert.equal(isPiboOutputEvent({ ...base, type: "assistant_message" }), false);
});
