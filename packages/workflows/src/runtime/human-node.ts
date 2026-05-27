import type {
  HumanNodeDefinition,
  NodeAttempt,
  NodeAttemptId,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRun,
  WorkflowRuntimeEvent,
  WorkflowValue,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
} from "../types/index.js";
import type {
  WorkflowRunStore,
  WorkflowWaitTokenStore,
} from "../store/index.js";
import { validateWorkflowPortValue } from "../validation/index.js";
import {
  failHumanNodeDispatch,
  humanNodeDispatchFailure,
} from "./dispatch-failures.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import { localStateSnapshotForNode } from "./state.js";
import { createTimestampFactory, resolveWaitTokenExpiry } from "./time.js";

export type WorkflowHumanNodeDispatchOptions = {
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  createWaitTokenId?: () => WorkflowWaitTokenId;
  store: WorkflowRunStore & WorkflowWaitTokenStore;
  emitEvent?: WorkflowEventEmitter;
};

export type WorkflowHumanNodeDispatchWaiting = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  waitToken: WorkflowWaitToken;
};

export type WorkflowHumanNodeDispatchFailure = {
  ok: false;
  run: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowHumanNodeDispatchResult = WorkflowHumanNodeDispatchWaiting | WorkflowHumanNodeDispatchFailure;

export async function dispatchWorkflowHumanNode(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  nodeId: string,
  input: WorkflowValue,
  options: WorkflowHumanNodeDispatchOptions,
): Promise<WorkflowHumanNodeDispatchResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const node = definition.nodes[nodeId];

  if (!node) {
    return humanNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.unknownNode",
          message: `Workflow node '${nodeId}' does not exist, so it cannot be dispatched as a human node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.unknownNode",
        message: "Human node dispatch failed because the node is not declared.",
      },
    });
  }

  if (node.kind !== "human") {
    return humanNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.humanNodeRequired",
          message: `Workflow node '${nodeId}' is '${node.kind}', but human node dispatch requires a human node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.kind`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.humanNodeRequired",
        message: "Human node dispatch failed because the selected node is not a human node.",
      },
    });
  }

  const humanNode = node as HumanNodeDefinition;
  const startedAt = timestamp();
  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "human",
    status: "running",
    input,
    startedAt,
    ...localStateSnapshotForNode(run, nodeId),
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "node.started",
    runId: run.id,
    nodeAttemptId: nodeAttempt.id,
    nodeId,
  });
  await persistWorkflowNodeAttempt(options.store, nodeAttempt);
  await persistWorkflowRun(options.store, run);

  const diagnostics: WorkflowDiagnostic[] = [];
  if (humanNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(humanNode.input, input, { path: `$.nodes.${nodeId}.input` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failHumanNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.humanNodeDispatchFailed",
        message: "Human node dispatch failed before durable wait creation.",
      },
    });
  }

  const waitCreatedAt = timestamp();
  const waitToken: WorkflowWaitToken = {
    id: options.createWaitTokenId?.() ?? createId("wwt"),
    workflowRunId: run.id,
    nodeAttemptId: nodeAttempt.id,
    humanNodeId: nodeId,
    actions: humanNode.actions ?? [],
    prompt: humanNode.prompt,
    ...(humanNode.schema ? { schema: humanNode.schema } : {}),
    status: "pending",
    createdAt: waitCreatedAt,
    ...resolveWaitTokenExpiry(humanNode.timeout, waitCreatedAt),
  };

  await options.store.saveWaitToken(waitToken);

  nodeAttempt.status = "waiting";
  Object.assign(nodeAttempt, localStateSnapshotForNode(run, nodeId));
  nodeAttempt.metadata = { waitTokenId: waitToken.id };
  run.status = "waiting";
  run.current = { nodeId, status: "waiting" };
  run.updatedAt = waitCreatedAt;

  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "wait.created",
    runId: run.id,
    waitTokenId: waitToken.id,
  });
  await persistWorkflowNodeAttempt(options.store, nodeAttempt);
  await persistWorkflowRun(options.store, run);

  return {
    ok: true,
    run,
    nodeAttempt,
    events,
    waitToken,
  };
}
