import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { PiboDataStore } from "../../../data/pibo-store.js";
import type { ChatWorkflowSessionService } from "./workflow-session-service.js";

const MIGRATION_ID = "remove-legacy-containers-v1";
const LEGACY_TABLES = [
	"projects", "project_sessions", "project_workflow_session_snapshots", "project_workflow_runs",
	"project_workflow_wait_tokens", "project_workflow_human_actions",
] as const;

export type LegacyProjectMigrationHooks = {
	beforeReceipts?(): void;
	afterDataReceipt?(): void;
};

export type LegacyProjectMigrationResult = {
	status: "not-needed" | "migrated" | "already-migrated";
	roomsMigrated: number;
	sessionsMigrated: number;
	workflowSessionsMigrated: number;
	workflowRunsMigrated: number;
	archivePath?: string;
};

export function migrateLegacyProjects(input: {
	dataStore: PiboDataStore;
	workflowService: ChatWorkflowSessionService;
	legacyProjectPath?: string;
	archiveDirectory?: string;
	hooks?: LegacyProjectMigrationHooks;
}): LegacyProjectMigrationResult {
	if (input.dataStore.path === ":memory:" || input.workflowService.path === ":memory:") {
		throw new Error("Legacy data migration requires file-backed Pibo and Workflow databases");
	}
	const sourcePath = resolve(input.legacyProjectPath ?? join(dirname(input.dataStore.path), "web-projects.sqlite"));
	const archiveDirectory = resolve(input.archiveDirectory ?? join(dirname(input.dataStore.path), "backups"));
	ensureReceiptTables(input.dataStore.db, input.workflowService.runtimeStore.db);
	const dataReceipt = readReceipt(input.dataStore.db, "feature_migration_receipts");
	const workflowReceipt = readReceipt(input.workflowService.runtimeStore.db, "workflow_migration_receipts");

	if (dataReceipt && workflowReceipt) {
		assertReceiptsEqual(dataReceipt, workflowReceipt);
		completeSourceArchiveWithoutOpening(sourcePath, dataReceipt.archive_path);
		return emptyResult("already-migrated", dataReceipt.archive_path);
	}
	if (!existsSync(sourcePath)) {
		if (dataReceipt || workflowReceipt) throw new Error("Legacy migration is partially committed but its recoverable source database is missing");
		return emptyResult("not-needed");
	}

	const db = input.dataStore.db;
	const dataUserVersion = pragmaUserVersion(db);
	let sourceAttached = false;
	let workflowAttached = false;
	try {
		db.prepare("ATTACH DATABASE ? AS legacy_source").run(sourcePath);
		sourceAttached = true;
		db.prepare("ATTACH DATABASE ? AS workflow_target").run(input.workflowService.path);
		workflowAttached = true;
		validateLegacySchema(db);
		const digest = legacySourceDigest(db);
		if (dataReceipt && dataReceipt.source_digest !== digest) throw new Error("Pibo migration receipt does not match the recoverable legacy source");
		if (workflowReceipt && workflowReceipt.source_digest !== digest) throw new Error("Workflow migration receipt does not match the recoverable legacy source");
		const archivePath = join(archiveDirectory, `${basename(sourcePath)}.migrated-${digest.slice(0, 16)}`);
		const counts = legacyCounts(db);

		db.exec("BEGIN IMMEDIATE");
		try {
			validateLegacyFacts(db);
			migrateRoomsAndSessions(db);
			migrateWorkflowFacts(db);
			migrateCatalogFacts(db);
			input.hooks?.beforeReceipts?.();
			writeReceipt(db, "main", "feature_migration_receipts", digest, sourcePath, archivePath);
			input.hooks?.afterDataReceipt?.();
			writeReceipt(db, "workflow_target", "workflow_migration_receipts", digest, sourcePath, archivePath);
			if (pragmaUserVersion(db) !== dataUserVersion) throw new Error("Legacy migration attempted to change the Pibo data schema version");
			db.exec("COMMIT");
		} catch (error) {
			if (db.isTransaction) db.exec("ROLLBACK");
			throw error;
		}
		db.exec("DETACH DATABASE workflow_target");
		workflowAttached = false;
		db.exec("DETACH DATABASE legacy_source");
		sourceAttached = false;
		completeSourceArchiveWithoutOpening(sourcePath, archivePath);
		return {
			status: "migrated",
			roomsMigrated: counts.rooms,
			sessionsMigrated: counts.sessions,
			workflowSessionsMigrated: counts.workflowSessions,
			workflowRunsMigrated: counts.runs,
			archivePath,
		};
	} finally {
		if (db.isTransaction) db.exec("ROLLBACK");
		if (workflowAttached) try { db.exec("DETACH DATABASE workflow_target"); } catch { /* preserve primary error */ }
		if (sourceAttached) try { db.exec("DETACH DATABASE legacy_source"); } catch { /* preserve primary error */ }
	}
}

type Receipt = { migration_id: string; source_digest: string; source_path: string; archive_path: string; completed_at: string };
function ensureReceiptTables(dataDb: DatabaseSync, workflowDb: DatabaseSync): void {
	dataDb.exec(`CREATE TABLE IF NOT EXISTS feature_migration_receipts (
		migration_id TEXT PRIMARY KEY, source_digest TEXT NOT NULL, source_path TEXT NOT NULL,
		archive_path TEXT NOT NULL, completed_at TEXT NOT NULL
	)`);
	workflowDb.exec(`CREATE TABLE IF NOT EXISTS workflow_migration_receipts (
		migration_id TEXT PRIMARY KEY, source_digest TEXT NOT NULL, source_path TEXT NOT NULL,
		archive_path TEXT NOT NULL, completed_at TEXT NOT NULL
	)`);
}
function readReceipt(db: DatabaseSync, table: string): Receipt | undefined {
	return db.prepare(`SELECT * FROM ${table} WHERE migration_id = ?`).get(MIGRATION_ID) as Receipt | undefined;
}
function assertReceiptsEqual(left: Receipt, right: Receipt): void {
	for (const key of ["migration_id", "source_digest", "source_path", "archive_path"] as const) {
		if (left[key] !== right[key]) throw new Error(`Legacy migration target receipts disagree on ${key}`);
	}
}
function writeReceipt(db: DatabaseSync, schema: string, table: string, digest: string, sourcePath: string, archivePath: string): void {
	const existing = db.prepare(`SELECT * FROM ${schema}.${table} WHERE migration_id = ?`).get(MIGRATION_ID) as Receipt | undefined;
	if (existing) {
		if (existing.source_digest !== digest || existing.source_path !== sourcePath || existing.archive_path !== archivePath) throw new Error("Legacy migration target has a conflicting receipt");
		return;
	}
	db.prepare(`INSERT INTO ${schema}.${table} (migration_id, source_digest, source_path, archive_path, completed_at) VALUES (?, ?, ?, ?, ?)`)
		.run(MIGRATION_ID, digest, sourcePath, archivePath, new Date().toISOString());
}

function validateLegacySchema(db: DatabaseSync): void {
	const names = new Set((db.prepare("SELECT name FROM legacy_source.sqlite_schema WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
	const missing = LEGACY_TABLES.filter((table) => !names.has(table));
	if (missing.length) throw new Error(`Legacy database is malformed; missing table(s): ${missing.join(", ")}`);
}

function validateLegacyFacts(db: DatabaseSync): void {
	const missingSessions = db.prepare(`SELECT ps.pibo_session_id AS id FROM legacy_source.project_sessions ps
		LEFT JOIN main.sessions s ON s.id = ps.pibo_session_id WHERE s.id IS NULL ORDER BY ps.pibo_session_id`).all() as Array<{ id: string }>;
	if (missingSessions.length) throw new Error(`Legacy links reference missing canonical Pibo Session(s): ${missingSessions.map((row) => row.id).join(", ")}`);
	const missingParents = db.prepare(`SELECT ps.pibo_session_id AS id, ps.parent_main_session_id AS parent_id FROM legacy_source.project_sessions ps
		LEFT JOIN main.sessions parent ON parent.id = ps.parent_main_session_id
		WHERE ps.parent_main_session_id IS NOT NULL AND parent.id IS NULL`).all() as Array<{ id: string; parent_id: string }>;
	if (missingParents.length) throw new Error(`Legacy hierarchy references missing parent Session '${missingParents[0]!.parent_id}' from '${missingParents[0]!.id}'`);
	const hierarchyConflict = db.prepare(`SELECT ps.pibo_session_id AS id FROM legacy_source.project_sessions ps JOIN main.sessions s ON s.id = ps.pibo_session_id
		WHERE ps.parent_main_session_id IS NOT NULL AND s.parent_id IS NOT NULL AND s.parent_id <> ps.parent_main_session_id LIMIT 1`).get() as { id: string } | undefined;
	if (hierarchyConflict) throw new Error(`Legacy hierarchy conflicts with canonical Session '${hierarchyConflict.id}'`);
	const orphanSnapshots = db.prepare(`SELECT x.id FROM legacy_source.project_workflow_session_snapshots x LEFT JOIN legacy_source.project_sessions ps ON ps.pibo_session_id = x.pibo_session_id WHERE ps.pibo_session_id IS NULL LIMIT 1`).get() as { id: string } | undefined;
	if (orphanSnapshots) throw new Error(`Legacy Workflow snapshot '${orphanSnapshots.id}' references a missing Session link`);
	const orphanRuns = db.prepare(`SELECT r.id FROM legacy_source.project_workflow_runs r
		LEFT JOIN legacy_source.project_sessions ps ON ps.pibo_session_id = r.pibo_session_id
		LEFT JOIN legacy_source.project_workflow_session_snapshots x ON x.id = r.snapshot_id
		WHERE ps.pibo_session_id IS NULL OR x.id IS NULL LIMIT 1`).get() as { id: string } | undefined;
	if (orphanRuns) throw new Error(`Legacy Workflow run '${orphanRuns.id}' has a missing Session or snapshot reference`);
	const orphanWait = db.prepare(`SELECT w.id FROM legacy_source.project_workflow_wait_tokens w LEFT JOIN legacy_source.project_workflow_runs r ON r.id = w.workflow_run_id WHERE r.id IS NULL LIMIT 1`).get() as { id: string } | undefined;
	if (orphanWait) throw new Error(`Legacy Workflow wait '${orphanWait.id}' references a missing run`);
	const orphanAction = db.prepare(`SELECT a.id FROM legacy_source.project_workflow_human_actions a
		LEFT JOIN legacy_source.project_workflow_runs r ON r.id = a.workflow_run_id
		LEFT JOIN legacy_source.project_workflow_wait_tokens w ON w.id = a.wait_token_id
		WHERE r.id IS NULL OR w.id IS NULL LIMIT 1`).get() as { id: string } | undefined;
	if (orphanAction) throw new Error(`Legacy Workflow human action '${orphanAction.id}' has a missing run or wait reference`);
	for (const [table, columns] of [
		["projects", ["metadata_json"]], ["project_sessions", ["configuration_json"]],
		["project_workflow_session_snapshots", ["snapshot_json"]],
		["project_workflow_runs", ["current_json", "input_json", "validation_json"]],
		["project_workflow_wait_tokens", ["actions_json", "schema_json", "resume_payload_json"]],
		["project_workflow_human_actions", ["actor_json", "payload_json"]],
	] as Array<[string, string[]]>) validateJsonColumns(db, `legacy_source.${table}`, columns);
}

function validateJsonColumns(db: DatabaseSync, table: string, columns: string[]): void {
	for (const column of columns) {
		const bad = db.prepare(`SELECT rowid AS id FROM ${table} WHERE ${column} IS NOT NULL AND json_valid(${column}) = 0 LIMIT 1`).get() as { id: number } | undefined;
		if (bad) throw new Error(`Legacy database contains malformed JSON in ${table}.${column} at row ${bad.id}`);
	}
}

function migrateRoomsAndSessions(db: DatabaseSync): void {
	const projects = db.prepare("SELECT * FROM legacy_source.projects ORDER BY id").all() as LegacyProjectRow[];
	for (const source of projects) {
		const roomId = migratedRoomId(source.id);
		const metadata = { workspace: source.project_folder, migration: { kind: "legacy-container", sourceId: source.id }, ...(source.archived_at ? { chatRoomArchivedAt: source.archived_at } : {}) };
		insertOrAssert(db, "main.rooms", "id", {
			id: roomId, name: source.name, topic: source.description, type: "chat", parent_room_id: null,
			workspace: source.project_folder, archived_at: source.archived_at, retention_policy_id: null,
			metadata_json: JSON.stringify(metadata), created_at: source.created_at, updated_at: source.updated_at,
		});
	}
	const links = db.prepare("SELECT * FROM legacy_source.project_sessions ORDER BY created_at, pibo_session_id").all() as LegacySessionRow[];
	for (const link of links) {
		const sourceProject = projects.find((project) => project.id === link.project_id);
		if (!sourceProject) throw new Error(`Legacy Session '${link.pibo_session_id}' references missing container '${link.project_id}'`);
		const session = db.prepare("SELECT * FROM main.sessions WHERE id = ?").get(link.pibo_session_id) as CanonicalSessionRow;
		const metadata = parseObject(session.metadata_json, `Session '${session.id}' metadata`);
		delete metadata.projectId;
		delete metadata.projectSessionKind;
		const workflowBacked = isWorkflowBacked(link);
		if (workflowBacked) {
			metadata.workflowSessionKind = link.kind === "main" ? "main_workflow" : "agent_node";
			metadata.workflowId = link.workflow_id;
			if (link.workflow_version) metadata.workflowVersion = link.workflow_version;
			if (link.workflow_run_id) metadata.workflowRunId = link.workflow_run_id;
		}
		const parentId = session.parent_id ?? link.parent_main_session_id;
		const rootId = session.root_session_id || (parentId ? canonicalRootId(db, parentId) : session.id);
		const archivedAt = session.archived_at ?? (link.archived ? link.updated_at : null);
		db.prepare(`UPDATE main.sessions SET room_id = ?, root_session_id = ?, parent_id = ?, workspace = COALESCE(NULLIF(workspace, ''), ?),
			archived_at = ?, metadata_json = ? WHERE id = ?`).run(migratedRoomId(link.project_id), rootId, parentId, sourceProject.project_folder, archivedAt, JSON.stringify(metadata), session.id);
		const updated = db.prepare("SELECT * FROM main.sessions WHERE id = ?").get(session.id) as CanonicalSessionRow;
		const childCount = Number((db.prepare("SELECT COUNT(*) AS count FROM main.sessions WHERE parent_id = ? AND deleted_at IS NULL").get(session.id) as { count: number }).count);
		insertOrUpdateNavigation(db, updated, childCount);
	}
}

function migrateWorkflowFacts(db: DatabaseSync): void {
	const links = db.prepare("SELECT * FROM legacy_source.project_sessions ORDER BY pibo_session_id").all() as LegacySessionRow[];
	for (const link of links.filter(isWorkflowBacked)) {
		if (!link.workflow_version) throw new Error(`Legacy Workflow Session '${link.pibo_session_id}' has no workflow version`);
		const state = normalizeLinkState(link.state);
		insertOrAssert(db, "workflow_target.workflow_session_links", "pibo_session_id", {
			pibo_session_id: link.pibo_session_id, workflow_id: link.workflow_id, workflow_version: link.workflow_version,
			workflow_run_id: link.workflow_run_id, state, configuration_json: link.configuration_json,
			created_at: link.created_at, updated_at: link.updated_at,
		});
	}
	const snapshots = db.prepare("SELECT * FROM legacy_source.project_workflow_session_snapshots ORDER BY id").all() as LegacySnapshotRow[];
	for (const row of snapshots) {
		const snapshot = parseObject(row.snapshot_json, `Workflow snapshot '${row.id}'`);
		delete snapshot.projectId;
		snapshot.piboSessionId = row.pibo_session_id;
		insertOrAssert(db, "workflow_target.workflow_session_snapshots", "id", {
			id: row.id, pibo_session_id: row.pibo_session_id, workflow_id: row.workflow_id, workflow_version: row.workflow_version,
			base_definition_hash: row.base_definition_hash, effective_definition_hash: row.effective_definition_hash,
			snapshot_json: JSON.stringify(snapshot), created_at: row.created_at,
		});
		const effectiveDefinition = requireObject(snapshot.effectiveDefinition, `Workflow snapshot '${row.id}' effective definition`);
		insertOrAssert(db, "workflow_target.workflow_definition_snapshots", "id", {
			id: row.id, workflow_id: row.workflow_id, workflow_version: row.workflow_version,
			definition_hash: row.effective_definition_hash, compiled_definition_json: JSON.stringify(effectiveDefinition), created_at: row.created_at,
		});
	}
	const runs = db.prepare("SELECT * FROM legacy_source.project_workflow_runs ORDER BY id").all() as LegacyRunRow[];
	for (const run of runs) {
		insertOrAssert(db, "workflow_target.workflow_runs", "id", {
			id: run.id, workflow_id: run.workflow_id, workflow_version: run.workflow_version,
			workflow_definition_hash: run.effective_definition_hash, definition_snapshot_id: run.snapshot_id,
			parent_run_id: null, parent_node_attempt_id: null, pibo_session_id: run.pibo_session_id, environment_json: null,
			status: run.status, current_node_id: null, current_edge_id: null, current_status: run.status,
			current_json: run.current_json, input_json: run.input_json, output_json: null, output_present: 0,
			state_json: "{\"global\":{}}", checkpoint_json: null, validation_json: run.validation_json,
			created_at: run.created_at, updated_at: run.updated_at, completed_at: run.completed_at, failed_at: run.failed_at, cancelled_at: run.cancelled_at,
		});
	}
	const waits = db.prepare("SELECT * FROM legacy_source.project_workflow_wait_tokens ORDER BY id").all() as LegacyWaitRow[];
	for (const wait of waits) insertOrAssert(db, "workflow_target.workflow_wait_tokens", "id", {
		id: wait.id, workflow_run_id: wait.workflow_run_id, node_attempt_id: wait.node_attempt_id, human_node_id: wait.human_node_id,
		kind: null, available_actions_json: wait.actions_json, prompt: wait.prompt, schema_json: wait.schema_json, status: wait.status,
		resume_payload_json: wait.resume_payload_json, resume_payload_present: wait.resume_payload_present, expires_at: wait.expires_at,
		created_at: wait.created_at, resolved_at: wait.resolved_at,
	});
	const actions = db.prepare("SELECT * FROM legacy_source.project_workflow_human_actions ORDER BY id").all() as LegacyActionRow[];
	for (const action of actions) insertOrAssert(db, "workflow_target.workflow_human_actions", "id", {
		id: action.id, workflow_run_id: action.workflow_run_id, wait_token_id: action.wait_token_id, action_id: action.action_id,
		kind: action.kind, actor_json: action.actor_json, payload_json: action.payload_present ? action.payload_json : null, created_at: action.created_at,
	});
}

function migrateCatalogFacts(db: DatabaseSync): void {
	const tables = new Set((db.prepare("SELECT name FROM main.sqlite_schema WHERE type = 'table' AND name LIKE 'workflow_%'").all() as Array<{ name: string }>).map((row) => row.name));
	if (tables.has("workflow_ui_drafts")) {
		validateJsonColumns(db, "main.workflow_ui_drafts", ["definition_json", "diagnostics_json", "validation_json"]);
		for (const row of db.prepare("SELECT * FROM main.workflow_ui_drafts ORDER BY draft_id").all() as Array<Record<string, unknown>>) {
			insertOrAssert(db, "workflow_target.workflow_drafts", "draft_id", {
				draft_id: row.draft_id, workflow_id: row.workflow_id, source: row.source, status: row.status,
				base_workflow_id: row.base_workflow_id, base_workflow_version: row.base_workflow_version, base_definition_hash: row.base_definition_hash,
				target_workflow_version: row.target_workflow_version, version_intent: row.version_intent, definition_json: row.definition_json,
				diagnostics_json: row.diagnostics_json, validation_json: row.validation_json, validation_state: row.validation_state,
				revision: row.revision, created_by: null, created_at: row.created_at, updated_by: null, updated_at: row.updated_at,
			});
		}
	}
	copySameShape(db, tables, "workflow_published_versions", ["workflow_id", "version"]);
	copySameShape(db, tables, "workflow_archive_states", ["workflow_id"]);
	copySameShape(db, tables, "workflow_prompt_assets", ["asset_id"]);
	copySameShape(db, tables, "workflow_prompt_asset_revisions", ["revision_id"]);
	if (tables.has("workflow_delete_tombstones")) {
		for (const row of db.prepare("SELECT * FROM main.workflow_delete_tombstones ORDER BY workflow_id").all() as Array<Record<string, unknown>>) insertOrAssert(db, "workflow_target.workflow_delete_tombstones", "workflow_id", {
			workflow_id: row.workflow_id, source: row.source, deleted: row.deleted, deleted_at: row.deleted_at, deleted_by: row.deleted_by,
			last_known_title: row.last_known_title, last_known_version: row.last_known_version, last_definition_hash: row.last_definition_hash, created_at: row.updated_at,
		});
	}
	if (tables.has("workflow_lifecycle_events")) {
		for (const row of db.prepare("SELECT * FROM main.workflow_lifecycle_events ORDER BY id").all() as Array<Record<string, unknown>>) insertOrAssert(db, "workflow_target.workflow_lifecycle_events", "id", {
			id: row.id, type: normalizeLifecycleType(String(row.type)), actor_id: row.actor_id, workflow_id: row.workflow_id, workflow_version: row.workflow_version,
			draft_id: row.draft_id, pibo_session_id: row.pibo_session_id, workflow_run_id: row.workflow_run_id, status: row.status,
			validation_json: row.validation_json, diagnostics_json: row.diagnostics_json, payload_json: row.payload_json, created_at: row.created_at,
		});
	}
	migrateDerivedWorkflowIdentities(db);
}

function migrateDerivedWorkflowIdentities(db: DatabaseSync): void {
	const rows = db.prepare(`SELECT workflow_id, MIN(created_at) AS created_at, MAX(updated_at) AS updated_at FROM (
		SELECT workflow_id, created_at, updated_at FROM workflow_target.workflow_drafts
		UNION ALL SELECT workflow_id, created_at, published_at FROM workflow_target.workflow_published_versions
	) GROUP BY workflow_id ORDER BY workflow_id`).all() as Array<{ workflow_id: string; created_at: string; updated_at: string }>;
	for (const row of rows) {
		const draft = db.prepare("SELECT draft_id, definition_json FROM workflow_target.workflow_drafts WHERE workflow_id = ? ORDER BY updated_at DESC LIMIT 1").get(row.workflow_id) as { draft_id: string; definition_json: string } | undefined;
		const published = db.prepare("SELECT version, definition_json FROM workflow_target.workflow_published_versions WHERE workflow_id = ? ORDER BY published_at DESC LIMIT 1").get(row.workflow_id) as { version: string; definition_json: string } | undefined;
		const definition = parseObject(draft?.definition_json ?? published?.definition_json ?? "{}", `Workflow identity '${row.workflow_id}' definition`);
		insertOrAssert(db, "workflow_target.workflow_identities", "workflow_id", {
			workflow_id: row.workflow_id, source: "ui", title: typeof definition.title === "string" ? definition.title : row.workflow_id,
			description: typeof definition.description === "string" ? definition.description : null,
			tags_json: JSON.stringify(Array.isArray(definition.metadata) ? [] : requireObjectOrEmpty(definition.metadata).tags ?? []),
			current_draft_id: draft?.draft_id ?? null, latest_version: published?.version ?? null, created_by: null,
			created_at: row.created_at, updated_by: null, updated_at: row.updated_at,
		});
	}
}

function copySameShape(db: DatabaseSync, tables: Set<string>, table: string, keyColumns: string[]): void {
	if (!tables.has(table)) return;
	const targetColumns = (db.prepare(`PRAGMA workflow_target.table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
	const sourceColumns = new Set((db.prepare(`PRAGMA main.table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name));
	const columns = targetColumns.filter((column) => sourceColumns.has(column));
	const rows = db.prepare(`SELECT ${columns.join(", ")} FROM main.${table} ORDER BY ${keyColumns.join(", ")}`).all() as Array<Record<string, unknown>>;
	for (const row of rows) insertOrAssert(db, `workflow_target.${table}`, keyColumns, row);
}

function insertOrAssert(db: DatabaseSync, table: string, key: string | string[], values: Record<string, unknown>): void {
	const keys = Array.isArray(key) ? key : [key];
	const where = keys.map((column) => `${column} = ?`).join(" AND ");
	const existing = db.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...keys.map((column) => values[column])) as Record<string, unknown> | undefined;
	if (existing) {
		for (const [column, value] of Object.entries(values)) {
			if (!sqliteValuesEqual(existing[column], value)) throw new Error(`Migration conflict in ${table} for ${keys.map((column) => `${column}=${String(values[column])}`).join(", ")} at ${column}`);
		}
		return;
	}
	const columns = Object.keys(values);
	db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).run(...columns.map((column) => values[column] ?? null));
}

function insertOrUpdateNavigation(db: DatabaseSync, session: CanonicalSessionRow, childCount: number): void {
	db.prepare(`INSERT INTO main.session_navigation (
		room_id, session_id, root_session_id, parent_id, origin_id, title, profile, status, archived_at,
		last_activity_at, last_message_preview, child_count, sort_key, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(session_id) DO UPDATE SET room_id=excluded.room_id, root_session_id=excluded.root_session_id,
		parent_id=excluded.parent_id, origin_id=excluded.origin_id, title=excluded.title, profile=excluded.profile,
		status=excluded.status, archived_at=excluded.archived_at, last_activity_at=excluded.last_activity_at,
		child_count=excluded.child_count, updated_at=excluded.updated_at`).run(
		session.room_id, session.id, session.root_session_id, session.parent_id, session.origin_id, session.title, session.profile,
		session.status, session.archived_at, session.last_activity_at, session.first_message_preview, childCount,
		session.last_activity_at, session.updated_at,
	);
}

function legacySourceDigest(db: DatabaseSync): string {
	const facts: Record<string, unknown> = {};
	for (const table of LEGACY_TABLES) facts[table] = db.prepare(`SELECT * FROM legacy_source.${table} ORDER BY rowid`).all();
	for (const table of ["workflow_ui_drafts", "workflow_published_versions", "workflow_archive_states", "workflow_delete_tombstones", "workflow_prompt_assets", "workflow_prompt_asset_revisions", "workflow_lifecycle_events"]) {
		if (db.prepare("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name=?").get(table)) facts[`catalog:${table}`] = db.prepare(`SELECT * FROM main.${table} ORDER BY rowid`).all();
	}
	return createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}
function legacyCounts(db: DatabaseSync): { rooms: number; sessions: number; workflowSessions: number; runs: number } {
	const count = (table: string, where = "") => Number((db.prepare(`SELECT COUNT(*) AS count FROM legacy_source.${table} ${where}`).get() as { count: number }).count);
	return { rooms: count("projects"), sessions: count("project_sessions"), workflowSessions: count("project_sessions", "WHERE workflow_id <> 'simple-chat' OR state NOT IN ('simple_chat', '')"), runs: count("project_workflow_runs") };
}
function migratedRoomId(sourceId: string): string { return `room_migrated_${createHash("sha256").update(sourceId).digest("hex").slice(0, 24)}`; }
function canonicalRootId(db: DatabaseSync, parentId: string): string { const row = db.prepare("SELECT root_session_id FROM main.sessions WHERE id = ?").get(parentId) as { root_session_id: string | null } | undefined; if (!row) throw new Error(`Missing canonical parent Session '${parentId}'`); return row.root_session_id || parentId; }
function isWorkflowBacked(row: LegacySessionRow): boolean { return row.workflow_id !== "simple-chat" || (row.state !== null && row.state !== "simple_chat"); }
function normalizeLinkState(value: string | null): string { if (value === "running" || value === "waiting" || value === "completed" || value === "failed" || value === "cancelled" || value === "configured") return value; if (value === "workflow") return "configured"; throw new Error(`Unsupported legacy Workflow Session state '${String(value)}'`); }
function normalizeLifecycleType(value: string): string { return value.replace(/^project\.workflow_session\.created$/, "workflow.session.created").replace(/^project\.workflow_start\./, "workflow.start."); }
function parseObject(value: unknown, label: string): Record<string, unknown> { const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value; if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} is not a JSON object`); return parsed as Record<string, unknown>; }
function requireObject(value: unknown, label: string): Record<string, unknown> { return parseObject(value, label); }
function requireObjectOrEmpty(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function sqliteValuesEqual(left: unknown, right: unknown): boolean { return (left ?? null) === (right ?? null); }
function pragmaUserVersion(db: DatabaseSync): number { return Number((db.prepare("PRAGMA main.user_version").get() as { user_version: number }).user_version); }
function completeSourceArchiveWithoutOpening(sourcePath: string, archivePath: string): void {
	if (!existsSync(sourcePath)) return;
	mkdirSync(dirname(archivePath), { recursive: true });
	if (existsSync(archivePath)) throw new Error(`Cannot archive legacy source because '${archivePath}' already exists`);
	renameSync(sourcePath, archivePath);
	for (const suffix of ["-wal", "-shm"]) if (existsSync(`${sourcePath}${suffix}`)) renameSync(`${sourcePath}${suffix}`, `${archivePath}${suffix}`);
}
function emptyResult(status: "not-needed" | "already-migrated", archivePath?: string): LegacyProjectMigrationResult { return { status, roomsMigrated: 0, sessionsMigrated: 0, workflowSessionsMigrated: 0, workflowRunsMigrated: 0, ...(archivePath ? { archivePath } : {}) }; }

type LegacyProjectRow = { id: string; name: string; description: string | null; project_folder: string; archived_at: string | null; created_at: string; updated_at: string };
type LegacySessionRow = { project_id: string; pibo_session_id: string; kind: "main" | "sub"; workflow_id: string; workflow_version: string | null; workflow_run_id: string | null; parent_main_session_id: string | null; state: string | null; configuration_json: string | null; archived: number; created_at: string; updated_at: string };
type LegacySnapshotRow = { id: string; pibo_session_id: string; workflow_id: string; workflow_version: string; base_definition_hash: string; effective_definition_hash: string; snapshot_json: string; created_at: string };
type LegacyRunRow = { id: string; pibo_session_id: string; workflow_id: string; workflow_version: string; snapshot_id: string; effective_definition_hash: string; status: string; current_json: string; input_json: string; validation_json: string | null; created_at: string; updated_at: string; completed_at: string | null; failed_at: string | null; cancelled_at: string | null };
type LegacyWaitRow = { id: string; workflow_run_id: string; node_attempt_id: string | null; human_node_id: string | null; actions_json: string; prompt: string; schema_json: string | null; status: string; resume_payload_json: string | null; resume_payload_present: number; expires_at: string | null; created_at: string; resolved_at: string | null };
type LegacyActionRow = { id: string; workflow_run_id: string; wait_token_id: string; action_id: string | null; kind: string; actor_json: string | null; payload_json: string | null; payload_present: number; created_at: string };
type CanonicalSessionRow = { id: string; room_id: string | null; root_session_id: string | null; parent_id: string | null; origin_id: string | null; profile: string; workspace: string | null; title: string; first_message_preview: string | null; status: string; archived_at: string | null; metadata_json: string; updated_at: string; last_activity_at: string };
