# PRD: Ink CLI Session UI V2 — Slash Command Catalog and Actions

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`

## 1. Executive Summary

- **Problem Statement**: V1 CLI Slash Commands are hard-coded and much smaller than Web Chat's command catalog.
- **Proposed Solution**: Derive CLI commands from the same routed gateway capability catalog as Web, add CLI-only commands, implement suggestions, and execute supported actions through the selected owner/session runtime.
- **Success Criteria**:
  - SC-01: `/help` and slash suggestions use a shared catalog.
  - SC-02: Supported Web commands execute through the real session runtime.
  - SC-03: Unsupported commands show explicit reasons.

## 2. User Experience & Functionality

- **User Personas**:
  - CLI user relying on slash commands from SSH.
  - Web user expecting command names to match between Web and CLI.
  - Implementer adding future commands once to the capability catalog.

- **User Stories**:
  - As a CLI user, I want `/` suggestions so I can discover commands.
  - As a CLI user, I want Web commands like `/status`, `/compact`, `/abort`, `/kill`, `/fast`, and `/clone` to work in terminal.
  - As a CLI user, I want unsupported commands to explain why they are unavailable.

- **Acceptance Criteria**:
  - Catalog includes routed Web commands and CLI-only commands: `/help`, `/new`, `/room`, `/agent`, `/owner` or `/profile`, `/exit`, `/quit`.
  - Typing `/` shows suggestions; typing a prefix filters suggestions.
  - Arrow keys move through suggestions; Enter accepts/runs; Escape closes suggestions.
  - `/status`, `/compact`, `/clear`, `/abort`, `/kill`, `/kill-all`, `/fast`, `/session-current`, `/sessions`, and `/clone` have behavior tests.
  - Action execution is scoped to the selected owner and active session.

## 3. Technical Notes

- Shared catalog descriptors should include slash text, action name, description, argument hints, support status, and terminal adaptation metadata.
- CLI source action execution should reuse `PiboSessionRouter`/gateway action mechanisms rather than duplicating action logic.
- `/clone` and any action returning a derived session id should open/select the resulting session when appropriate.

## 4. E2E / PTY Requirements

- Use `pibo debug pty ...` to type `/`, assert suggestions, filter to `/status`, execute it, and assert rich status output.
- Use `pibo debug pty ...` to run at least one runtime-affecting command such as `/fast` or `/compact` against a real session when feasible.
- Store raw and clean artifacts and list them in Ralph notes.

## 5. Risks & Non-Goals

- Browser-only commands may need terminal equivalents or explicit unsupported reasons.
- Full product-area screens for Workflows/Cron/Ralph/Agent Designer remain out of scope.
