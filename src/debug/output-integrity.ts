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

type CollisionEventRow = {
	sessionId: string;
	eventId: string;
};

type OutputKeyReuseRow = {
	sessionId: string;
	eventId: string | null;
	outputKey: string;
	uses: number;
	firstAt: string;
	lastAt: string;
};

type SessionTraceStatusRow = {
	sessionId: string;
	sessionStatus: string;
	openTurns: number;
	lastAt: string;
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
	kind: "turn_lifecycle" | "thinking_lifecycle" | "tool_lifecycle" | "identity_collision" | "output_key_reuse" | "session_trace_status" | "pending_output_job" | "dead_output_job";
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
	relatedIdentityCollision?: boolean;
	payloadValid?: boolean;
	uses?: number;
	sessionStatus?: string;
	projectedStatus?: "idle" | "running" | "error";
	openTurns?: number;
};

export type OutputIntegrityAudit = {
	resultType: "debug.integrity.output";
	readOnly: true;
	scope: {
		piboSessionId?: string;
		since?: string;
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
		outputKeyReuses: number;
		sessionTraceStatusMismatches: number;
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
	since?: string;
	before?: string;
	limit?: string | number;
	findingMode?: "all" | "dead_letters";
}): OutputIntegrityAudit {
	const limit = normalizeLimit(input.limit);
	const findings: OutputIntegrityFinding[] = [];
	const collisionEventKeys = new Set<string>();
	let turnLifecycleIssues = 0;
	let thinkingLifecycleIssues = 0;
	let toolLifecycleIssues = 0;
	let identityCollisions = 0;
	let outputKeyReuses = 0;
	let sessionTraceStatusMismatches = 0;
	let pendingOutputJobs = 0;
	let deadOutputJobs = 0;
	let deadIdentityCollisions = 0;

	if (input.dataStore.exists) {
		const db = new DatabaseSync(input.dataStore.path, { readOnly: true });
		try {
			if (tableExists(db, "event_log")) {
				const scope = eventScope(input.piboSessionId, input.since, input.before);
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
				for (const row of queryRows<CollisionEventRow>(db, `
					SELECT DISTINCT session_id AS sessionId, event_id AS eventId
					FROM event_log
					WHERE type = 'pibo.output.identity_collision' AND event_id IS NOT NULL ${scope.sql}
				`, scope.params)) collisionEventKeys.add(`${row.sessionId}\0${row.eventId}`);
				outputKeyReuses = countRows(db, `
					WITH output_keys AS (
						SELECT session_id, event_id, idempotency_key AS output_key, created_at
						FROM event_log
						WHERE idempotency_key LIKE 'pibo.output:%' ${scope.sql}
						UNION ALL
						SELECT session_id, event_id, ${COLLISION_KEY_SQL} AS output_key, created_at
						FROM event_log
						WHERE type = 'pibo.output.identity_collision'
							AND ${COLLISION_KEY_SQL} IS NOT NULL ${scope.sql}
					)
					SELECT COUNT(*) AS count FROM (
						SELECT output_key FROM output_keys GROUP BY output_key HAVING COUNT(*) > 1
					)
				`, [...scope.params, ...scope.params]);
				if (tableExists(db, "sessions")) {
					sessionTraceStatusMismatches = countRows(db, sessionTraceStatusSql(scope.sql, true), scope.params);
				}

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
				findings.push(...queryRows<OutputKeyReuseRow>(db, `
					WITH output_keys AS (
						SELECT session_id, event_id, idempotency_key AS output_key, created_at
						FROM event_log
						WHERE idempotency_key LIKE 'pibo.output:%' ${scope.sql}
						UNION ALL
						SELECT session_id, event_id, ${COLLISION_KEY_SQL} AS output_key, created_at
						FROM event_log
						WHERE type = 'pibo.output.identity_collision'
							AND ${COLLISION_KEY_SQL} IS NOT NULL ${scope.sql}
					)
					SELECT MIN(session_id) AS sessionId, MIN(event_id) AS eventId, output_key AS outputKey,
						COUNT(*) AS uses, MIN(created_at) AS firstAt, MAX(created_at) AS lastAt
					FROM output_keys
					GROUP BY output_key
					HAVING COUNT(*) > 1
					ORDER BY lastAt DESC
					LIMIT ?
				`, [...scope.params, ...scope.params, limit]).map((row) => ({
					kind: "output_key_reuse" as const,
					piboSessionId: row.sessionId,
					...(row.eventId ? { eventId: row.eventId } : {}),
					idempotencyKey: row.outputKey,
					uses: Number(row.uses),
					firstAt: row.firstAt,
					lastAt: row.lastAt,
				})));
				if (tableExists(db, "sessions")) {
					findings.push(...queryRows<SessionTraceStatusRow>(db, sessionTraceStatusSql(scope.sql, false), [...scope.params, limit]).map((row) => ({
						kind: "session_trace_status" as const,
						piboSessionId: row.sessionId,
						sessionStatus: row.sessionStatus,
						projectedStatus: Number(row.openTurns) > 0 ? "running" as const : row.sessionStatus === "error" ? "error" as const : "idle" as const,
						openTurns: Number(row.openTurns),
						lastAt: row.lastAt,
					})));
				}
			}
		} finally {
			db.close();
		}
	}

	if (input.reliabilityStore.exists) {
		const db = new DatabaseSync(input.reliabilityStore.path, { readOnly: true });
		try {
			const jobScope = reliabilityScope(input.piboSessionId, input.since, input.before, "updated_at");
			const deadScope = reliabilityScope(input.piboSessionId, input.since, input.before, "dead_at");
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
				`, [...deadScope.params, limit]).map((row) => deadJobFinding(row, collisionEventKeys)));
			}
		} finally {
			db.close();
		}
	}

	const visibleFindings = input.findingMode === "dead_letters"
		? findings.filter((finding) => finding.kind === "dead_output_job")
		: findings;
	visibleFindings.sort((left, right) => (right.lastAt ?? "").localeCompare(left.lastAt ?? ""));
	const returnedFindings = visibleFindings.slice(0, limit);
	const findingCount = turnLifecycleIssues
		+ thinkingLifecycleIssues
		+ toolLifecycleIssues
		+ identityCollisions
		+ outputKeyReuses
		+ sessionTraceStatusMismatches
		+ pendingOutputJobs
		+ deadOutputJobs;
	const nextCommands = input.piboSessionId
		? [
			`pibo debug trace ${input.piboSessionId} --check`,
			`pibo debug events ${input.piboSessionId} --limit 50`,
			`pibo debug persistence dead-letters --session ${input.piboSessionId}`,
		]
		: [
			"pibo debug persistence audit --session <pibo-session-id> --json",
			"pibo debug persistence dead-letters",
			"pibo debug jobs list --queue output-persistence",
		];
	return {
		resultType: "debug.integrity.output",
		readOnly: true,
		scope: {
			...(input.piboSessionId ? { piboSessionId: input.piboSessionId } : {}),
			...(input.since ? { since: input.since } : {}),
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
			outputKeyReuses,
			sessionTraceStatusMismatches,
			pendingOutputJobs,
			deadOutputJobs,
			deadIdentityCollisions,
		},
		findings: returnedFindings,
		nextCommands,
	};
}

export type OutputPersistenceDeadLetters = {
	resultType: "debug.persistence.dead-letters";
	readOnly: true;
	scope: OutputIntegrityAudit["scope"];
	summary: {
		deadOutputJobs: number;
		returnedDeadLetters: number;
		identityCollisions: number;
		relatedIdentityCollisions: number;
	};
	deadLetters: OutputIntegrityFinding[];
	nextCommands: string[];
};

export function outputPersistenceDeadLettersFromAudit(audit: OutputIntegrityAudit): OutputPersistenceDeadLetters {
	const deadLetters = audit.findings.filter((finding) => finding.kind === "dead_output_job");
	return {
		resultType: "debug.persistence.dead-letters",
		readOnly: true,
		scope: audit.scope,
		summary: {
			deadOutputJobs: audit.summary.deadOutputJobs,
			returnedDeadLetters: deadLetters.length,
			identityCollisions: deadLetters.filter((finding) => finding.identityCollision).length,
			relatedIdentityCollisions: deadLetters.filter((finding) => finding.relatedIdentityCollision).length,
		},
		deadLetters,
		nextCommands: audit.scope.piboSessionId
			? [`pibo debug persistence audit --session ${audit.scope.piboSessionId} --json`]
			: ["pibo debug persistence audit --json"],
	};
}

export function formatOutputPersistenceDeadLetters(result: OutputPersistenceDeadLetters): string {
	const lines = [
		"pibo debug persistence dead-letters",
		`readOnly\t${result.readOnly}`,
		`session\t${result.scope.piboSessionId ?? "all"}`,
		...(result.scope.since ? [`since\t${result.scope.since}`] : []),
		...(result.scope.before ? [`before\t${result.scope.before}`] : []),
		`deadOutputJobs\t${result.summary.deadOutputJobs}`,
		`returnedDeadLetters\t${result.summary.returnedDeadLetters}`,
		`identityCollisions\t${result.summary.identityCollisions}`,
		`relatedIdentityCollisions\t${result.summary.relatedIdentityCollisions}`,
	];
	if (result.deadLetters.length) {
		lines.push("", "job\tsession\tevent\treason\tcollision\trelated\tlastAt");
		for (const finding of result.deadLetters) {
			lines.push([
				finding.jobId ?? "-",
				finding.piboSessionId ?? "-",
				finding.eventId ?? "-",
				finding.deadReason ?? "-",
				finding.identityCollision ?? false,
				finding.relatedIdentityCollision ?? false,
				finding.lastAt ?? "-",
			].join("\t"));
		}
	}
	lines.push("", "Next:", ...result.nextCommands.map((command) => `  ${command}`));
	return lines.join("\n");
}

export function formatOutputIntegrityAudit(audit: OutputIntegrityAudit): string {
	const scope = audit.scope.piboSessionId ?? "all";
	const lines = [
		`pibo debug integrity output`,
		`readOnly\t${audit.readOnly}`,
		`session\t${scope}`,
		...(audit.scope.since ? [`since\t${audit.scope.since}`] : []),
		...(audit.scope.before ? [`before\t${audit.scope.before}`] : []),
		`findings\t${audit.summary.findingCount}`,
		`turnLifecycle\t${audit.summary.turnLifecycleIssues}`,
		`thinkingLifecycle\t${audit.summary.thinkingLifecycleIssues}`,
		`toolLifecycle\t${audit.summary.toolLifecycleIssues}`,
		`identityCollisions\t${audit.summary.identityCollisions}`,
		`outputKeyReuses\t${audit.summary.outputKeyReuses}`,
		`sessionTraceStatusMismatches\t${audit.summary.sessionTraceStatusMismatches}`,
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

function eventScope(piboSessionId: string | undefined, since: string | undefined, before: string | undefined): { sql: string; params: SqlValue[] } {
	const clauses: string[] = [];
	const params: SqlValue[] = [];
	if (piboSessionId) {
		clauses.push("session_id = ?");
		params.push(piboSessionId);
	}
	if (since) {
		clauses.push("created_at >= ?");
		params.push(since);
	}
	if (before) {
		clauses.push("created_at < ?");
		params.push(before);
	}
	return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", params };
}

function reliabilityScope(piboSessionId: string | undefined, since: string | undefined, before: string | undefined, timeColumn: "updated_at" | "dead_at"): { sql: string; params: SqlValue[] } {
	const clauses: string[] = [];
	const params: SqlValue[] = [];
	if (piboSessionId) {
		clauses.push(`${RELIABILITY_SESSION_ID_SQL} = ?`);
		params.push(piboSessionId);
	}
	if (since) {
		clauses.push(`${timeColumn} >= ?`);
		params.push(since);
	}
	if (before) {
		clauses.push(`${timeColumn} < ?`);
		params.push(before);
	}
	return { sql: clauses.length ? `AND ${clauses.join(" AND ")}` : "", params };
}

function sessionTraceStatusSql(eventScopeSql: string, countOnly: boolean): string {
	const lifecycle = `
		SELECT session_id, event_id,
			SUM(type = 'message_started') AS started,
			SUM(type IN ('message_finished', 'session_error')) AS finished,
			MAX(created_at) AS last_at
		FROM event_log
		WHERE event_id IS NOT NULL
			AND type IN ('message_started', 'message_finished', 'session_error')
			${eventScopeSql}
		GROUP BY session_id, event_id
	`;
	const mismatches = `
		SELECT sessions.id AS sessionId, sessions.status AS sessionStatus,
			SUM(turn_lifecycle.started > 0 AND turn_lifecycle.finished = 0) AS openTurns,
			MAX(turn_lifecycle.last_at) AS lastAt
		FROM sessions
		JOIN turn_lifecycle ON turn_lifecycle.session_id = sessions.id
		GROUP BY sessions.id, sessions.status
		HAVING (sessions.status = 'running' AND openTurns = 0)
			OR (sessions.status != 'running' AND openTurns > 0)
	`;
	return countOnly
		? `WITH turn_lifecycle AS (${lifecycle}), mismatches AS (${mismatches}) SELECT COUNT(*) AS count FROM mismatches`
		: `WITH turn_lifecycle AS (${lifecycle}) ${mismatches} ORDER BY lastAt DESC LIMIT ?`;
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

function deadJobFinding(row: ReliabilityRow, collisionEventKeys: ReadonlySet<string>): OutputIntegrityFinding {
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
		relatedIdentityCollision: Boolean(row.piboSessionId && row.eventId && collisionEventKeys.has(`${row.piboSessionId}\0${row.eventId}`)),
		payloadValid: row.payloadValid === 1,
		lastAt: row.updatedAt,
	};
}

function findingDetail(finding: OutputIntegrityFinding): string {
	if (finding.kind === "turn_lifecycle") return `started=${finding.started ?? 0},assistant=${finding.assistantMessages ?? 0},messageFinished=${finding.messageFinished ?? 0},sessionErrors=${finding.sessionErrors ?? 0}`;
	if (finding.kind === "thinking_lifecycle") return `thinking=${finding.thinkingIndex ?? 0},started=${finding.started ?? 0},finished=${finding.finished ?? 0}`;
	if (finding.kind === "tool_lifecycle") return `tool=${finding.toolCallId ?? "-"},ordinal=${finding.toolInvocationOrdinal ?? 0},called=${finding.called ?? 0},started=${finding.started ?? 0},finished=${finding.finished ?? 0}`;
	if (finding.kind === "identity_collision") return finding.idempotencyKey ?? `stream=${finding.streamId ?? "-"}`;
	if (finding.kind === "output_key_reuse") return `uses=${finding.uses ?? 0},key=${finding.idempotencyKey ?? "-"}`;
	if (finding.kind === "session_trace_status") return `session=${finding.sessionStatus ?? "-"},projected=${finding.projectedStatus ?? "-"},openTurns=${finding.openTurns ?? 0}`;
	if (finding.kind === "pending_output_job") return `payloadValid=${finding.payloadValid ?? false},attempts=${finding.attempts ?? 0}/${finding.maxAttempts ?? 0}`;
	return `reason=${finding.deadReason ?? "-"},collision=${finding.identityCollision ?? false},related=${finding.relatedIdentityCollision ?? false},payloadValid=${finding.payloadValid ?? false},attempts=${finding.attempts ?? 0}/${finding.maxAttempts ?? 0}`;
}
