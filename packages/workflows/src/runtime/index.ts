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
  JsonObject,
  JsonValue,
  NestedWorkflowNodeDefinition,
  NodeAttempt,
  NodeAttemptId,
  NodeId,
  NodeLocalStateReader,
  PromptBuilderRef,
  PromptBuilderResult,
  RecordedAgentPrompt,
  RetryBackoffPolicy,
  RetryPolicy,
  RegistryRefId,
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
  WorkflowEventRecord,
  WorkflowGlobalStateReader,
  WorkflowHumanActionId,
  WorkflowHumanActionKind,
  WorkflowHumanActionRecord,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRuntimeEvent,
  WorkflowValue,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
  WorkflowWakeup,
  WorkflowWakeupId,
} from "../types/index.js";
import type {
  WorkflowEdgeTransferStore,
  WorkflowEventStore,
  WorkflowHumanActionStore,
  WorkflowNodeAttemptStore,
  WorkflowRunStore,
  WorkflowWaitTokenStore,
  WorkflowWakeupStore,
} from "../store/index.js";
import {
  resolveWorkflowAdapter,
  resolveWorkflowDefinition,
  resolveWorkflowHandler,
  resolveWorkflowHumanAction,
  resolveWorkflowPromptBuilder,
} from "../registry/index.js";
import {
  validateJsonValueAgainstSchema,
  validateNodeOutput,
  validateWorkflow,
  validateWorkflowEdgeAdapterOutput,
  validateWorkflowGlobalState,
  validateWorkflowInput,
  validateWorkflowOutput,
  validateWorkflowPortValue,
} from "../validation/index.js";

export type ResolvedAgentProfile = {
  id: string;
  requestedId: string;
  aliases?: string[];
  tools?: string[];
  nativeTools?: string[];
  skills?: string[];
  contextFiles?: string[];
  metadata?: JsonObject;
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

export type PiboWorkflowProjectSessionLinkInput = {
  projectId: string;
  piboSessionId: string;
  workflowRunId: WorkflowRunId;
  workflowId: string;
  workflowVersion: string;
  workflowNodeId: string;
  workflowNodeAttemptId?: NodeAttemptId;
  parentPiboSessionId?: string;
  ownerScope: string;
  title?: string;
};

export type PiboWorkflowProjectSessionLinker = (
  input: PiboWorkflowProjectSessionLinkInput,
) => Promise<unknown> | unknown;

export type PiboSessionRoutingAgentExecutorOptions = {
  routing: PiboWorkflowSessionRouting;
  workspace?: string;
  timeoutMs?: number;
  createMessageId?: () => string;
  channel?: string;
  kind?: string;
  title?: string | ((context: OneNodeAgentExecutorContext) => string | undefined);
  metadata?: PiboRoutingJsonObject | ((context: OneNodeAgentExecutorContext) => PiboRoutingJsonObject | undefined);
  linkProjectSession?: PiboWorkflowProjectSessionLinker;
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

export type WorkflowNodeRetryDecision =
  | {
      kind: "retry";
      policy: RetryPolicy;
      currentAttempt: number;
      nextAttempt: number;
      maxAttempts: number;
      availableAt: string;
      delayMs: number;
    }
  | {
      kind: "exhausted";
      policy: RetryPolicy;
      currentAttempt: number;
      maxAttempts: number;
      error: WorkflowErrorSummary;
    }
  | {
      kind: "none";
      reason: "no_policy" | "not_retryable" | "retry_on_mismatch";
    };

export type WorkflowNodeRetryDecisionOptions = {
  workflow: Pick<WorkflowDefinition, "retry">;
  node: WorkflowDefinition["nodes"][string];
  nodeAttempt: Pick<NodeAttempt, "attempt">;
  error: WorkflowErrorSummary;
  now?: () => Date | string;
};

export function resolveWorkflowRetryPolicy(
  workflow: Pick<WorkflowDefinition, "retry">,
  node: WorkflowDefinition["nodes"][string],
): RetryPolicy | undefined {
  return node.retry ?? workflow.retry;
}

export function decideWorkflowNodeRetry(options: WorkflowNodeRetryDecisionOptions): WorkflowNodeRetryDecision {
  const policy = resolveWorkflowRetryPolicy(options.workflow, options.node);
  if (!policy) {
    return { kind: "none", reason: "no_policy" };
  }

  if (options.error.retryable === false) {
    return { kind: "none", reason: "not_retryable" };
  }

  if (policy.retryOn && !policy.retryOn.includes(options.error.code)) {
    return { kind: "none", reason: "retry_on_mismatch" };
  }

  const currentAttempt = options.nodeAttempt.attempt;
  if (currentAttempt >= policy.maxAttempts) {
    return {
      kind: "exhausted",
      policy,
      currentAttempt,
      maxAttempts: policy.maxAttempts,
      error: {
        code: "WorkflowRetryExhaustedError.maxAttemptsExceeded",
        message: `Workflow node retry policy exhausted after ${currentAttempt} attempt${currentAttempt === 1 ? "" : "s"} (maxAttempts: ${policy.maxAttempts}).`,
        retryable: false,
        details: { originalCode: options.error.code, maxAttempts: policy.maxAttempts },
      },
    };
  }

  const nextAttempt = currentAttempt + 1;
  const delayMs = calculateRetryDelayMs(policy.backoff, nextAttempt);
  const availableAt = new Date(timestampToMillis(options.now?.() ?? new Date()) + delayMs).toISOString();

  return {
    kind: "retry",
    policy,
    currentAttempt,
    nextAttempt,
    maxAttempts: policy.maxAttempts,
    availableAt,
    delayMs,
  };
}

export function createRetryScheduledNodeAttempt(
  previousAttempt: NodeAttempt,
  decision: Extract<WorkflowNodeRetryDecision, { kind: "retry" }>,
  options: { id?: NodeAttemptId; error?: WorkflowErrorSummary } = {},
): NodeAttempt {
  return {
    ...previousAttempt,
    id: options.id ?? createId("wna"),
    attempt: decision.nextAttempt,
    status: "retry_scheduled",
    error: options.error ?? previousAttempt.error,
    availableAt: decision.availableAt,
    startedAt: undefined,
    heartbeatAt: undefined,
    completedAt: undefined,
    failedAt: undefined,
    lease: undefined,
  };
}

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

export type WorkflowHumanActionDecisionKind = "approved" | "rejected" | "submitted" | "cancelled";

export type WorkflowHumanActionApplyRequest = {
  waitTokenId: WorkflowWaitTokenId;
  actionId?: RegistryRefId;
  kind?: WorkflowHumanActionKind;
  actor?: JsonObject;
  payload?: WorkflowValue;
};

export type WorkflowHumanActionApplyOptions = {
  registry: Pick<WorkflowRegistry, "humanActions">;
  store: WorkflowRunStore & WorkflowWaitTokenStore & WorkflowHumanActionStore;
  now?: () => Date | string;
  createHumanActionId?: () => WorkflowHumanActionId;
  createWakeupId?: () => WorkflowWakeupId;
  emitEvent?: WorkflowEventEmitter;
};

export type WorkflowHumanActionApplySuccess = {
  ok: true;
  run: WorkflowRun;
  waitToken: WorkflowWaitToken;
  humanAction: WorkflowHumanActionRecord;
  events: WorkflowRuntimeEvent[];
  decision: {
    kind: WorkflowHumanActionDecisionKind;
    actionId: RegistryRefId;
    actionKind: WorkflowHumanActionKind;
  };
  wakeup?: WorkflowWakeup;
  nodeAttempt?: NodeAttempt;
};

export type WorkflowHumanActionApplyFailure = {
  ok: false;
  run: WorkflowRun;
  waitToken?: WorkflowWaitToken;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowHumanActionApplyResult = WorkflowHumanActionApplySuccess | WorkflowHumanActionApplyFailure;

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
    const ownerScope = context.routing?.ownerScope ?? context.run.ownerScope;
    const title = resolveExecutorTitle(options.title, context);
    const session = options.routing.createSession({
      channel: options.channel ?? context.routing?.channel ?? "pibo.workflows",
      kind: options.kind ?? "workflow-agent",
      profile: context.profileId,
      ownerScope,
      parentId: context.routing?.parentSessionId,
      workspace: options.workspace,
      title,
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
    if (context.routing?.projectId && options.linkProjectSession) {
      await options.linkProjectSession({
        projectId: context.routing.projectId,
        piboSessionId: session.id,
        workflowRunId: context.run.id,
        workflowId: context.workflow.id,
        workflowVersion: context.workflow.version,
        workflowNodeId: context.nodeId,
        ...(context.nodeAttemptId ? { workflowNodeAttemptId: context.nodeAttemptId } : {}),
        ...(context.routing.parentSessionId ? { parentPiboSessionId: context.routing.parentSessionId } : {}),
        ownerScope,
        ...(title ? { title } : {}),
      });
    }
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

export async function applyWorkflowHumanAction(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  request: WorkflowHumanActionApplyRequest,
  options: WorkflowHumanActionApplyOptions,
): Promise<WorkflowHumanActionApplyResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const actedAt = timestamp();
  const diagnostics: WorkflowDiagnostic[] = [];
  const waitToken = await options.store.getWaitToken(request.waitTokenId);

  if (!waitToken) {
    diagnostics.push({
      code: "WorkflowRuntimeError.unknownWaitToken",
      message: `Workflow wait token '${request.waitTokenId}' does not exist, so no human action can be applied.`,
      severity: "error",
      path: "$.waitTokenId",
      hint: "Submit human actions only for pending wait tokens returned by workflow inspection.",
    });
    return humanActionApplyFailure(run, events, diagnostics, {
      code: "WorkflowRuntimeError.unknownWaitToken",
      message: "Human action failed because the wait token was not found.",
    });
  }

  if (waitToken.workflowRunId !== run.id) {
    diagnostics.push({
      code: "WorkflowRuntimeError.waitTokenRunMismatch",
      message: `Workflow wait token '${waitToken.id}' belongs to run '${waitToken.workflowRunId}', not run '${run.id}'.`,
      severity: "error",
      path: "$.waitTokenId",
      hint: "Load and update the workflow run that owns the wait token.",
    });
  }

  if (waitToken.status !== "pending") {
    diagnostics.push({
      code: "WorkflowRuntimeError.waitTokenNotPending",
      message: `Workflow wait token '${waitToken.id}' is '${waitToken.status}' and cannot accept another human action.`,
      severity: "error",
      path: "$.waitToken.status",
      hint: "Human wait tokens can only be resolved once while they are pending.",
    });
  }

  if (waitToken.expiresAt && timestampToMillis(waitToken.expiresAt) <= timestampToMillis(actedAt)) {
    waitToken.status = "expired";
    waitToken.resumedAt = actedAt;
    await options.store.saveWaitToken(waitToken);
    diagnostics.push({
      code: "WorkflowRuntimeError.waitTokenExpired",
      message: `Workflow wait token '${waitToken.id}' expired at ${waitToken.expiresAt}.`,
      severity: "error",
      path: "$.waitToken.expiresAt",
      hint: "Create a new human wait or route timeout handling before submitting an action.",
    });
  }

  const actionRef = resolveRequestedHumanActionRef(waitToken, request);
  if (!actionRef) {
    diagnostics.push({
      code: "WorkflowRuntimeError.humanActionUnavailable",
      message: request.actionId
        ? `Workflow wait token '${waitToken.id}' does not offer human action '${request.actionId}'.`
        : `Workflow wait token '${waitToken.id}' does not offer a human action of kind '${request.kind ?? "<missing>"}'.`,
      severity: "error",
      path: request.actionId ? "$.actionId" : "$.kind",
      hint: "Use one of the wait token's available action refs.",
    });
  }

  const actionDefinition = actionRef ? resolveWorkflowHumanAction(options.registry, actionRef.id) : undefined;
  if (actionRef && !actionDefinition) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownHumanActionRef",
      message: `Workflow wait token '${waitToken.id}' references human action '${actionRef.id}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      path: "$.waitToken.actions",
      hint: "Register the action with registerWorkflowHumanAction/createWorkflowRegistry before accepting it.",
    });
  }

  if (actionRef?.kind && actionDefinition && actionRef.kind !== actionDefinition.kind) {
    diagnostics.push({
      code: "WorkflowGraphError.humanActionKindMismatch",
      message: `Workflow wait token '${waitToken.id}' action '${actionRef.id}' declares kind '${actionRef.kind}', but the registry defines kind '${actionDefinition.kind}'.`,
      severity: "error",
      path: "$.waitToken.actions",
      hint: "Keep human action refs aligned with their registered action definitions.",
    });
  }

  if (actionDefinition && request.payload !== undefined) {
    const actionPort = actionDefinition.input ?? actionDefinition.output;
    if (actionPort) {
      diagnostics.push(
        ...validateWorkflowPortValue(actionPort, request.payload, { path: "$.payload" }).diagnostics,
      );
    }
  }

  if (actionDefinition?.kind === "resume" && waitToken.schema) {
    diagnostics.push(
      ...validateJsonValueAgainstSchema(waitToken.schema, request.payload, { path: "$.payload" }),
    );
  }

  if (waitToken.humanNodeId && request.payload !== undefined) {
    const nodeOutputResult = validateNodeOutput(definition, waitToken.humanNodeId, request.payload, {
      path: "$.payload",
    });
    diagnostics.push(...nodeOutputResult.diagnostics.map((diagnostic) => ({ ...diagnostic, nodeId: waitToken.humanNodeId })));
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return humanActionApplyFailure(run, events, diagnostics, {
      code: "WorkflowRuntimeError.humanActionRejected",
      message: "Human action failed validation before resolving the wait token.",
    }, waitToken);
  }

  const actionKind = actionDefinition!.kind;
  const humanAction: WorkflowHumanActionRecord = {
    id: options.createHumanActionId?.() ?? createId("wha"),
    workflowRunId: run.id,
    waitTokenId: waitToken.id,
    kind: actionKind,
    ...(request.actor ? { actor: request.actor } : {}),
    ...(request.payload !== undefined ? { payload: request.payload } : {}),
    createdAt: actedAt,
  };
  await options.store.saveHumanAction(humanAction);

  const nodeAttempt = waitToken.nodeAttemptId && hasWorkflowNodeAttemptReadStore(options.store)
    ? await options.store.getNodeAttempt(waitToken.nodeAttemptId)
    : undefined;

  if (actionKind === "cancel") {
    waitToken.status = "cancelled";
    waitToken.resumedAt = actedAt;
    run.status = "cancelled";
    run.current = { ...(run.current.nodeId ? { nodeId: run.current.nodeId } : {}), status: "cancelled" };
    run.cancelledAt = actedAt;
    run.updatedAt = actedAt;
    if (nodeAttempt) {
      nodeAttempt.status = "cancelled";
      nodeAttempt.completedAt = actedAt;
    }

    await options.store.saveWaitToken(waitToken);
    if (nodeAttempt) {
      await persistWorkflowNodeAttempt(options.store, nodeAttempt);
    }
    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "workflow.cancelled",
      runId: run.id,
      reason: "human action cancelled workflow",
    });
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      waitToken,
      humanAction,
      events,
      decision: { kind: "cancelled", actionId: actionDefinition!.id, actionKind },
      ...(nodeAttempt ? { nodeAttempt } : {}),
    };
  }

  waitToken.status = "resumed";
  if (request.payload !== undefined) {
    waitToken.resumePayload = request.payload;
  }
  waitToken.resumedAt = actedAt;
  run.status = "running";
  run.current = { ...(waitToken.humanNodeId ? { nodeId: waitToken.humanNodeId } : {}), status: "running" };
  run.updatedAt = actedAt;
  if (nodeAttempt) {
    nodeAttempt.status = "completed";
    if (request.payload !== undefined) {
      nodeAttempt.output = request.payload;
    }
    nodeAttempt.completedAt = actedAt;
  }

  const wakeup: WorkflowWakeup | undefined = hasWorkflowWakeupStore(options.store)
    ? {
        id: options.createWakeupId?.() ?? createId("wwu"),
        workflowRunId: run.id,
        ...(waitToken.nodeAttemptId ? { nodeAttemptId: waitToken.nodeAttemptId } : {}),
        kind: "human",
        availableAt: actedAt,
        correlationId: humanAction.id,
        ...(request.payload !== undefined ? { payload: request.payload } : {}),
        createdAt: actedAt,
      }
    : undefined;

  await options.store.saveWaitToken(waitToken);
  if (wakeup && hasWorkflowWakeupStore(options.store)) {
    await options.store.saveWakeup(wakeup);
  }
  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "wait.resumed",
    runId: run.id,
    waitTokenId: waitToken.id,
    ...(request.payload !== undefined ? { payload: request.payload } : {}),
  });
  if (nodeAttempt) {
    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      ...(request.payload !== undefined ? { output: request.payload } : {}),
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);
  }
  await persistWorkflowRun(options.store, run);

  return {
    ok: true,
    run,
    waitToken,
    humanAction,
    events,
    decision: { kind: decisionKindForHumanAction(actionKind), actionId: actionDefinition!.id, actionKind },
    ...(wakeup ? { wakeup } : {}),
    ...(nodeAttempt ? { nodeAttempt } : {}),
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
    const adapterResult = await adapter!.value({ input: payload, edge, run: createWorkflowRunWithoutLocalState(run) });
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

  const initialGlobalState = { ...(options.initialGlobalState ?? {}) };
  const globalStateResult = validateWorkflowGlobalState(definition, initialGlobalState);
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
    state: createInitialWorkflowRunState(initialGlobalState, options.initialLocalState),
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
      ...(executorResult.piboSessionId ? { piboSessionId: executorResult.piboSessionId } : {}),
      ...(executorResult.piSessionId ? { piSessionId: executorResult.piSessionId } : {}),
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

function createInitialWorkflowRunState(
  global: Record<string, JsonValue>,
  local?: Record<NodeId, Record<string, JsonValue>>,
): WorkflowRun["state"] {
  const localState = cloneLocalStateMap(local);
  return localState ? { global: { ...global }, local: localState } : { global: { ...global } };
}

function localStateSnapshotForNode(run: WorkflowRun, nodeId: string): Pick<NodeAttempt, "localState"> {
  const localState = cloneLocalStateForNode(run, nodeId);
  return localState ? { localState } : {};
}

function cloneLocalStateForNode(run: WorkflowRun, nodeId: string): Record<string, JsonValue> | undefined {
  const localState = run.state.local?.[nodeId];
  return localState === undefined ? undefined : structuredClone(localState) as Record<string, JsonValue>;
}

function cloneLocalStateMap(
  local: Record<NodeId, Record<string, JsonValue>> | undefined,
): Record<NodeId, Record<string, JsonValue>> | undefined {
  if (!local) {
    return undefined;
  }

  const entries = Object.entries(local);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    entries.map(([nodeId, nodeState]) => [nodeId, structuredClone(nodeState) as Record<string, JsonValue>]),
  );
}

function createNodeScopedWorkflowRun(run: WorkflowRun, nodeId: string): WorkflowRun {
  return {
    ...run,
    state: createNodeScopedWorkflowRunState(run, nodeId),
  };
}

function createWorkflowRunWithoutLocalState(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    state: { global: run.state.global },
  };
}

function createNodeScopedWorkflowRunState(run: WorkflowRun, nodeId: string): WorkflowRun["state"] {
  const localState = cloneLocalStateForNode(run, nodeId);
  return localState ? { global: run.state.global, local: { [nodeId]: localState } } : { global: run.state.global };
}

function createCurrentNodeStateView(state: WorkflowRun["state"], nodeId: string): WorkflowRun["state"] {
  const localState = state.local?.[nodeId];
  return localState
    ? { global: state.global, local: { [nodeId]: structuredClone(localState) as Record<string, JsonValue> } }
    : { global: state.global };
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
  await emitWorkflowRuntimeEvent(options.events, options.store, options.emitEvent, {
    type: "node.failed",
    runId: options.run.id,
    nodeAttemptId: options.nodeAttempt.id,
    error: options.error,
  });
  await emitWorkflowRuntimeEvent(options.events, options.store, options.emitEvent, {
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

function humanActionApplyFailure(
  run: WorkflowRun,
  events: WorkflowRuntimeEvent[],
  diagnostics: WorkflowDiagnostic[],
  error: WorkflowErrorSummary,
  waitToken?: WorkflowWaitToken,
): WorkflowHumanActionApplyFailure {
  return { ok: false, run, events, diagnostics, error, ...(waitToken ? { waitToken } : {}) };
}

function resolveRequestedHumanActionRef(
  waitToken: WorkflowWaitToken,
  request: WorkflowHumanActionApplyRequest,
): WorkflowWaitToken["actions"][number] | undefined {
  if (request.actionId) {
    return waitToken.actions.find((action) => action.id === request.actionId);
  }

  if (request.kind) {
    return waitToken.actions.find((action) => action.kind === request.kind);
  }

  return undefined;
}

function decisionKindForHumanAction(kind: WorkflowHumanActionKind): WorkflowHumanActionDecisionKind {
  if (kind === "approve") return "approved";
  if (kind === "reject") return "rejected";
  if (kind === "cancel") return "cancelled";
  return "submitted";
}

async function emitWorkflowRuntimeEvent(
  events: WorkflowRuntimeEvent[],
  store: WorkflowRunStore | undefined,
  emitEvent: WorkflowEventEmitter | undefined,
  event: WorkflowRuntimeEvent,
): Promise<void> {
  events.push(event);
  await persistWorkflowEvent(store, event);
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

async function persistWorkflowEdgeTransfer(
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

function hasWorkflowWakeupStore(
  store: WorkflowRunStore | undefined,
): store is WorkflowRunStore & Pick<WorkflowWakeupStore, "saveWakeup"> {
  return typeof (store as { saveWakeup?: unknown } | undefined)?.saveWakeup === "function";
}

function hasWorkflowNodeAttemptReadStore(
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

function linkWorkflowRunToAgentSession(
  run: WorkflowRun,
  node: AgentNodeDefinition,
  executorResult: OneNodeAgentExecutorResult,
): void {
  if (executorResult.piboSessionId) run.piboSessionId = executorResult.piboSessionId;
  if (node.routing?.projectId) run.projectId = node.routing.projectId;
}

function createAgentRuntimeSelectionMetadata(options: {
  run: WorkflowRun;
  node: AgentNodeDefinition;
  profile: ResolvedAgentProfile;
  executorResult: OneNodeAgentExecutorResult;
}): RuntimeSelectionMetadata {
  const tools = options.executorResult.effectiveTools ?? options.profile.tools ?? options.profile.nativeTools;
  const skills = options.executorResult.effectiveSkills ?? options.profile.skills;
  const contextFiles = options.executorResult.effectiveContextFiles ?? options.profile.contextFiles;

  return {
    profileId: options.executorResult.effectiveProfile ?? options.profile.id,
    requestedProfileId: options.profile.requestedId,
    selectedProfile: {
      id: options.profile.id,
      requestedId: options.profile.requestedId,
      ...(options.profile.aliases ? { aliases: options.profile.aliases } : {}),
      ...(options.profile.metadata ? { metadata: options.profile.metadata } : {}),
    },
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(contextFiles ? { contextFiles } : {}),
    routing: createAgentRuntimeRoutingMetadata(options.run, options.node.routing),
  };
}

function createAgentRuntimeRoutingMetadata(
  run: WorkflowRun,
  routing: AgentNodeDefinition["routing"],
): NonNullable<RuntimeSelectionMetadata["routing"]> {
  return {
    ...(routing?.parentSessionId ? { parentSessionId: routing.parentSessionId } : {}),
    ownerScope: routing?.ownerScope ?? run.ownerScope,
    ...(routing?.projectId ? { projectId: routing.projectId } : {}),
    ...(routing?.roomId ? { roomId: routing.roomId } : {}),
    ...(routing?.channel ? { channel: routing.channel } : {}),
  };
}

type AgentNodePromptBuildResult =
  | { ok: true; prompt: string; recordedPrompt: RecordedAgentPrompt }
  | { ok: false; diagnostics: WorkflowDiagnostic[]; error: WorkflowErrorSummary };

type AgentNodePromptBuildOptions = {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeId: string;
  registry?: Pick<WorkflowRegistry, "promptBuilders">;
  edgePayloads?: Record<string, WorkflowValue>;
};

async function buildAgentNodePrompt(
  node: AgentNodeDefinition,
  input: WorkflowValue,
  options: AgentNodePromptBuildOptions,
): Promise<AgentNodePromptBuildResult> {
  if (node.promptBuilder !== undefined) {
    return buildAgentNodePromptWithRegisteredBuilder(node, input, options);
  }

  if (!node.promptTemplate) {
    const prompt = formatPromptTemplateValue(input);
    return { ok: true, prompt, recordedPrompt: createRecordedAgentPrompt(prompt, "input") };
  }

  const prompt = renderPromptTemplate(node.promptTemplate, {
    input,
    state: options.run.state,
    nodeId: options.nodeId,
  });
  return {
    ok: true,
    prompt,
    recordedPrompt: createRecordedAgentPrompt(prompt, "promptTemplate"),
  };
}

async function buildAgentNodePromptWithRegisteredBuilder(
  node: AgentNodeDefinition,
  input: WorkflowValue,
  options: AgentNodePromptBuildOptions,
): Promise<AgentNodePromptBuildResult> {
  const builderId = getPromptBuilderRefId(node.promptBuilder!);
  const builder = builderId && options.registry
    ? resolveWorkflowPromptBuilder(options.registry, node.promptBuilder!)
    : undefined;

  if (!builderId || !builder) {
    const diagnostic: WorkflowDiagnostic = {
      code: "WorkflowRuntimeError.unknownPromptBuilderRef",
      message: `Workflow agent node '${options.nodeId}' references prompt builder '${builderId ?? "<invalid>"}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId: options.nodeId,
      path: getPromptBuilderRefPath(node.promptBuilder!, options.nodeId),
      hint: "Pass a Workflow Registry with the prompt builder registered before dispatching an agent node with promptBuilder.",
    };
    return {
      ok: false,
      diagnostics: [diagnostic],
      error: {
        code: diagnostic.code,
        message: "Agent node dispatch failed before Pibo Runtime execution because prompt builder resolution failed.",
      },
    };
  }

  try {
    const result = await builder.value({
      input,
      state: createCurrentNodeStateView(options.run.state, options.nodeId),
      global: createPromptBuilderStateReader(options.run.state.global),
      local: createPromptBuilderStateReader(options.run.state.local?.[options.nodeId] ?? {}),
      edge: createEdgePayloadReader(options.edgePayloads ?? {}),
      node,
      nodeId: options.nodeId,
      run: createNodeScopedWorkflowRun(options.run, options.nodeId),
      workflow: options.workflow,
    });
    const normalized = normalizePromptBuilderResult(result);
    if (normalized !== undefined) {
      return {
        ok: true,
        prompt: normalized.prompt,
        recordedPrompt: createRecordedAgentPrompt(normalized.prompt, "promptBuilder", {
          promptBuilderId: builderId,
          builderMetadata: normalized.metadata,
        }),
      };
    }

    const diagnostic: WorkflowDiagnostic = {
      code: "WorkflowRuntimeError.invalidPromptBuilderResult",
      message: `Workflow prompt builder '${builderId}' for agent node '${options.nodeId}' returned an invalid prompt result.`,
      severity: "error",
      nodeId: options.nodeId,
      path: getPromptBuilderRefPath(node.promptBuilder!, options.nodeId),
      hint: "Return a prompt string or an object with a string prompt property from the registered prompt builder.",
    };
    return {
      ok: false,
      diagnostics: [diagnostic],
      error: {
        code: diagnostic.code,
        message: "Agent node dispatch failed before Pibo Runtime execution because prompt builder output was invalid.",
      },
    };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Prompt builder failed with a non-Error value.";
    const diagnostic: WorkflowDiagnostic = {
      code: "WorkflowRuntimeError.promptBuilderFailed",
      message: `Workflow prompt builder '${builderId}' for agent node '${options.nodeId}' failed: ${message}`,
      severity: "error",
      nodeId: options.nodeId,
      path: getPromptBuilderRefPath(node.promptBuilder!, options.nodeId),
      hint: "Fix the registered prompt builder implementation or replace the promptBuilder ref.",
    };
    return {
      ok: false,
      diagnostics: [diagnostic],
      error: {
        code: diagnostic.code,
        message: "Agent node dispatch failed before Pibo Runtime execution because prompt builder execution failed.",
      },
    };
  }
}

function normalizePromptBuilderResult(
  result: PromptBuilderResult | unknown,
): { prompt: string; metadata?: Record<string, JsonValue> } | undefined {
  if (typeof result === "string") {
    return { prompt: result };
  }

  if (isPromptTemplateObject(result) && typeof result.prompt === "string") {
    const metadata = isJsonObject(result.metadata) ? result.metadata : undefined;
    return {
      prompt: result.prompt,
      ...(metadata ? { metadata } : {}),
    };
  }

  return undefined;
}

function createRecordedAgentPrompt(
  text: string,
  source: RecordedAgentPrompt["source"],
  options: Pick<RecordedAgentPrompt, "promptBuilderId" | "builderMetadata"> = {},
): RecordedAgentPrompt {
  return {
    text,
    source,
    tracePrivacy: {
      kind: "ownerScope",
      storage: "workflow-node-attempt",
      redacted: false,
    },
    ...(options.promptBuilderId ? { promptBuilderId: options.promptBuilderId } : {}),
    ...(options.builderMetadata ? { builderMetadata: options.builderMetadata } : {}),
  };
}

function recordFinalAgentPrompt(nodeAttempt: NodeAttempt, prompt: RecordedAgentPrompt): void {
  nodeAttempt.metadata = {
    ...nodeAttempt.metadata,
    finalPrompt: prompt,
  };
}

function createPromptBuilderStateReader(values: Record<string, JsonValue>): WorkflowGlobalStateReader | NodeLocalStateReader {
  return {
    get(path) {
      return values[path];
    },
  };
}

function getPromptBuilderRefId(ref: PromptBuilderRef): string | undefined {
  if (typeof ref === "string") {
    return ref.length > 0 ? ref : undefined;
  }

  return ref.kind === "promptBuilder" && ref.language === "typescript" && ref.id.length > 0 ? ref.id : undefined;
}

function getPromptBuilderRefPath(ref: PromptBuilderRef, nodeId: string): string {
  return typeof ref === "string" ? `$.nodes.${nodeId}.promptBuilder` : `$.nodes.${nodeId}.promptBuilder.id`;
}

type PromptTemplateRenderContext = {
  input: WorkflowValue;
  state: WorkflowRun["state"];
  nodeId: string;
};

function renderPromptTemplate(template: string, context: PromptTemplateRenderContext): string {
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (placeholder, expression: string) => {
    const resolved = resolvePromptTemplateExpression(expression.trim(), context);
    return resolved === undefined ? placeholder : formatPromptTemplateValue(resolved);
  });
}

function resolvePromptTemplateExpression(
  expression: string,
  context: PromptTemplateRenderContext,
): WorkflowValue | JsonValue | undefined {
  const path = expression.split(".").map((part) => part.trim()).filter(Boolean);
  const [root, ...rest] = path;

  if (!root) {
    return undefined;
  }

  if (root === "input") {
    return resolvePromptTemplatePath(context.input, rest);
  }

  if (root === "global") {
    return resolvePromptTemplatePath(context.state.global, rest);
  }

  if (root === "local") {
    return resolvePromptTemplatePath(context.state.local?.[context.nodeId] ?? {}, rest);
  }

  if (root === "state") {
    if (rest.length === 0) {
      return createCurrentNodeStateView(context.state, context.nodeId) as JsonValue;
    }

    const [scope, ...statePath] = rest;
    if (scope === "global") {
      return resolvePromptTemplatePath(context.state.global, statePath);
    }

    if (scope === "local") {
      return resolvePromptTemplatePath(context.state.local?.[context.nodeId] ?? {}, statePath);
    }

    return resolvePromptTemplatePath(context.state.global, rest);
  }

  return undefined;
}

function resolvePromptTemplatePath(value: unknown, path: string[]): WorkflowValue | JsonValue | undefined {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isPromptTemplateObject(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return isPromptTemplateValue(current) ? current : undefined;
}

function formatPromptTemplateValue(value: WorkflowValue | JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isPromptTemplateObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return isPromptTemplateObject(value) && Object.values(value).every(isPromptTemplateValue);
}

function isPromptTemplateValue(value: unknown): value is WorkflowValue | JsonValue {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return true;
    case "object":
      if (Array.isArray(value)) {
        return value.every(isPromptTemplateValue);
      }
      return Object.values(value).every(isPromptTemplateValue);
    default:
      return false;
  }
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

function calculateRetryDelayMs(backoff: RetryBackoffPolicy | undefined, nextAttempt: number): number {
  if (!backoff || backoff.kind === "none") {
    return 0;
  }

  if (backoff.kind === "fixed") {
    return backoff.delayMs;
  }

  if (backoff.kind === "linear") {
    return capRetryDelay(backoff.initialMs + Math.max(0, nextAttempt - 2) * backoff.stepMs, backoff.maxMs);
  }

  const factor = backoff.factor ?? 2;
  return capRetryDelay(backoff.initialMs * factor ** Math.max(0, nextAttempt - 2), backoff.maxMs);
}

function capRetryDelay(delayMs: number, maxMs: number | undefined): number {
  if (maxMs === undefined) {
    return delayMs;
  }

  return Math.min(delayMs, maxMs);
}

function timestampToMillis(value: Date | string): number {
  return typeof value === "string" ? new Date(value).getTime() : value.getTime();
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
