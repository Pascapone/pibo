import type {
  NodeAttempt,
  NodeAttemptId,
  RetryBackoffPolicy,
  RetryPolicy,
  WorkflowDefinition,
  WorkflowErrorSummary,
} from "../types/index.js";
import { createWorkflowRuntimeId } from "./ids.js";

export type WorkflowNodeRetryDecision =
  | {
      kind: "retry";
      policy: RetryPolicy;
      currentAttempt: number;
      nextAttempt: number;
      maxAttempts: number;
      availableAt: string;
      delayMs: number;
    }
  | {
      kind: "exhausted";
      policy: RetryPolicy;
      currentAttempt: number;
      maxAttempts: number;
      error: WorkflowErrorSummary;
    }
  | {
      kind: "none";
      reason: "no_policy" | "not_retryable" | "retry_on_mismatch";
    };

export type WorkflowNodeRetryDecisionOptions = {
  workflow: Pick<WorkflowDefinition, "retry">;
  node: WorkflowDefinition["nodes"][string];
  nodeAttempt: Pick<NodeAttempt, "attempt">;
  error: WorkflowErrorSummary;
  now?: () => Date | string;
};

export function resolveWorkflowRetryPolicy(
  workflow: Pick<WorkflowDefinition, "retry">,
  node: WorkflowDefinition["nodes"][string],
): RetryPolicy | undefined {
  return node.retry ?? workflow.retry;
}

export function decideWorkflowNodeRetry(options: WorkflowNodeRetryDecisionOptions): WorkflowNodeRetryDecision {
  const policy = resolveWorkflowRetryPolicy(options.workflow, options.node);
  if (!policy) {
    return { kind: "none", reason: "no_policy" };
  }

  if (options.error.retryable === false) {
    return { kind: "none", reason: "not_retryable" };
  }

  if (policy.retryOn && !policy.retryOn.includes(options.error.code)) {
    return { kind: "none", reason: "retry_on_mismatch" };
  }

  const currentAttempt = options.nodeAttempt.attempt;
  if (currentAttempt >= policy.maxAttempts) {
    return {
      kind: "exhausted",
      policy,
      currentAttempt,
      maxAttempts: policy.maxAttempts,
      error: {
        code: "WorkflowRetryExhaustedError.maxAttemptsExceeded",
        message: `Workflow node retry policy exhausted after ${currentAttempt} attempt${currentAttempt === 1 ? "" : "s"} (maxAttempts: ${policy.maxAttempts}).`,
        retryable: false,
        details: { originalCode: options.error.code, maxAttempts: policy.maxAttempts },
      },
    };
  }

  const nextAttempt = currentAttempt + 1;
  const delayMs = calculateRetryDelayMs(policy.backoff, nextAttempt);
  const now = options.now?.() ?? new Date();
  const nowMs = typeof now === "string" ? new Date(now).getTime() : now.getTime();
  const availableAt = new Date(nowMs + delayMs).toISOString();

  return {
    kind: "retry",
    policy,
    currentAttempt,
    nextAttempt,
    maxAttempts: policy.maxAttempts,
    availableAt,
    delayMs,
  };
}

export function createRetryScheduledNodeAttempt(
  previousAttempt: NodeAttempt,
  decision: Extract<WorkflowNodeRetryDecision, { kind: "retry" }>,
  options: { id?: NodeAttemptId; error?: WorkflowErrorSummary } = {},
): NodeAttempt {
  return {
    ...previousAttempt,
    id: options.id ?? createWorkflowRuntimeId("wna"),
    attempt: decision.nextAttempt,
    status: "retry_scheduled",
    error: options.error ?? previousAttempt.error,
    availableAt: decision.availableAt,
    startedAt: undefined,
    heartbeatAt: undefined,
    completedAt: undefined,
    failedAt: undefined,
    lease: undefined,
  };
}

function calculateRetryDelayMs(backoff: RetryBackoffPolicy | undefined, nextAttempt: number): number {
  if (!backoff || backoff.kind === "none") {
    return 0;
  }

  if (backoff.kind === "fixed") {
    return backoff.delayMs;
  }

  if (backoff.kind === "linear") {
    return capRetryDelay(backoff.initialMs + Math.max(0, nextAttempt - 2) * backoff.stepMs, backoff.maxMs);
  }

  const factor = backoff.factor ?? 2;
  return capRetryDelay(backoff.initialMs * factor ** Math.max(0, nextAttempt - 2), backoff.maxMs);
}

function capRetryDelay(delayMs: number, maxMs: number | undefined): number {
  if (maxMs === undefined) {
    return delayMs;
  }

  return Math.min(delayMs, maxMs);
}
