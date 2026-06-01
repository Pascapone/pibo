import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type FinalAppSpaceCutoverMode = "inspect" | "dry-run";

export type FinalAppSpaceLegacyValueSummary = {
	table: string;
	column: string;
	value: string;
	count: number;
};

export type FinalAppSpaceTableReport = {
	name: string;
	rowCount: number;
	legacyColumns: string[];
	legacyIndexes: string[];
};

export type FinalAppSpaceConflictGroup = {
	kind: string;
	table: string;
	key: string;
	rowCount: number;
	rowIds: string[];
	decision: string;
};

export type FinalAppSpacePlannedAction = {
	database: string;
	table: string;
	action: string;
	details: string;
};

export type FinalAppSpaceDatabaseReport = {
	name: string;
	path: string;
	exists: boolean;
	bytes: number;
	quickCheck?: string;
	tables: FinalAppSpaceTableReport[];
	legacyValues: FinalAppSpaceLegacyValueSummary[];
	conflictGroups: FinalAppSpaceConflictGroup[];
	plannedActions: FinalAppSpacePlannedAction[];
	unresolvedBlockers: string[];
};

export type FinalAppSpaceCutoverReport = {
	kind: "final-app-space-cutover";
	mode: FinalAppSpaceCutoverMode;
	root: string;
	databases: FinalAppSpaceDatabaseReport[];
	totals: {
		databases: number;
		affectedDatabases: number;
		legacyColumns: number;
		legacyIndexes: number;
		legacyRows: number;
		conflictGroups: number;
		plannedActions: number;
		unresolvedBlockers: number;
	};
};

const FORBIDDEN_PRODUCTION_ROOT = "/root/.pibo";
const LEGACY_COLUMN_NAMES = new Set(["owner_scope", "principal_id"]);
const LEGACY_DROP_TABLES = new Set(["room_members", "principal_session_stats", "principal_room_stats"]);
const FINAL_CUTOVER_DATABASES = [
	"pibo.sqlite",
	"pibo-sessions.sqlite",
	"chat-agents.sqlite",
	"pibo-ralph.sqlite",
	"pibo-cron.sqlite",
	"web-annotations.sqlite",
	"web-projects.sqlite",
	"pibo-workflows.sqlite",
];

export function inspectFinalAppSpaceCutoverMigration(input: { mode?: FinalAppSpaceCutoverMode; root?: string; env?: Record<string, string | undefined> } = {}): FinalAppSpaceCutoverReport {
	const mode = input.mode ?? "inspect";
	const root = resolveFinalCutoverRoot(input.root, input.env ?? process.env);
	const databases = FINAL_CUTOVER_DATABASES.map((name) => inspectCutoverDatabase(root, name, mode));
	return {
		kind: "final-app-space-cutover",
		mode,
		root,
		databases,
		totals: summarizeCutoverDatabases(databases),
	};
}

export function formatFinalAppSpaceCutoverReport(report: FinalAppSpaceCutoverReport): string {
	const lines = [
		`kind\t${report.kind}`,
		`mode\t${report.mode}`,
		`root\t${report.root}`,
		`databases\t${report.totals.databases}`,
		`affectedDatabases\t${report.totals.affectedDatabases}`,
		`legacyColumns\t${report.totals.legacyColumns}`,
		`legacyIndexes\t${report.totals.legacyIndexes}`,
		`legacyRows\t${report.totals.legacyRows}`,
		`conflictGroups\t${report.totals.conflictGroups}`,
		`plannedActions\t${report.totals.plannedActions}`,
		`unresolvedBlockers\t${report.totals.unresolvedBlockers}`,
		"database\texists\tbytes\tquickCheck\tlegacyColumns\tlegacyIndexes\tlegacyRows\tconflicts\tplannedActions\tpath",
	];
	for (const database of report.databases) {
		const legacyRows = database.legacyValues.reduce((sum, value) => sum + value.count, 0);
		const legacyColumns = database.tables.reduce((sum, table) => sum + table.legacyColumns.length, 0);
		const legacyIndexes = database.tables.reduce((sum, table) => sum + table.legacyIndexes.length, 0);
		lines.push(`${database.name}\t${database.exists}\t${database.bytes}\t${database.quickCheck ?? "-"}\t${legacyColumns}\t${legacyIndexes}\t${legacyRows}\t${database.conflictGroups.length}\t${database.plannedActions.length}\t${database.path}`);
		for (const value of database.legacyValues) lines.push(`legacyValue\t${database.name}\t${value.table}\t${value.column}\t${value.value}\t${value.count}`);
		for (const conflict of database.conflictGroups) lines.push(`conflict\t${database.name}\t${conflict.kind}\t${conflict.table}\t${conflict.key}\t${conflict.rowCount}\t${conflict.decision}`);
		for (const action of database.plannedActions) lines.push(`plan\t${database.name}\t${action.table}\t${action.action}\t${action.details}`);
		for (const blocker of database.unresolvedBlockers) lines.push(`blocker\t${database.name}\t${blocker}`);
	}
	return `${lines.join("\n")}\n`;
}

function resolveFinalCutoverRoot(root: string | undefined, env: Record<string, string | undefined>): string {
	const candidate = root ?? env.PIBO_MIGRATION_SANDBOX_HOME;
	if (!candidate) throw new Error("pibo data final-cutover requires --root <isolated-pibo-home> or PIBO_MIGRATION_SANDBOX_HOME");
	const resolved = resolve(candidate);
	if (resolved === FORBIDDEN_PRODUCTION_ROOT || resolved.startsWith(`${FORBIDDEN_PRODUCTION_ROOT}${sep}`)) {
		throw new Error("pibo data final-cutover refuses to target /root/.pibo; use a Docker sandbox or temporary fixture root");
	}
	if (!existsSync(resolved)) throw new Error(`pibo data final-cutover root does not exist: ${resolved}`);
	if (!statSync(resolved).isDirectory()) throw new Error(`pibo data final-cutover root is not a directory: ${resolved}`);
	return resolved;
}

function inspectCutoverDatabase(root: string, name: string, mode: FinalAppSpaceCutoverMode): FinalAppSpaceDatabaseReport {
	const path = join(root, name);
	const exists = existsSync(path);
	const report: FinalAppSpaceDatabaseReport = { name, path, exists, bytes: exists ? statSync(path).size : 0, tables: [], legacyValues: [], conflictGroups: [], plannedActions: [], unresolvedBlockers: [] };
	if (!exists) return report;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		report.quickCheck = "not-run-read-only-inspect";
		const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
		const indexRows = db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string; tbl_name: string; sql: string | null }>;
		for (const { name: tableName } of tables) {
			const columns = [...tableColumns(db, tableName)];
			const legacyColumns = columns.filter((column) => LEGACY_COLUMN_NAMES.has(column));
			const legacyIndexes = indexRows.filter((index) => index.tbl_name === tableName && legacyIndexMatches(index)).map((index) => index.name);
			if (legacyColumns.length || legacyIndexes.length || LEGACY_DROP_TABLES.has(tableName)) {
				report.tables.push({ name: tableName, rowCount: countRows(db, tableName), legacyColumns, legacyIndexes });
			}
			for (const column of legacyColumns) report.legacyValues.push(...summarizeLegacyColumnValues(db, tableName, column));
		}
		report.conflictGroups.push(...collectCutoverConflicts(db, name));
		if (mode === "dry-run") report.plannedActions.push(...planCutoverActions(name, report));
	} catch (error) {
		report.unresolvedBlockers.push(error instanceof Error ? error.message : String(error));
	} finally {
		db.close();
	}
	return report;
}

function summarizeCutoverDatabases(databases: FinalAppSpaceDatabaseReport[]): FinalAppSpaceCutoverReport["totals"] {
	let legacyColumns = 0;
	let legacyIndexes = 0;
	let legacyRows = 0;
	let conflictGroups = 0;
	let plannedActions = 0;
	let unresolvedBlockers = 0;
	let affectedDatabases = 0;
	for (const database of databases) {
		const databaseLegacyColumns = database.tables.reduce((sum, table) => sum + table.legacyColumns.length, 0);
		const databaseLegacyIndexes = database.tables.reduce((sum, table) => sum + table.legacyIndexes.length, 0);
		const databaseLegacyRows = database.legacyValues.reduce((sum, value) => sum + value.count, 0);
		legacyColumns += databaseLegacyColumns;
		legacyIndexes += databaseLegacyIndexes;
		legacyRows += databaseLegacyRows;
		conflictGroups += database.conflictGroups.length;
		plannedActions += database.plannedActions.length;
		unresolvedBlockers += database.unresolvedBlockers.length;
		if (databaseLegacyColumns || databaseLegacyIndexes || databaseLegacyRows || database.conflictGroups.length || database.plannedActions.length || database.unresolvedBlockers.length) affectedDatabases++;
	}
	return { databases: databases.length, affectedDatabases, legacyColumns, legacyIndexes, legacyRows, conflictGroups, plannedActions, unresolvedBlockers };
}

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

function legacyIndexMatches(index: { name: string; sql: string | null }): boolean {
	const text = `${index.name}\n${index.sql ?? ""}`.toLowerCase();
	return text.includes("owner") || text.includes("principal");
}

function countRows(db: DatabaseSync, tableName: string): number {
	return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as Record<string, unknown> | undefined)?.count ?? 0);
}

function summarizeLegacyColumnValues(db: DatabaseSync, tableName: string, columnName: string): FinalAppSpaceLegacyValueSummary[] {
	return (db.prepare(`SELECT ${quoteIdentifier(columnName)} AS value, COUNT(*) AS count FROM ${quoteIdentifier(tableName)} GROUP BY ${quoteIdentifier(columnName)} ORDER BY count DESC, value ASC`).all() as Array<{ value: unknown; count: number }>).map((row) => ({
		table: tableName,
		column: columnName,
		value: redactLegacyValue(row.value),
		count: Number(row.count ?? 0),
	}));
}

function redactLegacyValue(value: unknown): string {
	if (value === null || value === undefined) return "<null>";
	const text = String(value);
	if (text === "shared:app") return text;
	if (text.startsWith("user:")) return `user:<redacted:${hashShort(text)}>`;
	if (text.length <= 32 && /^[a-z0-9:_-]+$/i.test(text)) return text;
	return `<redacted:${hashShort(text)}>`;
}

function hashShort(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function collectCutoverConflicts(db: DatabaseSync, databaseName: string): FinalAppSpaceConflictGroup[] {
	const conflicts: FinalAppSpaceConflictGroup[] = [];
	if (databaseName === "pibo.sqlite") {
		conflicts.push(...collectDuplicateDefaultRoomConflicts(db));
		conflicts.push(...collectDuplicateNavigationConflicts(db));
	}
	if (databaseName === "chat-agents.sqlite") conflicts.push(...collectCustomAgentProfileConflicts(db));
	if (databaseName === "pibo-ralph.sqlite") conflicts.push(...collectAutomationTargetConflicts(db, "pibo_ralph_jobs"));
	if (databaseName === "pibo-cron.sqlite") conflicts.push(...collectAutomationTargetConflicts(db, "pibo_cron_jobs"));
	return conflicts;
}

function collectDuplicateDefaultRoomConflicts(db: DatabaseSync): FinalAppSpaceConflictGroup[] {
	if (!tableExists(db, "rooms")) return [];
	const columns = tableColumns(db, "rooms");
	if (!columns.has("id") || !columns.has("metadata_json")) return [];
	const rows = db.prepare(`SELECT id, metadata_json, ${selectExpression(columns, "archived_at", "NULL")}, ${selectExpression(columns, "updated_at", "NULL")} FROM rooms ORDER BY id ASC`).all() as Array<{ id: string; metadata_json: string | null; archived_at: string | null; updated_at: string | null }>;
	const defaults = rows.filter((row) => parseMetadata(row.metadata_json).default === true);
	if (defaults.length <= 1) return [];
	const [selected] = [...defaults].sort((left, right) => {
		const archivedCompare = Number(Boolean(left.archived_at)) - Number(Boolean(right.archived_at));
		if (archivedCompare !== 0) return archivedCompare;
		const updatedCompare = String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
		if (updatedCompare !== 0) return updatedCompare;
		return left.id.localeCompare(right.id);
	});
	return [{ kind: "duplicate-default-room", table: "rooms", key: "app-default-room", rowCount: defaults.length, rowIds: defaults.map((row) => row.id), decision: `keep ${selected.id}; clear default metadata on older duplicates` }];
}

function collectDuplicateNavigationConflicts(db: DatabaseSync): FinalAppSpaceConflictGroup[] {
	if (!tableExists(db, "session_navigation")) return [];
	const columns = tableColumns(db, "session_navigation");
	if (!columns.has("session_id")) return [];
	const rows = db.prepare(`SELECT session_id, COUNT(*) AS count, GROUP_CONCAT(rowid) AS rowids FROM session_navigation GROUP BY session_id HAVING COUNT(*) > 1 ORDER BY session_id ASC`).all() as Array<{ session_id: string; count: number; rowids: string | null }>;
	return rows.map((row) => ({ kind: "duplicate-navigation", table: "session_navigation", key: row.session_id, rowCount: Number(row.count), rowIds: String(row.rowids ?? "").split(",").filter(Boolean), decision: "keep newest updated_at row for each session_id" }));
}

function collectCustomAgentProfileConflicts(db: DatabaseSync): FinalAppSpaceConflictGroup[] {
	if (!tableExists(db, "chat_agents")) return [];
	const columns = tableColumns(db, "chat_agents");
	if (!columns.has("profile_name") || !columns.has("id")) return [];
	const rows = db.prepare("SELECT profile_name, COUNT(*) AS count, GROUP_CONCAT(id) AS ids FROM chat_agents GROUP BY profile_name HAVING COUNT(*) > 1 ORDER BY profile_name ASC").all() as Array<{ profile_name: string; count: number; ids: string | null }>;
	return rows.map((row) => ({ kind: "duplicate-custom-agent-profile", table: "chat_agents", key: `<redacted:${hashShort(row.profile_name)}>`, rowCount: Number(row.count), rowIds: String(row.ids ?? "").split(",").filter(Boolean), decision: "keep newest updated_at row on original profile name; rename older rows with deterministic legacy hash suffix" }));
}

function collectAutomationTargetConflicts(db: DatabaseSync, tableName: string): FinalAppSpaceConflictGroup[] {
	if (!tableExists(db, tableName)) return [];
	const columns = tableColumns(db, tableName);
	if (!columns.has("target_json") || !columns.has("id")) return [];
	const rows = db.prepare(`SELECT id, target_json FROM ${quoteIdentifier(tableName)} ORDER BY id ASC`).all() as Array<{ id: string; target_json: string | null }>;
	const legacyRows = rows.filter((row) => {
		const target = parseMetadata(row.target_json);
		return target.kind === "personal" || typeof target.principalId === "string";
	});
	if (legacyRows.length === 0) return [];
	return [{ kind: "legacy-automation-target", table: tableName, key: "default-chat-normalization", rowCount: legacyRows.length, rowIds: legacyRows.map((row) => row.id), decision: "normalize legacy personal/principal target to default-chat" }];
}

function planCutoverActions(databaseName: string, report: FinalAppSpaceDatabaseReport): FinalAppSpacePlannedAction[] {
	const actions: FinalAppSpacePlannedAction[] = [];
	for (const table of report.tables) {
		if (LEGACY_DROP_TABLES.has(table.name)) {
			const action = table.name.startsWith("principal_") ? "merge-then-drop-table" : "drop-table";
			actions.push({ database: databaseName, table: table.name, action, details: `${table.rowCount} historical rows` });
			continue;
		}
		if (table.legacyColumns.length || table.legacyIndexes.length) {
			actions.push({ database: databaseName, table: table.name, action: "rebuild-table", details: `remove columns [${table.legacyColumns.join(", ") || "-"}] and indexes [${table.legacyIndexes.join(", ") || "-"}]` });
		}
	}
	for (const conflict of report.conflictGroups) {
		actions.push({ database: databaseName, table: conflict.table, action: `resolve-${conflict.kind}`, details: conflict.decision });
	}
	return actions;
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
