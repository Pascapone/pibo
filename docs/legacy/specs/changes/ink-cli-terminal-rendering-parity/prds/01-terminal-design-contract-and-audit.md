# PRD 01: Terminal Design Contract and Current-State Audit

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`  
**Related docs:** `../spec.md`, `../design.md`, `../../../TERMINAL_DESIGN.md`

## 1. Executive Summary

### Problem Statement

The current Ink TUI is functionally improved but visually unacceptable as a Compact Terminal peer. `/status` now appears in the transcript flow, but the UI still looks like a plain CLI dashboard. Header text, command summaries, pickers, slash suggestions, and status output do not follow the design philosophy in `TERMINAL_DESIGN.md`.

### Proposed Solution

Make `TERMINAL_DESIGN.md` the enforceable contract for the TUI. Audit the current Ink output against the Web Compact Terminal and design file, document all gaps, and add tests/checklists that prevent future work from claiming parity when only shared data exists.

### Success Criteria

- SC-01: A current-state audit lists concrete design failures with PTY artifact references.
- SC-02: Requirements distinguish shared data, shared render flow, shared behavior, and visual parity within terminal limits.
- SC-03: Tests/checklists fail if the TUI regresses to top-heavy dashboard rendering or detached command outputs.
- SC-04: Ralph stories generated from this PRD cannot be completed without PTY visual evidence.

## 2. User Experience & Functionality

### User Personas

- **SSH operator:** Wants `pibo tui:sessions` to feel like the same terminal product as Web Compact Terminal.
- **Web Chat user:** Expects the same render order, status meaning, slash flow, and trace grouping when moving from Web to SSH.
- **Reviewer:** Needs artifact-backed evidence that design conformance was actually inspected.

### User Stories

- As an SSH operator, I want the TUI to feel like a compact terminal transcript, not a dashboard, so I can stay oriented.
- As a reviewer, I want a design audit tied to PTY screenshots/artifacts so I can verify the gap and the fix.
- As an implementer, I want explicit non-negotiable design rules so shared descriptors are not mistaken for visual parity.

### Acceptance Criteria

- Audit compares current TUI against `TERMINAL_DESIGN.md` sections for transcript-first layout, row density, color-as-signal, monospace hierarchy, prefix glyphs, detail panels, status bar, badges, rows, and command output.
- Audit includes at least these live flows: startup, owner/room picker, slash suggestions, `/status`, existing transcript, streaming/running rows where feasible.
- Audit references PTY artifacts with `raw.ansi.log`, `clean.txt`, `screen.txt`, and metadata paths.
- Audit identifies which UI elements are transcript rows, which are overlays, and which are chrome.
- Audit defines pass/fail rules for future implementation stories.
- `state.message` usage is classified: allowed only for ephemeral guidance, not command/runtime results.
- The PRD explicitly states that Web DOM reuse is out of scope, but render flow and component semantics are mandatory.

## 3. Design Contract Requirements

### Non-Negotiable Rules

- The transcript is the primary UI.
- Command/runtime results appear in chronological flow unless they are active overlays/pickers.
- Slash suggestions behave like a compact command palette near the input, not a noisy top section.
- Header/status chrome is compact and secondary.
- User messages and assistant messages are visually distinct.
- Running/streaming rows preserve order and status markers.
- Details expand inline below the parent row.
- Missing data is shown compactly, not as verbose debug prose.
- Secrets are redacted before both Web and Ink rendering.

### Allowed Renderer Differences

- Ink may use ASCII/Unicode borders, text progress bars, and ANSI colors.
- Web may use DOM/Tailwind/lucide icons.
- Ink may abbreviate owner/session identifiers, but full values must remain available through detail/status when needed.

### Forbidden Outcomes

- A plain text status dump with every field always visible.
- Slash suggestions or pickers that visually dominate the transcript without clear overlay treatment.
- Header lines so long that they truncate the important transcript content.
- Rows without clear role/status distinction.
- Claims of parity based only on `src/session-ui` model sharing.

## 4. Technical Notes

- Use `pibo debug pty ...` to capture actual screen output.
- Keep the audit under `docs/reports/`.
- Source-level tests are acceptable for static contracts, but visual behavior needs PTY screen evidence.
- Do not restart the production gateway as part of this audit.

## 5. Validation Requirements

- Focused tests for static renderer boundaries pass.
- PTY audit commands run and artifacts are saved.
- Audit report names exact command invocations and artifact paths.
- Typecheck passes.

## 6. Risks & Non-Goals

### Risks

- Design rules may be interpreted too loosely unless examples are concrete.
- PTY artifacts without visual conversion can still hide color/layout issues.

### Non-Goals

- Implementing the final renderer in this PRD.
- Reusing Web DOM components in Ink.
- Restarting gateway services.
