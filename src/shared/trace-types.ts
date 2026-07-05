import type { TraceOrderKey, TraceSource } from "./trace-order.js";

export type PiboTraceNodeType =
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

export type PiboTraceNodeStatus = "running" | "done" | "error";

export type PiboTraceSource = TraceSource;

export type PiboTraceOrderKey = TraceOrderKey;

export type PiboTraceNode = {
	id: string;
	parentId?: string;
	entryId?: string;
	piboSessionId: string;
	eventId?: string;
	toolCallId?: string;
	runId?: string;
	type: PiboTraceNodeType;
	title: string;
	status: PiboTraceNodeStatus;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	summary?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	payloadRefs?: Partial<Record<"input" | "output" | "reasoning" | "error" | "raw", TracePayloadRef>>;
	linkedPiboSessionId?: string;
	source?: PiboTraceSource;
	stableKey?: string;
	orderKey?: PiboTraceOrderKey;
	children: PiboTraceNode[];
};

export type TracePayloadRef = {
	ref: string;
	contentType: "text/markdown" | "text/plain" | "application/json" | "application/x-ndjson" | "application/octet-stream";
	byteLength: number;
	preview: string;
	truncatedPreview: boolean;
	hash?: string;
};

export type TraceTimelineNode = {
	nodeId: string;
	parentId?: string;
	piboSessionId: string;
	type: PiboTraceNodeType;
	status: PiboTraceNodeStatus;
	title: string;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	orderKey?: PiboTraceOrderKey;
	depth: number;
	hasChildren: boolean;
	childCount?: number;
	preview?: {
		text: string;
		source: "summary" | "payload" | "error";
		truncated: boolean;
	};
	inlinePayloads?: Partial<Record<"input" | "output" | "reasoning" | "error", unknown>>;
	payloadRefs?: Partial<Record<"input" | "output" | "reasoning" | "error" | "raw", TracePayloadRef>>;
	linkedPiboSessionId?: string;
	toolCallId?: string;
	runId?: string;
	eventId?: string;
	entryId?: string;
	source?: PiboTraceSource;
	stableKey?: string;
};

export type TraceTimelinePage = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	version: string;
	latestStreamId?: number;
	projectionStatus: "ready" | "stale" | "rebuilding" | "failed";
	cursor: {
		before?: string;
		after?: string;
		hasOlder: boolean;
		hasNewer: boolean;
	};
	nodes: TraceTimelineNode[];
	responseBudget: {
		nodeLimit: number;
		byteLimit: number;
		truncatedByBytes: boolean;
	};
	eventCount?: number;
	pageSize?: number;
	firstEventSequence?: number;
	lastEventSequence?: number;
	nextBeforeSequence?: number;
	nextBeforeCursor?: string;
	hasOlderEvents?: boolean;
};

export type TracePayloadChunk = {
	ref: TracePayloadRef;
	offset: number;
	limit: number;
	data: string;
	byteLength: number;
	nextOffset?: number;
	hasMore: boolean;
};

export type TraceRawEventsPage = {
	piboSessionId: string;
	cursor: {
		before?: string;
		hasOlder: boolean;
	};
	limit: number;
	events: ChatWebStoredEvent[];
	responseBudget: {
		byteLimit: number;
		truncatedByBytes: boolean;
	};
};

export type ChatWebStoredEvent<T = unknown> = {
	id: string;
	piboSessionId?: string;
	eventSequence?: number;
	eventId?: string;
	streamId?: number;
	streamFrameIndex?: number;
	type: string;
	createdAt: string;
	payload: T;
};

export type PiboWebSessionStatus = "idle" | "running" | "error";

export type PiboSessionTraceSummary = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	version: string;
	latestStreamId?: number;
	eventCount: number;
	status?: PiboWebSessionStatus;
};

export type PiboSessionTraceView = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	version: string;
	latestStreamId?: number;
	eventCount?: number;
	eventLimit?: number;
	pageSize?: number;
	beforeSequence?: number;
	beforeCursor?: string;
	firstEventSequence?: number;
	lastEventSequence?: number;
	nextBeforeSequence?: number;
	nextBeforeCursor?: string;
	hasOlderEvents?: boolean;
	nodes: PiboTraceNode[];
	rawEvents: ChatWebStoredEvent[];
};
