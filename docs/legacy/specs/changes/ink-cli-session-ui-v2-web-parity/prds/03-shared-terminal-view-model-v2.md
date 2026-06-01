# PRD: Ink CLI Session UI V2 — Shared Terminal View Model V2

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../design.md`, `../spec.md`

## 1. Executive Summary

- **Problem Statement**: Web and Ink currently share compact terminal rows, but rich terminal cards, status summaries, command menus, and interaction descriptors remain Web-only or CLI-specific.
- **Proposed Solution**: Extend `src/session-ui` into the renderer-neutral boundary for rows, cards, status descriptors, command descriptors, owner/room/session pickers, and command results.
- **Success Criteria**:
  - SC-01: Web Compact Terminal View and Ink consume shared descriptors for representative transcript/card/status states.
  - SC-02: Shared modules do not import DOM, Ink, React renderer, CSS, or browser APIs.
  - SC-03: Tests prove shared model parity for Web and CLI inputs.

## 2. User Experience & Functionality

- **User Personas**:
  - CLI user who expects terminal output to match Web semantics.
  - Web user who expects existing Web terminal behavior to remain intact.
  - Implementer who needs a stable reuse boundary.

- **User Stories**:
  - As a user, I want status/thinking/model/login/tool cards to have the same meaning in Web and CLI.
  - As an implementer, I want shared descriptors so the two renderers do not drift.
  - As a reviewer, I want tests that prove the shared descriptor output is renderer-neutral.

- **Acceptance Criteria**:
  - Add shared descriptors for terminal cards, status summaries, command menus, command results, and picker items.
  - Existing `buildCompactTerminalRows()` remains available and compatible.
  - Web renderer maps descriptors to DOM/Tailwind components.
  - Ink renderer maps descriptors to Ink components without importing Web components.
  - Shared tests cover representative assistant, reasoning, tool, yielded-run, error, status, model, login, and thinking cases.

## 3. Technical Notes

- Proposed modules:
  - `src/session-ui/terminalCards.ts`
  - `src/session-ui/statusViewModel.ts`
  - `src/session-ui/commandCatalog.ts`
  - `src/session-ui/commandResults.ts`
  - `src/session-ui/ownerViewModel.ts`
  - `src/session-ui/roomSessionViewModel.ts`
- Keep renderer-specific keyboard/mouse handling outside shared modules.
- Shared models may include action descriptors but not execute actions.

## 4. E2E / PTY Requirements

- Shared model stories are primarily unit-test driven.
- If a story changes user-facing CLI rendering, add a `pibo debug pty ...` snapshot/assertion covering the rendered descriptor through the real CLI path.

## 5. Risks & Non-Goals

- Do not reduce Web quality to fit terminal limitations.
- Do not import Ink into shared model code.
- Do not import Web DOM components into CLI code.
