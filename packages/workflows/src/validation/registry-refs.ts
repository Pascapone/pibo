import type {
  AdapterRef,
  GuardRef,
  PromptBuilderRef,
  WorkflowDiagnostic,
  WorkflowEdgeDefinition,
  WorkflowHumanActionRef,
  WorkflowNodeDefinition,
  WorkflowRegistry,
} from "../types/index.js";

export type WorkflowValidationOptions = {
  registry?: Partial<Pick<WorkflowRegistry, "adapters" | "guards" | "handlers" | "profiles" | "promptBuilders" | "humanActions">>;
};

export function isValidGuardRef(guard: GuardRef | undefined): guard is GuardRef {
  return isRecord(guard) && typeof guard.handler === "string" && guard.handler.length > 0;
}

export function validateWorkflowEdgeGuardRef(
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (!edge.guard) {
    return;
  }

  validateWorkflowGuardRef(edge.guard, diagnostics, options, {
    edgeId,
    path: `$.edges.${edgeId}.guard.handler`,
    diagnosticLabel: `Workflow edge '${edgeId}'`,
  });
}

export function validateWorkflowGuardRef(
  guard: GuardRef,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
  target: Pick<WorkflowDiagnostic, "edgeId"> & { path: string; diagnosticLabel: string },
): void {
  if (!isRecord(guard) || typeof guard.handler !== "string" || guard.handler.length === 0) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidGuardRef",
      message: `${target.diagnosticLabel} must use a registered guard handler ref.`,
      severity: "error",
      edgeId: target.edgeId,
      path: target.path,
      hint: "Use guard: { handler: 'guard.id' } with a non-empty registered guard id.",
    });
    return;
  }

  if (guard.priority !== undefined && (!Number.isInteger(guard.priority) || guard.priority < 0)) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidGuardPriority",
      message: `${target.diagnosticLabel} guard priority must be a non-negative integer when declared.`,
      severity: "error",
      edgeId: target.edgeId,
      path: target.path.replace(/\.handler$/, ".priority"),
      hint: "Use priority to make multiple guarded outgoing edges deterministic.",
    });
  }

  if (!options.registry?.guards || options.registry.guards.has(guard.handler)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.unknownGuardRef",
    message: `${target.diagnosticLabel} references guard '${guard.handler}', but it is not registered in the Workflow Registry.`,
    severity: "error",
    edgeId: target.edgeId,
    path: target.path,
    registryRef: guard.handler,
    hint: "Register the guard with registerWorkflowGuard/createWorkflowRegistry before validating or executing this workflow, or update the workflow to use a registered guard id.",
  });
}

export function validateWorkflowAgentNodeRuntimeSelection(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "agent") {
    return;
  }

  const rawNode = node as unknown as Record<string, unknown>;
  if (rawNode.runtime !== "pibo") {
    diagnostics.push({
      code: "WorkflowGraphError.invalidAgentRuntimeSelection",
      message: `Workflow agent node '${nodeId}' must select the Pibo Runtime in V1.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.runtime`,
      hint: "Set runtime: 'pibo'. V1 workflow agent nodes cannot select alternate runtimes.",
    });
  }

  const profile = rawNode.profile;
  const profileId =
    isRecord(profile) && profile.kind === "fixed" && typeof profile.id === "string" && profile.id.length > 0
      ? profile.id
      : undefined;

  if (!profileId) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidAgentProfileSelection",
      message: `Workflow agent node '${nodeId}' must select a fixed Agent Designer profile in V1.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.profile`,
      hint: "Use fixedProfile('pibo-agent') or { kind: 'fixed', id: 'profile-id' }. Dynamic profile selection is not supported in V1.",
    });
    return;
  }

  if (!options.registry?.profiles) {
    return;
  }

  const registeredProfile = options.registry.profiles.get(profileId);
  if (!registeredProfile) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownAgentProfileRef",
      message: `Workflow agent node '${nodeId}' references Agent Designer profile '${profileId}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.profile.id`,
      registryRef: profileId,
      hint: "Register the Agent Designer profile with registerWorkflowAgentProfile/createWorkflowRegistry before validating or executing this workflow, or update the node to use a registered fixed profile id.",
    });
    return;
  }

  if (isArchivedAgentProfileDefinition(registeredProfile.value)) {
    diagnostics.push({
      code: "WorkflowGraphError.archivedAgentProfileRef",
      message: `Workflow agent node '${nodeId}' references archived Agent Designer profile '${profileId}'.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.profile.id`,
      registryRef: profileId,
      hint: "Restore the Agent Designer profile or update the node to select a non-archived fixed profile id before publishing or running this workflow.",
    });
  }
}

function isArchivedAgentProfileDefinition(profile: { status?: string; archivedAt?: string; metadata?: unknown }): boolean {
  if (profile.status === "archived" || typeof profile.archivedAt === "string") {
    return true;
  }

  if (!isRecord(profile.metadata)) {
    return false;
  }

  return profile.metadata.archived === true || typeof profile.metadata.archivedAt === "string";
}

export function validateWorkflowAgentNodePromptBuilderRef(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "agent") {
    return;
  }

  if (node.promptTemplate !== undefined && node.promptBuilder !== undefined) {
    diagnostics.push({
      code: "WorkflowGraphError.ambiguousAgentPromptSource",
      message: `Workflow agent node '${nodeId}' declares both promptTemplate and promptBuilder.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}`,
      hint: "Declare exactly one prompt source for variable prompts: use promptTemplate for fixed templates or promptBuilder for a registered TypeScript prompt builder.",
    });
  }

  if (node.promptBuilder === undefined) {
    return;
  }

  const builderId = getPromptBuilderRefId(node.promptBuilder);
  if (!builderId) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidPromptBuilderRef",
      message: `Workflow agent node '${nodeId}' must use a registered TypeScript prompt builder ref when promptBuilder is declared.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.promptBuilder`,
      hint: "Use promptBuilderRef('prompt.builder.id') or a non-empty registered prompt builder id.",
    });
    return;
  }

  if (!options.registry?.promptBuilders || options.registry.promptBuilders.has(builderId)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.unknownPromptBuilderRef",
    message: `Workflow agent node '${nodeId}' references prompt builder '${builderId}', but it is not registered in the Workflow Registry.`,
    severity: "error",
    nodeId,
    path: getPromptBuilderRefPath(node.promptBuilder, nodeId),
    registryRef: builderId,
    hint: "Register the prompt builder with registerWorkflowPromptBuilder/createWorkflowRegistry before validating or executing this workflow, or update the node to use a registered prompt builder id.",
  });
}

function getPromptBuilderRefId(ref: PromptBuilderRef): string | undefined {
  if (typeof ref === "string") {
    return ref.length > 0 ? ref : undefined;
  }

  if (!isRecord(ref)) {
    return undefined;
  }

  const id = ref.id;
  return ref.kind === "promptBuilder" && ref.language === "typescript" && typeof id === "string" && id.length > 0
    ? id
    : undefined;
}

function getPromptBuilderRefPath(ref: PromptBuilderRef, nodeId: string): string {
  return typeof ref === "string" ? `$.nodes.${nodeId}.promptBuilder` : `$.nodes.${nodeId}.promptBuilder.id`;
}

export function validateWorkflowCodeNodeRef(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "code") {
    return;
  }

  if (!options.registry?.handlers || options.registry.handlers.has(node.handler)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.unknownHandlerRef",
    message: `Workflow code node '${nodeId}' references handler '${node.handler}', but it is not registered in the Workflow Registry.`,
    severity: "error",
    nodeId,
    path: `$.nodes.${nodeId}.handler`,
    registryRef: node.handler,
    hint: "Register the handler with registerWorkflowHandler/createWorkflowRegistry before validating or executing this workflow, or update the workflow to use a registered handler id.",
  });
}

export function validateWorkflowAdapterNodeRef(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "adapter") {
    return;
  }

  if (!isRegisteredAdapterRef(node.handler)) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidAdapterRef",
      message: `Workflow adapter node '${nodeId}' must use a registered TypeScript adapter ref for its handler.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.handler`,
      hint: "Create adapter nodes with handler: adapterRef('adapter.id') so persisted workflow IR stores an explicit adapter ref instead of an inline or raw handler value.",
    });
    return;
  }

  validateRegisteredAdapterExists(node.handler, diagnostics, options, {
    nodeId,
    path: `$.nodes.${nodeId}.handler.id`,
    diagnosticLabel: `Workflow adapter node '${nodeId}'`,
  });
}

export function validateWorkflowHumanActionRefs(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (node.kind !== "human" || !node.actions) {
    return;
  }

  node.actions.forEach((action, index) => {
    const path = `$.nodes.${nodeId}.actions.${index}`;
    const actionId = getHumanActionRefId(action);
    if (!actionId) {
      diagnostics.push({
        code: "WorkflowGraphError.invalidHumanActionRef",
        message: `Workflow human node '${nodeId}' declares an invalid human action ref at index ${index}.`,
        severity: "error",
        nodeId,
        path,
        hint: "Human action refs must contain a non-empty registry action id.",
      });
      return;
    }

    const registered = options.registry?.humanActions?.get(actionId);
    if (options.registry?.humanActions && !registered) {
      diagnostics.push({
        code: "WorkflowGraphError.unknownHumanActionRef",
        message: `Workflow human node '${nodeId}' references human action '${actionId}', but it is not registered in the Workflow Registry.`,
        severity: "error",
        nodeId,
        path: `${path}.id`,
        registryRef: actionId,
        hint: "Register approve/reject/resume/cancel or custom actions with registerWorkflowHumanAction/createWorkflowRegistry before validating the workflow.",
      });
      return;
    }

    if (registered && action.kind && registered.kind !== action.kind) {
      diagnostics.push({
        code: "WorkflowGraphError.humanActionKindMismatch",
        message: `Workflow human node '${nodeId}' action '${actionId}' declares kind '${action.kind}', but the registry defines kind '${registered.kind}'.`,
        severity: "error",
        nodeId,
        path: `${path}.kind`,
        registryRef: actionId,
        hint: "Keep wait-token action refs aligned with their registered action definitions.",
      });
    }
  });
}

function getHumanActionRefId(ref: WorkflowHumanActionRef): string | undefined {
  return ref && typeof ref.id === "string" && ref.id.length > 0 ? ref.id : undefined;
}

export function validateRegisteredAdapterExists(
  ref: AdapterRef,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId"> & { path: string; diagnosticLabel: string },
): void {
  if (!options.registry?.adapters || options.registry.adapters.has(ref.id)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.unknownAdapterRef",
    message: `${target.diagnosticLabel} references adapter '${ref.id}', but it is not registered in the Workflow Registry.`,
    severity: "error",
    nodeId: target.nodeId,
    edgeId: target.edgeId,
    path: target.path,
    registryRef: ref.id,
    hint: "Register the adapter with registerWorkflowAdapter/createWorkflowRegistry before validating or executing this workflow, or update the workflow to use a registered adapter id.",
  });
}

export function isRegisteredAdapterRef(value: unknown): value is AdapterRef {
  return (
    isRecord(value) &&
    value.kind === "adapter" &&
    value.language === "typescript" &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
