import type { PiboOutputEvent } from "../../core/events.js";
import { assistantOutputKey, isLiveOnlyOutputEvent, thinkingOutputKey, toolOutputKey } from "./output-event-policy.js";

const MAX_TRACKED_COMPACTOR_SESSIONS = 1_024;

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
	private readonly sessionBufferCounts = new Map<string, number>();

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
				mutations.push(() => this.setBuffer(this.assistantBuffers, key, next, event.piboSessionId));
				snapshots.push({ ...event, text: next.text });
				break;
			}
			case "assistant_message": {
				const key = assistantOutputKey(event);
				const buffered = this.assistantBuffers.get(key);
				const canonical = { ...event, text: event.text || buffered?.text || "" };
				mutations.push(() => {
					this.deleteBuffer(this.assistantBuffers, key, buffered, event.piboSessionId);
				});
				persistedEvents.push(canonical);
				liveEvents = [canonical];
				break;
			}
			case "thinking_started": {
				const key = thinkingOutputKey(event);
				const next = { base: event, text: "" };
				mutations.push(() => {
					if (!this.thinkingBuffers.has(key)) this.setBuffer(this.thinkingBuffers, key, next, event.piboSessionId);
				});
				persistedEvents.push(event);
				break;
			}
			case "thinking_delta": {
				const key = thinkingOutputKey(event);
				const previous = this.thinkingBuffers.get(key);
				const next = { base: previous?.base ?? event, text: `${previous?.text ?? ""}${event.text}` };
				mutations.push(() => this.setBuffer(this.thinkingBuffers, key, next, event.piboSessionId));
				snapshots.push({ ...event, text: next.text });
				break;
			}
			case "thinking_finished": {
				const key = thinkingOutputKey(event);
				const buffered = this.thinkingBuffers.get(key);
				const canonical = { ...event, text: event.text || buffered?.text || "" };
				mutations.push(() => {
					this.deleteBuffer(this.thinkingBuffers, key, buffered, event.piboSessionId);
				});
				persistedEvents.push(canonical);
				liveEvents = [canonical];
				break;
			}
			case "tool_execution_updated": {
				const key = toolOutputKey(event);
				mutations.push(() => this.setBuffer(this.toolSnapshots, key, event, event.piboSessionId));
				snapshots.push(event);
				break;
			}
			case "tool_execution_finished": {
				const key = toolOutputKey(event);
				const previous = this.toolSnapshots.get(key);
				mutations.push(() => {
					this.deleteBuffer(this.toolSnapshots, key, previous, event.piboSessionId);
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
			if (buffer.event.piboSessionId === piboSessionId) this.deleteBuffer(this.assistantBuffers, key, buffer, piboSessionId);
		}
		for (const [key, buffer] of this.thinkingBuffers) {
			if (buffer.base.piboSessionId === piboSessionId) this.deleteBuffer(this.thinkingBuffers, key, buffer, piboSessionId);
		}
		for (const [key, event] of this.toolSnapshots) {
			if (event.piboSessionId === piboSessionId) this.deleteBuffer(this.toolSnapshots, key, event, piboSessionId);
		}
		this.sessionBufferCounts.delete(piboSessionId);
		this.sessionRecency.delete(piboSessionId);
	}

	disposeAll(): void {
		this.assistantBuffers.clear();
		this.thinkingBuffers.clear();
		this.toolSnapshots.clear();
		this.sessionRecency.clear();
		this.sessionBufferCounts.clear();
	}

	debugState(): {
		sessionCount: number;
		completedSessionCount: number;
		sessions: string[];
		assistantBufferCount: number;
		thinkingBufferCount: number;
		toolSnapshotCount: number;
	} {
		return {
			sessionCount: this.sessionRecency.size,
			completedSessionCount: [...this.sessionRecency.keys()].filter((sessionId) => !this.sessionHasBuffers(sessionId)).length,
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
				this.deleteBuffer(this.assistantBuffers, key, buffer, buffer.event.piboSessionId);
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
				this.deleteBuffer(this.thinkingBuffers, key, buffer, buffer.base.piboSessionId);
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
		let completedCount = [...this.sessionRecency.keys()].filter((sessionId) => !this.sessionHasBuffers(sessionId)).length;
		while (completedCount > MAX_TRACKED_COMPACTOR_SESSIONS) {
			let removed = false;
			for (const sessionId of this.sessionRecency.keys()) {
				if (this.sessionHasBuffers(sessionId)) continue;
				this.sessionRecency.delete(sessionId);
				completedCount -= 1;
				removed = true;
				break;
			}
			if (!removed) break;
		}
	}

	private sessionHasBuffers(piboSessionId: string): boolean {
		return (this.sessionBufferCounts.get(piboSessionId) ?? 0) > 0;
	}

	private setBuffer<T>(map: Map<string, T>, key: string, value: T, piboSessionId: string): void {
		if (!map.has(key)) this.sessionBufferCounts.set(piboSessionId, (this.sessionBufferCounts.get(piboSessionId) ?? 0) + 1);
		setLatest(map, key, value);
	}

	private deleteBuffer<T>(map: Map<string, T>, key: string, expected: T | undefined, piboSessionId: string): void {
		if (expected === undefined || map.get(key) !== expected) return;
		map.delete(key);
		const next = (this.sessionBufferCounts.get(piboSessionId) ?? 1) - 1;
		if (next > 0) this.sessionBufferCounts.set(piboSessionId, next);
		else this.sessionBufferCounts.delete(piboSessionId);
	}
}

function setLatest<TKey, TValue>(map: Map<TKey, TValue>, key: TKey, value: TValue): void {
	map.delete(key);
	map.set(key, value);
}

function matchesBoundary(
	bufferEvent: { piboSessionId: string; eventId?: string },
	boundary: { piboSessionId: string; eventId?: string; type: string },
): boolean {
	if (bufferEvent.piboSessionId !== boundary.piboSessionId) return false;
	if (boundary.type === "session_error") return !boundary.eventId || bufferEvent.eventId === boundary.eventId;
	return bufferEvent.eventId === boundary.eventId;
}
