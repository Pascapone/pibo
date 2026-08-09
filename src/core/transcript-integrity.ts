import {
	sessionEntryToContextMessages,
	type AgentSessionRuntime,
	type SessionEntry,
	type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export const PIBO_TRANSCRIPT_INTEGRITY_RESUME_MESSAGE_TYPE = "pibo-transcript-integrity-resume";
export const PIBO_TRANSCRIPT_INTEGRITY_RESUME_PROMPT = "Continue the interrupted task autonomously from the repaired transcript. Do not rerun completed tools, wait for additional user input, or mention transcript repair unless it affects the result.";
export const PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE = "pibo-transcript-integrity";

export type PiboTranscriptIntegrityBoundary =
	| "load"
	| "persistence"
	| "before_compaction"
	| "after_compaction"
	| "before_provider";

export type PiboTranscriptIntegrityRelation =
	| "orphan_result"
	| "wrong_branch_result"
	| "duplicate_call"
	| "duplicate_result"
	| "tool_name_mismatch";

export type PiboTranscriptIntegrityAction =
	| "restored_pair"
	| "quarantined_tail"
	| "quarantined_runtime_result";

export type PiboTranscriptIntegrityIssue = {
	relation: PiboTranscriptIntegrityRelation;
	toolCallId: string;
	messageIndex: number;
	toolName?: string;
	expectedToolName?: string;
	entryId?: string;
};

export type PiboTranscriptIntegrityReport = {
	repairId: string;
	boundary: PiboTranscriptIntegrityBoundary;
	relation: PiboTranscriptIntegrityRelation;
	action: PiboTranscriptIntegrityAction;
	toolCallIds: string[];
	removedEntryIds: string[];
	restoredEntryIds: string[];
	continuationRequired: boolean;
};

type PiboAgentSession = AgentSessionRuntime["session"];
type AppendableMessage = Parameters<PiboAgentSession["sessionManager"]["appendMessage"]>[0];
type TranscriptMessage = AgentMessage & { role?: unknown };
type ToolCallBlock = { type: "toolCall"; id: string; name: string; arguments?: unknown };
type ToolResultMessage = AppendableMessage & { role: "toolResult"; toolCallId: string; toolName: string };
type AssistantMessage = AppendableMessage & { role: "assistant"; content: unknown[] };
type ProjectedMessage = { message: AgentMessage; entry?: SessionEntry };

type InstalledState = {
	session: PiboAgentSession;
	originalAppendMessage: PiboAgentSession["sessionManager"]["appendMessage"];
	restoredAssistants: Map<string, { entryId: string; fingerprint: string }>;
	reports: PiboTranscriptIntegrityReport[];
	continuationPending: boolean;
	continuationInProgress: boolean;
};

const installedStates = new WeakMap<object, InstalledState>();

export class PiboTranscriptIntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PiboTranscriptIntegrityError";
	}
}

export function validatePiboTranscriptIntegrityMessages(messages: readonly AgentMessage[]): PiboTranscriptIntegrityIssue[] {
	return validateProjectedMessages(messages.map((message) => ({ message })));
}

export function installPiboTranscriptIntegrity(session: PiboAgentSession): PiboTranscriptIntegrityReport[] {
	const existing = installedStates.get(session);
	if (existing) return [...existing.reports];

	const manager = session.sessionManager;
	const state: InstalledState = {
		session,
		originalAppendMessage: manager.appendMessage.bind(manager),
		restoredAssistants: new Map(),
		reports: [],
		continuationPending: false,
		continuationInProgress: false,
	};
	installedStates.set(session, state);

	manager.appendMessage = ((message: AppendableMessage) => appendMessageWithIntegrity(state, message)) as typeof manager.appendMessage;
	patchProviderBoundary(state);
	patchCompactionBoundaries(state);
	reconcilePiboTranscriptIntegrity(session, "load");
	return [...state.reports];
}

export function reconcilePiboTranscriptIntegrity(
	session: PiboAgentSession,
	boundary: PiboTranscriptIntegrityBoundary,
): PiboTranscriptIntegrityReport | undefined {
	const state = installedStates.get(session);
	if (!state) throw new PiboTranscriptIntegrityError("Transcript integrity is not installed for this session");

	const manager = session.sessionManager;
	const activeEntries = manager.buildContextEntries();
	const projected = projectEntries(activeEntries);
	const [issue] = validateProjectedMessages(projected, manager.getEntries());
	if (!issue) return undefined;

	const invalidEntry = issue.entryId ? manager.getEntry(issue.entryId) : undefined;
	if (!invalidEntry) {
		return quarantineRuntimeTranscript(state, boundary, issue);
	}

	const invalidEntryIndex = activeEntries.findIndex((entry) => entry.id === invalidEntry.id);
	const removedEntryIds = invalidEntryIndex >= 0
		? activeEntries.slice(invalidEntryIndex).map((entry) => entry.id)
		: [invalidEntry.id];
	const resultMessage = isToolResultMessageEntry(invalidEntry) ? invalidEntry.message : undefined;
	const authoritativeAssistant = resultMessage
		? uniqueAuthoritativeAssistant(manager.getEntries(), issue.toolCallId)
		: undefined;

	let report: PiboTranscriptIntegrityReport;
	branchTo(manager, invalidEntry.parentId);
	if (authoritativeAssistant && resultMessage && (issue.relation === "orphan_result" || issue.relation === "wrong_branch_result")) {
		const repairId = manager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, repairMetadata({
			boundary,
			relation: issue.relation,
			action: "restored_pair",
			toolCallIds: assistantToolCalls(authoritativeAssistant.message).map((call) => call.id),
			removedEntryIds,
			restoredEntryIds: [authoritativeAssistant.id, invalidEntry.id],
			phase: "journal_started",
		}));
		const restoredAssistantEntryId = state.originalAppendMessage(authoritativeAssistant.message as AppendableMessage);
		rememberRestoredAssistant(state, authoritativeAssistant.message, restoredAssistantEntryId);
		const restoredResultEntryId = state.originalAppendMessage(resultMessage as AppendableMessage);
		manager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, {
			repairId,
			phase: "journal_committed",
			restoredAssistantEntryId,
			restoredResultEntryId,
		});
		report = {
			repairId,
			boundary,
			relation: issue.relation,
			action: "restored_pair",
			toolCallIds: assistantToolCalls(authoritativeAssistant.message).map((call) => call.id),
			removedEntryIds,
			restoredEntryIds: [authoritativeAssistant.id, invalidEntry.id],
			continuationRequired: boundary === "load",
		};
	} else {
		const repairId = manager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, repairMetadata({
			boundary,
			relation: issue.relation,
			action: "quarantined_tail",
			toolCallIds: [issue.toolCallId],
			removedEntryIds,
			restoredEntryIds: [],
			phase: "quarantined",
		}));
		report = {
			repairId,
			boundary,
			relation: issue.relation,
			action: "quarantined_tail",
			toolCallIds: [issue.toolCallId],
			removedEntryIds,
			restoredEntryIds: [],
			continuationRequired: boundary === "load",
		};
	}

	syncAgentTranscript(session);
	assertSessionTranscriptValid(session, boundary);
	recordReport(state, report);
	return report;
}

export function claimPiboTranscriptIntegrityContinuation(
	session: PiboAgentSession,
): PiboTranscriptIntegrityReport[] {
	const state = installedStates.get(session);
	if (!state || !state.continuationPending || state.continuationInProgress) return [];
	const reports = state.reports.filter((report) => report.continuationRequired);
	if (reports.length === 0) {
		state.continuationPending = false;
		return [];
	}
	state.continuationPending = false;
	state.continuationInProgress = true;
	session.sessionManager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, {
		phase: "continuation_started",
		repairIds: reports.map((report) => report.repairId),
	});
	return reports;
}

export function settlePiboTranscriptIntegrityContinuation(
	session: PiboAgentSession,
	outcome: "completed" | "failed",
	error?: unknown,
): void {
	const state = installedStates.get(session);
	if (!state?.continuationInProgress) return;
	state.continuationInProgress = false;
	session.sessionManager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, {
		phase: `continuation_${outcome}`,
		...(error ? { errorClass: error instanceof Error ? error.name : "Error" } : {}),
	});
}

function patchProviderBoundary(state: InstalledState): void {
	const agent = state.session.agent;
	const previous = agent.transformContext?.bind(agent);
	const repairedProviderMessages = async (signal: AbortSignal | undefined) => {
		const repaired = state.session.sessionManager.buildSessionContext().messages;
		if (!previous) return repaired;
		const transformed = await previous(repaired, signal);
		return validatePiboTranscriptIntegrityMessages(transformed).length === 0 ? transformed : repaired;
	};
	agent.transformContext = async (messages, signal) => {
		const transformed = previous ? await previous(messages, signal) : messages;
		const durableRepair = reconcilePiboTranscriptIntegrity(state.session, "before_provider");
		if (durableRepair) return repairedProviderMessages(signal);
		const [runtimeIssue] = validatePiboTranscriptIntegrityMessages(transformed);
		if (!runtimeIssue) return transformed;
		quarantineRuntimeTranscript(state, "before_provider", runtimeIssue);
		return repairedProviderMessages(signal);
	};
}

function patchCompactionBoundaries(state: InstalledState): void {
	const session = state.session;
	const originalCompact = session.compact.bind(session);
	session.compact = (async (...args: Parameters<typeof session.compact>) => {
		reconcilePiboTranscriptIntegrity(session, "before_compaction");
		const result = await originalCompact(...args);
		reconcilePiboTranscriptIntegrity(session, "after_compaction");
		return result;
	}) as typeof session.compact;
}

function appendMessageWithIntegrity(state: InstalledState, message: AppendableMessage): string {
	if (isAssistantMessage(message)) {
		const restoredEntryId = restoredAssistantEntryId(state, message);
		return restoredEntryId ?? state.originalAppendMessage(message);
	}
	if (!isToolResultMessage(message)) return state.originalAppendMessage(message);

	const activeMessages = state.session.sessionManager.buildSessionContext().messages;
	if (activeToolCall(activeMessages, message.toolCallId)) return state.originalAppendMessage(message);

	const authoritativeAssistant = uniqueAssistantMessage(state.session.agent.state.messages, message.toolCallId);
	if (authoritativeAssistant) {
		const toolCallIds = assistantToolCalls(authoritativeAssistant).map((call) => call.id);
		const repairId = state.session.sessionManager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, repairMetadata({
			boundary: "persistence",
			relation: "orphan_result",
			action: "restored_pair",
			toolCallIds,
			removedEntryIds: [],
			restoredEntryIds: [],
			phase: "journal_started",
		}));
		const assistantEntryId = state.originalAppendMessage(authoritativeAssistant);
		rememberRestoredAssistant(state, authoritativeAssistant, assistantEntryId);
		const resultEntryId = state.originalAppendMessage(message);
		state.session.sessionManager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, {
			repairId,
			phase: "journal_committed",
			assistantEntryId,
			resultEntryId,
		});
		recordReport(state, {
			repairId,
			boundary: "persistence",
			relation: "orphan_result",
			action: "restored_pair",
			toolCallIds,
			removedEntryIds: [],
			restoredEntryIds: [assistantEntryId, resultEntryId],
			continuationRequired: false,
		});
		return resultEntryId;
	}

	const repairId = state.session.sessionManager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, repairMetadata({
		boundary: "persistence",
		relation: "orphan_result",
		action: "quarantined_runtime_result",
		toolCallIds: [message.toolCallId],
		removedEntryIds: [],
		restoredEntryIds: [],
		phase: "quarantined",
	}));
	recordReport(state, {
		repairId,
		boundary: "persistence",
		relation: "orphan_result",
		action: "quarantined_runtime_result",
		toolCallIds: [message.toolCallId],
		removedEntryIds: [],
		restoredEntryIds: [],
		continuationRequired: false,
	});
	syncAgentTranscript(state.session);
	return repairId;
}

function quarantineRuntimeTranscript(
	state: InstalledState,
	boundary: PiboTranscriptIntegrityBoundary,
	issue: PiboTranscriptIntegrityIssue,
): PiboTranscriptIntegrityReport {
	const repairId = state.session.sessionManager.appendCustomEntry(PIBO_TRANSCRIPT_INTEGRITY_ENTRY_TYPE, repairMetadata({
		boundary,
		relation: issue.relation,
		action: "quarantined_runtime_result",
		toolCallIds: [issue.toolCallId],
		removedEntryIds: [],
		restoredEntryIds: [],
		phase: "quarantined",
	}));
	const report: PiboTranscriptIntegrityReport = {
		repairId,
		boundary,
		relation: issue.relation,
		action: "quarantined_runtime_result",
		toolCallIds: [issue.toolCallId],
		removedEntryIds: [],
		restoredEntryIds: [],
		continuationRequired: boundary === "load",
	};
	syncAgentTranscript(state.session);
	recordReport(state, report);
	return report;
}

function validateProjectedMessages(
	projected: readonly ProjectedMessage[],
	allEntries: readonly SessionEntry[] = [],
): PiboTranscriptIntegrityIssue[] {
	const calls = new Map<string, { name: string; messageIndex: number }>();
	const results = new Map<string, number>();
	const issues: PiboTranscriptIntegrityIssue[] = [];
	const allCalls = allAssistantCallIds(allEntries);

	for (let messageIndex = 0; messageIndex < projected.length; messageIndex += 1) {
		const { message, entry } = projected[messageIndex]!;
		if (isAssistantMessage(message)) {
			for (const call of assistantToolCalls(message)) {
				const existing = calls.get(call.id);
				if (existing) {
					issues.push({ relation: "duplicate_call", toolCallId: call.id, toolName: call.name, messageIndex, entryId: entry?.id });
					continue;
				}
				calls.set(call.id, { name: call.name, messageIndex });
			}
			continue;
		}
		if (!isToolResultMessage(message)) continue;

		if (results.has(message.toolCallId)) {
			issues.push({ relation: "duplicate_result", toolCallId: message.toolCallId, toolName: message.toolName, messageIndex, entryId: entry?.id });
			continue;
		}
		results.set(message.toolCallId, messageIndex);
		const call = calls.get(message.toolCallId);
		if (!call) {
			issues.push({
				relation: allCalls.has(message.toolCallId) ? "wrong_branch_result" : "orphan_result",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				messageIndex,
				entryId: entry?.id,
			});
			continue;
		}
		if (call.name !== message.toolName) {
			issues.push({
				relation: "tool_name_mismatch",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				expectedToolName: call.name,
				messageIndex,
				entryId: entry?.id,
			});
		}
	}
	return issues;
}

function projectEntries(entries: readonly SessionEntry[]): ProjectedMessage[] {
	return entries.flatMap((entry) => sessionEntryToContextMessages(entry).map((message) => ({ entry, message })));
}

function allAssistantCallIds(entries: readonly SessionEntry[]): Set<string> {
	const ids = new Set<string>();
	for (const entry of entries) {
		if (!isAssistantMessageEntry(entry)) continue;
		for (const call of assistantToolCalls(entry.message)) ids.add(call.id);
	}
	return ids;
}

function uniqueAuthoritativeAssistant(entries: readonly SessionEntry[], toolCallId: string): (SessionMessageEntry & { message: AssistantMessage }) | undefined {
	const candidates = entries.filter((entry): entry is SessionMessageEntry & { message: AssistantMessage } =>
		isAssistantMessageEntry(entry) && assistantToolCalls(entry.message).some((call) => call.id === toolCallId));
	return candidates.length === 1 ? candidates[0] : undefined;
}

function uniqueAssistantMessage(messages: readonly AgentMessage[], toolCallId: string): AssistantMessage | undefined {
	const candidates = messages.filter((message): message is AssistantMessage =>
		isAssistantMessage(message) && assistantToolCalls(message).some((call) => call.id === toolCallId));
	return candidates.length === 1 ? candidates[0] : undefined;
}

function activeToolCall(messages: readonly AgentMessage[], toolCallId: string): ToolCallBlock | undefined {
	for (const message of messages) {
		if (!isAssistantMessage(message)) continue;
		const call = assistantToolCalls(message).find((candidate) => candidate.id === toolCallId);
		if (call) return call;
	}
	return undefined;
}

function assistantToolCalls(message: AssistantMessage | AgentMessage): ToolCallBlock[] {
	if (!isAssistantMessage(message)) return [];
	return message.content.flatMap((part) => {
		if (!part || typeof part !== "object") return [];
		const candidate = part as Partial<ToolCallBlock>;
		return candidate.type === "toolCall" && typeof candidate.id === "string" && typeof candidate.name === "string"
			? [{ type: "toolCall" as const, id: candidate.id, name: candidate.name, arguments: candidate.arguments }]
			: [];
	});
}

function isAssistantMessage(message: unknown): message is AssistantMessage {
	return Boolean(message && typeof message === "object" && (message as TranscriptMessage).role === "assistant" && Array.isArray((message as { content?: unknown }).content));
}

function isToolResultMessage(message: unknown): message is ToolResultMessage {
	return Boolean(
		message
		&& typeof message === "object"
		&& (message as TranscriptMessage).role === "toolResult"
		&& typeof (message as { toolCallId?: unknown }).toolCallId === "string"
		&& typeof (message as { toolName?: unknown }).toolName === "string",
	);
}

function isAssistantMessageEntry(entry: SessionEntry): entry is SessionMessageEntry & { message: AssistantMessage } {
	return entry.type === "message" && isAssistantMessage(entry.message);
}

function isToolResultMessageEntry(entry: SessionEntry): entry is SessionMessageEntry & { message: ToolResultMessage } {
	return entry.type === "message" && isToolResultMessage(entry.message);
}

function branchTo(manager: PiboAgentSession["sessionManager"], parentId: string | null): void {
	if (parentId) manager.branch(parentId);
	else manager.resetLeaf();
}

function syncAgentTranscript(session: PiboAgentSession): void {
	session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
}

function assertSessionTranscriptValid(session: PiboAgentSession, boundary: PiboTranscriptIntegrityBoundary): void {
	const issues = validateProjectedMessages(projectEntries(session.sessionManager.buildContextEntries()), session.sessionManager.getEntries());
	if (issues.length === 0) return;
	const issue = issues[0]!;
	throw new PiboTranscriptIntegrityError(
		`Transcript integrity repair failed at ${boundary}: ${issue.relation} for tool call ${issue.toolCallId}`,
	);
}

function rememberRestoredAssistant(state: InstalledState, message: AssistantMessage, entryId: string): void {
	const fingerprint = assistantFingerprint(message);
	for (const call of assistantToolCalls(message)) state.restoredAssistants.set(call.id, { entryId, fingerprint });
}

function restoredAssistantEntryId(state: InstalledState, message: AssistantMessage): string | undefined {
	const calls = assistantToolCalls(message);
	if (calls.length === 0) return undefined;
	const fingerprint = assistantFingerprint(message);
	const restored = calls.map((call) => state.restoredAssistants.get(call.id));
	if (restored.some((item) => !item || item.fingerprint !== fingerprint)) return undefined;
	const entryIds = new Set(restored.map((item) => item!.entryId));
	return entryIds.size === 1 ? restored[0]!.entryId : undefined;
}

function assistantFingerprint(message: AssistantMessage): string {
	return JSON.stringify({
		content: message.content,
		api: (message as { api?: unknown }).api,
		provider: (message as { provider?: unknown }).provider,
		model: (message as { model?: unknown }).model,
		responseId: (message as { responseId?: unknown }).responseId,
		timestamp: (message as { timestamp?: unknown }).timestamp,
	});
}

function repairMetadata(input: {
	boundary: PiboTranscriptIntegrityBoundary;
	relation: PiboTranscriptIntegrityRelation;
	action: PiboTranscriptIntegrityAction;
	toolCallIds: string[];
	removedEntryIds: string[];
	restoredEntryIds: string[];
	phase: string;
}): Record<string, unknown> {
	return {
		version: 1,
		boundary: input.boundary,
		relation: input.relation,
		action: input.action,
		phase: input.phase,
		toolCallIds: input.toolCallIds,
		removedEntryIds: input.removedEntryIds,
		restoredEntryIds: input.restoredEntryIds,
		removedCount: input.removedEntryIds.length,
		restoredCount: input.restoredEntryIds.length,
	};
}

function recordReport(state: InstalledState, report: PiboTranscriptIntegrityReport): void {
	state.reports.push(report);
	if (report.continuationRequired) state.continuationPending = true;
}
