import type {
  DiagnosticSeverity,
  RegistryRefId,
  StatePath,
  WorkflowDiagnostic,
  WorkflowId,
} from "../types/index.js";

export const V2_WORKFLOW_DIAGNOSTIC_CONSUMERS = [
  "workflow-library",
  "workflow-builder",
  "workflow-session-creation",
  "run-start",
  "runtime-failure",
] as const;

export type WorkflowDiagnosticConsumer = (typeof V2_WORKFLOW_DIAGNOSTIC_CONSUMERS)[number];

export type WorkflowDiagnosticGroupKind =
  | "workflow"
  | "node"
  | "edge"
  | "schemaPath"
  | "statePath"
  | "registryRef"
  | "severity";

export type WorkflowDiagnosticGroup = {
  kind: WorkflowDiagnosticGroupKind;
  key: string;
  label: string;
  severity: DiagnosticSeverity;
  count: number;
  diagnostics: WorkflowDiagnostic[];
};

export type WorkflowDiagnosticGroups = Record<WorkflowDiagnosticGroupKind, WorkflowDiagnosticGroup[]>;

export type WorkflowDiagnosticReport = {
  diagnostics: WorkflowDiagnostic[];
  groups: WorkflowDiagnosticGroups;
  consumers: WorkflowDiagnosticConsumer[];
  hasErrors: boolean;
  generatedAt?: string;
};

export type CreateWorkflowDiagnosticReportOptions = {
  workflowId?: WorkflowId;
  consumers?: WorkflowDiagnosticConsumer[];
  generatedAt?: string;
};

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

export function createWorkflowDiagnosticReport(
  inputDiagnostics: readonly WorkflowDiagnostic[],
  options: CreateWorkflowDiagnosticReportOptions = {},
): WorkflowDiagnosticReport {
  const diagnostics = [...inputDiagnostics];
  const groups = createGroupMaps();

  for (const diagnostic of diagnostics) {
    const workflowId = options.workflowId ?? diagnostic.workflowId ?? "workflow";
    addDiagnosticToGroup(groups, "workflow", workflowId, workflowId === "workflow" ? "Workflow" : `Workflow ${workflowId}`, diagnostic);

    if (diagnostic.nodeId) {
      addDiagnosticToGroup(groups, "node", diagnostic.nodeId, `Node ${diagnostic.nodeId}`, diagnostic);
    }

    if (diagnostic.edgeId) {
      addDiagnosticToGroup(groups, "edge", diagnostic.edgeId, `Edge ${diagnostic.edgeId}`, diagnostic);
    }

    const schemaPath = inferSchemaPath(diagnostic);
    if (schemaPath) {
      addDiagnosticToGroup(groups, "schemaPath", schemaPath, `Schema ${schemaPath}`, diagnostic);
    }

    const statePath = inferStatePath(diagnostic);
    if (statePath) {
      addDiagnosticToGroup(groups, "statePath", statePath, `State ${statePath}`, diagnostic);
    }

    if (diagnostic.registryRef) {
      addDiagnosticToGroup(groups, "registryRef", diagnostic.registryRef, `Registry ref ${diagnostic.registryRef}`, diagnostic);
    }

    addDiagnosticToGroup(groups, "severity", diagnostic.severity, diagnostic.severity, diagnostic);
  }

  return {
    diagnostics,
    groups: materializeGroups(groups),
    consumers: [...(options.consumers ?? V2_WORKFLOW_DIAGNOSTIC_CONSUMERS)],
    hasErrors: diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
  };
}

function inferSchemaPath(diagnostic: WorkflowDiagnostic): string | undefined {
  if (!diagnostic.path) return undefined;
  if (diagnostic.path === "$.schema" || diagnostic.path.includes(".schema") || diagnostic.code.startsWith("WorkflowInterfaceError.")) {
    return diagnostic.path;
  }
  return undefined;
}

function inferStatePath(diagnostic: WorkflowDiagnostic): StatePath | undefined {
  if (diagnostic.statePath) return diagnostic.statePath;
  if (diagnostic.path && diagnostic.code.startsWith("WorkflowStateError.")) return diagnostic.path;
  return undefined;
}

type WorkflowDiagnosticGroupMaps = Record<WorkflowDiagnosticGroupKind, Map<string, WorkflowDiagnosticGroup>>;

function createGroupMaps(): WorkflowDiagnosticGroupMaps {
  return {
    workflow: new Map(),
    node: new Map(),
    edge: new Map(),
    schemaPath: new Map(),
    statePath: new Map(),
    registryRef: new Map(),
    severity: new Map(),
  };
}

function addDiagnosticToGroup(
  groups: WorkflowDiagnosticGroupMaps,
  kind: WorkflowDiagnosticGroupKind,
  key: RegistryRefId | StatePath | DiagnosticSeverity | WorkflowId,
  label: string,
  diagnostic: WorkflowDiagnostic,
): void {
  const stringKey = String(key);
  const existing = groups[kind].get(stringKey);
  if (existing) {
    existing.diagnostics.push(diagnostic);
    existing.count = existing.diagnostics.length;
    existing.severity = highestSeverity(existing.severity, diagnostic.severity);
    return;
  }

  groups[kind].set(stringKey, {
    kind,
    key: stringKey,
    label,
    severity: diagnostic.severity,
    count: 1,
    diagnostics: [diagnostic],
  });
}

function highestSeverity(left: DiagnosticSeverity, right: DiagnosticSeverity): DiagnosticSeverity {
  return SEVERITY_RANK[right] > SEVERITY_RANK[left] ? right : left;
}

function materializeGroups(groups: WorkflowDiagnosticGroupMaps): WorkflowDiagnosticGroups {
  return {
    workflow: [...groups.workflow.values()],
    node: [...groups.node.values()],
    edge: [...groups.edge.values()],
    schemaPath: [...groups.schemaPath.values()],
    statePath: [...groups.statePath.values()],
    registryRef: [...groups.registryRef.values()],
    severity: [...groups.severity.values()],
  };
}
