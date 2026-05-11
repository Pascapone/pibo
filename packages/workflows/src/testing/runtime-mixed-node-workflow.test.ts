import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWorkflowRegistry,
  dispatchWorkflowAdapterNode,
  dispatchWorkflowAgentNode,
  dispatchWorkflowCodeNode,
  dispatchWorkflowHumanNode,
  dispatchWorkflowNestedWorkflowNode,
  mixedNodeWorkflowFixture,
  nestedChildWorkflowFixture,
  recordWorkflowEdgeTransfer,
  registerWorkflowDefinition,
  SqliteWorkflowRunStore,
  transferWorkflowEdgeAdapterData,
  validateWorkflow,
  validateWorkflowOutput,
  workflowFixtureProviders,
} from "../index.js";
import type { WorkflowRun, WorkflowRuntimeEvent } from "../index.js";

function createMixedRun(): WorkflowRun {
  return {
    id: "wfr_mixed_nodes",
    workflowId: mixedNodeWorkflowFixture.id,
    workflowVersion: mixedNodeWorkflowFixture.version,
    ownerScope: "user:mixed",
    status: "running",
    current: { nodeId: "plan", status: "running" },
    input: { topic: "Mixed workflow dispatch" },
    state: { global: { topic: "Mixed workflow dispatch" } },
    createdAt: "2026-05-11T02:00:00.000Z",
    updatedAt: "2026-05-11T02:00:00.000Z",
  };
}

describe("mixed node workflow runtime coverage", () => {
  it("dispatches a validated mixed workflow through code, agent, human, adapter, and nested workflow nodes", async () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    registerWorkflowDefinition(registry, nestedChildWorkflowFixture);
    const validation = validateWorkflow(mixedNodeWorkflowFixture, { registry });
    assert.equal(validation.ok, true);

    const store = new SqliteWorkflowRunStore(":memory:");
    const externalEvents: WorkflowRuntimeEvent[] = [];
    const emitEvent = (event: WorkflowRuntimeEvent) => {
      externalEvents.push(event);
    };
    const run = createMixedRun();

    try {
      const planResult = await dispatchWorkflowCodeNode(
        mixedNodeWorkflowFixture,
        run,
        "plan",
        { topic: "Mixed workflow dispatch" },
        {
          registry,
          store,
          now: () => "2026-05-11T02:00:01.000Z",
          createNodeAttemptId: () => "wna_mixed_plan",
          emitEvent,
        },
      );
      assert.equal(planResult.ok, true);
      assert.deepEqual(planResult.output, {
        steps: [
          { title: "Research Mixed workflow dispatch", done: false },
          { title: "Draft Mixed workflow dispatch", done: false },
        ],
      });

      const planTransfer = await recordWorkflowEdgeTransfer(
        mixedNodeWorkflowFixture,
        run,
        "plan-to-draft",
        planResult.nodeAttempt,
        {
          now: () => "2026-05-11T02:00:02.000Z",
          createEdgeTransferId: () => "wet_mixed_plan_to_draft",
          store,
          emitEvent,
        },
      );
      assert.equal(planTransfer.ok, true);

      const draftResult = await dispatchWorkflowAgentNode(
        mixedNodeWorkflowFixture,
        run,
        "draft",
        planTransfer.targetInput,
        {
          registry,
          store,
          now: () => "2026-05-11T02:00:03.000Z",
          createNodeAttemptId: () => "wna_mixed_draft",
          emitEvent,
          agentExecutor: (context) => {
            assert.equal(context.profileId, "pibo-agent");
            assert.equal(context.nodeId, "draft");
            return {
              output: {
                title: "Mixed workflow dispatch",
                body: `Drafted ${JSON.stringify(context.input)}`,
              },
              piboSessionId: "ps_mixed_draft",
              piSessionId: "pi_mixed_draft",
              effectiveProfile: "pibo-agent",
              effectiveTools: ["read"],
              effectiveSkills: ["workflow-skill"],
              effectiveContextFiles: ["context/workflow.md"],
            };
          },
        },
      );
      assert.equal(draftResult.ok, true);
      assert.equal(draftResult.nodeAttempt.metadata?.piboSessionId, "ps_mixed_draft");

      const draftTransfer = await recordWorkflowEdgeTransfer(
        mixedNodeWorkflowFixture,
        run,
        "draft-to-review",
        draftResult.nodeAttempt,
        {
          now: () => "2026-05-11T02:00:04.000Z",
          createEdgeTransferId: () => "wet_mixed_draft_to_review",
          store,
          emitEvent,
        },
      );
      assert.equal(draftTransfer.ok, true);

      const reviewResult = await dispatchWorkflowHumanNode(
        mixedNodeWorkflowFixture,
        run,
        "review",
        draftTransfer.targetInput,
        {
          store,
          now: () => "2026-05-11T02:00:05.000Z",
          createNodeAttemptId: () => "wna_mixed_review",
          createWaitTokenId: () => "wwt_mixed_review",
          emitEvent,
        },
      );
      assert.equal(reviewResult.ok, true);
      assert.equal(reviewResult.run.status, "waiting");
      assert.equal(reviewResult.nodeAttempt.status, "waiting");
      assert.equal(store.getWaitToken("wwt_mixed_review")?.status, "pending");

      const reviewOutput = { approved: true, notes: "Ready for summary." };
      reviewResult.nodeAttempt.status = "completed";
      reviewResult.nodeAttempt.output = reviewOutput;
      reviewResult.nodeAttempt.completedAt = "2026-05-11T02:00:06.000Z";
      run.status = "running";
      run.current = { nodeId: "review", status: "running" };
      run.updatedAt = "2026-05-11T02:00:06.000Z";
      store.saveNodeAttempt(reviewResult.nodeAttempt);
      store.saveRun(run);
      emitEvent({ type: "wait.resumed", runId: run.id, waitTokenId: "wwt_mixed_review", payload: reviewOutput });

      const normalizeResult = await dispatchWorkflowAdapterNode(
        mixedNodeWorkflowFixture,
        run,
        "normalize",
        reviewOutput,
        {
          registry,
          store,
          now: () => "2026-05-11T02:00:07.000Z",
          createNodeAttemptId: () => "wna_mixed_normalize",
          emitEvent,
        },
      );
      assert.equal(normalizeResult.ok, true);
      assert.deepEqual(normalizeResult.output, { summary: "Ready for summary.", status: "approved" });
      assert.equal(normalizeResult.nodeAttempt.metadata?.adapterId, "fixture.adapters.decisionToSummary");

      const childInputTransfer = await transferWorkflowEdgeAdapterData(
        mixedNodeWorkflowFixture,
        run,
        "normalize-to-child",
        normalizeResult.nodeAttempt,
        {
          registry,
          now: () => "2026-05-11T02:00:08.000Z",
          createEdgeTransferId: () => "wet_mixed_normalize_to_child",
        },
      );
      assert.equal(childInputTransfer.ok, true);
      assert.equal(childInputTransfer.targetInput, "Ready for summary.");

      const childResult = await dispatchWorkflowNestedWorkflowNode(
        mixedNodeWorkflowFixture,
        run,
        "child-summary",
        childInputTransfer.targetInput,
        {
          registry,
          store,
          now: () => "2026-05-11T02:00:09.000Z",
          createNodeAttemptId: () => "wna_mixed_child",
          createChildRunId: () => "wfr_mixed_child",
          emitEvent,
          nestedWorkflowExecutor: (context) => ({
            output: { summary: `Child summarized ${context.input}`, status: "draft" },
            childRun: {
              id: context.childRunId,
              workflowId: context.childWorkflow.id,
              workflowVersion: context.childWorkflow.version,
              ownerScope: context.run.ownerScope,
              parentRunId: context.run.id,
              parentNodeAttemptId: context.nodeAttemptId,
              status: "completed",
              current: { nodeId: context.childWorkflow.final as string, status: "completed" },
              input: context.input,
              output: { summary: `Child summarized ${context.input}`, status: "draft" },
              state: { global: {} },
              createdAt: "2026-05-11T02:00:09.000Z",
              updatedAt: "2026-05-11T02:00:09.000Z",
              completedAt: "2026-05-11T02:00:09.000Z",
            },
          }),
        },
      );
      assert.equal(childResult.ok, true);
      assert.deepEqual(childResult.output, { summary: "Child summarized Ready for summary.", status: "draft" });
      assert.equal(validateWorkflowOutput(mixedNodeWorkflowFixture, childResult.output).ok, true);

      run.status = "completed";
      run.current = { nodeId: "child-summary", status: "completed" };
      run.output = childResult.output;
      run.completedAt = "2026-05-11T02:00:10.000Z";
      run.updatedAt = "2026-05-11T02:00:10.000Z";
      store.saveRun(run);

      const nodeOrder = new Map([
        ["plan", 0],
        ["draft", 1],
        ["review", 2],
        ["normalize", 3],
        ["child-summary", 4],
      ]);
      assert.deepEqual(
        store
          .listNodeAttempts({ workflowRunId: run.id })
          .sort((left, right) => (nodeOrder.get(left.nodeId) ?? 0) - (nodeOrder.get(right.nodeId) ?? 0))
          .map((attempt) => [attempt.nodeId, attempt.kind, attempt.status]),
        [
          ["plan", "code", "completed"],
          ["draft", "agent", "completed"],
          ["review", "human", "completed"],
          ["normalize", "adapter", "completed"],
          ["child-summary", "workflow", "completed"],
        ],
      );
      assert.deepEqual(store.getRun(run.id), run);
      assert.deepEqual(
        externalEvents.map((event) => event.type),
        [
          "node.started",
          "node.completed",
          "edge.transferred",
          "node.started",
          "node.completed",
          "edge.transferred",
          "node.started",
          "wait.created",
          "wait.resumed",
          "node.started",
          "node.completed",
          "node.started",
          "node.completed",
        ],
      );
    } finally {
      store.close();
    }
  });
});
