# Proposal: Workflow Runtime Foundation and Manual Trigger

**Status:** Draft
**Created:** 2026-07-06
**Requester / Source:** User request in Pibo session `ps_22ae5cad-f457-4b9e-9f21-cc7ae577ac0c`
**Related docs:**

- `docs/project/workflows.md`
- `docs/project/workflow-interface-adapters.md`
- `docs/specs/capabilities/pibo-workflow-framework-package.md`
- `docs/specs/capabilities/chat-web-workflow-session-view.md`
- `docs/specs/capabilities/chat-web-workflow-xstate-session-view.md`
- `docs/legacy/specs/changes/pibo-workflow-system-v1/`
- `docs/legacy/specs/changes/pibo-workflow-ui-authoring-v2/`

## Why

The current Workflows tab can create and edit workflow graphs, but a user cannot trigger a draft directly from the editor. Project workflow sessions can create a configured session and a start record, but Chat Web does not yet drive the full workflow runtime through graph execution, edge transfers, adapters, guards, and agent nodes.

The next step must be small enough to ship, but it must not paint the system into a corner. Pibo needs a runtime foundation where triggers, nodes, edge payloads, adapters, guards, judge agents, and future external inputs share clear interfaces.

## What Changes

This change defines the product and technical contract for the next workflow phase:

1. Add first-class workflow trigger semantics.
2. Ship the first trigger as a manual/test trigger usable from the Workflows editor.
3. Define a runtime execution contract that can execute a draft or published workflow from a trigger input.
4. Define edge payload, adapter, guard, and judge-agent behavior so data transformation and routing remain plug-and-play.
5. Preserve the existing simple Workflows UI and add only the minimum controls needed to test/run a workflow.

## Capabilities

### New Capabilities

- `workflow-trigger-nodes`: Workflow IR can represent trigger nodes whose output starts a run.
- `workflow-editor-test-run`: The Workflows editor can run a draft through a manual/test trigger without publishing first.
- `workflow-runtime-executor`: Chat Web can request graph execution through a bounded runtime executor instead of only storing run metadata.
- `workflow-edge-payload-contract`: Edges move explicit payload envelopes between nodes.
- `workflow-transform-and-routing-contract`: Adapters, guards, and judge-agent nodes use stable interfaces for transformation and routing decisions.

### Modified Capabilities

- `pibo-workflow-framework-package`: Existing package-level runtime helpers become the source for product executor integration where possible.
- `chat-web-workflow-session-view`: Project workflow sessions should eventually show real node attempts and edge transfers, not only configured/start records.
- `chat-web-workflow-xstate-session-view`: XState remains a projection over runtime facts, not a separate execution engine.

## Scope Direction

### First Implementation Slice

The first implementation should support only:

- a manual/test trigger node in the Workflows editor;
- text input first, JSON input when the workflow/trigger declares a JSON port;
- triggering a draft from the editor with a small input dialog;
- executing a simple connected graph containing at least trigger → agent and trigger → agent → agent;
- direct compatible edge transfer between those nodes;
- status, errors, and output visible in the editor/run panel.

### Later Slices

Later slices can add:

- edge adapters and visible adapter nodes in the product executor;
- deterministic guards and router/gate behavior;
- explicit judge-agent patterns;
- human wait/resume execution;
- Project session execution using the same runtime foundation;
- webhooks, cron, message/event triggers, and external API triggers;
- richer run history and replay.

## Non-Goals

- Do not reintroduce the previously overbuilt workflow UI.
- Do not make XState the durable execution source of truth.
- Do not use hidden LLM coercion to bridge incompatible ports.
- Do not pass full chat history between agents by default.
- Do not add arbitrary inline JavaScript/TypeScript/shell code to UI-authored workflows.
- Do not implement webhooks or cron in the first slice.
