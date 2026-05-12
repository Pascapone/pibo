import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWorkflowPublishedVersionRecord,
  hashWorkflowDefinition,
  isWorkflowRecordSource,
  isWorkflowRecordStatus,
  minimalOneNodePiboAgentWorkflowFixture,
  SqliteWorkflowRunStore,
  WORKFLOW_RECORD_SOURCES,
  WORKFLOW_RECORD_STATUSES,
} from "../index.js";
import type {
  WorkflowArchiveStateRecord,
  WorkflowDefinition,
  WorkflowDefinitionSnapshot,
  WorkflowDeleteTombstoneRecord,
  WorkflowDraftRecord,
  WorkflowIdentityRecord,
} from "../index.js";

const createdAt = "2026-05-11T05:00:00.000Z";
const updatedAt = "2026-05-11T05:01:00.000Z";

function createDefinition(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    ...minimalOneNodePiboAgentWorkflowFixture,
    id: "workflow.ui.catalog",
    version: "1.0.0",
    title: "Catalog entity workflow",
    ...overrides,
  };
}

describe("workflow catalog entity persistence", () => {
  it("defines workflow source/status values and rejects conflated UI entity records", () => {
    assert.deepEqual([...WORKFLOW_RECORD_SOURCES], ["code", "ui"]);
    assert.deepEqual([...WORKFLOW_RECORD_STATUSES], ["draft", "published", "archived"]);
    assert.equal(isWorkflowRecordSource("code"), true);
    assert.equal(isWorkflowRecordSource("ui"), true);
    assert.equal(isWorkflowRecordSource("deleted"), false);
    assert.equal(isWorkflowRecordStatus("draft"), true);
    assert.equal(isWorkflowRecordStatus("published"), true);
    assert.equal(isWorkflowRecordStatus("archived"), true);
    assert.equal(isWorkflowRecordStatus("deleted"), false);

    const store = new SqliteWorkflowRunStore(":memory:");
    const definition = createDefinition({ id: "workflow.ui.contract" });
    const definitionHash = hashWorkflowDefinition(definition);
    const identity: WorkflowIdentityRecord = {
      workflowId: definition.id,
      source: "ui",
      title: "Contract workflow",
      tags: [],
      createdAt,
      updatedAt,
    };
    const draft: WorkflowDraftRecord = {
      draftId: "wfd_contract_1",
      workflowId: definition.id,
      source: "ui",
      status: "draft",
      versionIntent: "patch",
      definition: { id: definition.id },
      diagnostics: [],
      validationState: "unknown",
      revision: 1,
      createdAt,
      updatedAt,
    };
    const tombstone: WorkflowDeleteTombstoneRecord = {
      workflowId: definition.id,
      source: "ui",
      deleted: true,
      lastKnownTitle: identity.title,
      lastKnownVersion: definition.version,
      lastDefinitionHash: definitionHash,
      createdAt,
    };

    try {
      assert.throws(
        () => store.saveWorkflowIdentity({ ...identity, source: "code" } as unknown as WorkflowIdentityRecord),
        /Workflow identity records must use source 'ui'/,
      );
      assert.throws(
        () => store.saveWorkflowDraft({ ...draft, status: "published" } as unknown as WorkflowDraftRecord),
        /Workflow draft records must use status 'draft'/,
      );
      assert.throws(
        () => store.saveWorkflowDeleteTombstone({ ...tombstone, deleted: false } as unknown as WorkflowDeleteTombstoneRecord),
        /Workflow delete tombstone records must use deleted true/,
      );
      assert.throws(
        () => createWorkflowPublishedVersionRecord({
          workflowId: definition.id,
          version: definition.version,
          definition,
          status: "draft",
          publishedAt: updatedAt,
          createdAt,
        } as unknown as Parameters<typeof createWorkflowPublishedVersionRecord>[0]),
        /Workflow published version records must use status 'published'/,
      );
    } finally {
      store.close();
    }
  });

  it("stores identity, draft, published version, archive, and tombstone records as separate entities", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-catalog-entities-"));
    const store = new SqliteWorkflowRunStore(join(tempRoot, "pibo-workflows.sqlite"));
    const definition = createDefinition();
    const definitionHash = hashWorkflowDefinition(definition);
    const identity: WorkflowIdentityRecord = {
      workflowId: definition.id,
      source: "ui",
      title: "Catalog entity workflow",
      description: "A UI-authored workflow identity.",
      tags: ["catalog", "ui"],
      currentDraftId: "wfd_catalog_1",
      latestVersion: definition.version,
      createdBy: "user:catalog",
      createdAt,
      updatedBy: "user:catalog",
      updatedAt,
    };
    const draft: WorkflowDraftRecord = {
      draftId: "wfd_catalog_1",
      workflowId: definition.id,
      source: "ui",
      status: "draft",
      baseWorkflowId: definition.id,
      baseWorkflowVersion: definition.version,
      baseDefinitionHash: definitionHash,
      versionIntent: "minor",
      definition: {
        id: definition.id,
        version: "1.1.0",
        title: "Catalog entity workflow draft",
      },
      diagnostics: [
        {
          code: "WorkflowDraft.incomplete",
          message: "Draft is incomplete while authoring.",
          severity: "warning",
          path: "$.nodes",
        },
      ],
      validationState: "warning",
      revision: 1,
      createdBy: "user:catalog",
      createdAt,
      updatedBy: "user:catalog",
      updatedAt,
    };
    const published = createWorkflowPublishedVersionRecord({
      workflowId: definition.id,
      version: definition.version,
      definition,
      publishedFromDraftId: draft.draftId,
      publishedBy: "user:catalog",
      publishedAt: updatedAt,
      createdAt,
    });
    const archiveState: WorkflowArchiveStateRecord = {
      workflowId: definition.id,
      source: "ui",
      archived: true,
      archivedAt: updatedAt,
      archivedBy: "user:catalog",
      archiveReason: "No longer shown in default catalog.",
      updatedAt,
    };
    const tombstone: WorkflowDeleteTombstoneRecord = {
      workflowId: definition.id,
      source: "ui",
      deleted: true,
      deletedAt: updatedAt,
      deletedBy: "user:catalog",
      lastKnownTitle: identity.title,
      lastKnownVersion: definition.version,
      lastDefinitionHash: definitionHash,
      createdAt: updatedAt,
    };

    try {
      store.saveWorkflowIdentity(identity);
      store.saveWorkflowDraft(draft);
      store.savePublishedWorkflowVersion(published);
      store.saveWorkflowArchiveState(archiveState);
      store.saveWorkflowDeleteTombstone(tombstone);

      assert.deepEqual(store.getWorkflowIdentity(definition.id), identity);
      assert.deepEqual(store.listWorkflowIdentities({ workflowId: definition.id }), [identity]);
      assert.deepEqual(store.getWorkflowDraft(draft.draftId), draft);
      assert.deepEqual(store.listWorkflowDrafts({ workflowId: definition.id }), [draft]);
      assert.deepEqual(store.getPublishedWorkflowVersion(definition.id, definition.version), published);
      assert.deepEqual(store.getWorkflowArchiveState(definition.id), archiveState);
      assert.deepEqual(store.listWorkflowArchiveStates({ archived: true }), [archiveState]);
      assert.deepEqual(store.getWorkflowDeleteTombstone(definition.id), tombstone);
      assert.deepEqual(store.listWorkflowDeleteTombstones(), [tombstone]);

      assert.equal(draft.source, "ui");
      assert.equal(draft.status, "draft");
      assert.equal(published.source, "ui");
      assert.equal(published.status, "published");
    } finally {
      store.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists partial invalid UI drafts and enforces one active draft per workflow identity", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-draft-store-"));
    const store = new SqliteWorkflowRunStore(join(tempRoot, "pibo-workflows.sqlite"));
    const definition = createDefinition({ id: "workflow.ui.draft-store" });
    const identity: WorkflowIdentityRecord = {
      workflowId: definition.id,
      source: "ui",
      title: "Draft store workflow",
      tags: ["drafts"],
      createdBy: "user:catalog",
      createdAt,
      updatedBy: "user:catalog",
      updatedAt: createdAt,
    };
    const draft: WorkflowDraftRecord = {
      draftId: "wfd_draft_store_1",
      workflowId: definition.id,
      source: "ui",
      status: "draft",
      baseWorkflowId: definition.id,
      baseWorkflowVersion: definition.version,
      baseDefinitionHash: hashWorkflowDefinition(definition),
      versionIntent: "patch",
      definition: {
        id: definition.id,
        title: "Incomplete draft can still be saved",
      },
      diagnostics: [
        {
          code: "WorkflowValidationError.missingNodes",
          message: "Workflow IR must include a nodes object.",
          severity: "error",
          path: "$.nodes",
        },
      ],
      validationState: "error",
      revision: 1,
      createdBy: "user:catalog",
      createdAt,
      updatedBy: "user:catalog",
      updatedAt,
    };

    try {
      store.saveWorkflowIdentity(identity);
      store.saveWorkflowDraft(draft);

      assert.deepEqual(store.getWorkflowDraft(draft.draftId), draft);
      assert.deepEqual(store.listWorkflowDrafts({ workflowId: definition.id }), [draft]);
      assert.equal(store.getWorkflowIdentity(definition.id)?.currentDraftId, draft.draftId);

      const conflictingDraft: WorkflowDraftRecord = {
        ...draft,
        draftId: "wfd_draft_store_2",
        revision: 1,
        updatedAt: "2026-05-11T05:02:00.000Z",
      };
      assert.throws(
        () => store.saveWorkflowDraft(conflictingDraft),
        /Workflow 'workflow\.ui\.draft-store' already has an active draft 'wfd_draft_store_1'\./,
      );

      const updatedDraft: WorkflowDraftRecord = {
        ...draft,
        revision: 2,
        diagnostics: [
          {
            code: "WorkflowDraft.partial",
            message: "Draft remains incomplete but parsed.",
            severity: "warning",
            path: "$.output",
          },
        ],
        validationState: "warning",
        updatedAt: "2026-05-11T05:03:00.000Z",
      };
      store.saveWorkflowDraft(updatedDraft);
      assert.deepEqual(store.getWorkflowDraft(draft.draftId), updatedDraft);
      assert.deepEqual(store.listWorkflowDrafts({ workflowId: definition.id }), [updatedDraft]);
    } finally {
      store.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("records delete tombstones without removing historical definition snapshots", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-catalog-tombstone-"));
    const store = new SqliteWorkflowRunStore(join(tempRoot, "pibo-workflows.sqlite"));
    const definition = createDefinition({ id: "workflow.ui.deleted" });
    const snapshot: WorkflowDefinitionSnapshot = {
      id: "wfs_deleted_1",
      workflowId: definition.id,
      workflowVersion: definition.version,
      hash: hashWorkflowDefinition(definition),
      definition,
      createdAt,
    };
    const tombstone: WorkflowDeleteTombstoneRecord = {
      workflowId: definition.id,
      source: "ui",
      deleted: true,
      deletedAt: updatedAt,
      deletedBy: "user:catalog",
      lastKnownTitle: "Deleted workflow",
      lastKnownVersion: definition.version,
      lastDefinitionHash: snapshot.hash,
      createdAt: updatedAt,
    };

    try {
      store.saveDefinitionSnapshot(snapshot);
      store.saveWorkflowDeleteTombstone(tombstone);

      assert.deepEqual(store.getWorkflowDeleteTombstone(definition.id), tombstone);
      assert.deepEqual(store.getDefinitionSnapshot(snapshot.id), snapshot);
      assert.deepEqual(store.listDefinitionSnapshots({ workflowId: definition.id }), [snapshot]);
    } finally {
      store.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
