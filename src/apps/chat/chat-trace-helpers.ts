import { createHash } from "node:crypto";
import type { PiboOutputEvent } from "../../core/events.js";
import { patchTraceViewWithEvent } from "../../shared/trace-engine.js";
import type { ChatWebStoredEvent } from "../../shared/trace-types.js";
import type { PiboSessionTraceView, PiboWebSessionStatus } from "./trace.js";

export const DEFAULT_TRACE_EVENTS_PAGE_SIZE = 100;
export const MAX_TRACE_EVENTS_PER_REQUEST = 1000;
export const TRACE_CACHE_MAX_BYTES = 8 * 1024 * 1024;

export function etagForVersion(version: string): string {
	return `"${version}"`;
}

export function requestMatchesVersion(request: Request, version: string): boolean {
	const header = request.headers.get("if-none-match");
	if (!header) return false;
	return header
		.split(",")
		.map((value) => value.trim())
		.some((value) => value === "*" || value === etagForVersion(version) || value === `W/${etagForVersion(version)}`);
}

export function traceCacheKey(piboSessionId: string, version: string): string {
	return [piboSessionId, version, "structural"].join(":");
}

export function withRawTraceTail(trace: PiboSessionTraceView, rawEvents: PiboSessionTraceView["rawEvents"]): PiboSessionTraceView {
	if (rawEvents.length === 0) return trace;
	return { ...trace, rawEvents };
}

export function liveSnapshotVersion(snapshots: readonly PiboOutputEvent[]): string {
	if (snapshots.length === 0) return "";
	const hash = createHash("sha1");
	for (const snapshot of snapshots) {
		hash.update(JSON.stringify(snapshot));
		hash.update("\n");
	}
	return hash.digest("hex").slice(0, 16);
}

export function storedLiveSnapshotEvents(input: {
	piboSessionId: string;
	snapshots: readonly PiboOutputEvent[];
	lastEventSequence: number;
	now?: string;
}): ChatWebStoredEvent<PiboOutputEvent>[] {
	const createdAt = input.now ?? new Date().toISOString();
	return input.snapshots.map((snapshot, index) => ({
		id: `live-snapshot:${input.piboSessionId}:${index}:${liveSnapshotVersion([snapshot])}`,
		piboSessionId: input.piboSessionId,
		eventSequence: input.lastEventSequence + index + 1,
		eventId: "eventId" in snapshot && typeof snapshot.eventId === "string" ? snapshot.eventId : undefined,
		type: snapshot.type,
		createdAt,
		payload: snapshot,
	}));
}

export function withLiveSnapshots(
	trace: PiboSessionTraceView,
	snapshots: readonly PiboOutputEvent[],
	input: { piboSessionId: string; lastEventSequence: number; status?: PiboWebSessionStatus },
): PiboSessionTraceView {
	if (snapshots.length === 0) return trace;
	const events = storedLiveSnapshotEvents({
		piboSessionId: input.piboSessionId,
		snapshots,
		lastEventSequence: input.lastEventSequence,
	});
	let next = trace;
	for (const event of events) {
		next = patchTraceViewWithEvent(next, event, input.status ?? "running");
	}
	return {
		...next,
		version: `${trace.version}:live:${liveSnapshotVersion(snapshots)}`,
		rawEvents: trace.rawEvents,
	};
}

export function annotateTracePage(
	trace: PiboSessionTraceView,
	events: PiboSessionTraceView["rawEvents"],
	input: { lastEventSequence: number; pageSize: number; beforeSequence?: number },
): PiboSessionTraceView {
	const sequences = events
		.map((event) => event.eventSequence)
		.filter((sequence): sequence is number => typeof sequence === "number");
	const firstEventSequence = sequences.length ? Math.min(...sequences) : undefined;
	const lastEventSequence = sequences.length ? Math.max(...sequences) : undefined;
	return {
		...trace,
		eventCount: input.lastEventSequence,
		eventLimit: input.pageSize,
		pageSize: input.pageSize,
		beforeSequence: input.beforeSequence,
		firstEventSequence,
		lastEventSequence,
		nextBeforeSequence: firstEventSequence,
		hasOlderEvents: firstEventSequence !== undefined ? firstEventSequence > 1 : false,
	};
}

export function setTraceCache(
	cache: Map<string, PiboSessionTraceView>,
	key: string,
	trace: PiboSessionTraceView,
	maxEntries: number,
	maxBytes = TRACE_CACHE_MAX_BYTES,
): void {
	if (trace.rawEvents.length > 0) return;
	cache.delete(key);
	cache.set(key, trace);
	while (cache.size > maxEntries || traceCacheEstimatedBytes(cache) > maxBytes) {
		const oldestKey = cache.keys().next().value;
		if (typeof oldestKey !== "string") break;
		cache.delete(oldestKey);
	}
}

export function traceCacheEstimatedBytes(cache: ReadonlyMap<string, PiboSessionTraceView>): number {
	let bytes = 0;
	for (const trace of cache.values()) bytes += estimateTraceViewBytes(trace);
	return bytes;
}

export function estimateTraceViewBytes(trace: PiboSessionTraceView): number {
	let bytes = 512;
	bytes += byteLength(trace.piboSessionId) + byteLength(trace.piSessionId) + byteLength(trace.title) + byteLength(trace.version);
	for (const node of flattenEstimateNodes(trace.nodes)) {
		bytes += 256;
		bytes += byteLength(node.id) + byteLength(node.parentId) + byteLength(node.title) + byteLength(node.summary);
		bytes += estimatePayloadBytes(node.input) + estimatePayloadBytes(node.output) + byteLength(node.error);
	}
	return bytes;
}

function flattenEstimateNodes(nodes: readonly PiboSessionTraceView["nodes"][number][]): PiboSessionTraceView["nodes"][number][] {
	const result: PiboSessionTraceView["nodes"][number][] = [];
	const visit = (items: readonly PiboSessionTraceView["nodes"][number][]) => {
		for (const item of items) {
			result.push(item);
			visit(item.children);
		}
	};
	visit(nodes);
	return result;
}

function estimatePayloadBytes(value: unknown): number {
	if (value === undefined || value === null) return 0;
	if (typeof value === "string") return byteLength(value);
	try {
		return byteLength(JSON.stringify(value));
	} catch {
		return byteLength(String(value));
	}
}

function byteLength(value: string | undefined): number {
	return value ? Buffer.byteLength(value, "utf8") : 0;
}
