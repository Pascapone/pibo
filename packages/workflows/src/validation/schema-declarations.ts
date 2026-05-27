import { validateJsonSchemaSubset } from "./json-schema.js";

import type {
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowNodeDefinition,
  WorkflowPort,
} from "../types/index.js";

export function validateWorkflowPort(
  port: WorkflowPort,
  path: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId"> = {},
): void {
  if (port.kind !== "json") {
    return;
  }

  diagnostics.push(
    ...validateJsonSchemaSubset(port.schema, {
      path: `${path}.schema`,
      requireObjectRoot: true,
    }).map((diagnostic) => ({ ...diagnostic, ...target })),
  );
}

export function validateWorkflowNodeSchemaDeclarations(
  nodeId: string,
  node: WorkflowNodeDefinition,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (node.input) {
    validateWorkflowPort(node.input, `$.nodes.${nodeId}.input`, diagnostics, { nodeId });
  }

  if (node.output) {
    validateWorkflowPort(node.output, `$.nodes.${nodeId}.output`, diagnostics, { nodeId });
  }

  if (node.kind === "human" && node.schema) {
    diagnostics.push(
      ...validateJsonSchemaSubset(node.schema, {
        path: `$.nodes.${nodeId}.schema`,
        requireObjectRoot: true,
      }).map((diagnostic) => ({ ...diagnostic, nodeId })),
    );
  }
}

export function validateWorkflowGlobalStateSchemaDeclarations(
  definition: Pick<WorkflowDefinition, "state">,
  diagnostics: WorkflowDiagnostic[],
): void {
  if (!definition.state?.global) {
    return;
  }

  for (const [path, field] of Object.entries(definition.state.global)) {
    diagnostics.push(
      ...validateJsonSchemaSubset(field.schema, {
        path: `$.state.global.${path}.schema`,
        requireObjectRoot: false,
      }),
    );
  }
}
