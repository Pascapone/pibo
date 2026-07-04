import { createHash } from "node:crypto";
import type { PiboJsonValue } from "../../core/events.js";
import type { PayloadStore } from "../../data/payload-store.js";
import type {
	ChatWebStoredEvent,
	PiboSessionTraceView,
	PiboTraceNode,
	TracePayloadChunk,
	TracePayloadRef,
	TraceRawEventsPage,
	TraceTimelineNode,
	TraceTimelinePage,
} from "../../shared/trace-types.js";

export const TRACE_V2_DEFAULT_TIMELINE_LIMIT = 50;
export const TRACE_V2_MAX_TIMELINE_LIMIT = 240;
export const TRACE_V2_TIMELINE_HARD_BYTES = 256 * 1024;
export const TRACE_V2_PREVIEW_CHARS = 64;
export const TRACE_V2_INLINE_PAYLOAD_MAX_BYTES = 8 * 1024;
export const TRACE_V2_INLINE_TRANSCRIPT_PAYLOAD_MAX_BYTES = 64 * 1024;
export const TRACE_V2_PAYLOAD_REF_THRESHOLD_BYTES = 4096;
export const TRACE_V2_PAYLOAD_DEFAULT_LIMIT_BYTES = 64 * 1024;
export const TRACE_V2_PAYLOAD_MAX_LIMIT_BYTES = 1024 * 1024;
export const TRACE_V2_RAW_EVENTS_DEFAULT_LIMIT = 80;
export const TRACE_V2_RAW_EVENTS_MAX_LIMIT = 500;
export const TRACE_V2_RAW_EVENTS_HARD_BYTES = 256 * 1024;

type TracePayloadKind = "input" | "output" | "reasoning" | "error" | "raw";

type PayloadRefInput = {
	store: PayloadStore;
	piboSessionId: string;
	nodeId?: string;
	kind: TracePayloadKind;
	value: unknown;
};

export function traceTimelinePageFromView(input: {
	trace: PiboSessionTraceView;
	payloadStore: PayloadStore;
	limit: number;
	byteLimit?: number;
	fromTail?: boolean;
}): TraceTimelinePage {
	const byteLimit = input.byteLimit ?? TRACE_V2_TIMELINE_HARD_BYTES;
	const nodes = compactTraceNodes({
		nodes: input.trace.nodes,
		payloadStore: input.payloadStore,
		piboSessionId: input.trace.piboSessionId,
		limit: Math.max(1, Math.min(input.limit, TRACE_V2_MAX_TIMELINE_LIMIT)),
		fromTail: input.fromTail,
	});
	let page: TraceTimelinePage = {
		piboSessionId: input.trace.piboSessionId,
		piSessionId: input.trace.piSessionId,
		title: input.trace.title,
		version: input.trace.version,
		latestStreamId: input.trace.latestStreamId,
		projectionStatus: "ready",
		cursor: {
			before: input.trace.nextBeforeSequence !== undefined ? String(input.trace.nextBeforeSequence) : undefined,
			after: input.trace.lastEventSequence !== undefined ? String(input.trace.lastEventSequence) : undefined,
			hasOlder: input.trace.hasOlderEvents === true,
			hasNewer: false,
		},
		nodes,
		responseBudget: {
			nodeLimit: input.limit,
			byteLimit,
			truncatedByBytes: false,
		},
		eventCount: input.trace.eventCount,
		pageSize: input.trace.pageSize,
		firstEventSequence: input.trace.firstEventSequence,
		lastEventSequence: input.trace.lastEventSequence,
		nextBeforeSequence: input.trace.nextBeforeSequence,
		hasOlderEvents: input.trace.hasOlderEvents,
	};

	while (Buffer.byteLength(JSON.stringify(page), "utf8") > byteLimit && page.nodes.length > 1) {
		page = {
			...page,
			nodes: page.nodes.slice(Math.ceil(page.nodes.length / 4)),
			responseBudget: { ...page.responseBudget, truncatedByBytes: true },
		};
	}
	return page;
}

export function traceRawEventsPageFromEvents(input: {
	piboSessionId: string;
	events: ChatWebStoredEvent[];
	payloadStore: PayloadStore;
	limit: number;
	byteLimit?: number;
}): TraceRawEventsPage {
	const byteLimit = input.byteLimit ?? TRACE_V2_RAW_EVENTS_HARD_BYTES;
	const limited = input.events.slice(-Math.max(1, Math.min(input.limit, TRACE_V2_RAW_EVENTS_MAX_LIMIT)));
	let page: TraceRawEventsPage = {
		piboSessionId: input.piboSessionId,
		cursor: {
			before: limited[0]?.eventSequence !== undefined ? String(limited[0].eventSequence) : undefined,
			hasOlder: (limited[0]?.eventSequence ?? 1) > 1,
		},
		limit: input.limit,
		events: limited.map((event) => compactRawEvent(event, input.payloadStore, input.piboSessionId)),
		responseBudget: {
			byteLimit,
			truncatedByBytes: false,
		},
	};
	while (Buffer.byteLength(JSON.stringify(page), "utf8") > byteLimit && page.events.length > 1) {
		page = {
			...page,
			events: page.events.slice(Math.ceil(page.events.length / 4)),
			responseBudget: { ...page.responseBudget, truncatedByBytes: true },
		};
	}
	return page;
}

export function parseTracePayloadRef(ref: string): { piboSessionId: string; payloadId: string } | undefined {
	if (!ref.startsWith("trace_")) return undefined;
	try {
		const parsed = JSON.parse(Buffer.from(ref.slice("trace_".length), "base64url").toString("utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") return undefined;
		const record = parsed as { p?: unknown; id?: unknown };
		return typeof record.p === "string" && typeof record.id === "string"
			? { piboSessionId: record.p, payloadId: record.id }
			: undefined;
	} catch {
		return undefined;
	}
}

export function readTracePayloadChunk(input: {
	payloadStore: PayloadStore;
	ref: string;
	offset: number;
	limit: number;
}): TracePayloadChunk | undefined {
	const parsed = parseTracePayloadRef(input.ref);
	if (!parsed) return undefined;
	const payload = input.payloadStore.getPayload(parsed.payloadId);
	if (!payload) return undefined;
	const bytes = Buffer.from(input.payloadStore.readPayloadBytes(parsed.payloadId));
	const offset = Math.max(0, Math.min(input.offset, bytes.byteLength));
	const limit = Math.max(1, Math.min(input.limit, TRACE_V2_PAYLOAD_MAX_LIMIT_BYTES));
	const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + limit));
	const preview = payload.previewText ?? "";
	const traceRef: TracePayloadRef = {
		ref: input.ref,
		contentType: normalizeContentType(payload.contentType),
		byteLength: payload.byteSize,
		preview,
		truncatedPreview: Buffer.byteLength(preview, "utf8") < payload.byteSize,
		hash: payload.sha256,
	};
	const nextOffset = offset + chunk.byteLength < bytes.byteLength ? offset + chunk.byteLength : undefined;
	return {
		ref: traceRef,
		offset,
		limit,
		data: chunk.toString("utf8"),
		byteLength: chunk.byteLength,
		nextOffset,
		hasMore: nextOffset !== undefined,
	};
}

function compactTraceNodes(input: {
	nodes: readonly PiboTraceNode[];
	payloadStore: PayloadStore;
	piboSessionId: string;
	limit: number;
	fromTail?: boolean;
}): TraceTimelineNode[] {
	const result: TraceTimelineNode[] = [];
	const visit = (nodes: readonly PiboTraceNode[], depth: number): void => {
		for (const node of nodes) {
			result.push(compactTraceNode(node, input.payloadStore, input.piboSessionId, depth));
			visit(node.children, depth + 1);
		}
	};
	visit(input.nodes, 0);
	return input.fromTail ? result.slice(-input.limit) : result.slice(0, input.limit);
}

function compactTraceNode(node: PiboTraceNode, payloadStore: PayloadStore, piboSessionId: string, depth: number): TraceTimelineNode {
	const outputKind = node.type === "model.reasoning" ? "reasoning" : "output";
	const inlinePayloads = compactObject({
		input: inlinePayloadForNodeValue(node, "input", node.input),
		[outputKind]: inlinePayloadForNodeValue(node, outputKind, node.output),
		error: inlinePayloadForNodeValue(node, "error", node.error),
	});
	const payloadRefs = compactObject({
		input: inlinePayloads.input === undefined
			? payloadRefForValue({ store: payloadStore, piboSessionId, nodeId: node.id, kind: "input", value: node.input })
			: undefined,
		[outputKind]: inlinePayloads[outputKind] === undefined
			? payloadRefForValue({ store: payloadStore, piboSessionId, nodeId: node.id, kind: outputKind, value: node.output })
			: undefined,
		error: inlinePayloads.error === undefined
			? payloadRefForValue({ store: payloadStore, piboSessionId, nodeId: node.id, kind: "error", value: node.error })
			: undefined,
	});
	const preview = previewForNode(node, payloadRefs);
	return compactObject({
		nodeId: node.id,
		parentId: node.parentId,
		piboSessionId: node.piboSessionId,
		type: node.type,
		status: node.status,
		title: node.title,
		startedAt: node.startedAt,
		completedAt: node.completedAt,
		durationMs: node.durationMs,
		orderKey: node.orderKey,
		depth,
		hasChildren: node.children.length > 0,
		childCount: node.children.length || undefined,
		preview,
		inlinePayloads: Object.keys(inlinePayloads).length ? inlinePayloads : undefined,
		payloadRefs: Object.keys(payloadRefs).length ? payloadRefs : undefined,
		linkedPiboSessionId: node.linkedPiboSessionId,
		toolCallId: node.toolCallId,
		runId: node.runId,
		eventId: node.eventId,
		entryId: node.entryId,
		source: node.source,
		stableKey: node.stableKey,
	}) as TraceTimelineNode;
}

function inlinePayloadForNodeValue(node: PiboTraceNode, kind: TracePayloadKind, value: unknown): PiboJsonValue | string | undefined {
	return inlinePayloadForValue(value, inlinePayloadByteLimit(node, kind));
}

function inlinePayloadByteLimit(node: PiboTraceNode, kind: TracePayloadKind): number {
	if ((node.type === "user.message" || node.type === "assistant.message" || node.type === "model.reasoning") && kind !== "error") {
		return TRACE_V2_INLINE_TRANSCRIPT_PAYLOAD_MAX_BYTES;
	}
	return TRACE_V2_INLINE_PAYLOAD_MAX_BYTES;
}

function inlinePayloadForValue(value: unknown, maxBytes = TRACE_V2_INLINE_PAYLOAD_MAX_BYTES): PiboJsonValue | string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const { bytes } = payloadBytes(value);
	if (bytes.byteLength > maxBytes) return undefined;
	return toPayloadValue(value);
}

function payloadRefForValue(input: PayloadRefInput): TracePayloadRef | undefined {
	if (input.value === undefined || input.value === null || input.value === "") return undefined;
	const { text, bytes, contentType } = payloadBytes(input.value);
	const preview = textPreview(text);
	const truncatedPreview = normalizedPreviewText(text).length > preview.length;
	if (!truncatedPreview && bytes.byteLength <= TRACE_V2_PAYLOAD_REF_THRESHOLD_BYTES) {
		return undefined;
	}
	const payload = input.store.writePayload({
		value: toPayloadValue(input.value),
		contentType,
		retentionClass: "trace_event",
	});
	return {
		ref: encodeTracePayloadRef(input.piboSessionId, payload.id),
		contentType: normalizeContentType(contentType),
		byteLength: bytes.byteLength,
		preview,
		truncatedPreview,
		hash: createHash("sha256").update(bytes).digest("hex"),
	};
}

function previewForNode(
	node: PiboTraceNode,
	payloadRefs: Partial<Record<TracePayloadKind, TracePayloadRef>>,
): TraceTimelineNode["preview"] | undefined {
	if (node.error) {
		const text = textPreview(String(node.error));
		return { text, source: "error", truncated: String(node.error).length > text.length };
	}
	const payloadPreview = payloadRefs.output?.preview ?? payloadRefs.reasoning?.preview ?? payloadRefs.input?.preview;
	if (payloadPreview) return { text: payloadPreview, source: "payload", truncated: true };
	const candidate = node.output ?? node.summary ?? node.input ?? node.title;
	const text = textPreview(textForPreview(candidate));
	if (!text) return undefined;
	return { text, source: node.summary !== undefined && node.output === undefined ? "summary" : "payload", truncated: textForPreview(candidate).length > text.length };
}

function compactRawEvent(event: ChatWebStoredEvent, payloadStore: PayloadStore, piboSessionId: string): ChatWebStoredEvent {
	const payloadRef = payloadRefForValue({ store: payloadStore, piboSessionId, nodeId: event.id, kind: "raw", value: event.payload });
	if (!payloadRef) return event;
	return {
		...event,
		payload: {
			type: event.type,
			payloadRef,
			preview: payloadRef.preview,
			byteLength: payloadRef.byteLength,
			truncated: true,
		},
	};
}

function encodeTracePayloadRef(piboSessionId: string, payloadId: string): string {
	return `trace_${Buffer.from(JSON.stringify({ p: piboSessionId, id: payloadId }), "utf8").toString("base64url")}`;
}

function payloadBytes(value: unknown): { text: string; bytes: Buffer; contentType: string } {
	if (typeof value === "string") {
		const bytes = Buffer.from(value, "utf8");
		return { text: value, bytes, contentType: "text/plain; charset=utf-8" };
	}
	const text = JSON.stringify(value);
	return { text, bytes: Buffer.from(text, "utf8"), contentType: "application/json" };
}

function textForPreview(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function textPreview(value: string): string {
	return normalizedPreviewText(value).slice(0, TRACE_V2_PREVIEW_CHARS);
}

function normalizedPreviewText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function toPayloadValue(value: unknown): PiboJsonValue | string {
	if (typeof value === "string") return value;
	return JSON.parse(JSON.stringify(value)) as PiboJsonValue;
}

function normalizeContentType(contentType: string): TracePayloadRef["contentType"] {
	if (contentType.includes("json")) return "application/json";
	if (contentType.startsWith("text/markdown")) return "text/markdown";
	if (contentType.startsWith("text/")) return "text/plain";
	if (contentType.includes("x-ndjson")) return "application/x-ndjson";
	return "application/octet-stream";
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}
