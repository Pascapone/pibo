import type {
  AdapterRef,
  AgentProfileSelection,
  EdgeAdapterDefinition,
  JsonSchema,
  JsonWorkflowPort,
  PromptBuilderRef,
  RegistryRefId,
  SelectionPolicy,
  TextWorkflowPort,
  WorkflowPort,
} from "../types/index.js";

/**
 * Create a text workflow port.
 *
 * Text ports carry plain strings across workflow, node, and adapter boundaries.
 */
export function text(description?: string): TextWorkflowPort {
  return withOptionalDescription({ kind: "text" }, description);
}

/**
 * Create a JSON workflow port backed by a V1 JSON Schema subset contract.
 *
 * The schema is intentionally preserved as part of the workflow IR so validators,
 * compilers, runtime checks, and inspection surfaces all see the same contract.
 */
export function json(schema: JsonSchema, description?: string): JsonWorkflowPort {
  return withOptionalDescription({ kind: "json", schema }, description);
}

export function isTextPort(port: WorkflowPort): port is TextWorkflowPort {
  return port.kind === "text";
}

export function isJsonPort(port: WorkflowPort): port is JsonWorkflowPort {
  return port.kind === "json";
}

/**
 * Reference a registered deterministic TypeScript adapter by id.
 *
 * Adapter refs are stored in workflow IR for both edge adapters and visible adapter nodes;
 * the Workflow Registry owns the executable TypeScript handler behind the id.
 */
export function adapterRef(id: RegistryRefId): AdapterRef {
  return { kind: "adapter", language: "typescript", id };
}

export function isAdapterRef(value: unknown): value is AdapterRef {
  return (
    isRecord(value) &&
    value.kind === "adapter" &&
    value.language === "typescript" &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}

export function adapterRefId(ref: AdapterRef): RegistryRefId {
  return ref.id;
}

export function edgeAdapter(transform: AdapterRef, output: WorkflowPort): EdgeAdapterDefinition {
  return { kind: "edgeAdapter", transform, output };
}

/**
 * Reference a registered TypeScript prompt builder by id.
 *
 * Prompt builder refs are stored in workflow IR; the Workflow Registry owns
 * the executable handler that turns workflow input/state/edge data into the
 * final prompt text sent to a Pibo Runtime-backed agent node.
 */
export function promptBuilderRef(id: RegistryRefId): PromptBuilderRef {
  return { kind: "promptBuilder", language: "typescript", id };
}

export function isPromptBuilderRef(value: unknown): value is Exclude<PromptBuilderRef, string> {
  return (
    isRecord(value) &&
    value.kind === "promptBuilder" &&
    value.language === "typescript" &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}

export function promptBuilderRefId(ref: PromptBuilderRef): RegistryRefId {
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * Select a fixed Agent Designer profile for a Pibo Runtime-backed agent node.
 *
 * V1 intentionally supports only fixed profile selection so workflow runs are
 * predictable and can record the exact profile requested by each agent node.
 */
export function fixedProfile(id: RegistryRefId): AgentProfileSelection {
  return { kind: "fixed", id };
}

export function inheritSelection(): SelectionPolicy {
  return { kind: "inherit" };
}

export function onlySelection(ids: RegistryRefId[]): SelectionPolicy {
  return { kind: "only", ids: [...ids] };
}

export function excludeSelection(ids: RegistryRefId[]): SelectionPolicy {
  return { kind: "exclude", ids: [...ids] };
}

export function extendSelection(ids: RegistryRefId[]): SelectionPolicy {
  return { kind: "extend", ids: [...ids] };
}

function withOptionalDescription<TPort extends WorkflowPort>(port: TPort, description: string | undefined): TPort {
  if (description === undefined) {
    return port;
  }

  return { ...port, description };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
