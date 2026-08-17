import { piboHomePath } from "../../core/pibo-home.js";
import type { PiboJsonObject } from "../../core/events.js";

const MAX_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_AUTH_LOGIN_TIMEOUT_MS = 30 * 60 * 1_000;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_ENVIRONMENT_KEYS = new Set([
	"PI_CODING_AGENT_DIR",
	"PI_CONFIG_DIR",
	"OMP_PROFILE",
	"PI_PROFILE",
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

export const DEFAULT_OMP_ENVIRONMENT_ALLOWLIST = [
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

/**
 * Pibo does not know the real key names OMP's model catalog reads (it supports
 * many providers and custom `models.yml` baseUrl/apiKey pairs). We allow an
 * operator to add the specific provider keys (e.g. `OPENAI_API_KEY`,
 * `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`) plus any custom
 * keys via the config `apiKeyEnv` allowlist. These names are validated at parse
 * time so a typo fails fast.
 */
export const DEFAULT_OMP_API_KEY_ENVIRONMENT_KEYS = [
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"GEMINI_API_KEY",
	"DEEPSEEK_API_KEY",
	"OPENROUTER_API_KEY",
	"GROQ_API_KEY",
	"MISTRAL_API_KEY",
	"COHERE_API_KEY",
	"PERPLEXITY_API_KEY",
	"XAI_API_KEY",
	"OMP_DEFAULT_API_KEY",
] as const;

export type OmpRuntimeConfig = PiboJsonObject & {
	/** Bun executable used to spawn the OMP CLI. */
	bunExecutable: string;
	/** Path to the OMP CLI entry (`src/cli.ts`, a bundled `dist/cli.js`, or an `omp` launcher script). */
	ompEntry: string;
	/** Pibo-owned root under which isolated per-instance `PI_CODING_AGENT_DIR` homes are created. */
	homeRoot: string;
	/** Env key names OMP may inherit from the Pibo process (proxy/locale/SSH). */
	environmentAllowlist: string[];
	/** Provider API-key env names OMP may read (OPENAI_API_KEY, etc.). */
	apiKeyEnvironment: string[];
	/** Default provider/model to select when the profile does not pin one. */
	defaultProvider?: string;
	defaultModel?: string;
	diagnosticTimeoutMs: number;
	startupTimeoutMs: number;
	requestTimeoutMs: number;
	authLoginTimeoutMs: number;
	shutdownTimeoutMs: number;
	killTimeoutMs: number;
};

export const OMP_RUNTIME_CONFIG_SCHEMA: PiboJsonObject = {
	type: "object",
	additionalProperties: false,
	properties: {
		bunExecutable: { type: "string", minLength: 1, default: "bun" },
		ompEntry: { type: "string", minLength: 1 },
		homeRoot: { type: "string", minLength: 1 },
		environmentAllowlist: {
			type: "array",
			items: { type: "string", pattern: ENVIRONMENT_KEY_PATTERN.source },
			uniqueItems: true,
		},
		apiKeyEnvironment: {
			type: "array",
			items: { type: "string", pattern: ENVIRONMENT_KEY_PATTERN.source },
			uniqueItems: true,
		},
		defaultProvider: { type: "string", minLength: 1 },
		defaultModel: { type: "string", minLength: 1 },
		diagnosticTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 5_000 },
		startupTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 15_000 },
		requestTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 180_000 },
		authLoginTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_AUTH_LOGIN_TIMEOUT_MS, default: 15 * 60 * 1_000 },
		shutdownTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 2_000 },
		killTimeoutMs: { type: "integer", minimum: 1, maximum: MAX_TIMEOUT_MS, default: 500 },
	},
};

export function defaultOmpRuntimeConfig(): OmpRuntimeConfig {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const cfg = {} as OmpRuntimeConfig;
	return {
		bunExecutable: "bun",
		ompEntry: "", // operator must supply the OMP install path
		homeRoot: piboHomePath("agent-runtimes", "omp"),
		environmentAllowlist: [...DEFAULT_OMP_ENVIRONMENT_ALLOWLIST],
		apiKeyEnvironment: [...DEFAULT_OMP_API_KEY_ENVIRONMENT_KEYS],
		diagnosticTimeoutMs: 5_000,
		startupTimeoutMs: 15_000,
		requestTimeoutMs: 180_000,
		authLoginTimeoutMs: 15 * 60 * 1_000,
		shutdownTimeoutMs: 2_000,
		killTimeoutMs: 500,
	};
}

function timeout(value: unknown, fallback: number, label: string, maximum = MAX_TIMEOUT_MS): number {
	const selected = value ?? fallback;
	if (!Number.isSafeInteger(selected) || Number(selected) <= 0 || Number(selected) > maximum) {
		throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
	}
	return Number(selected);
}

function stringAllowlist(
	value: unknown,
	fallback: readonly string[],
	label: string,
	reject?: ReadonlySet<string>,
): string[] {
	const selected = value ?? fallback;
	if (!Array.isArray(selected)) throw new Error(`${label} must be an array of environment variable names`);
	const result: string[] = [];
	const seen = new Set<string>();
	for (const entry of selected) {
		if (typeof entry !== "string" || !ENVIRONMENT_KEY_PATTERN.test(entry)) {
			throw new Error(`${label} entries must be valid environment variable names`);
		}
		const canonical = entry.toUpperCase();
		if (reject?.has(canonical) || canonical.startsWith("DYLD_")) {
			throw new Error(`${label} may not include reserved key "${entry}"`);
		}
		if (seen.has(canonical)) throw new Error(`${label} contains duplicate key "${entry}"`);
		seen.add(canonical);
		result.push(entry);
	}
	return result;
}

function nonEmptyString(value: unknown, fallback: string, label: string): string {
	const selected = value ?? fallback;
	if (typeof selected !== "string" || selected.trim().length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return selected.trim();
}


/**
 * Resolve the OMP CLI entry. An empty value means "not yet configured" (the
 * operator supplies it via runtime-instance config); diagnose() surfaces that.
 * A non-empty value MUST be an absolute path — resolving it against the session
 * workspace would silently target the wrong executable.
 */
function absolutePathOrEmpty(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		return "";
	}
	const candidate = value.trim();
	if (!(candidate.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(candidate))) {
		throw new Error(label + " must be an absolute path to the OMP CLI entry; got \"" + candidate + "\"");
	}
	return candidate;
}

export function parseOmpRuntimeConfig(value: PiboJsonObject): OmpRuntimeConfig {
	const record = value ?? {};
	const provider = optionalString(record.defaultProvider);
	const model = optionalString(record.defaultModel);
	const config: OmpRuntimeConfig = {
		bunExecutable: nonEmptyString(record.bunExecutable, "bun", "bunExecutable"),
		ompEntry: absolutePathOrEmpty(record.ompEntry, "ompEntry"),
		homeRoot: nonEmptyString(record.homeRoot, piboHomePath("agent-runtimes", "omp"), "homeRoot"),
		environmentAllowlist: stringAllowlist(
			record.environmentAllowlist,
			DEFAULT_OMP_ENVIRONMENT_ALLOWLIST,
			"environmentAllowlist",
			RESERVED_ENVIRONMENT_KEYS,
		),
		apiKeyEnvironment: stringAllowlist(
			record.apiKeyEnvironment,
			DEFAULT_OMP_API_KEY_ENVIRONMENT_KEYS,
			"apiKeyEnvironment",
			RESERVED_ENVIRONMENT_KEYS,
		),
		diagnosticTimeoutMs: timeout(record.diagnosticTimeoutMs, 5_000, "diagnosticTimeoutMs"),
		startupTimeoutMs: timeout(record.startupTimeoutMs, 15_000, "startupTimeoutMs"),
		requestTimeoutMs: timeout(record.requestTimeoutMs, 180_000, "requestTimeoutMs"),
		authLoginTimeoutMs: timeout(
			record.authLoginTimeoutMs,
			15 * 60 * 1_000,
			"authLoginTimeoutMs",
			MAX_AUTH_LOGIN_TIMEOUT_MS,
		),
		shutdownTimeoutMs: timeout(record.shutdownTimeoutMs, 2_000, "shutdownTimeoutMs"),
		killTimeoutMs: timeout(record.killTimeoutMs, 500, "killTimeoutMs"),
	};
	if (provider !== undefined) config.defaultProvider = provider;
	if (model !== undefined) config.defaultModel = model;
	return config;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

