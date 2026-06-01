# Proposal: Pibo Workflow System V1

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** User request in Pibo Session `ps_5b632938-aa5c-4968-8b38-f9a4e87a3c67`  
**Related docs:**

- `docs/reports/2026-05-10-langgraph-xstate-pibo-workflow-plan.md`
- `docs/specs/changes/pibo-workflow-system-v1/references.md`
- `docs/specs/spec-product-projects-area.md`
- `docs/specs/capabilities/pibo-session-routing.md`
- `docs/specs/capabilities/subagent-delegation.md`
- `docs/specs/capabilities/yielded-run-control.md`

## Why

Pibo needs a workflow system that treats agent work as composable runtime units. The smallest useful agent workflow unit should be a Pibo Runtime: the routed runtime used by normal Pibo Sessions, including agent profiles, tools, skills, context, and session routing. Larger workflows should connect these units like blocks: one workflow's output can become another workflow's input.

The system must stay lightweight. Workflows are defined as TypeScript code using the Pibo Workflow Framework in `packages/workflows`. It should support simple definitions that wrap a single prompt, and it should also support complex definitions with nodes, edges, nested workflows, state, schema-bound inputs, schema-bound outputs, TypeScript code nodes, Agent nodes, adapter nodes, and human approval/input nodes.

## What Changes

Pibo gains a V1 workflow capability with these properties:

- A workflow can run an Agent node through normal Pibo Runtime.
- A workflow can accept either text input or JSON input validated by the OpenAI Structured Outputs / tool-calling JSON Schema subset.
- A workflow can emit either text output or JSON output validated by the same schema subset.
- Workflows can be connected through typed edges.
- Workflows can contain nodes, edges, and nested workflows.
- Nodes can be TypeScript code nodes, Agent nodes, nested workflow nodes, adapter nodes, or human nodes.
- Agent nodes explicitly select an Agent Designer profile, for example `pibo-agent`, and run through normal Pibo session routing.
- Prompts can be fixed or generated from input, state, and edge data.
- State and data flow through edges and nodes.
- The runtime keeps global workflow state and local node state separate.
- Registered TypeScript adapters make incompatible interfaces explicit.
- Bounded back-edges/retry policies support review/fix loops with max attempts.
- XState is a dependency for workflow projection, visualization, local orchestration support, and later UI editing, but not durable truth.

## Capabilities

### New Capabilities

- `pibo-workflow-registry`: TypeScript-defined workflow catalog in `packages/workflows`, including plugin registration for workflows, handlers, adapters, guards, prompt assets, and human actions.
- `pibo-workflow-runs`: persistent workflow executions linked to Pibo Sessions and Project Sessions.
- `pibo-workflow-interfaces`: clean input/output contracts using text or the OpenAI Structured Outputs / tool-calling JSON Schema subset.
- `pibo-workflow-composition`: connections between workflows and nodes, with explicit registered TypeScript adapter layers when interfaces differ.
- `pibo-workflow-xstate-model`: XState-backed state machine projection for visualization and future editing.
- `pibo-workflow-human-actions`: extensible Projects-tab and CLI/debug actions for approve/reject/resume/cancel and future actions.

### Modified Capabilities

- `pibo-session-routing`: must allow workflow-created runtimes to behave like normal routed sessions.
- `subagent-delegation`: may be used when an Agent node delegates work to child Pibo Runtimes.
- `yielded-run-control`: may control long-running workflow nodes or nested workflow runs.
- `pibo-event-contract`: must include workflow run and transition events.

## Impact

- **Code:** Add `packages/workflows` with framework API, Workflow Registry, validation, compiler, runtime kernel, store, registered TypeScript adapters, Agent node execution, TypeScript code node execution, human node execution, adapter node execution, and nested workflow execution.
- **APIs / CLI:** Add discoverable workflow commands: list, validate, run, inspect, approve, reject, resume, and cancel. No XState CLI command in V1.
- **Data:** Add fresh workflow-specific SQLite database `pibo-workflows.sqlite` for workflow runs, events, node attempts, edge transfers, checkpoints, wakeups, wait tokens, human actions, state snapshots, and optional compiled-definition snapshots. Normal session traces/tool calls/spans/transcripts remain in existing session stores.
- **Auth / Security:** Workflow TypeScript code nodes must respect Pibo's existing runtime and tool boundaries. No workflow may bypass normal session, tool, or compute-worker policy.
- **Docs:** Add durable specs for workflow definitions, interface contracts, execution, and UI visualization.
