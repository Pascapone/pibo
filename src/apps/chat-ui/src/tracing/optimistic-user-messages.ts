import type { ChatWebStoredEvent } from "../../../../shared/trace-types.js";
import type { PiboSessionTraceView, PiboTraceNode } from "../types.js";

export function reconcileOptimisticUserMessages(view: PiboSessionTraceView): PiboSessionTraceView {
	const persistedByText = new Map<string, number>();
	collectPersistedUserMessageText(view.nodes, persistedByText);
	if (!persistedByText.size) return view;
	const { nodes, changed } = dropReplacedOptimisticUserMessages(view.nodes, persistedByText);
	return changed ? { ...view, nodes } : view;
}

export function overlayIncludesOptimisticUserMessage(events: readonly ChatWebStoredEvent[]): boolean {
	return events.some(isUserMessageQueuedEvent);
}

export function collectPersistedUserMessageIndex(nodes: readonly PiboTraceNode[]): Map<string, string[]> {
	const messagesByText = new Map<string, string[]>();
	forEachPiboTraceNode(nodes, (node) => {
		if (node.type !== "user.message" || !node.entryId) return;
		const text = traceNodeText(node);
		const entryIds = messagesByText.get(text);
		if (entryIds) entryIds.push(node.entryId);
		else messagesByText.set(text, [node.entryId]);
	});
	return messagesByText;
}

export function annotateLiveTraceForkEntryIds(liveNodes: PiboTraceNode[], persistedUserMessageIndex: ReadonlyMap<string, readonly string[]>): void {
	if (!persistedUserMessageIndex.size) return;
	const nextIndexByText = new Map<string, number>();
	forEachPiboTraceNode(liveNodes, (node) => {
		if (node.type !== "user.message" || node.entryId) return;
		const text = traceNodeText(node);
		const entryIds = persistedUserMessageIndex.get(text);
		if (!entryIds?.length) return;
		const nextIndex = nextIndexByText.get(text) ?? 0;
		const entryId = entryIds[nextIndex];
		if (!entryId) return;
		node.entryId = entryId;
		nextIndexByText.set(text, nextIndex + 1);
	});
}

export function isUserMessageQueuedEvent(event: ChatWebStoredEvent): event is ChatWebStoredEvent & { payload: { type: "message_queued"; source: "user"; text: string } } {
	const payload = event.payload;
	return Boolean(
		payload &&
		typeof payload === "object" &&
		!Array.isArray(payload) &&
		"type" in payload && payload.type === "message_queued" &&
		"source" in payload && payload.source === "user" &&
		"text" in payload && typeof payload.text === "string"
	);
}

function collectPersistedUserMessageText(nodes: readonly PiboTraceNode[], byText: Map<string, number>): void {
	for (const node of nodes) {
		if (node.type === "user.message" && !isOptimisticUserMessageNode(node)) {
			const text = traceNodeText(node);
			if (text) byText.set(text, (byText.get(text) ?? 0) + 1);
		}
		collectPersistedUserMessageText(node.children, byText);
	}
}

function dropReplacedOptimisticUserMessages(
	nodes: readonly PiboTraceNode[],
	persistedByText: Map<string, number>,
): { nodes: PiboTraceNode[]; changed: boolean } {
	let changed = false;
	const next: PiboTraceNode[] = [];
	for (const node of nodes) {
		if (isOptimisticUserMessageNode(node)) {
			const text = traceNodeText(node);
			const persistedCount = text ? persistedByText.get(text) ?? 0 : 0;
			if (persistedCount > 0) {
				persistedByText.set(text, persistedCount - 1);
				changed = true;
				continue;
			}
		}
		const childResult = dropReplacedOptimisticUserMessages(node.children, persistedByText);
		changed = changed || childResult.changed;
		next.push(childResult.changed ? { ...node, children: childResult.nodes } : node);
	}
	return { nodes: changed ? next : nodes as PiboTraceNode[], changed };
}

function isOptimisticUserMessageNode(node: PiboTraceNode): boolean {
	if (node.type !== "user.message") return false;
	if (node.source === "event-log" && node.id.startsWith("event:message_queued:")) return true;
	return [node.id, node.stableKey, node.eventId]
		.filter((value): value is string => typeof value === "string")
		.some((value) => value.startsWith("optimistic:user-message:") || value.includes(":optimistic:user-message:"));
}

function forEachPiboTraceNode(nodes: readonly PiboTraceNode[], visitNode: (node: PiboTraceNode) => void): void {
	for (const node of nodes) {
		visitNode(node);
		forEachPiboTraceNode(node.children, visitNode);
	}
}

function traceNodeText(node: PiboTraceNode): string {
	return typeof node.output === "string" ? node.output : typeof node.summary === "string" ? node.summary : "";
}
