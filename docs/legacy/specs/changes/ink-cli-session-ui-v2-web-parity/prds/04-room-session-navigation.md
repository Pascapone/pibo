# PRD: Ink CLI Session UI V2 — Room and Session Navigation

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`

## 1. Executive Summary

- **Problem Statement**: V1 opens a recent session or flat session picker. It does not match Web's room organization, and `/new` can create sessions without clear owner/room visibility.
- **Proposed Solution**: Add owner-scoped room-first navigation: startup owner -> room -> session, `/session` room-first, `/room` switching, and `/new` creates in the active or selected room.
- **Success Criteria**:
  - SC-01: Startup can navigate owner -> room -> session in Ink.
  - SC-02: `/session` first chooses room, then session.
  - SC-03: `/new` creates under the selected owner's selected room and appears in Web navigation.

## 2. User Experience & Functionality

- **User Personas**:
  - CLI user organizing work by rooms.
  - Web user expecting CLI sessions under the same rooms.
  - Recovery operator opening old sessions quickly.

- **User Stories**:
  - As a CLI user, I want to choose a room before a session so the list is manageable.
  - As a CLI user, I want `/new` to use the selected room so the session is organized.
  - As a Web user, I want sessions created in CLI to appear in the same room in Web.

- **Acceptance Criteria**:
  - Personal Chat is the default room for the selected owner.
  - `/session` opens room picker, then session picker filtered by room.
  - `/room` changes active room and reloads room-scoped sessions.
  - Empty rooms offer a create-new-session option.
  - Escape navigates back one overlay level.
  - `--session <id>` still opens directly after owner validation.

## 3. Technical Notes

- Expand CLI source contracts for owner-scoped rooms, active room, room-scoped sessions, and room-scoped creation.
- Use existing Web room service semantics where practical.
- Persist session navigation rows consistently with Web read models.
- Existing V1 sessions without room metadata should be shown under Personal Chat after owner resolution.

## 4. E2E / PTY Requirements

- Use `pibo debug pty ...` to assert startup room picker behavior.
- Use `pibo debug pty ...` to select Personal Chat, create a session, send a message, and assert output.
- Validate the created session through Web/API/store checks and record the session URL.

## 5. Risks & Non-Goals

- This PRD does not implement full room management CRUD.
- Archived/deleted rooms should be visible or blocked according to existing Web rules, but full archive management remains Web-only unless separately specified.
