# Pibo Workflows

Pibo Workflows are the product path for repeatable, inspectable multi-step agent work. A workflow is a versioned graph with explicit inputs, outputs, nodes, edges, adapters, guards, state, and runtime facts.

This document describes the current baseline and the next planned execution step. Historical V1/V2 specs remain under `docs/legacy/specs/changes/`; the current manual-trigger/runtime-foundation plan lives at `docs/specs/changes/workflow-runtime-foundation-manual-trigger/`.

## Current baseline

Pibo currently has two workflow layers:

1. **Workflow framework package** — `packages/workflows` defines TypeScript IR types, ports, registry refs, validation helpers, runtime dispatch helpers, edge transfer helpers, persistence contracts, inspection helpers, fixtures, and XState projection helpers.
2. **Chat Web workflow product UI** — the Workflows tab provides workflow catalog/draft/publish UI, graph editing, node/edge inspectors, registered pickers, layout persistence, and Project workflow session configuration/start records.

The important current product gap is execution integration: the Workflows editor does not yet run a draft graph, and Project workflow start currently creates/returns workflow run metadata without driving every graph node through the workflow runtime executor.

## Near-term direction

The next workflow phase starts with a small manual trigger and a reusable runtime foundation:

- a manual/test trigger node in the Workflows editor;
- a Play action that accepts text first, then JSON when a schema is declared;
- draft test runs without publishing;
- explicit trigger → edge payload → node execution;
- direct compatible edge transfer for simple graphs;
- agent-node execution through normal Pibo Session routing;
- runtime facts for node attempts, edge transfers, output, and diagnostics;
- interfaces that later support webhooks, cron, deterministic adapters, guards, judge agents, human waits, and Project workflow execution.

Do not rebuild the previous overfull UI. Add only the controls needed to test a workflow from the editor: trigger node, Play, input dialog, status, and output/error.

## Authoring model

Workflow definitions are serializable Pibo Workflow IR. Executable behavior stays behind registered refs.

Current and intended node kinds include:

| Node kind | Role |
|---|---|
| `trigger` | Starts a run from a manual, webhook, cron, message, or future external event source. First implementation: manual editor trigger. |
| `agent` | Runs a normal Pibo Runtime through Pibo Session routing with a fixed Agent Designer profile. |
| `code` | Calls a trusted registered TypeScript handler. UI-authored workflows may reference registered handlers but must not contain inline code. |
| `workflow` | Calls a published nested workflow. |
| `adapter` | Runs a deterministic registered adapter as a visible graph node. |
| `human` | Creates a durable wait token with registered human actions. |

Current UI authoring already supports several of these graph elements. Trigger-node authoring and product execution are planned in `docs/specs/changes/workflow-runtime-foundation-manual-trigger/`.

## Trigger model

A trigger is a workflow node that produces the first payload for a run. The first trigger is manual/test:

- the trigger is visually distinct from normal nodes;
- the user clicks Play on the trigger in the Workflows editor;
- the user enters text or JSON input;
- validation runs before execution;
- the trigger output moves over outgoing edges like any other node output.

Future trigger kinds should reuse the same runtime start contract:

- webhook;
- cron/schedule;
- API event;
- message/event bus;
- Project workflow session start.

## Data flow and handoff defaults

Workflows move explicit payloads through ports and edges. The default handoff between two agents is **not** full chat history.

Default direct handoff:

1. Agent A receives its input and produces a declared output.
2. A compatible edge transfers that output as an edge payload.
3. Agent B receives that payload as its input.
4. Workflow facts store the edge transfer and linked Pibo Session ids.

The upstream Pibo Session transcript remains normal session data. It may be linked for inspection, but it is not injected into downstream prompts unless an explicit node, prompt builder, adapter, or policy-controlled reader asks for it.

## Adapters, transformations, and judge agents

Transformations must be visible and testable:

- Use direct edges only when ports are compatible.
- Use an edge adapter for small deterministic transformations tied to one edge.
- Use a visible `adapter` node when the transformation should be inspected as its own node attempt.
- Use an `agent` node when transformation requires model reasoning, summarization, judging, or semantic rewriting.

A judge is not a hidden edge feature. Model a judge as an explicit agent node that emits a structured decision such as:

```json
{ "decision": "approved", "summary": "The answer is ready." }
```

Downstream guards or router logic then decide which edge fires.

## Routing and gates

An edge without a guard is eligible after its source node completes and its payload is compatible with the target input. Guarded edges use registered guard refs and parameters. Future routing policies should define how multiple eligible outgoing edges behave.

Abort, cancel, revise, and retry paths should be explicit graph behavior: guarded edges, terminal nodes, error/control edges, retry policies, or human actions. They should not be hidden in prompt text.

## Runtime facts and projection

The runtime compiles validated Pibo Workflow IR into an internal LangGraph `StateGraph`. Pibo definitions, APIs, persistence records, events, session routing, and UI projections remain the product contract; LangGraph stays behind that boundary as the execution engine.

Workflow execution should record facts that can drive both editor runs and Project workflow views:

- workflow run id and source;
- trigger input summary;
- node attempts;
- edge transfers;
- linked Pibo Session ids for agent nodes;
- wait tokens and human actions;
- output and diagnostics;
- status changes and lifecycle events.

XState remains a deterministic projection for visualization and inspection. It is not the durable execution source of truth.

## Security and privacy rules

- UI-authored workflows must not contain inline executable code.
- Hidden LLM coercion on edges is forbidden.
- Agentic transforms must be explicit agent nodes.
- Full upstream chat history is not passed downstream by default.
- Inputs, outputs, state, prompts, edge payloads, and human action payloads are sensitive and should follow existing trace/privacy rules.
- Workflow execution must use normal Pibo auth, app context, Project/session routing, profile, tool, skill, context, and compute-worker policies.

## Related documentation

- Current runtime-foundation plan: `docs/specs/changes/workflow-runtime-foundation-manual-trigger/`
- Package capability: `docs/specs/capabilities/pibo-workflow-framework-package.md`
- Adapter guidance: `docs/project/workflow-interface-adapters.md`
- Registry/debug guidance: `docs/project/workflow-registry-and-debug-serialization.md`
- XState projection: `docs/project/workflow-xstate-projection.md`
- Workflow definition examples: `docs/project/workflow-definition-examples.md`
