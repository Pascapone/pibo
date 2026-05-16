import { sanitizeTerminalText, truncateTerminalText } from "./inkJson.js";

export type InkMarkdownOptions = {
	maxChars?: number;
	maxLines?: number;
};

const DEFAULT_MAX_CHARS = 3000;
const DEFAULT_MAX_LINES = 80;

export function renderInkMarkdownLines(markdown: string | undefined, options: InkMarkdownOptions = {}): string[] {
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const bounded = truncateTerminalText(markdown ?? "", maxChars);
	const sourceLines = sanitizeTerminalText(bounded).split("\n");
	const result: string[] = [];
	let inCodeFence = false;
	for (const sourceLine of sourceLines) {
		const trimmed = sourceLine.trim();
		if (/^```/.test(trimmed)) {
			inCodeFence = !inCodeFence;
			continue;
		}
		if (inCodeFence) {
			result.push(`    ${sourceLine.replace(/\t/g, "    ")}`.trimEnd());
			if (result.length >= maxLines) break;
			continue;
		}
		if (!trimmed) {
			if (result.length > 0 && result[result.length - 1] !== "") result.push("");
			if (result.length >= maxLines) break;
			continue;
		}
		result.push(normalizeMarkdownLine(trimmed));
		if (result.length >= maxLines) break;
	}
	while (result[result.length - 1] === "") result.pop();
	if (sourceLines.length > maxLines || bounded.includes("… truncated")) {
		if (result[result.length - 1] !== "… truncated") result.push("… truncated");
	}
	return result.length > 0 ? result : [""];
}

function normalizeMarkdownLine(line: string): string {
	const heading = line.match(/^#{1,6}\s+(.*)$/);
	if (heading) return stripInlineMarkdown(heading[1] ?? "");
	const unordered = line.match(/^[-*+]\s+(.*)$/);
	if (unordered) return `- ${stripInlineMarkdown(unordered[1] ?? "")}`;
	const ordered = line.match(/^\d+[.)]\s+(.*)$/);
	if (ordered) return `- ${stripInlineMarkdown(ordered[1] ?? "")}`;
	const quote = line.match(/^>\s?(.*)$/);
	if (quote) return `> ${stripInlineMarkdown(quote[1] ?? "")}`;
	return stripInlineMarkdown(line);
}

function stripInlineMarkdown(line: string): string {
	return line
		.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/__([^_]+)__/g, "$1")
		.replace(/\*([^*]+)\*/g, "$1")
		.replace(/_([^_]+)_/g, "$1")
		.replace(/<[^>]+>/g, "")
		.trimEnd();
}
