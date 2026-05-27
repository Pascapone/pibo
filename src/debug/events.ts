import { DatabaseSync } from "node:sqlite";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { formatPrimitive, formatTruncationFooter, sliceTextByBytes, type DebugDetailOptions, type DebugTextSlice } from "./detail-format.js";
import { formatNextCommands } from "./next-commands.js";
import { compactOneLine, eventPayload, rawEventObject, resolveEventField, sourceRef, stringifyPayloadValue, type DebugEventRow, type DebugPayloadRef } from "./payloads.js";
import { normalizeLimit, openReadOnlyDebugDatabase, withStorePath } from "./sql.js";

export type DebugEventResult = {
	piboSessionId: string;
	events: Array<Record<string, unknown>>;
	limited: boolean;
	nextCommands?: string[];
};

export type DebugEventShowResult = {
	piboSessionId: string;
	resultType: "debug.events.show";
	selector: string;
	event?: Record<string, unknown>;
	payload?: unknown;
	field?: string;
	fieldValue?: unknown;
	text?: string;
	truncation?: DebugTextSlice;
	source?: DebugPayloadRef;
	nextCommands: string[];
};

export function inspectDebugEvents(
	piboSessionId: string,
	store: ResolvedPiboDebugStore,
	options: { type?: string; fields?: string[]; limit?: string | number } = {},
): DebugEventResult {
	if (!store.exists) throw new Error(`Debug store "chat" not found at ${store.path}`);
	const limit = normalizeLimit(options.limit);
	const db = openReadOnlyDebugDatabase(store);
	try {
		if (!tableExists(db, "event_log")) return { piboSessionId, events: [], limited: false };
		const clauses = ["session_id = ?"];
		const values: Array<string | number> = [piboSessionId];
		if (options.type) {
			clauses.push("type = ?");
			values.push(options.type);
		}
		const rows = db
			.prepare(
				`
					SELECT stream_id, session_id, session_sequence, event_id, type, created_at, preview_text, attributes_json
					FROM event_log
					WHERE ${clauses.join(" AND ")}
					ORDER BY stream_id DESC
					LIMIT ?
				`,
			)
			.all(...values, limit + 1) as DebugEventRow[];
		const limited = rows.length > limit;
		const events = rows.slice(0, limit).map((row) => formatEventRow(row, options.fields ?? []));
		return {
			piboSessionId,
			events,
			limited,
			nextCommands: buildListNextCommands(piboSessionId, rows.slice(0, limit)),
		};
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

export function inspectDebugEventShow(
	piboSessionId: string,
	store: ResolvedPiboDebugStore,
	selector: string,
	options: DebugDetailOptions & { payload?: boolean; raw?: boolean; field?: string } = {},
): DebugEventShowResult {
	if (!store.exists) throw new Error(`Debug store "chat" not found at ${store.path}`);
	const db = openReadOnlyDebugDatabase(store);
	try {
		if (!tableExists(db, "event_log")) return { piboSessionId, resultType: "debug.events.show", selector, nextCommands: [] };
		const row = findEventRow(db, piboSessionId, selector);
		if (!row) return { piboSessionId, resultType: "debug.events.show", selector, nextCommands: [`pibo debug events ${piboSessionId} list`] };
		const payload = eventPayload(row);
		const raw = rawEventObject(row);
		const shown = options.raw ? raw : payload;
		const source = sourceRef(row, options.field, options.raw ? "raw" : "event");
		const result: DebugEventShowResult = {
			piboSessionId,
			resultType: "debug.events.show",
			selector,
			event: formatEventRow(row, []),
			payload: shown,
			source,
			nextCommands: buildShowNextCommands(piboSessionId, row),
		};
		if (options.field) {
			const resolved = resolveEventField(row, options.field);
			result.field = options.field;
			result.fieldValue = resolved.value;
			result.source = sourceRef(row, resolved.source === "raw" ? options.field : options.field, "event");
			if (resolved.value === undefined) return result;
			const text = stringifyPayloadValue(resolved.value);
			result.truncation = sliceTextByBytes(text, options, 8 * 1024);
			result.text = result.truncation.text;
			return result;
		}
		if (options.payload || options.raw) {
			const text = stringifyPayloadValue(shown);
			result.truncation = sliceTextByBytes(text, options, 8 * 1024);
			result.text = result.truncation.text;
			return result;
		}
		const inline = stringifyPayloadValue(payload.inlinePayload ?? payload.text ?? row.preview_text ?? "");
		result.truncation = sliceTextByBytes(inline, options, 2 * 1024);
		result.text = result.truncation.text;
		return result;
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

export function formatDebugEvents(result: DebugEventResult): string {
	if (result.events.length === 0) return ["events: 0", ...formatNextCommands(result.nextCommands ?? [])].join("\n");
	const columns = Object.keys(result.events[0] ?? {});
	const lines = [columns.join("\t")];
	for (const event of result.events) {
		lines.push(columns.map((column) => formatValue(event[column])).join("\t"));
	}
	lines.push(`events: ${result.events.length}${result.limited ? " (limited)" : ""}`);
	lines.push(...formatNextCommands(result.nextCommands ?? []));
	return lines.join("\n");
}

export function formatDebugEventShow(result: DebugEventShowResult): string {
	if (!result.event) return [`event: not found`, ...formatNextCommands(result.nextCommands)].join("\n");
	if (result.field && result.fieldValue === undefined) {
		return [
			`stream_id: ${result.event.stream_id}`,
			`type: ${result.event.type}`,
			`field: ${result.field}`,
			"value: <missing>",
			"Hint: run with --json --raw to inspect available fields.",
			...formatNextCommands([`pibo debug events ${result.piboSessionId} show ${result.event.stream_id} --json --raw`]),
		].join("\n");
	}
	if (result.field) {
		const lines = [result.text ?? ""];
		if (result.truncation) lines.push(...formatTruncationFooter(result.truncation, {
			nextChunk: result.truncation.truncatedAfter ? `pibo debug events ${result.piboSessionId} show ${result.event.stream_id} --field ${result.field} --from ${result.truncation.from + result.truncation.bytesShown} --bytes ${Math.max(result.truncation.bytesShown, 1)}` : undefined,
			full: `pibo debug events ${result.piboSessionId} show ${result.event.stream_id} --field ${result.field} --no-truncate`,
		}));
		return lines.join("\n");
	}
	const lines: string[] = [];
	lines.push(`stream_id: ${result.event.stream_id}`);
	lines.push(`type: ${result.event.type}`);
	lines.push(`created_at: ${result.event.created_at}`);
	if (result.event.event_id) lines.push(`event_id: ${result.event.event_id}`);
	if (result.event.preview_text) lines.push(`preview: ${compactOneLine(result.event.preview_text)}`);
	if (result.text) {
		lines.push("");
		lines.push("Payload preview:");
		lines.push(result.text);
		if (result.truncation) lines.push(...formatTruncationFooter(result.truncation, {
			nextChunk: result.truncation.truncatedAfter ? `pibo debug events ${result.piboSessionId} show ${result.event.stream_id} --payload --from ${result.truncation.from + result.truncation.bytesShown} --bytes ${Math.max(result.truncation.bytesShown, 1)}` : undefined,
			full: `pibo debug events ${result.piboSessionId} show ${result.event.stream_id} --payload --no-truncate`,
		}));
	}
	lines.push(...formatNextCommands(result.nextCommands));
	return lines.join("\n");
}

function formatEventRow(row: DebugEventRow, fields: string[]): Record<string, unknown> {
	const payload = eventPayload(row);
	const result: Record<string, unknown> = {
		created_at: row.created_at,
		type: row.type,
		event_id: row.event_id,
		stream_id: row.stream_id,
	};
	if (row.preview_text) result.preview_text = row.preview_text;
	for (const field of fields) {
		result[field] = resolveEventField(row, field).value;
	}
	return fields.length ? result : { created_at: row.created_at, type: row.type, event_id: row.event_id, stream_id: row.stream_id, preview_text: row.preview_text };
}

function findEventRow(db: DatabaseSync, piboSessionId: string, selector: string): DebugEventRow | undefined {
	const numeric = Number(selector);
	if (Number.isInteger(numeric)) {
		const row = db.prepare(`
			SELECT stream_id, session_id, session_sequence, event_id, type, created_at, preview_text, attributes_json
			FROM event_log WHERE session_id = ? AND stream_id = ?
		`).get(piboSessionId, numeric) as DebugEventRow | undefined;
		if (row) return row;
	}
	return db.prepare(`
		SELECT stream_id, session_id, session_sequence, event_id, type, created_at, preview_text, attributes_json
		FROM event_log WHERE session_id = ? AND event_id = ? ORDER BY stream_id DESC LIMIT 1
	`).get(piboSessionId, selector) as DebugEventRow | undefined;
}

function buildListNextCommands(piboSessionId: string, rows: DebugEventRow[]): string[] {
	const latest = rows[0];
	const latestAssistant = rows.find((row) => row.type === "assistant_message");
	return [
		latest ? `pibo debug events ${piboSessionId} show ${latest.stream_id}` : undefined,
		latestAssistant ? `pibo debug messages ${piboSessionId} show stream:${latestAssistant.stream_id} --full` : undefined,
		`pibo debug messages ${piboSessionId} list`,
	].filter((command): command is string => Boolean(command));
}

function buildShowNextCommands(piboSessionId: string, row: DebugEventRow): string[] {
	return [
		`pibo debug events ${piboSessionId} show ${row.stream_id} --payload --no-truncate`,
		row.type.includes("message") ? `pibo debug messages ${piboSessionId} show stream:${row.stream_id} --full` : undefined,
		row.type.startsWith("tool_") ? `pibo debug tool ${piboSessionId} ${toolCallIdFromRow(row) ?? "<tool-call-id>"}` : undefined,
	].filter((command): command is string => Boolean(command));
}

function toolCallIdFromRow(row: DebugEventRow): string | undefined {
	const payload = eventPayload(row);
	return typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
}

function tableExists(db: DatabaseSync, table: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}

function formatValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value).replaceAll("\n", "\\n");
}
