import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import type { PiboGoalStatus, PiboLoopJob } from "./types";

export function SessionGoalIndicator({ goal }: { goal?: PiboLoopJob | null }) {
	const status = sessionGoalIndicatorStatus(goal);
	const [nowMs, setNowMs] = useState(() => Date.now());

	useEffect(() => {
		setNowMs(Date.now());
		if (!status || goal?.state.goalEndedAt) return;
		const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
		return () => window.clearInterval(interval);
	}, [goal?.id, goal?.state.goalEndedAt, status]);

	return <SessionGoalIndicatorView goal={goal} nowMs={nowMs} />;
}

export function SessionGoalIndicatorView({ goal, nowMs }: { goal?: PiboLoopJob | null; nowMs: number }) {
	const status = sessionGoalIndicatorStatus(goal);
	if (!goal || !status) return null;
	const label = status === "active" ? "Pursuing Goal" : "Goal Paused";
	const tone = status === "active" ? "text-fuchsia-400" : "text-amber-300";
	const elapsed = formatSessionGoalElapsed(goal, nowMs);

	return (
		<span
			className={`inline-flex shrink-0 items-center gap-2 font-sans text-sm font-semibold ${tone}`}
			data-pibo-debug="session-goal-indicator"
			data-goal-id={goal.id}
			data-goal-status={status}
			title={`${goal.name}: ${goal.prompt}`}
		>
			<Target size={17} className={status === "active" ? "animate-pulse" : ""} aria-hidden="true" />
			<span>{label}:</span>
			<span className="tabular-nums">{elapsed}</span>
		</span>
	);
}

export function sessionGoalIndicatorStatus(goal?: PiboLoopJob | null): Extract<PiboGoalStatus, "active" | "paused"> | undefined {
	if (!goal || goal.mode !== "goal") return undefined;
	const status = goal.state.goalStatus ?? (goal.enabled ? "active" : "paused");
	return status === "active" || status === "paused" ? status : undefined;
}

export function formatSessionGoalElapsed(goal: PiboLoopJob, nowMs: number): string {
	const startedAtMs = goal.state.goalStartedAt ? Date.parse(goal.state.goalStartedAt) : Number.NaN;
	const endedAtMs = goal.state.goalEndedAt ? Date.parse(goal.state.goalEndedAt) : nowMs;
	const elapsedSeconds = Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs)
		? Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1_000))
		: 0;
	const hours = Math.floor(elapsedSeconds / 3_600);
	const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
	const seconds = elapsedSeconds % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
		: `${minutes}:${String(seconds).padStart(2, "0")}`;
}
