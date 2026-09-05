type HeaderUsageStatus = {
	contextPercent?: number;
	weeklyRemainingPercent?: number;
	weeklyResetAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedPercent(value: unknown): number | undefined {
	const number = finiteNumber(value);
	return number === undefined ? undefined : Math.max(0, Math.min(100, number));
}

export function extractHeaderUsage(status: unknown): HeaderUsageStatus {
	let record = asRecord(status);
	if (typeof status === "string") {
		try {
			record = asRecord(JSON.parse(status));
		} catch {
			record = undefined;
		}
	}
	if (!record) return {};

	const context = asRecord(record.contextUsage);
	const tokens = finiteNumber(context?.tokens);
	const contextWindow = finiteNumber(context?.contextWindow);
	const contextPercent = boundedPercent(
		context?.percent ?? (tokens !== undefined && contextWindow ? (tokens / contextWindow) * 100 : undefined),
	);
	const provider = asRecord(record.providerUsage);
	const limits = Array.isArray(provider?.limits)
		? provider.limits.map(asRecord).filter((limit): limit is Record<string, unknown> => Boolean(limit))
		: [];
	const weekly = limits.find((limit) => {
		const label = typeof limit?.label === "string" ? limit.label.toLowerCase() : "";
		return /(^|\s)(weekly|1w|7d)(\s|$)/.test(label);
	});
	const usedPercent = boundedPercent(weekly?.usedPercent);
	const weeklyRemainingPercent = boundedPercent(
		weekly?.remainingPercent ?? (usedPercent === undefined ? undefined : 100 - usedPercent),
	);

	return {
		contextPercent,
		weeklyRemainingPercent,
		weeklyResetAt: typeof weekly?.resetsAt === "string" ? weekly.resetsAt : undefined,
	};
}

function interpolate(left: readonly number[], right: readonly number[], ratio: number): string {
	const values = left.map((value, index) => Math.round(value + ((right[index] ?? value) - value) * ratio));
	return `rgb(${values.join(", ")})`;
}

export function usageHealthColor(healthPercent: number | undefined): string {
	if (healthPercent === undefined) return "#64748b";
	const health = Math.max(0, Math.min(100, healthPercent));
	if (health <= 50) return interpolate([239, 68, 68], [250, 204, 21], health / 50);
	return interpolate([250, 204, 21], [34, 197, 94], (health - 50) / 50);
}

function UsageRow({
	label,
	percent,
	healthPercent,
	title,
}: {
	label: string;
	percent?: number;
	healthPercent?: number;
	title?: string;
}) {
	const color = usageHealthColor(healthPercent);
	const width = percent === undefined ? 0 : percent;
	return (
		<div
			className="grid grid-cols-[5.25rem_minmax(3rem,1fr)_2.25rem] items-center gap-1"
			data-pibo-usage-meter={label.toLowerCase().replaceAll(" ", "-")}
			title={title}
		>
			<span className="truncate text-[9px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
			<div className="h-1 overflow-hidden rounded-full bg-slate-800">
				<div className="h-full rounded-full transition-[width,background-color] duration-300" style={{ width: `${width}%`, backgroundColor: color }} />
			</div>
			<span className="text-right font-mono text-[10px] tabular-nums" style={{ color }}>
				{percent === undefined ? "--" : `${Math.round(percent)}%`}
			</span>
		</div>
	);
}

export function TerminalHeaderUsage({ status }: { status?: unknown }) {
	const usage = extractHeaderUsage(status);
	const weeklyReset = usage.weeklyResetAt ? new Date(usage.weeklyResetAt) : undefined;
	const weeklyTitle = weeklyReset && !Number.isNaN(weeklyReset.getTime())
		? `Weekly limit resets ${weeklyReset.toLocaleString()}`
		: "Weekly limit remaining";
	return (
		<div
			className="ml-1 w-48 shrink-0 space-y-0.5 border-l border-slate-800 pl-2"
			data-pibo-debug="terminal-header-usage"
			aria-label="Terminal usage status"
		>
			<UsageRow
				label="Weekly Limit"
				percent={usage.weeklyRemainingPercent}
				healthPercent={usage.weeklyRemainingPercent}
				title={weeklyTitle}
			/>
			<UsageRow
				label="Context Usage"
				percent={usage.contextPercent}
				healthPercent={usage.contextPercent === undefined ? undefined : 100 - usage.contextPercent}
				title="Current context window usage"
			/>
		</div>
	);
}
