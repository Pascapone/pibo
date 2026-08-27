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
	providerNativeTurnId?: string;
};

type HistoryUserTimingTarget = {
	entryIndex: number;
	entryId?: string;
	turnId?: string;
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
	userFallbackEventIds: Map<number, string>;
	turnFallbackEventIds: Map<number, string>;
};

type HistoryTurnGroup = {
	index: number;
	userPosition: number;
	userEntryIndex: number;
	assistantTurnIndexes: number[];
	providerNativeTurnIds: Set<string>;
	fallbackEventId: string;
};

type AssistantTurnProjectionState = {
	assistantPartOrdinal: number;
	reasoningPartOrdinal: number;
};

const MAX_CONFIDENT_TIMESTAMP_DISTANCE_MS = 5 * 60 * 1_000;
const PERSISTED_TIMESTAMP_PATTERN =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

export function projectHistoryEntries(
	entries: readonly AgentRuntimeHistoryEntry[],
	sessionStatus: PiboWebSessionStatus,
	openHistoryEventIds: ReadonlySet<string>,
	turnTimings: readonly TraceMessageTurnTiming[] = [],
): AgentRuntimeHistoryEntry[] {
	if (sessionStatus !== "running" || openHistoryEventIds.size === 0) return [...entries];
	const { userAssignments, userFallbackEventIds } = assignHistoryTimings(entries, turnTimings);
	let lastUserMessageIndex = -1;
	let lastUserEventId: string | undefined;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type !== "message" || entry.role !== "user") continue;
		lastUserMessageIndex = index;
		lastUserEventId = canonicalProductTurnId(entry, userAssignments.get(index), userFallbackEventIds.get(index));
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
	const { userAssignments, turnAssignments, userFallbackEventIds, turnFallbackEventIds } =
		assignHistoryTimings(entries, turnTimings);
	const projectionStateByEventId = new Map<string, AssistantTurnProjectionState>();
	let assistantTurnIndex = 0;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type === "message") {
			if (entry.role === "user") {
				nodes.push(createUserMessageNode(
					piboSessionId,
					entry,
					index,
					userAssignments.get(index),
					userFallbackEventIds.get(index),
				));
			} else if (entry.role === "assistant" || entry.role === "tool") {
				const turn = collectAssistantTurn(entries, index);
				const hasAssistant = turn.entries.some(({ entry: turnEntry }) => turnEntry.role === "assistant");
				const timing = hasAssistant ? turnAssignments[assistantTurnIndex] : undefined;
				const fallbackEventId = hasAssistant ? turnFallbackEventIds.get(assistantTurnIndex) : undefined;
				const firstAssistant = turn.entries.find(({ entry: turnEntry }) => turnEntry.role === "assistant");
				const eventId = firstAssistant
					? canonicalProductTurnId(firstAssistant.entry, timing, fallbackEventId)
					: undefined;
				const projectionState = eventId
					? projectionStateByEventId.get(eventId) ?? { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 }
					: { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 };
				nodes.push(...createAssistantTurnNodes(
					piboSessionId,
					turn.entries,
					timing,
					projectionState,
					fallbackEventId,
				));
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
	let latestProviderNativeTurnId: string | undefined;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type !== "message") continue;
		if (entry.role === "user") {
			latestUserText = normalizedPrompt(historyMessageText(entry));
			latestUserEntryIndex = index;
			latestUserAt = parsedTimestamp(entry.createdAt);
			latestProviderNativeTurnId = entry.nativeTurnId;
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
				providerNativeTurnId: lastAssistant.entry.nativeTurnId ?? latestProviderNativeTurnId,
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
			prompt: normalizedPrompt(historyMessageText(entry)),
			userAt: parsedTimestamp(entry.createdAt),
		});
	}
	const historyTurns = collectHistoryTurnTimingTargets(entries);
	const groups = collectHistoryTurnGroups(entries, users, historyTurns);
	for (const historyTurn of historyTurns) {
		if (historyTurn.userEntryIndex === undefined || historyTurn.assistantAt === undefined) continue;
		const user = users.find((candidate) => candidate.entryIndex === historyTurn.userEntryIndex);
		if (user) user.assistantAt ??= historyTurn.assistantAt;
	}

	const matches = users.map((user) => findConfidentTimingMatch(user, turnTimings));
	const invalidUserPositions = invalidHistoryUserMatchPositions(matches);
	const messageTurnTimings = turnTimings.filter((timing) => timing.userMessageType !== "message_steered");
	const timingByEventId = new Map(messageTurnTimings.map((timing) => [timing.eventId, timing]));
	const conflictingGroupIndexes = conflictingHistoryGroupIndexes(groups, matches, timingByEventId);
	const userAssignments = new Map<number, TraceMessageTurnTiming>();
	const turnAssignments: Array<TraceMessageTurnTiming | undefined> = historyTurns.map(() => undefined);
	const userFallbackEventIds = new Map<number, string>();
	const turnFallbackEventIds = new Map<number, string>();
	for (const group of groups) {
		const match = matches[group.userPosition];
		if (conflictingGroupIndexes.has(group.index)) {
			userFallbackEventIds.set(group.userEntryIndex, group.fallbackEventId);
			for (const turnIndex of group.assistantTurnIndexes) {
				turnFallbackEventIds.set(turnIndex, group.fallbackEventId);
			}
			continue;
		}
		if (!match || invalidUserPositions.has(group.userPosition)) continue;
		userAssignments.set(group.userEntryIndex, match.timing);
		const outputTiming = outputTimingForUserTiming(match.timing, timingByEventId);
		if (!outputTiming) continue;
		for (const turnIndex of group.assistantTurnIndexes) turnAssignments[turnIndex] = outputTiming;
	}
	return { userAssignments, turnAssignments, userFallbackEventIds, turnFallbackEventIds };
}

function invalidHistoryUserMatchPositions(
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
	return invalidUserPositions;
}

function collectHistoryTurnGroups(
	entries: readonly AgentRuntimeHistoryEntry[],
	users: readonly HistoryUserTimingTarget[],
	historyTurns: readonly TranscriptTurnTimingTarget[],
): HistoryTurnGroup[] {
	const groups = users.map((user, userPosition): HistoryTurnGroup => {
		const entry = entries[user.entryIndex]!;
		return {
			index: userPosition,
			userPosition,
			userEntryIndex: user.entryIndex,
			assistantTurnIndexes: [],
			providerNativeTurnIds: new Set(entry.type === "message" && entry.nativeTurnId ? [entry.nativeTurnId] : []),
			fallbackEventId: `native-history-group:${historyEntryNodeId(entry)}`,
		};
	});
	const groupByUserEntryIndex = new Map(groups.map((group) => [group.userEntryIndex, group]));
	for (let turnIndex = 0; turnIndex < historyTurns.length; turnIndex += 1) {
		const userEntryIndex = historyTurns[turnIndex]!.userEntryIndex;
		if (userEntryIndex === undefined) continue;
		const group = groupByUserEntryIndex.get(userEntryIndex);
		if (!group) continue;
		group.assistantTurnIndexes.push(turnIndex);
		const providerNativeTurnId = historyTurns[turnIndex]!.providerNativeTurnId;
		if (providerNativeTurnId) group.providerNativeTurnIds.add(providerNativeTurnId);
	}
	return groups;
}

function conflictingHistoryGroupIndexes(
	groups: readonly HistoryTurnGroup[],
	matches: readonly (TimingMatch | undefined)[],
	timingByEventId: ReadonlyMap<string, TraceMessageTurnTiming>,
): Set<number> {
	const conflictingGroupIndexes = new Set<number>();
	const directClaimants = new Map<number, HistoryTurnGroup[]>();
	const outputClaimants = new Map<string, HistoryTurnGroup[]>();
	for (const group of groups) {
		const match = matches[group.userPosition];
		if (!match) continue;
		if (match.confidence === "identity" || group.assistantTurnIndexes.length > 0) {
			const timingClaimants = directClaimants.get(match.timingIndex) ?? [];
			timingClaimants.push(group);
			directClaimants.set(match.timingIndex, timingClaimants);
		}
		if (group.assistantTurnIndexes.length === 0) continue;
		const outputTiming = outputTimingForUserTiming(match.timing, timingByEventId);
		if (!outputTiming) continue;
		const eventClaimants = outputClaimants.get(outputTiming.eventId) ?? [];
		eventClaimants.push(group);
		outputClaimants.set(outputTiming.eventId, eventClaimants);
	}
	for (const claimants of directClaimants.values()) {
		if (claimants.length <= 1) continue;
		for (const claimant of claimants) conflictingGroupIndexes.add(claimant.index);
	}
	for (const [eventId, claimants] of outputClaimants) {
		if (claimants.length <= 1 || isLegitimateSteeringCohort(eventId, claimants, matches)) continue;
		for (const claimant of claimants) conflictingGroupIndexes.add(claimant.index);
	}
	return conflictingGroupIndexes;
}

function isLegitimateSteeringCohort(
	outputEventId: string,
	groups: readonly HistoryTurnGroup[],
	matches: readonly (TimingMatch | undefined)[],
): boolean {
	const [providerNativeTurnId] = groups[0]?.providerNativeTurnIds ?? [];
	if (!providerNativeTurnId || groups.some((group) =>
		group.providerNativeTurnIds.size !== 1 || !group.providerNativeTurnIds.has(providerNativeTurnId)
	)) return false;
	let baseClaimants = 0;
	let steeringClaimants = 0;
	for (const group of groups) {
		const timing = matches[group.userPosition]?.timing;
		if (!timing) return false;
		if (timing.userMessageType === "message_steered" && timing.activeEventId === outputEventId) {
			steeringClaimants += 1;
		} else if (timing.eventId === outputEventId) {
			baseClaimants += 1;
		} else {
			return false;
		}
	}
	return steeringClaimants > 0 && baseClaimants <= 1;
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
	fallbackEventId?: string,
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
	const eventId = canonicalProductTurnId(entry, timing, fallbackEventId);
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
	fallbackEventId?: string,
): PiboTraceNode[] {
	const firstAssistant = entries.find(({ entry }) => entry.role === "assistant");
	if (!firstAssistant) return [];
	const eventId = canonicalProductTurnId(firstAssistant.entry, timing, fallbackEventId);
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

function canonicalProductTurnId(
	entry: AgentRuntimeHistoryMessageEntry,
	timing: TraceMessageTurnTiming | undefined,
	fallbackEventId?: string,
): string | undefined {
	return fallbackEventId ?? timing?.eventId ?? entry.turnId;
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
	if (typeof value !== "string") return undefined;
	const match = PERSISTED_TIMESTAMP_PATTERN.exec(value);
	if (!match) return undefined;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hour = Number(match[4]);
	const minute = Number(match[5]);
	const second = Number(match[6]);
	const millisecond = Number((match[7] ?? "").padEnd(3, "0").slice(0, 3));
	const offsetHour = Number(match[10] ?? 0);
	const offsetMinute = Number(match[11] ?? 0);
	if (
		month < 1 || month > 12 ||
		day < 1 || day > 31 ||
		hour > 23 ||
		minute > 59 ||
		second > 59 ||
		offsetHour > 23 ||
		offsetMinute > 59
	) return undefined;
	const local = new Date(0);
	local.setUTCFullYear(year, month - 1, day);
	local.setUTCHours(hour, minute, second, millisecond);
	if (
		local.getUTCFullYear() !== year ||
		local.getUTCMonth() !== month - 1 ||
		local.getUTCDate() !== day ||
		local.getUTCHours() !== hour ||
		local.getUTCMinutes() !== minute ||
		local.getUTCSeconds() !== second
	) return undefined;
	const offsetSign = match[9] === "-" ? -1 : 1;
	const offsetMs = match[8] === "Z"
		? 0
		: offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
	const timestamp = local.getTime() - offsetMs;
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
