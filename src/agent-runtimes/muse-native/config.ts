import { isAbsolute, resolve } from "node:path";
import type { PiboJsonObject } from "../../core/events.js";
import { piboHomePath } from "../../core/pibo-home.js";

const MAX_TIMEOUT_MS = 10 * 60 * 1_000;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENVIRONMENT_KEYS = new Set([
	"MUSE_EXPERIMENTAL_SDK_ENABLED",
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

export const DEFAULT_MUSE_NATIVE_ENVIRONMENT_ALLOWLIST = [
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

export const MUSE_NATIVE_APPROVAL_MODES = ["allowAll", "promptUnmatched", "onRequest", "denyUnmatched"] as const;
export type MuseNativeApprovalMode = (typeof MUSE_NATIVE_APPROVAL_MODES)[number];

export type MuseNativeRuntimeConfig = PiboJsonObject & {
	executable: string;
	homeRoot: string;
	environmentAllowlist: string[];
	approvalMode: MuseNativeApprovalMode;
	experimentalSdkGate: boolean;
	diagnosticTimeoutMs: number;
	startupTimeoutMs: number;
	requestTimeoutMs: number;
	shutdownTimeoutMs: number;
};

export const MUSE_NATIVE_RUNTIME_CONFIG_SCHEMA: PiboJsonObject = {
	type: "object",
	additionalProperties: false,
	properties: {
		executable: { type: "string", minLength: 1, default: "muse" },
		homeRoot: { type: "string", minLength: 1 },
		environmentAllowlist: {
			type: "array",
			items: { type: "string", pattern: ENVIRONMENT_KEY_PATTERN.source },
			uniqueItems: true,
		},
		approvalMode: { type: "string", enum: [...MUSE_NATIVE_APPROVAL_MODES], default: "onRequest" },
		experimentalSdkGate: { type: "boolean", default: true },
		diagnosticTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 5_000 },
		startupTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 10_000 },
		requestTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 120_000 },
		shutdownTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 2_000 },
	},
};

export function defaultMuseNativeRuntimeConfig(): MuseNativeRuntimeConfig {
	return {
		executable: "muse",
		homeRoot: piboHomePath("agent-runtimes", "muse-native"),
		environmentAllowlist: [...DEFAULT_MUSE_NATIVE_ENVIRONMENT_ALLOWLIST],
		approvalMode: "onRequest",
		experimentalSdkGate: true,
		diagnosticTimeoutMs: 5_000,
		startupTimeoutMs: 10_000,
		requestTimeoutMs: 120_000,
		shutdownTimeoutMs: 2_000,
	};
}

function timeout(value: unknown, fallback: number, label: string, maximum = MAX_TIMEOUT_MS): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || Number(selected) <= 0 || Number(selected) > maximum) {
		throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
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

export function parseMuseNativeRuntimeConfig(value: PiboJsonObject): MuseNativeRuntimeConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config must be an object");
	const supported = new Set([
		"executable",
		"homeRoot",
		"environmentAllowlist",
		"approvalMode",
		"experimentalSdkGate",
		"diagnosticTimeoutMs",
		"startupTimeoutMs",
		"requestTimeoutMs",
		"shutdownTimeoutMs",
	]);
	const unknown = Object.keys(value).find((key) => !supported.has(key));
	if (unknown) throw new Error(`unsupported config field "${unknown}"`);

	const defaults = defaultMuseNativeRuntimeConfig();
	const executable = value.executable ?? defaults.executable;
	if (typeof executable !== "string" || !executable.trim()) throw new Error("executable must be a non-empty string");
	const homeRoot = value.homeRoot ?? defaults.homeRoot;
	if (typeof homeRoot !== "string" || !homeRoot.trim()) throw new Error("homeRoot must be a non-empty absolute path");
	if (!isAbsolute(homeRoot)) throw new Error("homeRoot must be an absolute path");
	const approvalMode = value.approvalMode ?? defaults.approvalMode;
	if (typeof approvalMode !== "string" || !MUSE_NATIVE_APPROVAL_MODES.includes(approvalMode as MuseNativeApprovalMode)) {
		throw new Error(`approvalMode must be one of ${MUSE_NATIVE_APPROVAL_MODES.join(", ")}`);
	}
	const experimentalSdkGate = value.experimentalSdkGate ?? defaults.experimentalSdkGate;
	if (typeof experimentalSdkGate !== "boolean") throw new Error("experimentalSdkGate must be boolean");

	return {
		executable: executable.trim(),
		homeRoot: resolve(homeRoot),
		environmentAllowlist: environmentAllowlist(value.environmentAllowlist, defaults.environmentAllowlist),
		approvalMode: approvalMode as MuseNativeApprovalMode,
		experimentalSdkGate,
		diagnosticTimeoutMs: timeout(value.diagnosticTimeoutMs, defaults.diagnosticTimeoutMs, "diagnosticTimeoutMs"),
		startupTimeoutMs: timeout(value.startupTimeoutMs, defaults.startupTimeoutMs, "startupTimeoutMs"),
		requestTimeoutMs: timeout(value.requestTimeoutMs, defaults.requestTimeoutMs, "requestTimeoutMs"),
		shutdownTimeoutMs: timeout(value.shutdownTimeoutMs, defaults.shutdownTimeoutMs, "shutdownTimeoutMs"),
	};
}
