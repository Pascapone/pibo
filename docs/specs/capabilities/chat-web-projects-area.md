# Spec: Chat Web Projects Area

**Status:** Draft
**Created:** 2026-05-05
**Updated:** 2026-05-17
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** `GLOSSARY.md`, [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Pibo Session Routing](./pibo-session-routing.md), [Current workflow docs](../../project/workflows.md), [Workflow runtime foundation and manual trigger](../changes/workflow-runtime-foundation-manual-trigger/spec.md), [Legacy Pibo Workflow System V1](../../legacy/specs/changes/pibo-workflow-system-v1/spec.md)

## Why

The Chat Web App needs a project-focused work surface for coding work without overloading Rooms. The current implementation adds a `Projects` area with separate project persistence, project-folder-backed Pibo Sessions, and workflow metadata while reusing the normal chat, trace, signal, profile, and session-routing behavior.

This spec records the implemented Projects behavior as a source-backed capability contract. It replaces the earlier proposal-style Projects document with requirements that can be checked against the current code.

## Goal

The system SHALL let an authenticated Chat Web user manage project containers and project sessions that route through normal Pibo Sessions while preserving project-specific storage, workspace, navigation, archive state, and workflow metadata.

## Background / Current State

Current code defines `ChatProjectService` backed by `.pibo/web-projects.sqlite`. The Projects area uses routes under `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId`. Server APIs live under `/api/chat/projects*` and `/api/chat/project-sessions/*`. Project Sessions are normal Pibo Sessions created through the web channel with their workspace set to the Project folder and metadata that links them back to the Project.

The Projects API now has two creation paths: normal Project chat sessions still use `simple-chat`, while `/api/chat/projects/:projectId/workflow-sessions` creates configured workflow-backed Project Sessions from published workflow catalog versions. Configured workflow sessions store workflow id/version, session-scoped configuration, a workflow definition snapshot, validation results, and lifecycle events; they do not create a workflow run until the user explicitly starts the session.

## Scope

### In Scope

- Project and Project Session persistence in the Projects store.
- Shared default Project bootstrap behavior.
- Project CRUD API behavior exposed by Chat Web.
- Project Session creation, rename, archive, and message sending.
- Project route selection and bootstrap payload behavior.
- Workflow metadata, configuration snapshots, run records, wait tokens, human actions, definition links, and lifecycle events currently stored or surfaced for Project Sessions.

### Out of Scope

- Implementing full workflow node execution beyond configured-session records, run-start records, and workflow inspection metadata — covered by the workflow change specs.
- Docker worker or worktree lifecycle for Project Sessions — not performed by `simple-chat` Projects code.
- Team, role, admin, or per-project account permissions.
- Git, CI, file-browser, and deployment integrations.
- Replacing or changing the Rooms/Sessions area.

## Requirements

### Requirement: Projects use a separate local store

The system MUST store Project containers and Project Session links in a Projects-managed SQLite store, separate from Chat Web rooms and from the Pibo Session Store.

#### Current

`ChatProjectService` opens `.pibo/web-projects.sqlite` by default and creates `projects` and `project_sessions` tables. Pibo Sessions remain stored and routed separately.

#### Acceptance

A fresh Projects store initializes both tables, enforces unique project names case-insensitively, enforces unique project folders, and indexes project sessions by project/archive/creation order.

#### Scenario: Fresh Projects store

- GIVEN no Projects database exists
- WHEN Chat Web constructs `ChatProjectService`
- THEN `.pibo/web-projects.sqlite` is created with Projects tables
- AND no Room records are required to list Projects.

### Requirement: Shared default Project is created on bootstrap

The system MUST create one deterministic shared default Project when the Projects bootstrap needs it and it does not already exist.

#### Current

`ensureSharedDefaultProject` creates or returns the shared default Project, names it `Shared Project`, marks shared-default metadata, and creates the default folder under `.pibo/projects/workspace` unless a folder override is supplied. Legacy ids may retain the old `personal_` prefix for compatibility.

#### Acceptance

Calling Projects bootstrap twice returns the same shared default Project and does not create duplicate default rows.

#### Scenario: First Projects visit

- GIVEN the app context has no default Project
- WHEN an allowed user opens `/projects`
- THEN bootstrap returns the shared default Project
- AND that project is marked as the shared default
- AND its folder exists on disk.

### Requirement: Project creation validates name and folder

The system MUST require a non-empty project name and absolute project folder, normalize `~` paths, and reject duplicate names or folders before creating a Project.

#### Current

The web API normalizes `~` and `~/...`, resolves the path, optionally creates the folder, and returns `400` for invalid input or store validation errors.

#### Acceptance

Creating a Project without a name, with a relative folder, with a duplicate name, or with a duplicate folder fails with a client error and does not insert a Project row.

#### Scenario: Create project with folder

- GIVEN an authenticated user
- WHEN the user posts `{ name, projectFolder, createFolder: true }` to `/api/chat/projects`
- THEN the response status is `201`
- AND the Project has a generated `prj_` id
- AND the stored folder is absolute and unique.

### Requirement: Project archive and delete are explicit

The system MUST archive Projects by setting `archivedAt`, hide archived Projects by default, and require an exact name confirmation before permanent delete.

#### Current

`PATCH /api/chat/projects/:projectId` accepts `archived: boolean`. `DELETE /api/chat/projects/:projectId` requires `confirmName`; the store rejects deletion unless the project is already archived and optionally removes the project folder when `deleteFiles` is true.

#### Acceptance

Archived Projects are excluded from default listing and included only when requested. Delete fails unless the Project is archived and the confirmation equals the current project name.

#### Scenario: Delete archived project

- GIVEN an archived Project named `Client App`
- WHEN the user deletes it with `confirmName: "Client App"`
- THEN the project row and its project-session links are removed
- AND the folder is removed only if `deleteFiles` is true.

### Requirement: Project Sessions are normal routed Pibo Sessions with project metadata

The system MUST create each Project Session as a normal Pibo Session in the Chat Web channel and store a Project Session link keyed by the Pibo Session ID.

#### Current

`createProjectChatSession` calls `channelContext.createSession` with `channel: CHAT_WEB_CHANNEL`, `kind: "chat"`, selected profile, app context context, workspace equal to the Project folder, and metadata containing `projectId`, `projectSessionKind: "main"`, and `projectWorkflowId`.

#### Acceptance

A created Project Session can be retrieved from the session router by its Pibo Session ID and from the Projects store as a Project Session link. Its runtime workspace is the Project folder.

#### Scenario: Create Project Session

- GIVEN a configured Project with folder `/work/app`
- WHEN the user creates a Project Session for that Project
- THEN the created Pibo Session has workspace `/work/app`
- AND its metadata contains the Project id and workflow id
- AND the Projects store records the same Pibo Session ID.

### Requirement: Project workflow sessions use published workflow catalog versions

The system MUST keep normal Project chat creation on `simple-chat` while allowing workflow-backed Project Sessions to be created only from explicit published workflow id/version selections.

#### Current

`POST /api/chat/projects/:projectId/sessions` creates a normal `simple-chat` Project Session. `POST /api/chat/projects/:projectId/workflow-sessions` requires explicit `workflowId` and `workflowVersion`, resolves them through the published workflow version catalog, rejects draft, archived, deleted, unknown, or validation-failing versions, stores the session in `configured` state, and saves an immutable workflow session snapshot with configuration and validation metadata.

#### Acceptance

Normal Project session creation without a workflow selection creates `simple-chat`. Workflow-backed creation with `standard-project@1.0.0` succeeds when validation passes and stores the selected workflow version. Workflow-backed creation with a draft, archived, deleted, missing, or validation-failing workflow version fails before inserting a Project Session link.

#### Scenario: Configured workflow Project Session

- GIVEN a Project exists
- AND `standard-project@1.0.0` is a published workflow catalog version
- WHEN the user posts that workflow id/version to `/api/chat/projects/:projectId/workflow-sessions`
- THEN the response status is `201`
- AND the Project Session state is `configured`
- AND a workflow session snapshot stores the selected definition, configuration, hashes, and validation summary.

### Requirement: Workflow runs start explicitly and remain one-per-session

The system MUST NOT start a workflow run when a configured Project Session is created, and MUST create at most one workflow run for that Project Session when start succeeds.

#### Current

`POST /api/chat/projects/:projectId/workflow-sessions/:piboSessionId/start` requires same-origin JSON, resolves the managed Project Session, loads its snapshot, revalidates the effective definition, records validation and start lifecycle events, then calls `startWorkflowSessionRun`. The store rejects changing the selected workflow id/version and enforces one `project_workflow_runs` row per Pibo Session.

#### Acceptance

Creating a workflow Project Session leaves `workflowRunId` empty. Starting it after validation creates a `wfr_` run, changes the Project Session state to `running`, updates session metadata with the run id, and returns the existing run on repeat start calls.

#### Scenario: Explicit workflow start

- GIVEN a configured workflow Project Session with no run
- WHEN the user starts it
- THEN validation runs against the saved snapshot
- AND a workflow run is stored only if validation passes
- AND starting the same session again returns the existing run instead of creating a second run.

### Requirement: Workflow-run links preserve main/sub distinction

The Projects store MUST support linking workflow-run-backed Pibo Sessions and preserve whether a linked session is a main session or a sub-session.

#### Current

`linkWorkflowRunSession` calls `addProjectSession` with state `workflow`; it sets `kind: "sub"` when `parentMainSessionId` is supplied, otherwise `kind: "main"`. Main Project Sessions update the parent Project's `currentMainSessionId`; sub-sessions do not replace it.

#### Acceptance

Linking a workflow child with `parentMainSessionId` stores `kind: "sub"`, the workflow run id, the workflow id, and the parent main session id while leaving the Project's current main session unchanged.

#### Scenario: Link child workflow run

- GIVEN a Project with current main Project Session `ps_main`
- WHEN a workflow run session `ps_child` is linked with `parentMainSessionId: "ps_main"`
- THEN the Project Session has `kind: "sub"`
- AND `workflowRunId` is stored
- AND the Project's `currentMainSessionId` remains `ps_main`.

### Requirement: Projects bootstrap resolves selection and session tree

The system MUST return a bootstrap payload that includes project identity, selected Project, Project Sessions, selected Pibo Session, session nodes, catalog data, and profile/model capability data needed by the Projects UI.

#### Current

`GET /api/chat/projects/bootstrap` ensures the shared default Project, selects the requested Project or shared default Project, creates a shared default Project `simple-chat` session if none exists, selects the requested session/current main/first available session, builds session nodes for the Project folder, applies Project Session archive state, enriches workflow-backed sessions with definition links and pending human actions, includes recent workflow lifecycle events, and appends catalog data.

#### Acceptance

A bootstrap response always includes `sharedDefaultProject`, `selectedProjectId`, `projectSessions`, `workflowLifecycleEvents`, `sessions`, and catalog fields. When a selected Pibo Session exists, the response includes `session` and `selectedPiboSessionId` matching that session.

#### Scenario: Shared default Project empty state

- GIVEN the shared default Project exists with no Project Sessions
- WHEN bootstrap is requested without a project id
- THEN a `simple-chat` Project Session is created
- AND that session is selected in the response.

### Requirement: Project messages target shared Project Sessions and are logged as chat events

The system MUST send Project messages only to existing Project Sessions and MUST append a durable accepted-message event before emitting the routed message.

#### Current

`POST /api/chat/projects/message` requires same-origin JSON and an authenticated session. It checks that the target Pibo Session exists, checks that the session is linked as a Project Session, deduplicates by client transaction id, appends `user.message.accepted` with `projectId`, notifies live listeners, and emits the message through the channel context.

#### Acceptance

Sending to an unknown session or a normal non-Project session fails. Reusing a client transaction id returns the existing accepted event instead of sending another runtime message.

#### Scenario: Send Project message

- GIVEN an existing Project Session
- WHEN the user posts a message with a new client transaction id
- THEN a `user.message.accepted` event is stored with the Project id
- AND the message is emitted to the selected Pibo Session.

### Requirement: Project Session updates are scoped to existing sessions

The system MUST update Project Session title and archive state only after resolving an authenticated shared Pibo Session.

#### Current

`PATCH /api/chat/project-sessions/:piboSessionId` resolves the requested session for the current user, updates the Pibo Session title through `channelContext.updateSession` when available, upserts the session query projection, and updates the Project Session archive flag when supplied.

#### Acceptance

Title updates fail when session updates are unavailable. Archive updates store a Project Session archive flag and are reflected in bootstrap session nodes.

#### Scenario: Archive Project Session

- GIVEN an existing Project Session
- WHEN the user patches `{ archived: true }`
- THEN the Project Session link has `archived: true`
- AND future default Project Session lists omit it.

### Requirement: Projects routes remain separate from room routes

The Chat Web UI MUST represent Projects navigation with `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId` routes instead of room routes.

#### Current

The UI route parser and router define Projects paths. `ProjectsArea` loads Projects bootstrap data, selects and renames Projects, toggles archived Projects and Project Sessions, creates Project Sessions, and passes the selected Project Session into the shared chat/session surface.

#### Acceptance

Navigating to a Project Session changes the browser route to `/projects/<projectId>/sessions/<piboSessionId>` and does not rewrite it to `/rooms/...` or `/sessions/...`.

#### Scenario: Select Project Session

- GIVEN a Project with a Project Session
- WHEN the user selects that Project Session in the Projects area
- THEN the selected route is `/projects/{projectId}/sessions/{piboSessionId}`
- AND the shared session view renders the selected Project Session.

## Edge Cases

- Malformed Project metadata JSON is read as an empty object.
- Archived Projects are selectable by bootstrap when requested directly with `includeArchived` behavior, but hidden from normal lists.
- The Projects store lists shared Projects; API calls still require an authenticated web session.
- Project API same-origin checks apply to mutating routes, but simple list and bootstrap routes rely on authenticated session checks.
- A Project Session link may reference a Pibo Session that no longer resolves; bootstrap filters unresolved Pibo Sessions out of the session node list.

## Constraints

- **Compatibility:** Project Sessions must remain valid Pibo Sessions and use Pibo Session IDs as the routing identity.
- **Security / Privacy:** Mutating Project routes must require same-origin JSON and authenticated web sessions. Project message sends resolve Project Sessions by shared resource existence, not auth account.
- **Data:** The Projects store is local SQLite and is not the source of truth for Pi transcripts or Pibo Session records.
- **Workflow:** Normal Project chat creation remains `simple-chat`; workflow-backed Project Session creation must use explicit published catalog versions, immutable snapshots, validation, and explicit run start.

## Success Criteria

- [ ] SC-001: A fresh authenticated Projects visit creates one shared default Project and one selected `simple-chat` Project Session when none exists.
- [ ] SC-002: Project CRUD honors required name/folder validation, archive-before-delete, and delete confirmation.
- [ ] SC-003: Project Session creation produces both a routed Pibo Session and a Projects store link with matching Pibo Session ID.
- [ ] SC-004: Project messages append accepted chat events with Project id and route through the selected Pibo Session.
- [ ] SC-005: Projects UI routes never collapse into Rooms/Sessions routes during bootstrap, selection, or message send.
- [x] SC-006: Workflow-run Project Session links preserve child-session metadata without replacing the current main Project Session, as covered by `test/project-service-workflow-link.test.mjs`.
- [ ] SC-007: Workflow-backed Project Session creation accepts only published catalog versions, saves a configuration snapshot, and starts at most one run after explicit validation.

## Verification Coverage

This section separates behavior with direct tests from behavior that is currently source-inspected only. It is part of the Projects contract so future work can add tests without guessing which requirements are already covered.

### Directly Tested

- `ChatProjectService.linkWorkflowRunSession` stores `kind: "sub"`, `workflowRunId`, `workflowId`, `parentMainSessionId`, `state: "workflow"`, and leaves `currentMainSessionId` on the Project unchanged when linking a workflow child. Verified by `test/project-service-workflow-link.test.mjs`.

### Source-Inspected Only

- Store initialization, uniqueness indexes, shared default Project creation, Project CRUD, archive/delete, and Project Session archive behavior are defined in `src/apps/chat/data/project-service.ts` but do not have focused direct tests in the current test inventory.
- Authenticated Projects bootstrap, published workflow catalog selection, configured workflow session creation/start, workflow snapshots, lifecycle events, Project Session creation through `channelContext.createSession`, Project message ingestion, and Project Session update APIs are defined in `src/apps/chat/web-app.ts` but do not have focused direct tests in the current test inventory.
- Projects route parsing, route-specific selection, and reuse of the shared session surface are defined in `src/apps/chat-ui/src/main.tsx` and `src/apps/chat-ui/src/App.tsx` but do not have focused direct tests in the current test inventory.

### Test Gaps

- Add store tests for shared default Project idempotency, duplicate project names/folders, archive-before-delete, and Project Session archive filtering.
- Add API tests for Projects bootstrap empty state, published/draft/archived workflow version handling, configured workflow session snapshot creation, explicit start idempotency, Project Session creation metadata/workspace, and Project message idempotency.
- Add UI or route-parser tests that prove `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId` remain distinct from Room routes.

### Recommended Test Matrix

| Test target | Required cases | Primary requirements | Suggested file |
|---|---|---|---|
| Projects store schema and validation | Fresh temporary store creates both tables; `ensureSharedDefaultProject` is idempotent; legacy default ids may use the old `personal_` compatibility prefix; blank or overlong names fail; relative folders fail; `~` paths normalize; duplicate names are case-insensitive; duplicate folders fail. | Projects use a separate local store; Shared default Project is created on bootstrap; Project creation validates name and folder | `test/project-service-store.test.mjs` |
| Project archive and delete | Default `listProjects` excludes archived Projects; `includeArchived` includes them; delete fails before archive; delete fails with a wrong confirmation name; delete removes Project Session links; `deleteFiles: true` removes the Project folder while `false` keeps it. | Project archive and delete are explicit | `test/project-service-store.test.mjs` |
| Project Session store behavior | `addProjectSession` defaults to main `simple-chat`; main sessions update `currentMainSessionId`; sub-sessions do not replace it; `setProjectSessionArchived` hides sessions from default lists and returns them when archived state changes. | Project Sessions are normal routed Pibo Sessions with project metadata; Workflow-run links preserve main/sub distinction; Project Session updates are scoped to existing sessions | `test/project-service-store.test.mjs` |
| Projects bootstrap API | First bootstrap creates the shared default Project and one selected `simple-chat` session; a requested Project selects its current main session; missing Pibo Session links are filtered from session nodes; archived session flags are projected onto returned nodes; catalog/profile fields remain present. | Shared default Project is created on bootstrap; Projects bootstrap resolves selection and session tree | `test/chat-projects-api.test.mjs` |
| Project creation and workflow API | `POST /api/chat/projects` requires same-origin JSON; create returns `201` with an absolute unique folder; normal Project Session creation stores channel `pibo.chat-web`, kind `chat`, workspace equal to the Project folder, and `simple-chat` metadata; workflow-backed creation requires an explicit published workflow id/version, stores a configured Project Session, saves a snapshot, and rejects draft/archived/deleted/unknown/invalid versions. | Project creation validates name and folder; Project Sessions are normal routed Pibo Sessions with project metadata; Project workflow sessions use published workflow catalog versions | `test/chat-projects-api.test.mjs` |
| Project message API | Message sends require same-origin JSON; unknown sessions fail;  non-Project sessions fail; a new `clientTxnId` appends one `user.message.accepted` event with `projectId` before `channelContext.emit`; reusing the same transaction id returns the existing accepted event and does not emit a second runtime message. | Project messages target shared Project Sessions and are logged as chat events | `test/chat-projects-api.test.mjs` |
| Project Session patch API | Title updates require `channelContext.updateSession`; missing update support returns not implemented; managed Project Sessions can update title and archive state; unknown sessions are rejected; archive state appears in later bootstrap data. | Project Session updates are scoped to existing sessions | `test/chat-projects-api.test.mjs` |
| Projects route parsing and navigation | `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId` parse to the Projects area; selecting a Project Session navigates to the Projects session route; the same Pibo Session id is not rewritten to `/rooms/...` or `/sessions/...`; local archived toggles keep their `pibo.chat.projects.*` keys. | Projects routes remain separate from room routes | route-parser/component test or browser check |

## Assumptions and Open Questions

### Assumptions

- `simple-chat` remains the normal Project chat workflow; configured workflow-backed Project Sessions are created through the explicit workflow-session endpoint from published catalog versions.
- Project folders are trusted local paths selected by the authenticated operator.
- Projects are app context resources; authenticated web sessions are required for access and same-origin guards protect mutations.

### Open Questions

- When should legacy Project controller compatibility fields be removed from migrated stores?
- Should the shared default Project folder be configurable in the UI?
- Should configured workflow Project Sessions move from start-record creation to actual asynchronous workflow node execution in the Projects API, or remain a separate workflow-kernel concern?

## Traceability

| Requirement | Scenario / Story | Source basis | Status |
|---|---|---|---|
| Projects use a separate local store | Fresh Projects store | `src/apps/chat/data/project-service.ts` | Source-inspected |
| Shared default Project is created on bootstrap | First Projects visit | `src/apps/chat/data/project-service.ts`, `src/apps/chat/web-app.ts` | Source-inspected |
| Project creation validates name and folder | Create project with folder | `src/apps/chat/web-app.ts`, `src/apps/chat/data/project-service.ts` | Source-inspected |
| Project archive and delete are explicit | Delete archived project | `src/apps/chat/data/project-service.ts`, `src/apps/chat/web-app.ts` | Source-inspected |
| Project Sessions are normal routed Pibo Sessions with project metadata | Create Project Session | `src/apps/chat/web-app.ts` | Source-inspected |
| Project workflow sessions use published workflow catalog versions | Configured workflow Project Session | `src/apps/chat/web-app.ts`, `src/apps/chat/data/project-service.ts`, `src/apps/chat-ui/src/App.tsx` | Source-inspected |
| Workflow runs start explicitly and remain one-per-session | Explicit workflow start | `src/apps/chat/web-app.ts`, `src/apps/chat/data/project-service.ts`, `src/apps/chat-ui/src/App.tsx` | Source-inspected |
| Workflow-run links preserve main/sub distinction | Link child workflow run | `src/apps/chat/data/project-service.ts`, `test/project-service-workflow-link.test.mjs` | Store-tested |
| Projects bootstrap resolves selection and session tree | Shared default Project empty state | `src/apps/chat/web-app.ts` | Source-inspected |
| Project messages target shared Project Sessions and are logged as chat events | Send Project message | `src/apps/chat/web-app.ts` | Source-inspected |
| Project Session updates are scoped to existing sessions | Archive Project Session | `src/apps/chat/web-app.ts` | Source-inspected |
| Projects routes remain separate from room routes | Select Project Session | `src/apps/chat-ui/src/main.tsx`, `src/apps/chat-ui/src/App.tsx` | Source-inspected |

## Verification Basis

This spec was written from the current workspace code, especially:

- `src/apps/chat/data/project-service.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat-ui/src/main.tsx`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/types.ts`
- `test/project-service-workflow-link.test.mjs`
