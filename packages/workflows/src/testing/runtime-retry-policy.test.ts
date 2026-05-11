import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  boundedReviewLoopWorkflowFixture,
  createRetryScheduledNodeAttempt,
  decideWorkflowNodeRetry,
  minimalOneNodePiboAgentWorkflowFixture,
  resolveWorkflowRetryPolicy,
} from "../index.js";
import type { NodeAttempt, WorkflowErrorSummary } from "../index.js";

const retryableError: WorkflowErrorSummary = {
  code: "WorkflowRuntimeError.timeout",
  message: "Timed out while waiting for node output.",
  retryable: true,
};

function nodeAttempt(attempt: number): NodeAttempt {
  return {
    id: `wna_attempt_${attempt}`,
    workflowRunId: "wfr_retry_policy",
    nodeId: "draft",
    attempt,
    kind: "agent",
    status: "failed",
    input: { topic: "Retry policy" },
    error: retryableError,
    startedAt: "2026-05-11T00:00:00.000Z",
    failedAt: "2026-05-11T00:00:10.000Z",
  };
}

describe("workflow retry policy runtime helpers", () => {
  it("resolves node retry policy before workflow retry policy", () => {
    const workflow = structuredClone(boundedReviewLoopWorkflowFixture);
    const draftNode = workflow.nodes.draft;
    assert.equal(draftNode.kind, "agent");

    workflow.retry = { maxAttempts: 5, backoff: { kind: "fixed", delayMs: 5_000 } };

    const policy = resolveWorkflowRetryPolicy(workflow, draftNode);

    assert.deepEqual(policy, { maxAttempts: 2, backoff: { kind: "fixed", delayMs: 1_000 } });
  });

  it("schedules the next node attempt until maxAttempts is reached", () => {
    const workflow = structuredClone(boundedReviewLoopWorkflowFixture);
    const draftNode = workflow.nodes.draft;
    assert.equal(draftNode.kind, "agent");

    const decision = decideWorkflowNodeRetry({
      workflow,
      node: draftNode,
      nodeAttempt: nodeAttempt(1),
      error: retryableError,
      now: () => "2026-05-11T00:00:10.000Z",
    });

    assert.equal(decision.kind, "retry");
    if (decision.kind !== "retry") {
      return;
    }

    assert.equal(decision.nextAttempt, 2);
    assert.equal(decision.availableAt, "2026-05-11T00:00:11.000Z");

    const scheduled = createRetryScheduledNodeAttempt(nodeAttempt(1), decision, { id: "wna_retry_scheduled" });
    assert.equal(scheduled.id, "wna_retry_scheduled");
    assert.equal(scheduled.attempt, 2);
    assert.equal(scheduled.status, "retry_scheduled");
    assert.equal(scheduled.availableAt, "2026-05-11T00:00:11.000Z");
    assert.equal(scheduled.startedAt, undefined);
    assert.equal(scheduled.failedAt, undefined);
  });

  it("returns a retry-exhausted diagnostic error when maxAttempts is exceeded", () => {
    const workflow = structuredClone(boundedReviewLoopWorkflowFixture);
    const draftNode = workflow.nodes.draft;
    assert.equal(draftNode.kind, "agent");

    const decision = decideWorkflowNodeRetry({
      workflow,
      node: draftNode,
      nodeAttempt: nodeAttempt(2),
      error: retryableError,
    });

    assert.equal(decision.kind, "exhausted");
    if (decision.kind !== "exhausted") {
      return;
    }

    assert.equal(decision.maxAttempts, 2);
    assert.equal(decision.error.code, "WorkflowRetryExhaustedError.maxAttemptsExceeded");
    assert.equal(decision.error.retryable, false);
  });

  it("skips retry when retryOn does not match or the error is not retryable", () => {
    const workflow = structuredClone(minimalOneNodePiboAgentWorkflowFixture);
    workflow.retry = { maxAttempts: 3, backoff: { kind: "none" }, retryOn: ["WorkflowRuntimeError.timeout"] };

    const mismatch = decideWorkflowNodeRetry({
      workflow,
      node: workflow.nodes.answer,
      nodeAttempt: nodeAttempt(1),
      error: { code: "WorkflowRuntimeError.validation", message: "Validation failed.", retryable: true },
    });
    assert.deepEqual(mismatch, { kind: "none", reason: "retry_on_mismatch" });

    const notRetryable = decideWorkflowNodeRetry({
      workflow,
      node: workflow.nodes.answer,
      nodeAttempt: nodeAttempt(1),
      error: { code: "WorkflowRuntimeError.timeout", message: "Permanent timeout.", retryable: false },
    });
    assert.deepEqual(notRetryable, { kind: "none", reason: "not_retryable" });
  });
});
