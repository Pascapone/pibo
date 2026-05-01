import { DatabaseSync } from "node:sqlite";
import { buildTraceView, type PiboTraceNode, type PiboSessionTraceView } from "../apps/chat/trace.js";
import type { PiboJsonObject, PiboOutputEvent } from "../core/events.js";
import type { PiboSession } from "../sessions/store.js";
import type { ChatWebStoredEvent } from "../apps/chat/read-model.js";
import { compareTraceOrder } from "../shared/trace-order.js";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { openReadOnlyDebugDatabase, withStorePath } from "./sql.js";

type SessionRow = {
	id: string;
	pi_session_id: string;
	channel: string;
	kind: string;
	profile: string;
	owner_scope: string | null;
	parent_id: string | null;
	origin_id: string | null;
	workspace: string | null;
	title: string | null;
	metadata_json: string | null;
	created_at: string;
	updated_at: string;
};

type ChatSessionRow = {
	status: string;
};

type EventRow = {
	id: string;
	pibo_session_id: string;
	event_sequence?: number | null;
	event_id: string | null;
	type: string;
	created_at: string;
	payload_json: string;
};

export type DebugTraceResult = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	status: string;
	nodes: DebugTraceNodeRow[];
	rawNodeCount: number;
	checks?: DebugTraceCheckResult;
};

export type DebugTraceNodeRow = {
	status: string;
	type: string;
	title: string;
	id: string;
	runId?: string;
	toolCallId?: string;
	linkedPiboSessionId?: string;
	source?: string;
	stableKey?: string;
	order?: string;
	startedAt?: string;
	completedAt?: string;
	depth: number;
};

export type DebugTraceCheckResult = {
	status: "ok" | "warning";
	issues: DebugTraceIssue[];
};

export type DebugTraceIssue = {
	severity: "warning";
	code: string;
	message: string;
	nodeId?: string;
};

export async function inspectDebugTrace(
	piboSessionId: string,
	stores: { sessions: ResolvedPiboDebugStore; chat: ResolvedPiboDebugStore },
	options: { runningOnly?: boolean; check?: boolean } = {},
): Promise<DebugTraceResult> {
	if (!stores.sessions.exists) throw new Error(`Debug store "sessions" not found at ${stores.sessions.defaultPath}`);
	if (!stores.chat.exists) throw new Error(`Debug store "chat" not found at ${stores.chat.defaultPath}`);

	const sessionsDb = openReadOnlyDebugDatabase(stores.sessions);
	const chatDb = openReadOnlyDebugDatabase(stores.chat);
	try {
		const sessionRow = sessionsDb.prepare("SELECT * FROM pibo_sessions WHERE id = ?").get(piboSessionId) as
			| SessionRow
			| undefined;
		if (!sessionRow) throw new Error(`Pibo session "${piboSessionId}" not found`);

		const session = sessionFromRow(sessionRow);
		const sessions = (sessionsDb.prepare("SELECT * FROM pibo_sessions").all() as SessionRow[]).map(sessionFromRow);
		const chatRow = tableExists(chatDb, "web_chat_sessions")
			? (chatDb.prepare("SELECT status FROM web_chat_sessions WHERE pibo_session_id = ?").get(piboSessionId) as
					| ChatSessionRow
					| undefined)
			: undefined;
		const events = tableExists(chatDb, "web_chat_events")
			? (chatDb
					.prepare("SELECT * FROM web_chat_events WHERE pibo_session_id = ? ORDER BY rowid ASC")
					.all(piboSessionId) as EventRow[]).map(eventFromRow)
			: [];
		const view = await buildTraceView({
			session,
			sessions,
			events,
			status: chatRow?.status === "running" || chatRow?.status === "error" ? chatRow.status : "idle",
		});
		const rows = flattenTraceNodes(view.nodes);
		const filtered = options.runningOnly ? rows.filter((node) => node.status === "running") : rows;
		return {
			piboSessionId: view.piboSessionId,
			piSessionId: view.piSessionId,
			title: view.title,
			status: traceStatus(view),
			nodes: filtered,
			rawNodeCount: rows.length,
			...(options.check ? { checks: checkTraceView(view) } : {}),
		};
	} catch (error) {
		throw withStorePath(withStorePath(error, stores.chat), stores.sessions);
	} finally {
		sessionsDb.close();
		chatDb.close();
	}
}

export function formatDebugTrace(result: DebugTraceResult): string {
	const lines = [
		`piboSessionId: ${result.piboSessionId}`,
		`piSessionId: ${result.piSessionId}`,
		`title: ${result.title}`,
		`status: ${result.status}`,
		"",
	];
	if (result.nodes.length === 0) {
		lines.push("nodes: 0");
		return lines.join("\n");
	}
	lines.push("status\ttype\ttitle\tid\trunId\tlinkedPiboSessionId");
	for (const node of result.nodes) {
		const title = `${"  ".repeat(node.depth)}${node.title}`;
		lines.push(
			[
				node.status,
				node.type,
				title,
				node.id,
				node.runId ?? "",
				node.linkedPiboSessionId ?? "",
			].join("\t"),
		);
	}
	lines.push(`nodes: ${result.nodes.length}${result.nodes.length !== result.rawNodeCount ? ` of ${result.rawNodeCount}` : ""}`);
	if (result.checks) {
		lines.push("");
		lines.push(`checks: ${result.checks.status}`);
		for (const issue of result.checks.issues) {
			lines.push(`${issue.severity}\t${issue.code}\t${issue.nodeId ?? ""}\t${issue.message}`);
		}
		if (result.checks.issues.length === 0) lines.push("issues: 0");
	}
	return lines.join("\n");
}

function flattenTraceNodes(nodes: PiboTraceNode[], depth = 0): DebugTraceNodeRow[] {
	return nodes.flatMap((node) => [
		{
			status: node.status,
			type: node.type,
			title: node.title,
			id: node.id,
			runId: node.runId,
			toolCallId: node.toolCallId,
			linkedPiboSessionId: node.linkedPiboSessionId,
			source: node.source,
			stableKey: node.stableKey,
			order: formatOrderKey(node),
			startedAt: node.startedAt,
			completedAt: node.completedAt,
			depth,
		},
		...flattenTraceNodes(node.children, depth + 1),
	]);
}

function traceStatus(view: PiboSessionTraceView): string {
	const rows = flattenTraceNodes(view.nodes);
	if (rows.some((node) => node.status === "error")) return "error";
	if (rows.some((node) => node.status === "running")) return "running";
	return "done";
}

function checkTraceView(view: PiboSessionTraceView): DebugTraceCheckResult {
	const issues: DebugTraceIssue[] = [];
	const all = flattenPiboTraceNodes(view.nodes);
	const ids = new Set<string>();
	for (const node of all) {
		if (ids.has(node.id)) {
			issues.push({
				severity: "warning",
				code: "duplicate_id",
				nodeId: node.id,
				message: "Trace node id appears more than once.",
			});
		}
		ids.add(node.id);
		if (!node.orderKey) {
			issues.push({
				severity: "warning",
				code: "missing_order",
				nodeId: node.id,
				message: "Trace node has no stable order key and may fall back to timestamp ordering.",
			});
		}
		if (!node.source) {
			issues.push({
				severity: "warning",
				code: "missing_source",
				nodeId: node.id,
				message: "Trace node has no projection source.",
			});
		}
		if (!node.stableKey) {
			issues.push({
				severity: "warning",
				code: "missing_stable_key",
				nodeId: node.id,
				message: "Trace node has no conceptual stable key.",
			});
		}
	}
	for (const node of all) {
		if (node.parentId && !ids.has(node.parentId)) {
			issues.push({
				severity: "warning",
				code: "missing_parent",
				nodeId: node.id,
				message: `Parent "${node.parentId}" is not present in the trace tree.`,
			});
		}
	}
	checkSiblingOrder(view.nodes, issues);
	return { status: issues.length ? "warning" : "ok", issues };
}

function checkSiblingOrder(nodes: PiboTraceNode[], issues: DebugTraceIssue[]): void {
	for (let index = 1; index < nodes.length; index += 1) {
		if (compareOrder(nodes[index - 1], nodes[index]) > 0) {
			issues.push({
				severity: "warning",
				code: "order_regression",
				nodeId: nodes[index].id,
				message: `Node appears before previous sibling by stable order: ${nodes[index - 1].id}`,
			});
		}
	}
	for (const node of nodes) checkSiblingOrder(node.children, issues);
}

function compareOrder(left: PiboTraceNode, right: PiboTraceNode): number {
	return compareTraceOrder(left.orderKey, right.orderKey) || left.id.localeCompare(right.id);
}

function flattenPiboTraceNodes(nodes: PiboTraceNode[]): PiboTraceNode[] {
	return nodes.flatMap((node) => [node, ...flattenPiboTraceNodes(node.children)]);
}

function formatOrderKey(node: PiboTraceNode): string | undefined {
	const order = node.orderKey;
	if (!order) return undefined;
	return [
		`turn=${order.turnSeq}`,
		order.transcriptIndex === undefined ? undefined : `tx=${order.transcriptIndex}`,
		order.contentPartIndex === undefined ? undefined : `part=${order.contentPartIndex}`,
		order.eventSequence === undefined ? undefined : `event=${order.eventSequence}`,
		order.streamFrameIndex === undefined ? undefined : `frame=${order.streamFrameIndex}`,
		`phase=${order.phaseRank}`,
		`source=${order.sourceRank}`,
	].filter(Boolean).join(",");
}

function sessionFromRow(row: SessionRow): PiboSession {
	return {
		id: row.id,
		piSessionId: row.pi_session_id,
		channel: row.channel,
		kind: row.kind,
		profile: row.profile,
		ownerScope: row.owner_scope ?? undefined,
		parentId: row.parent_id ?? undefined,
		originId: row.origin_id ?? undefined,
		workspace: row.workspace ?? undefined,
		title: row.title ?? undefined,
		metadata: parseObject(row.metadata_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function eventFromRow(row: EventRow): ChatWebStoredEvent {
	return {
		id: row.id,
		piboSessionId: row.pibo_session_id,
		eventSequence: row.event_sequence ?? undefined,
		eventId: row.event_id ?? undefined,
		type: row.type,
		createdAt: row.created_at,
		payload: JSON.parse(row.payload_json) as PiboOutputEvent,
	};
}

function tableExists(db: DatabaseSync, table: string): boolean {
	const row = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table);
	return row !== undefined;
}

function parseObject(value: string | null): PiboJsonObject {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as PiboJsonObject;
	} catch {
		return {};
	}
}
