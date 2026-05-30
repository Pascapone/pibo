# Pibo Workflows

Pibo Workflow System V1 is the canonical workflow capability for repeatable, inspectable Pibo work. Workflows are TypeScript-authored definitions that compose normal Pibo Runtime agent sessions, trusted TypeScript handlers, adapters, nested workflows, and durable human waits through typed ports and explicit edges.

This document describes the current implementation contract. Detailed historical requirements and design discussion remain under `docs/specs/changes/pibo-workflow-system-v1/`.

## Current scope

V1 provides:

- a dedicated workflow package at `packages/workflows`
- text and JSON workflow/node/adapter ports
- validation for the supported OpenAI Structured Outputs / tool-calling JSON Schema subset
- registry-backed workflow definitions, Agent Designer profiles, code handlers, adapters, guards, prompt builders, and human actions
- runtime dispatch for `agent`, `code`, nested `workflow`, visible `adapter`, and `human` nodes
- persisted workflow runs, node attempts, events, edge transfers, checkpoints, wakeups, wait tokens, and human actions in `pibo-workflows.sqlite`
- inspection helpers and Chat Web Workflow/XState UI projections
- deterministic XState projection for visualization and diagnostics

V1 intentionally does not provide a full visual workflow editor, raw XState editing, workflow YAML/JSON import/export as a product surface, arbitrary inline code nodes, or hidden/agent-inferred data adapters.

## Authoring model

Workflow definitions are TypeScript-owned canonical IR. Authors use the public `@pasko70/pibo-workflows` package surface and keep executable behavior outside the definition object behind registry refs.

Primary authoring helpers:

- `text(description?)` for plain string ports
- `json(schema, description?)` for JSON ports backed by the V1 schema subset
- `fixedProfile(profileId)` for required fixed Agent Designer profile selection on agent nodes
- `adapterRef(id)` and `edgeAdapter(ref, outputPort)` for explicit registered edge adapters
- `promptBuilderRef(id)` for registered prompt construction

Definitions should stay serializable. TypeScript closures belong in the Workflow Registry, not in persisted workflow IR.

For starter TypeScript examples, see `docs/project/workflow-definition-examples.md`. For explicit interface adapter examples, see `docs/project/workflow-interface-adapters.md`. For registry/plugin registration, prompt assets, routing hints, human actions, and debug serialization, see `docs/project/workflow-registry-and-debug-serialization.md`. For projection semantics, see `docs/project/workflow-xstate-projection.md`.

## Runtime nodes

Workflow nodes currently execute through these capability boundaries:

| Node kind | Capability boundary |
|---|---|
| `agent` | Routes through normal Pibo session routing with a fixed Agent Designer profile. Runtime metadata records the selected profile plus effective tools, skills, context files, and linked Pibo session ids. |
| `code` | Calls a trusted registered TypeScript handler. Handlers receive scoped input, declared state readers/writers, edge payload readers, and command/event emitters. |
| `workflow` | Runs a registered child workflow through an injected nested workflow executor. Parent and child state stay isolated except for declared input/output values. |
| `adapter` | Calls a trusted registered TypeScript adapter as a visible workflow node. |
| `human` | Creates a durable wait token with registry-backed actions such as approve, reject, resume, and cancel. Actions are validated before the wait is resolved. |

All runtime boundaries validate inputs before execution and validate outputs before downstream use or workflow completion.

## Data flow and state

Workflows move data only through declared ports and edges:

- Direct edges are allowed only when source and target ports are compatible.
- Incompatible edges require an explicit registered adapter, either as an edge adapter or as a visible `adapter` node.
- Edge payloads are immutable once transferred.
- Workflow global state is persisted and must be declared before node reads/writes.
- Node local state is scoped to the current node by default.
- Concurrent writes to the same global state path require an explicit merge policy.
- Back-edges and review/fix loops must be bounded with retry/loop policy.

This keeps workflow execution replayable and prevents hidden copy/paste or implicit schema coercion.

## Registry and plugin boundary

The Workflow Registry is the trusted lookup boundary for executable capabilities. It stores:

- workflow definitions by id/version
- fixed Agent Designer profile definitions
- TypeScript code handlers
- TypeScript adapters
- guards
- prompt builders
- human action definitions

Use `createWorkflowRegistry()` plus `registerWorkflowDefinition`, `registerWorkflowHandler`, `registerWorkflowAdapter`, `registerWorkflowGuard`, `registerWorkflowPromptBuilder`, `registerWorkflowAgentProfile`, and `registerWorkflowHumanAction` to assemble a registry. Plugin-provided capabilities should register stable ids and metadata instead of embedding implementation functions in definitions.

## Persistence and inspection

Workflow-specific facts are stored separately from normal Pibo/Pi session data. The workflow store records workflow runs, events, attempts, transfers, checkpoints, wakeups, wait tokens, human actions, state, current cursor, final output, validation errors, and lightweight links to Pibo/project sessions.

Normal session traces, tool calls, spans, transcripts, and Pibo Session records remain in the existing session stores. Workflow-backed Chat Web sessions link to workflow runs through persisted metadata, but simple chat sessions remain unbadged unless they have workflow metadata.

Use the inspection helpers in `packages/workflows/src/inspection` to reconstruct a run from store facts. Chat Web Workflow/XState panels and debug surfaces should consume the same persisted facts instead of inventing separate UI state.

## XState projection

XState is a deterministic projection and visualization layer, not durable execution truth. The kernel snapshot and workflow store remain authoritative.

The projection maps workflow nodes, edges, guards, waits, retry/failure states, final states, actors, actions, delays, and node statuses into a compact UI model. Consumers should use `projectWorkflowToXStateProjection(...)` and `createWorkflowXStateUiModel(...)` rather than reading private runtime internals.

See `docs/project/workflow-xstate-projection.md` for the detailed projection semantics, stable id scheme, snapshot-kind rules, UI model behavior, and consumer restrictions.

## Security and privacy rules

Workflow execution must not bypass existing Pibo auth, shared app project/session routing, tool, skill, context, profile, or compute-worker policies.

Additional V1 rules:

- Agent nodes must use fixed profile selection.
- Code and adapter nodes must use trusted registered TypeScript handlers.
- Human actions must validate token status, availability, payload schema, expiry, and run ownership before resolving waits.
- Inputs, outputs, state, prompts, edge payloads, wait payloads, and human action payloads are sensitive workflow data and should follow existing trace/privacy rules.
- Diagnostics should identify code, severity, path/node/edge context, and actionable hints without leaking hidden payloads into normal UI surfaces.

## Where to add more documentation

Keep current operator/developer docs under `docs/project/`. Keep implementation plans, validation reports, and historical specs under `docs/plans/`, `docs/reports/`, and `docs/specs/` respectively.

Registry/plugin registration patterns are documented in `docs/project/workflow-registry-and-debug-serialization.md`; add future current workflow docs under `docs/project/` and keep historical specs under `docs/specs/`.
