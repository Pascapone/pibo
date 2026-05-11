import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SqliteWorkflowRunStore } from "../index.js";
import type { NodeAttempt } from "../index.js";

const workflowRunId = "wfr_node_attempts";

function createAttempts(): NodeAttempt[] {
  return [
    {
      id: "wna_agent_completed",
      workflowRunId,
      nodeId: "answer",
      attempt: 1,
      kind: "agent",
      status: "completed",
      input: "Summarize this.",
      output: "Summary.",
      metadata: {
        runtime: {
          profileId: "pibo-agent",
          tools: ["read"],
          skills: ["workflow-review"],
          contextFiles: ["AGENTS.md"],
          routing: { ownerScope: "user:node-attempts", projectId: "project_1" },
        },
        piboSessionId: "ps_agent",
        piSessionId: "pi_agent",
      },
      startedAt: "2026-05-11T02:00:01.000Z",
      completedAt: "2026-05-11T02:00:02.000Z",
    },
    {
      id: "wna_code_failed",
      workflowRunId,
      nodeId: "format",
      attempt: 1,
      kind: "code",
      status: "failed",
      input: { draft: "hello" },
      metadata: { handlerId: "workflow.code.format" },
      error: { code: "WorkflowRuntimeError.codeNodeDispatchFailed", message: "Handler failed." },
      startedAt: "2026-05-11T02:00:03.000Z",
      failedAt: "2026-05-11T02:00:04.000Z",
    },
    {
      id: "wna_workflow_running",
      workflowRunId,
      nodeId: "child",
      attempt: 1,
      kind: "workflow",
      status: "running",
      input: { task: "delegate" },
      metadata: { workflowId: "child.workflow", workflowVersion: "1.0.0" },
      startedAt: "2026-05-11T02:00:05.000Z",
      heartbeatAt: "2026-05-11T02:00:06.000Z",
    },
    {
      id: "wna_human_waiting",
      workflowRunId,
      nodeId: "review",
      attempt: 1,
      kind: "human",
      status: "waiting",
      input: { title: "Review me" },
      metadata: { waitTokenId: "wwt_review" },
      startedAt: "2026-05-11T02:00:07.000Z",
    },
    {
      id: "wna_adapter_retry",
      workflowRunId,
      nodeId: "adapt",
      attempt: 2,
      kind: "adapter",
      status: "retry_scheduled",
      input: { payload: "raw" },
      localState: { attempts: 2 },
      metadata: { adapterId: "workflow.adapter.to-json" },
      lease: {
        ownerId: "worker-a",
        token: "lease-token",
        acquiredAt: "2026-05-11T02:00:08.000Z",
        expiresAt: "2026-05-11T02:05:08.000Z",
      },
      startedAt: "2026-05-11T02:00:08.000Z",
      availableAt: "2026-05-11T02:01:08.000Z",
    },
  ];
}

describe("workflow node attempt persistence", () => {
  it("persists and reloads node attempt status for every V1 node kind", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-node-attempts-test-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const store = new SqliteWorkflowRunStore(dbPath);
    const attempts = createAttempts();

    try {
      for (const attempt of attempts) {
        store.saveNodeAttempt(attempt);
      }

      assert.deepEqual(store.getNodeAttempt("wna_agent_completed"), attempts[0]);
      assert.deepEqual(store.listNodeAttempts({ kind: "human" }), [attempts[3]]);
      assert.deepEqual(store.listNodeAttempts({ status: "retry_scheduled" }), [attempts[4]]);
      store.close();

      const reopened = new SqliteWorkflowRunStore(dbPath);
      try {
        for (const attempt of attempts) {
          assert.deepEqual(reopened.getNodeAttempt(attempt.id), attempt);
        }
        assert.deepEqual(
          new Set(reopened.listNodeAttempts({ workflowRunId }).map((attempt) => attempt.kind)),
          new Set(["agent", "code", "workflow", "human", "adapter"]),
        );
        assert.deepEqual(reopened.listNodeAttempts({ nodeId: "format" }), [attempts[1]]);
      } finally {
        reopened.close();
      }
    } finally {
      try {
        store.close();
      } catch {
        // Store may already be closed by the reopen check.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
