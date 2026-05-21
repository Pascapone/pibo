import type { ChatWebStoredEvent } from "./trace-types.js";

type ChatStreamEvent = {
	type: string;
	piboSessionId?: string;
	streamFrameId?: string;
	streamId?: number;
	streamFrameIndex?: number;
	[key: string]: unknown;
};

type ApplyInput = {
	currentEvents: ChatWebStoredEvent[];
	streamEvents: ChatStreamEvent[];
	piboSessionId: string;
	nextSequence: () => number;
	now?: () => string;
};

export function applyTraceLiveEvents(input: ApplyInput): ChatWebStoredEvent[] {
	let events = input.currentEvents;
	for (const streamEvent of input.streamEvents) {
		const stored = storedEventFromStreamEvent(streamEvent, input.piboSessionId, input.nextSequence, input.now ?? (() => new Date().toISOString()));
		if (!stored) continue;
		events = reduceStoredEvent(events, stored);
	}
	return events;
}

function reduceStoredEvent(events: ChatWebStoredEvent[], event: ChatWebStoredEvent): ChatWebStoredEvent[] {
	if (event.type === "assistant_message") {
		return [...dropMatching(events, event, "assistant_delta"), event];
	}
	if (event.type === "thinking_finished") {
		return [...dropMatching(events, event, "thinking_delta"), event];
	}
	if (event.type === "tool_execution_finished") {
		return [...dropMatching(events, event, "tool_execution_updated"), event];
	}
	return dedupeByIdentity([...events, event]);
}

function storedEventFromStreamEvent(
	event: ChatStreamEvent,
	piboSessionId: string,
	nextSequence: () => number,
	now: () => string,
): ChatWebStoredEvent | undefined {
	if (event.type === "RAW_EVENT" && isRecord(event.event) && typeof event.event.type === "string") {
		const payload = event.event;
		return makeStored(event, piboSessionId, event.event.type, payload, nextSequence, now);
	}
	if (event.type === "TEXT_MESSAGE_CONTENT" && typeof event.delta === "string") {
		const payload = {
			type: "assistant_delta",
			piboSessionId,
			eventId: typeof event.runId === "string" ? event.runId : undefined,
			...partIndexFromMessageId(typeof event.messageId === "string" ? event.messageId : undefined, "assistant"),
			text: event.delta,
		};
		return makeStored(event, piboSessionId, "assistant_delta", payload, nextSequence, now);
	}
	if (event.type === "REASONING_MESSAGE_CONTENT" && typeof event.delta === "string") {
		const payload = {
			type: "thinking_delta",
			piboSessionId,
			eventId: typeof event.runId === "string" ? event.runId : undefined,
			...partIndexFromMessageId(typeof event.messageId === "string" ? event.messageId : undefined, "thinking"),
			text: event.delta,
		};
		return makeStored(event, piboSessionId, "thinking_delta", payload, nextSequence, now);
	}
	if (event.type === "TOOL_CALL_START" && typeof event.toolCallId === "string" && typeof event.toolName === "string") {
		const payload = {
			type: "tool_execution_started",
			piboSessionId,
			eventId: typeof event.runId === "string" ? event.runId : undefined,
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			args: event.args,
		};
		return makeStored(event, piboSessionId, "tool_execution_started", payload, nextSequence, now);
	}
	if (event.type === "TOOL_CALL_ARGS" && typeof event.toolCallId === "string" && typeof event.toolName === "string") {
		const eventId = typeof event.runId === "string" ? event.runId : undefined;
		const sourceEventType = event.sourceEventType === "tool_execution_updated" ? "tool_execution_updated" : "tool_call";
		const payload = sourceEventType === "tool_execution_updated"
			? {
					type: "tool_execution_updated",
					piboSessionId,
					eventId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
					partialResult: event.partialResult,
				}
			: {
					type: "tool_call",
					piboSessionId,
					eventId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: event.args,
					argsComplete: Boolean(event.argsComplete),
				};
		return makeStored(event, piboSessionId, sourceEventType, payload, nextSequence, now);
	}
	if (event.type === "TOOL_CALL_RESULT" && typeof event.toolCallId === "string" && typeof event.toolName === "string") {
		const payload = {
			type: "tool_execution_finished",
			piboSessionId,
			eventId: typeof event.runId === "string" ? event.runId : undefined,
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			result: event.result,
			isError: Boolean(event.isError),
		};
		return makeStored(event, piboSessionId, "tool_execution_finished", payload, nextSequence, now);
	}
	if (event.type === "RUN_ERROR" && typeof event.message === "string") {
		const payload = {
			type: "session_error",
			piboSessionId,
			eventId: typeof event.runId === "string" ? event.runId : undefined,
			error: event.message,
			errorDetails: event.errorDetails,
		};
		return makeStored(event, piboSessionId, "session_error", payload, nextSequence, now);
	}
	return undefined;
}

function makeStored(
	streamEvent: ChatStreamEvent,
	piboSessionId: string,
	type: string,
	payload: Record<string, unknown>,
	nextSequence: () => number,
	now: () => string,
): ChatWebStoredEvent {
	const streamFrame = typeof streamEvent.streamFrameId === "string" ? streamEvent.streamFrameId : undefined;
	const streamFrameIndex = typeof streamEvent.streamFrameIndex === "number" ? streamEvent.streamFrameIndex : undefined;
	const sequence = nextSequence();
	return {
		id: typeof streamEvent.streamId === "number"
			? `stream:${streamEvent.streamId}:${streamFrameIndex ?? "raw"}:${type}`
			: streamFrame
				? `stream:${streamFrame}:${type}`
				: `live:${sequence}:${type}`,
		piboSessionId,
		eventSequence: sequence,
		streamId: typeof streamEvent.streamId === "number" ? streamEvent.streamId : undefined,
		streamFrameIndex,
		eventId: typeof payload.eventId === "string" ? payload.eventId : undefined,
		type,
		createdAt: now(),
		payload,
	};
}

function dropMatching(events: ChatWebStoredEvent[], finalEvent: ChatWebStoredEvent, dropType: string): ChatWebStoredEvent[] {
	const finalKey = eventGroupKey(finalEvent);
	return events.filter((event) => event.type !== dropType || eventGroupKey(event) !== finalKey);
}

function dedupeByIdentity(events: ChatWebStoredEvent[]): ChatWebStoredEvent[] {
	const seen = new Set<string>();
	const deduped: ChatWebStoredEvent[] = [];
	for (const event of events) {
		const key = eventIdentityKey(event);
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(event);
	}
	return deduped;
}

function eventIdentityKey(event: ChatWebStoredEvent): string {
	if (event.streamId !== undefined) {
		return event.streamFrameIndex !== undefined
			? `stream:${event.streamId}:${event.streamFrameIndex}:${event.type}`
			: `stream:${event.streamId}:${event.id}:${event.type}`;
	}
	return `${event.id}:${event.type}`;
}

function eventGroupKey(event: ChatWebStoredEvent): string {
	const payload = isRecord(event.payload) ? event.payload : {};
	const piboSessionId = typeof payload.piboSessionId === "string" ? payload.piboSessionId : event.piboSessionId ?? "";
	const eventId = typeof payload.eventId === "string" ? payload.eventId : event.eventId ?? "";
	if (typeof payload.toolCallId === "string") return `${piboSessionId}:${eventId}:tool:${payload.toolCallId}`;
	const assistantIndex = typeof payload.assistantIndex === "number" ? payload.assistantIndex : undefined;
	const thinkingIndex = typeof payload.thinkingIndex === "number" ? payload.thinkingIndex : undefined;
	const contentIndex = typeof payload.contentIndex === "number" ? payload.contentIndex : 0;
	return `${piboSessionId}:${eventId}:${assistantIndex ?? thinkingIndex ?? contentIndex}`;
}

function partIndexFromMessageId(messageId: string | undefined, kind: "assistant" | "thinking"): Record<string, number> {
	const match = messageId?.match(new RegExp(`:${kind}:(\\d+)$`));
	if (!match) return {};
	const value = Number(match[1]);
	if (!Number.isInteger(value)) return {};
	return kind === "assistant" ? { assistantIndex: value } : { thinkingIndex: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
