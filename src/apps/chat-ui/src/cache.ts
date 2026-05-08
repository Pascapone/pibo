import type { BootstrapData, NavigationData, PiboSessionTraceView, PiboWebSessionNode } from "./types";

export const BOOTSTRAP_STALE_TIME_MS = 30_000;
export const BOOTSTRAP_GC_TIME_MS = 30 * 60_000;
export const TRACE_GC_TIME_MS = 30 * 60_000;
export const DEFAULT_RAW_EVENTS_LIMIT = 80;

export type SessionNavigationData = {
	roomId: string;
	piboSessionId: string;
	rooms: BootstrapData["rooms"];
	sessions: PiboWebSessionNode[];
};

export function chatBootstrapQueryKey(
	piboSessionId?: string,
	includeArchived = false,
	roomId?: string,
): readonly [string, string, string, string, string] {
	return ["chat", "bootstrap", piboSessionId ?? "", includeArchived ? "archived" : "active", roomId ?? ""];
}

export function chatSessionNavigationQueryKey(
	includeArchived = false,
	roomId?: string,
	piboSessionId?: string,
): readonly [string, string, string, string, string] {
	return ["chat", "sessions", includeArchived ? "archived" : "active", roomId ?? "", piboSessionId ?? ""];
}

export function chatTraceQueryKey(
	piboSessionId: string,
	options: { includeRawEvents?: boolean; rawEventsLimit?: number } = {},
): readonly [string, string, string, string, number] {
	return [
		"chat",
		"trace",
		piboSessionId,
		options.includeRawEvents ? "raw" : "compact",
		options.rawEventsLimit ?? DEFAULT_RAW_EVENTS_LIMIT,
	];
}

export function sessionNavigationFromBootstrap(data: NavigationData): SessionNavigationData {
	return {
		roomId: data.selectedRoomId,
		piboSessionId: data.selectedPiboSessionId,
		rooms: data.rooms,
		sessions: data.sessions,
	};
}

export function setChatNavigationCache(
	setQueryData: <T>(queryKey: readonly unknown[], data: T) => void,
	data: NavigationData,
	includeArchived = false,
	roomId?: string,
): void {
	setQueryData(chatSessionNavigationQueryKey(includeArchived, roomId ?? data.selectedRoomId, data.selectedPiboSessionId), sessionNavigationFromBootstrap(data));
}

export function traceQueriesForSession(piboSessionId: string): readonly [string, string, string] {
	return ["chat", "trace", piboSessionId];
}

export function isTraceView(value: unknown): value is PiboSessionTraceView {
	return Boolean(value && typeof value === "object" && "piboSessionId" in value && "nodes" in value);
}

export type ChatCacheMutation =
	| "send-message"
	| "slash-command"
	| "session-rename"
	| "session-archive-restore"
	| "session-delete"
	| "room-rename"
	| "room-archive-restore"
	| "room-delete"
	| "session-clone-fork"
	| "new-session"
	| "live-sse-delta";

export const chatCacheInvalidationMatrix: Record<ChatCacheMutation, readonly string[]> = {
	"send-message": ["trace", "sessions when title/status/unread/order changes"],
	"slash-command": ["trace", "bootstrap/sessions only when the action changes shell or navigation data"],
	"session-rename": ["sessions", "bootstrap when selected title is surfaced"],
	"session-archive-restore": ["sessions", "bootstrap"],
	"session-delete": ["sessions", "bootstrap", "selected trace when the deleted session is open"],
	"room-rename": ["bootstrap", "sessions"],
	"room-archive-restore": ["bootstrap", "sessions"],
	"room-delete": ["bootstrap", "sessions"],
	"session-clone-fork": ["sessions", "bootstrap", "new trace", "source trace remains reusable"],
	"new-session": ["sessions", "bootstrap", "new trace"],
	"live-sse-delta": ["trace only by default"],
};
