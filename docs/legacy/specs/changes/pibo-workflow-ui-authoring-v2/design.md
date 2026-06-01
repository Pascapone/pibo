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

Prompt overrides are eligible only for selected workflow nodes that resolve to Pibo Agent nodes with direct `promptTemplate` values and opt in through `metadata.sessionOverrides.prompt === true`. Model, thinking level, and fast mode are workflow-session-wide settings. Configured-session values are immutable after creation and before start.

Not allowed in V2:

```ts
type DisallowedV2Overrides = {
  agentProfileOverrides?: never;
  retryLimitOverrides?: never;
  arbitraryOptions?: never;
};
```

Every configured session creates a snapshot. The snapshot is the execution and historical-inspection record, not a pointer to mutable catalog state.

```ts
type WorkflowSessionConfigurationSnapshot = {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  createdBy: string;
  ownerScope: string;
  projectId: string;
  piboSessionId: string;
  workflow: {
    id: string;
    version: string;
    source: "code" | "ui";
    title?: string;
    description?: string;
    tags?: string[];
    baseDefinitionHash: string;
    effectiveDefinitionHash: string;
  };
  baseDefinition: WorkflowDefinition;
  effectiveDefinition: WorkflowDefinition;
  input: WorkflowValue;
  promptOverrides?: Record<NodeId, PromptTemplate>;
  overridePolicy: {
    promptEligibility: "metadata.sessionOverrides.prompt===true-and-direct-promptTemplate";
    eligiblePromptNodeIds: NodeId[];
    modelScope: "workflow";
    thinkingLevelScope: "workflow";
    fastModeScope: "workflow";
  };
  model?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
  promptAssetPins: Array<{ assetId: string; revisionId: string; contentHash: string; source: "code" | "ui" }>;
  validation: { diagnostics: WorkflowDiagnostic[]; validatedAt: string };
  deletedDefinitionFallback: { title?: string; workflowId: string; workflowVersion: string; effectiveDefinitionHash: string; tombstoneLabel?: string };
};
```

The runtime executes the effective snapshot. This keeps sessions inspectable after workflow edits or deletion. Model, thinking level, and fast mode stay workflow-scoped snapshot settings; they do not mutate node IR.

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

### Builder Canvas and Layout Metadata

Use `@xyflow/react` for the visual canvas. React Flow owns pan, zoom, selection, node dragging, and edge creation in the browser, but Pibo Workflow IR remains the source of truth.

Persist layout in the existing workflow UI metadata contract:

```ts
type WorkflowUiMetadata = {
  layout?: "auto" | "manual";
  positions?: Record<NodeId, { x: number; y: number }>;
  collapsed?: NodeId[];
  color?: string;
  icon?: string;
};
```

Rules:

- `workflow.ui.positions` is the canonical saved node position map for the builder.
- `node.ui.position` may seed imported or code-defined layouts, but the builder writes workflow-level positions on save.
- Workflows without complete saved positions receive deterministic auto layout from draft nodes and edges.
- Auto layout stays ephemeral until the user moves nodes or saves layout.
- Runtime execution, validation, and publish gating ignore layout metadata except for metadata shape checks.

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

Prompt assets are editable in V2 through the existing Markdown editor pattern from Context Files. Prompt asset saves create revisions; they do not mutate code/plugin prompt assets or published asset content in place.

Rules:

- Code/plugin prompt assets are read-only in the builder and can be copied into managed UI prompt assets.
- Each prompt asset save appends a new revision with a content hash and updates the draft reference.
- Published workflow versions and session snapshots pin prompt asset revision IDs and content hashes.
- Later prompt asset edits affect only drafts or future workflow versions that reference the new revision.

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

The UI uses exact same-origin Chat Web API routes under `/api/chat`. All routes require authentication; mutating routes require same-origin JSON.

Read routes:

- `GET /api/chat/workflows` lists catalog records, with optional `source`, `status`, and `includeArchived` filters.
- `GET /api/chat/workflows/:workflowId` inspects one workflow identity.
- `GET /api/chat/workflows/:workflowId/versions` lists immutable published versions.
- `GET /api/chat/workflows/:workflowId/versions/:version` inspects one immutable version.
- `GET /api/chat/workflows/drafts/:draftId` inspects one draft.
- `GET /api/chat/workflows/pickers/:kind` lists picker choices for `profiles`, `handlers`, `adapters`, `guards`, `human-actions`, `prompt-assets`, or `workflow-versions`.
- `GET /api/chat/projects/:projectId/workflow-sessions/:piboSessionId` inspects configured or run state for one workflow Project session.

Write routes:

- `POST /api/chat/workflows` creates a new UI workflow identity and active draft.
- `POST /api/chat/workflows/:workflowId/duplicate` duplicates a code or UI published version into a UI draft.
- `POST /api/chat/workflows/:workflowId/drafts` creates or reuses the one active next-version draft.
- `PATCH /api/chat/workflows/drafts/:draftId` saves parsed draft IR changes without allowing invalid raw text to overwrite the last valid object.
- `POST /api/chat/workflows/drafts/:draftId/validate` returns grouped diagnostics.
- `POST /api/chat/workflows/drafts/:draftId/publish` publishes a valid draft as an immutable version.
- `POST /api/chat/workflows/:workflowId/archive` archives a UI workflow identity.
- `DELETE /api/chat/workflows/:workflowId` tombstones a UI workflow identity while preserving snapshots.
- `POST /api/chat/projects/:projectId/workflow-sessions` creates a configured/not-started Project workflow session and snapshot.
- `POST /api/chat/projects/:projectId/workflow-sessions/:piboSessionId/start` revalidates the snapshot and starts the one allowed run, or returns the existing run with `alreadyStarted: true`.

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

## Resolved Design Decisions

1. Workflow Registry/store records and permissions are defined in `prds/02-workflow-registry-catalog-and-draft-store.md`.
2. Snapshot fields are defined by the `WorkflowSessionConfigurationSnapshot` contract above and `prds/09-implementation-completeness-contract.md` Section 4.4.
3. Historical Project runs link to the Workflows tab only when a live or archived definition exists. Tombstoned or missing definitions render snapshot data with a `definition deleted` state and no broken live-definition link.
4. Exact catalog, lifecycle, and Project workflow session routes are defined in `prds/09-implementation-completeness-contract.md` Section 4.3.
