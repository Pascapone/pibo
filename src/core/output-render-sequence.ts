import type { PiboOutputEvent } from "./events.js";

const RENDER_SEQUENCE_SLOTS_PER_MILLISECOND = 1_000;

/**
 * Assigns one monotonic position to each conceptual output segment. Deltas and
 * lifecycle events for the same segment reuse the first position.
 */
export class OutputRenderSequencer {
	private readonly positionsBySession = new Map<string, Map<string, number>>();
	private readonly activeEventIdBySession = new Map<string, string>();
	private readonly activeToolOrdinals = new Map<string, number>();
	private readonly latestToolOrdinals = new Map<string, number>();
	private readonly closedToolOrdinals = new Map<string, number>();
	private lastSequence = 0;

	constructor(private readonly now: () => number = Date.now) {}

	position<TEvent extends PiboOutputEvent>(event: TEvent): TEvent {
		this.trackActiveTurn(event);
		const eventWithToolIdentity = this.positionToolInvocation(event);
		const key = outputRenderSegmentKey(eventWithToolIdentity, this.activeEventIdBySession.get(event.piboSessionId));
		const existing = validRenderSequence(eventWithToolIdentity.renderSequence)
			? event.renderSequence
			: key ? this.positionsBySession.get(event.piboSessionId)?.get(key) : undefined;
		const renderSequence = existing ?? this.nextSequence();
		this.lastSequence = Math.max(this.lastSequence, renderSequence);
		if (key) {
			let positions = this.positionsBySession.get(event.piboSessionId);
			if (!positions) {
				positions = new Map();
				this.positionsBySession.set(event.piboSessionId, positions);
			}
			positions.set(key, renderSequence);
		}
		const positioned = eventWithToolIdentity.renderSequence === renderSequence
			? eventWithToolIdentity
			: { ...eventWithToolIdentity, renderSequence } as TEvent;
		this.closeToolInvocation(positioned);
		if (event.type === "message_finished" || event.type === "session_error") {
			const eventId = "eventId" in event ? event.eventId : undefined;
			if (eventId && this.activeEventIdBySession.get(event.piboSessionId) === eventId) {
				this.activeEventIdBySession.delete(event.piboSessionId);
			}
		}
		return positioned;
	}

	private positionToolInvocation<TEvent extends PiboOutputEvent>(event: TEvent): TEvent {
		if (!isToolIdentityEvent(event) || !event.toolCallId) return event;
		const activeEventId = this.activeEventIdBySession.get(event.piboSessionId);
		const eventId = event.eventId ?? activeEventId;
		const invocationKey = toolInvocationCounterKey(event.piboSessionId, eventId, event.toolCallId);
		const activeOrdinal = this.activeToolOrdinals.get(invocationKey);
		const latestOrdinal = this.latestToolOrdinals.get(invocationKey);
		let ordinal = validToolInvocationOrdinal(event.toolInvocationOrdinal)
			? event.toolInvocationOrdinal
			: activeOrdinal ?? (event.type === "tool_call" ? undefined : latestOrdinal);
		if (ordinal === undefined) ordinal = (this.latestToolOrdinals.get(invocationKey) ?? -1) + 1;
		this.latestToolOrdinals.set(invocationKey, Math.max(this.latestToolOrdinals.get(invocationKey) ?? -1, ordinal));
		if (event.type !== "subagent_session" && this.closedToolOrdinals.get(invocationKey) !== ordinal) {
			this.activeToolOrdinals.set(invocationKey, ordinal);
		}
		const needsEventId = !event.eventId && eventId !== undefined;
		return event.toolInvocationOrdinal === ordinal && !needsEventId
			? event
			: { ...event, ...(needsEventId ? { eventId } : {}), toolInvocationOrdinal: ordinal } as TEvent;
	}

	private closeToolInvocation(event: PiboOutputEvent): void {
		if (event.type !== "tool_execution_finished") return;
		const eventId = event.eventId ?? this.activeEventIdBySession.get(event.piboSessionId);
		const invocationKey = toolInvocationCounterKey(event.piboSessionId, eventId, event.toolCallId);
		this.activeToolOrdinals.delete(invocationKey);
		if (event.toolInvocationOrdinal !== undefined) this.closedToolOrdinals.set(invocationKey, event.toolInvocationOrdinal);
	}

	private trackActiveTurn(event: PiboOutputEvent): void {
		if (event.type === "message_started" && event.eventId) {
			this.activeEventIdBySession.set(event.piboSessionId, event.eventId);
		}
	}

	private nextSequence(): number {
		const wallClockSequence = Math.floor(this.now()) * RENDER_SEQUENCE_SLOTS_PER_MILLISECOND;
		this.lastSequence = Math.max(wallClockSequence, this.lastSequence + 1);
		return this.lastSequence;
	}
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

function toolInvocationCounterKey(piboSessionId: string, eventId: string | undefined, toolCallId: string): string {
	return JSON.stringify([piboSessionId, eventId ?? "unscoped", toolCallId]);
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
