import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AgentRuntimeDiagnostic } from "../../agent-runtime/types.js";
import { OmpRpcClient } from "./client.js";
import type { OmpRuntimeConfig } from "./config.js";

const MAX_VERSION_OUTPUT_BYTES = 256 * 1024;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const RESOURCE_ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type OmpInstancePaths = {
	root: string;
	agentDir: string;
	config: string;
	skills: string;
	context: string;
};

export type OmpSessionPaths = OmpInstancePaths & {
	piboSessionId: string;
	sessionGeneration: string;
	sessionDir: string;
};

export type PrepareOmpSessionPathsInput = {
	config: OmpRuntimeConfig;
	runtimeInstanceId: string;
	piboSessionId: string;
	sessionGeneration: string;
};

export type StartOmpProcessInput = PrepareOmpSessionPathsInput & {
	ompCommand: readonly string[];
	cwd: string;
	environment: NodeJS.ProcessEnv;
};

export type DiagnoseOmpRuntimeOptions = {
	baseEnvironment?: NodeJS.ProcessEnv;
};

export type OmpProcessErrorCode =
	| "environment_invalid"
	| "home_unavailable"
	| "isolation_failed"
	| "start_failed";

export class OmpProcessError extends Error {
	constructor(
		readonly code: OmpProcessErrorCode,
		message: string,
		options: ErrorOptions = {},
	) {
		super(message, options);
		this.name = "OmpProcessError";
	}
}

function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function nodeErrorCode(error: unknown): string | undefined {
	return error instanceof Error && "code" in error && typeof (error as NodeJS.ErrnoException).code === "string"
		? ((error as NodeJS.ErrnoException).code ?? undefined)
		: undefined;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
}

async function ensurePrivateConfig(path: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
	try {
		await stat(path);
	} catch {
		await writeFile(path, "", { mode: PRIVATE_FILE_MODE });
	}
}

export async function prepareOmpInstancePaths(
	config: OmpRuntimeConfig,
	runtimeInstanceId: string,
): Promise<OmpInstancePaths> {
	const root = resolve(config.homeRoot, safeSegment(runtimeInstanceId) || "orp");
	return {
		root,
		agentDir: join(root, "agent"),
		config: join(root, "agent", "config.yml"),
		skills: join(root, "agent", "skills"),
		context: join(root, "agent", "context"),
	};
}

export async function prepareOmpSessionPaths(
	input: PrepareOmpSessionPathsInput,
): Promise<OmpSessionPaths> {
	const instance = await prepareOmpInstancePaths(input.config, input.runtimeInstanceId);
	const sessionDir = join(instance.root, "sessions", safeSegment(input.piboSessionId) || "session");
	const paths: OmpSessionPaths = {
		...instance,
		piboSessionId: input.piboSessionId,
		sessionGeneration: input.sessionGeneration,
		sessionDir,
	};
	await ensurePrivateDirectory(instance.root);
	await ensurePrivateDirectory(instance.agentDir);
	await ensurePrivateDirectory(instance.skills);
	await ensurePrivateDirectory(instance.context);
	await ensurePrivateDirectory(sessionDir);
	await ensurePrivateConfig(instance.config);
	return paths;
}

export async function disposeOmpSessionPaths(paths: OmpSessionPaths): Promise<void> {
	await rm(paths.root, { recursive: true, force: true });
}

/**
 * Build the environment for the OMP child. The agent dir is redirected via
 * `PI_CODING_AGENT_DIR` (and `PI_CONFIG_DIR`) so all OMP user-global state is
 * isolated under the Pibo-owned home — the real `~/.omp` is never touched.
 * Only allow-listed keys are inherited; provider API keys are passed through
 * from the allowlisted key set (model auth is provider-config via models.yml +
 * env).
 */
export function buildOmpProcessEnvironment(input: {
	paths: OmpSessionPaths;
	config: OmpRuntimeConfig;
	baseEnvironment?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
	const base = input.baseEnvironment ?? process.env;
	const env: NodeJS.ProcessEnv = {
		PI_CODING_AGENT_DIR: input.paths.agentDir,
		PI_CONFIG_DIR: ".omp",
		PI_NO_TITLE: "1",
		OMP_PROFILE: "pibo",
	};
	const allowlist = new Set<string>([...input.config.environmentAllowlist, ...input.config.apiKeyEnvironment]);
	for (const [key, value] of Object.entries(base)) {
		if (allowlist.has(key) && value !== undefined) {
			env[key] = value;
		}
	}
	return env;
}

type VersionProbeResult =
	| { status: "ok"; output: string }
	| { status: "missing" }
	| { status: "timeout" }
	| { status: "too_large" }
	| { status: "failed"; exitCode?: number | null; errorCode?: string };

async function probeOmpVersion(
	config: OmpRuntimeConfig,
	environment: NodeJS.ProcessEnv,
): Promise<VersionProbeResult> {
	return await new Promise<VersionProbeResult>((resolveProbe) => {
		const command = ["--version"];
		let child;
		try {
			child = spawn(config.bunExecutable, [config.ompEntry, ...command], {
				env: environment,
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (error) {
			resolveProbe({ status: "failed", errorCode: nodeErrorCode(error) });
			return;
		}
		let settled = false;
		let bytes = 0;
		const chunks: Buffer[] = [];
		const settle = (result: VersionProbeResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolveProbe(result);
		};
		const collect = (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > MAX_VERSION_OUTPUT_BYTES) {
				child?.kill("SIGKILL");
				settle({ status: "too_large" });
				return;
			}
			chunks.push(Buffer.from(chunk));
		};
		child.stdout?.on("data", collect);
		child.stderr?.on("data", collect);
		child.once("error", (error: NodeJS.ErrnoException) => {
			settle(error.code === "ENOENT" ? { status: "missing" } : { status: "failed", errorCode: nodeErrorCode(error) });
		});
		child.once("close", (code) => {
			if (settled) return;
			if (code !== 0) {
				settle({ status: "failed", exitCode: code });
				return;
			}
			settle({ status: "ok", output: Buffer.concat(chunks).toString("utf8") });
		});
		const timer = setTimeout(() => {
			child?.kill("SIGKILL");
			settle({ status: "timeout" });
		}, config.diagnosticTimeoutMs);
	});
}

export async function diagnoseOmpRuntime(
	config: OmpRuntimeConfig,
	runtimeInstanceId: string,
	options: DiagnoseOmpRuntimeOptions = {},
): Promise<readonly AgentRuntimeDiagnostic[]> {
	const diagnostics: AgentRuntimeDiagnostic[] = [];
	if (!config.ompEntry) {
		diagnostics.push({
			severity: "error",
			code: "omp_entry_unset",
			message: `No OMP CLI entry is configured for runtime instance "${runtimeInstanceId}".`,
			path: "config.ompEntry",
		});
		return diagnostics;
	}
	let paths: OmpSessionPaths;
	try {
		paths = await prepareOmpSessionPaths({
			config,
			runtimeInstanceId,
			piboSessionId: "runtime-diagnostics",
			sessionGeneration: `version-probe-${randomUUID()}`,
		});
	} catch (error) {
		const errorCode = nodeErrorCode(error);
		diagnostics.push({
			severity: "error",
			code: "omp_home_unavailable",
			message: `Private OMP state is unavailable for runtime instance "${runtimeInstanceId}".`,
			path: "config.homeRoot",
			...(errorCode ? { details: { errorCode } } : {}),
		});
		return diagnostics;
	}

	diagnostics.push({
		severity: "info",
		code: "omp_home_ready",
		message: `Private OMP state is ready for runtime instance "${runtimeInstanceId}".`,
		details: { scope: "configured-instance", private: true },
	});

	let probe: VersionProbeResult;
	try {
		probe = await probeOmpVersion(
			config,
			buildOmpProcessEnvironment({ paths, config, baseEnvironment: options.baseEnvironment ?? process.env }),
		);
	} finally {
		await disposeOmpSessionPaths(paths);
	}

	if (probe.status === "missing") {
		diagnostics.push({
			severity: "error",
			code: "omp_bun_not_found",
			message: `Bun executable is not available for runtime instance "${runtimeInstanceId}".`,
			path: "config.bunExecutable",
		});
		return diagnostics;
	}
	if (probe.status === "timeout") {
		diagnostics.push({
			severity: "error",
			code: "omp_version_probe_timeout",
			message: `OMP version inspection timed out for runtime instance "${runtimeInstanceId}".`,
			path: "config.diagnosticTimeoutMs",
		});
		return diagnostics;
	}
	if (probe.status === "too_large") {
		diagnostics.push({
			severity: "error",
			code: "omp_version_probe_too_large",
			message: `OMP version inspection produced too much output for runtime instance "${runtimeInstanceId}".`,
		});
		return diagnostics;
	}
	if (probe.status === "failed") {
		diagnostics.push({
			severity: "error",
			code: "omp_version_probe_failed",
			message: `OMP CLI version inspection failed for runtime instance "${runtimeInstanceId}".`,
			...(probe.exitCode !== undefined || probe.errorCode
				? {
					details: {
						...(probe.exitCode !== undefined ? { exitCode: probe.exitCode } : {}),
						...(probe.errorCode ? { errorCode: probe.errorCode } : {}),
					},
				}
				: {}),
		});
		return diagnostics;
	}
	const version = probe.output.trim().split("\n").slice(-1)[0] ?? "";
	diagnostics.push({
		severity: "info",
		code: "omp_version_ok",
		message: `OMP CLI is available for runtime instance "${runtimeInstanceId}".`,
		details: { version: version || "unknown", private: true },
	});
	return diagnostics;
}

export type StartOmpProcessInputFull = StartOmpProcessInput & {
	startupTimeoutMs: number;
	requestTimeoutMs: number;
};

export async function startOmpProcess(input: StartOmpProcessInputFull): Promise<OmpRpcClient> {
	const client = new OmpRpcClient({
		startupTimeoutMs: input.startupTimeoutMs,
		requestTimeoutMs: input.requestTimeoutMs,
	});
	await client.connect(Array.from(input.ompCommand), {
		cwd: input.cwd,
		env: input.environment,
	});
	return client;
}

export function resolveOmpCommand(config: OmpRuntimeConfig, paths: OmpSessionPaths): string[] {
	const entry = resolveOmpEntryCwd(config.ompEntry);
	return [config.bunExecutable, entry, "--mode", "rpc", "--session-dir", paths.sessionDir];
}

function resolveOmpEntryCwd(entry: string): string {
	// Prefer the operator-configured absolute path; relative entries resolve
	// against the spawn cwd (OMP repo checkout in the adapter's working dir).
	return entry && entry.length > 0 ? entry : "src/cli.ts";
}
