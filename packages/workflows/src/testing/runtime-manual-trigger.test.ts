import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  runManualTextTriggerWorkflow,
  text,
} from "../index.js";
import type {
  OneNodeAgentExecutor,
  WorkflowDefinition,
} from "../index.js";

function createWorkflow(edges: WorkflowDefinition["edges"], nodes: WorkflowDefinition["nodes"] = {}): WorkflowDefinition {
  return {
    id: "test.manual-trigger",
    version: "1.0.0",
    input: text("Manual text input."),
    output: text("Last agent text output."),
    initial: "start",
    nodes: {
      start: {
        kind: "trigger",
        trigger: { kind: "manual", mode: "editor" },
        output: text("Prompt entered from the workflow editor."),
      },
      ...nodes,
    },
    edges,
  };
}

function agentNode(label: string) {
  return {
    kind: "agent" as const,
    runtime: "pibo" as const,
    profile: { kind: "fixed" as const, id: "base" },
    label,
    input: text(),
    output: text(),
    promptTemplate: "{{input}}",
  };
}

describe("manual text trigger workflow runtime", () => {
  it("passes editor text input into one agent node as the complete prompt input", async () => {
    const prompts: string[] = [];
    const inputs: unknown[] = [];
    const executor: OneNodeAgentExecutor = (context) => {
      prompts.push(context.prompt);
      inputs.push(context.input);
      return { output: `reply:${context.prompt}`, piboSessionId: `ps_${context.nodeId}` };
    };

    const result = await runManualTextTriggerWorkflow(
      createWorkflow({
        edge_start_to_agent: { id: "edge_start_to_agent", from: { nodeId: "start" }, to: { nodeId: "agent" }, kind: "data" },
      }, {
        agent: agentNode("Agent"),
      }),
      "Write a draft.",
      {
        source: { kind: "manual.editor", triggerNodeId: "start", actorId: "test-user", draftId: "draft_1" },
        agentExecutor: executor,
        createRunId: () => "wfr_manual",
        createNodeAttemptId: (() => {
          let index = 0;
          return () => ["wna_trigger", "wna_agent"][index++] ?? `wna_extra_${index}`;
        })(),
        now: () => "2026-07-06T00:00:00.000Z",
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(inputs, ["Write a draft."]);
    assert.deepEqual(prompts, ["Write a draft."]);
    assert.equal(result.output, "reply:Write a draft.");
    assert.equal(result.triggerAttempt.output, "Write a draft.");
    assert.equal(result.nodeAttempts.length, 2);
    assert.equal(result.edgeTransfers.length, 1);
    assert.equal(result.edgeTransfers[0].ok, true);
    if (result.edgeTransfers[0].ok) {
      assert.equal(result.edgeTransfers[0].targetInput, "Write a draft.");
    }
    assert.equal(result.nodeAttempts[1]?.metadata?.piboSessionId, "ps_agent");
  });

  it("passes only the previous agent output into the next agent", async () => {
    const received: Array<{ nodeId: string; input: unknown; prompt: string }> = [];
    const executor: OneNodeAgentExecutor = (context) => {
      received.push({ nodeId: context.nodeId, input: context.input, prompt: context.prompt });
      return { output: context.nodeId === "first" ? "first final message" : `second saw: ${context.input}` };
    };

    const result = await runManualTextTriggerWorkflow(
      createWorkflow({
        edge_start_to_first: { id: "edge_start_to_first", from: { nodeId: "start" }, to: { nodeId: "first" }, kind: "data" },
        edge_first_to_second: { id: "edge_first_to_second", from: { nodeId: "first" }, to: { nodeId: "second" }, kind: "data" },
      }, {
        first: agentNode("First"),
        second: agentNode("Second"),
      }),
      "initial prompt",
      {
        source: { kind: "manual.editor", triggerNodeId: "start" },
        agentExecutor: executor,
        now: () => "2026-07-06T00:00:00.000Z",
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(received, [
      { nodeId: "first", input: "initial prompt", prompt: "initial prompt" },
      { nodeId: "second", input: "first final message", prompt: "first final message" },
    ]);
    assert.equal(result.output, "second saw: first final message");
    assert.equal(result.edgeTransfers.length, 2);
  });

  it("fans the same last source output out to parallel downstream agents", async () => {
    const received: Array<{ nodeId: string; input: unknown }> = [];
    const executor: OneNodeAgentExecutor = (context) => {
      received.push({ nodeId: context.nodeId, input: context.input });
      return { output: `${context.nodeId} done` };
    };

    const result = await runManualTextTriggerWorkflow(
      createWorkflow({
        edge_start_to_left: { id: "edge_start_to_left", from: { nodeId: "start" }, to: { nodeId: "left" }, kind: "data" },
        edge_start_to_right: { id: "edge_start_to_right", from: { nodeId: "start" }, to: { nodeId: "right" }, kind: "data" },
      }, {
        left: agentNode("Left"),
        right: agentNode("Right"),
      }),
      "fan out this text",
      {
        source: { kind: "manual.editor", triggerNodeId: "start" },
        agentExecutor: executor,
        now: () => "2026-07-06T00:00:00.000Z",
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(received, [
      { nodeId: "left", input: "fan out this text" },
      { nodeId: "right", input: "fan out this text" },
    ]);
    assert.equal(result.edgeTransfers.length, 2);
  });

  it("does not pass previous prompts or history into downstream agent input", async () => {
    const secondInputs: unknown[] = [];
    const executor: OneNodeAgentExecutor = (context) => {
      if (context.nodeId === "first") return { output: "short final only" };
      secondInputs.push(context.input);
      return { output: "done" };
    };

    const result = await runManualTextTriggerWorkflow(
      createWorkflow({
        edge_start_to_first: { id: "edge_start_to_first", from: { nodeId: "start" }, to: { nodeId: "first" }, kind: "data" },
        edge_first_to_second: { id: "edge_first_to_second", from: { nodeId: "first" }, to: { nodeId: "second" }, kind: "data" },
      }, {
        first: { ...agentNode("First"), promptTemplate: "Long instruction with history wording: {{input}}" },
        second: agentNode("Second"),
      }),
      "original user prompt",
      {
        source: { kind: "manual.editor", triggerNodeId: "start" },
        agentExecutor: executor,
        now: () => "2026-07-06T00:00:00.000Z",
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(secondInputs, ["short final only"]);
  });

  it("keeps the existing unsupported-join failure under LangGraph execution", async () => {
    const result = await runManualTextTriggerWorkflow(
      createWorkflow({
        edge_start_to_left: { id: "edge_start_to_left", from: { nodeId: "start" }, to: { nodeId: "left" }, kind: "data" },
        edge_start_to_right: { id: "edge_start_to_right", from: { nodeId: "start" }, to: { nodeId: "right" }, kind: "data" },
        edge_left_to_join: { id: "edge_left_to_join", from: { nodeId: "left" }, to: { nodeId: "join" }, kind: "data" },
        edge_right_to_join: { id: "edge_right_to_join", from: { nodeId: "right" }, to: { nodeId: "join" }, kind: "data" },
      }, {
        left: agentNode("Left"),
        right: agentNode("Right"),
        join: agentNode("Join"),
      }),
      "join this text",
      {
        source: { kind: "manual.editor", triggerNodeId: "start" },
        agentExecutor: (context) => ({ output: `${context.nodeId} done` }),
        now: () => "2026-07-06T00:00:00.000Z",
      },
    );

    assert.equal(result.ok, false);
    if (result.ok) assert.fail("Expected unsupported join failure.");
    assert.equal(result.error.code, "WorkflowRuntimeError.joinUnsupported");
    assert.deepEqual(result.nodeAttempts.map((attempt) => attempt.nodeId), ["start", "left", "right", "join"]);
  });

  it("runs LangGraph workflows longer than the default recursion limit", async () => {
    const agentCount = 30;
    const nodes: WorkflowDefinition["nodes"] = {};
    const edges: WorkflowDefinition["edges"] = {};
    for (let index = 0; index < agentCount; index += 1) {
      const nodeId = `agent_${index}`;
      nodes[nodeId] = agentNode(`Agent ${index}`);
      const sourceNodeId = index === 0 ? "start" : `agent_${index - 1}`;
      const edgeId = `edge_${sourceNodeId}_to_${nodeId}`;
      edges[edgeId] = { id: edgeId, from: { nodeId: sourceNodeId }, to: { nodeId }, kind: "data" };
    }

    const result = await runManualTextTriggerWorkflow(
      createWorkflow(edges, nodes),
      "long graph",
      {
        source: { kind: "manual.editor", triggerNodeId: "start" },
        agentExecutor: (context) => ({ output: `${context.nodeId}:${context.input}` }),
        now: () => "2026-07-06T00:00:00.000Z",
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.nodeAttempts.length, agentCount + 1);
    assert.equal(result.nodeAttempts.at(-1)?.nodeId, `agent_${agentCount - 1}`);
  });
});
