import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createPiboSessionRoutingAgentExecutor,
  dispatchWorkflowAgentNode,
  json,
  SqliteWorkflowRunStore,
  text,
} from "../index.js";
import type { AgentNodeDefinition, WorkflowDefinition, WorkflowRun, WorkflowRuntimeEvent } from "../index.js";

function createAgentWorkflow(): WorkflowDefinition {
  return {
    id: "test.agent-node-dispatch",
    version: "1.0.0",
    input: text(),
    output: text(),
    initial: "draft",
    final: "draft",
    nodes: {
      draft: {
        kind: "agent",
        runtime: "pibo",
        profile: { kind: "fixed", id: "pibo-agent" },
        input: text(),
        output: text(),
        routing: {
          parentSessionId: "ps_parent_agent",
          ownerScope: "user:agent-node",
          projectId: "project_agent_node",
          roomId: "room_agent_node",
          channel: "chat",
        },
        promptTemplate: "Draft an answer for: {{input}}",
      },
    },
    edges: {},
  };
}

function createRun(): WorkflowRun {
  return {
    id: "wfr_agent",
    workflowId: "test.agent-node-dispatch",
    workflowVersion: "1.0.0",
    ownerScope: "user:fallback",
    status: "running",
    current: { nodeId: "draft", status: "running" },
    input: "Explain workflows",
    state: { global: {} },
    createdAt: "2026-05-10T23:58:00.000Z",
    updatedAt: "2026-05-10T23:58:00.000Z",
  };
}

describe("workflow agent node dispatch", () => {
  it("runs an agent node through Pibo Runtime routing and records node metadata", async () => {
    const definition = createAgentWorkflow();
    const createdSessions: unknown[] = [];
    const emittedMessages: unknown[] = [];
    const externalEvents: WorkflowRuntimeEvent[] = [];
    const store = new SqliteWorkflowRunStore(":memory:");
    const listeners = new Set<(event: { type: string; piboSessionId: string; eventId?: string; text?: string }) => void>();

    const result = await dispatchWorkflowAgentNode(definition, createRun(), "draft", "Explain workflows", {
      now: () => "2026-05-10T23:58:01.000Z",
      createNodeAttemptId: () => "wna_agent",
      store,
      emitEvent: (event) => {
        externalEvents.push(event);
      },
      agentExecutor: createPiboSessionRoutingAgentExecutor({
        routing: {
          createSession(input) {
            createdSessions.push(input);
            return { id: "ps_agent_node", piSessionId: "pi_agent_node", profile: input.profile };
          },
          emit(event) {
            emittedMessages.push(event);
            queueMicrotask(() => {
              for (const listener of listeners) {
                listener({
                  type: "assistant_message",
                  piboSessionId: event.piboSessionId,
                  eventId: event.id,
                  text: "Agent node response from routed Pibo Runtime.",
                });
              }
            });
          },
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          getSessionRuntimeStatus(piboSessionId) {
            assert.equal(piboSessionId, "ps_agent_node");
            return { piboSessionId, enabledTools: ["read", "bash"] };
          },
        },
        createMessageId: () => "msg_agent_node",
        title: "Agent node dispatch",
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.output, "Agent node response from routed Pibo Runtime.");
    assert.equal(result.nodeAttempt.status, "completed");
    assert.equal(result.nodeAttempt.metadata?.piboSessionId, "ps_agent_node");
    assert.equal(result.nodeAttempt.metadata?.piSessionId, "pi_agent_node");
    assert.equal(result.nodeAttempt.metadata?.runtime?.profileId, "pibo-agent");
    assert.deepEqual(result.nodeAttempt.metadata?.runtime?.tools, ["read", "bash"]);
    assert.deepEqual(store.getNodeAttempt("wna_agent"), result.nodeAttempt);
    store.close();
    assert.deepEqual(result.run.current, { nodeId: "draft", status: "running" });
    assert.deepEqual(externalEvents, result.events);
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["node.started", "node.completed"],
    );
    assert.deepEqual(createdSessions, [
      {
        channel: "chat",
        kind: "workflow-agent",
        profile: "pibo-agent",
        ownerScope: "user:agent-node",
        parentId: "ps_parent_agent",
        workspace: undefined,
        title: "Agent node dispatch",
        metadata: {
          workflowRunId: "wfr_agent",
          workflowId: definition.id,
          workflowVersion: definition.version,
          workflowNodeId: "draft",
          workflowNodeAttemptId: "wna_agent",
          projectId: "project_agent_node",
          chatRoomId: "room_agent_node",
        },
      },
    ]);
    assert.deepEqual(emittedMessages, [
      {
        type: "message",
        piboSessionId: "ps_agent_node",
        id: "msg_agent_node",
        text: "Draft an answer for: Explain workflows",
        source: "actor",
      },
    ]);
  });

  it("resolves the fixed Agent Designer profile before Pibo Runtime creation", async () => {
    const definition = createAgentWorkflow();
    (definition.nodes.draft as AgentNodeDefinition).profile = { kind: "fixed", id: "writer-alias" };
    const order: string[] = [];
    const createdSessions: unknown[] = [];
    const listeners = new Set<(event: { type: string; piboSessionId: string; eventId?: string; text?: string }) => void>();

    const result = await dispatchWorkflowAgentNode(definition, createRun(), "draft", "Explain workflows", {
      createNodeAttemptId: () => "wna_agent_resolved_profile",
      profileResolver: ({ selection, nodeId }) => {
        order.push(`resolve:${nodeId}:${selection.id}`);
        return { id: "writer-profile", requestedId: selection.id, aliases: [selection.id] };
      },
      agentExecutor: createPiboSessionRoutingAgentExecutor({
        routing: {
          createSession(input) {
            order.push(`createSession:${input.profile}`);
            createdSessions.push(input);
            return { id: "ps_resolved_profile", piSessionId: "pi_resolved_profile", profile: input.profile };
          },
          emit(event) {
            order.push(`emit:${event.piboSessionId}`);
            queueMicrotask(() => {
              for (const listener of listeners) {
                listener({
                  type: "assistant_message",
                  piboSessionId: event.piboSessionId,
                  eventId: event.id,
                  text: "Resolved profile response.",
                });
              }
            });
          },
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        createMessageId: () => "msg_resolved_profile",
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.nodeAttempt.metadata?.runtime?.profileId, "writer-profile");
    assert.deepEqual(order, [
      "resolve:draft:writer-alias",
      "createSession:writer-profile",
      "emit:ps_resolved_profile",
    ]);
    assert.deepEqual(createdSessions, [
      {
        channel: "chat",
        kind: "workflow-agent",
        profile: "writer-profile",
        ownerScope: "user:agent-node",
        parentId: "ps_parent_agent",
        workspace: undefined,
        title: undefined,
        metadata: {
          workflowRunId: "wfr_agent",
          workflowId: definition.id,
          workflowVersion: definition.version,
          workflowNodeId: "draft",
          workflowNodeAttemptId: "wna_agent_resolved_profile",
          projectId: "project_agent_node",
          chatRoomId: "room_agent_node",
        },
      },
    ]);
  });

  it("fails before Pibo Runtime creation when fixed Agent Designer profile resolution misses", async () => {
    const definition = createAgentWorkflow();
    let executorCalled = false;

    const result = await dispatchWorkflowAgentNode(definition, createRun(), "draft", "Explain workflows", {
      createNodeAttemptId: () => "wna_agent_missing_profile",
      profileResolver: () => undefined,
      agentExecutor: () => {
        executorCalled = true;
        return { output: "should not run" };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(executorCalled, false);
    assert.equal(result.nodeAttempt?.status, "failed");
    assert.equal(result.run.status, "failed");
    assert.equal(result.error.code, "WorkflowRuntimeError.unknownAgentProfile");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.unknownAgentProfile"));
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["node.started", "node.failed"],
    );
  });

  it("fails before Pibo Runtime execution when agent node input is invalid", async () => {
    const definition = createAgentWorkflow();
    let executorCalled = false;

    const result = await dispatchWorkflowAgentNode(definition, createRun(), "draft", { topic: "wrong kind" }, {
      createNodeAttemptId: () => "wna_agent_invalid_input",
      agentExecutor: () => {
        executorCalled = true;
        return { output: "should not run" };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(executorCalled, false);
    assert.equal(result.nodeAttempt?.status, "failed");
    assert.equal(result.run.status, "failed");
    assert.equal(result.error.code, "WorkflowRuntimeError.agentNodeDispatchFailed");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowInterfaceError.textValueExpected"));
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["node.started", "node.failed"],
    );
  });

  it("fails when the Pibo Runtime output violates the agent node output port", async () => {
    const definition = createAgentWorkflow();
    definition.nodes.draft.output = json({
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    });

    const result = await dispatchWorkflowAgentNode(definition, createRun(), "draft", "Explain workflows", {
      createNodeAttemptId: () => "wna_agent_invalid_output",
      agentExecutor: () => ({ output: "not structured output" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.nodeAttempt?.status, "failed");
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidNodeOutput");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowInterfaceError.valueTypeMismatch"));
  });

  it("rejects dispatching a non-agent node", async () => {
    const definition = createAgentWorkflow();
    definition.nodes.normalize = {
      kind: "code",
      language: "typescript",
      handler: "test.handlers.normalize",
      input: text(),
      output: text(),
    };

    const result = await dispatchWorkflowAgentNode(definition, createRun(), "normalize", "hello", {
      agentExecutor: () => ({ output: "should not run" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.agentNodeRequired");
    assert.equal(result.nodeAttempt, undefined);
  });
});
