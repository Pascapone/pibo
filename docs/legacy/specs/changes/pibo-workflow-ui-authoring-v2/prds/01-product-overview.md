# PRD: Pibo Workflow UI Authoring V2 — Product Overview

**Status:** Draft  
**Created:** 2026-05-11  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: Workflow V1 can define, run, persist, and inspect workflows, but normal Pibo users cannot select workflows for Project sessions or author workflow definitions in Chat Web.
- **Proposed Solution**: Add Workflow UI Authoring V2 with a Workflows main-nav surface for browsing and editing definitions and a Projects execution surface for configuring, starting, and inspecting workflow-backed Project sessions.
- **Success Criteria**:
  - SC-01: A user can create a Project session, select a workflow version, configure allowed session values, and save the session without starting a run.
  - SC-02: A user can explicitly start the configured session and inspect the single workflow run attached to that Project session.
  - SC-03: A user can duplicate an existing workflow, edit it as a UI draft, validate it, and publish an immutable version.
  - SC-04: A historical run remains inspectable after the live workflow definition is archived or deleted.
  - SC-05: No V2 UI path allows inline TypeScript, raw XState authoring, workflow slash commands, workflow tools for agents, templates, TypeScript export, YAML/JSON product import/export, or Zod schema authoring.

## 2. User Experience & Functionality

- **User Personas**:
  - Normal Pibo user creating and running Project workflow sessions.
  - Workflow author composing existing registered capabilities into a reusable workflow.
  - Reviewer approving or resuming human waits in a Project run.
  - Developer or implementation agent verifying V2 product behavior against specs.

- **User Stories**:
  - As a Pibo user, I want to choose a workflow when I create a Project session so that the session starts with the right process.
  - As a Pibo user, I want session creation and workflow start to be separate so that I can configure before execution.
  - As a workflow author, I want to duplicate an existing workflow and edit it visually so that I can create variants without writing TypeScript.
  - As a workflow author, I want published workflow versions to be immutable so that existing runs remain explainable.
  - As a Project reviewer, I want pending human actions in the run view so that I can approve, reject, resume, or cancel work.

- **Acceptance Criteria**:
  - Chat Web has a Workflows main-nav tab for global workflow browsing, duplication, editing, validation, publishing, archiving, and deletion.
  - Projects provide workflow session creation, delayed start, run history, Workflow/XState run view, and human action controls.
  - Project sessions use per-session workflow selection; a Project can contain sessions using different workflows.
  - Existing V1 workflow runtime, registry, persistence, and inspection behavior remain valid.
  - UI-created workflows use Pibo Workflow IR and the existing workflow validator.

- **Non-Goals**:
  - Workflow templates.
  - TypeScript export from UI-authored workflows.
  - YAML/JSON import or export as a user-facing product feature.
  - Inline TypeScript or arbitrary executable code in the UI.
  - Workflow slash commands or workflow tools for agents.
  - Normal Sessions-tab workflow usage.
  - Project-wide default workflow selection.
  - Changing a session's workflow after creation.
  - Raw XState editing.
  - Marketplace or third-party workflow package discovery.
  - Zod migration.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Existing Pibo Workflow Registry, validator, runtime kernel, workflow store, and XState projection.
  - Existing Pibo Project Session, Pibo Session, Agent Designer profile, auth, event, and Chat Web infrastructure.
  - Registry read APIs for workflows, versions, handlers, adapters, guards, human actions, prompt assets, and non-archived Agent profiles.
  - Write APIs for drafts, publish, archive, delete, configured Project sessions, run start, and human actions.

- **Evaluation Strategy**:
  - Product-flow tests cover select-configure-save-start-inspect for a workflow Project session.
  - Builder tests cover duplicate-edit-validate-publish for a UI draft.
  - Negative tests cover invalid drafts, missing refs, incompatible edges, invalid raw IR, and attempts to change workflow after session creation.
  - Boundary tests verify V2 exposes no inline TypeScript, raw XState editing, templates, slash commands, agent workflow tools, or Zod schema path.

## 4. Technical Specifications

- **Architecture Overview**:
  - TypeScript-registered workflows and UI drafts both produce Pibo Workflow IR.
  - The Workflow Registry/store is the catalog boundary for code workflows, UI drafts, and UI-published workflows.
  - The Workflows tab edits definitions. Projects create configured sessions and start runs.
  - Runtime executes only valid published workflows or valid effective snapshots.
  - XState projection renders graph/run state but never becomes durable truth.

- **Integration Points**:
  - `packages/workflows` for Workflow IR, validation, registry resolution, execution, and XState projection.
  - Chat Web Workflows tab for catalog and builder surfaces.
  - Chat Web Projects area for session creation, run view, sidebar, and human actions.
  - Workflow store for drafts, published UI workflows, snapshots, run facts, wait tokens, and human actions.
  - Agent Designer for profile selection and prompt behavior.

- **Security & Privacy**:
  - The UI must not create executable code. It can only reference registered handlers, adapters, guards, workflows, and non-archived profiles.
  - Workflow inputs, outputs, prompts, state, edge payloads, and human action payloads remain subject to existing session/project visibility rules.
  - Historical run snapshots must preserve inspectability without exposing more than the original run allowed.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Workflow Library, Project workflow selection, delayed start, snapshot creation, run view links, and duplicate-to-draft.
  - v1.1: Visual builder, node/edge editing, validation panel, raw IR toggle, and publish/version lifecycle.
  - v1.2: Human action controls, richer run history, nested workflow sidebar support, archive/delete, and historical deleted-definition states.
  - v2.0 follow-up: Templates, export, import, marketplace, and richer authoring layers only if later approved.

- **Technical Risks**:
  - UI authoring diverges from runtime IR; mitigate by making Pibo Workflow IR the only saved definition format.
  - Users publish invalid or unsafe workflows; mitigate with validation gates and registered-capability-only composition.
  - Run inspection breaks after deletion; mitigate with immutable configuration/effective-definition snapshots.
  - V2 scope expands into code generation or marketplace behavior; mitigate with explicit non-goals and review gates.

## 6. Manual Smoke Checklists

### Project workflow execution smoke checklist

Use this checklist after deploys or before release signoff to verify the Project workflow path end to end.

1. Open Chat Web as an authenticated user and navigate to Projects.
2. Create or open a Project and choose the workflow-backed session creation option.
3. Select a published workflow version from the global workflow-version picker.
4. Configure allowed session values: session name, workflow input, eligible prompt overrides, model, thinking level, and fast mode where available.
5. Save the workflow Project session.
   - Expected before Start: the session is visible in a configured/not-started state, shows the selected workflow id/version and configuration summary, shows validation state, exposes an explicit Start action, and shows no workflow run record or run history yet.
6. Start the workflow from the configured session view.
   - Expected after Start: exactly one workflow run is attached to the Project session, duplicate Start attempts return the existing run, and the status is no longer configured/not-started. Depending on the workflow, the run status should progress through running, waiting, completed, failed, or cancelled.
7. Inspect the Project workflow run view.
   - Expected inspection sections: status, current node, run history, node attempts, edge transfers, output, errors, validation diagnostics, nested workflow links, definition link or definition-deleted state, and pending human actions. Each section must show populated values or an explicit empty state.
8. If the workflow reaches a human wait, resolve it from the Project run view and confirm the run resumes or records the selected terminal action.

### Workflow Builder authoring smoke checklist

Use this checklist after deploys or before release signoff to verify the workflow authoring path end to end.

1. Open Chat Web as an authenticated user and navigate to Workflows.
2. Pick an eligible code or UI-published workflow from the Workflow Library and choose Duplicate.
   - Expected duplicate result: the original workflow remains read-only if it is code-owned, and the UI opens or creates a separate editable draft backed by the Workflow Registry/store.
3. Open the draft in Workflow Builder and make a small visual edit, such as moving a node, editing workflow metadata, changing a registered capability selection, updating a prompt field, or editing raw JSON schema within the supported subset.
   - Expected draft behavior: the draft can be saved even when warning or error diagnostics exist, and visual/raw panels continue to show the same Pibo Workflow IR as the source of truth.
4. Run manual validation from the builder.
   - Expected diagnostics behavior: validation diagnostics refresh for the current draft, group by workflow/node/edge/schema/state/registry ref where applicable, show actionable codes and locations, preserve non-validation diagnostics, and block Publish while any error-severity diagnostic remains.
5. Fix blocking diagnostics by using picker-backed registered refs, compatible ports/adapters, valid JSON schema subset values, required workflow input/output contracts, and at least one node.
   - Expected ready-to-publish behavior: the validation panel shows no error-severity diagnostics, warnings remain visible but do not block publish unless the publish route reports an error.
6. Publish the draft with the intended semantic version bump.
   - Expected immutable version result: publish creates a published workflow version with a stable definition hash, the same `workflowId@version` cannot later be overwritten with different IR, and future edits use a new next-version draft instead of mutating the published version.
7. Reopen the Workflow Library and version history for the workflow.
   - Expected library result: the new version appears as published, the source/status actions match UI-published behavior, and Project workflow pickers can select the published version while excluding drafts.

### Historical archive/delete lifecycle smoke checklist

Use this checklist after lifecycle changes or before release signoff to verify the archive/delete behavior required by `06-versioning-archive-delete-lifecycle.md`.

1. Create and start a Project workflow session from a published UI-authored workflow, then confirm the run view records the selected workflow id/version, definition hash, configuration summary, and effective snapshot.
2. Archive the workflow from the Workflow Library lifecycle controls.
   - Expected archived selection behavior: the workflow is hidden from default Project workflow-version pickers and normal start/selection lists, remains visible only through explicit archived filters, version history, or historical run links, and existing Project run inspection still opens.
3. Reopen the historical Project run created before archival.
   - Expected archived run result: the run view keeps its snapshot-backed inspection sections and, when the live archived identity still exists, may link to the Workflows definition/version while clearly showing archived state.
4. Delete or tombstone the same workflow identity using the authenticated delete flow.
   - Expected live catalog result: the workflow is absent from default catalog, picker, duplicate, publish, archive, and Project-session selection surfaces.
5. Reopen the same historical Project run after deletion.
   - Expected snapshot-only result: the run view renders a clear `definition deleted` state, does not show a broken Workflows link, and continues to display the snapshot title, workflow id/version, effective definition hash, configuration summary, run status, node attempts, edge transfers, output, errors, and human action history from the stored Project snapshot.
