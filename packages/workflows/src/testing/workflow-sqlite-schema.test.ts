import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWorkflowSqlitePath,
  isNormalSessionFactStorageName,
  SqliteWorkflowRunStore,
  WORKFLOW_SQLITE_FILENAME,
  WORKFLOW_SQLITE_SESSION_LINK_COLUMNS,
  WORKFLOW_SQLITE_TABLES,
} from "../index.js";

type TableInfoRow = {
  name: string;
};

type ColumnInfoRow = {
  name: string;
};

const requiredColumns: Record<(typeof WORKFLOW_SQLITE_TABLES)[number], string[]> = {
  workflow_definition_snapshots: [
    "id",
    "workflow_id",
    "workflow_version",
    "definition_hash",
    "compiled_definition_json",
    "created_at",
  ],
  workflow_runs: [
    "id",
    "workflow_id",
    "workflow_version",
    "workflow_definition_hash",
    "definition_snapshot_id",
    "owner_scope",
    "parent_run_id",
    "parent_node_attempt_id",
    "pibo_session_id",
    "project_id",
    "environment_json",
    "status",
    "input_json",
    "output_json",
    "state_json",
    "current_json",
    "created_at",
    "updated_at",
    "completed_at",
    "failed_at",
  ],
  workflow_events: ["id", "workflow_run_id", "type", "node_id", "edge_id", "attempt_id", "payload_json", "created_at"],
  workflow_node_attempts: [
    "id",
    "workflow_run_id",
    "node_id",
    "attempt_number",
    "kind",
    "status",
    "environment_json",
    "input_json",
    "output_json",
    "local_state_json",
    "error_json",
    "lease_json",
    "available_at",
    "started_at",
    "heartbeat_at",
    "completed_at",
    "failed_at",
  ],
  workflow_edge_transfers: [
    "id",
    "workflow_run_id",
    "edge_id",
    "source_node_attempt_id",
    "target_node_id",
    "payload_json",
    "adapter_attempt_id",
    "status",
    "created_at",
  ],
  workflow_checkpoints: ["id", "workflow_run_id", "namespace", "cursor_json", "state_json", "pending_json", "created_at"],
  workflow_wakeups: [
    "id",
    "workflow_run_id",
    "node_attempt_id",
    "kind",
    "available_at",
    "correlation_id",
    "payload_json",
    "created_at",
  ],
  workflow_wait_tokens: [
    "id",
    "workflow_run_id",
    "node_attempt_id",
    "kind",
    "available_actions_json",
    "schema_json",
    "status",
    "resume_payload_json",
    "expires_at",
    "created_at",
    "resolved_at",
  ],
  workflow_human_actions: ["id", "workflow_run_id", "wait_token_id", "kind", "actor_json", "payload_json", "created_at"],
};

describe("workflow sqlite schema", () => {
  it("creates the workflow-specific pibo-workflows.sqlite schema", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-schema-test-"));
    const dbPath = createWorkflowSqlitePath(tempRoot);
    const store = new SqliteWorkflowRunStore(dbPath);

    try {
      assert.equal(basename(dbPath), WORKFLOW_SQLITE_FILENAME);
      store.close();

      const db = new DatabaseSync(dbPath);
      try {
        const tables = new Set(
          db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
            .map((row) => (row as TableInfoRow).name),
        );

        for (const table of WORKFLOW_SQLITE_TABLES) {
          assert.equal(tables.has(table), true, `missing workflow table ${table}`);
          const columns = new Set(
            db
              .prepare(`PRAGMA table_info(${table})`)
              .all()
              .map((row) => (row as ColumnInfoRow).name),
          );
          assert.deepEqual(
            requiredColumns[table].filter((column) => !columns.has(column)),
            [],
            `missing required columns for ${table}`,
          );
        }
      } finally {
        db.close();
      }
    } finally {
      try {
        store.close();
      } catch {
        // Store may already be closed before schema inspection.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps normal session trace, transcript, tool-call, and span storage out of the workflow database", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-session-boundary-test-"));
    const dbPath = createWorkflowSqlitePath(tempRoot);
    const store = new SqliteWorkflowRunStore(dbPath);

    try {
      store.close();

      const db = new DatabaseSync(dbPath);
      try {
        const storageNames = db
          .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index', 'view', 'trigger')")
          .all()
          .map((row) => (row as TableInfoRow).name)
          .filter((name) => !name.startsWith("sqlite_"));

        assert.deepEqual(
          storageNames.filter(isNormalSessionFactStorageName),
          [],
          "workflow sqlite must not create normal session trace/transcript/tool-call/span storage",
        );

        const linkColumns = new Set(WORKFLOW_SQLITE_SESSION_LINK_COLUMNS);
        const disallowedColumns: string[] = [];
        for (const table of WORKFLOW_SQLITE_TABLES) {
          const columns = db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((row) => (row as ColumnInfoRow).name);
          for (const column of columns) {
            if (!linkColumns.has(column as (typeof WORKFLOW_SQLITE_SESSION_LINK_COLUMNS)[number])) {
              const storageName = `${table}.${column}`;
              if (isNormalSessionFactStorageName(storageName)) disallowedColumns.push(storageName);
            }
          }
        }

        assert.deepEqual(
          disallowedColumns,
          [],
          "workflow sqlite columns may link to existing sessions but must not duplicate normal session facts",
        );
      } finally {
        db.close();
      }
    } finally {
      try {
        store.close();
      } catch {
        // Store may already be closed before schema inspection.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
