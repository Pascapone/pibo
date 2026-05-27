import type { ChatWebStoredEvent } from "../../../../shared/trace-types.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../types";
import { isUserMessageQueuedEvent } from "./optimistic-user-messages";

export type LiveTraceOverlay = {
	piboSessionId: string;
	events: ChatWebStoredEvent[];
};

export function trimLiveOverlayForBaseTrace(overlay: LiveTraceOverlay | null, baseTrace: PiboSessionTraceView): LiveTraceOverlay | null {
	if (!overlay || overlay.piboSessionId !== baseTrace.piboSessionId) return overlay;
	const latestStreamId = baseTrace.latestStreamId;
	const confirmedEventKeys = confirmedTraceEventKeys(baseTrace);
	const confirmedUserMessageTexts = confirmedTranscriptUserMessageTexts(baseTrace.nodes);
	const events = overlay.events.filter((event) => {
		if (latestStreamId !== undefined && event.streamId !== undefined && event.streamId <= latestStreamId) return false;
		if (isUserMessageQueuedEvent(event) && confirmedUserMessageTexts.has(event.payload.text)) return false;
		const key = traceEventConfirmationKey(event);
		return !key || !confirmedEventKeys.has(key);
	});
	return events.length ? { ...overlay, events } : null;
}

function confirmedTranscriptUserMessageTexts(nodes: readonly PiboTraceNode[]): Set<string> {
	const texts = new Set<string>();
	for (const node of nodes) {
		if (node.type === "user.message" && node.source === "transcript") {
			const text = traceNodeText(node);
			if (text) texts.add(text);
		}
		for (const text of confirmedTranscriptUserMessageTexts(node.children)) texts.add(text);
	}
	return texts;
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
			const eventId = node.id.startsWith("event:message_queued:") ? node.id.slice("event:message_queued:".length) : undefined;
			if (eventId) keys.add(`${node.piboSessionId}:message_queued:${eventId}`);
			if (node.source === "transcript" && node.entryId) keys.add(`${node.piboSessionId}:message_queued:${node.entryId}`);
		}
		if (node.eventId && node.type === "assistant.message") {
			keys.add(`${node.piboSessionId}:assistant_delta:${node.eventId}`);
			keys.add(`${node.piboSessionId}:assistant_message:${node.eventId}`);
		}
		if (node.eventId && node.type === "model.reasoning") {
			keys.add(`${node.piboSessionId}:thinking_delta:${node.eventId}`);
			keys.add(`${node.piboSessionId}:thinking_finished:${node.eventId}`);
		}
		collectConfirmedTraceNodeKeys(node.children, keys);
	}
}

function traceEventConfirmationKey(event: ChatWebStoredEvent): string | undefined {
	const payload = event.payload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const eventId = "eventId" in payload && typeof payload.eventId === "string" ? payload.eventId : event.eventId;
	const piboSessionId = "piboSessionId" in payload && typeof payload.piboSessionId === "string" ? payload.piboSessionId : event.piboSessionId;
	if (!eventId || !piboSessionId) return undefined;
	return `${piboSessionId}:${event.type}:${eventId}`;
}

function traceNodeText(node: PiboTraceNode): string {
	if (typeof node.output === "string") return node.output;
	if (node.output && typeof node.output === "object" && "text" in node.output && typeof node.output.text === "string") return node.output.text;
	return "";
}
