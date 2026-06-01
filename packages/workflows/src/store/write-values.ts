import { canonicalWorkflowDefinitionJson } from "../definition-hash.js";
import type {
  EdgeTransfer,
  NodeAttempt,
  WorkflowArchiveStateRecord,
  WorkflowCheckpoint,
  WorkflowDefinitionSnapshot,
  WorkflowDeleteTombstoneRecord,
  WorkflowDraftRecord,
  WorkflowEventRecord,
  WorkflowHumanActionRecord,
  WorkflowIdentityRecord,
  WorkflowPublishedVersionRecord,
  WorkflowRun,
  WorkflowWakeup,
  WorkflowWaitToken,
} from "../types/index.js";

type SqliteWriteValue = string | number | null;

export function workflowDefinitionSnapshotWriteValues(snapshot: WorkflowDefinitionSnapshot): SqliteWriteValue[] {
  return [
    snapshot.id,
    snapshot.workflowId,
    snapshot.workflowVersion,
    snapshot.hash,
    serialize(snapshot.definition),
    snapshot.createdAt,
  ];
}

export function workflowIdentityWriteValues(record: WorkflowIdentityRecord): SqliteWriteValue[] {
  return [
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
  ];
}

export function workflowDraftWriteValues(record: WorkflowDraftRecord): SqliteWriteValue[] {
  return [
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
  ];
}

export function workflowArchiveStateWriteValues(record: WorkflowArchiveStateRecord): SqliteWriteValue[] {
  return [
    record.workflowId,
    record.source,
    record.archived ? 1 : 0,
    record.archivedAt ?? null,
    record.archivedBy ?? null,
    record.archiveReason ?? null,
    record.updatedAt,
  ];
}

export function workflowDeleteTombstoneWriteValues(record: WorkflowDeleteTombstoneRecord): SqliteWriteValue[] {
  return [
    record.workflowId,
    record.source,
    1,
    record.deletedAt ?? null,
    record.deletedBy ?? null,
    record.lastKnownTitle,
    record.lastKnownVersion ?? null,
    record.lastDefinitionHash ?? null,
    record.createdAt,
  ];
}

export function workflowPublishedVersionWriteValues(record: WorkflowPublishedVersionRecord): SqliteWriteValue[] {
  return [
    record.workflowId,
    record.version,
    record.source,
    record.status,
    record.definitionHash,
    canonicalWorkflowDefinitionJson(record.definition),
    record.publishedFromDraftId ?? null,
    record.publishedBy ?? null,
    record.publishedAt,
    record.createdAt,
  ];
}

export function workflowRunWriteValues(run: WorkflowRun): SqliteWriteValue[] {
  return [
    run.id,
    run.workflowId,
    run.workflowVersion,
    run.workflowDefinitionHash ?? null,
    run.definitionSnapshotId ?? null,
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
  ];
}

export function workflowEventWriteValues(event: WorkflowEventRecord): SqliteWriteValue[] {
  return [
    event.id,
    event.workflowRunId,
    event.type,
    event.nodeId ?? null,
    event.edgeId ?? null,
    event.attemptId ?? null,
    serializeOptional(event.payload),
    event.createdAt,
  ];
}

export function workflowNodeAttemptWriteValues(nodeAttempt: NodeAttempt): SqliteWriteValue[] {
  return [
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
  ];
}

export function workflowEdgeTransferWriteValues(transfer: EdgeTransfer): SqliteWriteValue[] {
  return [
    transfer.id,
    transfer.workflowRunId,
    transfer.edgeId,
    transfer.sourceNodeAttemptId,
    transfer.targetNodeId,
    serialize(transfer.payload),
    transfer.adapterAttemptId ?? null,
    transfer.status,
    transfer.createdAt,
  ];
}

export function workflowCheckpointWriteValues(checkpoint: WorkflowCheckpoint): SqliteWriteValue[] {
  return [
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
  ];
}

export function workflowWakeupWriteValues(wakeup: WorkflowWakeup): SqliteWriteValue[] {
  return [
    wakeup.id,
    wakeup.workflowRunId,
    wakeup.nodeAttemptId ?? null,
    wakeup.kind,
    wakeup.availableAt,
    wakeup.correlationId ?? null,
    serializeOptional(wakeup.payload),
    wakeup.createdAt,
  ];
}

export function workflowWaitTokenWriteValues(token: WorkflowWaitToken): SqliteWriteValue[] {
  return [
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
  ];
}

export function workflowHumanActionWriteValues(action: WorkflowHumanActionRecord): SqliteWriteValue[] {
  return [
    action.id,
    action.workflowRunId,
    action.waitTokenId,
    action.kind,
    serializeOptional(action.actor),
    serializeOptional(action.payload),
    action.createdAt,
  ];
}

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function serializeOptional(value: unknown | undefined): string | null {
  return value === undefined ? null : serialize(value);
}
