import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { spawnMspConnection, type SpawnedMspConnection } from "@muse-code/sdk";
import type { AgentRuntimeDiagnostic } from "../../agent-runtime/types.js";
import { protectPrivatePathsSync } from "../../core/private-path.js";
import type { MuseNativeRuntimeConfig, MuseNativeSandboxMode } from "./config.js";
import { MUSE_NATIVE_ADAPTER_VERSION, MUSE_PROTOCOL_SUPPORTED_RANGE, MUSE_PROTOCOL_VERSION } from "./protocol-version.js";
import { redactMuseNativeSensitiveText } from "./redaction.js";

const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;
const SESSION_PATH_CLEANUP_MAX_RETRIES = 10;
const SESSION_PATH_CLEANUP_RETRY_DELAY_MS = 50;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SDK_GATE_ENV = "MUSE_EXPERIMENTAL_SDK_ENABLED";
const MAX_STDERR_DIAGNOSTIC_CHARS = 4_000;
const MAX_DIAGNOSTICS = 32;
const BWRAP_PROBE_TIMEOUT_MS = 5_000;

const PROTECTED_RESOURCE_ENVIRONMENT_KEYS = new Set([
	"MUSE_HOME",
	"HOME",
	"USERPROFILE",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_STATE_HOME",
	"TMP",
	"TEMP",
	"TMPDIR",
	"PATH",
	"PATHEXT",
	"SYSTEMROOT",
	"WINDIR",
	"COMSPEC",
	"NODE_OPTIONS",
	"LD_PRELOAD",
	"BASH_ENV",
	"ENV",
	"PYTHONHOME",
	"PYTHONPATH",
	"RUBYOPT",
	"PERL5OPT",
	"JAVA_TOOL_OPTIONS",
	"_JAVA_OPTIONS",
]);

export type MuseNativeInstancePaths = {
	root: string;
	museHome: string;
	authFile: string;
	sessions: string;
};

export type MuseNativeSessionPaths = MuseNativeInstancePaths & {
	sessionRoot: string;
	generationRoot: string;
	processHome: string;
	temp: string;
	xdgCache: string;
	xdgConfig: string;
	/** Session-stable native session store. Unlike the other generation-scoped paths it survives host disposal, so resume keeps working across rebind and restart. */
	xdgData: string;
	xdgState: string;
};

export type PrepareMuseNativeSessionPathsInput = {
	config: MuseNativeRuntimeConfig;
	runtimeInstanceId: string;
	piboSessionId: string;
	sessionGeneration: string;
};

export type StartMuseNativeHostInput = PrepareMuseNativeSessionPathsInput & {
	workspace: string;
	signal?: AbortSignal;
	baseEnvironment?: NodeJS.ProcessEnv;
	resourceEnvironment?: Readonly<NodeJS.ProcessEnv>;
	onDiagnostic?: (diagnostic: MuseNativeHostDiagnostic) => void;
};

export type MuseNativeProcessErrorCode =
	| "environment_invalid"
	| "home_unavailable"
	| "isolation_failed"
	| "start_failed";

export class MuseNativeProcessError extends Error {
	constructor(
		readonly code: MuseNativeProcessErrorCode,
		message: string,
	) {
		super(message);
		this.name = "MuseNativeProcessError";
	}
}

export type MuseNativeHostDiagnostic = {
	level: "warning" | "error";
	message: string;
};

export type MuseNativeHostProcess = {
	paths: MuseNativeSessionPaths;
	spawned: SpawnedMspConnection;
	getDiagnostics(): readonly MuseNativeHostDiagnostic[];
	close(): Promise<void>;
};

function safeSegment(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "runtime";
	const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
	return `${normalized}-${hash}`;
}

function isInside(root: string, candidate: string): boolean {
	const child = relative(root, candidate);
	return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function findExecutableOnPath(name: string, pathEnv: string | undefined): string | undefined {
	if (!pathEnv) return undefined;
	for (const dir of pathEnv.split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, name);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not executable here; keep scanning.
		}
	}
	return undefined;
}

const bubblewrapProbeCache = new Map<string, Promise<boolean>>();

/** Functional bubblewrap probe: presence alone does not prove user namespaces work. */
export function probeBubblewrapSandbox(bwrapPath: string): Promise<boolean> {
	const cached = bubblewrapProbeCache.get(bwrapPath);
	if (cached) return cached;
	const probe = (async () => {
		try {
			await promisify(execFile)(bwrapPath, ["--ro-bind", "/", "/", "true"], { timeout: BWRAP_PROBE_TIMEOUT_MS });
			return true;
		} catch {
			return false;
		}
	})();
	bubblewrapProbeCache.set(bwrapPath, probe);
	return probe;
}

export type ResolveMuseSandboxArgsInput = {
	mode: MuseNativeSandboxMode;
	workspace: string;
	executable: string;
	platform?: NodeJS.Platform;
	pathEnv?: string;
	findExecutable?: (name: string) => string | undefined;
	probeSandbox?: (bwrapPath: string) => Promise<boolean>;
};

export type ResolveMuseSandboxArgsResult = {
	args: string[];
	diagnostic?: MuseNativeHostDiagnostic;
};

/**
 * Resolve `muse serve` sandbox flags. muse refuses every shell command when
 * its Linux sandbox cannot engage: bubblewrap missing or non-functional, or
 * the muse helper itself living inside the writable workspace root. Auto mode
 * degrades to --disable-sandbox with a warning diagnostic instead of leaving
 * the session without a working shell.
 */
export async function resolveMuseSandboxArgs(input: ResolveMuseSandboxArgsInput): Promise<ResolveMuseSandboxArgsResult> {
	if (input.mode === "disabled") return { args: ["--disable-sandbox"] };
	if (input.mode === "enabled") return { args: [] };
	const platform = input.platform ?? process.platform;
	if (platform !== "linux") return { args: [] };
	const pathEnv = input.pathEnv ?? process.env.PATH;
	const findExecutable = input.findExecutable ?? ((name: string) => findExecutableOnPath(name, pathEnv));
	const executablePath = isAbsolute(input.executable) ? input.executable : findExecutable(input.executable);
	if (executablePath && isInside(resolve(input.workspace), resolve(executablePath))) {
		return {
			args: ["--disable-sandbox"],
			diagnostic: {
				level: "warning",
				message: `Muse shell sandbox is disabled: the muse executable is inside the session workspace "${input.workspace}", which the sandbox refuses. Move the workspace or set sandbox "enabled" to fail instead.`,
			},
		};
	}
	const bwrapPath = findExecutable("bwrap");
	if (!bwrapPath) {
		return {
			args: ["--disable-sandbox"],
			diagnostic: {
				level: "warning",
				message: "Muse shell sandbox is disabled: no bwrap was found on PATH. Install your distribution's bubblewrap package to re-enable sandboxing.",
			},
		};
	}
	const probeSandbox = input.probeSandbox ?? probeBubblewrapSandbox;
	if (!(await probeSandbox(bwrapPath))) {
		return {
			args: ["--disable-sandbox"],
			diagnostic: {
				level: "warning",
				message: `Muse shell sandbox is disabled: bwrap at "${bwrapPath}" cannot sandbox (user namespaces unavailable?). Fix the bubblewrap setup to re-enable sandboxing.`,
			},
		};
	}
	return { args: [] };
}

function museExecutableInvocation(executable: string, args: readonly string[]): { command: string; args: string[] } {
	if (isAbsolute(executable) && [".js", ".cjs", ".mjs"].includes(extname(executable).toLowerCase())) {
		return { command: process.execPath, args: [executable, ...args] };
	}
	return { command: executable, args: [...args] };
}

function nodeErrorCode(error: unknown): string | undefined {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : undefined;
}

export function museNativeInstancePaths(config: MuseNativeRuntimeConfig, runtimeInstanceId: string): MuseNativeInstancePaths {
	const root = resolve(config.homeRoot);
	const instanceRoot = join(root, safeSegment(runtimeInstanceId));
	const museHome = join(instanceRoot, "muse-home");
	return {
		root: instanceRoot,
		museHome,
		authFile: join(museHome, ".config", "muse", "auth.json"),
		sessions: join(instanceRoot, "sessions"),
	};
}

export async function prepareMuseNativeSessionPaths(input: PrepareMuseNativeSessionPathsInput): Promise<MuseNativeSessionPaths> {
	const root = resolve(input.config.homeRoot);
	const instanceRoot = join(root, safeSegment(input.runtimeInstanceId));
	const museHome = join(instanceRoot, "muse-home");
	const sessionRoot = join(instanceRoot, "sessions", safeSegment(input.piboSessionId));
	const generationRoot = join(sessionRoot, safeSegment(input.sessionGeneration));
	const processHome = join(generationRoot, "home");
	const paths: MuseNativeSessionPaths = {
		root: instanceRoot,
		museHome,
		authFile: join(museHome, ".config", "muse", "auth.json"),
		sessions: join(instanceRoot, "sessions"),
		sessionRoot,
		generationRoot,
		processHome,
		temp: join(generationRoot, "tmp"),
		xdgCache: join(generationRoot, "xdg", "cache"),
		xdgConfig: join(generationRoot, "xdg", "config"),
		// The host persists native sessions under XDG_DATA_HOME. Keep it stable per
		// Pibo session (outside the wiped generation root) so resume survives rebind,
		// restart, and disposal; per-session isolation is preserved.
		xdgData: join(sessionRoot, "xdg-data"),
		xdgState: join(generationRoot, "xdg", "state"),
	};
	if (!isInside(root, instanceRoot) || !isInside(instanceRoot, generationRoot)) {
		throw new MuseNativeProcessError("isolation_failed", "Muse session paths escape the configured runtime home.");
	}
	try {
		await mkdir(paths.museHome, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		await mkdir(paths.sessions, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		// Session generations inherit the instance root ACL. Re-protecting on every open costs one
		// privileged shell per host start; the sentinel records the decision inside the protected root.
		const aclSentinel = join(instanceRoot, ".acl-protected");
		if (!existsSync(aclSentinel)) {
			protectPrivatePathsSync([{ path: instanceRoot, kind: "directory" }]);
			await writeFile(aclSentinel, "1\n", { mode: PRIVATE_FILE_MODE });
		}
		await mkdir(paths.processHome, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		await mkdir(paths.temp, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		await mkdir(paths.xdgCache, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		await mkdir(paths.xdgConfig, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		await mkdir(paths.xdgData, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		await mkdir(paths.xdgState, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		await mkdir(join(paths.museHome, ".config", "muse"), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
	} catch (error) {
		throw new MuseNativeProcessError(
			"home_unavailable",
			`Muse runtime home is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
		);
	}
	return paths;
}

async function seedGenerationAuth(paths: MuseNativeSessionPaths): Promise<boolean> {
	let auth: string;
	try {
		auth = await readFile(paths.authFile, "utf8");
	} catch {
		return false;
	}
	// The host resolves its config root from XDG_CONFIG_HOME when set, falling back to
	// $HOME/.config otherwise. The adapter always sets XDG_CONFIG_HOME, so auth must be
	// seeded at the XDG-resolved location; the $HOME copy stays as a fallback.
	const targets = [join(paths.processHome, ".config", "muse"), join(paths.xdgConfig, "muse")];
	for (const targetDir of targets) {
		await mkdir(targetDir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		await writeFile(join(targetDir, "auth.json"), auth, { mode: PRIVATE_FILE_MODE });
	}
	return true;
}

export function buildHostEnvironment(input: StartMuseNativeHostInput, paths: MuseNativeSessionPaths): NodeJS.ProcessEnv {
	const source = input.baseEnvironment ?? process.env;
	const env: NodeJS.ProcessEnv = {};
	for (const key of input.config.environmentAllowlist) {
		const value = source[key];
		if (value === undefined) continue;
		env[key] = value;
	}
	env.HOME = paths.processHome;
	env.USERPROFILE = paths.processHome;
	env.XDG_CACHE_HOME = paths.xdgCache;
	env.XDG_CONFIG_HOME = paths.xdgConfig;
	env.XDG_DATA_HOME = paths.xdgData;
	env.XDG_STATE_HOME = paths.xdgState;
	env.TMPDIR = paths.temp;
	env.TEMP = paths.temp;
	env.TMP = paths.temp;
	if (input.config.experimentalSdkGate) env[SDK_GATE_ENV] = "on";
	if (input.resourceEnvironment) {
		for (const [key, value] of Object.entries(input.resourceEnvironment)) {
			if (value === undefined) continue;
			const canonical = key.toUpperCase();
			if (PROTECTED_RESOURCE_ENVIRONMENT_KEYS.has(canonical) || canonical.startsWith("DYLD_")) continue;
			env[key] = value;
		}
	}
	return env;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return new Promise<T>((resolvePromise, rejectPromise) => {
			timer = setTimeout(() => rejectPromise(new Error(label)), timeoutMs);
			timer.unref?.();
			promise.then(
				(value) => {
					if (timer) clearTimeout(timer);
					resolvePromise(value);
				},
				(error) => {
					if (timer) clearTimeout(timer);
					rejectPromise(error);
				},
			);
		});
	} catch (error) {
		if (timer) clearTimeout(timer);
		throw error;
	}
}

/** Wipes only the generation root; the session-stable xdg-data session store intentionally survives for resume. */
export async function disposeMuseNativeSessionPaths(paths: MuseNativeSessionPaths): Promise<void> {
	await rm(paths.generationRoot, {
		recursive: true,
		force: true,
		maxRetries: SESSION_PATH_CLEANUP_MAX_RETRIES,
		retryDelay: SESSION_PATH_CLEANUP_RETRY_DELAY_MS,
	});
	await rmdir(paths.sessionRoot).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
	});
}

export async function startMuseNativeHost(input: StartMuseNativeHostInput): Promise<MuseNativeHostProcess> {
	const paths = await prepareMuseNativeSessionPaths(input);
	const diagnostics: MuseNativeHostDiagnostic[] = [];
	const report = (diagnostic: MuseNativeHostDiagnostic): void => {
		if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
		input.onDiagnostic?.(diagnostic);
	};
	if (!(await seedGenerationAuth(paths))) {
		report({
			level: "warning",
			message: "No stored Muse credential was found; store an API key or complete `muse login` on this host before prompting.",
		});
	}
	const env = buildHostEnvironment(input, paths);
	const sandbox = await resolveMuseSandboxArgs({
		mode: input.config.sandbox,
		workspace: input.workspace,
		executable: input.config.executable,
	});
	if (sandbox.diagnostic) report(sandbox.diagnostic);
	const invocation = museExecutableInvocation(input.config.executable, ["serve", ...sandbox.args]);
	let spawned: SpawnedMspConnection;
	try {
		const handshake = spawnMspConnection({
			command: invocation.command,
			args: invocation.args,
			cwd: input.workspace,
			env,
			shutdownTimeoutMs: input.config.shutdownTimeoutMs,
			onStderr: (chunk) => {
				const message = redactMuseNativeSensitiveText(chunk).slice(0, MAX_STDERR_DIAGNOSTIC_CHARS);
				if (message.trim()) report({ level: "warning", message: `muse serve stderr: ${message}` });
			},
		});
		if (input.signal?.aborted) {
			await handshake.close().catch(() => {});
			throw new MuseNativeProcessError("start_failed", "Muse host startup was aborted.");
		}
		try {
			spawned = await withTimeout(
				handshake.initialize({
				clientInfo: { name: "pibo", version: MUSE_NATIVE_ADAPTER_VERSION },
				// The host withholds MCP session config and session listing unless granted here.
				capabilities: { requestedCapabilities: ["sessionMcp", "sessionListStream"] },
			}),
				input.config.startupTimeoutMs,
				`Muse host startup timed out after ${input.config.startupTimeoutMs}ms.`,
			);
		} catch (error) {
			// A timed-out or failed handshake must not orphan the host process.
			await handshake.close().catch(() => {});
			throw error;
		}
	} catch (error) {
		await disposeMuseNativeSessionPaths(paths).catch(() => {});
		if (error instanceof MuseNativeProcessError) throw error;
		throw new MuseNativeProcessError(
			"start_failed",
			`Muse host failed to start: ${redactMuseNativeSensitiveText(error instanceof Error ? error.message : "unknown error")}`,
		);
	}
	if (spawned.fingerprintWarning) {
		report({
			level: "warning",
			message: `Muse schema fingerprint differs from SDK pin ${MUSE_PROTOCOL_VERSION}; continuing with a compatibility warning.`,
		});
	}
	let closed = false;
	return {
		paths,
		spawned,
		getDiagnostics: () => [...diagnostics],
		close: async () => {
			if (closed) return;
			closed = true;
			try {
				await withTimeout(spawned.close(), input.config.shutdownTimeoutMs + 5_000, "Muse host shutdown timed out.");
			} catch (error) {
				report({
					level: "warning",
					message: `Muse host shutdown failed: ${redactMuseNativeSensitiveText(error instanceof Error ? error.message : "unknown error")}`,
				});
			} finally {
				await disposeMuseNativeSessionPaths(paths).catch(() => {});
			}
		},
	};
}

type VersionProbeResult =
	| { status: "ok"; version: string }
	| { status: "failed"; errorCode?: string }
	| { status: "too_large" }
	| { status: "timeout" };

async function probeMuseVersion(executable: string, timeoutMs: number): Promise<VersionProbeResult> {
	return await new Promise<VersionProbeResult>((resolveProbe) => {
		let child;
		try {
			const invocation = museExecutableInvocation(executable, ["--version"]);
			child = spawn(invocation.command, invocation.args, { stdio: ["ignore", "pipe", "pipe"] });
		} catch (error) {
			resolveProbe({ status: "failed", errorCode: nodeErrorCode(error) });
			return;
		}
		let settled = false;
		let bytes = 0;
		const chunks: Buffer[] = [];
		const timer = setTimeout(() => settle({ status: "timeout" }), timeoutMs);
		timer.unref?.();
		const settle = (result: VersionProbeResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (result.status === "timeout" || result.status === "too_large") child.kill("SIGKILL");
			resolveProbe(result);
		};
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > MAX_VERSION_OUTPUT_BYTES) {
				settle({ status: "too_large" });
				return;
			}
			chunks.push(Buffer.from(chunk));
		});
		child.stderr.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > MAX_VERSION_OUTPUT_BYTES) settle({ status: "too_large" });
		});
		child.once("error", (error: NodeJS.ErrnoException) => settle({ status: "failed", errorCode: error.code }));
		child.once("close", () => {
			const output = Buffer.concat(chunks).toString("utf8");
			const match = /\bmuse[^\d\n]*?(\d+)\.(\d+)\.(\d+)/i.exec(output);
			const version = match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
			settle(version ? { status: "ok", version } : { status: "failed" });
		});
	});
}

export async function diagnoseMuseNativeRuntime(
	config: MuseNativeRuntimeConfig,
	runtimeInstanceId: string,
): Promise<readonly AgentRuntimeDiagnostic[]> {
	const diagnostics: AgentRuntimeDiagnostic[] = [];
	const probe = await probeMuseVersion(config.executable, config.diagnosticTimeoutMs);
	if (probe.status === "failed" && probe.errorCode === "ENOENT") {
		diagnostics.push({
			severity: "error",
			code: "muse_native_executable_missing",
			message: `Muse executable "${config.executable}" was not found for runtime instance "${runtimeInstanceId}". Install Muse and ensure it is on PATH.`,
		});
		return diagnostics;
	}
	if (probe.status !== "ok") {
		diagnostics.push({
			severity: "error",
			code: "muse_native_executable_unavailable",
			message: `Muse executable "${config.executable}" did not report a version for runtime instance "${runtimeInstanceId}" (status: ${probe.status}).`,
		});
		return diagnostics;
	}
	if (probe.version !== MUSE_PROTOCOL_VERSION) {
		diagnostics.push({
			severity: "warning",
			code: "muse_native_version_mismatch",
			message: `Muse ${probe.version} differs from the validated SDK pin ${MUSE_PROTOCOL_VERSION} (supported: ${MUSE_PROTOCOL_SUPPORTED_RANGE}); continuing with a compatibility warning.`,
		});
	} else {
		diagnostics.push({
			severity: "info",
			code: "muse_native_version_ok",
			message: `Muse ${probe.version} matches the validated SDK pin.`,
		});
	}
	let paths: MuseNativeSessionPaths | undefined;
	try {
		paths = await prepareMuseNativeSessionPaths({
			config,
			runtimeInstanceId,
			piboSessionId: "runtime-diagnostics",
			sessionGeneration: `version-probe-${randomUUID()}`,
		});
	} catch (error) {
		diagnostics.push({
			severity: "error",
			code: "muse_native_home_unavailable",
			message: `Muse runtime home "${config.homeRoot}" is unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
		});
	} finally {
		if (paths) await disposeMuseNativeSessionPaths(paths);
	}
	return diagnostics;
}
