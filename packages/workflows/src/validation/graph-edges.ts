import { isRegisteredAdapterRef, validateRegisteredAdapterExists } from "./registry-refs.js";
import type { WorkflowValidationOptions } from "./registry-refs.js";

import type { WorkflowDefinition, WorkflowDiagnostic, WorkflowEdgeDefinition } from "../types/index.js";

export function validateWorkflowEdgeNodeRefs(
  definition: Pick<WorkflowDefinition, "nodes">,
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (!Object.hasOwn(definition.nodes, edge.from.nodeId)) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownSourceNode",
      message: `Workflow edge '${edgeId}' references missing source node '${edge.from.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.from.nodeId,
      path: `$.edges.${edgeId}.from.nodeId`,
      hint: "Update the edge source to reference a declared workflow node id, or add the missing node to the workflow definition.",
    });
  }

  if (!Object.hasOwn(definition.nodes, edge.to.nodeId)) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownTargetNode",
      message: `Workflow edge '${edgeId}' references missing target node '${edge.to.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.to.nodeId,
      path: `$.edges.${edgeId}.to.nodeId`,
      hint: "Update the edge target to reference a declared workflow node id, or add the missing node to the workflow definition.",
    });
  }
}

export function validateWorkflowEdgeAdapterRef(
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
  options: WorkflowValidationOptions,
): void {
  if (!edge.adapter) {
    return;
  }

  if (!isRegisteredAdapterRef(edge.adapter.transform)) {
    diagnostics.push({
      code: "WorkflowGraphError.invalidAdapterRef",
      message: `Workflow edge '${edgeId}' must use a registered TypeScript adapter ref for its edge adapter transform.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.adapter.transform`,
      hint: "Create edge adapters with edgeAdapter(adapterRef('adapter.id'), outputPort) so persisted workflow IR stores an explicit adapter ref instead of an inline or raw handler value.",
    });
  } else {
    validateRegisteredAdapterExists(edge.adapter.transform, diagnostics, options, {
      edgeId,
      path: `$.edges.${edgeId}.adapter.transform.id`,
      diagnosticLabel: `Workflow edge '${edgeId}'`,
    });
  }
}
