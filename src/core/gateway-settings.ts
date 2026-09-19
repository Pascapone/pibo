import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { piboHomePath } from "./pibo-home.js";

export const DEFAULT_GATEWAY_CONCURRENT_YIELDED_RUNS = 50;
export const DEFAULT_SESSION_CONCURRENT_YIELDED_RUNS = 10;
export const DEFAULT_GATEWAY_PROVIDER_TURNS = 100;
export const DEFAULT_ROOM_PROVIDER_TURNS = 20;
export const DEFAULT_PIBO_GATEWAY_SETTINGS_PATH = "gateway-settings.json";

export type PiboGatewaySettings = {
	maxConcurrentYieldedRuns: number;
	sessionConcurrentYieldedRuns: number;
	maxProviderTurns: number;
	providerTurnsPerRoom: number;
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
		maxProviderTurns: parsePositiveInteger(
			env.PIBO_GATEWAY_MAX_PROVIDER_TURNS,
			DEFAULT_GATEWAY_PROVIDER_TURNS,
		),
		providerTurnsPerRoom: parsePositiveInteger(
			env.PIBO_GATEWAY_MAX_PROVIDER_TURNS_PER_ROOM,
			DEFAULT_ROOM_PROVIDER_TURNS,
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
		maxConcurrentYieldedRuns: sanitizePositiveInteger(raw.maxConcurrentYieldedRuns)
			?? defaults.maxConcurrentYieldedRuns,
		sessionConcurrentYieldedRuns: sanitizePositiveInteger(raw.sessionConcurrentYieldedRuns)
			?? defaults.sessionConcurrentYieldedRuns,
		maxProviderTurns: sanitizePositiveInteger(raw.maxProviderTurns)
			?? defaults.maxProviderTurns,
		providerTurnsPerRoom: sanitizePositiveInteger(raw.providerTurnsPerRoom)
			?? defaults.providerTurnsPerRoom,
	};
}

export function sanitizePositiveInteger(value: unknown): number | undefined {
	if (typeof value !== "number" && typeof value !== "string") return undefined;
	const parsed = typeof value === "number" ? value : Number(value.trim());
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Legacy alias; the validator is a generic positive integer. */
export const sanitizeConcurrentYieldedRuns = sanitizePositiveInteger;

function parsePositiveInteger(value: string | undefined, fallback: number): number {
	return sanitizePositiveInteger(value) ?? fallback;
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
