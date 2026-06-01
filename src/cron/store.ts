import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { piboHomePath } from "../core/pibo-home.js";

import { computeNextRunAt, validateSchedule } from "./schedule.js";
import type { PiboCronJob, PiboCronJobCreateInput, PiboCronJobPatchInput, PiboCronJobState, PiboCronRun, PiboCronRunStatus } from "./types.js";

export type PiboCronStoreOptions = {
	path?: string;
};

type CronJobRow = {
	id: string;
	name: string;
	description: string | null;
	enabled: number;
	target_json: string;
	profile: string;
	prompt: string;
	schedule_json: string;
	schedule_ui_json: string | null;
	delete_after_run: number;
	state_json: string;
	created_at: string;
	updated_at: string;
};

type CronRunRow = {
	id: string;
	job_id: string;
	pibo_session_id: string | null;
	status: PiboCronRunStatus;
	reason: string | null;
	error: string | null;
	started_at: string | null;
	completed_at: string | null;
	created_at: string;
	updated_at: string;
};

function nowIso(now = new Date()): string {
	return now.toISOString();
}

function parseJson<T>(json: string): T {
	return JSON.parse(json) as T;
}

function jobFromRow(row: CronJobRow): PiboCronJob {
	return {
		id: row.id,
		name: row.name,
		description: row.description ?? undefined,
		enabled: row.enabled === 1,
		target: parseTarget(row.target_json),
		profile: row.profile,
		prompt: row.prompt,
		schedule: parseJson(row.schedule_json),
		scheduleUi: row.schedule_ui_json ? parseJson(row.schedule_ui_json) : undefined,
		deleteAfterRun: row.delete_after_run === 1,
		state: parseJson(row.state_json),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function runFromRow(row: CronRunRow): PiboCronRun {
	return {
		id: row.id,
		jobId: row.job_id,
		piboSessionId: row.pibo_session_id ?? undefined,
		status: row.status,
		reason: row.reason ?? undefined,
		error: row.error ?? undefined,
		startedAt: row.started_at ?? undefined,
		completedAt: row.completed_at ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function defaultName(prompt: string): string {
	const normalized = prompt.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 80) : "Scheduled job";
}

function normalizeTarget(target: PiboCronJobCreateInput["target"] | { kind?: unknown; roomId?: unknown }): PiboCronJobCreateInput["target"] {
	if (target.kind === "room") return { kind: "room", roomId: String(target.roomId ?? "").trim() };
	return { kind: "default-chat" };
}

function parseTarget(json: string): PiboCronJobCreateInput["target"] {
	return normalizeTarget(parseJson(json));
}

function targetJson(target: PiboCronJobCreateInput["target"]): string {
	return JSON.stringify(normalizeTarget(target));
}

function validateJobInput(input: Pick<PiboCronJobCreateInput, "target" | "profile" | "prompt" | "schedule">): void {
	if (!input.profile.trim()) throw new Error("profile is required");
	if (!input.prompt.trim()) throw new Error("prompt is required");
	if (input.target.kind === "room" && !input.target.roomId.trim()) throw new Error("target.roomId is required");
	validateSchedule(input.schedule);
}

export class PiboCronStore {
	private readonly db: DatabaseSync;

	constructor(options: PiboCronStoreOptions = {}) {
		const dbPath = options.path ?? piboHomePath("pibo-cron.sqlite");
		const resolved = dbPath === ":memory:" ? dbPath : resolve(dbPath);
		if (resolved !== ":memory:") mkdirSync(dirname(resolved), { recursive: true });
		this.db = new DatabaseSync(resolved);
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec("PRAGMA foreign_keys = ON");
		if (resolved !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.applySchema();
	}

	close(): void {
		this.db.close();
	}

	createJob(input: PiboCronJobCreateInput, now = new Date()): PiboCronJob {
		const target = normalizeTarget(input.target);
		validateJobInput({ ...input, target });
		const timestamp = nowIso(now);
		const nextRunAt = input.enabled === false ? undefined : computeNextRunAt(input.schedule, now)?.toISOString();
		if (input.enabled !== false && !nextRunAt) throw new Error("schedule has no future run");
		const job: PiboCronJob = {
			id: `cron_${randomUUID()}`,
			name: (input.name ?? defaultName(input.prompt)).trim(),
			description: input.description?.trim() || undefined,
			enabled: input.enabled !== false,
			target,
			profile: input.profile,
			prompt: input.prompt,
			schedule: input.schedule,
			scheduleUi: input.scheduleUi,
			deleteAfterRun: input.deleteAfterRun === true,
			state: { nextRunAt },
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.insertJob(job);
		return this.getJob(job.id)!;
	}

	getJob(id: string): PiboCronJob | undefined {
		const row = this.db.prepare("SELECT * FROM pibo_cron_jobs WHERE id = ?").get(id) as CronJobRow | undefined;
		return row ? jobFromRow(row) : undefined;
	}

	listJobs(input: { includeDisabled?: boolean } = {}): PiboCronJob[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (!input.includeDisabled) clauses.push("enabled = 1");
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		return (this.db.prepare(`SELECT * FROM pibo_cron_jobs ${where} ORDER BY updated_at DESC, id ASC`).all(...values) as CronJobRow[]).map(jobFromRow);
	}

	updateJob(id: string, patch: PiboCronJobPatchInput, now = new Date()): PiboCronJob | undefined {
		const existing = this.getJob(id);
		if (!existing) return undefined;
		const nextTarget = patch.target ? normalizeTarget(patch.target) : existing.target;
		const next: PiboCronJob = {
			...existing,
			...patch,
			name: patch.name !== undefined ? patch.name.trim() : existing.name,
			description: patch.description !== undefined ? patch.description?.trim() || undefined : existing.description,
			enabled: patch.enabled ?? existing.enabled,
			target: nextTarget,
			profile: patch.profile ?? existing.profile,
			prompt: patch.prompt ?? existing.prompt,
			schedule: patch.schedule ?? existing.schedule,
			scheduleUi: patch.scheduleUi ?? existing.scheduleUi,
			deleteAfterRun: patch.deleteAfterRun ?? existing.deleteAfterRun,
			updatedAt: nowIso(now),
		};
		validateJobInput(next);
		next.state = {
			...existing.state,
			runningAt: existing.state.runningAt,
			nextRunAt: next.enabled ? computeNextRunAt(next.schedule, now)?.toISOString() : undefined,
		};
		if (next.enabled && !next.state.nextRunAt && next.schedule.kind !== "at") throw new Error("schedule has no future run");
		this.writeJob(next);
		return this.getJob(id);
	}

	removeJob(id: string): boolean {
		const result = this.db.prepare("DELETE FROM pibo_cron_jobs WHERE id = ?").run(id);
		return Number(result.changes ?? 0) > 0;
	}

	listRuns(input: { jobId?: string; limit?: number } = {}): PiboCronRun[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (input.jobId) { clauses.push("job_id = ?"); values.push(input.jobId); }
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		return (this.db.prepare(`SELECT * FROM pibo_cron_runs ${where} ORDER BY created_at DESC LIMIT ?`).all(...values, Math.max(1, Math.min(input.limit ?? 100, 500))) as CronRunRow[]).map(runFromRow);
	}

	getRun(id: string): PiboCronRun | undefined {
		const row = this.db.prepare("SELECT * FROM pibo_cron_runs WHERE id = ?").get(id) as CronRunRow | undefined;
		return row ? runFromRow(row) : undefined;
	}

	reserveDueRuns(limit: number, now = new Date()): Array<{ job: PiboCronJob; run: PiboCronRun }> {
		const timestamp = nowIso(now);
		const result: Array<{ job: PiboCronJob; run: PiboCronRun }> = [];
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const rows = this.db.prepare(`
				SELECT * FROM pibo_cron_jobs
				WHERE enabled = 1
				ORDER BY updated_at ASC
			`).all() as CronJobRow[];
			for (const row of rows) {
				if (result.length >= limit) break;
				const job = jobFromRow(row);
				if (job.state.runningAt) continue;
				if (!job.state.nextRunAt || job.state.nextRunAt > timestamp) continue;
				const run = this.createRunLocked(job, timestamp, "running");
				const state = { ...job.state, runningAt: timestamp, lastRunAt: timestamp, lastRunId: run.id };
				this.updateJobStateLocked(job.id, state, timestamp);
				result.push({ job: { ...job, state, updatedAt: timestamp }, run });
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
		return result;
	}

	reserveManualRun(id: string, now = new Date()): { job: PiboCronJob; run: PiboCronRun } | undefined {
		const timestamp = nowIso(now);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const job = this.getJob(id);
			if (!job) { this.db.exec("COMMIT"); return undefined; }
			if (job.state.runningAt) throw new Error("Job is already running");
			const run = this.createRunLocked(job, timestamp, "running", "manual");
			const state = { ...job.state, runningAt: timestamp, lastRunAt: timestamp, lastRunId: run.id };
			this.updateJobStateLocked(job.id, state, timestamp);
			this.db.exec("COMMIT");
			return { job: { ...job, state, updatedAt: timestamp }, run };
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	completeRun(input: { jobId: string; runId: string; status: PiboCronRunStatus; piboSessionId?: string; error?: string; reason?: string }, now = new Date()): void {
		const timestamp = nowIso(now);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const job = this.getJob(input.jobId);
			if (!job) { this.db.exec("COMMIT"); return; }
			const nextRunAt = job.enabled && job.schedule.kind !== "at" ? computeNextRunAt(job.schedule, now)?.toISOString() : undefined;
			const enabled = job.schedule.kind === "at" && input.status === "ok" ? false : job.enabled;
			const state: PiboCronJobState = {
				...job.state,
				runningAt: undefined,
				nextRunAt: enabled ? nextRunAt : undefined,
				lastRunAt: timestamp,
				lastRunId: input.runId,
				lastStatus: input.status === "error" ? "error" : input.status === "skipped" ? "skipped" : "ok",
				lastError: input.error,
				lastPiboSessionId: input.piboSessionId ?? job.state.lastPiboSessionId,
				consecutiveErrors: input.status === "error" ? (job.state.consecutiveErrors ?? 0) + 1 : 0,
			};
			this.db.prepare(`
				UPDATE pibo_cron_runs
				SET status = ?, pibo_session_id = ?, reason = ?, error = ?, completed_at = ?, updated_at = ?
				WHERE id = ?
			`).run(input.status, input.piboSessionId ?? null, input.reason ?? null, input.error ?? null, timestamp, timestamp, input.runId);
			this.db.prepare(`UPDATE pibo_cron_jobs SET enabled = ?, state_json = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, JSON.stringify(state), timestamp, job.id);
			if (job.deleteAfterRun && job.schedule.kind === "at" && input.status === "ok") {
				this.db.prepare("DELETE FROM pibo_cron_jobs WHERE id = ?").run(job.id);
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	recoverInterruptedRuns(cutoff = new Date(Date.now() - 5 * 60_000)): number {
		const cutoffIso = nowIso(cutoff);
		const rows = this.db.prepare("SELECT * FROM pibo_cron_jobs WHERE json_extract(state_json, '$.runningAt') IS NOT NULL").all() as CronJobRow[];
		let recovered = 0;
		for (const row of rows) {
			const job = jobFromRow(row);
			if (!job.state.runningAt || job.state.runningAt > cutoffIso) continue;
			if (job.state.lastRunId) {
				this.completeRun({ jobId: job.id, runId: job.state.lastRunId, status: "error", error: "Cron run was interrupted by gateway restart", reason: "interrupted" });
			} else {
				this.updateJobStateLocked(job.id, { ...job.state, runningAt: undefined }, nowIso());
			}
			recovered += 1;
		}
		return recovered;
	}

	status(): { jobs: number; running: number; nextRunAt?: string } {
		const jobs = this.listJobs({ includeDisabled: false });
		const running = jobs.filter((job) => job.state.runningAt).length;
		const nextRunAt = jobs.map((job) => job.state.nextRunAt).filter((value): value is string => Boolean(value)).sort()[0];
		return { jobs: jobs.length, running, nextRunAt };
	}

	private applySchema(): void {
		this.createFreshSchema();
	}

	private createFreshSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS pibo_cron_jobs (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT,
				enabled INTEGER NOT NULL,
				target_json TEXT NOT NULL,
				profile TEXT NOT NULL,
				prompt TEXT NOT NULL,
				schedule_json TEXT NOT NULL,
				schedule_ui_json TEXT,
				delete_after_run INTEGER NOT NULL DEFAULT 0,
				state_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_pibo_cron_jobs_enabled ON pibo_cron_jobs(enabled, updated_at DESC);

			CREATE TABLE IF NOT EXISTS pibo_cron_runs (
				id TEXT PRIMARY KEY,
				job_id TEXT NOT NULL,
				pibo_session_id TEXT,
				status TEXT NOT NULL,
				reason TEXT,
				error TEXT,
				started_at TEXT,
				completed_at TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_pibo_cron_runs_job_created ON pibo_cron_runs(job_id, created_at DESC);
		`);
	}

	private insertJob(job: PiboCronJob): void {
		this.db.prepare(`
			INSERT INTO pibo_cron_jobs (id, name, description, enabled, target_json, profile, prompt, schedule_json, schedule_ui_json, delete_after_run, state_json, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(job.id, job.name, job.description ?? null, job.enabled ? 1 : 0, targetJson(job.target), job.profile, job.prompt, JSON.stringify(job.schedule), job.scheduleUi ? JSON.stringify(job.scheduleUi) : null, job.deleteAfterRun ? 1 : 0, JSON.stringify(job.state), job.createdAt, job.updatedAt);
	}

	private writeJob(job: PiboCronJob): void {
		this.db.prepare(`
			UPDATE pibo_cron_jobs
			SET name = ?, description = ?, enabled = ?, target_json = ?, profile = ?, prompt = ?, schedule_json = ?, schedule_ui_json = ?, delete_after_run = ?, state_json = ?, updated_at = ?
			WHERE id = ?
		`).run(job.name, job.description ?? null, job.enabled ? 1 : 0, targetJson(job.target), job.profile, job.prompt, JSON.stringify(job.schedule), job.scheduleUi ? JSON.stringify(job.scheduleUi) : null, job.deleteAfterRun ? 1 : 0, JSON.stringify(job.state), job.updatedAt, job.id);
	}

	private updateJobStateLocked(id: string, state: PiboCronJobState, updatedAt: string): void {
		this.db.prepare("UPDATE pibo_cron_jobs SET state_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(state), updatedAt, id);
	}

	private createRunLocked(job: PiboCronJob, timestamp: string, status: PiboCronRunStatus, reason?: string): PiboCronRun {
		const run: PiboCronRun = { id: `crun_${randomUUID()}`, jobId: job.id, status, reason, startedAt: timestamp, createdAt: timestamp, updatedAt: timestamp };
		this.db.prepare(`
			INSERT INTO pibo_cron_runs (id, job_id, pibo_session_id, status, reason, error, started_at, completed_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(run.id, run.jobId, null, run.status, run.reason ?? null, null, run.startedAt ?? null, null, run.createdAt, run.updatedAt);
		return run;
	}
}

export function createDefaultPiboCronStore(options: PiboCronStoreOptions = {}): PiboCronStore {
	return new PiboCronStore(options);
}
