import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  EdgeTransfer,
  EdgeTransferId,
  NodeAttempt,
  NodeAttemptId,
  WorkflowArchiveStateRecord,
  WorkflowCheckpoint,
  WorkflowCheckpointId,
  WorkflowDefinitionSnapshot,
  WorkflowDefinitionSnapshotId,
  WorkflowDeleteTombstoneRecord,
  WorkflowDraftRecord,
  WorkflowEventId,
  WorkflowEventRecord,
  WorkflowHumanActionId,
  WorkflowHumanActionRecord,
  WorkflowIdentityRecord,
  WorkflowPublishedVersionRecord,
  WorkflowRun,
  WorkflowRunId,
  WorkflowWakeup,
  WorkflowWakeupId,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
} from "../types/index.js";
import {
  assertPublishedWorkflowVersionIsSame,
  assertWorkflowRecordStatusValue,
  assertWorkflowUiRecordSource,
  createWorkflowPublishedVersionRecord,
} from "./catalog-records.js";
import { assertNoActiveWorkflowDraftConflict, updateWorkflowIdentityCurrentDraft } from "./draft-writes.js";
import type {
  WorkflowArchiveStateListFilter,
  WorkflowArchiveStateStore,
  WorkflowCheckpointListFilter,
  WorkflowCheckpointStore,
  WorkflowDefinitionSnapshotListFilter,
  WorkflowDefinitionSnapshotStore,
  WorkflowDeleteTombstoneListFilter,
  WorkflowDeleteTombstoneStore,
  WorkflowDraftListFilter,
  WorkflowDraftStore,
  WorkflowEdgeTransferListFilter,
  WorkflowEdgeTransferStore,
  WorkflowEventListFilter,
  WorkflowEventStore,
  WorkflowHumanActionListFilter,
  WorkflowHumanActionStore,
  WorkflowIdentityListFilter,
  WorkflowIdentityStore,
  WorkflowNodeAttemptListFilter,
  WorkflowNodeAttemptStore,
  WorkflowPublishedVersionListFilter,
  WorkflowPublishedVersionStore,
  WorkflowRunListFilter,
  WorkflowRunStore,
  WorkflowWaitTokenListFilter,
  WorkflowWaitTokenStore,
  WorkflowWakeupListFilter,
  WorkflowWakeupStore,
} from "./contracts.js";
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
import {
  workflowArchiveStateWriteValues,
  workflowCheckpointWriteValues,
  workflowDefinitionSnapshotWriteValues,
  workflowDeleteTombstoneWriteValues,
  workflowDraftWriteValues,
  workflowEdgeTransferWriteValues,
  workflowEventWriteValues,
  workflowHumanActionWriteValues,
  workflowIdentityWriteValues,
  workflowNodeAttemptWriteValues,
  workflowPublishedVersionWriteValues,
  workflowRunWriteValues,
  workflowWaitTokenWriteValues,
  workflowWakeupWriteValues,
} from "./write-values.js";

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

export type {
  WorkflowArchiveStateListFilter,
  WorkflowArchiveStateStore,
  WorkflowCheckpointListFilter,
  WorkflowCheckpointStore,
  WorkflowDefinitionSnapshotListFilter,
  WorkflowDefinitionSnapshotStore,
  WorkflowDeleteTombstoneListFilter,
  WorkflowDeleteTombstoneStore,
  WorkflowDraftListFilter,
  WorkflowDraftStore,
  WorkflowEdgeTransferListFilter,
  WorkflowEdgeTransferStore,
  WorkflowEventListFilter,
  WorkflowEventStore,
  WorkflowHumanActionListFilter,
  WorkflowHumanActionStore,
  WorkflowIdentityListFilter,
  WorkflowIdentityStore,
  WorkflowNodeAttemptListFilter,
  WorkflowNodeAttemptStore,
  WorkflowPublishedVersionListFilter,
  WorkflowPublishedVersionStore,
  WorkflowRunListFilter,
  WorkflowRunStore,
  WorkflowWaitTokenListFilter,
  WorkflowWaitTokenStore,
  WorkflowWakeupListFilter,
  WorkflowWakeupStore,
} from "./contracts.js";

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
    `).run(...workflowDefinitionSnapshotWriteValues(snapshot));
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
    `).run(...workflowIdentityWriteValues(record));
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

    assertNoActiveWorkflowDraftConflict(this.db, record);

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
    `).run(...workflowDraftWriteValues(record));

    updateWorkflowIdentityCurrentDraft(this.db, record);
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
    `).run(...workflowArchiveStateWriteValues(record));
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
    `).run(...workflowDeleteTombstoneWriteValues(record));
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
    `).run(...workflowPublishedVersionWriteValues(normalized));
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workflow_id = excluded.workflow_id,
        workflow_version = excluded.workflow_version,
        workflow_definition_hash = excluded.workflow_definition_hash,
        definition_snapshot_id = excluded.definition_snapshot_id,
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
    `).run(...workflowRunWriteValues(run));
  }

  getRun(id: WorkflowRunId): WorkflowRun | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(id) as WorkflowRunRow | undefined;
    return row ? workflowRunFromRow(row) : undefined;
  }

  listRuns(filter: WorkflowRunListFilter = {}): WorkflowRun[] {
    const query = buildWorkflowStoreListQuery([
      { clause: "workflow_id = ?", value: filter.workflowId },
      { clause: "status = ?", value: filter.status },
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
    `).run(...workflowEventWriteValues(event));
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
    `).run(...workflowNodeAttemptWriteValues(nodeAttempt));
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
    `).run(...workflowEdgeTransferWriteValues(transfer));
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
    `).run(...workflowCheckpointWriteValues(checkpoint));
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
    `).run(...workflowWakeupWriteValues(wakeup));
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
    `).run(...workflowWaitTokenWriteValues(token));
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
    `).run(...workflowHumanActionWriteValues(action));
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
