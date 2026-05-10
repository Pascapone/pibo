import type {
  AgentNodeDefinition,
  NodeAttempt,
  NodeAttemptId,
  RuntimeSelectionMetadata,
  ValidationResult,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowRun,
  WorkflowRunId,
  WorkflowRuntimeEvent,
  WorkflowValue,
} from "../types/index.js";
import type { WorkflowRunStore } from "../store/index.js";
import { validateNodeOutput, validateWorkflow, validateWorkflowInput, validateWorkflowOutput } from "../validation/index.js";

export type OneNodeAgentExecutorContext = {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeAttemptId?: NodeAttemptId;
  nodeId: string;
  node: AgentNodeDefinition;
  input: WorkflowValue;
  prompt: string;
  profileId: string;
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

  try {
    const prompt = buildOneNodeAgentPrompt(node, input);
    const executorResult = await options.agentExecutor({
      workflow: definition,
      run,
      nodeAttemptId: nodeAttempt.id,
      nodeId,
      node,
      input,
      prompt,
      profileId: node.profile.id,
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
      profileId: executorResult.effectiveProfile ?? node.profile.id,
      tools: executorResult.effectiveTools,
      skills: executorResult.effectiveSkills,
      contextFiles: executorResult.effectiveContextFiles,
      routing: node.routing,
    };

    const completedAt = timestamp();
    nodeAttempt.status = "completed";
    nodeAttempt.output = executorResult.output;
    nodeAttempt.completedAt = completedAt;
    nodeAttempt.metadata = {
      runtime: runtimeMetadata,
      piboSessionId: executorResult.piboSessionId,
      piSessionId: executorResult.piSessionId,
    };

    await emitWorkflowRuntimeEvent(events, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      output: executorResult.output,
    });

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

function buildOneNodeAgentPrompt(node: AgentNodeDefinition, input: WorkflowValue): string {
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
