import type { BootstrapData, NavigationData, PiboRoom, PiboWebSessionNode } from "./types";

export function mergeNavigationIntoBootstrap(
	current: BootstrapData,
	navigation: NavigationData,
	options: { readSessionId?: string } = {},
): BootstrapData {
	const readSessionIds = options.readSessionId ? collectSessionSubtreeIds(current.sessions, options.readSessionId) : new Set<string>();
	const previousUnreadBySessionId = new Map<string, number>();
	collectSessionUnreadCounts(current.sessions, previousUnreadBySessionId);
	const clearedUnreadCount = [...readSessionIds].reduce((sum, sessionId) => sum + (previousUnreadBySessionId.get(sessionId) ?? 0), 0);
	return {
		...current,
		identity: navigation.identity,
		session: navigation.session,
		room: navigation.room,
		selectedRoomId: navigation.selectedRoomId,
		selectedPiboSessionId: navigation.selectedPiboSessionId,
		latestRoomStreamId: navigation.latestRoomStreamId,
		rooms: mergeNavigationRooms(current.rooms, navigation.rooms, navigation.selectedRoomId, clearedUnreadCount),
		sessions: mergeNavigationSessions(navigation.sessions, readSessionIds, previousUnreadBySessionId),
	};
}

function collectSessionUnreadCounts(sessions: readonly PiboWebSessionNode[], output: Map<string, number>): void {
	for (const session of sessions) {
		output.set(session.piboSessionId, session.unreadCount ?? 0);
		collectSessionUnreadCounts(session.children, output);
	}
}

function collectSessionSubtreeIds(sessions: readonly PiboWebSessionNode[], rootSessionId: string): Set<string> {
	const ids = new Set<string>();
	const visit = (session: PiboWebSessionNode): boolean => {
		if (session.piboSessionId === rootSessionId) {
			collectAllSessionIds(session, ids);
			return true;
		}
		return session.children.some((child) => visit(child));
	};
	for (const session of sessions) visit(session);
	return ids;
}

function collectAllSessionIds(session: PiboWebSessionNode, output: Set<string>): void {
	output.add(session.piboSessionId);
	for (const child of session.children) collectAllSessionIds(child, output);
}

function mergeNavigationSessions(
	next: readonly PiboWebSessionNode[],
	readSessionIds: ReadonlySet<string>,
	previousUnreadBySessionId: ReadonlyMap<string, number>,
): PiboWebSessionNode[] {
	return next.map((session) => {
		const preservedUnread = previousUnreadBySessionId.get(session.piboSessionId);
		const unreadCount = readSessionIds.has(session.piboSessionId) ? 0 : (session.unreadCount ?? preservedUnread ?? 0);
		return {
			...session,
			...(unreadCount > 0 ? { unreadCount } : { unreadCount: undefined }),
			children: mergeNavigationSessions(session.children, readSessionIds, previousUnreadBySessionId),
		};
	});
}

function mergeNavigationRooms(
	current: readonly PiboRoom[],
	next: readonly PiboRoom[],
	selectedRoomId: string | undefined,
	clearedUnreadCount: number,
): PiboRoom[] {
	const previousUnreadByRoomId = new Map<string, number>();
	collectRoomUnreadCounts(current, previousUnreadByRoomId);
	return mergeRoomNodes(next, previousUnreadByRoomId, selectedRoomId, clearedUnreadCount).rooms;
}

function collectRoomUnreadCounts(rooms: readonly PiboRoom[], output: Map<string, number>): void {
	for (const room of rooms) {
		output.set(room.id, room.unreadCount ?? 0);
		collectRoomUnreadCounts(room.children ?? [], output);
	}
}

function mergeRoomNodes(
	rooms: readonly PiboRoom[],
	previousUnreadByRoomId: ReadonlyMap<string, number>,
	selectedRoomId: string | undefined,
	clearedUnreadCount: number,
): { rooms: PiboRoom[]; selectedRoomFound: boolean } {
	let selectedRoomFound = false;
	const merged = rooms.map((room) => {
		const childResult = mergeRoomNodes(room.children ?? [], previousUnreadByRoomId, selectedRoomId, clearedUnreadCount);
		const roomContainsSelection = room.id === selectedRoomId || childResult.selectedRoomFound;
		selectedRoomFound = selectedRoomFound || roomContainsSelection;
		const preservedUnread = room.unreadCount ?? previousUnreadByRoomId.get(room.id) ?? 0;
		const unreadCount = roomContainsSelection && clearedUnreadCount > 0 ? Math.max(0, preservedUnread - clearedUnreadCount) : preservedUnread;
		return {
			...room,
			...(unreadCount > 0 ? { unreadCount } : { unreadCount: undefined }),
			...(room.children ? { children: childResult.rooms } : {}),
		};
	});
	return { rooms: merged, selectedRoomFound };
}

export function appendSessionRoots(current: PiboWebSessionNode[], next: PiboWebSessionNode[]): PiboWebSessionNode[] {
	if (!next.length) return current;
	const seen = new Set(current.map((session) => session.piboSessionId));
	const appended = next.filter((session) => !seen.has(session.piboSessionId));
	return appended.length ? [...current, ...appended] : current;
}
