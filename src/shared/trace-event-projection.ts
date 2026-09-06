import type { PiboOutputEvent } from "../core/events.js";
import { eventTraceOrder, liveTraceOrder, type TraceOrderKey } from "./trace-order.js";
import { compareTraceNodes, flattenTraceNodes } from "./trace-nodes.js";
import { attachAsyncAgentRunNode, isRunStartToolNode } from "./trace-async-agent-runs.js";
import { createRunNotificationNode, parseRunNotificationText } from "./trace-run-notifications.js";
import {
	findLikelyTraceChildSession,
	isSubagentToolName,
	type TraceChildSession,
} from "./trace-subagent-links.js";
import type { ChatWebStoredEvent, PiboTraceNode, PiboWebSessionStatus, TracePayloadRef } from "./trace-types.js";
import { qualifiedToolNodeId } from "./trace-tool-identity.js";

export type PersistedHistoryMode = "none" | "product" | "native";

export type PersistedHistoryCoverage = {
	mode: PersistedHistoryMode;
	eventIds: ReadonlySet<string>;
	toolCallIds: ReadonlySet<string>;
};

export function applySingleEventToNodes(
	nodes: PiboTraceNode[],
	byId: Map<string, PiboTraceNode>,
	piboSessionId: string,
	storedEvent: ChatWebStoredEvent,
	childByParent: Map<string, TraceChildSession[]>,
	linkedChildByToolCallId: Map<string, string>,
	historyCoverage: PersistedHistoryCoverage,
	openTranscriptEventIds: ReadonlySet<string>,
	sessionStatus: PiboWebSessionStatus,
): void {
	const payload = storedEvent.payload as PiboOutputEvent;
	if (payload.type === "message_started" && payload.source === "user" && payload.eventId) {
		const persistedUser = flattenTraceNodes([...nodes]).find((node) =>
			node.type === "user.message"
			&& isPersistedHistorySource(node.source)
			&& node.eventId === payload.eventId
		);
		if (persistedUser) applyRenderSequence(persistedUser, storedEvent, payload);
	}
	const confirmedUserMessage = historyCoverage.mode !== "none" ? confirmedUserMessageEchoNode(nodes, storedEvent) : undefined;
	if (confirmedUserMessage) {
		applyRenderSequence(confirmedUserMessage, storedEvent, payload);
		if (payload.type === "message_steered" && payload.activeEventId) {
			confirmedUserMessage.parentId = messageTurnNodeId(payload.activeEventId);
		}
		return;
	}
	if (
		((historyCoverage.mode === "native" && isTranscriptEchoEvent(payload))
			|| (historyCoverage.mode === "product" && isProductHistoryEchoEvent(payload))) &&
		historyCoversEvent(payload, historyCoverage) &&
		!shouldKeepTranscriptEchoEvent(payload, openTranscriptEventIds)
	) {
		applyRenderSequenceToHistoryNode(byId, storedEvent, payload);
		return;
	}
	if (isNativeHistoryToolEchoEvent(payload, historyCoverage, sessionStatus)) {
		applyRenderSequenceToHistoryNode(byId, storedEvent, payload);
		return;
	}
	if (payload.type === "assistant_delta") {
		mergeAssistantDeltaEvent(
			nodes,
			byId,
			payload,
			sessionStatus,
			storedEvent.createdAt,
			storedEvent.eventSequence,
			storedEvent.streamId,
			storedEvent.streamFrameIndex,
			storedEvent.traceSource,
			storedEvent.id,
		);
		return;
	}
	if (payload.type === "thinking_delta") {
		mergeThinkingDeltaEvent(
			nodes,
			byId,
			payload,
			sessionStatus,
			storedEvent.createdAt,
			storedEvent.eventSequence,
			storedEvent.streamId,
			storedEvent.streamFrameIndex,
			storedEvent.traceSource,
			storedEvent.id,
		);
		return;
	}
	if (payload.type === "assistant_message") {
		const node = assistantMessageNodeFromEvent(
			piboSessionId,
			payload,
			storedEvent.createdAt,
			storedEvent.eventSequence,
			storedEvent.streamId,
			storedEvent.streamFrameIndex,
			storedEvent.traceSource,
			storedEvent.id,
		);
		const existing = byId.get(node.id) ?? findMatchingContentNode(byId, node);
		if (existing) {
			mergeAssistantMessageEvent(existing, node);
			return;
		}
		nodes.push(node);
		byId.set(node.id, node);
		return;
	}
	const node = traceNodeFromEvent(
		piboSessionId,
		payload,
		childByParent,
		linkedChildByToolCallId,
		sessionStatus,
		storedEvent.createdAt,
		storedEvent.eventSequence,
		storedEvent.streamId,
		storedEvent.streamFrameIndex,
		storedEvent.traceSource,
		storedEvent.id,
	);
	if (!node) return;
	applyStoredPayloadRef(node, payload, storedEvent.storedPayloadRef);
	if (payload.type === "session_error" && payload.eventId) {
		node.parentId = settleTurnFromSessionError(byId, payload.eventId, payload, storedEvent.createdAt);
	}
	if (
		node.type === "user.message" &&
		node.status === "running" &&
		!node.parentId &&
		payload.type === "message_steered"
	) {
		const activeTurn = [...byId.values()].reverse().find(
			(candidate) => candidate.type === "agent.turn" && candidate.status === "running",
		);
		if (activeTurn) node.parentId = activeTurn.id;
	}
	if (node.type === "agent.turn" && node.eventId) {
		const existingTurn = [...byId.values()].find(
			(candidate) => candidate.type === "agent.turn" && candidate.eventId === node.eventId,
		);
		if (existingTurn) {
			existingTurn.status = node.status;
			existingTurn.completedAt = node.completedAt ?? existingTurn.completedAt;
			return;
		}
	}
	if (node.type === "assistant.message") {
		const existing = byId.get(node.id) ?? findMatchingContentNode(byId, node);
		if (existing) {
			mergeAssistantMessageEvent(existing, node);
			return;
		}
	}
	if (node.type === "execution.compaction") {
		const existing = findLatestCompactionNode(nodes);
		if (existing) {
			mergeCompactionEvent(existing, node);
			return;
		}
	}
	if (node.type === "model.reasoning") {
		const existing = byId.get(node.id) ?? findMatchingContentNode(byId, node);
		if (existing) {
			mergeReasoningEvent(existing, node);
			return;
		}
	}
	if (node.type === "agent.delegation" && !node.toolCallId && node.linkedPiboSessionId) {
		const existing = findLegacySubagentLinkTarget([...byId.values()], node);
		if (existing) {
			mergeSubagentSessionLink(existing, node);
			return;
		}
	}
	if (node.toolCallId) {
		const existing = byId.get(node.id) ?? findUniqueLegacyToolTarget(byId, node, payload);
		if (existing) {
			if (isRunStartToolNode(existing) && node.type === "agent.delegation") {
				attachAsyncAgentRunNode(existing, piboSessionId, storedEvent.createdAt, node);
				return;
			}
			mergeToolEvent(existing, node);
			attachAsyncAgentRunNode(existing, piboSessionId, storedEvent.createdAt);
			return;
		}
	}
	if (node.eventId) {
		const existing = byId.get(node.id);
		if (existing) {
			if (node.type === "user.message") {
				existing.status = node.status;
				existing.parentId = node.parentId ?? existing.parentId;
				existing.summary = node.summary ?? existing.summary;
				existing.output = node.output ?? existing.output;
			} else if (node.type === "execution.command") {
				existing.status = node.status;
				existing.output = node.output ?? existing.output;
				existing.error = node.error ?? existing.error;
				existing.completedAt = node.completedAt ?? existing.completedAt;
			}
			return;
		}
	}
	attachExecutionCommandToOpenTurn(node, byId);
	attachAsyncAgentRunNode(node, piboSessionId, storedEvent.createdAt);
	nodes.push(node);
	for (const indexed of flattenTraceNodes([node])) byId.set(indexed.id, indexed);
}

function findUniqueLegacyToolTarget(
	byId: ReadonlyMap<string, PiboTraceNode>,
	update: PiboTraceNode,
	event: PiboOutputEvent,
): PiboTraceNode | undefined {
	if ("eventId" in event && event.eventId) return undefined;
	const candidates = [...byId.values()].filter((candidate) =>
		candidate.toolCallId === update.toolCallId
		&& (candidate.type === "tool.call" || candidate.type === "tool.result" || candidate.type === "agent.delegation")
	);
	return candidates.length === 1 ? candidates[0] : undefined;
}

function applyRenderSequenceToHistoryNode(
	byId: ReadonlyMap<string, PiboTraceNode>,
	storedEvent: ChatWebStoredEvent,
	event: PiboOutputEvent,
): void {
	const stableKey = eventStableKey(event, traceEventInstanceKey(storedEvent.eventSequence, storedEvent.streamId, event, storedEvent.id));
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	const target = [...byId.values()].find((node) =>
		node.stableKey === stableKey
		|| (
			"toolCallId" in event
			&& typeof event.toolCallId === "string"
			&& node.toolCallId === event.toolCallId
			&& (!eventId || !node.eventId || node.eventId === eventId)
		)
	);
	if (target) applyRenderSequence(target, storedEvent, event);
}

function applyRenderSequence(
	node: PiboTraceNode,
	storedEvent: ChatWebStoredEvent,
	event: PiboOutputEvent,
): void {
	const renderSequence = storedEvent.renderSequence ?? event.renderSequence;
	const eventSequence = storedEvent.eventSequence ?? storedEvent.streamId;
	if (renderSequence === undefined && eventSequence === undefined) return;
	const orderKey = node.orderKey ?? eventTraceOrder(eventSequence, eventNodeKind(event.type));
	node.orderKey = {
		...orderKey,
		...(eventSequence === undefined ? {} : { turnSeq: eventSequence, eventSequence }),
		...(renderSequence === undefined ? {} : { renderSequence }),
	};
}

function applyStoredPayloadRef(
	node: PiboTraceNode,
	event: PiboOutputEvent,
	storedPayloadRef: TracePayloadRef | undefined,
): void {
	if (!storedPayloadRef) return;
	if (event.type === "tool_call" || event.type === "tool_execution_started") {
		node.payloadRefs = { ...node.payloadRefs, input: storedPayloadRef };
	}
	if (event.type === "tool_execution_finished" || event.type === "tool_execution_updated") {
		node.payloadRefs = { ...node.payloadRefs, output: storedPayloadRef };
	}
}

function assistantMessageNodeFromEvent(
	piboSessionId: string,
	event: Extract<PiboOutputEvent, { type: "assistant_message" }>,
	createdAt?: string,
	eventSequence?: number,
	streamId?: number,
	streamFrameIndex?: number,
	traceSource?: ChatWebStoredEvent["traceSource"],
	storedInstanceId?: string,
): PiboTraceNode {
	const eventId = typeof event.eventId === "string" ? event.eventId : undefined;
	const assistantId = assistantEventNodeId(event);
	const fallbackIdentity = traceEventInstanceKey(eventSequence, streamId, event, storedInstanceId);
	const id = assistantId ? assistantMessageNodeId(assistantId) : `event:${event.type}:${fallbackIdentity}`;
	return {
		id,
		piboSessionId,
		eventId,
		parentId: eventId ? messageTurnNodeId(eventId) : undefined,
		type: "assistant.message",
		title: "Agent Message",
		status: "done",
		startedAt: createdAt,
		completedAt: createdAt,
		summary: event.text,
		output: event.text,
		source: "event-log",
		stableKey: assistantId ? `assistant:${assistantId}` : eventStableKey(event, fallbackIdentity),
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex, traceSource, event.renderSequence, createdAt),
		children: [],
	};
}

function attachExecutionCommandToOpenTurn(
	node: PiboTraceNode,
	byId: Map<string, PiboTraceNode>,
): void {
	if (node.type !== "execution.command") return;
	if (node.parentId && byId.has(node.parentId)) return;

	const turn = [...byId.values()]
		.filter((candidate) => {
			if (candidate.type !== "agent.turn") return false;
			if (!candidate.startedAt || !node.startedAt) return false;
			if (candidate.startedAt > node.startedAt) return false;
			const closedAt = turnClosedAt(candidate, byId);
			return closedAt === undefined || node.startedAt <= closedAt;
		})
		.sort(compareTraceNodes)
		.at(-1);
	if (!turn) return;
	node.parentId = turn.id;
}

function turnClosedAt(turn: PiboTraceNode, byId: Map<string, PiboTraceNode>): string | undefined {
	if (turn.completedAt) return turn.completedAt;
	const error = [...byId.values()]
		.filter((candidate) =>
			candidate.type === "error" &&
			candidate.eventId !== undefined &&
			candidate.eventId === turn.eventId &&
			candidate.startedAt !== undefined
		)
		.sort(compareTraceNodes)
		.at(0);
	return error?.startedAt;
}

const INCOMPLETE_TURN_SUMMARY = "Incomplete output lifecycle";
const INCOMPLETE_TURN_ERROR = "Persisted output has message_started but no message_finished or session_error event.";

export function markIncompletePersistedTurns(
	nodes: PiboTraceNode[],
	byId: Map<string, PiboTraceNode>,
	piboSessionId: string,
	events: readonly ChatWebStoredEvent[],
	turnTimings: readonly TraceMessageTurnTiming[],
	sessionStatus: PiboWebSessionStatus,
): boolean {
	const lifecycleByEventId = new Map<string, { started: boolean; completed: boolean }>();
	for (const timing of turnTimings) {
		const lifecycle = lifecycleByEventId.get(timing.eventId) ?? { started: false, completed: false };
		lifecycle.started ||= timing.startedAt !== undefined;
		lifecycle.completed ||= timing.completedAt !== undefined;
		lifecycleByEventId.set(timing.eventId, lifecycle);
	}
	const incompleteEventIds = new Set([...lifecycleByEventId].flatMap(([eventId, lifecycle]) =>
		lifecycle.started && !lifecycle.completed ? [eventId] : [],
	));
	if (sessionStatus === "running") {
		const currentTurn = [...turnTimings].reverse().find((timing) =>
			timing.userMessageType !== "message_steered" &&
			timing.startedAt !== undefined,
		);
		if (currentTurn?.startedAt !== undefined && currentTurn.completedAt === undefined) {
			incompleteEventIds.delete(currentTurn.eventId);
		}
	}
	if (incompleteEventIds.size === 0) return false;
	const startByEventId = new Map<string, ChatWebStoredEvent>();
	const lastByEventId = new Map<string, ChatWebStoredEvent>();
	for (const storedEvent of events) {
		const event = storedEvent.payload as PiboOutputEvent;
		const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
		if (!eventId || !incompleteEventIds.has(eventId)) continue;
		if (event.type === "message_started" && !startByEventId.has(eventId)) startByEventId.set(eventId, storedEvent);
		lastByEventId.set(eventId, storedEvent);
	}

	for (const eventId of incompleteEventIds) {
		const start = startByEventId.get(eventId);
		if (!start) continue;
		const startEvent = start.payload as Extract<PiboOutputEvent, { type: "message_started" }>;
		const turnId = messageTurnNodeId(eventId);
		let turn = byId.get(turnId);
		if (!turn) {
			turn = traceNodeFromEvent(
				piboSessionId,
				startEvent,
				new Map(),
				new Map(),
				sessionStatus,
				start.createdAt,
				start.eventSequence,
				start.streamId,
				start.streamFrameIndex,
				start.traceSource,
				start.id,
			);
			if (!turn) continue;
			nodes.push(turn);
			byId.set(turn.id, turn);
		}
		turn.status = "error";
		turn.summary = INCOMPLETE_TURN_SUMMARY;
		turn.error = INCOMPLETE_TURN_ERROR;

		const last = lastByEventId.get(eventId) ?? start;
		settleInterruptedTurnChildren(byId, turnId, INCOMPLETE_TURN_ERROR);
		const markerId = `event:incomplete-turn:${eventId}`;
		if (byId.has(markerId)) continue;
		const marker: PiboTraceNode = {
			id: markerId,
			parentId: turnId,
			piboSessionId,
			eventId,
			type: "error",
			title: "Incomplete Turn",
			status: "error",
			startedAt: last.createdAt,
			summary: INCOMPLETE_TURN_SUMMARY,
			error: INCOMPLETE_TURN_ERROR,
			output: INCOMPLETE_TURN_ERROR,
			source: "event-log",
			stableKey: `incomplete-turn:${eventId}`,
			orderKey: eventTraceNodeOrder(
				last.eventSequence,
				"session_error",
				last.streamId,
				last.streamFrameIndex,
				last.traceSource,
				undefined,
				last.createdAt,
			),
			children: [],
		};
		nodes.push(marker);
		byId.set(marker.id, marker);
	}
	return [...incompleteEventIds].some((eventId) => byId.has(`event:incomplete-turn:${eventId}`));
}

function settleTurnFromSessionError(
	byId: Map<string, PiboTraceNode>,
	eventId: string,
	event: Extract<PiboOutputEvent, { type: "session_error" }>,
	completedAt: string | undefined,
): string | undefined {
	const turnId = messageTurnNodeId(eventId);
	const turn = byId.get(turnId) ?? [...byId.values()].find(
		(candidate) => candidate.type === "agent.turn" && candidate.eventId === eventId,
	);
	if (!turn) return undefined;
	turn.status = "error";
	turn.completedAt = completedAt ?? turn.completedAt;
	turn.summary = event.errorDetails?.userMessage ?? event.error;
	turn.error = event.error;
	settleInterruptedTurnChildren(byId, turn.id, event.error, completedAt);
	return turn.id;
}

function settleInterruptedTurnChildren(
	byId: ReadonlyMap<string, PiboTraceNode>,
	turnId: string,
	error: string,
	completedAt?: string,
): void {
	for (const node of byId.values()) {
		if (node.parentId !== turnId) continue;
		const isOpenContent = node.status === "running" && (
			node.type === "assistant.message" ||
			node.type === "model.reasoning" ||
			node.type === "tool.call"
		);
		const isUnfinishedTool = node.type === "tool.call" && node.completedAt === undefined;
		if (!isOpenContent && !isUnfinishedTool) continue;
		node.status = "error";
		node.completedAt = completedAt;
		node.error = error;
	}
}

export function eventsCanAffectAsyncAgentRunStatus(events: readonly ChatWebStoredEvent[]): boolean {
	return events.some((event) => {
		const type = (event.payload as PiboOutputEvent).type;
		return type !== "assistant_delta" && type !== "thinking_delta";
	});
}

export function contentDeltaPatchNodeId(event: PiboOutputEvent): string | undefined {
	if (event.type === "assistant_delta") {
		if (event.text.length === 0) return undefined;
		const assistantId = assistantEventNodeId(event);
		return assistantId ? assistantMessageNodeId(assistantId) : undefined;
	}
	if (event.type === "thinking_delta") {
		if (event.text.length === 0) return undefined;
		const thinkingId = thinkingEventNodeId(event);
		return thinkingId ? thinkingNodeId(thinkingId) : undefined;
	}
	return undefined;
}

export function reconcileTranscriptUserMessages(
	nodes: readonly PiboTraceNode[],
	events: readonly ChatWebStoredEvent[],
	turnTimings: readonly TraceMessageTurnTiming[] = [],
): void {
	const transcriptUsers = nodes.filter((node) => node.type === "user.message" && isPersistedHistorySource(node.source));
	const timingByEventId = new Map(turnTimings.map((timing) => [timing.eventId, timing]));
	let latestTranscriptUser: PiboTraceNode | undefined;
	for (const node of nodes) {
		if (node.type === "user.message" && isPersistedHistorySource(node.source)) {
			latestTranscriptUser = node;
			continue;
		}
		if (
			node.type !== "assistant.message" ||
			!isPersistedHistorySource(node.source) ||
			!node.eventId ||
			!latestTranscriptUser ||
			transcriptUserMessageHasCanonicalIdentity(latestTranscriptUser)
		) continue;
		const timing = timingByEventId.get(node.eventId);
		if (
			timing?.userText &&
			normalizedUserMessageText(traceNodeText(latestTranscriptUser)) !== normalizedUserMessageText(timing.userText)
		) continue;
		assignTranscriptUserMessageIdentity(latestTranscriptUser, timing);
	}

	let timingCursor = transcriptUsers.length - 1;
	for (let timingIndex = turnTimings.length - 1; timingIndex >= 0; timingIndex -= 1) {
		const timing = turnTimings[timingIndex]!;
		const prompt = normalizedUserMessageText(timing.userText);
		if (!prompt) continue;
		const exactMatchIndex = transcriptUsers.findIndex(
			(node, index) =>
				index <= timingCursor &&
				!transcriptUserMessageHasCanonicalIdentity(node) &&
				node.entryId === timing.eventId,
		);
		let matchIndex = exactMatchIndex;
		if (matchIndex === -1 && (timing.userMessageType === "message_steered" || timing.completedAt)) {
			for (let userIndex = timingCursor; userIndex >= 0; userIndex -= 1) {
				const node = transcriptUsers[userIndex]!;
				if (transcriptUserMessageHasCanonicalIdentity(node)) continue;
				if (normalizedUserMessageText(traceNodeText(node)) !== prompt) continue;
				matchIndex = userIndex;
				break;
			}
		}
		if (matchIndex === -1) continue;
		const matchedNode = transcriptUsers[matchIndex]!;
		assignTranscriptUserMessageIdentity(matchedNode, timing);
		timingCursor = matchIndex - 1;
	}

	let userCursor = 0;
	for (const storedEvent of events) {
		const event = storedEvent.payload as PiboOutputEvent;
		if ((event.type !== "message_queued" && event.type !== "message_steered") || event.source !== "user") continue;
		const payloadEventId = typeof event.eventId === "string" ? event.eventId : undefined;
		const eventId = payloadEventId ?? storedEvent.eventId;
		const fallbackIdentity = storedEvent.id ? `instance:${storedEvent.id}` : liveProjectionIdentity(event);
		const canonicalId = `event:${event.type}:${payloadEventId ?? fallbackIdentity}`;
		const stableKey = eventStableKey(event, fallbackIdentity);
		const text = typeof event.text === "string" ? event.text : undefined;
		const identityMatchIndex = transcriptUsers.findIndex((node) =>
			transcriptUserMessageMatchesIdentity(node, canonicalId, stableKey, eventId),
		);
		const matchIndex = identityMatchIndex !== -1
			? identityMatchIndex
			: transcriptUsers.findIndex(
				(node, index) =>
					index >= userCursor &&
					!transcriptUserMessageHasCanonicalIdentity(node) &&
					Boolean(text && traceNodeText(node) === text),
			);
		if (matchIndex === -1) continue;
		const matchedNode = transcriptUsers[matchIndex]!;
		matchedNode.id = canonicalId;
		matchedNode.stableKey = stableKey;
		matchedNode.startedAt = storedEvent.createdAt;
		userCursor = Math.max(userCursor, matchIndex + 1);
	}
}

export function isConfirmedUserMessageEcho(nodes: readonly PiboTraceNode[], event: ChatWebStoredEvent): boolean {
	return Boolean(confirmedUserMessageEchoNode(nodes, event));
}

function confirmedUserMessageEchoNode(nodes: readonly PiboTraceNode[], event: ChatWebStoredEvent): PiboTraceNode | undefined {
	const payload = event.payload as PiboOutputEvent;
	if ((payload.type !== "message_queued" && payload.type !== "message_steered") || payload.source !== "user") return undefined;
	const payloadEventId = typeof payload.eventId === "string" ? payload.eventId : undefined;
	const eventId = payloadEventId ?? event.eventId;
	const fallbackIdentity = event.id ? `instance:${event.id}` : liveProjectionIdentity(payload);
	const canonicalId = `event:${payload.type}:${payloadEventId ?? fallbackIdentity}`;
	const stableKey = eventStableKey(payload, fallbackIdentity);
	const text = typeof payload.text === "string" ? payload.text : undefined;
	const transcriptUsers = flattenTraceNodes([...nodes]).filter(
		(node) => node.type === "user.message" && isPersistedHistorySource(node.source),
	);
	const identityMatch = transcriptUsers.find((node) =>
		transcriptUserMessageMatchesIdentity(node, canonicalId, stableKey, eventId),
	);
	if (identityMatch) return identityMatch;
	return transcriptUsers.find((node) =>
		!transcriptUserMessageHasCanonicalIdentity(node) && Boolean(text && traceNodeText(node) === text),
	);
}

function isPersistedHistorySource(source: PiboTraceNode["source"]): boolean {
	return source === "transcript" || source === "product-history";
}

function transcriptUserMessageMatchesIdentity(
	node: PiboTraceNode,
	canonicalId: string,
	stableKey: string,
	eventId: string | undefined,
): boolean {
	if (node.id === canonicalId || node.stableKey === stableKey) return true;
	if (!eventId) return false;
	if (node.entryId === eventId || node.stableKey === `entry:${eventId}`) return true;
	return [node.id, node.stableKey].some((value) => canonicalUserMessageEventId(value) === eventId);
}

function transcriptUserMessageHasCanonicalIdentity(node: PiboTraceNode): boolean {
	return [node.id, node.stableKey].some((value) => canonicalUserMessageEventId(value) !== undefined);
}

function canonicalUserMessageEventId(value: string | undefined): string | undefined {
	for (const prefix of ["event:message_queued:", "event:message_steered:"]) {
		if (value?.startsWith(prefix)) return value.slice(prefix.length);
	}
	return undefined;
}

function assignTranscriptUserMessageIdentity(node: PiboTraceNode, timing: TraceMessageTurnTiming | undefined): void {
	if (!timing) return;
	const userMessageType = timing.userMessageType ?? "message_queued";
	node.id = `event:${userMessageType}:${timing.eventId}`;
	node.stableKey = `event:${userMessageType}:${timing.eventId}`;
}

function normalizedUserMessageText(value: string | undefined): string | undefined {
	const normalized = value?.replace(/\s+/g, " ").trim();
	return normalized || undefined;
}

function traceNodeText(node: PiboTraceNode): string | undefined {
	if (typeof node.output === "string") return node.output;
	if (typeof node.summary === "string") return node.summary;
	return undefined;
}

export function dedupeTraceEvents<T extends ChatWebStoredEvent>(events: readonly T[]): T[] {
	const seen = new Set<string>();
	const deduped: T[] = [];
	for (const event of events) {
		const key = traceEventDedupeKey(event);
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(event);
	}
	return deduped;
}

export function traceEventDedupeKey(event: ChatWebStoredEvent): string {
	if (event.streamId !== undefined) {
		const payload = event.payload as PiboOutputEvent;
		if (event.streamFrameIndex !== undefined) {
			return `stream:${event.streamId}:${event.streamFrameIndex}:${payload.type}`;
		}
		return `stream:${event.streamId}:${payload.type}`;
	}
	if (event.eventSequence !== undefined) return `sequence:${event.piboSessionId ?? ""}:${event.eventSequence}`;
	return `id:${event.id}`;
}

export function latestTraceStreamId(
	events: readonly ChatWebStoredEvent[],
	initial?: number,
): number | undefined {
	let latest = initial;
	for (const event of events) {
		if (event.streamId === undefined) continue;
		latest = latest === undefined ? event.streamId : Math.max(latest, event.streamId);
	}
	return latest;
}

// ── event → node helpers ─────────────────────────────────────────

function traceNodeFromEvent(
	piboSessionId: string,
	event: PiboOutputEvent,
	childByParent: Map<string, TraceChildSession[]>,
	linkedChildByToolCallId: Map<string, string>,
	sessionStatus: PiboWebSessionStatus,
	createdAt?: string,
	eventSequence?: number,
	streamId?: number,
	streamFrameIndex?: number,
	traceSource?: ChatWebStoredEvent["traceSource"],
	storedInstanceId?: string,
): PiboTraceNode | undefined {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	const fallbackIdentity = traceEventInstanceKey(eventSequence, streamId, event, storedInstanceId);
	const id = `event:${event.type}:${eventId ?? fallbackIdentity}`;
	const turnParentId = eventId ? messageTurnNodeId(eventId) : undefined;
	const base = {
		id,
		piboSessionId,
		eventId,
		startedAt: createdAt,
		source: "event-log" as const,
		stableKey: eventStableKey(event, fallbackIdentity),
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex, traceSource, event.renderSequence, createdAt),
		children: [] as PiboTraceNode[],
	};

	switch (event.type) {
		case "message_queued":
		case "message_steered": {
			const notification = parseRunNotificationText(event.text);
			if (event.source === "service" && notification) {
				return createRunNotificationNode({
					id,
					piboSessionId,
					eventId,
					startedAt: createdAt,
					source: "event-log",
					stableKey: eventId ? `run-notification:${eventId}` : id,
					orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex, traceSource, event.renderSequence, createdAt),
					notification,
				});
			}
			return {
				...base,
				...(event.type === "message_steered" && event.activeEventId ? { parentId: messageTurnNodeId(event.activeEventId) } : {}),
				type: "user.message",
				title: "User Message",
				status: isOptimisticUserMessageEvent(event) ? "running" : "done",
				summary: event.text,
				output: event.text,
			};
		}
		case "message_started":
		case "message_finished":
			return {
				...base,
				id: eventId ? messageTurnNodeId(eventId) : id,
				type: "agent.turn",
				startedAt: event.type === "message_started" ? createdAt : undefined,
				title: "Agent Turn",
				status:
					event.type === "message_finished" || sessionStatus !== "running" ? "done" : "running",
				completedAt: event.type === "message_finished" ? createdAt : undefined,
				stableKey: eventId ? `turn:${eventId}` : base.stableKey,
			};
		case "thinking_finished": {
			if (!hasVisibleText(event.text)) return undefined;
			const thinkingId = thinkingEventNodeId(event);
			return {
				...base,
				id: thinkingId ? thinkingNodeId(thinkingId) : id,
				parentId: turnParentId,
				type: "model.reasoning",
				title: "Thinking",
				status: "done",
				summary: event.text,
				output: event.text,
				stableKey: thinkingId ? `reasoning:${thinkingId}` : base.stableKey,
			};
		}
		case "assistant_message": {
			const assistantId = assistantEventNodeId(event);
			return {
				...base,
				id: assistantId ? assistantMessageNodeId(assistantId) : id,
				parentId: turnParentId,
				type: "assistant.message",
				title: "Agent Message",
				status: "done",
				completedAt: createdAt,
				summary: event.text,
				output: event.text,
				stableKey: assistantId ? `assistant:${assistantId}` : base.stableKey,
			};
		}
		case "tool_call":
		case "tool_execution_started":
		case "tool_execution_updated":
		case "tool_execution_finished": {
			const toolNodeId = toolInvocationNodeId(event);
			const subagentTool = isSubagentToolName(event.toolName);
			const linkedPiboSessionId =
				linkedChildByToolCallId.get(toolNodeId) ??
				(subagentTool
					? findLikelyTraceChildSession(piboSessionId, event.toolName, event, childByParent)
					: undefined);
			return {
				...base,
				id: toolNodeId,
				parentId: turnParentId,
				toolCallId: event.toolCallId,
				toolInvocationOrdinal: event.toolInvocationOrdinal ?? 0,
				intent: event.intent,
				toolMetrics: event.type === "tool_execution_finished" ? event.toolMetrics : undefined,
				type: subagentTool ? "agent.delegation" : "tool.call",
				title: event.toolName,
				status:
					event.type === "tool_execution_finished"
						? event.isError
							? "error"
							: "done"
						: sessionStatus === "running" &&
							  (event.type === "tool_execution_started" || event.type === "tool_execution_updated")
							? "running"
							: "done",
				completedAt: event.type === "tool_execution_finished" ? createdAt : undefined,
				input: "args" in event ? event.args : undefined,
				output:
					event.type === "tool_execution_finished"
						? event.result
						: event.type === "tool_execution_updated"
							? event.partialResult
							: undefined,
				error:
					event.type === "tool_execution_finished" && event.isError
						? stringifyPreview(event.result)
						: undefined,
				linkedPiboSessionId,
				stableKey: toolNodeId,
				children: [],
			};
		}
		case "subagent_session": {
			const childPiboSessionId = nonEmptyString(event.childPiboSessionId);
			const eventInstanceKey = traceEventInstanceKey(eventSequence, streamId, event, storedInstanceId);
			const toolNodeId = event.toolCallId ? toolInvocationNodeId(event) : undefined;
			return {
				...base,
				id: toolNodeId ?? `event:subagent_session:${eventInstanceKey}`,
				eventId,
				toolCallId: event.toolCallId,
				toolInvocationOrdinal: event.toolInvocationOrdinal,
				type: "agent.delegation",
				title: event.toolName,
				status: sessionStatus === "running" ? "running" : "done",
				summary: event.subagentName,
				input: { subagentName: event.subagentName, threadKey: event.threadKey },
				linkedPiboSessionId: childPiboSessionId,
				stableKey: toolNodeId
					? toolNodeId
					: childPiboSessionId ? `subagent:${childPiboSessionId}` : `subagent:event:${eventInstanceKey}`,
				children: [],
			};
		}
		case "execution_result":
			if (isInternalSessionOperation(event.action)) return undefined;
			return {
				...base,
				type: "execution.command",
				title: event.action,
				status: "done",
				input: { action: event.action },
				output: event.result,
			};
		case "compaction_start": {
			const eventInstanceKey = traceEventInstanceKey(eventSequence, streamId, event, storedInstanceId);
			return {
				...base,
				id: `event:compaction:${eventInstanceKey}`,
				type: "execution.compaction",
				title: "compact",
				status: "running",
				summary: "Compacting",
				input: { reason: event.reason },
				stableKey: `compaction:${eventInstanceKey}`,
			};
		}
		case "compaction_end": {
			const eventInstanceKey = traceEventInstanceKey(eventSequence, streamId, event, storedInstanceId);
			return {
				...base,
				id: `event:compaction:end:${eventInstanceKey}`,
				type: "execution.compaction",
				title: "compact",
				status: event.errorMessage ? "error" : "done",
				completedAt: createdAt,
				summary: event.aborted ? "Compaction skipped" : event.errorMessage ? "Compaction failed" : "Compacted",
				input: { reason: event.reason },
				output: event.result,
				error: event.errorMessage,
				stableKey: `compaction:${eventInstanceKey}`,
			};
		}
		case "session_error":
			return {
				...base,
				type: "error",
				title: "Session Error",
				status: "error",
				summary: event.errorDetails?.userMessage,
				input: event.errorDetails,
				error: event.error,
				output: event.error,
			};
		default:
			return undefined;
	}
}

function mergeAssistantDeltaEvent(
	nodes: PiboTraceNode[],
	byId: Map<string, PiboTraceNode>,
	event: Extract<PiboOutputEvent, { type: "assistant_delta" }>,
	sessionStatus: PiboWebSessionStatus,
	createdAt?: string,
	eventSequence?: number,
	streamId?: number,
	streamFrameIndex?: number,
	traceSource?: ChatWebStoredEvent["traceSource"],
	storedInstanceId?: string,
): void {
	if (typeof event.text !== "string" || event.text.length === 0) return;

	const assistantId = assistantEventNodeId(event);
	const fallbackIdentity = traceEventInstanceKey(eventSequence, streamId, event, storedInstanceId);
	const id = assistantId ? assistantMessageNodeId(assistantId) : `event:assistant_delta:${fallbackIdentity}`;
	const existing = byId.get(id);
	if (existing) {
		const text = `${typeof existing.output === "string" ? existing.output : ""}${event.text}`;
		existing.status = sessionStatus === "running" ? "running" : "done";
		existing.summary = text;
		existing.output = text;
		return;
	}

	const node: PiboTraceNode = {
		id,
		parentId: event.eventId ? messageTurnNodeId(event.eventId) : undefined,
		piboSessionId: event.piboSessionId,
		eventId: event.eventId,
		type: "assistant.message",
		title: "Agent Message",
		status: sessionStatus === "running" ? "running" : "done",
		startedAt: createdAt,
		summary: event.text,
		output: event.text,
		source: "event-log",
		stableKey: assistantId ? `assistant:${assistantId}` : id,
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex, traceSource, event.renderSequence, createdAt),
		children: [],
	};
	nodes.push(node);
	byId.set(node.id, node);
}

function findMatchingContentNode(
	byId: ReadonlyMap<string, PiboTraceNode>,
	update: PiboTraceNode,
): PiboTraceNode | undefined {
	if (!update.stableKey) return undefined;
	return [...byId.values()].find(
		(candidate) => candidate.type === update.type && candidate.stableKey === update.stableKey,
	);
}

function mergeAssistantMessageEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.summary = update.summary ?? target.summary;
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.completedAt = update.completedAt ?? target.completedAt;
}

function mergeThinkingDeltaEvent(
	nodes: PiboTraceNode[],
	byId: Map<string, PiboTraceNode>,
	event: Extract<PiboOutputEvent, { type: "thinking_delta" }>,
	sessionStatus: PiboWebSessionStatus,
	createdAt?: string,
	eventSequence?: number,
	streamId?: number,
	streamFrameIndex?: number,
	traceSource?: ChatWebStoredEvent["traceSource"],
	storedInstanceId?: string,
): void {
	if (typeof event.text !== "string" || event.text.length === 0) return;

	const thinkingId = thinkingEventNodeId(event);
	const fallbackIdentity = traceEventInstanceKey(eventSequence, streamId, event, storedInstanceId);
	const id = thinkingId ? thinkingNodeId(thinkingId) : `event:thinking_delta:${fallbackIdentity}`;
	const stableKey = thinkingId ? `reasoning:${thinkingId}` : id;
	const existing = byId.get(id) ?? [...byId.values()].find(
		(candidate) => candidate.type === "model.reasoning" && candidate.stableKey === stableKey,
	);
	if (existing) {
		const text = `${typeof existing.output === "string" ? existing.output : ""}${event.text}`;
		existing.status = sessionStatus === "running" ? "running" : "done";
		existing.summary = text;
		existing.output = text;
		return;
	}

	const node: PiboTraceNode = {
		id,
		parentId: event.eventId ? messageTurnNodeId(event.eventId) : undefined,
		piboSessionId: event.piboSessionId,
		eventId: event.eventId,
		type: "model.reasoning",
		title: "Thinking",
		status: sessionStatus === "running" ? "running" : "done",
		startedAt: createdAt,
		summary: event.text,
		output: event.text,
		source: "event-log",
		stableKey,
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex, traceSource, event.renderSequence, createdAt),
		children: [],
	};
	nodes.push(node);
	byId.set(node.id, node);
}

function mergeReasoningEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.summary = update.summary ?? target.summary;
	target.output = update.output ?? target.output;
	target.completedAt = update.completedAt ?? target.completedAt;
}

function isOptimisticUserMessageEvent(event: PiboOutputEvent): boolean {
	return (
		(event.type === "message_queued" || event.type === "message_steered") &&
		"clientTxnId" in event &&
		typeof event.clientTxnId === "string"
	);
}

function isInternalSessionOperation(action: string): boolean {
	return action === "session.fork" || action === "session.clone" || action === "session.switch";
}

function isProductHistoryEchoEvent(event: PiboOutputEvent): boolean {
	return event.type === "assistant_delta" || event.type === "assistant_message";
}

function isTranscriptEchoEvent(event: PiboOutputEvent): boolean {
	return (
		event.type === "message_queued" ||
		event.type === "message_started" ||
		event.type === "message_finished" ||
		event.type === "assistant_delta" ||
		event.type === "assistant_message" ||
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished"
	);
}

function shouldKeepTranscriptEchoEvent(
	event: PiboOutputEvent,
	openTranscriptEventIds: ReadonlySet<string>,
): boolean {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	return Boolean(eventId && openTranscriptEventIds.has(eventId));
}

function historyCoversEvent(event: PiboOutputEvent, coverage: PersistedHistoryCoverage): boolean {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	return eventId === undefined || coverage.eventIds.has(eventId);
}

function isNativeHistoryToolEchoEvent(
	event: PiboOutputEvent,
	coverage: PersistedHistoryCoverage,
	sessionStatus: PiboWebSessionStatus,
): boolean {
	if (coverage.mode !== "native" || sessionStatus === "running") return false;
	if (
		event.type !== "tool_call" &&
		event.type !== "tool_execution_started" &&
		event.type !== "tool_execution_updated" &&
		event.type !== "tool_execution_finished"
	) return false;
	if (typeof event.intent === "string" && event.intent.trim()) return false;
	return coverage.toolCallIds.has(event.toolCallId) || historyCoversEvent(event, coverage);
}

export type TraceMessageTurnTiming = {
	eventId: string;
	userText?: string;
	userMessageType?: "message_steered";
	activeEventId?: string;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	reasoningIndices?: number[];
	assistantIndices?: number[];
};

export function mergeMessageTurnTimings(...groups: readonly TraceMessageTurnTiming[][]): TraceMessageTurnTiming[] {
	const byEventId = new Map<string, TraceMessageTurnTiming>();
	for (const timing of groups.flat()) {
		const existing = byEventId.get(timing.eventId);
		if (!existing) {
			byEventId.set(timing.eventId, timing);
			continue;
		}
		const reasoningIndices = mergeUniqueIndices(existing.reasoningIndices, timing.reasoningIndices);
		const assistantIndices = mergeUniqueIndices(existing.assistantIndices, timing.assistantIndices);
		const merged: TraceMessageTurnTiming = {
			eventId: timing.eventId,
			userText: timing.userText ?? existing.userText,
			userMessageType: timing.userMessageType ?? existing.userMessageType,
			activeEventId: timing.activeEventId ?? existing.activeEventId,
			startedAt: timing.startedAt ?? existing.startedAt,
			completedAt: timing.completedAt ?? existing.completedAt,
			durationMs: timing.durationMs ?? existing.durationMs,
			...(reasoningIndices ? { reasoningIndices } : {}),
			...(assistantIndices ? { assistantIndices } : {}),
		};
		if (merged.durationMs === undefined) {
			const startedAtMs = parseTimestamp(merged.startedAt);
			const completedAtMs = parseTimestamp(merged.completedAt);
			if (startedAtMs !== undefined && completedAtMs !== undefined) {
				merged.durationMs = Math.max(0, completedAtMs - startedAtMs);
			}
		}
		byEventId.set(timing.eventId, merged);
	}
	return [...byEventId.values()];
}

function mergeUniqueIndices(first?: readonly number[], second?: readonly number[]): number[] | undefined {
	if (!first?.length && !second?.length) return undefined;
	return [...new Set([...(first ?? []), ...(second ?? [])])];
}

function appendUniqueIndex(indices: number[] | undefined, partIndex: number): number[] {
	if (indices?.includes(partIndex)) return indices;
	return [...(indices ?? []), partIndex];
}

export function messageTurnTimingsFromEvents(events: readonly ChatWebStoredEvent[]): TraceMessageTurnTiming[] {
	const timings = new Map<string, {
		userText?: string;
		userMessageType?: "message_steered";
		activeEventId?: string;
		startedAt?: string;
		completedAt?: string;
		reasoningIndices?: number[];
		assistantIndices?: number[];
	}>();
	const eventIds: string[] = [];
	const seenEventIds = new Set<string>();
	const ignoredEventIds = new Set<string>();
	for (const storedEvent of events) {
		const event = storedEvent.payload as PiboOutputEvent;
		if (
			event.type !== "message_queued" &&
			event.type !== "message_steered" &&
			event.type !== "message_started" &&
			event.type !== "message_finished" &&
			event.type !== "session_error" &&
			event.type !== "thinking_finished" &&
			event.type !== "assistant_message"
		) continue;
		const eventId = typeof event.eventId === "string" ? event.eventId : undefined;
		if (!eventId) continue;
		if ((event.type === "message_queued" || event.type === "message_started") && event.source === "service") {
			ignoredEventIds.add(eventId);
			continue;
		}
		if (ignoredEventIds.has(eventId)) continue;
		if (!seenEventIds.has(eventId)) {
			eventIds.push(eventId);
			seenEventIds.add(eventId);
		}
		const timing = timings.get(eventId) ?? {};
		if (event.type === "message_queued") {
			timing.userText ??= event.text;
		} else if (event.type === "message_steered") {
			timing.userText ??= event.text;
			timing.userMessageType = "message_steered";
			timing.activeEventId ??= event.activeEventId;
			timing.startedAt ??= storedEvent.createdAt;
		} else if (event.type === "message_started") {
			timing.userText ??= event.text;
			timing.startedAt ??= storedEvent.createdAt;
		} else if (event.type === "message_finished" || event.type === "session_error") {
			timing.completedAt = storedEvent.createdAt;
		} else if (event.type === "thinking_finished" && hasVisibleText(event.text)) {
			const partIndex = typeof event.thinkingIndex === "number" ? event.thinkingIndex : event.contentIndex;
			if (typeof partIndex === "number") timing.reasoningIndices = appendUniqueIndex(timing.reasoningIndices, partIndex);
		} else if (event.type === "assistant_message" && hasVisibleText(event.text)) {
			const partIndex = typeof event.assistantIndex === "number" ? event.assistantIndex : event.contentIndex;
			if (typeof partIndex === "number") timing.assistantIndices = appendUniqueIndex(timing.assistantIndices, partIndex);
		}
		timings.set(eventId, timing);
	}
	return eventIds.flatMap((eventId) => {
		const timing = timings.get(eventId);
		if (!timing) return [];
		const startedAtMs = parseTimestamp(timing.startedAt);
		const completedAtMs = parseTimestamp(timing.completedAt);
		return [{
			eventId,
			userText: timing.userText,
			startedAt: timing.startedAt,
			...(timing.userMessageType ? { userMessageType: timing.userMessageType } : {}),
			...(timing.activeEventId ? { activeEventId: timing.activeEventId } : {}),
			completedAt: timing.completedAt,
			durationMs: startedAtMs === undefined || completedAtMs === undefined
				? undefined
				: Math.max(0, completedAtMs - startedAtMs),
			...(timing.reasoningIndices ? { reasoningIndices: timing.reasoningIndices } : {}),
			...(timing.assistantIndices ? { assistantIndices: timing.assistantIndices } : {}),
		}];
	});
}

export function findOpenTranscriptEventIds(
	events: ChatWebStoredEvent[],
	sessionStatus: PiboWebSessionStatus,
): Set<string> {
	if (sessionStatus !== "running") return new Set();

	const open = new Set<string>();
	for (const storedEvent of events) {
		const event = storedEvent.payload as PiboOutputEvent;
		const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
		if (!eventId) continue;
		if (isOpenTranscriptEvent(event)) {
			open.add(eventId);
		} else if (event.type === "message_finished" || event.type === "session_error") {
			open.delete(eventId);
		}
	}
	return open;
}

function isOpenTranscriptEvent(event: PiboOutputEvent): boolean {
	return (
		event.type === "message_queued" ||
		event.type === "message_started" ||
		event.type === "assistant_delta" ||
		event.type === "assistant_message" ||
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished"
	);
}

function eventTraceNodeOrder(
	eventSequence: number | undefined,
	type: PiboOutputEvent["type"],
	streamId?: number,
	streamFrameIndex?: number,
	traceSource?: ChatWebStoredEvent["traceSource"],
	renderSequence?: number,
	createdAt?: string,
): TraceOrderKey {
	const order = traceSource === "live"
		? liveTraceOrder(streamId, streamFrameIndex, eventNodeKind(type))
		: eventTraceOrder(eventSequence ?? streamId, eventNodeKind(type));
	// Modern render sequences encode the first-visible millisecond plus a local
	// slot. Deriving chronology from that immutable segment position keeps a
	// live node in the same place when its persisted final receives a later
	// database created_at timestamp.
	const renderChronologyMs = renderSequence !== undefined && renderSequence >= 946_684_800_000_000
		? Math.floor(renderSequence / 1_000)
		: undefined;
	const chronologyMs = renderChronologyMs
		?? (createdAt && Number.isFinite(Date.parse(createdAt)) ? Date.parse(createdAt) : undefined);
	return {
		...order,
		...(renderSequence === undefined ? {} : { renderSequence }),
		...(chronologyMs === undefined ? {} : { chronologyMs }),
	};
}

function eventNodeKind(type: PiboOutputEvent["type"]): PiboTraceNode["type"] {
	switch (type) {
		case "message_queued":
		case "message_steered":
			return "user.message";
		case "message_started":
		case "message_finished":
			return "agent.turn";
		case "thinking_started":
		case "thinking_delta":
		case "thinking_finished":
			return "model.reasoning";
		case "tool_call":
		case "tool_execution_started":
		case "tool_execution_updated":
		case "tool_execution_finished":
		case "subagent_session":
			return "tool.call";
		case "assistant_delta":
		case "assistant_message":
			return "assistant.message";
		case "execution_result":
			return "execution.command";
		case "compaction_start":
		case "compaction_end":
			return "execution.compaction";
		case "session_error":
			return "error";
		default:
			return "execution.command";
	}
}

function eventStableKey(event: PiboOutputEvent, fallbackIdentity?: string): string {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	if (
		event.type === "tool_call" ||
		event.type === "tool_execution_started" ||
		event.type === "tool_execution_updated" ||
		event.type === "tool_execution_finished"
	) {
		return toolInvocationNodeId(event);
	}
	if (event.type === "subagent_session" && event.toolCallId) return toolInvocationNodeId(event);
	if (eventId && (event.type === "message_started" || event.type === "message_finished"))
		return `turn:${eventId}`;
	if (
		event.type === "thinking_started" ||
		event.type === "thinking_delta" ||
		event.type === "thinking_finished"
	) {
		const thinkingId = thinkingEventNodeId(event);
		if (thinkingId) return `reasoning:${thinkingId}`;
	}
	if (event.type === "assistant_delta" || event.type === "assistant_message") {
		const assistantId = assistantEventNodeId(event);
		if (assistantId) return `assistant:${assistantId}`;
	}
	return `event:${event.type}:${eventId ?? fallbackIdentity ?? liveProjectionIdentity(event)}`;
}

export function messageTurnNodeId(eventId: string): string {
	return `event:message:${eventId}`;
}

export function assistantMessageNodeId(eventId: string): string {
	return `event:assistant:${eventId}`;
}

function assistantEventNodeId(
	event: Extract<PiboOutputEvent, { type: "assistant_delta" | "assistant_message" }>,
): string | undefined {
	if (!event.eventId) return undefined;
	const partIndex = typeof event.assistantIndex === "number" ? event.assistantIndex : event.contentIndex;
	return typeof partIndex === "number" ? `${event.eventId}:assistant:${partIndex}` : event.eventId;
}

export function thinkingNodeId(eventId: string): string {
	return `event:thinking:${eventId}`;
}

function thinkingEventNodeId(
	event: Extract<PiboOutputEvent, { type: "thinking_started" | "thinking_delta" | "thinking_finished" }>,
): string | undefined {
	if (!event.eventId) return undefined;
	const partIndex = typeof event.thinkingIndex === "number" ? event.thinkingIndex : event.contentIndex;
	return typeof partIndex === "number" ? `${event.eventId}:thinking:${partIndex}` : event.eventId;
}

function mergeToolEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.intent = update.intent ?? target.intent;
	target.toolMetrics = update.toolMetrics ?? target.toolMetrics;
	target.summary = update.summary ?? target.summary;
	target.input = mergeDelegationInput(target, update);
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.completedAt = update.completedAt ?? target.completedAt;
	target.payloadRefs = { ...target.payloadRefs, ...update.payloadRefs };
	target.linkedPiboSessionId = update.linkedPiboSessionId ?? target.linkedPiboSessionId;
}

function mergeSubagentSessionLink(target: PiboTraceNode, update: PiboTraceNode): void {
	target.summary = update.summary ?? target.summary;
	target.input = mergeDelegationInput(target, update);
	target.linkedPiboSessionId = update.linkedPiboSessionId ?? target.linkedPiboSessionId;
}

function findLegacySubagentLinkTarget(nodes: readonly PiboTraceNode[], update: PiboTraceNode): PiboTraceNode | undefined {
	const delegations = [...nodes].reverse().filter((candidate) => candidate.type === "agent.delegation");
	const agentName = delegationAgentName(update);
	const candidates = delegations.filter(
		(candidate) => !candidate.linkedPiboSessionId && delegationAgentName(candidate) === agentName,
	);
	const threadKey = delegationThreadKey(update.input);
	const matchingCandidate = threadKey
		? candidates.find((candidate) => delegationThreadKey(candidate.input) === threadKey)
		: candidates.length === 1 ? candidates[0] : undefined;
	if (matchingCandidate) return matchingCandidate;
	return delegations.find((candidate) => candidate.linkedPiboSessionId === update.linkedPiboSessionId);
}

function delegationAgentName(node: PiboTraceNode): string | undefined {
	const input = isObjectRecord(node.input) ? node.input : undefined;
	const value = typeof input?.name === "string"
		? input.name
		: typeof input?.subagentName === "string"
			? input.subagentName
			: node.summary ?? node.title;
	return typeof value === "string"
		? value.replace(/^pibo_agents_send_message$/, "agent").replace(/^pibo_subagent_/, "").trim().toLowerCase() || undefined
		: undefined;
}

function delegationThreadKey(value: unknown): string | undefined {
	if (!isObjectRecord(value) || typeof value.threadKey !== "string") return undefined;
	return value.threadKey.trim() || undefined;
}

function mergeDelegationInput(target: PiboTraceNode, update: PiboTraceNode): unknown {
	if (target.type !== "agent.delegation" || !isObjectRecord(target.input) || !isObjectRecord(update.input)) {
		return update.input ?? target.input;
	}
	return Object.fromEntries(
		Object.entries({ ...target.input, ...update.input }).filter(([, value]) => value !== undefined),
	);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findLatestCompactionNode(nodes: readonly PiboTraceNode[]): PiboTraceNode | undefined {
	return flattenTraceNodes([...nodes]).reverse().find((node) => node.type === "execution.compaction" && node.status === "running");
}

function mergeCompactionEvent(target: PiboTraceNode, update: PiboTraceNode): void {
	target.status = update.status;
	target.summary = update.summary ?? target.summary;
	target.input = update.input ?? target.input;
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.completedAt = update.completedAt ?? target.completedAt;
}

function hasVisibleText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function stringifyPreview(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function parseTimestamp(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const timestamp = new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp : undefined;
}

function traceEventInstanceKey(
	eventSequence: number | undefined,
	streamId: number | undefined,
	event: PiboOutputEvent,
	storedInstanceId?: string,
): string {
	if (eventSequence !== undefined) return `sequence:${eventSequence}`;
	if (streamId !== undefined) return `stream:${streamId}`;
	if (storedInstanceId) return `instance:${storedInstanceId}`;
	return liveProjectionIdentity(event);
}

function toolInvocationNodeId(event: Extract<PiboOutputEvent, {
	type: "tool_call" | "tool_execution_started" | "tool_execution_updated" | "tool_execution_finished" | "subagent_session";
}>): string {
	const eventId = event.eventId
		?? (event.renderSequence !== undefined ? `render:${event.renderSequence}` : "unscoped");
	return qualifiedToolNodeId(event.toolCallId ?? "unlinked", eventId, event.toolInvocationOrdinal ?? 0);
}

function nonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value.trim() || undefined;
}

function liveProjectionIdentity(value: object): string {
	const existing = liveProjectionIdentityCache.get(value);
	if (existing) return existing;
	const identity = `live:${++liveProjectionIdentitySequence}`;
	liveProjectionIdentityCache.set(value, identity);
	return identity;
}

const liveProjectionIdentityCache = new WeakMap<object, string>();
let liveProjectionIdentitySequence = 0;
