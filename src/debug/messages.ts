import { DatabaseSync } from "node:sqlite";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { byteLength, formatTruncationFooter, sliceTextByBytes, type DebugDetailOptions, type DebugTextSlice } from "./detail-format.js";
import { formatNextCommands } from "./next-commands.js";
import { compactOneLine, messageRole, rawEventObject, resolveMessageContent, sourceRef, type DebugEventRow, type DebugPayloadRef } from "./payloads.js";
import { normalizeLimit, openReadOnlyDebugDatabase, withStorePath } from "./sql.js";
import { createDebugPayloadStore, hydrateDebugEventRow } from "./persisted-payloads.js";
import { readDebugRuntimeIdentity, type DebugRuntimeIdentity } from "./runtime-binding.js";

export type DebugMessageRow = {
	idx: number;
	role: string;
	streamId: number;
	eventId?: string;
	createdAt: string;
	contentBytes: number;
	preview: string;
	previewOnly: boolean;
	source: DebugPayloadRef;
	content: string;
	rawEvent?: Record<string, unknown>;
};

export type DebugMessagesListResult = DebugRuntimeIdentity & {
	piboSessionId: string;
	messages: Array<Omit<DebugMessageRow, "content">>;
	limited: boolean;
	nextCommands: string[];
};

export type DebugMessageShowResult = DebugRuntimeIdentity & {
	piboSessionId: string;
	resultType: "debug.messages.show" | "debug.final";
	selector: string;
	message?: Omit<DebugMessageRow, "content"> & { content: string };
	source?: DebugPayloadRef;
	truncation?: DebugTextSlice;
	nextCommands: string[];
};

export function inspectDebugMessagesList(
	piboSessionId: string,
	store: ResolvedPiboDebugStore,
	options: { limit?: string | number } = {},
): DebugMessagesListResult {
	const messages = readMessages(piboSessionId, store, normalizeLimit(options.limit));
	const limited = messages.limited;
	const rows = messages.rows.map(({ content: _content, ...row }) => row);
	return {
		piboSessionId,
		...messages.runtime,
		messages: rows,
		limited,
		nextCommands: [
			`pibo debug messages ${piboSessionId} show assistant:last --full`,
			`pibo debug final ${piboSessionId}`,
			rows[0] ? `pibo debug events ${piboSessionId} show ${rows[rows.length - 1]?.streamId} --json` : undefined,
		].filter((command): command is string => Boolean(command)),
	};
}

export function inspectDebugMessageShow(
	piboSessionId: string,
	store: ResolvedPiboDebugStore,
	selector: string,
	options: DebugDetailOptions & { full?: boolean; raw?: boolean; final?: boolean } = {},
): DebugMessageShowResult {
	const read = readMessages(piboSessionId, store, 1000);
	const messages = read.rows;
	const message = selectMessage(messages, selector);
	if (!message) {
		return {
			piboSessionId,
			...read.runtime,
			resultType: options.final ? "debug.final" : "debug.messages.show",
			selector,
			nextCommands: [`pibo debug messages ${piboSessionId} list`],
		};
	}
	const content = options.raw ? JSON.stringify(message.rawEvent ?? {}, null, 2) : message.content;
	const source = options.raw ? sourceRef({ stream_id: message.streamId, event_id: message.eventId ?? null, type: "message", created_at: message.createdAt, preview_text: message.preview, attributes_json: null }, undefined, "raw") : message.source;
	const slice = sliceTextByBytes(content, { ...options, noTruncate: options.noTruncate || options.full }, 8 * 1024);
	const nextCommands = buildShowNextCommands(piboSessionId, selector, message, slice, options.final ? "final" : "messages");
	const { rawEvent: _rawEvent, ...messageForResult } = message;
	return {
		piboSessionId,
		...read.runtime,
		resultType: options.final ? "debug.final" : "debug.messages.show",
		selector,
		message: { ...messageForResult, content: slice.text },
		source,
		truncation: slice,
		nextCommands,
	};
}

export function formatDebugMessagesList(result: DebugMessagesListResult): string {
	const runtimeLines = formatRuntimeIdentity(result);
	if (result.messages.length === 0) return [...runtimeLines, `messages: 0`, ...formatNextCommands(result.nextCommands)].join("\n");
	const lines = [...runtimeLines, "idx\trole\tstream_id\tevent_id\tbytes\ttruncated\tpreview"];
	for (const message of result.messages) {
		lines.push([
			message.idx,
			message.role,
			message.streamId,
			message.eventId ?? "",
			message.contentBytes,
			message.previewOnly ? "preview-only" : "no",
			compactOneLine(message.preview),
		].join("\t"));
	}
	lines.push(`messages: ${result.messages.length}${result.limited ? " (limited)" : ""}`);
	lines.push(...formatNextCommands(result.nextCommands));
	return lines.join("\n");
}

export function formatDebugMessageShow(result: DebugMessageShowResult, options: { plain?: boolean; final?: boolean } = {}): string {
	if (!result.message || !result.truncation) {
		return [`message: not found`, ...formatNextCommands(result.nextCommands)].join("\n");
	}
	if (options.plain) return result.message.content;
	const lines: string[] = [];
	lines.push(`piboSessionId: ${result.piboSessionId}`);
	lines.push(...formatRuntimeIdentity(result));
	lines.push(`selector: ${result.selector}`);
	lines.push(`role: ${result.message.role}`);
	lines.push(`stream_id: ${result.message.streamId}`);
	if (result.message.eventId) lines.push(`event_id: ${result.message.eventId}`);
	lines.push(`created_at: ${result.message.createdAt}`);
	lines.push(`contentBytes: ${result.message.contentBytes}`);
	if (result.message.previewOnly) lines.push("warning: only preview_text is available from the inspected store");
	lines.push("");
	lines.push("Content:");
	lines.push(result.message.content);
	lines.push(...formatTruncationFooter(result.truncation, {
		nextChunk: result.truncation.truncatedAfter ? nextChunkCommand(result.piboSessionId, result.selector, result.truncation, options.final) : undefined,
		full: fullCommand(result.piboSessionId, result.selector, options.final),
	}));
	lines.push("");
	lines.push("Source:");
	lines.push(`  store: ${result.source?.store}`);
	lines.push(`  table: ${result.source?.table}`);
	lines.push(`  stream_id: ${result.message.streamId}`);
	if (result.source?.path) lines.push(`  path: ${result.source.path}`);
	lines.push(...formatNextCommands(result.nextCommands));
	return lines.join("\n");
}

function readMessages(piboSessionId: string, store: ResolvedPiboDebugStore, limit: number): { rows: DebugMessageRow[]; limited: boolean; runtime: DebugRuntimeIdentity } {
	if (!store.exists) throw new Error(`Debug store "chat" not found at ${store.path}`);
	const db = openReadOnlyDebugDatabase(store);
	try {
		const runtime = readDebugRuntimeIdentity(db, piboSessionId);
		const persistedMessages = readPersistedMessages(db, store, piboSessionId, limit);
		if (persistedMessages.rows.length > 0) return { ...persistedMessages, runtime };
		if (!tableExists(db, "event_log")) return { rows: [], limited: false, runtime };
		const payloadStore = createDebugPayloadStore(db, store);
		const rows = db.prepare(`
			SELECT stream_id, session_id, session_sequence, event_id, type, created_at, payload_ref, preview_text, attributes_json
			FROM event_log
			WHERE session_id = ?
			ORDER BY stream_id ASC
			LIMIT ?
		`).all(piboSessionId, limit + 1) as DebugEventRow[];
		const messages: DebugMessageRow[] = [];
		for (const rawRow of rows) {
			const row = hydrateDebugEventRow(rawRow, payloadStore);
			const role = messageRole(row);
			if (!role) continue;
			const resolved = resolveMessageContent(row);
			if (!resolved) continue;
			const previewSlice = sliceTextByBytes(resolved.content, { maxBytes: 200 }, 200);
			messages.push({
				idx: messages.length + 1,
				role,
				streamId: row.stream_id,
				eventId: row.event_id ?? undefined,
				createdAt: row.created_at,
				contentBytes: byteLength(resolved.content),
				preview: previewSlice.text,
				previewOnly: resolved.previewOnly,
				source: { ...resolved.source, byteLength: byteLength(resolved.content) },
				content: resolved.content,
				rawEvent: rawEventObject(row),
			});
		}
		return { rows: messages.slice(0, limit), limited: rows.length > limit, runtime };
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

type PersistedMessageRow = {
	id: string;
	sequence: number;
	turn_id: string | null;
	role: string;
	created_at: string;
	content_preview: string | null;
	content_payload_ref: string | null;
	source_stream_id: number | null;
	attributes_json: string;
};

function readPersistedMessages(
	db: DatabaseSync,
	store: ResolvedPiboDebugStore,
	piboSessionId: string,
	limit: number,
): { rows: DebugMessageRow[]; limited: boolean } {
	if (!tableExists(db, "chat_messages")) return { rows: [], limited: false };
	const sourceRows = db.prepare(`
		SELECT id, sequence, turn_id, role, created_at, content_preview, content_payload_ref, source_stream_id, attributes_json
		FROM chat_messages
		WHERE session_id = ? AND role IN ('user', 'assistant', 'system')
		ORDER BY sequence ASC
		LIMIT ?
	`).all(piboSessionId, limit + 1) as PersistedMessageRow[];
	if (sourceRows.length === 0) return { rows: [], limited: false };
	const payloadStore = createDebugPayloadStore(db, store);
	const rows = sourceRows.slice(0, limit).map((row, index): DebugMessageRow => {
		const attributes = parseAttributes(row.attributes_json);
		let content = typeof attributes.inlineText === "string" ? attributes.inlineText : row.content_preview ?? "";
		let previewOnly = typeof attributes.inlineText !== "string";
		if (row.content_payload_ref && payloadStore) {
			try {
				content = payloadStore.readPayloadText(row.content_payload_ref);
				previewOnly = false;
			} catch {
				// Keep the stored preview.
			}
		}
		const preview = sliceTextByBytes(content, { maxBytes: 200 }, 200).text;
		return {
			idx: index + 1,
			role: row.role,
			streamId: row.source_stream_id ?? row.sequence,
			eventId: row.turn_id ?? undefined,
			createdAt: row.created_at,
			contentBytes: byteLength(content),
			preview,
			previewOnly,
			source: {
				store: "chat",
				table: "chat_messages",
				rowSelector: { id: row.id },
				path: row.content_payload_ref ? "content_payload_ref" : typeof attributes.inlineText === "string" ? "attributes_json.inlineText" : "content_preview",
				kind: "message",
				byteLength: byteLength(content),
			},
			content,
			rawEvent: { ...row, attributes_json: attributes },
		};
	});
	return { rows, limited: sourceRows.length > limit };
}

function parseAttributes(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function formatRuntimeIdentity(result: DebugRuntimeIdentity): string[] {
	return [
		result.runtimeInstanceId ? `runtimeInstanceId: ${result.runtimeInstanceId}` : undefined,
		result.runtimeAdapterId ? `runtimeAdapterId: ${result.runtimeAdapterId}` : undefined,
		result.runtimeBindingState ? `runtimeBindingState: ${result.runtimeBindingState}` : undefined,
	].filter((value): value is string => Boolean(value));
}

function selectMessage(messages: DebugMessageRow[], selector: string): DebugMessageRow | undefined {
	if (selector === "last") return messages[messages.length - 1];
	if (selector === "assistant:last") return [...messages].reverse().find((message) => message.role === "assistant");
	if (selector === "user:last") return [...messages].reverse().find((message) => message.role === "user");
	if (selector.startsWith("stream:")) {
		const streamId = Number(selector.slice("stream:".length));
		return messages.find((message) => message.streamId === streamId);
	}
	if (selector.startsWith("msg:")) {
		const eventId = selector.slice("msg:".length);
		return messages.find((message) => message.eventId === eventId);
	}
	const index = Number(selector);
	if (Number.isInteger(index) && index > 0) return messages[index - 1];
	return undefined;
}

function buildShowNextCommands(piboSessionId: string, selector: string, message: DebugMessageRow, slice: DebugTextSlice, commandKind: "messages" | "final"): string[] {
	return [
		slice.truncatedAfter ? nextChunkCommand(piboSessionId, selector, slice, commandKind === "final") : undefined,
		fullCommand(piboSessionId, selector, commandKind === "final"),
		`pibo debug events ${piboSessionId} show ${message.streamId} --field ${message.source.path ?? "preview_text"}`,
		`pibo debug messages ${piboSessionId} list`,
	].filter((command): command is string => Boolean(command));
}

function nextChunkCommand(piboSessionId: string, selector: string, slice: DebugTextSlice, final = false): string {
	const from = slice.from + slice.bytesShown;
	return final
		? `pibo debug final ${piboSessionId} --from ${from} --bytes ${Math.max(slice.bytesShown, 1)}`
		: `pibo debug messages ${piboSessionId} show ${selector} --from ${from} --bytes ${Math.max(slice.bytesShown, 1)}`;
}

function fullCommand(piboSessionId: string, selector: string, final = false): string {
	return final ? `pibo debug final ${piboSessionId} --no-truncate` : `pibo debug messages ${piboSessionId} show ${selector} --full`;
}

function tableExists(db: DatabaseSync, table: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}
