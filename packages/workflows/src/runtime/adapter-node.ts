import type {
  AdapterNodeDefinition,
  AdapterResult,
  NodeAttempt,
  NodeAttemptId,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowRuntimeEvent,
  WorkflowValue,
} from "../types/index.js";
import type { WorkflowRunStore } from "../store/index.js";
import { resolveWorkflowAdapter } from "../registry/index.js";
import { validateNodeOutput, validateWorkflowPortValue } from "../validation/index.js";
import {
  adapterNodeDispatchFailure,
  failAdapterNodeDispatch,
} from "./dispatch-failures.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import { createNodeScopedWorkflowRun, localStateSnapshotForNode } from "./state.js";
import { createTimestampFactory } from "./time.js";

export type WorkflowAdapterNodeDispatchOptions = {
  registry: Pick<WorkflowRegistry, "adapters">;
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
};

export type WorkflowAdapterNodeDispatchSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
  result: AdapterResult;
};

export type WorkflowAdapterNodeDispatchFailure = {
  ok: false;
  run: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowAdapterNodeDispatchResult =
  | WorkflowAdapterNodeDispatchSuccess
  | WorkflowAdapterNodeDispatchFailure;

export async function dispatchWorkflowAdapterNode(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  nodeId: string,
  input: WorkflowValue,
  options: WorkflowAdapterNodeDispatchOptions,
): Promise<WorkflowAdapterNodeDispatchResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const node = definition.nodes[nodeId];

  if (!node) {
    return adapterNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.unknownNode",
          message: `Workflow node '${nodeId}' does not exist, so it cannot be dispatched as an adapter node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.unknownNode",
        message: "Adapter node dispatch failed because the node is not declared.",
      },
    });
  }

  if (node.kind !== "adapter") {
    return adapterNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.adapterNodeRequired",
          message: `Workflow node '${nodeId}' is '${node.kind}', but adapter node dispatch requires an adapter node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.kind`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.adapterNodeRequired",
        message: "Adapter node dispatch failed because the selected node is not an adapter node.",
      },
    });
  }

  const adapterNode = node as AdapterNodeDefinition;
  const startedAt = timestamp();
  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "adapter",
    status: "running",
    input,
    startedAt,
    ...localStateSnapshotForNode(run, nodeId),
    metadata: { adapterId: adapterNode.handler.id },
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

  const adapter = resolveWorkflowAdapter(options.registry, adapterNode.handler);
  const diagnostics: WorkflowDiagnostic[] = [];

  if (!adapter) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownAdapterRef",
      message: `Workflow adapter node '${nodeId}' references adapter '${adapterNode.handler.id}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.handler.id`,
      hint: "Register the adapter before dispatching the adapter node.",
    });
  }

  if (adapterNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(adapterNode.input, input, { path: `$.nodes.${nodeId}.input` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failAdapterNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.adapterNodeDispatchFailed",
        message: "Adapter node dispatch failed before adapter execution.",
      },
    });
  }

  try {
    const adapterResult = await adapter!.value({ input, run: createNodeScopedWorkflowRun(run, nodeId) });
    const nodeOutputResult = validateNodeOutput(definition, nodeId, adapterResult.output);
    if (!nodeOutputResult.ok) {
      return failAdapterNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message: "Adapter node output failed validation before downstream use.",
        },
      });
    }

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = adapterResult.output;
    nodeAttempt.completedAt = completedAt;
    Object.assign(nodeAttempt, localStateSnapshotForNode(run, nodeId));
    nodeAttempt.metadata = { adapterId: adapterNode.handler.id };
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: adapterResult.output,
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      nodeAttempt,
      events,
      output: adapterResult.output,
      result: adapterResult,
    };
  } catch (caught) {
    return failAdapterNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics: [],
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: adapterErrorSummaryFromCaught(caught),
    });
  }
}

function adapterErrorSummaryFromCaught(caught: unknown): WorkflowErrorSummary {
  if (caught instanceof Error) {
    return {
      code: "WorkflowRuntimeError.adapterFailed",
      message: caught.message,
    };
  }

  return {
    code: "WorkflowRuntimeError.adapterFailed",
    message: "Workflow adapter failed with a non-Error value.",
  };
}
