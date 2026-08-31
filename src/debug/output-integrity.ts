import { DatabaseSync } from "node:sqlite";
import type { ResolvedPiboDebugStore } from "./stores.js";
import { normalizeLimit } from "./sql.js";

type SqlValue = string | number | bigint | Uint8Array | null;

const THINKING_INDEX_SQL = "CASE WHEN json_valid(attributes_json) THEN COALESCE(json_extract(attributes_json, '$.thinkingIndex'), json_extract(attributes_json, '$.contentIndex'), 0) ELSE 0 END";
const TOOL_CALL_ID_SQL = "CASE WHEN tool_call_id IS NOT NULL THEN tool_call_id WHEN json_valid(attributes_json) THEN json_extract(attributes_json, '$.toolCallId') END";
const TOOL_ORDINAL_SQL = "CASE WHEN json_valid(attributes_json) THEN COALESCE(json_extract(attributes_json, '$.toolInvocationOrdinal'), 0) ELSE 0 END";
const COLLISION_KEY_SQL = "CASE WHEN json_valid(attributes_json) THEN json_extract(attributes_json, '$.outputIdempotencyKey') END";
const RELIABILITY_SESSION_ID_SQL = "CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.piboSessionId'), json_extract(payload_json, '$.state.piboSessionId')) END";
const RELIABILITY_EVENT_ID_SQL = "CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.eventId'), json_extract(payload_json, '$.state.eventId')) END";

type LifecycleRow = {
	sessionId: string;
	eventId: string;
	started: number;
	finished: number;
	firstAt: string;
	lastAt: string;
};

type TurnLifecycleRow = LifecycleRow & {
	messageFinished: number;
	sessionErrors: number;
	assistantMessages: number;
};

type ThinkingLifecycleRow = LifecycleRow & {
	thinkingIndex: number;
};

type ToolLifecycleRow = LifecycleRow & {
	toolCallId: string;
	toolInvocationOrdinal: number;
	called: number;
};

type CollisionRow = {
	sessionId: string;
	eventId: string | null;
	streamId: number;
	createdAt: string;
	idempotencyKey: string | null;
};

type ReliabilityRow = {
	jobId: string;
	queue: string;
	attempts: number;
	maxAttempts: number;
	piboSessionId: string | null;
	eventId: string | null;
	lastError: string | null;
	deadReason?: string | null;
	payloadValid: number;
	updatedAt: string;
};

export type OutputIntegrityFinding = {
	kind: "turn_lifecycle" | "thinking_lifecycle" | "tool_lifecycle" | "identity_collision" | "pending_output_job" | "dead_output_job";
	piboSessionId?: string;
	eventId?: string;
	firstAt?: string;
	lastAt?: string;
	started?: number;
	finished?: number;
	called?: number;
	messageFinished?: number;
	sessionErrors?: number;
	assistantMessages?: number;
	thinkingIndex?: number;
	toolCallId?: string;
	toolInvocationOrdinal?: number;
	streamId?: number;
	idempotencyKey?: string;
	jobId?: string;
	queue?: string;
	attempts?: number;
	maxAttempts?: number;
	deadReason?: string;
	identityCollision?: boolean;
	payloadValid?: boolean;
};

export type OutputIntegrityAudit = {
	resultType: "debug.integrity.output";
	readOnly: true;
	scope: {
		piboSessionId?: string;
		before?: string;
		limit: number;
	};
	stores: {
		data: { path: string; exists: boolean };
		reliability: { path: string; exists: boolean };
	};
	summary: {
		findingCount: number;
		returnedFindings: number;
		turnLifecycleIssues: number;
		thinkingLifecycleIssues: number;
		toolLifecycleIssues: number;
		identityCollisions: number;
		pendingOutputJobs: number;
		deadOutputJobs: number;
		deadIdentityCollisions: number;
	};
	findings: OutputIntegrityFinding[];
	nextCommands: string[];
};

export function inspectOutputIntegrity(input: {
	dataStore: ResolvedPiboDebugStore;
	reliabilityStore: ResolvedPiboDebugStore;
	piboSessionId?: string;
	before?: string;
	limit?: string | number;
}): OutputIntegrityAudit {
	const limit = normalizeLimit(input.limit);
	const findings: OutputIntegrityFinding[] = [];
	let turnLifecycleIssues = 0;
	let thinkingLifecycleIssues = 0;
	let toolLifecycleIssues = 0;
	let identityCollisions = 0;
	let pendingOutputJobs = 0;
	let deadOutputJobs = 0;
	let deadIdentityCollisions = 0;

	if (input.dataStore.exists) {
		const db = new DatabaseSync(input.dataStore.path, { readOnly: true });
		try {
			if (tableExists(db, "event_log")) {
				const scope = eventScope(input.piboSessionId, input.before);
				turnLifecycleIssues = countRows(db, `
					SELECT COUNT(*) AS count FROM (
						SELECT session_id, event_id
						FROM event_log
						WHERE event_id IS NOT NULL
							AND type IN ('message_started', 'assistant_message', 'message_finished', 'session_error')
							${scope.sql}
						GROUP BY session_id, event_id
						HAVING SUM(type = 'message_started') != 1
							OR SUM(type IN ('message_finished', 'session_error')) != 1
							OR (SUM(type = 'message_finished') = 1 AND SUM(type = 'assistant_message') = 0)
					)
				`, scope.params);
				thinkingLifecycleIssues = countRows(db, `
					SELECT COUNT(*) AS count FROM (
						SELECT session_id, event_id,
							${THINKING_INDEX_SQL} AS thinking_index
						FROM event_log
						WHERE event_id IS NOT NULL
							AND type IN ('thinking_started', 'thinking_finished')
							${scope.sql}
						GROUP BY session_id, event_id, thinking_index
						HAVING SUM(type = 'thinking_started') != SUM(type = 'thinking_finished')
					)
				`, scope.params);
				toolLifecycleIssues = countRows(db, `
					SELECT COUNT(*) AS count FROM (
						SELECT session_id, event_id,
							${TOOL_CALL_ID_SQL} AS tool_call_id,
							${TOOL_ORDINAL_SQL} AS tool_invocation_ordinal
						FROM event_log
						WHERE event_id IS NOT NULL
							AND ${TOOL_CALL_ID_SQL} IS NOT NULL
							AND type IN ('tool_call', 'tool_execution_started', 'tool_execution_finished')
							${scope.sql}
						GROUP BY session_id, event_id, tool_call_id, tool_invocation_ordinal
						HAVING SUM(type = 'tool_call') != 1
							OR SUM(type = 'tool_execution_started') != 1
							OR SUM(type = 'tool_execution_finished') != 1
					)
				`, scope.params);
				identityCollisions = countRows(db, `
					SELECT COUNT(*) AS count
					FROM event_log
					WHERE type = 'pibo.output.identity_collision' ${scope.sql}
				`, scope.params);

				findings.push(...queryRows<TurnLifecycleRow>(db, `
					SELECT session_id AS sessionId, event_id AS eventId,
						SUM(type = 'message_started') AS started,
						SUM(type IN ('message_finished', 'session_error')) AS finished,
						SUM(type = 'message_finished') AS messageFinished,
						SUM(type = 'session_error') AS sessionErrors,
						SUM(type = 'assistant_message') AS assistantMessages,
						MIN(created_at) AS firstAt, MAX(created_at) AS lastAt
					FROM event_log
					WHERE event_id IS NOT NULL
						AND type IN ('message_started', 'assistant_message', 'message_finished', 'session_error')
						${scope.sql}
					GROUP BY session_id, event_id
					HAVING started != 1 OR finished != 1 OR (messageFinished = 1 AND assistantMessages = 0)
					ORDER BY lastAt DESC
					LIMIT ?
				`, [...scope.params, limit]).map((row) => ({
					kind: "turn_lifecycle" as const,
					piboSessionId: row.sessionId,
					eventId: row.eventId,
					firstAt: row.firstAt,
					lastAt: row.lastAt,
					started: row.started,
					finished: row.finished,
					messageFinished: row.messageFinished,
					sessionErrors: row.sessionErrors,
					assistantMessages: row.assistantMessages,
				})));
				findings.push(...queryRows<ThinkingLifecycleRow>(db, `
					SELECT session_id AS sessionId, event_id AS eventId,
						${THINKING_INDEX_SQL} AS thinkingIndex,
						SUM(type = 'thinking_started') AS started,
						SUM(type = 'thinking_finished') AS finished,
						MIN(created_at) AS firstAt, MAX(created_at) AS lastAt
					FROM event_log
					WHERE event_id IS NOT NULL
						AND type IN ('thinking_started', 'thinking_finished')
						${scope.sql}
					GROUP BY session_id, event_id, thinkingIndex
					HAVING started != finished
					ORDER BY lastAt DESC
					LIMIT ?
				`, [...scope.params, limit]).map((row) => ({
					kind: "thinking_lifecycle" as const,
					piboSessionId: row.sessionId,
					eventId: row.eventId,
					thinkingIndex: row.thinkingIndex,
					firstAt: row.firstAt,
					lastAt: row.lastAt,
					started: row.started,
					finished: row.finished,
				})));
				findings.push(...queryRows<ToolLifecycleRow>(db, `
					SELECT session_id AS sessionId, event_id AS eventId,
						${TOOL_CALL_ID_SQL} AS toolCallId,
						${TOOL_ORDINAL_SQL} AS toolInvocationOrdinal,
						SUM(type = 'tool_call') AS called,
						SUM(type = 'tool_execution_started') AS started,
						SUM(type = 'tool_execution_finished') AS finished,
						MIN(created_at) AS firstAt, MAX(created_at) AS lastAt
					FROM event_log
					WHERE event_id IS NOT NULL
						AND ${TOOL_CALL_ID_SQL} IS NOT NULL
						AND type IN ('tool_call', 'tool_execution_started', 'tool_execution_finished')
						${scope.sql}
					GROUP BY session_id, event_id, toolCallId, toolInvocationOrdinal
					HAVING called != 1 OR started != 1 OR finished != 1
					ORDER BY lastAt DESC
					LIMIT ?
				`, [...scope.params, limit]).map((row) => ({
					kind: "tool_lifecycle" as const,
					piboSessionId: row.sessionId,
					eventId: row.eventId,
					toolCallId: row.toolCallId,
					toolInvocationOrdinal: row.toolInvocationOrdinal,
					called: row.called,
					firstAt: row.firstAt,
					lastAt: row.lastAt,
					started: row.started,
					finished: row.finished,
				})));
				findings.push(...queryRows<CollisionRow>(db, `
					SELECT session_id AS sessionId, event_id AS eventId, stream_id AS streamId,
						created_at AS createdAt,
						${COLLISION_KEY_SQL} AS idempotencyKey
					FROM event_log
					WHERE type = 'pibo.output.identity_collision' ${scope.sql}
					ORDER BY stream_id DESC
					LIMIT ?
				`, [...scope.params, limit]).map((row) => ({
					kind: "identity_collision" as const,
					piboSessionId: row.sessionId,
					...(row.eventId ? { eventId: row.eventId } : {}),
					streamId: row.streamId,
					lastAt: row.createdAt,
					...(row.idempotencyKey ? { idempotencyKey: row.idempotencyKey } : {}),
				})));
			}
		} finally {
			db.close();
		}
	}

	if (input.reliabilityStore.exists) {
		const db = new DatabaseSync(input.reliabilityStore.path, { readOnly: true });
		try {
			const jobScope = reliabilityScope(input.piboSessionId, input.before, "updated_at");
			const deadScope = reliabilityScope(input.piboSessionId, input.before, "dead_at");
			if (tableExists(db, "pibo_jobs")) {
				pendingOutputJobs = countRows(db, `
					SELECT COUNT(*) AS count FROM pibo_jobs
					WHERE queue IN ('output-persistence', 'output-persistence-cli') ${jobScope.sql}
				`, jobScope.params);
				findings.push(...queryRows<ReliabilityRow>(db, `
					SELECT job_id AS jobId, queue, attempts, max_attempts AS maxAttempts,
						${RELIABILITY_SESSION_ID_SQL} AS piboSessionId,
						${RELIABILITY_EVENT_ID_SQL} AS eventId,
						last_error AS lastError, json_valid(payload_json) AS payloadValid, updated_at AS updatedAt
					FROM pibo_jobs
					WHERE queue IN ('output-persistence', 'output-persistence-cli') ${jobScope.sql}
					ORDER BY updated_at DESC
					LIMIT ?
				`, [...jobScope.params, limit]).map(pendingJobFinding));
			}
			if (tableExists(db, "pibo_dead_jobs")) {
				deadOutputJobs = countRows(db, `
					SELECT COUNT(*) AS count FROM pibo_dead_jobs
					WHERE queue IN ('output-persistence', 'output-persistence-cli') ${deadScope.sql}
				`, deadScope.params);
				deadIdentityCollisions = countRows(db, `
					SELECT COUNT(*) AS count FROM pibo_dead_jobs
					WHERE queue IN ('output-persistence', 'output-persistence-cli')
						AND last_error LIKE 'Pibo output identity collision for %' ${deadScope.sql}
				`, deadScope.params);
				findings.push(...queryRows<ReliabilityRow>(db, `
					SELECT job_id AS jobId, queue, attempts, max_attempts AS maxAttempts,
						${RELIABILITY_SESSION_ID_SQL} AS piboSessionId,
						${RELIABILITY_EVENT_ID_SQL} AS eventId,
						last_error AS lastError, dead_reason AS deadReason, json_valid(payload_json) AS payloadValid, dead_at AS updatedAt
					FROM pibo_dead_jobs
					WHERE queue IN ('output-persistence', 'output-persistence-cli') ${deadScope.sql}
					ORDER BY dead_at DESC
					LIMIT ?
				`, [...deadScope.params, limit]).map(deadJobFinding));
			}
		} finally {
			db.close();
		}
	}

	findings.sort((left, right) => (right.lastAt ?? "").localeCompare(left.lastAt ?? ""));
	const returnedFindings = findings.slice(0, limit);
	const findingCount = turnLifecycleIssues
		+ thinkingLifecycleIssues
		+ toolLifecycleIssues
		+ identityCollisions
		+ pendingOutputJobs
		+ deadOutputJobs;
	const nextCommands = input.piboSessionId
		? [
			`pibo debug trace ${input.piboSessionId} --check`,
			`pibo debug events ${input.piboSessionId} --limit 50`,
			"pibo debug jobs dead --queue output-persistence",
		]
		: [
			"pibo debug integrity output <pibo-session-id> --json",
			"pibo debug jobs list --queue output-persistence",
			"pibo debug jobs dead --queue output-persistence",
		];
	return {
		resultType: "debug.integrity.output",
		readOnly: true,
		scope: {
			...(input.piboSessionId ? { piboSessionId: input.piboSessionId } : {}),
			...(input.before ? { before: input.before } : {}),
			limit,
		},
		stores: {
			data: { path: input.dataStore.path, exists: input.dataStore.exists },
			reliability: { path: input.reliabilityStore.path, exists: input.reliabilityStore.exists },
		},
		summary: {
			findingCount,
			returnedFindings: returnedFindings.length,
			turnLifecycleIssues,
			thinkingLifecycleIssues,
			toolLifecycleIssues,
			identityCollisions,
			pendingOutputJobs,
			deadOutputJobs,
			deadIdentityCollisions,
		},
		findings: returnedFindings,
		nextCommands,
	};
}

export function formatOutputIntegrityAudit(audit: OutputIntegrityAudit): string {
	const scope = audit.scope.piboSessionId ?? "all";
	const lines = [
		`pibo debug integrity output`,
		`readOnly\t${audit.readOnly}`,
		`session\t${scope}`,
		...(audit.scope.before ? [`before\t${audit.scope.before}`] : []),
		`findings\t${audit.summary.findingCount}`,
		`turnLifecycle\t${audit.summary.turnLifecycleIssues}`,
		`thinkingLifecycle\t${audit.summary.thinkingLifecycleIssues}`,
		`toolLifecycle\t${audit.summary.toolLifecycleIssues}`,
		`identityCollisions\t${audit.summary.identityCollisions}`,
		`pendingOutputJobs\t${audit.summary.pendingOutputJobs}`,
		`deadOutputJobs\t${audit.summary.deadOutputJobs}`,
		`deadIdentityCollisions\t${audit.summary.deadIdentityCollisions}`,
	];
	if (audit.findings.length) {
		lines.push("", "kind\tsession\tevent\tdetail\tlastAt");
		for (const finding of audit.findings) {
			lines.push([
				finding.kind,
				finding.piboSessionId ?? "-",
				finding.eventId ?? finding.jobId ?? "-",
				findingDetail(finding),
				finding.lastAt ?? "-",
			].join("\t"));
		}
	}
	lines.push("", "Next:", ...audit.nextCommands.map((command) => `  ${command}`));
	return lines.join("\n");
}

function eventScope(piboSessionId: string | undefined, before: string | undefined): { sql: string; params: SqlValue[] } {
	const clauses: string[] = [];
	const params: SqlValue[] = [];
	if (piboSessionId) {
		clauses.push("session_id = ?");
		params.push(piboSessionId);
	}
	if (before) {
		clauses.push("created_at < ?");
		params.push(before);
	}
	return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", params };
}

function reliabilityScope(piboSessionId: string | undefined, before: string | undefined, timeColumn: "updated_at" | "dead_at"): { sql: string; params: SqlValue[] } {
	const clauses: string[] = [];
	const params: SqlValue[] = [];
	if (piboSessionId) {
		clauses.push(`${RELIABILITY_SESSION_ID_SQL} = ?`);
		params.push(piboSessionId);
	}
	if (before) {
		clauses.push(`${timeColumn} < ?`);
		params.push(before);
	}
	return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", params };
}

function queryRows<TRow>(db: DatabaseSync, sql: string, params: SqlValue[]): TRow[] {
	return db.prepare(sql).all(...params) as TRow[];
}

function countRows(db: DatabaseSync, sql: string, params: SqlValue[]): number {
	const row = db.prepare(sql).get(...params) as { count?: number | bigint } | undefined;
	return Number(row?.count ?? 0);
}

function tableExists(db: DatabaseSync, table: string): boolean {
	return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function pendingJobFinding(row: ReliabilityRow): OutputIntegrityFinding {
	return {
		kind: "pending_output_job",
		...(row.piboSessionId ? { piboSessionId: row.piboSessionId } : {}),
		...(row.eventId ? { eventId: row.eventId } : {}),
		jobId: row.jobId,
		queue: row.queue,
		attempts: row.attempts,
		maxAttempts: row.maxAttempts,
		payloadValid: row.payloadValid === 1,
		lastAt: row.updatedAt,
	};
}

function deadJobFinding(row: ReliabilityRow): OutputIntegrityFinding {
	return {
		kind: "dead_output_job",
		...(row.piboSessionId ? { piboSessionId: row.piboSessionId } : {}),
		...(row.eventId ? { eventId: row.eventId } : {}),
		jobId: row.jobId,
		queue: row.queue,
		attempts: row.attempts,
		maxAttempts: row.maxAttempts,
		...(row.deadReason ? { deadReason: row.deadReason } : {}),
		identityCollision: row.lastError?.startsWith("Pibo output identity collision for ") ?? false,
		payloadValid: row.payloadValid === 1,
		lastAt: row.updatedAt,
	};
}

function findingDetail(finding: OutputIntegrityFinding): string {
	if (finding.kind === "turn_lifecycle") return `started=${finding.started ?? 0},assistant=${finding.assistantMessages ?? 0},messageFinished=${finding.messageFinished ?? 0},sessionErrors=${finding.sessionErrors ?? 0}`;
	if (finding.kind === "thinking_lifecycle") return `thinking=${finding.thinkingIndex ?? 0},started=${finding.started ?? 0},finished=${finding.finished ?? 0}`;
	if (finding.kind === "tool_lifecycle") return `tool=${finding.toolCallId ?? "-"},ordinal=${finding.toolInvocationOrdinal ?? 0},called=${finding.called ?? 0},started=${finding.started ?? 0},finished=${finding.finished ?? 0}`;
	if (finding.kind === "identity_collision") return finding.idempotencyKey ?? `stream=${finding.streamId ?? "-"}`;
	if (finding.kind === "pending_output_job") return `payloadValid=${finding.payloadValid ?? false},attempts=${finding.attempts ?? 0}/${finding.maxAttempts ?? 0}`;
	return `reason=${finding.deadReason ?? "-"},collision=${finding.identityCollision ?? false},payloadValid=${finding.payloadValid ?? false},attempts=${finding.attempts ?? 0}/${finding.maxAttempts ?? 0}`;
}
