import type {
  AgentNodeDefinition,
  RuntimeSelectionMetadata,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowRun,
} from "../types/index.js";
import type {
  AgentProfileResolver,
  OneNodeAgentExecutorResult,
  ResolvedAgentProfile,
} from "./pibo-routing.js";

export async function resolveAgentProfileForRuntime(options: {
  workflow: WorkflowDefinition;
  run: WorkflowRun;
  nodeId: string;
  node: AgentNodeDefinition;
  resolver?: AgentProfileResolver;
}): Promise<
  | { ok: true; profile: ResolvedAgentProfile }
  | {
      ok: false;
      diagnostics: WorkflowDiagnostic[];
      error: WorkflowErrorSummary;
    }
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
          message:
            "Agent node dispatch failed before Pibo Runtime creation because profile resolution failed.",
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
    const message =
      caught instanceof Error
        ? caught.message
        : "Agent profile resolver failed with a non-Error value.";
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
        message:
          "Agent node dispatch failed before Pibo Runtime creation because profile resolution failed.",
      },
    };
  }
}

export function linkWorkflowRunToAgentSession(
  run: WorkflowRun,
  node: AgentNodeDefinition,
  executorResult: OneNodeAgentExecutorResult,
): void {
  if (executorResult.piboSessionId)
    run.piboSessionId = executorResult.piboSessionId;
  if (node.routing?.projectId) run.projectId = node.routing.projectId;
}

export function createAgentRuntimeSelectionMetadata(options: {
  run: WorkflowRun;
  node: AgentNodeDefinition;
  profile: ResolvedAgentProfile;
  executorResult: OneNodeAgentExecutorResult;
}): RuntimeSelectionMetadata {
  const tools =
    options.executorResult.effectiveTools ??
    options.profile.tools ??
    options.profile.nativeTools;
  const skills =
    options.executorResult.effectiveSkills ?? options.profile.skills;
  const contextFiles =
    options.executorResult.effectiveContextFiles ??
    options.profile.contextFiles;

  return {
    profileId: options.executorResult.effectiveProfile ?? options.profile.id,
    requestedProfileId: options.profile.requestedId,
    selectedProfile: {
      id: options.profile.id,
      requestedId: options.profile.requestedId,
      ...(options.profile.aliases ? { aliases: options.profile.aliases } : {}),
      ...(options.profile.metadata
        ? { metadata: options.profile.metadata }
        : {}),
    },
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(contextFiles ? { contextFiles } : {}),
    routing: createAgentRuntimeRoutingMetadata(
      options.run,
      options.node.routing,
    ),
  };
}

function createAgentRuntimeRoutingMetadata(
  run: WorkflowRun,
  routing: AgentNodeDefinition["routing"],
): NonNullable<RuntimeSelectionMetadata["routing"]> {
  return {
    ...(routing?.parentSessionId
      ? { parentSessionId: routing.parentSessionId }
      : {}),
    ownerScope: routing?.ownerScope ?? run.ownerScope,
    ...(routing?.projectId ? { projectId: routing.projectId } : {}),
    ...(routing?.roomId ? { roomId: routing.roomId } : {}),
    ...(routing?.channel ? { channel: routing.channel } : {}),
  };
}

export function agentExecutorErrorSummaryFromCaught(
  caught: unknown,
): WorkflowErrorSummary {
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
