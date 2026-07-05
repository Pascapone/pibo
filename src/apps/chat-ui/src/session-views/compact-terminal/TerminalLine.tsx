import type { CompactTerminalLine, CompactTerminalRowStatus, TerminalInlineToken } from "../../../../../session-ui/terminalRows.js";
import { TerminalFunctionCall } from "./TerminalInlineJson";

type TerminalLineProps = {
	line: CompactTerminalLine;
	status: CompactTerminalRowStatus;
	clampLines?: number;
};

const MAX_TERMINAL_LINE_TOKEN_SPANS = 120;

export function TerminalLine({ line, status, clampLines }: TerminalLineProps) {
	const contentClassName = `min-w-0 whitespace-pre-wrap break-words ${clampLines ? "block overflow-hidden" : ""}`;
	const tokens = compactTerminalLineTokens(line.tokens);
	const renderPlainText = tokens.length > MAX_TERMINAL_LINE_TOKEN_SPANS;
	return (
		<div className="grid grid-cols-[1.9rem_minmax(0,1fr)] gap-2 leading-[1.45]">
			<span className={`whitespace-pre ${prefixClassName(line.prefix, status)}`}>{prefixText(line.prefix)}</span>
			<span className={contentClassName} style={clampLines ? { maxHeight: `${clampLines * 1.45}em` } : undefined}>
				{renderPlainText
					? <span className="text-[#d4d4d4]">{tokens.map((token) => token.text).join("")}</span>
					: tokens.map((token, index) => (
						<span key={`${index}:${token.text}`} className={tokenClassName(token)}>
							{token.text}
						</span>
					))}
				{line.functionCall ? <TerminalFunctionCall name={line.functionCall.name} input={line.functionCall.input} /> : null}
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
							: token.tone === "yellow"
								? "text-[#facc15]"
								: token.tone === "blue"
									? "text-[#60a5fa]"
									: token.tone === "amber"
										? "text-[#f59e0b]"
									: "text-[#d4d4d4]";
	const weightClass =
		token.weight === "bold" ? "font-bold" : token.weight === "semibold" ? "font-semibold" : "font-normal";
	const italicClass = token.italic ? "italic" : "";
	return `${toneClass} ${weightClass} ${italicClass}`.trim();
}

function compactTerminalLineTokens(tokens: readonly TerminalInlineToken[]): TerminalInlineToken[] {
	const compacted: TerminalInlineToken[] = [];
	for (const token of tokens) {
		if (!token.text) continue;
		const previous = compacted.at(-1);
		if (
			previous
			&& previous.tone === token.tone
			&& previous.weight === token.weight
			&& previous.italic === token.italic
		) {
			previous.text += token.text;
			continue;
		}
		compacted.push({ ...token });
	}
	return compacted;
}
