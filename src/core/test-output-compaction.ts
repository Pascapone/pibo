type TextContent = { type: "text"; text: string };
type ImageContent = { type: "image"; data: string; mimeType: string };

type AgentToolResultLike = {
	content?: Array<TextContent | ImageContent>;
	details?: unknown;
	terminate?: boolean;
};

type AfterToolCallContextLike = {
	toolCall?: { name?: unknown };
	args?: unknown;
	result: AgentToolResultLike;
	isError: boolean;
};

export type ToolResultCompaction = {
	content?: Array<TextContent | ImageContent>;
	details?: unknown;
	isError?: boolean;
	terminate?: boolean;
};

export type PiboBashOutputCompactionDetails = {
	kind: "validation-output";
	command: string;
	isError: boolean;
	originalLines: number;
	originalChars: number;
	displayedLines: number;
	omittedLines: number;
	fullOutput?: string;
	fullOutputPath?: string;
};

export const PIBO_BASH_OUTPUT_COMPACTION_DETAILS_KEY = "piboBashOutputCompaction";

const MAX_INLINE_FULL_OUTPUT_CHARS = 120_000;
const MAX_ERROR_CONTEXT_LINES = 120;
const ERROR_CONTEXT_RADIUS = 2;
const MIN_SUCCESS_LINES_TO_COMPACT = 12;
const COMPACTED_MARKER = "[Pibo compacted validation output]";

const VALIDATION_COMMAND_PATTERN = /(?:^|[\s;&|()])(?:(?:npm|pnpm|yarn|bun)\s+run\s+[^\s;&|()]*?(?:test|typecheck|check|lint|build)[^\s;&|()]*|(?:npm|pnpm|yarn|bun)\s+(?:test|t)\b|(?:npx\s+)?(?:vitest|jest|mocha|ava|playwright|cypress|pytest|ruff|eslint|tsc|tsc\s+--noEmit|node\s+--test|go\s+test|cargo\s+test|dotnet\s+test)\b)/i;
const ERROR_LINE_PATTERN = /(?:\b(?:FAIL|FAILED|Failing|failure|failed|ERROR|Error|error|ERR!|Exception|Traceback|AssertionError|assert|expected|received|not ok|timed out|Command exited with code)\b|[✕×✖])/;
const BENIGN_SUCCESS_LINE_PATTERN = /(?:\b(?:PASS|passed|success|successful|ok|done|completed|✓)\b)/i;

export function compactValidationToolResultForContext(
	context: AfterToolCallContextLike,
): ToolResultCompaction | undefined {
	const toolName = typeof context.toolCall?.name === "string" ? context.toolCall.name : undefined;
	if (toolName !== "bash") return undefined;

	const command = commandFromArgs(context.args);
	if (!command || !isLikelyValidationCommand(command)) return undefined;

	const output = textFromContent(context.result.content);
	if (!output || output.includes(COMPACTED_MARKER)) return undefined;

	const compaction = compactValidationOutput({ command, output, isError: context.isError });
	if (!compaction) return undefined;

	return {
		content: [{ type: "text", text: compaction.text }],
		details: mergeCompactionDetails(context.result.details, compaction.details),
		isError: context.isError,
		terminate: context.result.terminate,
	};
}

export function compactValidationOutput(input: {
	command: string;
	output: string;
	isError: boolean;
}): { text: string; details: PiboBashOutputCompactionDetails } | undefined {
	const normalizedOutput = input.output.replace(/\r\n/g, "\n").trimEnd();
	const lines = normalizedOutput.length ? normalizedOutput.split("\n") : [];
	if (!input.isError && lines.length < MIN_SUCCESS_LINES_TO_COMPACT) return undefined;

	const interestingRanges = collectInterestingRanges(lines);
	const interestingLines = rangesToLines(lines, interestingRanges, MAX_ERROR_CONTEXT_LINES);
	const displayedBody = input.isError
		? (interestingLines.length ? interestingLines : tailLines(lines, MAX_ERROR_CONTEXT_LINES))
		: interestingLines.filter((line) => !BENIGN_SUCCESS_LINE_PATTERN.test(line)).slice(0, MAX_ERROR_CONTEXT_LINES);

	const statusLine = input.isError
		? "Command failed. Showing error-looking lines only."
		: displayedBody.length
			? "Command succeeded. Successful test output hidden; showing notable lines only."
			: "Command succeeded. Successful test output hidden by default.";
	const omittedLines = Math.max(0, lines.length - displayedBody.length);
	const header = [
		COMPACTED_MARKER,
		statusLine,
		`Original output: ${lines.length} line${lines.length === 1 ? "" : "s"}, ${normalizedOutput.length} chars.`,
		omittedLines > 0 ? `Hidden: ${omittedLines} line${omittedLines === 1 ? "" : "s"}. Expand details to show full output.` : undefined,
	].filter((line): line is string => Boolean(line));

	const text = displayedBody.length
		? `${header.join("\n")}\n\n${displayedBody.join("\n")}`
		: header.join("\n");
	const fullOutputPath = extractFullOutputPath(normalizedOutput);
	const details: PiboBashOutputCompactionDetails = {
		kind: "validation-output",
		command: input.command,
		isError: input.isError,
		originalLines: lines.length,
		originalChars: normalizedOutput.length,
		displayedLines: displayedBody.length,
		omittedLines,
		fullOutput: normalizedOutput.length <= MAX_INLINE_FULL_OUTPUT_CHARS ? normalizedOutput : undefined,
		fullOutputPath,
	};
	return { text, details };
}

function commandFromArgs(args: unknown): string | undefined {
	if (!isRecord(args)) return undefined;
	const command = args.command;
	return typeof command === "string" && command.trim() ? command : undefined;
}

function isLikelyValidationCommand(command: string): boolean {
	return VALIDATION_COMMAND_PATTERN.test(command);
}

function textFromContent(content: AgentToolResultLike["content"]): string | undefined {
	if (!Array.isArray(content) || content.length === 0) return undefined;
	const parts: string[] = [];
	for (const part of content) {
		if (!part || part.type !== "text") return undefined;
		parts.push(part.text);
	}
	return parts.join("");
}

function collectInterestingRanges(lines: string[]): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (!ERROR_LINE_PATTERN.test(lines[index])) continue;
		ranges.push([
			Math.max(0, index - ERROR_CONTEXT_RADIUS),
			Math.min(lines.length - 1, index + ERROR_CONTEXT_RADIUS),
		]);
	}
	return mergeRanges(ranges);
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
	const merged: Array<[number, number]> = [];
	for (const [start, end] of ranges.sort((left, right) => left[0] - right[0])) {
		const previous = merged.at(-1);
		if (!previous || start > previous[1] + 1) {
			merged.push([start, end]);
		} else {
			previous[1] = Math.max(previous[1], end);
		}
	}
	return merged;
}

function rangesToLines(lines: string[], ranges: Array<[number, number]>, maxLines: number): string[] {
	const output: string[] = [];
	for (const [rangeIndex, [start, end]] of ranges.entries()) {
		if (output.length >= maxLines) break;
		if (rangeIndex > 0) output.push("...");
		for (let index = start; index <= end && output.length < maxLines; index += 1) {
			output.push(lines[index]);
		}
	}
	if (ranges.length > 0 && output.length >= maxLines) output.push(`... (${ranges.length} error section${ranges.length === 1 ? "" : "s"} truncated)`);
	return output;
}

function tailLines(lines: string[], maxLines: number): string[] {
	return lines.slice(Math.max(0, lines.length - maxLines));
}

function mergeCompactionDetails(originalDetails: unknown, compaction: PiboBashOutputCompactionDetails): unknown {
	if (isRecord(originalDetails)) {
		return { ...originalDetails, [PIBO_BASH_OUTPUT_COMPACTION_DETAILS_KEY]: compaction };
	}
	return {
		[PIBO_BASH_OUTPUT_COMPACTION_DETAILS_KEY]: compaction,
		...(originalDetails === undefined ? {} : { originalDetails }),
	};
}

function extractFullOutputPath(output: string): string | undefined {
	const match = output.match(/Full output:\s*([^\]\n]+)/);
	return match?.[1]?.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
