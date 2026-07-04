# Proposal: Projects Room Parity and Modular Clean Start

**Status:** Draft
**Created:** 2026-07-03
**Requester / Source:** User product direction in Pibo session `ps_bc7a33da-f266-4b35-8d13-95a891ce9c3e`
**Related docs:**
- `docs/specs/capabilities/chat-web-projects-area.md`
- `docs/specs/capabilities/chat-web-rooms-and-event-streams.md`
- `docs/specs/capabilities/chat-web-workflow-session-view.md`
- `docs/specs/capabilities/pibo-workflow-framework-package.md`
- GitHub issue: https://github.com/Pascapone/pibo/issues/171

## Why

The current Chat Web Projects and Workflows areas have drifted away from the intended product model. Projects should feel like normal Chat Web Rooms and Sessions, with one key difference: a Project always has a working directory. Instead, the current Projects area has separate bootstrap assumptions, project-session records, workflow-specific UI, and fragile behavior such as the `sharedDefaultProject` null crash.

The Workflows tab is also too complex for the current product stage. It mixes catalog, draft management, graph editing, raw IR editing, validation, publish controls, lifecycle actions, and Project-session entry points in one confusing surface. Some buttons appear to do nothing or navigate back to the same place. The workflow work should not be deleted, but it should be disconnected from the default Project experience until Projects have a clean, extensible foundation.

## What Changes

Projects become a clean Room-like surface:

- A Project is semantically separate from a normal Room.
- A Project always has a required workspace path.
- Creating a Project requires a path; if the path does not exist, Pibo creates it.
- Project Sessions behave like normal Room Sessions, but always run in the Project workspace.
- The Project UI starts with a Sessions module that has visual and behavioral parity with normal Rooms/Sessions.
- The Project model exposes a module interface so future Project-scoped views can be added without changing the core Project concept.
- Existing workflow code is preserved but unhooked from the default Projects/Workflows product surface until a later redesign reconnects it.

## Capabilities

### Modified Capabilities

- `chat-web-projects-area`: redefine Projects as workspace-required, Room-like project containers with modular project views.
- `chat-web-rooms-and-event-streams`: allow Project Rooms or equivalent Project-backed room semantics without weakening normal Room behavior.
- `chat-web-workflow-session-view`: keep implementation available but remove it from the default Project flow for this clean-start phase.

### Deferred Capabilities

- Workflow authoring redesign.
- Project workflow module.
- Project Kanban/Todos module.
- Project Knowledge module.
- Project-local Skills module.
- Project-local MCP/module configuration.
- Project hooks and heartbeat/background-agent modules.

## Non-Goals

- Do not delete the existing workflow framework, graph canvas, workflow stores, or workflow editor code.
- Do not ship Kanban, Project Knowledge, project-local Skills, MCP configuration, hooks, or heartbeat in this phase.
- Do not make Projects a generic folder browser.
- Do not let Projects exist without a valid workspace path.

## Desired Product Sentence

A Project is a Room with a required working directory and an extensible set of project-scoped modules. Its default module is Sessions, and those sessions behave like normal Chat Web Sessions while always running in the Project workspace.
