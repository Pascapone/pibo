import type {
  AdapterNodeDefinition,
  AdapterResult,
  AgentNodeDefinition,
  CodeNodeResult,
  HumanNodeDefinition,
  NestedWorkflowNodeDefinition,
  NodeAttempt,
  NodeAttemptId,
  NodeId,
  TypeScriptCodeNodeDefinition,
  WorkflowCommand,
  WorkflowCommandEmitter,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRuntimeEvent,
  WorkflowValue,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
} from "../types/index.js";
import type {
  WorkflowRunStore,
  WorkflowWaitTokenStore,
} from "../store/index.js";
import {
  resolveWorkflowAdapter,
  resolveWorkflowDefinition,
  resolveWorkflowHandler,
} from "../registry/index.js";
import {
  validateNodeOutput,
  validateWorkflowInput,
  validateWorkflowOutput,
  validateWorkflowPortValue,
} from "../validation/index.js";
import {
  adapterNodeDispatchFailure,
  agentNodeDispatchFailure,
  codeNodeDispatchFailure,
  failAdapterNodeDispatch,
  failAgentNodeDispatch,
  failCodeNodeDispatch,
  failHumanNodeDispatch,
  failNestedWorkflowNodeDispatch,
  humanNodeDispatchFailure,
  nestedWorkflowNodeDispatchFailure,
} from "./dispatch-failures.js";
import {
  agentExecutorErrorSummaryFromCaught,
  createAgentRuntimeSelectionMetadata,
  linkWorkflowRunToAgentSession,
  resolveAgentProfileForRuntime,
} from "./agent-runtime.js";
import { createEdgePayloadReader } from "./edge-payloads.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import type {
  AgentProfileResolver,
  OneNodeAgentExecutor,
  OneNodeAgentExecutorResult,
} from "./pibo-routing.js";
import {
  applyCodeNodePatches,
  createCurrentNodeStateView,
  createInitialWorkflowRunState,
  createNodeScopedWorkflowRun,
  createStateReader,
  localStateSnapshotForNode,
  validateCodeNodePatches,
  WorkflowStateAccessViolation,
} from "./state.js";
import { buildAgentNodePrompt, recordFinalAgentPrompt } from "./prompts.js";
import {
  emitWorkflowRuntimeEvent,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import { createTimestampFactory, resolveWaitTokenExpiry } from "./time.js";

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

export type WorkflowCodeNodeDispatchOptions = {
  registry: Pick<WorkflowRegistry, "handlers">;
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  commandEmitter?: WorkflowCommandEmitter;
  edgePayloads?: Record<string, WorkflowValue>;
};

export type NestedWorkflowExecutorContext = {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeAttemptId: NodeAttemptId;
  nodeId: string;
  node: NestedWorkflowNodeDefinition;
  childWorkflow: WorkflowDefinition;
  childRunId: WorkflowRunId;
  input: WorkflowValue;
  namespace?: string;
};

export type NestedWorkflowExecutorResult = {
  output: WorkflowValue;
  childRun: WorkflowRun;
  events?: WorkflowRuntimeEvent[];
};

export type NestedWorkflowExecutor = (
  context: NestedWorkflowExecutorContext,
) => Promise<NestedWorkflowExecutorResult> | NestedWorkflowExecutorResult;

export type WorkflowNestedWorkflowNodeDispatchOptions = {
  registry: Pick<WorkflowRegistry, "workflows">;
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  createChildRunId?: () => WorkflowRunId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  nestedWorkflowExecutor: NestedWorkflowExecutor;
};

export type WorkflowHumanNodeDispatchOptions = {
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  createWaitTokenId?: () => WorkflowWaitTokenId;
  store: WorkflowRunStore & WorkflowWaitTokenStore;
  emitEvent?: WorkflowEventEmitter;
};

export type WorkflowCodeNodeDispatchSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
  result: CodeNodeResult;
  commands: WorkflowCommand[];
};

export type WorkflowCodeNodeDispatchFailure = {
  ok: false;
  run: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowCodeNodeDispatchResult = WorkflowCodeNodeDispatchSuccess | WorkflowCodeNodeDispatchFailure;

export type WorkflowNestedWorkflowNodeDispatchSuccess = {
  ok: true;
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  output: WorkflowValue;
  childRun: WorkflowRun;
};

export type WorkflowNestedWorkflowNodeDispatchFailure = {
  ok: false;
  run: WorkflowRun;
  nodeAttempt?: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
  childRun?: WorkflowRun;
};

export type WorkflowNestedWorkflowNodeDispatchResult =
  | WorkflowNestedWorkflowNodeDispatchSuccess
  | WorkflowNestedWorkflowNodeDispatchFailure;

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

export async function dispatchWorkflowCodeNode(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  nodeId: string,
  input: WorkflowValue,
  options: WorkflowCodeNodeDispatchOptions,
): Promise<WorkflowCodeNodeDispatchResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const node = definition.nodes[nodeId];

  if (!node) {
    return codeNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.unknownNode",
          message: `Workflow node '${nodeId}' does not exist, so it cannot be dispatched as a code node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.unknownNode",
        message: "Code node dispatch failed because the node is not declared.",
      },
    });
  }

  if (node.kind !== "code") {
    return codeNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.codeNodeRequired",
          message: `Workflow node '${nodeId}' is '${node.kind}', but code node dispatch requires a TypeScript code node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.kind`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.codeNodeRequired",
        message: "Code node dispatch failed because the selected node is not a code node.",
      },
    });
  }

  const codeNode = node as TypeScriptCodeNodeDefinition;
  const startedAt = timestamp();
  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "code",
    status: "running",
    input,
    startedAt,
    ...localStateSnapshotForNode(run, nodeId),
    metadata: { handlerId: codeNode.handler },
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

  const handler = resolveWorkflowHandler(options.registry, codeNode.handler);
  const diagnostics: WorkflowDiagnostic[] = [];

  if (!handler) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownHandlerRef",
      message: `Workflow code node '${nodeId}' references handler '${codeNode.handler}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.handler`,
      hint: "Register the handler before dispatching the code node.",
    });
  }

  if (codeNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(codeNode.input, input, { path: `$.nodes.${nodeId}.input` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failCodeNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.codeNodeDispatchFailed",
        message: "Code node dispatch failed before handler execution.",
      },
    });
  }

  try {
    const emittedCommands: WorkflowCommand[] = [];
    const handlerResult = await handler!.value({
      input,
      global: createStateReader("global", run.state.global, codeNode, nodeId),
      local: createStateReader("local", run.state.local?.[nodeId] ?? {}, codeNode, nodeId),
      edge: createEdgePayloadReader(options.edgePayloads ?? {}),
      emit: (event) => emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, event),
      command: async (command) => {
        emittedCommands.push(command);
        await options.commandEmitter?.(command);
      },
    });

    const commands = [...emittedCommands, ...toWorkflowCommandArray(handlerResult.command)];
    const patchDiagnostics = validateCodeNodePatches(definition, codeNode, nodeId, handlerResult);
    if (patchDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      return failCodeNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: patchDiagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidCodeNodePatch",
          message: "Code node state patch failed validation before completion.",
        },
      });
    }

    const nodeOutputResult = validateNodeOutput(definition, nodeId, handlerResult.output);
    if (!nodeOutputResult.ok) {
      return failCodeNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message: "Code node output failed validation before downstream use.",
        },
      });
    }

    applyCodeNodePatches(run, nodeId, handlerResult.globalPatch, handlerResult.localPatch);

    for (const command of commands) {
      if (!emittedCommands.includes(command)) {
        await options.commandEmitter?.(command);
      }
      if (command.kind === "emitEvent") {
        await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, command.event);
      }
    }

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = handlerResult.output;
    Object.assign(nodeAttempt, localStateSnapshotForNode(run, nodeId));
    nodeAttempt.completedAt = completedAt;
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: handlerResult.output,
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      nodeAttempt,
      events,
      output: handlerResult.output,
      result: handlerResult,
      commands,
    };
  } catch (caught) {
    const diagnostics = caught instanceof WorkflowStateAccessViolation ? [caught.diagnostic] : [];
    return failCodeNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: codeNodeErrorSummaryFromCaught(caught),
    });
  }
}

export async function dispatchWorkflowNestedWorkflowNode(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  nodeId: string,
  input: WorkflowValue,
  options: WorkflowNestedWorkflowNodeDispatchOptions,
): Promise<WorkflowNestedWorkflowNodeDispatchResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const node = definition.nodes[nodeId];

  if (!node) {
    return nestedWorkflowNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.unknownNode",
          message: `Workflow node '${nodeId}' does not exist, so it cannot be dispatched as a nested workflow node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.unknownNode",
        message: "Nested workflow node dispatch failed because the node is not declared.",
      },
    });
  }

  if (node.kind !== "workflow") {
    return nestedWorkflowNodeDispatchFailure({
      run,
      events,
      diagnostics: [
        {
          code: "WorkflowRuntimeError.workflowNodeRequired",
          message: `Workflow node '${nodeId}' is '${node.kind}', but nested workflow dispatch requires a workflow node.`,
          severity: "error",
          nodeId,
          path: `$.nodes.${nodeId}.kind`,
        },
      ],
      error: {
        code: "WorkflowRuntimeError.workflowNodeRequired",
        message: "Nested workflow node dispatch failed because the selected node is not a workflow node.",
      },
    });
  }

  const workflowNode = node as NestedWorkflowNodeDefinition;
  const startedAt = timestamp();
  const nodeAttempt: NodeAttempt = {
    id: options.createNodeAttemptId?.() ?? createId("wna"),
    workflowRunId: run.id,
    nodeId,
    attempt: 1,
    kind: "workflow",
    status: "running",
    input,
    startedAt,
    ...localStateSnapshotForNode(run, nodeId),
    metadata: {
      workflowId: workflowNode.workflowId,
      ...(workflowNode.workflowVersion ? { workflowVersion: workflowNode.workflowVersion } : {}),
      ...(workflowNode.namespace ? { namespace: workflowNode.namespace } : {}),
    },
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
  const childWorkflow = resolveWorkflowDefinition(options.registry, workflowNode.workflowId, workflowNode.workflowVersion);

  if (!childWorkflow) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownWorkflowRef",
      message: `Workflow node '${nodeId}' references child workflow '${workflowNode.workflowId}${workflowNode.workflowVersion ? `@${workflowNode.workflowVersion}` : ""}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.workflowId`,
      registryRef: workflowNode.workflowId,
      hint: "Register the child workflow definition before dispatching the nested workflow node.",
    });
  }

  if (workflowNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(workflowNode.input, input, { path: `$.nodes.${nodeId}.input` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (childWorkflow) {
    diagnostics.push(
      ...validateWorkflowInput(childWorkflow, input, { path: `$.nodes.${nodeId}.childInput` }).diagnostics.map(
        (diagnostic) => ({ ...diagnostic, nodeId }),
      ),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failNestedWorkflowNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics,
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: {
        code: "WorkflowRuntimeError.workflowNodeDispatchFailed",
        message: "Nested workflow node dispatch failed before child workflow execution.",
      },
    });
  }

  const childRunId = options.createChildRunId?.() ?? createId("wfr");

  try {
    const executorResult = await options.nestedWorkflowExecutor({
      workflow: definition,
      run: createNodeScopedWorkflowRun(run, nodeId),
      nodeAttemptId: nodeAttempt.id,
      nodeId,
      node: workflowNode,
      childWorkflow: childWorkflow!,
      childRunId,
      input,
      namespace: workflowNode.namespace,
    });

    if (executorResult.events?.length) {
      events.push(...executorResult.events);
    }

    nodeAttempt.metadata = {
      ...nodeAttempt.metadata,
      childRunId: executorResult.childRun.id,
      childWorkflowId: executorResult.childRun.workflowId,
      childWorkflowVersion: executorResult.childRun.workflowVersion,
    };

    if (executorResult.childRun.status !== "completed") {
      return failNestedWorkflowNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: [
          {
            code: "WorkflowRuntimeError.childWorkflowIncomplete",
            message: `Child workflow run '${executorResult.childRun.id}' ended with status '${executorResult.childRun.status}' instead of 'completed'.`,
            severity: "error",
            nodeId,
            path: `$.nodes.${nodeId}.workflowId`,
            hint: "Nested workflow nodes must wait for the child workflow to complete successfully before producing output.",
          },
        ],
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: executorResult.childRun.status === "failed"
            ? "WorkflowRuntimeError.childWorkflowFailed"
            : "WorkflowRuntimeError.childWorkflowIncomplete",
          message: "Nested workflow node dispatch failed because the child workflow did not complete successfully.",
        },
        childRun: executorResult.childRun,
      });
    }

    const childOutputResult = validateWorkflowOutput(childWorkflow!, executorResult.output, {
      path: `$.nodes.${nodeId}.childOutput`,
    });
    if (!childOutputResult.ok) {
      return failNestedWorkflowNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: childOutputResult.diagnostics.map((diagnostic) => ({ ...diagnostic, nodeId })),
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidChildWorkflowOutput",
          message: "Child workflow output failed validation before parent node completion.",
        },
        childRun: executorResult.childRun,
      });
    }

    const nodeOutputResult = validateNodeOutput(definition, nodeId, executorResult.output);
    if (!nodeOutputResult.ok) {
      return failNestedWorkflowNodeDispatch({
        run,
        nodeAttempt,
        events,
        diagnostics: nodeOutputResult.diagnostics,
        timestamp,
        store: options.store,
        emitEvent: options.emitEvent,
        error: {
          code: "WorkflowRuntimeError.invalidNodeOutput",
          message: "Nested workflow node output failed validation before downstream use.",
        },
        childRun: executorResult.childRun,
      });
    }

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = executorResult.output;
    nodeAttempt.completedAt = completedAt;
    Object.assign(nodeAttempt, localStateSnapshotForNode(run, nodeId));
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
      childRun: executorResult.childRun,
    };
  } catch (caught) {
    return failNestedWorkflowNodeDispatch({
      run,
      nodeAttempt,
      events,
      diagnostics: [],
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: nestedWorkflowErrorSummaryFromCaught(caught),
    });
  }
}

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

function toWorkflowCommandArray(command: WorkflowCommand | WorkflowCommand[] | undefined): WorkflowCommand[] {
  if (!command) {
    return [];
  }

  return Array.isArray(command) ? command : [command];
}


function codeNodeErrorSummaryFromCaught(caught: unknown): WorkflowErrorSummary {
  if (caught instanceof WorkflowStateAccessViolation) {
    return {
      code: caught.diagnostic.code,
      message: caught.message,
    };
  }

  if (caught instanceof Error) {
    return {
      code: "WorkflowRuntimeError.codeHandlerFailed",
      message: caught.message,
    };
  }

  return {
    code: "WorkflowRuntimeError.codeHandlerFailed",
    message: "Code node handler failed with a non-Error value.",
  };
}

function nestedWorkflowErrorSummaryFromCaught(caught: unknown): WorkflowErrorSummary {
  if (caught instanceof Error) {
    return {
      code: "WorkflowRuntimeError.nestedWorkflowExecutorFailed",
      message: caught.message,
    };
  }

  return {
    code: "WorkflowRuntimeError.nestedWorkflowExecutorFailed",
    message: "Nested workflow executor failed with a non-Error value.",
  };
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
