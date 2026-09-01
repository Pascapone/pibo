---
type: "Historical Record"
title: "PRD: Ink CLI Session UI V2 — Room and Session Navigation"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/changes/ink-cli-session-ui-v2-web-parity/prds/04-room-session-navigation.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "fda70adf3e29823df20ccb34ed672725e2936f6a"
  source_bytes: 2589
  source_sha256: "6cb4d41b0e6ae61e69221816e90b983228e15204f10839f1b1917bd5f1ce099d"
  source_body_sha256: "6cb4d41b0e6ae61e69221816e90b983228e15204f10839f1b1917bd5f1ce099d"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
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
