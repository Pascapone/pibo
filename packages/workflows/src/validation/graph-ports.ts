import { semanticJsonSchemasEqual } from "./json-schema.js";

import type {
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowEdgeDefinition,
  WorkflowPort,
} from "../types/index.js";

export function areWorkflowPortsDirectlyCompatible(source: WorkflowPort, target: WorkflowPort): boolean {
  if (source.kind !== target.kind) {
    return false;
  }

  if (source.kind === "text" && target.kind === "text") {
    return true;
  }

  if (source.kind === "json" && target.kind === "json") {
    return semanticJsonSchemasEqual(source.schema, target.schema);
  }

  return false;
}

export function validateWorkflowEdgeAdapterOutputCompatibility(
  definition: Pick<WorkflowDefinition, "nodes">,
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (!edge.adapter) {
    return;
  }

  const targetNode = definition.nodes[edge.to.nodeId];
  if (!targetNode?.input) {
    return;
  }

  if (areWorkflowPortsDirectlyCompatible(edge.adapter.output, targetNode.input)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.incompatibleEdgeAdapterOutput",
    message: `Workflow edge '${edgeId}' declares an adapter output that is incompatible with the target input port.`,
    severity: "error",
    edgeId,
    path: `$.edges.${edgeId}.adapter.output`,
    hint: "Set the edgeAdapter output port to the exact target input contract, or insert a visible adapter node whose output matches the downstream node.",
  });
}

export function validateWorkflowEdgePortCompatibility(
  definition: Pick<WorkflowDefinition, "nodes">,
  edgeId: string,
  edge: WorkflowEdgeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (edge.adapter) {
    return;
  }

  const sourceNode = definition.nodes[edge.from.nodeId];
  const targetNode = definition.nodes[edge.to.nodeId];
  if (!sourceNode || !targetNode || !sourceNode.output || !targetNode.input) {
    return;
  }

  if (areWorkflowPortsDirectlyCompatible(sourceNode.output, targetNode.input)) {
    return;
  }

  diagnostics.push({
    code: "WorkflowGraphError.incompatibleEdgePorts",
    message: `Workflow edge '${edgeId}' connects incompatible source output and target input ports.`,
    severity: "error",
    edgeId,
    path: `$.edges.${edgeId}`,
    hint: "Use matching text ports, use JSON ports with the same schema contract, or add an explicit edgeAdapter/adapter node to transform the payload.",
  });
}
