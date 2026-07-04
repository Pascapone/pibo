# Spec: Projects Room Parity and Modular Clean Start

**Status:** Draft
**Created:** 2026-07-03
**Requester / Source:** User product direction in Pibo session `ps_bc7a33da-f266-4b35-8d13-95a891ce9c3e`
**Related docs:**
- `docs/specs/changes/projects-room-parity-modular-clean-start/proposal.md`
- `docs/specs/capabilities/chat-web-projects-area.md`
- `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`
- `docs/specs/capabilities/chat-web-workflow-session-view.md`
- `docs/specs/capabilities/pibo-workflow-framework-package.md`
- GitHub issue: https://github.com/Pascapone/pibo/issues/171

## Why

Projects should be the project-scoped equivalent of Chat Web Rooms. Users should not have to learn a separate interaction model before they can work in a project. They should create a Project, give it a path, and then use sessions in that Project the same way they use sessions in a normal Room.

The current Projects and Workflows surfaces are too tightly coupled to workflow experiments and too weakly aligned with Rooms/Sessions. This creates fragile bootstrap paths, confusing UI, and a poor foundation for future project modules such as Workflows, Kanban/Todos, Project Knowledge, local Skills, project-scoped MCPs, hooks, or heartbeat/background agents.

## Goal

Rebuild Projects as semantically distinct, workspace-required Room-like containers whose first shipped module is Sessions, while preserving but disconnecting the existing workflow work until a later redesign reconnects it as a Project module.

## Background / Current State

Current Rooms already provide the desired baseline mental model: a Room contains Sessions, can have an optional workspace, and renders session lists and session views through the standard Chat Web surface.

Current Projects instead have separate project stores, bootstrap assumptions, custom Project Session records, workflow-specific session state, a Project Workflow Session view, and a Workflows tab that combines too many unrelated concepts. The code includes useful workflow assets, especially the graph canvas and workflow framework, but those assets should not drive the basic Project model.

The immediate user-facing problem is that Projects should be simple and reliable before workflow authoring or project-wide modules are layered back in.

## Scope

### In Scope

- Define Project as a Room-like product object with required workspace path.
- Keep Projects semantically distinguishable from normal Rooms.
- Require a workspace path on Project creation.
- Create the workspace directory when it does not exist.
- Route Project Sessions through the same Pibo Session behavior as normal Room Sessions.
- Ensure every Project Session uses the Project workspace as its working directory.
- Provide a minimal Project UI with a Sessions module as the default module.
- Define a Project module registry/interface that can later add Workflows, Kanban/Todos, Knowledge, Skills, MCPs, hooks, and heartbeat modules.
- Disconnect existing workflow-specific Project UI and the global Workflows tab from the default user flow without deleting code or data.
- Preserve existing workflow implementation files for later redesign and possible reattachment.
- Add migration/compatibility behavior for existing Project records where feasible.

### Out of Scope

- Rebuilding workflow authoring UX — deferred to a dedicated Workflows redesign.
- Deleting workflow code, workflow stores, graph editor code, workflow package code, or historical workflow data.
- Shipping Kanban/Todos, Project Knowledge, local Skills, project MCPs, hooks, or heartbeat modules.
- Running workflow graphs from Projects in this phase.
- Making normal Rooms require a workspace.
- Solving all historical Project data migration edge cases without explicit migration review.

## Requirements

### Requirement: Project is a semantically distinct Room-like container

The system MUST model Projects as semantically distinct from normal Rooms while preserving the Rooms/Sessions mental model for default Project usage.

#### Current

Projects are implemented as a separate Projects area with custom Project Session records and workflow-specific concepts. Normal Rooms are separate and have optional workspace metadata.

#### Target

A Project behaves like a Room for session creation, selection, archiving, navigation, and message flow. It remains identifiable as a Project through explicit type/capability metadata, not merely by the presence of a workspace.

#### Acceptance

- A Project appears in the Projects area, not as an ordinary Room in the normal Rooms list unless a deliberate cross-link is added.
- A normal Room does not become a Project only because it has a workspace.
- A Project can be identified by stable data, for example a room type/capability or project metadata.
- Session creation, selection, archiving, deletion, read state, and routing follow the same behavior as normal Room Sessions unless this spec explicitly says otherwise.

#### Scenario: Project remains semantically separate

- GIVEN a normal Room with a workspace
- AND a Project with a workspace
- WHEN the UI renders Rooms and Projects
- THEN the normal Room appears in the normal Rooms surface
- AND the Project appears in the Projects surface
- AND both use the same underlying Session behavior.

### Requirement: Project workspace is required and created when missing

The system MUST require a workspace path when creating a Project and MUST create that directory if it does not exist.

#### Current

Rooms can have optional workspace metadata. Current Projects have a `projectFolder`, but the product model and UI are not aligned with Room creation semantics.

#### Target

Project creation requires a valid path. If the path does not exist, Pibo creates it before the Project becomes usable. If the path cannot be created or is invalid, creation fails with a clear error.

#### Acceptance

- Project creation rejects an empty path.
- Project creation rejects invalid or unsafe paths with a clear message.
- Project creation creates a missing directory when permitted.
- Project creation fails without creating a partial Project when directory creation fails.
- Existing directory paths are accepted when accessible.
- Every created Project stores the canonical workspace path.

#### Scenario: Missing project directory is created

- GIVEN the user enters a Project name and a workspace path that does not exist
- WHEN the user creates the Project
- THEN Pibo creates the directory
- AND the Project is saved
- AND new sessions in that Project run with that directory as workspace.

#### Scenario: Empty path is rejected

- GIVEN the user enters a Project name without a workspace path
- WHEN the user creates the Project
- THEN creation fails
- AND no Project record is saved
- AND the UI explains that Projects require a working directory.

### Requirement: Project Sessions have Room Session parity

The system MUST let users create and use normal Sessions inside a Project with visual and behavioral parity to normal Room Sessions.

#### Current

Project Sessions are stored and rendered through a custom Projects sidebar and custom Project Session model. Workflow concepts are visible in the basic Projects flow.

#### Target

The first Project module is Sessions. It reuses the normal Room Session behavior as closely as possible. The only required behavioral difference is that Project Sessions always inherit the Project workspace.

#### Acceptance

- A user can create a new Session from a Project.
- The new Session is associated with the Project.
- The new Session uses the Project workspace as `workspace`/working directory.
- The Session composer, terminal/output view, session title, archive/delete actions, loading states, and session selection match normal Room behavior.
- No workflow configuration is required to start a normal Project Session.
- The UI does not show workflow state, workflow run ids, or graph concepts in the basic Sessions module.

#### Scenario: New Project Session behaves like a Room Session

- GIVEN a Project with workspace `/repo/app`
- WHEN the user creates a new Project Session
- THEN a Pibo Session is created in that Project
- AND the Pibo Session workspace is `/repo/app`
- AND the user can send messages and view output through the standard session surface.

### Requirement: Existing workflow work is preserved but disconnected

The system MUST preserve existing workflow code and data while removing workflow-specific UI and behavior from the default Project and Workflows user path for this clean-start phase.

#### Current

Projects expose workflow-backed sessions, workflow start/configuration panels, workflow state, and workflow-specific views. The global Workflows tab exposes an overloaded workflow library/editor/publish surface.

#### Target

Workflow implementation remains in the repository for later redesign. It is not deleted. However, the default Projects experience does not expose workflow-backed Project Sessions, workflow graph execution, workflow draft editing, or global Workflows tab entry points unless a deliberate developer/debug flag keeps them reachable for preservation work.

#### Acceptance

- The primary navigation does not encourage users into the current Workflows tab as a normal product surface.
- The Projects area does not show workflow session creation/configuration controls in the basic phase.
- Existing workflow routes/code may remain behind a disabled, hidden, or developer-only entry point.
- Existing workflow data is not destroyed.
- Tests or smoke checks verify that normal Project Sessions do not require workflow bootstrap data.

#### Scenario: Basic Project flow has no workflow dependency

- GIVEN the workflow catalog or workflow draft store is unavailable
- WHEN the user opens Projects and creates a normal Project Session
- THEN the Project flow still works
- AND no workflow-specific UI is required.

### Requirement: Project UI is modular but starts with Sessions only

The system MUST expose an internal Project module interface that allows additional project-scoped views later, while initially shipping only the Sessions module.

#### Current

Project UI is a custom layout with workflow-specific sections mixed into the same sidebar. Future modules do not have a clear extension point.

#### Target

The Project surface separates Project identity, module navigation, and active module content. Sessions is the default module. Future modules can register a sidebar entry and render a Project-scoped main view without becoming Session nodes.

#### Acceptance

- The Project UI has a stable place for Project module navigation.
- The default selected module is Sessions.
- The Sessions module renders Project Sessions.
- Non-session modules are represented as module entries, not as fake session rows.
- Module registration can carry id, label, route segment, enabled/disabled state, and renderer/view model hook.
- Disabled or unavailable modules do not break the Project shell.

#### Scenario: Future Kanban module is not a session

- GIVEN a future `kanban` Project module is registered
- WHEN the user opens a Project
- THEN `Kanban` can appear as a module entry
- AND its cards/tasks render in the Project main area
- AND those cards/tasks do not appear as sessions in the Sessions list.

### Requirement: Project navigation is predictable and Room-like

The system MUST provide predictable routes for Project list, Project detail, Project Sessions, and future Project modules.

#### Current

Projects use routes such as `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId`, with workflow-specific routes and side effects layered into the area.

#### Target

Project routes preserve the simple mental model:

- Project list.
- Selected Project.
- Selected Project module.
- Selected Session when the active module is Sessions.

Workflow-specific routes are not part of the default clean-start Project route contract.

#### Acceptance

- `/projects` opens the Projects surface.
- `/projects/:projectId` opens the Project with the default Sessions module.
- `/projects/:projectId/sessions/:piboSessionId` opens the selected Project Session.
- A future module route shape exists or is reserved, for example `/projects/:projectId/modules/:moduleId`.
- Unknown module ids show a recoverable not-found or disabled-module state.
- Navigation uses the app router rather than hard browser reloads for normal UI transitions.

#### Scenario: Opening a Project selects Sessions

- GIVEN a Project exists
- WHEN the user opens `/projects/:projectId`
- THEN the Project shell loads
- AND the Sessions module is selected
- AND the Project Session list is visible.

### Requirement: Bootstrap errors are recoverable

The system MUST not crash the React tree when Project bootstrap data is missing, invalid, or fails to load.

#### Current

A user observed `Cannot read properties of null (reading 'sharedDefaultProject')` in the Projects area. This indicates that the UI can dereference missing bootstrap data after loading fails or returns invalid data.

#### Target

Projects show loading, empty, error, or retry states for failed bootstrap. The UI never masks the original failure with a secondary null dereference.

#### Acceptance

- Opening Projects cannot produce `Cannot read properties of null (reading 'sharedDefaultProject')`.
- Failed Project bootstrap renders a clear error with retry/refresh guidance.
- Invalid bootstrap payloads are handled defensively.
- The default Project flow does not depend on workflow bootstrap data.

#### Scenario: Bootstrap returns null

- GIVEN the Projects bootstrap request returns null or an invalid payload
- WHEN the Projects area renders
- THEN it shows a recoverable error state
- AND no component reads properties from null.

### Requirement: Existing data is handled safely during migration

The system MUST define safe compatibility behavior for existing Project and workflow records before changing stores or route ownership.

#### Current

Existing Projects may live in `.pibo/web-projects.sqlite`, while Rooms and Sessions use the main Chat Web/Pibo stores. Workflow drafts and versions may live in separate stores.

#### Target

The implementation either migrates existing Project records into the new Project-as-Room representation or preserves them behind a compatibility path. It must not silently delete Projects, Sessions, workflow snapshots, workflow runs, drafts, or published versions.

#### Acceptance

- A migration/compatibility decision is documented before destructive changes.
- Existing Projects with `projectFolder` can become Project Rooms with required workspace when valid.
- Invalid historical Project paths are surfaced as repair-required records, not silently ignored.
- Existing normal Sessions remain unaffected.
- Existing workflow records remain preserved even if workflow UI is disconnected.

#### Scenario: Existing Project with valid folder is migrated

- GIVEN an existing Project record has `projectFolder=/repo/app`
- WHEN the migration/compatibility layer loads Projects
- THEN the Project is available in the new Projects surface
- AND its workspace is `/repo/app`
- AND normal Project Sessions can be created there.

## Edge Cases

- Workspace path already exists but is not a directory.
- Workspace path does not exist and cannot be created because of permissions.
- Workspace path is relative; implementation must define whether it is resolved against Pibo home, current process CWD, or rejected.
- Existing Project records reference missing or inaccessible folders.
- Existing Project Sessions point at deleted Pibo Sessions.
- Workflow stores are unavailable while Projects are opened.
- Normal Rooms with workspace metadata must not be misclassified as Projects.
- Project module registry has no optional modules enabled.
- User opens an old workflow route after workflow UI is disconnected.

## Constraints

- **Compatibility:** Do not delete workflow code or data during the clean start. Preserve historical workflow artifacts for a later redesign.
- **Security / Privacy:** Workspace paths may expose local filesystem structure. UI and logs should avoid leaking unnecessary path details outside Project configuration and diagnostics.
- **Filesystem Safety:** Project creation must avoid unsafe path handling. Creation must fail clearly when a path cannot be created or is not usable.
- **Behavioral Parity:** Project Sessions should match normal Room Sessions in user-visible behavior except for the required workspace.
- **Modularity:** Project modules must be Project-scoped and must not masquerade as Sessions.
- **Routing:** Normal app navigation should use the Chat Web router, not hard reloads, for default Project flows.
- **Verification:** The default Project creation/session flow must be validated through the real Chat Web UI or an equivalent route-level/browser smoke test, not only through isolated unit tests.

## Success Criteria

- [ ] SC-001: Users can create a Project only with a non-empty workspace path.
- [ ] SC-002: Missing workspace directories are created during Project creation when permitted.
- [ ] SC-003: Project Sessions can be created and used like normal Room Sessions.
- [ ] SC-004: Every Project Session runs with the Project workspace.
- [ ] SC-005: Basic Projects UI contains no workflow configuration/start/run concepts.
- [ ] SC-006: Current workflow code and data are preserved but not exposed in the default Project flow.
- [ ] SC-007: The Project shell has a module interface with Sessions as the only initially enabled module.
- [ ] SC-008: Project bootstrap failure shows a recoverable error instead of crashing.
- [ ] SC-009: Existing normal Rooms and Sessions keep their current behavior.
- [ ] SC-010: A browser or route-level smoke test covers Project creation, Project Session creation, message send, and workspace use.

## Assumptions and Open Questions

### Assumptions

- Project documentation remains in English, matching existing Pibo specs.
- The clean-start implementation should prefer reusing Room/Session code paths over extending the current custom Project Session stack.
- Workflow code should remain compileable even if hidden from primary navigation.
- The default Project module set for this phase is exactly `sessions`.

### Open Questions

- Should Projects be represented as `PiboRoom.type = "project"`, as `metadata.project = true`, or as a separate Project wrapper around a Room id?
- Should Project workspace paths be absolute-only, or may the UI accept relative paths and resolve them against a known base?
- Should normal Rooms and Projects share one physical `rooms` table with different type/capability metadata, or should Projects keep a thin table that references a Room id?
- What is the temporary access policy for old workflow routes: hidden route, developer flag, or redirect to a redesign notice?
- How much historical Project data must be migrated in the first implementation pass?
- Should the Project list include a default/shared Project, or should Projects be explicitly user-created only?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Project is a semantically distinct Room-like container | Project remains semantically separate | `tasks.md` T-002, T-003 | Pending |
| REQ-002 Project workspace is required and created when missing | Missing directory is created; empty path is rejected | `tasks.md` T-004, T-005 | Pending |
| REQ-003 Project Sessions have Room Session parity | New Project Session behaves like a Room Session | `tasks.md` T-006, T-007 | Pending |
| REQ-004 Existing workflow work is preserved but disconnected | Basic Project flow has no workflow dependency | `tasks.md` T-001, T-008 | Pending |
| REQ-005 Project UI is modular but starts with Sessions only | Future Kanban module is not a session | `tasks.md` T-009, T-010 | Pending |
| REQ-006 Project navigation is predictable and Room-like | Opening a Project selects Sessions | `tasks.md` T-011 | Pending |
| REQ-007 Bootstrap errors are recoverable | Bootstrap returns null | `tasks.md` T-012 | Pending |
| REQ-008 Existing data is handled safely during migration | Existing Project with valid folder is migrated | `tasks.md` T-013 | Pending |
