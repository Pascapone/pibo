import { isValidGuardRef, validateWorkflowGuardRef } from "./registry-refs.js";
import type { WorkflowValidationOptions } from "./registry-refs.js";

import type { WorkflowDefinition, WorkflowDiagnostic } from "../types/index.js";

export function validateWorkflowGraphCycles(
  definition: Pick<WorkflowDefinition, "nodes" | "edges" | "loops">,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  validateWorkflowLoopPolicies(definition, diagnostics, options);
  validateWorkflowCycles(definition, diagnostics);
}

function validateWorkflowLoopPolicies(
  definition: Pick<WorkflowDefinition, "edges" | "loops">,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  for (const [index, loop] of definition.loops?.entries() ?? []) {
    const path = `$.loops.${index}`;
    const edgeId = loop.edgeId;
    const edge = edgeId ? definition.edges[edgeId] : undefined;

    if (typeof edgeId !== "string" || edgeId.length === 0) {
      diagnostics.push({
        code: "WorkflowGraphError.invalidLoopPolicy",
        message: "Workflow loop policies must reference the explicit back-edge by edgeId.",
        severity: "error",
        path: `${path}.edgeId`,
        hint: "Set loops[n].edgeId to the id of the guarded back-edge this policy bounds.",
      });
    } else if (!edge) {
      diagnostics.push({
        code: "WorkflowGraphError.unknownLoopEdge",
        message: `Workflow loop policy references missing edge '${edgeId}'.`,
        severity: "error",
        edgeId,
        path: `${path}.edgeId`,
        hint: "Point the loop policy at an existing back-edge in workflow.edges.",
      });
    }

    if (!Number.isInteger(loop.maxAttempts) || loop.maxAttempts < 1) {
      diagnostics.push({
        code: "WorkflowRetryError.invalidMaxAttempts",
        message: "Workflow loop policies must declare maxAttempts as a positive integer.",
        severity: "error",
        edgeId: typeof edgeId === "string" ? edgeId : undefined,
        path: `${path}.maxAttempts`,
        hint: "Set maxAttempts to the maximum number of times this back-edge may be traversed.",
      });
    }

    const guard = loop.guard ?? edge?.guard;
    if (!guard) {
      diagnostics.push({
        code: "WorkflowGraphError.unboundedBackEdge",
        message: `Workflow loop policy${edgeId ? ` for edge '${edgeId}'` : ""} must declare a guard on the loop policy or edge.`,
        severity: "error",
        edgeId: typeof edgeId === "string" ? edgeId : undefined,
        path,
        hint: "Back-edges must be explicit, guarded, and bounded with maxAttempts so review/fix loops cannot run freely.",
      });
    } else {
      validateWorkflowGuardRef(guard, diagnostics, options, {
        edgeId: typeof edgeId === "string" ? edgeId : undefined,
        path: loop.guard ? `${path}.guard.handler` : `$.edges.${edgeId}.guard.handler`,
        diagnosticLabel: `Workflow loop policy${edgeId ? ` for edge '${edgeId}'` : ""}`,
      });
    }
  }
}

function validateWorkflowCycles(
  definition: Pick<WorkflowDefinition, "nodes" | "edges" | "loops">,
  diagnostics: WorkflowDiagnostic[],
): void {
  const boundedLoopEdgeIds = collectBoundedLoopEdgeIds(definition);
  const adjacency = new Map<string, Array<{ edgeId: string; targetNodeId: string }>>();

  for (const nodeId of Object.keys(definition.nodes)) {
    adjacency.set(nodeId, []);
  }

  for (const [edgeId, edge] of Object.entries(definition.edges)) {
    if (boundedLoopEdgeIds.has(edgeId)) {
      continue;
    }

    if (!Object.hasOwn(definition.nodes, edge.from.nodeId) || !Object.hasOwn(definition.nodes, edge.to.nodeId)) {
      continue;
    }

    adjacency.get(edge.from.nodeId)?.push({ edgeId, targetNodeId: edge.to.nodeId });
  }

  const visitState = new Map<string, "visiting" | "visited">();
  const pathNodes: string[] = [];
  const pathEdges: string[] = [];
  const reportedCycles = new Set<string>();

  const visit = (nodeId: string): void => {
    visitState.set(nodeId, "visiting");
    pathNodes.push(nodeId);

    for (const { edgeId, targetNodeId } of adjacency.get(nodeId) ?? []) {
      const targetState = visitState.get(targetNodeId);
      if (targetState === "visiting") {
        const cycleStartIndex = pathNodes.indexOf(targetNodeId);
        const cycleEdgeIds = cycleStartIndex >= 0 ? [...pathEdges.slice(cycleStartIndex), edgeId] : [edgeId];
        const cycleKey = [...cycleEdgeIds].sort().join("\u0000");
        if (reportedCycles.has(cycleKey)) {
          continue;
        }

        reportedCycles.add(cycleKey);
        const cycleNodeIds = cycleStartIndex >= 0 ? [...pathNodes.slice(cycleStartIndex), targetNodeId] : [nodeId, targetNodeId];
        diagnostics.push({
          code: "WorkflowGraphError.unboundedCycle",
          message: `Workflow contains an unbounded cycle through nodes '${cycleNodeIds.join(" -> ")}'.`,
          severity: "error",
          edgeId,
          path: `$.edges.${edgeId}`,
          hint: `Declare one cycle edge as a guarded loop policy with maxAttempts, for example loops: [{ edgeId: '${edgeId}', maxAttempts: 3, guard: ... }].`,
        });
        continue;
      }

      if (targetState === "visited") {
        continue;
      }

      pathEdges.push(edgeId);
      visit(targetNodeId);
      pathEdges.pop();
    }

    pathNodes.pop();
    visitState.set(nodeId, "visited");
  };

  for (const nodeId of Object.keys(definition.nodes)) {
    if (!visitState.has(nodeId)) {
      visit(nodeId);
    }
  }
}

function collectBoundedLoopEdgeIds(definition: Pick<WorkflowDefinition, "edges" | "loops">): Set<string> {
  const edgeIds = new Set<string>();

  for (const loop of definition.loops ?? []) {
    const edge = definition.edges[loop.edgeId];
    const guard = loop.guard ?? edge?.guard;
    if (edge && Number.isInteger(loop.maxAttempts) && loop.maxAttempts > 0 && isValidGuardRef(guard)) {
      edgeIds.add(loop.edgeId);
    }
  }

  return edgeIds;
}
