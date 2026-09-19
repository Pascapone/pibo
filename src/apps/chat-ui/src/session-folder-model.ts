import type { PiboSignalStatusSnapshot, PiboWebSessionNode } from "./types";

export const SESSION_FOLDER_STATE_STORAGE_KEY = "pibo.chat.sessionFolderSidebar.v1";
export const SESSION_FOLDER_STATE_VERSION = 1 as const;
export const SESSION_FOLDER_PAGE_SIZE = 25;
export const SESSION_FOLDER_PREVIEW_LIMIT = 8;

export type SessionFolderState = {
	version: typeof SESSION_FOLDER_STATE_VERSION;
	expandedRoomIds: string[];
	pinnedSessionsOnly: boolean;
};

export function emptySessionFolderState(): SessionFolderState {
	return {
		version: SESSION_FOLDER_STATE_VERSION,
		expandedRoomIds: [],
		pinnedSessionsOnly: false,
	};
}

export function isRoomExpandedInFolder(state: SessionFolderState, roomId: string): boolean {
	return state.expandedRoomIds.includes(roomId);
}

export function expandRoomInFolder(state: SessionFolderState, roomId: string | null | undefined): SessionFolderState {
	if (!roomId || state.expandedRoomIds.includes(roomId)) return state;
	return { ...state, expandedRoomIds: [...state.expandedRoomIds, roomId] };
}

export function toggleRoomExpandedInFolder(state: SessionFolderState, roomId: string): SessionFolderState {
	return isRoomExpandedInFolder(state, roomId)
		? { ...state, expandedRoomIds: state.expandedRoomIds.filter((candidate) => candidate !== roomId) }
		: { ...state, expandedRoomIds: [...state.expandedRoomIds, roomId] };
}

export function serializeSessionFolderState(state: SessionFolderState): string {
	return JSON.stringify({
		version: SESSION_FOLDER_STATE_VERSION,
		expandedRoomIds: state.expandedRoomIds.filter((roomId) => typeof roomId === "string"),
		pinnedSessionsOnly: state.pinnedSessionsOnly === true,
	});
}

export function parseSessionFolderState(value: string | null | undefined): SessionFolderState {
	if (!value) return emptySessionFolderState();
	try {
		const candidate = JSON.parse(value) as unknown;
		if (!isRecord(candidate) || candidate.version !== SESSION_FOLDER_STATE_VERSION) return emptySessionFolderState();
		return {
			version: SESSION_FOLDER_STATE_VERSION,
			expandedRoomIds: Array.isArray(candidate.expandedRoomIds)
				? candidate.expandedRoomIds.filter((roomId): roomId is string => typeof roomId === "string")
				: [],
			pinnedSessionsOnly: candidate.pinnedSessionsOnly === true,
		};
	} catch {
		return emptySessionFolderState();
	}
}

export function readSessionFolderState(storage: Pick<Storage, "getItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage): SessionFolderState {
	try {
		return parseSessionFolderState(storage?.getItem(SESSION_FOLDER_STATE_STORAGE_KEY));
	} catch {
		return emptySessionFolderState();
	}
}

export function writeSessionFolderState(
	state: SessionFolderState,
	storage: Pick<Storage, "setItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
): void {
	try {
		storage?.setItem(SESSION_FOLDER_STATE_STORAGE_KEY, serializeSessionFolderState(state));
	} catch {
		// Storage can be unavailable in private or restricted browser contexts.
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function filterFolderSessions<T extends Pick<PiboWebSessionNode, "pinned">>(sessions: readonly T[], pinnedSessionsOnly: boolean): readonly T[] {
	if (!pinnedSessionsOnly) return sessions;
	return sessions.filter((session) => session.pinned === true);
}

export function applyFolderStatusOverlay(
	nodes: PiboWebSessionNode[],
	snapshot: PiboSignalStatusSnapshot | null | undefined,
): PiboWebSessionNode[] {
	if (!snapshot) return nodes;
	return nodes.map((node) => overlayFolderNodeStatus(node, snapshot));
}

function overlayFolderNodeStatus(node: PiboWebSessionNode, snapshot: PiboSignalStatusSnapshot): PiboWebSessionNode {
	const update = snapshot.sessions[node.piboSessionId];
	const status = acknowledgedFolderStatus(update?.status, update?.isTreeActive, folderSubtreeUnreadCount(node));
	const children = node.children.map((child) => overlayFolderNodeStatus(child, snapshot));
	if ((!status || status === node.status) && children.every((child, index) => child === node.children[index])) return node;
	return { ...node, status: status ?? node.status, children };
}

function acknowledgedFolderStatus(
	status: PiboWebSessionNode["status"] | undefined,
	isTreeActive: boolean | undefined,
	unreadCount: number,
): PiboWebSessionNode["status"] | undefined {
	if (isTreeActive) return "running";
	if (status !== "error") return status;
	return unreadCount > 0 ? "error" : "idle";
}

function folderSubtreeUnreadCount(node: PiboWebSessionNode): number {
	return (node.unreadCount ?? 0) + node.children.reduce((sum, child) => sum + folderSubtreeUnreadCount(child), 0);
}
