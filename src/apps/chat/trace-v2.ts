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
export const TRACE_IMAGE_MAX_DECODED_BYTES = 10 * 1024 * 1024;
export const TRACE_IMAGE_MAX_STORED_PAYLOAD_BYTES = 15 * 1024 * 1024;
export const TRACE_IMAGE_MAX_COUNT = 20;

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
	transcriptTailCursor?: string;
}): TraceTimelinePage {
	const byteLimit = input.byteLimit ?? TRACE_V2_TIMELINE_HARD_BYTES;
	const nodes = compactTraceNodes({
		nodes: input.trace.nodes,
		payloadStore: input.payloadStore,
		piboSessionId: input.trace.piboSessionId,
		limit: Math.max(1, Math.min(input.limit, TRACE_V2_MAX_TIMELINE_LIMIT)),
		fromTail: input.fromTail,
	});
	const transcriptTailCursor = input.fromTail ? input.transcriptTailCursor : undefined;
	const hasOlder = input.trace.hasOlderEvents === true || transcriptTailCursor !== undefined;
	const nextBeforeCursor = transcriptTailCursor ?? (hasOlder ? input.trace.nextBeforeCursor : undefined);
	const nextBeforeSequence = transcriptTailCursor ? undefined : (hasOlder ? input.trace.nextBeforeSequence : undefined);
	let page: TraceTimelinePage = {
		piboSessionId: input.trace.piboSessionId,
		piSessionId: input.trace.piSessionId,
		integrityStatus: input.trace.integrityStatus,
		runtimeBinding: input.trace.runtimeBinding,
		title: input.trace.title,
		version: input.trace.version,
		latestStreamId: input.trace.latestStreamId,
		projectionStatus: "ready",
		cursor: {
			before: nextBeforeCursor ?? (nextBeforeSequence !== undefined ? String(nextBeforeSequence) : undefined),
			after: input.trace.lastEventSequence !== undefined ? String(input.trace.lastEventSequence) : undefined,
			hasOlder,
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
		nextBeforeSequence,
		nextBeforeCursor,
		hasOlderEvents: hasOlder,
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

export function parseTracePayloadRef(ref: string): {
	piboSessionId: string;
	payloadId: string;
	nodeId?: string;
	payloadKind?: TracePayloadKind;
} | undefined {
	if (!ref.startsWith("trace_")) return undefined;
	try {
		const parsed = JSON.parse(Buffer.from(ref.slice("trace_".length), "base64url").toString("utf8")) as unknown;
		if (!parsed || typeof parsed !== "object") return undefined;
		const record = parsed as { p?: unknown; id?: unknown; n?: unknown; k?: unknown };
		const payloadKind = isTracePayloadKind(record.k) ? record.k : undefined;
		return typeof record.p === "string" && typeof record.id === "string"
			? {
				piboSessionId: record.p,
				payloadId: record.id,
				...(typeof record.n === "string" ? { nodeId: record.n } : {}),
				...(payloadKind ? { payloadKind } : {}),
			}
			: undefined;
	} catch {
		return undefined;
	}
}

export function tracePayloadRefForStoredPayload(input: {
	payloadStore: Pick<PayloadStore, "getPayload" | "readPayloadJsonBounded">;
	piboSessionId: string;
	payloadId: string;
	nodeId: string;
	payloadKind: TracePayloadKind;
}): TracePayloadRef | undefined {
	const payload = input.payloadStore.getPayload(input.payloadId);
	if (!payload) return undefined;
	const rawPreview = payload.previewText ?? "";
	const preview = looksLikeImagePayloadPreview(rawPreview) ? "Image payload" : rawPreview;
	const imageCount = storedImageCount(input.payloadStore, payload);
	return {
		ref: encodeTracePayloadRef(input.piboSessionId, payload.id, input.nodeId, input.payloadKind),
		nodeId: input.nodeId,
		payloadKind: input.payloadKind,
		contentType: normalizeContentType(payload.contentType),
		byteLength: payload.byteSize,
		preview,
		truncatedPreview: Buffer.byteLength(preview, "utf8") < payload.byteSize,
		hash: payload.sha256,
		...(imageCount ? { imageCount } : {}),
	};
}

function storedImageCount(
	payloadStore: Pick<PayloadStore, "readPayloadJsonBounded">,
	payload: NonNullable<ReturnType<PayloadStore["getPayload"]>>,
): number | undefined {
	if (!payload.contentType.includes("json") || payload.byteSize > TRACE_IMAGE_MAX_STORED_PAYLOAD_BYTES) return undefined;
	if (!looksLikeImagePayloadPreview(payload.previewText ?? "")) return undefined;
	try {
		const value = payloadStore.readPayloadJsonBounded(payload.id, TRACE_IMAGE_MAX_STORED_PAYLOAD_BYTES);
		return collectStoredImagePayloads(value).length || undefined;
	} catch {
		return undefined;
	}
}

export function looksLikeImagePayloadPreview(value: string): boolean {
	return /"type"\s*:\s*"(?:image|input_image|output_image|image_url)"/i.test(value)
		|| /"mime(?:Type|_type)"\s*:\s*"image\//i.test(value);
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

export type TraceImagePayload = {
	bytes: Uint8Array;
	mimeType: string;
};

export type TraceImageReadResult =
	| { ok: true; image: TraceImagePayload; imageCount: number }
	| { ok: false; reason: "invalid-ref" | "missing-payload" | "unsupported-payload" | "payload-too-large" | "corrupt-payload" | "index-out-of-range" | "malformed-base64" | "image-too-large" | "unsupported-image" | "mime-mismatch" };

export function readTraceImagePayload(input: {
	payloadStore: PayloadStore;
	ref: string;
	nodeId: string;
	index: number;
}): TraceImageReadResult {
	const parsed = parseTracePayloadRef(input.ref);
	if (!parsed || parsed.nodeId !== input.nodeId || parsed.payloadKind !== "output") return { ok: false, reason: "invalid-ref" };
	const payload = input.payloadStore.getPayload(parsed.payloadId);
	if (!payload) return { ok: false, reason: "missing-payload" };
	if (!payload.contentType.includes("json")) return { ok: false, reason: "unsupported-payload" };
	if (payload.byteSize > TRACE_IMAGE_MAX_STORED_PAYLOAD_BYTES) return { ok: false, reason: "payload-too-large" };
	let value: unknown;
	try {
		value = input.payloadStore.readPayloadJsonBounded(parsed.payloadId, TRACE_IMAGE_MAX_STORED_PAYLOAD_BYTES);
	} catch {
		return { ok: false, reason: "corrupt-payload" };
	}
	const images = collectStoredImagePayloads(value);
	const image = images[input.index];
	if (!image) return { ok: false, reason: "index-out-of-range" };
	const decoded = decodeStoredImagePayload(image);
	if (!decoded.ok) return decoded;
	return { ok: true, image: decoded.image, imageCount: images.length };
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
			? node.payloadRefs?.input ?? payloadRefForValue({ store: payloadStore, piboSessionId, nodeId: node.id, kind: "input", value: node.input })
			: undefined,
		[outputKind]: inlinePayloads[outputKind] === undefined
			? node.payloadRefs?.[outputKind] ?? payloadRefForValue({ store: payloadStore, piboSessionId, nodeId: node.id, kind: outputKind, value: node.output })
			: undefined,
		error: inlinePayloads.error === undefined
			? node.payloadRefs?.error ?? payloadRefForValue({ store: payloadStore, piboSessionId, nodeId: node.id, kind: "error", value: node.error })
			: undefined,
		raw: node.payloadRefs?.raw,
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
		toolMetrics: node.toolMetrics,
		orderKey: node.orderKey,
		depth,
		hasChildren: node.children.length > 0,
		childCount: node.children.length || undefined,
		preview,
		inlinePayloads: Object.keys(inlinePayloads).length ? inlinePayloads : undefined,
		payloadRefs: Object.keys(payloadRefs).length ? payloadRefs : undefined,
		linkedPiboSessionId: node.linkedPiboSessionId,
		toolCallId: node.toolCallId,
		toolInvocationOrdinal: node.toolInvocationOrdinal,
		runId: node.runId,
		intent: node.intent,
		eventId: node.eventId,
		entryId: node.entryId,
		nativeTurnId: node.nativeTurnId,
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
	const payloadSha256 = createHash("sha256").update(bytes).digest("hex");
	const payload = input.store.writePayload({
		value: toPayloadValue(input.value),
		contentType,
		retentionClass: "trace_event",
	});
	const imageCount = collectStoredImagePayloads(input.value).length || undefined;
	return {
		ref: encodeTracePayloadRef(input.piboSessionId, payload.id, input.nodeId, input.kind),
		nodeId: input.nodeId,
		payloadKind: input.kind,
		contentType: normalizeContentType(contentType),
		byteLength: bytes.byteLength,
		preview,
		truncatedPreview,
		hash: payloadSha256,
		...(imageCount ? { imageCount } : {}),
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

function encodeTracePayloadRef(piboSessionId: string, payloadId: string, nodeId?: string, payloadKind?: TracePayloadKind): string {
	return `trace_${Buffer.from(JSON.stringify({ p: piboSessionId, id: payloadId, n: nodeId, k: payloadKind }), "utf8").toString("base64url")}`;
}

function isTracePayloadKind(value: unknown): value is TracePayloadKind {
	return value === "input" || value === "output" || value === "reasoning" || value === "error" || value === "raw";
}

function payloadBytes(value: unknown): { text: string; bytes: Buffer; contentType: string } {
	if (typeof value === "string") {
		const bytes = Buffer.from(value, "utf8");
		return { text: value, bytes, contentType: "text/plain; charset=utf-8" };
	}
	const text = JSON.stringify(value);
	return { text, bytes: Buffer.from(text, "utf8"), contentType: "application/json" };
}

type StoredImagePayload = {
	data: string;
	mimeType?: string;
};

function collectStoredImagePayloads(value: unknown, depth = 0, seen = new Set<unknown>()): StoredImagePayload[] {
	if (depth > 6 || seen.size >= 1_000 || value === undefined || value === null || typeof value !== "object") return [];
	if (seen.has(value)) return [];
	seen.add(value);
	if (Array.isArray(value)) {
		const images: StoredImagePayload[] = [];
		for (const item of value) {
			images.push(...collectStoredImagePayloads(item, depth + 1, seen));
			if (images.length >= TRACE_IMAGE_MAX_COUNT) return images.slice(0, TRACE_IMAGE_MAX_COUNT);
		}
		return images;
	}
	const record = value as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type.toLowerCase() : undefined;
	const declaredMimeType = typeof record.mimeType === "string"
		? record.mimeType
		: typeof record.mime_type === "string" ? record.mime_type : undefined;
	const directData = typeof record.data === "string" ? record.data : undefined;
	const imageUrl = storedImageUrl(record.image_url);
	if (["image", "input_image", "output_image", "image_url"].includes(type ?? "")) {
		if (directData) return [{ data: directData, mimeType: declaredMimeType }];
		if (imageUrl) return [{ data: imageUrl, mimeType: declaredMimeType }];
	}
	if (declaredMimeType?.startsWith("image/") && directData) return [{ data: directData, mimeType: declaredMimeType }];
	const nested: unknown[] = [];
	if ("content" in record) nested.push(record.content);
	if ("message" in record) nested.push(record.message);
	if ("result" in record) nested.push(record.result);
	if ("output" in record) nested.push(record.output);
	const images: StoredImagePayload[] = [];
	for (const item of nested) {
		images.push(...collectStoredImagePayloads(item, depth + 1, seen));
		if (images.length >= TRACE_IMAGE_MAX_COUNT) break;
	}
	return images.slice(0, TRACE_IMAGE_MAX_COUNT);
}

function storedImageUrl(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const url = (value as Record<string, unknown>).url;
	return typeof url === "string" ? url : undefined;
}

function decodeStoredImagePayload(image: StoredImagePayload): TraceImageReadResult {
	const dataUrl = /^data:([^;,]+);base64,(.*)$/is.exec(image.data);
	const rawEncoded = dataUrl?.[2] ?? image.data;
	const maxEncodedBytes = Math.ceil(TRACE_IMAGE_MAX_DECODED_BYTES / 3) * 4;
	if (rawEncoded.length > maxEncodedBytes + 128) return { ok: false, reason: "image-too-large" };
	const encoded = rawEncoded.replace(/\s+/g, "");
	if (!isStrictBase64(encoded)) {
		return { ok: false, reason: "malformed-base64" };
	}
	const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
	const decodedLength = (encoded.length / 4) * 3 - padding;
	if (decodedLength > TRACE_IMAGE_MAX_DECODED_BYTES) return { ok: false, reason: "image-too-large" };
	const bytes = Buffer.from(encoded, "base64");
	if (!bytes.byteLength || bytes.byteLength !== decodedLength) return { ok: false, reason: "malformed-base64" };
	const mimeType = imageMimeTypeFromBytes(bytes);
	if (!mimeType) return { ok: false, reason: "unsupported-image" };
	const declaredMimeType = image.mimeType ?? dataUrl?.[1];
	if (declaredMimeType && normalizeImageMimeType(declaredMimeType) !== mimeType) return { ok: false, reason: "mime-mismatch" };
	return { ok: true, image: { bytes, mimeType }, imageCount: 1 };
}

function isStrictBase64(value: string): boolean {
	if (!value || value.length % 4 !== 0) return false;
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	const contentLength = value.length - padding;
	for (let index = 0; index < contentLength; index += 1) {
		const code = value.charCodeAt(index);
		const alphaNumeric = (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39);
		if (!alphaNumeric && code !== 0x2b && code !== 0x2f) return false;
	}
	for (let index = contentLength; index < value.length; index += 1) {
		if (value.charCodeAt(index) !== 0x3d) return false;
	}
	return true;
}

function normalizeImageMimeType(value: string): string {
	const normalized = value.toLowerCase().split(";", 1)[0]?.trim();
	return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

export function imageMimeTypeFromBytes(bytes: Uint8Array): string | undefined {
	if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	const header = Buffer.from(bytes.subarray(0, 12));
	if (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
	if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
	if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
	if (bytes.length >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp") {
		const brand = header.subarray(8, 12).toString("ascii");
		if (brand === "avif" || brand === "avis") return "image/avif";
	}
	return undefined;
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
