import assert from "node:assert/strict";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { ChatSessionQueryService } from "../dist/apps/chat/data/session-query-service.js";
import { migrateLegacyProjects } from "../dist/apps/chat/data/legacy-project-migration.js";
import { ChatWorkflowSessionService } from "../dist/apps/chat/data/workflow-session-service.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../dist/sessions/pibo-data-store.js";
import {
	createLegacyProjectMigrationFixture,
	fixtureTimes,
	installLegacyCatalog,
} from "./fixtures/legacy-project-migration.mjs";

const migrationId = "remove-legacy-containers-v1";

function migrate(fixture, extra = {}) {
	return migrateLegacyProjects({
		dataStore: fixture.dataStore,
		workflowService: fixture.workflowService,
		legacyProjectPath: fixture.legacyPath,
		archiveDirectory: join(fixture.root, "backups"),
		...extra,
	});
}

function receiptCount(db, table) {
	return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE migration_id=?`).get(migrationId).count;
}

test("fresh storage does not create or open the retired database", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-legacy-project-fresh-"));
	const legacyPath = join(root, "web-projects.sqlite");
	const dataStore = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const workflowService = new ChatWorkflowSessionService(join(root, "pibo-workflows.sqlite"));
	try {
		const result = migrateLegacyProjects({ dataStore, workflowService, legacyProjectPath: legacyPath });
		assert.deepEqual(result, {
			status: "not-needed",
			roomsMigrated: 0,
			sessionsMigrated: 0,
			workflowSessionsMigrated: 0,
			workflowRunsMigrated: 0,
		});
		assert.equal(existsSync(legacyPath), false);
		assert.equal(dataStore.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='projects'").get(), undefined);
		assert.equal(workflowService.runtimeStore.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='project_sessions'").get(), undefined);
	} finally {
		workflowService.close();
		dataStore.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("valid upgrade preserves canonical Sessions/history, migrates same-definition Workflows and catalog, archives source, and reopens", () => {
	const fixture = createLegacyProjectMigrationFixture();
	try {
		installLegacyCatalog(fixture.dataStore);
		const before = new Map([fixture.parentId, fixture.childId].map((id) => [id, fixture.sessions.get(id)]));
		const beforeMessages = new Map([fixture.parentId, fixture.childId].map((id) => [id, fixture.dataStore.messages.listMessages(id)]));
		const beforeEvents = new Map([fixture.parentId, fixture.childId].map((id) => [id, fixture.dataStore.db.prepare("SELECT type, preview_text FROM event_log WHERE session_id=? ORDER BY stream_id").all(id)]));
		const result = migrate(fixture);

		assert.equal(result.status, "migrated");
		assert.deepEqual({ rooms: result.roomsMigrated, sessions: result.sessionsMigrated, workflowSessions: result.workflowSessionsMigrated, runs: result.workflowRunsMigrated }, { rooms: 1, sessions: 2, workflowSessions: 2, runs: 1 });
		assert.equal(existsSync(fixture.legacyPath), false);
		assert.equal(existsSync(result.archivePath), true);
		assert.equal(result.archivePath.startsWith(join(fixture.root, "backups")), true);
		const archivedSource = new DatabaseSync(result.archivePath, { readOnly: true });
		try {
			assert.equal(archivedSource.prepare("SELECT COUNT(*) AS count FROM project_sessions").get().count, 2);
			assert.equal(archivedSource.prepare("SELECT COUNT(*) AS count FROM project_workflow_session_snapshots").get().count, 2);
		} finally { archivedSource.close(); }

		const parent = fixture.sessions.get(fixture.parentId);
		const child = fixture.sessions.get(fixture.childId);
		assert.equal(parent.id, fixture.parentId);
		assert.equal(child.id, fixture.childId);
		assert.equal(parent.title, before.get(fixture.parentId).title);
		assert.equal(parent.profile, "planner");
		assert.deepEqual(parent.activeModel, { provider: "openai", id: "gpt-preserved" });
		assert.equal(parent.workspace, before.get(fixture.parentId).workspace);
		assert.equal(parent.runtimeBinding.runtimeInstanceId, "codex-primary");
		assert.equal(parent.runtimeBinding.nativeSessionId, "thread-parent");
		assert.deepEqual(parent.runtimeBinding.metadata, { durableBinding: true });
		assert.equal(child.parentId, fixture.parentId);
		assert.equal(child.originId, "ps_origin_preserved");
		assert.equal(child.workspace, fixture.workspace);
		assert.equal(child.metadata.customFact, "keep-child");
		assert.equal(child.metadata.projectId, undefined);
		assert.equal(child.metadata.projectSessionKind, undefined);
		assert.equal(parent.createdAt, fixtureTimes.created);
		assert.equal(parent.updatedAt, fixtureTimes.updated);
		assert.deepEqual(fixture.dataStore.messages.listMessages(fixture.parentId), beforeMessages.get(fixture.parentId));
		assert.deepEqual(fixture.dataStore.messages.listMessages(fixture.childId), beforeMessages.get(fixture.childId));
		assert.deepEqual(fixture.dataStore.db.prepare("SELECT type, preview_text FROM event_log WHERE session_id=? ORDER BY stream_id").all(fixture.parentId), beforeEvents.get(fixture.parentId));
		assert.deepEqual(fixture.dataStore.db.prepare("SELECT type, preview_text FROM event_log WHERE session_id=? ORDER BY stream_id").all(fixture.childId), beforeEvents.get(fixture.childId));

		const roomId = parent.metadata.chatRoomId;
		assert.equal(typeof roomId, "string");
		assert.equal(child.metadata.chatRoomId, roomId);
		const room = fixture.dataStore.db.prepare("SELECT * FROM rooms WHERE id=?").get(roomId);
		assert.equal(room.name, "Migrated workspace");
		assert.equal(room.workspace, fixture.workspace);
		assert.equal(JSON.parse(room.metadata_json).chatRoomArchivedAt, fixtureTimes.archived);
		assert.equal(fixture.dataStore.db.prepare("SELECT archived_at FROM sessions WHERE id=?").get(fixture.childId).archived_at, fixtureTimes.archived);

		const query = new ChatSessionQueryService(fixture.dataStore);
		query.upsertSessionsIfChanged([parent, child]);
		assert.equal(fixture.dataStore.db.prepare("SELECT room_id, archived_at FROM sessions WHERE id=?").get(fixture.childId).room_id, roomId);
		assert.equal(fixture.dataStore.db.prepare("SELECT archived_at FROM sessions WHERE id=?").get(fixture.childId).archived_at, fixtureTimes.archived);
		assert.equal(fixture.dataStore.db.prepare("SELECT archived_at FROM session_navigation WHERE session_id=?").get(fixture.childId).archived_at, fixtureTimes.archived);

		const parentLink = fixture.workflowService.getWorkflowSession(fixture.parentId);
		const childLink = fixture.workflowService.getWorkflowSession(fixture.childId);
		assert.equal(parentLink.workflowRunId, "wfr_legacy");
		assert.equal(childLink.workflowRunId, undefined);
		assert.equal(childLink.state, "configured");
		assert.equal(fixture.workflowService.getWorkflowSessionSnapshotForSession(fixture.parentId).id, "wfs_parent");
		assert.equal(fixture.workflowService.getWorkflowSessionSnapshotForSession(fixture.childId).id, "wfs_child");
		assert.equal(fixture.workflowService.runtimeStore.listDefinitionSnapshots({ workflowId: "workflow.same-definition" }).length, 1);
		assert.equal(fixture.workflowService.getWorkflowRun("wfr_legacy").status, "waiting");
		assert.deepEqual(fixture.workflowService.listWorkflowWaitTokens({ workflowRunId: "wfr_legacy" }).map((entry) => entry.id).sort(), ["wwt_pending", "wwt_resolved"]);
		assert.equal(fixture.workflowService.listWorkflowHumanActions({ workflowRunId: "wfr_legacy" })[0].actionId, "approve");

		const workflowDb = fixture.workflowService.runtimeStore.db;
		assert.equal(workflowDb.prepare("SELECT target_workflow_version FROM workflow_drafts WHERE draft_id='wfd_legacy'").get().target_workflow_version, "1.1.0");
		assert.equal(workflowDb.prepare("SELECT markdown FROM workflow_prompt_asset_revisions WHERE revision_id='revision_legacy'").get().markdown, "# Preserved prompt");
		assert.equal(workflowDb.prepare("SELECT type FROM workflow_lifecycle_events WHERE id='wfle_legacy'").get().type, "workflow.start.accepted");
		assert.equal(workflowDb.prepare("SELECT last_known_title FROM workflow_delete_tombstones WHERE workflow_id='workflow.deleted-legacy'").get().last_known_title, "Deleted legacy");
		const retiredCatalogTables = fixture.dataStore.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND (name='workflow_ui_drafts' OR name IN ('workflow_published_versions', 'workflow_archive_states', 'workflow_delete_tombstones', 'workflow_prompt_assets', 'workflow_prompt_asset_revisions', 'workflow_lifecycle_events')) ORDER BY name").all();
		assert.deepEqual(retiredCatalogTables, [], "successfully copied catalog tables must be retired from pibo.sqlite");
		assert.equal(receiptCount(fixture.dataStore.db, "feature_migration_receipts"), 1);
		assert.equal(receiptCount(workflowDb, "workflow_migration_receipts"), 1);

		fixture.close();
		const reopenedData = new PiboDataStore(fixture.dataPath, { payloadRootDir: join(fixture.root, "payloads") });
		const reopenedSessions = new PiboDataSessionStore(reopenedData);
		const reopenedWorkflow = new ChatWorkflowSessionService(fixture.workflowPath);
		try {
			const reopenedResult = migrateLegacyProjects({ dataStore: reopenedData, workflowService: reopenedWorkflow, legacyProjectPath: fixture.legacyPath, archiveDirectory: join(fixture.root, "backups") });
			assert.equal(reopenedResult.status, "already-migrated");
			assert.equal(reopenedSessions.get(fixture.parentId).title, "Preserved parent title");
			assert.equal(reopenedData.messages.listMessages(fixture.parentId).length, 1);
			assert.equal(reopenedWorkflow.getWorkflowRun("wfr_legacy").id, "wfr_legacy");
		} finally {
			reopenedWorkflow.close();
			reopenedData.close();
		}
	} finally {
		fixture.cleanup();
	}
});

test("catalog-only upgrades transfer and retire old pibo.sqlite catalog tables without a retired database", () => {
	const root = mkdtempSync(join(tmpdir(), "pibo-legacy-catalog-only-"));
	const legacyPath = join(root, "web-projects.sqlite");
	const dataStore = new PiboDataStore(join(root, "pibo.sqlite"), { payloadRootDir: join(root, "payloads") });
	const workflowService = new ChatWorkflowSessionService(join(root, "pibo-workflows.sqlite"));
	try {
		installLegacyCatalog(dataStore);
		const result = migrateLegacyProjects({ dataStore, workflowService, legacyProjectPath: legacyPath, archiveDirectory: join(root, "backups") });
		assert.equal(existsSync(legacyPath), false);
		assert.notEqual(result.status, "not-needed");
		assert.equal(workflowService.runtimeStore.db.prepare("SELECT target_workflow_version FROM workflow_drafts WHERE draft_id='wfd_legacy'").get().target_workflow_version, "1.1.0");
		assert.equal(dataStore.db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='workflow_ui_drafts'").get(), undefined);
	} finally {
		workflowService.close();
		dataStore.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test("malformed, missing-reference, and conflicting target sources fail visibly and remain recoverable", async (t) => {
	await t.test("malformed JSON", () => {
		const fixture = createLegacyProjectMigrationFixture({ malformedJson: true });
		try {
			assert.throws(() => migrate(fixture), /malformed JSON/);
			assert.equal(existsSync(fixture.legacyPath), true);
			assert.equal(receiptCount(fixture.dataStore.db, "feature_migration_receipts"), 0);
		} finally { fixture.cleanup(); }
	});
	await t.test("missing canonical Session", () => {
		const fixture = createLegacyProjectMigrationFixture({ omitCanonicalSession: "ps_legacy_child" });
		try {
			assert.throws(() => migrate(fixture), /missing canonical Pibo Session/);
			assert.equal(existsSync(fixture.legacyPath), true);
			assert.equal(receiptCount(fixture.workflowService.runtimeStore.db, "workflow_migration_receipts"), 0);
		} finally { fixture.cleanup(); }
	});
	await t.test("conflicting Workflow target", () => {
		const fixture = createLegacyProjectMigrationFixture();
		try {
			fixture.workflowService.addWorkflowSession({ piboSessionId: fixture.parentId, workflowId: "workflow.conflict", workflowVersion: "9.0.0" });
			assert.throws(() => migrate(fixture), /Migration conflict/);
			assert.equal(existsSync(fixture.legacyPath), true);
			assert.equal(fixture.workflowService.getWorkflowSession(fixture.parentId).workflowId, "workflow.conflict");
		} finally { fixture.cleanup(); }
	});
});

test("fault before receipts rolls back target writes and remains replayable", () => {
	const fixture = createLegacyProjectMigrationFixture();
	try {
		assert.throws(() => migrate(fixture, { hooks: { beforeReceipts() { throw new Error("fixture fault before receipts"); } } }), /fixture fault before receipts/);
		assert.equal(existsSync(fixture.legacyPath), true);
		assert.equal(receiptCount(fixture.dataStore.db, "feature_migration_receipts"), 0);
		assert.equal(receiptCount(fixture.workflowService.runtimeStore.db, "workflow_migration_receipts"), 0);
		assert.equal(fixture.workflowService.getWorkflowSession(fixture.parentId), undefined);
		assert.equal(fixture.dataStore.db.prepare("SELECT COUNT(*) AS count FROM rooms").get().count, 0);
		assert.equal(migrate(fixture).status, "migrated");
	} finally { fixture.cleanup(); }
});

test("a partial target receipt is detected and idempotently replayed before source retirement", () => {
	const fixture = createLegacyProjectMigrationFixture();
	try {
		const first = migrate(fixture);
		renameSync(first.archivePath, fixture.legacyPath);
		fixture.workflowService.runtimeStore.db.prepare("DELETE FROM workflow_migration_receipts WHERE migration_id=?").run(migrationId);
		assert.equal(receiptCount(fixture.dataStore.db, "feature_migration_receipts"), 1);
		assert.equal(receiptCount(fixture.workflowService.runtimeStore.db, "workflow_migration_receipts"), 0);
		assert.equal(existsSync(fixture.legacyPath), true);
		const replay = migrate(fixture);
		assert.equal(replay.status, "migrated");
		assert.equal(existsSync(fixture.legacyPath), false);
		assert.equal(existsSync(replay.archivePath), true);
		assert.equal(receiptCount(fixture.workflowService.runtimeStore.db, "workflow_migration_receipts"), 1);
		assert.equal(fixture.workflowService.runtimeStore.listDefinitionSnapshots({ workflowId: "workflow.same-definition" }).length, 1);
	} finally { fixture.cleanup(); }
});

test("disagreeing target receipts fail without consuming the recoverable source", () => {
	const fixture = createLegacyProjectMigrationFixture();
	try {
		const first = migrate(fixture);
		renameSync(first.archivePath, fixture.legacyPath);
		fixture.workflowService.runtimeStore.db.prepare("UPDATE workflow_migration_receipts SET source_digest='conflicting-digest' WHERE migration_id=?").run(migrationId);
		assert.throws(() => migrate(fixture), /receipts disagree on source_digest/);
		assert.equal(existsSync(fixture.legacyPath), true);
	} finally { fixture.cleanup(); }
});

test("migration durably commits both WAL targets before retiring sources and restores normal settings", () => {
	const fixture = createLegacyProjectMigrationFixture();
	try {
		fixture.dataStore.db.exec("PRAGMA synchronous = NORMAL");
		migrate(fixture, { hooks: { beforeReceipts() {
			assert.equal(fixture.dataStore.db.prepare("PRAGMA main.synchronous").get().synchronous, 2);
			assert.equal(fixture.dataStore.db.prepare("PRAGMA workflow_target.synchronous").get().synchronous, 2);
			assert.equal(existsSync(fixture.legacyPath), true);
		} } });
		assert.equal(fixture.dataStore.db.prepare("PRAGMA synchronous").get().synchronous, 1);
	} finally { fixture.cleanup(); }
});

test("partial migration reconstructs an entirely missing Workflow target from the retained source", () => {
	const fixture = createLegacyProjectMigrationFixture();
	const recovered = new ChatWorkflowSessionService(join(fixture.root, "recovered-workflows.sqlite"));
	try {
		const first = migrate(fixture);
		renameSync(first.archivePath, fixture.legacyPath);
		assert.equal(migrate(fixture, { workflowService: recovered }).status, "migrated");
		assert.equal(recovered.getWorkflowSession(fixture.parentId).workflowRunId, "wfr_legacy");
		assert.equal(recovered.listWorkflowWaitTokens({ workflowRunId: "wfr_legacy" }).length, 2);
		assert.equal(recovered.listWorkflowHumanActions({ workflowRunId: "wfr_legacy" }).length, 1);
		assert.equal(fixture.sessions.get(fixture.childId).parentId, fixture.parentId);
	} finally { recovered.close(); fixture.cleanup(); }
});

test("partial migration replays Pibo target changes when only the Workflow target committed", () => {
	const fixture = createLegacyProjectMigrationFixture();
	const recoveryPath = join(fixture.root, "pibo-before-migration.sqlite");
	let recovered;
	try {
		fixture.dataStore.db.prepare("VACUUM INTO ?").run(recoveryPath);
		const first = migrate(fixture);
		renameSync(first.archivePath, fixture.legacyPath);
		recovered = new PiboDataStore(recoveryPath, { payloadRootDir: join(fixture.root, "payloads") });
		assert.equal(migrate(fixture, { dataStore: recovered }).status, "migrated");
		const sessions = new PiboDataSessionStore(recovered);
		assert.equal(sessions.get(fixture.parentId).metadata.chatRoomId, fixture.sessions.get(fixture.parentId).metadata.chatRoomId);
		assert.equal(sessions.get(fixture.parentId).runtimeBinding.nativeSessionId, "thread-parent");
		assert.equal(recovered.messages.listMessages(fixture.parentId).length, 1);
	} finally { recovered?.close(); fixture.cleanup(); }
});

test("archive recovery completes a WAL rename interrupted after the base database moved", () => {
	const fixture = createLegacyProjectMigrationFixture();
	const writer = new DatabaseSync(fixture.legacyPath);
	let writerClosed = false;
	try {
		writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; UPDATE projects SET name = 'Preserved WAL name'");
		const result = migrate(fixture);
		assert.equal(existsSync(`${result.archivePath}-wal`), true);
		renameSync(`${result.archivePath}-wal`, `${fixture.legacyPath}-wal`);
		assert.equal(migrate(fixture).status, "already-migrated");
		assert.equal(existsSync(`${fixture.legacyPath}-wal`), false);
		writer.close(); writerClosed = true;
		const archive = new DatabaseSync(result.archivePath, { readOnly: true });
		try { assert.equal(archive.prepare("SELECT name FROM projects").get().name, "Preserved WAL name"); }
		finally { archive.close(); }
	} finally { if (!writerClosed) writer.close(); fixture.cleanup(); }
});
