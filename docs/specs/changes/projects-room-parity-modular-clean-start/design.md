# Design: Projects Room Parity and Modular Clean Start

**Status:** Draft
**Created:** 2026-07-03
**Related spec:** `docs/specs/changes/projects-room-parity-modular-clean-start/spec.md`

## Design Intent

The clean-start design should make Projects boring first. A Project should feel like a normal Chat Web Room with a required working directory. The architecture should then make it easy to add Project-scoped modules later without rebuilding Projects again.

## Recommended Shape

### Product model

Represent a Project as either:

1. a `PiboRoom` with explicit project type/capability, or
2. a thin `Project` wrapper that points to a `PiboRoom` id.

The preferred direction is option 1 unless implementation constraints prove otherwise:

```ts
type PiboRoomType = "space" | "chat" | "agent" | "project";
```

or an equivalent capability marker:

```ts
metadata: {
  project: true,
  workspace: "/absolute/path",
}
```

The important rule is that a Project is not inferred from workspace presence. Normal Rooms may have workspaces too.

### Workspace rule

Normal Rooms:

```text
workspace optional
```

Projects:

```text
workspace required
must be usable before Project creation succeeds
```

Project creation should perform filesystem validation/creation before committing the Project record.

### Session rule

Project Sessions should be normal Pibo Sessions associated with the Project Room and created through the same path as Room Sessions where possible.

```text
Project Session = Pibo Session + project room association + workspace inherited from project
```

Avoid a separate `ProjectSession` product model for basic sessions. If compatibility records remain, they should be adapters or migration artifacts, not the core model.

### Module rule

A Project module is a Project-scoped view, not a Session. Initial module list:

```ts
const projectModules = [
  { id: "sessions", label: "Sessions", routeSegment: "sessions", enabled: true },
];
```

Future module ids may include:

```text
workflows
todos
knowledge
skills
mcps
hooks
heartbeat
```

Modules should render in a Project module navigation area. Module content renders in the main panel. Module data must be scoped to the selected Project.

## UI Layout Direction

The Project shell should have three conceptual areas:

```text
Project header / identity
Project module navigation
Active module content
```

For the clean-start phase:

```text
Projects
  Project list
  Selected Project
    Sessions module
      session list
      selected session terminal/composer surface
```

The Sessions module should reuse the existing Room/Sessions UI behavior as much as possible. This includes loading, empty states, archived sessions, rename/archive/delete, selection, and message composer behavior.

## Workflow Quarantine

Do not delete workflow code. Instead, disconnect it from default navigation and default Projects behavior.

Recommended temporary behavior:

- Hide the Workflows tab from primary navigation or mark it disabled behind a developer flag.
- Remove workflow-backed Project Session creation from the clean-start Projects UI.
- Keep workflow routes compileable if cheap, but show a redesign notice or keep them developer-only.
- Keep workflow stores untouched.
- Do not migrate or delete workflow data in this change.

This allows the graph canvas and workflow framework to be reused later as the `workflows` Project module.

## Data and Migration Direction

Before implementation, inspect existing Projects data:

- `projects.id`
- `projects.name`
- `projects.project_folder`
- `project_sessions.pibo_session_id`
- workflow snapshot/run tables

Preferred migration behavior:

- Valid existing Projects become Project Rooms with required workspace.
- Existing normal Project Sessions remain visible if they can be associated safely with the Project Room.
- Workflow-backed Project Sessions are preserved but not shown in the default Sessions module unless they are safely representable as normal Pibo Sessions.
- Workflow run/snapshot data remains in place for later workflow redesign.

If migration risk is high, ship a compatibility read path first and defer destructive migration.

## Verification Direction

Minimum verification should include:

1. Project creation with existing directory.
2. Project creation with missing directory that Pibo creates.
3. Project creation with empty path rejected.
4. New Project Session uses Project workspace.
5. Message send in Project Session works through the normal terminal/composer surface.
6. Opening Projects with failed bootstrap shows recoverable error.
7. Workflows are not visible in the default Project flow.
8. Normal Rooms with optional workspace still work.

Use a browser/route-level smoke test for the default happy path. Unit tests are useful but not enough for this UI-facing change.

## Risks

- Existing Projects and workflow records may have mixed semantics. Avoid destructive migration until inspected.
- Reusing Room code may expose assumptions that normal Rooms can have no workspace. Keep workspace-required logic Project-specific.
- Hiding Workflows may break users who rely on the current experimental surface. If needed, keep a developer-only route or explicit legacy link.
- If Project modules are overdesigned now, the clean-start work will stall. Keep the initial module interface minimal.
