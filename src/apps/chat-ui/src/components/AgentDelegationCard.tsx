import { useEffect, useMemo, useState } from "react";
import { Bot, ExternalLink, GitBranch } from "lucide-react";
import {
	compactAgentDelegationTask,
	extractAgentDelegationName,
	formatAgentDelegationDuration,
	resolveAgentDelegationStatus,
	type AgentDelegationStatus,
} from "../../../../session-ui/delegation.js";
import type { PiboSignalSnapshot } from "../types";
import { JsonRenderer } from "../tracing/JsonRenderer";

export type AgentDelegationCardProps = {
	title?: string;
	summary?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	traceStatus?: "running" | "done" | "error";
	linkedPiboSessionId?: string;
	startedAt?: string;
	completedAt?: string;
	durationMs?: number;
	signals?: PiboSignalSnapshot;
	onOpenSession?: (piboSessionId: string) => void;
};

export function AgentDelegationCard({
	title,
	summary,
	input,
	output,
	error,
	traceStatus = "done",
	linkedPiboSessionId,
	startedAt,
	completedAt,
	durationMs,
	signals,
	onOpenSession,
}: AgentDelegationCardProps) {
	const childSignal = linkedPiboSessionId ? signals?.sessions[linkedPiboSessionId] : undefined;
	const traceTerminal = traceStatus === "error" || completedAt !== undefined;
	const status = resolveAgentDelegationStatus(childSignal, traceStatus, traceTerminal);
	const signalNode = useMemo(() => {
		if (!linkedPiboSessionId || !signals) return undefined;
		return Object.values(signals.nodes).find((node) =>
			node.childPiboSessionId === linkedPiboSessionId ||
			(node.piboSessionId === linkedPiboSessionId && node.kind === "session"),
		);
	}, [linkedPiboSessionId, signals]);
	const effectiveStartedAt = startedAt ?? signalNode?.startedAt ?? signalNode?.createdAt;
	const effectiveCompletedAt = status === "running"
		? undefined
		: completedAt ?? childSignal?.updatedAt ?? signalNode?.completedAt;
	const [now, setNow] = useState(() => Date.now());
	const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
	const name = extractAgentDelegationName(input, title, summary);
	const task = compactAgentDelegationTask(input);
	const timing = delegationTiming(effectiveStartedAt, effectiveCompletedAt, status === "running" ? undefined : durationMs, now, status === "running");
	const hasTechnicalDetails = input !== undefined || output !== undefined || Boolean(error);

	useEffect(() => {
		if (status !== "running") return;
		const interval = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(interval);
	}, [status]);

	return (
		<div
			className="min-w-0 overflow-hidden rounded-sm border border-[#f97316]/60 bg-[#1a140f] text-slate-200 shadow-sm"
			data-pibo-component="AgentDelegationCard"
			data-delegation-status={status}
		>
			<div className="flex min-w-0 flex-wrap items-start gap-3 border-b border-[#f97316]/25 bg-[#f97316]/8 px-3 py-2.5">
				<span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#f97316] bg-[#f97316]/15 text-[#f97316]">
					<GitBranch size={16} aria-hidden="true" />
					{status === "running" ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-[#0bda57]" aria-hidden="true" /> : null}
				</span>
				<div className="min-w-[12rem] flex-1">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<span className="text-[10px] font-bold uppercase tracking-wider text-[#f97316]">Agent Delegation</span>
						<span className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-slate-100">
							<Bot size={14} className="shrink-0 text-[#f97316]" aria-hidden="true" />
							<span className="truncate">{name}</span>
						</span>
						<DelegationStatusBadge status={status} />
					</div>
					{task ? <p className="mt-1 line-clamp-2 break-words font-mono text-xs leading-relaxed text-slate-400">{task}</p> : null}
					{timing ? <div className="mt-1 font-mono text-[10px] tabular-nums text-slate-500">{timing}</div> : null}
				</div>
				{linkedPiboSessionId && onOpenSession ? (
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							onOpenSession(linkedPiboSessionId);
						}}
						className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-sm border border-[#f97316]/70 px-2.5 py-1 text-[11px] font-semibold text-[#fb923c] hover:border-[#f97316] hover:bg-[#f97316]/10 focus:outline-none focus:ring-1 focus:ring-[#f97316]"
					>
						<ExternalLink size={13} aria-hidden="true" />
						Open sub-session
					</button>
				) : null}
			</div>
			{hasTechnicalDetails ? (
				<>
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							setShowTechnicalDetails((current) => !current);
						}}
						aria-expanded={showTechnicalDetails}
						className="flex min-h-9 w-full items-center justify-between gap-2 border-t border-[#f97316]/15 px-3 py-2 text-left text-[11px] font-semibold text-slate-400 hover:bg-[#f97316]/5 hover:text-slate-200 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#f97316]"
					>
						<span>Technical details</span>
						<span aria-hidden="true">{showTechnicalDetails ? "−" : "+"}</span>
					</button>
					{showTechnicalDetails ? (
						<div className="grid min-w-0 gap-3 border-t border-[#f97316]/15 bg-[#0e1116] p-3 text-xs">
							{input !== undefined ? <TechnicalValue label="Arguments" value={input} /> : null}
							{output !== undefined ? <TechnicalValue label="Result" value={output} /> : null}
							{error ? <TechnicalValue label="Error" value={error} error /> : null}
						</div>
					) : null}
				</>
			) : null}
		</div>
	);
}

function DelegationStatusBadge({ status }: { status: AgentDelegationStatus }) {
	const styles: Record<AgentDelegationStatus, string> = {
		running: "border-[#0bda57]/40 bg-[#0bda57]/10 text-[#0bda57]",
		completed: "border-green-500/40 bg-green-500/10 text-green-400",
		failed: "border-red-500/40 bg-red-500/10 text-red-400",
		cancelled: "border-slate-500/50 bg-slate-500/10 text-slate-300",
	};
	const label = `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
	return (
		<span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${styles[status]}`} role="status" aria-live="polite" aria-atomic="true">
			{status === "running" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" /> : null}
			{label}
		</span>
	);
}

function TechnicalValue({ label, value, error = false }: { label: string; value: unknown; error?: boolean }) {
	return (
		<div className="min-w-0">
			<div className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${error ? "text-red-400" : "text-[#fb923c]"}`}>{label}</div>
			<JsonRenderer value={value} />
		</div>
	);
}

function delegationTiming(
	startedAt: string | undefined,
	completedAt: string | undefined,
	durationMs: number | undefined,
	now: number,
	running: boolean,
): string | undefined {
	const start = timestamp(startedAt);
	const end = timestamp(completedAt);
	const elapsed = durationMs ?? (start === undefined ? undefined : Math.max(0, (end ?? now) - start));
	const parts: string[] = [];
	if (start !== undefined) parts.push(running ? `Started ${formatRelativeStart(now - start)}` : `Started ${formatStartTime(start)}`);
	if (elapsed !== undefined) parts.push(formatAgentDelegationDuration(elapsed));
	return parts.length ? parts.join(" · ") : undefined;
}

function formatRelativeStart(ageMs: number): string {
	const seconds = Math.max(0, Math.floor(ageMs / 1000));
	if (seconds < 5) return "just now";
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ago`;
}

function formatStartTime(timestampMs: number): string {
	return `${new Date(timestampMs).toISOString().slice(11, 19)} UTC`;
}

function timestamp(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = new Date(value).getTime();
	return Number.isFinite(parsed) ? parsed : undefined;
}
