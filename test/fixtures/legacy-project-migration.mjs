import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { ChatDataIngestService } from "../../dist/data/ingest-service.js";
import { PiboDataStore } from "../../dist/data/pibo-store.js";
import { PiboDataSessionStore } from "../../dist/sessions/pibo-data-store.js";
import { ChatWorkflowSessionService } from "../../dist/apps/chat/data/workflow-session-service.js";

export const fixtureTimes = {
	created: "2026-01-02T03:04:05.000Z",
	updated: "2026-02-03T04:05:06.000Z",
	archived: "2026-03-04T05:06:07.000Z",
};

export function createLegacyProjectMigrationFixture(options = {}) {
	const root = mkdtempSync(join(tmpdir(), "pibo-legacy-project-migration-"));
	const dataPath = join(root, "pibo.sqlite");
	const workflowPath = join(root, "pibo-workflows.sqlite");
	const legacyPath = join(root, "web-projects.sqlite");
	const workspace = join(root, "legacy-workspace");
	mkdirSync(workspace, { recursive: true });
	const dataStore = new PiboDataStore(dataPath, { payloadRootDir: join(root, "payloads") });
	const sessions = new PiboDataSessionStore(dataStore);
	const parent = sessions.create({
		id: "ps_legacy_parent",
		channel: "pibo.chat-web",
		kind: "project",
		profile: "planner",
		workspace: join(root, "canonical-parent-workspace"),
		title: "Preserved parent title",
		activeModel: { provider: "openai", id: "gpt-preserved" },
		metadata: { projectId: "prj_legacy", projectSessionKind: "main", customFact: "keep-parent" },
		runtimeBinding: {
			runtimeInstanceId: "codex-primary",
			adapterId: "codex-native",
			nativeSessionId: "thread-parent",
			state: "bound",
			protocol: "codex-app-server",
			metadata: { durableBinding: true },
		},
	});
	const child = sessions.create({
		id: "ps_legacy_child",
		channel: "pibo.chat-web",
		kind: "project",
		profile: "reviewer",
		parentId: parent.id,
		originId: "ps_origin_preserved",
		title: "Preserved child title",
		activeModel: { provider: "anthropic", id: "claude-preserved" },
		metadata: { projectId: "prj_legacy", projectSessionKind: "sub", customFact: "keep-child" },
	});
	const ingest = new ChatDataIngestService(dataStore);
	ingest.ingestUserMessageAccepted({ session: parent, roomId: "room_before_migration", actorId: "user-fixture", text: "Parent history must survive", clientTxnId: "legacy-parent" });
	ingest.ingestUserMessageAccepted({ session: child, roomId: "room_before_migration", actorId: "user-fixture", text: "Child history must survive", clientTxnId: "legacy-child" });
	dataStore.db.prepare(`UPDATE sessions SET created_at=?, updated_at=?, last_activity_at=? WHERE id=?`).run(fixtureTimes.created, fixtureTimes.updated, fixtureTimes.updated, parent.id);
	dataStore.db.prepare(`UPDATE sessions SET created_at=?, updated_at=?, last_activity_at=?, archived_at=? WHERE id=?`).run(fixtureTimes.created, fixtureTimes.updated, fixtureTimes.updated, fixtureTimes.archived, child.id);
	dataStore.db.prepare(`UPDATE session_runtime_bindings SET created_at=?, updated_at=? WHERE pibo_session_id IN (?, ?)`).run(fixtureTimes.created, fixtureTimes.updated, parent.id, child.id);

	createLegacyDatabase(legacyPath, { workspace, malformedJson: options.malformedJson });
	if (options.omitCanonicalSession) dataStore.db.prepare("DELETE FROM sessions WHERE id=?").run(options.omitCanonicalSession);
	if (options.hierarchyConflict) dataStore.db.prepare("UPDATE sessions SET parent_id=? WHERE id='ps_legacy_child'").run("ps_conflicting_parent");
	const workflowService = new ChatWorkflowSessionService(workflowPath);
	return {
		root, dataPath, workflowPath, legacyPath, workspace, dataStore, sessions, workflowService,
		parentId: parent.id, childId: child.id,
		close() { try { workflowService.close(); } catch {} try { dataStore.close(); } catch {} },
		cleanup() { this.close(); rmSync(root, { recursive: true, force: true }); },
	};
}

export function createLegacyDatabase(path, { workspace, malformedJson = false }) {
	const db = new DatabaseSync(path);
	db.exec(`
		PRAGMA foreign_keys=ON;
		CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, project_folder TEXT NOT NULL, configuration_status TEXT NOT NULL, current_main_session_id TEXT, archived_at TEXT, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE project_sessions (project_id TEXT NOT NULL, pibo_session_id TEXT PRIMARY KEY, kind TEXT NOT NULL, workflow_id TEXT NOT NULL, workflow_version TEXT, workflow_run_id TEXT, parent_main_session_id TEXT, title TEXT, state TEXT, configuration_json TEXT, retry_count INTEGER, max_retries INTEGER, archived INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE project_workflow_session_snapshots (id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, project_id TEXT NOT NULL, pibo_session_id TEXT NOT NULL UNIQUE, workflow_id TEXT NOT NULL, workflow_version TEXT NOT NULL, base_definition_hash TEXT NOT NULL, effective_definition_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL);
		CREATE TABLE project_workflow_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pibo_session_id TEXT NOT NULL UNIQUE, workflow_id TEXT NOT NULL, workflow_version TEXT NOT NULL, snapshot_id TEXT NOT NULL, effective_definition_hash TEXT NOT NULL, status TEXT NOT NULL, current_json TEXT NOT NULL, input_json TEXT NOT NULL, validation_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT, failed_at TEXT, cancelled_at TEXT);
		CREATE TABLE project_workflow_wait_tokens (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pibo_session_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL, node_attempt_id TEXT, human_node_id TEXT, actions_json TEXT NOT NULL, prompt TEXT NOT NULL, schema_json TEXT, status TEXT NOT NULL, resume_payload_json TEXT, resume_payload_present INTEGER NOT NULL, expires_at TEXT, created_at TEXT NOT NULL, resolved_at TEXT);
		CREATE TABLE project_workflow_human_actions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pibo_session_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL, wait_token_id TEXT NOT NULL, action_id TEXT, kind TEXT NOT NULL, actor_json TEXT, payload_json TEXT, payload_present INTEGER NOT NULL, created_at TEXT NOT NULL);
	`);
	db.prepare("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("prj_legacy", "Migrated workspace", "Preserved room topic", workspace, "configured", "ps_legacy_parent", fixtureTimes.archived, JSON.stringify({ customContainerFact: "keep-room" }), fixtureTimes.created, fixtureTimes.updated);
	const configuration = JSON.stringify({ inputValues: { request: "preserve me" }, promptOverrides: {}, promptOverrideEligibleNodeIds: [], overrideScopes: { promptOverrides: "eligible_agent_node", model: "workflow", thinkingLevel: "workflow", fastMode: "workflow" } });
	db.prepare("INSERT INTO project_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("prj_legacy", "ps_legacy_parent", "main", "workflow.same-definition", "1.0.0", "wfr_legacy", null, "Stale legacy title", "running", malformedJson ? "{bad" : configuration, null, null, 0, fixtureTimes.created, fixtureTimes.updated);
	db.prepare("INSERT INTO project_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("prj_legacy", "ps_legacy_child", "sub", "workflow.same-definition", "1.0.0", null, "ps_legacy_parent", "Stale child title", "configured", configuration, null, null, 1, fixtureTimes.created, fixtureTimes.updated);
	const definition = { id: "workflow.same-definition", version: "1.0.0", title: "Same definition", input: { kind: "json", schema: { type: "object" } }, output: { kind: "text" }, initial: "review", final: "review", nodes: { review: { kind: "human", prompt: "Approve?" } }, edges: {} };
	for (const [snapshotId, sessionId] of [["wfs_parent", "ps_legacy_parent"], ["wfs_child", "ps_legacy_child"]]) {
		const snapshot = { id: snapshotId, schemaVersion: 1, createdAt: fixtureTimes.created, createdBy: "user-fixture", projectId: "prj_legacy", piboSessionId: sessionId, workflow: { id: definition.id, version: definition.version, source: "ui", title: definition.title, tags: [], baseDefinitionHash: "sha256:same-base", effectiveDefinitionHash: "sha256:same-effective" }, baseDefinition: definition, effectiveDefinition: definition, inputValues: { request: sessionId }, promptOverrides: {}, overridePolicy: { promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate", eligiblePromptNodeIds: [], modelScope: "workflow", thinkingLevelScope: "workflow", fastModeScope: "workflow" }, promptAssetPins: [], validation: { ok: true }, deletedDefinitionFallback: { workflowId: definition.id, workflowVersion: definition.version, effectiveDefinitionHash: "sha256:same-effective" } };
		db.prepare("INSERT INTO project_workflow_session_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(snapshotId, 1, "prj_legacy", sessionId, definition.id, definition.version, "sha256:same-base", "sha256:same-effective", JSON.stringify(snapshot), fixtureTimes.created);
	}
	db.prepare("INSERT INTO project_workflow_runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("wfr_legacy", "prj_legacy", "ps_legacy_parent", definition.id, definition.version, "wfs_parent", "sha256:same-effective", "waiting", JSON.stringify({ nodeId: "review", status: "waiting" }), JSON.stringify({ request: "preserve me" }), JSON.stringify({ ok: true }), fixtureTimes.created, fixtureTimes.updated, null, null, null);
	db.prepare("INSERT INTO project_workflow_wait_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("wwt_pending", "prj_legacy", "ps_legacy_parent", "wfr_legacy", "wna_review", "review", JSON.stringify([{ id: "approve", kind: "approve" }]), "Approve migration?", JSON.stringify({ type: "object" }), "pending", null, 0, "2099-01-01T00:00:00.000Z", fixtureTimes.created, null);
	db.prepare("INSERT INTO project_workflow_wait_tokens VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("wwt_resolved", "prj_legacy", "ps_legacy_parent", "wfr_legacy", "wna_review_old", "review", JSON.stringify([{ id: "approve", kind: "approve" }]), "Previously approved?", null, "resumed", JSON.stringify({ approved: true }), 1, null, fixtureTimes.created, fixtureTimes.updated);
	db.prepare("INSERT INTO project_workflow_human_actions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("wha_legacy", "prj_legacy", "ps_legacy_parent", "wfr_legacy", "wwt_resolved", "approve", "approve", JSON.stringify({ userId: "user-fixture" }), JSON.stringify({ approved: true }), 1, fixtureTimes.updated);
	db.close();
}

export function installLegacyCatalog(dataStore) {
	dataStore.db.exec(`
		CREATE TABLE workflow_ui_drafts (draft_id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, base_workflow_id TEXT, base_workflow_version TEXT, base_definition_hash TEXT, target_workflow_version TEXT, version_intent TEXT NOT NULL, definition_json TEXT NOT NULL, diagnostics_json TEXT NOT NULL, validation_json TEXT, validation_state TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE workflow_published_versions (workflow_id TEXT NOT NULL, version TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, definition_hash TEXT NOT NULL, definition_json TEXT NOT NULL, published_from_draft_id TEXT, published_by TEXT, published_at TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workflow_id, version));
		CREATE TABLE workflow_archive_states (workflow_id TEXT PRIMARY KEY, source TEXT NOT NULL, archived INTEGER NOT NULL, archived_at TEXT, archived_by TEXT, archive_reason TEXT, updated_at TEXT NOT NULL);
		CREATE TABLE workflow_delete_tombstones (workflow_id TEXT PRIMARY KEY, source TEXT NOT NULL, deleted INTEGER NOT NULL, deleted_at TEXT NOT NULL, deleted_by TEXT NOT NULL, last_known_title TEXT NOT NULL, last_known_version TEXT, last_definition_hash TEXT, updated_at TEXT NOT NULL);
		CREATE TABLE workflow_prompt_assets (asset_id TEXT PRIMARY KEY, source TEXT NOT NULL, display_name TEXT NOT NULL, description TEXT, active_revision_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
		CREATE TABLE workflow_prompt_asset_revisions (revision_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, content_hash TEXT NOT NULL, markdown TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT, based_on_revision_id TEXT);
		CREATE TABLE workflow_lifecycle_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, actor_id TEXT, workflow_id TEXT, workflow_version TEXT, draft_id TEXT, project_id TEXT, pibo_session_id TEXT, workflow_run_id TEXT, status TEXT, validation_json TEXT, diagnostics_json TEXT NOT NULL, payload_json TEXT, created_at TEXT NOT NULL);
	`);
	const definition = { id: "workflow.catalog-legacy", version: "1.0.0", title: "Legacy catalog workflow", input: { kind: "text" }, output: { kind: "text" }, initial: "one", final: "one", nodes: { one: { kind: "code", language: "typescript", handler: "fixture" } }, edges: {} };
	dataStore.db.prepare("INSERT INTO workflow_ui_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("wfd_legacy", definition.id, "ui", "draft", null, null, null, "1.1.0", "minor", JSON.stringify({ ...definition, version: "1.1.0" }), "[]", JSON.stringify({ ok: true }), "valid", 4, fixtureTimes.created, fixtureTimes.updated);
	dataStore.db.prepare("INSERT INTO workflow_published_versions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(definition.id, definition.version, "ui", "published", "sha256:catalog", JSON.stringify(definition), "wfd_published", "user-fixture", fixtureTimes.updated, fixtureTimes.created);
	dataStore.db.prepare("INSERT INTO workflow_archive_states VALUES (?, ?, ?, ?, ?, ?, ?)").run(definition.id, "ui", 1, fixtureTimes.archived, "user-fixture", "preserve", fixtureTimes.updated);
	dataStore.db.prepare("INSERT INTO workflow_delete_tombstones VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("workflow.deleted-legacy", "ui", 1, fixtureTimes.archived, "user-fixture", "Deleted legacy", "2.0.0", "sha256:deleted", fixtureTimes.updated);
	dataStore.db.prepare("INSERT INTO workflow_prompt_assets VALUES (?, ?, ?, ?, ?, ?, ?)").run("asset_legacy", "ui", "Legacy prompt", "Preserve asset", "revision_legacy", fixtureTimes.created, fixtureTimes.updated);
	dataStore.db.prepare("INSERT INTO workflow_prompt_asset_revisions VALUES (?, ?, ?, ?, ?, ?, ?)").run("revision_legacy", "asset_legacy", "sha256:prompt", "# Preserved prompt", fixtureTimes.created, "user-fixture", null);
	dataStore.db.prepare("INSERT INTO workflow_lifecycle_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("wfle_legacy", "project.workflow_start.accepted", "user-fixture", definition.id, definition.version, null, "prj_legacy", "ps_legacy_parent", "wfr_legacy", "accepted", null, "[]", JSON.stringify({ keep: true }), fixtureTimes.updated);
}
