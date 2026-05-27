import type {
  RetryBackoffPolicy,
  RetryPolicy,
  WorkflowDiagnostic,
} from "../types/index.js";

export function validateWorkflowRetryPolicy(
  policy: RetryPolicy | undefined,
  path: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId"> = {},
): void {
  if (policy === undefined) {
    return;
  }

  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    diagnostics.push({
      code: "WorkflowRetryError.invalidMaxAttempts",
      message: "Workflow retry policies must declare maxAttempts as a positive integer.",
      severity: "error",
      ...target,
      path: `${path}.maxAttempts`,
      hint: "Set maxAttempts to the total number of attempts allowed, for example maxAttempts: 3.",
    });
  }

  if (policy.backoff !== undefined) {
    validateWorkflowRetryBackoffPolicy(policy.backoff, `${path}.backoff`, diagnostics, target);
  }

  if (policy.retryOn !== undefined) {
    if (!Array.isArray(policy.retryOn)) {
      diagnostics.push({
        code: "WorkflowRetryError.invalidRetryOn",
        message: "Workflow retry policy retryOn must be an array of non-empty error code strings.",
        severity: "error",
        ...target,
        path: `${path}.retryOn`,
        hint: "Use retryOn: ['WorkflowRuntimeError.transient'] or omit retryOn to retry all retryable errors until maxAttempts.",
      });
      return;
    }

    policy.retryOn.forEach((code, index) => {
      if (typeof code !== "string" || code.length === 0) {
        diagnostics.push({
          code: "WorkflowRetryError.invalidRetryOn",
          message: "Workflow retry policy retryOn entries must be non-empty error code strings.",
          severity: "error",
          ...target,
          path: `${path}.retryOn.${index}`,
          hint: "Use stable error codes such as 'WorkflowRuntimeError.timeout'.",
        });
      }
    });
  }
}

function validateWorkflowRetryBackoffPolicy(
  backoff: RetryBackoffPolicy,
  path: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId">,
): void {
  if (!isRecord(backoff)) {
    diagnostics.push({
      code: "WorkflowRetryError.invalidBackoffPolicy",
      message: "Workflow retry backoff policy must be an object.",
      severity: "error",
      ...target,
      path,
      hint: "Use { kind: 'none' }, { kind: 'fixed', delayMs }, { kind: 'linear', initialMs, stepMs }, or { kind: 'exponential', initialMs }.",
    });
    return;
  }

  switch (backoff.kind) {
    case "none":
      return;
    case "fixed":
      validateNonNegativeNumber(backoff.delayMs, `${path}.delayMs`, "delayMs", diagnostics, target);
      return;
    case "linear":
      validateNonNegativeNumber(backoff.initialMs, `${path}.initialMs`, "initialMs", diagnostics, target);
      validateNonNegativeNumber(backoff.stepMs, `${path}.stepMs`, "stepMs", diagnostics, target);
      validateOptionalNonNegativeNumber(backoff.maxMs, `${path}.maxMs`, "maxMs", diagnostics, target);
      return;
    case "exponential":
      validateNonNegativeNumber(backoff.initialMs, `${path}.initialMs`, "initialMs", diagnostics, target);
      if (backoff.factor !== undefined && (typeof backoff.factor !== "number" || backoff.factor <= 1)) {
        diagnostics.push({
          code: "WorkflowRetryError.invalidBackoffPolicy",
          message: "Workflow exponential retry backoff factor must be greater than 1 when declared.",
          severity: "error",
          ...target,
          path: `${path}.factor`,
          hint: "Omit factor to use the runtime default, or set factor to a number greater than 1.",
        });
      }
      validateOptionalNonNegativeNumber(backoff.maxMs, `${path}.maxMs`, "maxMs", diagnostics, target);
      return;
    default:
      diagnostics.push({
        code: "WorkflowRetryError.invalidBackoffPolicy",
        message: "Workflow retry backoff policy kind is not supported.",
        severity: "error",
        ...target,
        path: `${path}.kind`,
        hint: "Use backoff kind 'none', 'fixed', 'linear', or 'exponential'.",
      });
  }
}

function validateNonNegativeNumber(
  value: unknown,
  path: string,
  field: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId">,
): void {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return;
  }

  diagnostics.push({
    code: "WorkflowRetryError.invalidBackoffPolicy",
    message: `Workflow retry backoff ${field} must be a non-negative number.`,
    severity: "error",
    ...target,
    path,
    hint: "Use millisecond delays greater than or equal to 0.",
  });
}

function validateOptionalNonNegativeNumber(
  value: unknown,
  path: string,
  field: string,
  diagnostics: WorkflowDiagnostic[],
  target: Pick<WorkflowDiagnostic, "nodeId" | "edgeId">,
): void {
  if (value === undefined) {
    return;
  }

  validateNonNegativeNumber(value, path, field, diagnostics, target);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
