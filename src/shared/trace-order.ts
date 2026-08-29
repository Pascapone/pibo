export type TraceSource = "transcript" | "product-history" | "event-log" | "live";

export type TraceNodeKind =
	| "user.message"
	| "assistant.message"
	| "agent.turn"
	| "model.reasoning"
	| "tool.call"
	| "tool.result"
	| "agent.delegation"
	| "agent.async"
	| "execution.command"
	| "execution.compaction"
	| "yielded.run"
	| "error";

export type TraceOrderKey = {
	sourceRank: number;
	turnSeq: number;
	renderSequence?: number;
	transcriptIndex?: number;
	contentPartIndex?: number;
	eventSequence?: number;
	streamId?: number;
	streamFrameIndex?: number;
	phaseRank: number;
};

export const TRACE_SOURCE_RANK: Record<TraceSource, number> = {
	transcript: 0,
	"product-history": 1,
	"event-log": 1,
	live: 2,
};

export const TRACE_PHASE_RANK: Record<TraceNodeKind, number> = {
	"user.message": 0,
	"execution.command": 1,
	"execution.compaction": 1,
	"agent.turn": 2,
	"model.reasoning": 3,
	"tool.call": 4,
	"agent.delegation": 4,
	"agent.async": 5,
	"tool.result": 6,
	"yielded.run": 7,
	"assistant.message": 8,
	error: 9,
};

export function historyTraceOrder(
	historyIndex: number,
	contentPartIndex: number,
	type: TraceNodeKind,
	source: Extract<TraceSource, "transcript" | "product-history">,
): TraceOrderKey {
	return {
		sourceRank: TRACE_SOURCE_RANK[source],
		turnSeq: historyIndex,
		transcriptIndex: historyIndex,
		eventSequence: source === "product-history" ? historyIndex : undefined,
		contentPartIndex,
		phaseRank: TRACE_PHASE_RANK[type],
	};
}

/** @deprecated Use historyTraceOrder. */
export function transcriptTraceOrder(
	transcriptIndex: number,
	contentPartIndex: number,
	type: TraceNodeKind,
): TraceOrderKey {
	return historyTraceOrder(transcriptIndex, contentPartIndex, type, "transcript");
}

export function eventTraceOrder(eventSequence: number | undefined, type: TraceNodeKind): TraceOrderKey {
	return {
		sourceRank: TRACE_SOURCE_RANK["event-log"],
		turnSeq: eventSequence ?? Number.MAX_SAFE_INTEGER,
		eventSequence,
		phaseRank: TRACE_PHASE_RANK[type],
	};
}

export function liveTraceOrder(
	streamId: number | undefined,
	streamFrameIndex: number | undefined,
	type: TraceNodeKind,
): TraceOrderKey {
	const streamOrder = streamId ?? Number.MAX_SAFE_INTEGER;
	const frameIndex = streamFrameIndex ?? Number.MAX_SAFE_INTEGER;
	return {
		sourceRank: TRACE_SOURCE_RANK.live,
		turnSeq: streamOrder,
		streamId: streamOrder,
		streamFrameIndex: frameIndex,
		phaseRank: TRACE_PHASE_RANK[type],
	};
}

export function parseTraceStreamFrameId(value: string): { streamId: number; frameIndex: number } | undefined {
	const [stream, frame] = value.split(":");
	if (stream === undefined || frame === undefined) return undefined;
	const streamId = Number(stream);
	const frameIndex = Number(frame);
	if (!Number.isInteger(streamId) || streamId < 0) return undefined;
	if (!Number.isInteger(frameIndex) || frameIndex < 0) return undefined;
	return { streamId, frameIndex };
}

export function childTraceOrder(parent: TraceOrderKey | undefined, type: TraceNodeKind): TraceOrderKey | undefined {
	if (!parent) return undefined;
	return {
		...parent,
		contentPartIndex: (parent.contentPartIndex ?? 0) + 0.1,
		phaseRank: TRACE_PHASE_RANK[type],
	};
}

export function compareTraceOrder(left?: TraceOrderKey, right?: TraceOrderKey): number {
	if (!left && !right) return 0;
	if (!left) return 1;
	if (!right) return -1;
	const leftPosition = canonicalTracePosition(left);
	const rightPosition = canonicalTracePosition(right);
	return (
		leftPosition - rightPosition ||
		left.phaseRank - right.phaseRank ||
		(left.contentPartIndex ?? 0) - (right.contentPartIndex ?? 0) ||
		left.sourceRank - right.sourceRank ||
		(left.transcriptIndex ?? Number.MAX_SAFE_INTEGER) - (right.transcriptIndex ?? Number.MAX_SAFE_INTEGER) ||
		(left.eventSequence ?? Number.MAX_SAFE_INTEGER) - (right.eventSequence ?? Number.MAX_SAFE_INTEGER) ||
		(left.renderSequence ?? Number.MAX_SAFE_INTEGER) - (right.renderSequence ?? Number.MAX_SAFE_INTEGER) ||
		(left.streamId ?? Number.MAX_SAFE_INTEGER) - (right.streamId ?? Number.MAX_SAFE_INTEGER) ||
		(left.streamFrameIndex ?? Number.MAX_SAFE_INTEGER) - (right.streamFrameIndex ?? Number.MAX_SAFE_INTEGER) ||
		left.turnSeq - right.turnSeq
	);
}

/**
 * renderSequence is the cross-authority position contract. Persisted legacy
 * nodes use their durable event sequence in the same monotone per-session
 * number space; the sequencer initializes above both durable maxima. The
 * comparator never selects a field based on the other operand, keeping the
 * relation total and transitive.
 */
function canonicalTracePosition(order: TraceOrderKey): number {
	return order.renderSequence
		?? order.eventSequence
		?? order.transcriptIndex
		?? order.streamId
		?? order.turnSeq;
}
