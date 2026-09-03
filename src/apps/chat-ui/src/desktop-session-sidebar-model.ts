export const DESKTOP_SESSION_SIDEBAR_STORAGE_KEY = "pibo.chat.desktopSessionSidebar.v1";
export const DESKTOP_SESSION_SIDEBAR_STATE_VERSION = 1 as const;
export const DESKTOP_SESSION_SIDEBAR_MIN_WIDTH = 150;
export const DESKTOP_SESSION_SIDEBAR_MAX_WIDTH = 680;
export const DESKTOP_SESSION_SIDEBAR_DEFAULT_WIDTH = 300;
export const DESKTOP_COLLAPSED_SIDEBAR_WIDTH = 44;
export const DESKTOP_TERMINAL_MIN_WIDTH = 250;

export type DesktopSessionSidebarState = {
	version: typeof DESKTOP_SESSION_SIDEBAR_STATE_VERSION;
	width: number;
	collapsed: boolean;
};

export function emptyDesktopSessionSidebarState(): DesktopSessionSidebarState {
	return {
		version: DESKTOP_SESSION_SIDEBAR_STATE_VERSION,
		width: DESKTOP_SESSION_SIDEBAR_DEFAULT_WIDTH,
		collapsed: false,
	};
}

export function resizeDesktopSessionSidebar(
	state: DesktopSessionSidebarState,
	width: number,
): DesktopSessionSidebarState {
	return { ...state, width: clampDesktopSessionSidebarWidth(width) };
}

export function clampDesktopSessionSidebarWidth(width: number): number {
	if (!Number.isFinite(width)) return DESKTOP_SESSION_SIDEBAR_DEFAULT_WIDTH;
	return Math.round(Math.max(DESKTOP_SESSION_SIDEBAR_MIN_WIDTH, Math.min(DESKTOP_SESSION_SIDEBAR_MAX_WIDTH, width)));
}

export function serializeDesktopSessionSidebarState(state: DesktopSessionSidebarState): string {
	return JSON.stringify({
		version: DESKTOP_SESSION_SIDEBAR_STATE_VERSION,
		width: clampDesktopSessionSidebarWidth(state.width),
		collapsed: state.collapsed,
	});
}

export function parseDesktopSessionSidebarState(value: string | null | undefined): DesktopSessionSidebarState {
	if (!value) return emptyDesktopSessionSidebarState();
	try {
		const candidate = JSON.parse(value) as unknown;
		if (!isRecord(candidate) || candidate.version !== DESKTOP_SESSION_SIDEBAR_STATE_VERSION) return emptyDesktopSessionSidebarState();
		return {
			version: DESKTOP_SESSION_SIDEBAR_STATE_VERSION,
			width: clampDesktopSessionSidebarWidth(typeof candidate.width === "number" ? candidate.width : DESKTOP_SESSION_SIDEBAR_DEFAULT_WIDTH),
			collapsed: candidate.collapsed === true,
		};
	} catch {
		return emptyDesktopSessionSidebarState();
	}
}

export function readDesktopSessionSidebarState(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): DesktopSessionSidebarState {
	try {
		return parseDesktopSessionSidebarState(storage?.getItem(DESKTOP_SESSION_SIDEBAR_STORAGE_KEY));
	} catch {
		return emptyDesktopSessionSidebarState();
	}
}

export function writeDesktopSessionSidebarState(
	state: DesktopSessionSidebarState,
	storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
): void {
	try {
		storage?.setItem(DESKTOP_SESSION_SIDEBAR_STORAGE_KEY, serializeDesktopSessionSidebarState(state));
	} catch {
		// Storage can be unavailable in private or restricted browser contexts.
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
