import { createHash } from "node:crypto";
import type { PiboOutputEvent } from "./events.js";

const RENDER_SEQUENCE_SLOTS_PER_MILLISECOND = 1_000;
const MAX_TRACKED_SESSIONS = 1_024;
const MAX_RECENT_SEGMENTS_PER_SESSION = 1_024;
const MAX_RECENT_TOOL_INVOCATIONS_PER_SESSION = 1_024;

export type OutputRenderHighWaterStore = {
	claimOutputRenderSequence(piboSessionId: string, minimum: number): number;
	observeOutputRenderSequence(piboSessionId: string, sequence: number): void;
	claimOutputToolInvocationOrdinal?(piboSessionId: string, eventId: string, toolCallId: string): number;
	observeOutputToolInvocationOrdinal?(piboSessionId: string, eventId: string, toolCallId: string, ordinal: number): void;
	claimOrAttachOutputToolInvocation?(input: OutputToolInvocationTransition): number;
	observeOutputToolInvocation?(input: OutputToolInvocationTransition & { ordinal: number }): void;
};

export type OutputToolInvocationTransition = {
	piboSessionId: string;
	eventId: string;
	toolCallId: string;
	eventType: Extract<PiboOutputEvent, { toolCallId?: string }>["type"];
	callFingerprint?: string;
};

export function outputRenderHighWaterStore(value: unknown): OutputRenderHighWaterStore | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Partial<OutputRenderHighWaterStore>;
	return typeof candidate.claimOutputRenderSequence === "function"
		&& typeof candidate.observeOutputRenderSequence === "function"
		? candidate as OutputRenderHighWaterStore
		: undefined;
}

type ToolInvocationState = {
	ordinal: number;
	seen: Set<PiboOutputEvent["type"]>;
	closed: boolean;
	persistedIdentity: boolean;
};

type SessionSequenceState = {
	positions: Map<string, number>;
	segmentEventIds: Map<string, string | undefined>;
	activeSegments: Set<string>;
	completedSegments: Set<string>;
	activeEventId?: string;
	toolInvocations: Map<string, ToolInvocationState[]>;
	lastSequence: number;
};

type OutputRenderSequencerOptions = {
	now?: () => number;
	highWaterStore?: OutputRenderHighWaterStore;
};

/**
 * Assigns one monotonic position to each conceptual output segment. Deltas and
 * lifecycle events for the same segment reuse the first position.
 */
export class OutputRenderSequencer {
	private readonly sessions = new Map<string, SessionSequenceState>();
	private readonly now: () => number;
	private readonly highWaterStore?: OutputRenderHighWaterStore;

	constructor(nowOrOptions: (() => number) | OutputRenderSequencerOptions = Date.now) {
		if (typeof nowOrOptions === "function") {
			this.now = nowOrOptions;
		} else {
			this.now = nowOrOptions.now ?? Date.now;
			this.highWaterStore = nowOrOptions.highWaterStore;
		}
	}

	position<TEvent extends PiboOutputEvent>(event: TEvent): TEvent {
		const state = this.sessionState(event.piboSessionId);
		this.trackActiveTurn(state, event);
		const eventWithToolIdentity = this.positionToolInvocation(state, event);
		const key = outputRenderSegmentKey(eventWithToolIdentity, state.activeEventId);
		const supplied = validRenderSequence(eventWithToolIdentity.renderSequence)
			? eventWithToolIdentity.renderSequence
			: undefined;
		const existing = supplied ?? (key ? state.positions.get(key) : undefined);
		const renderSequence = existing ?? this.nextSequence(event.piboSessionId, state);
		state.lastSequence = Math.max(state.lastSequence, renderSequence);
		if (supplied !== undefined) this.highWaterStore?.observeOutputRenderSequence(event.piboSessionId, supplied);
		if (key && !state.positions.has(key)) state.positions.set(key, renderSequence);
		const positioned = eventWithToolIdentity.renderSequence === renderSequence
			? eventWithToolIdentity
			: { ...eventWithToolIdentity, renderSequence } as TEvent;
		if (event.type === "message_finished" || event.type === "session_error") {
			const eventId = "eventId" in event ? event.eventId : undefined;
			if ((eventId && state.activeEventId === eventId) || (event.type === "session_error" && !eventId)) {
				state.activeEventId = undefined;
			}
		}
		const segmentEventId = "eventId" in positioned && positioned.eventId ? positioned.eventId : state.activeEventId;
		this.updateSegmentLifecycle(state, positioned, key, segmentEventId);
		this.trimSessions();
		return positioned;
	}

	disposeSession(piboSessionId: string): void {
		this.sessions.delete(piboSessionId);
	}

	disposeAll(): void {
		this.sessions.clear();
	}

	debugState(): {
		sessionCount: number;
		completedSessionCount: number;
		sessions: string[];
		positionCount: number;
		toolInvocationCount: number;
	} {
		let positionCount = 0;
		let toolInvocationCount = 0;
		let completedSessionCount = 0;
		for (const state of this.sessions.values()) {
			positionCount += state.positions.size;
			for (const invocations of state.toolInvocations.values()) toolInvocationCount += invocations.length;
			if (sessionCanBeEvicted(state)) completedSessionCount += 1;
		}
		return { sessionCount: this.sessions.size, completedSessionCount, sessions: [...this.sessions.keys()], positionCount, toolInvocationCount };
	}

	private sessionState(piboSessionId: string): SessionSequenceState {
		const existing = this.sessions.get(piboSessionId);
		if (existing) {
			this.sessions.delete(piboSessionId);
			this.sessions.set(piboSessionId, existing);
			return existing;
		}
		const state: SessionSequenceState = {
			positions: new Map(),
			segmentEventIds: new Map(),
			activeSegments: new Set(),
			completedSegments: new Set(),
			toolInvocations: new Map(),
			lastSequence: 0,
		};
		this.sessions.set(piboSessionId, state);
		return state;
	}

	private positionToolInvocation<TEvent extends PiboOutputEvent>(state: SessionSequenceState, event: TEvent): TEvent {
		if (!isToolIdentityEvent(event) || !event.toolCallId) return event;
		const eventId = event.eventId ?? state.activeEventId;
		const counterKey = toolInvocationCounterKey(eventId, event.toolCallId);
		let invocations = state.toolInvocations.get(counterKey);
		if (!invocations) {
			invocations = [];
			state.toolInvocations.set(counterKey, invocations);
		}
		let invocation: ToolInvocationState | undefined;
		const transition = eventId ? {
			piboSessionId: event.piboSessionId,
			eventId,
			toolCallId: event.toolCallId,
			eventType: event.type,
			...(event.type === "tool_call" ? { callFingerprint: toolCallFingerprint(event) } : {}),
		} : undefined;
		if (validToolInvocationOrdinal(event.toolInvocationOrdinal)) {
			if (eventId) this.highWaterStore?.observeOutputToolInvocationOrdinal?.(event.piboSessionId, eventId, event.toolCallId, event.toolInvocationOrdinal);
			if (transition) this.highWaterStore?.observeOutputToolInvocation?.({ ...transition, ordinal: event.toolInvocationOrdinal });
			invocation = invocations.find((candidate) => candidate.ordinal === event.toolInvocationOrdinal);
			if (!invocation) {
				invocation = { ordinal: event.toolInvocationOrdinal, seen: new Set(), closed: false, persistedIdentity: true };
				invocations.push(invocation);
			}
			invocation.persistedIdentity = true;
		} else {
			const latest = invocations.at(-1);
			if (!latest) {
				invocation = this.createToolInvocation(invocations, event.piboSessionId, eventId, event.toolCallId, transition);
			} else if (event.type === "tool_call" && (latest.seen.has("tool_call") || (latest.closed && latest.persistedIdentity))) {
				invocation = this.createToolInvocation(invocations, event.piboSessionId, eventId, event.toolCallId, transition);
			} else if (event.type === "tool_execution_started" && latest.closed && latest.seen.has("tool_execution_started")) {
				invocation = this.createToolInvocation(invocations, event.piboSessionId, eventId, event.toolCallId, transition);
			} else {
				invocation = latest;
				if (transition) this.highWaterStore?.observeOutputToolInvocation?.({ ...transition, ordinal: latest.ordinal });
			}
		}
		invocation.seen.add(event.type);
		if (event.type === "tool_execution_finished") invocation.closed = true;
		this.trimToolInvocations(state);
		const needsEventId = !event.eventId && eventId !== undefined;
		return event.toolInvocationOrdinal === invocation.ordinal && !needsEventId
			? event
			: { ...event, ...(needsEventId ? { eventId } : {}), toolInvocationOrdinal: invocation.ordinal } as TEvent;
	}

	private trimToolInvocations(state: SessionSequenceState): void {
		let total = 0;
		for (const invocations of state.toolInvocations.values()) total += invocations.length;
		while (total > MAX_RECENT_TOOL_INVOCATIONS_PER_SESSION) {
			let removed = false;
			for (const [key, invocations] of state.toolInvocations) {
				const closedIndex = invocations.findIndex((invocation) => invocation.closed);
				if (closedIndex === -1) continue;
				invocations.splice(closedIndex, 1);
				total -= 1;
				if (!invocations.length) state.toolInvocations.delete(key);
				removed = true;
				break;
			}
			if (!removed) break;
		}
	}

	private createToolInvocation(
		invocations: ToolInvocationState[],
		piboSessionId: string,
		eventId: string | undefined,
		toolCallId: string,
		transition: OutputToolInvocationTransition | undefined,
	): ToolInvocationState {
		const localNext = invocations.reduce((maximum, invocation) => Math.max(maximum, invocation.ordinal), -1) + 1;
		const ordinal = transition
			? this.highWaterStore?.claimOrAttachOutputToolInvocation?.(transition)
				?? this.highWaterStore?.claimOutputToolInvocationOrdinal?.(piboSessionId, eventId!, toolCallId)
				?? localNext
			: localNext;
		return createInvocation(invocations, ordinal);
	}

	private updateSegmentLifecycle(
		state: SessionSequenceState,
		event: PiboOutputEvent,
		key: string | undefined,
		segmentEventId: string | undefined,
	): void {
		if (key && !state.segmentEventIds.has(key)) {
			state.segmentEventIds.set(key, segmentEventId);
		}
		if (event.type === "message_finished" || event.type === "session_error") {
			const boundaryEventId = event.eventId;
			for (const segmentKey of state.positions.keys()) {
				if (event.type === "session_error" && !boundaryEventId) this.completeSegment(state, segmentKey);
				else if (boundaryEventId && state.segmentEventIds.get(segmentKey) === boundaryEventId) this.completeSegment(state, segmentKey);
			}
			return;
		}
		if (!key) return;
		if (segmentCompletesWith(event)) this.completeSegment(state, key);
		else if (segmentRemainsActive(event)) {
			state.completedSegments.delete(key);
			state.activeSegments.add(key);
		}
	}

	private completeSegment(state: SessionSequenceState, key: string): void {
		state.activeSegments.delete(key);
		state.completedSegments.delete(key);
		state.completedSegments.add(key);
		while (state.completedSegments.size > MAX_RECENT_SEGMENTS_PER_SESSION) {
			const oldest = state.completedSegments.values().next().value as string | undefined;
			if (oldest === undefined) break;
			state.completedSegments.delete(oldest);
			if (!state.activeSegments.has(oldest)) {
				state.positions.delete(oldest);
				state.segmentEventIds.delete(oldest);
			}
		}
	}

	private trimSessions(): void {
		let removable = [...this.sessions.entries()].filter(([, state]) => sessionCanBeEvicted(state));
		while (removable.length > MAX_TRACKED_SESSIONS) {
			const [sessionId] = removable.shift()!;
			this.sessions.delete(sessionId);
		}
	}

	private trackActiveTurn(state: SessionSequenceState, event: PiboOutputEvent): void {
		if (event.type === "message_started" && event.eventId) state.activeEventId = event.eventId;
	}

	private nextSequence(piboSessionId: string, state: SessionSequenceState): number {
		const wallClockSequence = Math.floor(this.now()) * RENDER_SEQUENCE_SLOTS_PER_MILLISECOND;
		const minimum = Math.max(wallClockSequence, state.lastSequence + 1);
		const next = this.highWaterStore?.claimOutputRenderSequence(piboSessionId, minimum) ?? minimum;
		state.lastSequence = Math.max(state.lastSequence, next);
		return next;
	}
}

function createInvocation(invocations: ToolInvocationState[], ordinal: number): ToolInvocationState {
	const invocation = { ordinal, seen: new Set<PiboOutputEvent["type"]>(), closed: false, persistedIdentity: false };
	invocations.push(invocation);
	return invocation;
}

function segmentRemainsActive(event: PiboOutputEvent): boolean {
	return event.type === "message_started"
		|| event.type === "assistant_delta"
		|| event.type === "thinking_started"
		|| event.type === "thinking_delta"
		|| event.type === "tool_call"
		|| event.type === "tool_execution_started"
		|| event.type === "tool_execution_updated";
}

function segmentCompletesWith(event: PiboOutputEvent): boolean {
	return event.type === "assistant_message"
		|| event.type === "thinking_finished"
		|| event.type === "tool_execution_finished"
		|| event.type === "execution_result"
		|| event.type === "compaction_end"
		|| event.type === "approval_resolved"
		|| event.type === "user_input_resolved";
}

function sessionCanBeEvicted(state: SessionSequenceState): boolean {
	return state.activeEventId === undefined && state.activeSegments.size === 0;
}

export function validToolInvocationOrdinal(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isToolIdentityEvent(event: PiboOutputEvent): event is Extract<PiboOutputEvent, {
	type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished" | "subagent_session";
}> {
	return event.type === "tool_call"
		|| event.type === "tool_execution_started"
		|| event.type === "tool_execution_updated"
		|| event.type === "tool_execution_finished"
		|| event.type === "subagent_session";
}

function toolInvocationCounterKey(eventId: string | undefined, toolCallId: string): string {
	return JSON.stringify([eventId ?? "unscoped", toolCallId]);
}

function toolCallFingerprint(event: Extract<PiboOutputEvent, { type: "tool_call" }>): string {
	return createHash("sha256")
		.update(JSON.stringify([event.toolName, event.argsComplete, event.args]))
		.digest("hex");
}

export function validRenderSequence(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function outputRenderSegmentKey(event: PiboOutputEvent, activeEventId: string | undefined): string | undefined {
	const eventId = "eventId" in event && event.eventId ? event.eventId : activeEventId;
	switch (event.type) {
		case "message_queued":
		case "message_steered":
			return eventId ? `user:${eventId}` : undefined;
		case "message_started":
		case "message_finished":
			return eventId ? `turn:${eventId}` : undefined;
		case "assistant_delta":
		case "assistant_message":
			return `assistant:${eventId ?? "active"}:${event.assistantIndex ?? event.contentIndex ?? 0}`;
		case "thinking_started":
		case "thinking_delta":
		case "thinking_finished":
			return `reasoning:${eventId ?? "active"}:${event.thinkingIndex ?? event.contentIndex ?? 0}`;
		case "tool_call":
		case "tool_execution_started":
		case "tool_execution_updated":
		case "tool_execution_finished":
			return `tool:${eventId ?? "active"}:${event.toolCallId}:${event.toolInvocationOrdinal ?? 0}`;
		case "subagent_session":
			return event.toolCallId ? `tool:${eventId ?? "active"}:${event.toolCallId}:${event.toolInvocationOrdinal ?? 0}` : undefined;
		case "compaction_start":
		case "compaction_end":
			return `compaction:${eventId ?? "active"}:${event.compactionIndex ?? 0}`;
		case "approval_requested":
			return `approval:${eventId ?? "active"}:${event.request.requestId}`;
		case "approval_resolved":
			return `approval:${eventId ?? "active"}:${event.requestId}`;
		case "user_input_requested":
			return `user-input:${eventId ?? "active"}:${event.request.requestId}`;
		case "user_input_resolved":
			return `user-input:${eventId ?? "active"}:${event.requestId}`;
		case "assistant_usage":
			return `usage:${eventId ?? "active"}:${event.usageIndex ?? 0}`;
		case "session_error":
			return `error:${eventId ?? "active"}`;
		case "execution_result":
			return `execution:${eventId ?? event.action}`;
		default:
			return undefined;
	}
}
