import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalWorkflowDefinitionJson } from "../definition-hash.js";
import type {
  EdgeTransfer,
  EdgeTransferId,
  NodeAttempt,
  NodeAttemptId,
  NodeAttemptStatus,
  WorkflowArchiveStateRecord,
  WorkflowCheckpoint,
  WorkflowCheckpointId,
  WorkflowDefinitionSnapshot,
  WorkflowDefinitionSnapshotId,
  WorkflowDeleteTombstoneRecord,
  WorkflowDraftRecord,
  WorkflowDraftValidationState,
  WorkflowEventId,
  WorkflowEventRecord,
  WorkflowExecutionEnvironment,
  WorkflowHumanActionId,
  WorkflowHumanActionKind,
  WorkflowHumanActionRecord,
  WorkflowIdentityRecord,
  WorkflowPublishedVersionRecord,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRunStatus,
  WorkflowValue,
  WorkflowWakeup,
  WorkflowWakeupId,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
  WorkflowWaitTokenStatus,
} from "../types/index.js";
import {
  assertPublishedWorkflowVersionIsSame,
  assertWorkflowRecordStatusValue,
  assertWorkflowUiRecordSource,
  createWorkflowPublishedVersionRecord,
} from "./catalog-records.js";
import { buildWorkflowStoreListQuery, workflowStoreListLimit } from "./list-query.js";
import {
  workflowArchiveStateFromRow,
  workflowCheckpointFromRow,
  workflowDefinitionSnapshotFromRow,
  workflowDeleteTombstoneFromRow,
  workflowDraftFromRow,
  workflowEdgeTransferFromRow,
  workflowEventFromRow,
  workflowHumanActionFromRow,
  workflowIdentityFromRow,
  workflowNodeAttemptFromRow,
  workflowPublishedVersionFromRow,
  workflowRunFromRow,
  workflowWaitTokenFromRow,
  workflowWakeupFromRow,
  type WorkflowArchiveStateRow,
  type WorkflowCheckpointRow,
  type WorkflowDefinitionSnapshotRow,
  type WorkflowDeleteTombstoneRow,
  type WorkflowDraftRow,
  type WorkflowEdgeTransferRow,
  type WorkflowEventRow,
  type WorkflowHumanActionRow,
  type WorkflowIdentityRow,
  type WorkflowNodeAttemptRow,
  type WorkflowPublishedVersionRow,
  type WorkflowRunRow,
  type WorkflowWaitTokenRow,
  type WorkflowWakeupRow,
} from "./row-mappers.js";
import { installWorkflowSqliteSchema } from "./schema.js";

export {
  assertPublishedWorkflowVersionRecord,
  assertWorkflowRecordSource,
  assertWorkflowRecordStatus,
  createWorkflowPublishedVersionRecord,
  isWorkflowRecordSource,
  isWorkflowRecordStatus,
  WORKFLOW_RECORD_SOURCES,
  WORKFLOW_RECORD_STATUSES,
  type CreateWorkflowPublishedVersionRecordInput,
} from "./catalog-records.js";

export {
  createWorkflowSqlitePath,
  isNormalSessionFactStorageName,
  WORKFLOW_SQLITE_FILENAME,
  WORKFLOW_SQLITE_NORMAL_SESSION_FACT_KEYWORDS,
  WORKFLOW_SQLITE_SCHEMA_VERSION,
  WORKFLOW_SQLITE_SESSION_LINK_COLUMNS,
  WORKFLOW_SQLITE_TABLES,
  type WorkflowSqliteTableName,
} from "./schema.js";

export type WorkflowRunStore = {
  saveRun(run: WorkflowRun): void | Promise<void>;
  getRun(id: WorkflowRunId): WorkflowRun | undefined | Promise<WorkflowRun | undefined>;
};

export type WorkflowDefinitionSnapshotStore = {
  saveDefinitionSnapshot(snapshot: WorkflowDefinitionSnapshot): void | Promise<void>;
  getDefinitionSnapshot(id: WorkflowDefinitionSnapshotId): WorkflowDefinitionSnapshot | undefined | Promise<WorkflowDefinitionSnapshot | undefined>;
  listDefinitionSnapshots(filter?: WorkflowDefinitionSnapshotListFilter): WorkflowDefinitionSnapshot[] | Promise<WorkflowDefinitionSnapshot[]>;
};

export type WorkflowIdentityStore = {
  saveWorkflowIdentity(record: WorkflowIdentityRecord): void | Promise<void>;
  getWorkflowIdentity(workflowId: string): WorkflowIdentityRecord | undefined | Promise<WorkflowIdentityRecord | undefined>;
  listWorkflowIdentities(filter?: WorkflowIdentityListFilter): WorkflowIdentityRecord[] | Promise<WorkflowIdentityRecord[]>;
};

export type WorkflowDraftStore = {
  saveWorkflowDraft(record: WorkflowDraftRecord): void | Promise<void>;
  getWorkflowDraft(draftId: string): WorkflowDraftRecord | undefined | Promise<WorkflowDraftRecord | undefined>;
  listWorkflowDrafts(filter?: WorkflowDraftListFilter): WorkflowDraftRecord[] | Promise<WorkflowDraftRecord[]>;
};

export type WorkflowArchiveStateStore = {
  saveWorkflowArchiveState(record: WorkflowArchiveStateRecord): void | Promise<void>;
  getWorkflowArchiveState(workflowId: string): WorkflowArchiveStateRecord | undefined | Promise<WorkflowArchiveStateRecord | undefined>;
  listWorkflowArchiveStates(filter?: WorkflowArchiveStateListFilter): WorkflowArchiveStateRecord[] | Promise<WorkflowArchiveStateRecord[]>;
};

export type WorkflowDeleteTombstoneStore = {
  saveWorkflowDeleteTombstone(record: WorkflowDeleteTombstoneRecord): void | Promise<void>;
  getWorkflowDeleteTombstone(workflowId: string): WorkflowDeleteTombstoneRecord | undefined | Promise<WorkflowDeleteTombstoneRecord | undefined>;
  listWorkflowDeleteTombstones(filter?: WorkflowDeleteTombstoneListFilter): WorkflowDeleteTombstoneRecord[] | Promise<WorkflowDeleteTombstoneRecord[]>;
};

export type WorkflowPublishedVersionStore = {
  savePublishedWorkflowVersion(record: WorkflowPublishedVersionRecord): void | Promise<void>;
  getPublishedWorkflowVersion(workflowId: string, version: string): WorkflowPublishedVersionRecord | undefined | Promise<WorkflowPublishedVersionRecord | undefined>;
  listPublishedWorkflowVersions(filter?: WorkflowPublishedVersionListFilter): WorkflowPublishedVersionRecord[] | Promise<WorkflowPublishedVersionRecord[]>;
};

export type WorkflowEventStore = {
  saveEvent(event: WorkflowEventRecord): void | Promise<void>;
  getEvent(id: WorkflowEventId): WorkflowEventRecord | undefined | Promise<WorkflowEventRecord | undefined>;
  listEvents(filter?: WorkflowEventListFilter): WorkflowEventRecord[] | Promise<WorkflowEventRecord[]>;
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

export type WorkflowEdgeTransferStore = {
  saveEdgeTransfer(transfer: EdgeTransfer): void | Promise<void>;
  getEdgeTransfer(id: EdgeTransferId): EdgeTransfer | undefined | Promise<EdgeTransfer | undefined>;
  listEdgeTransfers(filter?: WorkflowEdgeTransferListFilter): EdgeTransfer[] | Promise<EdgeTransfer[]>;
};

export type WorkflowCheckpointStore = {
  saveCheckpoint(checkpoint: WorkflowCheckpoint): void | Promise<void>;
  getCheckpoint(id: WorkflowCheckpointId): WorkflowCheckpoint | undefined | Promise<WorkflowCheckpoint | undefined>;
  listCheckpoints(filter?: WorkflowCheckpointListFilter): WorkflowCheckpoint[] | Promise<WorkflowCheckpoint[]>;
};

export type WorkflowWakeupStore = {
  saveWakeup(wakeup: WorkflowWakeup): void | Promise<void>;
  getWakeup(id: WorkflowWakeupId): WorkflowWakeup | undefined | Promise<WorkflowWakeup | undefined>;
  listWakeups(filter?: WorkflowWakeupListFilter): WorkflowWakeup[] | Promise<WorkflowWakeup[]>;
};

export type WorkflowHumanActionStore = {
  saveHumanAction(action: WorkflowHumanActionRecord): void | Promise<void>;
  getHumanAction(id: WorkflowHumanActionId): WorkflowHumanActionRecord | undefined | Promise<WorkflowHumanActionRecord | undefined>;
  listHumanActions(filter?: WorkflowHumanActionListFilter): WorkflowHumanActionRecord[] | Promise<WorkflowHumanActionRecord[]>;
};

export type WorkflowRunListFilter = {
  workflowId?: string;
  status?: WorkflowRunStatus;
  ownerScope?: string;
  limit?: number;
};

export type WorkflowDefinitionSnapshotListFilter = {
  workflowId?: string;
  workflowVersion?: string;
  hash?: string;
  limit?: number;
};

export type WorkflowIdentityListFilter = {
  workflowId?: string;
  limit?: number;
};

export type WorkflowDraftListFilter = {
  workflowId?: string;
  validationState?: WorkflowDraftValidationState;
  limit?: number;
};

export type WorkflowArchiveStateListFilter = {
  archived?: boolean;
  limit?: number;
};

export type WorkflowDeleteTombstoneListFilter = {
  limit?: number;
};

export type WorkflowPublishedVersionListFilter = {
  workflowId?: string;
  limit?: number;
};

export type WorkflowEventListFilter = {
  workflowRunId?: WorkflowRunId;
  type?: string;
  nodeId?: string;
  edgeId?: string;
  attemptId?: NodeAttemptId;
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

export type WorkflowEdgeTransferListFilter = {
  workflowRunId?: WorkflowRunId;
  edgeId?: string;
  targetNodeId?: string;
  status?: EdgeTransfer["status"];
  limit?: number;
};

export type WorkflowCheckpointListFilter = {
  workflowRunId?: WorkflowRunId;
  namespace?: string;
  limit?: number;
};

export type WorkflowWakeupListFilter = {
  workflowRunId?: WorkflowRunId;
  nodeAttemptId?: NodeAttemptId;
  kind?: WorkflowWakeup["kind"];
  correlationId?: string;
  limit?: number;
};

export type WorkflowHumanActionListFilter = {
  workflowRunId?: WorkflowRunId;
  waitTokenId?: WorkflowWaitTokenId;
  kind?: WorkflowHumanActionKind;
  limit?: number;
};

export class SqliteWorkflowRunStore implements
  WorkflowRunStore,
  WorkflowDefinitionSnapshotStore,
  WorkflowIdentityStore,
  WorkflowDraftStore,
  WorkflowPublishedVersionStore,
  WorkflowArchiveStateStore,
  WorkflowDeleteTombstoneStore,
  WorkflowEventStore,
  WorkflowWaitTokenStore,
  WorkflowNodeAttemptStore,
  WorkflowEdgeTransferStore,
  WorkflowCheckpointStore,
  WorkflowWakeupStore,
  WorkflowHumanActionStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const resolvedPath = path === ":memory:" ? path : resolve(path);
    if (resolvedPath !== ":memory:") {
      mkdirSync(dirname(resolvedPath), { recursive: true });
    }

    this.db = new DatabaseSync(resolvedPath);
    installWorkflowSqliteSchema(this.db, { enableWal: resolvedPath !== ":memory:" });
  }

  saveDefinitionSnapshot(snapshot: WorkflowDefinitionSnapshot): void {
    this.db.prepare(`
      INSERT INTO workflow_definition_snapshots (
        id,
        workflow_id,
        workflow_version,
        definition_hash,
        compiled_definition_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_id = excluded.workflow_id,
        workflow_version = excluded.workflow_version,
        definition_hash = excluded.definition_hash,
        compiled_definition_json = excluded.compiled_definition_json,
        created_at = excluded.created_at
    `).run(
      snapshot.id,
      snapshot.workflowId,
      snapshot.workflowVersion,
      snapshot.hash,
      serialize(snapshot.definition),
      snapshot.createdAt,
    );
  }

  getDefinitionSnapshot(id: WorkflowDefinitionSnapshotId): WorkflowDefinitionSnapshot | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_definition_snapshots WHERE id = ?").get(id) as
      | WorkflowDefinitionSnapshotRow
      | undefined;
    return row ? workflowDefinitionSnapshotFromRow(row) : undefined;
  }

  listDefinitionSnapshots(filter: WorkflowDefinitionSnapshotListFilter = {}): WorkflowDefinitionSnapshot[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_id = ?", value: filter.workflowId },
      { clause: "workflow_version = ?", value: filter.workflowVersion },
      { clause: "definition_hash = ?", value: filter.hash },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_definition_snapshots ${query.where} ORDER BY created_at DESC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowDefinitionSnapshotRow[];
    return rows.map(workflowDefinitionSnapshotFromRow);
  }

  saveWorkflowIdentity(record: WorkflowIdentityRecord): void {
    assertWorkflowUiRecordSource(record.source, "Workflow identity");

    this.db.prepare(`
      INSERT INTO workflow_identities (
        workflow_id,
        source,
        title,
        description,
        tags_json,
        current_draft_id,
        latest_version,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id) DO UPDATE SET
        source = excluded.source,
        title = excluded.title,
        description = excluded.description,
        tags_json = excluded.tags_json,
        current_draft_id = excluded.current_draft_id,
        latest_version = excluded.latest_version,
        created_by = excluded.created_by,
        created_at = excluded.created_at,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      record.workflowId,
      record.source,
      record.title,
      record.description ?? null,
      serialize(record.tags),
      record.currentDraftId ?? null,
      record.latestVersion ?? null,
      record.createdBy ?? null,
      record.createdAt,
      record.updatedBy ?? null,
      record.updatedAt,
    );
  }

  getWorkflowIdentity(workflowId: string): WorkflowIdentityRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_identities WHERE workflow_id = ?").get(workflowId) as
      | WorkflowIdentityRow
      | undefined;
    return row ? workflowIdentityFromRow(row) : undefined;
  }

  listWorkflowIdentities(filter: WorkflowIdentityListFilter = {}): WorkflowIdentityRecord[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_id = ?", value: filter.workflowId },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_identities ${query.where} ORDER BY updated_at DESC, workflow_id ASC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowIdentityRow[];
    return rows.map(workflowIdentityFromRow);
  }

  saveWorkflowDraft(record: WorkflowDraftRecord): void {
    assertWorkflowUiRecordSource(record.source, "Workflow draft");
    assertWorkflowRecordStatusValue(record.status, "draft", "Workflow draft");

    const conflict = this.db
      .prepare("SELECT draft_id FROM workflow_drafts WHERE workflow_id = ? AND status = 'draft' AND draft_id <> ? LIMIT 1")
      .get(record.workflowId, record.draftId) as { draft_id: string } | undefined;
    if (conflict) {
      throw new Error(`Workflow '${record.workflowId}' already has an active draft '${conflict.draft_id}'.`);
    }

    this.db.prepare(`
      INSERT INTO workflow_drafts (
        draft_id,
        workflow_id,
        source,
        status,
        base_workflow_id,
        base_workflow_version,
        base_definition_hash,
        version_intent,
        definition_json,
        diagnostics_json,
        validation_state,
        revision,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(draft_id) DO UPDATE SET
        workflow_id = excluded.workflow_id,
        source = excluded.source,
        status = excluded.status,
        base_workflow_id = excluded.base_workflow_id,
        base_workflow_version = excluded.base_workflow_version,
        base_definition_hash = excluded.base_definition_hash,
        version_intent = excluded.version_intent,
        definition_json = excluded.definition_json,
        diagnostics_json = excluded.diagnostics_json,
        validation_state = excluded.validation_state,
        revision = excluded.revision,
        created_by = excluded.created_by,
        created_at = excluded.created_at,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      record.draftId,
      record.workflowId,
      record.source,
      record.status,
      record.baseWorkflowId ?? null,
      record.baseWorkflowVersion ?? null,
      record.baseDefinitionHash ?? null,
      record.versionIntent,
      serialize(record.definition),
      serialize(record.diagnostics),
      record.validationState,
      record.revision,
      record.createdBy ?? null,
      record.createdAt,
      record.updatedBy ?? null,
      record.updatedAt,
    );

    this.db.prepare(`
      UPDATE workflow_identities
      SET current_draft_id = ?,
          updated_by = COALESCE(?, updated_by),
          updated_at = ?
      WHERE workflow_id = ?
    `).run(record.draftId, record.updatedBy ?? null, record.updatedAt, record.workflowId);
  }

  getWorkflowDraft(draftId: string): WorkflowDraftRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_drafts WHERE draft_id = ?").get(draftId) as WorkflowDraftRow | undefined;
    return row ? workflowDraftFromRow(row) : undefined;
  }

  listWorkflowDrafts(filter: WorkflowDraftListFilter = {}): WorkflowDraftRecord[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_id = ?", value: filter.workflowId },
      { clause: "validation_state = ?", value: filter.validationState },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_drafts ${query.where} ORDER BY updated_at DESC, draft_id ASC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowDraftRow[];
    return rows.map(workflowDraftFromRow);
  }

  saveWorkflowArchiveState(record: WorkflowArchiveStateRecord): void {
    assertWorkflowUiRecordSource(record.source, "Workflow archive state");

    this.db.prepare(`
      INSERT INTO workflow_archive_states (
        workflow_id,
        source,
        archived,
        archived_at,
        archived_by,
        archive_reason,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id) DO UPDATE SET
        source = excluded.source,
        archived = excluded.archived,
        archived_at = excluded.archived_at,
        archived_by = excluded.archived_by,
        archive_reason = excluded.archive_reason,
        updated_at = excluded.updated_at
    `).run(
      record.workflowId,
      record.source,
      record.archived ? 1 : 0,
      record.archivedAt ?? null,
      record.archivedBy ?? null,
      record.archiveReason ?? null,
      record.updatedAt,
    );
  }

  getWorkflowArchiveState(workflowId: string): WorkflowArchiveStateRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_archive_states WHERE workflow_id = ?").get(workflowId) as
      | WorkflowArchiveStateRow
      | undefined;
    return row ? workflowArchiveStateFromRow(row) : undefined;
  }

  listWorkflowArchiveStates(filter: WorkflowArchiveStateListFilter = {}): WorkflowArchiveStateRecord[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "archived = ?", value: filter.archived === undefined ? undefined : filter.archived ? 1 : 0 },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_archive_states ${query.where} ORDER BY updated_at DESC, workflow_id ASC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowArchiveStateRow[];
    return rows.map(workflowArchiveStateFromRow);
  }

  saveWorkflowDeleteTombstone(record: WorkflowDeleteTombstoneRecord): void {
    assertWorkflowUiRecordSource(record.source, "Workflow delete tombstone");
    if (record.deleted !== true) {
      throw new Error("Workflow delete tombstone records must use deleted true.");
    }

    this.db.prepare(`
      INSERT INTO workflow_delete_tombstones (
        workflow_id,
        source,
        deleted,
        deleted_at,
        deleted_by,
        last_known_title,
        last_known_version,
        last_definition_hash,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id) DO UPDATE SET
        source = excluded.source,
        deleted = excluded.deleted,
        deleted_at = excluded.deleted_at,
        deleted_by = excluded.deleted_by,
        last_known_title = excluded.last_known_title,
        last_known_version = excluded.last_known_version,
        last_definition_hash = excluded.last_definition_hash,
        created_at = excluded.created_at
    `).run(
      record.workflowId,
      record.source,
      1,
      record.deletedAt ?? null,
      record.deletedBy ?? null,
      record.lastKnownTitle,
      record.lastKnownVersion ?? null,
      record.lastDefinitionHash ?? null,
      record.createdAt,
    );
  }

  getWorkflowDeleteTombstone(workflowId: string): WorkflowDeleteTombstoneRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_delete_tombstones WHERE workflow_id = ?").get(workflowId) as
      | WorkflowDeleteTombstoneRow
      | undefined;
    return row ? workflowDeleteTombstoneFromRow(row) : undefined;
  }

  listWorkflowDeleteTombstones(filter: WorkflowDeleteTombstoneListFilter = {}): WorkflowDeleteTombstoneRecord[] {
    const limit = workflowStoreListLimit(filter.limit);
    const rows = this.db
      .prepare("SELECT * FROM workflow_delete_tombstones ORDER BY created_at DESC, workflow_id ASC LIMIT ?")
      .all(limit) as WorkflowDeleteTombstoneRow[];
    return rows.map(workflowDeleteTombstoneFromRow);
  }

  savePublishedWorkflowVersion(record: WorkflowPublishedVersionRecord): void {
    const normalized = createWorkflowPublishedVersionRecord(record);
    const existing = this.getPublishedWorkflowVersion(normalized.workflowId, normalized.version);
    if (existing) {
      assertPublishedWorkflowVersionIsSame(existing, normalized);
      return;
    }

    this.db.prepare(`
      INSERT INTO workflow_published_versions (
        workflow_id,
        version,
        source,
        status,
        definition_hash,
        definition_json,
        published_from_draft_id,
        published_by,
        published_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalized.workflowId,
      normalized.version,
      normalized.source,
      normalized.status,
      normalized.definitionHash,
      canonicalWorkflowDefinitionJson(normalized.definition),
      normalized.publishedFromDraftId ?? null,
      normalized.publishedBy ?? null,
      normalized.publishedAt,
      normalized.createdAt,
    );
  }

  getPublishedWorkflowVersion(workflowId: string, version: string): WorkflowPublishedVersionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_published_versions WHERE workflow_id = ? AND version = ?").get(workflowId, version) as
      | WorkflowPublishedVersionRow
      | undefined;
    return row ? workflowPublishedVersionFromRow(row) : undefined;
  }

  listPublishedWorkflowVersions(filter: WorkflowPublishedVersionListFilter = {}): WorkflowPublishedVersionRecord[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_id = ?", value: filter.workflowId },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_published_versions ${query.where} ORDER BY workflow_id ASC, version ASC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowPublishedVersionRow[];
    return rows.map(workflowPublishedVersionFromRow);
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
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_id = ?", value: filter.workflowId },
      { clause: "status = ?", value: filter.status },
      { clause: "owner_scope = ?", value: filter.ownerScope },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_runs ${query.where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowRunRow[];
    return rows.map(workflowRunFromRow);
  }

  saveEvent(event: WorkflowEventRecord): void {
    this.db.prepare(`
      INSERT INTO workflow_events (
        id,
        workflow_run_id,
        type,
        node_id,
        edge_id,
        attempt_id,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_run_id = excluded.workflow_run_id,
        type = excluded.type,
        node_id = excluded.node_id,
        edge_id = excluded.edge_id,
        attempt_id = excluded.attempt_id,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `).run(
      event.id,
      event.workflowRunId,
      event.type,
      event.nodeId ?? null,
      event.edgeId ?? null,
      event.attemptId ?? null,
      serializeOptional(event.payload),
      event.createdAt,
    );
  }

  getEvent(id: WorkflowEventId): WorkflowEventRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_events WHERE id = ?").get(id) as WorkflowEventRow | undefined;
    return row ? workflowEventFromRow(row) : undefined;
  }

  listEvents(filter: WorkflowEventListFilter = {}): WorkflowEventRecord[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_run_id = ?", value: filter.workflowRunId },
      { clause: "type = ?", value: filter.type },
      { clause: "node_id = ?", value: filter.nodeId },
      { clause: "edge_id = ?", value: filter.edgeId },
      { clause: "attempt_id = ?", value: filter.attemptId },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_events ${query.where} ORDER BY created_at ASC, id ASC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowEventRow[];
    return rows.map(workflowEventFromRow);
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
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_run_id = ?", value: filter.workflowRunId },
      { clause: "node_id = ?", value: filter.nodeId },
      { clause: "kind = ?", value: filter.kind },
      { clause: "status = ?", value: filter.status },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_node_attempts ${query.where} ORDER BY started_at DESC, id DESC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowNodeAttemptRow[];
    return rows.map(workflowNodeAttemptFromRow);
  }

  saveEdgeTransfer(transfer: EdgeTransfer): void {
    this.db.prepare(`
      INSERT INTO workflow_edge_transfers (
        id,
        workflow_run_id,
        edge_id,
        source_node_attempt_id,
        target_node_id,
        payload_json,
        adapter_attempt_id,
        status,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_run_id = excluded.workflow_run_id,
        edge_id = excluded.edge_id,
        source_node_attempt_id = excluded.source_node_attempt_id,
        target_node_id = excluded.target_node_id,
        payload_json = excluded.payload_json,
        adapter_attempt_id = excluded.adapter_attempt_id,
        status = excluded.status,
        created_at = excluded.created_at
    `).run(
      transfer.id,
      transfer.workflowRunId,
      transfer.edgeId,
      transfer.sourceNodeAttemptId,
      transfer.targetNodeId,
      serialize(transfer.payload),
      transfer.adapterAttemptId ?? null,
      transfer.status,
      transfer.createdAt,
    );
  }

  getEdgeTransfer(id: EdgeTransferId): EdgeTransfer | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_edge_transfers WHERE id = ?").get(id) as
      | WorkflowEdgeTransferRow
      | undefined;
    return row ? workflowEdgeTransferFromRow(row) : undefined;
  }

  listEdgeTransfers(filter: WorkflowEdgeTransferListFilter = {}): EdgeTransfer[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_run_id = ?", value: filter.workflowRunId },
      { clause: "edge_id = ?", value: filter.edgeId },
      { clause: "target_node_id = ?", value: filter.targetNodeId },
      { clause: "status = ?", value: filter.status },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_edge_transfers ${query.where} ORDER BY created_at ASC, id ASC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowEdgeTransferRow[];
    return rows.map(workflowEdgeTransferFromRow);
  }

  saveCheckpoint(checkpoint: WorkflowCheckpoint): void {
    this.db.prepare(`
      INSERT INTO workflow_checkpoints (
        id,
        workflow_run_id,
        namespace,
        cursor_json,
        state_json,
        pending_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_run_id = excluded.workflow_run_id,
        namespace = excluded.namespace,
        cursor_json = excluded.cursor_json,
        state_json = excluded.state_json,
        pending_json = excluded.pending_json,
        created_at = excluded.created_at
    `).run(
      checkpoint.id,
      checkpoint.workflowRunId,
      checkpoint.namespace,
      serialize(checkpoint.cursor),
      serialize(checkpoint.globalState),
      serialize({
        pendingNodeIds: checkpoint.pendingNodeIds,
        completedNodeIds: checkpoint.completedNodeIds,
        edgePayloadRefs: checkpoint.edgePayloadRefs,
      }),
      checkpoint.createdAt,
    );
  }

  getCheckpoint(id: WorkflowCheckpointId): WorkflowCheckpoint | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_checkpoints WHERE id = ?").get(id) as
      | WorkflowCheckpointRow
      | undefined;
    return row ? workflowCheckpointFromRow(row) : undefined;
  }

  listCheckpoints(filter: WorkflowCheckpointListFilter = {}): WorkflowCheckpoint[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_run_id = ?", value: filter.workflowRunId },
      { clause: "namespace = ?", value: filter.namespace },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_checkpoints ${query.where} ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowCheckpointRow[];
    return rows.map(workflowCheckpointFromRow);
  }

  saveWakeup(wakeup: WorkflowWakeup): void {
    this.db.prepare(`
      INSERT INTO workflow_wakeups (
        id,
        workflow_run_id,
        node_attempt_id,
        kind,
        available_at,
        correlation_id,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_run_id = excluded.workflow_run_id,
        node_attempt_id = excluded.node_attempt_id,
        kind = excluded.kind,
        available_at = excluded.available_at,
        correlation_id = excluded.correlation_id,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `).run(
      wakeup.id,
      wakeup.workflowRunId,
      wakeup.nodeAttemptId ?? null,
      wakeup.kind,
      wakeup.availableAt,
      wakeup.correlationId ?? null,
      serializeOptional(wakeup.payload),
      wakeup.createdAt,
    );
  }

  getWakeup(id: WorkflowWakeupId): WorkflowWakeup | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_wakeups WHERE id = ?").get(id) as WorkflowWakeupRow | undefined;
    return row ? workflowWakeupFromRow(row) : undefined;
  }

  listWakeups(filter: WorkflowWakeupListFilter = {}): WorkflowWakeup[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_run_id = ?", value: filter.workflowRunId },
      { clause: "node_attempt_id = ?", value: filter.nodeAttemptId },
      { clause: "kind = ?", value: filter.kind },
      { clause: "correlation_id = ?", value: filter.correlationId },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_wakeups ${query.where} ORDER BY available_at ASC, id ASC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowWakeupRow[];
    return rows.map(workflowWakeupFromRow);
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
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_run_id = ?", value: filter.workflowRunId },
      { clause: "status = ?", value: filter.status },
      { clause: "human_node_id = ?", value: filter.humanNodeId },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_wait_tokens ${query.where} ORDER BY created_at DESC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowWaitTokenRow[];
    return rows.map(workflowWaitTokenFromRow);
  }

  saveHumanAction(action: WorkflowHumanActionRecord): void {
    this.db.prepare(`
      INSERT INTO workflow_human_actions (
        id,
        workflow_run_id,
        wait_token_id,
        kind,
        actor_json,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_run_id = excluded.workflow_run_id,
        wait_token_id = excluded.wait_token_id,
        kind = excluded.kind,
        actor_json = excluded.actor_json,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `).run(
      action.id,
      action.workflowRunId,
      action.waitTokenId,
      action.kind,
      serializeOptional(action.actor),
      serializeOptional(action.payload),
      action.createdAt,
    );
  }

  getHumanAction(id: WorkflowHumanActionId): WorkflowHumanActionRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_human_actions WHERE id = ?").get(id) as
      | WorkflowHumanActionRow
      | undefined;
    return row ? workflowHumanActionFromRow(row) : undefined;
  }

  listHumanActions(filter: WorkflowHumanActionListFilter = {}): WorkflowHumanActionRecord[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_run_id = ?", value: filter.workflowRunId },
      { clause: "wait_token_id = ?", value: filter.waitTokenId },
      { clause: "kind = ?", value: filter.kind },
    ], filter.limit);
    const rows = this.db
      .prepare(`SELECT * FROM workflow_human_actions ${query.where} ORDER BY created_at ASC, id ASC LIMIT ?`)
      .all(...query.values, query.limit) as WorkflowHumanActionRow[];
    return rows.map(workflowHumanActionFromRow);
  }

  close(): void {
    this.db.close();
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function serializeOptional(value: unknown | undefined): string | null {
  return value === undefined ? null : serialize(value);
}
