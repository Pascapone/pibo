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
	userAt?: number;
	assistantAt?: number;
	settled: boolean;
	turnId?: string;
	nativeTurnId?: string;
};

type HistoryUserTimingTarget = {
	entryIndex: number;
	entryId?: string;
	turnId?: string;
	nativeTurnId?: string;
	prompt?: string;
	userAt?: number;
	assistantAt?: number;
};

type TimingMatch = {
	timing: TraceMessageTurnTiming;
	timingIndex: number;
	confidence: "identity" | "timestamp";
};

type HistoryTimingAssignments = {
	userAssignments: Map<number, TraceMessageTurnTiming>;
	turnAssignments: Array<TraceMessageTurnTiming | undefined>;
};

type AssistantTurnProjectionState = {
	assistantPartOrdinal: number;
	reasoningPartOrdinal: number;
};

const MAX_CONFIDENT_TIMESTAMP_DISTANCE_MS = 5 * 60 * 1_000;

export function projectHistoryEntries(
	entries: readonly AgentRuntimeHistoryEntry[],
	sessionStatus: PiboWebSessionStatus,
	openHistoryEventIds: ReadonlySet<string>,
	turnTimings: readonly TraceMessageTurnTiming[] = [],
): AgentRuntimeHistoryEntry[] {
	if (sessionStatus !== "running" || openHistoryEventIds.size === 0) return [...entries];
	const { userAssignments } = assignHistoryTimings(entries, turnTimings);
	let lastUserMessageIndex = -1;
	let lastUserEventId: string | undefined;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type !== "message" || entry.role !== "user") continue;
		lastUserMessageIndex = index;
		lastUserEventId = canonicalProductTurnId(entry, userAssignments.get(index));
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
	const { userAssignments, turnAssignments } = assignHistoryTimings(entries, turnTimings);
	const projectionStateByEventId = new Map<string, AssistantTurnProjectionState>();
	let assistantTurnIndex = 0;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type === "message") {
			if (entry.role === "user") {
				nodes.push(createUserMessageNode(piboSessionId, entry, index, userAssignments.get(index)));
			} else if (entry.role === "assistant" || entry.role === "tool") {
				const turn = collectAssistantTurn(entries, index);
				const hasAssistant = turn.entries.some(({ entry: turnEntry }) => turnEntry.role === "assistant");
				const timing = hasAssistant ? turnAssignments[assistantTurnIndex] : undefined;
				const firstAssistant = turn.entries.find(({ entry: turnEntry }) => turnEntry.role === "assistant");
				const eventId = firstAssistant ? canonicalProductTurnId(firstAssistant.entry, timing) : undefined;
				const projectionState = eventId
					? projectionStateByEventId.get(eventId) ?? { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 }
					: { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 };
				nodes.push(...createAssistantTurnNodes(piboSessionId, turn.entries, timing, projectionState));
				if (eventId) projectionStateByEventId.set(eventId, projectionState);
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
	let latestUserAt: number | undefined;
	let latestTurnId: string | undefined;
	let latestNativeTurnId: string | undefined;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type !== "message") continue;
		if (entry.role === "user") {
			latestUserText = normalizedPrompt(historyMessageText(entry));
			latestUserEntryIndex = index;
			latestUserAt = parsedTimestamp(entry.createdAt);
			latestTurnId = entry.turnId;
			latestNativeTurnId = nativeHistoryTurnId(entry);
			continue;
		}
		if (entry.role !== "assistant" && entry.role !== "tool") continue;
		const turn = collectAssistantTurn(entries, index);
		const lastAssistant = [...turn.entries].reverse().find(({ entry: turnEntry }) => turnEntry.role === "assistant");
		if (lastAssistant) {
			targets.push({
				prompt: latestUserText,
				userEntryIndex: latestUserEntryIndex,
				userAt: latestUserAt,
				assistantAt: parsedTimestamp(lastAssistant.entry.createdAt),
				settled: isSettledAssistantEntry(lastAssistant.entry),
				turnId: lastAssistant.entry.turnId ?? latestTurnId,
				nativeTurnId: nativeHistoryTurnId(lastAssistant.entry) ?? latestNativeTurnId,
			});
		}
		index = turn.nextIndex - 1;
	}
	return targets;
}

function assignHistoryTimings(
	entries: readonly AgentRuntimeHistoryEntry[],
	turnTimings: readonly TraceMessageTurnTiming[],
): HistoryTimingAssignments {
	const users: HistoryUserTimingTarget[] = [];
	for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
		const entry = entries[entryIndex]!;
		if (entry.type !== "message" || entry.role !== "user") continue;
		users.push({
			entryIndex,
			entryId: entry.nativeEntryId,
			turnId: entry.turnId,
			nativeTurnId: nativeHistoryTurnId(entry),
			prompt: normalizedPrompt(historyMessageText(entry)),
			userAt: parsedTimestamp(entry.createdAt),
		});
	}
	const historyTurns = collectHistoryTurnTimingTargets(entries);
	for (const historyTurn of historyTurns) {
		if (historyTurn.userEntryIndex === undefined || historyTurn.assistantAt === undefined) continue;
		const user = users.find((candidate) => candidate.entryIndex === historyTurn.userEntryIndex);
		if (user) user.assistantAt ??= historyTurn.assistantAt;
	}

	const matches = users.map((user) => findConfidentTimingMatch(user, turnTimings));
	const invalidUserPositions = invalidHistoryUserMatchPositions(users, matches);
	const userAssignments = new Map<number, TraceMessageTurnTiming>();
	for (let userPosition = 0; userPosition < users.length; userPosition += 1) {
		const match = matches[userPosition];
		if (!match || invalidUserPositions.has(userPosition)) continue;
		userAssignments.set(users[userPosition]!.entryIndex, match.timing);
	}

	const messageTurnTimings = turnTimings.filter((timing) => timing.userMessageType !== "message_steered");
	const timingByEventId = new Map(messageTurnTimings.map((timing) => [timing.eventId, timing]));
	const turnAssignments: Array<TraceMessageTurnTiming | undefined> = historyTurns.map(() => undefined);
	const timingByNativeTurnId = new Map<string, TraceMessageTurnTiming>();
	const conflictedNativeTurnIds = new Set<string>();

	for (const user of users) {
		const userTiming = userAssignments.get(user.entryIndex);
		if (!userTiming || !user.nativeTurnId) continue;
		const outputTiming = outputTimingForUserTiming(userTiming, timingByEventId);
		if (!outputTiming) continue;
		const existing = timingByNativeTurnId.get(user.nativeTurnId);
		if (existing && existing.eventId !== outputTiming.eventId) {
			conflictedNativeTurnIds.add(user.nativeTurnId);
			continue;
		}
		timingByNativeTurnId.set(user.nativeTurnId, outputTiming);
	}
	for (const nativeTurnId of conflictedNativeTurnIds) {
		timingByNativeTurnId.delete(nativeTurnId);
		for (const user of users) {
			if (user.nativeTurnId === nativeTurnId) userAssignments.delete(user.entryIndex);
		}
	}

	for (let turnIndex = 0; turnIndex < historyTurns.length; turnIndex += 1) {
		const historyTurn = historyTurns[turnIndex]!;
		const nativeTurnId = historyTurn.nativeTurnId ?? historyTurn.turnId;
		let timing = nativeTurnId ? timingByNativeTurnId.get(nativeTurnId) : undefined;
		if (!timing && !nativeTurnId && historyTurn.userEntryIndex !== undefined) {
			const userTiming = userAssignments.get(historyTurn.userEntryIndex);
			timing = userTiming ? outputTimingForUserTiming(userTiming, timingByEventId) : undefined;
		}
		if (!timing) continue;
		turnAssignments[turnIndex] = timing;
	}
	return { userAssignments, turnAssignments };
}

function invalidHistoryUserMatchPositions(
	users: readonly HistoryUserTimingTarget[],
	matches: readonly (TimingMatch | undefined)[],
): Set<number> {
	const invalidUserPositions = new Set<number>();
	for (let leftPosition = 0; leftPosition < matches.length; leftPosition += 1) {
		const left = matches[leftPosition];
		if (!left) continue;
		for (let rightPosition = leftPosition + 1; rightPosition < matches.length; rightPosition += 1) {
			const right = matches[rightPosition];
			if (!right || left.timingIndex < right.timingIndex) continue;
			if (left.confidence !== "identity") invalidUserPositions.add(leftPosition);
			if (right.confidence !== "identity") invalidUserPositions.add(rightPosition);
		}
	}

	const ownerPositionsByTimingIndex = new Map<number, number[]>();
	for (let userPosition = 0; userPosition < matches.length; userPosition += 1) {
		const match = matches[userPosition];
		if (!match) continue;
		const positions = ownerPositionsByTimingIndex.get(match.timingIndex) ?? [];
		positions.push(userPosition);
		ownerPositionsByTimingIndex.set(match.timingIndex, positions);
	}
	for (const positions of ownerPositionsByTimingIndex.values()) {
		const nativeOwners = new Set(positions.map((position) =>
			users[position]!.nativeTurnId ?? users[position]!.turnId ?? `entry:${users[position]!.entryIndex}`
		));
		if (nativeOwners.size <= 1) continue;
		for (const position of positions) {
			if (matches[position]?.confidence !== "identity") invalidUserPositions.add(position);
		}
	}
	return invalidUserPositions;
}

function outputTimingForUserTiming(
	userTiming: TraceMessageTurnTiming,
	timingByEventId: ReadonlyMap<string, TraceMessageTurnTiming>,
): TraceMessageTurnTiming | undefined {
	if (userTiming.userMessageType !== "message_steered") return userTiming;
	return userTiming.activeEventId ? timingByEventId.get(userTiming.activeEventId) : undefined;
}

function findConfidentTimingMatch(
	target: Pick<HistoryUserTimingTarget, "entryId" | "turnId" | "prompt" | "userAt" | "assistantAt">,
	turnTimings: readonly TraceMessageTurnTiming[],
): TimingMatch | undefined {
	for (const identity of [target.turnId, target.entryId]) {
		if (!identity) continue;
		const timingIndex = turnTimings.findIndex((timing) => timing.eventId === identity);
		if (timingIndex >= 0) return { timing: turnTimings[timingIndex]!, timingIndex, confidence: "identity" };
	}
	if (!target.prompt) return undefined;
	const candidates = turnTimings.flatMap((timing, timingIndex) =>
		normalizedPrompt(timing.userText) === target.prompt ? [{ timing, timingIndex }] : []
	);
	if (!candidates.length) return undefined;

	const timestampEvidence = candidates.flatMap((candidate) => {
		const startedAt = parsedTimestamp(candidate.timing.startedAt);
		const completedAt = parsedTimestamp(candidate.timing.completedAt);
		const startDistance = startedAt === undefined || target.userAt === undefined
			? undefined
			: Math.abs(startedAt - target.userAt);
		const completionDistance = completedAt === undefined || target.assistantAt === undefined
			? undefined
			: Math.abs(completedAt - target.assistantAt);
		return [
			...(startDistance !== undefined && startDistance <= MAX_CONFIDENT_TIMESTAMP_DISTANCE_MS
				? [{ ...candidate, endpoint: "start" as const, distance: startDistance }]
				: []),
			...(completionDistance !== undefined && completionDistance <= MAX_CONFIDENT_TIMESTAMP_DISTANCE_MS
				? [{ ...candidate, endpoint: "completion" as const, distance: completionDistance }]
				: []),
		];
	}).sort((left, right) => left.distance - right.distance || left.timingIndex - right.timingIndex);
	const best = timestampEvidence[0];
	if (!best) return undefined;
	const bestTimingIndices = new Set(timestampEvidence
		.filter((evidence) => evidence.distance === best.distance)
		.map((evidence) => evidence.timingIndex));
	return bestTimingIndices.size === 1
		? { timing: best.timing, timingIndex: best.timingIndex, confidence: "timestamp" }
		: undefined;
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
	const eventId = canonicalProductTurnId(entry, timing);
	const eventIdentity = eventId ? `event:${userMessageType}:${eventId}` : undefined;
	return {
		id: eventIdentity ?? historyEntryNodeId(entry),
		entryId: entry.nativeEntryId,
		nativeTurnId: nativeHistoryTurnId(entry),
		piboSessionId,
		eventId,
		parentId: timing?.userMessageType === "message_steered" && timing.activeEventId
			? messageTurnNodeId(timing.activeEventId)
			: undefined,
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
	projectionState: AssistantTurnProjectionState = { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 },
): PiboTraceNode[] {
	const firstAssistant = entries.find(({ entry }) => entry.role === "assistant");
	if (!firstAssistant) return [];
	const eventId = canonicalProductTurnId(firstAssistant.entry, timing);
	const orderedNodes: PiboTraceNode[] = [];
	const toolsByCallId = new Map<string, PiboTraceNode>();

	for (const { entry, index: entryIndex } of entries) {
		if (entry.role === "tool") {
			mergePersistedToolResult(toolsByCallId, orderedNodes, entry, piboSessionId, entryIndex, eventId);
			continue;
		}
		const responseStatus = historyMessageStatus(entry);
		let responseNode: PiboTraceNode | undefined;
		const parts = historyMessageParts(entry);
		for (const [contentPartIndex, part] of parts.entries()) {
			if (part.type === "reasoning" && hasVisibleText(part.text)) {
				const thinkingIndex = timing?.reasoningIndices?.[projectionState.reasoningPartOrdinal]
					?? projectionState.reasoningPartOrdinal;
				orderedNodes.push(createReasoningNode({
					piboSessionId,
					entry,
					entryIndex,
					contentPartIndex,
					thinkingIndex,
					eventId,
					thinking: part.text,
				}));
				projectionState.reasoningPartOrdinal += 1;
			} else if (part.type === "text" && part.text !== "") {
				if (!responseNode) {
					const assistantIndex = timing?.assistantIndices?.[projectionState.assistantPartOrdinal]
						?? entry.assistantIndex
						?? projectionState.assistantPartOrdinal;
					responseNode = createAssistantMessageNode({
						piboSessionId,
						entry,
						entryIndex,
						contentPartIndex,
						assistantIndex,
						eventId,
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
				const toolNode = createToolCallNode(piboSessionId, entry, entryIndex, contentPartIndex, part, eventId);
				orderedNodes.push(toolNode);
				toolsByCallId.set(part.toolCallId, toolNode);
			}
		}
		if (responseNode) {
			responseNode.status = responseStatus;
			responseNode.error = entry.error;
			projectionState.assistantPartOrdinal += 1;
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
		nativeTurnId: nativeHistoryTurnId(input.entry),
		piboSessionId: input.piboSessionId,
		eventId: input.eventId,
		parentId: historyTurnParentId(input.entry, input.eventId),
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
	eventId?: string,
): PiboTraceNode {
	const source = traceSource(entry.source);
	return {
		id: `tool:${part.toolCallId}`,
		entryId: entry.nativeEntryId,
		nativeTurnId: nativeHistoryTurnId(entry),
		piboSessionId,
		eventId,
		parentId: historyTurnParentId(entry, eventId),
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
	eventId?: string,
): void {
	const toolCallId = entry.toolCallId;
	if (!toolCallId) return;
	let toolNode = toolsByCallId.get(toolCallId);
	if (!toolNode) {
		toolNode = createMissingToolResultNode(piboSessionId, entry, entryIndex, toolCallId, eventId);
		childNodes.push(toolNode);
		toolsByCallId.set(toolCallId, toolNode);
	}
	toolNode.eventId ??= eventId;
	toolNode.nativeTurnId ??= nativeHistoryTurnId(entry);
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
	eventId?: string,
): PiboTraceNode {
	const source = traceSource(entry.source);
	return {
		id: `tool:${toolCallId}`,
		entryId: entry.nativeEntryId,
		nativeTurnId: nativeHistoryTurnId(entry),
		piboSessionId,
		eventId,
		parentId: historyTurnParentId(entry, eventId),
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
		nativeTurnId: nativeHistoryTurnId(input.entry),
		piboSessionId: input.piboSessionId,
		eventId: input.eventId,
		parentId: historyTurnParentId(input.entry, input.eventId),
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

function canonicalProductTurnId(
	entry: AgentRuntimeHistoryMessageEntry,
	timing: TraceMessageTurnTiming | undefined,
): string | undefined {
	return timing?.eventId ?? entry.turnId;
}

function nativeHistoryTurnId(entry: AgentRuntimeHistoryMessageEntry): string | undefined {
	return entry.nativeTurnId ?? (entry.source === "native" ? entry.turnId : undefined);
}

function historyTurnParentId(entry: AgentRuntimeHistoryMessageEntry, eventId: string | undefined): string | undefined {
	return entry.source === "product" && eventId ? messageTurnNodeId(eventId) : undefined;
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
