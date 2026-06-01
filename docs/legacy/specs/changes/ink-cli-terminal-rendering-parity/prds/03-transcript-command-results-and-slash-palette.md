# PRD 03: Transcript Command Results and Slash Palette

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`  
**Related docs:** `../spec.md`, `../design.md`, `02-shared-render-flow-and-fixtures.md`

## 1. Executive Summary

### Problem Statement

Slash command behavior in the TUI is not visually aligned with the Web Compact Terminal. Command suggestions can appear as a generic list above other UI, command results can be mixed with transient messages, and the visual placement does not consistently feel like the Web terminal flow where command controls/results appear adjacent to the input/transcript context.

### Proposed Solution

Redesign slash suggestions and command results around terminal flow semantics. Suggestions become a compact command palette anchored near the input. Executed command results become transcript rows immediately above the input/current prompt, preserving chronological order. Commands that open menus/pickers use keyboard-native overlays with the same action semantics as Web.

### Success Criteria

- SC-01: Slash suggestions are visually distinct, compact, and anchored to the input area.
- SC-02: Executed command results render in transcript order as `CompactTerminalRow`/card descriptors.
- SC-03: Slash command UI uses the shared command catalog and labels from Web-capability descriptors.
- SC-04: PTY tests prove `/`, filtered suggestions, `/status`, and at least one menu command behave correctly.

## 2. User Experience & Functionality

### User Personas

- **Keyboard user:** Wants to discover and run commands quickly without losing transcript context.
- **Web Chat user:** Expects slash commands in TUI to map to the same actions and visible result semantics as Web.
- **Reviewer:** Needs clear screen artifacts showing command palette placement and result flow.

### User Stories

- As a TUI user, I want typing `/` to show a compact command palette near my input so command discovery feels local to what I am typing.
- As a TUI user, I want command results to appear immediately in the transcript flow so I can read them chronologically.
- As a Web user, I want `/status`, `/thinking`, `/model`, and `/login` in the TUI to use the same action names and result semantics as Web.

## 3. Slash Palette Requirements

### Placement and Layout

- The slash palette MUST render near the input/prompt, not as an indistinct top-of-screen list.
- The palette MUST use dense terminal styling:
  - command in cyan or highlighted tone
  - short description in dim tone
  - selected item marker `❯` or equivalent
  - unsupported/deferred reason shown compactly
- The palette MUST not obscure command results in the transcript more than necessary.
- The palette MUST close on Escape without deleting typed input on first Escape.
- The palette MUST support Up/Down and Enter.

### Catalog Behavior

- The palette MUST derive entries from the shared slash command catalog.
- CLI-only navigation commands MAY appear in a separate group but must use the same palette style.
- Unsupported/browser-only commands MUST be visible with a concise reason or grouped under unavailable commands.
- Filtering MUST preserve Web command names and aliases.

### Acceptance Criteria

- Typing `/` shows compact suggestions with `/status`, `/session`, `/thinking`, `/model`, `/login`, and CLI navigation commands where available.
- Typing `/st` filters to matching commands.
- Enter on an exact command runs it.
- Enter on a prefix accepts the command and leaves a trailing space for arguments.
- The final PTY screen clearly shows input plus palette as one visual unit.

## 4. Command Result Flow Requirements

### Transcript Placement

- Command results MUST appear in the transcript flow immediately above the input/current prompt after execution.
- `/status` MUST produce an execution command row and a status result row/card.
- `/thinking <level>`, `/model <provider/model>`, `/login <provider/method>`, `/fast`, `/compact`, `/clone`, `/abort`, `/kill`, `/kill-all`, unsupported commands, and command errors MUST produce rows/cards or picker overlays according to their result type.
- Pure guidance such as “Select a model” MAY use ephemeral overlay text, but command output MUST NOT be stored only in `state.message`.

### Ordering

- Existing transcript rows remain unchanged.
- If a command runs while an assistant/tool row is streaming, command result rows append after the current visible transcript tail.
- If a command opens a new session, the originating command result must be visible before or during the session transition, with no silent loss of context.

### Acceptance Criteria

- `/status` while room/session picker is open closes the picker and appends transcript rows.
- `/status` while streaming preserves running rows and appends after them.
- Unsupported command result is rendered as a terminal error/unsupported row, not just a header error.
- Command errors redact secrets.
- `state.message` remains limited to ephemeral guidance.

## 5. Technical Notes

- Add or refine a command-result-to-row converter.
- Shared descriptor normalization should remain in `src/session-ui` when renderer-neutral.
- CLI-only local rows must use stable ids to avoid duplicate rendering where possible.
- Preserve Web command catalog source-of-truth.

## 6. Validation Requirements

- Unit tests for suggestion filtering, exact-run vs accept behavior, unsupported command reasons.
- Controller tests for command result row appending and picker closure.
- Ink render tests for command rows and compact palette output.
- PTY tests for `/`, `/st`, `/status`, and one menu command.
- Typecheck passes.
- Full tests pass.

## 7. Risks & Non-Goals

### Risks

- Local command rows may duplicate persisted runtime events. Use stable ids or dedupe later if needed.
- Palette placement in terminal is constrained by Ink layout. The acceptance target is clear visual anchoring, not exact Web pixel placement.

### Non-Goals

- Mouse command palette support.
- Browser-only command implementation unless explicitly adapted in a later PRD.
