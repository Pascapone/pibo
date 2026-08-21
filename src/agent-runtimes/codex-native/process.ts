import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	realpath,
	rm,
	rmdir,
	writeFile,
} from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AgentRuntimeDiagnostic } from "../../agent-runtime/types.js";
import { protectPrivateFileSync, protectPrivatePathsSync } from "../../core/private-path.js";
import { CodexAppServerClient, type CodexAppServerDiagnostic } from "./client.js";
import type { CodexAppServerInitializeCapabilities } from "./protocol-types.js";
import type { CodexNativeRuntimeConfig } from "./config.js";
import {
	CODEX_APP_SERVER_PROTOCOL_NAME,
	CODEX_APP_SERVER_SUPPORTED_RANGE,
	CODEX_APP_SERVER_VERSION,
} from "./protocol-version.js";

const MAX_VERSION_OUTPUT_BYTES = 64 * 1024;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const INSTANCE_CONFIG = [
	"# Managed by Pibo for this configured Codex runtime instance.",
	"# Session-specific settings are supplied through process-scoped official overrides.",
	"[analytics]",
	"enabled = false",
	"",
].join("\n");
const RESOURCE_ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROTECTED_RESOURCE_ENVIRONMENT_KEYS = new Set([
	"CODEX_HOME",
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

export type CodexNativeInstancePaths = {
	root: string;
	codexHome: string;
	configFile: string;
	sessions: string;
};

export type CodexNativeSessionPaths = CodexNativeInstancePaths & {
	sessionRoot: string;
	generationRoot: string;
	processHome: string;
	temp: string;
	xdgCache: string;
	xdgConfig: string;
	xdgData: string;
	xdgState: string;
};

export type PrepareCodexNativeSessionPathsInput = {
	config: CodexNativeRuntimeConfig;
	runtimeInstanceId: string;
	piboSessionId: string;
	sessionGeneration: string;
};

export type StartCodexNativeAppServerInput = PrepareCodexNativeSessionPathsInput & {
	workspace: string;
	clientVersion: string;
	baseEnvironment?: NodeJS.ProcessEnv;
	resourceEnvironment?: Readonly<NodeJS.ProcessEnv>;
	onDiagnostic?: (diagnostic: CodexAppServerDiagnostic) => void;
};

export type DiagnoseCodexNativeRuntimeOptions = {
	baseEnvironment?: NodeJS.ProcessEnv;
};

export type CodexNativeProcessErrorCode =
	| "environment_invalid"
	| "home_unavailable"
	| "isolation_failed"
	| "start_failed";

export class CodexNativeProcessError extends Error {
	constructor(
		readonly code: CodexNativeProcessErrorCode,
		message: string,
	) {
		super(message);
		this.name = "CodexNativeProcessError";
	}
}

function safeSegment(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "runtime";
	const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
	return `${normalized}-${hash}`;
}

function isInside(root: string, candidate: string): boolean {
	const child = relative(root, candidate);
	return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

async function ensurePrivateDirectories(paths: readonly string[]): Promise<void> {
	for (const path of paths) {
		await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		const metadata = await lstat(path);
		if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("runtime path is not a private directory");
	}
	protectPrivatePathsSync(paths.map((path) => ({ path, kind: "directory" })));
}

async function ensurePrivateConfig(path: string): Promise<void> {
	try {
		await writeFile(path, INSTANCE_CONFIG, { encoding: "utf8", flag: "wx", mode: PRIVATE_FILE_MODE });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const metadata = await lstat(path);
	if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error("runtime config is not a private regular file");
	protectPrivateFileSync(path);
}

function nodeErrorCode(error: unknown): string | undefined {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : undefined;
}

function codexExecutableInvocation(executable: string, args: readonly string[]): { command: string; args: string[] } {
	if (process.platform === "win32" && isAbsolute(executable) && [".js", ".cjs", ".mjs"].includes(extname(executable).toLowerCase())) {
		return { command: process.execPath, args: [executable, ...args] };
	}
	return { command: executable, args: [...args] };
}

export async function prepareCodexNativeInstancePaths(
	config: CodexNativeRuntimeConfig,
	runtimeInstanceId: string,
): Promise<CodexNativeInstancePaths> {
	if (!runtimeInstanceId.trim()) throw new CodexNativeProcessError("home_unavailable", "Codex runtime instance id is required.");
	try {
		await mkdir(config.homeRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
		const canonicalHomeRoot = await realpath(config.homeRoot);
		const root = join(canonicalHomeRoot, safeSegment(runtimeInstanceId));
		const codexHome = join(root, "codex-home");
		const sessions = join(root, "sessions");
		await ensurePrivateDirectories([canonicalHomeRoot, root, codexHome, sessions]);
		const canonicalRoot = await realpath(root);
		for (const path of [codexHome, sessions]) {
			const canonical = await realpath(path);
			if (!isInside(canonicalRoot, canonical)) throw new Error("runtime path escaped its configured instance root");
		}
		const configFile = join(codexHome, "config.toml");
		await ensurePrivateConfig(configFile);
		return { root: canonicalRoot, codexHome: await realpath(codexHome), configFile, sessions: await realpath(sessions) };
	} catch {
		throw new CodexNativeProcessError(
			"home_unavailable",
			`Private Codex state could not be prepared for runtime instance "${runtimeInstanceId}".`,
		);
	}
}

export async function prepareCodexNativeSessionPaths(
	input: PrepareCodexNativeSessionPathsInput,
): Promise<CodexNativeSessionPaths> {
	if (!input.piboSessionId.trim() || !input.sessionGeneration.trim()) {
		throw new CodexNativeProcessError("home_unavailable", "Pibo session id and runtime generation are required.");
	}
	const instance = await prepareCodexNativeInstancePaths(input.config, input.runtimeInstanceId);
	const sessionRoot = join(instance.sessions, safeSegment(input.piboSessionId));
	const generationRoot = join(sessionRoot, safeSegment(input.sessionGeneration));
	let sessionDirectoryReady = false;
	try {
		const processHome = join(generationRoot, "home");
		const temp = join(generationRoot, "tmp");
		const xdgCache = join(processHome, ".cache");
		const xdgConfig = join(processHome, ".config");
		const xdgData = join(processHome, ".local", "share");
		const xdgState = join(processHome, ".local", "state");
		await ensurePrivateDirectories([sessionRoot, generationRoot, processHome, temp, xdgCache, xdgConfig, xdgData, xdgState]);
		sessionDirectoryReady = true;
		const canonicalGenerationRoot = await realpath(generationRoot);
		if (!isInside(instance.sessions, canonicalGenerationRoot)) throw new Error("runtime generation escaped its session root");
		return {
			...instance,
			sessionRoot: await realpath(sessionRoot),
			generationRoot: canonicalGenerationRoot,
			processHome: await realpath(processHome),
			temp: await realpath(temp),
			xdgCache: await realpath(xdgCache),
			xdgConfig: await realpath(xdgConfig),
			xdgData: await realpath(xdgData),
			xdgState: await realpath(xdgState),
		};
	} catch {
		if (sessionDirectoryReady) {
			await rm(generationRoot, { recursive: true, force: true }).catch(() => {});
			await rmdir(sessionRoot).catch(() => {});
		}
		throw new CodexNativeProcessError(
			"home_unavailable",
			`Private Codex process state could not be prepared for Pibo session "${input.piboSessionId}".`,
		);
	}
}

export async function disposeCodexNativeSessionPaths(paths: CodexNativeSessionPaths): Promise<void> {
	await rm(paths.generationRoot, { recursive: true, force: true });
	await rmdir(paths.sessionRoot).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
	});
}

export async function removeCodexNativeInstanceState(paths: CodexNativeInstancePaths): Promise<void> {
	await rm(paths.root, { recursive: true, force: true });
}

function environmentLookup(environment: NodeJS.ProcessEnv): Map<string, [string, string]> {
	const lookup = new Map<string, [string, string]>();
	for (const [key, value] of Object.entries(environment)) {
		if (typeof value === "string") lookup.set(key.toUpperCase(), [key, value]);
	}
	return lookup;
}

function assertResourceEnvironmentKey(key: string): void {
	if (!RESOURCE_ENVIRONMENT_KEY_PATTERN.test(key)) {
		throw new CodexNativeProcessError("environment_invalid", "Codex resource environment contains an invalid variable name.");
	}
	const canonical = key.toUpperCase();
	if (PROTECTED_RESOURCE_ENVIRONMENT_KEYS.has(canonical) || canonical.startsWith("DYLD_")) {
		throw new CodexNativeProcessError(
			"environment_invalid",
			`Codex resource environment may not override protected variable "${key}".`,
		);
	}
}

export function buildCodexNativeProcessEnvironment(input: {
	config: CodexNativeRuntimeConfig;
	paths: CodexNativeSessionPaths;
	baseEnvironment?: NodeJS.ProcessEnv;
	resourceEnvironment?: Readonly<NodeJS.ProcessEnv>;
}): NodeJS.ProcessEnv {
	const base = input.baseEnvironment ?? process.env;
	const lookup = environmentLookup(base);
	const environment: NodeJS.ProcessEnv = {};
	for (const configuredKey of input.config.environmentAllowlist) {
		const selected = lookup.get(configuredKey.toUpperCase());
		if (selected) environment[selected[0]] = selected[1];
	}
	for (const [key, value] of Object.entries(input.resourceEnvironment ?? {})) {
		if (value === undefined) continue;
		assertResourceEnvironmentKey(key);
		environment[key] = value;
	}
	environment.CODEX_HOME = input.paths.codexHome;
	environment.HOME = input.paths.processHome;
	environment.USERPROFILE = input.paths.processHome;
	environment.XDG_CACHE_HOME = input.paths.xdgCache;
	environment.XDG_CONFIG_HOME = input.paths.xdgConfig;
	environment.XDG_DATA_HOME = input.paths.xdgData;
	environment.XDG_STATE_HOME = input.paths.xdgState;
	environment.TMPDIR = input.paths.temp;
	environment.TMP = input.paths.temp;
	environment.TEMP = input.paths.temp;
	return environment;
}

type VersionProbeResult =
	| { status: "ok"; output: string }
	| { status: "missing" }
	| { status: "timeout" }
	| { status: "too_large" }
	| { status: "failed"; exitCode?: number | null; errorCode?: string };

async function probeCodexVersion(
	config: CodexNativeRuntimeConfig,
	environment: NodeJS.ProcessEnv,
): Promise<VersionProbeResult> {
	return await new Promise<VersionProbeResult>((resolveProbe) => {
		let child;
		try {
			const invocation = codexExecutableInvocation(config.executable, ["--version"]);
			child = spawn(invocation.command, invocation.args, { env: environment, stdio: ["ignore", "pipe", "pipe"] });
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
				child.kill("SIGKILL");
				settle({ status: "too_large" });
				return;
			}
			chunks.push(Buffer.from(chunk));
		};
		child.stdout.on("data", collect);
		child.stderr.on("data", collect);
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
			child.kill("SIGKILL");
			settle({ status: "timeout" });
		}, config.diagnosticTimeoutMs);
	});
}

type ParsedVersion = {
	version: string;
	major: number;
	minor: number;
	patch: number;
	prerelease: boolean;
};

function parseCodexVersion(output: string): ParsedVersion | undefined {
	const match = output.match(/\bcodex-cli\s+v?(\d+)\.(\d+)\.(\d+)([-+][0-9A-Za-z.-]+)?\b/);
	if (!match) return undefined;
	return {
		version: `${match[1]}.${match[2]}.${match[3]}${match[4] ?? ""}`,
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]?.startsWith("-") === true,
	};
}

function versionSupported(version: ParsedVersion): boolean {
	return !version.prerelease && version.major === 0 && version.minor === 147 && version.patch >= 0;
}

export async function diagnoseCodexNativeRuntime(
	config: CodexNativeRuntimeConfig,
	runtimeInstanceId: string,
	options: DiagnoseCodexNativeRuntimeOptions = {},
): Promise<readonly AgentRuntimeDiagnostic[]> {
	const diagnostics: AgentRuntimeDiagnostic[] = [];
	let paths: CodexNativeSessionPaths;
	try {
		paths = await prepareCodexNativeSessionPaths({
			config,
			runtimeInstanceId,
			piboSessionId: "runtime-diagnostics",
			sessionGeneration: `version-probe-${randomUUID()}`,
		});
	} catch (error) {
		const errorCode = nodeErrorCode(error);
		diagnostics.push({
			severity: "error",
			code: "codex_native_home_unavailable",
			message: `Private Codex state is unavailable for runtime instance "${runtimeInstanceId}".`,
			path: "config.homeRoot",
			...(errorCode ? { details: { errorCode } } : {}),
		});
		return diagnostics;
	}

	diagnostics.push({
		severity: "info",
		code: "codex_native_home_ready",
		message: `Private Codex state is ready for runtime instance "${runtimeInstanceId}".`,
		details: { scope: "configured-instance", private: true },
	});

	let probe: VersionProbeResult;
	try {
		probe = await probeCodexVersion(
			config,
			buildCodexNativeProcessEnvironment({
				config,
				paths,
				baseEnvironment: options.baseEnvironment ?? process.env,
			}),
		);
	} finally {
		await disposeCodexNativeSessionPaths(paths);
	}

	if (probe.status === "missing") {
		diagnostics.push({
			severity: "error",
			code: "codex_native_executable_not_found",
			message: `Codex CLI is not available for runtime instance "${runtimeInstanceId}".`,
			path: "config.executable",
		});
		return diagnostics;
	}
	if (probe.status === "timeout") {
		diagnostics.push({
			severity: "error",
			code: "codex_native_version_probe_timeout",
			message: `Codex CLI version inspection timed out for runtime instance "${runtimeInstanceId}".`,
			path: "config.diagnosticTimeoutMs",
		});
		return diagnostics;
	}
	if (probe.status === "too_large") {
		diagnostics.push({
			severity: "error",
			code: "codex_native_version_probe_too_large",
			message: `Codex CLI version inspection produced too much output for runtime instance "${runtimeInstanceId}".`,
		});
		return diagnostics;
	}
	if (probe.status === "failed") {
		diagnostics.push({
			severity: "error",
			code: "codex_native_version_probe_failed",
			message: `Codex CLI version inspection failed for runtime instance "${runtimeInstanceId}".`,
			...(probe.exitCode !== undefined || probe.errorCode
				? { details: { ...(probe.exitCode !== undefined ? { exitCode: probe.exitCode } : {}), ...(probe.errorCode ? { errorCode: probe.errorCode } : {}) } }
				: {}),
		});
		return diagnostics;
	}
	const parsed = parseCodexVersion(probe.output);
	if (!parsed) {
		diagnostics.push({
			severity: "error",
			code: "codex_native_version_unreadable",
			message: `Codex CLI returned an unrecognized version for runtime instance "${runtimeInstanceId}".`,
		});
		return diagnostics;
	}
	if (!versionSupported(parsed)) {
		diagnostics.push({
			severity: "error",
			code: "codex_native_version_unsupported",
			message: `Codex CLI ${parsed.version} is outside the supported range for runtime instance "${runtimeInstanceId}".`,
			details: { version: parsed.version, supportedRange: CODEX_APP_SERVER_SUPPORTED_RANGE },
		});
		return diagnostics;
	}
	diagnostics.push({
		severity: parsed.version === CODEX_APP_SERVER_VERSION ? "info" : "warning",
		code: parsed.version === CODEX_APP_SERVER_VERSION
			? "codex_native_available"
			: "codex_native_compatible_version",
		message: parsed.version === CODEX_APP_SERVER_VERSION
			? `Codex CLI ${parsed.version} is available for runtime instance "${runtimeInstanceId}".`
			: `Codex CLI ${parsed.version} is compatible but differs from the validated checkpoint ${CODEX_APP_SERVER_VERSION}.`,
		details: {
			version: parsed.version,
			validatedVersion: CODEX_APP_SERVER_VERSION,
			supportedRange: CODEX_APP_SERVER_SUPPORTED_RANGE,
			protocol: CODEX_APP_SERVER_PROTOCOL_NAME,
		},
	});
	return diagnostics;
}

export class CodexNativeAppServerProcess {
	private closePromise?: Promise<void>;

	constructor(
		readonly client: CodexAppServerClient,
		readonly paths: CodexNativeSessionPaths,
	) {}

	async close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = (async () => {
				try {
					await this.client.close();
				} finally {
					await disposeCodexNativeSessionPaths(this.paths);
				}
			})();
		}
		await this.closePromise;
	}
}

export async function startCodexNativeAppServer(
	input: StartCodexNativeAppServerInput,
): Promise<CodexNativeAppServerProcess> {
	if (!isAbsolute(input.workspace)) {
		throw new CodexNativeProcessError("start_failed", "Codex runtime workspace must be an absolute path.");
	}
	if (!input.clientVersion.trim()) {
		throw new CodexNativeProcessError("start_failed", "Codex App Server client version is required.");
	}
	const paths = await prepareCodexNativeSessionPaths(input);
	let client: CodexAppServerClient | undefined;
	try {
		const capabilities: CodexAppServerInitializeCapabilities = { experimentalApi: false };
		const invocation = codexExecutableInvocation(input.config.executable, [
			"app-server",
			"--stdio",
			"--strict-config",
			"-c",
			`tools.experimental_request_user_input.enabled=${input.config.experimentalUserInput}`,
			"-c",
			`features.default_mode_request_user_input=${input.config.experimentalUserInput}`,
		]);
		client = await CodexAppServerClient.start({
			command: invocation.command,
			fileCreationMask: 0o077,
			args: invocation.args,
			cwd: resolve(input.workspace),
			env: buildCodexNativeProcessEnvironment({
				config: input.config,
				paths,
				baseEnvironment: input.baseEnvironment,
				resourceEnvironment: input.resourceEnvironment,
			}),
			clientInfo: { name: "pibo", title: "Pibo", version: input.clientVersion.trim() },
			capabilities,
			startupTimeoutMs: input.config.startupTimeoutMs,
			requestTimeoutMs: input.config.requestTimeoutMs,
			shutdownTimeoutMs: input.config.shutdownTimeoutMs,
			killTimeoutMs: input.config.killTimeoutMs,
			onDiagnostic: input.onDiagnostic,
		});
		const [reportedHome, expectedHome] = await Promise.all([
			realpath(client.initializeResponse.codexHome).catch(() => resolve(client!.initializeResponse.codexHome)),
			realpath(paths.codexHome),
		]);
		if (reportedHome !== expectedHome) {
			throw new CodexNativeProcessError(
				"isolation_failed",
				`Codex App Server did not use the private home for runtime instance "${input.runtimeInstanceId}".`,
			);
		}
		return new CodexNativeAppServerProcess(client, paths);
	} catch (error) {
		await client?.close().catch(() => {});
		await disposeCodexNativeSessionPaths(paths).catch(() => {});
		if (error instanceof CodexNativeProcessError) throw error;
		throw new CodexNativeProcessError(
			"start_failed",
			`Codex App Server failed to start for runtime instance "${input.runtimeInstanceId}".`,
		);
	}
}
