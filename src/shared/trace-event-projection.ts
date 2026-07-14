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
import type { ChatWebStoredEvent, PiboTraceNode, PiboWebSessionStatus } from "./trace-types.js";

export function applySingleEventToNodes(
	nodes: PiboTraceNode[],
	byId: Map<string, PiboTraceNode>,
	piboSessionId: string,
	storedEvent: ChatWebStoredEvent,
	childByParent: Map<string, TraceChildSession[]>,
	linkedChildByToolCallId: Map<string, string>,
	hasPersistedTranscript: boolean,
	openTranscriptEventIds: ReadonlySet<string>,
	sessionStatus: PiboWebSessionStatus,
): void {
	const payload = storedEvent.payload as PiboOutputEvent;
	if (
		hasPersistedTranscript &&
		isTranscriptEchoEvent(payload) &&
		!shouldKeepTranscriptEchoEvent(payload, openTranscriptEventIds)
	) {
		return;
	}
	if (hasPersistedTranscript && isStaleToolCallEchoEvent(payload, sessionStatus)) {
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
		);
		const existing = byId.get(node.id);
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
	);
	if (!node) return;
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
		const existing = byId.get(node.id);
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
		const existing = byId.get(node.id);
		if (existing) {
			mergeReasoningEvent(existing, node);
			return;
		}
	}
	if (node.toolCallId) {
		const existing = [...byId.values()].find(
			(candidate) =>
				candidate.toolCallId === node.toolCallId &&
				(candidate.type === "tool.call" || candidate.type === "agent.delegation"),
		);
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
	if (node.eventId && byId.has(node.id)) return;
	attachExecutionCommandToOpenTurn(node, byId);
	attachAsyncAgentRunNode(node, piboSessionId, storedEvent.createdAt);
	nodes.push(node);
	for (const indexed of flattenTraceNodes([node])) byId.set(indexed.id, indexed);
}

function assistantMessageNodeFromEvent(
	piboSessionId: string,
	event: Extract<PiboOutputEvent, { type: "assistant_message" }>,
	createdAt?: string,
	eventSequence?: number,
	streamId?: number,
	streamFrameIndex?: number,
): PiboTraceNode {
	const eventId = typeof event.eventId === "string" ? event.eventId : undefined;
	const assistantId = assistantEventNodeId(event);
	const id = assistantId ? assistantMessageNodeId(assistantId) : `event:${event.type}:${cryptoSafeId(event)}`;
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
		stableKey: assistantId ? `assistant:${assistantId}` : eventStableKey(event),
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
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

export function isConfirmedUserMessageEcho(nodes: readonly PiboTraceNode[], event: ChatWebStoredEvent): boolean {
	const payload = event.payload as PiboOutputEvent;
	if (payload.type !== "message_queued" || payload.source !== "user") return false;
	const eventId = typeof payload.eventId === "string" ? payload.eventId : event.eventId;
	const text = typeof payload.text === "string" ? payload.text : undefined;
	return nodes.some((node) => {
		if (node.type !== "user.message" || node.source !== "transcript") return false;
		if (eventId && (node.entryId === eventId || node.stableKey === `entry:${eventId}`)) return true;
		return Boolean(text && traceNodeText(node) === text);
	});
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
): PiboTraceNode | undefined {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	const id = `event:${event.type}:${eventId ?? cryptoSafeId(event)}`;
	const turnParentId = eventId ? messageTurnNodeId(eventId) : undefined;
	const base = {
		id,
		piboSessionId,
		eventId,
		startedAt: createdAt,
		source: "event-log" as const,
		stableKey: eventStableKey(event),
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
		children: [] as PiboTraceNode[],
	};

	switch (event.type) {
		case "message_queued": {
			const notification = parseRunNotificationText(event.text);
			if (event.source === "service" && notification) {
				return createRunNotificationNode({
					id,
					piboSessionId,
					eventId,
					startedAt: createdAt,
					source: "event-log",
					stableKey: eventId ? `run-notification:${eventId}` : id,
					orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
					notification,
				});
			}
			return {
				...base,
				type: "user.message",
				title: "User Message",
				status: "done",
				summary: event.text,
				output: event.text,
			};
		}
		case "message_started":
		case "message_finished":
			if (event.source === "service") return undefined;
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
			const subagentTool = isSubagentToolName(event.toolName);
			const linkedPiboSessionId =
				linkedChildByToolCallId.get(event.toolCallId) ??
				(subagentTool
					? findLikelyTraceChildSession(piboSessionId, event.toolName, event, childByParent)
					: undefined);
			return {
				...base,
				id: `tool:${event.toolCallId}`,
				parentId: turnParentId,
				toolCallId: event.toolCallId,
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
				stableKey: `tool:${event.toolCallId}`,
				children: [],
			};
		}
		case "subagent_session":
			return {
				...base,
				id: event.toolCallId ? `tool:${event.toolCallId}` : id,
				eventId,
				toolCallId: event.toolCallId,
				type: "agent.delegation",
				title: event.toolName,
				status: sessionStatus === "running" ? "running" : "done",
				summary: event.subagentName,
				input: { subagentName: event.subagentName, threadKey: event.threadKey },
				linkedPiboSessionId: event.childPiboSessionId,
				stableKey: event.toolCallId ? `tool:${event.toolCallId}` : `subagent:${event.childPiboSessionId}`,
				children: [],
			};
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
		case "compaction_start":
			return {
				...base,
				id: `event:compaction:${eventSequence ?? streamId ?? cryptoSafeId(event)}`,
				type: "execution.compaction",
				title: "compact",
				status: "running",
				summary: "Compacting",
				input: { reason: event.reason },
				stableKey: "compaction:active",
			};
		case "compaction_end":
			return {
				...base,
				id: `event:compaction:end:${eventSequence ?? streamId ?? cryptoSafeId(event)}`,
				type: "execution.compaction",
				title: "compact",
				status: event.errorMessage ? "error" : "done",
				completedAt: createdAt,
				summary: event.aborted ? "Compaction skipped" : event.errorMessage ? "Compaction failed" : "Compacted",
				input: { reason: event.reason },
				output: event.result,
				error: event.errorMessage,
				stableKey: "compaction:active",
			};
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
): void {
	if (event.text.length === 0) return;

	const assistantId = assistantEventNodeId(event);
	const id = assistantId ? assistantMessageNodeId(assistantId) : `event:assistant_delta:${cryptoSafeId(event)}`;
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
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
		children: [],
	};
	nodes.push(node);
	byId.set(node.id, node);
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
): void {
	if (event.text.length === 0) return;

	const thinkingId = thinkingEventNodeId(event);
	const id = thinkingId ? thinkingNodeId(thinkingId) : `event:thinking_delta:${cryptoSafeId(event)}`;
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
		type: "model.reasoning",
		title: "Thinking",
		status: sessionStatus === "running" ? "running" : "done",
		startedAt: createdAt,
		summary: event.text,
		output: event.text,
		source: "event-log",
		stableKey: thinkingId ? `reasoning:${thinkingId}` : id,
		orderKey: eventTraceNodeOrder(eventSequence, event.type, streamId, streamFrameIndex),
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

function isInternalSessionOperation(action: string): boolean {
	return action === "session.fork" || action === "session.clone" || action === "session.switch";
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

function isStaleToolCallEchoEvent(event: PiboOutputEvent, sessionStatus: PiboWebSessionStatus): boolean {
	return sessionStatus !== "running" && event.type === "tool_call";
}

export type TraceMessageTurnTiming = {
	eventId: string;
	userText?: string;
	startedAt?: string;
	completedAt: string;
	durationMs?: number;
};

export function messageTurnTimingsFromEvents(events: readonly ChatWebStoredEvent[]): TraceMessageTurnTiming[] {
	const timings = new Map<string, { userText?: string; startedAt?: string; completedAt?: string }>();
	const completedEventIds: string[] = [];
	const completedEventIdSet = new Set<string>();
	const ignoredEventIds = new Set<string>();
	for (const storedEvent of events) {
		const event = storedEvent.payload as PiboOutputEvent;
		if (event.type !== "message_started" && event.type !== "message_finished") continue;
		const eventId = typeof event.eventId === "string" ? event.eventId : undefined;
		if (!eventId) continue;
		if (event.type === "message_started" && event.source === "service") {
			ignoredEventIds.add(eventId);
			continue;
		}
		if (ignoredEventIds.has(eventId)) continue;
		const timing = timings.get(eventId) ?? {};
		if (event.type === "message_started") {
			timing.userText ??= event.text;
			timing.startedAt ??= storedEvent.createdAt;
		} else {
			timing.completedAt = storedEvent.createdAt;
			if (!completedEventIdSet.has(eventId)) {
				completedEventIds.push(eventId);
				completedEventIdSet.add(eventId);
			}
		}
		timings.set(eventId, timing);
	}
	return completedEventIds.flatMap((eventId) => {
		const timing = timings.get(eventId);
		if (!timing?.completedAt) return [];
		const startedAtMs = parseTimestamp(timing.startedAt);
		const completedAtMs = parseTimestamp(timing.completedAt);
		return [{
			eventId,
			userText: timing.userText,
			startedAt: timing.startedAt,
			completedAt: timing.completedAt,
			durationMs: startedAtMs === undefined || completedAtMs === undefined
				? undefined
				: Math.max(0, completedAtMs - startedAtMs),
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
): TraceOrderKey {
	if (eventSequence === undefined && (streamId !== undefined || streamFrameIndex !== undefined)) {
		return liveTraceOrder(streamId, streamFrameIndex, eventNodeKind(type));
	}
	return eventTraceOrder(eventSequence, eventNodeKind(type));
}

function eventNodeKind(type: PiboOutputEvent["type"]): PiboTraceNode["type"] {
	switch (type) {
		case "message_queued":
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

function eventStableKey(event: PiboOutputEvent): string {
	const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
	if (
		event.type === "tool_call" ||
		event.type === "tool_execution_started" ||
		event.type === "tool_execution_updated" ||
		event.type === "tool_execution_finished"
	) {
		return `tool:${event.toolCallId}`;
	}
	if (event.type === "subagent_session" && event.toolCallId) return `tool:${event.toolCallId}`;
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
	return `event:${event.type}:${eventId ?? cryptoSafeId(event)}`;
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
	target.summary = update.summary ?? target.summary;
	target.input = update.input ?? target.input;
	target.output = update.output ?? target.output;
	target.error = update.error ?? target.error;
	target.completedAt = update.completedAt ?? target.completedAt;
	target.linkedPiboSessionId = update.linkedPiboSessionId ?? target.linkedPiboSessionId;
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

function cryptoSafeId(value: unknown): string {
	return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value))).slice(0, 48);
}

function base64UrlEncode(bytes: Uint8Array): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	let output = "";
	let index = 0;
	for (; index + 2 < bytes.length; index += 3) {
		const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
		output += alphabet[(value >> 18) & 63] + alphabet[(value >> 12) & 63] + alphabet[(value >> 6) & 63] + alphabet[value & 63];
	}
	if (index < bytes.length) {
		const first = bytes[index];
		const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
		const value = (first << 16) | (second << 8);
		output += alphabet[(value >> 18) & 63] + alphabet[(value >> 12) & 63];
		if (index + 1 < bytes.length) output += alphabet[(value >> 6) & 63];
	}
	return output;
}
