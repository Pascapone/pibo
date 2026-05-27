import type { PiboSessionTraceView } from "../types";

export function mergeOlderTracePage(current: PiboSessionTraceView, older: PiboSessionTraceView): PiboSessionTraceView {
	if (current.piboSessionId !== older.piboSessionId) return current;
	const seenNodes = new Set<string>();
	const nodes = [...older.nodes, ...current.nodes].filter((node) => {
		if (seenNodes.has(node.id)) return false;
		seenNodes.add(node.id);
		return true;
	});
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
		nodes,
		rawEvents,
		firstEventSequence: older.firstEventSequence ?? current.firstEventSequence,
		nextBeforeSequence: older.nextBeforeSequence,
		hasOlderEvents: older.hasOlderEvents,
		eventLimit: (current.eventLimit ?? 0) + (older.eventLimit ?? older.pageSize ?? 0),
	};
}
