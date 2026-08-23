import type { DatabaseSync } from "node:sqlite";
import type { PiboAgentObservationKind } from "../subagents/tool.js";
import { createDebugPayloadStore, hydrateDebugEventRow } from "./persisted-payloads.js";
import { eventAttributes, eventPayload, type DebugEventRow } from "./payloads.js";
import { openReadOnlyDebugDatabase, withStorePath } from "./sql.js";
import { resolveDebugStore, type ResolvedPiboDebugStore } from "./stores.js";

export type DebugAgentStatus = "running" | "idle" | "killed";

export type DebugAgentRow = {
	agentId: string;
	name: string;
	profile: string;
	threadKey?: string;
	status: DebugAgentStatus;
	createdAt: string;
	updatedAt: string;
	activeModel?: unknown;
};

export type DebugAgentObservation = {
	streamId: number;
	createdAt: string;
	agentId: string;
	name: string;
	threadKey?: string;
	eventType: string;
	kind: PiboAgentObservationKind;
	role?: string;
	text?: string;
	toolName?: string;
	toolCallId?: string;
	isError?: boolean;
	details?: unknown;
};

export type DebugAgentObserveOptions = {
	agentIds?: string[];
	names?: string[];
	threadKeys?: string[];
	eventTypes?: string[];
	kinds?: PiboAgentObservationKind[];
	since?: string;
	until?: string;
	textContains?: string;
	afterSequence?: number;
	order?: "asc" | "desc";
	limit?: number;
	includeDetails?: boolean;
};

export type DebugAgentObserveResult = {
	parentPiboSessionId: string;
	filters: DebugAgentObserveOptions;
	observations: DebugAgentObservation[];
	nextAfterSequence: number;
	truncated: boolean;
};

type SessionRow = {
	id: string;
	profile: string;
	status: string;
	metadata_json: string;
	active_model_json: string | null;
	created_at: string;
	updated_at: string;
};

type AgentEventRow = DebugEventRow & {
	profile: string;
	metadata_json: string;
};

export async function runDebugAgentsCli(args: string[]): Promise<void> {
	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printDebugAgentsDiscovery();
		return;
	}
	const parentPiboSessionId = args[0]!;
	const command = args[1];
	if (!command || command === "--help" || command === "-h") {
		printDebugAgentsDiscovery();
		return;
	}
	const parsed = parseAgentDebugOptions(args.slice(2));
	const store = resolveDebugStore("pibo-data");
	if (command === "list") {
		const agents = inspectDebugAgentList(parentPiboSessionId, store, {
			name: parsed.names[0],
			status: parsed.status,
		});
		if (parsed.json) console.log(JSON.stringify({ parentPiboSessionId, agents }, null, 2));
		else console.log(formatDebugAgentList(parentPiboSessionId, agents));
		return;
	}
	if (command === "observe") {
		const result = inspectDebugAgentObservations(parentPiboSessionId, store, {
			agentIds: parsed.agentIds.length ? parsed.agentIds : undefined,
			names: parsed.names.length ? parsed.names : undefined,
			threadKeys: parsed.threadKeys.length ? parsed.threadKeys : undefined,
			eventTypes: parsed.eventTypes.length ? parsed.eventTypes : undefined,
			kinds: parsed.kinds.length ? parsed.kinds : undefined,
			since: parsed.since,
			until: parsed.until,
			textContains: parsed.textContains,
			afterSequence: parsed.afterSequence,
			order: parsed.order,
			limit: parsed.limit,
			includeDetails: parsed.details,
		});
		if (parsed.json) console.log(JSON.stringify(result, null, 2));
		else console.log(formatDebugAgentObservations(result));
		return;
	}
	throw new Error(`Unknown pibo debug agents command "${command}". Run pibo debug agents --help.`);
}

export function inspectDebugAgentList(
	parentPiboSessionId: string,
	store: ResolvedPiboDebugStore,
	options: { name?: string; status?: DebugAgentStatus } = {},
): DebugAgentRow[] {
	if (!store.exists) throw new Error(`Debug store "pibo-data" not found at ${store.path}`);
	const db = openReadOnlyDebugDatabase(store);
	try {
		return readOwnedAgents(db, parentPiboSessionId)
			.filter((agent) => !options.name || agent.name === options.name)
			.filter((agent) => !options.status || agent.status === options.status);
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

export function inspectDebugAgentObservations(
	parentPiboSessionId: string,
	store: ResolvedPiboDebugStore,
	input: DebugAgentObserveOptions = {},
): DebugAgentObserveResult {
	if (!store.exists) throw new Error(`Debug store "pibo-data" not found at ${store.path}`);
	const db = openReadOnlyDebugDatabase(store);
	try {
		const order = input.order ?? "asc";
		const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
		const since = parseTimestamp(input.since, "since");
		const until = parseTimestamp(input.until, "until");
		if (since !== undefined && until !== undefined && since > until) throw new Error("Agent observation since must not be after until.");
		const owned = readOwnedAgents(db, parentPiboSessionId);
		const ownedById = new Map(owned.map((agent) => [agent.agentId, agent]));
		for (const agentId of input.agentIds ?? []) {
			if (!ownedById.has(agentId)) throw new Error(`Agent "${agentId}" is not owned by Pibo session "${parentPiboSessionId}".`);
		}
		const agentIds = input.agentIds ? new Set(input.agentIds) : undefined;
		const names = input.names ? new Set(input.names) : undefined;
		const threadKeys = input.threadKeys ? new Set(input.threadKeys) : undefined;
		const eventTypes = input.eventTypes ? new Set(input.eventTypes) : undefined;
		const kinds = input.kinds ? new Set(input.kinds) : undefined;
		const payloadStore = createDebugPayloadStore(db, store);
		const rows = db.prepare(`
			SELECT e.stream_id, e.session_id, e.session_sequence, e.event_id, e.type, e.created_at,
				e.payload_ref, e.preview_text, e.attributes_json, s.profile, s.metadata_json
			FROM event_log e
			JOIN sessions s ON s.id = e.session_id
			WHERE s.parent_id = ? AND s.channel = 'pibo.subagents' AND s.kind = 'subagent' AND s.deleted_at IS NULL
			ORDER BY e.stream_id ASC
		`).all(parentPiboSessionId) as AgentEventRow[];
		const textContains = input.textContains?.toLocaleLowerCase();
		const matches = rows.flatMap((rawRow) => {
			const agent = ownedById.get(rawRow.session_id ?? "");
			if (!agent) return [];
			if (agentIds && !agentIds.has(agent.agentId)) return [];
			if (names && !names.has(agent.name)) return [];
			if (threadKeys && (!agent.threadKey || !threadKeys.has(agent.threadKey))) return [];
			if (eventTypes && !eventTypes.has(rawRow.type)) return [];
			const kind = observationKind(rawRow.type);
			if (kinds && !kinds.has(kind)) return [];
			if (input.afterSequence !== undefined && rawRow.stream_id <= input.afterSequence) return [];
			const createdAt = Date.parse(rawRow.created_at);
			if (since !== undefined && createdAt < since) return [];
			if (until !== undefined && createdAt > until) return [];
			const row = hydrateDebugEventRow(rawRow, payloadStore) as AgentEventRow;
			const payload = { ...eventAttributes(row), ...eventPayload(row) };
			const text = observationText(row, payload);
			if (textContains && !(text ?? "").toLocaleLowerCase().includes(textContains)) return [];
			return [{
				streamId: row.stream_id,
				createdAt: row.created_at,
				agentId: agent.agentId,
				name: agent.name,
				...(agent.threadKey ? { threadKey: agent.threadKey } : {}),
				eventType: row.type,
				kind,
				...(observationRole(row.type, payload) ? { role: observationRole(row.type, payload) } : {}),
				...(text ? { text } : {}),
				...(typeof payload.toolName === "string" ? { toolName: payload.toolName } : {}),
				...(typeof payload.toolCallId === "string" ? { toolCallId: payload.toolCallId } : {}),
				...(row.type === "tool_execution_finished" ? { isError: payload.isError === true } : row.type === "session_error" ? { isError: true } : {}),
				...(input.includeDetails === true ? { details: payload } : {}),
			} satisfies DebugAgentObservation];
		});
		matches.sort((left, right) => order === "asc" ? left.streamId - right.streamId : right.streamId - left.streamId);
		const observations = matches.slice(0, limit);
		return {
			parentPiboSessionId,
			filters: { ...input, order, limit, includeDetails: input.includeDetails === true },
			observations,
			nextAfterSequence: observations.reduce((maximum, observation) => Math.max(maximum, observation.streamId), input.afterSequence ?? 0),
			truncated: matches.length > observations.length,
		};
	} catch (error) {
		throw withStorePath(error, store);
	} finally {
		db.close();
	}
}

function readOwnedAgents(db: DatabaseSync, parentPiboSessionId: string): DebugAgentRow[] {
	const rows = db.prepare(`
		SELECT id, profile, status, metadata_json, active_model_json, created_at, updated_at
		FROM sessions
		WHERE parent_id = ? AND channel = 'pibo.subagents' AND kind = 'subagent' AND deleted_at IS NULL
		ORDER BY updated_at DESC
	`).all(parentPiboSessionId) as SessionRow[];
	return rows.map((row) => {
		const metadata = parseObject(row.metadata_json);
		const killed = metadata.agentStatus === "killed";
		return {
			agentId: row.id,
			name: typeof metadata.subagentName === "string" ? metadata.subagentName : row.profile,
			profile: row.profile,
			...(typeof metadata.threadKey === "string" ? { threadKey: metadata.threadKey } : {}),
			status: killed ? "killed" : isRunningStatus(row.status) ? "running" : "idle",
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			...(row.active_model_json ? { activeModel: JSON.parse(row.active_model_json) } : {}),
		};
	});
}

function observationKind(type: string): PiboAgentObservationKind {
	if (["message_queued", "message_steered", "message_started", "assistant_message", "message_finished"].includes(type)) return "message";
	if (type.startsWith("thinking_")) return "thinking";
	if (type.startsWith("tool_") || type === "subagent_session") return "tool";
	if (type === "session_error") return "error";
	if (type === "execution_result" || type.startsWith("compaction_")) return "lifecycle";
	return "event";
}

function observationRole(type: string, payload: Record<string, unknown>): string | undefined {
	if (type === "assistant_message" || type === "assistant_delta" || type.startsWith("thinking_")) return "assistant";
	if (type === "message_queued" || type === "message_steered" || type === "message_started") return typeof payload.source === "string" ? payload.source : "actor";
	if (type.startsWith("tool_")) return "tool";
	if (type === "subagent_session") return "agent";
	if (type === "session_error" || type === "execution_result" || type.startsWith("compaction_")) return "system";
	return undefined;
}

function observationText(row: DebugEventRow, payload: Record<string, unknown>): string | undefined {
	if (typeof payload.text === "string") return payload.text;
	if (typeof payload.inlineText === "string") return payload.inlineText;
	if (payload.inlinePayload !== undefined) return stringify(payload.inlinePayload);
	if (typeof payload.error === "string") return payload.error;
	if (payload.result !== undefined) return stringify(payload.result);
	if (payload.partialResult !== undefined) return stringify(payload.partialResult);
	if (payload.args !== undefined) return stringify(payload.args);
	return row.preview_text ?? undefined;
}

function stringify(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value);
}

function parseObject(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function parseTimestamp(value: string | undefined, label: string): number | undefined {
	if (value === undefined) return undefined;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) throw new Error(`Agent observation ${label} must be a valid ISO-8601 timestamp.`);
	return timestamp;
}

function isRunningStatus(status: string): boolean {
	return ["running", "streaming", "queued", "starting", "waiting", "blocked", "retrying"].includes(status);
}

function formatDebugAgentList(parentPiboSessionId: string, agents: DebugAgentRow[]): string {
	if (agents.length === 0) return `parent: ${parentPiboSessionId}\nagents: 0`;
	return [
		`parent: ${parentPiboSessionId}`,
		"agentId\tname\tprofile\tthreadKey\tstatus\tupdatedAt",
		...agents.map((agent) => `${agent.agentId}\t${agent.name}\t${agent.profile}\t${agent.threadKey ?? ""}\t${agent.status}\t${agent.updatedAt}`),
		`agents: ${agents.length}`,
	].join("\n");
}

function formatDebugAgentObservations(result: DebugAgentObserveResult): string {
	if (result.observations.length === 0) return `parent: ${result.parentPiboSessionId}\nobservations: 0\nnextAfterSequence: ${result.nextAfterSequence}`;
	return [
		`parent: ${result.parentPiboSessionId}`,
		"streamId\tcreatedAt\tagentId\tname\teventType\tkind\ttext",
		...result.observations.map((observation) => `${observation.streamId}\t${observation.createdAt}\t${observation.agentId}\t${observation.name}\t${observation.eventType}\t${observation.kind}\t${(observation.text ?? "").replaceAll("\n", "\\n")}`),
		`observations: ${result.observations.length}${result.truncated ? " (limited)" : ""}`,
		`nextAfterSequence: ${result.nextAfterSequence}`,
	].join("\n");
}

function printDebugAgentsDiscovery(): void {
	console.log(`pibo debug agents - inspect delegated child agents

Usage:
  pibo debug agents <parent-session-id> list [--name name] [--status running|idle|killed] [--json]
  pibo debug agents <parent-session-id> observe [--agent-id ps_...] [--name name] [--thread-key key]
    [--event-type type] [--kind message|thinking|tool|error|lifecycle|event]
    [--since iso] [--until iso] [--contains text] [--after-sequence n]
    [--order asc|desc] [--limit 1..200] [--details] [--json]

Repeat --agent-id, --name, --thread-key, --event-type, or --kind to form an OR filter within that field.
Different filter fields combine with AND.

Next:
  pibo debug agents ps_... list
  pibo debug agents ps_... observe --kind tool --limit 20
`);
}

type ParsedAgentDebugOptions = {
	json: boolean;
	details: boolean;
	agentIds: string[];
	names: string[];
	threadKeys: string[];
	eventTypes: string[];
	kinds: PiboAgentObservationKind[];
	status?: DebugAgentStatus;
	since?: string;
	until?: string;
	textContains?: string;
	afterSequence?: number;
	order?: "asc" | "desc";
	limit?: number;
};

function parseAgentDebugOptions(args: string[]): ParsedAgentDebugOptions {
	const parsed: ParsedAgentDebugOptions = { json: false, details: false, agentIds: [], names: [], threadKeys: [], eventTypes: [], kinds: [] };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === "--json") { parsed.json = true; continue; }
		if (arg === "--details") { parsed.details = true; continue; }
		const value = args[index + 1];
		if (!value) throw new Error(`${arg} requires a value`);
		if (arg === "--agent-id") parsed.agentIds.push(value);
		else if (arg === "--name") parsed.names.push(value);
		else if (arg === "--thread-key") parsed.threadKeys.push(value);
		else if (arg === "--event-type") parsed.eventTypes.push(value);
		else if (arg === "--kind") {
			if (!["message", "thinking", "tool", "error", "lifecycle", "event"].includes(value)) throw new Error(`Invalid --kind "${value}"`);
			parsed.kinds.push(value as PiboAgentObservationKind);
		} else if (arg === "--status") {
			if (!["running", "idle", "killed"].includes(value)) throw new Error(`Invalid --status "${value}"`);
			parsed.status = value as DebugAgentStatus;
		} else if (arg === "--since") parsed.since = value;
		else if (arg === "--until") parsed.until = value;
		else if (arg === "--contains") parsed.textContains = value;
		else if (arg === "--after-sequence") parsed.afterSequence = parseNonNegativeInteger(value, arg);
		else if (arg === "--order") {
			if (value !== "asc" && value !== "desc") throw new Error(`Invalid --order "${value}"`);
			parsed.order = value;
		} else if (arg === "--limit") parsed.limit = Math.max(1, Math.min(parseNonNegativeInteger(value, arg), 200));
		else throw new Error(`Unknown pibo debug agents option "${arg}"`);
		index += 1;
	}
	return parsed;
}

function parseNonNegativeInteger(value: string, option: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${option} requires a non-negative integer`);
	return parsed;
}
