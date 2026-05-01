export type TraceSource = "transcript" | "event-log" | "live";

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
	| "yielded.run"
	| "error";

export type TraceOrderKey = {
	sourceRank: number;
	turnSeq: number;
	transcriptIndex?: number;
	contentPartIndex?: number;
	eventSequence?: number;
	streamFrameIndex?: number;
	phaseRank: number;
};

export const TRACE_SOURCE_RANK: Record<TraceSource, number> = {
	transcript: 0,
	"event-log": 1,
	live: 2,
};

export const TRACE_PHASE_RANK: Record<TraceNodeKind, number> = {
	"user.message": 0,
	"agent.turn": 1,
	"model.reasoning": 2,
	"tool.call": 3,
	"agent.delegation": 3,
	"agent.async": 4,
	"tool.result": 5,
	"execution.command": 6,
	"yielded.run": 7,
	"assistant.message": 8,
	error: 9,
};

export function transcriptTraceOrder(
	transcriptIndex: number,
	contentPartIndex: number,
	type: TraceNodeKind,
): TraceOrderKey {
	return {
		sourceRank: TRACE_SOURCE_RANK.transcript,
		turnSeq: transcriptIndex,
		transcriptIndex,
		contentPartIndex,
		phaseRank: TRACE_PHASE_RANK[type],
	};
}

export function eventTraceOrder(eventSequence: number | undefined, type: TraceNodeKind): TraceOrderKey {
	return {
		sourceRank: TRACE_SOURCE_RANK["event-log"],
		turnSeq: eventSequence ?? Number.MAX_SAFE_INTEGER,
		eventSequence,
		phaseRank: TRACE_PHASE_RANK[type],
	};
}

export function liveTraceOrder(streamFrameIndex: number | undefined, type: TraceNodeKind): TraceOrderKey {
	const frameIndex = streamFrameIndex ?? Number.MAX_SAFE_INTEGER;
	return {
		sourceRank: TRACE_SOURCE_RANK.live,
		turnSeq: frameIndex,
		streamFrameIndex: frameIndex,
		phaseRank: TRACE_PHASE_RANK[type],
	};
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
	return (
		left.turnSeq - right.turnSeq ||
		(left.transcriptIndex ?? Number.MAX_SAFE_INTEGER) - (right.transcriptIndex ?? Number.MAX_SAFE_INTEGER) ||
		(left.eventSequence ?? Number.MAX_SAFE_INTEGER) - (right.eventSequence ?? Number.MAX_SAFE_INTEGER) ||
		(left.streamFrameIndex ?? Number.MAX_SAFE_INTEGER) - (right.streamFrameIndex ?? Number.MAX_SAFE_INTEGER) ||
		(left.contentPartIndex ?? 0) - (right.contentPartIndex ?? 0) ||
		left.phaseRank - right.phaseRank ||
		left.sourceRank - right.sourceRank
	);
}
