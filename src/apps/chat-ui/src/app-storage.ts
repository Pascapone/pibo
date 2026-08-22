import { DEFAULT_CHAT_SESSION_VIEW_ID, toolDisplayModes, type ChatSessionViewId, type ToolDisplayMode } from "./session-views/types";

const LAST_SELECTION_STORAGE_KEY = "pibo.chat.lastSelection";
const SESSION_VIEW_STORAGE_KEY = "pibo.chat.sessionView";
const COMPOSER_DRAFT_STORAGE_PREFIX = "pibo.chat.composerDraft.";
const COMPOSER_HISTORY_STORAGE_KEY = "pibo.chat.composerHistory";
const SHOW_THINKING_STORAGE_KEY = "pibo.chat.showThinking";
const EXPAND_THINKING_STORAGE_KEY = "pibo.chat.expandThinking";
const SHOW_RAW_EVENTS_STORAGE_KEY = "pibo.chat.showRawEvents";
const TOOL_DISPLAY_MODE_STORAGE_KEY = "pibo.chat.toolDisplayMode";
const SHOW_ARCHIVED_SESSIONS_STORAGE_KEY = "pibo.chat.showArchived";
const SHOW_ARCHIVED_ROOMS_STORAGE_KEY = "pibo.chat.showArchivedRooms";
const NEW_SESSION_PROFILE_STORAGE_KEY = "pibo.chat.newSessionProfile";
const NEW_SESSION_PROFILES_BY_ROOM_STORAGE_KEY = "pibo.chat.newSessionProfilesByRoom";
const COMPOSER_HISTORY_LIMIT = 100;

export type StoredSelection = {
	roomId?: string;
	piboSessionId?: string;
	sessionsByRoom?: Record<string, string>;
};

export function readStoredSelection(): StoredSelection {
	try {
		const raw = localStorage.getItem(LAST_SELECTION_STORAGE_KEY);
		if (!raw) return {};
		const value = JSON.parse(raw);
		if (!isRecord(value)) return {};
		const sessionsByRoom = isRecord(value.sessionsByRoom)
			? Object.fromEntries(
					Object.entries(value.sessionsByRoom).filter(
						(entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string" && Boolean(entry[1]),
					),
				)
			: undefined;
		return {
			roomId: typeof value.roomId === "string" && value.roomId ? value.roomId : undefined,
			piboSessionId: typeof value.piboSessionId === "string" && value.piboSessionId ? value.piboSessionId : undefined,
			...(sessionsByRoom && Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
		};
	} catch {
		return {};
	}
}

export function writeStoredSelection(selection: StoredSelection): void {
	try {
		const previous = readStoredSelection();
		const sessionsByRoom = { ...(previous.sessionsByRoom ?? {}), ...(selection.sessionsByRoom ?? {}) };
		if (selection.roomId && selection.piboSessionId) sessionsByRoom[selection.roomId] = selection.piboSessionId;
		localStorage.setItem(
			LAST_SELECTION_STORAGE_KEY,
			JSON.stringify({
				roomId: selection.roomId,
				piboSessionId: selection.piboSessionId,
				...(Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
			}),
		);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

export function removeStoredRoomSelection(roomId: string): void {
	try {
		const stored = readStoredSelection();
		if (stored.sessionsByRoom?.[roomId]) {
			const { [roomId]: _removed, ...sessionsByRoom } = stored.sessionsByRoom;
			localStorage.setItem(
				LAST_SELECTION_STORAGE_KEY,
				JSON.stringify({
					roomId: stored.roomId,
					piboSessionId: stored.piboSessionId,
					...(Object.keys(sessionsByRoom).length ? { sessionsByRoom } : {}),
				}),
			);
		}
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

export function readStoredComposerDraft(piboSessionId: string): string {
	try {
		return localStorage.getItem(COMPOSER_DRAFT_STORAGE_PREFIX + piboSessionId) ?? "";
	} catch {
		return "";
	}
}

export function writeStoredComposerDraft(piboSessionId: string, text: string): void {
	try {
		const key = COMPOSER_DRAFT_STORAGE_PREFIX + piboSessionId;
		if (text) {
			localStorage.setItem(key, text);
		} else {
			localStorage.removeItem(key);
		}
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

export function readStoredComposerHistory(): string[] {
	try {
		const raw = localStorage.getItem(COMPOSER_HISTORY_STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
			.slice(-COMPOSER_HISTORY_LIMIT);
	} catch {
		return [];
	}
}

export function appendStoredComposerHistory(text: string): void {
	const entry = text.trim();
	if (!entry) return;
	const entries = readStoredComposerHistory();
	if (entries.at(-1) === entry) return;
	try {
		localStorage.setItem(COMPOSER_HISTORY_STORAGE_KEY, JSON.stringify([...entries, entry].slice(-COMPOSER_HISTORY_LIMIT)));
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

export function readStoredSessionView(): ChatSessionViewId {
	try {
		const stored = localStorage.getItem(SESSION_VIEW_STORAGE_KEY);
		return stored === "terminal" ? "terminal" : DEFAULT_CHAT_SESSION_VIEW_ID;
	} catch {
		return DEFAULT_CHAT_SESSION_VIEW_ID;
	}
}

export function writeStoredSessionView(viewId: ChatSessionViewId): void {
	try {
		localStorage.setItem(SESSION_VIEW_STORAGE_KEY, viewId);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

export function readStoredShowThinking(): boolean {
	return readStoredBoolean(SHOW_THINKING_STORAGE_KEY, true);
}

export function writeStoredShowThinking(value: boolean): void {
	writeStoredBoolean(SHOW_THINKING_STORAGE_KEY, value);
}

export function readStoredExpandThinking(): boolean {
	return readStoredBoolean(EXPAND_THINKING_STORAGE_KEY, true);
}

export function writeStoredExpandThinking(value: boolean): void {
	writeStoredBoolean(EXPAND_THINKING_STORAGE_KEY, value);
}

export function readStoredShowRawEvents(): boolean {
	return readStoredBoolean(SHOW_RAW_EVENTS_STORAGE_KEY, false);
}

export function readStoredToolDisplayMode(): ToolDisplayMode {
	try {
		const stored = localStorage.getItem(TOOL_DISPLAY_MODE_STORAGE_KEY);
		return toolDisplayModes.includes(stored as ToolDisplayMode) ? stored as ToolDisplayMode : "default";
	} catch {
		return "default";
	}
}

export function writeStoredToolDisplayMode(value: ToolDisplayMode): void {
	try {
		localStorage.setItem(TOOL_DISPLAY_MODE_STORAGE_KEY, value);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

export function writeStoredShowRawEvents(value: boolean): void {
	writeStoredBoolean(SHOW_RAW_EVENTS_STORAGE_KEY, value);
}

export function readStoredShowArchivedSessions(): boolean {
	return readStoredBoolean(SHOW_ARCHIVED_SESSIONS_STORAGE_KEY, false);
}

export function writeStoredShowArchivedSessions(value: boolean): void {
	writeStoredBoolean(SHOW_ARCHIVED_SESSIONS_STORAGE_KEY, value);
}

export function readStoredShowArchivedRooms(): boolean {
	return readStoredBoolean(SHOW_ARCHIVED_ROOMS_STORAGE_KEY, false);
}

export function writeStoredShowArchivedRooms(value: boolean): void {
	writeStoredBoolean(SHOW_ARCHIVED_ROOMS_STORAGE_KEY, value);
}

export function readStoredNewSessionProfile(roomId?: string): string {
	try {
		if (roomId) return readStoredNewSessionProfilesByRoom()[roomId] ?? "";
		return localStorage.getItem(NEW_SESSION_PROFILE_STORAGE_KEY) ?? "";
	} catch {
		return "";
	}
}

export function removeStoredNewSessionProfile(roomId: string): void {
	try {
		const profiles = readStoredNewSessionProfilesByRoom();
		if (!profiles[roomId]) return;
		delete profiles[roomId];
		localStorage.setItem(NEW_SESSION_PROFILES_BY_ROOM_STORAGE_KEY, JSON.stringify(profiles));
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

export function writeStoredNewSessionProfile(profile: string, roomId?: string): void {
	try {
		if (!roomId) {
			localStorage.setItem(NEW_SESSION_PROFILE_STORAGE_KEY, profile);
			return;
		}
		const profiles = readStoredNewSessionProfilesByRoom();
		profiles[roomId] = profile;
		localStorage.setItem(NEW_SESSION_PROFILES_BY_ROOM_STORAGE_KEY, JSON.stringify(profiles));
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function readStoredNewSessionProfilesByRoom(): Record<string, string> {
	const raw = localStorage.getItem(NEW_SESSION_PROFILES_BY_ROOM_STORAGE_KEY);
	if (!raw) return {};
	const value: unknown = JSON.parse(raw);
	if (!isRecord(value)) return {};
	return Object.fromEntries(Object.entries(value).filter(
		(entry): entry is [string, string] => Boolean(entry[0]) && typeof entry[1] === "string" && Boolean(entry[1]),
	));
}

export function clearStoredSelection(): void {
	try {
		localStorage.removeItem(LAST_SELECTION_STORAGE_KEY);
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function readStoredBoolean(key: string, defaultValue: boolean): boolean {
	try {
		const stored = localStorage.getItem(key);
		if (stored === "true") return true;
		if (stored === "false") return false;
		return defaultValue;
	} catch {
		return defaultValue;
	}
}

function writeStoredBoolean(key: string, value: boolean): void {
	try {
		localStorage.setItem(key, String(value));
	} catch {
		// Browser storage can be unavailable in private or locked-down contexts.
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
