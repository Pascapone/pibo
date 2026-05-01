import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PiboJsonObject } from "../../core/events.js";

export const CHAT_ROOM_ID_METADATA_KEY = "chatRoomId";
const CHAT_ROOM_ARCHIVED_AT_METADATA_KEY = "chatRoomArchivedAt";

export type PiboRoomType = "space" | "chat" | "agent";
export type PiboRoomRole = "owner" | "admin" | "member" | "viewer";

export type PiboRoom = {
	id: string;
	ownerScope: string;
	name: string;
	topic?: string;
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
	ownerScope: string;
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

type RoomRow = {
	id: string;
	owner_scope: string;
	name: string;
	topic: string | null;
	type: PiboRoomType;
	parent_room_id: string | null;
	created_at: string;
	updated_at: string;
	retention_policy_id: string | null;
	metadata_json: string | null;
};

type MemberRow = {
	room_id: string;
	principal_id: string;
	role: PiboRoomRole;
	joined_at: string;
	last_read_stream_id: number | null;
};

export class PiboRoomStore {
	private readonly db: DatabaseSync;

	constructor(path: string) {
		const resolvedPath = path === ":memory:" ? path : resolve(path);
		if (resolvedPath !== ":memory:") {
			mkdirSync(dirname(resolvedPath), { recursive: true });
		}

		this.db = new DatabaseSync(resolvedPath);
		this.db.exec("PRAGMA busy_timeout = 5000");
		if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS pibo_rooms (
				id TEXT PRIMARY KEY,
				owner_scope TEXT NOT NULL,
				name TEXT NOT NULL,
				topic TEXT,
				type TEXT NOT NULL,
				parent_room_id TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				retention_policy_id TEXT,
				metadata_json TEXT,
				FOREIGN KEY(parent_room_id) REFERENCES pibo_rooms(id)
			);

			CREATE TABLE IF NOT EXISTS pibo_room_members (
				room_id TEXT NOT NULL,
				principal_id TEXT NOT NULL,
				role TEXT NOT NULL,
				joined_at TEXT NOT NULL,
				last_read_stream_id INTEGER,
				PRIMARY KEY(room_id, principal_id),
				FOREIGN KEY(room_id) REFERENCES pibo_rooms(id)
			);

			CREATE INDEX IF NOT EXISTS idx_pibo_rooms_owner
				ON pibo_rooms(owner_scope, updated_at);
			CREATE INDEX IF NOT EXISTS idx_pibo_rooms_parent
				ON pibo_rooms(parent_room_id, updated_at);
			CREATE INDEX IF NOT EXISTS idx_pibo_room_members_principal
				ON pibo_room_members(principal_id, room_id);
		`);
	}

	createRoom(input: CreatePiboRoomInput): PiboRoom {
		const now = new Date().toISOString();
		const room: PiboRoom = {
			id: input.id ?? `room_${randomUUID()}`,
			ownerScope: input.ownerScope,
			name: input.name,
			topic: input.topic,
			type: input.type ?? "chat",
			parentRoomId: input.parentRoomId,
			createdAt: now,
			updatedAt: now,
			retentionPolicyId: input.retentionPolicyId,
			metadata: input.metadata ?? {},
		};
		this.db
			.prepare(`
				INSERT INTO pibo_rooms (
					id,
					owner_scope,
					name,
					topic,
					type,
					parent_room_id,
					created_at,
					updated_at,
					retention_policy_id,
					metadata_json
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`)
			.run(
				room.id,
				room.ownerScope,
				room.name,
				room.topic ?? null,
				room.type,
				room.parentRoomId ?? null,
				room.createdAt,
				room.updatedAt,
				room.retentionPolicyId ?? null,
				JSON.stringify(room.metadata),
			);
		return room;
	}

	updateRoom(id: string, input: UpdatePiboRoomInput): PiboRoom | undefined {
		const existing = this.getRoom(id);
		if (!existing) return undefined;
		const updated: PiboRoom = {
			...existing,
			name: input.name ?? existing.name,
			topic: input.topic === null ? undefined : input.topic ?? existing.topic,
			parentRoomId: input.parentRoomId === null ? undefined : input.parentRoomId ?? existing.parentRoomId,
			retentionPolicyId:
				input.retentionPolicyId === null ? undefined : input.retentionPolicyId ?? existing.retentionPolicyId,
			metadata: input.metadata ?? existing.metadata,
			updatedAt: new Date().toISOString(),
		};
		this.db
			.prepare(`
				UPDATE pibo_rooms SET
					name = ?,
					topic = ?,
					parent_room_id = ?,
					updated_at = ?,
					retention_policy_id = ?,
					metadata_json = ?
				WHERE id = ?
			`)
			.run(
				updated.name,
				updated.topic ?? null,
				updated.parentRoomId ?? null,
				updated.updatedAt,
				updated.retentionPolicyId ?? null,
				JSON.stringify(updated.metadata),
				id,
			);
		return this.getRoom(id);
	}

	deleteRooms(ids: string[]): number {
		if (!ids.length) return 0;
		const placeholders = ids.map(() => "?").join(", ");
		this.db.prepare(`DELETE FROM pibo_room_members WHERE room_id IN (${placeholders})`).run(...ids);
		const result = this.db.prepare(`DELETE FROM pibo_rooms WHERE id IN (${placeholders})`).run(...ids);
		return Number(result.changes ?? 0);
	}

	getRoom(id: string): PiboRoom | undefined {
		const row = this.db.prepare("SELECT * FROM pibo_rooms WHERE id = ?").get(id) as RoomRow | undefined;
		return row ? roomFromRow(row) : undefined;
	}

	listRooms(ownerScope: string): PiboRoom[] {
		return (this.db
			.prepare("SELECT * FROM pibo_rooms WHERE owner_scope = ? ORDER BY updated_at DESC, id ASC")
			.all(ownerScope) as RoomRow[]).map(roomFromRow);
	}

	listRoomTree(ownerScope: string): PiboRoomNode[] {
		const rooms = this.listRooms(ownerScope);
		const byId = new Map<string, PiboRoomNode>();
		for (const room of rooms) byId.set(room.id, { ...room, children: [] });
		const roots: PiboRoomNode[] = [];
		for (const node of byId.values()) {
			const parent = node.parentRoomId ? byId.get(node.parentRoomId) : undefined;
			if (parent) {
				parent.children.push(node);
			} else {
				roots.push(node);
			}
		}
		sortRoomNodes(roots);
		return roots;
	}

	listRoomSubtree(roomId: string): PiboRoom[] {
		const root = this.getRoom(roomId);
		if (!root) return [];
		const rooms = this.listRooms(root.ownerScope);
		const byParent = new Map<string, PiboRoom[]>();
		for (const room of rooms) {
			if (!room.parentRoomId) continue;
			const children = byParent.get(room.parentRoomId) ?? [];
			children.push(room);
			byParent.set(room.parentRoomId, children);
		}
		const result: PiboRoom[] = [];
		const visit = (room: PiboRoom): void => {
			result.push(room);
			for (const child of byParent.get(room.id) ?? []) visit(child);
		};
		visit(root);
		return result;
	}

	ensureDefaultRoom(input: { ownerScope: string; principalId: string; name?: string }): PiboRoom {
		const existing = this.listRooms(input.ownerScope).find((room) => room.metadata.default === true);
		if (existing) {
			this.ensureMember({
				roomId: existing.id,
				principalId: input.principalId,
				role: "owner",
			});
			return existing;
		}
		const room = this.createRoom({
			ownerScope: input.ownerScope,
			name: input.name ?? "Personal Chat",
			type: "chat",
			metadata: { default: true },
		});
		this.ensureMember({ roomId: room.id, principalId: input.principalId, role: "owner" });
		return room;
	}

	ensureMember(input: { roomId: string; principalId: string; role: PiboRoomRole }): PiboRoomMember {
		const now = new Date().toISOString();
		this.db
			.prepare(`
				INSERT INTO pibo_room_members (room_id, principal_id, role, joined_at, last_read_stream_id)
				VALUES (?, ?, ?, ?, NULL)
				ON CONFLICT(room_id, principal_id) DO UPDATE SET
					role = CASE
						WHEN pibo_room_members.role = 'owner' THEN pibo_room_members.role
						ELSE excluded.role
					END
			`)
			.run(input.roomId, input.principalId, input.role, now);
		const member = this.getMember(input.roomId, input.principalId);
		if (!member) throw new Error(`Failed to create room member for "${input.roomId}"`);
		return member;
	}

	getMember(roomId: string, principalId: string): PiboRoomMember | undefined {
		const row = this.db
			.prepare("SELECT * FROM pibo_room_members WHERE room_id = ? AND principal_id = ?")
			.get(roomId, principalId) as MemberRow | undefined;
		return row ? memberFromRow(row) : undefined;
	}

	updateReadCursor(roomId: string, principalId: string, lastReadStreamId: number): PiboRoomMember | undefined {
		this.db
			.prepare(`
				UPDATE pibo_room_members
				SET last_read_stream_id = MAX(COALESCE(last_read_stream_id, 0), ?)
				WHERE room_id = ? AND principal_id = ?
			`)
			.run(lastReadStreamId, roomId, principalId);
		return this.getMember(roomId, principalId);
	}

	requireRoomAccess(roomId: string, principalId: string, action: "read" | "write" | "admin" = "read"): PiboRoom {
		const room = this.getRoom(roomId);
		const member = room ? this.getMember(roomId, principalId) : undefined;
		if (!room || !member) throw new Error("Room is not available for this user");
		if (action === "write" && member.role === "viewer") throw new Error("Room write access is required");
		if (action === "admin" && member.role !== "owner" && member.role !== "admin") {
			throw new Error("Room admin access is required");
		}
		return room;
	}

	close(): void {
		this.db.close();
	}
}

export function createDefaultPiboRoomStore(cwd = process.cwd()): PiboRoomStore {
	return new PiboRoomStore(resolve(cwd, ".pibo/web-chat.sqlite"));
}

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

export function withPiboRoomArchived(metadata: PiboJsonObject | undefined, archived: boolean): PiboJsonObject {
	const next: PiboJsonObject = { ...(metadata ?? {}) };
	if (archived) {
		next[CHAT_ROOM_ARCHIVED_AT_METADATA_KEY] = new Date().toISOString();
	} else {
		delete next[CHAT_ROOM_ARCHIVED_AT_METADATA_KEY];
	}
	return next;
}

function roomFromRow(row: RoomRow): PiboRoom {
	return {
		id: row.id,
		ownerScope: row.owner_scope,
		name: row.name,
		topic: row.topic ?? undefined,
		type: row.type,
		parentRoomId: row.parent_room_id ?? undefined,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		retentionPolicyId: row.retention_policy_id ?? undefined,
		metadata: parseMetadata(row.metadata_json),
	};
}

function memberFromRow(row: MemberRow): PiboRoomMember {
	return {
		roomId: row.room_id,
		principalId: row.principal_id,
		role: row.role,
		joinedAt: row.joined_at,
		lastReadStreamId: row.last_read_stream_id ?? undefined,
	};
}

function parseMetadata(value: string | null): PiboJsonObject {
	if (!value) return {};
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed as PiboJsonObject;
	} catch {
		return {};
	}
}

function sortRoomNodes(nodes: PiboRoomNode[]): void {
	nodes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name));
	for (const node of nodes) sortRoomNodes(node.children);
}
