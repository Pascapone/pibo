import type {
  AgentNodeDefinition,
  JsonObject,
  NodeAttemptId,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunId,
  WorkflowValue,
} from "../types/index.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";

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

export const PIBO_WORKFLOW_SESSION_KIND_METADATA_KEY = "workflowSessionKind" as const;
export const PIBO_WORKFLOW_SESSION_KINDS = ["main_workflow", "nested_workflow", "agent_node", "subagent"] as const;

export type PiboWorkflowSessionKind = (typeof PIBO_WORKFLOW_SESSION_KINDS)[number];

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
  workflowSessionKind?: PiboWorkflowSessionKind;
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
        [PIBO_WORKFLOW_SESSION_KIND_METADATA_KEY]: "agent_node",
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
        workflowSessionKind: "agent_node",
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
