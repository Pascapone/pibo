# Tasks: Projects Room Parity and Modular Clean Start

**Status:** Draft
**Created:** 2026-07-03
**Related spec:** `docs/specs/changes/projects-room-parity-modular-clean-start/spec.md`

## Phase 0: Safety and Inventory

- [ ] T-001: Inventory current Projects and Workflows entry points.
  - Find primary nav links, routes, API calls, bootstrap dependencies, and workflow-specific Project UI.
  - Record what will be hidden, preserved, migrated, or removed from default flow.

- [ ] T-002: Decide the Project data representation.
  - Choose `PiboRoom.type = "project"`, `metadata.project = true`, or thin Project wrapper around Room id.
  - Document the decision before implementation.

- [ ] T-003: Define how Projects remain separate from normal Rooms.
  - Ensure normal Rooms with workspace are not classified as Projects.
  - Ensure Projects are listed in Projects, not mixed into the normal Rooms list unless explicitly linked.

## Phase 1: Project Creation and Workspace Contract

- [ ] T-004: Implement required workspace validation for Project creation.
  - Reject empty path.
  - Reject invalid/unsafe path.
  - Reject inaccessible existing path.

- [ ] T-005: Implement missing directory creation for Projects.
  - Create the directory before saving the Project.
  - Roll back/fail cleanly if creation fails.
  - Store canonical workspace path.

## Phase 2: Room-like Project Sessions

- [ ] T-006: Reuse Room Session creation behavior for Project Sessions.
  - Create normal Pibo Sessions associated with the Project.
  - Inherit the Project workspace for every new Project Session.

- [ ] T-007: Reuse Room Session UI behavior for the Project Sessions module.
  - Session list.
  - Create session.
  - Select session.
  - Rename/archive/delete where supported.
  - Terminal/composer surface.
  - Loading, empty, and error states.

## Phase 3: Workflow Clean Cut

- [ ] T-008: Disconnect workflow-specific features from the default Project flow.
  - Hide or remove workflow-backed Project Session creation from Projects UI.
  - Hide workflow run/start/configuration state from basic Project Sessions UI.
  - Hide or developer-gate the global Workflows tab.
  - Preserve workflow code and data.

## Phase 4: Project Module Shell

- [ ] T-009: Add a minimal Project module registry/interface.
  - Module id.
  - Label.
  - Route segment.
  - Enabled/disabled state.
  - Renderer or render hook.

- [ ] T-010: Register only the Sessions module for the clean-start phase.
  - Make Sessions the default module.
  - Ensure future modules do not render as session rows.

- [ ] T-011: Normalize Project routes.
  - `/projects` opens Projects.
  - `/projects/:projectId` opens default Sessions module.
  - `/projects/:projectId/sessions/:piboSessionId` opens selected Project Session.
  - Reserve or implement a future module route shape.
  - Use app-router navigation for default transitions.

## Phase 5: Robustness and Migration

- [ ] T-012: Fix Project bootstrap error handling.
  - No null dereference when bootstrap fails.
  - Clear recoverable error with retry.
  - Cover GitHub issue #171.

- [ ] T-013: Add safe compatibility/migration for existing Projects.
  - Existing valid `projectFolder` becomes Project workspace.
  - Invalid historical paths show repair-required state or are excluded with explicit diagnostics.
  - Workflow data remains preserved.

## Phase 6: Verification

- [ ] T-014: Add automated coverage for Project creation path validation.
  - Empty path rejected.
  - Missing path created.
  - Inaccessible path fails cleanly.

- [ ] T-015: Add automated coverage for Project Session workspace inheritance.
  - New Project Session has Project workspace.
  - Normal Room Session behavior remains unchanged.

- [ ] T-016: Add UI/route-level smoke test for the default Project flow.
  - Create Project.
  - Create Session.
  - Send message or exercise composer/terminal route.
  - Confirm workspace is in effect.

- [ ] T-017: Add regression coverage for failed/null Projects bootstrap.
  - Projects renders error state.
  - No `sharedDefaultProject` null crash.

- [ ] T-018: Verify workflow quarantine.
  - Default Projects UI has no workflow controls.
  - Workflow code still compiles.
  - Existing workflow data is not deleted.
