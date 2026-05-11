# Proposal: Pibo Workflow UI Authoring V2

**Status:** Draft v0.2
**Created:** 2026-05-11
**Updated:** 2026-05-11
**Owner / Source:** User discussion in Pibo session
**Related docs:**

- `docs/specs/changes/pibo-workflow-system-v1/spec.md`
- `docs/specs/changes/pibo-workflow-system-v1/design.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-authoring-api.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-xstate-integration.md`
- `docs/specs/changes/pibo-workflow-system-v1/prds/06-human-actions-cli-project-ui.md`

## Why

Pibo Workflow System V1 created the workflow framework, registry, runtime kernel, persistence, Projects linkage, and read-only Workflow/XState inspection view. Users can inspect workflow-backed sessions, but they cannot choose workflows while creating Project sessions, configure session-specific run settings, duplicate existing workflows, compose workflows visually, edit workflow IR, publish workflow versions, or manage workflow lifecycle from the UI.

V2 adds this product UI for normal Pibo users. Agents and operators continue to use CLI and programmatic APIs, not the UI.

## Proposal

Build Workflow UI V2 with two main product surfaces:

1. **Projects execution surface** — users create Project sessions, select workflow versions, configure session-scoped inputs/prompts/model settings, start the workflow later, inspect runs, and act on human waits.
2. **Workflows main-nav surface** — users browse all workflows, duplicate code or UI workflows into drafts, build/edit workflow definitions, validate drafts, publish immutable versions, archive workflows, and delete workflows.

The UI composes existing capabilities. New executable behavior still comes from TypeScript code registered through the Workflow Framework. The UI MUST NOT allow inline TypeScript or arbitrary executable code.

## Core Decisions

1. **V2 UI is for normal Pibo users.** Agents use CLI/programmatic paths.
2. **Workflows are used only inside Projects in V2.** No normal Sessions-tab workflow usage and no workflow slash commands.
3. **Workflow selection is per Project session.** It is not project-wide.
4. **A Project session can be configured without immediately starting the workflow.** The run starts only when the user executes it.
5. **A Project session has one workflow run.** Nodes may run in parallel if the workflow defines parallelism.
6. **Workflow selection is immutable after session creation.** The transition between workflow states, data, and sessions is undefined otherwise.
7. **Every session configuration creates a definition/configuration snapshot.** The snapshot records base workflow, version, hash, input values, prompt overrides, model, thinking level, and fast mode.
8. **Project Sessions sidebar shows only real Pibo Sessions.** Code, human, adapter, edge, guard, and state nodes appear only inside Workflow/XState views.
9. **Workflow sessions use Workflow/XState + run views.** Agent-node sessions and subagent sessions use Terminal view.
10. **Nested workflows appear as real nested workflow sessions when they create workflow runs.** They are reachable from the Project Sessions sidebar.
11. **Workflow UI drafts live in the Workflow Registry/store.** They semantically belong to workflows.
12. **UI drafts may be invalid or incomplete.** Invalid raw IR text is not saved; the UI shows a warning.
13. **Workflow records use separate `source` and `status` fields.** `source: "code" | "ui"`; `status: "draft" | "published" | "archived"`.
14. **Code-registered workflows are not edited directly.** They can be duplicated into UI drafts.
15. **UI-created workflows use Pibo Workflow IR.** V2 adds no separate YAML/JSON authoring layer.
16. **Raw Workflow IR is visible and editable through a toggle.** Raw XState editing is not supported.
17. **XState remains a visual/projection layer.** The UI edits Pibo nodes, edges, ports, adapters, guards, state, and UI metadata.
18. **Published workflow versions are immutable.** Editing creates a new draft/version path.
19. **Versioning is automatic and manual.** Patch increments automatically; users trigger minor/major version bumps.
20. **Archiving applies to the whole workflow.** Not individual versions.
21. **A workflow may be deleted even if historical runs exist.** Runs must retain enough snapshot data to remain inspectable.
22. **Only one draft exists per workflow/copy.** Users can create copies, but each copy has one draft.
23. **Workflows are global.** UI-authored workflows are visible to other users.
24. **All authenticated users may archive/delete workflows.**
25. **Prompt assets are editable in V2.** Use the existing Markdown editor pattern from Context Files.
26. **Schemas remain JSON Schema subset.** No Zod.
27. **Schema editing is raw JSON only in V2.**
28. **Schema changes are allowed even when edges break.** The draft becomes invalid until fixed.
29. **Adapters and guards are selectable.** Parameters are editable only when registry metadata provides `paramsSchema`.
30. **Nested workflow nodes are edited as references in the parent.** “Open workflow” navigates to the nested workflow's own builder/viewer. No inline nested graph expansion in V2.
31. **No templates in V2.** Users duplicate existing workflows.
32. **No TypeScript export, no workflow slash commands, and no workflow tools for agents in V2.**

## Non-Goals

- Workflow templates.
- TypeScript export from UI-created workflows.
- YAML/JSON import or export as a product feature.
- Inline TypeScript or arbitrary code execution in the UI.
- Slash commands for workflows.
- Workflow tools for agents.
- Normal Sessions-tab workflow usage.
- Project-wide default workflow selection.
- Changing a session's workflow after creation.
- Raw XState editing.
- Marketplace or third-party workflow package discovery.
- Zod migration.

## Impact

V2 requires new product and technical work for:

- Workflow Registry/store records for UI drafts and UI-published workflows;
- Project session creation and delayed workflow start;
- session configuration snapshots;
- workflow library in main navigation;
- visual builder and raw IR editor;
- workflow versioning, archive, and delete;
- Projects run history and nested session navigation;
- adapter, guard, handler, profile, prompt, and schema pickers/editors;
- validation and missing-reference diagnostics;
- human action controls in workflow run views.
