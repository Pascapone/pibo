export * from "./diagnostics.js";
export { areWorkflowPortsDirectlyCompatible } from "./graph-ports.js";
export { validateJsonSchemaSubset, validateJsonValueAgainstSchema } from "./json-schema.js";
export type { JsonSchemaSubsetValidationOptions, WorkflowValueValidationOptions } from "./json-schema.js";
export type { WorkflowValidationOptions } from "./registry-refs.js";

import { validateWorkflowGraphCycles } from "./graph-cycles.js";
import { validateWorkflowEdgeAdapterRef, validateWorkflowEdgeNodeRefs } from "./graph-edges.js";
import {
  validateWorkflowEdgeAdapterOutputCompatibility,
  validateWorkflowEdgePortCompatibility,
} from "./graph-ports.js";
import { validateJsonSchemaSubset, validateJsonValueAgainstSchema } from "./json-schema.js";
import type { WorkflowValueValidationOptions } from "./json-schema.js";
import {
  validateWorkflowAdapterNodeRef,
  validateWorkflowAgentNodePromptBuilderRef,
  validateWorkflowAgentNodeRuntimeSelection,
  validateWorkflowCodeNodeRef,
  validateWorkflowEdgeGuardRef,
  validateWorkflowHumanActionRefs,
} from "./registry-refs.js";
import type { WorkflowValidationOptions } from "./registry-refs.js";
import { validateWorkflowRetryPolicy } from "./retry-policy.js";
import {
  validateWorkflowGlobalStateWriteConflicts,
  validateWorkflowNodeStateAccess,
} from "./state-access.js";

import type {
  ValidationResult,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowNodeDefinition,
  WorkflowPort,
} from "../types/index.js";

export function validateWorkflow(definition: WorkflowDefinition, options: WorkflowValidationOptions = {}): ValidationResult {
  return validateWorkflowDefinitionSchemas(definition, options);
}

export function validateWorkflowDefinitionSchemas(
  definition: WorkflowDefinition,
  options: WorkflowValidationOptions = {},
): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [];

  validateWorkflowPort(definition.input, "$.input", diagnostics);
  validateWorkflowPort(definition.output, "$.output", diagnostics);

  validateWorkflowRetryPolicy(definition.retry, "$.retry", diagnostics);

  for (const [nodeId, node] of Object.entries(definition.nodes)) {
    validateNodeSchemas(nodeId, node, diagnostics);
    validateWorkflowRetryPolicy(node.retry, `$.nodes.${nodeId}.retry`, diagnostics, { nodeId });
    validateWorkflowAgentNodeRuntimeSelection(nodeId, node, diagnostics, options);
    validateWorkflowAgentNodePromptBuilderRef(nodeId, node, diagnostics, options);
    validateWorkflowCodeNodeRef(nodeId, node, diagnostics, options);
    validateWorkflowAdapterNodeRef(nodeId, node, diagnostics, options);
    validateWorkflowHumanActionRefs(nodeId, node, diagnostics, options);
    validateWorkflowNodeStateAccess(definition, nodeId, node, diagnostics);
  }

  validateWorkflowGlobalStateWriteConflicts(definition, diagnostics);
  validateWorkflowGraphCycles(definition, diagnostics, options);

  for (const [edgeId, edge] of Object.entries(definition.edges)) {
    validateWorkflowEdgeNodeRefs(definition, edgeId, edge, diagnostics);
    validateWorkflowEdgeGuardRef(edgeId, edge, diagnostics, options);
    validateWorkflowEdgeAdapterRef(edgeId, edge, diagnostics, options);
    validateWorkflowEdgeAdapterOutputCompatibility(definition, edgeId, edge, diagnostics);
    validateWorkflowEdgePortCompatibility(definition, edgeId, edge, diagnostics);

    if (edge.adapter) {
      validateWorkflowPort(edge.adapter.output, `$.edges.${edgeId}.adapter.output`, diagnostics, { edgeId });
    }
  }

  if (definition.state?.global) {
    for (const [path, field] of Object.entries(definition.state.global)) {
      diagnostics.push(
        ...validateJsonSchemaSubset(field.schema, {
          path: `$.state.global.${path}.schema`,
          requireObjectRoot: false,
        }),
      );
    }
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

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

export function validateWorkflowInput(
  definition: Pick<WorkflowDefinition, "input">,
  input: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  return validateWorkflowPortValue(definition.input, input, {
    path: options.path ?? "$.input",
  });
}

export function validateWorkflowOutput(
  definition: Pick<WorkflowDefinition, "output">,
  output: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  return validateWorkflowPortValue(definition.output, output, {
    path: options.path ?? "$.output",
  });
}

export function validateWorkflowGlobalState(
  definition: Pick<WorkflowDefinition, "state">,
  globalState: Record<string, unknown>,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [];
  const pathPrefix = options.path ?? "$.state.global";

  for (const [path, field] of Object.entries(definition.state?.global ?? {})) {
    if (!(path in globalState)) {
      continue;
    }

    diagnostics.push(
      ...validateJsonValueAgainstSchema(field.schema, globalState[path], {
        path: `${pathPrefix}.${path}`,
      }),
    );
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

export function validateNodeOutput(
  definition: Pick<WorkflowDefinition, "nodes">,
  nodeId: string,
  output: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  const node = definition.nodes[nodeId];
  if (!node) {
    const diagnostics: WorkflowDiagnostic[] = [
      {
        code: "WorkflowInterfaceError.unknownNode",
        message: `Workflow node '${nodeId}' does not exist, so its output cannot be validated.`,
        severity: "error",
        nodeId,
        path: `$.nodes.${nodeId}`,
        hint: "Validate outputs only for node ids declared in the workflow definition.",
      },
    ];
    return { ok: false, diagnostics };
  }

  if (!node.output) {
    return { ok: true, diagnostics: [] };
  }

  return withDiagnosticTarget(
    validateWorkflowPortValue(node.output, output, {
      path: options.path ?? `$.nodes.${nodeId}.output`,
    }),
    { nodeId },
  );
}

export function validateWorkflowEdgeAdapterOutput(
  definition: Pick<WorkflowDefinition, "nodes" | "edges">,
  edgeId: string,
  output: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  const diagnostics: WorkflowDiagnostic[] = [];
  const edge = definition.edges[edgeId];

  if (!edge) {
    diagnostics.push({
      code: "WorkflowInterfaceError.unknownEdge",
      message: `Workflow edge '${edgeId}' does not exist, so its adapter output cannot be validated.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}`,
      hint: "Validate adapter outputs only for edge ids declared in the workflow definition.",
    });
    return { ok: false, diagnostics };
  }

  if (!edge.adapter) {
    diagnostics.push({
      code: "WorkflowInterfaceError.edgeAdapterExpected",
      message: `Workflow edge '${edgeId}' does not declare an adapter output port.`,
      severity: "error",
      edgeId,
      path: `$.edges.${edgeId}.adapter`,
      hint: "Call validateWorkflowEdgeAdapterOutput only for edges that declare edgeAdapter(...).",
    });
    return { ok: false, diagnostics };
  }

  const adapterOutputPath = options.path ?? `$.edges.${edgeId}.adapter.outputValue`;
  diagnostics.push(
    ...validateWorkflowPortValue(edge.adapter.output, output, {
      path: adapterOutputPath,
    }).diagnostics.map((diagnostic) => ({ ...diagnostic, edgeId })),
  );

  const targetNode = definition.nodes[edge.to.nodeId];
  if (!targetNode) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownTargetNode",
      message: `Workflow edge '${edgeId}' references missing target node '${edge.to.nodeId}'.`,
      severity: "error",
      edgeId,
      nodeId: edge.to.nodeId,
      path: `$.edges.${edgeId}.to.nodeId`,
      hint: "Validate adapter outputs only after graph validation has accepted target node references.",
    });
  } else if (targetNode.input) {
    diagnostics.push(
      ...validateWorkflowPortValue(targetNode.input, output, {
        path: `$.edges.${edgeId}.targetInput`,
      }).diagnostics.map((diagnostic) => ({ ...diagnostic, edgeId, nodeId: edge.to.nodeId })),
    );
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

export function validateWorkflowPortValue(
  port: WorkflowPort,
  value: unknown,
  options: WorkflowValueValidationOptions = {},
): ValidationResult {
  const path = options.path ?? "$.value";
  const diagnostics: WorkflowDiagnostic[] = [];

  if (port.kind === "text") {
    if (typeof value !== "string") {
      diagnostics.push({
        code: "WorkflowInterfaceError.textValueExpected",
        message: "Text workflow ports require a string value.",
        severity: "error",
        path,
        hint: "Pass a string for text ports, or change the port to json(...) with an explicit schema.",
      });
    }
  } else {
    validateWorkflowPort(port, path, diagnostics);
    diagnostics.push(
      ...validateJsonValueAgainstSchema(port.schema, value, {
        path,
      }),
    );
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}

function validateNodeSchemas(
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

function withDiagnosticTarget(
  result: ValidationResult,
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId">,
): ValidationResult {
  const diagnostics = result.diagnostics.map((diagnostic) => ({ ...diagnostic, ...target }));
  return diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? { ok: false, diagnostics }
    : { ok: true, diagnostics };
}
