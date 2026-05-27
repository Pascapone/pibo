import { DatabaseSync } from "node:sqlite";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { DEFAULT_TOOL_BYTES, formatTruncationFooter, sliceTextByBytes, type DebugDetailOptions, type DebugTextSlice } from "./detail-format.js";
import { formatNextCommands } from "./next-commands.js";
import { compactOneLine, eventAttributes, eventPayload, stringifyPayloadValue, type DebugEventRow } from "./payloads.js";
import { openReadOnlyDebugDatabase, withStorePath } from "./sql.js";

export type DebugToolEventSummary = {
	streamId: number;
	type: string;
	eventId?: string;
	createdAt: string;
};

export type DebugToolInspection = {
	piboSessionId: string;
	resultType: "debug.tool";
	selector: string;
	toolCallId?: string;
	toolName?: string;
	status?: string;
	startedAt?: string;
	completedAt?: string;
	args?: unknown;
	output?: unknown;
	error?: unknown;
	argsText?: string;
	outputText?: string;
	argsTruncation?: DebugTextSlice;
	outputTruncation?: DebugTextSlice;
	events: DebugToolEventSummary[];
	nextCommands: string[];
};

export function inspectDebugTool(
	piboSessionId: string,
	store: ResolvedPiboDebugStore,
	selector: string,
	options: DebugDetailOptions & { args?: boolean; output?: boolean; error?: boolean } = {},
): DebugToolInspection {
	if (!store.exists) throw new Error(`Debug store "chat" not found at ${store.path}`);
	const db = openReadOnlyDebugDatabase(store);
	try {
		if (!tableExists(db, "event_log")) return emptyTool(piboSessionId, selector);
		const rows = db.prepare(`
			SELECT stream_id, session_id, session_sequence, event_id, type, created_at, preview_text, attributes_json
			FROM event_log
			WHERE session_id = ? AND type IN ('tool_call', 'tool_execution_started', 'tool_execution_updated', 'tool_execution_finished')
			ORDER BY stream_id ASC
		`).all(piboSessionId) as DebugEventRow[];
		const matching = rows.filter((row) => toolCallIdFromRow(row)?.includes(selector) || row.event_id === selector);
		if (matching.length === 0) return emptyTool(piboSessionId, selector);
		const toolCallId = toolCallIdFromRow(matching[0]) ?? selector;
		const toolName = firstString(matching.map(toolNameFromRow));
		const started = matching.find((row) => row.type === "tool_execution_started") ?? matching.find((row) => row.type === "tool_call");
		const finished = [...matching].reverse().find((row) => row.type === "tool_execution_finished");
		const args = firstDefined(matching.map(argsFromRow));
		const output = finished ? outputFromRow(finished) : firstDefined([...matching].reverse().map(outputFromRow));
		const error = finished ? errorFromRow(finished) : undefined;
		const status = statusFromRows(matching, finished);
		const argsSlice = args !== undefined ? sliceTextByBytes(stringifyPayloadValue(args), options, DEFAULT_TOOL_BYTES) : undefined;
		const outputSlice = output !== undefined ? sliceTextByBytes(stringifyPayloadValue(options.error ? (error ?? output) : output), options, DEFAULT_TOOL_BYTES) : undefined;
		return {
			piboSessionId,
			resultType: "debug.tool",
			selector,
			toolCallId,
			toolName,
			status,
			startedAt: started?.created_at,
			completedAt: finished?.created_at,
			args,
			output,
			error,
			argsText: argsSlice?.text,
			outputText: outputSlice?.text,
			argsTruncation: argsSlice,
			outputTruncation: outputSlice,
			events: matching.map((row) => ({ streamId: row.stream_id, type: row.type, eventId: row.event_id ?? undefined, createdAt: row.created_at })),
			nextCommands: [
				`pibo debug tool ${piboSessionId} ${toolCallId} --output --no-truncate`,
				`pibo debug tool ${piboSessionId} ${toolCallId} --args --no-truncate`,
				finished ? `pibo debug events ${piboSessionId} show ${finished.stream_id} --payload` : undefined,
			].filter((command): command is string => Boolean(command)),
		};
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

export function formatDebugTool(result: DebugToolInspection, options: { args?: boolean; output?: boolean; error?: boolean } = {}): string {
	if (!result.toolCallId) return [`tool: not found`, ...formatNextCommands(result.nextCommands)].join("\n");
	const lines: string[] = [];
	lines.push(`toolCallId: ${result.toolCallId}`);
	if (result.toolName) lines.push(`toolName: ${result.toolName}`);
	if (result.status) lines.push(`status: ${result.status}`);
	if (result.startedAt) lines.push(`startedAt: ${result.startedAt}`);
	if (result.completedAt) lines.push(`completedAt: ${result.completedAt}`);
	lines.push("");
	lines.push("Events:");
	for (const event of result.events) lines.push(`  ${event.streamId}\t${event.type}\t${event.eventId ?? ""}\t${event.createdAt}`);
	if ((options.args || !options.output) && result.argsText !== undefined) {
		lines.push("");
		lines.push("Args:");
		lines.push(result.argsText);
		if (result.argsTruncation) lines.push(...formatTruncationFooter(result.argsTruncation, {
			full: `pibo debug tool ${result.piboSessionId} ${result.toolCallId} --args --no-truncate`,
		}));
	}
	if ((options.output || options.error || !options.args) && result.outputText !== undefined) {
		lines.push("");
		lines.push(options.error ? "Error / output:" : "Output preview:");
		lines.push(result.outputText);
		if (result.outputTruncation) lines.push(...formatTruncationFooter(result.outputTruncation, {
			full: `pibo debug tool ${result.piboSessionId} ${result.toolCallId} --output --no-truncate`,
		}));
	}
	lines.push(...formatNextCommands(result.nextCommands));
	return lines.join("\n");
}

function emptyTool(piboSessionId: string, selector: string): DebugToolInspection {
	return { piboSessionId, resultType: "debug.tool", selector, events: [], nextCommands: [`pibo debug events ${piboSessionId} --type tool_execution_finished --limit 20`] };
}

function toolCallIdFromRow(row: DebugEventRow): string | undefined {
	const payload = eventPayload(row);
	const attributes = eventAttributes(row);
	return typeof payload.toolCallId === "string" ? payload.toolCallId : typeof attributes.toolCallId === "string" ? attributes.toolCallId : undefined;
}

function toolNameFromRow(row: DebugEventRow): string | undefined {
	const payload = eventPayload(row);
	const attributes = eventAttributes(row);
	return typeof payload.toolName === "string" ? payload.toolName : typeof attributes.toolName === "string" ? attributes.toolName : row.preview_text ?? undefined;
}

function argsFromRow(row: DebugEventRow): unknown {
	const payload = eventPayload(row);
	if ("args" in payload) return payload.args;
	if (row.type === "tool_call" || row.type === "tool_execution_started") return eventAttributes(row).inlinePayload;
	return undefined;
}

function outputFromRow(row: DebugEventRow): unknown {
	const payload = eventPayload(row);
	if ("result" in payload) return payload.result;
	if ("partialResult" in payload) return payload.partialResult;
	if (row.type === "tool_execution_finished" || row.type === "tool_execution_updated") return eventAttributes(row).inlinePayload;
	return undefined;
}

function errorFromRow(row: DebugEventRow): unknown {
	const payload = eventPayload(row);
	if (typeof payload.error === "string") return payload.error;
	const result = payload.result;
	if (result && typeof result === "object" && !Array.isArray(result)) {
		const record = result as Record<string, unknown>;
		if (typeof record.error === "string") return record.error;
	}
	return undefined;
}

function statusFromRows(rows: DebugEventRow[], finished?: DebugEventRow): string {
	if (!finished) return rows.some((row) => row.type === "tool_execution_started") ? "running" : "started";
	const payload = eventPayload(finished);
	if (payload.isError === true) return "error";
	const result = payload.result;
	if (result && typeof result === "object" && !Array.isArray(result)) {
		const details = (result as Record<string, unknown>).details;
		if (details && typeof details === "object" && !Array.isArray(details) && typeof (details as Record<string, unknown>).status === "string") return String((details as Record<string, unknown>).status);
		if (typeof (result as Record<string, unknown>).status === "string") return String((result as Record<string, unknown>).status);
	}
	return "completed";
}

function firstDefined(values: unknown[]): unknown {
	return values.find((value) => value !== undefined && value !== null);
}

function firstString(values: Array<string | undefined>): string | undefined {
	return values.find((value): value is string => Boolean(value));
}

function tableExists(db: DatabaseSync, table: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}
