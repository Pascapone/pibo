import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export const WORKFLOW_SQLITE_FILENAME = "pibo-workflows.sqlite";
export const WORKFLOW_SQLITE_SCHEMA_VERSION = 3;

export const WORKFLOW_SQLITE_TABLES = [
  "workflow_definition_snapshots",
  "workflow_identities",
  "workflow_drafts",
  "workflow_published_versions",
  "workflow_archive_states",
  "workflow_delete_tombstones",
  "workflow_runs",
  "workflow_events",
  "workflow_node_attempts",
  "workflow_edge_transfers",
  "workflow_checkpoints",
  "workflow_wakeups",
  "workflow_wait_tokens",
  "workflow_human_actions",
] as const;

export type WorkflowSqliteTableName = (typeof WORKFLOW_SQLITE_TABLES)[number];

export const WORKFLOW_SQLITE_SESSION_LINK_COLUMNS = ["pibo_session_id", "project_id"] as const;

export const WORKFLOW_SQLITE_NORMAL_SESSION_FACT_KEYWORDS = [
  "session_record",
  "session_trace",
  "session_transcript",
  "transcript",
  "tool_call",
  "span",
] as const;

const WORKFLOW_SQLITE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS workflow_definition_snapshots (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_version TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    compiled_definition_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_definition_snapshots_hash
    ON workflow_definition_snapshots(workflow_id, workflow_version, definition_hash);

  CREATE TABLE IF NOT EXISTS workflow_identities (
    workflow_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    tags_json TEXT NOT NULL,
    current_draft_id TEXT,
    latest_version TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_identities_updated
    ON workflow_identities(updated_at, workflow_id);

  CREATE TABLE IF NOT EXISTS workflow_drafts (
    draft_id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    base_workflow_id TEXT,
    base_workflow_version TEXT,
    base_definition_hash TEXT,
    version_intent TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    diagnostics_json TEXT NOT NULL,
    validation_state TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_drafts_workflow
    ON workflow_drafts(workflow_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_drafts_validation
    ON workflow_drafts(validation_state, updated_at);

  CREATE TABLE IF NOT EXISTS workflow_published_versions (
    workflow_id TEXT NOT NULL,
    version TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    definition_json TEXT NOT NULL,
    published_from_draft_id TEXT,
    published_by TEXT,
    published_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (workflow_id, version)
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_published_versions_workflow
    ON workflow_published_versions(workflow_id, version);
  CREATE INDEX IF NOT EXISTS idx_workflow_published_versions_published_at
    ON workflow_published_versions(published_at);

  CREATE TABLE IF NOT EXISTS workflow_archive_states (
    workflow_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    archived INTEGER NOT NULL,
    archived_at TEXT,
    archived_by TEXT,
    archive_reason TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_archive_states_archived
    ON workflow_archive_states(archived, updated_at);

  CREATE TABLE IF NOT EXISTS workflow_delete_tombstones (
    workflow_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    deleted INTEGER NOT NULL,
    deleted_at TEXT,
    deleted_by TEXT,
    last_known_title TEXT NOT NULL,
    last_known_version TEXT,
    last_definition_hash TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_delete_tombstones_created
    ON workflow_delete_tombstones(created_at);

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_version TEXT NOT NULL,
    workflow_definition_hash TEXT,
    definition_snapshot_id TEXT,
    parent_run_id TEXT,
    parent_node_attempt_id TEXT,
    pibo_session_id TEXT,
    project_id TEXT,
    environment_json TEXT,
    status TEXT NOT NULL,
    current_node_id TEXT,
    current_edge_id TEXT,
    current_status TEXT,
    current_json TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    output_present INTEGER NOT NULL DEFAULT 0,
    state_json TEXT NOT NULL,
    checkpoint_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    failed_at TEXT,
    cancelled_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
    ON workflow_runs(workflow_id, workflow_version, updated_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_status
    ON workflow_runs(status, updated_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_current_node
    ON workflow_runs(current_node_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_pibo_session
    ON workflow_runs(pibo_session_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_runs_project
    ON workflow_runs(project_id, updated_at);

  CREATE TABLE IF NOT EXISTS workflow_events (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    node_id TEXT,
    edge_id TEXT,
    attempt_id TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_events_run
    ON workflow_events(workflow_run_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_events_type
    ON workflow_events(type, created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_events_node
    ON workflow_events(workflow_run_id, node_id, created_at);

  CREATE TABLE IF NOT EXISTS workflow_node_attempts (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    environment_json TEXT,
    input_json TEXT NOT NULL,
    output_json TEXT,
    output_present INTEGER NOT NULL DEFAULT 0,
    local_state_json TEXT,
    metadata_json TEXT,
    error_json TEXT,
    lease_json TEXT,
    available_at TEXT,
    started_at TEXT,
    heartbeat_at TEXT,
    completed_at TEXT,
    failed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_node_attempts_run
    ON workflow_node_attempts(workflow_run_id, node_id);
  CREATE INDEX IF NOT EXISTS idx_workflow_node_attempts_status
    ON workflow_node_attempts(status, started_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_node_attempts_kind
    ON workflow_node_attempts(kind, started_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_node_attempts_available
    ON workflow_node_attempts(status, available_at);

  CREATE TABLE IF NOT EXISTS workflow_edge_transfers (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    edge_id TEXT NOT NULL,
    source_node_attempt_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    adapter_attempt_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_edge_transfers_run
    ON workflow_edge_transfers(workflow_run_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_edge_transfers_edge
    ON workflow_edge_transfers(edge_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_edge_transfers_target
    ON workflow_edge_transfers(workflow_run_id, target_node_id, created_at);

  CREATE TABLE IF NOT EXISTS workflow_checkpoints (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    namespace TEXT NOT NULL,
    cursor_json TEXT NOT NULL,
    state_json TEXT NOT NULL,
    pending_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_run
    ON workflow_checkpoints(workflow_run_id, namespace, created_at);

  CREATE TABLE IF NOT EXISTS workflow_wakeups (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    node_attempt_id TEXT,
    kind TEXT NOT NULL,
    available_at TEXT NOT NULL,
    correlation_id TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_wakeups_available
    ON workflow_wakeups(kind, available_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_wakeups_run
    ON workflow_wakeups(workflow_run_id, available_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_wakeups_correlation
    ON workflow_wakeups(correlation_id);

  CREATE TABLE IF NOT EXISTS workflow_wait_tokens (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    node_attempt_id TEXT,
    human_node_id TEXT,
    kind TEXT,
    available_actions_json TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schema_json TEXT,
    status TEXT NOT NULL,
    resume_payload_json TEXT,
    resume_payload_present INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_wait_tokens_run
    ON workflow_wait_tokens(workflow_run_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_wait_tokens_status
    ON workflow_wait_tokens(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_wait_tokens_node
    ON workflow_wait_tokens(human_node_id, created_at);

  CREATE TABLE IF NOT EXISTS workflow_human_actions (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL,
    wait_token_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    actor_json TEXT,
    payload_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_human_actions_run
    ON workflow_human_actions(workflow_run_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_workflow_human_actions_wait_token
    ON workflow_human_actions(wait_token_id, created_at);`;

type WorkflowSqliteColumnRow = {
  name: string;
};

export function isNormalSessionFactStorageName(name: string): boolean {
  const normalized = name.toLowerCase();
  return WORKFLOW_SQLITE_NORMAL_SESSION_FACT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function createWorkflowSqlitePath(baseDirectory: string): string {
  return resolve(baseDirectory, WORKFLOW_SQLITE_FILENAME);
}

export function installWorkflowSqliteSchema(db: DatabaseSync, options: { enableWal?: boolean } = {}): void {
  db.exec("PRAGMA busy_timeout = 5000");
  if (options.enableWal === true) db.exec("PRAGMA journal_mode = WAL");
  db.exec(WORKFLOW_SQLITE_SCHEMA_SQL);

  ensureWorkflowSqliteColumn(db, "workflow_runs", "workflow_definition_hash", "TEXT");
  ensureWorkflowSqliteColumn(db, "workflow_runs", "definition_snapshot_id", "TEXT");
  ensureWorkflowSqliteColumn(db, "workflow_node_attempts", "attempt_number", "INTEGER");
  ensureWorkflowSqliteColumn(db, "workflow_node_attempts", "environment_json", "TEXT");
  ensureWorkflowSqliteColumn(db, "workflow_wait_tokens", "kind", "TEXT");
  ensureWorkflowSqliteColumn(db, "workflow_wait_tokens", "available_actions_json", "TEXT");
  ensureWorkflowSqliteColumn(db, "workflow_wait_tokens", "resolved_at", "TEXT");
}

function ensureWorkflowSqliteColumn(
  db: DatabaseSync,
  table: WorkflowSqliteTableName,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as WorkflowSqliteColumnRow[];
  if (columns.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
