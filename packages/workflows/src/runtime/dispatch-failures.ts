import type { WorkflowRunStore } from "../store/index.js";
import type {
  NodeAttempt,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRun,
  WorkflowRuntimeEvent,
} from "../types/index.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";

type DispatchFailureOptions = {
  run: WorkflowRun;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

type FailedNodeDispatchOptions = DispatchFailureOptions & {
  nodeAttempt: NodeAttempt;
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
};

type DispatchFailure = DispatchFailureOptions & {
  ok: false;
};

type FailedNodeDispatch = DispatchFailureOptions & {
  nodeAttempt: NodeAttempt;
};

type FailedNodeDispatchFailure = DispatchFailure & {
  nodeAttempt: NodeAttempt;
};

export function agentNodeDispatchFailure(options: DispatchFailureOptions): DispatchFailure {
  return dispatchFailure(options);
}

export async function failAgentNodeDispatch(options: FailedNodeDispatchOptions): Promise<FailedNodeDispatchFailure> {
  return failedNodeDispatchFailure(await failNodeDispatch(options));
}

export function codeNodeDispatchFailure(options: DispatchFailureOptions): DispatchFailure {
  return dispatchFailure(options);
}

export async function failCodeNodeDispatch(options: FailedNodeDispatchOptions): Promise<FailedNodeDispatchFailure> {
  return failedNodeDispatchFailure(await failNodeDispatch(options));
}

export function nestedWorkflowNodeDispatchFailure(options: DispatchFailureOptions): DispatchFailure {
  return dispatchFailure(options);
}

export async function failNestedWorkflowNodeDispatch(
  options: FailedNodeDispatchOptions & { childRun?: WorkflowRun },
): Promise<FailedNodeDispatchFailure & { childRun?: WorkflowRun }> {
  const failure = failedNodeDispatchFailure(await failNodeDispatch(options));
  return {
    ...failure,
    ...(options.childRun ? { childRun: options.childRun } : {}),
  };
}

export function humanNodeDispatchFailure(options: DispatchFailureOptions): DispatchFailure {
  return dispatchFailure(options);
}

export async function failHumanNodeDispatch(options: FailedNodeDispatchOptions): Promise<FailedNodeDispatchFailure> {
  return failedNodeDispatchFailure(await failNodeDispatch(options));
}

export function adapterNodeDispatchFailure(options: DispatchFailureOptions): DispatchFailure {
  return dispatchFailure(options);
}

export async function failAdapterNodeDispatch(options: FailedNodeDispatchOptions): Promise<FailedNodeDispatchFailure> {
  return failedNodeDispatchFailure(await failNodeDispatch(options));
}

async function failNodeDispatch(options: FailedNodeDispatchOptions): Promise<FailedNodeDispatch> {
  const failedAt = options.timestamp();
  options.nodeAttempt.status = "failed";
  options.nodeAttempt.error = options.error;
  options.nodeAttempt.failedAt = failedAt;
  options.run.status = "failed";
  options.run.current = { nodeId: options.nodeAttempt.nodeId, status: "failed" };
  options.run.failedAt = failedAt;
  options.run.updatedAt = failedAt;
  await emitWorkflowRuntimeEvent(options.events, options.store, options.emitEvent, {
    type: "node.failed",
    runId: options.run.id,
    nodeAttemptId: options.nodeAttempt.id,
    error: options.error,
  });
  await persistWorkflowNodeAttempt(options.store, options.nodeAttempt);
  await persistWorkflowRun(options.store, options.run);

  return {
    run: options.run,
    nodeAttempt: options.nodeAttempt,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

function dispatchFailure(options: DispatchFailureOptions): DispatchFailure {
  return {
    ok: false,
    run: options.run,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

function failedNodeDispatchFailure(failure: FailedNodeDispatch): FailedNodeDispatchFailure {
  return {
    ok: false,
    run: failure.run,
    nodeAttempt: failure.nodeAttempt,
    events: failure.events,
    diagnostics: failure.diagnostics,
    error: failure.error,
  };
}
