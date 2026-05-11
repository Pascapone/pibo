import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWorkflowRegistry,
  dispatchWorkflowNestedWorkflowNode,
  json,
  registerWorkflowDefinition,
  SqliteWorkflowRunStore,
  validateWorkflow,
} from "../index.js";
import type { WorkflowDefinition, WorkflowRun, WorkflowRuntimeEvent } from "../index.js";

const topicPort = json({
  type: "object",
  properties: {
    topic: { type: "string" },
  },
  required: ["topic"],
  additionalProperties: false,
});

const summaryPort = json({
  type: "object",
  properties: {
    summary: { type: "string" },
  },
  required: ["summary"],
  additionalProperties: false,
});

function createChildWorkflow(): WorkflowDefinition {
  return {
    id: "test.child-workflow",
    version: "1.0.0",
    input: topicPort,
    output: summaryPort,
    initial: "summarize",
    final: "summarize",
    nodes: {
      summarize: {
        kind: "code",
        language: "typescript",
        handler: "test.handlers.summarize",
        input: topicPort,
        output: summaryPort,
      },
    },
    edges: {},
  };
}

function createParentWorkflow(): WorkflowDefinition {
  return {
    id: "test.parent-workflow",
    version: "1.0.0",
    input: topicPort,
    output: summaryPort,
    initial: "child",
    final: "child",
    nodes: {
      child: {
        kind: "workflow",
        workflowId: "test.child-workflow",
        workflowVersion: "1.0.0",
        namespace: "child-summary",
        input: topicPort,
        output: summaryPort,
      },
    },
    edges: {},
  };
}

function createRun(): WorkflowRun {
  return {
    id: "wfr_parent",
    workflowId: "test.parent-workflow",
    workflowVersion: "1.0.0",
    ownerScope: "user:nested",
    status: "running",
    current: { nodeId: "child", status: "running" },
    input: { topic: "Nested workflows" },
    state: { global: { parentOnly: "kept" } },
    createdAt: "2026-05-11T00:20:00.000Z",
    updatedAt: "2026-05-11T00:20:00.000Z",
  };
}

describe("workflow nested workflow node dispatch", () => {
  it("runs a registered child workflow and records parent/child linkage", async () => {
    const registry = createWorkflowRegistry();
    const childWorkflow = createChildWorkflow();
    const parentWorkflow = createParentWorkflow();
    const externalEvents: WorkflowRuntimeEvent[] = [];
    const store = new SqliteWorkflowRunStore(":memory:");
    registerWorkflowDefinition(registry, childWorkflow);

    assert.equal(validateWorkflow(parentWorkflow).ok, true);
    assert.equal(validateWorkflow(childWorkflow).ok, true);

    const result = await dispatchWorkflowNestedWorkflowNode(
      parentWorkflow,
      createRun(),
      "child",
      { topic: "Nested workflows" },
      {
        registry,
        now: () => "2026-05-11T00:20:01.000Z",
        createNodeAttemptId: () => "wna_child_node",
        createChildRunId: () => "wfr_child",
        store,
        emitEvent: (event) => {
          externalEvents.push(event);
        },
        nestedWorkflowExecutor: (context) => {
          assert.equal(context.workflow.id, parentWorkflow.id);
          assert.equal(context.run.id, "wfr_parent");
          assert.equal(context.nodeAttemptId, "wna_child_node");
          assert.equal(context.childWorkflow.id, childWorkflow.id);
          assert.equal(context.childRunId, "wfr_child");
          assert.equal(context.namespace, "child-summary");
          assert.deepEqual(context.input, { topic: "Nested workflows" });

          return {
            output: { summary: "Nested workflows summary" },
            childRun: {
              id: context.childRunId,
              workflowId: context.childWorkflow.id,
              workflowVersion: context.childWorkflow.version,
              ownerScope: context.run.ownerScope,
              parentRunId: context.run.id,
              parentNodeAttemptId: context.nodeAttemptId,
              status: "completed",
              current: { nodeId: "summarize", status: "completed" },
              input: context.input,
              output: { summary: "Nested workflows summary" },
              state: { global: { childOnly: "isolated" } },
              createdAt: "2026-05-11T00:20:01.000Z",
              updatedAt: "2026-05-11T00:20:01.000Z",
              completedAt: "2026-05-11T00:20:01.000Z",
            },
            events: [
              { type: "workflow.started", runId: "wfr_child", workflowId: childWorkflow.id },
              { type: "workflow.completed", runId: "wfr_child", output: { summary: "Nested workflows summary" } },
            ],
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.output, { summary: "Nested workflows summary" });
    assert.equal(result.nodeAttempt.status, "completed");
    assert.equal(result.nodeAttempt.metadata?.childRunId, "wfr_child");
    assert.equal(result.nodeAttempt.metadata?.childWorkflowId, childWorkflow.id);
    assert.deepEqual(store.getNodeAttempt("wna_child_node"), result.nodeAttempt);
    store.close();
    assert.equal(result.childRun.parentRunId, "wfr_parent");
    assert.equal(result.childRun.parentNodeAttemptId, "wna_child_node");
    assert.deepEqual(result.run.state.global, { parentOnly: "kept" });
    assert.deepEqual(externalEvents.map((event) => event.type), ["node.started", "node.completed"]);
    assert.deepEqual(result.events.map((event) => event.type), [
      "node.started",
      "workflow.started",
      "workflow.completed",
      "node.completed",
    ]);
  });

  it("fails before execution when the child workflow is not registered", async () => {
    let executorCalled = false;

    const result = await dispatchWorkflowNestedWorkflowNode(
      createParentWorkflow(),
      createRun(),
      "child",
      { topic: "Nested workflows" },
      {
        registry: createWorkflowRegistry(),
        createNodeAttemptId: () => "wna_missing_child",
        nestedWorkflowExecutor: () => {
          executorCalled = true;
          throw new Error("should not run");
        },
      },
    );

    assert.equal(result.ok, false);
    assert.equal(executorCalled, false);
    assert.equal(result.nodeAttempt?.status, "failed");
    assert.equal(result.run.status, "failed");
    assert.equal(result.error.code, "WorkflowRuntimeError.workflowNodeDispatchFailed");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownWorkflowRef"));
    assert.deepEqual(result.events.map((event) => event.type), ["node.started", "node.failed"]);
  });

  it("fails the parent node when the child workflow does not complete successfully", async () => {
    const registry = createWorkflowRegistry();
    const childWorkflow = createChildWorkflow();
    registerWorkflowDefinition(registry, childWorkflow);

    const result = await dispatchWorkflowNestedWorkflowNode(
      createParentWorkflow(),
      createRun(),
      "child",
      { topic: "Nested workflows" },
      {
        registry,
        createNodeAttemptId: () => "wna_failed_child",
        createChildRunId: () => "wfr_failed_child",
        nestedWorkflowExecutor: (context) => ({
          output: { summary: "not used" },
          childRun: {
            id: context.childRunId,
            workflowId: context.childWorkflow.id,
            workflowVersion: context.childWorkflow.version,
            ownerScope: context.run.ownerScope,
            parentRunId: context.run.id,
            parentNodeAttemptId: context.nodeAttemptId,
            status: "failed",
            current: { nodeId: "summarize", status: "failed" },
            input: context.input,
            state: { global: {} },
            createdAt: "2026-05-11T00:21:00.000Z",
            updatedAt: "2026-05-11T00:21:00.000Z",
            failedAt: "2026-05-11T00:21:00.000Z",
          },
        }),
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.childWorkflowFailed");
    assert.equal(result.childRun?.id, "wfr_failed_child");
    assert.equal(result.nodeAttempt?.metadata?.childRunId, "wfr_failed_child");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.childWorkflowIncomplete"));
  });
});
