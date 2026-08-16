import { isAbsolute, resolve } from "node:path";
import type { PiboJsonObject } from "../../core/events.js";
import { piboHomePath } from "../../core/pibo-home.js";

const MAX_TIMEOUT_MS = 10 * 60 * 1_000;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENVIRONMENT_KEYS = new Set([
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

export const DEFAULT_CODEX_NATIVE_ENVIRONMENT_ALLOWLIST = [
	"PATH",
	"PATHEXT",
	"SystemRoot",
	"WINDIR",
	"COMSPEC",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TZ",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
] as const;

export type CodexNativeRuntimeConfig = PiboJsonObject & {
	executable: string;
	homeRoot: string;
	environmentAllowlist: string[];
	experimentalUserInput: boolean;
	diagnosticTimeoutMs: number;
	startupTimeoutMs: number;
	requestTimeoutMs: number;
	shutdownTimeoutMs: number;
	killTimeoutMs: number;
};

export const CODEX_NATIVE_RUNTIME_CONFIG_SCHEMA: PiboJsonObject = {
	type: "object",
	additionalProperties: false,
	properties: {
		executable: { type: "string", minLength: 1, default: "codex" },
		homeRoot: { type: "string", minLength: 1 },
		environmentAllowlist: {
			type: "array",
			items: { type: "string", pattern: ENVIRONMENT_KEY_PATTERN.source },
			uniqueItems: true,
		},
		experimentalUserInput: { type: "boolean", default: false },
		diagnosticTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 5_000 },
		startupTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 10_000 },
		requestTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 120_000 },
		shutdownTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 2_000 },
		killTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 500 },
	},
};

export function defaultCodexNativeRuntimeConfig(): CodexNativeRuntimeConfig {
	return {
		executable: "codex",
		homeRoot: piboHomePath("agent-runtimes", "codex-native"),
		environmentAllowlist: [...DEFAULT_CODEX_NATIVE_ENVIRONMENT_ALLOWLIST],
		experimentalUserInput: false,
		diagnosticTimeoutMs: 5_000,
		startupTimeoutMs: 10_000,
		requestTimeoutMs: 120_000,
		shutdownTimeoutMs: 2_000,
		killTimeoutMs: 500,
	};
}

function timeout(value: unknown, fallback: number, label: string): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || Number(selected) <= 0 || Number(selected) > MAX_TIMEOUT_MS) {
		throw new Error(`${label} must be a positive integer no greater than ${MAX_TIMEOUT_MS}`);
	}
	return Number(selected);
}

function environmentAllowlist(value: unknown, fallback: readonly string[]): string[] {
	const selected = value ?? fallback;
	if (!Array.isArray(selected)) throw new Error("environmentAllowlist must be an array of environment variable names");
	const result: string[] = [];
	const seen = new Set<string>();
	for (const entry of selected) {
		if (typeof entry !== "string" || !ENVIRONMENT_KEY_PATTERN.test(entry)) {
			throw new Error("environmentAllowlist entries must be valid environment variable names");
		}
		const canonical = entry.toUpperCase();
		if (RESERVED_ENVIRONMENT_KEYS.has(canonical) || canonical.startsWith("DYLD_")) {
			throw new Error(`environmentAllowlist may not include reserved key "${entry}"`);
		}
		if (seen.has(canonical)) throw new Error(`environmentAllowlist contains duplicate key "${entry}"`);
		seen.add(canonical);
		result.push(entry);
	}
	return result;
}

export function parseCodexNativeRuntimeConfig(value: PiboJsonObject): CodexNativeRuntimeConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config must be an object");
	const supported = new Set([
		"executable",
		"homeRoot",
		"environmentAllowlist",
		"experimentalUserInput",
		"diagnosticTimeoutMs",
		"startupTimeoutMs",
		"requestTimeoutMs",
		"shutdownTimeoutMs",
		"killTimeoutMs",
	]);
	const unknown = Object.keys(value).find((key) => !supported.has(key));
	if (unknown) throw new Error(`unsupported config field "${unknown}"`);

	const defaults = defaultCodexNativeRuntimeConfig();
	const executable = value.executable ?? defaults.executable;
	if (typeof executable !== "string" || !executable.trim()) throw new Error("executable must be a non-empty string");
	const homeRoot = value.homeRoot ?? defaults.homeRoot;
	if (typeof homeRoot !== "string" || !homeRoot.trim()) throw new Error("homeRoot must be a non-empty absolute path");
	if (!isAbsolute(homeRoot)) throw new Error("homeRoot must be an absolute path");

	return {
		executable: executable.trim(),
		homeRoot: resolve(homeRoot),
		environmentAllowlist: environmentAllowlist(value.environmentAllowlist, defaults.environmentAllowlist),
		experimentalUserInput: value.experimentalUserInput === undefined
			? defaults.experimentalUserInput
			: (() => {
				if (typeof value.experimentalUserInput !== "boolean") throw new Error("experimentalUserInput must be boolean");
				return value.experimentalUserInput;
			})(),
		diagnosticTimeoutMs: timeout(value.diagnosticTimeoutMs, defaults.diagnosticTimeoutMs, "diagnosticTimeoutMs"),
		startupTimeoutMs: timeout(value.startupTimeoutMs, defaults.startupTimeoutMs, "startupTimeoutMs"),
		requestTimeoutMs: timeout(value.requestTimeoutMs, defaults.requestTimeoutMs, "requestTimeoutMs"),
		shutdownTimeoutMs: timeout(value.shutdownTimeoutMs, defaults.shutdownTimeoutMs, "shutdownTimeoutMs"),
		killTimeoutMs: timeout(value.killTimeoutMs, defaults.killTimeoutMs, "killTimeoutMs"),
	};
}
