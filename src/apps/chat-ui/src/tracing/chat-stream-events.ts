import { parseTraceStreamFrameId } from "../../../../shared/trace-order.js";
import type { PiboWebSessionNode } from "../types";

export type LiveStreamCursor = {
	streamId?: number;
	frameIndex?: number;
	cursor?: string;
	exact: boolean;
	liveReplayId?: number;
};

type ChatStreamEventMeta = {
	piboSessionId?: string;
	streamFrameId?: string;
	streamId?: number;
	streamFrameIndex?: number;
	liveReplayId?: number;
};

export type ChatStreamReplayStatus = {
	requestedAfter: number;
	replayed: number;
	missed: boolean;
	evictedBefore?: number;
	oldestAvailable?: number;
	newestAvailable?: number;
	bufferSize: number;
	maxEvents: number;
};

export type ChatStreamEvent = ChatStreamEventMeta & (
	| { type: "ready"; piboSessionId: string; liveReplay?: ChatStreamReplayStatus }
	| { type: "RUN_STARTED"; runId: string; input?: { text?: string; source?: string } }
	| { type: "RUN_FINISHED"; runId: string }
	| { type: "RUN_ERROR"; runId?: string; message: string; errorDetails?: unknown }
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
	| { type: "RAW_EVENT"; event: { type: string; [key: string]: unknown } }
);

export function chatStreamEvent(message: MessageEvent): ChatStreamEvent | undefined {
	try {
		const parsed = JSON.parse(message.data) as { type?: unknown };
		if (typeof parsed.type !== "string") return undefined;
		const streamFrame = message.lastEventId ? parseTraceStreamFrameId(message.lastEventId) : undefined;
		return {
			...(parsed as ChatStreamEvent),
			...(message.lastEventId ? { streamFrameId: message.lastEventId } : {}),
			...(streamFrame ? { streamId: streamFrame.streamId, streamFrameIndex: streamFrame.frameIndex } : {}),
		};
	} catch {
		return undefined;
	}
}

export function recordTraceLiveCursor(cursors: Map<string, LiveStreamCursor>, piboSessionId: string, streamId: number): void {
	const current = cursors.get(piboSessionId);
	if (current?.streamId !== undefined && current.streamId >= streamId) return;
	cursors.set(piboSessionId, {
		streamId,
		frameIndex: Number.MAX_SAFE_INTEGER,
		cursor: traceStreamCursorAfterStream(streamId),
		exact: false,
		...(current?.liveReplayId !== undefined ? { liveReplayId: current.liveReplayId } : {}),
	});
}

export function recordEventLiveCursor(cursors: Map<string, LiveStreamCursor>, piboSessionId: string, event: ChatStreamEvent): void {
	const current = cursors.get(piboSessionId);
	const liveReplayId = typeof event.liveReplayId === "number" && Number.isFinite(event.liveReplayId)
		? Math.max(current?.liveReplayId ?? 0, event.liveReplayId)
		: current?.liveReplayId;
	if (event.streamId === undefined || event.streamFrameIndex === undefined) {
		if (liveReplayId !== undefined && liveReplayId !== current?.liveReplayId) cursors.set(piboSessionId, { ...(current ?? { exact: false }), liveReplayId });
		return;
	}
	if (
		current
		&& (
			(current.streamId !== undefined && current.streamId > event.streamId)
			|| (current.streamId === event.streamId && current.exact && current.frameIndex !== undefined && current.frameIndex >= event.streamFrameIndex)
		)
	) {
		if (liveReplayId !== undefined && liveReplayId !== current.liveReplayId) cursors.set(piboSessionId, { ...current, liveReplayId });
		return;
	}
	cursors.set(piboSessionId, {
		streamId: event.streamId,
		frameIndex: event.streamFrameIndex,
		cursor: event.streamFrameId ?? `${event.streamId}:${event.streamFrameIndex}`,
		exact: true,
		...(liveReplayId !== undefined ? { liveReplayId } : {}),
	});
}

export function traceStreamCursorAfterStream(streamId: number): string {
	return `${streamId}:999999`;
}

export function eventTraceRefreshDelay(event: ChatStreamEvent): number | undefined {
	if (
		event.type === "RUN_FINISHED" ||
		event.type === "TEXT_MESSAGE_END"
	) {
		return 300;
	}
	if (event.type === "RUN_ERROR") {
		return 0;
	}
	return undefined;
}

export function eventShouldRefreshNavigation(event: ChatStreamEvent): boolean {
	return event.type === "RUN_STARTED" || event.type === "RUN_FINISHED" || event.type === "RUN_ERROR" || event.type === "TEXT_MESSAGE_END";
}

export function eventUpdatesLiveOverlay(event: ChatStreamEvent): boolean {
	return event.type === "TEXT_MESSAGE_CONTENT"
		|| event.type === "REASONING_MESSAGE_CONTENT"
		|| event.type === "TOOL_CALL_START"
		|| event.type === "TOOL_CALL_ARGS"
		|| event.type === "TOOL_CALL_RESULT"
		|| event.type === "RUN_ERROR"
		|| event.type === "RAW_EVENT";
}

export function resetLiveContentFlushTracking(keysBySession: Map<string, Set<string>>, piboSessionId: string, event: ChatStreamEvent): void {
	if (event.type === "RUN_STARTED" || event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
		keysBySession.delete(piboSessionId);
		return;
	}
	const startedKey = liveContentFlushKeyForStartedEvent(event);
	if (startedKey) keysBySession.get(piboSessionId)?.delete(startedKey);
}

export function consumeFirstLiveContentFlush(keysBySession: Map<string, Set<string>>, piboSessionId: string, event: ChatStreamEvent): boolean {
	const key = liveContentFlushKey(event);
	if (!key) return false;
	let keys = keysBySession.get(piboSessionId);
	if (!keys) {
		keys = new Set<string>();
		keysBySession.set(piboSessionId, keys);
	}
	if (keys.has(key)) return false;
	keys.add(key);
	return true;
}

function liveContentFlushKey(event: ChatStreamEvent): string | undefined {
	if (event.type === "TEXT_MESSAGE_CONTENT" || event.type === "REASONING_MESSAGE_CONTENT") return `${event.type}:${event.messageId}`;
	return undefined;
}

function liveContentFlushKeyForStartedEvent(event: ChatStreamEvent): string | undefined {
	if (event.type === "TEXT_MESSAGE_START") return `TEXT_MESSAGE_CONTENT:${event.messageId}`;
	if (event.type === "REASONING_MESSAGE_START") return `REASONING_MESSAGE_CONTENT:${event.messageId}`;
	return undefined;
}

export function liveSessionStatusFromEvent(event: ChatStreamEvent): PiboWebSessionNode["status"] | undefined {
	if (event.type === "RUN_ERROR") return "error";
	if (event.type === "RUN_FINISHED" || event.type === "TEXT_MESSAGE_END") return "idle";
	if (
		event.type === "RUN_STARTED" ||
		event.type === "TEXT_MESSAGE_START" ||
		event.type === "TEXT_MESSAGE_CONTENT" ||
		event.type === "REASONING_MESSAGE_START" ||
		event.type === "REASONING_MESSAGE_CONTENT" ||
		event.type === "TOOL_CALL_START" ||
		event.type === "TOOL_CALL_ARGS" ||
		event.type === "AGENT_DELEGATION"
	) {
		return "running";
	}
	return undefined;
}
