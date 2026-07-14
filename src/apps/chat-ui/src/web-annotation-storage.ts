const WEB_ANNOTATIONS_CDP_URL_STORAGE_KEY = "pibo.chat.webAnnotations.cdpUrl";
const WEB_ANNOTATIONS_SELECTED_STORAGE_KEY = "pibo.chat.webAnnotations.selected";
const LEGACY_WEB_ANNOTATIONS_SELECTED_STORAGE_PREFIX = `${WEB_ANNOTATIONS_SELECTED_STORAGE_KEY}.`;
const WEB_ANNOTATIONS_OVERLAY_STORAGE_PREFIX = "pibo.chat.webAnnotations.overlay.";
const WEB_ANNOTATIONS_PANEL_COLLAPSED_STORAGE_KEY = "pibo.chat.webAnnotations.panelCollapsed";
const WEB_ANNOTATIONS_TOGGLE_SHORTCUT_STORAGE_KEY = "pibo.chat.shortcuts.webAnnotationsToggle";

export const DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT = "Alt+Shift+A";

export type WebAnnotationOverlayPanelState = {
	bindingId?: string;
	piboSessionId: string;
	installed: boolean;
	active: boolean;
	toolbarExpanded: boolean;
	mode?: string;
	reason?: string;
	updatedAt?: string;
};

export function readStoredWebAnnotationsCdpUrl(): string {
	try {
		return localStorage.getItem(WEB_ANNOTATIONS_CDP_URL_STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

export function writeStoredWebAnnotationsCdpUrl(value: string): void {
	try {
		if (value.trim()) localStorage.setItem(WEB_ANNOTATIONS_CDP_URL_STORAGE_KEY, value.trim());
		else localStorage.removeItem(WEB_ANNOTATIONS_CDP_URL_STORAGE_KEY);
	} catch {
		// Ignore storage errors in private windows or locked-down browser contexts.
	}
}

export function readStoredWebAnnotationToggleShortcut(): string {
	try {
		return localStorage.getItem(WEB_ANNOTATIONS_TOGGLE_SHORTCUT_STORAGE_KEY) || DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT;
	} catch {
		return DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT;
	}
}

export function writeStoredWebAnnotationToggleShortcut(value: string): void {
	const shortcut = normalizeShortcutLabel(value) || DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT;
	try {
		localStorage.setItem(WEB_ANNOTATIONS_TOGGLE_SHORTCUT_STORAGE_KEY, shortcut);
	} catch {
		// Ignore storage errors in private windows or locked-down browser contexts.
	}
}

export function notifyWebAnnotationShortcutChanged(shortcut: string): void {
	const targetWindow = window as typeof window & {
		__piboWebAnnotations?: { setShortcut?: (value: string) => void };
	};
	targetWindow.__piboWebAnnotations?.setShortcut?.(shortcut);
	try {
		window.dispatchEvent(new CustomEvent("pibo:web-annotation-shortcut-changed", { detail: { shortcut } }));
	} catch {
		// CustomEvent can be unavailable in very old embedded browser contexts.
	}
}

export function normalizeShortcutLabel(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
}

export function readStoredWebAnnotationOverlayState(piboSessionId: string): WebAnnotationOverlayPanelState | null {
	try {
		return parseStoredWebAnnotationOverlayState(localStorage.getItem(storedWebAnnotationOverlayStateKey(piboSessionId)));
	} catch {
		return null;
	}
}

export function storedWebAnnotationOverlayStateKey(piboSessionId: string): string {
	return WEB_ANNOTATIONS_OVERLAY_STORAGE_PREFIX + piboSessionId;
}

export function parseStoredWebAnnotationOverlayState(raw: string | null): WebAnnotationOverlayPanelState | null {
	if (!raw) return null;
	try {
		return parseWebAnnotationOverlayState(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function parseWebAnnotationOverlayState(value: unknown): WebAnnotationOverlayPanelState | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const piboSessionId = typeof record.piboSessionId === "string" ? record.piboSessionId.trim() : "";
	if (!piboSessionId) return null;
	return {
		bindingId: typeof record.bindingId === "string" ? record.bindingId : undefined,
		piboSessionId,
		installed: record.installed !== false,
		active: record.active === true,
		toolbarExpanded: record.toolbarExpanded === true,
		mode: typeof record.mode === "string" ? record.mode : undefined,
		reason: typeof record.reason === "string" ? record.reason : undefined,
		updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
	};
}

export function readStoredSelectedWebAnnotationIds(piboSessionId?: string): string[] {
	try {
		const stored = parseStoredSelectedWebAnnotationIds(localStorage.getItem(WEB_ANNOTATIONS_SELECTED_STORAGE_KEY));
		if (stored.length || !piboSessionId) return stored;
		const legacyKey = LEGACY_WEB_ANNOTATIONS_SELECTED_STORAGE_PREFIX + piboSessionId;
		const legacy = parseStoredSelectedWebAnnotationIds(localStorage.getItem(legacyKey));
		if (legacy.length) {
			localStorage.setItem(WEB_ANNOTATIONS_SELECTED_STORAGE_KEY, JSON.stringify(legacy));
			localStorage.removeItem(legacyKey);
		}
		return legacy;
	} catch {
		return [];
	}
}

export function writeStoredSelectedWebAnnotationIds(piboSessionId: string | undefined, ids: readonly string[]): void {
	try {
		const unique = [...new Set(ids.filter((id) => id.trim()))].slice(0, 5);
		if (unique.length) localStorage.setItem(WEB_ANNOTATIONS_SELECTED_STORAGE_KEY, JSON.stringify(unique));
		else localStorage.removeItem(WEB_ANNOTATIONS_SELECTED_STORAGE_KEY);
		if (piboSessionId) localStorage.removeItem(LEGACY_WEB_ANNOTATIONS_SELECTED_STORAGE_PREFIX + piboSessionId);
	} catch {
		// Ignore storage errors in private windows or locked-down browser contexts.
	}
}

function parseStoredSelectedWebAnnotationIds(raw: string | null): string[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).slice(0, 5) : [];
	} catch {
		return [];
	}
}

export function readStoredWebAnnotationsPanelCollapsed(): boolean {
	try {
		return localStorage.getItem(WEB_ANNOTATIONS_PANEL_COLLAPSED_STORAGE_KEY) === "true";
	} catch {
		return false;
	}
}

export function writeStoredWebAnnotationsPanelCollapsed(value: boolean): void {
	try {
		localStorage.setItem(WEB_ANNOTATIONS_PANEL_COLLAPSED_STORAGE_KEY, String(value));
	} catch {
		// Ignore storage errors in private windows or locked-down browser contexts.
	}
}
