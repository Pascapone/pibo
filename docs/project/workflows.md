---
type: "Reference"
title: "Pibo Workflows"
description: "Explains the current Pibo Workflows baseline, authoring model, execution direction, and security boundaries."
tags: ["architecture", "reference", "workflows"]
status: "draft"
authority: "informative"
migration_lineage:
  source_path: "docs/project/workflows.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "15cd892fc5e295c5bc3b0b74039757ed733b0de0"
  source_bytes: 7533
  source_sha256: "677643fdf4d73d50d4cf63159add7604ffe88954994dad5ae47f0ea47f2ef4a0"
  source_body_sha256: "677643fdf4d73d50d4cf63159add7604ffe88954994dad5ae47f0ea47f2ef4a0"
generated:
  by: "process:pibo-okf-p-current-project-plans"
  at: "2026-09-05T10:02:49Z"
---
# Pibo Workflows

Pibo Workflows are the product path for repeatable, inspectable multi-step agent work. A workflow is a versioned graph with explicit inputs, outputs, nodes, edges, adapters, guards, state, and runtime facts.

Current contracts live in the [Workflow framework specification](/specs/orchestration/workflow-framework-runtime-store.md) and [catalog and Session integration specification](/specs/orchestration/workflow-catalog-and-session-execution.md). Remaining executor and trigger work lives in the [runtime follow-up plan](/plans/workflow-trigger-and-runtime-follow-ups.md). Historical V1/V2 packets are not current authority.

## Current baseline

Pibo currently has two workflow layers:

1. **Workflow framework package** — `packages/workflows` defines TypeScript IR types, ports, registry refs, validation helpers, runtime dispatch helpers, edge transfer helpers, persistence contracts, inspection helpers, fixtures, and XState projection helpers.
2. **Chat Web workflow product UI** — the Workflows area provides catalog/draft/publish UI, graph and raw IR editing, node/edge inspectors, registered pickers, prompt assets, layout persistence, manual text-trigger test runs, and workflow configuration/start records linked to normal Pibo Sessions.

Rooms group Sessions and may supply workspace defaults. Workflow definitions, immutable configuration snapshots and execution facts belong to the Workflow store; conversation history and runtime bindings belong to Pibo Sessions.

The remaining gap is general executor integration. The editor supports bounded manual trigger-to-agent traversal, including fan-out, through ordinary chat Sessions and persists canonical snapshots, Runs, attempts, and transfers; it rejects unsupported joins and graph shapes. Its Run Room selector defaults to the selected Room, shows that Room's workspace, and routes created agent Sessions there. The API accepts optional `roomId` and `workspace`, validates explicit Room write permission and workspace shape, and otherwise inherits the resolved Room workspace. Starting a configured Session Workflow persists one canonical `pending` Run and explicitly does not activate general graph execution; the explanatory state remains visible after reload.

## Near-term direction

The next phase connects existing editor tests and Session starts to one orchestration-owned executor. It preserves:

- manual trigger input and draft tests without publication;
- explicit trigger → edge payload → node execution;
- direct compatible edge transfer for supported graphs;
- agent-node execution through normal Pibo Session routing;
- runtime facts for node attempts, edge transfers, output, and diagnostics.

Schema-aware JSON triggers, broader graph advancement, restart recovery, webhooks, and scheduled starts remain follow-up work. Registered adapters, guards, human waits and nested-workflow runtime foundations remain available; the plan describes their remaining end-to-end integration.

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

Current UI authoring supports these graph elements, including manual triggers. Authoring support is not a claim that every combination executes through the current manual test path.

## Trigger model

A trigger is a workflow node that produces the first payload for a run. The first trigger is manual/test:

- the trigger is visually distinct from normal nodes;
- the user clicks Play on the trigger in the Workflows editor;
- the user chooses a Run Room, defaulted to the selected Room, and sees its workspace;
- the user enters text input in the current manual test slice;
- the API validates Room write permission and any explicit workspace before execution;
- ordinary agent Sessions inherit the chosen Room workspace unless a valid workspace override is supplied;
- validation runs before execution;
- the trigger output moves over outgoing edges like any other node output.

Future trigger kinds should reuse the same runtime start contract:

- webhook;
- cron/schedule;
- API event;
- message/event bus;
- workflow-backed Session start.

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

## Runtime ownership, facts, and projection

Pibo owns workflow graph execution. The runtime validates Pibo Workflow IR, schedules ready nodes deterministically, transfers explicit edge payloads, and records each transition in Pibo-managed facts. External graph frameworks such as LangGraph may inform graph composition and orchestration design, but they are reference material rather than runtime dependencies or sources of truth.

Workflow execution facts support editor runs and the Workflow view of normal Pibo Sessions:

- workflow run id and source;
- trigger input summary;
- node attempts;
- edge transfers;
- linked Pibo Session ids for agent nodes;
- wait tokens and human actions;
- output and diagnostics;
- status changes and lifecycle events.

XState remains a deterministic projection for visualization and inspection. It is not the durable execution source of truth. Session Workflow header and view state derive from canonical inspection, independently of ordinary Session activity.

## Acceptance baseline

At integrated commit `7ec71c2cca2108423002be0e7330d2a20c4c5b67`, source checks and all typechecks passed. The added manual editor API test passed alone, and the focused routed-runtime/UI/manual/header matrix passed 20 tests. The final-code whole-root rerun remains underway and has no recorded result here. The prior complete root suite at `14cbaf0fd04cfa321674b570baeb40e543d957cb` remains historical evidence: 2,744 total, 2,739 passed, 0 failed, 5 skipped. All 144 Workflow package tests passed previously; package source did not change.

Headful acceptance created a draft, authored and connected manual-trigger and agent nodes, saved text input/output settings, selected Room `Session-native QA`, and ran actual `openai-codex` in `/tmp/pibo-session-native-workspace`. Run `wfr_ac3db39f-229f-4082-9485-4f6e6663a8b5` and ordinary agent Session `ps_04559a0b-fac4-4636-979a-addb1ff91fb0` completed with `MANUAL_NATIVE_ROOM_OK`, two node attempts, one edge transfer, immutable executable snapshot, and actual output. Reopening the Workflow view preserved completed state independently of ordinary Session activity. The persisted pending-start explanation survived reload. Desktop and mobile layouts fit their tested viewports.

A clean `npm install --omit=dev` into an empty directory also passed CLI version/help, canonical persistent Workflow-service reopen, no-workspace-symlink, and no-retired-storage checks. No completed headful raw-IR editing, publish, human-action submission, or job-control acceptance is claimed.

## Security and privacy rules

- UI-authored workflows must not contain inline executable code.
- Hidden LLM coercion on edges is forbidden.
- Agentic transforms must be explicit agent nodes.
- Full upstream chat history is not passed downstream by default.
- Inputs, outputs, state, prompts, edge payloads, and human action payloads are sensitive and should follow existing trace/privacy rules.
- Workflow execution must use normal Pibo auth, App Context, Room/Session routing, workspace, profile, tool, skill, context, and compute-worker policies.

## Related documentation

- [Runtime follow-up plan](/plans/workflow-trigger-and-runtime-follow-ups.md)
- [Framework contract](/specs/orchestration/workflow-framework-runtime-store.md)
- [Adapter guidance](/project/workflow-interface-adapters.md)
- [Registry and debug guidance](/project/workflow-registry-and-debug-serialization.md)
- [XState projection](/project/workflow-xstate-projection.md)
- [Workflow definition examples](/project/workflow-definition-examples.md)
