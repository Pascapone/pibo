import type { DatabaseSync } from "node:sqlite";
import {
	normalizePiboAgentObservationLimit,
	piboAgentObservationDetails,
	piboAgentObservationKind,
	piboAgentObservationRole,
	piboAgentObservationText,
	type PiboAgentObservationKind,
	type PiboAgentObservationSource,
	type PiboAgentObservationToolDetail,
} from "../subagents/observations.js";
import {
	preparePiboAgentObservationQuery,
	selectPiboAgentObservationPage,
} from "../subagents/observation-query.js";
import type { PiboAgentObservation, PiboAgentObserveInput } from "../subagents/tool.js";
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

export type DebugAgentObservation = Omit<PiboAgentObservation, "sequence"> & {
	streamId: number;
};

export type DebugAgentObserveOptions = Omit<PiboAgentObserveInput, "requestIds" | "cursorMode">;

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
		printDebugAgentsDiscovery(parentPiboSessionId);
		return;
	}
	if (command !== "list" && command !== "observe") {
		throw new Error(`Unknown pibo debug agents command "${command}". Run pibo debug agents ${parentPiboSessionId} --help.`);
	}
	if (args.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
		printDebugAgentsCommandHelp(parentPiboSessionId, command);
		return;
	}
	const parsed = parseAgentDebugOptions(args.slice(2));
	validateAgentDebugOptions(command, parsed);
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
	const result = inspectDebugAgentObservations(parentPiboSessionId, store, {
		toolCallIds: parsed.toolCallIds.length ? parsed.toolCallIds : undefined,
		agentIds: parsed.agentIds.length ? parsed.agentIds : undefined,
		names: parsed.names.length ? parsed.names : undefined,
		threadKeys: parsed.threadKeys.length ? parsed.threadKeys : undefined,
		eventTypes: parsed.eventTypes.length ? parsed.eventTypes : undefined,
		kinds: parsed.kinds.length ? parsed.kinds : undefined,
		roles: parsed.roles.length ? parsed.roles : undefined,
		since: parsed.since,
		until: parsed.until,
		textContains: parsed.textContains,
		textRegex: parsed.textRegex,
		afterSequence: parsed.afterSequence,
		order: parsed.order,
		limit: parsed.limit,
		includeTools: parsed.includeTools || undefined,
		toolDetail: parsed.toolDetail,
		includeDetails: parsed.details,
	});
	if (parsed.json) console.log(JSON.stringify(result, null, 2));
	else console.log(formatDebugAgentObservations(result));
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
		const query = preparePiboAgentObservationQuery({ ...input, cursorMode: "history" });
		const owned = readOwnedAgents(db, parentPiboSessionId);
		const ownedById = new Map(owned.map((agent) => [agent.agentId, agent]));
		for (const agentId of input.agentIds ?? []) {
			if (!ownedById.has(agentId)) throw new Error(`Agent "${agentId}" is not owned by Pibo session "${parentPiboSessionId}".`);
		}
		const payloadStore = createDebugPayloadStore(db, store);
		const clauses = ["s.parent_id = ?", "s.channel = 'pibo.subagents'", "s.kind = 'subagent'", "s.deleted_at IS NULL"];
		const values: Array<string | number> = [parentPiboSessionId];
		if (query.afterSequence !== undefined) {
			clauses.push("e.stream_id > ?");
			values.push(query.afterSequence);
		}
		if (query.scanEventTypes && query.scanEventTypes.length > 0) {
			clauses.push(`e.type IN (${query.scanEventTypes.map(() => "?").join(", ")})`);
			values.push(...query.scanEventTypes);
		}
		const statement = db.prepare(`
			SELECT e.stream_id, e.session_id, e.session_sequence, e.event_id, e.type, e.created_at,
				e.payload_ref, e.preview_text, e.attributes_json, s.profile, s.metadata_json
			FROM event_log e
			JOIN sessions s ON s.id = e.session_id
			WHERE ${clauses.join(" AND ")}
			ORDER BY e.stream_id ${query.scanOrder.toUpperCase()}
		`);
		function* normalizedObservations(): IterableIterator<PiboAgentObservation> {
			for (const rawRow of statement.iterate(...values) as IterableIterator<AgentEventRow>) {
				const agent = ownedById.get(rawRow.session_id ?? "");
				if (!agent) continue;
				const row = hydrateDebugEventRow(rawRow, payloadStore) as AgentEventRow;
				const attributes = eventAttributes(row);
				const payload = { ...attributes, ...eventPayload(row) };
				const source = debugAgentObservationSource(row, attributes);
				const text = piboAgentObservationText(source);
				const role = piboAgentObservationRole(source);
				yield {
					sequence: row.stream_id,
					createdAt: row.created_at,
					agentId: agent.agentId,
					name: agent.name,
					...(agent.threadKey ? { threadKey: agent.threadKey } : {}),
					eventType: row.type,
					kind: piboAgentObservationKind(row.type),
					...(role ? { role } : {}),
					...(text ? { text } : {}),
					...(typeof payload.toolName === "string" ? { toolName: payload.toolName } : {}),
					...(typeof payload.toolCallId === "string" ? { toolCallId: payload.toolCallId } : {}),
					...(row.type === "tool_execution_finished" ? { isError: payload.isError === true } : row.type === "session_error" ? { isError: true } : {}),
					details: piboAgentObservationDetails(debugAgentObservationDetails(row, payload, source)),
				};
			}
		}
		const page = selectPiboAgentObservationPage(normalizedObservations(), query);
		return {
			parentPiboSessionId,
			filters: page.filters,
			observations: page.observations.map(({ sequence, ...observation }) => ({
				streamId: sequence,
				...observation,
			})),
			nextAfterSequence: page.nextAfterSequence,
			truncated: page.truncated,
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

function debugAgentObservationSource(row: DebugEventRow, attributes: Record<string, unknown>): PiboAgentObservationSource {
	const inlinePayload = attributes.inlinePayload;
	const source: PiboAgentObservationSource = {
		eventType: row.type,
		fallbackText: row.preview_text ?? row.type,
		...(typeof attributes.source === "string" ? { source: attributes.source } : {}),
	};
	if (row.type === "message_queued" || row.type === "message_steered" || row.type === "message_started") {
		source.text = typeof attributes.inlineText === "string" ? attributes.inlineText : row.preview_text ?? undefined;
	} else if (row.type === "assistant_message" || row.type === "assistant_delta" || row.type === "thinking_delta" || row.type === "thinking_finished") {
		source.text = typeof inlinePayload === "string" ? inlinePayload : row.preview_text ?? undefined;
	} else if (row.type === "session_error") {
		source.error = attributes.error;
	} else if (row.type === "tool_call" || row.type === "tool_execution_started") {
		source.args = inlinePayload;
	} else if (row.type === "tool_execution_updated") {
		source.partialResult = inlinePayload;
	} else if (row.type === "tool_execution_finished" || row.type === "execution_result" || row.type === "compaction_end") {
		source.result = inlinePayload;
	}
	if (row.type === "execution_result") source.action = attributes.action;
	if (row.type === "compaction_start" || row.type === "compaction_end") source.reason = attributes.reason;
	if (row.type === "subagent_session") source.subagentName = attributes.subagentName;
	return source;
}

function debugAgentObservationDetails(
	row: DebugEventRow,
	payload: Record<string, unknown>,
	source: PiboAgentObservationSource,
): Record<string, unknown> {
	return {
		type: row.type,
		...(row.session_id ? { piboSessionId: row.session_id } : {}),
		...(row.event_id ? { eventId: row.event_id } : {}),
		...payload,
		...(source.args !== undefined ? { args: source.args } : {}),
		...(source.partialResult !== undefined ? { partialResult: source.partialResult } : {}),
		...(source.result !== undefined ? { result: source.result } : {}),
	};
}

function parseObject(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
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

function printDebugAgentsDiscovery(parentPiboSessionId = "<parent-session-id>"): void {
	console.log(`pibo debug agents - inspect delegated child agents

Usage:
  pibo debug agents ${parentPiboSessionId} <command>

Commands:
  list      List child agents owned by the parent session.
  observe   Read persisted child-agent observations.

Next:
  pibo debug agents ${parentPiboSessionId} list --help
  pibo debug agents ${parentPiboSessionId} observe --help
`);
}

function printDebugAgentsCommandHelp(parentPiboSessionId: string, command: "list" | "observe"): void {
	if (command === "list") {
		console.log(`pibo debug agents ${parentPiboSessionId} list

Usage:
  pibo debug agents ${parentPiboSessionId} list [--name name] [--status running|idle|killed] [--json]

Filters use exact values. The command inspects only direct pibo.subagents children owned by the parent session.`);
		return;
	}
	console.log(`pibo debug agents ${parentPiboSessionId} observe

Usage:
  pibo debug agents ${parentPiboSessionId} observe [--tool-call-id id] [--agent-id ps_...] [--name name]
    [--thread-key key] [--event-type type] [--kind message|thinking|tool|error|lifecycle|event]
    [--role role] [--since iso] [--until iso] [--contains text] [--regex pattern] [--after-sequence n]
    [--order asc|desc] [--limit 1..200] [--include-tools]
    [--tool-detail summary|full] [--details] [--json]

Default: the newest 20 completed assistant messages; streaming deltas and tools are hidden.
The CLI is stateless history inspection. Use --after-sequence for explicit incremental polling.
Use --include-tools only for stalls, errors, or targeted diagnosis; prefer --tool-call-id when known.
Explicit --event-type or --kind
filters retain access to progress events. Repeat plural filters for OR within that field.
Different fields combine with AND. With --after-sequence, pages always consume the oldest unseen rows;
--order desc reverses only the returned page, so nextAfterSequence remains safe for polling.
--regex uses case-sensitive bundled rg/Rust-regex syntax; inline flags change case or multiline behavior.
Regex rejects NUL text and literal or escaped NUL patterns and requires the optional rg platform binary.`);
}

type ParsedAgentDebugOptions = {
	json: boolean;
	details: boolean;
	includeTools: boolean;
	toolCallIds: string[];
	agentIds: string[];
	names: string[];
	threadKeys: string[];
	eventTypes: string[];
	kinds: PiboAgentObservationKind[];
	roles: string[];
	status?: DebugAgentStatus;
	since?: string;
	until?: string;
	textContains?: string;
	textRegex?: string;
	afterSequence?: number;
	order?: "asc" | "desc";
	limit?: number;
	toolDetail?: PiboAgentObservationToolDetail;
};

function parseAgentDebugOptions(args: string[]): ParsedAgentDebugOptions {
	const parsed: ParsedAgentDebugOptions = {
		json: false,
		details: false,
		includeTools: false,
		toolCallIds: [],
		agentIds: [],
		names: [],
		threadKeys: [],
		eventTypes: [],
		kinds: [],
		roles: [],
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]!;
		if (arg === "--json") { parsed.json = true; continue; }
		if (arg === "--details") { parsed.details = true; continue; }
		if (arg === "--include-tools") { parsed.includeTools = true; continue; }
		const value = args[index + 1];
		if (!value) throw new Error(`${arg} requires a value`);
		if (arg === "--tool-call-id") parsed.toolCallIds.push(value);
		else if (arg === "--agent-id") parsed.agentIds.push(value);
		else if (arg === "--name") parsed.names.push(value);
		else if (arg === "--thread-key") parsed.threadKeys.push(value);
		else if (arg === "--event-type") parsed.eventTypes.push(value);
		else if (arg === "--kind") {
			if (!["message", "thinking", "tool", "error", "lifecycle", "event"].includes(value)) throw new Error(`Invalid --kind "${value}"`);
			parsed.kinds.push(value as PiboAgentObservationKind);
		} else if (arg === "--role") parsed.roles.push(value);
		else if (arg === "--status") {
			if (!["running", "idle", "killed"].includes(value)) throw new Error(`Invalid --status "${value}"`);
			parsed.status = value as DebugAgentStatus;
		} else if (arg === "--since") parsed.since = value;
		else if (arg === "--until") parsed.until = value;
		else if (arg === "--contains") parsed.textContains = value;
		else if (arg === "--regex") parsed.textRegex = value;
		else if (arg === "--after-sequence") parsed.afterSequence = parseNonNegativeInteger(value, arg);
		else if (arg === "--order") {
			if (value !== "asc" && value !== "desc") throw new Error(`Invalid --order "${value}"`);
			parsed.order = value;
		} else if (arg === "--limit") parsed.limit = normalizePiboAgentObservationLimit(parseNonNegativeInteger(value, arg));
		else if (arg === "--tool-detail") {
			if (value !== "summary" && value !== "full") throw new Error(`Invalid --tool-detail "${value}"`);
			parsed.toolDetail = value;
		} else throw new Error(`Unknown pibo debug agents option "${arg}"`);
		index += 1;
	}
	return parsed;
}

function validateAgentDebugOptions(command: "list" | "observe", parsed: ParsedAgentDebugOptions): void {
	if (command === "list") {
		if (parsed.names.length > 1) throw new Error("pibo debug agents list accepts at most one --name value");
		if (
			parsed.details || parsed.includeTools || parsed.toolCallIds.length > 0 || parsed.agentIds.length > 0
			|| parsed.threadKeys.length > 0 || parsed.eventTypes.length > 0 || parsed.kinds.length > 0
			|| parsed.roles.length > 0 || parsed.since !== undefined || parsed.until !== undefined
			|| parsed.textContains !== undefined || parsed.textRegex !== undefined
			|| parsed.afterSequence !== undefined || parsed.order !== undefined
			|| parsed.limit !== undefined || parsed.toolDetail !== undefined
		) throw new Error("Unsupported option for pibo debug agents list. Run the list command with --help.");
		return;
	}
	if (parsed.status !== undefined) throw new Error("--status is supported only by pibo debug agents list");
}

function parseNonNegativeInteger(value: string, option: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${option} requires a non-negative integer`);
	return parsed;
}
