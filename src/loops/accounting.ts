import type { PiboAssistantUsageEvent } from '../core/events.js';
import type { PiboLoopJob, PiboLoopRecursiveUsage, PiboLoopTokenAccounting, PiboLoopTokenAccountingBasis, PiboLoopUsageTotals } from './types.js';

export const LOOP_TOKEN_ACCOUNTING_VERSION = 1 as const;

export function emptyLoopUsageTotals(): PiboLoopUsageTotals {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
		costUsd: 0,
		costReportedTurns: 0,
		assistantTurns: 0,
	};
}

export function emptyLoopRecursiveUsage(): PiboLoopRecursiveUsage {
	return {
		controller: emptyLoopUsageTotals(),
		descendants: emptyLoopUsageTotals(),
		total: emptyLoopUsageTotals(),
		sessionIds: [],
	};
}

export function assistantUsageTotals(usage: PiboAssistantUsageEvent): PiboLoopUsageTotals {
	return {
		inputTokens: normalizedTokenCount(usage.inputTokens),
		outputTokens: normalizedTokenCount(usage.outputTokens),
		cacheReadTokens: normalizedTokenCount(usage.cacheReadTokens),
		cacheWriteTokens: normalizedTokenCount(usage.cacheWriteTokens),
		reasoningTokens: normalizedTokenCount(usage.reasoningTokens),
		totalTokens: normalizedTokenCount(usage.totalTokens),
		costUsd: typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd) ? Math.max(0, usage.costUsd) : 0,
		costReportedTurns: typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd) ? 1 : 0,
		assistantTurns: 1,
	};
}

function normalizeLoopUsageTotals(value: Partial<PiboLoopUsageTotals> | undefined): PiboLoopUsageTotals {
	const costUsd = typeof value?.costUsd === 'number' && Number.isFinite(value.costUsd) ? Math.max(0, value.costUsd) : 0;
	return {
		inputTokens: normalizedTokenCount(value?.inputTokens),
		outputTokens: normalizedTokenCount(value?.outputTokens),
		cacheReadTokens: normalizedTokenCount(value?.cacheReadTokens),
		cacheWriteTokens: normalizedTokenCount(value?.cacheWriteTokens),
		reasoningTokens: normalizedTokenCount(value?.reasoningTokens),
		totalTokens: normalizedTokenCount(value?.totalTokens),
		costUsd,
		costReportedTurns: value?.costReportedTurns === undefined && costUsd > 0 ? 1 : normalizedTokenCount(value?.costReportedTurns),
		assistantTurns: normalizedTokenCount(value?.assistantTurns),
	};
}

function addUsageTotals(left: PiboLoopUsageTotals, right: PiboLoopUsageTotals): PiboLoopUsageTotals {
	const normalizedLeft = normalizeLoopUsageTotals(left);
	const normalizedRight = normalizeLoopUsageTotals(right);
	return {
		inputTokens: normalizedLeft.inputTokens + normalizedRight.inputTokens,
		outputTokens: normalizedLeft.outputTokens + normalizedRight.outputTokens,
		cacheReadTokens: normalizedLeft.cacheReadTokens + normalizedRight.cacheReadTokens,
		cacheWriteTokens: normalizedLeft.cacheWriteTokens + normalizedRight.cacheWriteTokens,
		reasoningTokens: normalizedLeft.reasoningTokens + normalizedRight.reasoningTokens,
		totalTokens: normalizedLeft.totalTokens + normalizedRight.totalTokens,
		costUsd: normalizedLeft.costUsd + normalizedRight.costUsd,
		costReportedTurns: normalizedLeft.costReportedTurns + normalizedRight.costReportedTurns,
		assistantTurns: normalizedLeft.assistantTurns + normalizedRight.assistantTurns,
	};
}

export function addLoopAssistantUsage(
	current: PiboLoopRecursiveUsage | undefined,
	usage: PiboAssistantUsageEvent,
	input: { piboSessionId: string; descendant: boolean },
): PiboLoopRecursiveUsage {
	const base = current
		? {
			controller: normalizeLoopUsageTotals(current.controller),
			descendants: normalizeLoopUsageTotals(current.descendants),
			total: normalizeLoopUsageTotals(current.total),
			sessionIds: Array.isArray(current.sessionIds) ? current.sessionIds.filter((id): id is string => typeof id === 'string') : [],
		}
		: emptyLoopRecursiveUsage();
	const increment = assistantUsageTotals(usage);
	return {
		controller: input.descendant ? { ...base.controller } : addUsageTotals(base.controller, increment),
		descendants: input.descendant ? addUsageTotals(base.descendants, increment) : { ...base.descendants },
		total: addUsageTotals(base.total, increment),
		sessionIds: base.sessionIds.includes(input.piboSessionId) ? [...base.sessionIds] : [...base.sessionIds, input.piboSessionId],
	};
}

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
