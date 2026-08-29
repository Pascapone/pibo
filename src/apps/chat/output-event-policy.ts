import type { PiboOutputEvent } from "../../core/events.js";

export type LiveOnlyOutputEvent = Extract<
	PiboOutputEvent,
	{ type: "assistant_delta" | "thinking_delta" | "tool_execution_updated" }
>;

export function isLiveOnlyOutputEvent(event: PiboOutputEvent): event is LiveOnlyOutputEvent {
	return event.type === "assistant_delta" || event.type === "thinking_delta" || event.type === "tool_execution_updated";
}

export function isPersistableOutputEvent(event: PiboOutputEvent): boolean {
	return !isLiveOnlyOutputEvent(event);
}

export function assistantOutputKey(event: Extract<PiboOutputEvent, { type: "assistant_delta" | "assistant_message" }>): string {
	const partIndex = event.assistantIndex ?? event.contentIndex ?? 0;
	return [event.piboSessionId, event.eventId ?? "", partIndex].join(":");
}

export function thinkingOutputKey(
	event: Extract<PiboOutputEvent, { type: "thinking_started" | "thinking_delta" | "thinking_finished" }>,
): string {
	const partIndex = event.thinkingIndex ?? event.contentIndex ?? 0;
	return [event.piboSessionId, event.eventId ?? "", partIndex].join(":");
}

export function toolOutputKey(
	event: Extract<PiboOutputEvent, { type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished" }>,
): string {
	return [event.piboSessionId, event.eventId ?? "", event.toolCallId, event.toolInvocationOrdinal ?? 0].join(":");
}
