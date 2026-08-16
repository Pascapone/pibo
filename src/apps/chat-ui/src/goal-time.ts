import type { PiboLoopJob } from "./types";

export function goalActiveTimeSeconds(goal: PiboLoopJob, nowMs = Date.now()): number {
	const recordedSeconds = Math.max(0, Math.floor(goal.state.activeTimeSeconds ?? goal.state.timeUsedSeconds ?? 0));
	const runningAtMs = goal.state.runningAt ? Date.parse(goal.state.runningAt) : Number.NaN;
	if (!Number.isFinite(runningAtMs)) return recordedSeconds;
	return recordedSeconds + Math.max(0, Math.floor((nowMs - runningAtMs) / 1_000));
}
