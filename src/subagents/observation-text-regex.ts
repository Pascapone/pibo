import { spawnSync } from "node:child_process";

import { rgPath } from "@vscode/ripgrep";

const PIBO_AGENT_TEXT_REGEX_BATCH_BYTES = 512 * 1024;
const PIBO_AGENT_TEXT_REGEX_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export type PreparedPiboAgentObservationTextRegex = {
	pattern: string;
};

type RipgrepMatchEvent = {
	type?: string;
	data?: {
		absolute_offset?: number;
	};
};

function ripgrepErrorReason(stderr: string): string | undefined {
	const reasons = [...stderr.matchAll(/^error:\s*(.+)$/gm)];
	return reasons.at(-1)?.[1]?.trim().replace(/\.$/, "");
}

function runRipgrepTextRegex(pattern: string, input: Buffer) {
	return spawnSync(rgPath, [
		"--json",
		"--null-data",
		"--no-config",
		"--color=never",
		"--",
		pattern,
		"-",
	], {
		input,
		encoding: "utf8",
		maxBuffer: PIBO_AGENT_TEXT_REGEX_MAX_OUTPUT_BYTES,
	});
}

function throwRipgrepExecutionError(action: "validation" | "matching", error?: Error): never {
	const errorCode = error && "code" in error ? error.code : undefined;
	const detail = errorCode === "ENOBUFS"
		? "bundled rg output exceeded the observation query limit"
		: "bundled rg could not run";
	throw new Error(`Agent observation textRegex ${action} failed: ${detail}.`);
}

export function preparePiboAgentObservationTextRegex(
	pattern: string | undefined,
): PreparedPiboAgentObservationTextRegex | undefined {
	if (pattern === undefined) return undefined;
	const result = runRipgrepTextRegex(pattern, Buffer.alloc(0));
	if (result.error) throwRipgrepExecutionError("validation", result.error);
	if (result.status === 0 || result.status === 1) return { pattern };
	const reason = ripgrepErrorReason(result.stderr);
	if (reason) throw new Error(`Agent observation textRegex is invalid: ${reason}.`);
	throwRipgrepExecutionError("validation");
}

function observationIndexAtOffset(starts: readonly number[], offset: number): number | undefined {
	let low = 0;
	let high = starts.length - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (starts[middle]! <= offset) low = middle + 1;
		else high = middle - 1;
	}
	return high >= 0 ? high : undefined;
}

export function matchPiboAgentObservationTextRegex(
	prepared: PreparedPiboAgentObservationTextRegex,
	texts: readonly string[],
): boolean[] {
	const matches = texts.map(() => false);
	let batchStartIndex = 0;
	let batchTexts: string[] = [];
	let batchBytes = 0;

	function matchBatch(): void {
		if (batchTexts.length === 0) return;
		matchPiboAgentObservationTextRegexBatch(prepared, batchTexts, batchStartIndex, matches);
		batchStartIndex += batchTexts.length;
		batchTexts = [];
		batchBytes = 0;
	}

	for (const text of texts) {
		const textBytes = Buffer.byteLength(text) + 1;
		if (batchTexts.length > 0 && batchBytes + textBytes > PIBO_AGENT_TEXT_REGEX_BATCH_BYTES) matchBatch();
		batchTexts.push(text);
		batchBytes += textBytes;
	}
	matchBatch();
	return matches;
}

function matchPiboAgentObservationTextRegexBatch(
	prepared: PreparedPiboAgentObservationTextRegex,
	texts: readonly string[],
	batchStartIndex: number,
	matches: boolean[],
): void {
	const starts: number[] = [];
	const chunks: Buffer[] = [];
	let offset = 0;
	for (const text of texts) {
		starts.push(offset);
		const chunk = Buffer.from(`${text}\0`);
		chunks.push(chunk);
		offset += chunk.length;
	}

	const result = runRipgrepTextRegex(prepared.pattern, Buffer.concat(chunks, offset));
	if (result.error) throwRipgrepExecutionError("matching", result.error);
	if (result.status === 1) return;
	if (result.status !== 0) throwRipgrepExecutionError("matching");

	for (const line of result.stdout.split("\n")) {
		if (!line) continue;
		let event: RipgrepMatchEvent;
		try {
			event = JSON.parse(line) as RipgrepMatchEvent;
		} catch {
			throw new Error("Agent observation textRegex matching failed: bundled rg returned invalid output.");
		}
		if (event.type !== "match" || typeof event.data?.absolute_offset !== "number") continue;
		const index = observationIndexAtOffset(starts, event.data.absolute_offset);
		if (index !== undefined) matches[batchStartIndex + index] = true;
	}
}
