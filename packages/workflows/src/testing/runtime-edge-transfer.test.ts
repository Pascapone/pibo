import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adapterRef,
  createWorkflowRegistry,
  edgeAdapter,
  json,
  recordWorkflowEdgeTransfer,
  registerWorkflowAdapter,
  registerWorkflowAgentProfile,
  text,
  transferWorkflowEdgeAdapterData,
  transferWorkflowEdgeData,
  validateWorkflow,
  validateWorkflowPortValue,
} from "../index.js";
import type {
  NodeAttempt,
  WorkflowDefinition,
  WorkflowPort,
  WorkflowRun,
  WorkflowRuntimeEvent,
  WorkflowRunStore,
  WorkflowValue,
} from "../index.js";

function createTwoNodeWorkflow(): WorkflowDefinition {
  return {
    id: "test.two-node-transfer",
    version: "1.0.0",
    title: "Two node transfer test workflow",
    input: text(),
    output: text(),
    initial: "draft",
    final: "review",
    nodes: {
      draft: {
        kind: "agent",
        runtime: "pibo",
        profile: { kind: "fixed", id: "pibo-agent" },
        input: text(),
        output: text(),
      },
      review: {
        kind: "agent",
        runtime: "pibo",
        profile: { kind: "fixed", id: "pibo-agent" },
        input: text(),
        output: text(),
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
  };
}

function createRun(): WorkflowRun {
  return {
    id: "wfr_edge_transfer",
    workflowId: "test.two-node-transfer",
    workflowVersion: "1.0.0",
    ownerScope: "user:test",
    status: "running",
    current: { nodeId: "draft", status: "running" },
    input: "Start here.",
    state: { global: {} },
    createdAt: "2026-05-10T23:20:00.000Z",
    updatedAt: "2026-05-10T23:20:00.000Z",
  };
}

function createJsonTwoNodeWorkflow(): WorkflowDefinition {
  const articlePort = json({
    type: "object",
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
    },
    required: ["title", "summary"],
    additionalProperties: false,
  });

  return {
    id: "test.two-node-json-transfer",
    version: "1.0.0",
    title: "Two node JSON transfer test workflow",
    input: text(),
    output: text(),
    initial: "compose",
    final: "publish",
    nodes: {
      compose: {
        kind: "agent",
        runtime: "pibo",
        profile: { kind: "fixed", id: "pibo-agent" },
        input: text(),
        output: articlePort,
      },
      publish: {
        kind: "agent",
        runtime: "pibo",
        profile: { kind: "fixed", id: "pibo-agent" },
        input: articlePort,
        output: text(),
      },
    },
    edges: {
      "compose-to-publish": {
        id: "compose-to-publish",
        from: { nodeId: "compose" },
        to: { nodeId: "publish" },
        kind: "data",
      },
    },
  };
}

function createJsonRun(): WorkflowRun {
  return {
    id: "wfr_json_edge_transfer",
    workflowId: "test.two-node-json-transfer",
    workflowVersion: "1.0.0",
    ownerScope: "user:test",
    status: "running",
    current: { nodeId: "compose", status: "running" },
    input: "Write an article summary.",
    state: { global: {} },
    createdAt: "2026-05-10T23:30:00.000Z",
    updatedAt: "2026-05-10T23:30:00.000Z",
  };
}

function createSummaryJsonPort(): WorkflowPort {
  return json({
    type: "object",
    properties: {
      summary: { type: "string" },
    },
    required: ["summary"],
    additionalProperties: false,
  });
}

function createSourceAttempt(overrides: Partial<NodeAttempt> = {}): NodeAttempt {
  return {
    id: "wna_draft",
    workflowRunId: "wfr_edge_transfer",
    nodeId: "draft",
    attempt: 1,
    kind: "agent",
    status: "completed",
    input: "Start here.",
    output: "Draft output for review.",
    startedAt: "2026-05-10T23:20:01.000Z",
    completedAt: "2026-05-10T23:20:02.000Z",
    ...overrides,
  };
}

describe("workflow edge data transfer", () => {
  it("feeds node A JSON output into node B input in a two-node workflow", async () => {
    const definition = createJsonTwoNodeWorkflow();
    const definitionValidation = validateWorkflow(definition);
    assert.equal(definitionValidation.ok, true);

    const run = createJsonRun();
    const nodeAOutput: WorkflowValue = {
      title: "Workflow edges",
      summary: "A completed node can feed validated JSON into the next node.",
    };
    const sourceAttempt: NodeAttempt = {
      id: "wna_compose",
      workflowRunId: run.id,
      nodeId: "compose",
      attempt: 1,
      kind: "agent",
      status: "completed",
      input: run.input,
      output: nodeAOutput,
      startedAt: "2026-05-10T23:30:01.000Z",
      completedAt: "2026-05-10T23:30:02.000Z",
    };

    const transferResult = await recordWorkflowEdgeTransfer(
      definition,
      run,
      "compose-to-publish",
      sourceAttempt,
      {
        now: () => "2026-05-10T23:30:03.000Z",
        createEdgeTransferId: () => "wet_compose_to_publish",
      },
    );

    assert.equal(transferResult.ok, true);
    assert.deepEqual(transferResult.targetInput, nodeAOutput);
    assert.deepEqual(transferResult.transfer.payload, nodeAOutput);
    assert.deepEqual(run.current, { edgeId: "compose-to-publish", status: "running" });
    assert.deepEqual(transferResult.events, [
      {
        type: "edge.transferred",
        runId: run.id,
        edgeTransferId: "wet_compose_to_publish",
        edgeId: "compose-to-publish",
      },
    ]);

    const targetInputPort = definition.nodes.publish.input;
    assert.ok(targetInputPort);
    const targetInputValidation = validateWorkflowPortValue(targetInputPort, transferResult.targetInput, {
      path: "$.nodes.publish.input",
    });
    assert.equal(targetInputValidation.ok, true);

    const targetAttempt: NodeAttempt = {
      id: "wna_publish",
      workflowRunId: run.id,
      nodeId: "publish",
      attempt: 1,
      kind: "agent",
      status: "running",
      input: transferResult.targetInput,
      startedAt: "2026-05-10T23:30:04.000Z",
    };

    assert.deepEqual(targetAttempt.input, nodeAOutput);
  });

  it("creates a transferred edge payload from a completed source node output", () => {
    const definition = createTwoNodeWorkflow();
    const result = transferWorkflowEdgeData(definition, createRun(), "draft-to-review", createSourceAttempt(), {
      now: () => "2026-05-10T23:20:03.000Z",
      createEdgeTransferId: () => "wet_draft_to_review",
    });

    assert.equal(result.ok, true);
    assert.equal(result.targetInput, "Draft output for review.");
    assert.deepEqual(result.transfer, {
      id: "wet_draft_to_review",
      workflowRunId: "wfr_edge_transfer",
      edgeId: "draft-to-review",
      sourceNodeAttemptId: "wna_draft",
      targetNodeId: "review",
      status: "transferred",
      payload: "Draft output for review.",
      createdAt: "2026-05-10T23:20:03.000Z",
    });
  });

  it("records an edge transfer event and advances the workflow run cursor", async () => {
    const definition = createTwoNodeWorkflow();
    const run = createRun();
    const events: WorkflowRuntimeEvent[] = [];
    const emittedEvents: WorkflowRuntimeEvent[] = [];
    const savedRuns: WorkflowRun[] = [];
    const store: WorkflowRunStore = {
      saveRun(savedRun) {
        savedRuns.push(structuredClone(savedRun));
      },
      getRun(id) {
        return savedRuns.find((savedRun) => savedRun.id === id);
      },
    };

    const result = await recordWorkflowEdgeTransfer(
      definition,
      run,
      "draft-to-review",
      createSourceAttempt(),
      {
        now: () => "2026-05-10T23:20:03.000Z",
        createEdgeTransferId: () => "wet_draft_to_review",
        events,
        emitEvent: (event) => {
          emittedEvents.push(event);
        },
        store,
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.events, [
      {
        type: "edge.transferred",
        runId: "wfr_edge_transfer",
        edgeTransferId: "wet_draft_to_review",
        edgeId: "draft-to-review",
      },
    ]);
    assert.deepEqual(emittedEvents, result.events);
    assert.deepEqual(run.current, { edgeId: "draft-to-review", status: "running" });
    assert.equal(run.updatedAt, "2026-05-10T23:20:03.000Z");
    assert.equal(savedRuns.length, 1);
    assert.deepEqual(savedRuns[0]?.current, { edgeId: "draft-to-review", status: "running" });
  });

  it("does not record an event when edge transfer validation fails", async () => {
    const run = createRun();
    const originalCursor = structuredClone(run.current);
    const result = await recordWorkflowEdgeTransfer(
      createTwoNodeWorkflow(),
      run,
      "draft-to-review",
      createSourceAttempt({ status: "running" }),
      {
        emitEvent() {
          throw new Error("failed transfers should not emit events");
        },
      },
    );

    assert.equal(result.ok, false);
    assert.deepEqual(result.events, []);
    assert.deepEqual(run.current, originalCursor);
  });

  it("validates target node input before transferring the payload", () => {
    const definition = createTwoNodeWorkflow();
    definition.nodes.review.input = json({
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    });

    const result = transferWorkflowEdgeData(definition, createRun(), "draft-to-review", createSourceAttempt());

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidEdgePayload");
    assert.ok(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "WorkflowInterfaceError.valueTypeMismatch" && diagnostic.edgeId === "draft-to-review",
      ),
    );
  });

  it("runs a registered text-to-JSON edge adapter and validates its output before target node input", async () => {
    const definition = createTwoNodeWorkflow();
    const summaryPort = createSummaryJsonPort();
    definition.nodes.review.input = summaryPort;
    definition.edges["draft-to-review"].adapter = edgeAdapter(adapterRef("test.adapters.textToSummary"), summaryPort);
    const registry = createWorkflowRegistry();
    registerWorkflowAgentProfile(registry, "pibo-agent", {});
    registerWorkflowAdapter(registry, "test.adapters.textToSummary", ({ input, run }) => {
      assert.deepEqual(run?.state.local, undefined);
      return { output: { summary: String(input) } };
    });

    const definitionValidation = validateWorkflow(definition, { registry });
    assert.equal(definitionValidation.ok, true);

    const result = await transferWorkflowEdgeAdapterData(
      definition,
      {
        ...createRun(),
        state: { global: {}, local: { draft: { debugNotes: "do not leak" }, review: { tone: "formal" } } },
      },
      "draft-to-review",
      createSourceAttempt(),
      {
        registry,
        now: () => "2026-05-10T23:21:03.000Z",
        createEdgeTransferId: () => "wet_adapted_draft_to_review",
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.targetInput, { summary: "Draft output for review." });
    assert.deepEqual(result.transfer.payload, { summary: "Draft output for review." });
    assert.equal(result.transfer.targetNodeId, "review");
  });

  it("runs a registered JSON-to-text edge adapter and validates its output before target node input", async () => {
    const definition = createJsonTwoNodeWorkflow();
    definition.nodes.publish.input = text();
    definition.edges["compose-to-publish"].adapter = edgeAdapter(adapterRef("test.adapters.articleToReviewText"), text());
    const registry = createWorkflowRegistry();
    registerWorkflowAgentProfile(registry, "pibo-agent", {});
    registerWorkflowAdapter(registry, "test.adapters.articleToReviewText", ({ input }) => {
      assert.equal(typeof input, "object");
      assert.notEqual(input, null);
      assert.equal(Array.isArray(input), false);
      const article = input as { title: string; summary: string };
      return { output: `${article.title}: ${article.summary}` };
    });

    const definitionValidation = validateWorkflow(definition, { registry });
    assert.equal(definitionValidation.ok, true);

    const nodeAOutput: WorkflowValue = {
      title: "Adapter edges",
      summary: "Registered adapters can bridge JSON source output into text target input.",
    };
    const result = await transferWorkflowEdgeAdapterData(
      definition,
      createJsonRun(),
      "compose-to-publish",
      {
        id: "wna_compose",
        workflowRunId: "wfr_json_edge_transfer",
        nodeId: "compose",
        attempt: 1,
        kind: "agent",
        status: "completed",
        input: "Write an article summary.",
        output: nodeAOutput,
        startedAt: "2026-05-10T23:30:01.000Z",
        completedAt: "2026-05-10T23:30:02.000Z",
      },
      {
        registry,
        now: () => "2026-05-10T23:30:03.000Z",
        createEdgeTransferId: () => "wet_adapted_compose_to_publish",
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.targetInput, "Adapter edges: Registered adapters can bridge JSON source output into text target input.");
    assert.equal(result.transfer.payload, "Adapter edges: Registered adapters can bridge JSON source output into text target input.");
    assert.equal(result.transfer.targetNodeId, "publish");
  });

  it("rejects registered edge adapter output that does not satisfy the declared output port", async () => {
    const definition = createTwoNodeWorkflow();
    const summaryPort = createSummaryJsonPort();
    definition.nodes.review.input = summaryPort;
    definition.edges["draft-to-review"].adapter = edgeAdapter(adapterRef("test.adapters.invalidSummary"), summaryPort);
    const registry = createWorkflowRegistry();
    registerWorkflowAdapter(registry, "test.adapters.invalidSummary", () => ({
      output: { summary: 42 },
    }));

    const result = await transferWorkflowEdgeAdapterData(
      definition,
      createRun(),
      "draft-to-review",
      createSourceAttempt(),
      { registry },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidAdapterOutput");
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "WorkflowInterfaceError.valueTypeMismatch" &&
          diagnostic.edgeId === "draft-to-review" &&
          diagnostic.path === "$.edges.draft-to-review.adapter.outputValue.summary",
      ),
    );
  });

  it("rejects edge transfer before the source attempt has completed output", () => {
    const sourceAttempt = createSourceAttempt({ status: "running" });
    delete sourceAttempt.output;

    const result = transferWorkflowEdgeData(createTwoNodeWorkflow(), createRun(), "draft-to-review", sourceAttempt);

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.edgeTransferFailed");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.sourceAttemptIncomplete"));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.sourceOutputMissing"));
  });
});
