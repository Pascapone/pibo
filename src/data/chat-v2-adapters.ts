import { randomUUID } from "node:crypto";
import type { PiboJsonObject, PiboJsonValue, PiboOutputEvent } from "../core/events.js";
import type { ChatEventAppendInput, ChatEventListInput, ChatUnreadCountInput, StoredChatEvent } from "../apps/chat/event-log.js";
import { chatRoomIdFromMetadata, roomWorkspaceFromMetadata, type CreatePiboRoomInput, type PiboRoom, type PiboRoomMember, type PiboRoomNode, type PiboRoomRole, type UpdatePiboRoomInput } from "../apps/chat/rooms.js";
import type { ChatWebSessionBootstrapIndexResult, ChatWebSessionIndexItem, ChatWebStoredPiboEvent } from "../apps/chat/read-model.js";
import { isLiveOnlyOutputEvent } from "../apps/chat/output-event-policy.js";
import type { PiboSession } from "../sessions/store.js";
import type { PiboDataStore } from "./pibo-store.js";

type EventLogRow = {
	stream_id: number;
	session_id: string | null;
	session_sequence: number | null;
	room_id: string | null;
	type: string;
	actor_type: string | null;
	actor_id: string | null;
	event_id: string | null;
	idempotency_key: string | null;
	retention_class: string;
	preview_text: string | null;
	attributes_json: string;
	created_at: string;
};

type SessionRow = {
	id: string;
	pi_session_id: string | null;
	parent_id: string | null;
	channel: string;
	kind: string;
	profile: string;
	created_at: string;
	updated_at: string;
	last_activity_at: string;
	status: string;
};

type RoomRow = {
	id: string;
	owner_scope: string;
	name: string;
	topic: string | null;
	type: "space" | "chat" | "agent";
	parent_room_id: string | null;
	workspace: string | null;
	archived_at: string | null;
	retention_policy_id: string | null;
	metadata_json: string;
	created_at: string;
	updated_at: string;
};

type MemberRow = {
	room_id: string;
	principal_id: string;
	role: PiboRoomRole;
	joined_at: string;
	last_read_stream_id?: number | null;
};

export class ChatV2ReadModel {
	constructor(private readonly store: PiboDataStore) {}

	upsertSession(session: PiboSession, status: ChatWebSessionIndexItem["status"] = "idle"): void {
		const roomId = chatRoomIdFromMetadata(session.metadata) ?? "room_default";
		this.store.sessions.upsertSession({ session, roomId, status, lastActivityAt: session.updatedAt });
		this.upsertNavigation(session, roomId, status, session.updatedAt);
	}

	upsertSessionsIfChanged(sessions: PiboSession[]): ChatWebSessionBootstrapIndexResult {
		for (const session of sessions) this.upsertSession(session);
		return { checked: sessions.length, written: sessions.length, skipped: 0 };
	}

	recordEvent(event: PiboOutputEvent, session?: PiboSession): ChatWebStoredPiboEvent | undefined {
		if (session) this.upsertSession(session, statusFromOutputEvent(event));
		return undefined;
	}

	listSessions(): ChatWebSessionIndexItem[] {
		const rows = this.store.db.prepare("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY last_activity_at DESC, created_at DESC").all() as SessionRow[];
		return rows.map(sessionFromRow);
	}

	getSession(piboSessionId: string): ChatWebSessionIndexItem | undefined {
		const row = this.store.db.prepare("SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL").get(piboSessionId) as SessionRow | undefined;
		return row ? sessionFromRow(row) : undefined;
	}

	listEvents(piboSessionId: string, limit = 1000): ChatWebStoredPiboEvent[] {
		return this.listTraceEvents({ piboSessionId, limit, includeLive: true });
	}

	listAllEvents(piboSessionId: string): ChatWebStoredPiboEvent[] {
		return this.listTraceEvents({ piboSessionId, limit: 10000, includeLive: true });
	}

	listTraceEvents(input: { piboSessionId: string; limit?: number; beforeOrAtSequence?: number; beforeSequence?: number; includeLive?: boolean } | string): ChatWebStoredPiboEvent[] {
		const piboSessionId = typeof input === "string" ? input : input.piboSessionId;
		const limit = Math.max(1, Math.min((typeof input === "string" ? undefined : input.limit) ?? 2000, 10000));
		const beforeOrAtSequence = typeof input === "string" ? undefined : input.beforeOrAtSequence;
		const beforeSequence = typeof input === "string" ? undefined : input.beforeSequence;
		const includeLive = typeof input === "string" ? false : input.includeLive === true;
		const clauses = ["session_id = ?"];
		const values: Array<string | number> = [piboSessionId];
		if (!includeLive) clauses.push("type NOT IN ('assistant_delta', 'thinking_delta', 'tool_execution_updated')");
		if (beforeSequence !== undefined) {
			clauses.push("session_sequence < ?");
			values.push(beforeSequence);
		} else if (beforeOrAtSequence !== undefined) {
			clauses.push("session_sequence <= ?");
			values.push(beforeOrAtSequence);
		}
		const rows = this.store.db.prepare(`
			SELECT * FROM (
				SELECT * FROM event_log
				WHERE ${clauses.join(" AND ")}
				ORDER BY session_sequence DESC, stream_id DESC
				LIMIT ?
			)
			ORDER BY session_sequence ASC, stream_id ASC
		`).all(...values, limit) as EventLogRow[];
		return rows.map(storedPiboEventFromV2Row).filter((event): event is ChatWebStoredPiboEvent => event !== undefined);
	}

	hasSessionActivity(piboSessionId: string): boolean {
		const row = this.store.db.prepare("SELECT 1 AS found FROM event_log WHERE session_id = ? AND type NOT IN ('assistant_delta', 'thinking_delta', 'tool_execution_updated') LIMIT 1").get(piboSessionId) as { found: number } | undefined;
		return Boolean(row) || this.getSession(piboSessionId)?.status === "running";
	}

	countEventsByType(input: { piboSessionId?: string; eventTypes?: string[] } = {}): Array<{ eventType: string; count: number }> {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.piboSessionId) { clauses.push("session_id = ?"); values.push(input.piboSessionId); }
		if (input.eventTypes?.length) { clauses.push(`type IN (${input.eventTypes.map(() => "?").join(", ")})`); values.push(...input.eventTypes); }
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const rows = this.store.db.prepare(`SELECT type, COUNT(*) AS count FROM event_log ${where} GROUP BY type ORDER BY type`).all(...values) as Array<{ type: string; count: number }>;
		return rows.map((row) => ({ eventType: row.type, count: Number(row.count) }));
	}

	getLatestEventSequence(piboSessionId: string): number {
		const row = this.store.db.prepare("SELECT COALESCE(MAX(session_sequence), 0) AS latest_sequence FROM event_log WHERE session_id = ?").get(piboSessionId) as { latest_sequence: number };
		return row.latest_sequence;
	}

	deleteSessions(piboSessionIds: string[]): number {
		if (!piboSessionIds.length) return 0;
		const placeholders = piboSessionIds.map(() => "?").join(", ");
		this.store.db.prepare(`DELETE FROM observations WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		this.store.db.prepare(`DELETE FROM chat_messages WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		this.store.db.prepare(`DELETE FROM event_log WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		this.store.db.prepare(`DELETE FROM session_navigation WHERE session_id IN (${placeholders})`).run(...piboSessionIds);
		const result = this.store.db.prepare(`UPDATE sessions SET deleted_at = COALESCE(deleted_at, ?) WHERE id IN (${placeholders})`).run(new Date().toISOString(), ...piboSessionIds);
		return Number(result.changes ?? 0);
	}

	close(): void {}

	private upsertNavigation(session: PiboSession, roomId: string, status: string, now: string): void {
		this.store.navigation.upsertSession({
			ownerScope: session.ownerScope ?? "user:unknown",
			roomId,
			sessionId: session.id,
			rootSessionId: session.parentId ? (typeof session.metadata?.rootSessionId === "string" ? session.metadata.rootSessionId : session.parentId) : session.id,
			parentId: session.parentId,
			originId: session.originId,
			title: session.title || "Untitled Session",
			profile: session.profile,
			status,
			archivedAt: typeof session.metadata?.archivedAt === "string" ? session.metadata.archivedAt : undefined,
			lastActivityAt: now,
			sortKey: now,
			updatedAt: now,
		});
	}
}

export class ChatV2EventLog {
	constructor(private readonly store: PiboDataStore) {}

	appendEvent(input: ChatEventAppendInput): StoredChatEvent {
		const createdAt = input.createdAt ?? new Date().toISOString();
		const eventId = input.eventId ?? `ce_${randomUUID()}`;
		const idempotencyKey = input.clientTxnId ? `chat:user.accepted:${input.roomId ?? ""}:${input.actorId ?? ""}:${input.clientTxnId}` : `chat:event:${eventId}`;
		const existing = input.clientTxnId ? this.findByClientTxn(input.roomId, input.actorId, input.clientTxnId) : undefined;
		if (existing) return existing;
		const stored = this.store.eventLog.appendEvent({
			sessionId: input.piboSessionId,
			sessionSequence: input.piboSessionId ? nextSessionSequence(this.store, input.piboSessionId) : undefined,
			roomId: input.roomId,
			topic: "chat",
			type: input.eventType,
			source: input.actorType ?? "chat-web",
			actorType: input.actorType,
			actorId: input.actorId,
			eventId,
			idempotencyKey,
			retentionClass: input.retentionClass,
			previewText: previewForPayload(input.payload),
			attributes: compactObject({ clientTxnId: input.clientTxnId, inlinePayload: input.payload }),
			createdAt,
			indexedAt: createdAt,
		});
		return storedChatEventFromV2Row({
			stream_id: stored.streamId,
			session_id: stored.sessionId ?? null,
			session_sequence: stored.sessionSequence ?? null,
			room_id: stored.roomId ?? null,
			type: stored.type,
			actor_type: stored.actorType ?? null,
			actor_id: stored.actorId ?? null,
			event_id: stored.eventId ?? null,
			idempotency_key: stored.idempotencyKey ?? null,
			retention_class: stored.retentionClass,
			preview_text: stored.previewText ?? null,
			attributes_json: JSON.stringify(stored.attributes),
			created_at: stored.createdAt,
		});
	}

	appendOutputEvent(event: PiboOutputEvent, _input: { roomId?: string; actorId?: string } = {}): StoredChatEvent | undefined {
		// In V2 mode output events are written by ChatDataIngestService, which also
		// maintains messages, observations, and navigation. Avoid a second event_log
		// insert here; this adapter only preserves the legacy event-log surface.
		if (isLiveOnlyOutputEvent(event)) return undefined;
		return undefined;
	}

	listEvents(input: ChatEventListInput = {}): StoredChatEvent[] {
		const clauses: string[] = [];
		const values: Array<string | number> = [];
		if (input.roomId) { clauses.push("room_id = ?"); values.push(input.roomId); }
		if (input.piboSessionId) { clauses.push("session_id = ?"); values.push(input.piboSessionId); }
		if (input.afterStreamId !== undefined) { clauses.push("stream_id > ?"); values.push(input.afterStreamId); }
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const limit = Math.max(1, Math.min(input.limit ?? 1000, 5000));
		const rows = this.store.db.prepare(`SELECT * FROM event_log ${where} ORDER BY stream_id ASC LIMIT ?`).all(...values, limit) as EventLogRow[];
		return rows.map(storedChatEventFromV2Row);
	}

	findByClientTxn(roomId: string | undefined, actorId: string | undefined, clientTxnId: string): StoredChatEvent | undefined {
		if (!roomId || !actorId) return undefined;
		const row = this.store.db.prepare("SELECT * FROM event_log WHERE room_id = ? AND actor_id = ? AND json_extract(attributes_json, '$.clientTxnId') = ? ORDER BY stream_id ASC LIMIT 1").get(roomId, actorId, clientTxnId) as EventLogRow | undefined;
		return row ? storedChatEventFromV2Row(row) : undefined;
	}

	getLatestStreamId(input: { roomId?: string; piboSessionId?: string } = {}): number | undefined {
		const clauses: string[] = [];
		const values: string[] = [];
		if (input.roomId) { clauses.push("room_id = ?"); values.push(input.roomId); }
		if (input.piboSessionId) { clauses.push("session_id = ?"); values.push(input.piboSessionId); }
		const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
		const row = this.store.db.prepare(`SELECT MAX(stream_id) AS stream_id FROM event_log ${where}`).get(...values) as { stream_id: number | null } | undefined;
		return row?.stream_id ?? undefined;
	}

	markSessionRead(piboSessionId: string, principalId: string, lastReadStreamId: number): void {
		this.store.db.prepare(`
			INSERT INTO principal_session_stats (session_id, principal_id, last_read_stream_id, last_read_at, updated_at)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(session_id, principal_id) DO UPDATE SET
				last_read_stream_id = MAX(principal_session_stats.last_read_stream_id, excluded.last_read_stream_id),
				last_read_at = excluded.last_read_at,
				updated_at = excluded.updated_at
		`).run(piboSessionId, principalId, lastReadStreamId, new Date().toISOString(), new Date().toISOString());
	}

	countUnreadMessagesBySession(input: { piboSessionIds: string[]; principalId: string }): Map<string, number> {
		const counts = new Map<string, number>();
		if (!input.piboSessionIds.length) return counts;
		for (let offset = 0; offset < input.piboSessionIds.length; offset += 400) {
			const ids = [...new Set(input.piboSessionIds)].slice(offset, offset + 400);
			const placeholders = ids.map(() => "?").join(", ");
			const rows = this.store.db.prepare(`
				SELECT e.session_id, COUNT(*) AS count
				FROM event_log e
				LEFT JOIN principal_session_stats reads ON reads.session_id = e.session_id AND reads.principal_id = ?
				WHERE e.session_id IN (${placeholders})
					AND e.retention_class = 'chat_message'
					AND e.stream_id > COALESCE(reads.last_read_stream_id, 0)
					AND (e.actor_type IS NULL OR e.actor_type != 'user' OR e.actor_id IS NULL OR e.actor_id != ?)
					AND e.type IN ('user.message.accepted', 'assistant_message')
				GROUP BY e.session_id
			`).all(input.principalId, ...ids, input.principalId) as Array<{ session_id: string; count: number }>;
			for (const row of rows) if (Number(row.count) > 0) counts.set(row.session_id, Number(row.count));
		}
		return counts;
	}

	deleteSessions(piboSessionIds: string[]): number { return new ChatV2ReadModel(this.store).deleteSessions(piboSessionIds); }
	deleteRooms(roomIds: string[]): number {
		if (!roomIds.length) return 0;
		const placeholders = roomIds.map(() => "?").join(", ");
		const result = this.store.db.prepare(`DELETE FROM event_log WHERE room_id IN (${placeholders})`).run(...roomIds);
		return Number(result.changes ?? 0);
	}
}

export class ChatV2RoomStore {
	constructor(private readonly store: PiboDataStore) {}

	createRoom(input: CreatePiboRoomInput): PiboRoom {
		const now = new Date().toISOString();
		const room: PiboRoom = { id: input.id ?? `room_${randomUUID()}`, ownerScope: input.ownerScope, name: input.name, topic: input.topic, workspace: roomWorkspaceFromMetadata(input.metadata), type: input.type ?? "chat", parentRoomId: input.parentRoomId, createdAt: now, updatedAt: now, retentionPolicyId: input.retentionPolicyId, metadata: input.metadata ?? {} };
		this.store.db.prepare(`INSERT INTO rooms (id, owner_scope, name, topic, type, parent_room_id, workspace, retention_policy_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(room.id, room.ownerScope, room.name, room.topic ?? null, room.type, room.parentRoomId ?? null, room.workspace ?? null, room.retentionPolicyId ?? null, JSON.stringify(room.metadata), room.createdAt, room.updatedAt);
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
		this.store.db.prepare(`DELETE FROM room_members WHERE room_id IN (${placeholders})`).run(...ids);
		const result = this.store.db.prepare(`DELETE FROM rooms WHERE id IN (${placeholders})`).run(...ids);
		return Number(result.changes ?? 0);
	}

	getRoom(id: string): PiboRoom | undefined { const row = this.store.db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as RoomRow | undefined; return row ? roomFromRow(row) : undefined; }
	listRooms(ownerScope: string): PiboRoom[] { return (this.store.db.prepare("SELECT * FROM rooms WHERE owner_scope = ? ORDER BY updated_at DESC, id ASC").all(ownerScope) as RoomRow[]).map(roomFromRow); }
	listRoomTree(ownerScope: string): PiboRoomNode[] { const byId = new Map(this.listRooms(ownerScope).map((room) => [room.id, { ...room, children: [] as PiboRoomNode[] }])); const roots: PiboRoomNode[] = []; for (const node of byId.values()) { const parent = node.parentRoomId ? byId.get(node.parentRoomId) : undefined; if (parent) parent.children.push(node); else roots.push(node); } return roots; }
	listRoomSubtree(roomId: string): PiboRoom[] { const root = this.getRoom(roomId); if (!root) return []; const rooms = this.listRooms(root.ownerScope); const byParent = new Map<string, PiboRoom[]>(); for (const room of rooms) if (room.parentRoomId) byParent.set(room.parentRoomId, [...(byParent.get(room.parentRoomId) ?? []), room]); const result: PiboRoom[] = []; const visit = (room: PiboRoom): void => { result.push(room); for (const child of byParent.get(room.id) ?? []) visit(child); }; visit(root); return result; }
	ensureDefaultRoom(input: { ownerScope: string; principalId: string; name?: string }): PiboRoom { const existing = this.listRooms(input.ownerScope).find((room) => room.metadata.default === true); if (existing) { this.ensureMember({ roomId: existing.id, principalId: input.principalId, role: "owner" }); return existing; } const room = this.createRoom({ ownerScope: input.ownerScope, name: input.name ?? "Personal Chat", type: "chat", metadata: { default: true } }); this.ensureMember({ roomId: room.id, principalId: input.principalId, role: "owner" }); return room; }
	ensureMember(input: { roomId: string; principalId: string; role: PiboRoomRole }): PiboRoomMember { const now = new Date().toISOString(); this.store.db.prepare("INSERT INTO room_members (room_id, principal_id, role, joined_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id, principal_id) DO UPDATE SET role = CASE WHEN room_members.role = 'owner' THEN room_members.role ELSE excluded.role END").run(input.roomId, input.principalId, input.role, now); const member = this.getMember(input.roomId, input.principalId); if (!member) throw new Error(`Failed to create room member for \"${input.roomId}\"`); return member; }
	getMember(roomId: string, principalId: string): PiboRoomMember | undefined { const row = this.store.db.prepare("SELECT * FROM room_members WHERE room_id = ? AND principal_id = ?").get(roomId, principalId) as MemberRow | undefined; return row ? { roomId: row.room_id, principalId: row.principal_id, role: row.role, joinedAt: row.joined_at, lastReadStreamId: row.last_read_stream_id ?? undefined } : undefined; }
	updateReadCursor(roomId: string, principalId: string, lastReadStreamId: number): PiboRoomMember | undefined { this.store.db.prepare("INSERT INTO principal_room_stats (room_id, principal_id, last_read_stream_id, last_read_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(room_id, principal_id) DO UPDATE SET last_read_stream_id = MAX(principal_room_stats.last_read_stream_id, excluded.last_read_stream_id), last_read_at = excluded.last_read_at, updated_at = excluded.updated_at").run(roomId, principalId, lastReadStreamId, new Date().toISOString(), new Date().toISOString()); return this.getMember(roomId, principalId); }
	requireRoomAccess(roomId: string, principalId: string, action: "read" | "write" | "admin" = "read"): PiboRoom { const room = this.getRoom(roomId); const member = room ? this.getMember(roomId, principalId) : undefined; if (!room || !member) throw new Error("Room is not available for this user"); if (action === "write" && member.role === "viewer") throw new Error("Room write access is required"); if (action === "admin" && member.role !== "owner" && member.role !== "admin") throw new Error("Room admin access is required"); return room; }
	close(): void {}
}

function storedPiboEventFromV2Row(row: EventLogRow): ChatWebStoredPiboEvent | undefined {
	const attributes = parseJsonObject(row.attributes_json);
	const payload = attributes.inlinePayload;
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	return { id: String(row.stream_id), piboSessionId: row.session_id ?? undefined, eventSequence: row.session_sequence ?? undefined, eventId: row.event_id ?? undefined, streamId: row.stream_id, type: row.type, createdAt: row.created_at, payload: payload as PiboOutputEvent };
}

function storedChatEventFromV2Row(row: EventLogRow): StoredChatEvent {
	const attributes = parseJsonObject(row.attributes_json);
	return { streamId: row.stream_id, roomId: row.room_id ?? undefined, piboSessionId: row.session_id ?? undefined, eventId: row.event_id ?? `evt_${row.stream_id}`, eventType: row.type, actorType: actorTypeValue(row.actor_type), actorId: row.actor_id ?? undefined, clientTxnId: typeof attributes.clientTxnId === "string" ? attributes.clientTxnId : undefined, createdAt: row.created_at, retentionClass: retentionClassValue(row.retention_class), payload: (attributes.inlinePayload ?? null) as PiboJsonValue };
}

function sessionFromRow(row: SessionRow): ChatWebSessionIndexItem { return { piboSessionId: row.id, piSessionId: row.pi_session_id ?? row.id, parentId: row.parent_id ?? undefined, profile: row.profile, channel: row.channel, kind: row.kind, createdAt: row.created_at, updatedAt: row.updated_at, lastActivityAt: row.last_activity_at, status: row.status === "running" || row.status === "error" ? row.status : "idle" }; }
function roomFromRow(row: RoomRow): PiboRoom { const metadata = parseJsonObject(row.metadata_json); return { id: row.id, ownerScope: row.owner_scope, name: row.name, topic: row.topic ?? undefined, workspace: row.workspace ?? roomWorkspaceFromMetadata(metadata), type: row.type, parentRoomId: row.parent_room_id ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at, retentionPolicyId: row.retention_policy_id ?? undefined, metadata }; }
function parseJsonObject(value: string): PiboJsonObject { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as PiboJsonObject : {}; } catch { return {}; } }
function nextSessionSequence(store: PiboDataStore, sessionId: string): number { const row = store.db.prepare("SELECT COALESCE(MAX(session_sequence), 0) + 1 AS next_sequence FROM event_log WHERE session_id = ?").get(sessionId) as { next_sequence: number }; return row.next_sequence; }
function compactObject(value: Record<string, unknown>): PiboJsonObject { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as PiboJsonObject; }
function previewForPayload(payload: unknown): string | undefined { if (typeof payload === "object" && payload && "text" in payload && typeof payload.text === "string") return payload.text.slice(0, 512); if (typeof payload === "string") return payload.slice(0, 512); return undefined; }
function statusFromOutputEvent(event: PiboOutputEvent): ChatWebSessionIndexItem["status"] { if (event.type === "session_error") return "error"; if (event.type === "message_finished") return "idle"; return "running"; }
function retentionClassForOutputEvent(event: PiboOutputEvent): "live_delta" | "trace_event" | "chat_message" | "audit_event" { if (event.type === "assistant_message" || event.type === "message_started" || event.type === "message_finished") return "chat_message"; if (event.type === "assistant_delta" || event.type === "thinking_delta" || event.type === "tool_execution_updated") return "live_delta"; return "trace_event"; }
function actorTypeForOutputEvent(event: PiboOutputEvent): "user" | "assistant" | "system" | "agent" { if (event.type === "assistant_message" || event.type === "assistant_delta" || event.type.startsWith("thinking_")) return "assistant"; if (event.type === "session_error") return "system"; return "agent"; }
function actorTypeValue(value: string | null): "user" | "assistant" | "system" | "agent" | undefined { return value === "user" || value === "assistant" || value === "system" || value === "agent" ? value : undefined; }
function retentionClassValue(value: string): "live_delta" | "trace_event" | "chat_message" | "audit_event" { return value === "live_delta" || value === "chat_message" || value === "audit_event" ? value : "trace_event"; }
