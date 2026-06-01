# PRD: Ink CLI Session UI V2 — Interactive Keyboard Flows

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`

## 1. Executive Summary

- **Problem Statement**: Several Web terminal commands return interactive menus or rely on mouse clicks. The CLI needs equivalent keyboard-first flows.
- **Proposed Solution**: Convert interactive Web command results into shared menu descriptors and Ink overlays using arrows, Enter, Escape, confirmations, and terminal-safe prompts.
- **Success Criteria**:
  - SC-01: `/thinking` supports direct and picker flows.
  - SC-02: `/model` supports provider/model picker flows.
  - SC-03: `/login` supports provider/auth-method terminal flows.
  - SC-04: Fork/upload/download terminal equivalents are defined or explicitly marked unsupported.

## 2. User Experience & Functionality

- **User Personas**:
  - CLI user changing runtime settings without a mouse.
  - SSH operator completing login/model actions from a terminal.
  - Reviewer validating parity with Web command results.

- **User Stories**:
  - As a CLI user, I want `/thinking` to show a level picker so I can change reasoning level without remembering exact values.
  - As a CLI user, I want `/model` to choose provider and model with arrow keys.
  - As a CLI user, I want `/login` to show terminal-safe auth instructions.
  - As a CLI user, I want fork/upload/download behavior to be clear and safe in terminal.

- **Acceptance Criteria**:
  - `/thinking <level>` validates and applies a level directly.
  - `/thinking` opens a picker with current/default/off/minimal/low/medium/high/xhigh options where supported.
  - `/model` opens provider and model pickers, preserving unavailable/disabled states.
  - `/login` opens provider/auth-method picker and shows OAuth URL or API-key instructions.
  - Fork candidates can be listed and selected when terminal support is implemented, or a clear unsupported reason is shown.
  - Upload/download terminal behavior is path-based or explicitly deferred with help text.

## 3. Technical Notes

- Use one overlay stack for suggestions, owner picker, room picker, session picker, command menus, confirmations, and details.
- Hidden input may be required for API-key prompts; if not implemented, do not echo secrets.
- Menu result parsing should be shared where possible with Web model/login card logic.

## 4. E2E / PTY Requirements

- Use `pibo debug pty ...` to run `/thinking`, navigate options with arrow keys, confirm with Enter, and assert changed status.
- Use `pibo debug pty ...` to run `/model` and assert provider/model menu structure. Applying a real model may be skipped if provider auth is unavailable, but the reason must be recorded.
- Use `pibo debug pty ...` to run `/login` and assert provider/auth options or a clear no-provider state.

## 5. Risks & Non-Goals

- OAuth cannot always complete entirely inside SSH; terminal flow may provide URL and completion instructions.
- This PRD does not implement browser drag/drop upload.
