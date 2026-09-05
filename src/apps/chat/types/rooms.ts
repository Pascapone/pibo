import type { PiboJsonObject } from "../../../core/events.js";

export const CHAT_ROOM_ID_METADATA_KEY = "chatRoomId";
const CHAT_ROOM_ARCHIVED_AT_METADATA_KEY = "chatRoomArchivedAt";
const CHAT_ROOM_PINNED_AT_METADATA_KEY = "chatRoomPinnedAt";
const CHAT_ROOM_SIDEBAR_ORDER_METADATA_KEY = "chatRoomSidebarOrder";
const CHAT_ROOM_WORKSPACE_METADATA_KEY = "workspace";

export type PiboRoomType = "space" | "chat" | "agent";
export type PiboRoom = {
	id: string;
	name: string;
	topic?: string;
	workspace?: string;
	type: PiboRoomType;
	parentRoomId?: string;
	createdAt: string;
	updatedAt: string;
	retentionPolicyId?: string;
	metadata: PiboJsonObject;
};

export type PiboRoomNode = PiboRoom & {
	children: PiboRoomNode[];
};

export type CreatePiboRoomInput = {
	id?: string;
	name: string;
	topic?: string;
	type?: PiboRoomType;
	parentRoomId?: string;
	retentionPolicyId?: string;
	metadata?: PiboJsonObject;
};

export type UpdatePiboRoomInput = {
	name?: string;
	topic?: string | null;
	parentRoomId?: string | null;
	retentionPolicyId?: string | null;
	metadata?: PiboJsonObject;
};

export function chatRoomIdFromMetadata(metadata: PiboJsonObject | undefined): string | undefined {
	const value = metadata?.[CHAT_ROOM_ID_METADATA_KEY];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function withChatRoomId(metadata: PiboJsonObject | undefined, roomId: string): PiboJsonObject {
	return { ...(metadata ?? {}), [CHAT_ROOM_ID_METADATA_KEY]: roomId };
}

export function isDefaultPiboRoom(room: Pick<PiboRoom, "metadata">): boolean {
	return room.metadata.default === true;
}

export function isPiboRoomArchived(room: Pick<PiboRoom, "metadata">): boolean {
	return typeof room.metadata[CHAT_ROOM_ARCHIVED_AT_METADATA_KEY] === "string";
}

export function isPiboRoomPinned(room: Pick<PiboRoom, "metadata">): boolean {
	return typeof room.metadata[CHAT_ROOM_PINNED_AT_METADATA_KEY] === "string";
}

export function piboRoomSidebarOrder(room: Pick<PiboRoom, "metadata">): number | undefined {
	const value = room.metadata[CHAT_ROOM_SIDEBAR_ORDER_METADATA_KEY];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function comparePiboRoomsBySidebarOrder(left: PiboRoom, right: PiboRoom): number {
	const pinnedDifference = Number(isPiboRoomPinned(right)) - Number(isPiboRoomPinned(left));
	if (pinnedDifference !== 0) return pinnedDifference;
	const leftOrder = piboRoomSidebarOrder(left) ?? (Date.parse(left.createdAt) || 0);
	const rightOrder = piboRoomSidebarOrder(right) ?? (Date.parse(right.createdAt) || 0);
	if (leftOrder !== rightOrder) return rightOrder - leftOrder;
	return right.id.localeCompare(left.id);
}

export function roomWorkspaceFromMetadata(metadata: PiboJsonObject | undefined): string | undefined {
	const value = metadata?.[CHAT_ROOM_WORKSPACE_METADATA_KEY];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function withPiboRoomArchived(metadata: PiboJsonObject | undefined, archived: boolean): PiboJsonObject {
	const next: PiboJsonObject = { ...(metadata ?? {}) };
	if (archived) next[CHAT_ROOM_ARCHIVED_AT_METADATA_KEY] = new Date().toISOString();
	else delete next[CHAT_ROOM_ARCHIVED_AT_METADATA_KEY];
	return next;
}

export function withPiboRoomPinned(metadata: PiboJsonObject | undefined, pinned: boolean, order = Date.now()): PiboJsonObject {
	const next: PiboJsonObject = { ...(metadata ?? {}), [CHAT_ROOM_SIDEBAR_ORDER_METADATA_KEY]: order };
	if (pinned) next[CHAT_ROOM_PINNED_AT_METADATA_KEY] = new Date().toISOString();
	else delete next[CHAT_ROOM_PINNED_AT_METADATA_KEY];
	return next;
}

export function withPiboRoomSidebarOrder(metadata: PiboJsonObject | undefined, order: number): PiboJsonObject {
	return { ...(metadata ?? {}), [CHAT_ROOM_SIDEBAR_ORDER_METADATA_KEY]: order };
}

export function withPiboRoomWorkspace(metadata: PiboJsonObject | undefined, workspace?: string): PiboJsonObject {
	const next: PiboJsonObject = { ...(metadata ?? {}) };
	if (workspace) next[CHAT_ROOM_WORKSPACE_METADATA_KEY] = workspace;
	else delete next[CHAT_ROOM_WORKSPACE_METADATA_KEY];
	return next;
}
