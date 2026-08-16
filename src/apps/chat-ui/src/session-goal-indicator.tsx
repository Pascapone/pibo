import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import { goalActiveTimeSeconds } from "./goal-time";
import type { PiboGoalStatus, PiboLoopJob } from "./types";

export function SessionGoalIndicator({ goal }: { goal?: PiboLoopJob | null }) {
	const status = sessionGoalIndicatorStatus(goal);
	const [nowMs, setNowMs] = useState(() => Date.now());

	useEffect(() => {
		setNowMs(Date.now());
		if (!status || !goal?.state.runningAt) return;
		const interval = window.setInterval(() => setNowMs(Date.now()), 1_000);
		return () => window.clearInterval(interval);
	}, [goal?.id, goal?.state.runningAt, status]);

	return <SessionGoalIndicatorView goal={goal} nowMs={nowMs} />;
}

export function SessionGoalIndicatorView({ goal, nowMs }: { goal?: PiboLoopJob | null; nowMs: number }) {
	const status = sessionGoalIndicatorStatus(goal);
	if (!goal || !status) return null;
	const label = status === "active" ? "Pursuing Goal" : "Goal Paused";
	const tone = status === "active" ? "text-fuchsia-400" : "text-amber-300";
	const activeTime = formatSessionGoalActiveTime(goal, nowMs);

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
			<span className="tabular-nums">{activeTime}</span>
		</span>
	);
}

export function sessionGoalIndicatorStatus(goal?: PiboLoopJob | null): Extract<PiboGoalStatus, "active" | "paused"> | undefined {
	if (!goal || goal.mode !== "goal") return undefined;
	const status = goal.state.goalStatus ?? (goal.enabled ? "active" : "paused");
	return status === "active" || status === "paused" ? status : undefined;
}

export function formatSessionGoalActiveTime(goal: PiboLoopJob, nowMs: number): string {
	const activeSeconds = goalActiveTimeSeconds(goal, nowMs);
	const hours = Math.floor(activeSeconds / 3_600);
	const minutes = Math.floor((activeSeconds % 3_600) / 60);
	const seconds = activeSeconds % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
		: `${minutes}:${String(seconds).padStart(2, "0")}`;
}
