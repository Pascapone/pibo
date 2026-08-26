import type { PiboLoopJob } from "./types";

export function goalActiveTimeRunningAt(goal: PiboLoopJob): string | undefined {
	return goal.state.activeTimeRunningAt === null
		? undefined
		: goal.state.activeTimeRunningAt ?? goal.state.runningAt;
}

export function goalActiveTimeSeconds(goal: PiboLoopJob, nowMs = Date.now()): number {
	const recordedSeconds = Math.max(0, Math.floor(goal.state.activeTimeSeconds ?? goal.state.timeUsedSeconds ?? 0));
	const runningAt = goalActiveTimeRunningAt(goal);
	const runningAtMs = runningAt ? Date.parse(runningAt) : Number.NaN;
	if (!Number.isFinite(runningAtMs)) return recordedSeconds;
	return recordedSeconds + Math.max(0, Math.floor((nowMs - runningAtMs) / 1_000));
}
