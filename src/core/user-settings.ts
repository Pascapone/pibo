import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { piboHomePath } from "./pibo-home.js";
import { sanitizeTelemetryRetentionSettings, type TelemetryRetentionSettings } from "./telemetry-retention-settings.js";
import { sanitizeTelemetryStaleThresholdSettings, type TelemetryStaleThresholdSettings } from "./telemetry-staleness.js";

export const DEFAULT_USER_TIMEZONE = "UTC";
export const DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT = "Alt+Shift+A";
export const DEFAULT_PIBO_USER_SETTINGS_PATH = "user-settings.json";

export type PiboShortcutSettings = {
	webAnnotationsToggle: string;
};

export type PiboUserSettings = {
	timezone: string;
	shortcuts: PiboShortcutSettings;
	telemetryStaleThresholds: TelemetryStaleThresholdSettings;
	telemetryRetention: TelemetryRetentionSettings;
};

type PiboUserSettingsState = {
	settings?: PiboUserSettings;
};

export function loadPiboUserSettings(): PiboUserSettings {
	return sanitizeUserSettings(readState().settings);
}

export function updatePiboUserSettings(patch: Partial<PiboUserSettings>): PiboUserSettings {
	const state = readState();
	const next = sanitizeUserSettings({ ...(state.settings ?? {}), ...patch });
	state.settings = next;
	writeState(state);
	return next;
}

export function updateTelemetryRetentionLastPrunedAt(lastPrunedAt: string): PiboUserSettings {
	const current = loadPiboUserSettings();
	return updatePiboUserSettings({
		telemetryRetention: {
			...current.telemetryRetention,
			lastPrunedAt,
		},
	});
}

export function sanitizeShortcutSettings(value: unknown): PiboShortcutSettings {
	const raw = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return { webAnnotationsToggle: sanitizeShortcut(raw.webAnnotationsToggle) ?? DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT };
}

export function sanitizeShortcut(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const shortcut = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
	return shortcut && shortcut.length <= 80 ? shortcut : undefined;
}

export function sanitizeTimezone(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const timezone = value.trim();
	if (!timezone) return undefined;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone });
		return timezone;
	} catch {
		return undefined;
	}
}

function sanitizeUserSettings(value: unknown): PiboUserSettings {
	const raw = value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
	return {
		timezone: sanitizeTimezone(raw.timezone) ?? DEFAULT_USER_TIMEZONE,
		shortcuts: sanitizeShortcutSettings(raw.shortcuts),
		telemetryStaleThresholds: sanitizeTelemetryStaleThresholdSettings(raw.telemetryStaleThresholds),
		telemetryRetention: sanitizeTelemetryRetentionSettings(raw.telemetryRetention),
	};
}

function readState(): PiboUserSettingsState {
	const path = piboHomePath(DEFAULT_PIBO_USER_SETTINGS_PATH);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
		return { settings: sanitizeUserSettings(raw.settings) };
	} catch {
		return {};
	}
}

function writeState(state: PiboUserSettingsState): void {
	const path = piboHomePath(DEFAULT_PIBO_USER_SETTINGS_PATH);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}
