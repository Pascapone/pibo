# Spec: Pibo Workflow UI Authoring V2

**Status:** Draft v0.2
**Created:** 2026-05-11
**Updated:** 2026-05-11
**Owner / Source:** User discussion in Pibo session
**Related docs:**

- `proposal.md`
- `design.md`
- `tasks.md`
- `discovery-notes.md`
- `docs/specs/changes/pibo-workflow-system-v1/spec.md`
- `docs/specs/changes/pibo-workflow-system-v1/design-xstate-integration.md`

## Why

Workflow V1 is runtime-first. It can define, validate, run, persist, link, and inspect workflows, but normal Pibo users need a UI to select workflows for Project sessions and compose existing workflow elements into new workflow versions.

## Goal

Normal Pibo users can select, configure, start, inspect, duplicate, edit, validate, publish, version, archive, and delete workflows from Chat Web without writing code.

## Background / Current State

V1 provides:

- `WorkflowDefinition` IR with nodes, edges, ports, state, metadata, and UI metadata;
- Workflow Registry for definitions, handlers, adapters, guards, prompt builders, profiles, and human actions;
- runtime kernel, persistence, wait tokens, and workflow run inspection;
- Project session linkage via `workflowId` and `workflowRunId`;
- read-only Workflow/XState session view.

Current gaps:

- no workflow selection during Project session creation;
- no delayed start for configured workflow Project sessions;
- no workflow library UI;
- no workflow draft store inside the Workflow Registry;
- no visual workflow editor;
- no publish/version lifecycle for UI-authored workflows;
- no UI flow to compose workflows from existing building blocks;
- no Project Sessions sidebar model for nested workflow sessions versus agent/subagent sessions.

## Terminology

**Project Session:** A real Pibo Session shown in the Projects session sidebar.

**Workflow Session:** A Project Session whose selected context is a workflow run. It renders Workflow/XState + run views.

**Agent Node Session:** A real child Pibo Session created by an Agent node. It renders Terminal view.

**Subagent Session:** A real child Pibo Session created by an agent/subagent call. It renders Terminal view.

**Nested Workflow Session:** A real child Pibo Session/workflow container created by a nested workflow node. It renders Workflow/XState + run views.

**Logical Workflow Node:** A node in workflow IR. Code, human, adapter, guard, state, and edge elements are logical workflow elements, not necessarily Pibo Sessions.

## Scope

### In Scope

- Main-nav Workflows tab.
- Workflow Library for browsing global workflows and versions.
- Project-session workflow selection at session creation time.
- Delayed workflow start after Project session creation.
- Session-scoped workflow configuration before start.
- Workflow Run/Debug surface inside Projects.
- Workflow Builder in the Workflows tab.
- Duplicate existing workflows into UI-editable drafts.
- Visual graph editing with drag-and-drop layout.
- Automatic layout for workflows without saved positions.
- Raw Workflow IR viewing and editing through a toggle.
- Node creation and deletion.
- Edge creation and deletion.
- Agent profile selection from non-archived private/custom/global profiles.
- Prompt template editing.
- Prompt asset editing with the existing Markdown editor pattern.
- Input/output schema editing as raw JSON using the existing JSON Schema subset.
- Adapter selection from registered compatible adapters.
- Guard selection from registered guards.
- Adapter/guard parameter editing only when Registry metadata provides `paramsSchema`.
- Human approval configuration.
- Simple state reads/writes editing through dropdowns; complex state mappings through raw IR only.
- Validation panel with structured diagnostics.
- Draft, publish, version, archive, and delete lifecycle.
- Visible workflow version selection.
- Run history for workflow-backed Project sessions.
- Human action controls for workflow runs.
- Missing-reference diagnostics for disappeared handlers/adapters/guards/profiles/workflows.

### Out of Scope

- Workflow templates.
- TypeScript export from UI-authored workflows.
- YAML/JSON import or export as a product feature.
- Inline TypeScript in the UI.
- New executable capabilities created solely in UI.
- Slash commands for workflow run/start.
- Workflow tools for agents.
- Normal Sessions-tab workflow usage.
- Project-wide default workflow selection.
- Changing a session's workflow after creation.
- Inline expansion/editing of nested workflow internals in the parent graph.
- Zod migration.

## Requirements

### Requirement: UI targets normal Pibo users

The Workflow UI MUST be designed for normal Pibo users. Agents and operators MUST use CLI or programmatic APIs instead of the UI.

#### Acceptance

The UI copy and navigation assume an interactive human user. Agent-facing workflows remain available through existing or future CLI/API paths.

### Requirement: Workflows are global

UI-authored workflows MUST be global, not project-scoped or user-private.

#### Acceptance

Authenticated users can see UI-authored workflows unless future access rules are introduced. Code-registered and UI-published workflows appear in the same global Workflow Library.

### Requirement: Workflow record source and status are explicit

Workflow records MUST distinguish source and lifecycle status with separate properties.

```ts
type WorkflowRecordSource = "code" | "ui";
type WorkflowRecordStatus = "draft" | "published" | "archived";
```

#### Acceptance

The UI can derive actions from source/status, including duplicate, edit draft, publish, archive, delete, run, and inspect versions.

### Requirement: UI drafts live in the Workflow Registry/store

UI drafts MUST be stored with workflow registry data because they semantically belong to workflows.

#### Acceptance

Workflow catalog APIs return code workflows, UI drafts, and UI-published workflows with source/status metadata.

### Requirement: Drafts may be incomplete or invalid

The system MUST allow UI drafts to store incomplete or invalid Workflow IR. Invalid raw IR text MUST NOT overwrite the saved draft object.

#### Acceptance

- Drafts can be saved with validation errors.
- Raw IR parse errors show a warning.
- The last valid draft object remains intact after invalid raw IR edits.

### Requirement: One draft per workflow/copy

A workflow or copied workflow MUST have at most one active draft.

#### Acceptance

Users may create many workflow copies, but each copy has only one draft editing track.

### Requirement: Workflow selection happens during Project session creation

When a user creates a new session in a Project, Chat Web MUST show a session creation view that lets the user set a session name, select a workflow version, and configure workflow options before creation.

#### Acceptance

- The session creation view appears in the main session content area.
- The user can select a workflow version.
- The user can set allowed session-scoped values.
- Creating the Project session does not start the workflow automatically.

### Requirement: Workflow start is explicit

Creating a workflow Project session MUST NOT start the workflow. The user MUST explicitly start the workflow run after session creation.

#### Acceptance

A newly created workflow Project session can exist in a configured/not-started state. Starting the run creates the single workflow run for that Project session.

### Requirement: Session workflow selection is immutable

After a Project session is created, the selected workflow MUST NOT be changed for that session.

#### Acceptance

The UI does not expose a workflow switcher for existing Project sessions. API attempts to change the workflow for an existing session fail or require creating a new Project session.

### Requirement: One workflow run per Project session

A Project session MUST have at most one workflow run. Workflow nodes may execute in parallel when the workflow definition allows it.

#### Acceptance

The Project session run view shows one primary workflow run. Nested workflow runs are linked under that run/session hierarchy.

### Requirement: Workflows are selected per session, not per project

A Project MAY contain sessions using different workflows. A Project MUST NOT require one active default workflow in V2.

#### Acceptance

The Project session list can include multiple workflow IDs and versions.

### Requirement: Session-scoped configuration is snapshotted

Every configured workflow Project session MUST create an immutable configuration/effective-definition snapshot before run start.

Allowed session-scoped configuration:

- workflow input values;
- prompt overrides;
- model selection;
- thinking level;
- fast mode.

Disallowed in V2:

- agent profile overrides;
- retry limit overrides;
- arbitrary option overrides unless later specified.

V2 prompt overrides apply only to explicitly opted-in Pibo Agent nodes with direct `promptTemplate` values. Model selection, thinking level, and fast mode apply workflow-session-wide to Pibo Agent node sessions. Configured-session values are immutable after creation and before start.

#### Acceptance

The run remains inspectable even if the workflow definition changes or is deleted. The snapshot records the exact V2 snapshot contract from `prds/09-implementation-completeness-contract.md` Section 4.4: identity fields, owner scope, base and effective definitions, hashes, input, allowed overrides, scope rules, prompt asset pins, validation result, and deleted-definition fallback display fields.

### Requirement: Project Sessions sidebar shows only real Pibo Sessions

The Project Sessions sidebar MUST show only real Pibo Sessions and their parent/child nesting.

Shown in sidebar:

- main workflow Project sessions;
- nested workflow sessions;
- agent node sessions;
- subagent sessions.

Not shown directly in sidebar:

- code nodes;
- human nodes;
- adapter nodes;
- edges;
- guards;
- state entries.

#### Acceptance

Non-session workflow elements are reachable from the Workflow/XState view, not as sidebar sessions.

### Requirement: Sidebar distinguishes workflow, node, and subagent sessions visually

The Project Sessions sidebar MUST use icons or equivalent visual markers to distinguish session types.

#### Acceptance

Users can distinguish:

- main workflow session;
- nested workflow session;
- agent node session;
- subagent session.

### Requirement: Selected context chooses the view

The selected Project session context MUST determine the main view.

#### Acceptance

- Workflow sessions show Workflow/XState + run view.
- Nested workflow sessions show Workflow/XState + run view.
- Agent node sessions show Terminal view.
- Subagent sessions show Terminal view.
- Code/human/adapter nodes are inspected from the workflow view.

### Requirement: Workflow runs link back to definitions

Workflow runs in Projects MUST link back to their workflow definition in the Workflows tab when the definition still exists.

#### Acceptance

If the definition was deleted or is missing, the run shows snapshot information, a clear “definition deleted” state, and no broken live-definition link. If the definition still exists but is archived, the run may link to it and must show archived state.

### Requirement: UI composes existing capabilities only

The UI MUST allow users to compose workflows from existing registered elements. It MUST NOT create new executable TypeScript handlers, adapters, guards, or arbitrary inline code.

#### Acceptance

- Code nodes can reference only registered handlers.
- Adapter nodes and edge adapters can reference only registered adapters.
- Guards can reference only registered guards.
- Agent nodes can use available non-archived Agent Designer profiles.
- Nested workflow nodes can reference available workflow definitions.

### Requirement: Missing references are visible

If a referenced handler, adapter, guard, profile, or nested workflow disappears, the workflow MUST show clear error indicators and runtime errors must be explicit.

#### Acceptance

The Workflow Library, Builder, validation panel, and runtime failure state identify missing refs by id and location.

### Requirement: Duplicate workflow to draft

Users MUST be able to duplicate an existing workflow, including code-registered workflows, into a UI-editable draft.

#### Acceptance

The duplicated draft receives a new workflow identity or copy identity and can be edited without changing the source workflow.

### Requirement: Code workflows are read-only except duplicate

Code-registered workflows MUST NOT be edited directly in UI.

#### Acceptance

The UI offers duplicate/create-copy, run, inspect, and version actions where applicable, but not direct edit on the code-owned record.

### Requirement: Workflow drafts use Pibo Workflow IR

UI drafts MUST store editable Pibo Workflow IR, not raw XState JSON and not a separate YAML/JSON workflow language.

#### Acceptance

The draft definition can be validated by the same workflow validator used for runtime workflows after draft-only incomplete fields are resolved.

### Requirement: Draft and publish lifecycle

The system MUST support draft save, validation, publish, immutable published versions, archive, and delete.

#### Acceptance

- Drafts may be saved before they are runnable.
- Drafts show validation diagnostics.
- A valid draft can be published as a workflow version.
- Published versions are immutable.
- Editing a published workflow creates a new draft/version.
- Users can archive and delete workflows according to product rules.

### Requirement: Versioning supports automatic patch and user-triggered major/minor

Publishing MUST support automatic patch increments and user-triggered minor/major version increments.

#### Acceptance

If the user does not choose a major/minor bump, publish increments the patch version. The user can explicitly choose a minor or major bump.

### Requirement: Archive applies to whole workflow

Archiving MUST apply to the whole workflow, not one version.

#### Acceptance

An archived workflow is hidden from default start/selection lists but remains visible where historical runs or explicit archive filters require it.

### Requirement: Delete is allowed even with historical runs

Authenticated users MUST be able to delete workflows even if historical runs exist.

#### Acceptance

Historical runs remain inspectable through stored snapshots and show that the live definition was deleted.

### Requirement: All authenticated users can archive/delete workflows

Any authenticated user MAY archive or delete workflows in V2.

#### Acceptance

Archive/delete endpoints require authentication but no additional role in V2.

### Requirement: Visual editor edits all planned V2 fields

The Workflow Builder MUST support editing:

- title and description;
- workflow input and output schemas;
- nodes;
- edges;
- agent profiles;
- prompt templates;
- prompt assets;
- adapters;
- guards;
- simple state reads/writes;
- human approval prompts, schemas, actions, and timeouts;
- UI layout metadata.

#### Acceptance

The user can create a workflow with at least one node, connect nodes with edges, validate the workflow, and publish it.

### Requirement: Smallest valid workflow has one node, input, and output

A valid published workflow MUST have at least one node plus workflow input and output contracts.

#### Acceptance

Drafts with no nodes can be saved but cannot be published or run.

### Requirement: Raw IR is visible and editable

The Workflow Builder MUST provide a toggle to view and edit raw Workflow IR.

#### Acceptance

Raw IR edits update the draft after parsing and validation. Invalid edits show diagnostics without corrupting the last valid draft object.

### Requirement: JSON Schema editing is raw JSON only

V2 MUST edit JSON schemas through raw JSON editors only.

#### Acceptance

No form-builder schema editor is required for V2. The raw editor validates against the existing Pibo JSON Schema subset.

### Requirement: Schema changes may invalidate connected graphs

The UI MUST allow users to change workflow/node input and output schemas even if nodes are already connected.

#### Acceptance

The draft can become invalid. Publish and run remain blocked until diagnostics are resolved.

### Requirement: Adapter selection dialog shows compatible adapters

When an edge needs an adapter, the UI MUST show compatible adapters prominently, allow schema/description details, and offer two actions: use as edge adapter or insert adapter node.

#### Acceptance

The UI does not create new adapters. It only selects registered adapters.

### Requirement: Guards and adapters support params only with metadata

The UI MUST allow selecting guards and adapters. It MAY show parameter fields only when Registry metadata includes `paramsSchema`.

#### Acceptance

Adapters/guards without `paramsSchema` are selectable without parameters. Adapters/guards with `paramsSchema` render raw JSON or generated input for parameters and validate it.

### Requirement: State mappings support simple visual editing

The UI MUST support simple state reads/writes through dropdowns. Complex mappings remain editable only through raw IR.

#### Acceptance

Users can pick declared global/local/edge state paths for simple node read/write policies.

### Requirement: Nested workflow nodes open separately

In a parent workflow, a nested workflow node MUST be edited as a node with workflow/version selection. The UI MUST provide an “Open workflow” action that navigates to the nested workflow's own builder/viewer.

#### Acceptance

V2 does not expand nested workflow internals inline inside the parent graph.

### Requirement: Graph layout supports manual and automatic modes

The UI MUST use `@xyflow/react` for canvas interactions and support drag-and-drop layout plus automatic layout for workflows without saved positions.

#### Acceptance

- Users can move nodes and save positions.
- TypeScript/code-registered workflows without positions receive an automatic layout.
- Saved positions use `workflow.ui.layout` and `workflow.ui.positions` from the existing Workflow IR UI metadata contract.
- Layout metadata does not affect execution, validation, or publish gating except for metadata shape checks.

### Requirement: Workflow Library lists all available workflows

The Workflow Library MUST show registered code workflows and UI-authored workflows unless access rules hide them.

#### Acceptance

Each listed workflow shows id, title, version, description, tags, source, status, editability, and available actions.

### Requirement: Run history and human actions are visible in Projects

Project workflow sessions MUST show run history, current run state, validation errors, final output where permitted, and available human actions.

#### Acceptance

Users can inspect the session's workflow run and submit approve/reject/resume/cancel actions for persisted wait tokens.

### Requirement: Prompt assets are editable

Prompt assets referenced by workflows MUST be editable in V2 using the existing Markdown editor pattern used by Context Files.

#### Acceptance

Users can open and edit prompt assets from the Workflow Builder where permissions and source allow it. Prompt asset edits create revisions, update draft references to the new revision/hash, and do not mutate code/plugin prompt assets or already published workflow versions in place.

### Requirement: V2 uses existing JSON Schema subset

V2 MUST continue using the existing workflow JSON Schema subset for input/output schemas, human resume schemas, and state field schemas. V2 MUST NOT introduce Zod.

#### Acceptance

Schema editing and validation use the existing workflow validation logic and diagnostics.

### Requirement: XState remains visual only

V2 MAY use XState projection for graph rendering and run visualization. V2 MUST NOT treat XState as the canonical workflow definition.

#### Acceptance

UI editing writes Pibo workflow nodes, edges, ports, adapters, guards, state, and UI metadata. It does not write raw XState machine semantics as the source of truth.

## Edge Cases

- User creates a draft with no nodes.
- User deletes the initial node.
- User connects incompatible ports without an adapter.
- User selects a handler, adapter, guard, profile, or nested workflow that later disappears.
- User edits raw IR into invalid JSON or invalid workflow structure.
- User duplicates a code workflow with no UI layout metadata.
- User tries to change workflow after session creation.
- User edits a published workflow.
- User starts a run with invalid input.
- User submits an invalid human resume payload.
- User deletes a workflow with historical runs.
- User opens a Project run whose workflow definition was deleted.
- Nested workflows create deeper sidebar session trees.
- Agent node sessions create subagent sessions under them.

## Constraints

- **Compatibility:** V1 workflow runtime, registry, persistence, and read-only inspection behavior must keep working.
- **Security:** The UI must not allow inline TypeScript or arbitrary code execution.
- **Persistence:** Runtime executes only valid published workflows or valid session snapshots.
- **Schema:** V2 keeps the existing JSON Schema subset. No Zod migration.
- **Scope:** Workflows in V2 are Project-session features, not normal Sessions tab or slash-command features.
- **Navigation:** Projects sidebar represents real Pibo Sessions only. Workflow logical nodes live inside Workflow/XState views.

## Success Criteria

- [ ] SC-001: A user can create a Project session and choose a workflow version before session creation.
- [ ] SC-002: The created Project session does not start the workflow until the user explicitly starts it.
- [ ] SC-003: A user cannot change the workflow for that session after creation.
- [ ] SC-004: A configured session creates a snapshot of workflow version, hash, input, prompt overrides, model, thinking level, and fast mode.
- [ ] SC-005: A Project session has one workflow run, with nested workflow runs and child sessions shown under it.
- [ ] SC-006: The Project Sessions sidebar shows only real Pibo Sessions and visually distinguishes workflow, nested workflow, agent node, and subagent sessions.
- [ ] SC-007: Workflow sessions open Workflow/XState + run view; agent and subagent sessions open Terminal view.
- [ ] SC-008: A user can duplicate an existing workflow into a UI draft.
- [ ] SC-009: A user can edit nodes, edges, prompts, prompt assets, schemas, adapters, guards, state reads/writes, agent profiles, and human approvals in the builder.
- [ ] SC-010: A user can view and edit raw Workflow IR through a toggle.
- [ ] SC-011: The editor validates drafts and shows structured diagnostics.
- [ ] SC-012: A valid draft can be published as an immutable version.
- [ ] SC-013: Version publishing supports automatic patch and user-triggered minor/major bumps.
- [ ] SC-014: Workflows can be archived or deleted by authenticated users.
- [ ] SC-015: Historical runs remain inspectable after workflow deletion.
- [ ] SC-016: No V2 path allows inline TypeScript, workflow slash commands, templates, TypeScript export, YAML/JSON import/export, or Zod.

## Assumptions and Resolved Decisions

### Assumptions

- Existing Pibo Workflow IR is sufficient as the shared editable/runtime format.
- UI drafts need a wrapper around `WorkflowDefinition` for draft status, source, diagnostics, and version metadata.
- Code-registered workflows can be serialized into editable IR for duplication.
- Existing JSON Schema subset remains the schema contract.
- `@xyflow/react` is the selected graph/canvas library for the Workflow Builder.
- Existing Markdown editor patterns can be reused for revisioned prompt asset editing.
- Session model, thinking level, and fast mode overrides are workflow-session-wide in V2.
- Session prompt overrides target only explicitly opted-in Pibo Agent nodes with direct `promptTemplate` values.
- Configured-session values are immutable after creation and before start.

### Resolved Decisions

- Workflow Registry/store schema and V2 permission decisions are documented in `prds/02-workflow-registry-catalog-and-draft-store.md`.
- Workflow Builder graph/canvas and prompt asset persistence decisions are documented in `prds/04-workflow-builder-and-ir-editing.md`.
- Prompt override eligibility, workflow-scoped model/thinking/fast-mode settings, and pre-start configured-session immutability are documented in `prds/03-project-session-selection-and-snapshots.md`.
- Exact configuration/effective-definition snapshot fields, deleted-workflow display/link behavior, and exact API routes are documented in `prds/09-implementation-completeness-contract.md` Sections 4.3, 4.4, and 4.8.

## Traceability

| Requirement | Source Decision | Status |
|---|---|---|
| Session-level workflow choice | User answer B1-B3 | Draft |
| Delayed workflow start | User answer 7.1 | Draft |
| One run per Project session | User answer 7.3 | Draft |
| Projects-only workflow usage | User answer B4 | Draft |
| Main-nav Workflows tab | User answer 4.1 | Draft |
| Builder in Workflows tab | User answer 4.2 | Draft |
| Run history in Projects | User answer 4.2, 7.4 | Draft |
| Duplicate instead of templates | User answer C2-C3, G2 | Draft |
| No TypeScript export | User answer C4 | Draft |
| Full visual editing | User answer D1-D2 | Draft |
| Raw IR toggle | User answer D4, 4.4 | Draft |
| Drafts in Workflow Registry | User answer 1.1 | Draft |
| Source/status fields | User answer 1.4 | Draft |
| Missing ref errors | User answer 1.5 | Draft |
| Draft/publish/version/archive/delete | User answer E1-E4, 2.1-2.4 | Draft |
| Existing registered capabilities only | User answer F1-F2 | Draft |
| Private/custom profiles allowed, archived excluded | User answer 6.1 | Draft |
| Global workflows visible to users | User answer 6.2-6.3 | Draft |
| Authenticated users archive/delete | User answer 6.4 | Draft |
| Session scoped prompts/input/model/thinking/fast mode | User answer 3.1 | Draft |
| Sidebar real sessions only | Follow-up sidebar decision | Draft |
| Views by selected session context | Follow-up sidebar decision | Draft |
| No Zod | Later user decision | Draft |
| Raw JSON schema editing | User answer 5.3 | Draft |
| Compatible adapter dialog | User answer 5.5 | Draft |
| State reads/writes dropdowns | User answer 8.2 | Draft |
| Guards/adapters paramsSchema | User answer 8.3-8.4 | Draft |
| Nested workflow opens separately | User answer 8.5 | Draft |
