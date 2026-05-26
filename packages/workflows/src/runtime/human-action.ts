import type {
  JsonObject,
  NodeAttempt,
  RegistryRefId,
  WorkflowDefinition,
  WorkflowDiagnostic,
  WorkflowErrorSummary,
  WorkflowEventEmitter,
  WorkflowHumanActionId,
  WorkflowHumanActionKind,
  WorkflowHumanActionRecord,
  WorkflowRegistry,
  WorkflowRun,
  WorkflowRuntimeEvent,
  WorkflowValue,
  WorkflowWaitToken,
  WorkflowWaitTokenId,
  WorkflowWakeup,
  WorkflowWakeupId,
} from "../types/index.js";
import type {
  WorkflowHumanActionStore,
  WorkflowRunStore,
  WorkflowWaitTokenStore,
} from "../store/index.js";
import { resolveWorkflowHumanAction } from "../registry/index.js";
import {
  validateJsonValueAgainstSchema,
  validateNodeOutput,
  validateWorkflowPortValue,
} from "../validation/index.js";
import { createWorkflowRuntimeId as createId } from "./ids.js";
import {
  emitWorkflowRuntimeEvent,
  hasWorkflowNodeAttemptReadStore,
  hasWorkflowWakeupStore,
  persistWorkflowNodeAttempt,
  persistWorkflowRun,
} from "./persistence.js";
import { createTimestampFactory, timestampToMillis } from "./time.js";

export type WorkflowHumanActionDecisionKind = "approved" | "rejected" | "submitted" | "cancelled";

export type WorkflowHumanActionApplyRequest = {
  waitTokenId: WorkflowWaitTokenId;
  actionId?: RegistryRefId;
  kind?: WorkflowHumanActionKind;
  actor?: JsonObject;
  payload?: WorkflowValue;
};

export type WorkflowHumanActionApplyOptions = {
  registry: Pick<WorkflowRegistry, "humanActions">;
  store: WorkflowRunStore & WorkflowWaitTokenStore & WorkflowHumanActionStore;
  now?: () => Date | string;
  createHumanActionId?: () => WorkflowHumanActionId;
  createWakeupId?: () => WorkflowWakeupId;
  emitEvent?: WorkflowEventEmitter;
};

export type WorkflowHumanActionApplySuccess = {
  ok: true;
  run: WorkflowRun;
  waitToken: WorkflowWaitToken;
  humanAction: WorkflowHumanActionRecord;
  events: WorkflowRuntimeEvent[];
  decision: {
    kind: WorkflowHumanActionDecisionKind;
    actionId: RegistryRefId;
    actionKind: WorkflowHumanActionKind;
  };
  wakeup?: WorkflowWakeup;
  nodeAttempt?: NodeAttempt;
};

export type WorkflowHumanActionApplyFailure = {
  ok: false;
  run: WorkflowRun;
  waitToken?: WorkflowWaitToken;
  events: WorkflowRuntimeEvent[];
  diagnostics: WorkflowDiagnostic[];
  error: WorkflowErrorSummary;
};

export type WorkflowHumanActionApplyResult = WorkflowHumanActionApplySuccess | WorkflowHumanActionApplyFailure;

export async function applyWorkflowHumanAction(
  definition: WorkflowDefinition,
  run: WorkflowRun,
  request: WorkflowHumanActionApplyRequest,
  options: WorkflowHumanActionApplyOptions,
): Promise<WorkflowHumanActionApplyResult> {
  const events: WorkflowRuntimeEvent[] = [];
  const timestamp = createTimestampFactory(options.now);
  const actedAt = timestamp();
  const diagnostics: WorkflowDiagnostic[] = [];
  const waitToken = await options.store.getWaitToken(request.waitTokenId);

  if (!waitToken) {
    diagnostics.push({
      code: "WorkflowRuntimeError.unknownWaitToken",
      message: `Workflow wait token '${request.waitTokenId}' does not exist, so no human action can be applied.`,
      severity: "error",
      path: "$.waitTokenId",
      hint: "Submit human actions only for pending wait tokens returned by workflow inspection.",
    });
    return humanActionApplyFailure(run, events, diagnostics, {
      code: "WorkflowRuntimeError.unknownWaitToken",
      message: "Human action failed because the wait token was not found.",
    });
  }

  if (waitToken.workflowRunId !== run.id) {
    diagnostics.push({
      code: "WorkflowRuntimeError.waitTokenRunMismatch",
      message: `Workflow wait token '${waitToken.id}' belongs to run '${waitToken.workflowRunId}', not run '${run.id}'.`,
      severity: "error",
      path: "$.waitTokenId",
      hint: "Load and update the workflow run that owns the wait token.",
    });
  }

  if (waitToken.status !== "pending") {
    diagnostics.push({
      code: "WorkflowRuntimeError.waitTokenNotPending",
      message: `Workflow wait token '${waitToken.id}' is '${waitToken.status}' and cannot accept another human action.`,
      severity: "error",
      path: "$.waitToken.status",
      hint: "Human wait tokens can only be resolved once while they are pending.",
    });
  }

  if (waitToken.expiresAt && timestampToMillis(waitToken.expiresAt) <= timestampToMillis(actedAt)) {
    waitToken.status = "expired";
    waitToken.resumedAt = actedAt;
    await options.store.saveWaitToken(waitToken);
    diagnostics.push({
      code: "WorkflowRuntimeError.waitTokenExpired",
      message: `Workflow wait token '${waitToken.id}' expired at ${waitToken.expiresAt}.`,
      severity: "error",
      path: "$.waitToken.expiresAt",
      hint: "Create a new human wait or route timeout handling before submitting an action.",
    });
  }

  const actionRef = resolveRequestedHumanActionRef(waitToken, request);
  if (!actionRef) {
    diagnostics.push({
      code: "WorkflowRuntimeError.humanActionUnavailable",
      message: request.actionId
        ? `Workflow wait token '${waitToken.id}' does not offer human action '${request.actionId}'.`
        : `Workflow wait token '${waitToken.id}' does not offer a human action of kind '${request.kind ?? "<missing>"}'.`,
      severity: "error",
      path: request.actionId ? "$.actionId" : "$.kind",
      hint: "Use one of the wait token's available action refs.",
    });
  }

  const actionDefinition = actionRef ? resolveWorkflowHumanAction(options.registry, actionRef.id) : undefined;
  if (actionRef && !actionDefinition) {
    diagnostics.push({
      code: "WorkflowGraphError.unknownHumanActionRef",
      message: `Workflow wait token '${waitToken.id}' references human action '${actionRef.id}', but it is not registered in the Workflow Registry.`,
      severity: "error",
      path: "$.waitToken.actions",
      hint: "Register the action with registerWorkflowHumanAction/createWorkflowRegistry before accepting it.",
    });
  }

  if (actionRef?.kind && actionDefinition && actionRef.kind !== actionDefinition.kind) {
    diagnostics.push({
      code: "WorkflowGraphError.humanActionKindMismatch",
      message: `Workflow wait token '${waitToken.id}' action '${actionRef.id}' declares kind '${actionRef.kind}', but the registry defines kind '${actionDefinition.kind}'.`,
      severity: "error",
      path: "$.waitToken.actions",
      hint: "Keep human action refs aligned with their registered action definitions.",
    });
  }

  if (actionDefinition && request.payload !== undefined) {
    const actionPort = actionDefinition.input ?? actionDefinition.output;
    if (actionPort) {
      diagnostics.push(
        ...validateWorkflowPortValue(actionPort, request.payload, { path: "$.payload" }).diagnostics,
      );
    }
  }

  if (actionDefinition?.kind === "resume" && waitToken.schema) {
    diagnostics.push(
      ...validateJsonValueAgainstSchema(waitToken.schema, request.payload, { path: "$.payload" }),
    );
  }

  if (waitToken.humanNodeId && request.payload !== undefined) {
    const nodeOutputResult = validateNodeOutput(definition, waitToken.humanNodeId, request.payload, {
      path: "$.payload",
    });
    diagnostics.push(...nodeOutputResult.diagnostics.map((diagnostic) => ({ ...diagnostic, nodeId: waitToken.humanNodeId })));
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return humanActionApplyFailure(run, events, diagnostics, {
      code: "WorkflowRuntimeError.humanActionRejected",
      message: "Human action failed validation before resolving the wait token.",
    }, waitToken);
  }

  const actionKind = actionDefinition!.kind;
  const humanAction: WorkflowHumanActionRecord = {
    id: options.createHumanActionId?.() ?? createId("wha"),
    workflowRunId: run.id,
    waitTokenId: waitToken.id,
    kind: actionKind,
    ...(request.actor ? { actor: request.actor } : {}),
    ...(request.payload !== undefined ? { payload: request.payload } : {}),
    createdAt: actedAt,
  };
  await options.store.saveHumanAction(humanAction);

  const nodeAttempt = waitToken.nodeAttemptId && hasWorkflowNodeAttemptReadStore(options.store)
    ? await options.store.getNodeAttempt(waitToken.nodeAttemptId)
    : undefined;

  if (actionKind === "cancel") {
    waitToken.status = "cancelled";
    waitToken.resumedAt = actedAt;
    run.status = "cancelled";
    run.current = { ...(run.current.nodeId ? { nodeId: run.current.nodeId } : {}), status: "cancelled" };
    run.cancelledAt = actedAt;
    run.updatedAt = actedAt;
    if (nodeAttempt) {
      nodeAttempt.status = "cancelled";
      nodeAttempt.completedAt = actedAt;
    }

    await options.store.saveWaitToken(waitToken);
    if (nodeAttempt) {
      await persistWorkflowNodeAttempt(options.store, nodeAttempt);
    }
    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "workflow.cancelled",
      runId: run.id,
      reason: "human action cancelled workflow",
    });
    await persistWorkflowRun(options.store, run);

    return {
      ok: true,
      run,
      waitToken,
      humanAction,
      events,
      decision: { kind: "cancelled", actionId: actionDefinition!.id, actionKind },
      ...(nodeAttempt ? { nodeAttempt } : {}),
    };
  }

  waitToken.status = "resumed";
  if (request.payload !== undefined) {
    waitToken.resumePayload = request.payload;
  }
  waitToken.resumedAt = actedAt;
  run.status = "running";
  run.current = { ...(waitToken.humanNodeId ? { nodeId: waitToken.humanNodeId } : {}), status: "running" };
  run.updatedAt = actedAt;
  if (nodeAttempt) {
    nodeAttempt.status = "completed";
    if (request.payload !== undefined) {
      nodeAttempt.output = request.payload;
    }
    nodeAttempt.completedAt = actedAt;
  }

  const wakeup: WorkflowWakeup | undefined = hasWorkflowWakeupStore(options.store)
    ? {
        id: options.createWakeupId?.() ?? createId("wwu"),
        workflowRunId: run.id,
        ...(waitToken.nodeAttemptId ? { nodeAttemptId: waitToken.nodeAttemptId } : {}),
        kind: "human",
        availableAt: actedAt,
        correlationId: humanAction.id,
        ...(request.payload !== undefined ? { payload: request.payload } : {}),
        createdAt: actedAt,
      }
    : undefined;

  await options.store.saveWaitToken(waitToken);
  if (wakeup && hasWorkflowWakeupStore(options.store)) {
    await options.store.saveWakeup(wakeup);
  }
  await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
    type: "wait.resumed",
    runId: run.id,
    waitTokenId: waitToken.id,
    ...(request.payload !== undefined ? { payload: request.payload } : {}),
  });
  if (nodeAttempt) {
    await emitWorkflowRuntimeEvent(events, options.store, options.emitEvent, {
      type: "node.completed",
      runId: run.id,
      nodeAttemptId: nodeAttempt.id,
      ...(request.payload !== undefined ? { output: request.payload } : {}),
    });
    await persistWorkflowNodeAttempt(options.store, nodeAttempt);
  }
  await persistWorkflowRun(options.store, run);

  return {
    ok: true,
    run,
    waitToken,
    humanAction,
    events,
    decision: { kind: decisionKindForHumanAction(actionKind), actionId: actionDefinition!.id, actionKind },
    ...(wakeup ? { wakeup } : {}),
    ...(nodeAttempt ? { nodeAttempt } : {}),
  };
}

function humanActionApplyFailure(
  run: WorkflowRun,
  events: WorkflowRuntimeEvent[],
  diagnostics: WorkflowDiagnostic[],
  error: WorkflowErrorSummary,
  waitToken?: WorkflowWaitToken,
): WorkflowHumanActionApplyFailure {
  return { ok: false, run, events, diagnostics, error, ...(waitToken ? { waitToken } : {}) };
}

function resolveRequestedHumanActionRef(
  waitToken: WorkflowWaitToken,
  request: WorkflowHumanActionApplyRequest,
): WorkflowWaitToken["actions"][number] | undefined {
  if (request.actionId) {
    return waitToken.actions.find((action) => action.id === request.actionId);
  }

  if (request.kind) {
    return waitToken.actions.find((action) => action.kind === request.kind);
  }

  return undefined;
}

function decisionKindForHumanAction(kind: WorkflowHumanActionKind): WorkflowHumanActionDecisionKind {
  if (kind === "approve") return "approved";
  if (kind === "reject") return "rejected";
  if (kind === "cancel") return "cancelled";
  return "submitted";
}
