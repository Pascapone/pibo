# PRD: Ink CLI Session UI V2 — Product Scope and Current-State Audit

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: `pibo tui:sessions` V1 can send routed messages, but it is not yet a Web-parity terminal UI. It lacks owner/profile selection, room-first navigation, Web Slash Commands, rich Web terminal cards, and reliable Web visibility for CLI-created sessions.
- **Proposed Solution**: Establish V2 guardrails, audit the current implementation, document exact parity gaps, and prepare implementation batches that require real PTY-backed end-to-end validation.
- **Success Criteria**:
  - SC-01: The repo contains an implementation map of current shared Web/Ink code and gaps.
  - SC-02: The V2 scope matrix is explicit about what must match Web and what remains Web-only.
  - SC-03: Ralph stories require default-path PTY validation with `pibo debug pty` for user-facing CLI/TUI behavior.

## 2. User Experience & Functionality

- **User Personas**:
  - Host operator using SSH for recovery.
  - Web user who expects CLI-created sessions to appear in Web Chat.
  - Implementer/Ralph agent needing clear story boundaries and validation gates.

- **User Stories**:
  - As a host operator, I want the V2 scope to define Web-parity expectations so I know what the terminal UI should support.
  - As an implementer, I want an audit of current code and gaps so I do not duplicate already-shared logic or miss critical bugs.
  - As a reviewer, I want PTY-based acceptance criteria so interactive behavior is tested through the real CLI path.

- **Acceptance Criteria**:
  - Document current shared code in `src/session-ui` and current renderer-specific code in Web and Ink.
  - Document the V1 owner-scope bug and why Web filters out `user:unknown` sessions.
  - Document the required Web Slash Commands and CLI-only commands for V2.
  - Document the required PTY validation convention using `pibo debug pty ...`.

## 3. Technical Notes

- Current shared surface: `src/session-ui/terminalRows.ts`, `src/session-ui/terminalValue.ts`.
- Current Web compact terminal renderer: `src/apps/chat-ui/src/session-views/compact-terminal/`.
- Current Ink renderer: `src/apps/cli-ui/`.
- Current source/runtime boundary: `src/cli-session/` and `src/core/session-router.ts`.
- PTY validation must use the new debug command rather than ad hoc `script` calls where possible.

## 4. Risks & Non-Goals

- This PRD does not implement V2 features; it creates audit and validation guardrails.
- The audit must not become a blocker for obvious critical fixes, but Ralph stories must still record evidence.
