import type { AgentRuntimeHistoryEntry, AgentRuntimeHistoryReconciliationProof } from "../agent-runtime/history.js";
import type { PiboOutputEvent } from "../core/events.js";
import { isRunStartToolNode, reconcileAsyncAgentRunStatuses } from "./trace-async-agent-runs.js";
import {
	applySingleEventToNodes,
	dedupeTraceEvents,
	findOpenTranscriptEventIds,
	latestTraceStreamId,
	markIncompletePersistedTurns,
	mergeMessageTurnTimings,
	messageTurnTimingsFromEvents,
	reconcileTranscriptUserMessages,
	type TraceMessageTurnTiming,
	traceEventDedupeKey,
} from "./trace-event-projection.js";
import { flattenTraceNodes, mapTraceNodesById, nestTraceNodes } from "./trace-nodes.js";
import {
	mapTraceChildSessionsByParent,
	mapTraceSubagentSessionLinks,
} from "./trace-subagent-links.js";
import { projectHistoryEntries, traceNodesFromHistoryEntries } from "./trace-history.js";
import { TRACE_RECONCILIATION_TIMING_CAP } from "./trace-limits.js";
export { isRunStartToolNode } from "./trace-async-agent-runs.js";
export { patchTraceViewWithEvent, patchTraceViewWithEvents } from "./trace-live-patch.js";
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

const SERVICE_TURN_HISTORY_MATCH_MAX_DISTANCE_MS = 5 * 60 * 1_000;

type TraceBuildInput = {
	session: { id: string; piSessionId: string; title?: string | null };
	events: ChatWebStoredEvent[];
	turnTimings?: TraceMessageTurnTiming[];
	turnTimingOverflow?: boolean;
	historyEntries?: readonly AgentRuntimeHistoryEntry[];
	historyReconciliationProof?: AgentRuntimeHistoryReconciliationProof;
	historyReconciliationAuthoritative?: boolean;
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
	const timingOverflow = input.turnTimingOverflow === true
		|| suppliedTurnTimings.length + eventTurnTimings.length > TRACE_RECONCILIATION_TIMING_CAP;
	const turnTimings = timingOverflow
		? []
		: mergeMessageTurnTimings(suppliedTurnTimings, eventTurnTimings);
	const historyTurnTimings = timingOverflow ? [...suppliedTurnTimings, ...eventTurnTimings] : turnTimings;
	const entries = projectHistoryEntries(
		allEntries,
		sessionStatus,
		openHistoryEventIds,
		historyTurnTimings,
		input.historyReconciliationProof,
		input.historyReconciliationAuthoritative,
	);
	const nodes = traceNodesFromHistoryEntries(
		input.session.id,
		entries,
		historyTurnTimings,
		input.historyReconciliationProof,
		input.historyReconciliationAuthoritative,
	);
	suppressServiceTurnHistory(nodes, events);
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
	const hasIncompleteTurns = markIncompletePersistedTurns(nodes, byId, input.session.id, events, turnTimings, sessionStatus);

	const nestedNodes = nestTraceNodes(nodes);
	reconcileAsyncAgentRunStatuses(nestedNodes);

	return {
		piboSessionId: input.session.id,
		piSessionId: input.session.piSessionId,
		...(hasIncompleteTurns ? { integrityStatus: "incomplete" as const } : {}),
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

function suppressServiceTurnHistory(nodes: PiboTraceNode[], events: readonly ChatWebStoredEvent[]): void {
	// Native history does not retain the product-level service source. Match the unique nearby
	// user entry, then let the event log provide the canonical prompt-free service turn.
	const hiddenNativeTurnIds = new Set<string>();
	const serviceStarts = events.flatMap((storedEvent) => {
		const event = storedEvent.payload as PiboOutputEvent;
		if (event.type !== "message_started" || event.source !== "service" || !event.text.trim()) return [];
		return [{ text: normalizeTraceText(event.text), createdAt: storedEvent.createdAt, eventId: event.eventId }];
	});

	for (const serviceStart of serviceStarts) {
		const candidates = nodes
			.filter((node) =>
				node.type === "user.message"
				&& (node.source === "transcript" || node.source === "product-history")
				&& normalizeTraceText(traceNodeText(node)) === serviceStart.text
				&& (!node.nativeTurnId || !hiddenNativeTurnIds.has(node.nativeTurnId))
			)
			.map((node) => ({ node, distance: timestampDistance(node.startedAt, serviceStart.createdAt) }))
			.filter((candidate) => candidate.distance !== undefined && candidate.distance <= SERVICE_TURN_HISTORY_MATCH_MAX_DISTANCE_MS)
			.sort((left, right) => left.distance! - right.distance!);
		const identityMatch = candidates.find(({ node }) =>
			node.eventId === serviceStart.eventId
			|| node.entryId === serviceStart.eventId
			|| node.nativeTurnId === serviceStart.eventId,
		);
		const matched = identityMatch ?? (
			candidates.length > 0 && (candidates.length === 1 || candidates[0]!.distance !== candidates[1]!.distance)
				? candidates[0]
				: undefined
		);
		if (matched?.node.nativeTurnId) hiddenNativeTurnIds.add(matched.node.nativeTurnId);
	}

	if (hiddenNativeTurnIds.size === 0) return;
	for (let index = nodes.length - 1; index >= 0; index -= 1) {
		const node = nodes[index]!;
		if (node.nativeTurnId && hiddenNativeTurnIds.has(node.nativeTurnId)) nodes.splice(index, 1);
	}
}

function traceNodeText(node: PiboTraceNode): string {
	return typeof node.output === "string" ? node.output : typeof node.summary === "string" ? node.summary : "";
}

function normalizeTraceText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function timestampDistance(left: string | undefined, right: string | undefined): number | undefined {
	if (!left || !right) return undefined;
	const leftMs = Date.parse(left);
	const rightMs = Date.parse(right);
	if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return undefined;
	return Math.abs(leftMs - rightMs);
}
