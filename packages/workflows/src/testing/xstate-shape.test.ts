import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  WORKFLOW_XSTATE_CANCEL_EVENT,
  WORKFLOW_XSTATE_PROJECTION_KIND,
  WORKFLOW_XSTATE_PROJECTION_VERSION,
  WORKFLOW_XSTATE_RESUME_EVENT,
  WORKFLOW_XSTATE_TERMINAL_STATE_IDS,
  createXStateMachineProjection,
  createXStateProjectionContextShape,
  xstateActorIdForNode,
  xstateStateIdForNode,
} from "../index.js";
import type { XStateProjectionState } from "../index.js";

describe("XState projection shape", () => {
  it("defines a versioned Pibo-owned machine projection shape", () => {
    const contextShape = createXStateProjectionContextShape({
      global: {
        topic: {
          schema: { type: "string" },
          description: "Shared topic.",
        },
      },
      local: {
        draft: {
          reads: ["global.topic"],
          writes: ["local.notes"],
        },
      },
      edge: {
        "draft-to-review": {
          reads: ["edge.payload"],
        },
      },
    });

    const draftState: XStateProjectionState = {
      id: xstateStateIdForNode("draft"),
      kind: "node",
      nodeId: "draft",
      type: "atomic",
      actorId: xstateActorIdForNode("draft"),
      invoke: {
        id: xstateActorIdForNode("draft"),
        src: "pibo.workflow.actor.agent",
        input: { kind: "nodeInput", nodeId: "draft" },
      },
      tags: ["agent"],
      meta: {
        pibo: {
          kind: "node",
          nodeId: "draft",
          nodeKind: "agent",
          actorId: xstateActorIdForNode("draft"),
          description: "Draft the answer.",
        },
      },
    };

    const projection = createXStateMachineProjection({
      id: "example.workflow",
      version: "1.0.0",
      initial: draftState.id,
      states: {
        [draftState.id]: draftState,
      },
      transitions: [
        {
          event: "WORKFLOW.NODE.DONE",
          source: draftState.id,
          target: WORKFLOW_XSTATE_TERMINAL_STATE_IDS.completed,
          edgeId: "draft-to-review",
          guard: "guards.accepted",
          actions: ["actions.transferEdge"],
          meta: {
            pibo: {
              edgeId: "draft-to-review",
              edgeKind: "data",
              guardRef: "guards.accepted",
            },
          },
        },
      ],
      actors: {
        [xstateActorIdForNode("draft")]: {
          id: xstateActorIdForNode("draft"),
          src: "pibo.workflow.actor.agent",
          nodeId: "draft",
          kind: "agent",
          input: { kind: "nodeInput", nodeId: "draft" },
        },
      },
      guards: {
        "guards.accepted": {
          id: "guards.accepted",
          ref: "guards.accepted",
          edgeId: "draft-to-review",
        },
      },
      actions: {
        "actions.transferEdge": {
          id: "actions.transferEdge",
          kind: "transferEdge",
          edgeId: "draft-to-review",
          durableEffect: true,
        },
      },
      contextShape,
      metadata: { tags: ["example"] },
    });

    assert.equal(projection.kind, WORKFLOW_XSTATE_PROJECTION_KIND);
    assert.equal(projection.schemaVersion, WORKFLOW_XSTATE_PROJECTION_VERSION);
    assert.equal(projection.contextShape.durableTruth, "kernel");
    assert.equal(projection.contextShape.exposesPrivatePayloads, false);
    assert.deepEqual(projection.finalStates, WORKFLOW_XSTATE_TERMINAL_STATE_IDS);
    assert.deepEqual(projection.config.meta.pibo.snapshotKinds, ["kernel", "xstate", "ui"]);
    assert.equal(projection.config.meta.pibo.workflowVersion, "1.0.0");
    assert.deepEqual(projection.config.states[draftState.id]?.on?.["WORKFLOW.NODE.DONE"], {
      target: WORKFLOW_XSTATE_TERMINAL_STATE_IDS.completed,
      guard: "guards.accepted",
      actions: ["actions.transferEdge"],
      meta: {
        pibo: {
          edgeId: "draft-to-review",
          edgeKind: "data",
          guardRef: "guards.accepted",
        },
      },
    });
    assert.equal(projection.transitions[0]?.meta?.pibo.edgeId, "draft-to-review");
  });

  it("exposes stable event names for future wait/cancel mappings", () => {
    assert.equal(WORKFLOW_XSTATE_RESUME_EVENT, "WORKFLOW.RESUME");
    assert.equal(WORKFLOW_XSTATE_CANCEL_EVENT, "WORKFLOW.CANCEL");
  });
});
