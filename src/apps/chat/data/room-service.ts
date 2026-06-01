import { randomUUID } from "node:crypto";
import { legacyOwnerScopeForPreCutoverSchemas } from "../../../owner-scope-compat.js";
import { roomWorkspaceFromMetadata, type CreatePiboRoomInput, type PiboRoom, type PiboRoomMember, type PiboRoomNode, type PiboRoomRole, type UpdatePiboRoomInput } from "../types/rooms.js";
import type { PiboDataStore } from "../../../data/pibo-store.js";
import { roomFromRow, type MemberRow, type RoomRow } from "./chat-data-mappers.js";
import { sqliteTableColumns, sqliteTableExists } from "../../../data/sqlite-schema.js";

export class ChatRoomService {
	constructor(private readonly store: PiboDataStore) {}

	createRoom(input: CreatePiboRoomInput): PiboRoom {
		const now = new Date().toISOString();
		const room: PiboRoom = { id: input.id ?? `room_${randomUUID()}`, ownerScope: legacyOwnerScopeForPreCutoverSchemas(), name: input.name, topic: input.topic, workspace: roomWorkspaceFromMetadata(input.metadata), type: input.type ?? "chat", parentRoomId: input.parentRoomId, createdAt: now, updatedAt: now, retentionPolicyId: input.retentionPolicyId, metadata: input.metadata ?? {} };
		const hasOwnerScope = sqliteTableColumns(this.store.db, "rooms").has("owner_scope");
		const columns = ["id", ...(hasOwnerScope ? ["owner_scope"] : []), "name", "topic", "type", "parent_room_id", "workspace", "retention_policy_id", "metadata_json", "created_at", "updated_at"];
		this.store.db.prepare(`INSERT INTO rooms (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(room.id, ...(hasOwnerScope ? [room.ownerScope] : []), room.name, room.topic ?? null, room.type, room.parentRoomId ?? null, room.workspace ?? null, room.retentionPolicyId ?? null, JSON.stringify(room.metadata), room.createdAt, room.updatedAt);
		return room;
	}

	updateRoom(id: string, input: UpdatePiboRoomInput): PiboRoom | undefined {
		const existing = this.getRoom(id); if (!existing) return undefined;
		const metadata = input.metadata ?? existing.metadata;
		const updated = { ...existing, name: input.name ?? existing.name, topic: input.topic === null ? undefined : input.topic ?? existing.topic, parentRoomId: input.parentRoomId === null ? undefined : input.parentRoomId ?? existing.parentRoomId, retentionPolicyId: input.retentionPolicyId === null ? undefined : input.retentionPolicyId ?? existing.retentionPolicyId, metadata, workspace: roomWorkspaceFromMetadata(metadata), updatedAt: new Date().toISOString() };
		this.store.db.prepare("UPDATE rooms SET name = ?, topic = ?, parent_room_id = ?, workspace = ?, retention_policy_id = ?, metadata_json = ?, updated_at = ? WHERE id = ?").run(updated.name, updated.topic ?? null, updated.parentRoomId ?? null, updated.workspace ?? null, updated.retentionPolicyId ?? null, JSON.stringify(updated.metadata), updated.updatedAt, id);
		return this.getRoom(id);
	}

	deleteRooms(ids: string[]): number {
		if (!ids.length) return 0;
		const placeholders = ids.map(() => "?").join(", ");
		if (sqliteTableExists(this.store.db, "room_members")) this.store.db.prepare(`DELETE FROM room_members WHERE room_id IN (${placeholders})`).run(...ids);
		const result = this.store.db.prepare(`DELETE FROM rooms WHERE id IN (${placeholders})`).run(...ids);
		return Number(result.changes ?? 0);
	}

	getRoom(id: string): PiboRoom | undefined { const row = this.store.db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | undefined; return row ? roomFromRow(row) : undefined; }
	listRooms(_ownerScope?: string): PiboRoom[] { return (this.store.db.prepare("SELECT * FROM rooms ORDER BY updated_at DESC, id ASC").all() as RoomRow[]).map(roomFromRow); }
	listRoomTree(ownerScope?: string): PiboRoomNode[] { const byId = new Map(this.listRooms(ownerScope).map((room) => [room.id, { ...room, children: [] as PiboRoomNode[] }])); const roots: PiboRoomNode[] = []; for (const node of byId.values()) { const parent = node.parentRoomId ? byId.get(node.parentRoomId) : undefined; if (parent) parent.children.push(node); else roots.push(node); } return roots; }
	listRoomSubtree(roomId: string): PiboRoom[] { const root = this.getRoom(roomId); if (!root) return []; const rooms = this.listRooms(); const byParent = new Map<string, PiboRoom[]>(); for (const room of rooms) if (room.parentRoomId) byParent.set(room.parentRoomId, [...(byParent.get(room.parentRoomId) ?? []), room]); const result: PiboRoom[] = []; const visit = (room: PiboRoom): void => { result.push(room); for (const child of byParent.get(room.id) ?? []) visit(child); }; visit(root); return result; }
	ensureDefaultRoom(input: { ownerScope: string; principalId: string; name?: string }): PiboRoom { const hasOwnerScope = sqliteTableColumns(this.store.db, "rooms").has("owner_scope"); const existing = (this.store.db.prepare(`SELECT * FROM rooms WHERE json_extract(metadata_json, '$.default') IS 1 ORDER BY ${hasOwnerScope ? "CASE owner_scope WHEN ? THEN 0 ELSE 1 END," : ""} updated_at DESC, id ASC LIMIT 1`).get(...(hasOwnerScope ? [legacyOwnerScopeForPreCutoverSchemas()] : [])) as RoomRow | undefined); if (existing) { this.ensureMember({ roomId: existing.id, principalId: legacyOwnerScopeForPreCutoverSchemas(), role: "owner" }); return roomFromRow(existing); } const room = this.createRoom({ ownerScope: legacyOwnerScopeForPreCutoverSchemas(), name: input.name ?? "Shared Chat", type: "chat", metadata: { default: true } }); this.ensureMember({ roomId: room.id, principalId: legacyOwnerScopeForPreCutoverSchemas(), role: "owner" }); return room; }
	ensureMember(input: { roomId: string; principalId: string; role: PiboRoomRole }): PiboRoomMember { const now = new Date().toISOString(); const principalId = legacyOwnerScopeForPreCutoverSchemas(); if (!sqliteTableExists(this.store.db, "room_members")) return { roomId: input.roomId, principalId, role: input.role, joinedAt: now }; this.store.db.prepare("INSERT INTO room_members (room_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id, principal_id) DO UPDATE SET role = CASE WHEN room_members.role = 'owner' THEN room_members.role ELSE excluded.role END").run(input.roomId, principalId, input.role, now); const member = this.getMember(input.roomId, principalId); if (!member) throw new Error(`Failed to create room member for \"${input.roomId}\"`); return member; }
	getMember(roomId: string, _principalId: string): PiboRoomMember | undefined { const principalId = legacyOwnerScopeForPreCutoverSchemas(); if (!sqliteTableExists(this.store.db, "room_members")) return this.getRoom(roomId) ? { roomId, principalId, role: "owner", joinedAt: new Date(0).toISOString() } : undefined; const row = this.store.db.prepare("SELECT * FROM room_members WHERE room_id = ? AND principal_id = ?").get(roomId, principalId) as MemberRow | undefined; return row ? { roomId: row.room_id, principalId: row.principal_id, role: row.role, joinedAt: row.joined_at, lastReadStreamId: row.last_read_stream_id ?? undefined } : undefined; }
	updateReadCursor(roomId: string, _principalId: string, lastReadStreamId: number): PiboRoomMember | undefined { const now = new Date().toISOString(); if (sqliteTableExists(this.store.db, "principal_room_stats")) { const principalId = legacyOwnerScopeForPreCutoverSchemas(); this.store.db.prepare("INSERT INTO principal_room_stats (room_id, principal_id, last_read_stream_id, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, principal_id) DO UPDATE SET last_read_stream_id = MAX(principal_room_stats.last_read_stream_id, excluded.last_read_stream_id), last_read_at = excluded.last_read_at, updated_at = excluded.updated_at").run(roomId, principalId, lastReadStreamId, now, now); return this.getMember(roomId, principalId); } this.store.db.prepare("INSERT INTO app_room_read_state (room_id, last_read_stream_id, last_read_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET last_read_stream_id = MAX(app_room_read_state.last_read_stream_id, excluded.last_read_stream_id), last_read_at = excluded.last_read_at, updated_at = excluded.updated_at").run(roomId, lastReadStreamId, now, now); return this.getMember(roomId, legacyOwnerScopeForPreCutoverSchemas()); }
	requireRoomAccess(roomId: string, _principalId: string, _action: "read" | "write" | "admin" = "read"): PiboRoom { const room = this.getRoom(roomId); if (!room) throw new Error("Room not found"); return room; }
	close(): void {}
}
