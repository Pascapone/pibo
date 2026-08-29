import type { PiboOutputEvent } from "../../core/events.js";
import { assistantOutputKey, isLiveOnlyOutputEvent, thinkingOutputKey, toolOutputKey } from "./output-event-policy.js";

export type OutputCompactorResult = {
	liveEvents: PiboOutputEvent[];
	persistedEvents: PiboOutputEvent[];
	snapshots: PiboOutputEvent[];
};

type AssistantBuffer = {
	event: Extract<PiboOutputEvent, { type: "assistant_delta" }>;
	text: string;
};

type ThinkingBuffer = {
	base: Extract<PiboOutputEvent, { type: "thinking_delta" | "thinking_started" }>;
	text: string;
};

export class OutputCompactor {
	private readonly assistantBuffers = new Map<string, AssistantBuffer>();
	private readonly thinkingBuffers = new Map<string, ThinkingBuffer>();
	private readonly toolSnapshots = new Map<string, Extract<PiboOutputEvent, { type: "tool_execution_updated" }>>();

	compact(event: PiboOutputEvent): OutputCompactorResult {
		const persistedEvents: PiboOutputEvent[] = [];
		const snapshots: PiboOutputEvent[] = [];

		switch (event.type) {
			case "assistant_delta": {
				const key = assistantOutputKey(event);
				const previous = this.assistantBuffers.get(key);
				const text = `${previous?.text ?? ""}${event.text}`;
				this.assistantBuffers.set(key, { event, text });
				snapshots.push({ ...event, text });
				break;
			}
			case "assistant_message": {
				const key = assistantOutputKey(event);
				const buffered = this.assistantBuffers.get(key);
				this.assistantBuffers.delete(key);
				persistedEvents.push({ ...event, text: event.text || buffered?.text || "" });
				break;
			}
			case "thinking_started": {
				const key = thinkingOutputKey(event);
				this.thinkingBuffers.set(key, { base: event, text: "" });
				persistedEvents.push(event);
				break;
			}
			case "thinking_delta": {
				const key = thinkingOutputKey(event);
				const previous = this.thinkingBuffers.get(key);
				const text = `${previous?.text ?? ""}${event.text}`;
				this.thinkingBuffers.set(key, { base: previous?.base ?? event, text });
				snapshots.push({ ...event, text });
				break;
			}
			case "thinking_finished": {
				const key = thinkingOutputKey(event);
				const buffered = this.thinkingBuffers.get(key);
				this.thinkingBuffers.delete(key);
				persistedEvents.push({ ...event, text: event.text || buffered?.text || "" });
				break;
			}
			case "tool_execution_updated": {
				this.toolSnapshots.set(toolOutputKey(event), event);
				snapshots.push(event);
				break;
			}
			case "tool_execution_finished": {
				this.toolSnapshots.delete(toolOutputKey(event));
				persistedEvents.push(event);
				break;
			}
			case "message_finished":
			case "session_error": {
				persistedEvents.push(...this.flushForBoundary(event));
				persistedEvents.push(event);
				break;
			}
			default:
				if (!isLiveOnlyOutputEvent(event)) persistedEvents.push(event);
				break;
		}

		return { liveEvents: [event], persistedEvents, snapshots };
	}

	snapshotsForSession(piboSessionId: string): PiboOutputEvent[] {
		const snapshots: PiboOutputEvent[] = [];
		for (const buffer of this.assistantBuffers.values()) {
			if (buffer.event.piboSessionId === piboSessionId) snapshots.push({ ...buffer.event, text: buffer.text });
		}
		for (const buffer of this.thinkingBuffers.values()) {
			if (buffer.base.piboSessionId !== piboSessionId) continue;
			if (buffer.base.type === "thinking_delta") snapshots.push({ ...buffer.base, text: buffer.text });
			else snapshots.push({ ...buffer.base, type: "thinking_delta", text: buffer.text });
		}
		for (const event of this.toolSnapshots.values()) {
			if (event.piboSessionId === piboSessionId) snapshots.push(event);
		}
		return snapshots;
	}

	private flushForBoundary(event: Extract<PiboOutputEvent, { type: "message_finished" | "session_error" }>): PiboOutputEvent[] {
		const flushed: PiboOutputEvent[] = [];
		for (const [key, buffer] of Array.from(this.assistantBuffers.entries())) {
			if (!matchesBoundary(buffer.event, event)) continue;
			this.assistantBuffers.delete(key);
			flushed.push({
				type: "assistant_message",
				piboSessionId: buffer.event.piboSessionId,
				eventId: buffer.event.eventId,
				renderSequence: buffer.event.renderSequence,
				assistantIndex: buffer.event.assistantIndex,
				contentIndex: buffer.event.contentIndex,
				text: buffer.text,
			});
		}
		for (const [key, buffer] of Array.from(this.thinkingBuffers.entries())) {
			if (!matchesBoundary(buffer.base, event)) continue;
			this.thinkingBuffers.delete(key);
			flushed.push({
				type: "thinking_finished",
				piboSessionId: buffer.base.piboSessionId,
				eventId: buffer.base.eventId,
				renderSequence: buffer.base.renderSequence,
				thinkingIndex: "thinkingIndex" in buffer.base ? buffer.base.thinkingIndex : undefined,
				contentIndex: buffer.base.contentIndex,
				text: buffer.text,
			});
		}
		return flushed;
	}
}

function matchesBoundary(
	bufferEvent: { piboSessionId: string; eventId?: string },
	boundary: { piboSessionId: string; eventId?: string; type: string },
): boolean {
	if (bufferEvent.piboSessionId !== boundary.piboSessionId) return false;
	if (boundary.type === "session_error") return !boundary.eventId || bufferEvent.eventId === boundary.eventId;
	return bufferEvent.eventId === boundary.eventId;
}
