import type {
  AdapterNodeDefinition,
  AdapterResult,
  AgentNodeDefinition,
  CodeNodeResult,
  DurationSpec,
  EdgePayloadReader,
  EdgeTransfer,
  EdgeTransferId,
  HumanNodeDefinition,
  JsonValue,
  NestedWorkflowNodeDefinition,
  NodeAttempt,
  NodeAttemptId,
  NodeLocalStateReader,
  RuntimeSelectionMetadata,
  ScopedStatePath,
  StatePatch,
  TypeScriptCodeNodeDefinition,
  ValidationResult,
  WorkflowCommand,
  WorkflowCommandEmitter,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowGlobalStateReader,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRuntimeEvent,
  WorkflowValue,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
} from "../types/index.js";
import type { WorkflowNodeAttemptStore, WorkflowRunStore, WorkflowWaitTokenStore } from "../store/index.js";
import { resolveWorkflowAdapter, resolveWorkflowDefinition, resolveWorkflowHandler } from "../registry/index.js";
import {
  validateJsonValueAgainstSchema,
  validateNodeOutput,
  validateWorkflow,
  validateWorkflowEdgeAdapterOutput,
  validateWorkflowInput,
  validateWorkflowOutput,
  validateWorkflowPortValue,
} from "../validation/index.js";

export type ResolvedAgentProfile = {
  id: string;
  requestedId: string;
  aliases?: string[];
};

export type AgentProfileResolverContext = {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeId: string;
  node: AgentNodeDefinition;
  selection: AgentNodeDefinition["profile"];
};

export type AgentProfileResolver = (
  context: AgentProfileResolverContext,
) => Promise<ResolvedAgentProfile | undefined> | ResolvedAgentProfile | undefined;

export type OneNodeAgentExecutorContext = {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeAttemptId?: NodeAttemptId;
  nodeId: string;
  node: AgentNodeDefinition;
  input: WorkflowValue;
  prompt: string;
  profileId: string;
  resolvedProfile: ResolvedAgentProfile;
  routing?: AgentNodeDefinition["routing"];
};

export type PiboRoutingJsonValue =
  | null
  | boolean
  | number
  | string
  | PiboRoutingJsonValue[]
  | { [key: string]: PiboRoutingJsonValue };

export type PiboRoutingJsonObject = { [key: string]: PiboRoutingJsonValue };

export type PiboWorkflowSession = {
  id: string;
  piSessionId?: string;
  profile: string;
  ownerScope?: string;
  parentId?: string;
  workspace?: string;
  metadata?: PiboRoutingJsonObject;
};

export type PiboWorkflowSessionCreateInput = {
  channel: string;
  kind: string;
  profile: string;
  ownerScope?: string;
  parentId?: string;
  workspace?: string;
  title?: string;
  metadata?: PiboRoutingJsonObject;
};

export type PiboWorkflowMessageEvent = {
  type: "message";
  piboSessionId: string;
  id?: string;
  text: string;
  source?: "user" | "ui" | "service" | "actor";
};

export type PiboWorkflowAssistantMessageEvent = {
  type: "assistant_message";
  piboSessionId: string;
  eventId?: string;
  text: string;
};

export type PiboWorkflowSessionErrorEvent = {
  type: "session_error";
  piboSessionId: string;
  eventId?: string;
  error: string;
};

export type PiboWorkflowOutputEvent = PiboWorkflowAssistantMessageEvent | PiboWorkflowSessionErrorEvent | {
  type: string;
  piboSessionId: string;
  eventId?: string;
};

export type PiboWorkflowSessionStatus = {
  piboSessionId: string;
  enabledTools?: string[];
  activeTools?: string[];
};

export type PiboWorkflowSessionRouting = {
  createSession(input: PiboWorkflowSessionCreateInput): PiboWorkflowSession;
  emit(event: PiboWorkflowMessageEvent): Promise<unknown> | unknown;
  subscribe(listener: (event: PiboWorkflowOutputEvent) => void): () => void;
  getSessionRuntimeStatus?(piboSessionId: string): PiboWorkflowSessionStatus | undefined;
};

export type PiboSessionRoutingAgentExecutorOptions = {
  routing: PiboWorkflowSessionRouting;
  workspace?: string;
  timeoutMs?: number;
  createMessageId?: () => string;
  channel?: string;
  kind?: string;
  title?: string | ((context: OneNodeAgentExecutorContext) => string | undefined);
  metadata?: PiboRoutingJsonObject | ((context: OneNodeAgentExecutorContext) => PiboRoutingJsonObject | undefined);
};

export type OneNodeAgentExecutorResult = {
  output: WorkflowValue;
  piboSessionId?: string;
  piSessionId?: string;
  effectiveProfile?: string;
  effectiveTools?: string[];
  effectiveSkills?: string[];
  effectiveContextFiles?: string[];
};

export type OneNodeAgentExecutor = (
  context: OneNodeAgentExecutorContext,
) => Promise<OneNodeAgentExecutorResult> | OneNodeAgentExecutorResult;

export type OneNodeAgentWorkflowOptions = {
  ownerScope?: string;
  now?: () => Date | string;
  createRunId?: () => WorkflowRunId;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  profileResolver?: AgentProfileResolver;
  agentExecutor: OneNodeAgentExecutor;
};

export type WorkflowAgentNodeDispatchOptions = {
  now?: () => Date | string;
  createNodeAttemptId?: () => NodeAttemptId;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  profileResolver?: AgentProfileResolver;
  agentExecutor: OneNodeAgentExecutor;
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

export type WorkflowEdgeTransferOptions = {
  now?: () => Date | string;
  createEdgeTransferId?: () => EdgeTransferId;
};

export type WorkflowEdgeAdapterTransferOptions = WorkflowEdgeTransferOptions & {
  registry: Pick<WorkflowRegistry, "adapters">;
};

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

export type RecordedWorkflowEdgeTransferOptions = WorkflowEdgeTransferOptions & {
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

export type WorkflowEdgeTransferResult = WorkflowEdgeTransferSuccess | WorkflowEdgeTransferFailure;

export type RecordedWorkflowEdgeTransferSuccess = WorkflowEdgeTransferSuccess & {
  run: WorkflowRun;
  events: WorkflowRuntimeEvent[];
};

export type RecordedWorkflowEdgeTransferFailure = WorkflowEdgeTransferFailure & {
  run: WorkflowRun;
  events: WorkflowRuntimeEvent[];
};

export type RecordedWorkflowEdgeTransferResult =
  | RecordedWorkflowEdgeTransferSuccess
  | RecordedWorkflowEdgeTransferFailure;

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

export type OneNodeAgentWorkflowResult = OneNodeAgentWorkflowSuccess | OneNodeAgentWorkflowFailure;

export function createPiboSessionRoutingAgentExecutor(
  options: PiboSessionRoutingAgentExecutorOptions,
): OneNodeAgentExecutor {
  return async (context) => {
    const session = options.routing.createSession({
      channel: options.channel ?? context.routing?.channel ?? "pibo.workflows",
      kind: options.kind ?? "workflow-agent",
      profile: context.profileId,
      ownerScope: context.routing?.ownerScope ?? context.run.ownerScope,
      parentId: context.routing?.parentSessionId,
      workspace: options.workspace,
      title: resolveExecutorTitle(options.title, context),
      metadata: {
        ...resolveExecutorMetadata(options.metadata, context),
        workflowRunId: context.run.id,
        workflowId: context.workflow.id,
        workflowVersion: context.workflow.version,
        workflowNodeId: context.nodeId,
        ...(context.nodeAttemptId ? { workflowNodeAttemptId: context.nodeAttemptId } : {}),
        ...(context.routing?.projectId ? { projectId: context.routing.projectId } : {}),
        ...(context.routing?.roomId ? { chatRoomId: context.routing.roomId } : {}),
      },
    });
    const messageId = options.createMessageId?.() ?? createId("wfm");
    const reply = await emitMessageAndWaitForPiboReply(
      options.routing,
      {
        type: "message",
        piboSessionId: session.id,
        id: messageId,
        text: context.prompt,
        source: "actor",
      },
      options.timeoutMs,
    );
    const status = options.routing.getSessionRuntimeStatus?.(session.id);

    return {
      output: reply.text,
      piboSessionId: session.id,
      piSessionId: session.piSessionId,
      effectiveProfile: session.profile || context.profileId,
      effectiveTools: status?.enabledTools ?? status?.activeTools,
    };
  };
}

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
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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

    const prompt = buildAgentNodePrompt(agentNode, input);
    const executorResult = await options.agentExecutor({
      workflow: definition,
      run,
      nodeAttemptId: nodeAttempt.id,
      nodeId,
      node: agentNode,
      input,
      prompt,
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

    const runtimeMetadata: RuntimeSelectionMetadata = {
      profileId: executorResult.effectiveProfile ?? profileResolution.profile.id,
      ...(executorResult.effectiveTools ? { tools: executorResult.effectiveTools } : {}),
      ...(executorResult.effectiveSkills ? { skills: executorResult.effectiveSkills } : {}),
      ...(executorResult.effectiveContextFiles ? { contextFiles: executorResult.effectiveContextFiles } : {}),
      ...(agentNode.routing ? { routing: agentNode.routing } : {}),
    };

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = executorResult.output;
    nodeAttempt.completedAt = completedAt;
    nodeAttempt.metadata = {
      runtime: runtimeMetadata,
      ...(executorResult.piboSessionId ? { piboSessionId: executorResult.piboSessionId } : {}),
      ...(executorResult.piSessionId ? { piSessionId: executorResult.piSessionId } : {}),
    };
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
      error: errorSummaryFromCaught(caught),
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
    metadata: { handlerId: codeNode.handler },
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
      emit: (event) => emitWorkflowRuntimeEvent(events, options.emitEvent, event),
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
        await emitWorkflowRuntimeEvent(events, options.emitEvent, command.event);
      }
    }

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = handlerResult.output;
    nodeAttempt.localState = run.state.local?.[nodeId];
    nodeAttempt.completedAt = completedAt;
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
    metadata: {
      workflowId: workflowNode.workflowId,
      ...(workflowNode.workflowVersion ? { workflowVersion: workflowNode.workflowVersion } : {}),
      ...(workflowNode.namespace ? { namespace: workflowNode.namespace } : {}),
    },
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
      run,
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
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
  nodeAttempt.metadata = { waitTokenId: waitToken.id };
  run.status = "waiting";
  run.current = { nodeId, status: "waiting" };
  run.updatedAt = waitCreatedAt;

  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
    metadata: { adapterId: adapterNode.handler.id },
  };
  run.current = { nodeId, status: "running" };
  run.updatedAt = startedAt;

  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
    const adapterResult = await adapter!.value({ input, run });
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
    nodeAttempt.metadata = { adapterId: adapterNode.handler.id };
    run.current = { nodeId, status: run.status };
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
        message: "Workflow edge data transfer failed because the edge is not declared.",
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
  const sourceOutputResult = validateNodeOutput(definition, edge.from.nodeId, payload, {
    path: `$.edges.${edgeId}.payload`,
  });
  diagnostics.push(...sourceOutputResult.diagnostics.map((diagnostic) => ({ ...diagnostic, edgeId })));

  if (targetNode?.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(targetNode.input, payload, {
        path: `$.edges.${edgeId}.targetInput`,
      }).diagnostics.map((diagnostic) => ({ ...diagnostic, edgeId, nodeId: edge.to.nodeId })),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return edgeTransferFailure(diagnostics, {
      code: "WorkflowRuntimeError.invalidEdgePayload",
      message: "Workflow edge payload failed source output or target input validation.",
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
        message: "Workflow edge adapter transfer failed because the edge is not declared.",
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

  const adapter = edge.adapter ? resolveWorkflowAdapter(options.registry, edge.adapter.transform) : undefined;
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
      message: "Workflow edge adapter transfer failed before adapter execution.",
    });
  }

  const payload = sourceNodeAttempt.output as WorkflowValue;
  const sourceOutputResult = validateNodeOutput(definition, edge.from.nodeId, payload, {
    path: `$.edges.${edgeId}.payload`,
  });
  diagnostics.push(...sourceOutputResult.diagnostics.map((diagnostic) => ({ ...diagnostic, edgeId })));

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return edgeTransferFailure(diagnostics, {
      code: "WorkflowRuntimeError.invalidEdgePayload",
      message: "Workflow edge adapter input failed source output validation.",
    });
  }

  let adaptedOutput: WorkflowValue;
  try {
    const adapterResult = await adapter!.value({ input: payload, edge, run });
    adaptedOutput = adapterResult.output;
  } catch (caught) {
    return edgeTransferFailure(diagnostics, adapterErrorSummaryFromCaught(caught));
  }

  const adapterOutputResult = validateWorkflowEdgeAdapterOutput(definition, edgeId, adaptedOutput);
  diagnostics.push(...adapterOutputResult.diagnostics);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return edgeTransferFailure(diagnostics, {
      code: "WorkflowRuntimeError.invalidAdapterOutput",
      message: "Workflow edge adapter output failed validation before target node execution.",
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
  const result = transferWorkflowEdgeData(definition, run, edgeId, sourceNodeAttempt, options);
  if (!result.ok) {
    return { ...result, run, events };
  }

  run.current = { edgeId, status: run.status };
  run.updatedAt = result.transfer.createdAt;
  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
    type: "edge.transferred",
    runId: run.id,
    edgeTransferId: result.transfer.id,
    edgeId,
  });
  await persistWorkflowRun(options.store, run);

  return { ...result, run, events };
}

export function validateOneNodeAgentWorkflowPath(definition: WorkflowDefinition): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [...validateWorkflow(definition).diagnostics];
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
      message: "The one-node agent workflow path requires exactly one initial node.",
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
    const finalNodeIds = definition.final ? toNodeIdArray(definition.final) : [nodeId];

    if (initialNodeIds.length === 1 && initialNodeIds[0] !== nodeId) {
      diagnostics.push({
        code: "WorkflowRuntimeError.initialNodeMismatch",
        message: "The initial node must be the only declared node for the one-node agent workflow path.",
        severity: "error",
        path: "$.initial",
        nodeId: initialNodeIds[0],
      });
    }

    if (finalNodeIds.length !== 1 || finalNodeIds[0] !== nodeId) {
      diagnostics.push({
        code: "WorkflowRuntimeError.finalNodeMismatch",
        message: "The final node must be the only declared node for the one-node agent workflow path.",
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
        message: "Agent nodes must use the Pibo runtime in the one-node agent workflow path.",
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
      message: "Workflow definition cannot run on the one-node agent workflow path.",
    });
  }

  const inputResult = validateWorkflowInput(definition, input);
  if (!inputResult.ok) {
    return runtimeFailure(events, inputResult.diagnostics, {
      code: "WorkflowRuntimeError.invalidInput",
      message: "Workflow input failed validation before execution.",
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
    state: { global: {} },
    createdAt,
    updatedAt: createdAt,
  };

  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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
  };

  await emitWorkflowRuntimeEvent(events, options.emitEvent, {
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

    const prompt = buildAgentNodePrompt(node, input);
    const executorResult = await options.agentExecutor({
      workflow: definition,
      run,
      nodeAttemptId: nodeAttempt.id,
      nodeId,
      node,
      input,
      prompt,
      profileId: profileResolution.profile.id,
      resolvedProfile: profileResolution.profile,
      routing: node.routing,
    });

    const nodeOutputResult = validateNodeOutput(definition, nodeId, executorResult.output);
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
          message: "Agent node output failed validation before workflow completion.",
        },
      });
    }

    const workflowOutputResult = validateWorkflowOutput(definition, executorResult.output);
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

    const runtimeMetadata: RuntimeSelectionMetadata = {
      profileId: executorResult.effectiveProfile ?? profileResolution.profile.id,
      ...(executorResult.effectiveTools ? { tools: executorResult.effectiveTools } : {}),
      ...(executorResult.effectiveSkills ? { skills: executorResult.effectiveSkills } : {}),
      ...(executorResult.effectiveContextFiles ? { contextFiles: executorResult.effectiveContextFiles } : {}),
      ...(node.routing ? { routing: node.routing } : {}),
    };

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = executorResult.output;
    nodeAttempt.completedAt = completedAt;
    nodeAttempt.metadata = {
      runtime: runtimeMetadata,
      ...(executorResult.piboSessionId ? { piboSessionId: executorResult.piboSessionId } : {}),
      ...(executorResult.piSessionId ? { piSessionId: executorResult.piSessionId } : {}),
    };

    await emitWorkflowRuntimeEvent(events, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: executorResult.output,
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);

    run.status = "completed";
    run.current = { nodeId, status: "completed" };
    if (executorResult.piboSessionId) run.piboSessionId = executorResult.piboSessionId;
    if (node.routing?.projectId) run.projectId = node.routing.projectId;
    run.output = executorResult.output;
    run.completedAt = completedAt;
    run.updatedAt = completedAt;

    await emitWorkflowRuntimeEvent(events, options.emitEvent, {
      type: "workflow.completed",
      runId: run.id,
      output: executorResult.output,
    });
    await persistWorkflowRun(options.store, run);

    return { ok: true, run, nodeAttempt, events, output: executorResult.output };
  } catch (caught) {
    return failRunningWorkflow({
      run,
      nodeAttempt,
      events,
      diagnostics: [],
      timestamp,
      store: options.store,
      emitEvent: options.emitEvent,
      error: errorSummaryFromCaught(caught),
    });
  }
}

function createStateReader(
  scope: "global" | "local",
  values: Record<string, JsonValue>,
  node: TypeScriptCodeNodeDefinition,
  nodeId: string,
): WorkflowGlobalStateReader | NodeLocalStateReader {
  return {
    get(path) {
      assertDeclaredStateRead(scope, path, node, nodeId);
      return values[path];
    },
  };
}

function createEdgePayloadReader(payloads: Record<string, WorkflowValue>): EdgePayloadReader {
  return {
    get(edgeId) {
      return payloads[edgeId];
    },
    all() {
      return { ...payloads };
    },
  };
}

function assertDeclaredStateRead(
  scope: "global" | "local",
  path: string,
  node: TypeScriptCodeNodeDefinition,
  nodeId: string,
): void {
  const scopedPath = `${scope}.${path}` as ScopedStatePath;
  if ((node.state?.reads ?? []).includes(scopedPath)) {
    return;
  }

  throw new WorkflowStateAccessViolation({
    code: "WorkflowStateError.undeclaredStateRead",
    message: `Code node handler '${node.handler}' attempted to read undeclared ${scope} state path '${path}'.`,
    severity: "error",
    nodeId,
    path: `$.nodes.${nodeId}.state.reads`,
    hint: `Declare '${scopedPath}' in the code node state.reads list before reading it from handler context.`,
  });
}

function validateCodeNodePatches(
  definition: WorkflowDefinition,
  node: TypeScriptCodeNodeDefinition,
  nodeId: string,
  result: CodeNodeResult,
): WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];
  validateStatePatchWrites("global", result.globalPatch, node, nodeId, diagnostics);
  validateStatePatchWrites("local", result.localPatch, node, nodeId, diagnostics);
  validateGlobalStatePatchValues(definition, nodeId, result.globalPatch, diagnostics);
  return diagnostics;
}

function validateStatePatchWrites(
  scope: "global" | "local",
  patch: StatePatch | undefined,
  node: TypeScriptCodeNodeDefinition,
  nodeId: string,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (!patch) {
    return;
  }

  const declaredWrites = new Set(node.state?.writes ?? []);
  for (const path of Object.keys(patch)) {
    const scopedPath = `${scope}.${path}` as ScopedStatePath;
    if (declaredWrites.has(scopedPath)) {
      continue;
    }

    diagnostics.push({
      code: "WorkflowStateError.undeclaredStateWrite",
      message: `Workflow code node '${nodeId}' attempted to write undeclared ${scope} state path '${path}'.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.state.writes`,
      hint: `Declare '${scopedPath}' in the code node state.writes list before returning it in a state patch.`,
    });
  }
}

function validateGlobalStatePatchValues(
  definition: WorkflowDefinition,
  nodeId: string,
  patch: StatePatch | undefined,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (!patch || !definition.state?.global) {
    return;
  }

  for (const [path, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const field = definition.state.global[path];
    if (!field) {
      continue;
    }

    diagnostics.push(
      ...validateJsonValueAgainstSchema(field.schema, value, {
        path: `$.nodes.${nodeId}.globalPatch.${path}`,
      }).map((diagnostic) => ({ ...diagnostic, nodeId })),
    );
  }
}

function applyCodeNodePatches(
  run: WorkflowRun,
  nodeId: string,
  globalPatch: StatePatch | undefined,
  localPatch: StatePatch | undefined,
): void {
  if (globalPatch) {
    applyStatePatch(run.state.global, globalPatch);
  }

  if (localPatch) {
    run.state.local ??= {};
    run.state.local[nodeId] ??= {};
    applyStatePatch(run.state.local[nodeId], localPatch);
  }
}

function applyStatePatch(target: Record<string, JsonValue>, patch: StatePatch): void {
  for (const [path, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete target[path];
    } else {
      target[path] = value;
    }
  }
}

function toWorkflowCommandArray(command: WorkflowCommand | WorkflowCommand[] | undefined): WorkflowCommand[] {
  if (!command) {
    return [];
  }

  return Array.isArray(command) ? command : [command];
}

async function failAgentNodeDispatch(options: {
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  error: WorkflowErrorSummary;
}): Promise<WorkflowAgentNodeDispatchFailure> {
  const failure = await failNodeDispatch(options);
  return {
    ok: false,
    run: failure.run,
    nodeAttempt: failure.nodeAttempt,
    events: failure.events,
    diagnostics: failure.diagnostics,
    error: failure.error,
  };
}

function agentNodeDispatchFailure(options: {
  run: WorkflowRun;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
}): WorkflowAgentNodeDispatchFailure {
  return {
    ok: false,
    run: options.run,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

async function failCodeNodeDispatch(options: {
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  error: WorkflowErrorSummary;
}): Promise<WorkflowCodeNodeDispatchFailure> {
  const failure = await failNodeDispatch(options);
  return {
    ok: false,
    run: failure.run,
    nodeAttempt: failure.nodeAttempt,
    events: failure.events,
    diagnostics: failure.diagnostics,
    error: failure.error,
  };
}

async function failNestedWorkflowNodeDispatch(options: {
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  error: WorkflowErrorSummary;
  childRun?: WorkflowRun;
}): Promise<WorkflowNestedWorkflowNodeDispatchFailure> {
  const failure = await failNodeDispatch(options);
  return {
    ok: false,
    run: failure.run,
    nodeAttempt: failure.nodeAttempt,
    events: failure.events,
    diagnostics: failure.diagnostics,
    error: failure.error,
    ...(options.childRun ? { childRun: options.childRun } : {}),
  };
}

async function failNodeDispatch(options: {
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  error: WorkflowErrorSummary;
}): Promise<{
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
}> {
  const failedAt = options.timestamp();
  options.nodeAttempt.status = "failed";
  options.nodeAttempt.error = options.error;
  options.nodeAttempt.failedAt = failedAt;
  options.run.status = "failed";
  options.run.current = { nodeId: options.nodeAttempt.nodeId, status: "failed" };
  options.run.failedAt = failedAt;
  options.run.updatedAt = failedAt;
  await emitWorkflowRuntimeEvent(options.events, options.emitEvent, {
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

function codeNodeDispatchFailure(options: {
  run: WorkflowRun;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
}): WorkflowCodeNodeDispatchFailure {
  return {
    ok: false,
    run: options.run,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

function nestedWorkflowNodeDispatchFailure(options: {
  run: WorkflowRun;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
}): WorkflowNestedWorkflowNodeDispatchFailure {
  return {
    ok: false,
    run: options.run,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

async function failAdapterNodeDispatch(options: {
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  error: WorkflowErrorSummary;
}): Promise<WorkflowAdapterNodeDispatchFailure> {
  const failure = await failNodeDispatch(options);
  return {
    ok: false,
    run: failure.run,
    nodeAttempt: failure.nodeAttempt,
    events: failure.events,
    diagnostics: failure.diagnostics,
    error: failure.error,
  };
}

function adapterNodeDispatchFailure(options: {
  run: WorkflowRun;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
}): WorkflowAdapterNodeDispatchFailure {
  return {
    ok: false,
    run: options.run,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

async function failHumanNodeDispatch(options: {
  run: WorkflowRun;
  nodeAttempt: NodeAttempt;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  timestamp: () => string;
  store?: WorkflowRunStore;
  emitEvent?: WorkflowEventEmitter;
  error: WorkflowErrorSummary;
}): Promise<WorkflowHumanNodeDispatchFailure> {
  const failure = await failNodeDispatch(options);
  return {
    ok: false,
    run: failure.run,
    nodeAttempt: failure.nodeAttempt,
    events: failure.events,
    diagnostics: failure.diagnostics,
    error: failure.error,
  };
}

function humanNodeDispatchFailure(options: {
  run: WorkflowRun;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
}): WorkflowHumanNodeDispatchFailure {
  return {
    ok: false,
    run: options.run,
    events: options.events,
    diagnostics: options.diagnostics,
    error: options.error,
  };
}

class WorkflowStateAccessViolation extends Error {
  constructor(readonly diagnostic: WorkflowDiagnostic) {
    super(diagnostic.message);
  }
}

function resolveExecutorTitle(
  title: PiboSessionRoutingAgentExecutorOptions["title"],
  context: OneNodeAgentExecutorContext,
): string | undefined {
  return typeof title === "function" ? title(context) : title;
}

function resolveExecutorMetadata(
  metadata: PiboSessionRoutingAgentExecutorOptions["metadata"],
  context: OneNodeAgentExecutorContext,
): PiboRoutingJsonObject {
  const resolved = typeof metadata === "function" ? metadata(context) : metadata;
  return resolved ?? {};
}

function emitMessageAndWaitForPiboReply(
  routing: PiboWorkflowSessionRouting,
  event: PiboWorkflowMessageEvent,
  timeoutMs = 120000,
): Promise<PiboWorkflowAssistantMessageEvent> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    let unsubscribe = () => {};
    const finish = (result: PiboWorkflowAssistantMessageEvent | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    timeout = setTimeout(() => {
      finish(new Error(`Timed out waiting for assistant reply from Pibo session "${event.piboSessionId}"`));
    }, timeoutMs);
    unsubscribe = routing.subscribe((output) => {
      if (output.piboSessionId !== event.piboSessionId || output.eventId !== event.id) return;
      if (output.type === "assistant_message") {
        finish(output as PiboWorkflowAssistantMessageEvent);
      } else if (output.type === "session_error") {
        finish(new Error((output as PiboWorkflowSessionErrorEvent).error));
      }
    });

    Promise.resolve(routing.emit(event)).catch(finish);
  });
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
  options.run.current = { nodeId: options.nodeAttempt.nodeId, status: "failed" };
  options.run.failedAt = failedAt;
  options.run.updatedAt = failedAt;
  await emitWorkflowRuntimeEvent(options.events, options.emitEvent, {
    type: "node.failed",
    runId: options.run.id,
    nodeAttemptId: options.nodeAttempt.id,
    error: options.error,
  });
  await emitWorkflowRuntimeEvent(options.events, options.emitEvent, {
    type: "workflow.failed",
    runId: options.run.id,
    error: options.error,
  });
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

function edgeTransferFailure(
  diagnostics: WorkflowDiagnostic[],
  error: WorkflowErrorSummary,
): WorkflowEdgeTransferFailure {
  return { ok: false, diagnostics, error };
}

async function emitWorkflowRuntimeEvent(
  events: WorkflowRuntimeEvent[],
  emitEvent: WorkflowEventEmitter | undefined,
  event: WorkflowRuntimeEvent,
): Promise<void> {
  events.push(event);
  await emitEvent?.(event);
}

async function persistWorkflowRun(store: WorkflowRunStore | undefined, run: WorkflowRun): Promise<void> {
  await store?.saveRun(run);
}

async function persistWorkflowNodeAttempt(
  store: WorkflowRunStore | undefined,
  nodeAttempt: NodeAttempt,
): Promise<void> {
  if (!hasWorkflowNodeAttemptStore(store)) {
    return;
  }

  await store.saveNodeAttempt(nodeAttempt);
}

function hasWorkflowNodeAttemptStore(
  store: WorkflowRunStore | undefined,
): store is WorkflowRunStore & Pick<WorkflowNodeAttemptStore, "saveNodeAttempt"> {
  return typeof (store as { saveNodeAttempt?: unknown } | undefined)?.saveNodeAttempt === "function";
}

async function resolveAgentProfileForRuntime(options: {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeId: string;
  node: AgentNodeDefinition;
  resolver?: AgentProfileResolver;
}): Promise<
  | { ok: true; profile: ResolvedAgentProfile }
  | { ok: false; diagnostics: WorkflowDiagnostic[]; error: WorkflowErrorSummary }
> {
  const requestedId = options.node.profile.id;

  if (!options.resolver) {
    return { ok: true, profile: { id: requestedId, requestedId } };
  }

  try {
    const profile = await options.resolver({
      workflow: options.workflow,
      run: options.run,
      nodeId: options.nodeId,
      node: options.node,
      selection: options.node.profile,
    });

    if (!profile || typeof profile.id !== "string" || profile.id.length === 0) {
      const diagnostic: WorkflowDiagnostic = {
        code: "WorkflowRuntimeError.unknownAgentProfile",
        message: `Workflow agent node '${options.nodeId}' references fixed Agent Designer profile '${requestedId}', but profile resolution returned no profile.`,
        severity: "error",
        nodeId: options.nodeId,
        path: `$.nodes.${options.nodeId}.profile.id`,
        hint: "Register the Agent Designer profile before running the workflow or update the node's fixed profile selection.",
      };
      return {
        ok: false,
        diagnostics: [diagnostic],
        error: {
          code: diagnostic.code,
          message: "Agent node dispatch failed before Pibo Runtime creation because profile resolution failed.",
        },
      };
    }

    return {
      ok: true,
      profile: {
        ...profile,
        requestedId: profile.requestedId || requestedId,
      },
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Agent profile resolver failed with a non-Error value.";
    const diagnostic: WorkflowDiagnostic = {
      code: "WorkflowRuntimeError.agentProfileResolutionFailed",
      message: `Workflow agent node '${options.nodeId}' could not resolve fixed Agent Designer profile '${requestedId}': ${message}`,
      severity: "error",
      nodeId: options.nodeId,
      path: `$.nodes.${options.nodeId}.profile.id`,
      hint: "Ensure the workflow runtime is connected to the Agent Designer profile registry before creating the Pibo Runtime.",
    };
    return {
      ok: false,
      diagnostics: [diagnostic],
      error: {
        code: diagnostic.code,
        message: "Agent node dispatch failed before Pibo Runtime creation because profile resolution failed.",
      },
    };
  }
}

function buildAgentNodePrompt(node: AgentNodeDefinition, input: WorkflowValue): string {
  const serializedInput = typeof input === "string" ? input : JSON.stringify(input);
  return node.promptTemplate?.replaceAll("{{input}}", serializedInput) ?? serializedInput;
}

function toNodeIdArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function createTimestampFactory(now: OneNodeAgentWorkflowOptions["now"]): () => string {
  return () => {
    const value = now?.() ?? new Date();
    return typeof value === "string" ? value : value.toISOString();
  };
}

function resolveWaitTokenExpiry(
  timeout: DurationSpec | undefined,
  createdAt: string,
): Pick<WorkflowWaitToken, "expiresAt"> {
  if (!timeout) {
    return {};
  }

  const durationMs = durationSpecToMilliseconds(timeout);
  if (durationMs === undefined) {
    return {};
  }

  return { expiresAt: new Date(new Date(createdAt).getTime() + durationMs).toISOString() };
}

function durationSpecToMilliseconds(duration: DurationSpec): number | undefined {
  switch (duration.kind) {
    case "milliseconds":
      return duration.value;
    case "seconds":
      return duration.value * 1000;
    case "minutes":
      return duration.value * 60_000;
    case "iso8601":
      return parseIso8601DurationMilliseconds(duration.value);
  }
}

function parseIso8601DurationMilliseconds(value: string): number | undefined {
  const match = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function errorSummaryFromCaught(caught: unknown): WorkflowErrorSummary {
  if (caught instanceof Error) {
    return {
      code: "WorkflowRuntimeError.executorFailed",
      message: caught.message,
    };
  }

  return {
    code: "WorkflowRuntimeError.executorFailed",
    message: "Agent executor failed with a non-Error value.",
  };
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
