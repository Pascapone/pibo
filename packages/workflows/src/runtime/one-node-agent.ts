import type { WorkflowRunStore } from "../store/index.js";
import type {
  AgentNodeDefinition,
  JsonValue,
  NodeAttempt,
  NodeAttemptId,
  NodeId,
  ValidationResult,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRuntimeEvent,
  WorkflowValue,
} from "../types/index.js";
import {
  validateNodeOutput,
  validateWorkflow,
  validateWorkflowGlobalState,
  validateWorkflowInput,
  validateWorkflowOutput,
} from "../validation/index.js";
import {
  agentExecutorErrorSummaryFromCaught,
  createAgentRuntimeSelectionMetadata,
  linkWorkflowRunToAgentSession,
  resolveAgentProfileForRuntime,
} from "./agent-runtime.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import type {
  AgentProfileResolver,
  OneNodeAgentExecutor,
} from "./pibo-routing.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import { buildAgentNodePrompt, recordFinalAgentPrompt } from "./prompts.js";
import {
  createInitialWorkflowRunState,
  createNodeScopedWorkflowRun,
  localStateSnapshotForNode,
} from "./state.js";
import { createTimestampFactory } from "./time.js";

export type OneNodeAgentWorkflowOptions = {
  registry?: Pick<WorkflowRegistry, "promptBuilders">;
  ownerScope?: string;
  initialGlobalState?: Record<string, JsonValue>;
  initialLocalState?: Record<NodeId, Record<string, JsonValue>>;
  now?: () => Date | string;
  createRunId?: () => WorkflowRunId;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  profileResolver?: AgentProfileResolver;
  agentExecutor: OneNodeAgentExecutor;
};

export type OneNodeAgentWorkflowSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
};

export type OneNodeAgentWorkflowFailure = {
  ok: false;
  run?: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type OneNodeAgentWorkflowResult =
  | OneNodeAgentWorkflowSuccess
  | OneNodeAgentWorkflowFailure;

export function validateOneNodeAgentWorkflowPath(
  definition: WorkflowDefinition,
): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [
    ...validateWorkflow(definition).diagnostics,
  ];
  const nodeEntries = Object.entries(definition.nodes);

  if (nodeEntries.length !== 1) {
    diagnostics.push({
      code: "WorkflowRuntimeError.oneNodeAgentRequired",
      message: "The one-node agent workflow path requires exactly one node.",
      severity: "error",
      path: "$.nodes",
      hint: "Use a workflow with one agent node, no edges, and matching initial/final ids.",
    });
  }

  const initialNodeIds = toNodeIdArray(definition.initial);
  if (initialNodeIds.length !== 1) {
    diagnostics.push({
      code: "WorkflowRuntimeError.singleInitialRequired",
      message:
        "The one-node agent workflow path requires exactly one initial node.",
      severity: "error",
      path: "$.initial",
    });
  }

  if (Object.keys(definition.edges).length > 0) {
    diagnostics.push({
      code: "WorkflowRuntimeError.edgesUnsupported",
      message: "The one-node agent workflow path does not execute edges.",
      severity: "error",
      path: "$.edges",
      hint: "Use the later graph runtime path for multi-node workflows with edges.",
    });
  }

  const [nodeId, node] = nodeEntries[0] ?? [];
  if (nodeId && node) {
    const finalNodeIds = definition.final
      ? toNodeIdArray(definition.final)
      : [nodeId];

    if (initialNodeIds.length === 1 && initialNodeIds[0] !== nodeId) {
      diagnostics.push({
        code: "WorkflowRuntimeError.initialNodeMismatch",
        message:
          "The initial node must be the only declared node for the one-node agent workflow path.",
        severity: "error",
        path: "$.initial",
        nodeId: initialNodeIds[0],
      });
    }

    if (finalNodeIds.length !== 1 || finalNodeIds[0] !== nodeId) {
      diagnostics.push({
        code: "WorkflowRuntimeError.finalNodeMismatch",
        message:
          "The final node must be the only declared node for the one-node agent workflow path.",
        severity: "error",
        path: "$.final",
        nodeId,
      });
    }

    if (node.kind !== "agent") {
      diagnostics.push({
        code: "WorkflowRuntimeError.agentNodeRequired",
        message: "The one-node workflow path only supports agent nodes.",
        severity: "error",
        path: `$.nodes.${nodeId}.kind`,
        nodeId,
      });
    } else if (node.runtime !== "pibo") {
      diagnostics.push({
        code: "WorkflowRuntimeError.piboRuntimeRequired",
        message:
          "Agent nodes must use the Pibo runtime in the one-node agent workflow path.",
        severity: "error",
        path: `$.nodes.${nodeId}.runtime`,
        nodeId,
      });
    }
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

export async function runOneNodeAgentWorkflow(
  definition: WorkflowDefinition,
  input: WorkflowValue,
  options: OneNodeAgentWorkflowOptions,
): Promise<OneNodeAgentWorkflowResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const shapeResult = validateOneNodeAgentWorkflowPath(definition);
  if (!shapeResult.ok) {
    return runtimeFailure(events, shapeResult.diagnostics, {
      code: "WorkflowRuntimeError.invalidDefinition",
      message:
        "Workflow definition cannot run on the one-node agent workflow path.",
    });
  }

  const inputResult = validateWorkflowInput(definition, input);
  if (!inputResult.ok) {
    return runtimeFailure(events, inputResult.diagnostics, {
      code: "WorkflowRuntimeError.invalidInput",
      message: "Workflow input failed validation before execution.",
    });
  }

  const initialGlobalState = { ...(options.initialGlobalState ?? {}) };
  const globalStateResult = validateWorkflowGlobalState(
    definition,
    initialGlobalState,
  );
  if (!globalStateResult.ok) {
    return runtimeFailure(events, globalStateResult.diagnostics, {
      code: "WorkflowRuntimeError.invalidGlobalState",
      message: "Workflow global state failed validation before execution.",
    });
  }

  const nodeId = toNodeIdArray(definition.initial)[0];
  const node = definition.nodes[nodeId] as AgentNodeDefinition;
  const timestamp = createTimestampFactory(options.now);
  const createdAt = timestamp();
  const run: WorkflowRun = {
    id: options.createRunId?.() ?? createId("wfr"),
    workflowId: definition.id,
    workflowVersion: definition.version,
    ownerScope: options.ownerScope ?? "workflow:local",
    status: "running",
    current: { nodeId, status: "running" },
    input,
    state: createInitialWorkflowRunState(
      initialGlobalState,
      options.initialLocalState,
    ),
    createdAt,
    updatedAt: createdAt,
  };

  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "workflow.started",
    runId: run.id,
    workflowId: definition.id,
  });
  await persistWorkflowRun(options.store, run);

  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "agent",
    status: "running",
    input,
    startedAt: timestamp(),
    ...localStateSnapshotForNode(run, nodeId),
  };

  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "node.started",
    runId: run.id,
    nodeAttemptId: nodeAttempt.id,
    nodeId,
  });
  await persistWorkflowNodeAttempt(options.store, nodeAttempt);

  try {
    const profileResolution = await resolveAgentProfileForRuntime({
      workflow: definition,
      run,
      nodeId,
      node,
      resolver: options.profileResolver,
    });
    if (!profileResolution.ok) {
      return failRunningWorkflow({
        run,
        nodeAttempt,
        events,
        diagnostics: profileResolution.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: profileResolution.error,
      });
    }

    const promptResult = await buildAgentNodePrompt(node, input, {
      workflow: definition,
      run,
      nodeId,
      registry: options.registry,
    });
    if (!promptResult.ok) {
      return failRunningWorkflow({
        run,
        nodeAttempt,
        events,
        diagnostics: promptResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: promptResult.error,
      });
    }

    recordFinalAgentPrompt(nodeAttempt, promptResult.recordedPrompt);
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);

    const executorResult = await options.agentExecutor({
      workflow: definition,
      run: createNodeScopedWorkflowRun(run, nodeId),
      nodeAttemptId: nodeAttempt.id,
      nodeId,
      node,
      input,
      prompt: promptResult.prompt,
      profileId: profileResolution.profile.id,
      resolvedProfile: profileResolution.profile,
      routing: node.routing,
    });

    const nodeOutputResult = validateNodeOutput(
      definition,
      nodeId,
      executorResult.output,
    );
    if (!nodeOutputResult.ok) {
      return failRunningWorkflow({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message:
            "Agent node output failed validation before workflow completion.",
        },
      });
    }

    const workflowOutputResult = validateWorkflowOutput(
      definition,
      executorResult.output,
    );
    if (!workflowOutputResult.ok) {
      return failRunningWorkflow({
        run,
        nodeAttempt,
        events,
        diagnostics: workflowOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidWorkflowOutput",
          message: "Workflow output failed validation before completion.",
        },
      });
    }

    const runtimeMetadata = createAgentRuntimeSelectionMetadata({
      run,
      node,
      profile: profileResolution.profile,
      executorResult,
    });

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = executorResult.output;
    nodeAttempt.completedAt = completedAt;
    Object.assign(nodeAttempt, localStateSnapshotForNode(run, nodeId));
    nodeAttempt.metadata = {
      ...nodeAttempt.metadata,
      runtime: runtimeMetadata,
      ...(executorResult.piboSessionId
        ? { piboSessionId: executorResult.piboSessionId }
        : {}),
      ...(executorResult.piSessionId
        ? { piSessionId: executorResult.piSessionId }
        : {}),
    };

    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: executorResult.output,
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);

    run.status = "completed";
    run.current = { nodeId, status: "completed" };
    linkWorkflowRunToAgentSession(run, node, executorResult);
    run.output = executorResult.output;
    run.completedAt = completedAt;
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "workflow.completed",
      runId: run.id,
      output: executorResult.output,
    });
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      nodeAttempt,
      events,
      output: executorResult.output,
    };
  } catch (caught) {
    return failRunningWorkflow({
      run,
      nodeAttempt,
      events,
      diagnostics: [],
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: agentExecutorErrorSummaryFromCaught(caught),
    });
  }
}

async function failRunningWorkflow(options: {
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  error: WorkflowErrorSummary;
}): Promise<OneNodeAgentWorkflowFailure> {
  const failedAt = options.timestamp();
  options.nodeAttempt.status = "failed";
  options.nodeAttempt.error = options.error;
  options.nodeAttempt.failedAt = failedAt;
  options.run.status = "failed";
  options.run.current = {
    nodeId: options.nodeAttempt.nodeId,
    status: "failed",
  };
  options.run.failedAt = failedAt;
  options.run.updatedAt = failedAt;
  await emitWorkflowRuntimeEvent(
    options.events,
    options.store,
    options.emitEvent,
    {
      type: "node.failed",
      runId: options.run.id,
      nodeAttemptId: options.nodeAttempt.id,
      error: options.error,
    },
  );
  await emitWorkflowRuntimeEvent(
    options.events,
    options.store,
    options.emitEvent,
    {
      type: "workflow.failed",
      runId: options.run.id,
      error: options.error,
    },
  );
  await persistWorkflowNodeAttempt(options.store, options.nodeAttempt);
  await persistWorkflowRun(options.store, options.run);

  return {
    ok: false,
    run: options.run,
    nodeAttempt: options.nodeAttempt,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

function runtimeFailure(
  events: WorkflowRuntimeEvent[],
  diagnostics: WorkflowDiagnostic[],
  error: WorkflowErrorSummary,
): OneNodeAgentWorkflowFailure {
  return { ok: false, events, diagnostics, error };
}

function toNodeIdArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}
