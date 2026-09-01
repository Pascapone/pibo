---
type: "Research"
title: "Report: LangGraph as Reference, XState as Orchestration Model, Pibo-Native Workflow System"
description: "Preserves the original report body as stable research without promoting historical claims."
tags: ["migration","research","report"]
status: "stable"
authority: "informative"
migration_lineage:
  source_path: "docs/reports/2026-05-10-langgraph-xstate-pibo-workflow-plan.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "d2867a6788bb574ebf1de526caa50d847a199789"
  source_bytes: 8795
  source_sha256: "8cf114ecd399c7b4c98b29b6d6b42364e5d89ef2a7b171e7cfb9786b5f205557"
  source_body_sha256: "8cf114ecd399c7b4c98b29b6d6b42364e5d89ef2a7b171e7cfb9786b5f205557"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
---
# Report: LangGraph as Reference, XState as Orchestration Model, Pibo-Native Workflow System

**Date:** 2026-05-10  
**Status:** Planning report  
**Scope:** Pibo Projects, workflow orchestration, agent delegation, workflow state, and future workflow UI

## Summary

We should use **LangGraph as an architectural reference**, use **XState as the orchestration model**, and build a **Pibo-native workflow system** rather than embedding an external agent runtime.

This plan keeps Pibo's product boundary intact. Pibo should own sessions, routing, persistence, trace events, Projects, subagents, yielded runs, worktrees, Docker workers, and Chat Web visibility. LangGraph can inform how agent graphs are structured. XState can inform how workflow state machines, events, guards, retries, waiting states, and actors behave.

The first implementation should stay small. Pibo should model workflows as explicit, persistent state machines with graph-shaped definitions where needed. It should not start as a broad DAG engine or a direct LangGraph clone.

## Decision

Use the projects as follows:

| Component | Role in Pibo |
|---|---|
| LangGraph | Reference for agent graph concepts, node/edge patterns, memory, human-in-the-loop, traceability, and multi-agent orchestration. |
| XState | Reference or possible library for workflow state machines, statecharts, events, guards, actors, waiting states, retries, and transition rules. |
| Pibo-native workflow system | The actual runtime, persistence, APIs, traces, UI integration, and session/subagent execution layer. |

## Why LangGraph Should Be a Reference, Not the Runtime

LangGraph is relevant because it solves problems close to Pibo's future workflow goals:

- graph-shaped agent execution
- explicit nodes and transitions
- agent control flow
- human-in-the-loop pauses
- checkpointing and resumability concepts
- long-running task visibility
- multi-agent patterns

But LangGraph should not become Pibo's core runtime in V1. Direct adoption would introduce another agent runtime with its own assumptions about tools, state, persistence, memory, and execution. That would overlap with Pibo's session router, Pi Coding Agent integration, yielded runs, subagents, and trace system.

Pibo needs LangGraph's design lessons, not its runtime boundary.

## Why XState Fits the Orchestration Layer

Pibo project workflows are naturally stateful. A coding project does not only move through a graph of tasks; it waits, retries, asks for review, branches on decisions, and resumes after failure.

Examples:

```text
simple-chat
  -> active

standard-project
  -> intake
  -> spec
  -> plan
  -> implementation
  -> test
  -> review
  -> cleanup
  -> done
```

XState fits this shape because it focuses on:

- explicit states
- allowed transitions
- event-driven movement
- guards
- actions
- invoked actors
- final states
- failure states
- human waiting states
- visualizable statecharts

This maps well to Pibo's Projects area, where a Main Project Session owns workflow state and Sub-Sessions perform delegated work.

## Recommended Architecture

Pibo should own a workflow stack like this:

```text
Workflow Definition
  -> State Machine / Statechart Model
    -> Workflow Run Store
      -> Workflow Runtime
        -> Pibo Session Router
        -> Subagents
        -> Yielded Runs
        -> Docker Compute Workers / Worktrees
        -> Event Log / Trace Events
        -> Chat Web UI
```

The workflow runtime should not bypass normal Pibo primitives. It should launch work through existing routed sessions, generated subagent tools, yielded run control, and project session metadata.

## Core Concepts

### Workflow Definition

A serializable product definition. It describes states, transitions, events, and optional node behavior.

```ts
type PiboWorkflowDefinition = {
  id: string;
  version: string;
  initialState: string;
  states: Record<string, PiboWorkflowState>;
};
```

### Workflow State

A named phase in a workflow. It may define allowed events, actions, waiting behavior, or delegated work.

```ts
type PiboWorkflowState = {
  label: string;
  kind: "chat" | "agent" | "human_review" | "command" | "terminal" | "final";
  on?: Record<string, PiboWorkflowTransition>;
};
```

### Transition

A permitted move from one state to another.

```ts
type PiboWorkflowTransition = {
  target: string;
  guard?: string;
  action?: string;
};
```

### Workflow Run

A persisted execution instance.

```ts
type PiboWorkflowRun = {
  id: string;
  workflowId: string;
  workflowVersion: string;
  projectId?: string;
  piboSessionId?: string;
  status: "running" | "waiting" | "failed" | "completed";
  currentState: string;
  state: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
```

## V1 Scope

V1 should implement only the minimum needed to make workflows real and observable.

### Include

- Workflow definition registry.
- `simple-chat` as the first one-state workflow.
- A `standard-project` draft definition, possibly disabled until execution behavior is ready.
- Workflow run persistence.
- Transition validation.
- Trace events for workflow start, transition, wait, resume, fail, and complete.
- Project Session linkage through `workflowId` and optional `workflowRunId`.
- Chat Web display of current workflow state.

### Exclude

- General-purpose DAG execution.
- Direct LangGraph runtime integration.
- Full visual workflow editor.
- Complex dynamic workflow generation by agents.
- Silent automatic conversion of normal chats into workflows.
- Broad plugin ecosystem for arbitrary workflow node types.

## Relationship to Existing Pibo Docs and Code

This plan aligns with the existing direction in:

- `docs/specs/spec-product-projects-area.md`
- `docs/legacy/specs/spec-product-projects-area.backup-2026-05-10.md`
- `docs/legacy/specs/spec-architecture-agent-orchestration-and-model-selection.md`
- `docs/reports/sql-database-inventory-2026-05-10.md`

Current Pibo already has related foundations:

- Project Sessions with `workflowId`.
- `simple-chat` as the current accepted workflow.
- Workflow-related SQLite schema in `/root/.pibo/workflows.sqlite`.
- Pibo Sessions and routed runtime execution.
- Subagents and yielded run control.
- Event log fields for `workflow_run_id`.

## Main Design Principle

Pibo workflows should be **session-native state machines**.

That means:

- a workflow run belongs to a Project Session or Project
- state transitions are explicit and persisted
- delegated work uses Pibo Sub-Sessions
- long work can yield through `pibo_run_*`
- Chat Web can show the current workflow state
- traces remain the historical record
- workflow state remains the current process record

## Risks

### Risk: Building Too Much DAG Infrastructure

A general DAG engine would be powerful but premature. It would add complexity before we know the exact product needs.

**Mitigation:** Start with state machines. Add DAG-like parallel groups only when a concrete workflow requires them.

### Risk: XState Dependency Leakage

If Pibo adopts XState directly, XState semantics could leak into APIs, database records, and user-facing workflow definitions.

**Mitigation:** Define Pibo's own workflow contract first. Use XState internally only if it fits behind that contract.

### Risk: LangGraph Runtime Boundary Conflict

Direct LangGraph integration could compete with Pibo's session router and Pi runtime.

**Mitigation:** Treat LangGraph as reference material. Do not route execution through LangGraph in V1.

### Risk: Workflow State and Trace State Become Confused

Trace events describe history. Workflow state describes current process position. Mixing them would make recovery and UI state fragile.

**Mitigation:** Store workflow runs separately and emit trace events as projections of workflow activity.

## Recommended Next Steps

1. Write a short capability spec for **Pibo Workflow State Machines** under `docs/specs/capabilities/`.
2. Define the V1 workflow contract for `simple-chat` and `standard-project`.
3. Map the existing `/root/.pibo/workflows.sqlite` schema to the desired runtime contract.
4. Decide whether XState is only a reference or an internal implementation dependency.
5. Build a small workflow registry and transition validator.
6. Wire Project Session creation to create or link a workflow run when needed.
7. Emit workflow trace events and show current workflow state in Chat Web.

## Recommendation

Proceed with this plan.

Use **LangGraph to study agent graph patterns**. Use **XState to shape state-machine semantics**. Build **Pibo's own workflow runtime** around Pibo Sessions, Project Sessions, Subagents, yielded runs, traces, and SQLite persistence.

This gives Pibo a clear architecture without importing another product's runtime boundary.