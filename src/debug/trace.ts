import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { buildTraceView, type PiboTraceNode, type PiboSessionTraceView } from "../apps/chat/trace.js";
import type { AgentRuntimeHistoryEntry, AgentRuntimeHistoryInspection } from "../agent-runtime/history.js";
import type { PiboJsonObject } from "../core/events.js";
import { storedPiboEventFromV2Row, type EventLogRow } from "../apps/chat/data/chat-data-mappers.js";
import { PayloadStore } from "../data/payload-store.js";
import { createDefaultPiboPluginRegistry } from "../plugins/builtin.js";
import type { RuntimeSessionBinding } from "../sessions/runtime-binding.js";
import type { PiboSession } from "../sessions/store.js";
import type { ChatWebStoredPiboEvent } from "../apps/chat/read-model.js";
import { compareTraceNodes } from "../shared/trace-nodes.js";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { openReadOnlyDebugDatabase, withStorePath } from "./sql.js";
import { formatNextCommands } from "./next-commands.js";
import { resolveDebugTraceSessionStatus, summarizeDebugTraceStatus, type DebugTraceStatusSource } from "./trace-status.js";

type SessionRow = {
	id: string;
	pi_session_id: string | null;
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

export type DebugTraceResult = {
	piboSessionId: string;
	piSessionId: string;
	runtimeInstanceId?: string;
	runtimeAdapterId?: string;
	nativeSessionId?: string;
	runtimeBindingState?: string;
	historySource: "product" | "native" | "events";
	title: string;
	status: string;
	statusSource: DebugTraceStatusSource;
	errorNodeCount: number;
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
	options: { runningOnly?: boolean; check?: boolean; nativeHistory?: boolean } = {},
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

		const binding = readRuntimeBindingForTrace(sessionsDb, sessionRow);
		const session = { ...sessionFromRow(sessionRow), runtimeBinding: binding };
		const sessions = (sessionsDb.prepare("SELECT * FROM sessions").all() as SessionRow[]).map((row) => ({
			...sessionFromRow(row),
			runtimeBinding: readRuntimeBindingForTrace(sessionsDb, row),
		}));
		const adapterIssues: DebugTraceIssue[] = [];
		const payloadStore = tableExists(chatDb, "payloads")
			? new PayloadStore(chatDb, join(dirname(stores.chat.path), "payloads"))
			: undefined;
		const eventRows = tableExists(chatDb, "event_log")
			? chatDb.prepare("SELECT * FROM event_log WHERE session_id = ? ORDER BY stream_id ASC").all(piboSessionId) as EventLogRow[]
			: [];
		const events = eventRows.map((row) => {
			const event = storedPiboEventFromV2Row(row, payloadStore);
			if (event && (row.type === "assistant_delta" || row.type === "thinking_delta") && !nonEmptyEventText(event.payload)) {
				adapterIssues.push({
					severity: "warning",
					code: "missing_delta_text",
					nodeId: row.event_id ?? String(row.stream_id),
					message: `Persisted ${row.type} event has no readable text payload.`,
				});
			}
			return event;
		}).filter((event): event is ChatWebStoredPiboEvent => event !== undefined);
		const productHistory = readProductHistoryEntries(chatDb, payloadStore, piboSessionId);
		let nativeHistoryEntries: readonly AgentRuntimeHistoryEntry[] = [];
		let nativeHistoryInspection: AgentRuntimeHistoryInspection | undefined;
		if (options.nativeHistory || (events.length === 0 && productHistory.length === 0)) {
			const native = await readDebugNativeHistory(binding, session.workspace ?? process.cwd(), adapterIssues);
			nativeHistoryEntries = native?.entries ?? [];
			nativeHistoryInspection = native?.inspection;
		}
		const historyEntries = nativeHistoryEntries.length ? nativeHistoryEntries : productHistory;
		const historySource: DebugTraceResult["historySource"] = nativeHistoryEntries.length
			? "native"
			: productHistory.length ? "product" : "events";
		const sessionStatus = resolveDebugTraceSessionStatus(sessionRow.status, events.map((event) => event.type));
		const view = await buildTraceView({
			session,
			sessions,
			events,
			historyEntries,
			historyInspection: nativeHistoryInspection,
			status: sessionStatus.status,
		});
		const rows = flattenTraceNodes(view.nodes);
		const statusSummary = summarizeDebugTraceStatus(sessionStatus.status, rows.map((node) => node.status));
		const filtered = options.runningOnly ? rows.filter((node) => node.status === "running") : rows;
		return {
			piboSessionId: view.piboSessionId,
			piSessionId: view.piSessionId,
			runtimeInstanceId: binding?.runtimeInstanceId,
			runtimeAdapterId: binding?.adapterId,
			nativeSessionId: binding?.nativeSessionId,
			runtimeBindingState: binding?.state,
			historySource,
			title: view.title,
			status: statusSummary.status,
			statusSource: sessionStatus.source,
			errorNodeCount: statusSummary.errorNodeCount,
			nodes: filtered,
			rawNodeCount: rows.length,
			...(options.check ? { checks: checkTraceView(view, adapterIssues) } : {}),
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
		...(result.runtimeInstanceId ? [`runtimeInstanceId: ${result.runtimeInstanceId}`] : []),
		...(result.runtimeAdapterId ? [`runtimeAdapterId: ${result.runtimeAdapterId}`] : []),
		...(result.nativeSessionId ? [`nativeSessionId: ${result.nativeSessionId}`] : []),
		...(result.runtimeBindingState ? [`runtimeBindingState: ${result.runtimeBindingState}`] : []),
		`historySource: ${result.historySource}`,
		`title: ${result.title}`,
		`status: ${result.status}`,
		`statusSource: ${result.statusSource}`,
		`nodeErrors: ${result.errorNodeCount}`,
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

export function checkTraceView(view: PiboSessionTraceView, adapterIssues: readonly DebugTraceIssue[] = []): DebugTraceCheckResult {
	const issues: DebugTraceIssue[] = [...adapterIssues];
	const all = flattenPiboTraceNodes(view.nodes);
	const ids = new Set<string>();
	const stableKeyOwners = new Map<string, string>();
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
		} else {
			const existingOwner = stableKeyOwners.get(node.stableKey);
			if (existingOwner && existingOwner !== node.id) {
				issues.push({
					severity: "warning",
					code: "duplicate_stable_key",
					nodeId: node.id,
					message: `Stable key "${node.stableKey}" is already used by node "${existingOwner}".`,
				});
			} else {
				stableKeyOwners.set(node.stableKey, node.id);
			}
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
	return compareTraceNodes(left, right);
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
		piSessionId: row.pi_session_id ?? "",
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

type DebugHistoryMessageRow = {
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

function readProductHistoryEntries(
	db: DatabaseSync,
	payloadStore: PayloadStore | undefined,
	piboSessionId: string,
): AgentRuntimeHistoryEntry[] {
	if (!tableExists(db, "chat_messages")) return [];
	const rows = db.prepare(`
		SELECT m.*, e.session_sequence AS event_sequence
		FROM chat_messages m
		LEFT JOIN event_log e ON e.stream_id = m.source_stream_id
		WHERE m.session_id = ? AND m.role IN ('user', 'assistant', 'system')
		ORDER BY m.sequence ASC
		LIMIT 2000
	`).all(piboSessionId) as DebugHistoryMessageRow[];
	return rows.flatMap((row) => {
		const role = row.role === "user" || row.role === "assistant" || row.role === "system" ? row.role : undefined;
		if (!role) return [];
		const attributes = parseObject(row.attributes_json);
		let content = typeof attributes.inlineText === "string" ? attributes.inlineText : row.content_preview ?? "";
		if (row.content_payload_ref && payloadStore) {
			try {
				content = payloadStore.readPayloadText(row.content_payload_ref);
			} catch {
				// Keep the bounded preview and let trace checks report any missing event payload separately.
			}
		}
		return [{
			id: `product:${row.id}`,
			type: "message" as const,
			source: "product" as const,
			createdAt: row.created_at,
			sequence: row.event_sequence ?? row.sequence,
			turnId: row.turn_id ?? undefined,
			role,
			content,
			assistantIndex: numberAttribute(attributes, "assistantIndex"),
			contentIndex: numberAttribute(attributes, "contentIndex"),
			status: row.status === "running" || row.status === "streaming"
				? "running" as const
				: row.status === "error" || row.status === "failed" ? "error" as const : "complete" as const,
		} satisfies AgentRuntimeHistoryEntry];
	});
}

async function readDebugNativeHistory(
	binding: RuntimeSessionBinding | undefined,
	workspace: string,
	issues: DebugTraceIssue[],
) {
	if (!binding) return undefined;
	const registry = createDefaultPiboPluginRegistry();
	const adapter = registry.getAgentRuntimeAdapter(binding.runtimeInstanceId);
	if (!adapter?.descriptor.capabilities.maintenance.history || !adapter.readHistory) {
		issues.push({
			severity: "warning",
			code: "runtime_history_provider_unavailable",
			message: `Runtime instance "${binding.runtimeInstanceId}" has no locally registered history provider.`,
		});
		return undefined;
	}
	try {
		return await adapter.readHistory({ binding, workspace, limit: 500 });
	} catch (error) {
		issues.push({
			severity: "warning",
			code: "runtime_history_read_failed",
			message: redactRuntimeHistoryError(error),
		});
		return undefined;
	}
}

function readRuntimeBindingForTrace(db: DatabaseSync, session: SessionRow): RuntimeSessionBinding | undefined {
	if (!tableExists(db, "session_runtime_bindings")) {
		return {
			piboSessionId: session.id,
			runtimeInstanceId: "pi",
			adapterId: "pi",
			nativeSessionId: session.pi_session_id ?? undefined,
			state: session.pi_session_id ? "bound" : "unbound",
			protocol: "pi-sdk",
			metadata: { source: "legacy-synthesized" },
			revision: 1,
			createdAt: session.created_at,
			updatedAt: session.updated_at,
		};
	}
	const row = db.prepare("SELECT * FROM session_runtime_bindings WHERE pibo_session_id = ?").get(session.id) as {
		pibo_session_id: string;
		runtime_instance_id: string;
		runtime_adapter_id: string;
		native_session_id: string | null;
		binding_state: RuntimeSessionBinding["state"];
		protocol: string | null;
		protocol_version: string | null;
		adapter_version: string | null;
		locator_json: string | null;
		metadata_json: string;
		revision: number;
		created_at: string;
		updated_at: string;
	} | undefined;
	if (!row) return undefined;
	const locator = parseObject(row.locator_json);
	return {
		piboSessionId: row.pibo_session_id,
		runtimeInstanceId: row.runtime_instance_id,
		adapterId: row.runtime_adapter_id,
		nativeSessionId: row.native_session_id ?? undefined,
		state: row.binding_state,
		protocol: row.protocol ?? undefined,
		protocolVersion: row.protocol_version ?? undefined,
		adapterVersion: row.adapter_version ?? undefined,
		locator: typeof locator.kind === "string" ? locator as RuntimeSessionBinding["locator"] : undefined,
		metadata: parseObject(row.metadata_json),
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function numberAttribute(attributes: PiboJsonObject, key: string): number | undefined {
	const value = attributes[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyEventText(event: unknown): boolean {
	const text = event && typeof event === "object" ? (event as { text?: unknown }).text : undefined;
	return typeof text === "string" && text.length > 0;
}

function redactRuntimeHistoryError(error: unknown): string {
	return (error instanceof Error ? error.message : String(error))
		.replace(/(bearer|token|secret|password|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
		.replace(/\/\/[^\s/@:]+:[^\s/@]+@/g, "//[redacted]@")
		.slice(0, 500);
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
