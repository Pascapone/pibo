import type { ToolCallMetrics } from "../../../../../shared/tool-call-metrics.js";

const tokenFormatter = new Intl.NumberFormat("en-US");

type MetricLevel = "unavailable" | "normal" | "elevated" | "high" | "critical";
type MetricKind = "duration" | "input" | "output";

const metricClasses: Record<MetricKind, Record<MetricLevel, string>> = {
	duration: {
		unavailable: "border-[#525252] bg-[#171717] text-[#737373]",
		normal: "border-[#c084fc] bg-[#c084fc]/15 text-[#e9d5ff]",
		elevated: "border-[#ffb000] bg-[#ffb000]/20 text-[#ffd166]",
		high: "border-[#ff6b00] bg-[#ff6b00]/20 text-[#ffad66]",
		critical: "border-[#ff2bd6] bg-[#ff2bd6]/25 text-[#ff8bea]",
	},
	input: {
		unavailable: "border-[#525252] bg-[#171717] text-[#737373]",
		normal: "border-[#00e5ff] bg-[#00e5ff]/15 text-[#7df9ff]",
		elevated: "border-[#ffe600] bg-[#ffe600]/20 text-[#fff36b]",
		high: "border-[#ff7a00] bg-[#ff7a00]/20 text-[#ffb15c]",
		critical: "border-[#ff2bd6] bg-[#ff2bd6]/25 text-[#ff8bea]",
	},
	output: {
		unavailable: "border-[#525252] bg-[#171717] text-[#737373]",
		normal: "border-[#a3ff12] bg-[#a3ff12]/15 text-[#c7ff6b]",
		elevated: "border-[#ffe600] bg-[#ffe600]/20 text-[#fff36b]",
		high: "border-[#ff6b00] bg-[#ff6b00]/25 text-[#ffad66]",
		critical: "border-[#ff2bd6] bg-[#ff2bd6]/30 text-[#ff8bea]",
	},
};

function tokens(value: number | undefined): string {
	return value === undefined || !Number.isFinite(value) || value < 0 ? "—" : `≈${tokenFormatter.format(Math.round(value))}`;
}

function duration(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
	if (value < 1000) return `${Math.round(value)} ms`;
	if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
	return `${Math.floor(value / 60_000)}m ${Math.floor(value % 60_000 / 1000)}s`;
}

function metricLevel(kind: MetricKind, value: number | undefined): MetricLevel {
	if (value === undefined || !Number.isFinite(value) || value < 0) return "unavailable";
	if (kind === "duration") {
		if (value >= 15_000) return "critical";
		if (value >= 5_000) return "high";
		if (value >= 1_000) return "elevated";
		return "normal";
	}
	if (kind === "input") {
		if (value >= 50_000) return "critical";
		if (value >= 20_000) return "high";
		if (value >= 8_000) return "elevated";
		return "normal";
	}
	if (value >= 50_000) return "critical";
	if (value >= 10_000) return "high";
	if (value >= 2_000) return "elevated";
	return "normal";
}

function ColoredMetricSignal({
	kind,
	label,
	value,
	formatted,
	description,
}: {
	kind: MetricKind;
	label: string;
	value: number | undefined;
	formatted: string;
	description: string;
}) {
	const level = metricLevel(kind, value);
	return (
		<span
			data-metric-kind={kind}
			data-metric-level={level}
			title={description}
			className={`inline-flex min-w-0 items-baseline gap-1.5 border-l-2 px-2 py-0.5 font-bold ${metricClasses[kind][level]}`}
		>
			<span className="text-[9px] font-black uppercase tracking-[0.14em] opacity-80">{label}</span>
			<span className="whitespace-nowrap text-[11px]">{formatted}</span>
		</span>
	);
}

export function TerminalToolMetrics({ metrics }: { metrics?: ToolCallMetrics }) {
	return (
		<div
			data-pibo-debug="tool-metrics"
			aria-label="Tool call metrics"
			className="ml-[1.9rem] mt-1 flex flex-wrap items-stretch gap-px border-y border-[#262626] bg-[#050505] py-px font-mono leading-[1.45] tabular-nums"
		>
			<ColoredMetricSignal
				kind="duration"
				label="Time"
				value={metrics?.durationMs}
				formatted={duration(metrics?.durationMs)}
				description="Execution time from tool start to finish; color escalates at 1, 5, and 15 seconds; — means unavailable"
			/>
			<ColoredMetricSignal
				kind="input"
				label="In"
				value={metrics?.inputTokens}
				formatted={tokens(metrics?.inputTokens)}
				description="Estimated tool-argument tokens (characters ÷ 4), not model input usage; color escalates at 8k, 20k, and 50k; — means unavailable"
			/>
			<ColoredMetricSignal
				kind="output"
				label="Out"
				value={metrics?.outputTokens}
				formatted={`${tokens(metrics?.outputTokens)} tokens`}
				description="Estimated tool-result tokens (characters ÷ 4), not model output usage or billing; color escalates at 2k, 10k, and 50k. Media and unmeasurable payloads show —."
			/>
		</div>
	);
}
