import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { JsonRenderer } from "../../tracing/JsonRenderer";
import type { CompactTerminalRow, CompactTerminalToolCallReference } from "../../../../../session-ui/terminalRows.js";
import { renderableTerminalValue } from "../../../../../session-ui/terminalValue.js";
import { getTracePayload } from "../../api-trace-signals";
import { copyTextToClipboard } from "../../clipboard";
import { buildToolCallReferenceUrl, formatToolCallReference } from "../../tool-call-reference";
import type { TracePayloadRef } from "../../types";

type TerminalDetailsProps = {
	row: CompactTerminalRow;
	piboSessionId: string;
	targetToolCallNodeId?: string;
	onOpenSession: (piboSessionId: string) => void;
};

export function TerminalDetails({ row, piboSessionId, targetToolCallNodeId, onOpenSession }: TerminalDetailsProps) {
	return (
		<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]" data-shared-terminal-details={row.kind}>
			{row.detailItems?.length ? (
				<div className="space-y-3">
					{row.detailItems.map((item) => (
						<div
							key={item.id}
							className={`space-y-2 ${item.toolCallReference?.traceNodeId === targetToolCallNodeId ? "border-l-2 border-[#38bdf8] pl-2" : ""}`}
							data-pibo-tool-call-target={item.toolCallReference?.traceNodeId === targetToolCallNodeId ? "true" : undefined}
						>
							<div className="flex items-center gap-2 text-[11px]">
								<span className="font-semibold text-[#d4d4d4]">{item.label}</span>
								{item.linkedPiboSessionId ? (
									<button
										type="button"
										onClick={() => onOpenSession(item.linkedPiboSessionId!)}
										className="border border-[#3a3a3a] px-2 py-0.5 text-[#38bdf8] hover:border-[#38bdf8]"
									>
										Open Session
									</button>
								) : null}
							</div>
							<ToolCallReferenceDetails piboSessionId={piboSessionId} reference={item.toolCallReference} />
							<DetailPayload label="Input" value={item.input} />
							<DetailPayload label="Output" value={item.output} />
							<PayloadRefs refs={item.payloadRefs} />
							<CompactedOutputDisclosure value={item.output} />
							{item.error ? <DetailText label="Error" value={item.error} tone="red" /> : null}
						</div>
					))}
				</div>
			) : (
				<div
					className={`space-y-3 ${row.toolCallReference?.traceNodeId === targetToolCallNodeId ? "border-l-2 border-[#38bdf8] pl-2" : ""}`}
					data-pibo-tool-call-target={row.toolCallReference?.traceNodeId === targetToolCallNodeId ? "true" : undefined}
				>
					<ToolCallReferenceDetails piboSessionId={piboSessionId} reference={row.toolCallReference} />
					<DetailPayload label="Input" value={row.input} />
					<DetailPayload label="Output" value={row.output} />
					<PayloadRefs refs={row.payloadRefs} />
					<CompactedOutputDisclosure value={row.output} />
					{row.error ? <DetailText label="Error" value={row.error} tone="red" /> : null}
					{row.linkedPiboSessionId ? (
						<div className="flex items-center gap-2 text-[11px]">
							<span className="text-[#737373]">Child session</span>
							<button
								type="button"
								onClick={() => onOpenSession(row.linkedPiboSessionId!)}
								className="border border-[#3a3a3a] px-2 py-0.5 text-[#38bdf8] hover:border-[#38bdf8]"
							>
								{row.linkedPiboSessionId}
							</button>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}

function ToolCallReferenceDetails({
	piboSessionId,
	reference,
}: {
	piboSessionId: string;
	reference?: CompactTerminalToolCallReference;
}) {
	const [copied, setCopied] = useState(false);
	if (!reference) return null;

	const copyReference = async () => {
		try {
			const url = buildToolCallReferenceUrl(window.location.href, piboSessionId, reference);
			await copyTextToClipboard(formatToolCallReference(piboSessionId, reference, url));
			setCopied(true);
		} catch {
			setCopied(false);
		}
	};

	return (
		<div className="space-y-1 border border-[#2a2a2a] bg-[#0b0b0b] p-2" data-pibo-tool-call-reference={reference.traceNodeId}>
			<div className="flex items-center justify-between gap-2">
				<div className="text-[11px] font-semibold text-[#737373]">Tool Call Reference</div>
				<button
					type="button"
					onClick={() => void copyReference()}
					title={copied ? "Copied Tool Call Reference" : "Copy Tool Call Reference"}
					aria-label={copied ? "Copied Tool Call Reference" : "Copy Tool Call Reference"}
					className="inline-flex h-6 w-6 shrink-0 items-center justify-center border border-[#3a3a3a] text-[#a3a3a3] transition-colors hover:border-[#38bdf8] hover:text-[#38bdf8]"
				>
					{copied ? <Check size={12} /> : <Copy size={12} />}
				</button>
			</div>
			<div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 font-mono text-[11px]">
				<span className="text-[#737373]">Tool Call ID</span>
				<code className="min-w-0 break-all text-[#d4d4d4]">{reference.toolCallId}</code>
				<span className="text-[#737373]">Reference</span>
				<code className="min-w-0 break-all text-[#38bdf8]">{piboSessionId} / {reference.traceNodeId}</code>
			</div>
		</div>
	);
}

function PayloadRefs({ refs }: { refs?: CompactTerminalRow["payloadRefs"] }) {
	if (!refs) return null;
	const entries = Object.entries(refs).filter((entry): entry is [string, TracePayloadRef] => Boolean(entry[1]));
	if (!entries.length) return null;
	return (
		<div className="space-y-2">
			{entries.map(([kind, ref]) => (
				<PayloadRefDetail key={`${kind}:${ref.ref}`} kind={kind} refInfo={ref} />
			))}
		</div>
	);
}

// Keep text shaping bounded even for long, unbroken multibyte output.
const PAYLOAD_READER_SECTION_BYTES = 4 * 1024;

function PayloadRefDetail({ kind, refInfo }: { kind: string; refInfo: TracePayloadRef }) {
	const generation = useRef(0);
	const pending = useRef(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [loadError, setLoadError] = useState<string>();
	const [state, setState] = useState<
		| { status: "loading" }
		| { status: "loaded"; data: string; offset: number; previous: number[]; hasMore: boolean; nextOffset?: number }
		| { status: "error"; message: string }
	>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		generation.current++;
		pending.current = false;
		setLoadingMore(false);
		setLoadError(undefined);
		setState({ status: "loading" });
		getTracePayload(refInfo.ref, { offset: 0, limit: PAYLOAD_READER_SECTION_BYTES })
			.then((chunk) => {
				if (cancelled) return;
				setState({ status: "loaded", data: chunk.data, offset: 0, previous: [], hasMore: chunk.hasMore, nextOffset: chunk.nextOffset });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
			});
		return () => {
			cancelled = true;
			generation.current++;
		};
	}, [refInfo.ref]);

	async function loadSection(back = false) {
		if (pending.current || state.status !== "loaded") return;
		const offset = back ? state.previous.at(-1) : state.nextOffset;
		if (offset === undefined) return;
		pending.current = true; setLoadingMore(true); setLoadError(undefined);
		const current = generation.current;
		try {
			const chunk = await getTracePayload(refInfo.ref, { offset, limit: PAYLOAD_READER_SECTION_BYTES });
			if (current !== generation.current) return;
			setState({ status: "loaded", data: chunk.data, offset, previous: back ? state.previous.slice(0, -1) : [...state.previous, state.offset], hasMore: chunk.hasMore, nextOffset: chunk.nextOffset });
		} catch (error) {
			if (current === generation.current) setLoadError(error instanceof Error ? error.message : String(error));
		} finally {
			if (current === generation.current) { pending.current = false; setLoadingMore(false); }
		}
	}

	return (
		<div className="space-y-1" data-shared-terminal-payload-ref={kind}>
			<div className="text-[11px] font-semibold text-[#737373]">
				{kind} payload ({Math.ceil(refInfo.byteLength / 1024)} KB)
			</div>
			{state.status === "loading" ? (
				<div className="border border-[#2a2a2a] bg-[#0b0b0b] p-2 text-[12px] text-[#737373]">Loading payload preview...</div>
			) : state.status === "error" ? (
				<div className="border border-[#2a2a2a] bg-[#0b0b0b] p-2 text-[12px] text-[#ef4444]">{state.message}</div>
			) : (
				<div className="space-y-1">
					<pre key={state.offset} className="m-0 max-h-[520px] overflow-auto whitespace-pre-wrap break-words border border-[#2a2a2a] bg-[#0b0b0b] p-2 font-mono text-[12px] leading-[1.45] text-[#d4d4d4]">
						{state.data}
					</pre>
					{loadError ? <div role="alert" className="text-[12px] text-[#ef4444]">{loadError}</div> : null}
					<div className="flex items-center gap-2 text-[12px]">
						<span>Section {state.previous.length + 1}</span>
						<button type="button" disabled={loadingMore || !state.previous.length} onClick={() => void loadSection(true)} className="border border-[#2a2a2a] px-2 py-1 text-[#38bdf8] disabled:opacity-50">Previous section</button>
						<a href={`/api/chat/trace/payload/${encodeURIComponent(refInfo.ref)}?download=1`} download className="text-[#38bdf8] underline">Download full content</a>
					</div>
					{state.hasMore ? (
						<button type="button" disabled={loadingMore} onClick={() => void loadSection()} className="border border-[#2a2a2a] px-2 py-1 text-[12px] text-[#38bdf8] disabled:opacity-50">
							{loadingMore ? "Loading…" : "Next section"}
						</button>
					) : null}
				</div>
			)}
		</div>
	);
}

function DetailPayload({ label, value }: { label: string; value: unknown }) {
	const renderable = renderableTerminalValue(value);
	if (renderable.kind === "empty") return null;
	if (renderable.kind === "text") {
		const parsed = parseJsonDetailText(renderable.text);
		if (parsed?.kind === "json") return <DetailJson label={label} value={parsed.value} meta={parsed.meta} />;
		if (parsed?.kind === "text") return <DetailText label={label} value={parsed.text} />;
		return <DetailText label={label} value={renderable.text} />;
	}
	return <DetailJson label={label} value={renderable.value} />;
}

function CompactedOutputDisclosure({ value }: { value: unknown }) {
	const details = compactedOutputDetails(value);
	if (!details) return null;
	return (
		<details className="space-y-1 border border-[#2a2a2a] bg-[#0b0b0b] p-2">
			<summary className="cursor-pointer text-[11px] font-semibold text-[#38bdf8]">
				Show full output ({details.originalLines} lines)
			</summary>
			{details.fullOutput ? (
				<pre className="mt-2 max-h-[520px] overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.45] text-[#d4d4d4]">
					{details.fullOutput}
				</pre>
			) : details.fullOutputPath ? (
				<div className="mt-2 min-w-0 break-words font-mono text-[12px] text-[#d4d4d4]">
					Full output file: {details.fullOutputPath}
				</div>
			) : null}
		</details>
	);
}

function compactedOutputDetails(value: unknown): CompactedOutputDetails | undefined {
	if (!isRecord(value)) return undefined;
	const details = isRecord(value.details) ? value.details.piboBashOutputCompaction : undefined;
	if (!isRecord(details) || details.kind !== "validation-output") return undefined;
	const originalLines = typeof details.originalLines === "number" ? details.originalLines : undefined;
	if (originalLines === undefined) return undefined;
	return {
		originalLines,
		fullOutput: typeof details.fullOutput === "string" ? details.fullOutput : undefined,
		fullOutputPath: typeof details.fullOutputPath === "string" ? details.fullOutputPath : undefined,
	};
}

type CompactedOutputDetails = {
	originalLines: number;
	fullOutput?: string;
	fullOutputPath?: string;
};

function DetailJson({ label, value, meta }: { label: string; value: unknown; meta?: string }) {
	return (
		<div className="space-y-1" data-shared-terminal-detail-json={label}>
			<div className="space-y-0.5">
				<div className="text-[11px] font-semibold text-[#737373]" data-shared-terminal-detail-label={label}>{label}</div>
				{meta ? <div className="min-w-0 break-words text-[11px] text-[#737373]">Status: {meta}</div> : null}
			</div>
			<div className="compact-terminal-json border border-[#2a2a2a] bg-[#0b0b0b] p-2">
				<JsonRenderer value={value} showControls={false} />
			</div>
		</div>
	);
}

function DetailText({
	label,
	value,
	tone = "default",
}: {
	label: string;
	value: string;
	tone?: "default" | "red";
}) {
	return (
		<div className="space-y-1" data-shared-terminal-detail-text={label}>
			<div className="text-[11px] font-semibold text-[#737373]" data-shared-terminal-detail-label={label}>{label}</div>
			<pre
				className={`m-0 whitespace-pre-wrap break-words border border-[#2a2a2a] bg-[#0b0b0b] p-2 font-mono text-[12px] leading-[1.45] ${
					tone === "red" ? "text-[#ef4444]" : "text-[#d4d4d4]"
				}`}
			>
				{value}
			</pre>
		</div>
	);
}

type ParsedDetailText =
	| { kind: "json"; value: unknown; meta?: string }
	| { kind: "text"; text: string };

function parseJsonDetailText(value: string): ParsedDetailText | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	const direct = parseJsonValue(trimmed);
	if (direct !== undefined) return normalizeParsedJsonValue(direct);

	const lines = trimmed.split(/\r?\n/);
	for (let index = 1; index < lines.length; index += 1) {
		const candidate = lines.slice(index).join("\n").trim();
		if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
		const parsed = parseJsonValue(candidate);
		if (parsed === undefined) continue;
		const meta = lines.slice(0, index).join(" ").trim();
		return normalizeParsedJsonValue(parsed, meta || undefined);
	}
	return undefined;
}

function normalizeParsedJsonValue(value: unknown, meta?: string): ParsedDetailText {
	const renderable = renderableTerminalValue(value);
	if (renderable.kind === "text") {
		const nested = parseJsonDetailText(renderable.text);
		if (nested?.kind === "json") return { ...nested, meta: nested.meta ?? meta };
		return { kind: "text", text: renderable.text };
	}
	return { kind: "json", value, meta };
}

function parseJsonValue(value: string): unknown | undefined {
	if (!value.startsWith("{") && !value.startsWith("[")) return undefined;
	try {
		const parsed = JSON.parse(value) as unknown;
		return parsed !== null && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
