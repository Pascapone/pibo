import type {
	AgentRuntimeHistoryContentPart,
	AgentRuntimeHistoryEntry,
	AgentRuntimeHistoryMessageEntry,
	AgentRuntimeHistoryReconciliationProof,
} from "../agent-runtime/history.js";
import { historyTraceOrder } from "./trace-order.js";
import { attachAsyncAgentRunNode, reconcileAsyncAgentRunStatuses } from "./trace-async-agent-runs.js";
import { sortTraceNodes } from "./trace-nodes.js";
import { createRunNotificationNode, parseRunNotificationText } from "./trace-run-notifications.js";
import { isSubagentToolName } from "./trace-subagent-links.js";
import { assistantMessageNodeId, messageTurnNodeId, thinkingNodeId, type TraceMessageTurnTiming } from "./trace-event-projection.js";
import type { PiboTraceNode, PiboTraceNodeStatus, PiboTraceSource, PiboWebSessionStatus } from "./trace-types.js";
import { TRACE_RECONCILIATION_ENTRY_CAP, TRACE_RECONCILIATION_TIMING_CAP } from "./trace-limits.js";

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
	entryIndexes: number[];
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
	turnProjectionStates: Map<number, AssistantTurnProjectionState>;
};

type HistoryTurnGroup = {
	index: number;
	userPosition?: number;
	userEntryIndex?: number;
	assistantTurnIndexes: number[];
	entryIndexes: number[];
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
	reconciliationProof?: AgentRuntimeHistoryReconciliationProof,
): AgentRuntimeHistoryEntry[] {
	if (sessionStatus !== "running" || openHistoryEventIds.size === 0) return [...entries];
	const { userAssignments, userFallbackEventIds } = assignHistoryTimings(entries, turnTimings, reconciliationProof);
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
	reconciliationProof?: AgentRuntimeHistoryReconciliationProof,
): PiboTraceNode[] {
	const nodes: PiboTraceNode[] = [];
	const { userAssignments, turnAssignments, userFallbackEventIds, turnFallbackEventIds, turnProjectionStates } =
		assignHistoryTimings(entries, turnTimings, reconciliationProof);
	const qualifiedNativeToolCallIds = nativeToolCallIdsRequiringQualification(entries, reconciliationProof);
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
				const timing = turnAssignments[assistantTurnIndex];
				const fallbackEventId = turnFallbackEventIds.get(assistantTurnIndex);
				const identityEntry = turn.entries.find(({ entry: turnEntry }) => turnEntry.role === "assistant")
					?? turn.entries[0];
				const eventId = identityEntry
					? canonicalProductTurnId(identityEntry.entry, timing, fallbackEventId)
					: undefined;
				const projectionState = eventId
					? turnProjectionStates.get(assistantTurnIndex)
						?? projectionStateByEventId.get(eventId)
						?? { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 }
					: { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 };
				nodes.push(...createAssistantTurnNodes(
						piboSessionId,
						turn.entries,
						timing,
						projectionState,
						fallbackEventId,
						qualifiedNativeToolCallIds,
					));
				if (eventId) projectionStateByEventId.set(eventId, projectionState);
				assistantTurnIndex += 1;
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
		const identityEntry = lastAssistant ?? turn.entries[0];
		targets.push({
			prompt: latestUserText,
			userEntryIndex: latestUserEntryIndex,
			userAt: latestUserAt,
			assistantAt: lastAssistant ? parsedTimestamp(lastAssistant.entry.createdAt) : undefined,
			providerNativeTurnId: identityEntry?.entry.nativeTurnId ?? latestProviderNativeTurnId,
			entryIndexes: turn.entries.map(({ index: entryIndex }) => entryIndex),
		});
		index = turn.nextIndex - 1;
	}
	return targets;
}

function assignHistoryTimings(
	entries: readonly AgentRuntimeHistoryEntry[],
	turnTimings: readonly TraceMessageTurnTiming[],
	reconciliationProof?: AgentRuntimeHistoryReconciliationProof,
): HistoryTimingAssignments {
	// Direct callers hand us a complete in-memory history. Paged production
	// callers must provide an explicit adapter proof: complete proof decisions
	// are computed once over the whole bounded scope and then projected back by
	// stable position; incomplete proof can never authorize a product identity.
	if (
		entries.length > TRACE_RECONCILIATION_ENTRY_CAP
		|| turnTimings.length > TRACE_RECONCILIATION_TIMING_CAP
		|| (reconciliationProof?.entries.length ?? 0) > TRACE_RECONCILIATION_ENTRY_CAP
	) return assignHistoryTimingsWithinScope(entries, [], true);
	if (!reconciliationProof) return assignHistoryTimingsWithinScope(entries, turnTimings);
	if (
		!reconciliationProof.complete
		|| !proofMatchesPage(entries, reconciliationProof)
	) return assignHistoryTimingsWithinScope(entries, [], true);
	return assignmentsFromCompleteProof(entries, turnTimings, reconciliationProof.entries);
}

function assignHistoryTimingsWithinScope(
	entries: readonly AgentRuntimeHistoryEntry[],
	turnTimings: readonly TraceMessageTurnTiming[],
	failClosed = false,
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
	if (failClosed) {
		const userFallbackEventIds = new Map<number, string>();
		const turnFallbackEventIds = new Map<number, string>();
		for (const group of groups) {
			if (group.userEntryIndex !== undefined) userFallbackEventIds.set(group.userEntryIndex, group.fallbackEventId);
			for (const turnIndex of group.assistantTurnIndexes) turnFallbackEventIds.set(turnIndex, group.fallbackEventId);
		}
		return {
			userAssignments: new Map(),
			turnAssignments: historyTurns.map(() => undefined),
			userFallbackEventIds,
			turnFallbackEventIds,
			turnProjectionStates: new Map(),
		};
	}
	for (const historyTurn of historyTurns) {
		if (historyTurn.userEntryIndex === undefined || historyTurn.assistantAt === undefined) continue;
		const user = users.find((candidate) => candidate.entryIndex === historyTurn.userEntryIndex);
		if (user) user.assistantAt ??= historyTurn.assistantAt;
	}

	const matches = users.map((user) => findConfidentTimingMatch(user, turnTimings));
	const invalidUserPositions = invalidHistoryUserMatchPositions(matches);
	const messageTurnTimings = turnTimings.filter((timing) => timing.userMessageType !== "message_steered");
	const timingByEventId = new Map(messageTurnTimings.map((timing) => [timing.eventId, timing]));
	const conflictingGroupIndexes = conflictingHistoryGroupIndexes(groups, matches, timingByEventId, invalidUserPositions);
	const userAssignments = new Map<number, TraceMessageTurnTiming>();
	const turnAssignments: Array<TraceMessageTurnTiming | undefined> = historyTurns.map(() => undefined);
	const userFallbackEventIds = new Map<number, string>();
	const turnFallbackEventIds = new Map<number, string>();
	const turnProjectionStates = new Map<number, AssistantTurnProjectionState>();
	for (const group of groups) {
		const userPosition = group.userPosition;
		const match = userPosition === undefined ? undefined : matches[userPosition];
		if (conflictingGroupIndexes.has(group.index)) {
			if (group.userEntryIndex !== undefined) userFallbackEventIds.set(group.userEntryIndex, group.fallbackEventId);
			for (const turnIndex of group.assistantTurnIndexes) {
				turnFallbackEventIds.set(turnIndex, group.fallbackEventId);
			}
			continue;
		}
		if (!match || userPosition === undefined || invalidUserPositions.has(userPosition)) {
			if (groupNeedsStructuralFallback(entries, group)) {
				if (group.userEntryIndex !== undefined) userFallbackEventIds.set(group.userEntryIndex, group.fallbackEventId);
				for (const turnIndex of group.assistantTurnIndexes) turnFallbackEventIds.set(turnIndex, group.fallbackEventId);
			}
			continue;
		}
		if (group.userEntryIndex !== undefined) userAssignments.set(group.userEntryIndex, match.timing);
		const outputTiming = outputTimingForUserTiming(match.timing, timingByEventId);
		if (!outputTiming) continue;
		for (const turnIndex of group.assistantTurnIndexes) turnAssignments[turnIndex] = outputTiming;
	}
	return { userAssignments, turnAssignments, userFallbackEventIds, turnFallbackEventIds, turnProjectionStates };
}

type ProofEntryDecision = {
	timing?: TraceMessageTurnTiming;
	fallbackEventId?: string;
};

function assignmentsFromCompleteProof(
	entries: readonly AgentRuntimeHistoryEntry[],
	turnTimings: readonly TraceMessageTurnTiming[],
	proofEntries: readonly AgentRuntimeHistoryEntry[],
): HistoryTimingAssignments {
	if (!hasUniqueStableHistoryPositions(entries)) {
		return assignHistoryTimingsWithinScope(entries, turnTimings, true);
	}
	const proofAssignments = assignHistoryTimingsWithinScope(proofEntries, turnTimings);
	const localFallbackEventIds = historyGroupFallbackEventIds(entries);
	const decisionsByPosition = new Map<string, ProofEntryDecision>();
	for (let entryIndex = 0; entryIndex < proofEntries.length; entryIndex += 1) {
		const entry = proofEntries[entryIndex]!;
		if (entry.type !== "message" || entry.role !== "user") continue;
		decisionsByPosition.set(entry.historyPosition!, {
			timing: proofAssignments.userAssignments.get(entryIndex),
			fallbackEventId: proofAssignments.userFallbackEventIds.get(entryIndex),
		});
	}
	const proofTurns = collectHistoryTurnTimingTargets(proofEntries);
	for (let turnIndex = 0; turnIndex < proofTurns.length; turnIndex += 1) {
		const decision = {
			timing: proofAssignments.turnAssignments[turnIndex],
			fallbackEventId: proofAssignments.turnFallbackEventIds.get(turnIndex),
		};
		for (const entryIndex of proofTurns[turnIndex]!.entryIndexes) {
			decisionsByPosition.set(proofEntries[entryIndex]!.historyPosition!, decision);
		}
	}

	const userAssignments = new Map<number, TraceMessageTurnTiming>();
	const userFallbackEventIds = new Map<number, string>();
	for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
		const entry = entries[entryIndex]!;
		if (entry.type !== "message" || entry.role !== "user") continue;
		const decision = decisionsByPosition.get(entry.historyPosition!);
		if (decision?.timing) userAssignments.set(entryIndex, decision.timing);
		if (decision?.fallbackEventId) userFallbackEventIds.set(entryIndex, decision.fallbackEventId);
		if (!decision) userFallbackEventIds.set(entryIndex, localFallbackEventIds[entryIndex]!);
	}

	const localTurns = collectHistoryTurnTimingTargets(entries);
	const turnAssignments: Array<TraceMessageTurnTiming | undefined> = localTurns.map(() => undefined);
	const turnFallbackEventIds = new Map<number, string>();
	const turnProjectionStates = projectionStatesFromCompleteProof(
		entries,
		localTurns,
		proofEntries,
		proofTurns,
		proofAssignments,
	);
	for (let turnIndex = 0; turnIndex < localTurns.length; turnIndex += 1) {
		const turn = localTurns[turnIndex]!;
		const decisions = turn.entryIndexes.map((entryIndex) =>
			decisionsByPosition.get(entries[entryIndex]!.historyPosition!)
		);
		const decision = oneConsistentProofDecision(decisions);
		if (decision?.timing) turnAssignments[turnIndex] = decision.timing;
		if (decision?.fallbackEventId) {
			turnFallbackEventIds.set(turnIndex, decision.fallbackEventId);
		} else if (!decision) {
			const firstEntryIndex = turn.entryIndexes[0]!;
			turnFallbackEventIds.set(turnIndex, localFallbackEventIds[firstEntryIndex]!);
		}
	}
	return { userAssignments, turnAssignments, userFallbackEventIds, turnFallbackEventIds, turnProjectionStates };
}

function proofMatchesPage(
	entries: readonly AgentRuntimeHistoryEntry[],
	proof: AgentRuntimeHistoryReconciliationProof,
): boolean {
	if (!hasUniqueStableHistoryPositions(entries) || !hasUniqueStableHistoryPositions(proof.entries)) return false;
	if (proof.scopeId) {
		if (entries.some((entry) => entry.historyScopeId !== proof.scopeId)) return false;
		if (proof.entries.some((entry) => entry.historyScopeId !== proof.scopeId)) return false;
	}
	const proofByPosition = new Map(proof.entries.map((entry) => [entry.historyPosition!, entry]));
	return entries.every((entry) => {
		const proofEntry = proofByPosition.get(entry.historyPosition!);
		return proofEntry !== undefined && historyProofSignature(entry) === historyProofSignature(proofEntry);
	});
}

function historyProofSignature(entry: AgentRuntimeHistoryEntry): string {
	const { sequence: _pageLocalSequence, ...proofContent } = entry;
	return stableJson(proofContent);
}

function stableJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.filter(([, child]) => child !== undefined)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
		.join(",")}}`;
}

function projectionStatesFromCompleteProof(
	entries: readonly AgentRuntimeHistoryEntry[],
	localTurns: readonly TranscriptTurnTimingTarget[],
	proofEntries: readonly AgentRuntimeHistoryEntry[],
	proofTurns: readonly TranscriptTurnTimingTarget[],
	proofAssignments: HistoryTimingAssignments,
): Map<number, AssistantTurnProjectionState> {
	const stateByEventId = new Map<string, AssistantTurnProjectionState>();
	const stateByPosition = new Map<string, AssistantTurnProjectionState>();
	for (let turnIndex = 0; turnIndex < proofTurns.length; turnIndex += 1) {
		const turn = proofTurns[turnIndex]!;
		const firstAssistantIndex = turn.entryIndexes.find((entryIndex) => {
			const entry = proofEntries[entryIndex];
			return entry?.type === "message" && entry.role === "assistant";
		});
		const identityEntryIndex = firstAssistantIndex ?? turn.entryIndexes[0];
		if (identityEntryIndex === undefined) continue;
		const identityEntry = proofEntries[identityEntryIndex];
		if (!identityEntry || identityEntry.type !== "message") continue;
		const eventId = canonicalProductTurnId(
			identityEntry,
			proofAssignments.turnAssignments[turnIndex],
			proofAssignments.turnFallbackEventIds.get(turnIndex),
		);
		const state = eventId
			? stateByEventId.get(eventId) ?? { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 }
			: { assistantPartOrdinal: 0, reasoningPartOrdinal: 0 };
		for (const entryIndex of turn.entryIndexes) {
			const entry = proofEntries[entryIndex];
			if (!entry || entry.type !== "message" || !entry.historyPosition) continue;
			stateByPosition.set(entry.historyPosition, { ...state });
			if (entry.role !== "assistant") continue;
			const parts = historyMessageParts(entry);
			state.reasoningPartOrdinal += parts.filter((part) => part.type === "reasoning" && hasVisibleText(part.text)).length;
			if (parts.some((part) => part.type === "text" && part.text !== "")) state.assistantPartOrdinal += 1;
		}
		if (eventId) stateByEventId.set(eventId, state);
	}

	const localStates = new Map<number, AssistantTurnProjectionState>();
	for (let turnIndex = 0; turnIndex < localTurns.length; turnIndex += 1) {
		const firstEntryIndex = localTurns[turnIndex]!.entryIndexes[0];
		if (firstEntryIndex === undefined) continue;
		const position = entries[firstEntryIndex]?.historyPosition;
		const state = position ? stateByPosition.get(position) : undefined;
		if (state) localStates.set(turnIndex, { ...state });
	}
	return localStates;
}

function hasUniqueStableHistoryPositions(entries: readonly AgentRuntimeHistoryEntry[]): boolean {
	const positions = new Set<string>();
	for (const entry of entries) {
		if (!entry.historyPosition || positions.has(entry.historyPosition)) return false;
		positions.add(entry.historyPosition);
	}
	return true;
}

function oneConsistentProofDecision(
	decisions: readonly (ProofEntryDecision | undefined)[],
): ProofEntryDecision | undefined {
	const first = decisions[0];
	if (!first || decisions.some((decision) => !decision)) return undefined;
	const firstTimingId = first.timing?.eventId;
	return decisions.every((decision) =>
		decision?.timing?.eventId === firstTimingId
		&& decision?.fallbackEventId === first.fallbackEventId
	) ? first : undefined;
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
	const fallbackEventIds = historyGroupFallbackEventIds(entries);
	const groups = users.map((user, userPosition): HistoryTurnGroup => {
		const entry = entries[user.entryIndex]!;
		return {
			index: userPosition,
			userPosition,
			userEntryIndex: user.entryIndex,
			assistantTurnIndexes: [],
			entryIndexes: [user.entryIndex],
			providerNativeTurnIds: new Set(entry.type === "message" && entry.nativeTurnId ? [entry.nativeTurnId] : []),
			fallbackEventId: fallbackEventIds[user.entryIndex]!,
		};
	});
	const groupByUserEntryIndex = new Map(groups.map((group) => [group.userEntryIndex, group]));
	for (let turnIndex = 0; turnIndex < historyTurns.length; turnIndex += 1) {
		const userEntryIndex = historyTurns[turnIndex]!.userEntryIndex;
		const group = userEntryIndex === undefined ? undefined : groupByUserEntryIndex.get(userEntryIndex);
		if (!group) {
			const firstEntryIndex = historyTurns[turnIndex]!.entryIndexes[0];
			const firstEntry = firstEntryIndex === undefined ? undefined : entries[firstEntryIndex];
			if (!firstEntry) continue;
			groups.push({
				index: groups.length,
				assistantTurnIndexes: [turnIndex],
				entryIndexes: [...historyTurns[turnIndex]!.entryIndexes],
				providerNativeTurnIds: new Set(historyTurns[turnIndex]!.providerNativeTurnId
					? [historyTurns[turnIndex]!.providerNativeTurnId!]
					: []),
				fallbackEventId: fallbackEventIds[firstEntryIndex]!,
			});
			continue;
		}
		group.assistantTurnIndexes.push(turnIndex);
		group.entryIndexes.push(...historyTurns[turnIndex]!.entryIndexes);
		const providerNativeTurnId = historyTurns[turnIndex]!.providerNativeTurnId;
		if (providerNativeTurnId) group.providerNativeTurnIds.add(providerNativeTurnId);
	}
	return groups;
}

function historyGroupFallbackEventIds(entries: readonly AgentRuntimeHistoryEntry[]): string[] {
	const positionCounts = new Map<string, number>();
	const sequenceCounts = new Map<number, number>();
	for (const entry of entries) {
		if (entry.historyPosition) positionCounts.set(entry.historyPosition, (positionCounts.get(entry.historyPosition) ?? 0) + 1);
		if (entry.sequence !== undefined) sequenceCounts.set(entry.sequence, (sequenceCounts.get(entry.sequence) ?? 0) + 1);
	}
	return entries.map((entry, entryIndex) => {
		if (entry.historyPosition && positionCounts.get(entry.historyPosition) === 1) {
			return `native-history-group:${entry.historyPosition}`;
		}
		const scopePrefix = entry.historyScopeId ? `${entry.historyScopeId}:` : "";
		if (entry.sequence !== undefined && sequenceCounts.get(entry.sequence) === 1) {
			return `native-history-group:${scopePrefix}position:${entry.sequence}`;
		}
		return `native-history-group:${scopePrefix}position:${entryIndex}`;
	});
}

function groupNeedsStructuralFallback(
	entries: readonly AgentRuntimeHistoryEntry[],
	group: HistoryTurnGroup,
): boolean {
	return group.userPosition === undefined || (group.assistantTurnIndexes.length > 0 && group.entryIndexes.every((entryIndex) => {
		const entry = entries[entryIndex];
		return entry?.type !== "message" || !entry.turnId;
	}));
}

function conflictingHistoryGroupIndexes(
	groups: readonly HistoryTurnGroup[],
	matches: readonly (TimingMatch | undefined)[],
	timingByEventId: ReadonlyMap<string, TraceMessageTurnTiming>,
	invalidUserPositions: ReadonlySet<number>,
): Set<number> {
	const conflictingGroupIndexes = new Set<number>();
	const directClaimants = new Map<number, HistoryTurnGroup[]>();
	const outputClaimants = new Map<string, HistoryTurnGroup[]>();
	for (const group of groups) {
		if (
			group.userPosition === undefined
			|| (invalidUserPositions.has(group.userPosition) && group.assistantTurnIndexes.length === 0)
		) continue;
		const match = matches[group.userPosition];
		if (!match) continue;
		const timingClaimants = directClaimants.get(match.timingIndex) ?? [];
		timingClaimants.push(group);
		directClaimants.set(match.timingIndex, timingClaimants);
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
		const timing = group.userPosition === undefined ? undefined : matches[group.userPosition]?.timing;
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
	qualifiedNativeToolCallIds: ReadonlySet<string> = new Set(),
): PiboTraceNode[] {
	const firstAssistant = entries.find(({ entry }) => entry.role === "assistant");
	const identityEntry = firstAssistant ?? entries[0];
	if (!identityEntry) return [];
	const eventId = canonicalProductTurnId(identityEntry.entry, timing, fallbackEventId);
	const orderedNodes: PiboTraceNode[] = [];
	const toolsByCallId = new Map<string, PiboTraceNode>();

	for (const { entry, index: entryIndex } of entries) {
		if (entry.role === "tool") {
			mergePersistedToolResult(
				toolsByCallId,
				orderedNodes,
				entry,
				piboSessionId,
				entryIndex,
				eventId,
				qualifiedNativeToolCallIds.has(entry.toolCallId ?? ""),
			);
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
				const toolNode = createToolCallNode(
					piboSessionId,
					entry,
					entryIndex,
					contentPartIndex,
					part,
					eventId,
					qualifiedNativeToolCallIds.has(part.toolCallId),
				);
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
	qualifyProjectionIdentity = false,
): PiboTraceNode {
	const source = traceSource(entry.source);
	const toolNodeId = historyToolNodeId(
		entry,
		part.toolCallId,
		`${entry.historyPosition ?? `${eventId ?? entry.id}:entry:${entryIndex}`}:part:${contentPartIndex}`,
		qualifyProjectionIdentity,
	);
	return {
		id: toolNodeId,
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
		stableKey: toolNodeId,
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
	qualifyProjectionIdentity = false,
): void {
	const toolCallId = entry.toolCallId;
	if (!toolCallId) return;
	let toolNode = toolsByCallId.get(toolCallId);
	if (!toolNode) {
		toolNode = createMissingToolResultNode(
			piboSessionId,
			entry,
			entryIndex,
			toolCallId,
			eventId,
			qualifyProjectionIdentity,
		);
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
	qualifyProjectionIdentity = false,
): PiboTraceNode {
	const source = traceSource(entry.source);
	const toolNodeId = historyToolNodeId(
		entry,
		toolCallId,
		`${entry.historyPosition ?? `${eventId ?? entry.id}:entry:${entryIndex}`}:result`,
		qualifyProjectionIdentity,
	);
	return {
		id: toolNodeId,
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
		stableKey: toolNodeId,
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
	if (entry.source === "native" && entry.historyPosition) return `history:${entry.historyPosition}`;
	return entry.source === "native" && entry.nativeEntryId ? `entry:${entry.nativeEntryId}` : `history:${entry.id}`;
}

function historyToolNodeId(
	entry: AgentRuntimeHistoryMessageEntry,
	toolCallId: string,
	projectionIdentity: string,
	qualifyProjectionIdentity: boolean,
): string {
	if (entry.source !== "native" || !qualifyProjectionIdentity) return `tool:${toolCallId}`;
	return `history-tool:${encodeURIComponent(JSON.stringify([toolCallId, projectionIdentity]))}`;
}

function nativeToolCallIdsRequiringQualification(
	entries: readonly AgentRuntimeHistoryEntry[],
	reconciliationProof?: AgentRuntimeHistoryReconciliationProof,
): Set<string> {
	const localNativeToolCallIds = nativeToolCallIds(entries);
	if (!reconciliationProof) return duplicateNativeToolCallIds(entries);
	if (
		!reconciliationProof.complete
		|| reconciliationProof.entries.length > TRACE_RECONCILIATION_ENTRY_CAP
		|| !proofMatchesPage(entries, reconciliationProof)
	) return localNativeToolCallIds;
	return duplicateNativeToolCallIds(reconciliationProof.entries);
}

function nativeToolCallIds(entries: readonly AgentRuntimeHistoryEntry[]): Set<string> {
	const result = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "message" || entry.source !== "native") continue;
		if (entry.role === "assistant") {
			for (const part of historyMessageParts(entry)) {
				if (part.type === "tool_call") result.add(part.toolCallId);
			}
		} else if (entry.role === "tool" && entry.toolCallId) {
			result.add(entry.toolCallId);
		}
	}
	return result;
}

function duplicateNativeToolCallIds(entries: readonly AgentRuntimeHistoryEntry[]): Set<string> {
	const counts = new Map<string, number>();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type !== "message" || (entry.role !== "assistant" && entry.role !== "tool")) continue;
		const turn = collectAssistantTurn(entries, index);
		const callIds = new Set<string>();
		for (const { entry: turnEntry } of turn.entries) {
			if (turnEntry.source !== "native") continue;
			if (turnEntry.role === "assistant") {
				for (const part of historyMessageParts(turnEntry)) {
					if (part.type !== "tool_call") continue;
					callIds.add(part.toolCallId);
					counts.set(part.toolCallId, (counts.get(part.toolCallId) ?? 0) + 1);
				}
			} else if (turnEntry.toolCallId && !callIds.has(turnEntry.toolCallId)) {
				callIds.add(turnEntry.toolCallId);
				counts.set(turnEntry.toolCallId, (counts.get(turnEntry.toolCallId) ?? 0) + 1);
			}
		}
		index = turn.nextIndex - 1;
	}
	return new Set([...counts].filter(([, count]) => count > 1).map(([toolCallId]) => toolCallId));
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
