import type {
  EdgeTransfer,
  NodeAttempt,
  WorkflowEventEmitter,
  WorkflowEventRecord,
  WorkflowRun,
  WorkflowRuntimeEvent,
} from "../types/index.js";
import type {
  WorkflowEdgeTransferStore,
  WorkflowEventStore,
  WorkflowNodeAttemptStore,
  WorkflowRunStore,
  WorkflowWakeupStore,
} from "../store/index.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";

export async function emitWorkflowRuntimeEvent(
  events: WorkflowRuntimeEvent[],
  store: WorkflowRunStore | undefined,
  emitEvent: WorkflowEventEmitter | undefined,
  event: WorkflowRuntimeEvent,
): Promise<void> {
  events.push(event);
  await persistWorkflowEvent(store, event);
  await emitEvent?.(event);
}

export async function persistWorkflowRun(store: WorkflowRunStore | undefined, run: WorkflowRun): Promise<void> {
  await store?.saveRun(run);
}

export async function persistWorkflowNodeAttempt(
  store: WorkflowRunStore | undefined,
  nodeAttempt: NodeAttempt,
): Promise<void> {
  if (!hasWorkflowNodeAttemptStore(store)) {
    return;
  }

  await store.saveNodeAttempt(nodeAttempt);
}

export async function persistWorkflowEdgeTransfer(
  store: WorkflowRunStore | undefined,
  transfer: EdgeTransfer,
): Promise<void> {
  if (!hasWorkflowEdgeTransferStore(store)) {
    return;
  }

  await store.saveEdgeTransfer(transfer);
}

async function persistWorkflowEvent(
  store: WorkflowRunStore | undefined,
  event: WorkflowRuntimeEvent,
): Promise<void> {
  if (!hasWorkflowEventStore(store)) {
    return;
  }

  await store.saveEvent(createWorkflowEventRecord(event));
}

function hasWorkflowNodeAttemptStore(
  store: WorkflowRunStore | undefined,
): store is WorkflowRunStore & Pick<WorkflowNodeAttemptStore, "saveNodeAttempt"> {
  return typeof (store as { saveNodeAttempt?: unknown } | undefined)?.saveNodeAttempt === "function";
}

function hasWorkflowEdgeTransferStore(
  store: WorkflowRunStore | undefined,
): store is WorkflowRunStore & Pick<WorkflowEdgeTransferStore, "saveEdgeTransfer"> {
  return typeof (store as { saveEdgeTransfer?: unknown } | undefined)?.saveEdgeTransfer === "function";
}

function hasWorkflowEventStore(
  store: WorkflowRunStore | undefined,
): store is WorkflowRunStore & Pick<WorkflowEventStore, "saveEvent"> {
  return typeof (store as { saveEvent?: unknown } | undefined)?.saveEvent === "function";
}

export function hasWorkflowWakeupStore(
  store: WorkflowRunStore | undefined,
): store is WorkflowRunStore & Pick<WorkflowWakeupStore, "saveWakeup"> {
  return typeof (store as { saveWakeup?: unknown } | undefined)?.saveWakeup === "function";
}

export function hasWorkflowNodeAttemptReadStore(
  store: WorkflowRunStore | undefined,
): store is WorkflowRunStore & Pick<WorkflowNodeAttemptStore, "getNodeAttempt" | "saveNodeAttempt"> {
  return typeof (store as { getNodeAttempt?: unknown } | undefined)?.getNodeAttempt === "function" &&
    typeof (store as { saveNodeAttempt?: unknown } | undefined)?.saveNodeAttempt === "function";
}

function createWorkflowEventRecord(event: WorkflowRuntimeEvent): WorkflowEventRecord {
  return {
    id: createId("wev"),
    workflowRunId: event.runId,
    type: event.type,
    ...workflowEventForeignKeys(event),
    payload: event,
    createdAt: new Date().toISOString(),
  };
}

function workflowEventForeignKeys(event: WorkflowRuntimeEvent): Pick<WorkflowEventRecord, "nodeId" | "edgeId" | "attemptId"> {
  const keys: Pick<WorkflowEventRecord, "nodeId" | "edgeId" | "attemptId"> = {};
  if ("nodeId" in event) {
    keys.nodeId = event.nodeId;
  }
  if ("edgeId" in event) {
    keys.edgeId = event.edgeId;
  }
  if ("nodeAttemptId" in event) {
    keys.attemptId = event.nodeAttemptId;
  }
  return keys;
}
