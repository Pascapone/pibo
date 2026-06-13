/**
 * Detection of the VS Code CLI binary and wrapper around it.
 *
 * The `code` binary is what VS Code installs on `$PATH` when the user enables
 * "Shell Command: Install 'code' command in PATH" from the VS Code command
 * palette. It is the only supported way for `pibo vscode install` to install
 * the extension. If no supported binary is on `$PATH`, install fails with a
 * clear error pointing at https://code.visualstudio.com/.
 */

import { spawn as defaultSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { SpawnLike } from "./types.js";

export const SUPPORTED_CODE_BINARIES = ["code", "code-insiders", "codium"] as const;

export type SupportedCodeBinary = (typeof SUPPORTED_CODE_BINARIES)[number];

export type ResolvedCodeBinary = {
	binary: SupportedCodeBinary;
	path: string;
};

function splitPathEnv(pathValue: string | undefined): string[] {
	if (!pathValue) return [];
	return pathValue.split(delimiter).filter((entry) => entry.length > 0);
}

function firstExisting(candidates: string[]): string | undefined {
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

export function detectCodeBinary(options: { env?: NodeJS.ProcessEnv; path?: string } = {}): ResolvedCodeBinary | undefined {
	const pathValue = options.path ?? options.env?.PATH ?? process.env.PATH ?? "";
	const directories = splitPathEnv(pathValue);
	for (const binary of SUPPORTED_CODE_BINARIES) {
		const candidates = directories.map((dir) => join(dir, binary));
		const found = firstExisting(candidates);
		if (found) return { binary, path: found };
	}
	return undefined;
}

export type CodeInvocationResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

const COLLECT_BUFFER_LIMIT = 1024 * 1024; // 1 MiB

export function runCodeCommand(options: {
	binary: string;
	args: readonly string[];
	spawnImpl?: SpawnLike;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}): Promise<CodeInvocationResult> {
	const spawnImpl = options.spawnImpl ?? defaultSpawn;
	const env = options.env ?? process.env;
	return new Promise<CodeInvocationResult>((resolveInvocation, rejectInvocation) => {
		let child: ReturnType<SpawnLike>;
		try {
			child = spawnImpl(options.binary, [...options.args], {
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			rejectInvocation(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let stdoutLength = 0;
		let stderrLength = 0;
		let timedOut = false;
		const timeoutHandle =
			typeof options.timeoutMs === "number"
				? setTimeout(() => {
						timedOut = true;
						child.kill("SIGKILL");
					}, options.timeoutMs)
				: null;
		child.stdout?.on("data", (chunk: Buffer) => {
			stdoutLength += chunk.length;
			if (stdoutLength <= COLLECT_BUFFER_LIMIT) stdoutChunks.push(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrLength += chunk.length;
			if (stderrLength <= COLLECT_BUFFER_LIMIT) stderrChunks.push(chunk);
		});
		child.on("error", (error) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			rejectInvocation(error);
		});
		child.on("close", (code) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			if (timedOut) {
				rejectInvocation(new Error(`code command timed out after ${options.timeoutMs}ms`));
				return;
			}
			resolveInvocation({
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				exitCode: code ?? -1,
			});
		});
	});
}

export type CodeExtensionListEntry = {
	id: string;
	version?: string;
};

export async function listInstalledExtensions(options: {
	binary: string;
	spawnImpl?: SpawnLike;
	env?: NodeJS.ProcessEnv;
}): Promise<CodeExtensionListEntry[]> {
	const result = await runCodeCommand({
		binary: options.binary,
		args: ["--list-extensions", "--show-versions"],
		spawnImpl: options.spawnImpl,
		env: options.env,
		timeoutMs: 30_000,
	});
	if (result.exitCode !== 0) {
		throw new Error(`code --list-extensions failed: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
	}
	const entries: CodeExtensionListEntry[] = [];
	for (const rawLine of result.stdout.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		const atIndex = line.lastIndexOf("@");
		if (atIndex > 0) {
			entries.push({ id: line.slice(0, atIndex), version: line.slice(atIndex + 1) });
		} else {
			entries.push({ id: line });
		}
	}
	return entries;
}
