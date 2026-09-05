---
type: "Historical Record"
title: "Remove Projects and Make Workflows Session-Native"
description: "Archives the completed transition directive; current authority belongs to the Room, Session, and Workflow specifications."
tags: ["projects-removal", "sessions", "rooms", "workflows", "migration"]
status: "deprecated"
authority: "historical"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T10:02:00Z"
original_body_sha256: "747508fd324e56145a0b36406c11fdb952b021e8496bdab84e8b4796ac50766f"
original_generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T06:09:28Z"
sources:
  - resource: "scope:User-supplied untracked directive at docs/plans/remove-projects-and-make-workflows-session-native.md, preserved original body"
    title: "Original transition directive"
  - resource: "/specs/web/rooms-and-session-trees.md"
    title: "Current Room and Session ownership"
  - resource: "/specs/orchestration/workflow-catalog-and-session-execution.md"
    title: "Current Workflow ownership and execution"
links:
  - "/specs/web/rooms-and-session-trees.md"
  - "/specs/orchestration/workflow-catalog-and-session-execution.md"
  - "/reports/session-native-workflow-transition-validation-2026-09-05.md"
---

# Goal

Reach a product state in which the Pibo Projects feature no longer exists in product behavior, architecture, storage, APIs, UI, terminology, tests, or current documentation.

Pibo must behave as though Projects had never been introduced. Rooms group work, Rooms may define workspaces, Pibo Sessions remain the universal conversation and execution identity, and Workflows operate directly through normal Pibo Sessions.

The complete Workflow capability must remain available. This includes the Workflow editor, catalog, drafts, publishing, versions, validation, registered capabilities, execution foundations, runtime facts, linked agent Sessions, graph and XState projections, waits, human actions, nested workflows, manual triggers, and future workflow roadmap.

This document defines the destination and completion bar. It does not prescribe implementation order or code structure. The implementing agent owns the technical plan.

# Target product model

The finished product has these first-class concepts:

- **Room** — groups related Pibo Sessions and may define their default workspace.
- **Pibo Session** — owns conversation identity, execution, history, runtime binding, hierarchy, status, workspace, and user interaction.
- **Workflow Definition** — defines a versioned reusable graph.
- **Workflow Run** — executes a Workflow Definition and links to the normal Pibo Sessions used by the run.
- **Workspace** — the filesystem directory used by a Room or Session.

There is no Pibo Project, Project Session, Projects area, Project Manager container, Project workflow session, or Project-owned workflow lifecycle.

A workflow-backed Session is a normal Pibo Session with workflow linkage. It is not a separate Session class and does not require a separate container type.

# Required outcome

## Projects is absent

The shipped product must contain no Projects product surface or active Projects domain model.

This includes the absence of:

- Projects navigation, tabs, routes, sidebars, dialogs, panels, labels, empty states, archive controls, and settings;
- Project creation, selection, rename, archive, restore, deletion, folder deletion, or Project-specific Session management;
- Project-specific bootstrap, message, mutation, workflow-start, wait-token, human-action, or event-stream APIs;
- Project-specific stores, tables, service objects, configuration options, worker seeds, runtime branches, cache keys, local-storage keys, and preview ownership fields;
- Project-specific workflow catalog actions, workflow picker language, validation triggers, lifecycle event names, diagnostics, and security copy;
- Project-only Session views, routing rules, metadata, types, adapters, compatibility helpers, and test fixtures;
- current normative documentation that presents Projects as an active or intended Pibo capability.

Projects must not survive as a hidden alias, renamed compatibility container, disabled module, dormant route, deprecated UI switch, or generic abstraction retained only because existing code already uses it.

Historical records may continue to describe Projects as a removed design. They must be clearly historical and must not act as current product authority.

## Rooms and Sessions own workspace-oriented work

All user work that previously depended on Projects must be possible through Rooms and normal Pibo Sessions.

- A Room may represent a repository, folder, long-running work area, team topic, or any other Session grouping.
- A Room may retain a configured workspace.
- Sessions created in a Room inherit or resolve the appropriate workspace through the normal Session model.
- Sessions remain independently addressable by Pibo Session ID.
- Session trees, parent and child Sessions, subagents, traces, terminal interaction, previews, runtime controls, archive behavior, and deletion continue to work without a Project association.
- No normal Session operation may query or require Project storage.

The user must not lose any material capability merely because the separate Projects area is gone.

## Workflows are fully preserved and become session-native

The Workflow product remains a first-class Pibo area.

The final product must preserve the current Workflow editor and its complete supporting lifecycle:

- workflow library and catalog;
- UI drafts and draft editing;
- graph, node, edge, state, prompt, schema, and raw Workflow IR editing;
- validation and diagnostics;
- immutable published versions;
- duplication, next-version editing, archive, deletion tombstones, and historical inspection;
- registered profiles, handlers, adapters, guards, prompt builders, prompt assets, human actions, and nested workflow references;
- manual trigger and test-run behavior already supported;
- workflow runtime, store, inspection, retry, checkpoint, wait, human-action, nested-workflow, agent-node, edge-transfer, and XState projection foundations;
- all existing security, privacy, versioning, capability, and no-inline-code boundaries.

Every Project-dependent workflow interaction must have a Session-native equivalent:

- A user can start or create a workflow-backed normal Session without creating or selecting a Project.
- Workflow execution can target a normal Room and workspace where relevant.
- Agent nodes create or use normal Pibo Sessions through standard routing.
- Workflow Runs link through `workflowRunId`, `workflowId`, workflow version, node identity, and Pibo Session IDs without requiring `projectId`.
- Workflow configuration and immutable effective-definition snapshots belong to the Workflow or Session integration, not to a Project service.
- Wait tokens and human actions belong to Workflow Runs and linked Sessions, not to Projects.
- Workflow status, graph inspection, run history, node attempts, edge transfers, outputs, validation errors, and human actions remain visible for workflow-backed normal Sessions.
- The Workflow view is available from the appropriate normal Session surface alongside the Terminal view.
- Workflow catalog language and actions refer to starting workflows or creating workflow Sessions, never to creating Project Sessions.

Removing Projects must not reduce Workflow scope, delete the Workflow editor, turn Workflows into a static catalog, or postpone currently working Workflow behavior.

Pre-existing Workflow roadmap gaps do not have to be solved merely because Projects is removed. Existing plans must, however, remain valid after their Project assumptions are translated into Room-, Session-, Workspace-, and Workflow-owned concepts.

## Workflow ownership is coherent

The finished architecture has one coherent ownership model for Workflow product data and runtime facts.

- Workflow definitions, drafts, versions, assets, validation records, lifecycle facts, Runs, snapshots, waits, human actions, node attempts, edge transfers, checkpoints, wakeups, outputs, and diagnostics are Workflow-owned facts.
- Pibo Sessions own conversation and runtime history.
- Rooms own grouping and optional workspace defaults.
- Cross-links use stable IDs and do not duplicate ownership.
- No Workflow capability depends on `web-projects.sqlite` or Project tables.
- Fresh installations do not create Project storage.
- Normal operation after upgrade does not open, query, write, seed, repair, or synchronize Project storage.

The result must not leave two competing Workflow persistence paths whose distinction exists only because one was formerly Project-owned.

## Existing user data remains usable

Removing the feature must not delete or strand existing work.

For every existing Project-backed Pibo Session that still has canonical Session data:

- the Pibo Session ID remains valid;
- transcript, product history, trace data, runtime binding, title, profile, model, hierarchy, timestamps, archive state, and workspace remain available;
- the Session becomes reachable through normal Rooms and Sessions navigation;
- child Sessions and subagents remain linked correctly;
- workflow linkage remains inspectable when the Session was workflow-backed;
- no user must recreate a Session, copy a transcript, or manually reconstruct workflow state.

Existing Project containers, Project Session links, workflow snapshots, Runs, waits, and human actions must be converted into their surviving Room, Session, and Workflow equivalents where corresponding data exists.

A successful upgrade leaves no active product dependency on the legacy Project database. Missing, malformed, conflicting, or partially migrated legacy data must fail visibly and preserve recoverable source data rather than silently dropping work.

# Done when

The change is complete only when all of the following are true:

1. No Projects entry appears anywhere in the running Chat Web product.
2. No `/projects` product route or `/api/chat/projects` API remains part of the active application contract.
3. A fresh Pibo installation creates no Project database, tables, default Project, Project workspace, or Project Session.
4. Existing Project-backed Sessions remain reachable and usable as normal Sessions after upgrade.
5. Rooms and Sessions provide the workspace behavior needed for repository- and folder-oriented work.
6. The Workflow area loads and retains its editor, library, draft, publish, versioning, validation, picker, asset, archive, delete, and inspection behavior.
7. A workflow can be started without a Project and produces or links normal Pibo Sessions.
8. Workflow-backed Sessions expose their Workflow state and controls through the normal Session UI.
9. Workflow snapshots, Runs, waits, human actions, node attempts, edge transfers, outputs, and diagnostics have no Project ownership requirement.
10. Session creation, messaging, event streaming, runtime actions, traces, previews, subagents, archive, deletion, and cleanup work without consulting a Project service.
11. Current specifications, plans, glossary entries, help text, UI copy, and developer documentation describe the Session-native model consistently.
12. Project-specific source and test references are gone except for intentionally retained migration fixtures or clearly historical documentation.
13. Retained legacy fixtures cannot register routes, create stores, affect runtime behavior, or present Projects as a supported feature.
14. Workflow regression coverage, Session and Room coverage, upgrade migration coverage, type checking, builds, documentation validation, and realistic browser validation all pass.
15. The implementation leaves no dead Project components, unused Project types, stale exports, disabled Project modules, misleading names, or duplicate persistence paths.

# Boundaries

- Do not delete or rename the OKF `docs/project/` root. It is documentation taxonomy, not the Projects product feature.
- Do not remove ordinary uses of the word “project” that mean source repository, filesystem project, native project context, documentation project, projection, or another unrelated concept.
- Do not weaken Rooms, Sessions, Workspaces, Workflows, runtime adapters, subagents, previews, traces, or history to make removal easier.
- Do not retain Projects as an internal mandatory abstraction behind Session-native labels.
- Do not treat hiding the Projects tab as completion.
- Do not delete existing canonical Pibo Sessions as cleanup.
- Do not claim completion while Project-owned Workflow facts remain necessary for any supported path.
- Do not expand the change into an unrelated redesign of the Workflow editor or Session UI.

# Validation expectations

Validation must prove the final product, not merely compile the deletion.

At minimum, evidence must cover:

- a clean installation with no Projects artifacts;
- an upgrade fixture containing Projects, Project Sessions, archived state, hierarchy, workflow snapshots, Runs, waits, and human actions;
- preservation of canonical Session identity and history through migration;
- Room workspace inheritance and Session execution in that workspace;
- Workflow editor and lifecycle regression coverage;
- Session-native workflow creation or start, linked agent Sessions, inspection, waits, and human actions;
- Session messaging, event streaming, traces, previews, subagents, archive, and deletion after Project removal;
- source inventory proving that remaining Project references are intentional historical or migration evidence;
- headful browser verification of navigation, normal Session use, Room workspace use, Workflow editing, workflow start, Workflow Session inspection, and responsive behavior;
- current documentation and generated OKF indexes passing all repository documentation gates.

# Failure conditions

The objective is not complete if any of these conditions remains:

- Projects is hidden but its service, routes, store, domain types, or lifecycle still run.
- Workflow editing survives but workflow execution, inspection, waits, or human actions are lost.
- Workflows still require a synthetic Project internally.
- Existing Project Sessions become inaccessible, duplicated, detached from history, or assigned new Pibo Session IDs.
- `web-projects.sqlite` remains necessary during normal operation.
- current docs or UI still direct users to Projects.
- broad deletion removes unrelated repository, workspace, native project context, projection, or `docs/project/` behavior.
- tests pass only because Project behavior was removed from coverage rather than replaced by Session-native coverage.

# Deliverable

Produce one coherent implementation that reaches this target state, including code, data continuity, UI, APIs, stores, tests, documentation, and validation evidence.

The implementing agent may choose the internal design and execution sequence. It must finish the complete transition rather than stop after analysis, a partial compatibility layer, a hidden Projects UI, or a Workflow-only proof of concept.
