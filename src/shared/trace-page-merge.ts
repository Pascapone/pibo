import { flattenTraceNodes, nestTraceNodes } from "./trace-nodes.js";
import type { PiboSessionTraceView } from "./trace-types.js";

export function mergeOlderTracePage(current: PiboSessionTraceView, older: PiboSessionTraceView): PiboSessionTraceView {
	if (current.piboSessionId !== older.piboSessionId) return current;
	const seenRawEvents = new Set<string>();
	const rawEvents = [...older.rawEvents, ...current.rawEvents].filter((event) => {
		const key = event.id || `${event.eventSequence ?? ""}:${event.type}:${event.createdAt}`;
		if (seenRawEvents.has(key)) return false;
		seenRawEvents.add(key);
		return true;
	});
	return {
		...current,
		version: current.version,
		nodes: mergeTraceNodes(older.nodes, current.nodes),
		rawEvents,
		beforeCursor: older.beforeCursor ?? current.beforeCursor,
		firstEventSequence: older.firstEventSequence ?? current.firstEventSequence,
		nextBeforeSequence: older.nextBeforeSequence,
		nextBeforeCursor: older.nextBeforeCursor,
		hasOlderEvents: older.hasOlderEvents,
		eventLimit: (current.eventLimit ?? 0) + (older.eventLimit ?? older.pageSize ?? 0),
	};
}

export function mergeRefreshedTracePage(current: PiboSessionTraceView, refreshed: PiboSessionTraceView): PiboSessionTraceView {
	if (current.piboSessionId !== refreshed.piboSessionId) return refreshed;
	return {
		...refreshed,
		nodes: mergeRefreshedTraceNodes(current.nodes, refreshed),
		rawEvents: mergeTraceRawEvents(current.rawEvents, refreshed.rawEvents),
		beforeCursor: current.beforeCursor,
		firstEventSequence: current.firstEventSequence ?? refreshed.firstEventSequence,
		nextBeforeSequence: current.nextBeforeSequence,
		nextBeforeCursor: current.nextBeforeCursor,
		hasOlderEvents: current.hasOlderEvents,
		eventLimit: current.eventLimit ?? refreshed.eventLimit,
	};
}

function mergeRefreshedTraceNodes(
	currentNodes: PiboSessionTraceView["nodes"],
	refreshed: PiboSessionTraceView,
): PiboSessionTraceView["nodes"] {
	const refreshedNodes = flattenTraceNodes([...refreshed.nodes]);
	const refreshedIds = new Set(refreshedNodes.map((node) => node.id));
	const refreshedStartedAt = earliestTraceNodeTimestamp(refreshedNodes);
	const retainedOlderNodes = flattenTraceNodes([...currentNodes]).filter((node) => {
		if (refreshedIds.has(node.id)) return true;
		if (isTransientTailNode(node)) return false;
		const eventSequence = node.orderKey?.eventSequence;
		if (eventSequence !== undefined && refreshed.firstEventSequence !== undefined) {
			return eventSequence < refreshed.firstEventSequence;
		}
		if (node.source === "live" || node.orderKey?.streamId !== undefined) return false;
		const startedAt = parseTimestamp(node.startedAt);
		return startedAt !== undefined && refreshedStartedAt !== undefined && startedAt < refreshedStartedAt;
	});
	return mergeTraceNodes(retainedOlderNodes, refreshed.nodes);
}

function isTransientTailNode(node: PiboSessionTraceView["nodes"][number]): boolean {
	return node.source === "live"
		|| node.orderKey?.streamId !== undefined
		|| node.type === "yielded.run"
		|| node.stableKey?.startsWith("run-notification:") === true;
}

function earliestTraceNodeTimestamp(nodes: PiboSessionTraceView["nodes"]): number | undefined {
	let earliest: number | undefined;
	for (const node of nodes) {
		const startedAt = parseTimestamp(node.startedAt);
		if (startedAt === undefined) continue;
		earliest = earliest === undefined ? startedAt : Math.min(earliest, startedAt);
	}
	return earliest;
}

function parseTimestamp(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function mergeTraceRawEvents(
	currentEvents: PiboSessionTraceView["rawEvents"],
	refreshedEvents: PiboSessionTraceView["rawEvents"],
): PiboSessionTraceView["rawEvents"] {
	if (!refreshedEvents.length) return currentEvents;
	const firstRefreshedSequence = refreshedEvents.reduce<number | undefined>((first, event) => {
		if (event.eventSequence === undefined) return first;
		return first === undefined ? event.eventSequence : Math.min(first, event.eventSequence);
	}, undefined);
	const byKey = new Map<string, PiboSessionTraceView["rawEvents"][number]>();
	for (const event of currentEvents) {
		if (firstRefreshedSequence !== undefined && event.eventSequence !== undefined && event.eventSequence >= firstRefreshedSequence) continue;
		byKey.set(traceRawEventKey(event), event);
	}
	for (const event of refreshedEvents) byKey.set(traceRawEventKey(event), event);
	return [...byKey.values()];
}

function traceRawEventKey(event: PiboSessionTraceView["rawEvents"][number]): string {
	return event.id || `${event.eventSequence ?? ""}:${event.type}:${event.createdAt}`;
}

function mergeTraceNodes(olderNodes: PiboSessionTraceView["nodes"], currentNodes: PiboSessionTraceView["nodes"]) {
	const byId = new Map<string, PiboSessionTraceView["nodes"][number]>();
	for (const node of flattenTraceNodes([...olderNodes])) {
		byId.set(node.id, { ...node, children: [] });
	}
	for (const node of flattenTraceNodes([...currentNodes])) {
		const existing = byId.get(node.id);
		byId.set(node.id, {
			...existing,
			...node,
			children: [],
		});
	}
	return nestTraceNodes([...byId.values()]);
}
