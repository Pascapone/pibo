import { createHash } from "node:crypto";
import {
	createReadToolDefinition,
	type ReadToolDetails,
	type ReadToolInput,
} from "@earendil-works/pi-coding-agent";
import type { ToolProfileRegistration } from "../core/profiles.js";

export const HASHLINE_TOOL_NAME = "hashline";
export const HASHLINE_REPLACED_BUILTIN_TOOLS = ["read"] as const;

const HASH_ALPHABET = "ZPMQVRWSNKTXJBYH";
const CONTINUATION_NOTICE_RE = /\n\n(\[(?:Showing lines \d+-\d+ of \d+(?: \([^)]+ limit\))?\. Use offset=\d+ to continue\.|\d+ more lines in file\. Use offset=\d+ to continue\.)\])$/;

export function hashLineContent(line: string): string {
	const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
	const byte = createHash("sha256").update(normalized, "utf8").digest()[0]!;
	return `${HASH_ALPHABET[(byte >>> 4) & 0x0f]}${HASH_ALPHABET[byte & 0x0f]}`;
}

export function formatHashlineReadText(
	text: string,
	offset = 1,
	details?: ReadToolDetails,
): string {
	if (details?.truncation?.firstLineExceedsLimit || text.startsWith("Read image file [")) return text;
	if (text.length === 0) return "File is empty.";

	const continuation = text.match(CONTINUATION_NOTICE_RE);
	const body = continuation ? text.slice(0, -continuation[0].length) : text;
	const notice = continuation?.[1];
	const lines = body.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
	const firstLine = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 1;
	const width = String(firstLine + lines.length - 1).length;
	const formatted = lines.map((line, index) => {
		const lineNumber = String(firstLine + index).padStart(width, " ");
		return `${lineNumber}#${hashLineContent(line)}:${line}`;
	}).join("\n");

	return notice ? `${formatted}\n\n${notice}` : formatted;
}

export function createHashlineToolDefinition(cwd: string) {
	const read = createReadToolDefinition(cwd);
	return {
		...read,
		name: HASHLINE_TOOL_NAME,
		label: HASHLINE_TOOL_NAME,
		description: "Read workspace files with short content hashes on every text line. Text output uses LINE#HASH:CONTENT anchors; images remain attachments. Use offset and limit for large files.",
		promptSnippet: "Read file contents with LINE#HASH anchors",
		promptGuidelines: [
			"Use hashline instead of read, cat, or sed when examining files.",
			"Treat the LINE#HASH prefix as metadata; the text after the first colon is the file content.",
		],
		async execute(
			toolCallId: string,
			input: ReadToolInput,
			signal: AbortSignal | undefined,
			onUpdate: Parameters<typeof read.execute>[3],
			context: Parameters<typeof read.execute>[4],
		) {
			const result = await read.execute(toolCallId, input, signal, onUpdate, context);
			if (result.content.some((item) => item.type === "image")) return result;
			return {
				...result,
				content: result.content.map((item) => item.type === "text"
					? { ...item, text: formatHashlineReadText(item.text, input.offset, result.details) }
					: item),
			};
		},
	};
}

export function createHashlineToolProfile(): ToolProfileRegistration {
	return {
		name: HASHLINE_TOOL_NAME,
		description: "Pi-only read replacement that prefixes every text line with a short content hash.",
		yieldable: false,
		replacesBuiltinTools: HASHLINE_REPLACED_BUILTIN_TOOLS,
		createDefinition(context) {
			return createHashlineToolDefinition(context.cwd ?? process.cwd());
		},
	};
}
