import { useState } from "react";
import { FileArchive, FileText } from "lucide-react";
import type { CompactTerminalRow } from "../../../../../session-ui/terminalRows.js";
import { getTracePayload } from "../../api-trace-signals";
import { MarkdownRenderer } from "../../tracing/MarkdownRenderer";

type SummaryState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "loaded"; markdown: string }
	| { status: "error"; message: string };

const numberFormatter = new Intl.NumberFormat("en-US");

export function TerminalCompactionCard({ row }: { row: CompactTerminalRow }) {
	const stats = row.compactionStats;
	const outputPayloadRef = row.payloadRefs?.output;
	const [summaryState, setSummaryState] = useState<SummaryState>({ status: "idle" });
	const inlineMarkdown = row.compactionMarkdown;
	const loadedMarkdown = summaryState.status === "loaded" ? summaryState.markdown : undefined;
	const markdown = inlineMarkdown ?? loadedMarkdown;
	const unavailableMessage = compactionTextUnavailableMessage(row);

	const loadSummary = () => {
		if (inlineMarkdown || !outputPayloadRef || summaryState.status !== "idle") return;
		setSummaryState({ status: "loading" });
		getTracePayload(outputPayloadRef.ref, { offset: 0, limit: 1024 * 1024 })
			.then((chunk) => {
				const summary = compactionSummaryFromPayload(chunk.data);
				setSummaryState(summary
					? { status: "loaded", markdown: summary }
					: { status: "error", message: unavailableMessage });
			})
			.catch((error: unknown) => {
				setSummaryState({ status: "error", message: error instanceof Error ? error.message : String(error) });
			});
	};

	return (
		<div data-pibo-component="TerminalCompactionCard" className="min-w-0">
			<div className="grid grid-cols-[1rem_minmax(0,1fr)] whitespace-pre-wrap break-words">
				<span className="flex items-center text-[#22c55e]"><FileArchive size={13} strokeWidth={1.8} aria-hidden="true" /></span>
				<span className="font-semibold text-[#22c55e]">Compacted</span>
			</div>
			<div
				className="ml-4 mt-2 grid gap-px border-y border-[#262626] bg-[#050505] sm:grid-cols-3"
				aria-label="Compaction statistics"
				data-pibo-debug="compaction-stats"
			>
				<CompactionMetric label="Tool calls" value={formatCount(stats?.toolCallCount)} />
				<CompactionMetric
					label="Peak tool output"
					value={formatTokens(stats?.maxToolOutputTokens, stats?.maxToolOutputTokenBasis)}
				/>
				<CompactionMetric label="Compaction tokens" value={formatCount(stats?.compactionTokens)} />
			</div>
			<details
				className="ml-4 mt-2 border border-[#2a2a2a] bg-[#111111]"
				onToggle={(event) => {
					if (event.currentTarget.open) loadSummary();
				}}
			>
				<summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[11px] font-semibold text-[#38bdf8] marker:hidden">
					<FileText size={13} aria-hidden="true" />
					Compaction text
				</summary>
				<div className="border-t border-[#2a2a2a] px-3 py-2">
					{markdown ? (
						<div className="compact-terminal-markdown" data-pibo-component="MarkdownRendererHost" data-pibo-markdown-kind="compaction">
							<MarkdownRenderer>{markdown}</MarkdownRenderer>
						</div>
					) : summaryState.status === "loading" ? (
						<div className="text-[11px] text-[#737373]" role="status">Loading compaction text…</div>
					) : (
						<div className="text-[11px] text-[#737373]">{summaryState.status === "error" ? summaryState.message : unavailableMessage}</div>
					)}
				</div>
			</details>
		</div>
	);
}

function compactionTextUnavailableMessage(row: CompactTerminalRow): string {
	if (isRecord(row.input) && row.input.reason === "codex_context_compaction") {
		return "Codex did not provide compaction text.";
	}
	return "Compaction text is unavailable.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function CompactionMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0 border-l-2 border-[#38bdf8] bg-[#38bdf8]/10 px-2 py-1 font-mono tabular-nums text-[#bae6fd]">
			<div className="text-[9px] font-black uppercase tracking-[0.14em] opacity-80">{label}</div>
			<div className="mt-0.5 whitespace-nowrap text-[11px] font-bold">{value}</div>
		</div>
	);
}

function formatCount(value: number | undefined): string {
	return value === undefined || !Number.isFinite(value) || value < 0 ? "—" : numberFormatter.format(Math.round(value));
}

function formatTokens(value: number | undefined, basis: string | undefined): string {
	if (value === undefined || !Number.isFinite(value) || value < 0) return "— tokens";
	const prefix = basis?.startsWith("tiktoken/") ? "" : "≈";
	return `${prefix}${numberFormatter.format(Math.round(value))} tokens`;
}

function compactionSummaryFromPayload(value: string): string | undefined {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const summary = (parsed as Record<string, unknown>).summary;
		return typeof summary === "string" && summary.trim() ? summary : undefined;
	} catch {
		return undefined;
	}
}
