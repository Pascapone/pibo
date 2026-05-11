# Spec: Chat Web Projects Area

**Status:** Draft  
**Created:** 2026-05-05  
**Updated:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** `GLOSSARY.md`, [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Pibo Session Routing](./pibo-session-routing.md), [Pibo Workflow System V1](../changes/pibo-workflow-system-v1/spec.md)

## Why

The Chat Web App needs a project-focused work surface for coding work without overloading Rooms. The current implementation adds a `Projects` area with separate project persistence, project-folder-backed Pibo Sessions, and workflow metadata while reusing the normal chat, trace, signal, profile, and session-routing behavior.

This spec records the implemented Projects behavior as a source-backed capability contract. It replaces the earlier proposal-style Projects document with requirements that can be checked against the current code.

## Goal

The system SHALL let an authenticated Chat Web user manage project containers and project sessions that route through normal Pibo Sessions while preserving project-specific storage, workspace, navigation, archive state, and workflow metadata.

## Background / Current State

Current code defines `ChatProjectService` backed by `.pibo/web-projects.sqlite`. The Projects area uses routes under `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId`. Server APIs live under `/api/chat/projects*` and `/api/chat/project-sessions/*`. Project Sessions are normal Pibo Sessions created through the web channel with their workspace set to the Project folder and metadata that links them back to the Project.

The only user-creatable workflow accepted by the web API is `simple-chat`. The data model can store other workflow ids and workflow run ids for workflow-linked sessions.

## Scope

### In Scope

- Project and Project Session persistence in the Projects store.
- Personal Project bootstrap behavior.
- Project CRUD API behavior exposed by Chat Web.
- Project Session creation, rename, archive, and message sending.
- Project route selection and bootstrap payload behavior.
- Workflow metadata currently stored on Project Sessions.

### Out of Scope

- Implementing complex workflow execution — covered by the workflow change specs.
- Docker worker or worktree lifecycle for Project Sessions — not performed by `simple-chat` Projects code.
- Multi-user project membership beyond current authenticated owner-scope checks.
- Git, CI, file-browser, and deployment integrations.
- Replacing or changing the Rooms/Sessions area.

## Requirements

### Requirement: Projects use a separate local store

The system MUST store Project containers and Project Session links in a Projects-owned SQLite store, separate from Chat Web rooms and from the Pibo Session Store.

#### Current

`ChatProjectService` opens `.pibo/web-projects.sqlite` by default and creates `projects` and `project_sessions` tables. Pibo Sessions remain stored and routed separately.

#### Acceptance

A fresh Projects store initializes both tables, enforces unique project names case-insensitively, enforces unique project folders, and indexes project sessions by project/archive/creation order.

#### Scenario: Fresh Projects store

- GIVEN no Projects database exists
- WHEN Chat Web constructs `ChatProjectService`
- THEN `.pibo/web-projects.sqlite` is created with Projects tables
- AND no Room records are required to list Projects.

### Requirement: Personal Project is created on bootstrap

The system MUST create one deterministic Personal Project per owner scope when the Projects bootstrap needs it and it does not already exist.

#### Current

`ensurePersonalProject` uses `personal_${base64url(ownerScope)}` as the id, names it `Personal Chat`, marks metadata `{ personal: true }`, and creates the default folder under `.pibo/projects/workspace` unless a folder override is supplied.

#### Acceptance

Calling Projects bootstrap twice for the same owner returns the same Personal Project and does not create duplicate personal rows.

#### Scenario: First Projects visit

- GIVEN an authenticated user with no Personal Project
- WHEN the user opens `/projects`
- THEN bootstrap returns a `personalProject`
- AND that project has `metadata.personal === true`
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

`createProjectChatSession` calls `channelContext.createSession` with `channel: CHAT_WEB_CHANNEL`, `kind: "chat"`, selected profile, authenticated owner scope, workspace equal to the Project folder, and metadata containing `projectId`, `projectSessionKind: "main"`, and `projectWorkflowId`.

#### Acceptance

A created Project Session can be retrieved from the session router by its Pibo Session ID and from the Projects store as a Project Session link. Its runtime workspace is the Project folder.

#### Scenario: Create Project Session

- GIVEN a configured Project with folder `/work/app`
- WHEN the user creates a Project Session for that Project
- THEN the created Pibo Session has workspace `/work/app`
- AND its metadata contains the Project id and workflow id
- AND the Projects store records the same Pibo Session ID.

### Requirement: V1 user-created workflow is simple-chat only

The system MUST default blank workflow input to `simple-chat` and reject other user-provided workflow ids through the Chat Web Project Session creation API.

#### Current

`normalizeProjectWorkflowId` accepts missing, null, empty, or `simple-chat` values and throws `400` for any other value. The store still supports arbitrary workflow ids for internal workflow-run links.

#### Acceptance

Posting a Project Session create request with `workflowId: "standard-project"` fails in the current V1 API. Posting no workflow id creates a `simple-chat` Project Session.

#### Scenario: Unsupported workflow id

- GIVEN a Project exists
- WHEN the user posts `{ workflowId: "standard-project" }` to `/api/chat/projects/:projectId/sessions`
- THEN the API returns a client error
- AND no Project Session is created for that request.

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

`GET /api/chat/projects/bootstrap` ensures the Personal Project, selects the requested Project or Personal Project, creates a Personal Project `simple-chat` session if none exists, selects the requested session/current main/first available session, builds session nodes for the Project folder, applies Project Session archive state, and appends catalog data.

#### Acceptance

A bootstrap response always includes `personalProject`, `selectedProjectId`, `projectSessions`, `sessions`, and catalog fields. When a selected Pibo Session exists, the response includes `session` and `selectedPiboSessionId` matching that session.

#### Scenario: Personal Project empty state

- GIVEN the Personal Project exists with no Project Sessions
- WHEN bootstrap is requested without a project id
- THEN a `simple-chat` Project Session is created
- AND that session is selected in the response.

### Requirement: Project messages are owner-scoped and logged as chat events

The system MUST send Project messages only to owned Project Sessions and MUST append a durable accepted-message event before emitting the routed message.

#### Current

`POST /api/chat/projects/message` requires same-origin JSON and an authenticated session. It checks that the target Pibo Session exists and has the same owner scope, checks that the session is linked as a Project Session, deduplicates by client transaction id, appends `user.message.accepted` with `projectId`, notifies live listeners, and emits the message through the channel context.

#### Acceptance

Sending to an unknown session, another owner's session, or a normal non-Project session fails. Reusing a client transaction id returns the existing accepted event instead of sending another runtime message.

#### Scenario: Send Project message

- GIVEN an owned Project Session
- WHEN the user posts a message with a new client transaction id
- THEN a `user.message.accepted` event is stored with the Project id
- AND the message is emitted to the selected Pibo Session.

### Requirement: Project Session updates are scoped to existing sessions

The system MUST update Project Session title and archive state only after resolving an authenticated, owned Pibo Session.

#### Current

`PATCH /api/chat/project-sessions/:piboSessionId` resolves the requested session for the current user, updates the Pibo Session title through `channelContext.updateSession` when available, upserts the session query projection, and updates the Project Session archive flag when supplied.

#### Acceptance

Title updates fail when session updates are unavailable. Archive updates store a Project Session archive flag and are reflected in bootstrap session nodes.

#### Scenario: Archive Project Session

- GIVEN an owned Project Session
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
- The Projects store currently lists Projects without an owner-scope filter in `listProjects`; API calls still require an authenticated web session. This is a current implementation constraint and a future hardening point.
- Project API same-origin checks apply to mutating routes, but simple list and bootstrap routes rely on authenticated session checks.
- A Project Session link may reference a Pibo Session that no longer resolves; bootstrap filters unresolved Pibo Sessions out of the session node list.

## Constraints

- **Compatibility:** Project Sessions must remain valid Pibo Sessions and use Pibo Session IDs as the routing identity.
- **Security / Privacy:** Mutating Project routes must require same-origin JSON and authenticated web sessions. Project message sends must reject sessions outside the caller's owner scope.
- **Data:** The Projects store is local SQLite and is not the source of truth for Pi transcripts or Pibo Session records.
- **Workflow:** The web API exposes only `simple-chat` creation in V1 even though the store can record workflow-run metadata.

## Success Criteria

- [ ] SC-001: A fresh authenticated Projects visit creates one Personal Project and one selected `simple-chat` Project Session when none exists.
- [ ] SC-002: Project CRUD honors required name/folder validation, archive-before-delete, and delete confirmation.
- [ ] SC-003: Project Session creation produces both a routed Pibo Session and a Projects store link with matching Pibo Session ID.
- [ ] SC-004: Project messages append accepted chat events with Project id and route through the selected Pibo Session.
- [ ] SC-005: Projects UI routes never collapse into Rooms/Sessions routes during bootstrap, selection, or message send.
- [x] SC-006: Workflow-run Project Session links preserve child-session metadata without replacing the current main Project Session, as covered by `test/project-service-workflow-link.test.mjs`.

## Verification Coverage

This section separates behavior with direct tests from behavior that is currently source-inspected only. It is part of the Projects contract so future work can add tests without guessing which requirements are already covered.

### Directly Tested

- `ChatProjectService.linkWorkflowRunSession` stores `kind: "sub"`, `workflowRunId`, `workflowId`, `parentMainSessionId`, `state: "workflow"`, and leaves `currentMainSessionId` on the Project unchanged when linking a workflow child. Verified by `test/project-service-workflow-link.test.mjs`.

### Source-Inspected Only

- Store initialization, uniqueness indexes, Personal Project creation, Project CRUD, archive/delete, and Project Session archive behavior are defined in `src/apps/chat/data/project-service.ts` but do not have focused direct tests in the current test inventory.
- Authenticated Projects bootstrap, `simple-chat` workflow validation, Project Session creation through `channelContext.createSession`, Project message ingestion, and Project Session update APIs are defined in `src/apps/chat/web-app.ts` but do not have focused direct tests in the current test inventory.
- Projects route parsing, route-specific selection, and reuse of the shared session surface are defined in `src/apps/chat-ui/src/main.tsx` and `src/apps/chat-ui/src/App.tsx` but do not have focused direct tests in the current test inventory.

### Test Gaps

- Add store tests for Personal Project idempotency, duplicate project names/folders, archive-before-delete, and Project Session archive filtering.
- Add API tests for Projects bootstrap empty state, unsupported workflow id rejection, Project Session creation metadata/workspace, and Project message idempotency.
- Add UI or route-parser tests that prove `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId` remain distinct from Room routes.

### Recommended Test Matrix

| Test target | Required cases | Primary requirements | Suggested file |
|---|---|---|---|
| Projects store schema and validation | Fresh temporary store creates both tables; `ensurePersonalProject` is idempotent per owner; personal ids use the `personal_` base64url form; blank or overlong names fail; relative folders fail; `~` paths normalize; duplicate names are case-insensitive; duplicate folders fail. | Projects use a separate local store; Personal Project is created on bootstrap; Project creation validates name and folder | `test/project-service-store.test.mjs` |
| Project archive and delete | Default `listProjects` excludes archived Projects; `includeArchived` includes them; delete fails before archive; delete fails with a wrong confirmation name; delete removes Project Session links; `deleteFiles: true` removes the Project folder while `false` keeps it. | Project archive and delete are explicit | `test/project-service-store.test.mjs` |
| Project Session store behavior | `addProjectSession` defaults to main `simple-chat`; main sessions update `currentMainSessionId`; sub-sessions do not replace it; `setProjectSessionArchived` hides sessions from default lists and returns them when archived state changes. | Project Sessions are normal routed Pibo Sessions with project metadata; Workflow-run links preserve main/sub distinction; Project Session updates are scoped to existing sessions | `test/project-service-store.test.mjs` |
| Projects bootstrap API | First bootstrap for a new owner creates the Personal Project and one selected `simple-chat` session; a requested Project selects its current main session; missing Pibo Session links are filtered from session nodes; archived session flags are projected onto returned nodes; catalog/profile fields remain present. | Personal Project is created on bootstrap; Projects bootstrap resolves selection and session tree | `test/chat-projects-api.test.mjs` |
| Project creation and workflow API | `POST /api/chat/projects` requires same-origin JSON; create returns `201` with an absolute unique folder; Project Session creation stores channel `pibo.chat-web`, kind `chat`, workspace equal to the Project folder, and metadata `{ projectId, projectSessionKind: "main", projectWorkflowId }`; missing workflow id defaults to `simple-chat`; unsupported workflow id returns a client error and creates no session link. | Project creation validates name and folder; Project Sessions are normal routed Pibo Sessions with project metadata; V1 user-created workflow is simple-chat only | `test/chat-projects-api.test.mjs` |
| Project message API | Message sends require same-origin JSON; unknown sessions fail; another owner's session fails; non-Project sessions fail; a new `clientTxnId` appends one `user.message.accepted` event with `projectId` before `channelContext.emit`; reusing the same transaction id returns the existing accepted event and does not emit a second runtime message. | Project messages are owner-scoped and logged as chat events | `test/chat-projects-api.test.mjs` |
| Project Session patch API | Title updates require `channelContext.updateSession`; missing update support returns not implemented; owned Project Sessions can update title and archive state; unowned sessions are rejected; archive state appears in later bootstrap data. | Project Session updates are scoped to existing sessions | `test/chat-projects-api.test.mjs` |
| Projects route parsing and navigation | `/projects`, `/projects/:projectId`, and `/projects/:projectId/sessions/:piboSessionId` parse to the Projects area; selecting a Project Session navigates to the Projects session route; the same Pibo Session id is not rewritten to `/rooms/...` or `/sessions/...`; local archived toggles keep their `pibo.chat.projects.*` keys. | Projects routes remain separate from room routes | route-parser/component test or browser check |

## Assumptions and Open Questions

### Assumptions

- `simple-chat` remains the only user-creatable Project workflow until the workflow runner is implemented.
- Project folders are trusted local paths selected by the authenticated operator.
- Current owner-scope enforcement for Projects is split between web-session checks, Pibo Session ownership checks, and future project-list filtering work.

### Open Questions

- Should `ChatProjectService.listProjects` filter by owner scope before any multi-user deployment?
- Should the Personal Project folder be configurable per user in the UI?
- Should unsupported workflow ids remain hard-rejected by the web API once workflow definitions are registered dynamically?

## Traceability

| Requirement | Scenario / Story | Source basis | Status |
|---|---|---|---|
| Projects use a separate local store | Fresh Projects store | `src/apps/chat/data/project-service.ts` | Source-inspected |
| Personal Project is created on bootstrap | First Projects visit | `src/apps/chat/data/project-service.ts`, `src/apps/chat/web-app.ts` | Source-inspected |
| Project creation validates name and folder | Create project with folder | `src/apps/chat/web-app.ts`, `src/apps/chat/data/project-service.ts` | Source-inspected |
| Project archive and delete are explicit | Delete archived project | `src/apps/chat/data/project-service.ts`, `src/apps/chat/web-app.ts` | Source-inspected |
| Project Sessions are normal routed Pibo Sessions with project metadata | Create Project Session | `src/apps/chat/web-app.ts` | Source-inspected |
| V1 user-created workflow is simple-chat only | Unsupported workflow id | `src/apps/chat/web-app.ts` | Source-inspected |
| Workflow-run links preserve main/sub distinction | Link child workflow run | `src/apps/chat/data/project-service.ts`, `test/project-service-workflow-link.test.mjs` | Store-tested |
| Projects bootstrap resolves selection and session tree | Personal Project empty state | `src/apps/chat/web-app.ts` | Source-inspected |
| Project messages are owner-scoped and logged as chat events | Send Project message | `src/apps/chat/web-app.ts` | Source-inspected |
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
