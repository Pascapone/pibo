import { createHash } from "node:crypto";
import type { PiboOutputEvent } from "./events.js";

const RENDER_SEQUENCE_SLOTS_PER_MILLISECOND = 1_000;
const MAX_TRACKED_SESSIONS = 1_024;
const MAX_RECENT_SEGMENTS_PER_SESSION = 1_024;
const MAX_RECENT_TOOL_INVOCATIONS_PER_SESSION = 1_024;
const MAX_RECENT_OUTPUT_PARTS_PER_SESSION = 1_024;

export type OutputRenderHighWaterStore = {
	claimOutputRenderSequence(piboSessionId: string, minimum: number): number;
	observeOutputRenderSequence(piboSessionId: string, sequence: number): void;
	claimOutputToolInvocationOrdinal?(piboSessionId: string, eventId: string, toolCallId: string): number;
	observeOutputToolInvocationOrdinal?(piboSessionId: string, eventId: string, toolCallId: string, ordinal: number): void;
	claimOrAttachOutputToolInvocation?(input: OutputToolInvocationTransition): number;
	observeOutputToolInvocation?(input: OutputToolInvocationTransition & { ordinal: number }): void;
	claimOrAttachOutputPart?(input: OutputPartTransition): number;
	observeOutputPart?(input: OutputPartTransition & { index: number }): void;
};

export type OutputPartKind = "assistant" | "thinking" | "usage" | "compaction";

export type OutputPartTransition = {
	piboSessionId: string;
	eventId: string;
	kind: OutputPartKind;
	proposedIndex: number;
	suppliedIndex?: number;
	canonicalIndex?: boolean;
	fingerprint: string;
	identityFingerprint: string;
	terminal: boolean;
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
	callFingerprint?: string;
};

type OutputPartState = {
	index: number;
	closed: boolean;
};

type SessionSequenceState = {
	positions: Map<string, number>;
	segmentEventIds: Map<string, string | undefined>;
	activeSegments: Set<string>;
	completedSegments: Set<string>;
	activeEventId?: string;
	toolInvocations: Map<string, ToolInvocationState[]>;
	outputParts: Map<string, OutputPartState[]>;
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
		const eventWithPartIdentity = this.positionOutputPart(state, event);
		const eventWithToolIdentity = this.positionToolInvocation(state, eventWithPartIdentity);
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
			outputParts: new Map(),
			lastSequence: 0,
		};
		this.sessions.set(piboSessionId, state);
		return state;
	}

	private positionOutputPart<TEvent extends PiboOutputEvent>(state: SessionSequenceState, event: TEvent): TEvent {
		const transition = outputPartTransition(event, state.activeEventId);
		if (!transition) return event;
		const key = outputPartCounterKey(transition.eventId, transition.kind);
		const parts = state.outputParts.get(key) ?? [];
		if (!state.outputParts.has(key)) state.outputParts.set(key, parts);
		const suppliedPart = transition.suppliedIndex === undefined
			? undefined
			: parts.find((part) => part.index === transition.suppliedIndex);
		if (transition.suppliedIndex !== undefined && (transition.canonicalIndex || suppliedPart)) {
			this.highWaterStore?.observeOutputPart?.({ ...transition, index: transition.suppliedIndex });
			this.recordOutputPart(parts, transition.suppliedIndex, transition.terminal);
			this.trimOutputParts(state);
			return event;
		}
		const latestOpen = [...parts].reverse().find((part) => !part.closed);
		const localMaximum = parts.reduce((maximum, part) => Math.max(maximum, part.index), -1);
		const localIndex = latestOpen?.index
			?? (transition.proposedIndex > localMaximum ? transition.proposedIndex : localMaximum + 1);
		const index = latestOpen
			? localIndex
			: this.highWaterStore?.claimOrAttachOutputPart?.({ ...transition, proposedIndex: localIndex }) ?? localIndex;
		this.recordOutputPart(parts, index, transition.terminal);
		this.trimOutputParts(state);
		return withOutputPartIndex(event, transition.kind, index);
	}

	private recordOutputPart(parts: OutputPartState[], index: number, terminal: boolean): void {
		let part = parts.find((candidate) => candidate.index === index);
		if (!part) {
			part = { index, closed: false };
			parts.push(part);
		}
		if (terminal) part.closed = true;
	}

	private trimOutputParts(state: SessionSequenceState): void {
		let total = 0;
		for (const parts of state.outputParts.values()) total += parts.length;
		while (total > MAX_RECENT_OUTPUT_PARTS_PER_SESSION) {
			let removed = false;
			for (const [key, parts] of state.outputParts) {
				const closedIndex = parts.findIndex((part) => part.closed);
				if (closedIndex === -1) continue;
				parts.splice(closedIndex, 1);
				total -= 1;
				if (!parts.length) state.outputParts.delete(key);
				removed = true;
				break;
			}
			if (!removed) break;
		}
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
			} else if (event.type === "tool_call" && toolCallStartsNewInvocation(latest, transition?.callFingerprint)) {
				invocation = this.createToolInvocation(invocations, event.piboSessionId, eventId, event.toolCallId, transition);
			} else if (event.type === "tool_execution_started" && latest.closed && latest.seen.has("tool_execution_started")) {
				invocation = this.createToolInvocation(invocations, event.piboSessionId, eventId, event.toolCallId, transition);
			} else {
				invocation = latest;
				if (transition) this.highWaterStore?.observeOutputToolInvocation?.({ ...transition, ordinal: latest.ordinal });
			}
		}
		invocation.seen.add(event.type);
		if (event.type === "tool_call" && transition?.callFingerprint) invocation.callFingerprint = transition.callFingerprint;
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

function toolCallStartsNewInvocation(invocation: ToolInvocationState, callFingerprint: string | undefined): boolean {
	if (!invocation.seen.has("tool_call")) return invocation.closed && invocation.persistedIdentity;
	if (invocation.closed) return true;
	if (invocation.callFingerprint === undefined) return false;
	return callFingerprint === undefined || invocation.callFingerprint !== callFingerprint;
}

function outputPartTransition(event: PiboOutputEvent, activeEventId: string | undefined): OutputPartTransition | undefined {
	const eventId = ("eventId" in event ? event.eventId : undefined) ?? activeEventId;
	if (!eventId) return undefined;
	if (event.type === "assistant_delta" || event.type === "assistant_message") {
		return {
			piboSessionId: event.piboSessionId,
			eventId,
			kind: "assistant",
			proposedIndex: event.assistantIndex ?? event.contentIndex ?? 0,
			...(validOutputPartIndex(event.assistantIndex)
				? { suppliedIndex: event.assistantIndex, canonicalIndex: validRenderSequence(event.renderSequence) }
				: {}),
			fingerprint: outputPartFingerprint(event),
			identityFingerprint: outputIdentityFingerprint(event),
			terminal: event.type === "assistant_message",
		};
	}
	if (event.type === "thinking_started" || event.type === "thinking_delta" || event.type === "thinking_finished") {
		return {
			piboSessionId: event.piboSessionId,
			eventId,
			kind: "thinking",
			proposedIndex: event.thinkingIndex ?? event.contentIndex ?? 0,
			...(validOutputPartIndex(event.thinkingIndex)
				? { suppliedIndex: event.thinkingIndex, canonicalIndex: validRenderSequence(event.renderSequence) }
				: {}),
			fingerprint: outputPartFingerprint(event),
			identityFingerprint: outputIdentityFingerprint(event),
			terminal: event.type === "thinking_finished",
		};
	}
	if (event.type === "assistant_usage") {
		return {
			piboSessionId: event.piboSessionId,
			eventId,
			kind: "usage",
			proposedIndex: event.usageIndex ?? 0,
			...(validOutputPartIndex(event.usageIndex)
				? { suppliedIndex: event.usageIndex, canonicalIndex: validRenderSequence(event.renderSequence) }
				: {}),
			fingerprint: outputPartFingerprint(event),
			identityFingerprint: outputIdentityFingerprint(event),
			terminal: true,
		};
	}
	if (event.type === "compaction_start" || event.type === "compaction_end") {
		return {
			piboSessionId: event.piboSessionId,
			eventId,
			kind: "compaction",
			proposedIndex: event.compactionIndex ?? 0,
			...(validOutputPartIndex(event.compactionIndex)
				? { suppliedIndex: event.compactionIndex, canonicalIndex: validRenderSequence(event.renderSequence) }
				: {}),
			fingerprint: outputPartFingerprint(event),
			identityFingerprint: outputIdentityFingerprint(event),
			terminal: event.type === "compaction_end",
		};
	}
	return undefined;
}

function validOutputPartIndex(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function outputIdentityFingerprint(event: PiboOutputEvent): string {
	const payload = { ...event } as Record<string, unknown>;
	delete payload.renderSequence;
	return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function outputPartFingerprint(event: PiboOutputEvent): string {
	const payload = { ...event } as Record<string, unknown>;
	delete payload.renderSequence;
	delete payload.assistantIndex;
	delete payload.thinkingIndex;
	delete payload.usageIndex;
	delete payload.compactionIndex;
	delete payload.contentIndex;
	return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function outputPartCounterKey(eventId: string, kind: OutputPartKind): string {
	return JSON.stringify([eventId, kind]);
}

function withOutputPartIndex<TEvent extends PiboOutputEvent>(event: TEvent, kind: OutputPartKind, index: number): TEvent {
	if (kind === "assistant" && (event.type === "assistant_delta" || event.type === "assistant_message")) {
		return event.assistantIndex === index ? event : { ...event, assistantIndex: index } as TEvent;
	}
	if (kind === "thinking" && (event.type === "thinking_started" || event.type === "thinking_delta" || event.type === "thinking_finished")) {
		return event.thinkingIndex === index ? event : { ...event, thinkingIndex: index } as TEvent;
	}
	if (kind === "usage" && event.type === "assistant_usage") {
		return event.usageIndex === index ? event : { ...event, usageIndex: index } as TEvent;
	}
	if (kind === "compaction" && (event.type === "compaction_start" || event.type === "compaction_end")) {
		return event.compactionIndex === index ? event : { ...event, compactionIndex: index } as TEvent;
	}
	return event;
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

function toolCallFingerprint(event: Extract<PiboOutputEvent, { type: "tool_call" }>): string | undefined {
	if (!event.argsComplete) return undefined;
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
