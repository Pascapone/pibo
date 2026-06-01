# PRD: Ink CLI Session UI V2 — Web-Parity Rendering and PTY Validation

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: The current Ink UI is functional but visually and structurally different from the Web Compact Terminal View, and prior validation relied too much on fake/demo paths.
- **Proposed Solution**: Implement Web-parity Ink renderers for shared descriptors and establish mandatory PTY-backed E2E validation using `pibo debug pty ...`.
- **Success Criteria**:
  - SC-01: Ink renders rich cards and transcript rows with Web-aligned labels, markers, grouping, and status meaning.
  - SC-02: PTY smoke tests cover real startup, owner/room/session selection, message send, slash suggestions, `/status`, and at least one interactive command.
  - SC-03: Raw and clean PTY artifacts are captured for review.

## 2. User Experience & Functionality

- **User Personas**:
  - CLI user who wants the terminal UI to feel like the Web terminal view.
  - Reviewer who needs evidence from real PTY behavior.
  - Ralph agent implementing user-facing UI changes.

- **User Stories**:
  - As a CLI user, I want rows/cards to look like the Web Compact Terminal View so I can transfer context between Web and SSH.
  - As a reviewer, I want PTY artifacts so I can inspect real terminal behavior.
  - As an implementer, I want deterministic PTY scripts so regressions are caught automatically.

- **Acceptance Criteria**:
  - Ink renders user, assistant, reasoning, tool call, tool status, thinking, login, model, yielded-run, compaction, and error descriptors.
  - Status/progress/quota bars render as terminal text bars with matching semantics.
  - Collapsed/expanded states are keyboard-accessible where implemented.
  - Narrow terminal and no-color modes remain readable.
  - PTY validation uses `pibo debug pty ...`, not only ad hoc shell tools.
  - Final validation runs `npm test` and installed/global `pibo tui:sessions` PTY smoke.

## 3. Technical Notes

- Prefer snapshot-like clean-output assertions over brittle raw ANSI matching.
- Keep raw ANSI artifacts for debugging renderer issues.
- Provide deterministic seeded data where real provider calls are not required, but final user-path validation must include a real router/source path when feasible.

## 4. E2E / PTY Requirements

Required final PTY scenarios:

1. Start `pibo tui:sessions`, select owner, select Personal Chat, open/create a session.
2. Send a message through the real router and assert assistant output appears.
3. Type `/`, filter suggestions, run `/status`, and assert status card fields.
4. Run `/thinking` picker or another interactive command and assert keyboard selection behavior.
5. Open an existing session by `--session <id>` and assert transcript hydration.
6. Capture raw and clean artifacts for each scenario.

## 5. Risks & Non-Goals

- PTY tests can be flaky if they depend on live model latency. Scripts should use timeouts, assertions, and deterministic local fixtures where acceptable, with at least one real-path smoke when feasible.
- Pixel-perfect Web parity is impossible in terminal; semantic/layout parity is required.
