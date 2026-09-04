import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PIBO_AGENT_TEXT_REGEX_BATCH_MAX_ITEMS = 128;
export const PIBO_AGENT_TEXT_REGEX_BATCH_TARGET_BYTES = 64 * 1024;
const PIBO_AGENT_TEXT_REGEX_MAX_OUTPUT_BYTES = 64 * 1024;
const requireFromHere = createRequire(import.meta.url);

export type PreparedPiboAgentObservationTextRegex = {
	pattern: string;
	rgPath: string;
};

function escapedNulIndex(pattern: string): number | undefined {
	for (let index = 0; index < pattern.length; index += 1) {
		if (pattern[index] !== "\\") continue;
		let slashEnd = index;
		while (pattern[slashEnd + 1] === "\\") slashEnd += 1;
		const slashCount = slashEnd - index + 1;
		if (slashCount % 2 === 1) {
			const remainder = pattern.slice(slashEnd + 1);
			if (/^(?:x00|x\{0+\}|u\{0+\})/i.test(remainder)) return index;
		}
		index = slashEnd;
	}
	return undefined;
}

function assertSupportedNulPattern(pattern: string): void {
	if (pattern.includes("\0") || escapedNulIndex(pattern) !== undefined) {
		throw new Error("Agent observation textRegex is invalid: matching NUL bytes is not supported.");
	}
}

function resolvePiboAgentObservationRipgrepPath(): string {
	const arch = process.env.npm_config_arch || process.arch;
	const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
	const platformPackage = `@vscode/ripgrep-${process.platform}-${arch}`;
	try {
		const wrapperPath = requireFromHere.resolve("@vscode/ripgrep");
		return createRequire(wrapperPath).resolve(`${platformPackage}/bin/${binaryName}`);
	} catch {
		throw new Error(
			`Agent observation textRegex is unavailable: ${platformPackage} is not installed for this platform.`,
		);
	}
}

function ripgrepErrorReason(stderr: string): string | undefined {
	if (stderr.includes("pattern contains \"\\0\"")) return "matching NUL bytes is not supported";
	const reasons = [...stderr.matchAll(/^error:\s*(.+)$/gm)];
	return reasons.at(-1)?.[1]?.trim().replace(/\.$/, "");
}

function runRipgrepTextRegex(
	prepared: PreparedPiboAgentObservationTextRegex,
	args: string[],
	options: { cwd?: string; input?: string } = {},
) {
	return spawnSync(prepared.rgPath, [
		"--no-config",
		"--color=never",
		"--null-data",
		...args,
	], {
		...options,
		encoding: "utf8",
		maxBuffer: PIBO_AGENT_TEXT_REGEX_MAX_OUTPUT_BYTES,
	});
}

function throwRipgrepExecutionError(action: "validation" | "matching", error?: Error): never {
	const errorCode = error && "code" in error ? error.code : undefined;
	if (errorCode === "ENOENT" || errorCode === "EACCES") {
		throw new Error("Agent observation textRegex is unavailable: bundled rg could not be executed.");
	}
	const detail = errorCode === "ENOBUFS"
		? "bundled rg output exceeded the bounded observation batch limit"
		: "bundled rg could not run";
	throw new Error(`Agent observation textRegex ${action} failed: ${detail}.`);
}

export function preparePiboAgentObservationTextRegex(
	pattern: string | undefined,
): PreparedPiboAgentObservationTextRegex | undefined {
	if (pattern === undefined) return undefined;
	assertSupportedNulPattern(pattern);
	const prepared = { pattern, rgPath: resolvePiboAgentObservationRipgrepPath() };
	const result = runRipgrepTextRegex(prepared, ["--quiet", "--", pattern, "-"], { input: "" });
	if (result.error) throwRipgrepExecutionError("validation", result.error);
	if (result.status === 0 || result.status === 1) return prepared;
	const reason = ripgrepErrorReason(result.stderr);
	if (reason) throw new Error(`Agent observation textRegex is invalid: ${reason}.`);
	throwRipgrepExecutionError("validation");
}

export function matchPiboAgentObservationTextRegex(
	prepared: PreparedPiboAgentObservationTextRegex,
	texts: readonly string[],
): boolean[] {
	for (const text of texts) {
		if (text.includes("\0")) {
			throw new Error("Agent observation textRegex cannot match observation text containing NUL bytes.");
		}
	}
	if (texts.length === 0) return [];

	// One private file per observation preserves record boundaries. --files-with-matches
	// emits each fixed filename at most once, so output cannot grow with submatch count.
	const directory = mkdtempSync(join(tmpdir(), "pibo-agent-observe-regex-"));
	const filenames = texts.map((_, index) => index.toString().padStart(6, "0"));
	try {
		for (let index = 0; index < texts.length; index += 1) {
			writeFileSync(join(directory, filenames[index]!), texts[index]!, {
				encoding: "utf8",
				flag: "wx",
				mode: 0o600,
			});
		}
		const result = runRipgrepTextRegex(
			prepared,
			["--files-with-matches", "--null", "--", prepared.pattern, ...filenames],
			{ cwd: directory },
		);
		if (result.error) throwRipgrepExecutionError("matching", result.error);
		if (result.status === 1) return texts.map(() => false);
		if (result.status !== 0) {
			const reason = ripgrepErrorReason(result.stderr);
			if (reason) throw new Error(`Agent observation textRegex is invalid: ${reason}.`);
			throwRipgrepExecutionError("matching");
		}
		const matched = new Set(result.stdout.split("\0").filter(Boolean));
		return filenames.map((filename) => matched.has(filename));
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
