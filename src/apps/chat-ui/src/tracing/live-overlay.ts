import { parseRunNotificationText } from "../../../../shared/trace-run-notifications.js";
import type { ChatWebStoredEvent } from "../../../../shared/trace-types.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../types";
import { isUserMessageQueuedEvent } from "./optimistic-user-messages";

export type LiveTraceOverlay = {
	piboSessionId: string;
	events: ChatWebStoredEvent[];
};

export function restoreLiveTraceOverlayForSession(
	cache: Map<string, LiveTraceOverlay>,
	current: LiveTraceOverlay | null,
	selectedPiboSessionId: string | null,
): LiveTraceOverlay | null {
	if (current) cache.set(current.piboSessionId, current);
	return selectedPiboSessionId ? cache.get(selectedPiboSessionId) ?? null : null;
}

export function reconcileLiveTraceOverlayCache(
	cache: Map<string, LiveTraceOverlay>,
	current: LiveTraceOverlay | null,
	baseTrace: PiboSessionTraceView,
): LiveTraceOverlay | null {
	if (current && current.piboSessionId !== baseTrace.piboSessionId) {
		cache.set(current.piboSessionId, current);
	}
	const selectedOverlay = current?.piboSessionId === baseTrace.piboSessionId
		? current
		: cache.get(baseTrace.piboSessionId) ?? null;
	const next = trimLiveOverlayForBaseTrace(selectedOverlay, baseTrace);
	if (next) cache.set(baseTrace.piboSessionId, next);
	else cache.delete(baseTrace.piboSessionId);
	return next;
}

export function trimLiveOverlayForBaseTrace(overlay: LiveTraceOverlay | null, baseTrace: PiboSessionTraceView): LiveTraceOverlay | null {
	if (!overlay || overlay.piboSessionId !== baseTrace.piboSessionId) return overlay;
	const confirmedEventKeys = confirmedTraceEventKeys(baseTrace);
	const unassignedUserMessageTextCounts = unassignedTranscriptUserMessageTextCounts(baseTrace.nodes);
	const events = overlay.events.filter((event) => {
		const key = traceEventConfirmationKey(event);
		if (key && confirmedEventKeys.has(key)) return false;
		if (isUserMessageQueuedEvent(event)) {
			const remaining = unassignedUserMessageTextCounts.get(event.payload.text) ?? 0;
			if (remaining > 0) {
				if (remaining === 1) unassignedUserMessageTextCounts.delete(event.payload.text);
				else unassignedUserMessageTextCounts.set(event.payload.text, remaining - 1);
				return false;
			}
		}
		return !isCoveredRunNotification(baseTrace, event);
	});
	return events.length ? { ...overlay, events } : null;
}

function unassignedTranscriptUserMessageTextCounts(nodes: readonly PiboTraceNode[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const node of nodes) {
		if (
			node.type === "user.message" &&
			node.source === "transcript" &&
			!hasCanonicalUserMessageIdentity(node)
		) {
			const text = traceNodeText(node);
			if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
		}
		for (const [text, count] of unassignedTranscriptUserMessageTextCounts(node.children)) {
			counts.set(text, (counts.get(text) ?? 0) + count);
		}
	}
	return counts;
}

function hasCanonicalUserMessageIdentity(node: PiboTraceNode): boolean {
	return [node.id, node.stableKey].some((value) =>
		value?.startsWith("event:message_queued:") || value?.startsWith("event:message_steered:"),
	);
}

function confirmedTraceEventKeys(trace: PiboSessionTraceView): Set<string> {
	const keys = new Set<string>();
	for (const event of trace.rawEvents) {
		const key = traceEventConfirmationKey(event);
		if (key) keys.add(key);
	}
	collectConfirmedTraceNodeKeys(trace.nodes, keys);
	return keys;
}

function collectConfirmedTraceNodeKeys(nodes: readonly PiboTraceNode[], keys: Set<string>): void {
	for (const node of nodes) {
		if (node.type === "user.message") {
			for (const type of ["message_queued", "message_steered"] as const) {
				const prefix = `event:${type}:`;
				const eventId = node.id.startsWith(prefix) ? node.id.slice(prefix.length) : undefined;
				if (eventId) keys.add(`${node.piboSessionId}:${type}:${eventId}`);
				if (node.source === "transcript" && node.entryId) keys.add(`${node.piboSessionId}:${type}:${node.entryId}`);
			}
		}
		if (node.type === "assistant.message") {
			const identity = traceNodeContentIdentity(node, "assistant:");
			if (identity) {
				keys.add(`${node.piboSessionId}:assistant_delta:${identity}`);
				if (node.source === "transcript" || node.completedAt !== undefined) {
					keys.add(`${node.piboSessionId}:assistant_message:${identity}`);
				}
			}
		}
		if (node.type === "model.reasoning") {
			const identity = traceNodeContentIdentity(node, "reasoning:");
			if (identity) {
				keys.add(`${node.piboSessionId}:thinking_delta:${identity}`);
				if (node.source === "transcript") {
					keys.add(`${node.piboSessionId}:thinking_started:${identity}`);
					keys.add(`${node.piboSessionId}:thinking_finished:${identity}`);
				}
			}
		}
		if (node.toolCallId && (node.type === "tool.call" || node.type === "tool.result" || node.type === "agent.delegation")) {
			const identity = `tool:${node.toolCallId}`;
			keys.add(`${node.piboSessionId}:tool_call:${identity}`);
			const completed = node.completedAt !== undefined || node.type === "tool.result" || node.status === "error";
			if (node.status === "running" || node.output !== undefined || completed) {
				keys.add(`${node.piboSessionId}:tool_execution_started:${identity}`);
			}
			if ((node.output !== undefined && !completed) || completed) {
				keys.add(`${node.piboSessionId}:tool_execution_updated:${identity}`);
			}
			if (completed) keys.add(`${node.piboSessionId}:tool_execution_finished:${identity}`);
		}
		collectConfirmedTraceNodeKeys(node.children, keys);
	}
}

function isCoveredRunNotification(baseTrace: PiboSessionTraceView, event: ChatWebStoredEvent): boolean {
	const payload = event.payload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
	const source = "source" in payload ? payload.source : undefined;
	const text = "text" in payload ? payload.text : undefined;
	if (source !== "service" || typeof text !== "string" || !parseRunNotificationText(text)) return false;
	return baseTraceTailCoversEvent(baseTrace, event);
}

function baseTraceTailCoversEvent(baseTrace: PiboSessionTraceView, event: ChatWebStoredEvent): boolean {
	const sequence = event.eventSequence;
	if (sequence === undefined || baseTrace.firstEventSequence === undefined) return false;
	const lastSequence = baseTrace.lastEventSequence ?? baseTrace.eventCount;
	return lastSequence !== undefined && sequence >= baseTrace.firstEventSequence && sequence <= lastSequence;
}

function traceEventConfirmationKey(event: ChatWebStoredEvent): string | undefined {
	const payload = event.payload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const eventId = "eventId" in payload && typeof payload.eventId === "string" ? payload.eventId : event.eventId;
	const piboSessionId = "piboSessionId" in payload && typeof payload.piboSessionId === "string" ? payload.piboSessionId : event.piboSessionId;
	if (!piboSessionId) return undefined;
	if (
		event.type === "tool_call" ||
		event.type === "tool_execution_started" ||
		event.type === "tool_execution_updated" ||
		event.type === "tool_execution_finished"
	) {
		const toolCallId = "toolCallId" in payload && typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
		return toolCallId ? `${piboSessionId}:${event.type}:tool:${toolCallId}` : undefined;
	}
	if (!eventId) return undefined;
	if (event.type === "assistant_delta" || event.type === "assistant_message") {
		const partIndex = numericPayloadField(payload, "assistantIndex") ?? numericPayloadField(payload, "contentIndex");
		const identity = partIndex === undefined ? eventId : `${eventId}:assistant:${partIndex}`;
		return `${piboSessionId}:${event.type}:${identity}`;
	}
	if (event.type === "thinking_started" || event.type === "thinking_delta" || event.type === "thinking_finished") {
		const partIndex = numericPayloadField(payload, "thinkingIndex") ?? numericPayloadField(payload, "contentIndex");
		const identity = partIndex === undefined ? eventId : `${eventId}:thinking:${partIndex}`;
		return `${piboSessionId}:${event.type}:${identity}`;
	}
	return `${piboSessionId}:${event.type}:${eventId}`;
}

function traceNodeContentIdentity(node: PiboTraceNode, stableKeyPrefix: string): string | undefined {
	if (node.stableKey?.startsWith(stableKeyPrefix)) return node.stableKey.slice(stableKeyPrefix.length);
	return node.eventId;
}

function numericPayloadField(payload: object, key: string): number | undefined {
	const value = key in payload ? (payload as Record<string, unknown>)[key] : undefined;
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function traceNodeText(node: PiboTraceNode): string {
	if (typeof node.output === "string") return node.output;
	if (node.output && typeof node.output === "object" && "text" in node.output && typeof node.output.text === "string") return node.output.text;
	return "";
}
