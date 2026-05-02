import { JsonRenderer } from "../../tracing/JsonRenderer";
import type { CompactTerminalRow } from "./terminalRows";
import { renderableTerminalValue } from "./terminalValue";

type TerminalDetailsProps = {
	row: CompactTerminalRow;
	onOpenSession: (piboSessionId: string) => void;
};

export function TerminalDetails({ row, onOpenSession }: TerminalDetailsProps) {
	return (
		<div className="mt-2 border border-[#2a2a2a] bg-[#111111] px-3 py-2 text-[12px] text-[#d4d4d4]">
			{row.detailItems?.length ? (
				<div className="space-y-3">
					{row.detailItems.map((item) => (
						<div key={item.id} className="space-y-2">
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
							<DetailPayload label="Input" value={item.input} />
							<DetailPayload label="Output" value={item.output} />
							{item.error ? <DetailText label="Error" value={item.error} tone="red" /> : null}
						</div>
					))}
				</div>
			) : (
				<div className="space-y-3">
					<DetailPayload label="Input" value={row.input} />
					<DetailPayload label="Output" value={row.output} />
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

function DetailJson({ label, value, meta }: { label: string; value: unknown; meta?: string }) {
	return (
		<div className="space-y-1">
			<div className="space-y-0.5">
				<div className="text-[11px] font-semibold text-[#737373]">{label}</div>
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
		<div className="space-y-1">
			<div className="text-[11px] font-semibold text-[#737373]">{label}</div>
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
