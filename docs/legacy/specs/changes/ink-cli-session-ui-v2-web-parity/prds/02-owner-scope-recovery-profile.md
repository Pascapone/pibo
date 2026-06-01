# PRD: Ink CLI Session UI V2 — Owner Scope and Recovery Profile

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`

## 1. Executive Summary

- **Problem Statement**: CLI-created sessions can be stored under `user:unknown` when `pibo tui:sessions` runs outside Web Auth without `--owner-scope`. Web Chat filters by authenticated owner scope, so valid CLI sessions can be hidden from the user.
- **Proposed Solution**: Make `pibo tui:sessions` resolve an explicit effective owner before rooms, sessions, messages, and actions. Host-root CLI becomes an explicit recovery/admin surface that can impersonate a selected local owner or use a local Root recovery owner when no Web user exists.
- **Success Criteria**:
  - SC-01: New CLI sessions never silently use `user:unknown`.
  - SC-02: Multiple owner scopes produce an owner picker.
  - SC-03: No-owner systems use a stable Root recovery owner with no email.
  - SC-04: Selecting a Web owner creates sessions visible in that Web user's room navigation.

## 2. User Experience & Functionality

- **User Personas**:
  - Host-root operator selecting which user to recover/debug.
  - Web user expecting CLI activity to appear under their Personal Chat/rooms.
  - Admin repairing old `user:unknown` sessions.

- **User Stories**:
  - As a host operator, I want to select a Web user/profile so I can continue as that user from SSH.
  - As a host operator, I want a Root recovery profile if no users exist so first-run recovery still works.
  - As a Web user, I want CLI-created sessions to appear in my Web UI so I can continue in the browser.
  - As an admin, I want diagnostics for legacy `user:unknown` sessions so I can reassign them safely.

- **Acceptance Criteria**:
  - Owner discovery lists known owner scopes from rooms, sessions, navigation, custom agents, and Better Auth data where available.
  - Startup chooses or asks for an effective owner before showing rooms unless `--owner-scope` is supplied.
  - `/owner` or `/profile` opens the owner picker and reloads rooms/sessions after selection.
  - Header and `/status` show active owner label and scope.
  - Message sending and action execution reject sessions owned by a different owner.
  - Legacy `user:unknown` sessions are not selected for new writes by default.

## 3. Technical Notes

- Add a renderer-neutral owner/profile summary descriptor for Ink and possible Web diagnostics.
- Prefer a canonical Root recovery owner such as `local:root`; final string remains an implementation decision unless resolved before work starts.
- Custom agents should be loaded for the selected owner where custom-agent storage is owner-scoped.
- Owner changes must close the open session unless the session belongs to the new owner.

## 4. E2E / PTY Requirements

- Use `pibo debug pty ...` to script startup with multiple owners and assert that an owner picker appears.
- Use `pibo debug pty ...` to select a Web owner, create a session in Personal Chat, send a message, and assert the clean output contains the selected owner, selected room, sent message, and assistant reply.
- Store raw and clean PTY artifacts and include their paths in Ralph notes when passing stories.

## 5. Risks & Non-Goals

- This feature intentionally allows local host-root impersonation as a recovery/admin path. It must be explicit and visible, not hidden.
- It does not add remote admin impersonation to Web Auth.
