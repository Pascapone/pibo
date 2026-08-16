import type {
	AgentRuntimeHistoryContentPart,
	AgentRuntimeHistoryEntry,
	AgentRuntimeHistoryMessageEntry,
} from "../agent-runtime/history.js";
import { historyTraceOrder } from "./trace-order.js";
import { attachAsyncAgentRunNode, reconcileAsyncAgentRunStatuses } from "./trace-async-agent-runs.js";
import { sortTraceNodes } from "./trace-nodes.js";
import { createRunNotificationNode, parseRunNotificationText } from "./trace-run-notifications.js";
import { isSubagentToolName } from "./trace-subagent-links.js";
import { assistantMessageNodeId, messageTurnNodeId, thinkingNodeId, type TraceMessageTurnTiming } from "./trace-event-projection.js";
import type { PiboTraceNode, PiboTraceNodeStatus, PiboTraceSource, PiboWebSessionStatus } from "./trace-types.js";

type IndexedHistoryMessageEntry = {
	entry: AgentRuntimeHistoryMessageEntry;
	index: number;
};

type TranscriptTurnTimingTarget = {
	prompt?: string;
	userEntryIndex?: number;
	assistantAt?: number;
	settled: boolean;
	turnId?: string;
};

export function projectHistoryEntries(
	entries: readonly AgentRuntimeHistoryEntry[],
	sessionStatus: PiboWebSessionStatus,
	openHistoryEventIds: ReadonlySet<string>,
	turnTimings: readonly TraceMessageTurnTiming[] = [],
): AgentRuntimeHistoryEntry[] {
	if (sessionStatus !== "running" || openHistoryEventIds.size === 0) return [...entries];
	const userTimingAssignments = assignHistoryUserTimings(entries, turnTimings);
	let lastUserMessageIndex = -1;
	let lastUserEventId: string | undefined;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type !== "message" || entry.role !== "user") continue;
		lastUserMessageIndex = index;
		lastUserEventId = entry.turnId && openHistoryEventIds.has(entry.turnId)
			? entry.turnId
			: userTimingAssignments.get(index)?.eventId;
	}
	return lastUserMessageIndex !== -1 && lastUserEventId && openHistoryEventIds.has(lastUserEventId)
		? entries.slice(0, lastUserMessageIndex)
		: [...entries];
}

export function traceNodesFromHistoryEntries(
	piboSessionId: string,
	entries: readonly AgentRuntimeHistoryEntry[],
	turnTimings: readonly TraceMessageTurnTiming[] = [],
): PiboTraceNode[] {
	const nodes: PiboTraceNode[] = [];
	const turnTimingAssignments = assignHistoryTurnTimings(entries, turnTimings);
	const userTimingAssignments = assignHistoryUserTimings(entries, turnTimings);
	let assistantTurnIndex = 0;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type === "message") {
			if (entry.role === "user") {
				nodes.push(createUserMessageNode(piboSessionId, entry, index, userTimingAssignments.get(index)));
			} else if (entry.role === "assistant" || entry.role === "tool") {
				const turn = collectAssistantTurn(entries, index);
				const hasAssistant = turn.entries.some(({ entry: turnEntry }) => turnEntry.role === "assistant");
				const timing = hasAssistant ? turnTimingAssignments[assistantTurnIndex] : undefined;
				nodes.push(...createAssistantTurnNodes(piboSessionId, turn.entries, timing));
				if (hasAssistant) assistantTurnIndex += 1;
				index = turn.nextIndex - 1;
			}
		} else if (entry.type === "session_info" && entry.name) {
			const source = traceSource(entry.source);
			const entryIndex = historyIndex(entry, index);
			nodes.push({
				id: historyEntryNodeId(entry),
				entryId: entry.nativeEntryId,
				piboSessionId,
				type: "execution.command",
				title: "Session Info",
				status: "done",
				startedAt: entry.createdAt,
				output: { name: entry.name },
				source,
				stableKey: historyEntryStableKey(entry),
				orderKey: historyTraceOrder(entryIndex, 0, "execution.command", source),
				children: [],
			});
		}
	}
	reconcileAsyncAgentRunStatuses(nodes);
	sortTraceNodes(nodes);
	return nodes;
}

function collectHistoryTurnTimingTargets(entries: readonly AgentRuntimeHistoryEntry[]): TranscriptTurnTimingTarget[] {
	const targets: TranscriptTurnTimingTarget[] = [];
	let latestUserText: string | undefined;
	let latestUserEntryIndex: number | undefined;
	let latestTurnId: string | undefined;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type !== "message") continue;
		if (entry.role === "user") {
			latestUserText = normalizedPrompt(historyMessageText(entry));
			latestUserEntryIndex = index;
			latestTurnId = entry.turnId;
			continue;
		}
		if (entry.role !== "assistant" && entry.role !== "tool") continue;
		const turn = collectAssistantTurn(entries, index);
		const lastAssistant = [...turn.entries].reverse().find(({ entry: turnEntry }) => turnEntry.role === "assistant");
		if (lastAssistant) {
			targets.push({
				prompt: latestUserText,
				userEntryIndex: latestUserEntryIndex,
				assistantAt: parsedTimestamp(lastAssistant.entry.createdAt),
				settled: isSettledAssistantEntry(lastAssistant.entry),
				turnId: lastAssistant.entry.turnId ?? latestTurnId,
			});
		}
		index = turn.nextIndex - 1;
	}
	return targets;
}

function assignHistoryTurnTimings(
	entries: readonly AgentRuntimeHistoryEntry[],
	turnTimings: readonly TraceMessageTurnTiming[],
): Array<TraceMessageTurnTiming | undefined> {
	const messageTurnTimings = turnTimings.filter((timing) => timing.userMessageType !== "message_steered");
	const timingByEventId = new Map(messageTurnTimings.map((timing) => [timing.eventId, timing]));
	const historyTurns = collectHistoryTurnTimingTargets(entries);
	const assignments: Array<TraceMessageTurnTiming | undefined> = historyTurns.map((turn) => turn.turnId ? timingByEventId.get(turn.turnId) : undefined);
	let timingCursor = messageTurnTimings.length - 1;
	for (let turnIndex = historyTurns.length - 1; turnIndex >= 0; turnIndex -= 1) {
		if (assignments[turnIndex]) {
			const assignedIndex = messageTurnTimings.indexOf(assignments[turnIndex]!);
			if (assignedIndex >= 0) timingCursor = Math.min(timingCursor, assignedIndex - 1);
			continue;
		}
		const historyTurn = historyTurns[turnIndex];
		if (!historyTurn?.prompt) continue;
		let matchedIndex: number | undefined;
		let matchedDistance = Number.POSITIVE_INFINITY;
		for (let timingIndex = timingCursor; timingIndex >= 0; timingIndex -= 1) {
			const timing = messageTurnTimings[timingIndex];
			if (normalizedPrompt(timing?.userText) !== historyTurn.prompt) continue;
			const completedAt = parsedTimestamp(timing?.completedAt);
			const distance = completedAt === undefined || historyTurn.assistantAt === undefined
				? Number.POSITIVE_INFINITY
				: Math.abs(completedAt - historyTurn.assistantAt);
			if (matchedIndex === undefined || distance < matchedDistance) {
				matchedIndex = timingIndex;
				matchedDistance = distance;
			}
		}
		if (matchedIndex === undefined) continue;
		assignments[turnIndex] = messageTurnTimings[matchedIndex];
		timingCursor = matchedIndex - 1;
	}
	return assignments;
}

function assignHistoryUserTimings(
	entries: readonly AgentRuntimeHistoryEntry[],
	turnTimings: readonly TraceMessageTurnTiming[],
): Map<number, TraceMessageTurnTiming> {
	const users: Array<{ entryIndex: number; entryId?: string; turnId?: string; prompt?: string }> = [];
	const userPositionByEntryIndex = new Map<number, number>();
	for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
		const entry = entries[entryIndex]!;
		if (entry.type !== "message" || entry.role !== "user") continue;
		userPositionByEntryIndex.set(entryIndex, users.length);
		users.push({
			entryIndex,
			entryId: entry.nativeEntryId,
			turnId: entry.turnId,
			prompt: normalizedPrompt(historyMessageText(entry)),
		});
	}
	if (!users.length || !turnTimings.length) return new Map();

	const timingIndexByEventId = new Map(turnTimings.map((timing, timingIndex) => [timing.eventId, timingIndex]));
	const anchorByUserPosition = new Map<number, number>();
	const assignedTimingIndexes = new Set<number>();
	for (let userPosition = 0; userPosition < users.length; userPosition += 1) {
		const user = users[userPosition]!;
		const timingIndex = timingIndexByEventId.get(user.turnId ?? user.entryId ?? "");
		if (timingIndex === undefined || assignedTimingIndexes.has(timingIndex)) continue;
		anchorByUserPosition.set(userPosition, timingIndex);
		assignedTimingIndexes.add(timingIndex);
	}

	const historyTurns = collectHistoryTurnTimingTargets(entries);
	let timingUpperBound = turnTimings.length - 1;
	for (let turnIndex = historyTurns.length - 1; turnIndex >= 0; turnIndex -= 1) {
		const historyTurn = historyTurns[turnIndex];
		const userPosition = historyTurn?.userEntryIndex === undefined
			? undefined
			: userPositionByEntryIndex.get(historyTurn.userEntryIndex);
		if (!historyTurn?.prompt || userPosition === undefined) continue;
		const exactAnchor = anchorByUserPosition.get(userPosition);
		if (exactAnchor !== undefined) {
			timingUpperBound = Math.min(timingUpperBound, exactAnchor - 1);
			continue;
		}

		let steeringTimingIndex: number | undefined;
		for (let timingIndex = timingUpperBound; timingIndex >= 0; timingIndex -= 1) {
			const timing = turnTimings[timingIndex]!;
			if (assignedTimingIndexes.has(timingIndex) || timing.userMessageType !== "message_steered") continue;
			if (normalizedPrompt(timing.userText) !== historyTurn.prompt) continue;
			steeringTimingIndex = timingIndex;
			break;
		}
		if (steeringTimingIndex !== undefined) {
			anchorByUserPosition.set(userPosition, steeringTimingIndex);
			assignedTimingIndexes.add(steeringTimingIndex);
			timingUpperBound = steeringTimingIndex - 1;
			continue;
		}
		if (!historyTurn.settled) continue;

		let matchedTimingIndex: number | undefined;
		let matchedDistance = Number.POSITIVE_INFINITY;
		for (let timingIndex = timingUpperBound; timingIndex >= 0; timingIndex -= 1) {
			const timing = turnTimings[timingIndex]!;
			if (assignedTimingIndexes.has(timingIndex) || timing.userMessageType === "message_steered" || !timing.completedAt) continue;
			if (normalizedPrompt(timing.userText) !== historyTurn.prompt) continue;
			const completedAt = parsedTimestamp(timing.completedAt);
			const distance = completedAt === undefined || historyTurn.assistantAt === undefined
				? Number.POSITIVE_INFINITY
				: Math.abs(completedAt - historyTurn.assistantAt);
			if (matchedTimingIndex === undefined || distance < matchedDistance) {
				matchedTimingIndex = timingIndex;
				matchedDistance = distance;
			}
		}
		if (matchedTimingIndex === undefined) continue;
		anchorByUserPosition.set(userPosition, matchedTimingIndex);
		assignedTimingIndexes.add(matchedTimingIndex);
		timingUpperBound = matchedTimingIndex - 1;
	}

	const assignments = new Map<number, TraceMessageTurnTiming>();
	const anchors = [...anchorByUserPosition.entries()]
		.map(([userPosition, timingIndex]) => ({ userPosition, timingIndex }))
		.sort((left, right) => left.userPosition - right.userPosition);
	for (const anchor of anchors) assignments.set(users[anchor.userPosition]!.entryIndex, turnTimings[anchor.timingIndex]!);

	const boundaries = [
		{ userPosition: -1, timingIndex: -1 },
		...anchors,
		{ userPosition: users.length, timingIndex: turnTimings.length },
	];
	for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
		const previous = boundaries[boundaryIndex]!;
		const next = boundaries[boundaryIndex + 1]!;
		let timingCursor = next.timingIndex - 1;
		for (let userPosition = next.userPosition - 1; userPosition > previous.userPosition; userPosition -= 1) {
			const user = users[userPosition]!;
			if (assignments.has(user.entryIndex) || !user.prompt) continue;
			for (let timingIndex = timingCursor; timingIndex > previous.timingIndex; timingIndex -= 1) {
				if (assignedTimingIndexes.has(timingIndex)) continue;
				const timing = turnTimings[timingIndex]!;
				if (normalizedPrompt(timing.userText) !== user.prompt) continue;
				assignments.set(user.entryIndex, timing);
				assignedTimingIndexes.add(timingIndex);
				timingCursor = timingIndex - 1;
				break;
			}
		}
	}
	return assignments;
}

function collectAssistantTurn(
	entries: readonly AgentRuntimeHistoryEntry[],
	startIndex: number,
): { entries: IndexedHistoryMessageEntry[]; nextIndex: number } {
	const turnEntries: IndexedHistoryMessageEntry[] = [];
	let index = startIndex;
	while (index < entries.length) {
		const entry = entries[index]!;
		if (entry.type !== "message") break;
		if (entry.role !== "assistant" && entry.role !== "tool") break;
		turnEntries.push({ entry, index });
		index += 1;
	}
	return { entries: turnEntries, nextIndex: index };
}

function createUserMessageNode(
	piboSessionId: string,
	entry: AgentRuntimeHistoryMessageEntry,
	entryIndex: number,
	timing?: TraceMessageTurnTiming,
): PiboTraceNode {
	const text = historyMessageText(entry);
	const notification = parseRunNotificationText(text);
	const source = traceSource(entry.source);
	const orderIndex = historyIndex(entry, entryIndex);
	if (notification) {
		return createRunNotificationNode({
			id: historyEntryNodeId(entry),
			entryId: entry.nativeEntryId,
			piboSessionId,
			startedAt: entry.createdAt,
			orderKey: historyTraceOrder(orderIndex, 0, "yielded.run", source),
			source,
			stableKey: historyEntryStableKey(entry),
			notification,
		});
	}
	const userMessageType = timing?.userMessageType ?? "message_queued";
	const eventId = entry.turnId ?? timing?.eventId;
	const eventIdentity = eventId ? `event:${userMessageType}:${eventId}` : undefined;
	return {
		id: eventIdentity ?? historyEntryNodeId(entry),
		entryId: entry.nativeEntryId,
		piboSessionId,
		eventId,
		type: "user.message",
		title: "User Message",
		status: entry.status === "running" ? "running" : entry.status === "error" ? "error" : "done",
		startedAt: entry.createdAt,
		summary: text,
		output: text,
		error: entry.error,
		source,
		stableKey: eventIdentity ?? historyEntryStableKey(entry),
		orderKey: historyTraceOrder(orderIndex, 0, "user.message", source),
		children: [],
	};
}

function createAssistantTurnNodes(
	piboSessionId: string,
	entries: IndexedHistoryMessageEntry[],
	timing?: TraceMessageTurnTiming,
): PiboTraceNode[] {
	const firstAssistant = entries.find(({ entry }) => entry.role === "assistant");
	if (!firstAssistant) return [];
	const orderedNodes: PiboTraceNode[] = [];
	const toolsByCallId = new Map<string, PiboTraceNode>();
	let assistantPartOrdinal = 0;
	let reasoningPartOrdinal = 0;

	for (const { entry, index: entryIndex } of entries) {
		if (entry.role === "tool") {
			mergePersistedToolResult(toolsByCallId, orderedNodes, entry, piboSessionId, entryIndex);
			continue;
		}
		const responseStatus = historyMessageStatus(entry);
		let responseNode: PiboTraceNode | undefined;
		const parts = historyMessageParts(entry);
		for (const [contentPartIndex, part] of parts.entries()) {
			if (part.type === "reasoning" && hasVisibleText(part.text)) {
				const thinkingIndex = timing?.reasoningIndices?.[reasoningPartOrdinal] ?? reasoningPartOrdinal;
				orderedNodes.push(createReasoningNode({
					piboSessionId,
					entry,
					entryIndex,
					contentPartIndex,
					thinkingIndex,
					eventId: entry.turnId ?? timing?.eventId,
					thinking: part.text,
				}));
				reasoningPartOrdinal += 1;
			} else if (part.type === "text" && part.text !== "") {
				if (!responseNode) {
					const assistantIndex = entry.assistantIndex ?? timing?.assistantIndices?.[assistantPartOrdinal] ?? assistantPartOrdinal;
					responseNode = createAssistantMessageNode({
						piboSessionId,
						entry,
						entryIndex,
						contentPartIndex,
						assistantIndex,
						eventId: entry.turnId ?? timing?.eventId,
						status: responseStatus,
						text: part.text,
						error: entry.error,
						children: [],
						startedAt: entry.createdAt,
					});
					orderedNodes.push(responseNode);
				} else {
					responseNode.summary = `${typeof responseNode.summary === "string" ? responseNode.summary : ""}${part.text}`;
					responseNode.output = `${typeof responseNode.output === "string" ? responseNode.output : ""}${part.text}`;
				}
			} else if (part.type === "tool_call") {
				const toolNode = createToolCallNode(piboSessionId, entry, entryIndex, contentPartIndex, part);
				orderedNodes.push(toolNode);
				toolsByCallId.set(part.toolCallId, toolNode);
			}
		}
		if (responseNode) {
			responseNode.status = responseStatus;
			responseNode.error = entry.error;
			assistantPartOrdinal += 1;
		}
	}
	const finalNode = orderedNodes.at(-1);
	if (finalNode?.type === "assistant.message" && finalNode.status === "done") {
		finalNode.completedAt = timing?.completedAt ?? finalNode.startedAt;
		finalNode.durationMs = timing?.durationMs;
	}
	return orderedNodes;
}

function createReasoningNode(input: {
	piboSessionId: string;
	entry: AgentRuntimeHistoryMessageEntry;
	entryIndex: number;
	contentPartIndex: number;
	thinkingIndex: number;
	eventId?: string;
	thinking: string;
}): PiboTraceNode {
	const eventIdentity = input.eventId ? `${input.eventId}:thinking:${input.thinkingIndex}` : undefined;
	const source = traceSource(input.entry.source);
	return {
		id: eventIdentity ? thinkingNodeId(eventIdentity) : `${historyEntryNodeId(input.entry)}:thinking:${input.contentPartIndex}`,
		entryId: input.entry.nativeEntryId,
		piboSessionId: input.piboSessionId,
		eventId: input.eventId,
		parentId: input.entry.source === "product" && input.eventId ? messageTurnNodeId(input.eventId) : undefined,
		type: "model.reasoning",
		title: "Thinking",
		status: "done",
		startedAt: input.entry.createdAt,
		summary: input.thinking,
		output: input.thinking,
		source,
		stableKey: eventIdentity ? `reasoning:${eventIdentity}` : `${historyEntryStableKey(input.entry)}:thinking:${input.contentPartIndex}`,
		orderKey: historyTraceOrder(historyIndex(input.entry, input.entryIndex), input.contentPartIndex, "model.reasoning", source),
		children: [],
	};
}

function createToolCallNode(
	piboSessionId: string,
	entry: AgentRuntimeHistoryMessageEntry,
	entryIndex: number,
	contentPartIndex: number,
	part: Extract<AgentRuntimeHistoryContentPart, { type: "tool_call" }>,
): PiboTraceNode {
	const source = traceSource(entry.source);
	return {
		id: `tool:${part.toolCallId}`,
		entryId: entry.nativeEntryId,
		piboSessionId,
		eventId: entry.turnId,
		parentId: entry.source === "product" && entry.turnId ? messageTurnNodeId(entry.turnId) : undefined,
		toolCallId: part.toolCallId,
		type: isSubagentToolName(part.toolName) ? "agent.delegation" : "tool.call",
		title: part.toolName,
		status: "done",
		startedAt: entry.createdAt,
		input: part.input ?? {},
		source,
		stableKey: `tool:${part.toolCallId}`,
		orderKey: historyTraceOrder(
			historyIndex(entry, entryIndex),
			contentPartIndex,
			isSubagentToolName(part.toolName) ? "agent.delegation" : "tool.call",
			source,
		),
		children: [],
	};
}

function mergePersistedToolResult(
	toolsByCallId: Map<string, PiboTraceNode>,
	childNodes: PiboTraceNode[],
	entry: AgentRuntimeHistoryMessageEntry,
	piboSessionId: string,
	entryIndex: number,
): void {
	const toolCallId = entry.toolCallId;
	if (!toolCallId) return;
	let toolNode = toolsByCallId.get(toolCallId);
	if (!toolNode) {
		toolNode = createMissingToolResultNode(piboSessionId, entry, entryIndex, toolCallId);
		childNodes.push(toolNode);
		toolsByCallId.set(toolCallId, toolNode);
	}
	toolNode.status = entry.isError === true || entry.status === "error" ? "error" : "done";
	toolNode.completedAt = entry.createdAt;
	toolNode.output = entry.result ?? { content: entry.content };
	toolNode.error = toolNode.status === "error" ? stringifyPreview(toolNode.output) : undefined;
	attachAsyncAgentRunNode(toolNode, piboSessionId, entry.createdAt);
}

function createMissingToolResultNode(
	piboSessionId: string,
	entry: AgentRuntimeHistoryMessageEntry,
	entryIndex: number,
	toolCallId: string,
): PiboTraceNode {
	const source = traceSource(entry.source);
	return {
		id: `tool:${toolCallId}`,
		entryId: entry.nativeEntryId,
		piboSessionId,
		eventId: entry.turnId,
		toolCallId,
		type: "tool.result",
		title: entry.toolName ?? "Tool Result",
		status: "done",
		startedAt: entry.createdAt,
		source,
		stableKey: `tool:${toolCallId}`,
		orderKey: historyTraceOrder(historyIndex(entry, entryIndex), 0, "tool.result", source),
		children: [],
	};
}

function createAssistantMessageNode(input: {
	piboSessionId: string;
	entry: AgentRuntimeHistoryMessageEntry;
	entryIndex: number;
	contentPartIndex: number;
	assistantIndex: number;
	eventId?: string;
	status: PiboTraceNodeStatus;
	text: string;
	error?: string;
	children?: PiboTraceNode[];
	startedAt?: string;
	completedAt?: string;
}): PiboTraceNode {
	const eventIdentity = input.eventId ? `${input.eventId}:assistant:${input.assistantIndex}` : undefined;
	const source = traceSource(input.entry.source);
	return {
		id: eventIdentity ? assistantMessageNodeId(eventIdentity) : `${historyEntryNodeId(input.entry)}:response`,
		entryId: input.entry.nativeEntryId,
		piboSessionId: input.piboSessionId,
		eventId: input.eventId,
		parentId: input.entry.source === "product" && input.eventId ? messageTurnNodeId(input.eventId) : undefined,
		type: "assistant.message",
		title: "Agent Message",
		status: input.status,
		startedAt: input.startedAt ?? input.entry.createdAt,
		completedAt: input.completedAt,
		summary: input.text,
		output: input.text,
		error: input.error,
		source,
		stableKey: eventIdentity ? `assistant:${eventIdentity}` : `${historyEntryStableKey(input.entry)}:response:${input.contentPartIndex}`,
		orderKey: historyTraceOrder(historyIndex(input.entry, input.entryIndex), input.contentPartIndex, "assistant.message", source),
		children: input.children ?? [],
	};
}

function historyMessageParts(entry: AgentRuntimeHistoryMessageEntry): AgentRuntimeHistoryContentPart[] {
	return typeof entry.content === "string" ? [{ type: "text", text: entry.content }] : [...entry.content];
}

function historyMessageText(entry: AgentRuntimeHistoryMessageEntry): string {
	if (typeof entry.content === "string") return entry.content;
	return entry.content.map((part) => part.type === "text" ? part.text : "").join("");
}

function historyMessageStatus(entry: AgentRuntimeHistoryMessageEntry): PiboTraceNodeStatus {
	if (entry.status === "error" || entry.error) return "error";
	if (entry.status === "running") return "running";
	return "done";
}

function isSettledAssistantEntry(entry: AgentRuntimeHistoryMessageEntry): boolean {
	return entry.status !== "running" && entry.metadata?.stopReason !== "toolUse" && entry.metadata?.stopReason !== "tool_use";
}

function historyEntryNodeId(entry: AgentRuntimeHistoryEntry): string {
	return entry.source === "native" && entry.nativeEntryId ? `entry:${entry.nativeEntryId}` : `history:${entry.id}`;
}

function historyEntryStableKey(entry: AgentRuntimeHistoryEntry): string {
	return historyEntryNodeId(entry);
}

function historyIndex(entry: AgentRuntimeHistoryEntry, fallback: number): number {
	return entry.sequence ?? fallback;
}

function traceSource(source: AgentRuntimeHistoryEntry["source"]): Extract<PiboTraceSource, "transcript" | "product-history"> {
	return source === "native" ? "transcript" : "product-history";
}

function normalizedPrompt(value: string | undefined): string | undefined {
	const normalized = value?.replace(/\s+/g, " ").trim();
	return normalized || undefined;
}

function parsedTimestamp(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const timestamp = new Date(value).getTime();
	return Number.isFinite(timestamp) ? timestamp : undefined;
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
