import type { PiboAssistantUsageEvent } from '../core/events.js';
import type { PiboLoopJob, PiboLoopTokenAccounting, PiboLoopTokenAccountingBasis } from './types.js';

export const LOOP_TOKEN_ACCOUNTING_VERSION = 1 as const;

function normalizedTokenCount(value: number | undefined): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function normalizeLoopTokenAccounting(value: unknown, fallback: PiboLoopTokenAccountingBasis = 'total'): PiboLoopTokenAccounting {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const candidate = value as { version?: unknown; basis?: unknown };
		if (candidate.version === LOOP_TOKEN_ACCOUNTING_VERSION && (candidate.basis === 'total' || candidate.basis === 'uncached')) {
			return { version: LOOP_TOKEN_ACCOUNTING_VERSION, basis: candidate.basis };
		}
	}
	return { version: LOOP_TOKEN_ACCOUNTING_VERSION, basis: fallback };
}

export function newGoalTokenAccounting(): PiboLoopTokenAccounting {
	return { version: LOOP_TOKEN_ACCOUNTING_VERSION, basis: 'uncached' };
}

export function goalTokenAccounting(job: PiboLoopJob): PiboLoopTokenAccounting {
	return normalizeLoopTokenAccounting(job.state.tokenAccounting);
}

export function goalBudgetTokens(usage: PiboAssistantUsageEvent, basis: PiboLoopTokenAccountingBasis): number {
	const totalTokens = normalizedTokenCount(usage.totalTokens);
	if (basis === 'total') return totalTokens;
	const cacheReadTokens = normalizedTokenCount(usage.cacheReadTokens);
	const cacheWriteTokens = normalizedTokenCount(usage.cacheWriteTokens);
	return Math.max(0, totalTokens - cacheReadTokens - cacheWriteTokens);
}

export function goalActiveTimeSeconds(job: PiboLoopJob): number {
	return Math.max(0, Math.floor(job.state.activeTimeSeconds ?? job.state.timeUsedSeconds ?? 0));
}

export function goalElapsedWallClockSeconds(job: PiboLoopJob, now = new Date()): number {
	if (job.mode !== 'goal' || !job.state.goalStartedAt) return 0;
	const startedAt = Date.parse(job.state.goalStartedAt);
	const endedAt = job.state.goalEndedAt ? Date.parse(job.state.goalEndedAt) : now.getTime();
	if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;
	return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
}

export function goalRemainingTokens(job: PiboLoopJob): number | undefined {
	return job.tokenBudget === undefined ? undefined : Math.max(0, job.tokenBudget - (job.state.tokensUsed ?? 0));
}

export function goalCanStartNextTurn(job: PiboLoopJob, now = new Date()): boolean {
	if (job.mode !== 'goal' || !job.enabled) return false;
	const status = job.state.goalStatus ?? 'paused';
	if (status !== 'active') return false;
	if (job.state.nextAttemptAt && Date.parse(job.state.nextAttemptAt) > now.getTime()) return false;
	const remaining = goalRemainingTokens(job);
	return remaining === undefined || remaining > (job.tokenReserve ?? 0);
}
