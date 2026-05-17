import { useState } from "react";
import { Activity, Cpu, Folder, Gauge, Hash, Layers } from "lucide-react";
import { buildTerminalCardDescriptor, type TerminalProgressDescriptor, type TerminalStatusField } from "../../../../../session-ui/index.js";
import type { CompactTerminalRow } from "../../../../../session-ui/terminalRows.js";

type StatusData = {
	piboSessionId?: string;
	queuedMessages?: number;
	processing?: boolean;
	streaming?: boolean;
	enabledTools?: string[];
	activeTools?: string[];
	cwd?: string;
	disposed?: boolean;
	contextUsage?: {
		tokens?: number;
		contextWindow?: number;
		percent?: number;
	};
	providerUsage?: {
		provider?: string;
		planType?: string;
		fetchedAt?: string;
		limits: Array<{
			label: string;
			usedPercent: number;
			remainingPercent: number;
			resetsAt?: string;
		}>;
		credits?: {
			unlimited?: boolean;
			balance?: string;
		};
	};
};

function parseStatusData(output: unknown): StatusData | undefined {
	if (!output) return undefined;
	let obj: Record<string, unknown> | undefined;
	if (typeof output === "string") {
		try {
			obj = JSON.parse(output) as Record<string, unknown>;
		} catch {
			return undefined;
		}
	} else if (typeof output === "object" && !Array.isArray(output)) {
		obj = output as Record<string, unknown>;
	}
	if (!obj) return undefined;

	const contextUsage =
		typeof obj.contextUsage === "object" && obj.contextUsage !== null
			? (obj.contextUsage as Record<string, unknown>)
			: undefined;
	const providerUsage =
		typeof obj.providerUsage === "object" && obj.providerUsage !== null
			? (obj.providerUsage as Record<string, unknown>)
			: undefined;
	const providerLimits = Array.isArray(providerUsage?.limits)
		? providerUsage.limits
				.filter((limit): limit is Record<string, unknown> => Boolean(limit) && typeof limit === "object" && !Array.isArray(limit))
				.map((limit) => ({
					label: typeof limit.label === "string" ? limit.label : "limit",
					usedPercent: typeof limit.usedPercent === "number" ? limit.usedPercent : 0,
					remainingPercent: typeof limit.remainingPercent === "number" ? limit.remainingPercent : 0,
					resetsAt: typeof limit.resetsAt === "string" ? limit.resetsAt : undefined,
				}))
		: [];
	const providerCredits =
		typeof providerUsage?.credits === "object" && providerUsage.credits !== null
			? (providerUsage.credits as Record<string, unknown>)
			: undefined;

	return {
		piboSessionId:
			typeof obj.piboSessionId === "string" ? obj.piboSessionId : undefined,
		queuedMessages:
			typeof obj.queuedMessages === "number" ? obj.queuedMessages : undefined,
		processing:
			typeof obj.processing === "boolean" ? obj.processing : undefined,
		streaming:
			typeof obj.streaming === "boolean" ? obj.streaming : undefined,
		enabledTools: Array.isArray(obj.enabledTools)
			? obj.enabledTools.filter((t): t is string => typeof t === "string")
			: Array.isArray(obj.activeTools)
				? obj.activeTools.filter((t): t is string => typeof t === "string")
				: undefined,
		activeTools: Array.isArray(obj.activeTools)
			? obj.activeTools.filter((t): t is string => typeof t === "string")
			: undefined,
		cwd: typeof obj.cwd === "string" ? obj.cwd : undefined,
		disposed:
			typeof obj.disposed === "boolean" ? obj.disposed : undefined,
		contextUsage: contextUsage
			? {
					tokens:
						typeof contextUsage.tokens === "number"
							? contextUsage.tokens
							: undefined,
					contextWindow:
						typeof contextUsage.contextWindow === "number"
							? contextUsage.contextWindow
							: undefined,
					percent:
						typeof contextUsage.percent === "number"
							? contextUsage.percent
							: undefined,
				}
			: undefined,
		providerUsage: providerUsage && (providerLimits.length > 0 || providerCredits)
			? {
					provider: typeof providerUsage.provider === "string" ? providerUsage.provider : undefined,
					planType: typeof providerUsage.planType === "string" ? providerUsage.planType : undefined,
					fetchedAt: typeof providerUsage.fetchedAt === "string" ? providerUsage.fetchedAt : undefined,
					limits: providerLimits,
					credits: providerCredits
						? {
							unlimited: providerCredits.unlimited === true,
							balance: typeof providerCredits.balance === "string" ? providerCredits.balance : undefined,
						}
						: undefined,
				}
			: undefined,
	};
}

function legacyStatusField(id: string, label: string, value?: string): TerminalStatusField | undefined {
	return value ? { id, label, value } : undefined;
}

function StatusFieldRow({ field, icon }: { field: TerminalStatusField; icon: "session" | "cwd" }) {
	const Icon = icon === "session" ? Hash : Folder;
	return (
		<div className="flex items-center gap-1.5 text-[11px]" data-shared-status-field={field.id}>
			<Icon size={11} className="shrink-0 text-[#737373]" />
			<span className="shrink-0 text-[#737373]">{field.label}:</span>
			<span className={`truncate font-mono ${field.id === "session" ? "text-[#38bdf8]" : "text-[#d4d4d4]"}`}>
				{field.value}
			</span>
		</div>
	);
}

function SharedProgressBar({ progress, label }: { progress: TerminalProgressDescriptor; label?: string }) {
	const percent = progress.percent ?? 0;
	const barColor =
		progress.tone === "red"
			? "bg-[#ef4444]"
			: progress.tone === "yellow"
				? "bg-[#facc15]"
				: progress.tone === "cyan"
					? "bg-[#38bdf8]"
					: "bg-[#22c55e]";
	return (
		<div className="mt-3 space-y-1" data-shared-progress={progress.id}>
			<div className="flex items-center justify-between text-[11px]">
				<span className="text-[#737373]">{label ?? progress.label}</span>
				<span className="font-mono text-[#d4d4d4]">{progress.text}</span>
			</div>
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a2a]">
				<div
					className={`h-full rounded-full ${barColor} transition-all`}
					style={{ width: `${Math.min(Math.max(percent, 0), 100)}%` }}
				/>
			</div>
		</div>
	);
}

function formatResetTime(value?: string): string | undefined {
	if (!value) return undefined;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toLocaleString(undefined, {
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function TerminalStatusCard({ row }: { row: CompactTerminalRow }) {
	const data = parseStatusData(row.output);
	const sharedCard = buildTerminalCardDescriptor(row);
	const statusView = sharedCard?.kind === "status" ? sharedCard.statusView : undefined;
	const [toolsExpanded, setToolsExpanded] = useState(false);

	if (!data || !statusView) {
		return (
			<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]">
				<div className="text-[#737373]">Status (unparseable)</div>
			</div>
		);
	}

	const fieldById = new Map(statusView.fields.map((field) => [field.id, field]));
	const sessionField = fieldById.get("session") ?? legacyStatusField("session", "Session", data.piboSessionId);
	const cwdField = fieldById.get("cwd") ?? legacyStatusField("cwd", "CWD", data.cwd);
	const contextProgress = statusView.progress.find((progress) => progress.id === "context" && progress.state === "available");
	const providerProgress = statusView.progress.filter((progress) => progress.id.startsWith("provider-") && progress.state === "available");
	const enabledTools = data.enabledTools ?? data.activeTools ?? [];

	return (
		<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]" data-shared-terminal-card="status">
			{/* Header */}
			<div className="mb-2 flex items-center gap-2">
				<Activity size={14} className="text-[#22c55e]" />
				<span className="font-semibold text-[#d4d4d4]">{statusView.title}</span>
			</div>

			{/* Session Info */}
			<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
				{sessionField ? <StatusFieldRow field={sessionField} icon="session" /> : null}
				{cwdField ? <StatusFieldRow field={cwdField} icon="cwd" /> : null}
			</div>

			{/* State Badges */}
			<div className="mt-2 flex flex-wrap gap-1.5">
				{data.processing ? (
					<span className="inline-flex items-center gap-1 border border-[#1f4960] px-1.5 py-0.5 text-[11px] text-[#38bdf8]">
						<Cpu size={10} /> Processing
					</span>
				) : null}
				{data.streaming ? (
					<span className="inline-flex items-center gap-1 border border-[#1f4960] px-1.5 py-0.5 text-[11px] text-[#38bdf8]">
						<Activity size={10} /> Streaming
					</span>
				) : null}
				{typeof data.queuedMessages === "number" &&
				data.queuedMessages > 0 ? (
					<span className="inline-flex items-center gap-1 border border-[#3a3a3a] px-1.5 py-0.5 text-[11px] text-[#d4d4d4]">
						<Layers size={10} /> Queued: {data.queuedMessages}
					</span>
				) : null}
				{data.disposed ? (
					<span className="inline-flex items-center gap-1 border border-[#5f2222] px-1.5 py-0.5 text-[11px] text-[#ef4444]">
						Disposed
					</span>
				) : null}
			</div>

			{/* Context Usage Bar */}
			{contextProgress ? <SharedProgressBar progress={contextProgress} label="Context Usage" /> : null}

			{/* Provider Usage */}
			{data.providerUsage ? (
				<div className="mt-3 space-y-1.5 border-t border-[#2a2a2a] pt-2" data-shared-provider-progress={providerProgress.length}>
					<div className="flex items-center gap-1.5 text-[11px] text-[#737373]">
						<Gauge size={11} />
						<span>OpenAI Codex quota{data.providerUsage.planType ? ` (${data.providerUsage.planType})` : ""}</span>
					</div>
					{data.providerUsage.limits.map((limit) => {
						const reset = formatResetTime(limit.resetsAt);
						return (
							<div key={`${limit.label}-${limit.resetsAt ?? ""}`} className="space-y-1">
								<div className="flex items-center justify-between gap-2 text-[11px]">
									<span className="text-[#a3a3a3]">{limit.label}</span>
									<span className="shrink-0 font-mono text-[#d4d4d4]">
										{limit.remainingPercent.toFixed(0)}% left{reset ? ` · resets ${reset}` : ""}
									</span>
								</div>
								<div className="h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a2a]">
									<div className="h-full rounded-full bg-[#38bdf8] transition-all" style={{ width: `${Math.min(Math.max(limit.remainingPercent, 0), 100)}%` }} />
								</div>
							</div>
						);
					})}
					{data.providerUsage.credits ? (
						<div className="text-[11px] text-[#a3a3a3]">
							Credits: {data.providerUsage.credits.unlimited ? "unlimited" : data.providerUsage.credits.balance ?? "available"}
						</div>
					) : null}
				</div>
			) : null}

			{/* Foldable Tools */}
			{enabledTools.length > 0 ? (
				<div className="mt-3">
					<button
						type="button"
						onClick={() => setToolsExpanded((v) => !v)}
						className="flex items-center gap-1.5 text-[11px] text-[#737373] hover:text-[#d4d4d4]"
					>
						<span className="text-[#d4d4d4]">
							{toolsExpanded ? "▾" : "▸"}
						</span>
						<span>Enabled tools ({enabledTools.length})</span>
					</button>
					{toolsExpanded ? (
						<div className="mt-1.5 flex flex-wrap gap-1">
							{enabledTools.map((tool) => (
								<span
									key={tool}
									className="inline-block rounded-sm border border-[#2a2a2a] bg-[#0b0b0b] px-1.5 py-0.5 font-mono text-[11px] text-[#a3a3a3]"
								>
									{tool}
								</span>
							))}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
