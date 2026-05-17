import { sanitizeTerminalText } from "./inkJson.js";

export type InkMarkdownOptions = {
	maxChars?: number;
	maxLines?: number;
};

export function renderInkMarkdownLines(markdown: string | undefined, _options: InkMarkdownOptions = {}): string[] {
	const sourceLines = sanitizeTerminalText(markdown ?? "").split("\n");
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
			continue;
		}
		if (!trimmed) {
			if (result.length > 0 && result[result.length - 1] !== "") result.push("");
			continue;
		}
		result.push(normalizeMarkdownLine(trimmed));
	}
	while (result[result.length - 1] === "") result.pop();
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
