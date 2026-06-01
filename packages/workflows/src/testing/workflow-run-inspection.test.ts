import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatWorkflowRunInspection,
  inspectWorkflowRun,
  SqliteWorkflowRunStore,
} from "../index.js";
import type { NodeAttempt, WorkflowErrorSummary, WorkflowRun } from "../index.js";

const createdAt = "2026-05-11T04:00:00.000Z";
const updatedAt = "2026-05-11T04:01:00.000Z";

function createRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "wfr_inspect",
    workflowId: "workflow.inspect",
    workflowVersion: "1.0.0",
    piboSessionId: "ps_inspect",
    projectId: "project_inspect",
    status: "completed",
    current: { nodeId: "done", status: "completed" },
    input: "start",
    output: "finished",
    state: { global: { topic: "inspection" } },
    createdAt,
    updatedAt,
    completedAt: updatedAt,
    ...overrides,
  };
}

function createAttempt(overrides: Partial<NodeAttempt> = {}): NodeAttempt {
  return {
    id: "wna_done_1",
    workflowRunId: "wfr_inspect",
    nodeId: "done",
    attempt: 1,
    kind: "code",
    status: "completed",
    input: "start",
    output: "finished",
    startedAt: createdAt,
    completedAt: updatedAt,
    ...overrides,
  };
}

function assertNoWorkflowOwnerFields(value: unknown): void {
  const blockedKeys = new Set([["owner", "Scope"].join(""), ["owner", "scope"].join("_")]);
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      assert.equal(blockedKeys.has(key), false);
      stack.push(child);
    }
  }
}

describe("workflow run inspection", () => {
  it("builds an inspectable completed run summary after SQLite restart", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-inspection-completed-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const run = createRun();
    let store = new SqliteWorkflowRunStore(dbPath);

    try {
      store.saveRun(run);
      store.saveNodeAttempt(createAttempt());
      store.saveCheckpoint({
        id: "wcp_done",
        workflowRunId: run.id,
        namespace: "main",
        cursor: run.current,
        globalState: run.state.global,
        pendingNodeIds: [],
        completedNodeIds: ["done"],
        edgePayloadRefs: [],
        createdAt: updatedAt,
      });
      store.saveEvent({
        id: "wev_completed",
        workflowRunId: run.id,
        type: "workflow.completed",
        payload: { type: "workflow.completed", runId: run.id, output: run.output },
        createdAt: updatedAt,
      });
      store.close();

      store = new SqliteWorkflowRunStore(dbPath);
      const inspection = await inspectWorkflowRun(store, run.id);

      assert.ok(inspection);
      assert.equal(inspection.kind, "workflowRunInspection");
      assert.equal(inspection.summary.status, "completed");
      assert.equal(inspection.summary.completedNodeAttempts, 1);
      assert.equal(inspection.summary.latestCheckpointId, "wcp_done");
      assert.equal(inspection.run.output, "finished");
      assert.equal(inspection.events[0]?.type, "workflow.completed");
      assertNoWorkflowOwnerFields(inspection);
      const formatted = formatWorkflowRunInspection(inspection);
      assert.match(formatted, /status\tcompleted/);
      assert.doesNotMatch(formatted, /owner/i);
    } finally {
      store.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("surfaces failed node and error summaries for failed runs after SQLite restart", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-inspection-failed-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const error: WorkflowErrorSummary = { code: "WorkflowNodeError.failed", message: "Node failed", retryable: false };
    const run = createRun({
      id: "wfr_failed",
      status: "failed",
      current: { nodeId: "review", status: "failed" },
      output: undefined,
      completedAt: undefined,
      failedAt: updatedAt,
    });
    let store = new SqliteWorkflowRunStore(dbPath);

    try {
      store.saveRun(run);
      store.saveNodeAttempt(createAttempt({
        id: "wna_review_1",
        workflowRunId: run.id,
        nodeId: "review",
        status: "failed",
        output: undefined,
        error,
        failedAt: updatedAt,
      }));
      store.saveEvent({
        id: "wev_failed",
        workflowRunId: run.id,
        type: "workflow.failed",
        attemptId: "wna_review_1",
        payload: { type: "workflow.failed", runId: run.id, error },
        createdAt: updatedAt,
      });
      store.close();

      store = new SqliteWorkflowRunStore(dbPath);
      const inspection = await inspectWorkflowRun(store, run.id);

      assert.ok(inspection);
      assert.equal(inspection.summary.status, "failed");
      assert.equal(inspection.summary.failedNodeId, "review");
      assert.equal(inspection.summary.failedNodeAttemptId, "wna_review_1");
      assert.deepEqual(inspection.summary.error, error);
      assert.match(formatWorkflowRunInspection(inspection), /failed_node\treview/);
    } finally {
      store.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns undefined for unknown runs", async () => {
    const store = new SqliteWorkflowRunStore(":memory:");
    try {
      assert.equal(await inspectWorkflowRun(store, "wfr_missing"), undefined);
    } finally {
      store.close();
    }
  });
});
