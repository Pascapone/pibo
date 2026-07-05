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
