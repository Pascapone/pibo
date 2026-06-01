# PRD: Pibo Workflow UI Authoring V2 — Implementation Completeness Contract

**Status:** Draft  
**Created:** 2026-05-11  
**Purpose:** Second-pass completeness PRD for implementation agents.  
**Related docs:** all source docs in `../`, all PRDs in this directory.

## 1. Executive Summary

- **Problem Statement**: Workflow UI Authoring V2 spans registry storage, catalog APIs, Project session lifecycle, snapshots, visual editing, raw IR editing, capability pickers, versioning, run inspection, human actions, validation, security, and tests. Implementation agents may miss cross-cutting rules if they use only high-level specs.
- **Proposed Solution**: Treat this PRD as the implementation completeness contract. It consolidates every mandatory V2 requirement into an agent-ready checklist and defines the minimum product, API, persistence, UI, validation, and test surface required for V2.
- **Success Criteria**:
  - SC-01: Every requirement in `../spec.md` maps to at least one PRD and at least one checklist item in this file.
  - SC-02: Every task group in `../tasks.md` maps to an implementation area and validation gate.
  - SC-03: An implementation agent can identify all required surfaces, records, APIs, UI flows, validation rules, tests, and explicit deferrals without reading the original chat.
  - SC-04: A reviewer can reject an implementation when any checklist item marked MUST is missing.
  - SC-05: V2 passes typecheck plus relevant workflow, API, and Chat Web tests for catalog, builder, Project sessions, run inspection, human actions, and security boundaries.

## 2. User Experience & Functionality

- **User Personas**:
  - Implementation agent building V2 from PRDs.
  - Reviewer verifying completeness against source specs.
  - Product engineer validating user-facing scope.
  - Full-stack engineer implementing Workflows and Projects surfaces.
  - QA/security reviewer testing validation and capability boundaries.

- **User Stories**:
  - As an implementation agent, I want one mandatory checklist so that I do not miss requirements spread across source specs.
  - As a reviewer, I want pass/fail gates so that V2 completeness can be evaluated repeatably.
  - As a product engineer, I want all non-goals restated so that scope does not expand during implementation.
  - As a QA engineer, I want tests mapped to task groups so that validation covers the shipped behavior.

- **Acceptance Criteria**:
  - V2 includes both product surfaces: Workflows main-nav tab and Projects execution surface.
  - V2 includes global workflow catalog, UI draft store, UI-published workflows, version history, archive, and delete.
  - V2 includes Project session workflow selection, delayed start, one run per session, workflow immutability, and session snapshots.
  - V2 includes builder support for visual graph editing, raw Workflow IR editing, raw JSON schema editing, prompt editing, prompt asset editing, validation panel, and publish panel.
  - V2 includes node, edge, adapter, guard, state, human, profile, and nested workflow editing within the registered-capability-only boundary.
  - V2 includes Project run inspection, sidebar session routing, human action controls, and deleted-definition historical inspection.
  - V2 excludes all explicit non-goals unless a later approved change updates scope.

- **Non-Goals**:
  - Do not implement workflow templates in V2.
  - Do not implement TypeScript export from UI workflows in V2.
  - Do not implement YAML/JSON import/export as product features in V2.
  - Do not implement inline TypeScript, JavaScript, shell, eval, or arbitrary executable code in V2 UI.
  - Do not implement workflow slash commands in V2.
  - Do not implement workflow tools for agents in V2.
  - Do not implement normal Sessions-tab workflow usage in V2.
  - Do not implement Project-wide default workflow selection in V2.
  - Do not allow changing a session's workflow after creation.
  - Do not implement raw XState editing.
  - Do not introduce Zod or a new schema authoring/validation layer.
  - Do not inline-expand nested workflow internals in parent graphs.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Existing Pibo Workflow IR, Registry, validator, runtime kernel, persistence, wait tokens, and XState projection.
  - Existing Project Session, Pibo Session hierarchy, Agent Designer profiles, prompt assets, auth, event, and Chat Web systems.
  - Catalog, draft, version, picker, publish, archive, delete, configured-session, start-run, run-inspection, and human-action APIs.
  - Test harnesses for workflow package logic, backend APIs, Chat Web UI, and Project run behavior.

- **Evaluation Strategy**:
  - **Definition/catalog evals**: code and UI workflows list correctly; drafts save invalid structures; source/status action derivation is stable.
  - **Builder evals**: duplicate/edit/validate/publish works; raw IR invalid text is rejected safely; no raw XState or inline code path exists.
  - **Composition evals**: registered refs resolve; missing refs diagnose; incompatible ports require registered adapters; params validate against `paramsSchema`.
  - **Project session evals**: selection, delayed start, immutable workflow, snapshot, one-run enforcement, deleted-definition inspection.
  - **Run/human evals**: sidebar real-session tree, view routing, run status, nested workflow links, approve/reject/resume/cancel.
  - **Release evals**: `npm run typecheck` and relevant automated/manual V2 flows pass.

## 4. Technical Specifications

- **Architecture Overview**:
  - V2 adds UI and API layers on top of the V1 Workflow Registry, Workflow IR, validator, runtime kernel, persistence, and XState projection.
  - The Workflows tab owns definitions, drafts, versions, validation, and lifecycle actions.
  - Projects own configured sessions, explicit start, workflow runs, run inspection, sidebar navigation, and human actions.
  - Runtime executes only valid published workflows or valid session snapshots.

- **Integration Points**:
  - Workflow Registry/store for code workflows, UI drafts, UI-published versions, source/status metadata, archive/delete, and missing refs.
  - Project service and Pibo Session Store for configured sessions, parent/child session hierarchy, and view routing.
  - Workflow runtime/store for runs, snapshots, node attempts, edge transfers, wait tokens, events, outputs, and errors.
  - Chat Web Workflows and Projects surfaces for catalog, builder, session creation, run view, and human actions.

- **Security & Privacy**:
  - V2 must keep Pibo's existing auth, Project/session visibility, profile/tool/skill/context, and compute-worker boundaries.
  - The UI can compose only registered handlers, adapters, guards, workflows, human actions, prompt assets, and non-archived Agent profiles.
  - Workflow inputs, outputs, prompts, prompt assets, state, edge payloads, snapshots, and human action payloads remain sensitive workflow data.

### 4.1 Required Product Surfaces

The implementation MUST include:

| Surface | Required behavior |
|---|---|
| Workflows tab | Global workflow library, builder, draft/version lifecycle, validation panel, archive/delete actions. |
| Projects execution | Project session creation, workflow selection, delayed start, run view, run history, human actions. |
| Project sidebar | Real Pibo Sessions only; distinct visual markers for workflow, nested workflow, agent node, and subagent sessions. |
| Workflow view | Workflow/XState + run state for workflow and nested workflow sessions. |
| Terminal view | Normal Terminal view for agent node and subagent sessions. |

### 4.2 Workflow Record and Store Contract

The implementation MUST model workflow record source and lifecycle separately:

```ts
type WorkflowRecordSource = "code" | "ui";
type WorkflowRecordStatus = "draft" | "published" | "archived";
```

The implementation MUST use the detailed Workflow Registry/store schema in `02-workflow-registry-catalog-and-draft-store.md`. It treats these entities as distinct:

- workflow identity: groups versions, active draft state, archive state, delete/tombstone state, title, description, tags, and audit fields;
- draft record: the one mutable UI editing track for a workflow/copy, containing a parsed partial Workflow IR object plus diagnostics;
- published version record: immutable runnable definition with semantic version and definition hash;
- archive state: workflow-level state, not per-version state;
- delete/tombstone state: live catalog state that must not remove historical run snapshots.

The implementation MUST use the permission matrix in `02-workflow-registry-catalog-and-draft-store.md`:

| Action | V2 baseline |
|---|---|
| View workflows | Authenticated users can see code projections and global UI-authored workflows; archived records require an explicit archive filter or historical link. |
| Duplicate workflow | Authenticated users can duplicate code workflow projections or unarchived UI-published versions into new UI identities and active drafts. |
| Create draft | Authenticated users can create a UI draft for a new UI identity or next-version path when the workflow has no active draft. |
| Edit draft | Authenticated users can edit global UI drafts; V2 audit fields do not create owner-private edit gates. |
| Publish draft | Authenticated users can publish valid UI drafts with no error diagnostics as immutable version records. |
| Archive workflow | Authenticated users can archive UI-authored workflow identities; code projections remain read-only except duplicate. |
| Delete workflow | Authenticated users can delete/tombstone UI-authored workflow identities; historical snapshots must remain inspectable. |

The implementation MUST support:

- global visibility of UI-authored workflows;
- code workflows as read-only except duplication;
- UI drafts in the Workflow Registry/store;
- UI-published workflows in the Workflow Registry/store;
- one active draft per workflow/copy;
- incomplete/invalid draft save;
- invalid raw IR text rejection without overwriting the saved draft object;
- registry-visible published UI versions;
- source/status-derived UI actions;
- missing-reference diagnostics for handlers, adapters, guards, profiles, prompt assets, human actions, and nested workflows.

### 4.3 Catalog, Picker, and Lifecycle API Contract

The implementation MUST expose these same-origin Chat Web routes under `/api/chat`. All routes require an authenticated web session. Mutating routes MUST require same-origin JSON requests. UI workflow records are global in V2, so authenticated user ids are audit fields rather than ownership gates.

| Method | Route | Purpose | Required behavior |
|---|---|---|---|
| `GET` | `/api/chat/workflows` | List catalog records | Returns code projections, UI drafts, UI published versions, and archived workflows only when `includeArchived=true` or a historical link requests them. Supports `source`, `status`, and search/filter query parameters when implemented. |
| `POST` | `/api/chat/workflows` | Create a new UI workflow draft identity | Creates a global UI workflow identity and active draft from title/description/tags plus optional initial parsed Workflow IR. Does not create executable code. |
| `GET` | `/api/chat/workflows/:workflowId` | Inspect one workflow identity | Returns source/status, active draft summary, published versions, archive/delete state when visible, diagnostics, and source/status-derived actions. |
| `GET` | `/api/chat/workflows/:workflowId/versions` | List published versions | Returns immutable published version summaries in deterministic order. Archived identities require `includeArchived=true` or historical access. |
| `GET` | `/api/chat/workflows/:workflowId/versions/:version` | Inspect one published version | Returns immutable definition metadata, definition hash, validation state, prompt asset pins, and available actions. |
| `POST` | `/api/chat/workflows/:workflowId/duplicate` | Duplicate a code or UI published version into a UI draft | Body selects `version` when needed and optional title/description/tags. Returns the new UI identity and active draft. The source version is never mutated. |
| `POST` | `/api/chat/workflows/:workflowId/drafts` | Create or reuse a next-version draft | Creates the one active draft for an editable UI workflow/version path, or returns the existing active draft with `reused: true`. Rejects code projections, deleted workflows, and multiple active drafts. |
| `GET` | `/api/chat/workflows/drafts/:draftId` | Inspect one draft | Returns the parsed draft IR object, validation state, diagnostics, revision, base version/hash, and editor metadata. |
| `PATCH` | `/api/chat/workflows/drafts/:draftId` | Save a draft | Accepts parsed Workflow IR draft changes and editor metadata. Drafts may remain incomplete or invalid. Invalid raw JSON text is rejected before replacing the last valid draft object. |
| `POST` | `/api/chat/workflows/drafts/:draftId/validate` | Validate a draft | Runs the shared workflow validator and returns grouped diagnostics without publishing or starting. |
| `POST` | `/api/chat/workflows/drafts/:draftId/publish` | Publish a draft | Body may choose `versionIntent: "patch" | "minor" | "major"`. Requires no error diagnostics and creates an immutable published version with a definition hash. |
| `POST` | `/api/chat/workflows/:workflowId/archive` | Archive a workflow identity | Archives a UI-authored workflow at identity scope. Code projections cannot be archived. Historical links remain inspectable. |
| `DELETE` | `/api/chat/workflows/:workflowId` | Delete/tombstone a workflow identity | Requires confirmation input. Tombstones a UI-authored workflow without deleting historical snapshots. Tombstoned identities are absent from normal catalog lists. |
| `GET` | `/api/chat/workflows/pickers/:kind` | List picker options | `:kind` is one of `profiles`, `handlers`, `adapters`, `guards`, `human-actions`, `prompt-assets`, or `workflow-versions`. Picker rows include `id`, `displayName`, `description`, and `paramsSchema` or `null` where applicable. Defaults exclude archived profiles/workflows. |

Project workflow session routes are part of the same contract:

| Method | Route | Purpose | Required behavior |
|---|---|---|---|
| `POST` | `/api/chat/projects/:projectId/workflow-sessions` | Create a configured/not-started workflow Project session | Body accepts session name, workflow id/version, input, prompt overrides, model, thinking level, and fast mode. It creates a Pibo Session plus Project session metadata and a configuration/effective-definition snapshot, but no workflow run. |
| `GET` | `/api/chat/projects/:projectId/workflow-sessions/:piboSessionId` | Inspect configured or run session state | Returns selected workflow metadata, snapshot summary, validation state, run id/status when present, and deleted-definition display state when applicable. |
| `POST` | `/api/chat/projects/:projectId/workflow-sessions/:piboSessionId/start` | Start the configured workflow session | Revalidates the stored snapshot immediately before run creation. Creates exactly one workflow run. A repeated start returns the existing run with `alreadyStarted: true` and MUST NOT create a second run. |

Project routes MUST enforce existing Project/session access. Catalog routes require authentication but no owner-private workflow gate in V2. API errors use normal Chat Web JSON errors plus structured workflow diagnostics for validation failures; validation-blocked create, publish, or start responses use `422` with diagnostics, missing records use `404`, and lifecycle conflicts use `409`.

### 4.4 Project Session and Snapshot Contract

The implementation MUST support:

- Project session creation with session name and workflow id/version;
- allowed session overrides: input, prompt overrides, model, thinking level, fast mode;
- session-scoped overrides that do not persist back to the workflow definition;
- prompt overrides keyed by node id and accepted only for explicitly opted-in Pibo Agent nodes with direct `promptTemplate` values;
- workflow-session-wide model, thinking level, and fast mode settings, not per-Agent-node settings;
- disallowed V2 overrides: agent profile overrides, retry limit overrides, arbitrary options;
- configured/not-started state after session creation;
- explicit start action;
- one workflow run per Project session;
- parallel node execution inside that run when the workflow definition allows it;
- immutable workflow selection after session creation;
- effective snapshot before run start;
- configured/not-started Project session view with configuration summary, validation state, Start action, and empty run-history state;
- blocked create/start UX that shows diagnostics and keeps the session in a safe state;
- historical run inspectability after workflow edit, archive, or delete.

The V2 session snapshot contract is exact, not a minimum. A persisted configuration/effective-definition snapshot MUST record:

- snapshot id, schema version, creation timestamp, creating principal id, owner scope, Project id, and Pibo Session id;
- workflow id, workflow version, source (`code` or `ui`), title, description, tags, base definition hash, and effective definition hash;
- the immutable base `WorkflowDefinition` body selected from the registry and the immutable effective `WorkflowDefinition` body used for execution after allowed prompt overrides are applied;
- selected input values;
- prompt overrides when present, keyed by node id for nodes eligible for prompt override;
- prompt override eligibility policy, including `metadata.sessionOverrides.prompt === true`, direct `promptTemplate` requirement, and the eligible node ids computed when the snapshot was created;
- model when present, with scope `workflow`;
- thinking level when present, with scope `workflow`;
- fast mode when present, with scope `workflow`;
- prompt asset pins used by the effective definition: prompt asset id, revision id, content hash, and source for each referenced asset;
- validation result at snapshot creation, including diagnostics and validation timestamp;
- deleted-definition display fallback fields: snapshot title, workflow id/version, effective definition hash, and optional tombstone label fields copied when a tombstone already exists.

V2 configured-session values are immutable after creation and before first start. The update API MUST NOT change workflow id/version, input values, prompt overrides, model, thinking level, or fast mode in place. Users create a new configured Project session when those values need to change.

### 4.5 Builder Contract

The implementation MUST support editing:

- title and description;
- workflow input and output schemas;
- nodes;
- edges;
- agent profiles;
- prompt templates;
- prompt assets with the existing Markdown editor pattern;
- adapters;
- guards;
- simple state reads/writes;
- human approval prompts, schemas, actions, and timeouts;
- UI layout metadata.

Drafts with zero nodes MAY be saved. Published/runnable workflows MUST have at least one node plus workflow input and output contracts.

The builder MUST include:

- graph canvas;
- node inspector;
- edge inspector;
- workflow settings;
- raw JSON schema editors;
- prompt editor;
- prompt asset editor;
- validation panel;
- raw Workflow IR toggle/editor;
- publish/version panel.

The builder MUST NOT expose raw XState editing.

The builder MUST use the documented builder decisions from `04-workflow-builder-and-ir-editing.md`:

- use `@xyflow/react` for pan, zoom, selection, node drag, and edge creation;
- store saved layout in `workflow.ui.layout` and `workflow.ui.positions` without affecting runtime semantics;
- compute ephemeral auto layout for workflows without positions;
- create revisioned prompt assets and pin prompt asset revision IDs/content hashes in published versions and session snapshots.

### 4.6 Composition Contract

The implementation MUST support node kinds:

```ts
type EditableNodeKind = "agent" | "code" | "workflow" | "adapter" | "human";
```

The implementation MUST enforce:

- Agent nodes choose non-archived private, custom, or global Agent Designer profiles.
- Code nodes choose registered handlers only.
- Workflow nodes choose workflow id/version and provide “Open workflow”.
- Adapter nodes choose registered adapters only.
- Human nodes edit prompt, raw JSON schema, registered human action choices, and timeout.
- Missing or invalid human action refs show diagnostics and block publish/run when they affect executable behavior.
- Edges connect typed ports and may carry guards/adapters where valid.
- Incompatible ports require explicit registered adapters.
- Adapter dialog offers “Use as edge adapter” and “Insert adapter node”.
- Guard/adapter params are editable only when Registry metadata provides `paramsSchema`.
- Simple state mappings are editable through dropdowns; complex mappings remain raw IR only.
- Schema changes may invalidate connected graphs without blocking draft save.

### 4.7 Version, Archive, and Delete Contract

The implementation MUST support:

- draft save;
- validation before publish;
- immutable published versions;
- patch bump by default;
- user-triggered minor and major bumps;
- edit published workflow by creating/reusing next draft path;
- version history and version selection;
- archive whole workflow, not one version;
- authenticated delete even when historical runs exist;
- historical run inspection through snapshots after delete.

### 4.8 Run Inspection and Human Action Contract

The implementation MUST support:

- run state display for each workflow Project session;
- current status, current node, node attempts, edge transfers, output, and errors;
- nested workflow links and session hierarchy;
- link back to definition when a live or archived definition still exists and the user has access;
- snapshot-only “definition deleted” state when the live definition is tombstoned or missing;
- pending human action display from persisted wait tokens;
- approve, reject, resume, and cancel actions;
- resume payload validation before action acceptance;
- live refresh where existing event streams support it.

### 4.9 Validation and Diagnostic Contract

The implementation MUST run validation after:

- draft load;
- graph edit;
- node edit;
- edge edit;
- schema edit;
- prompt edit;
- state edit;
- raw IR edit;
- before publish;
- before Project session creation;
- before workflow start.

Diagnostics SHOULD include:

- code;
- message;
- optional path;
- optional nodeId;
- optional edgeId;
- severity;
- hint.

The implementation MUST block publish and run/start while error diagnostics remain.

The implementation MUST expose lifecycle or audit-equivalent signals for draft save, validation, publish, archive, delete, configured-session creation, start blocked, start accepted, run status changes, and human action submission.

### 4.10 Security Boundary Contract

The implementation MUST NOT allow:

- inline TypeScript;
- JavaScript eval;
- arbitrary shell/script nodes;
- creating new handlers/adapters/guards in UI;
- hidden LLM coercion between incompatible schemas;
- raw XState source editing;
- Zod schema layer.

The implementation MUST keep Pibo's existing auth, Project/session visibility, profile/tool/skill/context, and compute-worker boundaries.

### 4.11 Implementation Checklist

Reviewer rule: every unchecked MUST item in this section is an independent pass/fail item. Mark an item passing only when implementation evidence and the mapped validation gate exist; otherwise fail the V2 completeness review.

### Registry, Catalog, and Store

- [ ] MUST add source/status metadata to workflow catalog records.
- [ ] MUST store UI drafts in the Workflow Registry/store.
- [ ] MUST store UI-published workflows in the Workflow Registry/store.
- [ ] MUST enforce one active draft per workflow/copy.
- [ ] MUST allow incomplete/invalid draft save.
- [ ] MUST reject invalid raw IR text without corrupting the last valid draft object.
- [ ] MUST expose catalog and picker APIs.
- [ ] MUST expose missing-reference diagnostics.

### Project Session Lifecycle

- [ ] MUST create Project sessions with workflow id/version selection.
- [ ] MUST keep creation separate from start.
- [ ] MUST persist configuration/effective-definition snapshots.
- [ ] MUST reject workflow changes after session creation.
- [ ] MUST enforce one workflow run per Project session.
- [ ] MUST keep historical runs inspectable after definition deletion.

### Workflows UI and Builder

- [ ] MUST add Workflows main-nav tab.
- [ ] MUST add Workflow Library.
- [ ] MUST add Workflow Builder with graph, inspectors, validation, raw IR, and publish panels.
- [ ] MUST support drag/drop layout and automatic layout.
- [ ] MUST support raw JSON schema editing only.
- [ ] MUST support prompt template and prompt asset editing.
- [ ] MUST support raw Workflow IR editing and forbid raw XState editing.

### Composition

- [ ] MUST support agent, code, workflow, adapter, and human nodes.
- [ ] MUST select only registered handlers, adapters, guards, workflows, human actions, prompt assets, and non-archived Agent profiles.
- [ ] MUST provide compatible adapter selection and insert/use actions.
- [ ] MUST support guard/adapter params only with `paramsSchema`.
- [ ] MUST support simple state read/write dropdowns and raw-IR-only complex mappings.
- [ ] MUST navigate to nested workflow builder/viewer instead of inline expansion.

### Lifecycle

- [ ] MUST publish valid drafts as immutable versions.
- [ ] MUST support patch/minor/major version behavior.
- [ ] MUST archive whole workflows.
- [ ] MUST allow authenticated delete.
- [ ] MUST preserve historical run snapshots.

### Projects Run View

- [ ] MUST show only real Pibo Sessions in the Project sidebar.
- [ ] MUST visually distinguish workflow, nested workflow, agent node, and subagent sessions.
- [ ] MUST route workflow sessions to Workflow/XState + run view.
- [ ] MUST route agent/subagent sessions to Terminal view.
- [ ] MUST show run history, state, output/errors, nested links, and human actions.

### Validation, Security, and Tests

- [ ] MUST reuse existing JSON Schema subset validation and avoid Zod.
- [ ] MUST validate at edit, publish, session creation, and start boundaries.
- [ ] MUST block publish/run on error diagnostics.
- [ ] MUST prevent inline TypeScript and arbitrary executable code.
- [ ] MUST test registry lifecycle, catalog APIs, builder, raw IR, Project session lifecycle, sidebar/view routing, human actions, archive/delete, deleted-definition inspection, and explicit non-goals.
- [ ] MUST run `npm run typecheck` and relevant workflow/package/Chat Web tests before completion.

### 4.12 Traceability to Task Groups

Each task group from `../tasks.md` maps to an implementation area and a validation gate. A task-group row is incomplete if either column is empty or if the validation gate does not name reviewable evidence.

| Task group | Implementation area | Validation gate |
|---|---|---|
| 0. Spec discovery and open questions | Resolved-decision docs across PRDs 02, 03, 04, 06, 07, and 09. | PRD 09 US-001 decision review, JSON validation, and typecheck for doc-only decision changes. |
| 1. Workflow Registry Store and Catalog | Sections 4.2, 4.3, and 4.11 Registry checklist. | Catalog/lifecycle checklist tests, workflow package store tests, `web-channel` catalog API tests, and typecheck. |
| 2. Version, Archive, Delete Lifecycle | Sections 4.7 and 4.11 Lifecycle checklist. | Lifecycle checklist tests, published-version package tests, archive/delete `web-channel` tests, and typecheck. |
| 3. Workflows Main-Nav Tab | Sections 4.1, 4.5, and 4.11 Workflows UI checklist. | Workflows UI source tests, browser smoke for `/apps/chat/workflows`, Chat UI build, and typecheck. |
| 4. Project Session Creation and Workflow Selection | Sections 4.4 and 4.11 Project Session checklist. | Project service tests, configured-session UI tests, Project workflow `web-channel` tests, and typecheck. |
| 5. Project Sessions Sidebar and Views | Sections 4.1, 4.8, and 4.11 Projects Run View checklist. | Session-kind tests, run-inspection source tests, Project bootstrap `web-channel` tests, browser smoke, and typecheck. |
| 6. Workflow Draft Duplication | Sections 4.2, 4.3, 4.5, and 4.11 Registry/Builder checklist. | Duplicate-to-draft `web-channel` tests, builder loader tests, lifecycle checklist tests, and typecheck. |
| 7. Visual Workflow Builder | Sections 4.5 and 4.11 Workflows UI checklist. | Builder source tests, Chat UI build, browser smoke for builder panels, and typecheck. |
| 8. Node Editing | Sections 4.6 and 4.11 Composition checklist. | Builder/security checklist tests, composition-boundary tests, picker `web-channel` tests, and typecheck. |
| 9. Adapter, Guard, and State Editing | Sections 4.6 and 4.11 Composition checklist. | Composition-boundary tests, state-mapping UI tests, guard/adapter `web-channel` tests, and typecheck. |
| 10. Schema, Prompt, and Prompt Asset Editing | Sections 4.5, 4.9, and 4.11 Workflows UI checklist. | Builder raw/schema/prompt tests, prompt asset `web-channel` tests, and typecheck. |
| 11. Raw Workflow IR Editor | Sections 4.5, 4.9, and 4.11 Workflows UI checklist. | Builder raw IR tests, validation pipeline `web-channel` tests, raw-XState negative tests, and typecheck. |
| 12. Validation Panel | Sections 4.9, 4.10, and 4.11 Validation checklist. | Validation-pipeline `web-channel` tests, diagnostic source tests, security-boundary tests, and typecheck. |
| 13. Run History and Human Actions in Projects | Sections 4.8 and 4.11 Projects Run View checklist. | Project/run-view checklist tests, runtime human-node package tests, human-action `web-channel` tests, browser smoke, and typecheck. |
| 14. Testing and Validation | Sections 3, 4.9, 4.10, and 4.11 Validation checklist. | Release coverage tests, targeted workflow/package/Chat Web tests, browser smoke checklists, and typecheck. |
| 15. Explicit V3 Deferrals | Sections 2 Non-Goals, 4.10, and 4.11 Validation checklist. | Deferral source tests, security-boundary tests, explicit non-goal browser scan, and typecheck. |

### 4.13 Requirement Traceability

Each requirement from `../spec.md` maps by REQ id to PRD coverage and one or more numbered completeness sections. A row is incomplete if the PRD coverage or completeness-section cell is empty.

| Requirement | Source requirement | PRD coverage | Completeness sections |
|---|---|---|---|
| REQ-001 | UI targets normal Pibo users | `01, 09` | 4.1, 4.10, 4.11 |
| REQ-002 | Workflows are global | `02, 09` | 4.2 |
| REQ-003 | Workflow record source/status explicit | `02, 09` | 4.2 |
| REQ-004 | UI drafts live in Workflow Registry/store | `02, 09` | 4.2 |
| REQ-005 | Drafts may be incomplete/invalid | `02, 04, 09` | 4.2, 4.5, 4.9 |
| REQ-006 | One draft per workflow/copy | `02, 06, 09` | 4.2, 4.7 |
| REQ-007 | Workflow selection during Project session creation | `03, 09` | 4.4 |
| REQ-008 | Workflow start is explicit | `03, 07, 09` | 4.4, 4.8 |
| REQ-009 | Session workflow selection is immutable | `03, 09` | 4.4 |
| REQ-010 | One workflow run per Project session | `03, 07, 09` | 4.4, 4.8 |
| REQ-011 | Workflows selected per session, not Project | `01, 03, 09` | 4.4 |
| REQ-012 | Session-scoped configuration is snapshotted | `03, 06, 09` | 4.4, 4.7 |
| REQ-013 | Project sidebar shows only real Pibo Sessions | `07, 09` | 4.1, 4.8 |
| REQ-014 | Sidebar visually distinguishes session types | `07, 09` | 4.1, 4.8 |
| REQ-015 | Selected context chooses the view | `07, 09` | 4.1, 4.8 |
| REQ-016 | Workflow runs link back to definitions | `07, 09` | 4.8 |
| REQ-017 | UI composes existing capabilities only | `05, 08, 09` | 4.6, 4.10 |
| REQ-018 | Missing references are visible | `02, 05, 08, 09` | 4.2, 4.6, 4.9 |
| REQ-019 | Duplicate workflow to draft | `02, 04, 09` | 4.2, 4.3, 4.5 |
| REQ-020 | Code workflows read-only except duplicate | `02, 09` | 4.2 |
| REQ-021 | Workflow drafts use Pibo Workflow IR | `01, 04, 09` | 4.5 |
| REQ-022 | Draft and publish lifecycle | `06, 09` | 4.7 |
| REQ-023 | Versioning patch/minor/major | `06, 09` | 4.7 |
| REQ-024 | Archive applies to whole workflow | `06, 09` | 4.7 |
| REQ-025 | Delete allowed with historical runs | `06, 07, 09` | 4.7, 4.8 |
| REQ-026 | Authenticated users archive/delete | `06, 09` | 4.2, 4.7 |
| REQ-027 | Visual editor edits V2 fields | `04, 05, 09` | 4.5, 4.6 |
| REQ-028 | Smallest valid workflow has one node/input/output | `04, 09` | 4.5 |
| REQ-029 | Raw IR visible/editable | `04, 09` | 4.5, 4.9 |
| REQ-030 | JSON Schema editing raw JSON only | `04, 08, 09` | 4.5, 4.9 |
| REQ-031 | Schema changes may invalidate graphs | `04, 05, 09` | 4.6, 4.9 |
| REQ-032 | Adapter selection dialog compatible adapters | `05, 09` | 4.6 |
| REQ-033 | Guards/adapters params only with metadata | `05, 09` | 4.6 |
| REQ-034 | State mappings simple visual editing | `05, 09` | 4.6 |
| REQ-035 | Nested workflow nodes open separately | `05, 09` | 4.6 |
| REQ-036 | Graph layout manual/automatic | `04, 09` | 4.5 |
| REQ-037 | Workflow Library lists workflows | `02, 09` | 4.1, 4.3 |
| REQ-038 | Run history and human actions in Projects | `07, 09` | 4.8 |
| REQ-039 | Prompt assets are editable | `04, 09` | 4.5, 4.14 |
| REQ-040 | Use existing JSON Schema subset | `04, 08, 09` | 4.9, 4.10 |
| REQ-041 | XState remains visual only | `01, 04, 07, 08, 09` | 4.5, 4.8, 4.10 |

### 4.14 Resolved Decisions Gate

All source-spec decisions that block V2 implementation are now documented:

- Registry/store schema and permission decisions are documented in `02-workflow-registry-catalog-and-draft-store.md`: workflow identity, draft record, published version record, archive state, delete/tombstone state, and the V2 permission matrix.
- Project session override decisions are documented in `03-project-session-selection-and-snapshots.md`: prompt overrides are limited to explicitly opted-in Pibo Agent nodes with direct `promptTemplate` values; model, thinking level, and fast mode are workflow-session-wide; configured-session values are immutable before start.
- Session snapshot fields are documented in Section 4.4 of this PRD and `03-project-session-selection-and-snapshots.md`: snapshots store the base and effective definitions, hashes, inputs, allowed overrides, scope policy, prompt asset pins, validation result, identity fields, and deleted-definition fallback display fields.
- Deleted-workflow display and link behavior is documented in Section 4.8 of this PRD plus `06-versioning-archive-delete-lifecycle.md` and `07-project-run-inspection-sidebar-and-human-actions.md`: live or archived definitions can link back to Workflows; tombstoned or missing definitions render a snapshot-only definition-deleted state with no live-definition action.
- Exact API routes are documented in Section 4.3 of this PRD. Catalog routes live under `/api/chat/workflows`; Project workflow configured-session routes live under `/api/chat/projects/:projectId/workflow-sessions`.
- Builder decisions are documented in `04-workflow-builder-and-ir-editing.md`: use `@xyflow/react` for the visual canvas, save layout through existing Workflow IR UI metadata, and persist prompt asset edits as revisions instead of mutating published asset content in place.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Registry/store model, global catalog, duplicate-to-draft, Project session selection, delayed start, snapshot, and run status.
  - v1.1: Visual builder, raw IR editor, node/edge composition, validation panel, publish/version lifecycle.
  - v1.2: Archive/delete, deleted-definition historical inspection, human actions, nested session sidebar, and full UI test coverage.
  - V3 candidates: templates, import/export, TypeScript export, marketplace, workflow tools for agents, slash commands, richer schema authoring.

- **Technical Risks**:
  - UI drafts diverge from runtime workflows; mitigate by storing Pibo Workflow IR and validating with the existing validator.
  - Runtime history becomes unreadable after lifecycle actions; mitigate with mandatory snapshots and deleted-definition UI state.
  - Broad archive/delete permissions cause accidental loss; mitigate with confirmation UI and immutable historical snapshots.
  - Scope creep introduces unsafe execution paths; mitigate with explicit non-goals and negative tests.

