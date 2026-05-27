import type {
  StateScope,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowNodeDefinition,
} from "../types/index.js";

export function validateWorkflowNodeStateAccess(
  definition: Pick<WorkflowDefinition, "state">,
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (node.state === undefined) {
    return;
  }

  validateNodeStateAccessList(definition, nodeId, node.state.reads, "reads", diagnostics);
  validateNodeStateAccessList(definition, nodeId, node.state.writes, "writes", diagnostics);
}

export function validateWorkflowGlobalStateWriteConflicts(
  definition: Pick<WorkflowDefinition, "nodes" | "state">,
  diagnostics: WorkflowDiagnostic[],
): void {
  const writersByPath = new Map<string, Set<string>>();

  for (const [nodeId, node] of Object.entries(definition.nodes)) {
    for (const writePath of node.state?.writes ?? []) {
      if (typeof writePath !== "string") {
        continue;
      }

      const scopedPath = parseScopedStatePath(writePath);
      if (scopedPath?.scope !== "global" || !definition.state?.global?.[scopedPath.path]) {
        continue;
      }

      const writers = writersByPath.get(scopedPath.path) ?? new Set<string>();
      writers.add(nodeId);
      writersByPath.set(scopedPath.path, writers);
    }
  }

  for (const [statePath, writers] of writersByPath) {
    const field = definition.state?.global?.[statePath];
    if (!field || field.merge || writers.size <= 1) {
      continue;
    }

    diagnostics.push({
      code: "WorkflowStateError.ambiguousConcurrentGlobalStateWrite",
      message: `Workflow global state path '${statePath}' is written by multiple nodes without an explicit merge policy.`,
      severity: "error",
      path: `$.state.global.${statePath}`,
      statePath,
      hint: `Declare state.global['${statePath}'].merge, or ensure only one node writes '${statePath}'. Writers: ${[
        ...writers,
      ].join(", ")}.`,
    });
  }
}

function validateNodeStateAccessList(
  definition: Pick<WorkflowDefinition, "state">,
  nodeId: string,
  values: unknown,
  direction: "reads" | "writes",
  diagnostics: WorkflowDiagnostic[],
): void {
  if (values === undefined) {
    return;
  }

  if (!Array.isArray(values)) {
    diagnostics.push({
      code: "WorkflowStateError.invalidStateAccessDeclaration",
      message: `Workflow node '${nodeId}' state.${direction} must be an array of scoped state paths.`,
      severity: "error",
      nodeId,
      path: `$.nodes.${nodeId}.state.${direction}`,
      hint: "Declare state access as strings such as 'global.projectGoal', 'local.draft', or 'edge.previous'.",
    });
    return;
  }

  values.forEach((value, index) => {
    const path = `$.nodes.${nodeId}.state.${direction}.${index}`;
    if (typeof value !== "string") {
      diagnostics.push({
        code: "WorkflowStateError.invalidStateAccessDeclaration",
        message: `Workflow node '${nodeId}' state.${direction} entry must be a scoped state path string.`,
        severity: "error",
        nodeId,
        path,
        hint: "Use scoped paths like 'global.projectGoal', 'local.draft', or 'edge.previous'.",
      });
      return;
    }

    const scopedPath = parseScopedStatePath(value);
    if (!scopedPath) {
      diagnostics.push({
        code: "WorkflowStateError.invalidStatePath",
        message: `Workflow node '${nodeId}' declares invalid ${direction} state path '${value}'.`,
        severity: "error",
        nodeId,
        path,
        statePath: value,
        hint: "State paths must be scoped as 'global.<path>', 'local.<path>', or 'edge.<path>' with a non-empty path.",
      });
      return;
    }

    if (direction === "writes" && scopedPath.scope === "edge") {
      diagnostics.push({
        code: "WorkflowStateError.edgeStateWriteNotAllowed",
        message: `Workflow node '${nodeId}' declares a write to immutable edge payload path '${value}'.`,
        severity: "error",
        nodeId,
        path,
        statePath: value,
        hint: "Edge payloads are immutable after transfer; write to 'global.<path>' or current-node 'local.<path>' instead.",
      });
    }

    if (scopedPath.scope === "global" && !definition.state?.global?.[scopedPath.path]) {
      diagnostics.push({
        code: "WorkflowStateError.unknownGlobalStatePath",
        message: `Workflow node '${nodeId}' declares ${direction} access to unknown global state path '${scopedPath.path}'.`,
        severity: "error",
        nodeId,
        path,
        statePath: value,
        hint: `Declare state.global['${scopedPath.path}'] with a schema before a node can read or write it.`,
      });
    }
  });
}

function parseScopedStatePath(value: string): { scope: StateScope; path: string } | undefined {
  const separatorIndex = value.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    return undefined;
  }

  const scope = value.slice(0, separatorIndex);
  const path = value.slice(separatorIndex + 1);
  if (scope !== "global" && scope !== "local" && scope !== "edge") {
    return undefined;
  }

  if (path.split(".").some((segment) => segment.length === 0)) {
    return undefined;
  }

  return { scope, path };
}
