import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createPiboSessionRoutingAgentExecutor,
  minimalOneNodePiboAgentWorkflowFixture,
  runOneNodeAgentWorkflow,
  SqliteWorkflowRunStore,
  validateOneNodeAgentWorkflowPath,
  validateWorkflow,
} from "../index.js";
import type { AgentNodeDefinition, WorkflowDefinition, WorkflowRuntimeEvent } from "../index.js";

function cloneMinimalWorkflow(): WorkflowDefinition {
  return structuredClone(minimalOneNodePiboAgentWorkflowFixture) as WorkflowDefinition;
}

describe("one-node agent workflow runtime path", () => {
  it("runs a minimal pibo-agent workflow through normal Pibo session routing", async () => {
    const createdSessions: unknown[] = [];
    const emittedMessages: unknown[] = [];
    const listeners = new Set<(event: { type: string; piboSessionId: string; eventId?: string; text?: string }) => void>();
    const routing = {
      createSession(input: {
        channel: string;
        kind: string;
        profile: string;
        ownerScope?: string;
        parentId?: string;
        metadata?: Record<string, unknown>;
      }) {
        createdSessions.push(input);
        return { id: "ps_workflow_agent", piSessionId: "pi_workflow_agent", profile: input.profile };
      },
      emit(event: { type: "message"; piboSessionId: string; id?: string; text: string; source?: string }) {
        emittedMessages.push(event);
        queueMicrotask(() => {
          for (const listener of listeners) {
            listener({
              type: "assistant_message",
              piboSessionId: event.piboSessionId,
              eventId: event.id,
              text: "Workflow response from routed Pibo session.",
            });
          }
        });
      },
      subscribe(listener: (event: { type: string; piboSessionId: string; eventId?: string; text?: string }) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSessionRuntimeStatus(piboSessionId: string) {
        assert.equal(piboSessionId, "ps_workflow_agent");
        return { piboSessionId, enabledTools: ["read", "bash"] };
      },
    };

    const definition = cloneMinimalWorkflow();
    (definition.nodes.answer as AgentNodeDefinition).routing = {
      parentSessionId: "ps_parent",
      ownerScope: "user:routing",
      roomId: "room_routing",
      channel: "chat",
    };

    const result = await runOneNodeAgentWorkflow(definition, "Use routing.", {
      ownerScope: "user:fallback",
      now: () => "2026-05-10T22:57:00.000Z",
      createRunId: () => "wfr_routing",
      createNodeAttemptId: () => "wna_routing",
      agentExecutor: createPiboSessionRoutingAgentExecutor({
        routing,
        createMessageId: () => "msg_routing",
        title: "Workflow agent node",
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.output, "Workflow response from routed Pibo session.");
    assert.deepEqual(createdSessions, [
      {
        channel: "chat",
        kind: "workflow-agent",
        profile: "pibo-agent",
        ownerScope: "user:routing",
        parentId: "ps_parent",
        workspace: undefined,
        title: "Workflow agent node",
        metadata: {
          workflowRunId: "wfr_routing",
          workflowId: definition.id,
          workflowVersion: definition.version,
          workflowNodeId: "answer",
          workflowNodeAttemptId: "wna_routing",
          chatRoomId: "room_routing",
        },
      },
    ]);
    assert.deepEqual(emittedMessages, [
      {
        type: "message",
        piboSessionId: "ps_workflow_agent",
        id: "msg_routing",
        text: "Answer the user request using normal Pibo Runtime routing: Use routing.",
        source: "actor",
      },
    ]);
    assert.equal(result.nodeAttempt.metadata?.piboSessionId, "ps_workflow_agent");
    assert.equal(result.nodeAttempt.metadata?.piSessionId, "pi_workflow_agent");
    assert.deepEqual(result.nodeAttempt.metadata?.runtime?.tools, ["read", "bash"]);
  });

  it("runs a single-prompt workflow from validation to routed, persisted completion", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-single-prompt-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const store = new SqliteWorkflowRunStore(dbPath);
    const createdSessions: unknown[] = [];
    const emittedMessages: unknown[] = [];
    const emittedTraceEvents: WorkflowRuntimeEvent[] = [];
    const listeners = new Set<(event: { type: string; piboSessionId: string; eventId?: string; text?: string }) => void>();
    const definition = cloneMinimalWorkflow();
    (definition.nodes.answer as AgentNodeDefinition).routing = {
      parentSessionId: "ps_parent_single_prompt",
      ownerScope: "user:single-prompt",
      projectId: "project_single_prompt",
      roomId: "room_single_prompt",
      channel: "chat",
    };

    const definitionValidation = validateWorkflow(definition);
    const runtimePathValidation = validateOneNodeAgentWorkflowPath(definition);
    assert.equal(definitionValidation.ok, true);
    assert.equal(runtimePathValidation.ok, true);

    try {
      const result = await runOneNodeAgentWorkflow(definition, "Summarize the workflow system.", {
        ownerScope: "user:fallback",
        now: () => "2026-05-10T23:12:00.000Z",
        createRunId: () => "wfr_single_prompt",
        createNodeAttemptId: () => "wna_single_prompt",
        store,
        emitEvent: (event) => {
          emittedTraceEvents.push(event);
        },
        agentExecutor: createPiboSessionRoutingAgentExecutor({
          routing: {
            createSession(input) {
              createdSessions.push(input);
              return { id: "ps_single_prompt", piSessionId: "pi_single_prompt", profile: input.profile };
            },
            emit(event) {
              emittedMessages.push(event);
              queueMicrotask(() => {
                for (const listener of listeners) {
                  listener({
                    type: "assistant_message",
                    piboSessionId: event.piboSessionId,
                    eventId: event.id,
                    text: "Single-prompt workflow completed through routed Pibo Runtime.",
                  });
                }
              });
            },
            subscribe(listener) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            getSessionRuntimeStatus(piboSessionId) {
              assert.equal(piboSessionId, "ps_single_prompt");
              return { piboSessionId, enabledTools: ["read", "bash"] };
            },
          },
          createMessageId: () => "msg_single_prompt",
          title: "Single prompt workflow",
        }),
      });

      assert.equal(result.ok, true);
      assert.equal(result.output, "Single-prompt workflow completed through routed Pibo Runtime.");
      assert.equal(result.run.status, "completed");
      assert.equal(result.run.input, "Summarize the workflow system.");
      assert.equal(result.run.output, "Single-prompt workflow completed through routed Pibo Runtime.");
      assert.deepEqual(result.run.current, { nodeId: "answer", status: "completed" });
      assert.equal(result.run.piboSessionId, "ps_single_prompt");
      assert.equal(result.run.projectId, "project_single_prompt");
      assert.equal(result.nodeAttempt.metadata?.piboSessionId, "ps_single_prompt");
      assert.equal(result.nodeAttempt.metadata?.piSessionId, "pi_single_prompt");
      assert.equal(result.nodeAttempt.metadata?.runtime?.profileId, "pibo-agent");
      assert.deepEqual(result.nodeAttempt.metadata?.runtime?.tools, ["read", "bash"]);
      assert.deepEqual(
        emittedTraceEvents.map((event) => event.type),
        ["workflow.started", "node.started", "node.completed", "workflow.completed"],
      );
      assert.deepEqual(createdSessions, [
        {
          channel: "chat",
          kind: "workflow-agent",
          profile: "pibo-agent",
          ownerScope: "user:single-prompt",
          parentId: "ps_parent_single_prompt",
          workspace: undefined,
          title: "Single prompt workflow",
          metadata: {
            workflowRunId: "wfr_single_prompt",
            workflowId: definition.id,
            workflowVersion: definition.version,
            workflowNodeId: "answer",
            workflowNodeAttemptId: "wna_single_prompt",
            projectId: "project_single_prompt",
            chatRoomId: "room_single_prompt",
          },
        },
      ]);
      assert.deepEqual(emittedMessages, [
        {
          type: "message",
          piboSessionId: "ps_single_prompt",
          id: "msg_single_prompt",
          text: "Answer the user request using normal Pibo Runtime routing: Summarize the workflow system.",
          source: "actor",
        },
      ]);

      store.close();
      const reopened = new SqliteWorkflowRunStore(dbPath);
      const persisted = reopened.getRun("wfr_single_prompt");
      reopened.close();

      assert.ok(persisted);
      assert.equal(persisted.status, "completed");
      assert.equal(persisted.input, "Summarize the workflow system.");
      assert.equal(persisted.output, "Single-prompt workflow completed through routed Pibo Runtime.");
      assert.deepEqual(persisted.current, { nodeId: "answer", status: "completed" });
      assert.equal(persisted.piboSessionId, "ps_single_prompt");
      assert.equal(persisted.projectId, "project_single_prompt");
    } finally {
      try {
        store.close();
      } catch {
        // Already closed by the reopen check.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs a minimal pibo-agent workflow from input to completion", async () => {
    const result = await runOneNodeAgentWorkflow(minimalOneNodePiboAgentWorkflowFixture, "Explain workflow runs.", {
      ownerScope: "user:test",
      now: () => "2026-05-10T22:55:00.000Z",
      createRunId: () => "wfr_test",
      createNodeAttemptId: () => "wna_test",
      agentExecutor: (context) => {
        assert.equal(context.profileId, "pibo-agent");
        assert.equal(
          context.prompt,
          "Answer the user request using normal Pibo Runtime routing: Explain workflow runs.",
        );

        return {
          output: "Workflow runs execute nodes and validate outputs.",
          piboSessionId: "ps_test",
          piSessionId: "pi_test",
          effectiveProfile: "pibo-agent",
          effectiveTools: ["read"],
          effectiveSkills: ["workflow-test"],
          effectiveContextFiles: ["AGENTS.md"],
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.output, "Workflow runs execute nodes and validate outputs.");
    assert.equal(result.run.id, "wfr_test");
    assert.equal(result.run.status, "completed");
    assert.equal(result.run.output, "Workflow runs execute nodes and validate outputs.");
    assert.equal(result.nodeAttempt.id, "wna_test");
    assert.equal(result.nodeAttempt.status, "completed");
    assert.equal(result.nodeAttempt.metadata?.runtime?.profileId, "pibo-agent");
    assert.equal(result.nodeAttempt.metadata?.piboSessionId, "ps_test");
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["workflow.started", "node.started", "node.completed", "workflow.completed"],
    );
  });

  it("emits workflow and node trace events as runtime boundaries are crossed", async () => {
    const emittedEvents: WorkflowRuntimeEvent[] = [];

    const result = await runOneNodeAgentWorkflow(minimalOneNodePiboAgentWorkflowFixture, "Trace this run.", {
      ownerScope: "user:trace",
      now: () => "2026-05-10T23:07:00.000Z",
      createRunId: () => "wfr_trace",
      createNodeAttemptId: () => "wna_trace",
      emitEvent: async (event) => {
        emittedEvents.push(event);
      },
      agentExecutor: () => ({ output: "Traced workflow output." }),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(emittedEvents, result.events);
    assert.deepEqual(
      emittedEvents.map((event) => event.type),
      ["workflow.started", "node.started", "node.completed", "workflow.completed"],
    );
    assert.deepEqual(emittedEvents[0], {
      type: "workflow.started",
      runId: "wfr_trace",
      workflowId: minimalOneNodePiboAgentWorkflowFixture.id,
    });
    assert.deepEqual(emittedEvents[1], {
      type: "node.started",
      runId: "wfr_trace",
      nodeAttemptId: "wna_trace",
      nodeId: "answer",
    });
    assert.deepEqual(emittedEvents[2], {
      type: "node.completed",
      runId: "wfr_trace",
      nodeAttemptId: "wna_trace",
      output: "Traced workflow output.",
    });
    assert.deepEqual(emittedEvents[3], {
      type: "workflow.completed",
      runId: "wfr_trace",
      output: "Traced workflow output.",
    });
  });

  it("persists workflow run identity, status, cursor, input, and output", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-test-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const store = new SqliteWorkflowRunStore(dbPath);

    try {
      const result = await runOneNodeAgentWorkflow(minimalOneNodePiboAgentWorkflowFixture, "Persist this run.", {
        ownerScope: "user:persist",
        now: () => "2026-05-10T23:03:00.000Z",
        createRunId: () => "wfr_persisted",
        createNodeAttemptId: () => "wna_persisted",
        store,
        agentExecutor: () => ({ output: "Persisted workflow output." }),
      });

      assert.equal(result.ok, true);
      assert.deepEqual(store.getRun("wfr_persisted"), result.run);
      store.close();

      const reopened = new SqliteWorkflowRunStore(dbPath);
      const persisted = reopened.getRun("wfr_persisted");
      reopened.close();

      assert.ok(persisted);
      assert.equal(persisted.id, "wfr_persisted");
      assert.equal(persisted.workflowId, minimalOneNodePiboAgentWorkflowFixture.id);
      assert.equal(persisted.workflowVersion, minimalOneNodePiboAgentWorkflowFixture.version);
      assert.equal(persisted.status, "completed");
      assert.deepEqual(persisted.current, { nodeId: "answer", status: "completed" });
      assert.equal(persisted.input, "Persist this run.");
      assert.equal(persisted.output, "Persisted workflow output.");
    } finally {
      try {
        store.close();
      } catch {
        // Already closed by the reopen check.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects workflows outside the one-node agent shape", () => {
    const definition = cloneMinimalWorkflow();
    definition.edges = {
      extra: {
        id: "extra",
        from: { nodeId: "answer" },
        to: { nodeId: "answer" },
      },
    };

    const result = validateOneNodeAgentWorkflowPath(definition);

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowRuntimeError.edgesUnsupported"));
  });

  it("fails the run when the agent output does not match the node/workflow output port", async () => {
    const result = await runOneNodeAgentWorkflow(minimalOneNodePiboAgentWorkflowFixture, "Return structured data.", {
      now: () => "2026-05-10T22:56:00.000Z",
      createRunId: () => "wfr_invalid_output",
      createNodeAttemptId: () => "wna_invalid_output",
      agentExecutor: () => ({ output: { answer: "not a text value" } }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.run?.status, "failed");
    assert.equal(result.nodeAttempt?.status, "failed");
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidNodeOutput");
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.code === "WorkflowInterfaceError.textValueExpected"),
    );
    assert.deepEqual(
      result.events.map((event) => event.type),
      ["workflow.started", "node.started", "node.failed", "workflow.failed"],
    );
  });
});
