import type {
  EdgeTransfer,
  NodeAttempt,
  NodeAttemptId,
  WorkflowCheckpoint,
  WorkflowErrorSummary,
  WorkflowEventRecord,
  WorkflowHumanActionRecord,
  WorkflowRun,
  WorkflowRunId,
  WorkflowWaitToken,
  WorkflowWakeup,
} from "../types/index.js";
import type {
  WorkflowCheckpointStore,
  WorkflowEdgeTransferStore,
  WorkflowEventStore,
  WorkflowHumanActionStore,
  WorkflowNodeAttemptStore,
  WorkflowRunStore,
  WorkflowWaitTokenStore,
  WorkflowWakeupStore,
} from "../store/index.js";

export type WorkflowRunInspectionStore = WorkflowRunStore
  & Partial<WorkflowEventStore>
  & Partial<WorkflowNodeAttemptStore>
  & Partial<WorkflowEdgeTransferStore>
  & Partial<WorkflowCheckpointStore>
  & Partial<WorkflowWakeupStore>
  & Partial<WorkflowWaitTokenStore>
  & Partial<WorkflowHumanActionStore>;

export type WorkflowRunInspectionOptions = {
  limit?: number;
};

export type WorkflowRunInspectionSummary = {
  runId: WorkflowRunId;
  workflowId: string;
  workflowVersion: string;
  status: WorkflowRun["status"];
  ownerScope: string;
  piboSessionId?: string;
  projectId?: string;
  currentNodeId?: string;
  currentEdgeId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  failedAt?: string;
  cancelledAt?: string;
  nodeAttempts: number;
  completedNodeAttempts: number;
  failedNodeAttempts: number;
  waitingNodeAttempts: number;
  pendingWaitTokens: number;
  edgeTransfers: number;
  events: number;
  latestCheckpointId?: string;
  failedNodeId?: string;
  failedNodeAttemptId?: NodeAttemptId;
  error?: WorkflowErrorSummary;
};

export type WorkflowRunInspection = {
  kind: "workflowRunInspection";
  schemaVersion: 1;
  summary: WorkflowRunInspectionSummary;
  run: WorkflowRun;
  nodeAttempts: NodeAttempt[];
  edgeTransfers: EdgeTransfer[];
  checkpoints: WorkflowCheckpoint[];
  wakeups: WorkflowWakeup[];
  waitTokens: WorkflowWaitToken[];
  humanActions: WorkflowHumanActionRecord[];
  events: WorkflowEventRecord[];
};

export async function inspectWorkflowRun(
  store: WorkflowRunInspectionStore,
  runId: WorkflowRunId,
  options: WorkflowRunInspectionOptions = {},
): Promise<WorkflowRunInspection | undefined> {
  const run = await store.getRun(runId);
  if (!run) return undefined;

  const limit = normalizeInspectionLimit(options.limit);
  const nodeAttempts = sortNodeAttempts(await listOptional(store, store.listNodeAttempts, { workflowRunId: run.id, limit }));
  const edgeTransfers = await listOptional(store, store.listEdgeTransfers, { workflowRunId: run.id, limit });
  const checkpoints = await listOptional(store, store.listCheckpoints, { workflowRunId: run.id, limit });
  const wakeups = await listOptional(store, store.listWakeups, { workflowRunId: run.id, limit });
  const waitTokens = await listOptional(store, store.listWaitTokens, { workflowRunId: run.id, limit });
  const humanActions = await listOptional(store, store.listHumanActions, { workflowRunId: run.id, limit });
  const events = await listOptional(store, store.listEvents, { workflowRunId: run.id, limit });

  return {
    kind: "workflowRunInspection",
    schemaVersion: 1,
    summary: createInspectionSummary(run, {
      nodeAttempts,
      edgeTransfers,
      checkpoints,
      waitTokens,
      events,
    }),
    run,
    nodeAttempts,
    edgeTransfers,
    checkpoints,
    wakeups,
    waitTokens,
    humanActions,
    events,
  };
}

export function formatWorkflowRunInspection(inspection: WorkflowRunInspection): string {
  const { summary } = inspection;
  const lines = [
    `run\t${summary.runId}`,
    `workflow\t${summary.workflowId}@${summary.workflowVersion}`,
    `status\t${summary.status}`,
    `owner\t${summary.ownerScope}`,
  ];
  if (summary.piboSessionId) lines.push(`pibo_session\t${summary.piboSessionId}`);
  if (summary.projectId) lines.push(`project\t${summary.projectId}`);
  if (summary.currentNodeId) lines.push(`current_node\t${summary.currentNodeId}`);
  if (summary.currentEdgeId) lines.push(`current_edge\t${summary.currentEdgeId}`);
  if (summary.latestCheckpointId) lines.push(`checkpoint\t${summary.latestCheckpointId}`);
  if (summary.failedNodeId) lines.push(`failed_node\t${summary.failedNodeId}`);
  if (summary.failedNodeAttemptId) lines.push(`failed_attempt\t${summary.failedNodeAttemptId}`);
  if (summary.error) lines.push(`error\t${summary.error.code}\t${summary.error.message}`);
  lines.push(
    `attempts\t${summary.nodeAttempts}\tcompleted=${summary.completedNodeAttempts}\tfailed=${summary.failedNodeAttempts}\twaiting=${summary.waitingNodeAttempts}`,
    `wait_tokens\t${summary.pendingWaitTokens} pending`,
    `edge_transfers\t${summary.edgeTransfers}`,
    `events\t${summary.events}`,
    `updated\t${summary.updatedAt}`,
  );
  return lines.join("\n");
}

function createInspectionSummary(
  run: WorkflowRun,
  facts: {
    nodeAttempts: NodeAttempt[];
    edgeTransfers: EdgeTransfer[];
    checkpoints: WorkflowCheckpoint[];
    waitTokens: WorkflowWaitToken[];
    events: WorkflowEventRecord[];
  },
): WorkflowRunInspectionSummary {
  const failedAttempt = latestNodeAttempt(facts.nodeAttempts.filter((attempt) => attempt.status === "failed"));
  const latestCheckpoint = latestCheckpointByCreatedAt(facts.checkpoints);
  const failedEventError = latestWorkflowFailedEventError(facts.events);
  return {
    runId: run.id,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    status: run.status,
    ownerScope: run.ownerScope,
    ...(run.piboSessionId ? { piboSessionId: run.piboSessionId } : {}),
    ...(run.projectId ? { projectId: run.projectId } : {}),
    ...(run.current.nodeId ? { currentNodeId: run.current.nodeId } : {}),
    ...(run.current.edgeId ? { currentEdgeId: run.current.edgeId } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.failedAt ? { failedAt: run.failedAt } : {}),
    ...(run.cancelledAt ? { cancelledAt: run.cancelledAt } : {}),
    nodeAttempts: facts.nodeAttempts.length,
    completedNodeAttempts: facts.nodeAttempts.filter((attempt) => attempt.status === "completed").length,
    failedNodeAttempts: facts.nodeAttempts.filter((attempt) => attempt.status === "failed").length,
    waitingNodeAttempts: facts.nodeAttempts.filter((attempt) => attempt.status === "waiting").length,
    pendingWaitTokens: facts.waitTokens.filter((token) => token.status === "pending").length,
    edgeTransfers: facts.edgeTransfers.length,
    events: facts.events.length,
    ...(latestCheckpoint ? { latestCheckpointId: latestCheckpoint.id } : {}),
    ...(failedAttempt ? { failedNodeId: failedAttempt.nodeId, failedNodeAttemptId: failedAttempt.id } : {}),
    ...(failedAttempt?.error ?? failedEventError ? { error: failedAttempt?.error ?? failedEventError } : {}),
  };
}

async function listOptional<TStore, TItem, TFilter>(
  store: TStore,
  list: ((filter: TFilter) => TItem[] | Promise<TItem[]>) | undefined,
  filter: TFilter,
): Promise<TItem[]> {
  if (!list) return [];
  return list.call(store, filter);
}

function normalizeInspectionLimit(limit: number | undefined): number {
  if (limit === undefined) return 1000;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Workflow inspection limit must be a positive integer");
  return Math.min(limit, 1000);
}

function sortNodeAttempts(attempts: NodeAttempt[]): NodeAttempt[] {
  return [...attempts].sort((left, right) => compareNullableStrings(attemptSortKey(left), attemptSortKey(right)) || left.id.localeCompare(right.id));
}

function latestNodeAttempt(attempts: NodeAttempt[]): NodeAttempt | undefined {
  return [...attempts].sort((left, right) => compareNullableStrings(attemptSortKey(right), attemptSortKey(left)) || right.id.localeCompare(left.id))[0];
}

function latestCheckpointByCreatedAt(checkpoints: WorkflowCheckpoint[]): WorkflowCheckpoint | undefined {
  return [...checkpoints].sort((left, right) => compareNullableStrings(right.createdAt, left.createdAt) || right.id.localeCompare(left.id))[0];
}

function attemptSortKey(attempt: NodeAttempt): string | undefined {
  return attempt.startedAt ?? attempt.availableAt ?? attempt.completedAt ?? attempt.failedAt;
}

function compareNullableStrings(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left.localeCompare(right);
}

function latestWorkflowFailedEventError(events: WorkflowEventRecord[]): WorkflowErrorSummary | undefined {
  const failedEvent = [...events]
    .filter((event) => event.type === "workflow.failed")
    .sort((left, right) => compareNullableStrings(right.createdAt, left.createdAt) || right.id.localeCompare(left.id))[0];
  const payload = failedEvent?.payload;
  if (!payload || typeof payload !== "object" || !("error" in payload)) return undefined;
  const error = payload.error;
  if (!error || typeof error !== "object" || !("code" in error) || !("message" in error)) return undefined;
  return error as WorkflowErrorSummary;
}
