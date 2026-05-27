import type { SessionEntry } from "@mariozechner/pi-coding-agent";
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
	traceEventDedupeKey,
} from "./trace-event-projection.js";
import { flattenTraceNodes, mapTraceNodesById, nestTraceNodes } from "./trace-nodes.js";
import { nestMutableCopiedTraceNodes, shareUnchangedTraceNodes } from "./trace-patch-nodes.js";
import {
	mapTraceChildSessionsByParent,
	mapTraceSubagentSessionLinks,
	type TraceChildSession,
} from "./trace-subagent-links.js";
import { projectTranscriptEntries, traceNodesFromEntries } from "./trace-transcript.js";
export { isRunStartToolNode } from "./trace-async-agent-runs.js";
export {
	assistantMessageNodeId,
	dedupeTraceEvents,
	latestTraceStreamId,
	messageTurnNodeId,
	thinkingNodeId,
	traceEventDedupeKey,
} from "./trace-event-projection.js";
export { traceNodesFromEntries } from "./trace-transcript.js";
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
	transcriptEntries?: SessionEntry[];
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
	const allEntries = input.transcriptEntries ?? [];
	const openTranscriptEventIds = findOpenTranscriptEventIds(events, sessionStatus);
	const entries = projectTranscriptEntries(allEntries, sessionStatus, openTranscriptEventIds);
	const nodes = traceNodesFromEntries(input.session.id, entries);
	const byId = mapTraceNodesById(nodes);
	const childByParent = mapTraceChildSessionsByParent(input.sessions ?? []);
	const linkedChildByToolCallId = mapTraceSubagentSessionLinks(events);
	const hasPersistedTranscript = entries.some((entry) => entry.type === "message");

	for (const storedEvent of events) {
		applySingleEventToNodes(
			nodes,
			byId,
			input.session.id,
			storedEvent,
			childByParent,
			linkedChildByToolCallId,
			hasPersistedTranscript,
			openTranscriptEventIds,
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
			false,
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
