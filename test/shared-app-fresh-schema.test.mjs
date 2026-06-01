import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CustomAgentStore } from "../dist/apps/chat/agent-store.js";
import { ChatProjectService } from "../dist/apps/chat/data/project-service.js";
import { ChatWorkflowDraftStore, ChatWorkflowLifecycleEventStore, ChatWorkflowPromptAssetStore } from "../dist/apps/chat/workflow-persistence.js";
import { PiboCronStore } from "../dist/cron/store.js";
import { PiboDataStore } from "../dist/data/pibo-store.js";
import { PiboRalphStore } from "../dist/ralph/store.js";
import { WebAnnotationStore } from "../dist/web-annotations/store.js";
import { SqliteWorkflowRunStore } from "../packages/workflows/dist/index.js";

function tempDir(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
}

function columns(db, table) {
	return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function assertNoColumns(db, table, forbidden) {
	const tableColumns = columns(db, table);
	for (const column of forbidden) assert.equal(tableColumns.has(column), false, `${table}.${column} should not exist in fresh schema`);
}

function assertNoTable(db, table) {
	const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
	assert.equal(row, undefined, `${table} should not exist in fresh schema`);
}

test("fresh shared-app schemas omit owner/principal access-control structures", () => {
	const dir = tempDir("shared-app-fresh-schema-");
	const pibo = new PiboDataStore(join(dir, "pibo.sqlite"), { payloadRootDir: join(dir, "payloads") });
	new ChatWorkflowDraftStore(pibo);
	new ChatWorkflowPromptAssetStore(pibo);
	new ChatWorkflowLifecycleEventStore(pibo);

	for (const table of ["sessions", "rooms", "session_navigation", "workflow_ui_drafts", "workflow_prompt_assets", "workflow_prompt_asset_revisions", "workflow_lifecycle_events"]) {
		assertNoColumns(pibo.db, table, ["owner_scope", "principal_id"]);
	}
	for (const table of ["app_session_read_state", "app_room_read_state"]) assertNoColumns(pibo.db, table, ["principal_id", "owner_scope"]);
	assertNoTable(pibo.db, "room_members");
	assertNoTable(pibo.db, "principal_session_stats");
	assertNoTable(pibo.db, "principal_room_stats");
	pibo.close();

	const agents = new CustomAgentStore(join(dir, "chat-agents.sqlite"));
	assertNoColumns(new DatabaseSync(join(dir, "chat-agents.sqlite"), { readOnly: true }), "chat_agents", ["owner_scope", "principal_id"]);
	agents.close();

	const ralph = new PiboRalphStore({ path: join(dir, "pibo-ralph.sqlite") });
	const ralphDb = new DatabaseSync(join(dir, "pibo-ralph.sqlite"), { readOnly: true });
	for (const table of ["pibo_ralph_jobs", "pibo_ralph_runs", "pibo_ralph_run_facts"]) assertNoColumns(ralphDb, table, ["owner_scope", "principal_id"]);
	ralphDb.close();
	ralph.close();

	const cron = new PiboCronStore({ path: join(dir, "pibo-cron.sqlite") });
	const cronDb = new DatabaseSync(join(dir, "pibo-cron.sqlite"), { readOnly: true });
	for (const table of ["pibo_cron_jobs", "pibo_cron_runs"]) assertNoColumns(cronDb, table, ["owner_scope", "principal_id"]);
	cronDb.close();
	cron.close();

	const annotations = new WebAnnotationStore({ path: join(dir, "web-annotations.sqlite") });
	const annotationDb = new DatabaseSync(join(dir, "web-annotations.sqlite"), { readOnly: true });
	for (const table of ["web_annotation_bindings", "web_annotations"]) assertNoColumns(annotationDb, table, ["owner_scope", "principal_id"]);
	annotationDb.close();
	annotations.close();

	const projects = new ChatProjectService(join(dir, "web-projects.sqlite"));
	const projectDb = new DatabaseSync(join(dir, "web-projects.sqlite"), { readOnly: true });
	assertNoColumns(projectDb, "projects", ["owner_scope", "principal_id"]);
	projectDb.close();
	projects.close();

	const workflows = new SqliteWorkflowRunStore(join(dir, "pibo-workflows.sqlite"));
	const workflowsDb = new DatabaseSync(join(dir, "pibo-workflows.sqlite"), { readOnly: true });
	assertNoColumns(workflowsDb, "workflow_runs", ["owner_scope", "principal_id"]);
	workflowsDb.close();
	workflows.close();
});
