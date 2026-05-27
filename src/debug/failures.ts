import { DatabaseSync } from "node:sqlite";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { formatNextCommands } from "./next-commands.js";
import { compactOneLine, eventPayload, type DebugEventRow } from "./payloads.js";
import { normalizeLimit, openReadOnlyDebugDatabase, withStorePath } from "./sql.js";
import { inspectDebugTrace, type DebugTraceNodeRow } from "./trace.js";

export type DebugFailureRow = {
	kind: "tool" | "trace" | "session";
	streamId?: number;
	type?: string;
	toolCallId?: string;
	toolName?: string;
	status?: string;
	reason?: string;
	preview?: string;
	nodeId?: string;
	title?: string;
	inspect: string;
};

export type DebugFailuresResult = {
	piboSessionId: string;
	resultType: "debug.failures";
	failures: DebugFailureRow[];
	limited: boolean;
	nextCommands: string[];
};

export async function inspectDebugFailures(
	piboSessionId: string,
	stores: { sessions: ResolvedPiboDebugStore; chat: ResolvedPiboDebugStore },
	options: { limit?: string | number } = {},
): Promise<DebugFailuresResult> {
	const limit = normalizeLimit(options.limit);
	const failures: DebugFailureRow[] = [];
	failures.push(...readToolFailures(piboSessionId, stores.chat, limit));
	try {
		const trace = await inspectDebugTrace(piboSessionId, stores, {});
		for (const node of trace.nodes.filter((item) => item.status === "error")) failures.push(traceFailure(piboSessionId, node));
	} catch {
		// Trace reconstruction is best-effort for failure summaries.
	}
	failures.push(...readSessionFailures(piboSessionId, stores.sessions));
	const limited = failures.length > limit;
	const visible = failures.slice(0, limit);
	return {
		piboSessionId,
		resultType: "debug.failures",
		failures: visible,
		limited,
		nextCommands: [
			visible[0]?.inspect,
			`pibo debug trace ${piboSessionId} --check`,
			`pibo debug events ${piboSessionId} --type tool_execution_finished --limit 20`,
		].filter((command): command is string => Boolean(command)),
	};
}

export function formatDebugFailures(result: DebugFailuresResult): string {
	const lines: string[] = [`failures: ${result.failures.length}${result.limited ? " (limited)" : ""}`];
	result.failures.forEach((failure, index) => {
		lines.push("");
		if (failure.kind === "tool") {
			lines.push(`${index + 1}. stream_id=${failure.streamId} tool=${failure.toolName ?? ""} status=${failure.status ?? "error"}`);
			if (failure.reason) lines.push(`   reason: ${failure.reason}`);
			if (failure.preview) lines.push(`   preview: ${failure.preview}`);
			lines.push(`   inspect: ${failure.inspect}`);
			return;
		}
		if (failure.kind === "trace") {
			lines.push(`${index + 1}. trace node ${failure.nodeId} status=${failure.status}`);
			if (failure.title) lines.push(`   title: ${failure.title}`);
			lines.push(`   inspect: ${failure.inspect}`);
			return;
		}
		lines.push(`${index + 1}. session status=${failure.status}`);
		if (failure.reason) lines.push(`   reason: ${failure.reason}`);
		lines.push(`   inspect: ${failure.inspect}`);
	});
	lines.push(...formatNextCommands(result.nextCommands));
	return lines.join("\n");
}

function readToolFailures(piboSessionId: string, store: ResolvedPiboDebugStore, limit: number): DebugFailureRow[] {
	if (!store.exists) return [];
	const db = openReadOnlyDebugDatabase(store);
	try {
		if (!tableExists(db, "event_log")) return [];
		const rows = db.prepare(`
			SELECT stream_id, session_id, session_sequence, event_id, type, created_at, preview_text, attributes_json
			FROM event_log
			WHERE session_id = ? AND type = 'tool_execution_finished'
			ORDER BY stream_id DESC
			LIMIT ?
		`).all(piboSessionId, limit + 1) as DebugEventRow[];
		return rows.flatMap((row) => {
			const payload = eventPayload(row);
			const status = statusFromPayload(payload);
			const isError = payload.isError === true || ["error", "failed", "failure"].includes(status ?? "");
			if (!isError) return [];
			const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : row.event_id ?? undefined;
			const toolName = typeof payload.toolName === "string" ? payload.toolName : row.preview_text ?? undefined;
			const reason = failureReason(payload);
			return [{
				kind: "tool" as const,
				streamId: row.stream_id,
				type: row.type,
				toolCallId,
				toolName,
				status: status ?? "error",
				reason,
				preview: compactOneLine(row.preview_text ?? reason ?? ""),
				inspect: `pibo debug tool ${piboSessionId} ${toolCallId ?? row.stream_id} --output`,
			}];
		});
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

function readSessionFailures(piboSessionId: string, store: ResolvedPiboDebugStore): DebugFailureRow[] {
	if (!store.exists) return [];
	const db = openReadOnlyDebugDatabase(store);
	try {
		if (!tableExists(db, "sessions")) return [];
		const row = db.prepare("SELECT status, metadata_json FROM sessions WHERE id = ?").get(piboSessionId) as { status: string; metadata_json: string | null } | undefined;
		if (!row || row.status !== "error") return [];
		return [{ kind: "session", status: row.status, reason: row.metadata_json ?? undefined, inspect: `pibo debug session ${piboSessionId} --json` }];
	} finally {
		db.close();
	}
}

function traceFailure(piboSessionId: string, node: DebugTraceNodeRow): DebugFailureRow {
	return {
		kind: "trace",
		nodeId: node.id,
		status: node.status,
		title: node.title,
		toolCallId: node.toolCallId,
		inspect: node.toolCallId ? `pibo debug tool ${piboSessionId} ${node.toolCallId}` : `pibo debug trace ${piboSessionId} show ${node.id}`,
	};
}

function statusFromPayload(payload: Record<string, unknown>): string | undefined {
	const result = payload.result;
	if (result && typeof result === "object" && !Array.isArray(result)) {
		const record = result as Record<string, unknown>;
		if (typeof record.status === "string") return record.status;
		const details = record.details;
		if (details && typeof details === "object" && !Array.isArray(details) && typeof (details as Record<string, unknown>).status === "string") return String((details as Record<string, unknown>).status);
	}
	return payload.isError === true ? "error" : undefined;
}

function failureReason(payload: Record<string, unknown>): string | undefined {
	if (typeof payload.error === "string") return payload.error;
	const result = payload.result;
	if (typeof result === "string") return result;
	if (result && typeof result === "object" && !Array.isArray(result)) {
		const record = result as Record<string, unknown>;
		if (typeof record.error === "string") return record.error;
		if (typeof record.message === "string") return record.message;
		const details = record.details;
		if (details && typeof details === "object" && !Array.isArray(details) && typeof (details as Record<string, unknown>).status === "string") return String((details as Record<string, unknown>).status);
	}
	return undefined;
}

function tableExists(db: DatabaseSync, table: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}
