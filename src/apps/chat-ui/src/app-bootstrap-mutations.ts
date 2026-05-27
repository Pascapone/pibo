import type { QueryClient } from "@tanstack/react-query";
import type { BootstrapData, PiboRoom, PiboSession, PiboWebSessionNode } from "./types";
import { findRoomById, sessionNodeTitle } from "./session-sidebar-helpers";

export type BootstrapMutationSnapshot = {
	localBootstrap: BootstrapData | null;
	queryData: Array<[readonly unknown[], BootstrapData | undefined]>;
};

export function createBootstrapMutationSnapshot(queryClient: QueryClient, localBootstrap: BootstrapData | null): BootstrapMutationSnapshot {
	return {
		localBootstrap,
		queryData: queryClient.getQueriesData<BootstrapData>({ queryKey: ["chat", "bootstrap"] }),
	};
}

export function addSessionNodeToBootstrap(data: BootstrapData, node: PiboWebSessionNode): BootstrapData {
	if (findSessionNode(data.sessions, node.piboSessionId)) return data;
	return { ...data, sessions: [node, ...data.sessions] };
}

export function removeSessionsFromBootstrap(data: BootstrapData, piboSessionIds: ReadonlySet<string>): BootstrapData {
	const sessions = removeSessionNodes(data.sessions, piboSessionIds);
	const selectedDeleted = piboSessionIds.has(data.selectedPiboSessionId);
	return {
		...data,
		selectedPiboSessionId: selectedDeleted ? "" : data.selectedPiboSessionId,
		sessions,
	};
}

function removeSessionNodes(nodes: PiboWebSessionNode[], piboSessionIds: ReadonlySet<string>): PiboWebSessionNode[] {
	let changed = false;
	const next: PiboWebSessionNode[] = [];
	for (const node of nodes) {
		if (piboSessionIds.has(node.piboSessionId)) {
			changed = true;
			continue;
		}
		const children = removeSessionNodes(node.children, piboSessionIds);
		if (children !== node.children) {
			changed = true;
			next.push({ ...node, children });
		} else {
			next.push(node);
		}
	}
	return changed ? next : nodes;
}

export function sessionSubtreeIds(node: PiboWebSessionNode): Set<string> {
	const ids = new Set<string>([node.piboSessionId]);
	for (const child of node.children) {
		for (const id of sessionSubtreeIds(child)) ids.add(id);
	}
	return ids;
}

export function replaceOptimisticSessionNode(
	data: BootstrapData,
	tempId: string | undefined,
	node: PiboWebSessionNode,
): BootstrapData {
	if (!tempId) return addSessionNodeToBootstrap(data, node);
	let replaced = false;
	const sessions = replaceSessionNode(data.sessions, tempId, () => {
		replaced = true;
		return node;
	});
	return {
		...data,
		selectedPiboSessionId: data.selectedPiboSessionId === tempId ? node.piboSessionId : data.selectedPiboSessionId,
		session: data.session.id === tempId ? piboSessionFromSessionNode(node, data.session) : data.session,
		sessions: replaced ? sessions : [node, ...sessions],
	};
}

export function updateSessionFromPiboSession(data: BootstrapData, session: PiboSession): BootstrapData {
	const archived = typeof session.metadata?.chatWebArchivedAt === "string";
	return {
		...data,
		session: data.session.id === session.id ? session : data.session,
		sessions: replaceSessionNode(data.sessions, session.id, (node) => ({
			...node,
			profile: session.profile,
			activeModel: session.activeModel,
			title: session.title || node.title || "Untitled Session",
			archived,
		})),
	};
}

export function updateSessionNodeInBootstrap(
	data: BootstrapData,
	piboSessionId: string,
	updater: (node: PiboWebSessionNode) => PiboWebSessionNode,
): BootstrapData {
	const session = data.session.id === piboSessionId ? piboSessionFromSessionNode(updater(sessionNodeFromSession(data.session)), data.session) : data.session;
	return { ...data, session, sessions: replaceSessionNode(data.sessions, piboSessionId, updater) };
}

export function addRoomToBootstrap(data: BootstrapData, room: PiboRoom): BootstrapData {
	if (findRoomById(data.rooms, room.id)) return data;
	return {
		...data,
		room,
		selectedRoomId: room.id,
		selectedPiboSessionId: "",
		rooms: [room, ...data.rooms],
	};
}

export function replaceRoomInBootstrap(data: BootstrapData, roomId: string, room: PiboRoom): BootstrapData {
	return {
		...data,
		room: data.room?.id === roomId ? room : data.room,
		selectedRoomId: data.selectedRoomId === roomId ? room.id : data.selectedRoomId,
		rooms: replaceRoomNode(data.rooms, roomId, () => room),
	};
}

export function updateRoomInBootstrap(data: BootstrapData, roomId: string, updater: (room: PiboRoom) => PiboRoom): BootstrapData {
	return {
		...data,
		room: data.room?.id === roomId ? updater(data.room) : data.room,
		rooms: replaceRoomNode(data.rooms, roomId, updater),
	};
}

export function removeRoomsFromBootstrap(data: BootstrapData, roomIds: ReadonlySet<string>): BootstrapData {
	const selectedDeleted = roomIds.has(data.selectedRoomId);
	return {
		...data,
		room: data.room && roomIds.has(data.room.id) ? undefined : data.room,
		selectedRoomId: selectedDeleted ? "" : data.selectedRoomId,
		selectedPiboSessionId: selectedDeleted ? "" : data.selectedPiboSessionId,
		rooms: removeRoomNodes(data.rooms, roomIds),
	};
}

function replaceRoomNode(nodes: PiboRoom[], roomId: string, updater: (room: PiboRoom) => PiboRoom): PiboRoom[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.id === roomId) {
			changed = true;
			return updater(node);
		}
		const originalChildren = node.children ?? [];
		const children = replaceRoomNode(originalChildren, roomId, updater);
		if (children === originalChildren) return node;
		changed = true;
		return { ...node, children };
	});
	return changed ? next : nodes;
}

function removeRoomNodes(nodes: PiboRoom[], roomIds: ReadonlySet<string>): PiboRoom[] {
	let changed = false;
	const next: PiboRoom[] = [];
	for (const node of nodes) {
		if (roomIds.has(node.id)) {
			changed = true;
			continue;
		}
		const originalChildren = node.children ?? [];
		const children = removeRoomNodes(originalChildren, roomIds);
		if (children !== originalChildren) {
			changed = true;
			next.push({ ...node, children });
		} else {
			next.push(node);
		}
	}
	return changed ? next : nodes;
}

export function createOptimisticRoom(id: string, userId: string, name: string): PiboRoom {
	const now = new Date().toISOString();
	return {
		id,
		ownerScope: `user:${userId}`,
		name,
		type: "chat",
		createdAt: now,
		updatedAt: now,
		metadata: {},
		children: [],
	};
}

export function roomWithArchivedState(room: PiboRoom, archived: boolean): PiboRoom {
	const metadata = { ...room.metadata };
	if (archived) metadata.chatRoomArchivedAt = new Date().toISOString();
	else delete metadata.chatRoomArchivedAt;
	return { ...room, metadata, updatedAt: new Date().toISOString() };
}

export function roomSubtreeIds(room: PiboRoom): Set<string> {
	const ids = new Set<string>([room.id]);
	for (const child of room.children ?? []) {
		for (const id of roomSubtreeIds(child)) ids.add(id);
	}
	return ids;
}

function replaceSessionNode(
	nodes: PiboWebSessionNode[],
	piboSessionId: string,
	updater: (node: PiboWebSessionNode) => PiboWebSessionNode,
): PiboWebSessionNode[] {
	let changed = false;
	const next = nodes.map((node) => {
		if (node.piboSessionId === piboSessionId) {
			changed = true;
			return updater(node);
		}
		const children = replaceSessionNode(node.children, piboSessionId, updater);
		if (children === node.children) return node;
		changed = true;
		return { ...node, children };
	});
	return changed ? next : nodes;
}

export function createOptimisticSessionNode(piboSessionId: string, profile: string): PiboWebSessionNode {
	return {
		piboSessionId,
		piSessionId: "pending",
		profile,
		title: "New Session",
		status: "idle",
		lastActivityAt: new Date().toISOString(),
		derivedSessions: [],
		children: [],
	};
}

export function sessionNodeFromSession(session: PiboSession): PiboWebSessionNode {
	return {
		piboSessionId: session.id,
		piSessionId: session.piSessionId,
		profile: session.profile,
		activeModel: session.activeModel,
		title: session.title || "Untitled Session",
		archived: typeof session.metadata?.chatWebArchivedAt === "string",
		status: "idle",
		lastActivityAt: session.updatedAt,
		derivedSessions: [],
		children: [],
	};
}

function piboSessionFromSessionNode(node: PiboWebSessionNode, base: PiboSession): PiboSession {
	return {
		...base,
		id: node.piboSessionId,
		piSessionId: node.piSessionId,
		profile: node.profile,
		activeModel: node.activeModel,
		title: sessionNodeTitle(node),
		updatedAt: node.lastActivityAt ?? base.updatedAt,
	};
}

function findSessionNode(nodes: PiboWebSessionNode[], piboSessionId: string): PiboWebSessionNode | undefined {
	for (const node of nodes) {
		if (node.piboSessionId === piboSessionId) return node;
		const child = findSessionNode(node.children, piboSessionId);
		if (child) return child;
	}
	return undefined;
}
