import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { piboHomePath } from '../core/pibo-home.js';
import { isPiboThinkingLevel } from '../core/thinking.js';
import type { PiboJsonObject, PiboMessageEvent, PiboSessionErrorDetails } from '../core/events.js';
import type { ModelProfile } from '../core/profiles.js';
import type { PiboThinkingLevel } from '../core/thinking.js';
import { newGoalTokenAccounting, normalizeLoopTokenAccounting } from './accounting.js';
import type { PiboGoalStatus, PiboLoopFactReader, PiboLoopFailure, PiboLoopJob, PiboLoopJobCreateInput, PiboLoopJobPatchInput, PiboLoopJobState, PiboLoopMode, PiboLoopResourceCleanupState, PiboLoopResourceMetadata, PiboLoopRun, PiboLoopRunAccounting, PiboLoopRunFact, PiboLoopRunMessageState, PiboLoopRunStatus, PiboLoopStopEvaluationSummary, PiboLoopStopPolicy, PiboLoopTarget } from './types.js';

export type PiboLoopStoreOptions = { path?: string };

type LoopJobRow = { id: string; loop_mode: string; name: string; description: string | null; enabled: number; target_json: string; profile: string; prompt: string; max_iterations: number | null; token_budget: number | null; token_reserve: number | null; runtime_options_json: string | null; stop_policy_json: string | null; resource_json?: string | null; state_json: string; created_at: string; updated_at: string };
type LoopRunRow = { id: string; job_id: string; pibo_session_id: string | null; status: PiboLoopRunStatus; reason: string | null; error: string | null; error_details_json?: string | null; message_event_id?: string | null; message_state?: PiboLoopRunMessageState | null; accounting_json?: string | null; resource_json?: string | null; started_at: string | null; completed_at: string | null; created_at: string; updated_at: string };
type LoopRunFactRow = { id: string; job_id: string; run_id: string | null; pibo_session_id: string | null; type: string; source: PiboLoopRunFact['source']; payload_json: string; created_at: string };

function nowIso(now = new Date()): string { return now.toISOString(); }
function parseJson<T>(json: string): T { return JSON.parse(json) as T; }
function defaultName(prompt: string): string { const normalized = prompt.replace(/\s+/g, ' ').trim(); return normalized ? normalized.slice(0, 80) : 'Loop job'; }
function normalizeLoopMode(value: unknown, fallback: PiboLoopMode = 'goal'): PiboLoopMode { return value === 'ralph' ? 'ralph' : value === 'goal' ? 'goal' : fallback; }
function isJsonObject(value: unknown): value is PiboJsonObject { return !!value && typeof value === 'object' && !Array.isArray(value); }

type LoopRuntimeOptions = { modelOverride?: ModelProfile; thinkingLevel?: PiboThinkingLevel; fastMode?: boolean };

const cleanupStates = new Set<PiboLoopResourceCleanupState>(['none', 'active', 'released', 'retained', 'dirty']);

function normalizeLoopTarget(target: PiboLoopTarget | { kind?: unknown; roomId?: unknown }): PiboLoopTarget {
	if (target.kind === 'room') return { kind: 'room', roomId: String(target.roomId ?? '').trim() };
	return { kind: 'default-chat' };
}
function parseLoopTarget(json: string): PiboLoopTarget { return normalizeLoopTarget(parseJson(json)); }
function targetJson(target: PiboLoopTarget): string { return JSON.stringify(normalizeLoopTarget(target)); }

function optionalString(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string') throw new Error(`${field} must be a string`);
	const trimmed = value.trim();
	return trimmed || undefined;
}
function normalizeBrowserLeaseIds(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error('resources.browserLeaseIds must be an array');
	const ids = [...new Set(value.map((item) => optionalString(item, 'resources.browserLeaseIds[]')).filter((item): item is string => !!item))];
	return ids.length ? ids : undefined;
}
export function normalizeLoopResourceMetadata(value: PiboLoopResourceMetadata | null | undefined): PiboLoopResourceMetadata | undefined {
	if (value === undefined || value === null) return undefined;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('resources must be an object');
	const cleanupState = optionalString(value.cleanupState, 'resources.cleanupState') as PiboLoopResourceCleanupState | undefined;
	if (cleanupState && !cleanupStates.has(cleanupState)) throw new Error('resources.cleanupState must be one of none, active, released, retained, dirty');
	const resources: PiboLoopResourceMetadata = {};
	const workerId = optionalString(value.workerId, 'resources.workerId');
	const browserLeaseIds = normalizeBrowserLeaseIds(value.browserLeaseIds);
	const retainedUntil = optionalString(value.retainedUntil, 'resources.retainedUntil');
	const dirtyReason = optionalString(value.dirtyReason, 'resources.dirtyReason');
	const updatedAt = optionalString(value.updatedAt, 'resources.updatedAt');
	if (workerId) resources.workerId = workerId;
	if (browserLeaseIds) resources.browserLeaseIds = browserLeaseIds;
	if (cleanupState) resources.cleanupState = cleanupState;
	if (retainedUntil) resources.retainedUntil = retainedUntil;
	if (dirtyReason) resources.dirtyReason = dirtyReason;
	if (updatedAt) resources.updatedAt = updatedAt;
	return Object.keys(resources).length ? resources : undefined;
}
function parseResourceMetadata(json: string | null | undefined): PiboLoopResourceMetadata | undefined {
	if (!json) return undefined;
	try { return normalizeLoopResourceMetadata(JSON.parse(json) as PiboLoopResourceMetadata); } catch { return undefined; }
}
function resourceMetadataJson(resources: PiboLoopResourceMetadata | null | undefined): string | null {
	const normalized = normalizeLoopResourceMetadata(resources);
	return normalized ? JSON.stringify(normalized) : null;
}
function parseRunAccounting(json: string | null | undefined): PiboLoopRunAccounting | undefined {
	if (!json) return undefined;
	try {
		const value = JSON.parse(json) as PiboLoopRunAccounting;
		return value && typeof value === 'object' && !Array.isArray(value)
			? { ...value, tokenAccounting: normalizeLoopTokenAccounting(value.tokenAccounting) }
			: undefined;
	} catch { return undefined; }
}
function runAccountingJson(accounting: PiboLoopRunAccounting | undefined): string | null { return accounting ? JSON.stringify(accounting) : null; }
function parseSessionErrorDetails(json: string | null | undefined): PiboSessionErrorDetails | undefined {
	if (!json) return undefined;
	try {
		const value = JSON.parse(json) as PiboSessionErrorDetails;
		return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
	} catch { return undefined; }
}
function sessionErrorDetailsJson(details: PiboSessionErrorDetails | undefined): string | null { return details ? JSON.stringify(details) : null; }
function normalizeJobState(state: PiboLoopJobState, mode: PiboLoopMode, enabled: boolean, createdAt: string): PiboLoopJobState {
	if (mode !== 'goal') return state;
	const activeTimeSeconds = Math.max(0, Math.floor(state.activeTimeSeconds ?? state.timeUsedSeconds ?? 0));
	const goalStartedAt = state.goalStartedAt ?? (enabled || (state.completedIterations ?? 0) > 0 || (state.tokensUsed ?? 0) > 0 || (state.goalStatus !== undefined && state.goalStatus !== 'paused') ? createdAt : undefined);
	const normalized = { ...state, tokenAccounting: normalizeLoopTokenAccounting(state.tokenAccounting), activeTimeSeconds, ...(goalStartedAt ? { goalStartedAt } : {}) };
	delete normalized.timeUsedSeconds;
	return normalized;
}

function jobFromRow(row: LoopJobRow): PiboLoopJob {
	const resources = parseResourceMetadata(row.resource_json);
	const mode = normalizeLoopMode(row.loop_mode, 'ralph');
	const enabled = row.enabled === 1;
	return { id: row.id, mode, name: row.name, description: row.description ?? undefined, enabled, target: parseLoopTarget(row.target_json), profile: row.profile, prompt: row.prompt, maxIterations: row.max_iterations ?? undefined, tokenBudget: row.token_budget ?? undefined, tokenReserve: row.token_reserve ?? undefined, stopPolicy: parseStopPolicy(row.stop_policy_json), ...parseRuntimeOptions(row.runtime_options_json), ...(resources ? { resources } : {}), state: normalizeJobState(parseJson(row.state_json), mode, enabled, row.created_at), createdAt: row.created_at, updatedAt: row.updated_at };
}
function runFromRow(row: LoopRunRow): PiboLoopRun {
	const resources = parseResourceMetadata(row.resource_json);
	const accounting = parseRunAccounting(row.accounting_json);
	const errorDetails = parseSessionErrorDetails(row.error_details_json);
	return { id: row.id, jobId: row.job_id, piboSessionId: row.pibo_session_id ?? undefined, status: row.status, reason: row.reason ?? undefined, error: row.error ?? undefined, ...(errorDetails ? { errorDetails } : {}), messageEventId: row.message_event_id ?? undefined, messageState: row.message_state ?? undefined, startedAt: row.started_at ?? undefined, completedAt: row.completed_at ?? undefined, ...(accounting ? { accounting } : {}), ...(resources ? { resources } : {}), createdAt: row.created_at, updatedAt: row.updated_at };
}
function mergeResourceMetadata(jobResources: PiboLoopResourceMetadata | undefined, runResources: PiboLoopResourceMetadata | undefined): PiboLoopResourceMetadata | undefined {
	if (!jobResources && !runResources) return undefined;
	const browserLeaseIds = [...new Set([...(jobResources?.browserLeaseIds ?? []), ...(runResources?.browserLeaseIds ?? [])])];
	return { ...(jobResources ?? {}), ...(runResources ?? {}), ...(browserLeaseIds.length ? { browserLeaseIds } : {}) };
}
function factFromRow(row: LoopRunFactRow): PiboLoopRunFact {
	return { id: row.id, jobId: row.job_id, runId: row.run_id ?? undefined, piboSessionId: row.pibo_session_id ?? undefined, type: row.type, source: row.source, payload: parseJson(row.payload_json), createdAt: row.created_at };
}
function normalizeMaxIterations(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1) throw new Error('maxIterations must be a positive integer');
	return value;
}
function normalizeTokenBudget(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1) throw new Error('tokenBudget must be a positive integer');
	return value;
}
function normalizeTokenReserve(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 0) throw new Error('tokenReserve must be a non-negative integer');
	return value;
}
function goalStatus(job: Pick<PiboLoopJob, 'mode' | 'enabled' | 'state'>): PiboGoalStatus | undefined {
	if (job.mode !== 'goal') return undefined;
	return job.state.goalStatus ?? (job.enabled ? 'active' : 'paused');
}
function isTerminalGoalStatus(status: PiboGoalStatus | undefined): boolean { return status === 'complete' || status === 'blocked' || status === 'budget_limited'; }
function normalizeModelOverride(value: ModelProfile | null | undefined): ModelProfile | undefined {
	if (value === undefined || value === null) return undefined;
	const provider = value.provider.trim();
	const id = value.id.trim();
	if (!provider || !id) throw new Error('modelOverride must include provider and id');
	return { provider, id };
}
function normalizeThinkingLevel(value: PiboThinkingLevel | string | null | undefined): PiboThinkingLevel | undefined {
	if (value === undefined || value === null) return undefined;
	if (!isPiboThinkingLevel(value)) throw new Error('thinkingLevel must be one of off, minimal, low, medium, high, xhigh, max');
	return value;
}
function normalizeFastMode(value: boolean | null | undefined): boolean | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'boolean') throw new Error('fastMode must be a boolean');
	return value;
}
function normalizeRuntimeOptions(input: { modelOverride?: ModelProfile | null; thinkingLevel?: PiboThinkingLevel | string | null; fastMode?: boolean | null }): LoopRuntimeOptions {
	return { modelOverride: normalizeModelOverride(input.modelOverride), thinkingLevel: normalizeThinkingLevel(input.thinkingLevel), fastMode: normalizeFastMode(input.fastMode) };
}
function parseRuntimeOptions(json: string | null): LoopRuntimeOptions {
	if (!json) return {};
	try { const parsed = JSON.parse(json) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}; return normalizeRuntimeOptions(parsed as LoopRuntimeOptions); } catch { return {}; }
}
function runtimeOptionsJson(job: Pick<PiboLoopJob, 'modelOverride' | 'thinkingLevel' | 'fastMode'>): string | null {
	const options = normalizeRuntimeOptions(job);
	const json: Record<string, unknown> = {};
	if (options.modelOverride) json.modelOverride = options.modelOverride;
	if (options.thinkingLevel) json.thinkingLevel = options.thinkingLevel;
	if (options.fastMode !== undefined) json.fastMode = options.fastMode;
	return Object.keys(json).length ? JSON.stringify(json) : null;
}
function hasOwn(object: object, key: string): boolean { return Object.prototype.hasOwnProperty.call(object, key); }

export function normalizeLoopStopPolicy(value: PiboLoopStopPolicy | null | undefined): PiboLoopStopPolicy | undefined {
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
		if (ids.has(id)) throw new Error(`Duplicate Loop stop condition id: ${id}`);
		ids.add(id);
		if (condition.options !== undefined && !isJsonObject(condition.options)) throw new Error(`stopPolicy.conditions[${index}].options must be an object`);
		if (condition.enabled !== undefined && typeof condition.enabled !== 'boolean') throw new Error(`stopPolicy.conditions[${index}].enabled must be a boolean`);
		if (condition.failClosed !== undefined && typeof condition.failClosed !== 'boolean') throw new Error(`stopPolicy.conditions[${index}].failClosed must be a boolean`);
		if (condition.timeoutMs !== undefined && (!Number.isInteger(condition.timeoutMs) || condition.timeoutMs < 1)) throw new Error(`stopPolicy.conditions[${index}].timeoutMs must be a positive integer`);
		return { id, type, ...(condition.enabled !== undefined ? { enabled: condition.enabled } : {}), ...(condition.options ? { options: condition.options } : {}), ...(condition.failClosed !== undefined ? { failClosed: condition.failClosed } : {}), ...(condition.timeoutMs !== undefined ? { timeoutMs: condition.timeoutMs } : {}) };
	}) };
}
function parseStopPolicy(json: string | null): PiboLoopStopPolicy | undefined {
	if (!json) return undefined;
	try { return normalizeLoopStopPolicy(JSON.parse(json) as PiboLoopStopPolicy); } catch { return undefined; }
}
function stopPolicyJson(policy: PiboLoopStopPolicy | undefined): string | null { return policy ? JSON.stringify(normalizeLoopStopPolicy(policy)) : null; }
function validateJobInput(input: Pick<PiboLoopJobCreateInput, 'mode' | 'target' | 'profile' | 'prompt' | 'maxIterations' | 'tokenBudget' | 'tokenReserve' | 'modelOverride' | 'thinkingLevel' | 'fastMode' | 'stopPolicy' | 'resources'>): void {
	if (input.mode !== undefined && input.mode !== 'goal' && input.mode !== 'ralph') throw new Error('mode must be goal or ralph');
	if (!input.profile.trim()) throw new Error('profile is required');
	if (!input.prompt.trim()) throw new Error('prompt is required');
	if (input.target.kind === 'room' && !input.target.roomId.trim()) throw new Error('target.roomId is required');
	if (input.mode === 'ralph' && (input.tokenBudget !== undefined || input.tokenReserve !== undefined)) throw new Error('tokenBudget and tokenReserve are only available for goal mode');
	normalizeMaxIterations(input.maxIterations);
	normalizeTokenBudget(input.tokenBudget);
	normalizeTokenReserve(input.tokenReserve);
	if (input.tokenReserve !== undefined && input.tokenBudget === undefined) throw new Error('tokenReserve requires tokenBudget');
	if (input.tokenReserve !== undefined && input.tokenBudget !== undefined && input.tokenReserve >= input.tokenBudget) throw new Error('tokenReserve must be smaller than tokenBudget');
	normalizeRuntimeOptions(input);
	normalizeLoopStopPolicy(input.stopPolicy);
	normalizeLoopResourceMetadata(input.resources);
}

export class PiboLoopStore {
	private readonly db: DatabaseSync;
	constructor(options: PiboLoopStoreOptions = {}) {
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
	createJob(input: PiboLoopJobCreateInput, now = new Date()): PiboLoopJob {
		const target = normalizeLoopTarget(input.target);
		validateJobInput({ ...input, target });
		const timestamp = nowIso(now);
		const runtimeOptions = normalizeRuntimeOptions(input);
		const resources = normalizeLoopResourceMetadata(input.resources);
		const mode = normalizeLoopMode(input.mode);
		const enabled = input.enabled === true;
		const state: PiboLoopJobState = {
			completedIterations: 0,
			...(mode === 'goal' ? { goalStatus: enabled ? 'active' : 'paused', tokenAccounting: newGoalTokenAccounting(), tokensUsed: 0, activeTimeSeconds: 0, ...(enabled ? { goalStartedAt: timestamp } : {}) } : {}),
			...(input.initialPiboSessionId?.trim() ? { lastPiboSessionId: input.initialPiboSessionId.trim() } : {}),
		};
		const job: PiboLoopJob = { id: mode === 'ralph' ? `ralph_${randomUUID()}` : `loop_${randomUUID()}`, mode, name: (input.name ?? defaultName(input.prompt)).trim(), description: input.description?.trim() || undefined, enabled, target, profile: input.profile, prompt: input.prompt, maxIterations: normalizeMaxIterations(input.maxIterations), tokenBudget: normalizeTokenBudget(input.tokenBudget), tokenReserve: normalizeTokenReserve(input.tokenReserve), stopPolicy: normalizeLoopStopPolicy(input.stopPolicy), ...runtimeOptions, ...(resources ? { resources } : {}), state, createdAt: timestamp, updatedAt: timestamp };
		this.insertJob(job);
		return this.getJob(job.id)!;
	}
	getJob(id: string): PiboLoopJob | undefined { const row = this.db.prepare('SELECT * FROM pibo_ralph_jobs WHERE id = ?').get(id) as LoopJobRow | undefined; return row ? jobFromRow(row) : undefined; }
	getLatestGoalForSession(piboSessionId: string): PiboLoopJob | undefined {
		const row = this.db.prepare("SELECT * FROM pibo_ralph_jobs WHERE loop_mode = 'goal' AND json_extract(state_json, '$.lastPiboSessionId') = ? ORDER BY created_at DESC LIMIT 1").get(piboSessionId) as LoopJobRow | undefined;
		return row ? jobFromRow(row) : undefined;
	}
	listGoalsForSession(piboSessionId: string): PiboLoopJob[] {
		return (this.db.prepare("SELECT * FROM pibo_ralph_jobs WHERE loop_mode = 'goal' AND json_extract(state_json, '$.lastPiboSessionId') = ? ORDER BY created_at DESC").all(piboSessionId) as LoopJobRow[]).map(jobFromRow);
	}
	getSessionGoalOwner(piboSessionId: string): PiboLoopJob | undefined {
		return this.listGoalsForSession(piboSessionId).find((job) => {
			if ((goalStatus(job) ?? 'paused') !== 'complete') return true;
			return Boolean(this.db.prepare("SELECT 1 FROM pibo_ralph_runs WHERE job_id = ? AND status = 'running' LIMIT 1").get(job.id));
		});
	}
	createSessionGoal(input: PiboLoopJobCreateInput & { initialPiboSessionId: string }, now = new Date()): PiboLoopJob {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const owner = this.getSessionGoalOwner(input.initialPiboSessionId);
			if (owner) throw new Error(`cannot create a new goal because this Pibo Session has an unfinished goal or in-flight run owned by ${owner.id}`);
			const job = this.createJob({ ...input, mode: 'goal', enabled: true }, now);
			this.db.exec('COMMIT');
			return job;
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
	reopenGoal(id: string, input: { actorId: string }, now = new Date()): PiboLoopJob {
		const actorId = input.actorId.trim();
		if (!actorId) throw new Error('reopen actorId is required');
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const job = this.getJob(id);
			if (!job || job.mode !== 'goal') throw new Error('Goal not found');
			const previousStatus = goalStatus(job) ?? (job.enabled ? 'active' : 'paused');
			if (job.enabled || !['complete', 'blocked', 'budget_limited'].includes(previousStatus)) throw new Error('Only a disabled terminal Goal can be reopened');
			const piboSessionId = job.state.lastPiboSessionId;
			if (!piboSessionId) throw new Error('Goal cannot be reopened because it has no originating Pibo Session');
			if (this.db.prepare("SELECT 1 FROM pibo_ralph_runs WHERE job_id = ? AND status = 'running' LIMIT 1").get(job.id)) throw new Error('Goal cannot be reopened while a Loop run is active or queued');
			const competitor = this.listGoalsForSession(piboSessionId).find((candidate) => {
				if (candidate.id === job.id) return false;
				if ((goalStatus(candidate) ?? 'paused') !== 'complete') return true;
				return Boolean(this.db.prepare("SELECT 1 FROM pibo_ralph_runs WHERE job_id = ? AND status = 'running' LIMIT 1").get(candidate.id));
			});
			if (competitor) throw new Error(`Goal cannot be reopened because ${competitor.id} owns the Pibo Session`);
			const timestamp = nowIso(now);
			const fact: PiboLoopRunFact = {
				id: `rfact_${randomUUID()}`,
				jobId: job.id,
				piboSessionId,
				type: 'pibo.loop.goal-reopened',
				source: 'pibo',
				payload: { actorId, previousStatus, previousGoalEndedAt: job.state.goalEndedAt ?? null, confirmation: 'confirm-terminal-reopen' },
				createdAt: timestamp,
			};
			this.db.prepare('INSERT INTO pibo_ralph_run_facts (id, job_id, run_id, pibo_session_id, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(fact.id, fact.jobId, null, piboSessionId, fact.type, fact.source, JSON.stringify(fact.payload), fact.createdAt);
			const state: PiboLoopJobState = { ...job.state, goalStatus: 'active', goalEndedAt: undefined, stopRequestedAt: undefined, cancelRequestedAt: undefined, runningAt: undefined };
			this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = 1, state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), timestamp, job.id);
			this.db.exec('COMMIT');
			return this.getJob(id)!;
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
	updateGoalStatus(id: string, status: Extract<PiboGoalStatus, 'complete' | 'blocked'>, now = new Date()): PiboLoopJob | undefined {
		const job = this.getJob(id);
		if (!job || job.mode !== 'goal') return undefined;
		const currentStatus = goalStatus(job);
		if (currentStatus === status) return job;
		if (isTerminalGoalStatus(currentStatus)) throw new Error(`Cannot change terminal goal status from ${currentStatus} to ${status}`);
		const timestamp = nowIso(now);
		const state: PiboLoopJobState = { ...job.state, goalStatus: status, goalEndedAt: job.state.goalEndedAt ?? timestamp, runningAt: job.state.runningAt };
		this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = 0, state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), timestamp, id);
		return this.getJob(id);
	}
	recordGoalProgress(id: string, input: { tokens?: number; activeTimeSeconds?: number }, now = new Date()): PiboLoopJob | undefined {
		const job = this.getJob(id);
		if (!job || job.mode !== 'goal') return job;
		const tokens = Math.max(0, Math.floor(input.tokens ?? 0));
		const activeTimeSeconds = Math.max(0, Math.floor(input.activeTimeSeconds ?? 0));
		const nextTokens = (job.state.tokensUsed ?? 0) + tokens;
		const currentStatus = goalStatus(job) ?? 'active';
		const budgetLimited = currentStatus === 'active' && job.tokenBudget !== undefined && nextTokens >= job.tokenBudget;
		const state: PiboLoopJobState = {
			...job.state,
			tokensUsed: nextTokens,
			activeTimeSeconds: (job.state.activeTimeSeconds ?? 0) + activeTimeSeconds,
			goalStatus: budgetLimited ? 'budget_limited' : currentStatus,
		};
		const timestamp = nowIso(now);
		if (budgetLimited) state.goalEndedAt = job.state.goalEndedAt ?? timestamp;
		this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = ?, state_json = ?, updated_at = ? WHERE id = ?').run(budgetLimited ? 0 : job.enabled ? 1 : 0, JSON.stringify(state), timestamp, id);
		return this.getJob(id);
	}
	recordGoalTurnUsage(id: string, runId: string, tokens: number, now = new Date()): PiboLoopJob | undefined {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const job = this.recordGoalProgress(id, { tokens }, now);
			if (job?.mode === 'goal') {
				const row = this.db.prepare('SELECT * FROM pibo_ralph_runs WHERE id = ? AND job_id = ?').get(runId, id) as LoopRunRow | undefined;
				if (row) {
					const accounting = parseRunAccounting(row.accounting_json) ?? { tokenAccounting: normalizeLoopTokenAccounting(job.state.tokenAccounting) };
					const turnTokens = (accounting.tokensUsed ?? 0) + Math.max(0, Math.floor(tokens));
					const budget = accounting.tokenBudget;
					const before = accounting.tokensUsedBefore ?? 0;
					const nextAccounting: PiboLoopRunAccounting = { ...accounting, tokensUsed: turnTokens, ...(budget !== undefined ? { overshootTokens: Math.max(0, before + turnTokens - budget) } : {}) };
					this.db.prepare('UPDATE pibo_ralph_runs SET accounting_json = ?, updated_at = ? WHERE id = ?').run(runAccountingJson(nextAccounting), nowIso(now), runId);
				}
			}
			this.db.exec('COMMIT');
			return job;
		} catch (error) { this.db.exec('ROLLBACK'); throw error; }
	}
	recordGoalRunTime(id: string, runId: string, activeTimeSeconds: number, now = new Date()): PiboLoopJob | undefined {
		const seconds = Math.max(0, Math.floor(activeTimeSeconds));
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const job = this.recordGoalProgress(id, { activeTimeSeconds: seconds }, now);
			if (job?.mode === 'goal') {
				const row = this.db.prepare('SELECT * FROM pibo_ralph_runs WHERE id = ? AND job_id = ?').get(runId, id) as LoopRunRow | undefined;
				if (row) {
					const accounting = { ...(parseRunAccounting(row.accounting_json) ?? { tokenAccounting: normalizeLoopTokenAccounting(job.state.tokenAccounting) }), activeTimeSeconds: seconds };
					this.db.prepare('UPDATE pibo_ralph_runs SET accounting_json = ?, updated_at = ? WHERE id = ?').run(runAccountingJson(accounting), nowIso(now), runId);
				}
			}
			this.db.exec('COMMIT');
			return job;
		} catch (error) { this.db.exec('ROLLBACK'); throw error; }
	}
	listJobs(input: { includeDisabled?: boolean } = {}): PiboLoopJob[] {
		const clauses: string[] = []; const values: Array<string | number> = [];
		if (!input.includeDisabled) clauses.push('enabled = 1');
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		return (this.db.prepare(`SELECT * FROM pibo_ralph_jobs ${where} ORDER BY updated_at DESC, id ASC`).all(...values) as LoopJobRow[]).map(jobFromRow);
	}
	updateJob(id: string, patch: PiboLoopJobPatchInput, now = new Date()): PiboLoopJob | undefined {
		const existing = this.getJob(id); if (!existing) return undefined;
		const runtimeOptions = normalizeRuntimeOptions({
			modelOverride: hasOwn(patch, 'modelOverride') ? patch.modelOverride : existing.modelOverride,
			thinkingLevel: hasOwn(patch, 'thinkingLevel') ? patch.thinkingLevel : existing.thinkingLevel,
			fastMode: hasOwn(patch, 'fastMode') ? patch.fastMode : existing.fastMode,
		});
		const stopPolicy = hasOwn(patch, 'stopPolicy') ? normalizeLoopStopPolicy(patch.stopPolicy ?? undefined) : existing.stopPolicy;
		const target = patch.target ? normalizeLoopTarget(patch.target) : existing.target;
		const mode = patch.mode !== undefined ? normalizeLoopMode(patch.mode) : existing.mode;
		const enabled = patch.enabled ?? existing.enabled;
		let state: PiboLoopJobState = mode === existing.mode
			? { ...existing.state }
			: { completedIterations: existing.state.completedIterations ?? 0, ...(mode === 'goal' ? { goalStatus: enabled ? 'active' : 'paused', tokenAccounting: newGoalTokenAccounting(), tokensUsed: 0, activeTimeSeconds: 0, ...(enabled ? { goalStartedAt: nowIso(now) } : {}) } : {}) };
		if (mode === 'goal' && patch.enabled !== undefined) {
			const currentGoalStatus = goalStatus({ mode, enabled: existing.enabled, state: existing.state }) ?? 'paused';
			if (patch.enabled) {
				if (currentGoalStatus === 'complete') throw new Error('Completed goals cannot be restarted; create a new goal');
				const nextBudget = hasOwn(patch, 'tokenBudget') ? normalizeTokenBudget(patch.tokenBudget ?? undefined) : existing.tokenBudget;
				const nextReserve = hasOwn(patch, 'tokenReserve') ? normalizeTokenReserve(patch.tokenReserve ?? undefined) : existing.tokenReserve;
				if (currentGoalStatus === 'budget_limited' && nextBudget !== undefined && (existing.state.tokensUsed ?? 0) + (nextReserve ?? 0) >= nextBudget) throw new Error('Increase or clear the token budget, or lower the token reserve, before resuming this goal');
				state.goalStatus = 'active';
				state.goalStartedAt ??= nowIso(now);
				delete state.goalEndedAt;
				state.stopRequestedAt = undefined;
				state.cancelRequestedAt = undefined;
				state.lastFailure = undefined;
				state.nextAttemptAt = undefined;
				state.retryBackoffMs = undefined;
				state.consecutiveErrors = 0;
			} else {
				state.goalStatus = currentGoalStatus === 'active' ? 'paused' : currentGoalStatus;
			}
		}
		const next: PiboLoopJob = { ...existing, mode, state, name: patch.name !== undefined ? patch.name.trim() : existing.name, description: patch.description !== undefined ? patch.description?.trim() || undefined : existing.description, enabled, target, profile: patch.profile ?? existing.profile, prompt: patch.prompt ?? existing.prompt, maxIterations: hasOwn(patch, 'maxIterations') ? normalizeMaxIterations(patch.maxIterations ?? undefined) : existing.maxIterations, tokenBudget: mode === 'ralph' ? undefined : hasOwn(patch, 'tokenBudget') ? normalizeTokenBudget(patch.tokenBudget ?? undefined) : existing.tokenBudget, tokenReserve: mode === 'ralph' || (hasOwn(patch, 'tokenBudget') && patch.tokenBudget === null && !hasOwn(patch, 'tokenReserve')) ? undefined : hasOwn(patch, 'tokenReserve') ? normalizeTokenReserve(patch.tokenReserve ?? undefined) : existing.tokenReserve, stopPolicy, modelOverride: runtimeOptions.modelOverride, thinkingLevel: runtimeOptions.thinkingLevel, fastMode: runtimeOptions.fastMode, updatedAt: nowIso(now) };
		validateJobInput(next); this.writeJob(next); return this.getJob(id);
	}
	updateJobResources(id: string, resources: PiboLoopResourceMetadata | null | undefined, now = new Date()): PiboLoopJob | undefined {
		const existing = this.getJob(id); if (!existing) return undefined;
		const timestamp = nowIso(now);
		this.db.prepare('UPDATE pibo_ralph_jobs SET resource_json = ?, updated_at = ? WHERE id = ?').run(resourceMetadataJson(resources), timestamp, id);
		return this.getJob(id);
	}
	updateRunResources(input: { runId: string; jobId?: string; resources?: PiboLoopResourceMetadata | null }, now = new Date()): PiboLoopRun | undefined {
		const clauses = ['id = ?'];
		const values: Array<string | null> = [input.runId];
		if (input.jobId) { clauses.push('job_id = ?'); values.push(input.jobId); }
		const timestamp = nowIso(now);
		const result = this.db.prepare(`UPDATE pibo_ralph_runs SET resource_json = ?, updated_at = ? WHERE ${clauses.join(' AND ')}`).run(resourceMetadataJson(input.resources), timestamp, ...values);
		if (Number(result.changes ?? 0) === 0) return undefined;
		const row = this.db.prepare('SELECT * FROM pibo_ralph_runs WHERE id = ?').get(input.runId) as LoopRunRow | undefined;
		return row ? runFromRow(row) : undefined;
	}
	removeJob(id: string): boolean {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			if (!this.getJob(id)) { this.db.exec('COMMIT'); return false; }
			if (this.db.prepare("SELECT 1 FROM pibo_ralph_runs WHERE job_id = ? AND status = 'running' LIMIT 1").get(id)) throw new Error('Loop job has an active run; cancel it before removal');
			this.db.prepare('DELETE FROM pibo_ralph_run_facts WHERE job_id = ?').run(id);
			this.db.prepare('DELETE FROM pibo_ralph_runs WHERE job_id = ?').run(id);
			const result = this.db.prepare('DELETE FROM pibo_ralph_jobs WHERE id = ?').run(id);
			this.db.exec('COMMIT');
			return Number(result.changes ?? 0) > 0;
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
	listRuns(input: { jobId?: string; limit?: number } = {}): PiboLoopRun[] {
		const clauses: string[] = []; const values: Array<string | number> = [];
		if (input.jobId) { clauses.push('job_id = ?'); values.push(input.jobId); }
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		return (this.db.prepare(`SELECT * FROM pibo_ralph_runs ${where} ORDER BY created_at DESC LIMIT ?`).all(...values, Math.max(1, Math.min(input.limit ?? 100, 500))) as LoopRunRow[]).map(runFromRow);
	}
	getRun(id: string): PiboLoopRun | undefined {
		const row = this.db.prepare('SELECT * FROM pibo_ralph_runs WHERE id = ?').get(id) as LoopRunRow | undefined;
		return row ? runFromRow(row) : undefined;
	}
	getRunByMessageEventId(eventId: string): PiboLoopRun | undefined {
		const row = this.db.prepare('SELECT * FROM pibo_ralph_runs WHERE message_event_id = ?').get(eventId) as LoopRunRow | undefined;
		return row ? runFromRow(row) : undefined;
	}
	attachRunMessage(jobId: string, runId: string, eventId: string, now = new Date()): PiboLoopRun | undefined {
		const timestamp = nowIso(now);
		const result = this.db.prepare("UPDATE pibo_ralph_runs SET message_event_id = ?, message_state = 'queued', updated_at = ? WHERE id = ? AND job_id = ? AND status = 'running'").run(eventId, timestamp, runId, jobId);
		return Number(result.changes ?? 0) > 0 ? this.getRun(runId) : undefined;
	}
	updateRunMessageState(eventId: string, state: PiboLoopRunMessageState, now = new Date()): PiboLoopRun | undefined {
		const timestamp = nowIso(now);
		const result = this.db.prepare('UPDATE pibo_ralph_runs SET message_state = ?, updated_at = ? WHERE message_event_id = ?').run(state, timestamp, eventId);
		return Number(result.changes ?? 0) > 0 ? this.getRunByMessageEventId(eventId) : undefined;
	}
	reserveRun(id: string, now = new Date()): { job: PiboLoopJob; run: PiboLoopRun } | undefined { this.updateJob(id, { enabled: true }, now); return this.reserveJob(id, now); }
	reserveDueRuns(limit: number, now = new Date()): Array<{ job: PiboLoopJob; run: PiboLoopRun }> {
		const rows = this.db.prepare('SELECT * FROM pibo_ralph_jobs WHERE enabled = 1 ORDER BY updated_at ASC').all() as LoopJobRow[];
		const result: Array<{ job: PiboLoopJob; run: PiboLoopRun }> = [];
		for (const row of rows) { if (result.length >= limit) break; const reserved = this.reserveJob(row.id, now); if (reserved) result.push(reserved); }
		return result;
	}
	attachRunSession(jobId: string, runId: string, piboSessionId: string, now = new Date()): void {
		const timestamp = nowIso(now); const job = this.getJob(jobId); if (!job) return;
		this.db.prepare('UPDATE pibo_ralph_runs SET pibo_session_id = ?, updated_at = ? WHERE id = ?').run(piboSessionId, timestamp, runId);
		this.updateJobStateLocked(jobId, { ...job.state, lastPiboSessionId: piboSessionId }, timestamp);
	}
	requestStop(id: string, now = new Date()): PiboLoopJob | undefined {
		const job = this.getJob(id); if (!job) return undefined;
		const state = { ...job.state, ...(job.mode === 'goal' && goalStatus(job) === 'active' ? { goalStatus: 'paused' as const } : {}), stopRequestedAt: nowIso(now) };
		this.writeJob({ ...job, enabled: false, state, updatedAt: nowIso(now) }); return this.getJob(id);
	}
	requestCancel(id: string, now = new Date()): PiboLoopJob | undefined {
		const job = this.getJob(id); if (!job) return undefined;
		const state = { ...job.state, ...(job.mode === 'goal' && goalStatus(job) === 'active' ? { goalStatus: 'paused' as const } : {}), stopRequestedAt: nowIso(now), cancelRequestedAt: nowIso(now) };
		this.writeJob({ ...job, enabled: false, state, updatedAt: nowIso(now) }); return this.getJob(id);
	}
	applyStopEvaluation(input: { jobId: string; evaluation: PiboLoopStopEvaluationSummary; conditionStates?: Record<string, PiboJsonObject>; disable?: boolean }, now = new Date()): void {
		const job = this.getJob(input.jobId); if (!job) return;
		const timestamp = nowIso(now);
		const state: PiboLoopJobState = { ...job.state, conditionStates: input.conditionStates ?? job.state.conditionStates, lastStopEvaluation: input.evaluation };
		this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = ?, state_json = ?, updated_at = ? WHERE id = ?').run(input.disable ? 0 : job.enabled ? 1 : 0, JSON.stringify(state), timestamp, job.id);
	}
	completeRun(input: { jobId: string; runId: string; status: PiboLoopRunStatus; piboSessionId?: string; error?: string; errorDetails?: PiboSessionErrorDetails; failure?: PiboLoopFailure; goalStatus?: Extract<PiboGoalStatus, 'active' | 'blocked'>; reason?: string; stopAfterRun?: boolean; stopEvaluation?: PiboLoopStopEvaluationSummary; conditionStates?: Record<string, PiboJsonObject> }, now = new Date()): void {
		const timestamp = nowIso(now); const job = this.getJob(input.jobId); if (!job) return;
		const completedIterations = (job.state.completedIterations ?? 0) + 1;
		const reachedMaxIterations = job.maxIterations !== undefined && completedIterations >= job.maxIterations;
		const currentGoalStatus = goalStatus(job);
		const nextGoalStatus = job.mode === 'goal' ? isTerminalGoalStatus(currentGoalStatus) ? currentGoalStatus : input.goalStatus ?? currentGoalStatus : undefined;
		const terminalGoalStatus = job.mode === 'goal' && isTerminalGoalStatus(nextGoalStatus);
		const shouldDisable = terminalGoalStatus || reachedMaxIterations || input.stopAfterRun === true || input.stopEvaluation?.finalAction === 'stop-after-run' || input.stopEvaluation?.finalAction === 'cancel-current-run';
		const state: PiboLoopJobState = {
			...job.state,
			runningAt: undefined,
			completedIterations,
			lastRunAt: timestamp,
			lastRunId: input.runId,
			lastStatus: input.status === 'error' ? 'error' : input.status === 'cancelled' ? 'cancelled' : 'ok',
			lastError: input.error,
			lastFailure: input.status === 'error' ? input.failure : undefined,
			nextAttemptAt: input.status === 'error' ? input.failure?.nextAttemptAt : undefined,
			retryBackoffMs: input.status === 'error' ? input.failure?.retryBackoffMs : undefined,
			lastPiboSessionId: input.piboSessionId ?? job.state.lastPiboSessionId,
			consecutiveErrors: input.status === 'error' ? (job.state.consecutiveErrors ?? 0) + 1 : 0,
			conditionStates: input.conditionStates ?? job.state.conditionStates,
			lastStopEvaluation: input.stopEvaluation ?? job.state.lastStopEvaluation,
			...(nextGoalStatus ? { goalStatus: nextGoalStatus } : {}),
			...(terminalGoalStatus ? { goalEndedAt: job.state.goalEndedAt ?? timestamp } : {}),
		};
		this.db.exec('BEGIN IMMEDIATE');
		try {
			this.db.prepare("UPDATE pibo_ralph_runs SET status = ?, pibo_session_id = COALESCE(?, pibo_session_id), reason = ?, error = ?, error_details_json = ?, message_state = CASE WHEN message_state = 'invalidated' THEN message_state ELSE 'finished' END, completed_at = ?, updated_at = ? WHERE id = ?").run(input.status, input.piboSessionId ?? null, input.reason ?? input.stopEvaluation?.reason ?? null, input.error ?? null, sessionErrorDetailsJson(input.errorDetails), timestamp, timestamp, input.runId);
			this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = ?, state_json = ?, updated_at = ? WHERE id = ?').run(shouldDisable ? 0 : job.enabled ? 1 : 0, JSON.stringify(state), timestamp, job.id);
			this.db.exec('COMMIT');
		} catch (error) {
			try { this.db.exec('ROLLBACK'); } catch { /* ignore rollback failure */ }
			throw error;
		}
	}
	appendRunFact(input: Omit<PiboLoopRunFact, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): PiboLoopRunFact {
		if (!input.jobId.trim()) throw new Error('fact jobId is required');
		if (!input.type.trim()) throw new Error('fact type is required');
		if (!isJsonObject(input.payload)) throw new Error('fact payload must be an object');
		const payloadJson = JSON.stringify(input.payload);
		if (payloadJson.length > 16_384) throw new Error('fact payload is too large');
		const fact: PiboLoopRunFact = { id: input.id ?? `rfact_${randomUUID()}`, jobId: input.jobId, runId: input.runId, piboSessionId: input.piboSessionId, type: input.type.trim(), source: input.source, payload: input.payload, createdAt: input.createdAt ?? nowIso() };
		this.db.prepare('INSERT INTO pibo_ralph_run_facts (id, job_id, run_id, pibo_session_id, type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(fact.id, fact.jobId, fact.runId ?? null, fact.piboSessionId ?? null, fact.type, fact.source, payloadJson, fact.createdAt);
		return fact;
	}
	listRunFacts(input: { jobId?: string; runId?: string; type?: string; limit?: number } = {}): PiboLoopRunFact[] {
		const clauses: string[] = []; const values: Array<string | number> = [];
		if (input.jobId) { clauses.push('job_id = ?'); values.push(input.jobId); }
		if (input.runId) { clauses.push('run_id = ?'); values.push(input.runId); }
		if (input.type) { clauses.push('type = ?'); values.push(input.type); }
		const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
		return (this.db.prepare(`SELECT * FROM pibo_ralph_run_facts ${where} ORDER BY created_at DESC LIMIT ?`).all(...values, Math.max(1, Math.min(input.limit ?? 100, 500))) as LoopRunFactRow[]).map(factFromRow);
	}
	createFactReader(job: PiboLoopJob): PiboLoopFactReader {
		return { list: (input = {}) => this.listRunFacts({ jobId: job.id, type: input.type, runId: input.runId, limit: input.limit }), count: (input = {}) => this.listRunFacts({ jobId: job.id, type: input.type, runId: input.runId, limit: 500 }).length };
	}
	recoverInterruptedRuns(cutoff = new Date(Date.now() - 5 * 60_000)): number { const cutoffIso = nowIso(cutoff); const rows = this.db.prepare("SELECT * FROM pibo_ralph_jobs WHERE json_extract(state_json, '$.runningAt') IS NOT NULL").all() as LoopJobRow[]; let recovered = 0; for (const row of rows) { const job = jobFromRow(row); if (!job.state.runningAt || job.state.runningAt > cutoffIso) continue; if (job.state.lastRunId) { this.completeRun({ jobId: job.id, runId: job.state.lastRunId, status: 'error', error: 'Loop run was interrupted by gateway restart', reason: 'interrupted' }); this.markInterruptedRunResourcesDirty(job, job.state.lastRunId); } recovered += 1; } return recovered; }
	status(): { jobs: number; running: number } { const jobs = this.listJobs({ includeDisabled: false }); return { jobs: jobs.length, running: jobs.filter((job) => job.state.runningAt).length }; }
	private markInterruptedRunResourcesDirty(job: PiboLoopJob, runId: string): void {
		const runRow = this.db.prepare('SELECT * FROM pibo_ralph_runs WHERE id = ? AND job_id = ?').get(runId, job.id) as LoopRunRow | undefined;
		const resources = mergeResourceMetadata(job.resources, runRow ? runFromRow(runRow).resources : undefined);
		if (!resources || (!resources.workerId && (resources.browserLeaseIds ?? []).length === 0)) return;
		const nextResources: PiboLoopResourceMetadata = { ...resources, cleanupState: 'dirty', dirtyReason: 'Loop run was interrupted before browser resource cleanup could be confirmed', updatedAt: nowIso() };
		this.updateRunResources({ jobId: job.id, runId, resources: nextResources });
		this.updateJobResources(job.id, nextResources);
	}
	private reserveJob(id: string, now = new Date()): { job: PiboLoopJob; run: PiboLoopRun } | undefined {
		const timestamp = nowIso(now); this.db.exec('BEGIN IMMEDIATE');
		try {
			const job = this.getJob(id);
			if (!job || !job.enabled || job.state.runningAt) { this.db.exec('COMMIT'); return undefined; }
			if (job.state.nextAttemptAt && job.state.nextAttemptAt > timestamp) { this.db.exec('COMMIT'); return undefined; }
			if (job.mode === 'goal' && job.tokenBudget !== undefined) {
				const remaining = Math.max(0, job.tokenBudget - (job.state.tokensUsed ?? 0));
				if (remaining <= (job.tokenReserve ?? 0)) {
					const state = { ...job.state, goalStatus: 'budget_limited' as const, goalEndedAt: timestamp };
					this.db.prepare('UPDATE pibo_ralph_jobs SET enabled = 0, state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), timestamp, job.id);
					this.db.exec('COMMIT');
					return undefined;
				}
			}
			const run = this.createRunLocked(job, timestamp);
			const state = { ...job.state, runningAt: timestamp, lastRunAt: timestamp, lastRunId: run.id, nextAttemptAt: undefined, retryBackoffMs: undefined };
			this.updateJobStateLocked(job.id, state, timestamp);
			this.db.exec('COMMIT');
			return { job: { ...job, state, updatedAt: timestamp }, run };
		} catch (error) { this.db.exec('ROLLBACK'); throw error; }
	}
	private applySchema(): void {
		this.createFreshSchema();
		this.ensureJobColumn('loop_mode', "TEXT NOT NULL DEFAULT 'ralph'");
		this.ensureJobColumn('max_iterations', 'INTEGER');
		this.ensureJobColumn('token_budget', 'INTEGER');
		this.ensureJobColumn('token_reserve', 'INTEGER');
		this.ensureJobColumn('runtime_options_json', 'TEXT');
		this.ensureJobColumn('stop_policy_json', 'TEXT');
		this.ensureJobColumn('resource_json', 'TEXT');
		this.ensureRunColumn('resource_json', 'TEXT');
		this.ensureRunColumn('accounting_json', 'TEXT');
		this.ensureRunColumn('error_details_json', 'TEXT');
		this.ensureRunColumn('message_event_id', 'TEXT');
		this.ensureRunColumn('message_state', 'TEXT');
		this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_pibo_ralph_runs_message_event ON pibo_ralph_runs(message_event_id) WHERE message_event_id IS NOT NULL');
		this.repairOrphanedChildren();
	}
	private createFreshSchema(): void {
		this.db.exec(`CREATE TABLE IF NOT EXISTS pibo_ralph_jobs (id TEXT PRIMARY KEY, loop_mode TEXT NOT NULL DEFAULT 'goal', name TEXT NOT NULL, description TEXT, enabled INTEGER NOT NULL, target_json TEXT NOT NULL, profile TEXT NOT NULL, prompt TEXT NOT NULL, max_iterations INTEGER, token_budget INTEGER, token_reserve INTEGER, runtime_options_json TEXT, stop_policy_json TEXT, resource_json TEXT, state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_jobs_enabled ON pibo_ralph_jobs(enabled, updated_at DESC); CREATE TABLE IF NOT EXISTS pibo_ralph_runs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES pibo_ralph_jobs(id) ON DELETE CASCADE, pibo_session_id TEXT, status TEXT NOT NULL, reason TEXT, error TEXT, error_details_json TEXT, message_event_id TEXT, message_state TEXT, accounting_json TEXT, resource_json TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_runs_job_created ON pibo_ralph_runs(job_id, created_at DESC); CREATE TABLE IF NOT EXISTS pibo_ralph_run_facts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES pibo_ralph_jobs(id) ON DELETE CASCADE, run_id TEXT, pibo_session_id TEXT, type TEXT NOT NULL, source TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_facts_job_created ON pibo_ralph_run_facts(job_id, created_at DESC); CREATE INDEX IF NOT EXISTS idx_pibo_ralph_facts_run_type ON pibo_ralph_run_facts(run_id, type, created_at DESC);`);
	}
	private repairOrphanedChildren(): void {
		this.db.exec('BEGIN IMMEDIATE');
		try {
			this.db.exec('DELETE FROM pibo_ralph_run_facts WHERE NOT EXISTS (SELECT 1 FROM pibo_ralph_jobs WHERE pibo_ralph_jobs.id = pibo_ralph_run_facts.job_id)');
			this.db.exec('DELETE FROM pibo_ralph_runs WHERE NOT EXISTS (SELECT 1 FROM pibo_ralph_jobs WHERE pibo_ralph_jobs.id = pibo_ralph_runs.job_id)');
			this.db.exec('COMMIT');
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}
	private ensureJobColumn(name: string, definition: string): void {
		const columns = this.tableColumns('pibo_ralph_jobs');
		if (!columns.has(name)) this.db.exec(`ALTER TABLE pibo_ralph_jobs ADD COLUMN ${name} ${definition}`);
	}
	private ensureRunColumn(name: string, definition: string): void {
		const columns = this.tableColumns('pibo_ralph_runs');
		if (!columns.has(name)) this.db.exec(`ALTER TABLE pibo_ralph_runs ADD COLUMN ${name} ${definition}`);
	}
	private tableColumns(tableName: string): Set<string> {
		return new Set((this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).map((column) => column.name));
	}
	private insertJob(job: PiboLoopJob): void { this.db.prepare('INSERT INTO pibo_ralph_jobs (id, loop_mode, name, description, enabled, target_json, profile, prompt, max_iterations, token_budget, token_reserve, runtime_options_json, stop_policy_json, resource_json, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(job.id, job.mode, job.name, job.description ?? null, job.enabled ? 1 : 0, targetJson(job.target), job.profile, job.prompt, job.maxIterations ?? null, job.tokenBudget ?? null, job.tokenReserve ?? null, runtimeOptionsJson(job), stopPolicyJson(job.stopPolicy), resourceMetadataJson(job.resources), JSON.stringify(job.state), job.createdAt, job.updatedAt); }
	private writeJob(job: PiboLoopJob): void { this.db.prepare('UPDATE pibo_ralph_jobs SET loop_mode = ?, name = ?, description = ?, enabled = ?, target_json = ?, profile = ?, prompt = ?, max_iterations = ?, token_budget = ?, token_reserve = ?, runtime_options_json = ?, stop_policy_json = ?, resource_json = ?, state_json = ?, updated_at = ? WHERE id = ?').run(job.mode, job.name, job.description ?? null, job.enabled ? 1 : 0, targetJson(job.target), job.profile, job.prompt, job.maxIterations ?? null, job.tokenBudget ?? null, job.tokenReserve ?? null, runtimeOptionsJson(job), stopPolicyJson(job.stopPolicy), resourceMetadataJson(job.resources), JSON.stringify(job.state), job.updatedAt, job.id); }
	private updateJobStateLocked(id: string, state: PiboLoopJobState, updatedAt: string): void { this.db.prepare('UPDATE pibo_ralph_jobs SET state_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), updatedAt, id); }
	private createRunLocked(job: PiboLoopJob, timestamp: string): PiboLoopRun {
		const tokensUsedBefore = job.state.tokensUsed ?? 0;
		const accounting: PiboLoopRunAccounting | undefined = job.mode === 'goal' ? {
			tokenAccounting: normalizeLoopTokenAccounting(job.state.tokenAccounting),
			...(job.tokenBudget !== undefined ? { tokenBudget: job.tokenBudget, remainingTokensBefore: Math.max(0, job.tokenBudget - tokensUsedBefore) } : {}),
			...(job.tokenReserve !== undefined ? { tokenReserve: job.tokenReserve } : {}),
			tokensUsedBefore,
			tokensUsed: 0,
			overshootTokens: 0,
		} : undefined;
		const run: PiboLoopRun = { id: job.mode === 'ralph' ? `rrun_${randomUUID()}` : `lrun_${randomUUID()}`, jobId: job.id, status: 'running', messageState: 'reserved', startedAt: timestamp, ...(accounting ? { accounting } : {}), ...(job.resources ? { resources: job.resources } : {}), createdAt: timestamp, updatedAt: timestamp };
		this.db.prepare('INSERT INTO pibo_ralph_runs (id, job_id, pibo_session_id, status, reason, error, error_details_json, message_event_id, message_state, accounting_json, resource_json, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(run.id, run.jobId, null, run.status, null, null, null, null, 'reserved', runAccountingJson(run.accounting), resourceMetadataJson(run.resources), run.startedAt ?? null, null, run.createdAt, run.updatedAt);
		return run;
	}
}
export function createDefaultPiboLoopStore(options: PiboLoopStoreOptions = {}): PiboLoopStore { return new PiboLoopStore(options); }

export function createLoopMessagePreflight(options: PiboLoopStoreOptions = {}) {
	return (event: PiboMessageEvent): { allowed: boolean; reason?: string; code?: string } => {
		if (event.provenance?.kind !== 'loop-run') return { allowed: true };
		const store = createDefaultPiboLoopStore(options);
		try {
			const { jobId, runId } = event.provenance;
			const job = store.getJob(jobId);
			const run = store.getRun(runId);
			const status = job?.mode === 'goal' ? goalStatus(job) ?? (job.enabled ? 'active' : 'paused') : undefined;
			const allowed = Boolean(
				job
				&& run
				&& run.jobId === jobId
				&& run.status === 'running'
				&& run.messageEventId === event.id
				&& (!run.piboSessionId || run.piboSessionId === event.piboSessionId)
				&& job.enabled
				&& job.state.runningAt
				&& job.state.lastRunId === runId
				&& (job.mode !== 'goal' || status === 'active'),
			);
			if (allowed) return { allowed: true };
			return {
				allowed: false,
				code: 'loop_continuation_invalidated',
				reason: `Loop continuation ${runId} is no longer authorized for job ${jobId}${status ? ` (${status})` : ''}`,
			};
		} finally {
			store.close();
		}
	};
}
