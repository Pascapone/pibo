import type { PiboLoopJob } from './types.js';

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

export function goalCanStartNextTurn(job: PiboLoopJob): boolean {
	const remaining = goalRemainingTokens(job);
	return remaining === undefined || remaining > (job.tokenReserve ?? 0);
}
