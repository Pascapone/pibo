# Tasks: Pibo Workflow UI Authoring V2

**Status:** Draft v0.2
**Created:** 2026-05-11
**Updated:** 2026-05-11
**Related spec:** `spec.md`

## 0. Spec Discovery and Open Questions

- [x] 0.1 Confirm Workflow Registry/store schema for UI drafts and UI-published workflows. Decision recorded in `prds/02-workflow-registry-catalog-and-draft-store.md`.
- [x] 0.2 Define configuration/effective-definition snapshot fields. Decision recorded in `prds/09-implementation-completeness-contract.md` Section 4.4 and `prds/03-project-session-selection-and-snapshots.md`.
- [x] 0.3 Define deleted-workflow behavior for historical Project runs. Decision recorded in `prds/09-implementation-completeness-contract.md` Section 4.8, `prds/06-versioning-archive-delete-lifecycle.md`, and `prds/07-project-run-inspection-sidebar-and-human-actions.md`.
- [x] 0.4 Choose visual graph/canvas library. Decision recorded in `prds/04-workflow-builder-and-ir-editing.md`: use `@xyflow/react` for builder canvas interactions.
- [x] 0.5 Define exact API routes and auth/owner behavior. Decision recorded in `prds/09-implementation-completeness-contract.md` Section 4.3.
- [x] 0.6 Decide global vs per-node application of model, thinking level, and fast mode overrides. Decision recorded in `prds/03-project-session-selection-and-snapshots.md`: model, thinking level, and fast mode are workflow-session-wide.
- [x] 0.7 Decide prompt asset versioning/mutation behavior. Decision recorded in `prds/04-workflow-builder-and-ir-editing.md`: prompt asset edits create revisions and do not mutate published asset content in place.
- [x] 0.8 Define prompt override eligibility rules. Decision recorded in `prds/03-project-session-selection-and-snapshots.md`: prompt overrides target explicitly opted-in Pibo Agent nodes with direct `promptTemplate` values.
- [x] 0.9 Define pre-start configured-session edit policy. Decision recorded in `prds/03-project-session-selection-and-snapshots.md`: configured-session values are immutable before start.

## 1. Workflow Registry Store and Catalog

- [ ] 1.1 Add `source: "code" | "ui"` and `status: "draft" | "published" | "archived"` model to workflow catalog records.
- [ ] 1.2 Store UI drafts in the Workflow Registry/store.
- [ ] 1.3 Store UI-published workflows in the Workflow Registry/store.
- [ ] 1.4 Enforce one active draft per workflow/copy.
- [ ] 1.5 Allow drafts to be invalid or incomplete.
- [ ] 1.6 Reject invalid raw IR text without overwriting the last valid draft object.
- [ ] 1.7 Add missing-reference diagnostics for handlers, adapters, guards, profiles, and nested workflows.
- [ ] 1.8 Add API to list workflow definitions, drafts, and versions from code registry and UI store.
- [ ] 1.9 Add API to inspect one workflow version or draft.
- [ ] 1.10 Add API to list registered handlers, adapters, guards, human actions, prompt assets, and non-archived agent profiles for editor pickers.
- [ ] 1.11 Add tests for catalog visibility, source/status behavior, and version listing.

## 2. Version, Archive, Delete Lifecycle

- [ ] 2.1 Publish valid draft as immutable workflow version.
- [ ] 2.2 Make published UI workflows registry-visible.
- [ ] 2.3 Support automatic patch version increment by default.
- [ ] 2.4 Support user-triggered minor and major version bumps.
- [ ] 2.5 Editing a published workflow creates a new draft/version path.
- [ ] 2.6 Show version history and allow version selection.
- [ ] 2.7 Archive whole workflows, not individual versions.
- [ ] 2.8 Allow authenticated users to delete workflows even with historical runs.
- [ ] 2.9 Preserve run inspectability after workflow deletion through snapshots.
- [ ] 2.10 Add tests for publish, version bump, archive, delete, and historical run behavior.

## 3. Workflows Main-Nav Tab

- [ ] 3.1 Add a main navigation Workflows tab.
- [ ] 3.2 Add Workflow Library inside the Workflows tab.
- [ ] 3.3 List global code and UI workflows.
- [ ] 3.4 Show id, title, description, source, status, versions, tags, validation status, and missing refs.
- [ ] 3.5 Support actions: duplicate, edit draft, create new version, archive, delete, inspect versions, and create Project session/run link.
- [ ] 3.6 Hide archived workflows from default lists while keeping archive filters available.
- [ ] 3.7 Exclude templates from V2.

## 4. Project Session Creation and Workflow Selection

- [ ] 4.1 Add Project session creation view in the main session panel.
- [ ] 4.2 Let user set session name and select workflow id/version.
- [ ] 4.3 Show workflow input/output summary and description.
- [ ] 4.4 Render workflow input editor from JSON values/raw schema context.
- [ ] 4.5 Validate workflow input before session creation/start.
- [ ] 4.6 Support prompt overrides.
- [ ] 4.7 Support model selection.
- [ ] 4.8 Support thinking level selection.
- [ ] 4.9 Support fast mode selection.
- [ ] 4.10 Do not support agent profile overrides, retry overrides, or arbitrary option overrides in V2.
- [ ] 4.11 Create configured workflow Project session without starting the workflow.
- [ ] 4.12 Persist immutable session configuration/effective-definition snapshot.
- [ ] 4.13 Add explicit start action for configured workflow sessions.
- [ ] 4.14 Reject workflow changes after Project session creation.
- [ ] 4.15 Enforce one workflow run per Project session.
- [ ] 4.16 Add tests for delayed start, snapshot creation, and workflow selection immutability.

## 5. Project Sessions Sidebar and Views

- [ ] 5.1 Update Project Sessions sidebar to show only real Pibo Sessions.
- [ ] 5.2 Show main workflow sessions.
- [ ] 5.3 Show nested workflow sessions.
- [ ] 5.4 Show agent node sessions.
- [ ] 5.5 Show subagent sessions.
- [ ] 5.6 Do not show code, human, adapter, edge, guard, or state nodes as sidebar sessions.
- [ ] 5.7 Add distinct icons/visual hints for workflow, nested workflow, agent node, and subagent sessions.
- [ ] 5.8 Route workflow and nested workflow sessions to Workflow/XState + run view.
- [ ] 5.9 Route agent node and subagent sessions to Terminal view.
- [ ] 5.10 Add links from Project run views to workflow definitions in the Workflows tab.
- [ ] 5.11 Show “definition deleted” state when a run's workflow definition no longer exists.

## 6. Workflow Draft Duplication

- [ ] 6.1 Duplicate code-registered workflows into UI drafts.
- [ ] 6.2 Duplicate UI-published workflows into UI drafts/copies.
- [ ] 6.3 Preserve source workflow id/version/hash metadata.
- [ ] 6.4 Auto-layout duplicated workflows without positions.
- [ ] 6.5 Prevent direct editing of code-registered workflows.

## 7. Visual Workflow Builder

- [ ] 7.1 Add graph canvas with auto layout for workflows without positions.
- [ ] 7.2 Support drag-and-drop node positions and persist UI metadata.
- [ ] 7.3 Add node palette for `agent`, `code`, `workflow`, `adapter`, and `human` nodes.
- [ ] 7.4 Add node inspector.
- [ ] 7.5 Add edge drawing and edge inspector.
- [ ] 7.6 Add port compatibility checks while connecting nodes.
- [ ] 7.7 Require adapters for incompatible ports.
- [ ] 7.8 Allow schema changes to invalidate connected graphs without blocking draft save.
- [ ] 7.9 Support deleting nodes and edges with clear validation diagnostics.
- [ ] 7.10 Require at least one node plus workflow input/output for publish/run.

## 8. Node Editing

- [ ] 8.1 Agent nodes: choose non-archived Agent Designer profile and edit prompt template.
- [ ] 8.2 Code nodes: choose registered handler only.
- [ ] 8.3 Workflow nodes: choose nested workflow id/version.
- [ ] 8.4 Workflow nodes: provide “Open workflow” navigation to child workflow builder/viewer.
- [ ] 8.5 Do not inline-expand nested workflow internals in the parent graph.
- [ ] 8.6 Adapter nodes: choose registered adapter only.
- [ ] 8.7 Human nodes: edit prompt, raw JSON schema, actions, and timeout.
- [ ] 8.8 Forbid inline TypeScript and arbitrary code entry.

## 9. Adapter, Guard, and State Editing

- [ ] 9.1 Adapter dialog shows only compatible adapters prominently.
- [ ] 9.2 Adapter dialog shows adapter schema and description details.
- [ ] 9.3 Adapter dialog supports “Use as edge adapter”.
- [ ] 9.4 Adapter dialog supports “Insert adapter node”.
- [ ] 9.5 Do not support creating new adapters in UI.
- [ ] 9.6 Guards are selectable from Registry.
- [ ] 9.7 Guard params are editable only when Registry metadata provides `paramsSchema`.
- [ ] 9.8 Adapter params are editable only when Registry metadata provides `paramsSchema`.
- [ ] 9.9 Simple state reads/writes are editable through dropdowns.
- [ ] 9.10 Complex state mappings are raw IR only.

## 10. Schema, Prompt, and Prompt Asset Editing

- [ ] 10.1 Use existing JSON Schema subset; do not add Zod.
- [ ] 10.2 Edit workflow input/output schemas as raw JSON only.
- [ ] 10.3 Edit node input/output schemas as raw JSON only.
- [ ] 10.4 Edit human resume payload schemas as raw JSON only.
- [ ] 10.5 Validate schemas with existing workflow validation diagnostics.
- [ ] 10.6 Add prompt template editor.
- [ ] 10.7 Add prompt asset editor using existing Markdown editor pattern from Context Files.
- [ ] 10.8 Show session prompt override behavior clearly.

## 11. Raw Workflow IR Editor

- [ ] 11.1 Add raw IR toggle on workflow definition/editor.
- [ ] 11.2 Allow raw IR editing.
- [ ] 11.3 Parse raw IR edits without corrupting last valid draft object.
- [ ] 11.4 Show warning for invalid raw IR text and do not save it.
- [ ] 11.5 Sync valid raw edits back to graph editor.
- [ ] 11.6 Show parse and workflow validation diagnostics.
- [ ] 11.7 Do not expose raw XState JSON editing.

## 12. Validation Panel

- [ ] 12.1 Run validation after graph, node, edge, schema, prompt, state, and raw IR edits.
- [ ] 12.2 Group diagnostics by workflow, node, edge, schema path, state path, registry ref, and severity.
- [ ] 12.3 Link diagnostics to graph elements and editors.
- [ ] 12.4 Show missing-reference diagnostics in library cards and editor panels.
- [ ] 12.5 Block publish while error diagnostics remain.
- [ ] 12.6 Block run/start when the effective session snapshot is invalid.
- [ ] 12.7 Allow non-blocking warnings where appropriate.

## 13. Run History and Human Actions in Projects

- [ ] 13.1 Show workflow run state for each workflow Project session.
- [ ] 13.2 Show nested workflow runs under the same Project session hierarchy.
- [ ] 13.3 Show current run status, current node, node attempts, edge transfers, output, and errors.
- [ ] 13.4 Show pending human actions from persisted wait tokens.
- [ ] 13.5 Support approve, reject, resume, and cancel actions.
- [ ] 13.6 Validate human resume payload before submission.
- [ ] 13.7 Refresh run state live where existing event streams support it.
- [ ] 13.8 Keep runs inspectable after workflow definition deletion.

## 14. Testing and Validation

- [ ] 14.1 Unit-test Workflow Registry draft and publish/version lifecycle.
- [ ] 14.2 Unit-test catalog read APIs.
- [ ] 14.3 Unit-test source/status action derivation.
- [ ] 14.4 Integration-test Project session creation with workflow selection.
- [ ] 14.5 Integration-test delayed workflow start.
- [ ] 14.6 Integration-test effective snapshot creation.
- [ ] 14.7 Integration-test workflow selection immutability.
- [ ] 14.8 UI-test duplicate/edit/validate/publish path.
- [ ] 14.9 UI-test raw IR invalid edit warning.
- [ ] 14.10 UI-test incompatible edge adapter requirement.
- [ ] 14.11 UI-test missing handler/adapter/guard/profile diagnostics.
- [ ] 14.12 UI-test Project sidebar nesting and view selection.
- [ ] 14.13 UI-test human action submission.
- [ ] 14.14 Run `npm run typecheck` and relevant workflow/package tests.

## 15. Explicit V3 Deferrals

- [ ] 15.1 Do not implement workflow templates.
- [ ] 15.2 Do not implement TypeScript export from UI workflows.
- [ ] 15.3 Do not implement workflow slash commands.
- [ ] 15.4 Do not implement workflow tools for agents.
- [ ] 15.5 Do not implement YAML/JSON import/export as product features.
- [ ] 15.6 Do not implement inline TypeScript in the UI.
- [ ] 15.7 Do not implement Zod schema authoring.
- [ ] 15.8 Do not implement inline nested workflow graph expansion.
