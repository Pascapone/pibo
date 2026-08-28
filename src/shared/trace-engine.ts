import type { AgentRuntimeHistoryEntry, AgentRuntimeHistoryReconciliationProof } from "../agent-runtime/history.js";
import type { PiboOutputEvent } from "../core/events.js";
import { isRunStartToolNode, reconcileAsyncAgentRunStatuses } from "./trace-async-agent-runs.js";
import {
	applySingleEventToNodes,
	contentDeltaPatchNodeId,
	dedupeTraceEvents,
	eventsCanAffectAsyncAgentRunStatus,
	findOpenTranscriptEventIds,
	isConfirmedUserMessageEcho,
	latestTraceStreamId,
	mergeMessageTurnTimings,
	messageTurnTimingsFromEvents,
	reconcileTranscriptUserMessages,
	type TraceMessageTurnTiming,
	traceEventDedupeKey,
} from "./trace-event-projection.js";
import { flattenTraceNodes, mapTraceNodesById, nestTraceNodes } from "./trace-nodes.js";
import { nestMutableCopiedTraceNodes, shareUnchangedTraceNodes } from "./trace-patch-nodes.js";
import {
	mapTraceChildSessionsByParent,
	mapTraceSubagentSessionLinks,
	type TraceChildSession,
} from "./trace-subagent-links.js";
import { projectHistoryEntries, traceNodesFromHistoryEntries } from "./trace-history.js";
import { TRACE_RECONCILIATION_TIMING_CAP } from "./trace-limits.js";
export { isRunStartToolNode } from "./trace-async-agent-runs.js";
export {
	assistantMessageNodeId,
	dedupeTraceEvents,
	latestTraceStreamId,
	messageTurnNodeId,
	thinkingNodeId,
	traceEventDedupeKey,
} from "./trace-event-projection.js";
export { traceNodesFromHistoryEntries } from "./trace-history.js";
export {
	compareTraceNodes,
	flattenTraceNodes,
	mapTraceNodesById,
	nestTraceNodes,
	sortTraceNodes,
} from "./trace-nodes.js";
import type {
	ChatWebStoredEvent,
	PiboSessionTraceView,
	PiboTraceNode,
	PiboWebSessionStatus,
} from "./trace-types.js";

// ── buildTraceViewFromEvents ─────────────────────────────────────

type TraceBuildInput = {
	session: { id: string; piSessionId: string; title?: string | null };
	events: ChatWebStoredEvent[];
	turnTimings?: TraceMessageTurnTiming[];
	historyEntries?: readonly AgentRuntimeHistoryEntry[];
	historyReconciliationProof?: AgentRuntimeHistoryReconciliationProof;
	sessions?: Array<{
		id: string;
		parentId?: string | null;
		originId?: string | null;
		updatedAt: string;
		title?: string | null;
		metadata?: Record<string, unknown>;
	}>;
	status?: PiboWebSessionStatus;
	latestStreamId?: number;
	includeRawEvents?: boolean;
	rawEventsLimit?: number;
};

export function buildTraceViewFromEvents(input: TraceBuildInput): PiboSessionTraceView {
	const sessionStatus = input.status ?? "idle";
	const events = dedupeTraceEvents(input.events);
	const allEntries = input.historyEntries ?? [];
	const openHistoryEventIds = findOpenTranscriptEventIds(events, sessionStatus);
	const suppliedTurnTimings = input.turnTimings ?? [];
	const eventTurnTimings = messageTurnTimingsFromEvents(events);
	const timingOverflow = suppliedTurnTimings.length + eventTurnTimings.length > TRACE_RECONCILIATION_TIMING_CAP;
	const turnTimings = timingOverflow
		? []
		: mergeMessageTurnTimings(suppliedTurnTimings, eventTurnTimings);
	const historyTurnTimings = timingOverflow ? [...suppliedTurnTimings, ...eventTurnTimings] : turnTimings;
	const entries = projectHistoryEntries(allEntries, sessionStatus, openHistoryEventIds, historyTurnTimings, input.historyReconciliationProof);
	const nodes = traceNodesFromHistoryEntries(input.session.id, entries, historyTurnTimings, input.historyReconciliationProof);
	reconcileTranscriptUserMessages(nodes, events, turnTimings);
	const byId = mapTraceNodesById(nodes);
	const childByParent = mapTraceChildSessionsByParent(input.sessions ?? []);
	const linkedChildByToolCallId = mapTraceSubagentSessionLinks(events);
	const historyMode = entries.some((entry) => entry.source === "native")
		? "native" as const
		: entries.some((entry) => entry.type === "message") ? "product" as const : "none" as const;
	const historyNodes = flattenTraceNodes(nodes);
	const historyCoverage = {
		mode: historyMode,
		eventIds: new Set(historyNodes.flatMap((node) => node.eventId ? [node.eventId] : [])),
		toolCallIds: new Set(historyNodes.flatMap((node) => node.toolCallId ? [node.toolCallId] : [])),
	};

	for (const storedEvent of events) {
		applySingleEventToNodes(
			nodes,
			byId,
			input.session.id,
			storedEvent,
			childByParent,
			linkedChildByToolCallId,
			historyCoverage,
			openHistoryEventIds,
			sessionStatus,
		);
	}

	const nestedNodes = nestTraceNodes(nodes);
	reconcileAsyncAgentRunStatuses(nestedNodes);

	return {
		piboSessionId: input.session.id,
		piSessionId: input.session.piSessionId,
		title: input.session.title ?? "Untitled Session",
		version: "",
		latestStreamId: latestTraceStreamId(events, input.latestStreamId),
		nodes: nestedNodes,
		rawEvents:
			input.includeRawEvents === true
				? events.slice(-(input.rawEventsLimit ?? events.length))
				: [],
	};
}

// ── transcript helpers ───────────────────────────────────────────

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
	if (eventsCanAffectAsyncAgentRunStatus(appliedEvents)) {
		reconcileAsyncAgentRunStatuses(nestedNodes);
	}
	const sharedNodes = shareUnchangedTraceNodes(previousById, nestedNodes, contentDeltaChangedNodeIds);

	return {
		...view,
		rawEvents: view.rawEvents.length ? [...view.rawEvents, ...appliedEvents] : appliedEvents,
		nodes: sharedNodes,
		latestStreamId: latestTraceStreamId(appliedEvents, view.latestStreamId),
	};
}
