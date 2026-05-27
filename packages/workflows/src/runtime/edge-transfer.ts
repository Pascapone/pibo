import type {
  EdgeTransfer,
  EdgeTransferId,
  NodeAttempt,
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
import {
  validateNodeOutput,
  validateWorkflowEdgeAdapterOutput,
  validateWorkflowPortValue,
} from "../validation/index.js";
import { createWorkflowRunWithoutLocalState } from "./state.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowEdgeTransfer,
  persistWorkflowRun,
} from "./persistence.js";
import { createTimestampFactory } from "./time.js";

export type WorkflowEdgeTransferOptions = {
  now?: () => Date | string;
  createEdgeTransferId?: () => EdgeTransferId;
};

export type WorkflowEdgeAdapterTransferOptions = WorkflowEdgeTransferOptions & {
  registry: Pick<WorkflowRegistry, "adapters">;
};

export type RecordedWorkflowEdgeTransferOptions =
  WorkflowEdgeTransferOptions & {
    events?: WorkflowRuntimeEvent[];
    emitEvent?: WorkflowEventEmitter;
    store?: WorkflowRunStore;
  };

export type WorkflowEdgeTransferSuccess = {
  ok: true;
  transfer: EdgeTransfer;
  targetInput: WorkflowValue;
  diagnostics: WorkflowDiagnostic[];
};

export type WorkflowEdgeTransferFailure = {
  ok: false;
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowEdgeTransferResult =
  | WorkflowEdgeTransferSuccess
  | WorkflowEdgeTransferFailure;

export type RecordedWorkflowEdgeTransferSuccess =
  WorkflowEdgeTransferSuccess & {
    run: WorkflowRun;
    events: WorkflowRuntimeEvent[];
  };

export type RecordedWorkflowEdgeTransferFailure =
  WorkflowEdgeTransferFailure & {
    run: WorkflowRun;
    events: WorkflowRuntimeEvent[];
  };

export type RecordedWorkflowEdgeTransferResult =
  | RecordedWorkflowEdgeTransferSuccess
  | RecordedWorkflowEdgeTransferFailure;

export function transferWorkflowEdgeData(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  edgeId: string,
  sourceNodeAttempt: NodeAttempt,
  options: WorkflowEdgeTransferOptions = {},
): WorkflowEdgeTransferResult {
  const timestamp = createTimestampFactory(options.now);
  const edge = definition.edges[edgeId];
  if (!edge) {
    return edgeTransferFailure(
      [
        {
          code: "WorkflowRuntimeError.unknownEdge",
          message: `Workflow edge '${edgeId}' does not exist, so no payload can be transferred.`,
          severity: "error",
          edgeId,
          path: `$.edges.${edgeId}`,
          hint: "Evaluate and transfer only edges declared in the workflow definition.",
        },
      ],
      {
        code: "WorkflowRuntimeError.unknownEdge",
        message:
          "Workflow edge data transfer failed because the edge is not declared.",
      },
    );
  }

  const diagnostics: WorkflowDiagnostic[] = [];
  const sourceNode = definition.nodes[edge.from.nodeId];
  const targetNode = definition.nodes[edge.to.nodeId];

  if (!sourceNode) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownSourceNode",
      message: `Workflow edge '${edgeId}' references missing source node '${edge.from.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.from.nodeId,
      path: `$.edges.${edgeId}.from.nodeId`,
    });
  }

  if (!targetNode) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownTargetNode",
      message: `Workflow edge '${edgeId}' references missing target node '${edge.to.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.to.nodeId,
      path: `$.edges.${edgeId}.to.nodeId`,
    });
  }

  if ((edge.kind ?? "data") !== "data") {
    diagnostics.push({
      code: "WorkflowRuntimeError.nonDataEdgeTransferUnsupported",
      message: `Workflow edge '${edgeId}' is not a data edge and cannot transfer a direct payload.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.kind`,
      hint: "Use data edges for payload transfer; control, error, and resume routing are handled by later runtime paths.",
    });
  }

  if (edge.adapter) {
    diagnostics.push({
      code: "WorkflowRuntimeError.edgeAdapterTransferUnsupported",
      message: `Workflow edge '${edgeId}' uses an edge adapter, which is not available in direct edge data transfer yet.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.adapter`,
      hint: "Use direct compatible ports until registered adapter resolution is implemented.",
    });
  }

  if (sourceNodeAttempt.workflowRunId !== run.id) {
    diagnostics.push({
      code: "WorkflowRuntimeError.sourceAttemptRunMismatch",
      message: `Source node attempt '${sourceNodeAttempt.id}' belongs to a different workflow run.`,
      severity: "error",
      edgeId,
      nodeId: sourceNodeAttempt.nodeId,
      path: "$.sourceNodeAttempt.workflowRunId",
      hint: "Transfer edge payloads only from attempts created for the same workflow run.",
    });
  }

  if (sourceNodeAttempt.nodeId !== edge.from.nodeId) {
    diagnostics.push({
      code: "WorkflowRuntimeError.sourceAttemptNodeMismatch",
      message: `Source node attempt '${sourceNodeAttempt.id}' does not match edge source node '${edge.from.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: sourceNodeAttempt.nodeId,
      path: "$.sourceNodeAttempt.nodeId",
      hint: "Use the completed attempt for the edge source node when transferring data.",
    });
  }

  if (sourceNodeAttempt.status !== "completed") {
    diagnostics.push({
      code: "WorkflowRuntimeError.sourceAttemptIncomplete",
      message: `Source node attempt '${sourceNodeAttempt.id}' must be completed before edge data can transfer.`,
      severity: "error",
      edgeId,
      nodeId: sourceNodeAttempt.nodeId,
      path: "$.sourceNodeAttempt.status",
      hint: "Transfer edge payloads only after a source node attempt completes successfully.",
    });
  }

  if (!Object.hasOwn(sourceNodeAttempt, "output")) {
    diagnostics.push({
      code: "WorkflowRuntimeError.sourceOutputMissing",
      message: `Source node attempt '${sourceNodeAttempt.id}' has no output to transfer.`,
      severity: "error",
      edgeId,
      nodeId: sourceNodeAttempt.nodeId,
      path: "$.sourceNodeAttempt.output",
      hint: "Persist or pass the source node output before evaluating outgoing data edges.",
    });
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return edgeTransferFailure(diagnostics, {
      code: "WorkflowRuntimeError.edgeTransferFailed",
      message: "Workflow edge data transfer failed before payload validation.",
    });
  }

  const payload = sourceNodeAttempt.output as WorkflowValue;
  const sourceOutputResult = validateNodeOutput(
    definition,
    edge.from.nodeId,
    payload,
    {
      path: `$.edges.${edgeId}.payload`,
    },
  );
  diagnostics.push(
    ...sourceOutputResult.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      edgeId,
    })),
  );

  if (targetNode?.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(targetNode.input, payload, {
        path: `$.edges.${edgeId}.targetInput`,
      }).diagnostics.map((diagnostic) => ({
        ...diagnostic,
        edgeId,
        nodeId: edge.to.nodeId,
      })),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return edgeTransferFailure(diagnostics, {
      code: "WorkflowRuntimeError.invalidEdgePayload",
      message:
        "Workflow edge payload failed source output or target input validation.",
    });
  }

  const transfer: EdgeTransfer = {
    id: options.createEdgeTransferId?.() ?? createId("wet"),
    workflowRunId: run.id,
    edgeId,
    sourceNodeAttemptId: sourceNodeAttempt.id,
    targetNodeId: edge.to.nodeId,
    status: "transferred",
    payload,
    createdAt: timestamp(),
  };

  return { ok: true, transfer, targetInput: payload, diagnostics };
}

export async function transferWorkflowEdgeAdapterData(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  edgeId: string,
  sourceNodeAttempt: NodeAttempt,
  options: WorkflowEdgeAdapterTransferOptions,
): Promise<WorkflowEdgeTransferResult> {
  const timestamp = createTimestampFactory(options.now);
  const edge = definition.edges[edgeId];
  if (!edge) {
    return edgeTransferFailure(
      [
        {
          code: "WorkflowRuntimeError.unknownEdge",
          message: `Workflow edge '${edgeId}' does not exist, so no adapted payload can be transferred.`,
          severity: "error",
          edgeId,
          path: `$.edges.${edgeId}`,
          hint: "Evaluate and transfer only edges declared in the workflow definition.",
        },
      ],
      {
        code: "WorkflowRuntimeError.unknownEdge",
        message:
          "Workflow edge adapter transfer failed because the edge is not declared.",
      },
    );
  }

  const diagnostics: WorkflowDiagnostic[] = [];
  const sourceNode = definition.nodes[edge.from.nodeId];
  const targetNode = definition.nodes[edge.to.nodeId];

  if (!sourceNode) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownSourceNode",
      message: `Workflow edge '${edgeId}' references missing source node '${edge.from.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.from.nodeId,
      path: `$.edges.${edgeId}.from.nodeId`,
    });
  }

  if (!targetNode) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownTargetNode",
      message: `Workflow edge '${edgeId}' references missing target node '${edge.to.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.to.nodeId,
      path: `$.edges.${edgeId}.to.nodeId`,
    });
  }

  if ((edge.kind ?? "data") !== "data") {
    diagnostics.push({
      code: "WorkflowRuntimeError.nonDataEdgeTransferUnsupported",
      message: `Workflow edge '${edgeId}' is not a data edge and cannot transfer an adapted payload.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.kind`,
      hint: "Use data edges for adapter payload transfer; control, error, and resume routing are handled by later runtime paths.",
    });
  }

  if (!edge.adapter) {
    diagnostics.push({
      code: "WorkflowRuntimeError.edgeAdapterRequired",
      message: `Workflow edge '${edgeId}' does not declare an edge adapter for adapted transfer.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.adapter`,
      hint: "Use transferWorkflowEdgeData for direct compatible edges, or declare edgeAdapter(adapterRef(...), outputPort).",
    });
  }

  if (sourceNodeAttempt.workflowRunId !== run.id) {
    diagnostics.push({
      code: "WorkflowRuntimeError.sourceAttemptRunMismatch",
      message: `Source node attempt '${sourceNodeAttempt.id}' belongs to a different workflow run.`,
      severity: "error",
      edgeId,
      nodeId: sourceNodeAttempt.nodeId,
      path: "$.sourceNodeAttempt.workflowRunId",
      hint: "Transfer edge payloads only from attempts created for the same workflow run.",
    });
  }

  if (sourceNodeAttempt.nodeId !== edge.from.nodeId) {
    diagnostics.push({
      code: "WorkflowRuntimeError.sourceAttemptNodeMismatch",
      message: `Source node attempt '${sourceNodeAttempt.id}' does not match edge source node '${edge.from.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: sourceNodeAttempt.nodeId,
      path: "$.sourceNodeAttempt.nodeId",
      hint: "Use the completed attempt for the edge source node when transferring data.",
    });
  }

  if (sourceNodeAttempt.status !== "completed") {
    diagnostics.push({
      code: "WorkflowRuntimeError.sourceAttemptIncomplete",
      message: `Source node attempt '${sourceNodeAttempt.id}' must be completed before edge adapter data can transfer.`,
      severity: "error",
      edgeId,
      nodeId: sourceNodeAttempt.nodeId,
      path: "$.sourceNodeAttempt.status",
      hint: "Transfer edge payloads only after a source node attempt completes successfully.",
    });
  }

  if (!Object.hasOwn(sourceNodeAttempt, "output")) {
    diagnostics.push({
      code: "WorkflowRuntimeError.sourceOutputMissing",
      message: `Source node attempt '${sourceNodeAttempt.id}' has no output to adapt.`,
      severity: "error",
      edgeId,
      nodeId: sourceNodeAttempt.nodeId,
      path: "$.sourceNodeAttempt.output",
      hint: "Persist or pass the source node output before evaluating outgoing adapter edges.",
    });
  }

  const adapter = edge.adapter
    ? resolveWorkflowAdapter(options.registry, edge.adapter.transform)
    : undefined;
  if (edge.adapter && !adapter) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownAdapterRef",
      message: `Workflow edge '${edgeId}' references adapter '${edge.adapter.transform.id}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.adapter.transform.id`,
      hint: "Register the adapter before executing adapted edge transfers.",
    });
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return edgeTransferFailure(diagnostics, {
      code: "WorkflowRuntimeError.edgeAdapterTransferFailed",
      message:
        "Workflow edge adapter transfer failed before adapter execution.",
    });
  }

  const payload = sourceNodeAttempt.output as WorkflowValue;
  const sourceOutputResult = validateNodeOutput(
    definition,
    edge.from.nodeId,
    payload,
    {
      path: `$.edges.${edgeId}.payload`,
    },
  );
  diagnostics.push(
    ...sourceOutputResult.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      edgeId,
    })),
  );

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return edgeTransferFailure(diagnostics, {
      code: "WorkflowRuntimeError.invalidEdgePayload",
      message: "Workflow edge adapter input failed source output validation.",
    });
  }

  let adaptedOutput: WorkflowValue;
  try {
    const adapterResult = await adapter!.value({
      input: payload,
      edge,
      run: createWorkflowRunWithoutLocalState(run),
    });
    adaptedOutput = adapterResult.output;
  } catch (caught) {
    return edgeTransferFailure(
      diagnostics,
      adapterErrorSummaryFromCaught(caught),
    );
  }

  const adapterOutputResult = validateWorkflowEdgeAdapterOutput(
    definition,
    edgeId,
    adaptedOutput,
  );
  diagnostics.push(...adapterOutputResult.diagnostics);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return edgeTransferFailure(diagnostics, {
      code: "WorkflowRuntimeError.invalidAdapterOutput",
      message:
        "Workflow edge adapter output failed validation before target node execution.",
    });
  }

  const transfer: EdgeTransfer = {
    id: options.createEdgeTransferId?.() ?? createId("wet"),
    workflowRunId: run.id,
    edgeId,
    sourceNodeAttemptId: sourceNodeAttempt.id,
    targetNodeId: edge.to.nodeId,
    status: "transferred",
    payload: adaptedOutput,
    createdAt: timestamp(),
  };

  return { ok: true, transfer, targetInput: adaptedOutput, diagnostics };
}

export async function recordWorkflowEdgeTransfer(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  edgeId: string,
  sourceNodeAttempt: NodeAttempt,
  options: RecordedWorkflowEdgeTransferOptions = {},
): Promise<RecordedWorkflowEdgeTransferResult> {
  const events = options.events ?? [];
  const result = transferWorkflowEdgeData(
    definition,
    run,
    edgeId,
    sourceNodeAttempt,
    options,
  );
  if (!result.ok) {
    return { ...result, run, events };
  }

  run.current = { edgeId, status: run.status };
  run.updatedAt = result.transfer.createdAt;
  await persistWorkflowEdgeTransfer(options.store, result.transfer);
  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "edge.transferred",
    runId: run.id,
    edgeTransferId: result.transfer.id,
    edgeId,
  });
  await persistWorkflowRun(options.store, run);

  return { ...result, run, events };
}

function edgeTransferFailure(
  diagnostics: WorkflowDiagnostic[],
  error: WorkflowErrorSummary,
): WorkflowEdgeTransferFailure {
  return { ok: false, diagnostics, error };
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
