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
  WorkflowHumanActionId,
  WorkflowHumanActionKind,
  WorkflowHumanActionRecord,
  WorkflowIdentityRecord,
  WorkflowPublishedVersionRecord,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRunStatus,
  WorkflowWakeup,
  WorkflowWakeupId,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
  WorkflowWaitTokenStatus,
} from "../types/index.js";

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
