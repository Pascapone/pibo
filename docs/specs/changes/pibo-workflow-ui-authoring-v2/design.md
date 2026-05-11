# Design: Pibo Workflow UI Authoring V2

**Status:** Draft v0.2
**Created:** 2026-05-11
**Updated:** 2026-05-11
**Related spec:** `spec.md`

## Design Summary

V2 adds a human-facing Workflow UI on top of V1's workflow framework. The UI edits Pibo Workflow IR and composes registered building blocks. It does not generate TypeScript, run inline code, or use raw XState as source of truth.

```text
TypeScript Framework ─┐
                      ├─> Pibo Workflow IR ─> Validator ─> Runtime Kernel
Workflow UI Drafts ───┘                         │
                                                └─> XState Projection ─> UI Graph
```

Projects remain the execution context. The Workflows main-nav tab owns definition browsing and editing.

## Product Surfaces

### Workflows Main-Nav Tab

The Workflows tab owns workflow definitions.

Contains:

- Workflow Library;
- Workflow Builder;
- draft/version management;
- raw IR editor toggle;
- validation panel;
- prompt asset editor;
- workflow archive/delete actions.

### Projects Execution Surface

Projects own workflow sessions and runs.

Contains:

- Project session creation view;
- configured/not-started workflow session state;
- explicit start action;
- Workflow/XState + run view;
- run history for the session;
- human action controls;
- links back to workflow definitions in the Workflows tab.

## Project Session Creation Flow

A new Project session starts as a configured workflow session, not as an immediate run.

```text
Create Project Session
  -> enter session name
  -> choose workflow id/version
  -> enter input values
  -> override prompts where allowed
  -> choose model/thinking/fast mode
  -> create configured session
  -> user explicitly starts workflow
  -> workflow run is created
```

Allowed session-scoped configuration:

```ts
type WorkflowSessionOverrides = {
  input: WorkflowValue;
  promptOverrides?: Record<NodeId, PromptTemplate>;
  model?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
};
```

Not allowed in V2:

```ts
type DisallowedV2Overrides = {
  agentProfileOverrides?: never;
  retryLimitOverrides?: never;
  arbitraryOptions?: never;
};
```

Every configured session creates a snapshot.

```ts
type WorkflowSessionConfigurationSnapshot = {
  id: string;
  projectId: string;
  piboSessionId: string;
  workflowId: string;
  workflowVersion: string;
  baseDefinitionHash: string;
  effectiveDefinitionHash: string;
  input: WorkflowValue;
  promptOverrides?: Record<NodeId, PromptTemplate>;
  model?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
  createdAt: string;
};
```

The runtime executes the effective snapshot. This keeps sessions inspectable after workflow edits or deletion.

## Project Sessions Sidebar Model

Projects do not use Room semantics in the Workflow UI. The Project is the top product container.

The sidebar shows real Pibo Sessions only.

```text
Project
└── Main Workflow Session            // real Pibo Session, Workflow view
    ├── Agent Node Session           // real Pibo Session, Terminal view
    │   ├── Subagent Session         // real Pibo Session, Terminal view
    │   └── Subagent Session         // real Pibo Session, Terminal view
    └── Nested Workflow Session      // real Pibo Session, Workflow view
        └── Agent Node Session       // real Pibo Session, Terminal view
```

Not shown directly in sidebar:

```text
Code Node
Human Node
Adapter Node
Edge
Guard
State
```

Those are visible inside the Workflow/XState view.

### Sidebar Visual Types

Use icons or equivalent visual hints for:

```text
main workflow session
nested workflow session
agent node session
subagent session
```

The UI must make agent node sessions and subagent sessions visually distinct because workflows can also nest workflows.

### View Selection Rules

```ts
function viewForProjectSession(session: ProjectSession): "workflow" | "terminal" {
  if (session.kind === "workflow-main") return "workflow";
  if (session.kind === "workflow-nested") return "workflow";
  if (session.kind === "agent-node") return "terminal";
  if (session.kind === "subagent") return "terminal";
  return "terminal";
}
```

Workflow views show:

- Workflow/XState graph;
- run status;
- node list;
- current node;
- nested workflow links;
- code/human/adapter node inspection;
- human actions.

Terminal views show the normal session transcript and tools for agent node and subagent sessions.

## Workflow Library

The library lists global workflows.

Shows:

- id;
- title;
- description;
- versions;
- source: `code` or `ui`;
- status: `draft`, `published`, or `archived`;
- tags and examples where present;
- input/output summary;
- latest validation state;
- missing-reference state;
- actions: run/create Project session, duplicate, edit draft, create new version, archive, delete, inspect versions.

## Workflow Record Model

V2 uses separate source and status fields.

```ts
type WorkflowRecordSource = "code" | "ui";
type WorkflowRecordStatus = "draft" | "published" | "archived";

type WorkflowRecord = {
  id: string;
  workflowId: string;
  version?: string;
  source: WorkflowRecordSource;
  status: WorkflowRecordStatus;
  definition?: WorkflowDefinition;
  draft?: WorkflowDraft;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

Derived behavior:

```ts
function canEdit(record: WorkflowRecord): boolean {
  return record.source === "ui" && record.status === "draft";
}

function canRun(record: WorkflowRecord): boolean {
  return record.status === "published";
}

function canDuplicate(record: WorkflowRecord): boolean {
  return record.status === "published";
}
```

## Workflow Registry Store

UI drafts and UI-published workflows live in the Workflow Registry/store.

Rationale:

```text
They are semantically workflows.
The catalog must show code and UI workflows together.
The runtime should resolve published UI workflows through the same registry path.
```

### Workflow Draft Wrapper

```ts
type WorkflowDraft = {
  id: string;
  source: "ui";
  status: "draft";
  workflowId: string;
  baseWorkflowId?: string;
  baseWorkflowVersion?: string;
  baseDefinitionHash?: string;
  definition: PartialWorkflowDefinition;
  diagnostics: WorkflowDiagnostic[];
  createdAt: string;
  updatedAt: string;
};
```

Drafts may be invalid. A draft can have zero nodes while editing, but publish requires one node, input, and output.

Invalid raw IR text is not saved into `definition`. The UI shows a warning and preserves the last valid draft object.

### Published UI Workflow

```ts
type PublishedUiWorkflow = {
  id: string;
  source: "ui";
  status: "published" | "archived";
  workflowId: string;
  version: string;
  definition: WorkflowDefinition;
  definitionHash: string;
  createdAt: string;
  publishedAt: string;
  archivedAt?: string;
};
```

Published versions are immutable. Editing creates a draft for the next version.

## Versioning

Versioning supports automatic and manual behavior.

```text
major.minor.patch
```

Rules:

- Patch increments automatically on publish by default.
- User may choose a minor or major bump.
- Published versions are immutable.
- One active draft exists per workflow/copy.
- Users can duplicate workflows to create separate copies.
- Archiving applies to the whole workflow.
- Deletion is allowed even if historical runs exist.

Historical runs remain inspectable through session/run snapshots.

## Workflow Builder

The builder edits workflow drafts.

Main panels:

- graph canvas;
- node inspector;
- edge inspector;
- workflow settings;
- raw JSON schema editor;
- prompt editor;
- prompt asset Markdown editor;
- state read/write selector;
- validation panel;
- raw IR editor toggle;
- publish/version panel.

## Editing Model

### Nodes

The UI can add these node kinds:

```ts
type EditableNodeKind = "agent" | "code" | "workflow" | "adapter" | "human";
```

Rules:

- `agent`: choose a non-archived Agent Designer profile and edit prompt template.
- `code`: choose a registered handler only.
- `workflow`: choose a workflow id/version.
- `adapter`: choose a registered adapter only.
- `human`: edit prompt, raw JSON schema, actions, and timeout.

Private and custom profiles are allowed. Archived profiles are not selectable.

### Nested Workflow Nodes

Nested workflow nodes are references in the parent graph.

```ts
type NestedWorkflowNodeEditor = {
  workflowId: string;
  workflowVersion: string;
  openWorkflow(): void;
};
```

V2 does not expand nested internals inline. “Open workflow” navigates to the child workflow's own builder/viewer.

### Edges

The UI creates typed edges between node ports.

```ts
type EditableEdge = {
  from: NodePortRef;
  to: NodePortRef;
  kind?: "data" | "control" | "error" | "resume";
  guard?: GuardRef;
  adapter?: EdgeAdapterDefinition;
};
```

Schema/port changes are allowed even if they break existing edges. The draft becomes invalid until fixed.

### Adapter Selection

When ports are incompatible, show compatible adapters prominently.

Dialog content:

```text
From port schema
To port schema
Compatible adapters
Adapter description/details
```

Actions:

```text
Use as edge adapter
Insert adapter node
```

The UI never creates new adapters.

### Guard Selection

Guards are selectable from the Registry.

If Registry metadata includes `paramsSchema`, the UI may show parameter input and validate params.

```ts
type GuardRegistryMetadata = {
  id: string;
  description?: string;
  paramsSchema?: JsonSchema;
};
```

### Adapter Parameters

Adapters are selectable from the Registry.

If Registry metadata includes `paramsSchema`, the UI may show parameter input and validate params.

```ts
type AdapterRegistryMetadata = {
  id: string;
  input: WorkflowPort;
  output: WorkflowPort;
  description?: string;
  paramsSchema?: JsonSchema;
};
```

### State Mappings

Simple state reads/writes are visually editable.

```ts
type SimpleStateAccessEditor = {
  reads: ScopedStatePath[];
  writes: ScopedStatePath[];
};
```

Complex state mappings remain raw IR only.

### Schemas

V2 uses raw JSON editing for schemas.

No form builder is required.

The UI validates schemas with the existing JSON Schema subset validator.

### Prompt Assets

Prompt assets are editable in V2. Reuse the existing Markdown editor pattern from Context Files.

### Raw IR Editor

The raw editor works on Workflow IR.

Rules:

- It is accessed through a toggle on the workflow definition.
- Parse errors do not overwrite the last valid draft object.
- Valid raw edits update the visual editor.
- Invalid workflow edits update diagnostics.
- Raw XState editing is not supported.

## Validation Model

The editor runs validation at these points:

- draft load;
- node edit;
- edge edit;
- schema edit;
- prompt edit;
- raw IR edit;
- before publish;
- before session creation;
- before workflow start.

Validation uses existing functions from `packages/workflows/src/validation` where possible.

Missing refs produce diagnostics and visible UI indicators.

```ts
type MissingRefDiagnostic = WorkflowDiagnostic & {
  code:
    | "WorkflowRegistryError.handlerMissing"
    | "WorkflowRegistryError.adapterMissing"
    | "WorkflowRegistryError.guardMissing"
    | "WorkflowRegistryError.profileMissing"
    | "WorkflowRegistryError.workflowMissing";
};
```

## Registry Integration

The UI needs read APIs for:

- workflow definitions and versions;
- workflow drafts;
- handlers;
- adapters;
- guards;
- human actions;
- Agent Designer profiles;
- prompt assets;
- schema refs if introduced later.

The UI needs write APIs for:

- creating drafts;
- saving drafts;
- duplicating workflows;
- validating drafts;
- publishing drafts;
- archiving workflows;
- deleting workflows;
- creating configured Project sessions;
- starting workflow runs for configured Project sessions.

## XState Integration

V2 uses XState projection for display.

```text
WorkflowDefinition IR -> projectToXState() -> visual graph/run state
```

Rules:

- XState is not canonical.
- Editing writes Pibo IR fields.
- Runtime state comes from workflow kernel records and run store.
- XState snapshots may help rendering but do not replace persisted workflow facts.

## Run and Session Persistence

A Project session owns one workflow run.

```ts
type ProjectWorkflowSession = {
  projectId: string;
  piboSessionId: string;
  workflowId: string;
  workflowVersion: string;
  workflowRunId?: string;
  state: "configured" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  configurationSnapshotId: string;
};
```

Nested workflow runs create nested workflow sessions when they need session-level navigation.

Agent nodes create agent node sessions. Subagents create child subagent sessions under the agent node session.

## Security and Capability Boundaries

The UI cannot create executable logic.

Allowed:

```text
choose registered handler
choose registered adapter
choose registered guard
choose registered workflow
choose non-archived Agent profile
edit prompt text
edit prompt assets
edit JSON schemas
edit graph structure
edit simple state reads/writes
```

Forbidden:

```text
inline TypeScript
JavaScript eval
arbitrary shell/code nodes
hidden LLM coercion
raw XState source editing
Zod schema layer
```

## Open Design Questions

1. What exact database tables/records should the Workflow Registry store use for UI drafts and UI-published workflows?
2. What exact snapshot fields are required to keep deleted-workflow runs inspectable?
3. How should workflow deletion interact with links from old Project sessions?
4. Which graph library should power the visual editor?
5. How should model, thinking level, and fast mode apply to multi-agent workflows: globally, per Agent node, or both?
6. Should prompt asset edits create versions or mutate current prompt assets?
