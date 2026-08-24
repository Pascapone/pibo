import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { piboHomePath } from "./pibo-home.js";
import type { InitialSessionContext, ModelProfile } from "./profiles.js";
import { isPiboThinkingLevel, type PiboThinkingLevel } from "./thinking.js";

export const DEFAULT_PIBO_MODEL_DEFAULTS_PATH = "model-defaults.json";

export type PiboModelDefaults = {
	main?: ModelProfile;
	subagent?: ModelProfile;
	thinking?: PiboThinkingLevel;
	mainThinking?: PiboThinkingLevel;
	subagentThinking?: PiboThinkingLevel;
	fast?: boolean;
	mainFast?: boolean;
	subagentFast?: boolean;
};

export function selectRequestedSubagentModelProfile(
	profile: InitialSessionContext,
	defaults: PiboModelDefaults = {},
): ModelProfile | undefined {
	if (profile.model) return cloneModelProfile(profile.model);
	return cloneModelProfile(profile.subagentModel ?? defaults.subagent);
}

export function selectRequestedModelProfile(
	profile: InitialSessionContext,
	defaults: PiboModelDefaults = {},
): ModelProfile | undefined {
	if (profile.parentSessionId) return selectRequestedSubagentModelProfile(profile, defaults);
	if (profile.model) return cloneModelProfile(profile.model);
	return cloneModelProfile(profile.mainModel ?? defaults.main);
}

export function selectRequestedSubagentThinkingLevel(
	profile: InitialSessionContext,
	defaults: PiboModelDefaults = {},
): PiboThinkingLevel | undefined {
	return profile.subagentThinkingLevel ?? profile.thinkingLevel ?? defaults.subagentThinking ?? defaults.thinking;
}

export function selectRequestedThinkingLevel(
	profile: InitialSessionContext,
	defaults: PiboModelDefaults = {},
): PiboThinkingLevel | undefined {
	if (profile.parentSessionId) return selectRequestedSubagentThinkingLevel(profile, defaults);
	return profile.mainThinkingLevel ?? profile.thinkingLevel ?? defaults.mainThinking ?? defaults.thinking;
}

export function selectRequestedFastMode(
	profile: InitialSessionContext,
	defaults: PiboModelDefaults = {},
): boolean | undefined {
	if (profile.parentSessionId) return profile.subagentFast ?? profile.fast ?? defaults.subagentFast ?? defaults.fast;
	return profile.mainFast ?? profile.fast ?? defaults.mainFast ?? defaults.fast;
}

export function loadPiboModelDefaults(
	cwd = process.cwd(),
	path?: string,
): PiboModelDefaults {
	const resolvedPath = path ? resolve(cwd, path) : piboHomePath(DEFAULT_PIBO_MODEL_DEFAULTS_PATH);
	if (!existsSync(resolvedPath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(resolvedPath, "utf-8")) as unknown;
		return sanitizePiboModelDefaults(parsed);
	} catch {
		return {};
	}
}

export function savePiboModelDefaults(
	defaults: PiboModelDefaults,
	cwd = process.cwd(),
	path?: string,
): PiboModelDefaults {
	const sanitized = sanitizePiboModelDefaults(defaults);
	const resolvedPath = path ? resolve(cwd, path) : piboHomePath(DEFAULT_PIBO_MODEL_DEFAULTS_PATH);
	mkdirSync(dirname(resolvedPath), { recursive: true });
	writeFileSync(resolvedPath, `${JSON.stringify(sanitized, null, 2)}\n`);
	return sanitized;
}

export function sanitizePiboModelDefaults(value: unknown): PiboModelDefaults {
	const raw = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	const sanitized: PiboModelDefaults = {};
	const main = sanitizeModelProfile(raw.main);
	const subagent = sanitizeModelProfile(raw.subagent);
	const thinking = sanitizeThinkingLevel(raw.thinking);
	const mainThinking = sanitizeThinkingLevel(raw.mainThinking);
	const subagentThinking = sanitizeThinkingLevel(raw.subagentThinking);
	const fast = sanitizeBoolean(raw.fast);
	const mainFast = sanitizeBoolean(raw.mainFast);
	const subagentFast = sanitizeBoolean(raw.subagentFast);
	if (main) sanitized.main = main;
	if (subagent) sanitized.subagent = subagent;
	if (thinking) sanitized.thinking = thinking;
	if (mainThinking) sanitized.mainThinking = mainThinking;
	if (subagentThinking) sanitized.subagentThinking = subagentThinking;
	if (fast !== undefined) sanitized.fast = fast;
	if (mainFast !== undefined) sanitized.mainFast = mainFast;
	if (subagentFast !== undefined) sanitized.subagentFast = subagentFast;
	return sanitized;
}

export function sanitizeThinkingLevel(value: unknown): PiboThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	return isPiboThinkingLevel(value) ? value : undefined;
}

export function sanitizeModelProfile(value: unknown): ModelProfile | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const raw = value as Record<string, unknown>;
	if (typeof raw.provider !== "string" || typeof raw.id !== "string") return undefined;
	const provider = raw.provider.trim();
	const id = raw.id.trim();
	if (!provider || !id) return undefined;
	return { provider, id };
}

function cloneModelProfile(model: ModelProfile | undefined): ModelProfile | undefined {
	return model ? { ...model } : undefined;
}

function sanitizeBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}
