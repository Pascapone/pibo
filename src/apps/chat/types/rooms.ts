import type { PiboJsonObject } from "../../../core/events.js";

export const CHAT_ROOM_ID_METADATA_KEY = "chatRoomId";
const CHAT_ROOM_ARCHIVED_AT_METADATA_KEY = "chatRoomArchivedAt";
const CHAT_ROOM_WORKSPACE_METADATA_KEY = "workspace";

export type PiboRoomType = "space" | "chat" | "agent";
export type PiboRoomRole = "owner" | "admin" | "member" | "viewer";

export type PiboRoom = {
	id: string;
	ownerScope: string;
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

export type PiboRoomMember = {
	roomId: string;
	principalId: string;
	role: PiboRoomRole;
	joinedAt: string;
	lastReadStreamId?: number;
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

export function withPiboRoomWorkspace(metadata: PiboJsonObject | undefined, workspace?: string): PiboJsonObject {
	const next: PiboJsonObject = { ...(metadata ?? {}) };
	if (workspace) next[CHAT_ROOM_WORKSPACE_METADATA_KEY] = workspace;
	else delete next[CHAT_ROOM_WORKSPACE_METADATA_KEY];
	return next;
}
