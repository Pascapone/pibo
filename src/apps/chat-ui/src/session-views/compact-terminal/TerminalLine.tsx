import type { CompactTerminalLine, CompactTerminalRowStatus, TerminalInlineToken } from "./terminalRows";

type TerminalLineProps = {
	line: CompactTerminalLine;
	status: CompactTerminalRowStatus;
};

export function TerminalLine({ line, status }: TerminalLineProps) {
	return (
		<div className="grid grid-cols-[1.9rem_minmax(0,1fr)] gap-2 leading-[1.45]">
			<span className={`whitespace-pre ${prefixClassName(line.prefix, status)}`}>{prefixText(line.prefix)}</span>
			<span className="min-w-0 whitespace-pre-wrap break-words">
				{line.tokens.map((token, index) => (
					<span key={`${index}:${token.text}`} className={tokenClassName(token)}>
						{token.text}
					</span>
				))}
			</span>
		</div>
	);
}

function prefixText(prefix: CompactTerminalLine["prefix"] = "none"): string {
	switch (prefix) {
		case "bullet":
			return "•";
		case "detail":
			return "└";
		case "continuation":
			return " ";
		case "prompt":
			return "›";
		case "none":
		default:
			return " ";
	}
}

function prefixClassName(prefix: CompactTerminalLine["prefix"] = "none", status: CompactTerminalRowStatus): string {
	if (prefix === "bullet") {
		if (status === "running") return "text-[#38bdf8]";
		if (status === "error") return "text-[#ef4444]";
		if (status === "done") return "text-[#22c55e]";
	}
	if (prefix === "prompt") return "text-[#737373]";
	return "text-[#737373]";
}

function tokenClassName(token: TerminalInlineToken): string {
	const toneClass =
		token.tone === "dim"
			? "text-[#737373]"
			: token.tone === "cyan"
				? "text-[#38bdf8]"
				: token.tone === "green"
					? "text-[#22c55e]"
					: token.tone === "red"
						? "text-[#ef4444]"
						: token.tone === "magenta"
							? "text-[#d946ef]"
							: "text-[#d4d4d4]";
	const weightClass =
		token.weight === "bold" ? "font-bold" : token.weight === "semibold" ? "font-semibold" : "font-normal";
	const italicClass = token.italic ? "italic" : "";
	return `${toneClass} ${weightClass} ${italicClass}`.trim();
}
