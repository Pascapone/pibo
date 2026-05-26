import type {
  AgentNodeDefinition,
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
import { validateNodeOutput, validateWorkflowPortValue } from "../validation/index.js";
import { agentNodeDispatchFailure, failAgentNodeDispatch } from "./dispatch-failures.js";
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
  OneNodeAgentExecutorResult,
} from "./pibo-routing.js";
import { createNodeScopedWorkflowRun, localStateSnapshotForNode } from "./state.js";
import { buildAgentNodePrompt, recordFinalAgentPrompt } from "./prompts.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import { createTimestampFactory } from "./time.js";

export {
  createRetryScheduledNodeAttempt,
  decideWorkflowNodeRetry,
  resolveWorkflowRetryPolicy,
} from "./retry.js";
export type { WorkflowNodeRetryDecision, WorkflowNodeRetryDecisionOptions } from "./retry.js";
export { runOneNodeAgentWorkflow, validateOneNodeAgentWorkflowPath } from "./one-node-agent.js";
export type {
  OneNodeAgentWorkflowFailure,
  OneNodeAgentWorkflowOptions,
  OneNodeAgentWorkflowResult,
  OneNodeAgentWorkflowSuccess,
} from "./one-node-agent.js";
export {
  createPiboSessionRoutingAgentExecutor,
  PIBO_WORKFLOW_SESSION_KIND_METADATA_KEY,
  PIBO_WORKFLOW_SESSION_KINDS,
} from "./pibo-routing.js";
export type {
  AgentProfileResolver,
  AgentProfileResolverContext,
  OneNodeAgentExecutor,
  OneNodeAgentExecutorContext,
  OneNodeAgentExecutorResult,
  PiboRoutingJsonObject,
  PiboRoutingJsonValue,
  PiboSessionRoutingAgentExecutorOptions,
  PiboWorkflowAssistantMessageEvent,
  PiboWorkflowMessageEvent,
  PiboWorkflowOutputEvent,
  PiboWorkflowProjectSessionLinker,
  PiboWorkflowProjectSessionLinkInput,
  PiboWorkflowSession,
  PiboWorkflowSessionCreateInput,
  PiboWorkflowSessionErrorEvent,
  PiboWorkflowSessionKind,
  PiboWorkflowSessionRouting,
  PiboWorkflowSessionStatus,
  ResolvedAgentProfile,
} from "./pibo-routing.js";

export {
  recordWorkflowEdgeTransfer,
  transferWorkflowEdgeAdapterData,
  transferWorkflowEdgeData,
} from "./edge-transfer.js";
export type {
  RecordedWorkflowEdgeTransferFailure,
  RecordedWorkflowEdgeTransferOptions,
  RecordedWorkflowEdgeTransferResult,
  RecordedWorkflowEdgeTransferSuccess,
  WorkflowEdgeAdapterTransferOptions,
  WorkflowEdgeTransferFailure,
  WorkflowEdgeTransferOptions,
  WorkflowEdgeTransferResult,
  WorkflowEdgeTransferSuccess,
} from "./edge-transfer.js";

export { applyWorkflowHumanAction } from "./human-action.js";
export type {
  WorkflowHumanActionApplyFailure,
  WorkflowHumanActionApplyOptions,
  WorkflowHumanActionApplyRequest,
  WorkflowHumanActionApplyResult,
  WorkflowHumanActionApplySuccess,
  WorkflowHumanActionDecisionKind,
} from "./human-action.js";
export { dispatchWorkflowHumanNode } from "./human-node.js";
export type {
  WorkflowHumanNodeDispatchFailure,
  WorkflowHumanNodeDispatchOptions,
  WorkflowHumanNodeDispatchResult,
  WorkflowHumanNodeDispatchWaiting,
} from "./human-node.js";
export { dispatchWorkflowAdapterNode } from "./adapter-node.js";
export type {
  WorkflowAdapterNodeDispatchFailure,
  WorkflowAdapterNodeDispatchOptions,
  WorkflowAdapterNodeDispatchResult,
  WorkflowAdapterNodeDispatchSuccess,
} from "./adapter-node.js";
export { dispatchWorkflowCodeNode } from "./code-node.js";
export type {
  WorkflowCodeNodeDispatchFailure,
  WorkflowCodeNodeDispatchOptions,
  WorkflowCodeNodeDispatchResult,
  WorkflowCodeNodeDispatchSuccess,
} from "./code-node.js";
export { dispatchWorkflowNestedWorkflowNode } from "./nested-workflow-node.js";
export type {
  NestedWorkflowExecutor,
  NestedWorkflowExecutorContext,
  NestedWorkflowExecutorResult,
  WorkflowNestedWorkflowNodeDispatchFailure,
  WorkflowNestedWorkflowNodeDispatchOptions,
  WorkflowNestedWorkflowNodeDispatchResult,
  WorkflowNestedWorkflowNodeDispatchSuccess,
} from "./nested-workflow-node.js";

export type WorkflowAgentNodeDispatchOptions = {
  registry?: Pick<WorkflowRegistry, "promptBuilders">;
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  profileResolver?: AgentProfileResolver;
  agentExecutor: OneNodeAgentExecutor;
  edgePayloads?: Record<string, WorkflowValue>;
};

export type WorkflowAgentNodeDispatchSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
  result: OneNodeAgentExecutorResult;
};

export type WorkflowAgentNodeDispatchFailure = {
  ok: false;
  run: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowAgentNodeDispatchResult =
  | WorkflowAgentNodeDispatchSuccess
  | WorkflowAgentNodeDispatchFailure;

export async function dispatchWorkflowAgentNode(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  nodeId: string,
  input: WorkflowValue,
  options: WorkflowAgentNodeDispatchOptions,
): Promise<WorkflowAgentNodeDispatchResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const node = definition.nodes[nodeId];

  if (!node) {
    return agentNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.unknownNode",
          message: `Workflow node '${nodeId}' does not exist, so it cannot be dispatched as an agent node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.unknownNode",
        message: "Agent node dispatch failed because the node is not declared.",
      },
    });
  }

  if (node.kind !== "agent") {
    return agentNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.agentNodeRequired",
          message: `Workflow node '${nodeId}' is '${node.kind}', but agent node dispatch requires an agent node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.kind`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.agentNodeRequired",
        message: "Agent node dispatch failed because the selected node is not an agent node.",
      },
    });
  }

  const agentNode = node as AgentNodeDefinition;
  if (agentNode.runtime !== "pibo") {
    return agentNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.piboRuntimeRequired",
          message: `Workflow agent node '${nodeId}' uses runtime '${agentNode.runtime}', but V1 agent dispatch requires the Pibo runtime.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.runtime`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.piboRuntimeRequired",
        message: "Agent node dispatch failed because the selected node does not use the Pibo runtime.",
      },
    });
  }

  const startedAt = timestamp();
  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "agent",
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
  if (agentNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(agentNode.input, input, { path: `$.nodes.${nodeId}.input` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failAgentNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.agentNodeDispatchFailed",
        message: "Agent node dispatch failed before Pibo Runtime execution.",
      },
    });
  }

  try {
    const profileResolution = await resolveAgentProfileForRuntime({
      workflow: definition,
      run,
      nodeId,
      node: agentNode,
      resolver: options.profileResolver,
    });
    if (!profileResolution.ok) {
      return failAgentNodeDispatch({
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

    const promptResult = await buildAgentNodePrompt(agentNode, input, {
      workflow: definition,
      run,
      nodeId,
      registry: options.registry,
      edgePayloads: options.edgePayloads,
    });
    if (!promptResult.ok) {
      return failAgentNodeDispatch({
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
      node: agentNode,
      input,
      prompt: promptResult.prompt,
      profileId: profileResolution.profile.id,
      resolvedProfile: profileResolution.profile,
      routing: agentNode.routing,
    });

    const nodeOutputResult = validateNodeOutput(definition, nodeId, executorResult.output);
    if (!nodeOutputResult.ok) {
      return failAgentNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message: "Agent node output failed validation before downstream use.",
        },
      });
    }

    const runtimeMetadata = createAgentRuntimeSelectionMetadata({
      run,
      node: agentNode,
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
      ...(executorResult.piboSessionId ? { piboSessionId: executorResult.piboSessionId } : {}),
      ...(executorResult.piSessionId ? { piSessionId: executorResult.piSessionId } : {}),
    };
    linkWorkflowRunToAgentSession(run, agentNode, executorResult);
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: executorResult.output,
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      nodeAttempt,
      events,
      output: executorResult.output,
      result: executorResult,
    };
  } catch (caught) {
    return failAgentNodeDispatch({
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
