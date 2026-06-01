# PRD 06: Pickers, Overlays, and Keyboard Flows

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/ink-cli-terminal-rendering-parity/`  
**Related docs:** `../spec.md`, `../design.md`, `03-transcript-command-results-and-slash-palette.md`

## 1. Executive Summary

### Problem Statement

Current owner/room/session/slash pickers are functional but visually disconnected from the Compact Terminal design. They appear as generic lists with long identifiers and weak hierarchy. Interactive Web controls such as model, login, and thinking menus need keyboard-native terminal equivalents that preserve the same action flow and visual semantics.

### Proposed Solution

Redesign TUI pickers and overlays as compact terminal command surfaces. They should appear near the input or inline with the transcript context, use concise labels, preserve Web action semantics, and provide clear keyboard controls. Long identifiers become secondary/dim details, not primary visual content.

### Success Criteria

- SC-01: Owner, room, session, slash, thinking, model, login, and fork pickers share a coherent terminal overlay style.
- SC-02: Pickers preserve the same flow semantics as Web controls and shared descriptors.
- SC-03: Long ids are deemphasized; useful titles/status/counts are primary.
- SC-04: PTY tests cover nested picker navigation, Escape/back behavior, and command execution from picker state.

## 2. User Experience & Functionality

### User Personas

- **SSH operator:** Needs fast keyboard navigation through owners, rooms, sessions, and commands.
- **Web user:** Expects `/thinking`, `/model`, and `/login` to map to familiar Web action flows.
- **Reviewer:** Needs PTY evidence that overlays are visually distinct and do not break transcript flow.

### User Stories

- As a user, I want room/session pickers to prioritize human-readable names so I do not scan UUIDs.
- As a user, I want keyboard overlays to look like part of the terminal, not a separate dashboard.
- As a user, I want Escape and Enter behavior to be consistent across slash suggestions and all pickers.

## 3. Overlay Design Requirements

### Common Overlay Style

All pickers/overlays MUST use a shared compact terminal style:

- short title in dim/yellow/cyan tone depending on context
- selected row marker `❯`
- primary label first
- secondary metadata dimmed
- disabled/unavailable items visibly marked
- control hint compact and consistent
- no excessive long IDs as primary labels

Example target style:

```text
select room
❯ Personal Chat        default · 24 sessions
  Ralph V2             3 sessions
  Recovery             empty
```

### Placement

- Slash palette SHOULD anchor near the input.
- Command pickers SHOULD appear where Web would show command controls/results: adjacent to current prompt/transcript context.
- Startup owner/room/session pickers MAY appear before transcript rows, but must still use terminal overlay style.
- Overlays MUST not permanently pollute transcript history unless they produce a command result.

### Keyboard Controls

- Up/Down moves selection.
- Enter confirms.
- Escape backs out one overlay level.
- Ctrl+C exits cleanly.
- Help/control hint must reflect the current overlay.

## 4. Specific Flow Requirements

### Owner Picker

- Shows Web users and Root recovery.
- Primary label is user/root display name.
- Owner scope is secondary/dim and may be abbreviated.
- Switching owner clears invalid active room/session.

### Room Picker

- Primary label is room title.
- Default room is marked compactly.
- Session count or empty state should be shown when available.
- Room UUIDs are secondary and should not dominate.

### Session Picker

- Primary label is session title.
- Shows status/profile/model/updated time compactly when available.
- Includes `+ New session` action for empty rooms.
- Back action works from session picker to room picker.

### Thinking Picker

- Uses shared thinking levels.
- Shows current/default state.
- Direct `/thinking high` still works.
- Disabled/unsupported states are visible.

### Model Picker

- Preserves provider -> model flow.
- Provider availability and disabled states are visible.
- Model selection executes the same action semantics as Web.

### Login Picker

- Preserves provider -> auth method flow.
- Device/browser URL output is rendered as a transcript command result or inline terminal instruction.
- API-key flow must not echo secrets.

### Fork/Clone/Upload/Download Equivalents

- Fork candidates use keyboard selection.
- Clone opens the derived session when available while preserving result context.
- Browser-only actions show unsupported reasons compactly.

## 5. Acceptance Criteria

- PTY startup picker screen is compact and human-readable.
- `/owner`, `/room`, `/session`, `/thinking`, `/model`, `/login`, and slash suggestions share visual style.
- Long owner/room/session IDs are not the dominant visible text.
- Escape behavior is tested for nested model/login/session flows.
- Running `/status` while a picker is open closes or suspends the picker and appends transcript result rows.
- Disabled/unavailable actions render with clear reason.
- No picker output is mistaken for transcript history unless it produces a command/action result.

## 6. Technical Notes

- Prefer shared picker descriptor models from `src/session-ui`.
- Add Ink-specific overlay renderer components under `src/apps/cli-ui`.
- Consider a single overlay stack renderer for picker/suggestions/details/confirmation.
- Keep overlay render tests independent from live source data where possible.

## 7. Validation Requirements

- Unit tests for picker descriptor shaping and selected indices.
- Ink render tests for owner/room/session/thinking/model/login overlays.
- Controller tests for Escape/back/Enter behavior.
- PTY tests for startup room picker, slash palette, `/thinking`, `/model`, `/login` where feasible.
- Typecheck passes.
- Full tests pass.

## 8. Risks & Non-Goals

### Risks

- Live model/login provider catalogs may be unavailable. Use deterministic fake provider data for rendering and one live/default path where feasible.
- Too much metadata in picker rows can recreate the current noisy UI. Keep primary labels short.

### Non-Goals

- Mouse support.
- Web DOM reuse.
- Full browser upload/download parity.
