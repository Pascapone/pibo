import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createWorkflowRegistry,
  dispatchWorkflowAgentNode,
  dispatchWorkflowCodeNode,
  json,
  minimalOneNodePiboAgentWorkflowFixture,
  promptBuilderRef,
  recordWorkflowEdgeTransfer,
  registerWorkflowAgentProfile,
  registerWorkflowHandler,
  registerWorkflowPromptBuilder,
  runOneNodeAgentWorkflow,
  text,
  validateWorkflow,
} from "../index.js";
import type { PromptBuilderHandler, WorkflowDefinition, WorkflowRun } from "../index.js";

const promptPlanPort = json({
  type: "object",
  required: ["topic", "audience"],
  additionalProperties: false,
  properties: {
    topic: { type: "string" },
    audience: { type: "string" },
  },
});

function createVariablePromptWorkflow(): WorkflowDefinition {
  return {
    id: "test.variable-prompt-workflow",
    version: "1.0.0",
    input: promptPlanPort,
    output: text(),
    initial: "plan",
    final: "draft",
    nodes: {
      plan: {
        kind: "code",
        language: "typescript",
        handler: "test.handlers.preparePromptPlan",
        input: promptPlanPort,
        output: promptPlanPort,
      },
      draft: {
        kind: "agent",
        runtime: "pibo",
        profile: { kind: "fixed", id: "pibo-agent" },
        input: promptPlanPort,
        output: text(),
        promptBuilder: promptBuilderRef("test.promptBuilders.variableDraft"),
      },
    },
    edges: {
      "plan-to-draft": {
        id: "plan-to-draft",
        from: { nodeId: "plan" },
        to: { nodeId: "draft" },
        kind: "data",
      },
    },
  };
}

function createVariablePromptRun(definition: WorkflowDefinition): WorkflowRun {
  return {
    id: "wfr_variable_prompt",
    workflowId: definition.id,
    workflowVersion: definition.version,
    ownerScope: "user:prompt-workflows",
    status: "running",
    current: { nodeId: "plan", status: "running" },
    input: { topic: "prompt builders", audience: "workflow authors" },
    state: {
      global: { style: "concise" },
      local: { draft: { previousDraft: "Use examples." } },
    },
    createdAt: "2026-05-11T00:55:00.000Z",
    updatedAt: "2026-05-11T00:55:00.000Z",
  };
}

describe("fixed and variable prompt workflow runtime coverage", () => {
  it("runs a fixed promptTemplate workflow and records the rendered prompt", async () => {
    const validation = validateWorkflow(minimalOneNodePiboAgentWorkflowFixture);
    assert.equal(validation.ok, true);

    const result = await runOneNodeAgentWorkflow(
      minimalOneNodePiboAgentWorkflowFixture,
      "Explain fixed workflow prompts.",
      {
        ownerScope: "user:fixed-prompt-workflow",
        now: () => "2026-05-11T00:55:01.000Z",
        createRunId: () => "wfr_fixed_prompt",
        createNodeAttemptId: () => "wna_fixed_prompt",
        agentExecutor: (context) => {
          assert.equal(
            context.prompt,
            "Answer the user request using normal Pibo Runtime routing: Explain fixed workflow prompts.",
          );
          return { output: "Fixed prompt workflow completed." };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "Fixed prompt workflow completed.");
    assert.deepEqual(result.nodeAttempt.metadata?.finalPrompt, {
      text: "Answer the user request using normal Pibo Runtime routing: Explain fixed workflow prompts.",
      source: "promptTemplate",
      tracePrivacy: {
        kind: "ownerScope",
        storage: "workflow-node-attempt",
        redacted: false,
      },
    });
  });

  it("runs a variable promptBuilder workflow using transferred data and state", async () => {
    const definition = createVariablePromptWorkflow();
    const registry = createWorkflowRegistry();
    registerWorkflowAgentProfile(registry, "pibo-agent", { tools: ["read"], skills: [], contextFiles: [] });
    registerWorkflowHandler(registry, "test.handlers.preparePromptPlan", ({ input }) => ({ output: input }));
    const builder: PromptBuilderHandler = (context) => {
      const input = context.input as { topic: string; audience: string };
      assert.equal(context.global.get("style"), "concise");
      assert.equal(context.local.get("previousDraft"), "Use examples.");
      assert.deepEqual(context.edge.get("plan"), input);
      return {
        prompt: `Write a ${context.global.get("style")} note about ${input.topic} for ${input.audience}. Previous: ${context.local.get("previousDraft")}`,
        metadata: { variant: "state-and-edge" },
      };
    };
    registerWorkflowPromptBuilder(registry, "test.promptBuilders.variableDraft", builder);

    const validation = validateWorkflow(definition, { registry });
    assert.equal(validation.ok, true);

    const run = createVariablePromptRun(definition);
    const planResult = await dispatchWorkflowCodeNode(
      definition,
      run,
      "plan",
      { topic: "prompt builders", audience: "workflow authors" },
      {
        registry,
        now: () => "2026-05-11T00:55:02.000Z",
        createNodeAttemptId: () => "wna_variable_plan",
      },
    );
    assert.equal(planResult.ok, true);

    const transfer = await recordWorkflowEdgeTransfer(definition, run, "plan-to-draft", planResult.nodeAttempt, {
      now: () => "2026-05-11T00:55:03.000Z",
      createEdgeTransferId: () => "wet_variable_plan_to_draft",
    });
    assert.equal(transfer.ok, true);

    const draftResult = await dispatchWorkflowAgentNode(definition, run, "draft", transfer.targetInput, {
      registry,
      now: () => "2026-05-11T00:55:04.000Z",
      createNodeAttemptId: () => "wna_variable_draft",
      edgePayloads: { plan: transfer.targetInput },
      agentExecutor: (context) => {
        assert.equal(
          context.prompt,
          "Write a concise note about prompt builders for workflow authors. Previous: Use examples.",
        );
        return { output: "Variable prompt workflow completed." };
      },
    });

    assert.equal(draftResult.ok, true);
    assert.equal(draftResult.output, "Variable prompt workflow completed.");
    assert.deepEqual(draftResult.nodeAttempt.metadata?.finalPrompt, {
      text: "Write a concise note about prompt builders for workflow authors. Previous: Use examples.",
      source: "promptBuilder",
      tracePrivacy: {
        kind: "ownerScope",
        storage: "workflow-node-attempt",
        redacted: false,
      },
      promptBuilderId: "test.promptBuilders.variableDraft",
      builderMetadata: { variant: "state-and-edge" },
    });
  });
});
