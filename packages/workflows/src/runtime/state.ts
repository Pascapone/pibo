import type {
  CodeNodeResult,
  JsonValue,
  NodeAttempt,
  NodeId,
  NodeLocalStateReader,
  ScopedStatePath,
  StatePatch,
  TypeScriptCodeNodeDefinition,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowGlobalStateReader,
  WorkflowRun,
} from "../types/index.js";
import { validateJsonValueAgainstSchema } from "../validation/index.js";

export class WorkflowStateAccessViolation extends Error {
  constructor(readonly diagnostic: WorkflowDiagnostic) {
    super(diagnostic.message);
  }
}

export function createInitialWorkflowRunState(
  global: Record<string, JsonValue>,
  local?: Record<NodeId, Record<string, JsonValue>>,
): WorkflowRun["state"] {
  const localState = cloneLocalStateMap(local);
  return localState ? { global: { ...global }, local: localState } : { global: { ...global } };
}

export function localStateSnapshotForNode(run: WorkflowRun, nodeId: string): Pick<NodeAttempt, "localState"> {
  const localState = cloneLocalStateForNode(run, nodeId);
  return localState ? { localState } : {};
}

export function createNodeScopedWorkflowRun(run: WorkflowRun, nodeId: string): WorkflowRun {
  return {
    ...run,
    state: createNodeScopedWorkflowRunState(run, nodeId),
  };
}

export function createWorkflowRunWithoutLocalState(run: WorkflowRun): WorkflowRun {
  return {
    ...run,
    state: { global: run.state.global },
  };
}

export function createCurrentNodeStateView(state: WorkflowRun["state"], nodeId: string): WorkflowRun["state"] {
  const localState = state.local?.[nodeId];
  return localState
    ? { global: state.global, local: { [nodeId]: structuredClone(localState) as Record<string, JsonValue> } }
    : { global: state.global };
}

export function createStateReader(
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

export function validateCodeNodePatches(
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

export function applyCodeNodePatches(
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

function createNodeScopedWorkflowRunState(run: WorkflowRun, nodeId: string): WorkflowRun["state"] {
  const localState = cloneLocalStateForNode(run, nodeId);
  return localState ? { global: run.state.global, local: { [nodeId]: localState } } : { global: run.state.global };
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

function applyStatePatch(target: Record<string, JsonValue>, patch: StatePatch): void {
  for (const [path, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete target[path];
    } else {
      target[path] = value;
    }
  }
}
