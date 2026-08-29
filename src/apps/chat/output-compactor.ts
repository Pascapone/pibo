import type { PiboOutputEvent } from "../../core/events.js";
import { assistantOutputKey, isLiveOnlyOutputEvent, thinkingOutputKey, toolOutputKey } from "./output-event-policy.js";

const MAX_TRACKED_COMPACTOR_SESSIONS = 1_024;
const MAX_BUFFER_ENTRIES_PER_KIND = 4_096;

export type OutputCompactorResult = {
	liveEvents: PiboOutputEvent[];
	persistedEvents: PiboOutputEvent[];
	snapshots: PiboOutputEvent[];
};

export type PreparedOutputCompaction = OutputCompactorResult & {
	ack(): void;
	rollback(): void;
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
	private readonly sessionRecency = new Map<string, true>();

	compact(event: PiboOutputEvent): OutputCompactorResult {
		const prepared = this.prepare(event);
		prepared.ack();
		return prepared;
	}

	prepare(event: PiboOutputEvent): PreparedOutputCompaction {
		const persistedEvents: PiboOutputEvent[] = [];
		const snapshots: PiboOutputEvent[] = [];
		let liveEvents: PiboOutputEvent[] = [event];
		const mutations: Array<() => void> = [];

		switch (event.type) {
			case "assistant_delta": {
				const key = assistantOutputKey(event);
				const previous = this.assistantBuffers.get(key);
				const next = { event, text: `${previous?.text ?? ""}${event.text}` };
				mutations.push(() => setBounded(this.assistantBuffers, key, next));
				snapshots.push({ ...event, text: next.text });
				break;
			}
			case "assistant_message": {
				const key = assistantOutputKey(event);
				const buffered = this.assistantBuffers.get(key);
				const canonical = { ...event, text: event.text || buffered?.text || "" };
				mutations.push(() => {
					if (this.assistantBuffers.get(key) === buffered) this.assistantBuffers.delete(key);
				});
				persistedEvents.push(canonical);
				liveEvents = [canonical];
				break;
			}
			case "thinking_started": {
				const key = thinkingOutputKey(event);
				const next = { base: event, text: "" };
				mutations.push(() => setBounded(this.thinkingBuffers, key, next));
				persistedEvents.push(event);
				break;
			}
			case "thinking_delta": {
				const key = thinkingOutputKey(event);
				const previous = this.thinkingBuffers.get(key);
				const next = { base: previous?.base ?? event, text: `${previous?.text ?? ""}${event.text}` };
				mutations.push(() => setBounded(this.thinkingBuffers, key, next));
				snapshots.push({ ...event, text: next.text });
				break;
			}
			case "thinking_finished": {
				const key = thinkingOutputKey(event);
				const buffered = this.thinkingBuffers.get(key);
				const canonical = { ...event, text: event.text || buffered?.text || "" };
				mutations.push(() => {
					if (this.thinkingBuffers.get(key) === buffered) this.thinkingBuffers.delete(key);
				});
				persistedEvents.push(canonical);
				liveEvents = [canonical];
				break;
			}
			case "tool_execution_updated": {
				const key = toolOutputKey(event);
				mutations.push(() => setBounded(this.toolSnapshots, key, event));
				snapshots.push(event);
				break;
			}
			case "tool_execution_finished": {
				const key = toolOutputKey(event);
				const previous = this.toolSnapshots.get(key);
				mutations.push(() => {
					if (this.toolSnapshots.get(key) === previous) this.toolSnapshots.delete(key);
				});
				persistedEvents.push(event);
				break;
			}
			case "message_finished":
			case "session_error": {
				const flushed = this.prepareBoundaryFlush(event, mutations);
				persistedEvents.push(...flushed, event);
				liveEvents = [...flushed, event];
				break;
			}
			default:
				if (!isLiveOnlyOutputEvent(event)) persistedEvents.push(event);
				break;
		}

		let settled = false;
		return {
			liveEvents,
			persistedEvents,
			snapshots,
			ack: () => {
				if (settled) return;
				settled = true;
				for (const mutate of mutations) mutate();
				this.touchSession(event.piboSessionId);
			},
			rollback: () => {
				settled = true;
			},
		};
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

	disposeSession(piboSessionId: string): void {
		for (const [key, buffer] of this.assistantBuffers) {
			if (buffer.event.piboSessionId === piboSessionId) this.assistantBuffers.delete(key);
		}
		for (const [key, buffer] of this.thinkingBuffers) {
			if (buffer.base.piboSessionId === piboSessionId) this.thinkingBuffers.delete(key);
		}
		for (const [key, event] of this.toolSnapshots) {
			if (event.piboSessionId === piboSessionId) this.toolSnapshots.delete(key);
		}
		this.sessionRecency.delete(piboSessionId);
	}

	disposeAll(): void {
		this.assistantBuffers.clear();
		this.thinkingBuffers.clear();
		this.toolSnapshots.clear();
		this.sessionRecency.clear();
	}

	debugState(): {
		sessionCount: number;
		sessions: string[];
		assistantBufferCount: number;
		thinkingBufferCount: number;
		toolSnapshotCount: number;
	} {
		return {
			sessionCount: this.sessionRecency.size,
			sessions: [...this.sessionRecency.keys()],
			assistantBufferCount: this.assistantBuffers.size,
			thinkingBufferCount: this.thinkingBuffers.size,
			toolSnapshotCount: this.toolSnapshots.size,
		};
	}

	private prepareBoundaryFlush(
		event: Extract<PiboOutputEvent, { type: "message_finished" | "session_error" }>,
		mutations: Array<() => void>,
	): PiboOutputEvent[] {
		const flushed: PiboOutputEvent[] = [];
		for (const [key, buffer] of this.assistantBuffers) {
			if (!matchesBoundary(buffer.event, event)) continue;
			mutations.push(() => {
				if (this.assistantBuffers.get(key) === buffer) this.assistantBuffers.delete(key);
			});
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
		for (const [key, buffer] of this.thinkingBuffers) {
			if (!matchesBoundary(buffer.base, event)) continue;
			mutations.push(() => {
				if (this.thinkingBuffers.get(key) === buffer) this.thinkingBuffers.delete(key);
			});
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

	private touchSession(piboSessionId: string): void {
		this.sessionRecency.delete(piboSessionId);
		this.sessionRecency.set(piboSessionId, true);
		while (this.sessionRecency.size > MAX_TRACKED_COMPACTOR_SESSIONS) {
			const oldest = this.sessionRecency.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			this.disposeSession(oldest);
		}
	}
}

function setBounded<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, value: TValue): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > MAX_BUFFER_ENTRIES_PER_KIND) {
		const oldest = map.keys().next().value as TKey | undefined;
		if (oldest === undefined) break;
		map.delete(oldest);
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
