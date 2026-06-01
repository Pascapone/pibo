import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  minimalOneNodePiboAgentWorkflowFixture,
  recordWorkflowEdgeTransfer,
  SqliteWorkflowRunStore,
  text,
} from "../index.js";
import type {
  EdgeTransfer,
  NodeAttempt,
  WorkflowCheckpoint,
  WorkflowDefinition,
  WorkflowDefinitionSnapshot,
  WorkflowHumanActionRecord,
  WorkflowRun,
  WorkflowRuntimeEvent,
  WorkflowWakeup,
  WorkflowWaitToken,
} from "../index.js";

const createdAt = "2026-05-11T03:00:00.000Z";
const updatedAt = "2026-05-11T03:00:01.000Z";

function createRun(): WorkflowRun {
  return {
    id: "wfr_facts",
    workflowId: "workflow.facts",
    workflowVersion: "1.0.0",
    workflowDefinitionHash: "hash_facts",
    definitionSnapshotId: "wds_facts",
    piboSessionId: "ps_facts",
    projectId: "project_facts",
    environment: { kind: "docker", id: "pibo-dev-Workflows" },
    status: "running",
    current: { nodeId: "source", status: "running" },
    input: "start",
    state: { global: { topic: "persistence" }, local: { source: { drafts: 1 } } },
    checkpoint: { id: "wcp_facts", namespace: "main" },
    createdAt,
    updatedAt,
  };
}

function createDirectEdgeWorkflow(): WorkflowDefinition {
  return {
    id: "workflow.facts",
    version: "1.0.0",
    input: text(),
    output: text(),
    initial: "source",
    final: "target",
    nodes: {
      source: { kind: "code", language: "typescript", handler: "source", input: text(), output: text() },
      target: { kind: "code", language: "typescript", handler: "target", input: text(), output: text() },
    },
    edges: {
      source_to_target: {
        id: "source_to_target",
        from: { nodeId: "source" },
        to: { nodeId: "target" },
      },
    },
  };
}

describe("workflow fact persistence", () => {
  it("persists workflow events, edge transfers, checkpoints, wakeups, waits, and state snapshots", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-facts-test-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const store = new SqliteWorkflowRunStore(dbPath);
    const run = createRun();
    const snapshot: WorkflowDefinitionSnapshot = {
      id: "wds_facts",
      workflowId: minimalOneNodePiboAgentWorkflowFixture.id,
      workflowVersion: minimalOneNodePiboAgentWorkflowFixture.version,
      hash: "hash_facts",
      definition: minimalOneNodePiboAgentWorkflowFixture,
      createdAt,
    };
    const nodeAttempt: NodeAttempt = {
      id: "wna_source_1",
      workflowRunId: run.id,
      nodeId: "source",
      attempt: 1,
      kind: "code",
      status: "completed",
      input: "start",
      output: "done",
      localState: { drafts: 1 },
      startedAt: createdAt,
      completedAt: updatedAt,
    };
    const checkpoint: WorkflowCheckpoint = {
      id: "wcp_facts",
      workflowRunId: run.id,
      namespace: "main",
      cursor: { nodeId: "source", status: "running" },
      globalState: { topic: "persistence" },
      pendingNodeIds: ["target"],
      completedNodeIds: ["source"],
      edgePayloadRefs: ["wet_manual"],
      createdAt: updatedAt,
    };
    const wakeup: WorkflowWakeup = {
      id: "wwu_retry_1",
      workflowRunId: run.id,
      nodeAttemptId: nodeAttempt.id,
      kind: "retry",
      availableAt: "2026-05-11T03:05:00.000Z",
      correlationId: "retry:source:2",
      payload: { attempt: 2 },
      createdAt,
    };
    const waitToken: WorkflowWaitToken = {
      id: "wwt_review_1",
      workflowRunId: run.id,
      nodeAttemptId: "wna_review_1",
      humanNodeId: "review",
      kind: "approval",
      actions: [{ id: "approve", kind: "approve" }],
      prompt: "Approve?",
      status: "pending",
      createdAt,
      expiresAt: "2026-05-12T03:00:00.000Z",
    };
    const humanAction: WorkflowHumanActionRecord = {
      id: "wha_approve_1",
      workflowRunId: run.id,
      waitTokenId: waitToken.id,
      kind: "approve",
      actor: { userId: "user:facts" },
      payload: { approved: true },
      createdAt: updatedAt,
    };
    const manualEvent: WorkflowRuntimeEvent = {
      type: "checkpoint.created",
      runId: run.id,
      checkpointId: checkpoint.id,
    };

    try {
      store.saveDefinitionSnapshot(snapshot);
      store.saveRun(run);
      store.saveNodeAttempt(nodeAttempt);
      store.saveCheckpoint(checkpoint);
      store.saveWakeup(wakeup);
      store.saveWaitToken(waitToken);
      store.saveHumanAction(humanAction);
      store.saveEvent({
        id: "wev_checkpoint_1",
        workflowRunId: run.id,
        type: manualEvent.type,
        payload: manualEvent,
        createdAt,
      });
      const edgeResult = await recordWorkflowEdgeTransfer(
        createDirectEdgeWorkflow(),
        run,
        "source_to_target",
        nodeAttempt,
        {
          store,
          now: () => new Date(updatedAt),
          createEdgeTransferId: () => "wet_runtime_1",
        },
      );

      assert.equal(edgeResult.ok, true);
      store.close();

      const reopened = new SqliteWorkflowRunStore(dbPath);
      try {
        assert.deepEqual(reopened.getDefinitionSnapshot(snapshot.id), snapshot);
        assert.deepEqual(reopened.getRun(run.id)?.state, run.state);
        assert.deepEqual(reopened.getNodeAttempt(nodeAttempt.id), nodeAttempt);
        assert.deepEqual(reopened.getCheckpoint(checkpoint.id), checkpoint);
        assert.deepEqual(reopened.getWakeup(wakeup.id), wakeup);
        assert.deepEqual(reopened.getWaitToken(waitToken.id), waitToken);
        assert.deepEqual(reopened.getHumanAction(humanAction.id), humanAction);

        const persistedTransfers = reopened.listEdgeTransfers({ workflowRunId: run.id });
        assert.deepEqual(persistedTransfers.map((transfer: EdgeTransfer) => transfer.id), ["wet_runtime_1"]);
        assert.deepEqual(persistedTransfers[0]?.payload, "done");

        const events = reopened.listEvents({ workflowRunId: run.id });
        assert.deepEqual(new Set(events.map((event) => event.type)), new Set(["checkpoint.created", "edge.transferred"]));
        const edgeEvent = reopened.listEvents({ workflowRunId: run.id, type: "edge.transferred" })[0];
        assert.equal(edgeEvent?.edgeId, "source_to_target");
        assert.equal(edgeEvent?.payload?.type, "edge.transferred");
        assert.deepEqual(reopened.listWakeups({ correlationId: wakeup.correlationId }), [wakeup]);
        assert.deepEqual(reopened.listHumanActions({ waitTokenId: waitToken.id }), [humanAction]);
      } finally {
        reopened.close();
      }
    } finally {
      try {
        store.close();
      } catch {
        // Store may already be closed before reopening.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
