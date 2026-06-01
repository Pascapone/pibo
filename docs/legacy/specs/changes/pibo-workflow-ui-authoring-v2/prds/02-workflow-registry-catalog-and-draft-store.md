# PRD: Pibo Workflow UI Authoring V2 — Workflow Registry, Catalog, and Draft Store

**Status:** Draft  
**Created:** 2026-05-11  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: V1 has a code-oriented Workflow Registry, but V2 needs one catalog that can show code workflows, UI drafts, and UI-published versions with lifecycle actions and diagnostics.
- **Proposed Solution**: Extend the Workflow Registry/store model with global workflow records, explicit `source` and `status`, invalid draft support, version listing, missing-reference diagnostics, and editor picker metadata.
- **Success Criteria**:
  - SC-01: Catalog APIs list code workflows, UI drafts, and UI-published workflows with source/status metadata.
  - SC-02: A UI draft can be saved while incomplete or invalid, but invalid raw IR text cannot overwrite the last valid draft object.
  - SC-03: Each workflow/copy has at most one active draft.
  - SC-04: Missing handler, adapter, guard, profile, prompt asset, or nested workflow refs produce structured diagnostics with ids and locations.
  - SC-05: Workflow Library actions can be derived from record source/status without special-case UI guesses.

## 2. User Experience & Functionality

- **User Personas**:
  - Workflow author browsing available workflows and drafts.
  - Pibo user selecting a workflow for a Project session.
  - Developer registering handlers, adapters, guards, workflows, or prompt assets.
  - Reviewer debugging catalog and missing-reference errors.

- **User Stories**:
  - As a workflow author, I want one Workflow Library to show code and UI workflows so that I do not search multiple places.
  - As a workflow author, I want drafts to save before they are runnable so that I can build workflows incrementally.
  - As a workflow author, I want code workflows to be duplicable but not directly editable so that code-owned definitions stay stable.
  - As a reviewer, I want missing refs to identify the broken id and location so that I can fix the draft or registry.

- **Acceptance Criteria**:
  - Workflow records distinguish `source: "code" | "ui"` from `status: "draft" | "published" | "archived"`.
  - UI drafts live in the Workflow Registry/store, not in Project session state.
  - Draft definitions may be partial or invalid and include diagnostics.
  - Invalid raw IR parse results show a warning and preserve the last valid persisted draft object.
  - Catalog entries show id, title, description, tags, examples where present, source, status, versions, editability, validation state, missing refs, and actions.
  - Picker APIs expose registered handlers, adapters, guards, human actions, prompt assets, and non-archived Agent profiles.

- **Non-Goals**:
  - User-private workflow catalogs in V2.
  - Project-scoped workflow definitions in V2.
  - Editing code-registered workflow records directly.
  - Creating new executable handlers, adapters, or guards from UI.
  - Storing invalid raw text as the canonical workflow definition.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Workflow Registry resolution for definitions, versions, handlers, adapters, guards, human actions, prompt assets, profiles, and nested workflows.
  - Existing workflow validation functions, including JSON Schema subset validation and graph validation.
  - Catalog/picker APIs consumable by Chat Web.

- **Evaluation Strategy**:
  - Catalog tests verify global visibility, source/status derivation, archived filtering, and version ordering.
  - Draft tests verify incomplete draft save, one-active-draft enforcement, duplicate-to-draft, and raw IR parse protection.
  - Registry-ref tests remove handlers/adapters/guards/profiles/nested workflows and verify structured missing-reference diagnostics.

## 4. Technical Specifications

- **Architecture Overview**:
  - Code workflows remain registered by TypeScript/plugin code and are read-only catalog records.
  - UI drafts and UI-published workflows are persisted in the Workflow Registry/store.
  - Published UI workflows are registry-resolvable by id/version and executable like code-registered workflows.
  - Drafts are editor objects until published; runtime never executes invalid drafts.

- **Workflow Registry Store Schema Decision**:

  The V2 Workflow Registry/store persists UI-authored workflow identities, drafts, published versions, archive markers, and delete tombstones. Code-registered workflows are projected into the catalog from the existing code registry and stay read-only; they are not mutated by the UI store. Persisted records use authenticated user ids for audit fields only. V2 does not add owner-private workflow access rules.

  | Entity | Key | Required fields | Rules |
  |---|---|---|---|
  | Workflow identity | `workflowId` | `title`, `description`, `tags`, `source: "ui"`, `createdBy`, `createdAt`, `updatedBy`, `updatedAt`, optional `currentDraftId`, optional `latestVersion` | One identity per UI-authored workflow/copy. It groups the active draft, published versions, archive state, and delete/tombstone state. Code workflows expose catalog identities as projections only. |
  | Draft record | `draftId` plus `workflowId` | `status: "draft"`, `baseWorkflowId`, `baseWorkflowVersion`, `baseDefinitionHash`, `versionIntent` (`patch`, `minor`, or `major`), `definition: PartialWorkflowDefinition`, `diagnostics`, `validationState`, `revision`, audit timestamps | One active draft per workflow identity. The draft definition may be incomplete or workflow-invalid, but it is still a parsed Workflow IR object. Invalid raw text is a client/editor buffer and must not replace `definition`. |
  | Published version record | `workflowId` plus `version` | `status: "published"`, immutable `definition: WorkflowDefinition`, `definitionHash`, `publishedFromDraftId`, `publishedBy`, `publishedAt`, `createdAt` | Each version is immutable after publish and registry-resolvable by `workflowId`/`version` while the identity is not deleted. Publishing requires a valid draft with no error diagnostics. |
  | Archive state | `workflowId` | `archived: boolean`, optional `archivedAt`, optional `archivedBy`, optional `archiveReason` | Archive applies to the whole workflow identity, not to individual versions. Archived workflows are hidden from default catalog, picker, and Project session selection lists and can appear only through explicit archive filters or historical run links. |
  | Delete/tombstone state | `workflowId` | `deleted: boolean`, optional `deletedAt`, optional `deletedBy`, `lastKnownTitle`, `lastKnownVersion`, optional `lastDefinitionHash` | Delete hides the live catalog identity and blocks new draft, publish, archive, duplicate, and Project-session selection actions. Historical Project runs continue to render from their own snapshots; delete must not remove run snapshots. |

  Catalog projections derive `source` and `status` from these entities:

  - code registry projection: `source: "code"`, `status: "published"`, read-only except duplicate;
  - active UI draft: `source: "ui"`, `status: "draft"`;
  - unarchived UI published version: `source: "ui"`, `status: "published"`;
  - archived UI identity: `source: "ui"`, `status: "archived"` when an archive filter or historical link requests it;
  - deleted UI identity: not listed in normal catalog responses; historical run views use snapshots plus the tombstone label.

- **Permission Matrix Decision**:

  All actions require an authenticated user. `createdBy`, `updatedBy`, `publishedBy`, `archivedBy`, and `deletedBy` are audit fields, not ownership gates, because V2 workflows are global. Role-based or owner-private permissions are deferred beyond V2.

  | Action | Code workflow projection | UI draft | UI published, unarchived | UI archived or tombstoned | V2 rule |
  |---|---|---|---|---|---|
  | View | Allowed | Allowed | Allowed | Archived: explicit filter or historical link. Tombstoned: historical snapshot/tombstone label only. | Catalog/list/inspect APIs require authentication. |
  | Duplicate | Allowed; creates a new UI identity and active draft. | Not a separate action; edit the active draft. | Allowed; creates a new UI identity and active draft from the selected version. | Not allowed from tombstones; archived duplicates are deferred unless a later story explicitly enables them. | Duplicate never mutates the source workflow/version. |
  | Create draft | Not allowed directly; duplicate first. | Not allowed when the workflow already has an active draft. | Allowed as the next-version draft for that workflow when no active draft exists. | Not allowed. | Enforce one active draft per workflow/copy. |
  | Edit draft | Not allowed. | Allowed. | Not allowed; create a next-version draft first. | Not allowed. | Any authenticated user may edit global UI drafts in V2. |
  | Publish | Not allowed. | Allowed only when validation has no error diagnostics and registered references resolve. | Not allowed; publish from a draft. | Not allowed. | Publish creates a new immutable version record. |
  | Archive | Not allowed for code projections. | Allowed at workflow identity level. | Allowed at workflow identity level. | Already archived: idempotent/no-op. Tombstoned: not allowed. | Any authenticated user may archive UI-authored workflows in V2. |
  | Delete | Not allowed for code projections. | Allowed at workflow identity level. | Allowed at workflow identity level. | Archived: allowed. Tombstoned: idempotent/no-op. | Any authenticated user may delete UI-authored workflows in V2; historical snapshots remain. |

- **Implementation Story References**:
  - Catalog entity, list, inspect, action derivation, and auth stories (`prd_02` US-002, US-005, US-009, US-010) MUST implement the schema and permission matrix above.
  - Draft persistence, raw edit safety, and duplicate-to-draft stories (`prd_02` US-003, US-004, US-006) MUST use the workflow identity plus one-active-draft rule above.
  - Publish, version, archive, and delete lifecycle stories (`prd_06` US-001 through US-008) MUST use these entities for immutable versions, workflow-level archive, and delete/tombstone behavior.

- **Remaining Implementation Details**:
  - Physical database layout may use normalized tables or JSON columns, but the API-facing entities and lifecycle invariants above are normative.
  - Exact HTTP route paths are defined in `09-implementation-completeness-contract.md` Section 4.3. Catalog and lifecycle routes live under `/api/chat/workflows`.

- **Integration Points**:
  - Workflow Registry/store for code workflow projection, UI drafts, UI-published versions, archive/delete markers, and metadata.
  - Chat Web Workflow Library and Builder for list, inspect, duplicate, edit, validate, publish, archive, and delete actions.
  - Agent Designer profile catalog for non-archived profile picker results.
  - Prompt asset store/editor where prompt assets are editable.

- **Security & Privacy**:
  - Catalog APIs require authentication.
  - UI-authored workflows are global in V2; callers must not imply private ownership.
  - Diagnostics should reveal missing ids and locations without dumping sensitive prompt/input/output payloads.
  - Code workflows stay code-owned to avoid UI mutation of plugin-defined behavior.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Catalog list/inspect, source/status metadata, duplicate-to-draft, draft save, and picker APIs.
  - v1.1: Missing-reference diagnostics, validation summaries, archived filters, and version history.
  - v1.2: Prompt asset integration, richer catalog search/filtering, and deleted-definition run states.

- **Technical Risks**:
  - Draft schema becomes a second workflow language; mitigate by wrapping `PartialWorkflowDefinition` and publishing only valid `WorkflowDefinition` IR.
  - Global workflows create accidental edits by any user; mitigate with immutable published versions, source/status actions, and explicit archive/delete affordances.
  - Missing refs surface only at runtime; mitigate by validating on draft load, picker render, publish, session creation, and run start.
