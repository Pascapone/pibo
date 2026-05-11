import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyWorkflowHumanAction,
  createWorkflowRegistry,
  dispatchWorkflowHumanNode,
  json,
  SqliteWorkflowRunStore,
  validateWorkflow,
} from "../index.js";
import type { JsonSchema, NodeAttempt, WorkflowDefinition, WorkflowRun } from "../index.js";

const createdAt = "2026-05-11T05:00:00.000Z";
const updatedAt = "2026-05-11T05:01:00.000Z";

const reviewInputSchema: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    body: { type: "string" },
  },
  required: ["title", "body"],
  additionalProperties: false,
};

const reviewDecisionSchema: JsonSchema = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    notes: { type: ["string", "null"] },
  },
  required: ["approved", "notes"],
  additionalProperties: false,
};

const reviewInputPort = json(reviewInputSchema);
const reviewDecisionPort = json(reviewDecisionSchema);

function createRun(id: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    workflowId: "workflow.persistence-validation",
    workflowVersion: "1.0.0",
    ownerScope: "user:persistence-validation",
    status: "running",
    current: { nodeId: "review", status: "running" },
    input: { title: "Persistence", body: "Validate workflow persistence." },
    state: { global: { topic: "persistence" } },
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function createAttempt(id: string, runId: string, overrides: Partial<NodeAttempt> = {}): NodeAttempt {
  return {
    id,
    workflowRunId: runId,
    nodeId: "review",
    attempt: 1,
    kind: "human",
    status: "running",
    input: { title: "Persistence", body: "Validate workflow persistence." },
    startedAt: createdAt,
    ...overrides,
  };
}

function createHumanWorkflow(): WorkflowDefinition {
  return {
    id: "workflow.persistence-validation",
    version: "1.0.0",
    input: reviewInputPort,
    output: reviewDecisionPort,
    initial: "review",
    final: "review",
    nodes: {
      review: {
        kind: "human",
        prompt: "Review persistence validation output.",
        input: reviewInputPort,
        output: reviewDecisionPort,
        schema: reviewDecisionSchema,
        actions: [{ id: "workflow.human.resume", kind: "resume" }],
      },
    },
    edges: {},
  };
}

describe("workflow persistence validation", () => {
  it("recovers completed, failed, waiting, and resumed workflow run facts after SQLite restarts", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-persistence-validation-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const definition = createHumanWorkflow();
    assert.equal(validateWorkflow(definition).ok, true);

    let store = new SqliteWorkflowRunStore(dbPath);

    try {
      const completedRun = createRun("wfr_persist_completed", {
        status: "completed",
        current: { nodeId: "review", status: "completed" },
        output: { approved: true, notes: "Completed." },
        updatedAt,
        completedAt: updatedAt,
      });
      const failedRun = createRun("wfr_persist_failed", {
        status: "failed",
        current: { nodeId: "review", status: "failed" },
        updatedAt,
        failedAt: updatedAt,
      });
      const waitingSeedRun = createRun("wfr_persist_waiting");

      store.saveRun(completedRun);
      store.saveNodeAttempt(createAttempt("wna_persist_completed", completedRun.id, {
        status: "completed",
        output: completedRun.output,
        completedAt: updatedAt,
      }));
      store.saveEvent({
        id: "wev_persist_completed",
        workflowRunId: completedRun.id,
        type: "workflow.completed",
        payload: { type: "workflow.completed", runId: completedRun.id, output: completedRun.output },
        createdAt: updatedAt,
      });

      store.saveRun(failedRun);
      store.saveNodeAttempt(createAttempt("wna_persist_failed", failedRun.id, {
        status: "failed",
        error: { code: "WorkflowRuntimeError.validation", message: "Validation failed.", retryable: false },
        failedAt: updatedAt,
      }));
      store.saveEvent({
        id: "wev_persist_failed",
        workflowRunId: failedRun.id,
        type: "workflow.failed",
        attemptId: "wna_persist_failed",
        payload: { type: "workflow.failed", runId: failedRun.id },
        createdAt: updatedAt,
      });

      const waitingResult = await dispatchWorkflowHumanNode(
        definition,
        waitingSeedRun,
        "review",
        { title: "Persistence", body: "Validate workflow persistence." },
        {
          store,
          now: () => "2026-05-11T05:02:00.000Z",
          createNodeAttemptId: () => "wna_persist_waiting",
          createWaitTokenId: () => "wwt_persist_waiting",
        },
      );
      assert.equal(waitingResult.ok, true);
      store.close();

      store = new SqliteWorkflowRunStore(dbPath);
      assert.deepEqual(store.getRun(completedRun.id), completedRun);
      assert.deepEqual(store.getRun(failedRun.id), failedRun);
      assert.deepEqual(store.getRun(waitingSeedRun.id), waitingResult.run);
      assert.equal(store.getNodeAttempt("wna_persist_waiting")?.status, "waiting");
      assert.equal(store.getWaitToken("wwt_persist_waiting")?.status, "pending");
      assert.deepEqual(store.listRuns({ status: "completed" }).map((run) => run.id), [completedRun.id]);
      assert.deepEqual(store.listRuns({ status: "failed" }).map((run) => run.id), [failedRun.id]);
      assert.deepEqual(store.listRuns({ status: "waiting" }).map((run) => run.id), [waitingSeedRun.id]);

      const resumedResult = await applyWorkflowHumanAction(
        definition,
        waitingResult.run,
        {
          waitTokenId: "wwt_persist_waiting",
          actionId: "workflow.human.resume",
          actor: { kind: "user", id: "reviewer-persistence" },
          payload: { approved: true, notes: "Resumed after restart." },
        },
        {
          registry: createWorkflowRegistry({
            humanActions: {
              "workflow.human.resume": {
                id: "workflow.human.resume",
                kind: "resume",
                title: "Resume",
                input: reviewDecisionPort,
                output: reviewDecisionPort,
              },
            },
          }),
          store,
          now: () => "2026-05-11T05:03:00.000Z",
          createHumanActionId: () => "wha_persist_resume",
          createWakeupId: () => "wwu_persist_resume",
        },
      );
      assert.equal(resumedResult.ok, true);
      store.close();

      store = new SqliteWorkflowRunStore(dbPath);
      assert.equal(store.getRun(waitingSeedRun.id)?.status, "running");
      assert.deepEqual(store.getRun(waitingSeedRun.id), resumedResult.run);
      assert.equal(store.getNodeAttempt("wna_persist_waiting")?.status, "completed");
      assert.deepEqual(store.getWaitToken("wwt_persist_waiting"), resumedResult.waitToken);
      assert.equal(store.getWaitToken("wwt_persist_waiting")?.status, "resumed");
      assert.deepEqual(store.getHumanAction("wha_persist_resume"), resumedResult.humanAction);
      assert.deepEqual(store.getWakeup("wwu_persist_resume"), resumedResult.wakeup);
      assert.deepEqual(store.listEvents({ workflowRunId: waitingSeedRun.id }).map((event) => event.type), [
        "node.started",
        "wait.created",
        "wait.resumed",
        "node.completed",
      ]);
    } finally {
      try {
        store.close();
      } catch {
        // Store may already be closed between restart checks.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
