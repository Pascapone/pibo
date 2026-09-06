import type { ChatWebStoredEvent } from "./trace-types.js";

type ChatStreamEvent = {
	type: string;
	piboSessionId?: string;
	streamFrameId?: string;
	streamId?: number;
	streamFrameIndex?: number;
	liveReplayId?: number;
	createdAt?: string;
	renderSequence?: number;
	toolInvocationOrdinal?: number;
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
	let mutableEvents: ChatWebStoredEvent[] | undefined;
	let seenIdentities: Set<string> | undefined;
	const ensureSeenIdentities = () => {
		seenIdentities ??= new Set(events.map(eventIdentityKey));
		return seenIdentities;
	};
	const appendStoredEvent = (event: ChatWebStoredEvent) => {
		mutableEvents ??= events.slice();
		mutableEvents.push(event);
		events = mutableEvents;
	};
	for (const streamEvent of input.streamEvents) {
		const stored = storedEventFromStreamEvent(streamEvent, input.piboSessionId, input.nextSequence, input.now ?? (() => new Date().toISOString()));
		if (!stored) continue;
		if (isFinalReplacementEvent(stored)) {
			events = replaceLiveDeltasWithFinalEvent(events, stored);
			mutableEvents = events;
			seenIdentities = undefined;
			continue;
		}
		const identity = eventIdentityKey(stored);
		const seen = ensureSeenIdentities();
		if (seen.has(identity)) continue;
		seen.add(identity);
		appendStoredEvent(stored);
	}
	return events;
}

function isFinalReplacementEvent(event: ChatWebStoredEvent): boolean {
	return event.type === "assistant_message"
		|| event.type === "thinking_finished"
		|| event.type === "tool_execution_finished";
}

function replaceLiveDeltasWithFinalEvent(events: ChatWebStoredEvent[], event: ChatWebStoredEvent): ChatWebStoredEvent[] {
	if (event.type === "assistant_message") {
		return [...dropMatching(events, event, "assistant_delta"), event];
	}
	if (event.type === "thinking_finished") {
		return [...dropMatching(events, event, "thinking_delta"), event];
	}
	if (event.type === "tool_execution_finished") {
		return [...dropMatching(events, event, "tool_execution_updated"), event];
	}
	return events;
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
			toolInvocationOrdinal: validOrdinal(event.toolInvocationOrdinal) ? event.toolInvocationOrdinal : undefined,
			args: event.args,
			...(event.intent ? { intent: event.intent } : {}),
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
					toolInvocationOrdinal: validOrdinal(event.toolInvocationOrdinal) ? event.toolInvocationOrdinal : undefined,
					args: event.args,
					partialResult: event.partialResult,
					...(event.intent ? { intent: event.intent } : {}),
				}
			: {
					type: "tool_call",
					piboSessionId,
					eventId,
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					toolInvocationOrdinal: validOrdinal(event.toolInvocationOrdinal) ? event.toolInvocationOrdinal : undefined,
					args: event.args,
					argsComplete: Boolean(event.argsComplete),
					...(event.intent ? { intent: event.intent } : {}),
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
			toolInvocationOrdinal: validOrdinal(event.toolInvocationOrdinal) ? event.toolInvocationOrdinal : undefined,
			result: event.result,
			toolMetrics: event.toolMetrics,
			isError: Boolean(event.isError),
			...(event.intent ? { intent: event.intent } : {}),
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
	const liveReplayId = typeof streamEvent.liveReplayId === "number" && Number.isFinite(streamEvent.liveReplayId) ? streamEvent.liveReplayId : undefined;
	const sequence = nextSequence();
	const renderSequence = validSequence(streamEvent.renderSequence)
		? streamEvent.renderSequence
		: validSequence(payload.renderSequence) ? payload.renderSequence : undefined;
	const positionedPayload = renderSequence !== undefined && payload.renderSequence === undefined
		? { ...payload, renderSequence }
		: payload;
	return {
		id: typeof streamEvent.streamId === "number"
			? `stream:${streamEvent.streamId}:${streamFrameIndex ?? "raw"}:${type}`
			: liveReplayId !== undefined
				? `live-replay:${liveReplayId}:${type}`
				: streamFrame
					? `stream:${streamFrame}:${type}`
					: `live:${sequence}:${type}`,
		piboSessionId,
		eventSequence: sequence,
		renderSequence,
		streamId: typeof streamEvent.streamId === "number" ? streamEvent.streamId : undefined,
		streamFrameIndex,
		traceSource: "live",
		eventId: typeof positionedPayload.eventId === "string" ? positionedPayload.eventId : undefined,
		type,
		createdAt: streamEventCreatedAt(streamEvent) ?? now(),
		payload: positionedPayload,
	};
}

function validSequence(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validOrdinal(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function streamEventCreatedAt(event: ChatStreamEvent): string | undefined {
	if (typeof event.createdAt !== "string" || !Number.isFinite(Date.parse(event.createdAt))) return undefined;
	return event.createdAt;
}

function dropMatching(events: ChatWebStoredEvent[], finalEvent: ChatWebStoredEvent, dropType: string): ChatWebStoredEvent[] {
	const finalKey = eventGroupKey(finalEvent);
	return events.filter((event) => event.type !== dropType || eventGroupKey(event) !== finalKey);
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
	if (typeof payload.toolCallId === "string") {
		const ordinal = typeof payload.toolInvocationOrdinal === "number" ? payload.toolInvocationOrdinal : 0;
		return `${piboSessionId}:${eventId}:tool:${payload.toolCallId}:${ordinal}`;
	}
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
