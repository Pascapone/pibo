import type { PiboOutputEvent } from "../core/events.js";
import { reconcileAsyncAgentRunStatuses } from "./trace-async-agent-runs.js";
import {
	applySingleEventToNodes,
	contentDeltaPatchNodeId,
	eventsCanAffectAsyncAgentRunStatus,
	isConfirmedUserMessageEcho,
	latestTraceStreamId,
	traceEventDedupeKey,
} from "./trace-event-projection.js";
import { flattenTraceNodes } from "./trace-nodes.js";
import { nestMutableCopiedTraceNodes, shareUnchangedTraceNodes } from "./trace-patch-nodes.js";
import type { TraceChildSession } from "./trace-subagent-links.js";
import type {
	ChatWebStoredEvent,
	PiboSessionTraceView,
	PiboTraceNode,
	PiboWebSessionStatus,
} from "./trace-types.js";

export function patchTraceViewWithEvent(
	view: PiboSessionTraceView,
	event: ChatWebStoredEvent,
	sessionStatus: PiboWebSessionStatus,
): PiboSessionTraceView {
	return patchTraceViewWithEvents(view, [event], sessionStatus);
}

export function patchTraceViewWithEvents(
	view: PiboSessionTraceView,
	events: readonly ChatWebStoredEvent[],
	sessionStatus: PiboWebSessionStatus,
): PiboSessionTraceView {
	if (!events.length) return view;

	const seenEventKeys = new Set(view.rawEvents.map((event) => traceEventDedupeKey(event)));
	const candidateEvents: ChatWebStoredEvent[] = [];
	for (const event of events) {
		const eventKey = traceEventDedupeKey(event);
		if (seenEventKeys.has(eventKey)) continue;
		seenEventKeys.add(eventKey);
		candidateEvents.push(event);
	}
	if (!candidateEvents.length) return view;

	const previousFlatNodes = flattenTraceNodes(view.nodes);
	const allNodes: PiboTraceNode[] = [];
	const byId = new Map<string, PiboTraceNode>();
	const previousById = new Map<string, PiboTraceNode>();
	for (const previousNode of previousFlatNodes) {
		previousById.set(previousNode.id, previousNode);
		const nextNode = { ...previousNode, children: [] };
		allNodes.push(nextNode);
		byId.set(nextNode.id, nextNode);
	}
	const childByParent = new Map<string, TraceChildSession[]>();
	const linkedChildByToolCallId = new Map<string, string>();
	const openTranscriptEventIds = new Set<string>();
	const emptyHistoryCoverage = { mode: "none" as const, eventIds: new Set<string>(), toolCallIds: new Set<string>() };
	const appliedEvents: ChatWebStoredEvent[] = [];
	let contentDeltaChangedNodeIds: Set<string> | undefined = new Set();

	for (const event of candidateEvents) {
		if (isConfirmedUserMessageEcho(allNodes, event)) continue;

		appliedEvents.push(event);
		const contentDeltaNodeId = contentDeltaPatchNodeId(event.payload as PiboOutputEvent);
		if (contentDeltaChangedNodeIds && contentDeltaNodeId) contentDeltaChangedNodeIds.add(contentDeltaNodeId);
		else contentDeltaChangedNodeIds = undefined;
		applySingleEventToNodes(
			allNodes,
			byId,
			view.piboSessionId,
			event,
			childByParent,
			linkedChildByToolCallId,
			emptyHistoryCoverage,
			openTranscriptEventIds,
			sessionStatus,
		);
	}

	if (!appliedEvents.length) return view;

	const nestedNodes = nestMutableCopiedTraceNodes(allNodes);
	if (eventsCanAffectAsyncAgentRunStatus(appliedEvents)) reconcileAsyncAgentRunStatuses(nestedNodes);
	const sharedNodes = shareUnchangedTraceNodes(previousById, nestedNodes, contentDeltaChangedNodeIds);

	return {
		...view,
		rawEvents: view.rawEvents.length ? [...view.rawEvents, ...appliedEvents] : appliedEvents,
		nodes: sharedNodes,
		latestStreamId: latestTraceStreamId(appliedEvents, view.latestStreamId),
	};
}
