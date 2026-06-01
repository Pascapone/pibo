import type {
  EdgeTransfer,
  NodeAttempt,
  NodeAttemptStatus,
  WorkflowArchiveStateRecord,
  WorkflowCheckpoint,
  WorkflowDefinition,
  WorkflowDefinitionSnapshot,
  WorkflowDeleteTombstoneRecord,
  WorkflowDraftRecord,
  WorkflowDraftValidationState,
  WorkflowEventRecord,
  WorkflowExecutionEnvironment,
  WorkflowHumanActionKind,
  WorkflowHumanActionRecord,
  WorkflowIdentityRecord,
  WorkflowPublishedVersionRecord,
  WorkflowRecordSource,
  WorkflowRecordStatus,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowValue,
  WorkflowWakeup,
  WorkflowWaitToken,
  WorkflowWaitTokenStatus,
} from "../types/index.js";

export type WorkflowRunRow = {
  id: string;
  workflow_id: string;
  workflow_version: string;
  workflow_definition_hash: string | null;
  definition_snapshot_id: string | null;
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

export type WorkflowDefinitionSnapshotRow = {
  id: string;
  workflow_id: string;
  workflow_version: string;
  definition_hash: string;
  compiled_definition_json: string;
  created_at: string;
};

export type WorkflowIdentityRow = {
  workflow_id: string;
  source: WorkflowRecordSource;
  title: string;
  description: string | null;
  tags_json: string;
  current_draft_id: string | null;
  latest_version: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

export type WorkflowDraftRow = {
  draft_id: string;
  workflow_id: string;
  source: WorkflowRecordSource;
  status: WorkflowRecordStatus;
  base_workflow_id: string | null;
  base_workflow_version: string | null;
  base_definition_hash: string | null;
  version_intent: "patch" | "minor" | "major";
  definition_json: string;
  diagnostics_json: string;
  validation_state: WorkflowDraftValidationState;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

export type WorkflowArchiveStateRow = {
  workflow_id: string;
  source: WorkflowRecordSource;
  archived: number;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  updated_at: string;
};

export type WorkflowDeleteTombstoneRow = {
  workflow_id: string;
  source: WorkflowRecordSource;
  deleted: number;
  deleted_at: string | null;
  deleted_by: string | null;
  last_known_title: string;
  last_known_version: string | null;
  last_definition_hash: string | null;
  created_at: string;
};

export type WorkflowPublishedVersionRow = {
  workflow_id: string;
  version: string;
  source: WorkflowRecordSource;
  status: WorkflowRecordStatus;
  definition_hash: string;
  definition_json: string;
  published_from_draft_id: string | null;
  published_by: string | null;
  published_at: string;
  created_at: string;
};

export type WorkflowEventRow = {
  id: string;
  workflow_run_id: string;
  type: string;
  node_id: string | null;
  edge_id: string | null;
  attempt_id: string | null;
  payload_json: string | null;
  created_at: string;
};

export type WorkflowWaitTokenRow = {
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

export type WorkflowNodeAttemptRow = {
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

export type WorkflowEdgeTransferRow = {
  id: string;
  workflow_run_id: string;
  edge_id: string;
  source_node_attempt_id: string;
  target_node_id: string;
  payload_json: string;
  adapter_attempt_id: string | null;
  status: EdgeTransfer["status"];
  created_at: string;
};

export type WorkflowCheckpointRow = {
  id: string;
  workflow_run_id: string;
  namespace: string;
  cursor_json: string;
  state_json: string;
  pending_json: string;
  created_at: string;
};

export type WorkflowWakeupRow = {
  id: string;
  workflow_run_id: string;
  node_attempt_id: string | null;
  kind: WorkflowWakeup["kind"];
  available_at: string;
  correlation_id: string | null;
  payload_json: string | null;
  created_at: string;
};

export type WorkflowHumanActionRow = {
  id: string;
  workflow_run_id: string;
  wait_token_id: string;
  kind: WorkflowHumanActionKind;
  actor_json: string | null;
  payload_json: string | null;
  created_at: string;
};

export function workflowDefinitionSnapshotFromRow(
  row: WorkflowDefinitionSnapshotRow,
): WorkflowDefinitionSnapshot {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    hash: row.definition_hash,
    definition: parseJson(row.compiled_definition_json),
    createdAt: row.created_at,
  };
}

export function workflowIdentityFromRow(
  row: WorkflowIdentityRow,
): WorkflowIdentityRecord {
  return {
    workflowId: row.workflow_id,
    source: "ui",
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    tags: parseJson<string[]>(row.tags_json),
    ...(row.current_draft_id ? { currentDraftId: row.current_draft_id } : {}),
    ...(row.latest_version ? { latestVersion: row.latest_version } : {}),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    createdAt: row.created_at,
    ...(row.updated_by ? { updatedBy: row.updated_by } : {}),
    updatedAt: row.updated_at,
  };
}

export function workflowDraftFromRow(
  row: WorkflowDraftRow,
): WorkflowDraftRecord {
  return {
    draftId: row.draft_id,
    workflowId: row.workflow_id,
    source: "ui",
    status: "draft",
    ...(row.base_workflow_id ? { baseWorkflowId: row.base_workflow_id } : {}),
    ...(row.base_workflow_version
      ? { baseWorkflowVersion: row.base_workflow_version }
      : {}),
    ...(row.base_definition_hash
      ? { baseDefinitionHash: row.base_definition_hash }
      : {}),
    versionIntent: row.version_intent,
    definition: parseJson<WorkflowDraftRecord["definition"]>(
      row.definition_json,
    ),
    diagnostics: parseJson<WorkflowDraftRecord["diagnostics"]>(
      row.diagnostics_json,
    ),
    validationState: row.validation_state,
    revision: row.revision,
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    createdAt: row.created_at,
    ...(row.updated_by ? { updatedBy: row.updated_by } : {}),
    updatedAt: row.updated_at,
  };
}

export function workflowArchiveStateFromRow(
  row: WorkflowArchiveStateRow,
): WorkflowArchiveStateRecord {
  return {
    workflowId: row.workflow_id,
    source: "ui",
    archived: Boolean(row.archived),
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.archived_by ? { archivedBy: row.archived_by } : {}),
    ...(row.archive_reason ? { archiveReason: row.archive_reason } : {}),
    updatedAt: row.updated_at,
  };
}

export function workflowDeleteTombstoneFromRow(
  row: WorkflowDeleteTombstoneRow,
): WorkflowDeleteTombstoneRecord {
  return {
    workflowId: row.workflow_id,
    source: "ui",
    deleted: true,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}),
    ...(row.deleted_by ? { deletedBy: row.deleted_by } : {}),
    lastKnownTitle: row.last_known_title,
    ...(row.last_known_version
      ? { lastKnownVersion: row.last_known_version }
      : {}),
    ...(row.last_definition_hash
      ? { lastDefinitionHash: row.last_definition_hash }
      : {}),
    createdAt: row.created_at,
  };
}

export function workflowPublishedVersionFromRow(
  row: WorkflowPublishedVersionRow,
): WorkflowPublishedVersionRecord {
  return {
    workflowId: row.workflow_id,
    version: row.version,
    source: "ui",
    status: "published",
    definitionHash: row.definition_hash,
    definition: parseJson<WorkflowDefinition>(row.definition_json),
    ...(row.published_from_draft_id
      ? { publishedFromDraftId: row.published_from_draft_id }
      : {}),
    ...(row.published_by ? { publishedBy: row.published_by } : {}),
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

export function workflowRunFromRow(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    ...(row.workflow_definition_hash
      ? { workflowDefinitionHash: row.workflow_definition_hash }
      : {}),
    ...(row.definition_snapshot_id
      ? { definitionSnapshotId: row.definition_snapshot_id }
      : {}),
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    ...(row.parent_node_attempt_id
      ? { parentNodeAttemptId: row.parent_node_attempt_id }
      : {}),
    ...(row.pibo_session_id ? { piboSessionId: row.pibo_session_id } : {}),
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.environment_json
      ? {
          environment: parseJson<WorkflowExecutionEnvironment>(
            row.environment_json,
          ),
        }
      : {}),
    status: row.status,
    current: parseJson(row.current_json),
    input: parseJson(row.input_json) as WorkflowValue,
    ...(row.output_present
      ? { output: parseJson(row.output_json ?? "null") as WorkflowValue }
      : {}),
    state: parseJson(row.state_json),
    ...(row.checkpoint_json
      ? { checkpoint: parseJson(row.checkpoint_json) }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.failed_at ? { failedAt: row.failed_at } : {}),
    ...(row.cancelled_at ? { cancelledAt: row.cancelled_at } : {}),
  };
}

export function workflowEventFromRow(
  row: WorkflowEventRow,
): WorkflowEventRecord {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    type: row.type,
    ...(row.node_id ? { nodeId: row.node_id } : {}),
    ...(row.edge_id ? { edgeId: row.edge_id } : {}),
    ...(row.attempt_id ? { attemptId: row.attempt_id } : {}),
    ...(row.payload_json ? { payload: parseJson(row.payload_json) } : {}),
    createdAt: row.created_at,
  };
}

export function workflowWaitTokenFromRow(
  row: WorkflowWaitTokenRow,
): WorkflowWaitToken {
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
    ...(row.resume_payload_present
      ? {
          resumePayload: parseJson(
            row.resume_payload_json ?? "null",
          ) as WorkflowValue,
        }
      : {}),
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...((row.resolved_at ?? row.resumed_at)
      ? { resumedAt: (row.resolved_at ?? row.resumed_at) as string }
      : {}),
  };
}

export function workflowNodeAttemptFromRow(
  row: WorkflowNodeAttemptRow,
): NodeAttempt {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    nodeId: row.node_id,
    attempt: row.attempt_number ?? row.attempt ?? 0,
    kind: row.kind,
    status: row.status,
    ...(row.environment_json
      ? {
          environment: parseJson<WorkflowExecutionEnvironment>(
            row.environment_json,
          ),
        }
      : {}),
    input: parseJson(row.input_json) as WorkflowValue,
    ...(row.output_present
      ? { output: parseJson(row.output_json ?? "null") as WorkflowValue }
      : {}),
    ...(row.local_state_json
      ? { localState: parseJson(row.local_state_json) }
      : {}),
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

export function workflowEdgeTransferFromRow(
  row: WorkflowEdgeTransferRow,
): EdgeTransfer {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    edgeId: row.edge_id,
    sourceNodeAttemptId: row.source_node_attempt_id,
    targetNodeId: row.target_node_id,
    status: row.status,
    payload: parseJson(row.payload_json) as WorkflowValue,
    ...(row.adapter_attempt_id
      ? { adapterAttemptId: row.adapter_attempt_id }
      : {}),
    createdAt: row.created_at,
  };
}

export function workflowCheckpointFromRow(
  row: WorkflowCheckpointRow,
): WorkflowCheckpoint {
  const pending = parseJson<
    Partial<
      Pick<
        WorkflowCheckpoint,
        "pendingNodeIds" | "completedNodeIds" | "edgePayloadRefs"
      >
    >
  >(row.pending_json);
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    namespace: row.namespace,
    cursor: parseJson(row.cursor_json),
    globalState: parseJson(row.state_json),
    pendingNodeIds: pending.pendingNodeIds ?? [],
    completedNodeIds: pending.completedNodeIds ?? [],
    edgePayloadRefs: pending.edgePayloadRefs ?? [],
    createdAt: row.created_at,
  };
}

export function workflowWakeupFromRow(row: WorkflowWakeupRow): WorkflowWakeup {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    ...(row.node_attempt_id ? { nodeAttemptId: row.node_attempt_id } : {}),
    kind: row.kind,
    availableAt: row.available_at,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.payload_json
      ? { payload: parseJson(row.payload_json) as WorkflowValue }
      : {}),
    createdAt: row.created_at,
  };
}

export function workflowHumanActionFromRow(
  row: WorkflowHumanActionRow,
): WorkflowHumanActionRecord {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    waitTokenId: row.wait_token_id,
    kind: row.kind,
    ...(row.actor_json ? { actor: parseJson(row.actor_json) } : {}),
    ...(row.payload_json
      ? { payload: parseJson(row.payload_json) as WorkflowValue }
      : {}),
    createdAt: row.created_at,
  };
}

function parseJson<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}
