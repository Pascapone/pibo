import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { piboHomePath } from "./pibo-home.js";

export const DEFAULT_GATEWAY_CONCURRENT_YIELDED_RUNS = 50;
export const DEFAULT_SESSION_CONCURRENT_YIELDED_RUNS = 10;
export const DEFAULT_PIBO_GATEWAY_SETTINGS_PATH = "gateway-settings.json";

export type PiboGatewaySettings = {
	maxConcurrentYieldedRuns: number;
	sessionConcurrentYieldedRuns: number;
};

type PiboGatewaySettingsState = {
	settings?: PiboGatewaySettings;
};

export function loadPiboGatewaySettings(env: NodeJS.ProcessEnv = process.env): PiboGatewaySettings {
	return sanitizePiboGatewaySettings(readState().settings, env);
}

export function updatePiboGatewaySettings(
	patch: Partial<PiboGatewaySettings>,
	env: NodeJS.ProcessEnv = process.env,
): PiboGatewaySettings {
	const state = readState();
	const current = sanitizePiboGatewaySettings(state.settings, env);
	const next = sanitizePiboGatewaySettings({ ...current, ...patch }, env);
	state.settings = next;
	writeState(state);
	return next;
}

export function resolvePiboGatewaySettings(env: NodeJS.ProcessEnv = process.env): PiboGatewaySettings {
	return {
		maxConcurrentYieldedRuns: parsePositiveInteger(
			env.PIBO_GATEWAY_MAX_CONCURRENT_YIELDED_RUNS,
			DEFAULT_GATEWAY_CONCURRENT_YIELDED_RUNS,
		),
		sessionConcurrentYieldedRuns: parsePositiveInteger(
			env.PIBO_SESSION_CONCURRENT_YIELDED_RUNS,
			DEFAULT_SESSION_CONCURRENT_YIELDED_RUNS,
		),
	};
}

export function sanitizePiboGatewaySettings(
	value: unknown,
	env: NodeJS.ProcessEnv = process.env,
): PiboGatewaySettings {
	const raw = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	const defaults = resolvePiboGatewaySettings(env);
	return {
		maxConcurrentYieldedRuns: sanitizeConcurrentYieldedRuns(raw.maxConcurrentYieldedRuns)
			?? defaults.maxConcurrentYieldedRuns,
		sessionConcurrentYieldedRuns: sanitizeConcurrentYieldedRuns(raw.sessionConcurrentYieldedRuns)
			?? defaults.sessionConcurrentYieldedRuns,
	};
}

export function sanitizeConcurrentYieldedRuns(value: unknown): number | undefined {
	if (typeof value !== "number" && typeof value !== "string") return undefined;
	const parsed = typeof value === "number" ? value : Number(value.trim());
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	return sanitizeConcurrentYieldedRuns(value) ?? fallback;
}

function readState(): PiboGatewaySettingsState {
	const path = piboHomePath(DEFAULT_PIBO_GATEWAY_SETTINGS_PATH);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
		return { settings: raw.settings as PiboGatewaySettings | undefined };
	} catch {
		return {};
	}
}

function writeState(state: PiboGatewaySettingsState): void {
	const path = piboHomePath(DEFAULT_PIBO_GATEWAY_SETTINGS_PATH);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}
