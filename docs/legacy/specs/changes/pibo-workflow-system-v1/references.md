---
type: "Historical Record"
title: "References: Pibo Workflow System V1"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/changes/pibo-workflow-system-v1/references.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "ba68139b89221052dbf9f4fd822bd790b850078d"
  source_bytes: 3336
  source_sha256: "94a04ea6e7684d841c4c631bc12e45255b2fdeedeb7fae98c37fa2b8a11919f3"
  source_body_sha256: "94a04ea6e7684d841c4c631bc12e45255b2fdeedeb7fae98c37fa2b8a11919f3"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# References: Pibo Workflow System V1

**Status:** Draft  
**Created:** 2026-05-10  
**Feature:** `pibo-workflow-system-v1`

This file links the external project research reports used to shape the Pibo Workflow System V1 specs and design documents.

## Product/API References

| Source | Link | Primary value for Pibo |
|---|---|---|
| OpenAI Structured Outputs | `https://platform.openai.com/docs/guides/structured-outputs` | V1 structured port schema compatibility: use the Structured Outputs / tool-calling JSON Schema subset. |

## Research Reports

| Project | Report | Primary value for Pibo |
|---|---|---|
| LangGraphJS | `docs/reports/2026-05-10-workflow-research-langgraphjs.md` | Agent graph patterns, state updates, commands, subgraphs, checkpoint namespaces, streaming, interrupts. |
| OpenWorkflow | `docs/reports/2026-05-10-workflow-research-openworkflow.md` | Durable execution, run/attempt model, retry, replay, leases, wakeups, crash recovery. |
| Graphology | `docs/reports/2026-05-10-workflow-research-graphology.md` | Evented graph store, strict mutations, graph serialization, modular algorithms, projection APIs. |
| Graphlib | `docs/reports/2026-05-10-workflow-research-graphlib.md` | Minimal graph API, traversal, topsort, cycle detection, internal indices, JSON IR discipline. |
| XState | `docs/reports/2026-05-10-workflow-research-xstate.md` | Statechart projection, actor model, guards/actions/delays, inspection, visualization, UI editing, `setup(...)` typing pattern. |
| Archon | `docs/reports/2026-05-10-workflow-research-archon.md` | Product UX for AI coding workflows, approval gates, worktree isolation, provider capabilities, CLI/skill/docs patterns. |

## How the Reports Map to Design Docs

| Design document | Main research inputs |
|---|---|
| `design-framework-architecture.md` | All reports; synthesizes the overall architecture. |
| `design-authoring-api.md` | Archon, XState, LangGraphJS. |
| `design-runtime-kernel.md` | OpenWorkflow, LangGraphJS, Archon. |
| `design-xstate-integration.md` | XState, LangGraphJS. |
| `design.md` | Compact summary of all design decisions. |

## Key Synthesis

Pibo should combine the research as follows:

- **LangGraphJS** informs agent graph composition, commands, state updates, subgraphs, and checkpoint namespaces.
- **OpenWorkflow** informs the durable kernel: runs, attempts, retry, replay, leases, wakeups, and crash recovery.
- **Graphology** informs the graph store and mutation/event model.
- **Graphlib** informs the minimal graph API, traversal, topsort, and cycle validation.
- **XState** informs projection, actors, guards, actions, delays, inspection, visualization, and UI editing.
- **Archon** informs product workflow UX: approval nodes, workflow routing hints, provider capabilities, isolation, CLI operations, and agent-facing docs. Pibo remains TypeScript framework-first.

## Canonical Direction

The reports support this direction:

> Pibo Workflow System V1 should use a Pibo-owned Workflow IR, a small graph store, a compiler, a durable runtime kernel, Pibo Runtime Agent nodes, TypeScript code nodes, nested workflows, explicit adapters, durable wait tokens, and XState-compatible projections for visualization and editing.

No researched project should be copied wholesale. Each contributes patterns to a Pibo-native framework.
