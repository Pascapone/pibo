import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWorkflowRegistry,
  dispatchWorkflowCodeNode,
  json,
  registerWorkflowHandler,
  SqliteWorkflowRunStore,
  text,
  validateWorkflow,
} from "../index.js";
import type { WorkflowCommand, WorkflowDefinition, WorkflowRun, WorkflowRuntimeEvent } from "../index.js";

function createCodeWorkflow(): WorkflowDefinition {
  return {
    id: "test.code-node-dispatch",
    version: "1.0.0",
    input: json({
      type: "object",
      properties: {
        topic: { type: "string" },
      },
      required: ["topic"],
      additionalProperties: false,
    }),
    output: json({
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    }),
    initial: "normalize",
    final: "normalize",
    nodes: {
      normalize: {
        kind: "code",
        language: "typescript",
        handler: "test.handlers.normalize",
        input: json({
          type: "object",
          properties: {
            topic: { type: "string" },
          },
          required: ["topic"],
          additionalProperties: false,
        }),
        output: json({
          type: "object",
          properties: {
            summary: { type: "string" },
          },
          required: ["summary"],
          additionalProperties: false,
        }),
        state: {
          reads: ["global.topic", "local.seed"],
          writes: ["global.summary", "local.lastSummary"],
        },
      },
    },
    edges: {},
    state: {
      global: {
        topic: { schema: { type: "string" } },
        summary: { schema: { type: "string" } },
      },
    },
  };
}

function createRun(): WorkflowRun {
  return {
    id: "wfr_code",
    workflowId: "test.code-node-dispatch",
    workflowVersion: "1.0.0",
    ownerScope: "user:test",
    status: "running",
    current: { nodeId: "normalize", status: "running" },
    input: { topic: "Workflows" },
    state: {
      global: { topic: "Workflows" },
      local: { normalize: { seed: "seed-value" } },
    },
    createdAt: "2026-05-10T23:40:00.000Z",
    updatedAt: "2026-05-10T23:40:00.000Z",
  };
}

describe("workflow code node dispatch", () => {
  it("runs a registered TypeScript handler with scoped context, patches state, and validates output", async () => {
    const definition = createCodeWorkflow();
    const registry = createWorkflowRegistry();
    const emittedCommands: WorkflowCommand[] = [];
    const externalEvents: WorkflowRuntimeEvent[] = [];
    const store = new SqliteWorkflowRunStore(":memory:");

    registerWorkflowHandler(registry, "test.handlers.normalize", async (ctx) => {
      assert.deepEqual(ctx.input, { topic: "Workflows" });
      assert.equal(ctx.global.get("topic"), "Workflows");
      assert.equal(ctx.local.get("seed"), "seed-value");
      assert.equal(ctx.edge.get("previous"), "edge payload");
      assert.deepEqual(ctx.edge.all(), { previous: "edge payload" });
      await ctx.emit({ type: "checkpoint.created", runId: "wfr_code", checkpointId: "wcp_from_handler" });
      await ctx.command({ kind: "cancelWorkflow", reason: "recorded command only" });

      return {
        output: { summary: "Normalized Workflows" },
        globalPatch: { summary: "Normalized Workflows" },
        localPatch: { lastSummary: "Normalized Workflows" },
      };
    });

    const validation = validateWorkflow(definition, { registry });
    assert.equal(validation.ok, true);

    const result = await dispatchWorkflowCodeNode(definition, createRun(), "normalize", { topic: "Workflows" }, {
      registry,
      now: () => "2026-05-10T23:40:01.000Z",
      createNodeAttemptId: () => "wna_code",
      store,
      edgePayloads: { previous: "edge payload" },
      emitEvent: (event) => {
        externalEvents.push(event);
      },
      commandEmitter: (command) => {
        emittedCommands.push(command);
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.output, { summary: "Normalized Workflows" });
    assert.equal(result.nodeAttempt.status, "completed");
    assert.equal(result.nodeAttempt.metadata?.handlerId, "test.handlers.normalize");
    assert.deepEqual(store.getNodeAttempt("wna_code"), result.nodeAttempt);
    store.close();
    assert.deepEqual(result.nodeAttempt.localState, { seed: "seed-value", lastSummary: "Normalized Workflows" });
    assert.deepEqual(result.run.state.global, { topic: "Workflows", summary: "Normalized Workflows" });
    assert.deepEqual(result.run.current, { nodeId: "normalize", status: "running" });
    assert.deepEqual(emittedCommands, [{ kind: "cancelWorkflow", reason: "recorded command only" }]);
    assert.deepEqual(externalEvents, result.events);
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["node.started", "checkpoint.created", "node.completed"],
    );
  });

  it("fails before execution when the registered handler is missing", async () => {
    const definition = createCodeWorkflow();
    const registry = createWorkflowRegistry();

    const validation = validateWorkflow(definition, { registry });
    assert.equal(validation.ok, false);
    assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownHandlerRef"));

    const result = await dispatchWorkflowCodeNode(definition, createRun(), "normalize", { topic: "Workflows" }, {
      registry,
      createNodeAttemptId: () => "wna_missing_handler",
    });

    assert.equal(result.ok, false);
    assert.equal(result.nodeAttempt?.status, "failed");
    assert.equal(result.error.code, "WorkflowRuntimeError.codeNodeDispatchFailed");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowGraphError.unknownHandlerRef"));
  });

  it("rejects undeclared code node state writes", async () => {
    const definition = createCodeWorkflow();
    const node = definition.nodes.normalize;
    assert.equal(node.kind, "code");
    if (node.kind === "code") {
      node.state = { writes: [] };
    }
    const registry = createWorkflowRegistry();
    registerWorkflowHandler(registry, "test.handlers.normalize", () => ({
      output: { summary: "Bad patch" },
      globalPatch: { summary: "Bad patch" },
    }));

    const result = await dispatchWorkflowCodeNode(definition, createRun(), "normalize", { topic: "Workflows" }, {
      registry,
      createNodeAttemptId: () => "wna_bad_patch",
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidCodeNodePatch");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowStateError.undeclaredStateWrite"));
  });

  it("fails code node dispatch when handler output violates the node output port", async () => {
    const definition = createCodeWorkflow();
    const registry = createWorkflowRegistry();
    registerWorkflowHandler(registry, "test.handlers.normalize", () => ({ output: "not structured output" }));

    const result = await dispatchWorkflowCodeNode(definition, createRun(), "normalize", { topic: "Workflows" }, {
      registry,
      createNodeAttemptId: () => "wna_invalid_output",
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidNodeOutput");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowInterfaceError.valueTypeMismatch"));
  });

  it("rejects dispatching a non-code node", async () => {
    const definition = createCodeWorkflow();
    definition.nodes.answer = {
      kind: "agent",
      runtime: "pibo",
      profile: { kind: "fixed", id: "pibo-agent" },
      input: text(),
      output: text(),
    };

    const result = await dispatchWorkflowCodeNode(definition, createRun(), "answer", "hello", {
      registry: createWorkflowRegistry(),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.codeNodeRequired");
    assert.equal(result.nodeAttempt, undefined);
  });
});
