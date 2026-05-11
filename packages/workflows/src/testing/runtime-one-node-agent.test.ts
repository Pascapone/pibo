import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  createPiboSessionRoutingAgentExecutor,
  createWorkflowRegistry,
  minimalOneNodePiboAgentWorkflowFixture,
  resolveWorkflowAgentProfile,
  runOneNodeAgentWorkflow,
  SqliteWorkflowRunStore,
  validateOneNodeAgentWorkflowPath,
  validateWorkflow,
  workflowFixtureProviders,
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

  it("links routed workflow agent sessions to project sessions before sending the prompt", async () => {
    const lifecycle: string[] = [];
    const projectSessionLinks: unknown[] = [];
    const listeners = new Set<(event: { type: string; piboSessionId: string; eventId?: string; text?: string }) => void>();
    const definition = cloneMinimalWorkflow();
    (definition.nodes.answer as AgentNodeDefinition).routing = {
      parentSessionId: "ps_project_main",
      ownerScope: "user:project-link",
      projectId: "project_workflow_link",
    };

    const result = await runOneNodeAgentWorkflow(definition, "Link the workflow session.", {
      ownerScope: "user:fallback",
      now: () => "2026-05-11T02:30:00.000Z",
      createRunId: () => "wfr_project_link",
      createNodeAttemptId: () => "wna_project_link",
      agentExecutor: createPiboSessionRoutingAgentExecutor({
        routing: {
          createSession(input) {
            lifecycle.push("createSession");
            return { id: "ps_project_workflow_agent", profile: input.profile };
          },
          emit(event) {
            lifecycle.push("emitPrompt");
            queueMicrotask(() => {
              for (const listener of listeners) {
                listener({
                  type: "assistant_message",
                  piboSessionId: event.piboSessionId,
                  eventId: event.id,
                  text: "Linked project workflow response.",
                });
              }
            });
          },
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        createMessageId: () => "msg_project_link",
        title: "Project workflow agent",
        linkProjectSession(input) {
          lifecycle.push("linkProjectSession");
          projectSessionLinks.push(input);
        },
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.run.piboSessionId, "ps_project_workflow_agent");
    assert.equal(result.run.projectId, "project_workflow_link");
    assert.deepEqual(lifecycle, ["createSession", "linkProjectSession", "emitPrompt"]);
    assert.deepEqual(projectSessionLinks, [
      {
        projectId: "project_workflow_link",
        piboSessionId: "ps_project_workflow_agent",
        workflowRunId: "wfr_project_link",
        workflowId: definition.id,
        workflowVersion: definition.version,
        workflowNodeId: "answer",
        workflowNodeAttemptId: "wna_project_link",
        parentPiboSessionId: "ps_project_main",
        ownerScope: "user:project-link",
        title: "Project workflow agent",
      },
    ]);
  });

  it("keeps normal session trace/tool-call/span/transcript events in the routed session stream", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-session-facts-boundary-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const store = new SqliteWorkflowRunStore(dbPath);
    const listeners = new Set<
      (event: { type: string; piboSessionId: string; eventId?: string; text?: string; payload?: unknown }) => void
    >();

    try {
      const result = await runOneNodeAgentWorkflow(cloneMinimalWorkflow(), "Keep session facts separate.", {
        ownerScope: "user:session-boundary",
        now: () => "2026-05-11T02:20:00.000Z",
        createRunId: () => "wfr_session_boundary",
        createNodeAttemptId: () => "wna_session_boundary",
        store,
        agentExecutor: createPiboSessionRoutingAgentExecutor({
          routing: {
            createSession(input) {
              return { id: "ps_session_boundary", piSessionId: "pi_session_boundary", profile: input.profile };
            },
            emit(event) {
              queueMicrotask(() => {
                for (const listener of listeners) {
                  listener({
                    type: "tool_call_result",
                    piboSessionId: event.piboSessionId,
                    eventId: event.id,
                    payload: { toolCallId: "tc_1", output: "kept in session store" },
                  });
                  listener({
                    type: "span_completed",
                    piboSessionId: event.piboSessionId,
                    eventId: event.id,
                    payload: { spanId: "span_1" },
                  });
                  listener({
                    type: "transcript_delta",
                    piboSessionId: event.piboSessionId,
                    eventId: event.id,
                    payload: { delta: "session transcript data" },
                  });
                  listener({
                    type: "assistant_message",
                    piboSessionId: event.piboSessionId,
                    eventId: event.id,
                    text: "Workflow output from normal session reply.",
                  });
                }
              });
            },
            subscribe(listener) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          createMessageId: () => "msg_session_boundary",
        }),
      });

      assert.equal(result.ok, true);
      assert.equal(result.output, "Workflow output from normal session reply.");
      assert.equal(result.nodeAttempt.metadata?.piboSessionId, "ps_session_boundary");
      assert.equal(result.nodeAttempt.metadata?.piSessionId, "pi_session_boundary");
      assert.deepEqual(
        store.listEvents({ workflowRunId: "wfr_session_boundary" }).map((event) => event.type),
        ["workflow.started", "node.started", "node.completed", "workflow.completed"],
      );
      assert.deepEqual(store.getNodeAttempt("wna_session_boundary")?.metadata, result.nodeAttempt.metadata);
    } finally {
      try {
        store.close();
      } catch {
        // Store may already be closed if the test failed after closing it.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("selects the registered fixed pibo-agent Agent Designer profile for one-node execution", async () => {
    const registry = createWorkflowRegistry(workflowFixtureProviders);
    const definition = cloneMinimalWorkflow();
    const createdSessions: unknown[] = [];
    const emittedMessages: unknown[] = [];
    const listeners = new Set<(event: { type: string; piboSessionId: string; eventId?: string; text?: string }) => void>();

    const definitionValidation = validateWorkflow(definition, { registry });
    assert.equal(definitionValidation.ok, true);

    const result = await runOneNodeAgentWorkflow(definition, "Use the registered profile.", {
      ownerScope: "user:pibo-agent-profile",
      now: () => "2026-05-11T00:35:00.000Z",
      createRunId: () => "wfr_pibo_agent_profile",
      createNodeAttemptId: () => "wna_pibo_agent_profile",
      profileResolver: ({ selection }) => {
        const entry = resolveWorkflowAgentProfile(registry, selection.id);
        if (!entry) return undefined;

        return {
          id: entry.id,
          requestedId: selection.id,
          ...entry.value,
        };
      },
      agentExecutor: createPiboSessionRoutingAgentExecutor({
        routing: {
          createSession(input) {
            createdSessions.push(input);
            return { id: "ps_pibo_agent_profile", piSessionId: "pi_pibo_agent_profile", profile: input.profile };
          },
          emit(event) {
            emittedMessages.push(event);
            queueMicrotask(() => {
              for (const listener of listeners) {
                listener({
                  type: "assistant_message",
                  piboSessionId: event.piboSessionId,
                  eventId: event.id,
                  text: "Registered pibo-agent profile response.",
                });
              }
            });
          },
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        createMessageId: () => "msg_pibo_agent_profile",
        title: "Registered pibo-agent workflow",
      }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.output, "Registered pibo-agent profile response.");
    assert.deepEqual(createdSessions, [
      {
        channel: "pibo.workflows",
        kind: "workflow-agent",
        profile: "pibo-agent",
        ownerScope: "user:pibo-agent-profile",
        parentId: undefined,
        workspace: undefined,
        title: "Registered pibo-agent workflow",
        metadata: {
          workflowRunId: "wfr_pibo_agent_profile",
          workflowId: definition.id,
          workflowVersion: definition.version,
          workflowNodeId: "answer",
          workflowNodeAttemptId: "wna_pibo_agent_profile",
        },
      },
    ]);
    assert.deepEqual(emittedMessages, [
      {
        type: "message",
        piboSessionId: "ps_pibo_agent_profile",
        id: "msg_pibo_agent_profile",
        text: "Answer the user request using normal Pibo Runtime routing: Use the registered profile.",
        source: "actor",
      },
    ]);
    assert.deepEqual(result.nodeAttempt.metadata?.runtime, {
      profileId: "pibo-agent",
      requestedProfileId: "pibo-agent",
      selectedProfile: {
        id: "pibo-agent",
        requestedId: "pibo-agent",
      },
      tools: ["read", "bash", "edit", "write"],
      skills: [],
      contextFiles: [],
      routing: {
        ownerScope: "user:pibo-agent-profile",
      },
    });
    assert.equal(result.nodeAttempt.metadata?.piboSessionId, "ps_pibo_agent_profile");
    assert.equal(result.nodeAttempt.metadata?.piSessionId, "pi_pibo_agent_profile");
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
      assert.deepEqual(result.nodeAttempt.metadata?.finalPrompt, {
        text: "Answer the user request using normal Pibo Runtime routing: Summarize the workflow system.",
        source: "promptTemplate",
        tracePrivacy: {
          kind: "ownerScope",
          storage: "workflow-node-attempt",
          redacted: false,
        },
      });
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
      const persistedNodeAttempt = reopened.getNodeAttempt("wna_single_prompt");
      reopened.close();

      assert.ok(persisted);
      assert.equal(persisted.status, "completed");
      assert.equal(persisted.input, "Summarize the workflow system.");
      assert.equal(persisted.output, "Single-prompt workflow completed through routed Pibo Runtime.");
      assert.deepEqual(persisted.current, { nodeId: "answer", status: "completed" });
      assert.equal(persisted.piboSessionId, "ps_single_prompt");
      assert.equal(persisted.projectId, "project_single_prompt");
      assert.deepEqual(persistedNodeAttempt?.metadata?.finalPrompt, result.nodeAttempt.metadata?.finalPrompt);
    } finally {
      try {
        store.close();
      } catch {
        // Already closed by the reopen check.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("resolves a fixed Agent Designer profile before one-node runtime execution", async () => {
    const definition = cloneMinimalWorkflow();
    (definition.nodes.answer as AgentNodeDefinition).profile = { kind: "fixed", id: "answer-alias" };
    const order: string[] = [];

    const result = await runOneNodeAgentWorkflow(definition, "Explain profile resolution.", {
      ownerScope: "user:profile-resolution",
      createRunId: () => "wfr_profile_resolution",
      createNodeAttemptId: () => "wna_profile_resolution",
      profileResolver: ({ selection, nodeId }) => {
        order.push(`resolve:${nodeId}:${selection.id}`);
        return { id: "answer-profile", requestedId: selection.id, aliases: [selection.id] };
      },
      agentExecutor: (context) => {
        order.push(`execute:${context.profileId}`);
        assert.equal(context.profileId, "answer-profile");
        assert.deepEqual(context.resolvedProfile, {
          id: "answer-profile",
          requestedId: "answer-alias",
          aliases: ["answer-alias"],
        });
        return { output: "Resolved profile workflow output." };
      },
    });

    assert.equal(result.ok, true);
    assert.deepEqual(order, ["resolve:answer:answer-alias", "execute:answer-profile"]);
    assert.equal(result.nodeAttempt.metadata?.runtime?.profileId, "answer-profile");
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
      assert.deepEqual(store.getNodeAttempt("wna_persisted"), result.nodeAttempt);
      store.close();

      const reopened = new SqliteWorkflowRunStore(dbPath);
      const persisted = reopened.getRun("wfr_persisted");
      const persistedNodeAttempt = reopened.getNodeAttempt("wna_persisted");
      reopened.close();

      assert.ok(persisted);
      assert.equal(persisted.id, "wfr_persisted");
      assert.equal(persisted.workflowId, minimalOneNodePiboAgentWorkflowFixture.id);
      assert.equal(persisted.workflowVersion, minimalOneNodePiboAgentWorkflowFixture.version);
      assert.equal(persisted.status, "completed");
      assert.deepEqual(persisted.current, { nodeId: "answer", status: "completed" });
      assert.equal(persisted.input, "Persist this run.");
      assert.equal(persisted.output, "Persisted workflow output.");
      assert.deepEqual(persistedNodeAttempt, result.nodeAttempt);
    } finally {
      try {
        store.close();
      } catch {
        // Already closed by the reopen check.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists initial global and local workflow state across restart", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "pibo-workflows-state-test-"));
    const dbPath = join(tempRoot, "pibo-workflows.sqlite");
    const store = new SqliteWorkflowRunStore(dbPath);
    const definition = cloneMinimalWorkflow();
    definition.state = {
      global: {
        projectGoal: { schema: { type: "string" } },
      },
    };
    (definition.nodes.answer as AgentNodeDefinition).promptTemplate =
      "Goal: {{global.projectGoal}}. Local: {{local.previousDraft}}. Input: {{input}}";

    try {
      const result = await runOneNodeAgentWorkflow(definition, "Persist global state.", {
        ownerScope: "user:state",
        initialGlobalState: { projectGoal: "Ship workflow state" },
        initialLocalState: { answer: { previousDraft: "Outline v1" } },
        now: () => "2026-05-11T00:15:00.000Z",
        createRunId: () => "wfr_global_state",
        createNodeAttemptId: () => "wna_global_state",
        store,
        agentExecutor: (context) => {
          assert.equal(context.prompt, "Goal: Ship workflow state. Local: Outline v1. Input: Persist global state.");
          assert.deepEqual(context.run.state.global, { projectGoal: "Ship workflow state" });
          assert.deepEqual(context.run.state.local?.answer, { previousDraft: "Outline v1" });
          return { output: "Global state persisted." };
        },
      });

      assert.equal(result.ok, true);
      assert.deepEqual(result.run.state.global, { projectGoal: "Ship workflow state" });
      assert.deepEqual(result.run.state.local?.answer, { previousDraft: "Outline v1" });
      assert.deepEqual(result.nodeAttempt.localState, { previousDraft: "Outline v1" });
      assert.deepEqual(store.getNodeAttempt("wna_global_state")?.localState, { previousDraft: "Outline v1" });
      store.close();

      const reopened = new SqliteWorkflowRunStore(dbPath);
      const persisted = reopened.getRun("wfr_global_state");
      const persistedNodeAttempt = reopened.getNodeAttempt("wna_global_state");
      reopened.close();

      assert.ok(persisted);
      assert.deepEqual(persisted.state.global, { projectGoal: "Ship workflow state" });
      assert.deepEqual(persisted.state.local?.answer, { previousDraft: "Outline v1" });
      assert.deepEqual(persistedNodeAttempt?.localState, { previousDraft: "Outline v1" });
      assert.equal(persisted.status, "completed");
    } finally {
      try {
        store.close();
      } catch {
        // Already closed by the reopen check.
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid initial global workflow state", async () => {
    const definition = cloneMinimalWorkflow();
    definition.state = {
      global: {
        attempts: { schema: { type: "integer" } },
      },
    };

    const result = await runOneNodeAgentWorkflow(definition, "Bad state.", {
      initialGlobalState: { attempts: "not an integer" },
      agentExecutor: () => ({ output: "should not run" }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "WorkflowRuntimeError.invalidGlobalState");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.path === "$.state.global.attempts"));
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
