import type { PiboRoom, PiboWebSessionNode } from "./types";

const RECENT_SESSION_ACTIVITY_SIGNAL_MS = 3_000;

export function roomNodeTooltip(room: Pick<PiboRoom, "id" | "name">): string {
	return `${room.name || "Untitled Room"}\n${room.id}`;
}

export function sessionNodeTooltip(node: PiboWebSessionNode): string {
	return `${sessionNodeTitle(node)}\n${node.piboSessionId}`;
}

export function sessionNodeTitle(node: PiboWebSessionNode): string {
	return typeof node.title === "string" && node.title ? node.title : "Untitled Session";
}

export function sessionNodeSignal(node: PiboWebSessionNode, now: number): { className: string; title: string } {
	const base = "session-signal h-2 w-2 rounded-full";
	if (node.status === "error") {
		return { className: `${base} session-signal-error`, title: (node.unreadCount ?? 0) > 0 ? "Run failed" : "Run failed (read)" };
	}
	if (node.status === "running") {
		return { className: `${base} session-signal-running`, title: "Runtime is working" };
	}
	if ((node.unreadCount ?? 0) > 0 || sessionWasRecentlyActive(node, now)) {
		return { className: `${base} session-signal-unread`, title: "New completed assistant message" };
	}
	return { className: `${base} session-signal-idle`, title: "Idle" };
}

function sessionWasRecentlyActive(node: PiboWebSessionNode, now: number): boolean {
	if (!node.lastActivityAt) return false;
	const timestamp = Date.parse(node.lastActivityAt);
	return Number.isFinite(timestamp) && now - timestamp < RECENT_SESSION_ACTIVITY_SIGNAL_MS;
}

export function nextRecentSessionSignalExpiryMs(nodes: readonly PiboWebSessionNode[], now: number): number | undefined {
	let nextMs: number | undefined;
	const visit = (node: PiboWebSessionNode) => {
		if (node.status !== "running" && node.status !== "error" && (node.unreadCount ?? 0) === 0 && node.lastActivityAt) {
			const timestamp = Date.parse(node.lastActivityAt);
			if (Number.isFinite(timestamp)) {
				const remainingMs = RECENT_SESSION_ACTIVITY_SIGNAL_MS - (now - timestamp);
				if (remainingMs > 0) nextMs = nextMs === undefined ? remainingMs : Math.min(nextMs, remainingMs);
			}
		}
		for (const child of node.children) visit(child);
	};
	for (const node of nodes) visit(node);
	return nextMs === undefined ? undefined : nextMs + 50;
}

function sessionTreeHasSession(nodes: PiboWebSessionNode[], piboSessionId: string): boolean {
	return nodes.some((node) => node.piboSessionId === piboSessionId || sessionTreeHasSession(node.children, piboSessionId));
}

export function splitSessionNodesByArchive(nodes: PiboWebSessionNode[], includeArchived = true): {
	active: PiboWebSessionNode[];
	archived: PiboWebSessionNode[];
} {
	const active: PiboWebSessionNode[] = [];
	const archived: PiboWebSessionNode[] = [];
	for (const node of nodes) {
		if (node.archived) {
			if (includeArchived) archived.push(node);
			continue;
		}

		const children = splitSessionNodesByArchive(node.children, includeArchived);
		active.push({ ...node, children: children.active });
		if (includeArchived) archived.push(...children.archived);
	}
	return { active, archived };
}

export function limitSessionNodesForSidebar(
	nodes: PiboWebSessionNode[],
	limit: number,
	selectedPiboSessionId: string | null,
): PiboWebSessionNode[] {
	if (nodes.length <= limit) return nodes;
	const visible = nodes.slice(0, limit);
	if (!selectedPiboSessionId) return visible;
	const selectedTopLevel = nodes.find((node) => node.piboSessionId === selectedPiboSessionId || sessionTreeHasSession(node.children, selectedPiboSessionId));
	if (!selectedTopLevel || visible.some((node) => node.piboSessionId === selectedTopLevel.piboSessionId)) return visible;
	return [...visible, selectedTopLevel];
}

export function findPersonalRoom(rooms: PiboRoom[]): PiboRoom | undefined {
	for (const room of rooms) {
		if (isPersonalRoom(room)) return room;
		const child = findPersonalRoom(room.children ?? []);
		if (child) return child;
	}
	return undefined;
}

export function findRoomById(rooms: PiboRoom[], roomId: string): PiboRoom | undefined {
	for (const room of rooms) {
		if (room.id === roomId) return room;
		const child = findRoomById(room.children ?? [], roomId);
		if (child) return child;
	}
	return undefined;
}

export function countUnreadRooms(rooms: readonly PiboRoom[]): number {
	return rooms.reduce((sum, room) => sum + (room.unreadCount ?? 0), 0);
}

export function splitRoomNodes(nodes: PiboRoom[]): {
	active: PiboRoom[];
	archived: PiboRoom[];
} {
	const active: PiboRoom[] = [];
	const archived: PiboRoom[] = [];
	for (const node of nodes) {
		if (isPersonalRoom(node)) {
			const children = splitRoomNodes(node.children ?? []);
			active.push(...children.active);
			archived.push(...children.archived);
			continue;
		}
		if (isArchivedRoom(node)) {
			archived.push(node);
			continue;
		}
		const children = splitRoomNodes(node.children ?? []);
		active.push({ ...node, children: children.active });
		archived.push(...children.archived);
	}
	return { active, archived };
}

export function isPersonalRoom(room: PiboRoom): boolean {
	return room.metadata.default === true;
}

export function isArchivedRoom(room: PiboRoom): boolean {
	return typeof room.metadata.chatRoomArchivedAt === "string";
}

export function formatRoomSummary(room: PiboRoom): string {
	if (room.topic && room.workspace) return `${room.topic} | ${room.workspace}`;
	if (room.topic) return room.topic;
	if (room.workspace) return room.workspace;
	return room.type;
}
