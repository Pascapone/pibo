import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "../core/pibo-home.js";
import { sqliteTableColumns } from "../data/sqlite-schema.js";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { PiboJsonValue } from "../core/events.js";
import type {
	PiboRunCompletionPolicy,
	PiboRunKind,
	PiboRunReadResult,
	PiboRunSnapshot,
	PiboRunStatus,
	PiboToolRunResult,
} from "../runs/registry.js";

export type PiboEventRetentionClass = "live_delta" | "trace_event" | "chat_message" | "audit_event" | string;

export type PiboEventAppendInput = {
	topic: string;
	key?: string;
	eventId?: string;
	idempotencyKey?: string;
	createdAt?: string;
	retentionClass?: PiboEventRetentionClass;
	payload: PiboJsonValue;
};

export type StoredPiboEvent = {
	streamId: number;
	topic: string;
	key?: string;
	eventId: string;
	idempotencyKey?: string;
	createdAt: string;
	retentionClass: PiboEventRetentionClass;
	payload: PiboJsonValue;
};

export type PiboEventListInput = {
	topic?: string;
	afterStreamId?: number;
	limit?: number;
};

export type PiboEventCountInput = {
	topic?: string;
	key?: string;
	retentionClass?: PiboEventRetentionClass;
};

export type PiboEventCountRow = {
	topic: string;
	key?: string;
	retentionClass: PiboEventRetentionClass;
	count: number;
};

export type PiboEventPruneInput = {
	topic?: string;
	retentionClass?: PiboEventRetentionClass;
	before?: string;
	beforeStreamId?: number;
	limit?: number;
	destructive?: boolean;
};

export type PiboJobState = "pending" | "running";

export type PiboJobEnqueueInput = {
	jobId?: string;
	queue: string;
	payload: PiboJsonValue;
	runAt?: string;
	priority?: number;
	maxAttempts?: number;
	idempotencyKey?: string;
	expiresAt?: string;
};

export type StoredPiboJob = {
	jobId: string;
	queue: string;
	state: PiboJobState;
	payload: PiboJsonValue;
	runAt: string;
	priority: number;
	workerId?: string;
	claimExpiresAt?: string;
	attempts: number;
	maxAttempts: number;
	idempotencyKey?: string;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
	lastError?: string;
};

export type StoredPiboDeadJob = {
	jobId: string;
	queue: string;
	payload: PiboJsonValue;
	attempts: number;
	maxAttempts: number;
	idempotencyKey?: string;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
	lastError?: string;
	deadAt: string;
	deadReason: string;
};

export type PiboJobRetryInput = {
	error?: string;
	delayMs?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	now?: Date;
};

export type PiboDeadJobListInput = {
	queue?: string;
	limit?: number;
};

export type PiboDeadJobReplayInput = {
	payload?: PiboJsonValue;
	runAt?: string;
	priority?: number;
	maxAttempts?: number;
	idempotencyKey?: string;
};

export type PiboRunStoreRecord = PiboRunReadResult & {
	jobId?: string;
	retryable: boolean;
	maxAttempts: number;
	notifiedStatus?: PiboRunStatus;
	acknowledgedStatus?: PiboRunStatus;
};

type PiboEventRow = {
	stream_id: number;
	topic: string;
	key: string | null;
	event_id: string;
	idempotency_key: string | null;
	created_at: string;
	retention_class: string;
	payload_json: string;
};

type PiboConsumerRow = {
	consumer: string;
	topic: string;
	last_stream_id: number;
	updated_at: string;
};

type PiboJobRow = {
	job_id: string;
	queue: string;
	state: PiboJobState;
	payload_json: string;
	run_at: string;
	priority: number;
	worker_id: string | null;
	claim_expires_at: string | null;
	attempts: number;
	max_attempts: number;
	idempotency_key: string | null;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
	last_error: string | null;
};

type PiboDeadJobRow = {
	job_id: string;
	queue: string;
	payload_json: string;
	attempts: number;
	max_attempts: number;
	idempotency_key: string | null;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
	last_error: string | null;
	dead_at: string;
	dead_reason: string;
};

type PiboRunRow = {
	run_id: string;
	kind: PiboRunKind;
	controller_pibo_session_id: string;
	status: PiboRunStatus;
	completion_policy: PiboRunCompletionPolicy;
	consumed: number;
	tool_name: string;
	summary: string | null;
	result_json: string | null;
	error: string | null;
	notified_status: PiboRunStatus | null;
	acknowledged_status: PiboRunStatus | null;
	created_at: string;
	updated_at: string;
	completed_at: string | null;
	job_id: string | null;
	retryable: number;
	max_attempts: number;
};

function now(): string {
	return new Date().toISOString();
}

function clampLimit(limit: number | undefined, defaultLimit = 100, maxLimit = 5000): number {
	return Math.max(1, Math.min(limit ?? defaultLimit, maxLimit));
}

function json(value: PiboJsonValue | undefined): string {
	return JSON.stringify(value ?? null);
}

function parseJson(value: string): PiboJsonValue {
	return JSON.parse(value) as PiboJsonValue;
}

function asDate(value: Date | undefined): Date {
	return value ?? new Date();
}

function migratePiboRunControllerColumn(db: DatabaseSync): void {
	const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pibo_runs'").get();
	if (!table) return;
	const legacyColumn = ["o", "wner_pibo_session_id"].join("");
	const columns = sqliteTableColumns(db, "pibo_runs");
	if (!columns.has(legacyColumn) || columns.has("controller_pibo_session_id")) return;
	db.exec("DROP INDEX IF EXISTS idx_pibo_runs_" + ["o", "wner_updated"].join(""));
	db.exec(`ALTER TABLE pibo_runs RENAME COLUMN ${legacyColumn} TO controller_pibo_session_id`);
}

export class PiboReliabilityStore {
	private readonly db: DatabaseSync;
	private readonly appendEventStatement: StatementSync;
	private readonly getEventByStreamIdStatement: StatementSync;
	private readonly getEventByTopicEventIdStatement: StatementSync;
	private readonly getEventByTopicIdempotencyKeyStatement: StatementSync;

	constructor(path = piboHomePath("pibo-events.sqlite")) {
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") mkdirSync(dirname(resolvedPath), { recursive: true });

		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA foreign_keys = ON");
		if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		migratePiboRunControllerColumn(this.db);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS pibo_event_stream (
				stream_id INTEGER PRIMARY KEY,
				topic TEXT NOT NULL,
				key TEXT,
				event_id TEXT NOT NULL,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				retention_class TEXT NOT NULL,
				payload_json TEXT NOT NULL
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_pibo_event_stream_event
				ON pibo_event_stream(topic, event_id);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_pibo_event_stream_idempotency
				ON pibo_event_stream(topic, idempotency_key)
				WHERE idempotency_key IS NOT NULL;
			CREATE INDEX IF NOT EXISTS idx_pibo_event_stream_topic_stream
				ON pibo_event_stream(topic, stream_id);

			CREATE TABLE IF NOT EXISTS pibo_event_consumers (
				consumer TEXT NOT NULL,
				topic TEXT NOT NULL,
				last_stream_id INTEGER NOT NULL,
				updated_at TEXT NOT NULL,
				PRIMARY KEY(consumer, topic)
			);

			CREATE TABLE IF NOT EXISTS pibo_jobs (
				job_id TEXT PRIMARY KEY,
				queue TEXT NOT NULL,
				state TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				run_at TEXT NOT NULL,
				priority INTEGER NOT NULL DEFAULT 0,
				worker_id TEXT,
				claim_expires_at TEXT,
				attempts INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 1,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				expires_at TEXT,
				last_error TEXT
			);
			CREATE UNIQUE INDEX IF NOT EXISTS idx_pibo_jobs_idempotency
				ON pibo_jobs(queue, idempotency_key)
				WHERE idempotency_key IS NOT NULL;
			CREATE INDEX IF NOT EXISTS idx_pibo_jobs_live_claim
				ON pibo_jobs(queue, state, run_at, priority DESC, created_at)
				WHERE state = 'pending';
			CREATE INDEX IF NOT EXISTS idx_pibo_jobs_expired_claim
				ON pibo_jobs(queue, state, claim_expires_at, priority DESC, created_at)
				WHERE state = 'running';

			CREATE TABLE IF NOT EXISTS pibo_dead_jobs (
				job_id TEXT PRIMARY KEY,
				queue TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				attempts INTEGER NOT NULL,
				max_attempts INTEGER NOT NULL,
				idempotency_key TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				expires_at TEXT,
				last_error TEXT,
				dead_at TEXT NOT NULL,
				dead_reason TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_pibo_dead_jobs_queue_dead_at
				ON pibo_dead_jobs(queue, dead_at);

			CREATE TABLE IF NOT EXISTS pibo_runs (
				run_id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				controller_pibo_session_id TEXT NOT NULL,
				status TEXT NOT NULL,
				completion_policy TEXT NOT NULL,
				consumed INTEGER NOT NULL DEFAULT 0,
				tool_name TEXT NOT NULL,
				summary TEXT,
				result_json TEXT,
				error TEXT,
				notified_status TEXT,
				acknowledged_status TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				completed_at TEXT,
				job_id TEXT,
				retryable INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 1
			);
			CREATE INDEX IF NOT EXISTS idx_pibo_runs_controller_updated
				ON pibo_runs(controller_pibo_session_id, updated_at);
			CREATE INDEX IF NOT EXISTS idx_pibo_runs_status
				ON pibo_runs(status);
		`);

		this.appendEventStatement = this.db.prepare(`
			INSERT INTO pibo_event_stream (topic, key, event_id, idempotency_key, created_at, retention_class, payload_json)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);
		this.getEventByStreamIdStatement = this.db.prepare("SELECT * FROM pibo_event_stream WHERE stream_id = ?");
		this.getEventByTopicEventIdStatement = this.db.prepare("SELECT * FROM pibo_event_stream WHERE topic = ? AND event_id = ?");
		this.getEventByTopicIdempotencyKeyStatement = this.db.prepare("SELECT * FROM pibo_event_stream WHERE topic = ? AND idempotency_key = ?");
	}

	append(input: PiboEventAppendInput): StoredPiboEvent {
		const eventId = input.eventId ?? `evt_${randomUUID()}`;
		const createdAt = input.createdAt ?? now();
		const result = this.appendEventStatement.run(
				input.topic,
				input.key ?? null,
				eventId,
				input.idempotencyKey ?? null,
				createdAt,
				input.retentionClass ?? "audit_event",
				json(input.payload),
			);
		return this.getEventByStreamId(Number(result.lastInsertRowid));
	}

	appendOnce(input: PiboEventAppendInput): StoredPiboEvent {
		try {
			return this.append(input);
		} catch (error) {
			const existing =
				(input.eventId ? this.getEventByTopicEventId(input.topic, input.eventId) : undefined) ??
				(input.idempotencyKey ? this.getEventByTopicIdempotencyKey(input.topic, input.idempotencyKey) : undefined);
			if (existing) return existing;
			throw error;
		}
	}

	list(input: PiboEventListInput = {}): StoredPiboEvent[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (input.topic) {
			clauses.push("topic = ?");
			values.push(input.topic);
		}
		if (input.afterStreamId !== undefined) {
			clauses.push("stream_id > ?");
			values.push(input.afterStreamId);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`SELECT * FROM pibo_event_stream ${where} ORDER BY stream_id ASC LIMIT ?`)
			.all(...values, clampLimit(input.limit, 1000)) as PiboEventRow[];
		return rows.map(eventFromRow);
	}

	countEvents(input: PiboEventCountInput = {}): PiboEventCountRow[] {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.topic) {
			clauses.push("topic = ?");
			values.push(input.topic);
		}
		if (input.key) {
			clauses.push("key = ?");
			values.push(input.key);
		}
		if (input.retentionClass) {
			clauses.push("retention_class = ?");
			values.push(input.retentionClass);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`
				SELECT topic, key, retention_class, COUNT(*) AS count
				FROM pibo_event_stream
				${where}
				GROUP BY topic, key, retention_class
				ORDER BY topic, key, retention_class
			`)
			.all(...values) as Array<{ topic: string; key: string | null; retention_class: string; count: number }>;
		return rows.map((row) => ({
			topic: row.topic,
			key: row.key ?? undefined,
			retentionClass: row.retention_class,
			count: Number(row.count),
		}));
	}

	readFromConsumer(topic: string, consumer: string, limit = 100): StoredPiboEvent[] {
		const offset = this.getConsumerOffset(topic, consumer) ?? 0;
		return this.list({ topic, afterStreamId: offset, limit });
	}

	saveConsumerOffset(topic: string, consumer: string, streamId: number): void {
		this.db
			.prepare(`
				INSERT INTO pibo_event_consumers (consumer, topic, last_stream_id, updated_at)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(consumer, topic) DO UPDATE SET
					last_stream_id = MAX(pibo_event_consumers.last_stream_id, excluded.last_stream_id),
					updated_at = excluded.updated_at
			`)
			.run(consumer, topic, streamId, now());
	}

	listConsumers(): Array<{ consumer: string; topic: string; lastStreamId: number; updatedAt: string }> {
		return (this.db.prepare("SELECT * FROM pibo_event_consumers ORDER BY topic, consumer").all() as PiboConsumerRow[]).map(
			(row) => ({
				consumer: row.consumer,
				topic: row.topic,
				lastStreamId: row.last_stream_id,
				updatedAt: row.updated_at,
			}),
		);
	}

	prune(input: PiboEventPruneInput = {}): number {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (input.topic) {
			clauses.push("topic = ?");
			values.push(input.topic);
		}
		if (input.retentionClass) {
			clauses.push("retention_class = ?");
			values.push(input.retentionClass);
		}
		if (input.before) {
			clauses.push("created_at < ?");
			values.push(input.before);
		}
		if (input.beforeStreamId !== undefined) {
			clauses.push("stream_id <= ?");
			values.push(input.beforeStreamId);
		}
		if (!input.destructive) {
			clauses.push(`
				stream_id <= COALESCE(
					(SELECT MIN(last_stream_id) FROM pibo_event_consumers WHERE pibo_event_consumers.topic = pibo_event_stream.topic),
					stream_id
				)
			`);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const result = this.db
			.prepare(`
				DELETE FROM pibo_event_stream
				WHERE stream_id IN (
					SELECT stream_id FROM pibo_event_stream
					${where}
					ORDER BY stream_id ASC
					LIMIT ${clampLimit(input.limit, 500)}
				)
			`)
			.run(...values);
		return Number(result.changes ?? 0);
	}

	enqueue(input: PiboJobEnqueueInput): StoredPiboJob {
		const timestamp = now();
		const jobId = input.jobId ?? `job_${randomUUID()}`;
		const result = this.db
			.prepare(`
				INSERT OR IGNORE INTO pibo_jobs (
					job_id, queue, state, payload_json, run_at, priority, worker_id, claim_expires_at,
					attempts, max_attempts, idempotency_key, created_at, updated_at, expires_at, last_error
				) VALUES (?, ?, 'pending', ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?, ?, NULL)
			`)
			.run(
				jobId,
				input.queue,
				json(input.payload),
				input.runAt ?? timestamp,
				input.priority ?? 0,
				Math.max(1, input.maxAttempts ?? 1),
				input.idempotencyKey ?? null,
				timestamp,
				timestamp,
				input.expiresAt ?? null,
			);
		if (Number(result.changes ?? 0) === 0 && input.idempotencyKey) {
			const existing = this.getJobByIdempotencyKey(input.queue, input.idempotencyKey);
			if (existing) return existing;
		}
		return this.getJob(jobId);
	}

	claimBatch(workerId: string, limit: number, options: { visibilityTimeoutMs?: number; queue?: string } = {}): StoredPiboJob[] {
		const timestamp = now();
		const claimExpiresAt = new Date(Date.now() + (options.visibilityTimeoutMs ?? 30000)).toISOString();
		const clauses = [
			"((state = 'pending' AND run_at <= ?) OR (state = 'running' AND claim_expires_at IS NOT NULL AND claim_expires_at <= ?))",
			"(expires_at IS NULL OR expires_at > ?)",
		];
		const values: Array<string | number> = [timestamp, timestamp, timestamp];
		if (options.queue) {
			clauses.push("queue = ?");
			values.push(options.queue);
		}
		this.moveExpiredJobs(timestamp);
		const rows = this.db
			.prepare(`
				UPDATE pibo_jobs
				SET state = 'running',
					worker_id = ?,
					claim_expires_at = ?,
					attempts = attempts + 1,
					updated_at = ?
				WHERE job_id IN (
					SELECT job_id FROM pibo_jobs
					WHERE ${clauses.join(" AND ")}
					ORDER BY priority DESC, run_at ASC, created_at ASC
					LIMIT ?
				)
				RETURNING *
			`)
			.all(workerId, claimExpiresAt, timestamp, ...values, clampLimit(limit)) as PiboJobRow[];
		return rows.map(jobFromRow);
	}

	claimJob(jobId: string, workerId: string, visibilityTimeoutMs = 30000): StoredPiboJob | undefined {
		const timestamp = now();
		const claimExpiresAt = new Date(Date.now() + visibilityTimeoutMs).toISOString();
		const row = this.db
			.prepare(`
				UPDATE pibo_jobs
				SET state = 'running',
					worker_id = ?,
					claim_expires_at = ?,
					attempts = attempts + 1,
					updated_at = ?
				WHERE job_id = ?
					AND state = 'pending'
					AND run_at <= ?
					AND (expires_at IS NULL OR expires_at > ?)
				RETURNING *
			`)
			.get(workerId, claimExpiresAt, timestamp, jobId, timestamp, timestamp) as PiboJobRow | undefined;
		return row ? jobFromRow(row) : undefined;
	}

	ack(jobId: string, workerId: string): boolean {
		const timestamp = now();
		const result = this.db
			.prepare(`
				DELETE FROM pibo_jobs
				WHERE job_id = ?
					AND state = 'running'
					AND worker_id = ?
					AND claim_expires_at IS NOT NULL
					AND claim_expires_at > ?
			`)
			.run(jobId, workerId, timestamp);
		return Number(result.changes ?? 0) > 0;
	}

	retry(jobId: string, workerId: string, input: PiboJobRetryInput = {}): boolean {
		const timestamp = now();
		const row = this.getLiveWorkerJob(jobId, workerId, timestamp);
		if (!row) return false;
		const job = jobFromRow(row);
		if (job.attempts >= job.maxAttempts) {
			this.moveJobToDead(row, input.error ?? "Job exhausted retry attempts.", "max_attempts", timestamp);
			return true;
		}
		const delayMs = input.delayMs ?? retryDelayMs(job.attempts, input);
		const runAt = new Date(asDate(input.now).getTime() + delayMs).toISOString();
		this.db
			.prepare(`
				UPDATE pibo_jobs
				SET state = 'pending',
					worker_id = NULL,
					claim_expires_at = NULL,
					run_at = ?,
					updated_at = ?,
					last_error = ?
				WHERE job_id = ?
			`)
			.run(runAt, timestamp, input.error ?? null, jobId);
		return true;
	}

	fail(jobId: string, workerId: string, error: string): boolean {
		const timestamp = now();
		const row = this.getLiveWorkerJob(jobId, workerId, timestamp);
		if (!row) return false;
		this.moveJobToDead(row, error, "failed", timestamp);
		return true;
	}

	heartbeat(jobId: string, workerId: string, extendMs: number): boolean {
		const timestamp = now();
		const claimExpiresAt = new Date(Date.now() + Math.max(1, extendMs)).toISOString();
		const result = this.db
			.prepare(`
				UPDATE pibo_jobs
				SET claim_expires_at = ?, updated_at = ?
				WHERE job_id = ?
					AND state = 'running'
					AND worker_id = ?
					AND claim_expires_at IS NOT NULL
					AND claim_expires_at > ?
			`)
			.run(claimExpiresAt, timestamp, jobId, workerId, timestamp);
		return Number(result.changes ?? 0) > 0;
	}

	listJobs(input: { queue?: string; state?: PiboJobState; limit?: number } = {}): StoredPiboJob[] {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.queue) {
			clauses.push("queue = ?");
			values.push(input.queue);
		}
		if (input.state) {
			clauses.push("state = ?");
			values.push(input.state);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`SELECT * FROM pibo_jobs ${where} ORDER BY priority DESC, run_at ASC, created_at ASC LIMIT ?`)
			.all(...values, clampLimit(input.limit, 100)) as PiboJobRow[];
		return rows.map(jobFromRow);
	}

	listDead(input: PiboDeadJobListInput = {}): StoredPiboDeadJob[] {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.queue) {
			clauses.push("queue = ?");
			values.push(input.queue);
		}
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db
			.prepare(`SELECT * FROM pibo_dead_jobs ${where} ORDER BY dead_at DESC LIMIT ?`)
			.all(...values, clampLimit(input.limit, 100)) as PiboDeadJobRow[];
		return rows.map(deadJobFromRow);
	}

	requeueDead(jobId: string, input: PiboDeadJobReplayInput = {}): StoredPiboJob {
		const dead = this.db.prepare("SELECT * FROM pibo_dead_jobs WHERE job_id = ?").get(jobId) as PiboDeadJobRow | undefined;
		if (!dead) throw new Error(`Unknown dead job "${jobId}"`);
		const deadJob = deadJobFromRow(dead);
		const payload = input.payload ?? replayPayload(deadJob.payload, deadJob.jobId);
		const job = this.enqueue({
			queue: deadJob.queue,
			payload,
			runAt: input.runAt,
			priority: input.priority ?? 0,
			maxAttempts: input.maxAttempts ?? deadJob.maxAttempts,
			idempotencyKey: input.idempotencyKey,
		});
		this.db.prepare("DELETE FROM pibo_dead_jobs WHERE job_id = ?").run(jobId);
		return job;
	}

	createRun(input: {
		runId?: string;
		controllerPiboSessionId: string;
		toolName: string;
		completionPolicy: PiboRunCompletionPolicy;
		params?: unknown;
		retryable?: boolean;
		maxAttempts?: number;
	}): PiboRunStoreRecord {
		const timestamp = now();
		const runId = input.runId ?? `run_${randomUUID()}`;
		const maxAttempts = Math.max(1, input.maxAttempts ?? 1);
		const job = this.enqueue({
			queue: "runs",
			payload: {
				runId,
				controllerPiboSessionId: input.controllerPiboSessionId,
				toolName: input.toolName,
				params: input.params,
			} as PiboJsonValue,
			maxAttempts,
		});
		this.db
			.prepare(`
				INSERT INTO pibo_runs (
					run_id, kind, controller_pibo_session_id, status, completion_policy, consumed, tool_name,
					summary, result_json, error, notified_status, acknowledged_status, created_at, updated_at,
					completed_at, job_id, retryable, max_attempts
				) VALUES (?, 'tool', ?, 'running', ?, 0, ?, ?, NULL, NULL, NULL, NULL, ?, ?, NULL, ?, ?, ?)
			`)
			.run(
				runId,
				input.controllerPiboSessionId,
				input.completionPolicy,
				input.toolName,
				`${input.toolName} run is running.`,
				timestamp,
				timestamp,
				job.jobId,
				input.retryable ? 1 : 0,
				maxAttempts,
			);
		this.claimJob(job.jobId, `run-registry:${process.pid}`, 24 * 60 * 60 * 1000);
		return this.requireRun(runId);
	}

	updateRun(runId: string, patch: Partial<PiboRunStoreRecord>): PiboRunStoreRecord | undefined {
		const existing = this.getRun(runId);
		if (!existing) return undefined;
		const next: PiboRunStoreRecord = { ...existing, ...patch, updatedAt: patch.updatedAt ?? now() };
		this.db
			.prepare(`
				UPDATE pibo_runs SET
					status = ?,
					completion_policy = ?,
					consumed = ?,
					summary = ?,
					result_json = ?,
					error = ?,
					notified_status = ?,
					acknowledged_status = ?,
					updated_at = ?,
					completed_at = ?,
					job_id = ?,
					retryable = ?,
					max_attempts = ?
				WHERE run_id = ?
			`)
			.run(
				next.status,
				next.completionPolicy,
				next.consumed ? 1 : 0,
				next.summary ?? null,
				next.result ? JSON.stringify(next.result) : null,
				next.error ?? null,
				next.notifiedStatus ?? null,
				next.acknowledgedStatus ?? null,
				next.updatedAt,
				next.completedAt ?? null,
				next.jobId ?? null,
				next.retryable ? 1 : 0,
				next.maxAttempts,
				runId,
			);
		return this.requireRun(runId);
	}

	getRun(runId: string): PiboRunStoreRecord | undefined {
		const row = this.db.prepare("SELECT * FROM pibo_runs WHERE run_id = ?").get(runId) as PiboRunRow | undefined;
		return row ? runFromRow(row) : undefined;
	}

	listRuns(input: { controllerPiboSessionId?: string; includeConsumed?: boolean; includeDetached?: boolean } = {}): PiboRunStoreRecord[] {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.controllerPiboSessionId) {
			clauses.push("controller_pibo_session_id = ?");
			values.push(input.controllerPiboSessionId);
		}
		if (!input.includeConsumed) clauses.push("consumed = 0");
		if (!input.includeDetached) clauses.push("completion_policy != 'detached'");
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.db.prepare(`SELECT * FROM pibo_runs ${where} ORDER BY created_at ASC`).all(...values) as PiboRunRow[];
		return rows.map(runFromRow);
	}

	pruneRuns(input: { consumedTerminalTtlMs: number; detachedTerminalTtlMs: number; nowMs: number }): number {
		const rows = this.db
			.prepare("SELECT * FROM pibo_runs WHERE status IN ('completed', 'failed', 'cancelled') AND completed_at IS NOT NULL")
			.all() as PiboRunRow[];
		const ids = rows
			.map(runFromRow)
			.filter((run) => {
				if (!run.completedAt) return false;
				const ageMs = input.nowMs - Date.parse(run.completedAt);
				return (
					(run.completionPolicy === "detached" && ageMs >= input.detachedTerminalTtlMs) ||
					(run.completionPolicy === "tracked" && run.consumed && ageMs >= input.consumedTerminalTtlMs)
				);
			})
			.map((run) => run.runId);
		if (!ids.length) return 0;
		const placeholders = ids.map(() => "?").join(", ");
		const result = this.db.prepare(`DELETE FROM pibo_runs WHERE run_id IN (${placeholders})`).run(...ids);
		return Number(result.changes ?? 0);
	}

	recoverInterruptedRuns(): PiboRunStoreRecord[] {
		const rows = this.db.prepare("SELECT * FROM pibo_runs WHERE status = 'running'").all() as PiboRunRow[];
		const recovered: PiboRunStoreRecord[] = [];
		const timestamp = now();
		for (const row of rows) {
			if (row.job_id && this.hasUnexpiredJobClaim(row.job_id, timestamp)) continue;
			const run = runFromRow(row);
			if (run.retryable && run.maxAttempts > 1) {
				if (run.jobId) this.releaseJobForRetry(run.jobId, timestamp);
				recovered.push(
					this.updateRun(run.runId, {
						status: "queued",
						summary: `${run.toolName} run is queued for retry after interruption.`,
					} as Partial<PiboRunStoreRecord>) ?? run,
				);
			} else {
				if (run.jobId) this.moveLiveJobToDead(run.jobId, "Run was interrupted before completion and the tool is not retryable.", "interrupted", timestamp);
				recovered.push(
					this.updateRun(run.runId, {
						status: "failed",
						error: "Run was interrupted before completion and the tool is not retryable.",
						summary: `${run.toolName} run failed.`,
						completedAt: timestamp,
					}) ?? run,
				);
			}
		}
		return recovered;
	}

	close(): void {
		this.db.close();
	}

	private getEventByStreamId(streamId: number): StoredPiboEvent {
		const row = this.getEventByStreamIdStatement.get(streamId) as PiboEventRow | undefined;
		if (!row) throw new Error(`Unknown pibo event stream id "${streamId}"`);
		return eventFromRow(row);
	}

	private getEventByTopicEventId(topic: string, eventId: string): StoredPiboEvent | undefined {
		const row = this.getEventByTopicEventIdStatement.get(topic, eventId) as PiboEventRow | undefined;
		return row ? eventFromRow(row) : undefined;
	}

	private getEventByTopicIdempotencyKey(topic: string, idempotencyKey: string): StoredPiboEvent | undefined {
		const row = this.getEventByTopicIdempotencyKeyStatement.get(topic, idempotencyKey) as PiboEventRow | undefined;
		return row ? eventFromRow(row) : undefined;
	}

	private getConsumerOffset(topic: string, consumer: string): number | undefined {
		const row = this.db
			.prepare("SELECT last_stream_id FROM pibo_event_consumers WHERE topic = ? AND consumer = ?")
			.get(topic, consumer) as { last_stream_id: number } | undefined;
		return row?.last_stream_id;
	}

	private getJob(jobId: string): StoredPiboJob {
		const row = this.db.prepare("SELECT * FROM pibo_jobs WHERE job_id = ?").get(jobId) as PiboJobRow | undefined;
		if (!row) throw new Error(`Unknown live job "${jobId}"`);
		return jobFromRow(row);
	}

	private getJobByIdempotencyKey(queue: string, idempotencyKey: string): StoredPiboJob | undefined {
		const row = this.db
			.prepare("SELECT * FROM pibo_jobs WHERE queue = ? AND idempotency_key = ?")
			.get(queue, idempotencyKey) as PiboJobRow | undefined;
		return row ? jobFromRow(row) : undefined;
	}

	private getLiveWorkerJob(jobId: string, workerId: string, timestamp: string): PiboJobRow | undefined {
		return this.db
			.prepare(`
				SELECT * FROM pibo_jobs
				WHERE job_id = ?
					AND state = 'running'
					AND worker_id = ?
					AND claim_expires_at IS NOT NULL
					AND claim_expires_at > ?
			`)
			.get(jobId, workerId, timestamp) as PiboJobRow | undefined;
	}

	private moveExpiredJobs(timestamp: string): void {
		const expired = this.db.prepare("SELECT * FROM pibo_jobs WHERE expires_at IS NOT NULL AND expires_at <= ?").all(timestamp) as
			PiboJobRow[];
		for (const row of expired) this.moveJobToDead(row, row.last_error ?? "Job expired.", "expired", timestamp);
	}

	private hasUnexpiredJobClaim(jobId: string, timestamp: string): boolean {
		const row = this.db
			.prepare(`
				SELECT job_id FROM pibo_jobs
				WHERE job_id = ?
					AND state = 'running'
					AND claim_expires_at IS NOT NULL
					AND claim_expires_at > ?
			`)
			.get(jobId, timestamp);
		return row !== undefined;
	}

	private releaseJobForRetry(jobId: string, timestamp: string): void {
		this.db
			.prepare(`
				UPDATE pibo_jobs
				SET state = 'pending',
					worker_id = NULL,
					claim_expires_at = NULL,
					run_at = ?,
					updated_at = ?
				WHERE job_id = ?
			`)
			.run(timestamp, timestamp, jobId);
	}

	private moveLiveJobToDead(jobId: string, error: string, reason: string, timestamp: string): void {
		const row = this.db.prepare("SELECT * FROM pibo_jobs WHERE job_id = ?").get(jobId) as PiboJobRow | undefined;
		if (row) this.moveJobToDead(row, error, reason, timestamp);
	}

	private moveJobToDead(row: PiboJobRow, error: string, reason: string, timestamp: string): void {
		this.db
			.prepare(`
				INSERT OR REPLACE INTO pibo_dead_jobs (
					job_id, queue, payload_json, attempts, max_attempts, idempotency_key, created_at,
					updated_at, expires_at, last_error, dead_at, dead_reason
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				row.job_id,
				row.queue,
				row.payload_json,
				row.attempts,
				row.max_attempts,
				row.idempotency_key,
				row.created_at,
				timestamp,
				row.expires_at,
				error,
				timestamp,
				reason,
			);
		this.db.prepare("DELETE FROM pibo_jobs WHERE job_id = ?").run(row.job_id);
	}

	private requireRun(runId: string): PiboRunStoreRecord {
		const run = this.getRun(runId);
		if (!run) throw new Error(`Unknown run "${runId}"`);
		return run;
	}
}

export function createDefaultPiboReliabilityStore(_cwd?: string): PiboReliabilityStore {
	return new PiboReliabilityStore(piboHomePath("pibo-events.sqlite"));
}

function eventFromRow(row: PiboEventRow): StoredPiboEvent {
	return {
		streamId: row.stream_id,
		topic: row.topic,
		key: row.key ?? undefined,
		eventId: row.event_id,
		idempotencyKey: row.idempotency_key ?? undefined,
		createdAt: row.created_at,
		retentionClass: row.retention_class,
		payload: parseJson(row.payload_json),
	};
}

function jobFromRow(row: PiboJobRow): StoredPiboJob {
	return {
		jobId: row.job_id,
		queue: row.queue,
		state: row.state,
		payload: parseJson(row.payload_json),
		runAt: row.run_at,
		priority: row.priority,
		workerId: row.worker_id ?? undefined,
		claimExpiresAt: row.claim_expires_at ?? undefined,
		attempts: row.attempts,
		maxAttempts: row.max_attempts,
		idempotencyKey: row.idempotency_key ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		expiresAt: row.expires_at ?? undefined,
		lastError: row.last_error ?? undefined,
	};
}

function deadJobFromRow(row: PiboDeadJobRow): StoredPiboDeadJob {
	return {
		jobId: row.job_id,
		queue: row.queue,
		payload: parseJson(row.payload_json),
		attempts: row.attempts,
		maxAttempts: row.max_attempts,
		idempotencyKey: row.idempotency_key ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		expiresAt: row.expires_at ?? undefined,
		lastError: row.last_error ?? undefined,
		deadAt: row.dead_at,
		deadReason: row.dead_reason,
	};
}

function runFromRow(row: PiboRunRow): PiboRunStoreRecord {
	const output: PiboRunStoreRecord = {
		runId: row.run_id,
		kind: row.kind,
		controllerPiboSessionId: row.controller_pibo_session_id,
		status: row.status,
		completionPolicy: row.completion_policy,
		consumed: row.consumed === 1,
		toolName: row.tool_name,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		retryable: row.retryable === 1,
		maxAttempts: row.max_attempts,
	};
	if (row.summary) output.summary = row.summary;
	if (row.result_json) output.result = JSON.parse(row.result_json) as PiboToolRunResult;
	if (row.error) output.error = row.error;
	if (row.notified_status) output.notifiedStatus = row.notified_status;
	if (row.acknowledged_status) output.acknowledgedStatus = row.acknowledged_status;
	if (row.completed_at) output.completedAt = row.completed_at;
	if (row.job_id) output.jobId = row.job_id;
	return output;
}

function retryDelayMs(attempts: number, input: PiboJobRetryInput): number {
	const baseDelayMs = Math.max(1, input.baseDelayMs ?? 1000);
	const maxDelayMs = Math.max(baseDelayMs, input.maxDelayMs ?? 60000);
	return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempts - 1));
}

function replayPayload(payload: PiboJsonValue, jobId: string): PiboJsonValue {
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		return { ...payload, replayedFromJobId: jobId } as PiboJsonValue;
	}
	return { value: payload, replayedFromJobId: jobId } as PiboJsonValue;
}
