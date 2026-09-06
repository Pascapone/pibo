import type { ToolCallMetrics } from "../../../../../shared/tool-call-metrics.js";

const tokenFormatter = new Intl.NumberFormat("en-US");

function tokens(value: number | undefined): string {
	return value === undefined || !Number.isFinite(value) || value < 0 ? "—" : `≈${tokenFormatter.format(Math.round(value))}`;
}

function duration(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
	if (value < 1000) return `${Math.round(value)} ms`;
	if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
	return `${Math.floor(value / 60_000)}m ${Math.floor(value % 60_000 / 1000)}s`;
}

export function TerminalToolMetrics({ metrics }: { metrics?: ToolCallMetrics }) {
	return (
		<div
			data-pibo-debug="tool-metrics"
			aria-label="Tool call metrics"
			className="ml-[1.9rem] mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-[#2a2a2a] pt-0.5 font-mono text-[11px] leading-[1.45] text-[#a3a3a3] tabular-nums"
		>
			<span title="Execution time from tool start to finish; — means unavailable">Time {duration(metrics?.durationMs)}</span>
			<span title="Estimated tool-argument tokens (characters ÷ 4), not model input usage; — means unavailable">In {tokens(metrics?.inputTokens)}</span>
			<span className="text-[#d4d4d4]" title="Estimated tool-result tokens (characters ÷ 4), not model output usage or billing. Media and unmeasurable payloads show —.">Out {tokens(metrics?.outputTokens)} tokens</span>
		</div>
	);
}
