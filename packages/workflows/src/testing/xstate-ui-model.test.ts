import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WORKFLOW_XSTATE_UI_MODEL_KIND,
  WORKFLOW_XSTATE_UI_MODEL_VERSION,
  WORKFLOW_XSTATE_TERMINAL_STATE_IDS,
  boundedReviewLoopWorkflowFixture,
  createWorkflowXStateUiModel,
  humanWaitWorkflowFixture,
  mixedNodeWorkflowFixture,
  projectWorkflowToXStateProjection,
  xstateActorIdForNode,
  xstateRetryDelayStateIdForNode,
  xstateStateIdForNode,
  xstateTransitionIdForEdge,
} from "../index.js";
import type { WorkflowMachineSnapshot } from "../index.js";

describe("Workflow/XState UI projection model", () => {
  it("exposes a compact Web UI model from the XState machine projection", () => {
    const projection = projectWorkflowToXStateProjection(mixedNodeWorkflowFixture);
    const model = createWorkflowXStateUiModel(projection);

    assert.equal(model.kind, WORKFLOW_XSTATE_UI_MODEL_KIND);
    assert.equal(model.schemaVersion, WORKFLOW_XSTATE_UI_MODEL_VERSION);
    assert.deepEqual(model.projection, {
      kind: "pibo.workflow.xstateProjection",
      schemaVersion: 1,
      workflowId: "fixture.mixed-nodes",
      workflowVersion: "1.0.0",
      initialStateId: xstateStateIdForNode("plan"),
      durableTruth: "kernel",
      exposesPrivatePayloads: false,
      snapshotKinds: ["kernel", "xstate", "ui"],
    });

    assert.deepEqual(
      model.nodes.map((node) => node.id),
      [
        "node.child-summary",
        "node.draft",
        "node.normalize",
        "node.plan",
        "node.review",
        WORKFLOW_XSTATE_TERMINAL_STATE_IDS.cancelled,
        WORKFLOW_XSTATE_TERMINAL_STATE_IDS.completed,
        WORKFLOW_XSTATE_TERMINAL_STATE_IDS.failed,
      ],
    );
    assert.equal(model.nodes.find((node) => node.id === xstateStateIdForNode("review"))?.kind, "wait");
    assert.equal(model.nodes.find((node) => node.id === xstateStateIdForNode("review"))?.status, "idle");
    assert.equal(model.actors.find((actor) => actor.id === xstateActorIdForNode("draft"))?.src, "pibo.workflow.actor.agent");
    assert.equal(model.actors.find((actor) => actor.id === xstateActorIdForNode("child-summary"))?.childWorkflowId, "fixture.nested-child");

    const planEdge = model.edges.find((edge) => edge.id === xstateTransitionIdForEdge("plan-to-draft"));
    assert.deepEqual(planEdge, {
      id: xstateTransitionIdForEdge("plan-to-draft"),
      source: xstateStateIdForNode("plan"),
      target: xstateStateIdForNode("draft"),
      event: "WORKFLOW.NODE.DONE",
      edgeId: "plan-to-draft",
      edgeKind: "data",
      guardRef: undefined,
      adapterRef: undefined,
      actions: ["workflow.edge.plan-to-draft.transfer"],
      label: undefined,
      color: undefined,
      priority: undefined,
    });
  });

  it("marks current wait, terminal, and retry-delay states from kernel snapshots or explicit active state ids", () => {
    const humanProjection = projectWorkflowToXStateProjection(humanWaitWorkflowFixture);
    const waitingSnapshot: WorkflowMachineSnapshot = {
      kind: "kernel",
      workflowId: humanWaitWorkflowFixture.id,
      runId: "run.waiting",
      status: "waiting",
      current: { nodeId: "review", status: "waiting" },
      version: 1,
    };
    const waitingModel = createWorkflowXStateUiModel(humanProjection, { snapshot: waitingSnapshot });

    assert.deepEqual(waitingModel.current, {
      snapshotKind: "kernel",
      runId: "run.waiting",
      status: "waiting",
      stateIds: [xstateStateIdForNode("review")],
      nodeId: "review",
    });
    assert.equal(waitingModel.nodes.find((node) => node.id === xstateStateIdForNode("review"))?.status, "waiting");
    assert.equal(waitingModel.nodes.find((node) => node.id === xstateStateIdForNode("review"))?.wait?.durable, true);

    const completedModel = createWorkflowXStateUiModel(humanProjection, {
      snapshot: {
        kind: "kernel",
        workflowId: humanWaitWorkflowFixture.id,
        runId: "run.completed",
        status: "completed",
        current: { status: "completed" },
        version: 2,
      },
    });
    assert.equal(
      completedModel.nodes.find((node) => node.id === WORKFLOW_XSTATE_TERMINAL_STATE_IDS.completed)?.status,
      "completed",
    );

    const retryProjection = projectWorkflowToXStateProjection(boundedReviewLoopWorkflowFixture);
    const retryModel = createWorkflowXStateUiModel(retryProjection, {
      activeStateIds: [xstateRetryDelayStateIdForNode("draft")],
    });
    assert.equal(retryModel.current?.stateIds[0], xstateRetryDelayStateIdForNode("draft"));
    assert.equal(retryModel.nodes.find((node) => node.id === xstateRetryDelayStateIdForNode("draft"))?.status, "retry_scheduled");
  });
});
