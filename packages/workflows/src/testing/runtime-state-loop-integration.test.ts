import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boundedReviewLoopWorkflowFixture,
  createRetryScheduledNodeAttempt,
  createWorkflowRegistry,
  decideWorkflowNodeRetry,
  dispatchWorkflowCodeNode,
  json,
  recordWorkflowEdgeTransfer,
  registerWorkflowHandler,
  text,
  transferWorkflowEdgeData,
  validateWorkflow,
  workflowFixtureProviders,
  workflowFixtureRegistryRefs,
} from "../index.js";
import type { NodeAttempt, WorkflowDefinition, WorkflowErrorSummary, WorkflowRun, WorkflowValue } from "../index.js";

function createDraftReviewWorkflow(): WorkflowDefinition {
  const draftPort = json({
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
    },
    required: ["title", "body"],
    additionalProperties: false,
  });
  const reviewPort = json({
    type: "object",
    properties: {
      approved: { type: "boolean" },
      notes: { type: "string" },
    },
    required: ["approved", "notes"],
    additionalProperties: false,
  });

  return {
    id: "test.state-isolation-edge-transfer",
    version: "1.0.0",
    input: text(),
    output: reviewPort,
    initial: "draft",
    final: "review",
    nodes: {
      draft: {
        kind: "code",
        language: "typescript",
        handler: "test.handlers.makeDraft",
        input: text(),
        output: draftPort,
        state: {
          reads: ["global.topic", "local.seed", "local.secret"],
          writes: ["global.draftTitle", "local.lastDraft"],
        },
      },
      review: {
        kind: "code",
        language: "typescript",
        handler: "test.handlers.reviewDraft",
        input: draftPort,
        output: reviewPort,
        state: {
          reads: ["global.draftTitle", "local.seed", "local.secret", "edge.draft-to-review"],
          writes: ["global.reviewNotes", "local.lastReview"],
        },
      },
    },
    edges: {
      "draft-to-review": {
        id: "draft-to-review",
        from: { nodeId: "draft" },
        to: { nodeId: "review" },
        kind: "data",
      },
    },
    state: {
      global: {
        topic: { schema: { type: "string" } },
        draftTitle: { schema: { type: "string" } },
        reviewNotes: { schema: { type: "string" } },
      },
    },
  };
}

function createDraftReviewRun(): WorkflowRun {
  return {
    id: "wfr_state_loop",
    workflowId: "test.state-isolation-edge-transfer",
    workflowVersion: "1.0.0",
    ownerScope: "user:test",
    status: "running",
    current: { nodeId: "draft", status: "running" },
    input: "Draft the workflow state story.",
    state: {
      global: { topic: "Workflow state" },
      local: {
        draft: { seed: "outline", secret: "draft-private" },
        review: { seed: "rubric" },
      },
    },
    createdAt: "2026-05-11T01:30:00.000Z",
    updatedAt: "2026-05-11T01:30:00.000Z",
  };
}

function retryableTimeout(): WorkflowErrorSummary {
  return {
    code: "WorkflowRuntimeError.timeout",
    message: "Timed out waiting for draft output.",
    retryable: true,
  };
}

describe("workflow state, edge transfer, and bounded loop integration", () => {
  it("keeps local node state isolated while transferring edge payloads between stateful code nodes", async () => {
    const definition = createDraftReviewWorkflow();
    const registry = createWorkflowRegistry();
    const run = createDraftReviewRun();

    registerWorkflowHandler(registry, "test.handlers.makeDraft", ({ input, global, local }) => {
      assert.equal(input, "Draft the workflow state story.");
      assert.equal(global.get("topic"), "Workflow state");
      assert.equal(local.get("seed"), "outline");
      assert.equal(local.get("secret"), "draft-private");

      return {
        output: { title: "Workflow state", body: "Local state stays private." },
        globalPatch: { draftTitle: "Workflow state" },
        localPatch: { lastDraft: "v1" },
      };
    });
    registerWorkflowHandler(registry, "test.handlers.reviewDraft", ({ input, global, local, edge }) => {
      assert.deepEqual(input, { title: "Workflow state", body: "Local state stays private." });
      assert.equal(global.get("draftTitle"), "Workflow state");
      assert.equal(local.get("seed"), "rubric");
      assert.equal(local.get("secret"), undefined);
      assert.deepEqual(edge.get("draft-to-review"), input);

      return {
        output: { approved: false, notes: "Needs another example." },
        globalPatch: { reviewNotes: "Needs another example." },
        localPatch: { lastReview: "needs_revision" },
      };
    });

    const validation = validateWorkflow(definition, { registry });
    assert.equal(validation.ok, true);

    const draftResult = await dispatchWorkflowCodeNode(definition, run, "draft", run.input, {
      registry,
      now: () => "2026-05-11T01:30:01.000Z",
      createNodeAttemptId: () => "wna_state_draft",
    });
    assert.equal(draftResult.ok, true);
    assert.deepEqual(run.state.local?.draft, { seed: "outline", secret: "draft-private", lastDraft: "v1" });

    const transferResult = await recordWorkflowEdgeTransfer(definition, run, "draft-to-review", draftResult.nodeAttempt, {
      now: () => "2026-05-11T01:30:02.000Z",
      createEdgeTransferId: () => "wet_state_draft_to_review",
    });
    assert.equal(transferResult.ok, true);
    assert.deepEqual(transferResult.targetInput, draftResult.output);
    assert.deepEqual(run.current, { edgeId: "draft-to-review", status: "running" });

    const reviewResult = await dispatchWorkflowCodeNode(definition, run, "review", transferResult.targetInput, {
      registry,
      now: () => "2026-05-11T01:30:03.000Z",
      createNodeAttemptId: () => "wna_state_review",
      edgePayloads: { "draft-to-review": transferResult.targetInput },
    });

    assert.equal(reviewResult.ok, true);
    assert.deepEqual(reviewResult.output, { approved: false, notes: "Needs another example." });
    assert.deepEqual(run.state.global, {
      topic: "Workflow state",
      draftTitle: "Workflow state",
      reviewNotes: "Needs another example.",
    });
    assert.deepEqual(run.state.local?.draft, { seed: "outline", secret: "draft-private", lastDraft: "v1" });
    assert.deepEqual(run.state.local?.review, { seed: "rubric", lastReview: "needs_revision" });
    assert.deepEqual(reviewResult.nodeAttempt.localState, { seed: "rubric", lastReview: "needs_revision" });
  });

  it("validates a bounded review/fix back-edge and schedules only bounded draft retries", async () => {
    const definition = structuredClone(boundedReviewLoopWorkflowFixture);
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    const validation = validateWorkflow(definition, { registry });
    assert.equal(validation.ok, true);
    assert.deepEqual(definition.loops?.[0], {
      edgeId: "revise-to-draft",
      maxAttempts: 3,
      guard: { handler: workflowFixtureRegistryRefs.guards.needsRevision },
    });

    const run: WorkflowRun = {
      id: "wfr_bounded_review_loop",
      workflowId: definition.id,
      workflowVersion: definition.version,
      ownerScope: "user:test",
      status: "running",
      current: { nodeId: "revise", status: "running" },
      input: { topic: "Workflow loops" },
      state: {
        global: {
          reviewNotes: { approved: false, notes: "Add concrete examples." },
          revisionCount: 1,
        },
      },
      createdAt: "2026-05-11T01:35:00.000Z",
      updatedAt: "2026-05-11T01:35:00.000Z",
    };

    const guard = registry.guards.get(workflowFixtureRegistryRefs.guards.needsRevision);
    assert.ok(guard);
    assert.equal(
      await guard.value({
        run,
        edge: definition.edges["needs-revision"],
        output: { approved: false, notes: "Add concrete examples." },
      }),
      true,
    );

    const reviseAttempt: NodeAttempt = {
      id: "wna_revise_for_back_edge",
      workflowRunId: run.id,
      nodeId: "revise",
      attempt: 1,
      kind: "code",
      status: "completed",
      input: { approved: false, notes: "Add concrete examples." },
      output: { topic: "Add concrete examples." },
      startedAt: "2026-05-11T01:35:01.000Z",
      completedAt: "2026-05-11T01:35:02.000Z",
    };

    const backEdgeTransfer = transferWorkflowEdgeData(definition, run, "revise-to-draft", reviseAttempt, {
      now: () => "2026-05-11T01:35:03.000Z",
      createEdgeTransferId: () => "wet_revise_to_draft",
    });
    assert.equal(backEdgeTransfer.ok, true);
    assert.deepEqual(backEdgeTransfer.targetInput, { topic: "Add concrete examples." });

    const draftNode = definition.nodes.draft;
    assert.equal(draftNode.kind, "agent");
    const failedDraftAttempt: NodeAttempt = {
      id: "wna_failed_draft_1",
      workflowRunId: run.id,
      nodeId: "draft",
      attempt: 1,
      kind: "agent",
      status: "failed",
      input: backEdgeTransfer.targetInput as WorkflowValue,
      error: retryableTimeout(),
      failedAt: "2026-05-11T01:35:04.000Z",
    };

    const retryDecision = decideWorkflowNodeRetry({
      workflow: definition,
      node: draftNode,
      nodeAttempt: failedDraftAttempt,
      error: retryableTimeout(),
      now: () => "2026-05-11T01:35:04.000Z",
    });
    assert.equal(retryDecision.kind, "retry");
    if (retryDecision.kind !== "retry") {
      return;
    }

    const scheduled = createRetryScheduledNodeAttempt(failedDraftAttempt, retryDecision, { id: "wna_draft_retry_2" });
    assert.equal(scheduled.status, "retry_scheduled");
    assert.equal(scheduled.attempt, 2);
    assert.equal(scheduled.availableAt, "2026-05-11T01:35:05.000Z");

    const secondFailedDraftAttempt: NodeAttempt = { ...failedDraftAttempt, id: "wna_failed_draft_2", attempt: 2 };
    const exhausted = decideWorkflowNodeRetry({
      workflow: definition,
      node: draftNode,
      nodeAttempt: secondFailedDraftAttempt,
      error: retryableTimeout(),
    });
    assert.equal(exhausted.kind, "exhausted");
    if (exhausted.kind === "exhausted") {
      assert.equal(exhausted.error.code, "WorkflowRetryExhaustedError.maxAttemptsExceeded");
    }
  });
});
