import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { piboHomePath } from "./pibo-home.js";
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
};

type PiboUserSettingsState = {
	users: Record<string, PiboUserSettings>;
};

export function loadPiboUserSettings(ownerScope: string): PiboUserSettings {
	const state = readState();
	return sanitizeUserSettings(state.users[ownerScope]);
}

export function updatePiboUserSettings(ownerScope: string, patch: Partial<PiboUserSettings>): PiboUserSettings {
	const state = readState();
	const next = sanitizeUserSettings({ ...state.users[ownerScope], ...patch });
	state.users[ownerScope] = next;
	writeState(state);
	return next;
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
	};
}

function readState(): PiboUserSettingsState {
	const path = piboHomePath(DEFAULT_PIBO_USER_SETTINGS_PATH);
	if (!existsSync(path)) return { users: {} };
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed as Record<string, unknown>
			: {};
		const rawUsers = raw.users && typeof raw.users === "object" && !Array.isArray(raw.users)
			? raw.users as Record<string, unknown>
			: {};
		const users: Record<string, PiboUserSettings> = {};
		for (const [ownerScope, settings] of Object.entries(rawUsers)) {
			users[ownerScope] = sanitizeUserSettings(settings);
		}
		return { users };
	} catch {
		return { users: {} };
	}
}

function writeState(state: PiboUserSettingsState): void {
	const path = piboHomePath(DEFAULT_PIBO_USER_SETTINGS_PATH);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}
