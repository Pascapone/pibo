import { canonicalWorkflowDefinitionJson, hashWorkflowDefinition } from "../definition-hash.js";
import type {
  WorkflowPublishedVersionRecord,
  WorkflowRecordSource,
  WorkflowRecordStatus,
} from "../types/index.js";

export type CreateWorkflowPublishedVersionRecordInput = Omit<WorkflowPublishedVersionRecord, "source" | "status" | "definitionHash"> & {
  source?: "ui";
  status?: "published";
  definitionHash?: string;
};

export const WORKFLOW_RECORD_SOURCES = ["code", "ui"] as const satisfies readonly WorkflowRecordSource[];
export const WORKFLOW_RECORD_STATUSES = ["draft", "published", "archived"] as const satisfies readonly WorkflowRecordStatus[];

export function isWorkflowRecordSource(value: unknown): value is WorkflowRecordSource {
  return typeof value === "string" && (WORKFLOW_RECORD_SOURCES as readonly string[]).includes(value);
}

export function isWorkflowRecordStatus(value: unknown): value is WorkflowRecordStatus {
  return typeof value === "string" && (WORKFLOW_RECORD_STATUSES as readonly string[]).includes(value);
}

export function assertWorkflowRecordSource(value: unknown): asserts value is WorkflowRecordSource {
  if (!isWorkflowRecordSource(value)) {
    throw new Error(`Workflow record source must be one of: ${WORKFLOW_RECORD_SOURCES.join(", ")}.`);
  }
}

export function assertWorkflowRecordStatus(value: unknown): asserts value is WorkflowRecordStatus {
  if (!isWorkflowRecordStatus(value)) {
    throw new Error(`Workflow record status must be one of: ${WORKFLOW_RECORD_STATUSES.join(", ")}.`);
  }
}

export function assertWorkflowUiRecordSource(value: unknown, entity: string): asserts value is "ui" {
  assertWorkflowRecordSource(value);
  if (value !== "ui") {
    throw new Error(`${entity} records must use source 'ui'. Code workflows are catalog projections and are not persisted UI records.`);
  }
}

export function assertWorkflowRecordStatusValue(value: unknown, expected: WorkflowRecordStatus, entity: string): void {
  assertWorkflowRecordStatus(value);
  if (value !== expected) {
    throw new Error(`${entity} records must use status '${expected}'.`);
  }
}

export function createWorkflowPublishedVersionRecord(
  input: CreateWorkflowPublishedVersionRecordInput,
): WorkflowPublishedVersionRecord {
  const record: WorkflowPublishedVersionRecord = {
    ...input,
    source: input.source ?? "ui",
    status: input.status ?? "published",
    definitionHash: input.definitionHash ?? hashWorkflowDefinition(input.definition),
  };
  assertPublishedWorkflowVersionRecord(record);
  return record;
}

export function assertPublishedWorkflowVersionRecord(record: WorkflowPublishedVersionRecord): void {
  assertWorkflowUiRecordSource(record.source, "Workflow published version");
  assertWorkflowRecordStatusValue(record.status, "published", "Workflow published version");
  if (record.definition.id !== record.workflowId || record.definition.version !== record.version) {
    throw new Error(`Workflow '${record.workflowId}@${record.version}' published record does not match its definition id/version.`);
  }
  const computedHash = hashWorkflowDefinition(record.definition);
  if (record.definitionHash !== computedHash) {
    throw new Error(`Workflow '${record.workflowId}@${record.version}' published record has an invalid definition hash.`);
  }
}

export function assertPublishedWorkflowVersionIsSame(
  existing: WorkflowPublishedVersionRecord,
  next: WorkflowPublishedVersionRecord,
): void {
  if (
    existing.definitionHash !== next.definitionHash ||
    canonicalWorkflowDefinitionJson(existing.definition) !== canonicalWorkflowDefinitionJson(next.definition)
  ) {
    throw new Error(`Published workflow '${next.workflowId}@${next.version}' is immutable and cannot be replaced.`);
  }
}
