import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { piboHomePath } from '../core/pibo-home.js';
import { isPiboThinkingLevel } from '../core/thinking.js';
import type { PiboJsonObject } from '../core/events.js';
import type { ModelProfile } from '../core/profiles.js';
import type { PiboThinkingLevel } from '../core/thinking.js';
import type { PiboRalphFactReader, PiboRalphJob, PiboRalphJobCreateInput, PiboRalphJobPatchInput, PiboRalphJobState, PiboRalphRun, PiboRalphRunFact, PiboRalphRunStatus, PiboRalphStopEvaluationSummary, PiboRalphStopPolicy } from './types.js';

export type PiboRalphStoreOptions = { path?: string };

type RalphJobRow = { id: string; owner_scope: string; name: string; description: string | null; enabled: number; target_json: string; profile: string; prompt: string; max_iterations: number | null; runtime_options_json: string | null; stop_policy_json: string | null; state_json: string; created_at: string; updated_at: string };
type RalphRunRow = { id: string; job_id: string; owner_scope: string; pibo_session_id: string | null; status: PiboRalphRunStatus; reason: string | null; error: string | null; started_at: string | null; completed_at: string | null; created_at: string; updated_at: string };
type RalphRunFactRow = { id: string; owner_scope: string; job_id: string; run_id: string | null; pibo_session_id: string | null; type: string; source: PiboRalphRunFact['source']; payload_json: string; created_at: string };

function nowIso(now = new Date()): string { return now.toISOString(); }
function parseJson<T>(json: string): T { return JSON.parse(json) as T; }
function defaultName(prompt: string): string { const normalized = prompt.replace(/\s+/g, ' ').trim(); return normalized ? normalized.slice(0, 80) : 'Ralph job'; }
function isJsonObject(value: unknown): value is PiboJsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }

type RalphRuntimeOptions = { modelOverride?: ModelProfile; thinkingLevel?: PiboThinkingLevel; fastMode?: boolean };

function jobFromRow(row: RalphJobRow): PiboRalphJob {
	return { id: row.id, ownerScope: row.owner_scope, name: row.name, description: row.description ?? undefined, enabled: row.enabled === 1, target: parseJson(row.target_json), profile: row.profile, prompt: row.prompt, maxIterations: row.max_iterations ?? undefined, stopPolicy: parseStopPolicy(row.stop_policy_json), ...parseRuntimeOptions(row.runtime_options_json), state: parseJson(row.state_json), createdAt: row.created_at, updatedAt: row.updated_at };
}
function runFromRow(row: RalphRunRow): PiboRalphRun {
	return { id: row.id, jobId: row.job_id, ownerScope: row.owner_scope, piboSessionId: row.pibo_session_id ?? undefined, status: row.status, reason: row.reason ?? undefined, error: row.error ?? undefined, startedAt: row.started_at ?? undefined, completedAt: row.completed_at ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at };
}
function factFromRow(row: RalphRunFactRow): PiboRalphRunFact {
	return { id: row.id, ownerScope: row.owner_scope, jobId: row.job_id, runId: row.run_id ?? undefined, piboSessionId: row.pibo_session_id ?? undefined, type: row.type, source: row.source, payload: parseJson(row.payload_json), createdAt: row.created_at };
}
function normalizeMaxIterations(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1) throw new Error('maxIterations must be a positive integer');
	return value;
}
function normalizeModelOverride(value: ModelProfile | null | undefined): ModelProfile | undefined {
	if (value === undefined || value === null) return undefined;
	const provider = value.provider.trim();
	const id = value.id.trim();
	if (!provider || !id) throw new Error('modelOverride must include provider and id');
	return { provider, id };
}
function normalizeThinkingLevel(value: PiboThinkingLevel | string | null | undefined): PiboThinkingLevel | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isPiboThinkingLevel(value)) throw new Error('thinkingLevel must be one of off, minimal, low, medium, high, xhigh');
	return value;
}
function normalizeFastMode(value: boolean | null | undefined): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'boolean') throw new Error('fastMode must be a boolean');
	return value;
}
function normalizeRuntimeOptions(input: { modelOverride?: ModelProfile | null; thinkingLevel?: PiboThinkingLevel | string | null; fastMode?: boolean | null }): RalphRuntimeOptions {
	return { modelOverride: normalizeModelOverride(input.modelOverride), thinkingLevel: normalizeThinkingLevel(input.thinkingLevel), fastMode: normalizeFastMode(input.fastMode) };
}
function parseRuntimeOptions(json: string | null): RalphRuntimeOptions {
	if (!json) return {};
	try { const parsed = JSON.parse(json) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}; return normalizeRuntimeOptions(parsed as RalphRuntimeOptions); } catch { return {}; }
}
function runtimeOptionsJson(job: Pick<PiboRalphJob, 'modelOverride' | 'thinkingLevel' | 'fastMode'>): string | null {
	const options = normalizeRuntimeOptions(job);
	const json: Record<string, unknown> = {};
	if (options.modelOverride) json.modelOverride = options.modelOverride;
	if (options.thinkingLevel) json.thinkingLevel = options.thinkingLevel;
	if (options.fastMode !== undefined) json.fastMode = options.fastMode;
	return Object.keys(json).length ? JSON.stringify(json) : null;
}
function hasOwn(object: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(object, key); }

export function normalizeRalphStopPolicy(value: PiboRalphStopPolicy | null | undefined): PiboRalphStopPolicy | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('stopPolicy must be an object');
	if (value.mode !== 'any' && value.mode !== 'all') throw new Error('stopPolicy.mode must be any or all');
	if (!Array.isArray(value.conditions)) throw new Error('stopPolicy.conditions must be an array');
	const ids = new Set<string>();
	return { mode: value.mode, conditions: value.conditions.map((condition, index) => {
		if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new Error(`stopPolicy.conditions[${index}] must be an object`);
		const id = typeof condition.id === 'string' && condition.id.trim() ? condition.id.trim() : `condition-${index + 1}`;
		const type = typeof condition.type === 'string' ? condition.type.trim() : '';
		if (!type) throw new Error(`stopPolicy.conditions[${index}].type is required`);
		if (ids.has(id)) throw new Error(`Duplicate Ralph stop condition id: ${id}`);
		ids.add(id);
		if (condition.options !== undefined && !isJsonObject(condition.options)) throw new Error(`stopPolicy.conditions[${index}].options must be an object`);
		if (condition.enabled !== undefined && typeof condition.enabled !== 'boolean') throw new Error(`stopPolicy.conditions[${index}].enabled must be a boolean`);
		if (condition.failClosed !== undefined && typeof condition.failClosed !== 'boolean') throw new Error(`stopPolicy.conditions[${index}].failClosed must be a boolean`);
		if (condition.timeoutMs !== undefined && (!Number.isInteger(condition.timeoutMs) || condition.timeoutMs < 1)) throw new Error(`stopPolicy.conditions[${index}].timeoutMs must be a positive integer`);
		return { id, type, ...(condition.enabled !== undefined ? { enabled: condition.enabled } : {}), ...(condition.options ? { options: condition.options } : {}), ...(condition.failClosed !== undefined ? { failClosed: condition.failClosed } : {}), ...(condition.timeoutMs !== undefined ? { timeoutMs: condition.timeoutMs } : {}) };
	}) };
}
function parseStopPolicy(json: string | null): PiboRalphStopPolicy | undefined {
	if (!json) return undefined;
	try { return normalizeRalphStopPolicy(JSON.parse(json) as PiboRalphStopPolicy); } catch { return undefined; }
}
function stopPolicyJson(policy: PiboRalphStopPolicy | undefined): string | null { return policy ? JSON.stringify(normalizeRalphStopPolicy(policy)) : null; }
function validateJobInput(input: Pick<PiboRalphJobCreateInput, 'ownerScope' | 'target' | 'profile' | 'prompt' | 'maxIterations' | 'modelOverride' | 'thinkingLevel' | 'fastMode' | 'stopPolicy'>): void {
	if (!input.ownerScope.trim()) throw new Error('ownerScope is required');
	if (!input.profile.trim()) throw new Error('profile is required');
	if (!input.prompt.trim()) throw new Error('prompt is required');
	if (input.target.kind === 'room' && !input.target.roomId.trim()) throw new Error('target.roomId is required');
	if (input.target.kind === 'personal' && !input.target.principalId.trim()) throw new Error('target.principalId is required');
	normalizeMaxIterations(input.maxIterations);
	normalizeRuntimeOptions(input);
	normalizeRalphStopPolicy(input.stopPolicy);
}

export class PiboRalphStore {
	private readonly db: DatabaseSync;
	constructor(options: PiboRalphStoreOptions = {}) {
		const dbPath = options.path ?? piboHomePath('pibo-ralph.sqlite');
		const resolved = dbPath === ':memory:' ? dbPath : resolve(dbPath);
		if (resolved !== ':memory:') mkdirSync(dirname(resolved), { recursive: true });
		this.db = new DatabaseSync(resolved);
		this.db.exec('PRAGMA busy_timeout = 5000');
		this.db.exec('PRAGMA foreign_keys = ON');
		if (resolved !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
		this.applySchema();
	}
	close(): void { this.db.close(); }
	createJob(input: PiboRalphJobCreateInput, now = new Date()): PiboRalphJob {
		validateJobInput(input);
		const timestamp = nowIso(now);
		const runtimeOptions = normalizeRuntimeOptions(input);
		const job: PiboRalphJob = { id: `ralph_${randomUUID()}`, ownerScope: input.ownerScope, name: (input.name ?? defaultName(input.prompt)).trim(), description: input.description?.trim() || undefined, enabled: input.enabled === true, target: input.target, profile: input.profile, prompt: input.prompt, maxIterations: normalizeMaxIterations(input.maxIterations), stopPolicy: normalizeRalphStopPolicy(input.stopPolicy), ...runtimeOptions, state: { completedIterations: 0 }, createdAt: timestamp, updatedAt: timestamp };
		this.insertJob(job);
		return this.getJob(job.id)!;
	}
	getJob(id: string): PiboRalphJob | undefined { const row = this.db.prepare('SELECT * FROM pibo_ralph_jobs WHERE id = ?').get(id) as RalphJobRow | undefined; return row ? jobFromRow(row) : undefined; }
	getOwnedJob(ownerScope: string, id: string): PiboRalphJob | undefined { const row = this.db.prepare('SELECT * FROM pibo_ralph_jobs WHERE id = ? AND owner_scope = ?').get(id, ownerScope) as RalphJobRow | undefined; return row ? jobFromRow(row) : undefined; }
	listJobs(input: { ownerScope?: string; includeDisabled?: boolean } = {}): PiboRalphJob[] {
		const clauses: string[] = []; const values: Array<string | number> = [];
		if (input.ownerScope) { clauses.push('owner_scope = ?'); values.push(input.ownerScope); }
		if (!input.includeDisabled) clauses.push('enabled = 1');
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		return (this.db.prepare(`SELECT * FROM pibo_ralph_jobs ${where} ORDER BY updated_at DESC, id ASC`).all(...values) as RalphJobRow[]).map(jobFromRow);
	}
	updateJob(ownerScope: string, id: string, patch: PiboRalphJobPatchInput, now = new Date()): PiboRalphJob | undefined {
		const existing = this.getOwnedJob(ownerScope, id); if (!existing) return undefined;
		const runtimeOptions = normalizeRuntimeOptions({
			modelOverride: hasOwn(patch, 'modelOverride') ? patch.modelOverride : existing.modelOverride,
			thinkingLevel: hasOwn(patch, 'thinkingLevel') ? patch.thinkingLevel : existing.thinkingLevel,
			fastMode: hasOwn(patch, 'fastMode') ? patch.fastMode : existing.fastMode,
		});
		const stopPolicy = hasOwn(patch, 'stopPolicy') ? normalizeRalphStopPolicy(patch.stopPolicy ?? undefined) : existing.stopPolicy;
		const next: PiboRalphJob = { ...existing, name: patch.name !== undefined ? patch.name.trim() : existing.name, description: patch.description !== undefined ? patch.description?.trim() || undefined : existing.description, enabled: patch.enabled ?? existing.enabled, target: patch.target ?? existing.target, profile: patch.profile ?? existing.profile, prompt: patch.prompt ?? existing.prompt, maxIterations: hasOwn(patch, 'maxIterations') ? normalizeMaxIterations(patch.maxIterations ?? undefined) : existing.maxIterations, stopPolicy, modelOverride: runtimeOptions.modelOverride, thinkingLevel: runtimeOptions.thinkingLevel, fastMode: runtimeOptions.fastMode, updatedAt: nowIso(now) };
		validateJobInput(next); this.writeJob(next); return this.getJob(id);
	}
	removeJob(ownerScope: string, id: string): boolean { const result = this.db.prepare('DELETE FROM pibo_ralph_jobs WHERE id = ? AND owner_scope = ?').run(id, ownerScope); return Number(result.changes ?? 0) > 0; }
	listRuns(input: { ownerScope?: string; jobId?: string; limit?: number } = {}): PiboRalphRun[] {
		const clauses: string[] = []; const values: Array<string | number> = [];
		if (input.ownerScope) { clauses.push('owner_scope = ?'); values.push(input.ownerScope); }
		if (input.jobId) { clauses.push('job_id = ?'); values.push(input.jobId); }
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		return (this.db.prepare(`SELECT * FROM pibo_ralph_runs ${where} ORDER BY created_at DESC LIMIT ?`).all(...values, Math.max(1, Math.min(input.limit ?? 100, 500))) as RalphRunRow[]).map(runFromRow);
	}
	reserveRun(ownerScope: string, id: string, now = new Date()): { job: PiboRalphJob; run: PiboRalphRun } | undefined { this.updateJob(ownerScope, id, { enabled: true }, now); return this.reserveJob(id, now); }
	reserveDueRuns(limit: number, now = new Date()): Array<{ job: PiboRalphJob; run: PiboRalphRun }> {
		const rows = this.db.prepare('SELECT * FROM pibo_ralph_jobs WHERE enabled = 1 ORDER BY updated_at ASC').all() as RalphJobRow[];
		const result: Array<{ job: PiboRalphJob; run: PiboRalphRun }> = [];
		for (const row of rows) { if (result.length >= limit) break; const reserved = this.reserveJob(row.id, now); if (reserved) result.push(reserved); }
		return result;
	}
	attachRunSession(jobId: string, runId: string, piboSessionId: string, now = new Date()): void {
		const timestamp = nowIso(now); const job = this.getJob(jobId); if (!job) return;
		this.db.prepare('UPDATE pibo_ralph_runs SET pibo_session_id = ?, updated_at = ? WHERE id = ?').run(piboSessionId, timestamp, runId);
		this.updateJobStateLocked(jobId, { ...job.state, lastPiboSessionId: piboSessionId }, timestamp);
	}
	requestStop(ownerScope: string, id: string, now = new Date()): PiboRalphJob | undefined {
		const job = this.getOwnedJob(ownerScope, id); if (!job) return undefined;
		const state = { ...job.state, stopRequestedAt: nowIso(now) };
		this.writeJob({ ...job, enabled: false, state, updatedAt: nowIso(now) }); return this.getJob(id);
	}
	requestCancel(ownerScope: string, id: string, now = new Date()): PiboRalphJob | undefined {
		const job = this.getOwnedJob(ownerScope, id); if (!job) return undefined;
		const state = { ...job.state, stopRequestedAt: nowIso(now), cancelRequestedAt: nowIso(now) };
		this.writeJob({ ...job, enabled: false, state, updatedAt: nowIso(now) }); return this.getJob(id);
	}
	applyStopEvaluation(input: { jobId: string; evaluation: PiboRalphStopEvaluationSummary; conditionStates?: Record<string, PiboJsonObject>; disable?: boolean }, now = new Date()): void {
		const job = this.getJob(input.jobId); if (!job) return;
		const timestamp = nowIso(now);
		const state: PiboRalphJobState = { ...job.state, runningAt: undefined, conditionStates: input.conditionStates ?? job.state.conditionStates, lastStopEvaluation: input.evaluation };
		this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = ?, state_json = ?, updated_at = ? WHERE id = ?').run(input.disable ? 0 : job.enabled ? 1 : 0, JSON.stringify(state), timestamp, job.id);
	}
	completeRun(input: { jobId: string; runId: string; status: PiboRalphRunStatus; piboSessionId?: string; error?: string; reason?: string; stopAfterRun?: boolean; stopEvaluation?: PiboRalphStopEvaluationSummary; conditionStates?: Record<string, PiboJsonObject> }, now = new Date()): void {
		const timestamp = nowIso(now); const job = this.getJob(input.jobId); if (!job) return;
			const completedIterations = (job.state.completedIterations ?? 0) + 1;
		const reachedMaxIterations = job.maxIterations !== undefined && completedIterations >= job.maxIterations;
		const shouldDisable = reachedMaxIterations || input.stopAfterRun === true || input.stopEvaluation?.finalAction === 'stop-after-run' || input.stopEvaluation?.finalAction === 'cancel-current-run';
		const state: PiboRalphJobState = { ...job.state, runningAt: undefined, completedIterations, lastRunAt: timestamp, lastRunId: input.runId, lastStatus: input.status === 'error' ? 'error' : input.status === 'cancelled' ? 'cancelled' : 'ok', lastError: input.error, lastPiboSessionId: input.piboSessionId ?? job.state.lastPiboSessionId, consecutiveErrors: input.status === 'error' ? (job.state.consecutiveErrors ?? 0) + 1 : 0, conditionStates: input.conditionStates ?? job.state.conditionStates, lastStopEvaluation: input.stopEvaluation ?? job.state.lastStopEvaluation };
		this.db.prepare('UPDATE pibo_ralph_runs SET status = ?, pibo_session_id = ?, reason = ?, error = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(input.status, input.piboSessionId ?? null, input.reason ?? input.stopEvaluation?.reason ?? null, input.error ?? null, timestamp, timestamp, input.runId);
		this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = ?, state_json = ?, updated_at = ? WHERE id = ?').run(shouldDisable ? 0 : job.enabled ? 1 : 0, JSON.stringify(state), timestamp, job.id);
	}
	appendRunFact(input: Omit<PiboRalphRunFact, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): PiboRalphRunFact {
		if (!input.ownerScope.trim()) throw new Error('fact ownerScope is required');
		if (!input.jobId.trim()) throw new Error('fact jobId is required');
		if (!input.type.trim()) throw new Error('fact type is required');
		if (!isJsonObject(input.payload)) throw new Error('fact payload must be an object');
		const payloadJson = JSON.stringify(input.payload);
		if (payloadJson.length > 16_384) throw new Error('fact payload is too large');
		const fact: PiboRalphRunFact = { id: input.id ?? `rfact_${randomUUID()}`, ownerScope: input.ownerScope, jobId: input.jobId, runId: input.runId, piboSessionId: input.piboSessionId, type: input.type.trim(), source: input.source, payload: input.payload, createdAt: input.createdAt ?? nowIso() };
		this.db.prepare('INSERT INTO pibo_ralph_run_facts (id, owner_scope, job_id, run_id, pibo_session_id, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(fact.id, fact.ownerScope, fact.jobId, fact.runId ?? null, fact.piboSessionId ?? null, fact.type, fact.source, payloadJson, fact.createdAt);
		return fact;
	}
	listRunFacts(input: { ownerScope?: string; jobId?: string; runId?: string; type?: string; limit?: number } = {}): PiboRalphRunFact[] {
		const clauses: string[] = []; const values: Array<string | number> = [];
		if (input.ownerScope) { clauses.push('owner_scope = ?'); values.push(input.ownerScope); }
		if (input.jobId) { clauses.push('job_id = ?'); values.push(input.jobId); }
		if (input.runId) { clauses.push('run_id = ?'); values.push(input.runId); }
		if (input.type) { clauses.push('type = ?'); values.push(input.type); }
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		return (this.db.prepare(`SELECT * FROM pibo_ralph_run_facts ${where} ORDER BY created_at DESC LIMIT ?`).all(...values, Math.max(1, Math.min(input.limit ?? 100, 500))) as RalphRunFactRow[]).map(factFromRow);
	}
	createFactReader(job: PiboRalphJob): PiboRalphFactReader {
		return { list: (input = {}) => this.listRunFacts({ ownerScope: job.ownerScope, jobId: job.id, type: input.type, runId: input.runId, limit: input.limit }), count: (input = {}) => this.listRunFacts({ ownerScope: job.ownerScope, jobId: job.id, type: input.type, runId: input.runId, limit: 500 }).length };
	}
	recoverInterruptedRuns(cutoff = new Date(Date.now() - 5 * 60_000)): number { const cutoffIso = nowIso(cutoff); const rows = this.db.prepare("SELECT * FROM pibo_ralph_jobs WHERE json_extract(state_json, '$.runningAt') IS NOT NULL").all() as RalphJobRow[]; let recovered = 0; for (const row of rows) { const job = jobFromRow(row); if (!job.state.runningAt || job.state.runningAt > cutoffIso) continue; if (job.state.lastRunId) this.completeRun({ jobId: job.id, runId: job.state.lastRunId, status: 'error', error: 'Ralph run was interrupted by gateway restart', reason: 'interrupted' }); recovered += 1; } return recovered; }
	status(): { jobs: number; running: number } { const jobs = this.listJobs({ includeDisabled: false }); return { jobs: jobs.length, running: jobs.filter((job) => job.state.runningAt).length }; }
	private reserveJob(id: string, now = new Date()): { job: PiboRalphJob; run: PiboRalphRun } | undefined {
		const timestamp = nowIso(now); this.db.exec('BEGIN IMMEDIATE');
		try { const job = this.getJob(id); if (!job || !job.enabled || job.state.runningAt) { this.db.exec('COMMIT'); return undefined; } const run = this.createRunLocked(job, timestamp); const state = { ...job.state, runningAt: timestamp, lastRunAt: timestamp, lastRunId: run.id }; this.updateJobStateLocked(job.id, state, timestamp); this.db.exec('COMMIT'); return { job: { ...job, state, updatedAt: timestamp }, run }; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
	}
	private applySchema(): void {
		this.db.exec(`CREATE TABLE IF NOT EXISTS pibo_ralph_jobs (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL, target_json TEXT NOT NULL, profile TEXT NOT NULL, prompt TEXT NOT NULL, max_iterations INTEGER, runtime_options_json TEXT, stop_policy_json TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_jobs_owner ON pibo_ralph_jobs(owner_scope, updated_at DESC); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_jobs_enabled ON pibo_ralph_jobs(enabled, updated_at DESC); CREATE TABLE IF NOT EXISTS pibo_ralph_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, owner_scope TEXT NOT NULL, pibo_session_id TEXT, status TEXT NOT NULL, reason TEXT, error TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_runs_job_created ON pibo_ralph_runs(job_id, created_at DESC); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_runs_owner_created ON pibo_ralph_runs(owner_scope, created_at DESC); CREATE TABLE IF NOT EXISTS pibo_ralph_run_facts (id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, job_id TEXT NOT NULL, run_id TEXT, pibo_session_id TEXT, type TEXT NOT NULL, source TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_facts_job_created ON pibo_ralph_run_facts(job_id, created_at DESC); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_facts_run_type ON pibo_ralph_run_facts(run_id, type, created_at DESC);`);
		this.ensureJobColumn('max_iterations', 'INTEGER');
		this.ensureJobColumn('runtime_options_json', 'TEXT');
		this.ensureJobColumn('stop_policy_json', 'TEXT');
	}
	private ensureJobColumn(name: string, definition: string): void {
		const columns = this.db.prepare('PRAGMA table_info(pibo_ralph_jobs)').all() as Array<{ name: string }>;
		if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE pibo_ralph_jobs ADD COLUMN ${name} ${definition}`);
	}
	private insertJob(job: PiboRalphJob): void { this.db.prepare('INSERT INTO pibo_ralph_jobs (id, owner_scope, name, description, enabled, target_json, profile, prompt, max_iterations, runtime_options_json, stop_policy_json, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(job.id, job.ownerScope, job.name, job.description ?? null, job.enabled ? 1 : 0, JSON.stringify(job.target), job.profile, job.prompt, job.maxIterations ?? null, runtimeOptionsJson(job), stopPolicyJson(job.stopPolicy), JSON.stringify(job.state), job.createdAt, job.updatedAt); }
	private writeJob(job: PiboRalphJob): void { this.db.prepare('UPDATE pibo_ralph_jobs SET name = ?, description = ?, enabled = ?, target_json = ?, profile = ?, prompt = ?, max_iterations = ?, runtime_options_json = ?, stop_policy_json = ?, state_json = ?, updated_at = ? WHERE id = ? AND owner_scope = ?').run(job.name, job.description ?? null, job.enabled ? 1 : 0, JSON.stringify(job.target), job.profile, job.prompt, job.maxIterations ?? null, runtimeOptionsJson(job), stopPolicyJson(job.stopPolicy), JSON.stringify(job.state), job.updatedAt, job.id, job.ownerScope); }
	private updateJobStateLocked(id: string, state: PiboRalphJobState, updatedAt: string): void { this.db.prepare('UPDATE pibo_ralph_jobs SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), updatedAt, id); }
	private createRunLocked(job: PiboRalphJob, timestamp: string): PiboRalphRun { const run: PiboRalphRun = { id: `rrun_${randomUUID()}`, jobId: job.id, ownerScope: job.ownerScope, status: 'running', startedAt: timestamp, createdAt: timestamp, updatedAt: timestamp }; this.db.prepare('INSERT INTO pibo_ralph_runs (id, job_id, owner_scope, pibo_session_id, status, reason, error, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, ?, ?)').run(run.id, run.jobId, run.ownerScope, run.status, run.startedAt ?? null, run.createdAt, run.updatedAt); return run; }
}
export function createDefaultPiboRalphStore(options: PiboRalphStoreOptions = {}): PiboRalphStore { return new PiboRalphStore(options); }
