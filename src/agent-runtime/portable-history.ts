import { createHash } from "node:crypto";
import type { PiboJsonObject, PiboJsonValue } from "../core/events.js";
import type { PiboDataStore } from "../data/pibo-store.js";
import { redactSensitiveText, redactSensitiveValue } from "../core/sensitive-data-redaction.js";
import type { PiboSession } from "../sessions/store.js";
import type { RuntimeSessionBinding } from "../sessions/runtime-binding.js";
import type { AgentRuntimeHistoryContentPart, AgentRuntimeHistoryEntry } from "./history.js";

export const PORTABLE_HISTORY_HANDOFF_METADATA_KEY = "portableHistoryHandoff";
export const PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY = "portableHistoryLastImport";

const PORTABLE_HISTORY_VERSION = 1 as const;
const MAX_SOURCE_ROWS = 4_000;
const MAX_HISTORY_ENTRIES = 1_000;
const MAX_HISTORY_BYTES = 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024;
const MAX_HISTORY_ENVELOPE_RESERVE_BYTES = 16 * 1024;

export type AgentRuntimePortableHistoryCheckpoint = {
	maxSessionSequence: number;
	createdAt: string;
};

export type AgentRuntimePortableHistory = {
	version: typeof PORTABLE_HISTORY_VERSION;
	piboSessionId: string;
	sourceRuntimeInstanceId: string;
	sourceAdapterId: string;
	checkpoint: AgentRuntimePortableHistoryCheckpoint;
	entries: readonly AgentRuntimeHistoryEntry[];
	truncated: boolean;
	omittedEntries: number;
};

export type AgentRuntimeHistoryHandoff =
	| {
		mode: "import";
		history: AgentRuntimePortableHistory;
	}
	| {
		mode: "fresh";
	};

export type PersistedPortableHistoryHandoff = {
	version: typeof PORTABLE_HISTORY_VERSION;
	status: "pending";
	mode: "import" | "fresh";
	sourceRuntimeInstanceId: string;
	sourceAdapterId: string;
	targetRuntimeInstanceId: string;
	targetAdapterId: string;
	requestedAt: string;
	checkpoint?: AgentRuntimePortableHistoryCheckpoint;
};

export interface AgentRuntimePortableHistoryProvider {
	createCheckpoint(piboSessionId: string): AgentRuntimePortableHistoryCheckpoint;
	read(input: {
		piboSession: PiboSession;
		sourceBinding: Pick<RuntimeSessionBinding, "runtimeInstanceId" | "adapterId">;
		checkpoint: AgentRuntimePortableHistoryCheckpoint;
	}): AgentRuntimePortableHistory;
}

type MessageRow = {
	id: string;
	sequence: number;
	turn_id: string | null;
	role: string;
	status: string;
	created_at: string;
	content_preview: string | null;
	content_payload_ref: string | null;
	source_stream_id: number | null;
	attributes_json: string;
	event_sequence: number | null;
};

type EventRow = {
	stream_id: number;
	session_sequence: number;
	type: string;
	turn_id: string | null;
	tool_call_id: string | null;
	payload_ref: string | null;
	preview_text: string | null;
	attributes_json: string;
	created_at: string;
};

function validBoundedIdentifier(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}

function validTimestamp(value: unknown): value is string {
	return typeof value === "string" && value.length <= 128 && Number.isFinite(Date.parse(value));
}

function parseObject(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
}

function jsonValue(value: unknown): PiboJsonValue | undefined {
	if (value === undefined) return undefined;
	try {
		return JSON.parse(JSON.stringify(redactSensitiveValue(value))) as PiboJsonValue;
	} catch {
		return undefined;
	}
}

function boundedIdentifierText(value: string, fallback: string, maxLength = 512): string {
	const normalized = value.trim();
	const redacted = redactSensitiveText(normalized).replace(/[\r\n]+/g, " ").trim();
	const needsHash = redacted !== normalized || redacted.length > maxLength;
	const suffix = needsHash ? `-${createHash("sha256").update(value).digest("hex").slice(0, 12)}` : "";
	const selected = (redacted || fallback).slice(0, Math.max(1, maxLength - suffix.length));
	return `${selected}${suffix}`;
}

function optionalBoundedIdentifierText(value: string | null): string | undefined {
	return value ? boundedIdentifierText(value, "portable-id") : undefined;
}

function toolInvocationKey(turnId: string | null | undefined, toolCallId: string): string {
	return JSON.stringify([turnId ?? null, toolCallId]);
}

function boundedText(value: string, maxBytes = MAX_ENTRY_BYTES): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	const suffix = "\n\n[Portable history entry truncated by Pibo.]";
	const suffixBytes = Buffer.byteLength(suffix, "utf8");
	const buffer = Buffer.from(value, "utf8");
	return `${buffer.subarray(0, Math.max(0, maxBytes - suffixBytes)).toString("utf8")}${suffix}`;
}

function stringContent(entry: AgentRuntimeHistoryEntry): string {
	if (entry.type !== "message") return entry.name;
	if (typeof entry.content === "string") return entry.content;
	return entry.content.map((part) => {
		if (part.type === "text" || part.type === "reasoning") return part.text;
		return `${part.toolName}:${JSON.stringify(part.input ?? null)}`;
	}).join("\n");
}

function entryBytes(entry: AgentRuntimeHistoryEntry): number {
	return Buffer.byteLength(JSON.stringify(entry), "utf8");
}

function historyRole(value: string): "user" | "assistant" | "system" | undefined {
	return value === "user" || value === "assistant" || value === "system" ? value : undefined;
}

function historyStatus(value: string): "complete" | "running" | "error" {
	if (value === "running" || value === "streaming" || value === "in_progress") return "running";
	if (value === "error" || value === "failed") return "error";
	return "complete";
}

export class PiboDataPortableHistoryProvider implements AgentRuntimePortableHistoryProvider {
	constructor(private readonly store: PiboDataStore) {}

	createCheckpoint(piboSessionId: string): AgentRuntimePortableHistoryCheckpoint {
		const row = this.store.db.prepare(`
			SELECT COALESCE(MAX(session_sequence), 0) AS max_sequence
			FROM event_log
			WHERE session_id = ?
		`).get(piboSessionId) as { max_sequence: number };
		return {
			maxSessionSequence: Number(row.max_sequence ?? 0),
			createdAt: new Date().toISOString(),
		};
	}

	read(input: {
		piboSession: PiboSession;
		sourceBinding: Pick<RuntimeSessionBinding, "runtimeInstanceId" | "adapterId">;
		checkpoint: AgentRuntimePortableHistoryCheckpoint;
	}): AgentRuntimePortableHistory {
		const messages = this.readMessages(
			input.piboSession.id,
			input.checkpoint,
			this.readRoutedUserMessages(input.piboSession.id, input.checkpoint),
		);
		const tools = this.readToolEntries(input.piboSession.id, input.checkpoint);
		const nonPortableCount = this.nonPortableEntryCount(input.piboSession.id, input.checkpoint);
		const modelEntries = [...messages, ...tools]
			.sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0) || left.createdAt.localeCompare(right.createdAt));
		const contextEntry: AgentRuntimeHistoryEntry = {
			id: "portable:pibo-context",
			type: "message",
			source: "product",
			createdAt: input.checkpoint.createdAt,
			sequence: 0,
			role: "system",
			content: [
				"Pibo portable conversation handoff.",
				`Pibo Session ID: ${input.piboSession.id}`,
				`Pibo Room ID: ${typeof input.piboSession.metadata?.chatRoomId === "string" ? input.piboSession.metadata.chatRoomId : "unknown"}`,
				`Profile: ${input.piboSession.profile}`,
				`Source runtime: ${input.sourceBinding.runtimeInstanceId} (${input.sourceBinding.adapterId})`,
				"The following entries are model-relevant product history. Private reasoning and runtime-private metadata are intentionally omitted.",
			].join("\n"),
			status: "complete",
		};
		const nonPortableEntry: AgentRuntimeHistoryEntry | undefined = nonPortableCount > 0
			? {
				id: "portable:nonportable-fallback",
				type: "message",
				source: "product",
				createdAt: input.checkpoint.createdAt,
				sequence: 0,
				role: "system",
				content: `${nonPortableCount} runtime-specific history entr${nonPortableCount === 1 ? "y was" : "ies were"} retained by Pibo but omitted from the portable model context because no safe cross-runtime representation exists.`,
				status: "complete",
			}
			: undefined;
		const bounded = boundEntries(modelEntries, {
			maxEntries: MAX_HISTORY_ENTRIES - (nonPortableEntry ? 3 : 2),
			maxBytes: Math.max(
				0,
				MAX_HISTORY_BYTES
					- entryBytes(contextEntry)
					- (nonPortableEntry ? entryBytes(nonPortableEntry) : 0)
					- MAX_HISTORY_ENVELOPE_RESERVE_BYTES,
			),
		});
		const retained = [...bounded.entries];
		let additionallyOmitted = 0;
		while (true) {
			const omittedEntries = bounded.omittedEntries + additionallyOmitted;
			const entries: AgentRuntimeHistoryEntry[] = [contextEntry];
			if (nonPortableEntry) entries.push(nonPortableEntry);
			if (omittedEntries > 0) {
				entries.push({
					id: "portable:bounded-fallback",
					type: "message",
					source: "product",
					createdAt: input.checkpoint.createdAt,
					sequence: 0,
					role: "system",
					content: `${omittedEntries} older portable history entr${omittedEntries === 1 ? "y was" : "ies were"} omitted to stay within the bounded cross-runtime handoff limit. The most recent conversation context follows.`,
					status: "complete",
				});
			}
			entries.push(...normalizeToolPairs(retained));
			const history: AgentRuntimePortableHistory = {
				version: PORTABLE_HISTORY_VERSION,
				piboSessionId: input.piboSession.id,
				sourceRuntimeInstanceId: input.sourceBinding.runtimeInstanceId,
				sourceAdapterId: input.sourceBinding.adapterId,
				checkpoint: { ...input.checkpoint },
				entries,
				truncated: omittedEntries > 0,
				omittedEntries,
			};
			const serializedBytes = Buffer.byteLength(JSON.stringify(history), "utf8");
			if (serializedBytes <= MAX_HISTORY_BYTES) return history;
			if (retained.length === 0) {
				throw new Error("Portable history metadata exceeds the aggregate handoff limit.");
			}
			const excessBytes = serializedBytes - MAX_HISTORY_BYTES;
			const averageEntryBytes = Math.max(1, Math.floor(retained.reduce((sum, entry) => sum + entryBytes(entry), 0) / retained.length));
			const removeCount = Math.min(retained.length, Math.max(1, Math.ceil(excessBytes / averageEntryBytes)));
			retained.splice(0, removeCount);
			additionallyOmitted += removeCount;
		}
	}

	private readMessages(
		piboSessionId: string,
		checkpoint: AgentRuntimePortableHistoryCheckpoint,
		routedUserMessages: { turnIds: ReadonlySet<string>; sourceStreamIds: ReadonlySet<number> },
	): AgentRuntimeHistoryEntry[] {
		const rows = this.store.db.prepare(`
			SELECT m.*, e.session_sequence AS event_sequence
			FROM chat_messages m
			LEFT JOIN event_log e ON e.stream_id = m.source_stream_id
			WHERE m.session_id = ?
				AND m.role IN ('user', 'assistant', 'system')
				AND ((e.session_sequence IS NOT NULL AND e.session_sequence <= ?) OR (e.session_sequence IS NULL AND m.created_at <= ?))
			ORDER BY COALESCE(e.session_sequence, m.sequence) DESC
			LIMIT ?
		`).all(piboSessionId, checkpoint.maxSessionSequence, checkpoint.createdAt, MAX_SOURCE_ROWS) as MessageRow[];
		return rows.reverse().flatMap((row) => {
			const role = historyRole(row.role);
			if (!role) return [];
			const attributes = parseObject(row.attributes_json);
			const clientTxnId = typeof attributes.clientTxnId === "string" ? attributes.clientTxnId : undefined;
			if (role === "user") {
				if (clientTxnId && !routedUserMessages.turnIds.has(clientTxnId)) return [];
				if (!clientTxnId && row.source_stream_id !== null && !routedUserMessages.sourceStreamIds.has(row.source_stream_id)) return [];
			}
			let text = typeof attributes.inlineText === "string" ? attributes.inlineText : row.content_preview ?? "";
			if (row.content_payload_ref) {
				const payload = this.store.payloads.getPayload(row.content_payload_ref);
				if (payload && payload.byteSize <= MAX_ENTRY_BYTES) {
					text = this.store.payloads.readPayloadText(row.content_payload_ref);
				}
			}
			return [{
				id: `portable:message:${row.id}`,
				type: "message" as const,
				source: "product" as const,
				createdAt: row.created_at,
				sequence: row.event_sequence ?? row.sequence,
				turnId: optionalBoundedIdentifierText(row.turn_id),
				role,
				content: boundedText(redactSensitiveText(text)),
				status: historyStatus(row.status),
			} satisfies AgentRuntimeHistoryEntry];
		});
	}

	private readRoutedUserMessages(
		piboSessionId: string,
		checkpoint: AgentRuntimePortableHistoryCheckpoint,
	): { turnIds: ReadonlySet<string>; sourceStreamIds: ReadonlySet<number> } {
		const routedRows = this.store.db.prepare(`
			SELECT DISTINCT turn_id
			FROM event_log
			WHERE session_id = ?
				AND session_sequence <= ?
				AND turn_id IS NOT NULL
				AND type IN ('message_queued', 'message_steered', 'message_started')
		`).all(piboSessionId, checkpoint.maxSessionSequence) as Array<{ turn_id: string }>;
		const acceptedRows = this.store.db.prepare(`
			SELECT accepted.stream_id
			FROM event_log accepted
			WHERE accepted.session_id = ?
				AND accepted.type = 'user.message.accepted'
				AND accepted.session_sequence <= ?
				AND EXISTS (
					SELECT 1
					FROM event_log routed
					WHERE routed.session_id = accepted.session_id
						AND routed.session_sequence > accepted.session_sequence
						AND routed.session_sequence <= ?
						AND routed.type IN ('message_queued', 'message_steered', 'message_started')
						AND NOT EXISTS (
							SELECT 1
							FROM event_log next_user
							WHERE next_user.session_id = accepted.session_id
								AND next_user.type = 'user.message.accepted'
								AND next_user.session_sequence > accepted.session_sequence
								AND next_user.session_sequence < routed.session_sequence
						)
				)
		`).all(piboSessionId, checkpoint.maxSessionSequence, checkpoint.maxSessionSequence) as Array<{ stream_id: number }>;
		return {
			turnIds: new Set(routedRows.map((row) => row.turn_id)),
			sourceStreamIds: new Set(acceptedRows.map((row) => row.stream_id)),
		};
	}

	private readToolEntries(piboSessionId: string, checkpoint: AgentRuntimePortableHistoryCheckpoint): AgentRuntimeHistoryEntry[] {
		const rows = (this.store.db.prepare(`
			SELECT stream_id, session_sequence, type, turn_id, tool_call_id, payload_ref, preview_text, attributes_json, created_at
			FROM event_log
			WHERE session_id = ?
				AND session_sequence <= ?
				AND type IN ('tool_call', 'tool_execution_finished')
			ORDER BY session_sequence DESC
			LIMIT ?
		`).all(piboSessionId, checkpoint.maxSessionSequence, MAX_SOURCE_ROWS) as EventRow[]).reverse();
		const calls = new Map<string, EventRow>();
		const results = new Map<string, EventRow>();
		for (const row of rows) {
			if (!row.tool_call_id) continue;
			const invocationKey = toolInvocationKey(row.turn_id, row.tool_call_id);
			if (row.type === "tool_call") {
				const attributes = parseObject(row.attributes_json);
				const existing = calls.get(invocationKey);
				if (!existing || attributes.argsComplete === true) calls.set(invocationKey, row);
			} else {
				results.set(invocationKey, row);
			}
		}
		const entries: AgentRuntimeHistoryEntry[] = [];
		for (const row of calls.values()) {
			const toolCallId = row.tool_call_id;
			if (!toolCallId) continue;
			const attributes = parseObject(row.attributes_json);
			const portableToolCallId = boundedIdentifierText(toolCallId, `tool-call-${row.stream_id}`);
			const toolName = boundedIdentifierText(typeof attributes.toolName === "string" ? attributes.toolName : row.preview_text ?? "tool", "tool", 256);
			const part: AgentRuntimeHistoryContentPart = {
				type: "tool_call",
				toolCallId: portableToolCallId,
				toolName,
				input: this.readEventPayload(row),
			};
			entries.push({
				id: `portable:tool-call:${row.stream_id}`,
				type: "message",
				source: "product",
				createdAt: row.created_at,
				sequence: row.session_sequence,
				turnId: optionalBoundedIdentifierText(row.turn_id),
				role: "assistant",
				content: [part],
				status: "complete",
				toolCallId: portableToolCallId,
				toolName,
			});
		}
		for (const row of results.values()) {
			const toolCallId = row.tool_call_id;
			if (!toolCallId) continue;
			const attributes = parseObject(row.attributes_json);
			const portableToolCallId = boundedIdentifierText(toolCallId, `tool-call-${row.stream_id}`);
			const toolName = boundedIdentifierText(typeof attributes.toolName === "string" ? attributes.toolName : row.preview_text ?? "tool", "tool", 256);
			const result = this.readEventPayload(row) ?? null;
			entries.push({
				id: `portable:tool-result:${row.stream_id}`,
				type: "message",
				source: "product",
				createdAt: row.created_at,
				sequence: row.session_sequence,
				turnId: optionalBoundedIdentifierText(row.turn_id),
				role: "tool",
				content: boundedText(JSON.stringify(result)),
				status: attributes.isError === true ? "error" : "complete",
				toolCallId: portableToolCallId,
				toolName,
				result,
				isError: attributes.isError === true,
			});
		}
		return entries;
	}

	private readEventPayload(row: EventRow): PiboJsonValue | undefined {
		const attributes = parseObject(row.attributes_json);
		if (attributes.inlinePayload !== undefined) return jsonValue(attributes.inlinePayload);
		if (!row.payload_ref) return undefined;
		const payload = this.store.payloads.getPayload(row.payload_ref);
		if (!payload) return { portableFallback: "Tool payload is no longer available in Pibo history." };
		if (payload.byteSize > MAX_ENTRY_BYTES) {
			return {
				portableFallback: "Tool payload exceeded the per-entry portable history limit.",
				preview: redactSensitiveText(payload.previewText ?? row.preview_text ?? ""),
			};
		}
		try {
			return jsonValue(payload.contentType.includes("json")
				? this.store.payloads.readPayloadJson(row.payload_ref)
				: this.store.payloads.readPayloadText(row.payload_ref));
		} catch {
			return { portableFallback: "Tool payload could not be read from Pibo history." };
		}
	}

	private nonPortableEntryCount(piboSessionId: string, checkpoint: AgentRuntimePortableHistoryCheckpoint): number {
		const row = this.store.db.prepare(`
			SELECT COUNT(*) AS count
			FROM event_log
			WHERE session_id = ?
				AND session_sequence <= ?
				AND (type = 'pi_event' OR type LIKE 'thinking_%' OR type = 'subagent_session')
		`).get(piboSessionId, checkpoint.maxSessionSequence) as { count: number };
		return Number(row.count ?? 0);
	}
}

function normalizeToolPairs(entries: readonly AgentRuntimeHistoryEntry[]): AgentRuntimeHistoryEntry[] {
	const callIds = new Set<string>();
	const resultIds = new Set<string>();
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		if (entry.role === "tool" && entry.toolCallId) resultIds.add(toolInvocationKey(entry.turnId, entry.toolCallId));
		if (!Array.isArray(entry.content)) continue;
		for (const part of entry.content) {
			if (part.type === "tool_call") callIds.add(toolInvocationKey(entry.turnId, part.toolCallId));
		}
	}
	return entries.map((entry) => {
		if (entry.type !== "message") return entry;
		if (entry.role === "tool" && entry.toolCallId && !callIds.has(toolInvocationKey(entry.turnId, entry.toolCallId))) {
			return {
				...entry,
				role: "user",
				content: [
					`[Portable fallback: result from tool "${entry.toolName ?? "tool"}" had no retained matching call.]`,
					typeof entry.content === "string" ? entry.content : JSON.stringify(entry.result ?? null),
				].join("\n"),
				toolCallId: undefined,
				toolName: undefined,
				result: undefined,
				isError: undefined,
			};
		}
		if (entry.role !== "assistant" || !Array.isArray(entry.content)) return entry;
		const content = entry.content.map((part): AgentRuntimeHistoryContentPart => {
			if (part.type !== "tool_call" || resultIds.has(toolInvocationKey(entry.turnId, part.toolCallId))) return part;
			return {
				type: "text",
				text: `[Portable fallback: tool call "${part.toolName}" had no retained result.]\nInput: ${JSON.stringify(part.input ?? null)}`,
			};
		});
		return content.some((part) => part.type === "tool_call")
			? { ...entry, content }
			: { ...entry, content, toolCallId: undefined, toolName: undefined };
	});
}

function boundEntries(
	entries: readonly AgentRuntimeHistoryEntry[],
	limits: { maxEntries: number; maxBytes: number },
): {
	entries: AgentRuntimeHistoryEntry[];
	omittedEntries: number;
} {
	const selected: AgentRuntimeHistoryEntry[] = [];
	let bytes = 0;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		const normalized = normalizeEntrySize(entry);
		const size = entryBytes(normalized);
		if (selected.length >= limits.maxEntries || bytes + size > limits.maxBytes) continue;
		selected.push(normalized);
		bytes += size;
	}
	selected.reverse();
	return { entries: selected, omittedEntries: entries.length - selected.length };
}

function normalizeEntrySize(entry: AgentRuntimeHistoryEntry): AgentRuntimeHistoryEntry {
	if (entry.type !== "message") return entry;
	if (typeof entry.content === "string") return { ...entry, content: boundedText(entry.content) };
	if (entryBytes(entry) <= MAX_ENTRY_BYTES) return entry;
	return {
		...entry,
		content: boundedText(stringContent(entry)),
		result: entry.result === undefined ? undefined : {
			portableFallback: "Structured history content exceeded the per-entry limit.",
		},
	};
}

export function createPortableHistoryHandoffMetadata(input: {
	mode: "import" | "fresh";
	sourceBinding: Pick<RuntimeSessionBinding, "runtimeInstanceId" | "adapterId">;
	targetBinding: Pick<RuntimeSessionBinding, "runtimeInstanceId" | "adapterId">;
	checkpoint?: AgentRuntimePortableHistoryCheckpoint;
}): PersistedPortableHistoryHandoff {
	return {
		version: PORTABLE_HISTORY_VERSION,
		status: "pending",
		mode: input.mode,
		sourceRuntimeInstanceId: input.sourceBinding.runtimeInstanceId,
		sourceAdapterId: input.sourceBinding.adapterId,
		targetRuntimeInstanceId: input.targetBinding.runtimeInstanceId,
		targetAdapterId: input.targetBinding.adapterId,
		requestedAt: new Date().toISOString(),
		...(input.checkpoint ? { checkpoint: { ...input.checkpoint } } : {}),
	};
}

export function readPortableHistoryHandoffMetadata(
	metadata: PiboJsonObject | undefined,
): PersistedPortableHistoryHandoff | undefined {
	const value = metadata?.[PORTABLE_HISTORY_HANDOFF_METADATA_KEY];
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (record.version !== PORTABLE_HISTORY_VERSION || record.status !== "pending" || (record.mode !== "import" && record.mode !== "fresh")) return undefined;
	if (
		!validBoundedIdentifier(record.sourceRuntimeInstanceId)
		|| !validBoundedIdentifier(record.sourceAdapterId)
		|| !validBoundedIdentifier(record.targetRuntimeInstanceId)
		|| !validBoundedIdentifier(record.targetAdapterId)
		|| !validTimestamp(record.requestedAt)
	) return undefined;
	let checkpoint: AgentRuntimePortableHistoryCheckpoint | undefined;
	if (record.mode === "import") {
		const raw = record.checkpoint;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
		const selected = raw as Record<string, unknown>;
		if (!Number.isSafeInteger(selected.maxSessionSequence) || Number(selected.maxSessionSequence) < 0 || !validTimestamp(selected.createdAt)) return undefined;
		checkpoint = {
			maxSessionSequence: Number(selected.maxSessionSequence),
			createdAt: selected.createdAt,
		};
	}
	return {
		version: PORTABLE_HISTORY_VERSION,
		status: "pending",
		mode: record.mode,
		sourceRuntimeInstanceId: record.sourceRuntimeInstanceId,
		sourceAdapterId: record.sourceAdapterId,
		targetRuntimeInstanceId: record.targetRuntimeInstanceId,
		targetAdapterId: record.targetAdapterId,
		requestedAt: record.requestedAt,
		...(checkpoint ? { checkpoint } : {}),
	};
}

export function withPortableHistoryHandoffMetadata(
	metadata: PiboJsonObject | undefined,
	handoff: PersistedPortableHistoryHandoff,
): PiboJsonObject {
	return {
		...(metadata ?? {}),
		[PORTABLE_HISTORY_HANDOFF_METADATA_KEY]: handoff as unknown as PiboJsonValue,
	};
}

export function withoutPortableHistoryHandoffMetadata(input: {
	metadata: PiboJsonObject | undefined;
	handoff: PersistedPortableHistoryHandoff;
	history?: AgentRuntimePortableHistory;
}): PiboJsonObject {
	const { [PORTABLE_HISTORY_HANDOFF_METADATA_KEY]: _handoff, ...metadata } = input.metadata ?? {};
	return {
		...metadata,
		[PORTABLE_HISTORY_LAST_IMPORT_METADATA_KEY]: {
			version: PORTABLE_HISTORY_VERSION,
			status: "completed",
			mode: input.handoff.mode,
			sourceRuntimeInstanceId: input.handoff.sourceRuntimeInstanceId,
			sourceAdapterId: input.handoff.sourceAdapterId,
			targetRuntimeInstanceId: input.handoff.targetRuntimeInstanceId,
			targetAdapterId: input.handoff.targetAdapterId,
			requestedAt: input.handoff.requestedAt,
			...(input.handoff.checkpoint ? { checkpoint: { ...input.handoff.checkpoint } } : {}),
			completedAt: new Date().toISOString(),
			...(input.history ? {
				entryCount: input.history.entries.length,
				truncated: input.history.truncated,
				omittedEntries: input.history.omittedEntries,
			} : {}),
		} as unknown as PiboJsonValue,
	};
}
