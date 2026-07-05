import type { ChatWebStoredEvent, PiboSessionTraceView, PiboTraceNode, TraceTimelineNode, TraceTimelinePage } from "../types";

export function traceViewFromTimelinePage(page: TraceTimelinePage, rawEvents: ChatWebStoredEvent[] = []): PiboSessionTraceView {
	const nodesById = new Map<string, PiboTraceNode>();
	const roots: PiboTraceNode[] = [];
	for (const row of page.nodes) {
		nodesById.set(row.nodeId, traceNodeFromTimelineNode(row));
	}
	for (const row of page.nodes) {
		const node = nodesById.get(row.nodeId);
		if (!node) continue;
		const parent = row.parentId ? nodesById.get(row.parentId) : undefined;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	return {
		piboSessionId: page.piboSessionId,
		piSessionId: page.piSessionId,
		title: page.title,
		version: page.version,
		latestStreamId: page.latestStreamId,
		eventCount: page.eventCount,
		eventLimit: page.pageSize,
		pageSize: page.pageSize,
		beforeCursor: page.cursor.before,
		firstEventSequence: page.firstEventSequence ?? sequenceFromCursor(page.cursor.before),
		lastEventSequence: page.lastEventSequence ?? sequenceFromCursor(page.cursor.after),
		nextBeforeSequence: page.nextBeforeSequence ?? sequenceFromCursor(page.cursor.before),
		nextBeforeCursor: page.nextBeforeCursor ?? page.cursor.before,
		hasOlderEvents: page.hasOlderEvents ?? page.cursor.hasOlder,
		nodes: roots,
		rawEvents,
	};
}

function sequenceFromCursor(cursor: string | undefined): number | undefined {
	if (!cursor) return undefined;
	const sequence = Number.parseInt(cursor, 10);
	return Number.isFinite(sequence) ? sequence : undefined;
}

function traceNodeFromTimelineNode(row: TraceTimelineNode): PiboTraceNode {
	const preview = row.preview?.text;
	const inputPreview = row.payloadRefs?.input?.preview;
	const outputPreview = row.payloadRefs?.output?.preview ?? row.payloadRefs?.reasoning?.preview ?? preview;
	const errorPreview = row.payloadRefs?.error?.preview;
	const inlineOutput = row.inlinePayloads?.output ?? row.inlinePayloads?.reasoning;
	return {
		id: row.nodeId,
		parentId: row.parentId,
		entryId: row.entryId,
		piboSessionId: row.piboSessionId,
		eventId: row.eventId,
		toolCallId: row.toolCallId,
		runId: row.runId,
		type: row.type,
		title: row.title,
		status: row.status,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
		durationMs: row.durationMs,
		summary: preview,
		input: row.inlinePayloads?.input ?? inputPreview,
		output: inlineOutput ?? outputPreview,
		error: typeof row.inlinePayloads?.error === "string" ? row.inlinePayloads.error : errorPreview,
		payloadRefs: row.payloadRefs,
		linkedPiboSessionId: row.linkedPiboSessionId,
		source: row.source,
		stableKey: row.stableKey,
		orderKey: row.orderKey,
		children: [],
	};
}
