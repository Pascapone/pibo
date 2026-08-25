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
	const tokenUsage = status === "active" ? formatSessionGoalTokenUsage(goal) : undefined;
	const accessibleLabel = [label, `Elapsed ${elapsed}`, tokenUsage ? `Tokens ${tokenUsage}` : undefined].filter(Boolean).join(". ");

	return (
		<span
			className={`ml-auto inline-flex shrink-0 items-center gap-2 font-sans text-sm font-semibold ${tone}`}
			data-pibo-debug="session-goal-indicator"
			data-goal-id={goal.id}
			data-goal-status={status}
			aria-label={accessibleLabel}
			title={`${goal.name}: ${goal.prompt}`}
		>
			<Target size={17} className={status === "active" ? "animate-pulse" : ""} aria-hidden="true" />
			<span>{label}:</span>
			<span className="tabular-nums">{elapsed}</span>
			{tokenUsage ? <><span aria-hidden="true">·</span><span className="font-mono tabular-nums">{tokenUsage}</span></> : null}
		</span>
	);
}

export function sessionGoalIndicatorStatus(goal?: PiboLoopJob | null): Extract<PiboGoalStatus, "active" | "paused"> | undefined {
	if (!goal || goal.mode !== "goal") return undefined;
	const status = goal.state.goalStatus ?? (goal.enabled ? "active" : "paused");
	return status === "active" || status === "paused" ? status : undefined;
}

export function formatSessionGoalTokenUsage(goal: PiboLoopJob): string {
	const used = formatCompactTokenCount(goal.state.tokensUsed ?? 0);
	return goal.tokenBudget === undefined ? used : `${used} / ${formatCompactTokenCount(goal.tokenBudget)}`;
}

function formatCompactTokenCount(tokens: number): string {
	const normalized = Number.isFinite(tokens) ? Math.max(0, tokens) : 0;
	return normalized >= 1_000_000
		? `${(normalized / 1_000_000).toFixed(1)}M`
		: `${(normalized / 1_000).toFixed(1)}k`;
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
