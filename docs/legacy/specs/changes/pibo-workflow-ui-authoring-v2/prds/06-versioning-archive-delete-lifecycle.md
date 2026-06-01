# PRD: Pibo Workflow UI Authoring V2 — Versioning, Archive, and Delete Lifecycle

**Status:** Draft  
**Created:** 2026-05-11  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: UI-authored workflows need a lifecycle that supports iterative editing without making historical runs ambiguous or mutating published behavior.
- **Proposed Solution**: Add draft/publish/version lifecycle with immutable published versions, automatic patch bumps, user-triggered minor/major bumps, workflow-level archive, authenticated delete, and snapshot-backed historical run inspection.
- **Success Criteria**:
  - SC-01: A valid draft can be published as an immutable workflow version.
  - SC-02: Publish increments patch by default and supports explicit minor or major version bumps.
  - SC-03: Editing a published workflow creates or reuses the one active draft for the next version path and never mutates the published version.
  - SC-04: Archive hides the whole workflow from default start/selection lists without deleting historical run data.
  - SC-05: Authenticated users can delete workflows even with historical runs, and those runs still render from snapshots.

## 2. User Experience & Functionality

- **User Personas**:
  - Workflow author iterating on a workflow.
  - Pibo user choosing a stable published workflow version.
  - Reviewer inspecting why an old run used a deleted or archived definition.
  - Operator cleaning the global workflow catalog.

- **User Stories**:
  - As a workflow author, I want drafts and published versions separated so that edits do not affect active users.
  - As a workflow author, I want automatic patch versions and manual major/minor choices so that version intent is explicit.
  - As a Pibo user, I want archived workflows hidden from normal selection so that I do not start deprecated workflows by accident.
  - As a reviewer, I want old runs to stay inspectable after deletion so that deletion does not erase operational history.

- **Acceptance Criteria**:
  - Published workflow versions are immutable.
  - One active draft exists per workflow/copy.
  - Users may create many copies by duplicating workflows.
  - Version history is visible and selectable.
  - Default publish increments patch unless the user chooses minor or major.
  - Archiving applies to the whole workflow, not a single version.
  - Archived workflows are hidden from default run/selection lists but visible through archive filters or historical run links.
  - Delete requires authentication but no additional V2 role.
  - Create/edit/publish/archive/delete permissions use the shared Workflow Registry permission matrix in `02-workflow-registry-catalog-and-draft-store.md`.
  - Historical Project runs show snapshot data and a clear “definition deleted” state when the live definition is gone.

- **Non-Goals**:
  - Per-version archive in V2.
  - Role-based workflow lifecycle permissions beyond authentication.
  - Permanent deletion of run snapshots needed for historical inspection.
  - Merging multiple active drafts for the same workflow/copy.
  - Marketplace review or approval flow.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Workflow Registry/store version records and immutable definition hashes.
  - Draft-to-published validation pipeline.
  - Archive/delete APIs with authentication.
  - Historical run snapshot lookup and deleted-definition display state.

- **Evaluation Strategy**:
  - Publish tests verify immutable stored definitions, definition hashes, and registry visibility.
  - Version tests verify patch/minor/major behavior and one-active-draft enforcement.
  - Archive tests verify default list hiding and explicit archive filter visibility.
  - Delete tests verify catalog removal/deleted marker behavior and historical run inspectability.

## 4. Technical Specifications

- **Architecture Overview**:
  - Draft records are mutable editor records.
  - Published records are immutable workflow version records with definition hash.
  - Archive applies at workflow identity level and changes catalog visibility/action derivation.
  - Delete removes or tombstones live catalog records while preserving run snapshots and references required for inspection.
  - Lifecycle actions must use the schema and permission matrix defined in `02-workflow-registry-catalog-and-draft-store.md`; any authenticated user may create, edit, publish, archive, or delete UI-authored workflows in V2, while code workflow projections remain read-only except duplicate.
  - Exact lifecycle API routes are defined in `09-implementation-completeness-contract.md` Section 4.3: catalog and lifecycle routes live under `/api/chat/workflows`, and delete uses `DELETE /api/chat/workflows/:workflowId` with confirmation input.

- **Deleted-Definition Display Decision**:
  - If a historical Project run references a live or archived workflow identity that still exists, the run view may link to the Workflows tab definition/version and must show archived state when relevant.
  - If the live workflow identity is tombstoned or missing, the run view must not render a broken Workflows link. It renders a snapshot-only `definition deleted` state using the run snapshot's title, workflow id/version, effective definition hash, and configuration summary.
  - Tombstoned workflows remain absent from normal catalog, picker, duplicate, publish, archive, and Project-session selection flows. Historical run access is allowed only through the Project/session that owns the snapshot.

- **Integration Points**:
  - Workflow Registry/store for draft, published, archived, deleted/tombstoned records, versions, and hashes.
  - Workflow Library and Builder for actions and version panels.
  - Project run view for links back to live definitions or snapshot-only deleted-definition state.
  - Auth layer for archive/delete endpoints.

- **Security & Privacy**:
  - Archive and delete require authenticated users.
  - Delete must not remove run snapshots that are required to explain historical execution.
  - Deleted live definitions must not leak beyond historical run access rules.
  - Version immutability protects users from silent behavior changes.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Publish immutable version, patch bump, version list, and edit-published-creates-draft.
  - v1.1: Minor/major bump UI, archive whole workflow, archived filters, and run definition links.
  - v1.2: Delete with historical snapshot state, tombstone handling, and deleted-definition UI tests.

- **Technical Risks**:
  - Deletion breaks run links; mitigate with the snapshot-only `definition deleted` state and tests that no broken live-definition link is rendered.
  - Version numbers collide under concurrent publish; mitigate with transactional publish/version allocation.
  - Users overuse delete because permissions are broad; mitigate with confirmation copy and immutable run snapshots.
