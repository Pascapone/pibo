import type { DatabaseSync } from "node:sqlite";

import type { WorkflowDraftRecord } from "../types/index.js";

type WorkflowDraftWriteIdentityFields = Pick<WorkflowDraftRecord, "draftId" | "workflowId" | "updatedAt" | "updatedBy">;

type ActiveWorkflowDraftConflictRow = {
  draft_id: string;
};

export function assertNoActiveWorkflowDraftConflict(
  db: DatabaseSync,
  record: Pick<WorkflowDraftRecord, "draftId" | "workflowId">,
): void {
  const conflict = db
    .prepare("SELECT draft_id FROM workflow_drafts WHERE workflow_id = ? AND status = 'draft' AND draft_id <> ? LIMIT 1")
    .get(record.workflowId, record.draftId) as ActiveWorkflowDraftConflictRow | undefined;
  if (conflict) {
    throw new Error(`Workflow '${record.workflowId}' already has an active draft '${conflict.draft_id}'.`);
  }
}

export function updateWorkflowIdentityCurrentDraft(db: DatabaseSync, record: WorkflowDraftWriteIdentityFields): void {
  db.prepare(`
    UPDATE workflow_identities
    SET current_draft_id = ?,
        updated_by = COALESCE(?, updated_by),
        updated_at = ?
    WHERE workflow_id = ?
  `).run(record.draftId, record.updatedBy ?? null, record.updatedAt, record.workflowId);
}
