import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type {
  NodeAttempt,
  NodeAttemptId,
  NodeId,
  TriggerNodeDefinition,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRegistry,
  WorkflowRun,
  JsonValue,
  WorkflowRunId,
  WorkflowRuntimeEvent,
  WorkflowValue,
} from "../types/index.js";
import type { WorkflowRunStore } from "../store/index.js";
import { validateWorkflow, validateWorkflowInput, validateWorkflowPortValue } from "../validation/index.js";
import { dispatchWorkflowAgentNode } from "./agent-node.js";
import { recordWorkflowEdgeTransfer } from "./edge-transfer.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import type { AgentProfileResolver, OneNodeAgentExecutor } from "./pibo-routing.js";
import { createInitialWorkflowRunState } from "./state.js";
import { createTimestampFactory } from "./time.js";

export type WorkflowManualTriggerRunSource = {
  kind: "manual.editor" | "manual.api";
  triggerNodeId: NodeId;
  actorId?: string;
  draftId?: string;
};

export type WorkflowManualTriggerRunOptions = {
  source: WorkflowManualTriggerRunSource;
  registry?: Pick<WorkflowRegistry, "promptBuilders">;
  now?: () => Date | string;
  createRunId?: () => WorkflowRunId;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  profileResolver?: AgentProfileResolver;
  agentExecutor: OneNodeAgentExecutor;
  initialGlobalState?: Record<string, JsonValue>;
};

export type WorkflowManualTriggerRunSuccess = {
  ok: true;
  run: WorkflowRun;
  triggerAttempt: NodeAttempt;
  nodeAttempts: NodeAttempt[];
  edgeTransfers: Awaited<ReturnType<typeof recordWorkflowEdgeTransfer>>[];
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
};

export type WorkflowManualTriggerRunFailure = {
  ok: false;
  run?: WorkflowRun;
  triggerAttempt?: NodeAttempt;
  nodeAttempts: NodeAttempt[];
  edgeTransfers: Awaited<ReturnType<typeof recordWorkflowEdgeTransfer>>[];
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowManualTriggerRunResult =
  | WorkflowManualTriggerRunSuccess
  | WorkflowManualTriggerRunFailure;

type PendingNodeInput = {
  nodeId: NodeId;
  input: WorkflowValue;
  viaEdgeId: string;
};

type WorkflowManualTriggerGraphFailure = {
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

type WorkflowManualTriggerGraphState = {
  run: WorkflowRun;
  nodeAttempts: NodeAttempt[];
  edgeTransfers: Awaited<ReturnType<typeof recordWorkflowEdgeTransfer>>[];
  events: WorkflowRuntimeEvent[];
  pending: PendingNodeInput[];
  current?: PendingNodeInput;
  executedNodeIds: NodeId[];
  lastOutput: WorkflowValue;
  failure?: WorkflowManualTriggerGraphFailure;
};

const WorkflowManualTriggerState = Annotation.Root({
  execution: Annotation<WorkflowManualTriggerGraphState>(),
});

export async function runManualTextTriggerWorkflow(
  definition: WorkflowDefinition,
  input: string,
  options: WorkflowManualTriggerRunOptions,
): Promise<WorkflowManualTriggerRunResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const nodeAttempts: NodeAttempt[] = [];
  const edgeTransfers: Awaited<ReturnType<typeof recordWorkflowEdgeTransfer>>[] = [];
  const timestamp = createTimestampFactory(options.now);
  const triggerNodeId = options.source.triggerNodeId;
  const triggerNode = definition.nodes[triggerNodeId];

  const readiness = validateManualTextTriggerRun(definition, triggerNodeId, input);
  if (!readiness.ok) {
    return failure({
      nodeAttempts,
      edgeTransfers,
      events,
      diagnostics: readiness.diagnostics,
      error: {
        code: "WorkflowRuntimeError.manualTriggerRunBlocked",
        message: "Manual trigger workflow run was blocked by validation errors.",
      },
    });
  }

  const createdAt = timestamp();
  const run: WorkflowRun = {
    id: options.createRunId?.() ?? createId("wfr"),
    workflowId: definition.id,
    workflowVersion: definition.version,
    status: "running",
    current: { nodeId: triggerNodeId, status: "running" },
    input,
    state: createInitialWorkflowRunState(options.initialGlobalState ?? {}),
    createdAt,
    updatedAt: createdAt,
  };

  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "workflow.started",
    runId: run.id,
    workflowId: definition.id,
  });
  await persistWorkflowRun(options.store, run);

  const triggerAttempt = await completeManualTriggerNodeAttempt({
    definition,
    run,
    triggerNodeId,
    triggerNode: triggerNode as TriggerNodeDefinition,
    input,
    timestamp,
    store: options.store,
    emitEvent: options.emitEvent,
    events,
    createNodeAttemptId: options.createNodeAttemptId,
    source: options.source,
  });
  nodeAttempts.push(triggerAttempt);

  const initialGraphState: WorkflowManualTriggerGraphState = {
    run,
    nodeAttempts,
    edgeTransfers,
    events,
    pending: [],
    executedNodeIds: [],
    lastOutput: input,
  };

  let execution: WorkflowManualTriggerGraphState;
  try {
    const graph = compileManualTextTriggerWorkflowGraph(definition, options, timestamp);
    const graphResult = await graph.invoke(
      { execution: initialGraphState },
      { recursionLimit: workflowGraphRecursionLimit(definition) },
    );
    execution = graphResult.execution;
  } catch (error) {
    return failRun({
      run,
      triggerAttempt,
      nodeAttempts,
      edgeTransfers,
      events,
      diagnostics: [{
        code: "WorkflowRuntimeError.langGraphExecutionFailed",
        message: error instanceof Error ? error.message : "LangGraph execution failed with a non-Error value.",
        severity: "error",
        path: "$",
      }],
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.langGraphExecutionFailed",
        message: "Manual trigger workflow run failed during LangGraph execution.",
      },
    });
  }

  if (execution.failure) {
    return failRun({
      run: execution.run,
      triggerAttempt,
      nodeAttempts: execution.nodeAttempts,
      edgeTransfers: execution.edgeTransfers,
      events: execution.events,
      diagnostics: execution.failure.diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: execution.failure.error,
    });
  }

  const completedAt = timestamp();
  execution.run.status = "completed";
  execution.run.current = { status: "completed" };
  execution.run.output = execution.lastOutput;
  execution.run.completedAt = completedAt;
  execution.run.updatedAt = completedAt;
  await emitWorkflowRuntimeEvent(execution.events, options.store, options.emitEvent, {
    type: "workflow.completed",
    runId: execution.run.id,
    output: execution.lastOutput,
  });
  await persistWorkflowRun(options.store, execution.run);

  return {
    ok: true,
    run: execution.run,
    triggerAttempt,
    nodeAttempts: execution.nodeAttempts,
    edgeTransfers: execution.edgeTransfers,
    events: execution.events,
    output: execution.lastOutput,
  };
}

function compileManualTextTriggerWorkflowGraph(
  definition: WorkflowDefinition,
  options: WorkflowManualTriggerRunOptions,
  timestamp: () => string,
) {
  const graphNodeNames = new Map<NodeId, string>();
  for (const nodeId of Object.keys(definition.nodes)) graphNodeNames.set(nodeId, workflowGraphNodeName(nodeId));
  const triggerGraphNode = graphNodeNames.get(options.source.triggerNodeId) ?? workflowGraphNodeName(options.source.triggerNodeId);
  const graph = new StateGraph<
    typeof WorkflowManualTriggerState,
    typeof WorkflowManualTriggerState.State,
    typeof WorkflowManualTriggerState.Update,
    string
  >(WorkflowManualTriggerState);

  graph.addNode(triggerGraphNode, async (state) => {
    const execution = state.execution;
    const triggerAttempt = execution.nodeAttempts[0];
    const enqueueResult = await enqueueDirectOutgoingAgentEdges({
      definition,
      run: execution.run,
      sourceAttempt: triggerAttempt,
      queue: execution.pending,
      edgeTransfers: execution.edgeTransfers,
      events: execution.events,
      store: options.store,
      emitEvent: options.emitEvent,
      timestamp,
    });
    if (!enqueueResult.ok) {
      execution.failure = { diagnostics: enqueueResult.diagnostics, error: enqueueResult.error };
      return { execution };
    }
    execution.current = execution.pending.shift();
    return { execution };
  });

  for (const [nodeId, node] of Object.entries(definition.nodes)) {
    if (nodeId === options.source.triggerNodeId || node.kind !== "agent") continue;
    const graphNodeName = graphNodeNames.get(nodeId)!;
    graph.addNode(graphNodeName, async (state) => {
      const execution = state.execution;
      const pending = execution.current;
      if (!pending || pending.nodeId !== nodeId) {
        execution.failure = {
          diagnostics: [{
            code: "WorkflowRuntimeError.langGraphStateMismatch",
            message: `LangGraph scheduled workflow node '${nodeId}' without its pending input.`,
            severity: "error",
            nodeId,
            path: `$.nodes.${nodeId}`,
          }],
          error: {
            code: "WorkflowRuntimeError.langGraphStateMismatch",
            message: "Manual trigger workflow run reached an invalid LangGraph state.",
          },
        };
        execution.current = undefined;
        return { execution };
      }
      if (execution.executedNodeIds.includes(nodeId)) {
        execution.failure = {
          diagnostics: [{
            code: "WorkflowRuntimeError.joinUnsupported",
            message: `Workflow node '${nodeId}' received more than one input, but manual trigger V1 does not support joins yet.`,
            severity: "error",
            nodeId,
            edgeId: pending.viaEdgeId,
            path: `$.edges.${pending.viaEdgeId}`,
            hint: "Use a simple fan-out or linear agent chain until join policies are implemented.",
          }],
          error: {
            code: "WorkflowRuntimeError.joinUnsupported",
            message: "Manual trigger workflow run failed because a join node was reached.",
          },
        };
        execution.current = undefined;
        return { execution };
      }
      execution.executedNodeIds.push(nodeId);

      const dispatchResult = await dispatchWorkflowAgentNode(definition, execution.run, nodeId, pending.input, {
        registry: options.registry,
        now: options.now,
        createNodeAttemptId: options.createNodeAttemptId,
        store: options.store,
        emitEvent: options.emitEvent,
        profileResolver: options.profileResolver,
        agentExecutor: options.agentExecutor,
      });
      execution.events.push(...dispatchResult.events);
      execution.run = dispatchResult.run;
      if (!dispatchResult.ok) {
        execution.failure = { diagnostics: dispatchResult.diagnostics, error: dispatchResult.error };
        execution.current = undefined;
        return { execution };
      }

      execution.nodeAttempts.push(dispatchResult.nodeAttempt);
      execution.lastOutput = dispatchResult.output;
      const enqueueResult = await enqueueDirectOutgoingAgentEdges({
        definition,
        run: execution.run,
        sourceAttempt: dispatchResult.nodeAttempt,
        queue: execution.pending,
        edgeTransfers: execution.edgeTransfers,
        events: execution.events,
        store: options.store,
        emitEvent: options.emitEvent,
        timestamp,
      });
      if (!enqueueResult.ok) {
        execution.failure = { diagnostics: enqueueResult.diagnostics, error: enqueueResult.error };
        execution.current = undefined;
        return { execution };
      }
      execution.current = execution.pending.shift();
      return { execution };
    });
  }

  const route = (state: typeof WorkflowManualTriggerState.State) => {
    if (state.execution.failure || !state.execution.current) return END;
    return graphNodeNames.get(state.execution.current.nodeId) ?? END;
  };
  graph.addEdge(START, triggerGraphNode);
  graph.addConditionalEdges(triggerGraphNode, route);
  for (const [nodeId, node] of Object.entries(definition.nodes)) {
    if (nodeId === options.source.triggerNodeId || node.kind !== "agent") continue;
    graph.addConditionalEdges(graphNodeNames.get(nodeId)!, route);
  }
  return graph.compile();
}

function workflowGraphNodeName(nodeId: NodeId): string {
  return `pibo_${Buffer.from(nodeId).toString("base64url")}`;
}

function workflowGraphRecursionLimit(definition: WorkflowDefinition): number {
  return Math.max(25, Object.keys(definition.nodes).length * 2 + 2);
}

export function validateManualTextTriggerRun(
  definition: WorkflowDefinition,
  triggerNodeId: NodeId,
  input: string,
): { ok: true; diagnostics: WorkflowDiagnostic[] } | { ok: false; diagnostics: WorkflowDiagnostic[] } {
  const diagnostics: WorkflowDiagnostic[] = [];
  const definitionResult = validateWorkflow(definition);
  diagnostics.push(...definitionResult.diagnostics);
  const workflowInputResult = validateWorkflowInput(definition, input);
  diagnostics.push(...workflowInputResult.diagnostics);

  const node = definition.nodes[triggerNodeId];
  if (!node) {
    diagnostics.push({
      code: "WorkflowRuntimeError.unknownTriggerNode",
      message: `Manual trigger node '${triggerNodeId}' does not exist.`,
      severity: "error",
      nodeId: triggerNodeId,
      path: `$.nodes.${triggerNodeId}`,
    });
  } else if (node.kind !== "trigger") {
    diagnostics.push({
      code: "WorkflowRuntimeError.triggerNodeRequired",
      message: `Workflow node '${triggerNodeId}' is '${node.kind}', but manual runs require a trigger node.`,
      severity: "error",
      nodeId: triggerNodeId,
      path: `$.nodes.${triggerNodeId}.kind`,
    });
  } else {
    if (node.trigger.kind !== "manual") {
      diagnostics.push({
        code: "WorkflowRuntimeError.manualTriggerRequired",
        message: `Workflow trigger node '${triggerNodeId}' is '${node.trigger.kind}', but this run path supports only manual triggers.`,
        severity: "error",
        nodeId: triggerNodeId,
        path: `$.nodes.${triggerNodeId}.trigger.kind`,
      });
    }
    if (!node.output || node.output.kind !== "text") {
      diagnostics.push({
        code: "WorkflowRuntimeError.textTriggerOutputRequired",
        message: `Workflow trigger node '${triggerNodeId}' must declare a text output port for manual text runs.`,
        severity: "error",
        nodeId: triggerNodeId,
        path: `$.nodes.${triggerNodeId}.output`,
      });
    } else {
      diagnostics.push(...validateWorkflowPortValue(node.output, input, { path: `$.nodes.${triggerNodeId}.output` }).diagnostics.map((diagnostic) => ({ ...diagnostic, nodeId: triggerNodeId })));
    }
  }

  for (const [edgeId, edge] of Object.entries(definition.edges)) {
    if (edge.from.nodeId !== triggerNodeId && definition.nodes[edge.from.nodeId]?.kind !== "agent") continue;
    const target = definition.nodes[edge.to.nodeId];
    if (!target) continue;
    if (target.kind !== "agent") {
      diagnostics.push({
        code: "WorkflowRuntimeError.agentTargetRequired",
        message: `Workflow edge '${edgeId}' targets '${target.kind}', but manual trigger V1 can only dispatch agent nodes.`,
        severity: "error",
        edgeId,
        nodeId: edge.to.nodeId,
        path: `$.edges.${edgeId}.to.nodeId`,
        hint: "Use trigger and agent nodes only until adapter/code/human execution is enabled for this run path.",
      });
    }
    if (edge.guard) {
      diagnostics.push({
        code: "WorkflowRuntimeError.edgeGuardUnsupported",
        message: `Workflow edge '${edgeId}' uses a guard, which is not supported by manual trigger V1.`,
        severity: "error",
        edgeId,
        path: `$.edges.${edgeId}.guard`,
      });
    }
    if (edge.adapter) {
      diagnostics.push({
        code: "WorkflowRuntimeError.edgeAdapterUnsupported",
        message: `Workflow edge '${edgeId}' uses an adapter, which is not supported by manual trigger V1.`,
        severity: "error",
        edgeId,
        path: `$.edges.${edgeId}.adapter`,
      });
    }
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

async function completeManualTriggerNodeAttempt(input: {
  definition: WorkflowDefinition;
  run: WorkflowRun;
  triggerNodeId: NodeId;
  triggerNode: TriggerNodeDefinition;
  input: string;
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  events: WorkflowRuntimeEvent[];
  createNodeAttemptId?: () => NodeAttemptId;
  source: WorkflowManualTriggerRunSource;
}): Promise<NodeAttempt> {
  const startedAt = input.timestamp();
  const nodeAttempt: NodeAttempt = {
    id: input.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: input.run.id,
    nodeId: input.triggerNodeId,
    attempt: 1,
    kind: "trigger",
    status: "running",
    input: input.input,
    startedAt,
    metadata: {
      trigger: {
        kind: input.triggerNode.trigger.kind,
        mode: input.triggerNode.trigger.mode ?? "editor",
        source: input.source.kind,
        ...(input.source.actorId ? { actorId: input.source.actorId } : {}),
        ...(input.source.draftId ? { draftId: input.source.draftId } : {}),
      },
    },
  };
  input.run.current = { nodeId: input.triggerNodeId, status: "running" };
  input.run.updatedAt = startedAt;
  await emitWorkflowRuntimeEvent(input.events, input.store, input.emitEvent, {
    type: "node.started",
    runId: input.run.id,
    nodeAttemptId: nodeAttempt.id,
    nodeId: input.triggerNodeId,
  });
  await persistWorkflowNodeAttempt(input.store, nodeAttempt);
  await persistWorkflowRun(input.store, input.run);

  const completedAt = input.timestamp();
  nodeAttempt.status = "completed";
  nodeAttempt.output = input.input;
  nodeAttempt.completedAt = completedAt;
  input.run.current = { nodeId: input.triggerNodeId, status: "running" };
  input.run.updatedAt = completedAt;
  await emitWorkflowRuntimeEvent(input.events, input.store, input.emitEvent, {
    type: "node.completed",
    runId: input.run.id,
    nodeAttemptId: nodeAttempt.id,
    output: input.input,
  });
  await persistWorkflowNodeAttempt(input.store, nodeAttempt);
  await persistWorkflowRun(input.store, input.run);
  return nodeAttempt;
}

async function enqueueDirectOutgoingAgentEdges(input: {
  definition: WorkflowDefinition;
  run: WorkflowRun;
  sourceAttempt: NodeAttempt;
  queue: PendingNodeInput[];
  edgeTransfers: Awaited<ReturnType<typeof recordWorkflowEdgeTransfer>>[];
  events: WorkflowRuntimeEvent[];
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  timestamp: () => string;
}): Promise<{ ok: true } | { ok: false; diagnostics: WorkflowDiagnostic[]; error: WorkflowErrorSummary }> {
  const outgoingEdges = Object.entries(input.definition.edges)
    .filter(([, edge]) => edge.from.nodeId === input.sourceAttempt.nodeId)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [edgeId, edge] of outgoingEdges) {
    if (edge.guard || edge.adapter || (edge.kind ?? "data") !== "data") {
      return {
        ok: false,
        diagnostics: [{
          code: "WorkflowRuntimeError.edgeFeatureUnsupported",
          message: `Workflow edge '${edgeId}' uses a feature that manual trigger V1 does not execute yet.`,
          severity: "error",
          edgeId,
          path: `$.edges.${edgeId}`,
        }],
        error: {
          code: "WorkflowRuntimeError.edgeFeatureUnsupported",
          message: "Manual trigger workflow run failed because an unsupported edge feature was reached.",
        },
      };
    }

    const target = input.definition.nodes[edge.to.nodeId];
    if (!target || target.kind !== "agent") {
      return {
        ok: false,
        diagnostics: [{
          code: "WorkflowRuntimeError.agentTargetRequired",
          message: `Workflow edge '${edgeId}' must target an agent node in manual trigger V1.`,
          severity: "error",
          edgeId,
          nodeId: edge.to.nodeId,
          path: `$.edges.${edgeId}.to.nodeId`,
        }],
        error: {
          code: "WorkflowRuntimeError.agentTargetRequired",
          message: "Manual trigger workflow run failed because a non-agent node was reached.",
        },
      };
    }

    const transfer = await recordWorkflowEdgeTransfer(input.definition, input.run, edgeId, input.sourceAttempt, {
      events: input.events,
      store: input.store,
      emitEvent: input.emitEvent,
      now: input.timestamp,
    });
    input.edgeTransfers.push(transfer);
    if (!transfer.ok) {
      return { ok: false, diagnostics: transfer.diagnostics, error: transfer.error };
    }
    input.queue.push({ nodeId: edge.to.nodeId, input: transfer.targetInput, viaEdgeId: edgeId });
  }

  return { ok: true };
}

async function failRun(input: {
  run: WorkflowRun;
  triggerAttempt?: NodeAttempt;
  nodeAttempts: NodeAttempt[];
  edgeTransfers: Awaited<ReturnType<typeof recordWorkflowEdgeTransfer>>[];
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  error: WorkflowErrorSummary;
}): Promise<WorkflowManualTriggerRunFailure> {
  const failedAt = input.timestamp();
  input.run.status = "failed";
  input.run.current = { ...input.run.current, status: "failed" };
  input.run.failedAt = failedAt;
  input.run.updatedAt = failedAt;
  await emitWorkflowRuntimeEvent(input.events, input.store, input.emitEvent, {
    type: "workflow.failed",
    runId: input.run.id,
    error: input.error,
  });
  await persistWorkflowRun(input.store, input.run);
  return failure({
    run: input.run,
    triggerAttempt: input.triggerAttempt,
    nodeAttempts: input.nodeAttempts,
    edgeTransfers: input.edgeTransfers,
    events: input.events,
    diagnostics: input.diagnostics,
    error: input.error,
  });
}

function failure(input: Omit<WorkflowManualTriggerRunFailure, "ok">): WorkflowManualTriggerRunFailure {
  return { ok: false, ...input };
}
