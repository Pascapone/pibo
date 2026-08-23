import assert from "node:assert/strict";
import test from "node:test";
import {
	chatStreamFramesFromOutputEvent,
	createChatStreamState,
} from "../dist/apps/chat/stream.js";

test("chat stream forwards an intent that arrives after the tool call started", () => {
	const state = createChatStreamState();
	assert.deepEqual(chatStreamFramesFromOutputEvent({
		type: "tool_call",
		piboSessionId: "ps-intent",
		eventId: "message-1",
		toolCallId: "tool-1",
		toolName: "read",
		args: { path: "README.md" },
		argsComplete: true,
	}, state, { includeRawEvent: false }), [
		{ type: "TOOL_CALL_START", toolCallId: "tool-1", toolName: "read", args: { path: "README.md" }, runId: "message-1" },
		{ type: "TOOL_CALL_ARGS", toolCallId: "tool-1", toolName: "read", args: { path: "README.md" }, argsComplete: true, runId: "message-1", sourceEventType: "tool_call" },
	]);
	assert.deepEqual(chatStreamFramesFromOutputEvent({
		type: "tool_execution_started",
		piboSessionId: "ps-intent",
		eventId: "message-1",
		toolCallId: "tool-1",
		toolName: "read",
		args: { path: "README.md" },
		intent: "Reviewing project documentation",
	}, state, { includeRawEvent: false }), [{
		type: "TOOL_CALL_START",
		toolCallId: "tool-1",
		toolName: "read",
		args: { path: "README.md" },
		intent: "Reviewing project documentation",
		runId: "message-1",
	}]);
});

test("chat stream projects runtime approval and structured-input request lifecycles without losing raw events", () => {
	const state = createChatStreamState();
	const approvalRequest = {
		requestId: "approval-product-id",
		requestType: "command_execution",
		title: "Run Codex command",
		arguments: { command: "printf approved" },
		decisions: [{ id: "accept", label: "Approve once" }],
	};
	const approvalFrames = chatStreamFramesFromOutputEvent({
		type: "approval_requested",
		piboSessionId: "ps_runtime_requests",
		eventId: "message-1",
		request: approvalRequest,
	}, state);
	assert.deepEqual(approvalFrames, [
		{ type: "RUNTIME_APPROVAL_REQUESTED", runId: "message-1", request: approvalRequest },
		{
			type: "RAW_EVENT",
			event: {
				type: "approval_requested",
				piboSessionId: "ps_runtime_requests",
				eventId: "message-1",
				request: approvalRequest,
			},
		},
	]);
	assert.deepEqual(chatStreamFramesFromOutputEvent({
		type: "approval_resolved",
		piboSessionId: "ps_runtime_requests",
		eventId: "message-1",
		requestId: "approval-product-id",
		resolution: "responded",
	}, state, { includeRawEvent: false }), [{
		type: "RUNTIME_APPROVAL_RESOLVED",
		runId: "message-1",
		requestId: "approval-product-id",
		resolution: "responded",
	}]);

	const inputRequest = {
		requestId: "input-product-id",
		blocking: true,
		questions: [{
			id: "approach",
			header: "Approach",
			question: "Which approach?",
			options: [{ label: "Safe" }],
			allowFreeform: false,
		}],
	};
	assert.deepEqual(chatStreamFramesFromOutputEvent({
		type: "user_input_requested",
		piboSessionId: "ps_runtime_requests",
		eventId: "message-2",
		request: inputRequest,
	}, state, { includeRawEvent: false }), [{
		type: "RUNTIME_USER_INPUT_REQUESTED",
		runId: "message-2",
		request: inputRequest,
	}]);
	assert.deepEqual(chatStreamFramesFromOutputEvent({
		type: "user_input_resolved",
		piboSessionId: "ps_runtime_requests",
		eventId: "message-2",
		requestId: "input-product-id",
		resolution: "cleared",
	}, state, { includeRawEvent: false }), [{
		type: "RUNTIME_USER_INPUT_RESOLVED",
		runId: "message-2",
		requestId: "input-product-id",
		resolution: "cleared",
	}]);
});
