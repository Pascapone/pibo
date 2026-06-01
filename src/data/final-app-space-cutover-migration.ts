import type { DatabaseSync } from "node:sqlite";

export function migrateLegacyChatDataSchemaToOwnerless(db: DatabaseSync): void {
	db.exec("BEGIN IMMEDIATE");
	try {
		retireDuplicateDefaultRooms(db);
		rebuildRoomsWithoutOwnerScope(db);
		rebuildSessionNavigationWithoutOwnerScope(db);
		mergePrincipalSessionStats(db);
		mergePrincipalRoomStats(db);
		dropTableIfExists(db, "room_members");
		dropTableIfExists(db, "principal_session_stats");
		dropTableIfExists(db, "principal_room_stats");
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

function retireDuplicateDefaultRooms(db: DatabaseSync): void {
	if (!tableExists(db, "rooms")) return;
	const columns = tableColumns(db, "rooms");
	if (!columns.has("id") || !columns.has("metadata_json")) return;
	const rows = db.prepare(`SELECT id, metadata_json, ${columns.has("archived_at") ? "archived_at" : "NULL AS archived_at"}, ${columns.has("updated_at") ? "updated_at" : "NULL AS updated_at"} FROM rooms ORDER BY id ASC`).all() as Array<{ id: string; metadata_json: string | null; archived_at: string | null; updated_at: string | null }>;
	const defaultRows = rows.filter((row) => parseMetadata(row.metadata_json).default === true);
	if (defaultRows.length <= 1) return;
	const [canonical] = [...defaultRows].sort((left, right) => {
		const archivedCompare = Number(Boolean(left.archived_at)) - Number(Boolean(right.archived_at));
		if (archivedCompare !== 0) return archivedCompare;
		const updatedCompare = String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
		if (updatedCompare !== 0) return updatedCompare;
		return left.id.localeCompare(right.id);
	});
	const update = db.prepare("UPDATE rooms SET metadata_json = ? WHERE id = ?");
	for (const row of defaultRows) {
		if (row.id === canonical.id) continue;
		const metadata = parseMetadata(row.metadata_json);
		delete metadata.default;
		update.run(JSON.stringify(metadata), row.id);
	}
}

function rebuildRoomsWithoutOwnerScope(db: DatabaseSync): void {
	if (!tableExists(db, "rooms") || !tableColumns(db, "rooms").has("owner_scope")) return;
	const columns = tableColumns(db, "rooms");
	db.exec(`
		CREATE TABLE __pibo_ownerless_rooms (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			topic TEXT,
			type TEXT NOT NULL,
			parent_room_id TEXT,
			workspace TEXT,
			archived_at TEXT,
			retention_policy_id TEXT,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`);
	const now = new Date().toISOString();
	const rows = db.prepare(`SELECT ${selectExpression(columns, "id", "NULL")}, ${selectExpression(columns, "name", "NULL")}, ${selectExpression(columns, "topic", "NULL")}, ${selectExpression(columns, "type", "NULL")}, ${selectExpression(columns, "parent_room_id", "NULL")}, ${selectExpression(columns, "workspace", "NULL")}, ${selectExpression(columns, "archived_at", "NULL")}, ${selectExpression(columns, "retention_policy_id", "NULL")}, ${selectExpression(columns, "metadata_json", "'{}'")}, ${selectExpression(columns, "created_at", "NULL")}, ${selectExpression(columns, "updated_at", "NULL")} FROM rooms ORDER BY id ASC`).all() as Array<Record<string, unknown>>;
	const insert = db.prepare("INSERT INTO __pibo_ownerless_rooms (id, name, topic, type, parent_room_id, workspace, archived_at, retention_policy_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
	for (const row of rows) {
		const id = stringValue(row.id);
		if (!id) continue;
		const createdAt = stringValue(row.created_at) ?? stringValue(row.updated_at) ?? now;
		insert.run(id, stringValue(row.name) ?? "Untitled Room", stringValue(row.topic) ?? null, stringValue(row.type) ?? "chat", stringValue(row.parent_room_id) ?? null, stringValue(row.workspace) ?? null, stringValue(row.archived_at) ?? null, stringValue(row.retention_policy_id) ?? null, stringValue(row.metadata_json) ?? "{}", createdAt, stringValue(row.updated_at) ?? createdAt);
	}
	db.exec("DROP TABLE rooms");
	db.exec("ALTER TABLE __pibo_ownerless_rooms RENAME TO rooms");
}

function rebuildSessionNavigationWithoutOwnerScope(db: DatabaseSync): void {
	if (!tableExists(db, "session_navigation") || !tableColumns(db, "session_navigation").has("owner_scope")) return;
	const columns = tableColumns(db, "session_navigation");
	db.exec(`
		CREATE TABLE __pibo_ownerless_session_navigation (
			room_id TEXT,
			session_id TEXT PRIMARY KEY,
			root_session_id TEXT,
			parent_id TEXT,
			origin_id TEXT,
			title TEXT NOT NULL,
			profile TEXT NOT NULL,
			status TEXT NOT NULL,
			archived_at TEXT,
			last_activity_at TEXT NOT NULL,
			last_message_preview TEXT,
			child_count INTEGER NOT NULL DEFAULT 0,
			sort_key TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);
	`);
	const now = new Date().toISOString();
	const rows = db.prepare(`SELECT ${selectExpression(columns, "room_id", "NULL")}, ${selectExpression(columns, "session_id", "NULL")}, ${selectExpression(columns, "root_session_id", "NULL")}, ${selectExpression(columns, "parent_id", "NULL")}, ${selectExpression(columns, "origin_id", "NULL")}, ${selectExpression(columns, "title", "NULL")}, ${selectExpression(columns, "profile", "NULL")}, ${selectExpression(columns, "status", "NULL")}, ${selectExpression(columns, "archived_at", "NULL")}, ${selectExpression(columns, "last_activity_at", "NULL")}, ${selectExpression(columns, "last_message_preview", "NULL")}, ${selectExpression(columns, "child_count", "0")}, ${selectExpression(columns, "sort_key", "NULL")}, ${selectExpression(columns, "updated_at", "NULL")} FROM session_navigation ORDER BY session_id ASC, updated_at DESC`).all() as Array<Record<string, unknown>>;
	const insert = db.prepare("INSERT OR IGNORE INTO __pibo_ownerless_session_navigation (room_id, session_id, root_session_id, parent_id, origin_id, title, profile, status, archived_at, last_activity_at, last_message_preview, child_count, sort_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
	for (const row of rows) {
		const sessionId = stringValue(row.session_id);
		if (!sessionId) continue;
		const updatedAt = stringValue(row.updated_at) ?? now;
		const lastActivityAt = stringValue(row.last_activity_at) ?? updatedAt;
		insert.run(stringValue(row.room_id) ?? null, sessionId, stringValue(row.root_session_id) ?? sessionId, stringValue(row.parent_id) ?? null, stringValue(row.origin_id) ?? null, stringValue(row.title) ?? "Untitled Session", stringValue(row.profile) ?? "default", stringValue(row.status) ?? "idle", stringValue(row.archived_at) ?? null, lastActivityAt, stringValue(row.last_message_preview) ?? null, numberValue(row.child_count) ?? 0, stringValue(row.sort_key) ?? lastActivityAt, updatedAt);
	}
	db.exec("DROP TABLE session_navigation");
	db.exec("ALTER TABLE __pibo_ownerless_session_navigation RENAME TO session_navigation");
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_session_navigation_room_sort
			ON session_navigation(room_id, archived_at, sort_key DESC);
		CREATE INDEX IF NOT EXISTS idx_session_navigation_root
			ON session_navigation(root_session_id, parent_id);
	`);
}

function mergePrincipalSessionStats(db: DatabaseSync): void {
	if (!tableExists(db, "principal_session_stats")) return;
	const columns = tableColumns(db, "principal_session_stats");
	if (!columns.has("session_id")) return;
	const rows = db.prepare(`SELECT session_id, ${selectExpression(columns, "unread_count", "0")}, ${selectExpression(columns, "last_read_stream_id", "0")}, ${selectExpression(columns, "last_read_message_sequence", "0")}, ${selectExpression(columns, "last_read_at", "NULL")}, ${selectExpression(columns, "updated_at", "NULL")} FROM principal_session_stats ORDER BY session_id ASC`).all() as Array<Record<string, unknown>>;
	const merged = new Map<string, { unreadCount: number; lastReadStreamId: number; lastReadMessageSequence: number; lastReadAt: string | null; updatedAt: string }>();
	const now = new Date().toISOString();
	for (const row of rows) {
		const sessionId = stringValue(row.session_id);
		if (!sessionId) continue;
		const current = merged.get(sessionId) ?? { unreadCount: 0, lastReadStreamId: 0, lastReadMessageSequence: 0, lastReadAt: null, updatedAt: now };
		current.unreadCount = Math.max(current.unreadCount, numberValue(row.unread_count) ?? 0);
		current.lastReadStreamId = Math.max(current.lastReadStreamId, numberValue(row.last_read_stream_id) ?? 0);
		current.lastReadMessageSequence = Math.max(current.lastReadMessageSequence, numberValue(row.last_read_message_sequence) ?? 0);
		current.lastReadAt = newestTimestamp(current.lastReadAt, stringValue(row.last_read_at));
		current.updatedAt = newestTimestamp(current.updatedAt, stringValue(row.updated_at)) ?? current.updatedAt;
		merged.set(sessionId, current);
	}
	const upsert = db.prepare(`
		INSERT INTO app_session_read_state (session_id, unread_count, last_read_stream_id, last_read_message_sequence, last_read_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(session_id) DO UPDATE SET
			unread_count = MAX(app_session_read_state.unread_count, excluded.unread_count),
			last_read_stream_id = MAX(app_session_read_state.last_read_stream_id, excluded.last_read_stream_id),
			last_read_message_sequence = MAX(app_session_read_state.last_read_message_sequence, excluded.last_read_message_sequence),
			last_read_at = CASE WHEN COALESCE(excluded.last_read_at, '') > COALESCE(app_session_read_state.last_read_at, '') THEN excluded.last_read_at ELSE app_session_read_state.last_read_at END,
			updated_at = CASE WHEN excluded.updated_at > app_session_read_state.updated_at THEN excluded.updated_at ELSE app_session_read_state.updated_at END
	`);
	for (const [sessionId, state] of merged) upsert.run(sessionId, state.unreadCount, state.lastReadStreamId, state.lastReadMessageSequence, state.lastReadAt, state.updatedAt);
}

function mergePrincipalRoomStats(db: DatabaseSync): void {
	if (!tableExists(db, "principal_room_stats")) return;
	const columns = tableColumns(db, "principal_room_stats");
	if (!columns.has("room_id")) return;
	const rows = db.prepare(`SELECT room_id, ${selectExpression(columns, "unread_count", "0")}, ${selectExpression(columns, "last_read_stream_id", "0")}, ${selectExpression(columns, "last_read_at", "NULL")}, ${selectExpression(columns, "updated_at", "NULL")} FROM principal_room_stats ORDER BY room_id ASC`).all() as Array<Record<string, unknown>>;
	const merged = new Map<string, { unreadCount: number; lastReadStreamId: number; lastReadAt: string | null; updatedAt: string }>();
	const now = new Date().toISOString();
	for (const row of rows) {
		const roomId = stringValue(row.room_id);
		if (!roomId) continue;
		const current = merged.get(roomId) ?? { unreadCount: 0, lastReadStreamId: 0, lastReadAt: null, updatedAt: now };
		current.unreadCount = Math.max(current.unreadCount, numberValue(row.unread_count) ?? 0);
		current.lastReadStreamId = Math.max(current.lastReadStreamId, numberValue(row.last_read_stream_id) ?? 0);
		current.lastReadAt = newestTimestamp(current.lastReadAt, stringValue(row.last_read_at));
		current.updatedAt = newestTimestamp(current.updatedAt, stringValue(row.updated_at)) ?? current.updatedAt;
		merged.set(roomId, current);
	}
	const upsert = db.prepare(`
		INSERT INTO app_room_read_state (room_id, unread_count, last_read_stream_id, last_read_at, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(room_id) DO UPDATE SET
			unread_count = MAX(app_room_read_state.unread_count, excluded.unread_count),
			last_read_stream_id = MAX(app_room_read_state.last_read_stream_id, excluded.last_read_stream_id),
			last_read_at = CASE WHEN COALESCE(excluded.last_read_at, '') > COALESCE(app_room_read_state.last_read_at, '') THEN excluded.last_read_at ELSE app_room_read_state.last_read_at END,
			updated_at = CASE WHEN excluded.updated_at > app_room_read_state.updated_at THEN excluded.updated_at ELSE app_room_read_state.updated_at END
	`);
	for (const [roomId, state] of merged) upsert.run(roomId, state.unreadCount, state.lastReadStreamId, state.lastReadAt, state.updatedAt);
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
	return Boolean(db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function tableColumns(db: DatabaseSync, tableName: string): Set<string> {
	if (!tableExists(db, tableName)) return new Set();
	return new Set((db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all() as Array<{ name: string }>).map((column) => column.name));
}

function dropTableIfExists(db: DatabaseSync, tableName: string): void {
	db.exec(`DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`);
}

function selectExpression(columns: Set<string>, columnName: string, fallback: string): string {
	return columns.has(columnName) ? quoteIdentifier(columnName) : `${fallback} AS ${quoteIdentifier(columnName)}`;
}

function parseMetadata(value: string | null): Record<string, unknown> {
	try {
		const parsed = value ? JSON.parse(value) as unknown : {};
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function newestTimestamp(left: string | null, right: string | undefined): string | null {
	if (!right) return left;
	if (!left) return right;
	return right > left ? right : left;
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
