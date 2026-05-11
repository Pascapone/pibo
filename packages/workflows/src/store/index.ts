import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  NodeAttempt,
  NodeAttemptId,
  NodeAttemptStatus,
  WorkflowExecutionEnvironment,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRunStatus,
  WorkflowValue,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
  WorkflowWaitTokenStatus,
} from "../types/index.js";

export const WORKFLOW_SQLITE_FILENAME = "pibo-workflows.sqlite";
export const WORKFLOW_SQLITE_SCHEMA_VERSION = 1;

export const WORKFLOW_SQLITE_TABLES = [
  "workflow_definition_snapshots",
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

export function createWorkflowSqlitePath(baseDirectory: string): string {
  return resolve(baseDirectory, WORKFLOW_SQLITE_FILENAME);
}

export type WorkflowRunStore = {
  saveRun(run: WorkflowRun): void | Promise<void>;
  getRun(id: WorkflowRunId): WorkflowRun | undefined | Promise<WorkflowRun | undefined>;
};

export type WorkflowWaitTokenStore = {
  saveWaitToken(token: WorkflowWaitToken): void | Promise<void>;
  getWaitToken(id: WorkflowWaitTokenId): WorkflowWaitToken | undefined | Promise<WorkflowWaitToken | undefined>;
  listWaitTokens(filter?: WorkflowWaitTokenListFilter): WorkflowWaitToken[] | Promise<WorkflowWaitToken[]>;
};

export type WorkflowNodeAttemptStore = {
  saveNodeAttempt(nodeAttempt: NodeAttempt): void | Promise<void>;
  getNodeAttempt(id: NodeAttemptId): NodeAttempt | undefined | Promise<NodeAttempt | undefined>;
  listNodeAttempts(filter?: WorkflowNodeAttemptListFilter): NodeAttempt[] | Promise<NodeAttempt[]>;
};

export type WorkflowRunListFilter = {
  workflowId?: string;
  status?: WorkflowRunStatus;
  ownerScope?: string;
  limit?: number;
};

export type WorkflowWaitTokenListFilter = {
  workflowRunId?: WorkflowRunId;
  status?: WorkflowWaitTokenStatus;
  humanNodeId?: string;
  limit?: number;
};

export type WorkflowNodeAttemptListFilter = {
  workflowRunId?: WorkflowRunId;
  nodeId?: string;
  kind?: NodeAttempt["kind"];
  status?: NodeAttemptStatus;
  limit?: number;
};

type WorkflowRunRow = {
  id: string;
  workflow_id: string;
  workflow_version: string;
  workflow_definition_hash: string | null;
  definition_snapshot_id: string | null;
  owner_scope: string;
  parent_run_id: string | null;
  parent_node_attempt_id: string | null;
  pibo_session_id: string | null;
  project_id: string | null;
  environment_json: string | null;
  status: WorkflowRunStatus;
  current_node_id: string | null;
  current_edge_id: string | null;
  current_status: WorkflowRunStatus | null;
  current_json: string;
  input_json: string;
  output_json: string | null;
  output_present: number;
  state_json: string;
  checkpoint_json: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
};

type WorkflowWaitTokenRow = {
  id: string;
  workflow_run_id: string;
  node_attempt_id: string | null;
  human_node_id: string | null;
  kind: string | null;
  available_actions_json: string | null;
  actions_json?: string | null;
  prompt: string;
  schema_json: string | null;
  status: WorkflowWaitTokenStatus;
  resume_payload_json: string | null;
  resume_payload_present: number;
  created_at: string;
  expires_at: string | null;
  resolved_at: string | null;
  resumed_at?: string | null;
};

type WorkflowNodeAttemptRow = {
  id: string;
  workflow_run_id: string;
  node_id: string;
  attempt_number: number | null;
  attempt?: number | null;
  kind: NodeAttempt["kind"];
  status: NodeAttemptStatus;
  environment_json: string | null;
  input_json: string;
  output_json: string | null;
  output_present: number;
  local_state_json: string | null;
  metadata_json: string | null;
  error_json: string | null;
  lease_json: string | null;
  started_at: string | null;
  heartbeat_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  available_at: string | null;
};

export class SqliteWorkflowRunStore implements WorkflowRunStore, WorkflowWaitTokenStore, WorkflowNodeAttemptStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const resolvedPath = path === ":memory:" ? path : resolve(path);
    if (resolvedPath !== ":memory:") {
      mkdirSync(dirname(resolvedPath), { recursive: true });
    }

    this.db = new DatabaseSync(resolvedPath);
    this.db.exec("PRAGMA busy_timeout = 5000");
    if (resolvedPath !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version TEXT NOT NULL,
        workflow_definition_hash TEXT,
        definition_snapshot_id TEXT,
        owner_scope TEXT NOT NULL,
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
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_owner
        ON workflow_runs(owner_scope, updated_at);
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
        ON workflow_human_actions(wait_token_id, created_at);
    `);

    this.ensureColumn("workflow_runs", "workflow_definition_hash", "TEXT");
    this.ensureColumn("workflow_runs", "definition_snapshot_id", "TEXT");
    this.ensureColumn("workflow_node_attempts", "attempt_number", "INTEGER");
    this.ensureColumn("workflow_node_attempts", "environment_json", "TEXT");
    this.ensureColumn("workflow_wait_tokens", "kind", "TEXT");
    this.ensureColumn("workflow_wait_tokens", "available_actions_json", "TEXT");
    this.ensureColumn("workflow_wait_tokens", "resolved_at", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((row) => row.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  saveRun(run: WorkflowRun): void {
    this.db.prepare(`
      INSERT INTO workflow_runs (
        id,
        workflow_id,
        workflow_version,
        workflow_definition_hash,
        definition_snapshot_id,
        owner_scope,
        parent_run_id,
        parent_node_attempt_id,
        pibo_session_id,
        project_id,
        environment_json,
        status,
        current_node_id,
        current_edge_id,
        current_status,
        current_json,
        input_json,
        output_json,
        output_present,
        state_json,
        checkpoint_json,
        created_at,
        updated_at,
        completed_at,
        failed_at,
        cancelled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_id = excluded.workflow_id,
        workflow_version = excluded.workflow_version,
        workflow_definition_hash = excluded.workflow_definition_hash,
        definition_snapshot_id = excluded.definition_snapshot_id,
        owner_scope = excluded.owner_scope,
        parent_run_id = excluded.parent_run_id,
        parent_node_attempt_id = excluded.parent_node_attempt_id,
        pibo_session_id = excluded.pibo_session_id,
        project_id = excluded.project_id,
        environment_json = excluded.environment_json,
        status = excluded.status,
        current_node_id = excluded.current_node_id,
        current_edge_id = excluded.current_edge_id,
        current_status = excluded.current_status,
        current_json = excluded.current_json,
        input_json = excluded.input_json,
        output_json = excluded.output_json,
        output_present = excluded.output_present,
        state_json = excluded.state_json,
        checkpoint_json = excluded.checkpoint_json,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at,
        failed_at = excluded.failed_at,
        cancelled_at = excluded.cancelled_at
    `).run(
      run.id,
      run.workflowId,
      run.workflowVersion,
      run.workflowDefinitionHash ?? null,
      run.definitionSnapshotId ?? null,
      run.ownerScope,
      run.parentRunId ?? null,
      run.parentNodeAttemptId ?? null,
      run.piboSessionId ?? null,
      run.projectId ?? null,
      serializeOptional(run.environment),
      run.status,
      run.current.nodeId ?? null,
      run.current.edgeId ?? null,
      run.current.status ?? null,
      serialize(run.current),
      serialize(run.input),
      run.output === undefined ? null : serialize(run.output),
      run.output === undefined ? 0 : 1,
      serialize(run.state),
      serializeOptional(run.checkpoint),
      run.createdAt,
      run.updatedAt,
      run.completedAt ?? null,
      run.failedAt ?? null,
      run.cancelledAt ?? null,
    );
  }

  getRun(id: WorkflowRunId): WorkflowRun | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as WorkflowRunRow | undefined;
    return row ? workflowRunFromRow(row) : undefined;
  }

  listRuns(filter: WorkflowRunListFilter = {}): WorkflowRun[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (filter.workflowId !== undefined) {
      clauses.push("workflow_id = ?");
      values.push(filter.workflowId);
    }
    if (filter.status !== undefined) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    if (filter.ownerScope !== undefined) {
      clauses.push("owner_scope = ?");
      values.push(filter.ownerScope);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...values, limit) as WorkflowRunRow[];
    return rows.map(workflowRunFromRow);
  }

  saveNodeAttempt(nodeAttempt: NodeAttempt): void {
    this.db.prepare(`
      INSERT INTO workflow_node_attempts (
        id,
        workflow_run_id,
        node_id,
        attempt_number,
        kind,
        status,
        environment_json,
        input_json,
        output_json,
        output_present,
        local_state_json,
        metadata_json,
        error_json,
        lease_json,
        started_at,
        heartbeat_at,
        completed_at,
        failed_at,
        available_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_run_id = excluded.workflow_run_id,
        node_id = excluded.node_id,
        attempt_number = excluded.attempt_number,
        kind = excluded.kind,
        status = excluded.status,
        environment_json = excluded.environment_json,
        input_json = excluded.input_json,
        output_json = excluded.output_json,
        output_present = excluded.output_present,
        local_state_json = excluded.local_state_json,
        metadata_json = excluded.metadata_json,
        error_json = excluded.error_json,
        lease_json = excluded.lease_json,
        started_at = excluded.started_at,
        heartbeat_at = excluded.heartbeat_at,
        completed_at = excluded.completed_at,
        failed_at = excluded.failed_at,
        available_at = excluded.available_at
    `).run(
      nodeAttempt.id,
      nodeAttempt.workflowRunId,
      nodeAttempt.nodeId,
      nodeAttempt.attempt,
      nodeAttempt.kind,
      nodeAttempt.status,
      serializeOptional(nodeAttempt.environment),
      serialize(nodeAttempt.input),
      nodeAttempt.output === undefined ? null : serialize(nodeAttempt.output),
      nodeAttempt.output === undefined ? 0 : 1,
      serializeOptional(nodeAttempt.localState),
      serializeOptional(nodeAttempt.metadata),
      serializeOptional(nodeAttempt.error),
      serializeOptional(nodeAttempt.lease),
      nodeAttempt.startedAt ?? null,
      nodeAttempt.heartbeatAt ?? null,
      nodeAttempt.completedAt ?? null,
      nodeAttempt.failedAt ?? null,
      nodeAttempt.availableAt ?? null,
    );
  }

  getNodeAttempt(id: NodeAttemptId): NodeAttempt | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_node_attempts WHERE id = ?").get(id) as
      | WorkflowNodeAttemptRow
      | undefined;
    return row ? workflowNodeAttemptFromRow(row) : undefined;
  }

  listNodeAttempts(filter: WorkflowNodeAttemptListFilter = {}): NodeAttempt[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (filter.workflowRunId !== undefined) {
      clauses.push("workflow_run_id = ?");
      values.push(filter.workflowRunId);
    }
    if (filter.nodeId !== undefined) {
      clauses.push("node_id = ?");
      values.push(filter.nodeId);
    }
    if (filter.kind !== undefined) {
      clauses.push("kind = ?");
      values.push(filter.kind);
    }
    if (filter.status !== undefined) {
      clauses.push("status = ?");
      values.push(filter.status);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    const rows = this.db
      .prepare(`SELECT * FROM workflow_node_attempts ${where} ORDER BY started_at DESC, id DESC LIMIT ?`)
      .all(...values, limit) as WorkflowNodeAttemptRow[];
    return rows.map(workflowNodeAttemptFromRow);
  }

  saveWaitToken(token: WorkflowWaitToken): void {
    this.db.prepare(`
      INSERT INTO workflow_wait_tokens (
        id,
        workflow_run_id,
        node_attempt_id,
        human_node_id,
        kind,
        available_actions_json,
        prompt,
        schema_json,
        status,
        resume_payload_json,
        resume_payload_present,
        expires_at,
        created_at,
        resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_run_id = excluded.workflow_run_id,
        node_attempt_id = excluded.node_attempt_id,
        human_node_id = excluded.human_node_id,
        kind = excluded.kind,
        available_actions_json = excluded.available_actions_json,
        prompt = excluded.prompt,
        schema_json = excluded.schema_json,
        status = excluded.status,
        resume_payload_json = excluded.resume_payload_json,
        resume_payload_present = excluded.resume_payload_present,
        expires_at = excluded.expires_at,
        resolved_at = excluded.resolved_at
    `).run(
      token.id,
      token.workflowRunId,
      token.nodeAttemptId ?? null,
      token.humanNodeId ?? null,
      token.kind ?? null,
      serialize(token.actions),
      token.prompt,
      serializeOptional(token.schema),
      token.status,
      token.resumePayload === undefined ? null : serialize(token.resumePayload),
      token.resumePayload === undefined ? 0 : 1,
      token.expiresAt ?? null,
      token.createdAt,
      token.resumedAt ?? null,
    );
  }

  getWaitToken(id: WorkflowWaitTokenId): WorkflowWaitToken | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_wait_tokens WHERE id = ?").get(id) as
      | WorkflowWaitTokenRow
      | undefined;
    return row ? workflowWaitTokenFromRow(row) : undefined;
  }

  listWaitTokens(filter: WorkflowWaitTokenListFilter = {}): WorkflowWaitToken[] {
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (filter.workflowRunId !== undefined) {
      clauses.push("workflow_run_id = ?");
      values.push(filter.workflowRunId);
    }
    if (filter.status !== undefined) {
      clauses.push("status = ?");
      values.push(filter.status);
    }
    if (filter.humanNodeId !== undefined) {
      clauses.push("human_node_id = ?");
      values.push(filter.humanNodeId);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 1000));
    const rows = this.db
      .prepare(`SELECT * FROM workflow_wait_tokens ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...values, limit) as WorkflowWaitTokenRow[];
    return rows.map(workflowWaitTokenFromRow);
  }

  close(): void {
    this.db.close();
  }
}

function workflowRunFromRow(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    ...(row.workflow_definition_hash ? { workflowDefinitionHash: row.workflow_definition_hash } : {}),
    ...(row.definition_snapshot_id ? { definitionSnapshotId: row.definition_snapshot_id } : {}),
    ownerScope: row.owner_scope,
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.parent_node_attempt_id ? { parentNodeAttemptId: row.parent_node_attempt_id } : {}),
    ...(row.pibo_session_id ? { piboSessionId: row.pibo_session_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.environment_json ? { environment: parseJson(row.environment_json) } : {}),
    status: row.status,
    current: parseJson(row.current_json),
    input: parseJson(row.input_json) as WorkflowValue,
    ...(row.output_present ? { output: parseJson(row.output_json ?? "null") as WorkflowValue } : {}),
    state: parseJson(row.state_json),
    ...(row.checkpoint_json ? { checkpoint: parseJson(row.checkpoint_json) } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.failed_at ? { failedAt: row.failed_at } : {}),
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
  };
}

function workflowWaitTokenFromRow(row: WorkflowWaitTokenRow): WorkflowWaitToken {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    ...(row.node_attempt_id ? { nodeAttemptId: row.node_attempt_id } : {}),
    ...(row.human_node_id ? { humanNodeId: row.human_node_id } : {}),
    ...(row.kind ? { kind: row.kind } : {}),
    actions: parseJson(row.available_actions_json ?? row.actions_json ?? "[]"),
    prompt: row.prompt,
    ...(row.schema_json ? { schema: parseJson(row.schema_json) } : {}),
    status: row.status,
    ...(row.resume_payload_present ? { resumePayload: parseJson(row.resume_payload_json ?? "null") as WorkflowValue } : {}),
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.resolved_at ?? row.resumed_at ? { resumedAt: (row.resolved_at ?? row.resumed_at) as string } : {}),
  };
}

function workflowNodeAttemptFromRow(row: WorkflowNodeAttemptRow): NodeAttempt {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    nodeId: row.node_id,
    attempt: row.attempt_number ?? row.attempt ?? 0,
    kind: row.kind,
    status: row.status,
    ...(row.environment_json ? { environment: parseJson<WorkflowExecutionEnvironment>(row.environment_json) } : {}),
    input: parseJson(row.input_json) as WorkflowValue,
    ...(row.output_present ? { output: parseJson(row.output_json ?? "null") as WorkflowValue } : {}),
    ...(row.local_state_json ? { localState: parseJson(row.local_state_json) } : {}),
    ...(row.metadata_json ? { metadata: parseJson(row.metadata_json) } : {}),
    ...(row.error_json ? { error: parseJson(row.error_json) } : {}),
    ...(row.lease_json ? { lease: parseJson(row.lease_json) } : {}),
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.heartbeat_at ? { heartbeatAt: row.heartbeat_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.failed_at ? { failedAt: row.failed_at } : {}),
    ...(row.available_at ? { availableAt: row.available_at } : {}),
  };
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function serializeOptional(value: unknown | undefined): string | null {
  return value === undefined ? null : serialize(value);
}

function parseJson<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}
