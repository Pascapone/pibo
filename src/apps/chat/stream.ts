import type { PiboOutputEvent } from "../../core/events.js";

export type ChatStreamEvent = { piboSessionId?: string } & (
	| { type: "ready"; piboSessionId: string }
	| { type: "RUN_STARTED"; runId: string; input?: { text?: string; source?: string } }
	| { type: "RUN_FINISHED"; runId: string }
	| { type: "RUN_ERROR"; runId?: string; message: string }
	| { type: "TEXT_MESSAGE_START"; messageId: string; runId?: string; role: "assistant" }
	| { type: "TEXT_MESSAGE_CONTENT"; messageId: string; runId?: string; delta: string }
	| { type: "TEXT_MESSAGE_END"; messageId: string; runId?: string; finalText?: string }
	| { type: "REASONING_MESSAGE_START"; messageId: string; runId?: string }
	| { type: "REASONING_MESSAGE_CONTENT"; messageId: string; runId?: string; delta: string }
	| { type: "REASONING_MESSAGE_END"; messageId: string; runId?: string; finalText?: string }
	| { type: "TOOL_CALL_START"; toolCallId: string; toolName: string; args?: unknown; runId?: string }
	| { type: "TOOL_CALL_ARGS"; toolCallId: string; toolName?: string; args: unknown; argsComplete: boolean; runId?: string; partialResult?: unknown; sourceEventType?: "tool_call" | "tool_execution_updated" }
	| { type: "TOOL_CALL_RESULT"; toolCallId: string; toolName?: string; result: unknown; isError: boolean; runId?: string }
	| { type: "AGENT_DELEGATION"; toolCallId?: string; toolName: string; subagentName: string; childPiboSessionId: string; threadKey?: string }
	| { type: "EXECUTION_RESULT"; runId?: string; eventId?: string; action: string; result: unknown }
	| { type: "RAW_EVENT"; event: PiboOutputEvent }
);

export type ChatStreamState = {
	textMessageIds: Set<string>;
	reasoningMessageIds: Set<string>;
	toolCallIds: Set<string>;
};

export function createChatStreamState(): ChatStreamState {
	return {
		textMessageIds: new Set(),
		reasoningMessageIds: new Set(),
		toolCallIds: new Set(),
	};
}

export function chatStreamFramesFromOutputEvent(
	event: PiboOutputEvent,
	state: ChatStreamState,
	options: { includeRawEvent?: boolean } = {},
): ChatStreamEvent[] {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	const frames: ChatStreamEvent[] = [];
	const reasoningMessageId = reasoningIdFromOutputEvent(event);

	switch (event.type) {
		case "message_started":
			if (eventId) {
				frames.push({
					type: "RUN_STARTED",
					runId: eventId,
					input: { text: event.text, source: event.source },
				});
			}
			break;
		case "message_finished":
			if (eventId) frames.push({ type: "RUN_FINISHED", runId: eventId });
			break;
		case "assistant_delta":
			if (eventId && event.text.length > 0) {
				const messageId = textMessageIdFromOutputEvent(event);
				ensureTextMessageStarted(frames, state, messageId, eventId);
				frames.push({ type: "TEXT_MESSAGE_CONTENT", messageId, runId: eventId, delta: event.text });
			}
			break;
		case "assistant_message":
			if (eventId) {
				const messageId = textMessageIdFromOutputEvent(event);
				ensureTextMessageStarted(frames, state, messageId, eventId);
				frames.push({ type: "TEXT_MESSAGE_END", messageId, runId: eventId, finalText: event.text });
			}
			break;
		case "thinking_started":
			if (reasoningMessageId) ensureReasoningStarted(frames, state, reasoningMessageId, eventId);
			break;
		case "thinking_delta":
			if (reasoningMessageId && event.text.length > 0) {
				ensureReasoningStarted(frames, state, reasoningMessageId, eventId);
				frames.push({ type: "REASONING_MESSAGE_CONTENT", messageId: reasoningMessageId, runId: eventId, delta: event.text });
			}
			break;
		case "thinking_finished":
			if (reasoningMessageId) {
				ensureReasoningStarted(frames, state, reasoningMessageId, eventId);
				frames.push({ type: "REASONING_MESSAGE_END", messageId: reasoningMessageId, runId: eventId, finalText: event.text });
			}
			break;
		case "tool_call":
			ensureToolCallStarted(frames, state, event.toolCallId, event.toolName, event.args, eventId);
			frames.push({
				type: "TOOL_CALL_ARGS",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				argsComplete: event.argsComplete,
				runId: eventId,
				sourceEventType: "tool_call",
			});
			break;
		case "tool_execution_started":
			ensureToolCallStarted(frames, state, event.toolCallId, event.toolName, event.args, eventId);
			break;
		case "tool_execution_updated":
			ensureToolCallStarted(frames, state, event.toolCallId, event.toolName, event.args, eventId);
			frames.push({
				type: "TOOL_CALL_ARGS",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				args: event.args,
				argsComplete: true,
				runId: eventId,
				partialResult: event.partialResult,
				sourceEventType: "tool_execution_updated",
			});
			break;
		case "tool_execution_finished":
			ensureToolCallStarted(frames, state, event.toolCallId, event.toolName, undefined, eventId);
			frames.push({ type: "TOOL_CALL_RESULT", toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError, runId: eventId });
			break;
		case "subagent_session":
			frames.push({
				type: "AGENT_DELEGATION",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				subagentName: event.subagentName,
				childPiboSessionId: event.childPiboSessionId,
				threadKey: event.threadKey,
			});
			break;
		case "execution_result":
			frames.push({ type: "EXECUTION_RESULT", runId: eventId, eventId: event.eventId, action: event.action, result: event.result });
			break;
		case "session_error":
			frames.push({ type: "RUN_ERROR", runId: eventId, message: event.error });
			break;
		default:
			break;
	}

	if (options.includeRawEvent ?? true) frames.push({ type: "RAW_EVENT", event });
	return frames;
}

function reasoningIdFromOutputEvent(event: PiboOutputEvent): string | undefined {
	if (event.type !== "thinking_started" && event.type !== "thinking_delta" && event.type !== "thinking_finished") {
		return undefined;
	}
	if (!event.eventId) return undefined;
	const partIndex = typeof event.thinkingIndex === "number" ? event.thinkingIndex : event.contentIndex;
	return typeof partIndex === "number" ? `${event.eventId}:thinking:${partIndex}` : event.eventId;
}

function textMessageIdFromOutputEvent(
	event: Extract<PiboOutputEvent, { type: "assistant_delta" | "assistant_message" }>,
): string {
	const partIndex = typeof event.assistantIndex === "number" ? event.assistantIndex : event.contentIndex;
	return partIndex === undefined || !event.eventId ? event.eventId ?? "" : `${event.eventId}:assistant:${partIndex}`;
}

function ensureTextMessageStarted(frames: ChatStreamEvent[], state: ChatStreamState, messageId: string, runId?: string): void {
	if (state.textMessageIds.has(messageId)) return;
	state.textMessageIds.add(messageId);
	frames.push({ type: "TEXT_MESSAGE_START", messageId, runId, role: "assistant" });
}

function ensureReasoningStarted(frames: ChatStreamEvent[], state: ChatStreamState, messageId: string, runId?: string): void {
	if (state.reasoningMessageIds.has(messageId)) return;
	state.reasoningMessageIds.add(messageId);
	frames.push({ type: "REASONING_MESSAGE_START", messageId, runId });
}

function ensureToolCallStarted(
	frames: ChatStreamEvent[],
	state: ChatStreamState,
	toolCallId: string,
	toolName: string,
	args: unknown,
	runId?: string,
): void {
	if (state.toolCallIds.has(toolCallId)) return;
	state.toolCallIds.add(toolCallId);
	frames.push({ type: "TOOL_CALL_START", toolCallId, toolName, args, runId });
}
