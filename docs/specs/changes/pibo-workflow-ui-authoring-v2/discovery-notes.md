# Discovery Notes: Pibo Workflow UI Authoring V2

**Status:** Working notes v0.2
**Created:** 2026-05-11
**Updated:** 2026-05-11

This file records user decisions from V2 clarification rounds so they are not lost.

## Round 1: Product Scope

### Target Users

- Normal Pibo users use the UI feature.
- Agents use CLI and programmatic paths, not the UI.
- Operators/agents are not the primary UI audience.

### User Understanding

- Normal users should understand workflows visually.
- Users may edit prompts.
- JSON Schema knowledge is assumed for deeper schema editing.
- New workflow capabilities are created only through TypeScript code.
- The UI composes and configures existing elements.

### Builder vs Launcher

V2 needs two product surfaces:

1. **Workflow Builder** for configuration, composition, editing, and publishing.
2. **Run/Launcher/Debug surface** for selecting workflows, creating Project sessions, starting runs, and inspecting run history.

There are no templates in V2, but the launcher pattern still applies.

### Workflow Selection

- Workflow selection happens when creating a session in a Project.
- The main session area should switch to a session creation view.
- The creation view should let the user set session name, workflow, and options.
- Session-scoped workflow changes may be made before creation.
- Session-scoped changes do not persist back to the workflow definition.
- Workflow selection is fixed after session creation.
- Workflows are selected per session, not per project.
- Sessions cannot be relinked to another workflow later.
- V2 does not support workflow slash commands.
- V2 does not use workflows in the normal Sessions tab.

### Workflow Creation

- Users cannot create a completely empty runnable workflow.
- A workflow needs at least one node.
- V2 has no templates.
- Users can duplicate existing workflows.
- Code-registered workflows can be duplicated into UI drafts.
- UI-created workflows cannot be exported to TypeScript.

### Visual Editing

V2 should support editing:

- title and description;
- nodes;
- edges;
- agent profiles;
- prompt templates;
- input/output schemas;
- adapters;
- guards;
- human approvals.

V2 should also support:

- drag-and-drop layout;
- automatic layout for workflows without saved positions;
- raw Workflow IR viewing and editing.

### Draft, Publish, and Versioning

- V2 needs a draft/publish lifecycle.
- Drafts can be saved and validated.
- Published workflows are versioned.
- Editing a published workflow creates a new version.
- Archive and delete should exist.
- Workflow versions should be visible and selectable.

### Security and Capability Boundaries

- UI workflows can only use existing registered handlers, adapters, and guards.
- UI must not allow inline TypeScript.
- True new functionality comes from TypeScript and real code.
- Any Agent Designer profile can be selected.
- No workflows are internal-only by default; all should be visible/available.

### V2 Required Scope

V2 includes:

- workflow selection and start;
- workflow creation by duplication/composition;
- workflow editing;
- workflow connection/composition;
- run history;
- human actions;
- validation panel.

V2 excludes:

- templates;
- export;
- slash commands;
- workflow tools for agents.

### Later Clarifications

- No Zod migration. Keep the current JSON Schema subset and custom validator.
- No additional YAML/JSON authoring layer is required for V2.
- Use Pibo Workflow IR as the shared editable/runtime format.
- XState remains visual/projection-only, not workflow logic or source of truth.

## Round 2: Data Model, UI, Sessions, and Editor Details

### Data Model

- UI drafts should live in the Workflow Registry/store because they semantically belong to workflows.
- Drafts may save invalid or half-finished IR.
- Invalid raw IR text should not be saved. The UI should show a warning and preserve the last valid draft object.
- Workflow records should distinguish source and status with separate fields:

```ts
type WorkflowRecord = {
  source: "code" | "ui";
  status: "draft" | "published" | "archived";
};
```

- If a registered handler, adapter, guard, profile, or workflow disappears, the workflow should show clear error indicators, and runtime should fail with explicit messages.

### Versioning

- Versioning should be automatic and manual.
- Patch version increments automatically.
- Minor and major version bumps are triggered by the user.
- Workflows can be deleted even if historical runs exist.
- Historical runs must remain inspectable through snapshots.
- Archiving applies only to the whole workflow, not individual versions.
- Only one active draft may exist per workflow/copy.
- Users can still create many copies of a workflow.

### Session Configuration

Allowed session-scoped settings:

- prompt overrides;
- input values;
- model selection, e.g. GPT-5.5 or Kimi K2.6;
- thinking level;
- fast mode.

Not allowed in V2:

- agent profile overrides;
- retry limit overrides;
- arbitrary options unless later specified.

Other decisions:

- Every session configuration creates its own snapshot.
- In V2, a configured session is saved without immediately starting the workflow.
- A workflow run starts only when explicitly executed.

### UI Structure

- Workflows get a main navigation tab, like Sessions, Projects, or Settings.
- The Builder lives in the Workflows tab.
- Run history belongs to Project sessions under Projects.
- Workflow execution and inspection happen in Projects.
- Runs link back to their workflow definition in the Workflows tab if the definition still exists.
- Raw IR appears behind a toggle on the workflow definition, not as the default view.

### Editor Capabilities

- Code-registered workflows are not edited directly.
- Code workflows can be duplicated and then edited as UI drafts.
- The smallest valid workflow has one node plus input and output contracts.
- JSON Schemas are edited as raw JSON only.
- Workflow/node input/output schemas may be changed even if nodes are connected.
- Breaking schema changes make the workflow invalid until fixed.

### Adapter Dialog

The adapter dialog should:

- show compatible adapters prominently;
- allow details for schema and description;
- offer two actions: use as edge adapter, or insert adapter node;
- not create new adapters in UI.

### Rights and Visibility

- Private and custom Agent Profiles are selectable.
- Archived Agent Profiles are not selectable.
- Workflows are global, not user-scoped or project-scoped.
- Other users can see UI-authored workflows.
- Any authenticated user can archive/delete workflows in V2.

### Execution and Runs

- Creating a Project session does not start the workflow.
- A workflow run must be explicitly started.
- Each Project session has one workflow run.
- Workflow nodes may run in parallel if the workflow definition allows it.
- Workflow runs belong to Project sessions.
- Nested workflows also belong under the Project session hierarchy.

### V2 Boundaries

- Prompt assets are editable in V2.
- Use the existing Markdown editor pattern from Context Files for prompt assets.
- State mappings are visually editable only for simple reads/writes dropdowns.
- Complex state mappings are raw IR only.
- Guards are selectable.
- Guard parameters are editable only if Registry metadata provides `paramsSchema`.
- Adapters are selectable.
- Adapter parameters are editable only if Registry metadata provides `paramsSchema`.
- Nested workflow nodes are normal parent-graph nodes with workflow/version selection.
- “Open workflow” navigates to the nested workflow's own builder/viewer.
- V2 does not inline-expand nested workflow internals in the parent graph.

## Round 3: Project Sessions Sidebar and Views

### Project Is the Top Container

Projects do not use Room semantics in this UI. A Project is the top product container for Project sessions.

### Sidebar Shows Real Pibo Sessions Only

The Project Sessions sidebar should contain real Pibo Sessions:

```text
Project
└── Main Workflow Session
    ├── Agent Node Session
    │   ├── Subagent Session
    │   └── Subagent Session
    └── Nested Workflow Session
        └── Agent Node Session
```

The sidebar should not show logical workflow elements that are not Pibo Sessions:

```text
Code Node
Human Node
Adapter Node
Edge
Guard
State
```

These appear in the Workflow/XState view.

### Visual Distinction

Sidebar entries need icons or equivalent visual hints to distinguish:

- main workflow sessions;
- nested workflow sessions;
- agent node sessions;
- subagent sessions.

This is important because workflows can nest workflows, and agent sessions can have subagent sessions.

### View Selection

The selected sidebar context determines the view:

- Workflow session -> Workflow/XState view and run view.
- Nested workflow session -> Workflow/XState view and run view.
- Agent node session -> Terminal view.
- Subagent session -> Terminal view.
- Code/human/adapter nodes -> reachable only inside Workflow/XState view.
