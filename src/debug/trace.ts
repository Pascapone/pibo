import { DatabaseSync } from "node:sqlite";
import { buildTraceView, type PiboTraceNode, type PiboSessionTraceView } from "../apps/chat/trace.js";
import type { PiboJsonObject, PiboOutputEvent } from "../core/events.js";
import { normalizeSessionErrorDetails } from "../core/session-errors.js";
import type { PiboSession } from "../sessions/store.js";
import type { ChatWebStoredPiboEvent } from "../apps/chat/read-model.js";
import { compareTraceOrder } from "../shared/trace-order.js";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { openReadOnlyDebugDatabase, withStorePath } from "./sql.js";
import { formatNextCommands } from "./next-commands.js";

type SessionRow = {
	id: string;
	pi_session_id: string;
	channel: string;
	kind: string;
	profile: string;
	parent_id: string | null;
	origin_id: string | null;
	workspace: string | null;
	title: string | null;
	status: string;
	metadata_json: string | null;
	created_at: string;
	updated_at: string;
	last_activity_at: string;
};

type EventRow = {
	stream_id: number;
	session_id: string | null;
	session_sequence?: number | null;
	event_id: string | null;
	type: string;
	created_at: string;
	preview_text: string | null;
	attributes_json: string;
};

export type DebugTraceResult = {
	piboSessionId: string;
	piSessionId: string;
	title: string;
	status: string;
	nodes: DebugTraceNodeRow[];
	rawNodeCount: number;
	checks?: DebugTraceCheckResult;
	nextCommands?: string[];
};

export type DebugTraceNodeRow = {
	status: string;
	type: string;
	title: string;
	id: string;
	parentId?: string;
	runId?: string;
	toolCallId?: string;
	linkedPiboSessionId?: string;
	source?: string;
	stableKey?: string;
	order?: string;
	startedAt?: string;
	completedAt?: string;
	childrenCount?: number;
	depth: number;
};

export type DebugTraceNodeResult = {
	piboSessionId: string;
	resultType: "debug.trace.show";
	nodeId: string;
	node?: DebugTraceNodeRow;
	children: DebugTraceNodeRow[];
	nextCommands: string[];
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
	if (!stores.sessions.exists) throw new Error(`Debug store "sessions" not found at ${stores.sessions.path}`);
	if (!stores.chat.exists) throw new Error(`Debug store "chat" not found at ${stores.chat.path}`);

	const sessionsDb = openReadOnlyDebugDatabase(stores.sessions);
	const chatDb = stores.chat.path === stores.sessions.path ? sessionsDb : openReadOnlyDebugDatabase(stores.chat);
	try {
		const sessionRow = sessionsDb.prepare("SELECT * FROM sessions WHERE id = ?").get(piboSessionId) as
			| SessionRow
			| undefined;
		if (!sessionRow) throw new Error(`Pibo session "${piboSessionId}" not found`);

		const session = sessionFromRow(sessionRow);
		const sessions = (sessionsDb.prepare("SELECT * FROM sessions").all() as SessionRow[]).map(sessionFromRow);
		const events = tableExists(chatDb, "event_log")
			? (chatDb
					.prepare("SELECT stream_id, session_id, session_sequence, event_id, type, created_at, preview_text, attributes_json FROM event_log WHERE session_id = ? ORDER BY stream_id ASC")
					.all(piboSessionId) as EventRow[]).map(eventFromRow).filter((event): event is ChatWebStoredPiboEvent => event !== undefined)
			: [];
		const view = await buildTraceView({
			session,
			sessions,
			events,
			status: sessionRow.status === "running" || sessionRow.status === "error" ? sessionRow.status : "idle",
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
			nextCommands: buildTraceNextCommands(view.piboSessionId, filtered),
		};
	} catch (error) {
		throw withStorePath(withStorePath(error, stores.chat), stores.sessions);
	} finally {
		sessionsDb.close();
		if (chatDb !== sessionsDb) chatDb.close();
	}
}

export async function inspectDebugTraceNode(
	piboSessionId: string,
	stores: { sessions: ResolvedPiboDebugStore; chat: ResolvedPiboDebugStore },
	nodeId: string,
): Promise<DebugTraceNodeResult> {
	const trace = await inspectDebugTrace(piboSessionId, stores, {});
	const node = trace.nodes.find((item) => item.id === nodeId);
	const children = trace.nodes.filter((item) => item.parentId === nodeId);
	return {
		piboSessionId,
		resultType: "debug.trace.show",
		nodeId,
		node,
		children,
		nextCommands: node ? buildNodeNextCommands(piboSessionId, node) : [`pibo debug trace ${piboSessionId}`],
	};
}

export function formatDebugTrace(result: DebugTraceResult, options: { medium?: boolean } = {}): string {
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
	const columns = options.medium
		? ["status", "type", "title", "id", "runId", "toolCallId", "linkedPiboSessionId", "source", "stableKey", "order"]
		: ["status", "type", "title", "id", "runId", "linkedPiboSessionId"];
	lines.push(columns.join("\t"));
	for (const node of result.nodes) {
		const title = `${"  ".repeat(node.depth)}${node.title}`;
		const values: Record<string, string | undefined> = {
			status: node.status,
			type: node.type,
			title,
			id: node.id,
			runId: node.runId,
			toolCallId: node.toolCallId,
			linkedPiboSessionId: node.linkedPiboSessionId,
			source: node.source,
			stableKey: node.stableKey,
			order: node.order,
		};
		lines.push(columns.map((column) => values[column] ?? "").join("\t"));
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
	lines.push(...formatNextCommands(result.nextCommands ?? []));
	return lines.join("\n");
}

export function formatDebugTraceNode(result: DebugTraceNodeResult): string {
	if (!result.node) return [`node: not found`, ...formatNextCommands(result.nextCommands)].join("\n");
	const node = result.node;
	const lines: string[] = [];
	lines.push(`nodeId: ${node.id}`);
	lines.push(`type: ${node.type}`);
	lines.push(`title: ${node.title}`);
	lines.push(`status: ${node.status}`);
	if (node.parentId) lines.push(`parentId: ${node.parentId}`);
	if (node.startedAt) lines.push(`startedAt: ${node.startedAt}`);
	if (node.completedAt) lines.push(`completedAt: ${node.completedAt}`);
	if (node.source) lines.push(`source: ${node.source}`);
	if (node.stableKey) lines.push(`stableKey: ${node.stableKey}`);
	if (node.order) lines.push(`order: ${node.order}`);
	lines.push(`children: ${result.children.length}`);
	if (node.linkedPiboSessionId) lines.push(`linkedPiboSessionId: ${node.linkedPiboSessionId}`);
	if (node.runId) lines.push(`runId: ${node.runId}`);
	if (node.toolCallId) lines.push(`toolCallId: ${node.toolCallId}`);
	lines.push(...formatNextCommands(result.nextCommands));
	return lines.join("\n");
}

function flattenTraceNodes(nodes: PiboTraceNode[], depth = 0): DebugTraceNodeRow[] {
	return nodes.flatMap((node) => [
		{
			status: node.status,
			type: node.type,
			title: node.title,
			id: node.id,
			parentId: node.parentId,
			runId: node.runId,
			toolCallId: node.toolCallId,
			linkedPiboSessionId: node.linkedPiboSessionId,
			source: node.source,
			stableKey: node.stableKey,
			order: formatOrderKey(node),
			startedAt: node.startedAt,
			completedAt: node.completedAt,
			childrenCount: node.children.length,
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

function buildTraceNextCommands(piboSessionId: string, nodes: DebugTraceNodeRow[]): string[] {
	const errorNode = nodes.find((node) => node.status === "error");
	const firstNode = nodes[0];
	return [
		errorNode ? `pibo debug trace ${piboSessionId} show ${errorNode.id}` : firstNode ? `pibo debug trace ${piboSessionId} show ${firstNode.id}` : undefined,
		nodes.some((node) => node.status === "error") ? `pibo debug failures ${piboSessionId}` : undefined,
		`pibo debug messages ${piboSessionId} list`,
	].filter((command): command is string => Boolean(command));
}

function buildNodeNextCommands(piboSessionId: string, node: DebugTraceNodeRow): string[] {
	return [
		node.toolCallId ? `pibo debug tool ${piboSessionId} ${node.toolCallId}` : undefined,
		node.linkedPiboSessionId ? `pibo debug session ${node.linkedPiboSessionId}` : undefined,
		node.linkedPiboSessionId ? `pibo debug trace ${node.linkedPiboSessionId}` : undefined,
		`pibo debug trace ${piboSessionId} --medium`,
		`pibo debug events ${piboSessionId} --limit 20`,
	].filter((command): command is string => Boolean(command));
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
		parentId: row.parent_id ?? undefined,
		originId: row.origin_id ?? undefined,
		workspace: row.workspace ?? undefined,
		title: row.title ?? undefined,
		metadata: parseObject(row.metadata_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function eventFromRow(row: EventRow): ChatWebStoredPiboEvent | undefined {
	const payload = outputPayloadFromV2Row(row);
	if (!payload) return undefined;
	return {
		id: String(row.stream_id),
		piboSessionId: row.session_id ?? undefined,
		eventSequence: row.session_sequence ?? undefined,
		eventId: row.event_id ?? undefined,
		streamId: row.stream_id,
		type: row.type,
		createdAt: row.created_at,
		payload,
	};
}

function outputPayloadFromV2Row(row: EventRow): PiboOutputEvent | undefined {
	const attributes = parseObject(row.attributes_json);
	const inlinePayload = attributes.inlinePayload;
	if (inlinePayload && typeof inlinePayload === "object" && !Array.isArray(inlinePayload) && typeof (inlinePayload as { type?: unknown }).type === "string") {
		return inlinePayload as PiboOutputEvent;
	}
	const piboSessionId = row.session_id;
	if (!piboSessionId) return undefined;
	const base = { piboSessionId, eventId: row.event_id ?? undefined };
	if (row.type === "assistant_message") return compactObject({ ...base, type: "assistant_message", text: row.preview_text ?? "" }) as PiboOutputEvent;
	if (row.type === "message_started") return compactObject({ ...base, type: "message_started", text: row.preview_text ?? "" }) as PiboOutputEvent;
	if (row.type === "message_finished") return compactObject({ ...base, type: "message_finished" }) as PiboOutputEvent;
	if (row.type === "thinking_started") return compactObject({ ...base, type: "thinking_started" }) as PiboOutputEvent;
	if (row.type === "thinking_finished") return compactObject({ ...base, type: "thinking_finished", text: row.preview_text ?? "" }) as PiboOutputEvent;
	if (row.type === "tool_call") return compactObject({ ...base, type: "tool_call", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: inlinePayload ?? null, argsComplete: booleanAttribute(attributes, "argsComplete") ?? true }) as PiboOutputEvent;
	if (row.type === "tool_execution_started") return compactObject({ ...base, type: "tool_execution_started", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: inlinePayload ?? null }) as PiboOutputEvent;
	if (row.type === "tool_execution_updated") return compactObject({ ...base, type: "tool_execution_updated", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", args: null, partialResult: inlinePayload ?? null }) as PiboOutputEvent;
	if (row.type === "tool_execution_finished") return compactObject({ ...base, type: "tool_execution_finished", toolCallId: stringAttribute(attributes, "toolCallId") ?? row.event_id ?? `tool_${row.stream_id}`, toolName: row.preview_text ?? stringAttribute(attributes, "toolName") ?? "tool", result: inlinePayload ?? null, isError: booleanAttribute(attributes, "isError") ?? false }) as PiboOutputEvent;
	if (row.type === "session_error") {
		const error = stringAttribute(attributes, "error") ?? row.preview_text ?? "Error";
		return compactObject({ ...base, type: "session_error", error, errorDetails: normalizeSessionErrorDetails(error, isRecord(attributes.errorDetails) ? attributes.errorDetails : undefined) }) as PiboOutputEvent;
	}
	return compactObject({ ...base, type: row.type }) as PiboOutputEvent;
}

function stringAttribute(attributes: PiboJsonObject, key: string): string | undefined {
	const value = attributes[key];
	return typeof value === "string" ? value : undefined;
}

function booleanAttribute(attributes: PiboJsonObject, key: string): boolean | undefined {
	const value = attributes[key];
	return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is PiboJsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactObject(value: Record<string, unknown>): PiboJsonObject {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as PiboJsonObject;
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
