# Spec: Ink CLI Session UI

**Status:** Draft  
**Created:** 2026-05-16  
**Owner / Source:** User request and `docs/reports/ink-cli-session-subset-report.md`  
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `docs/specs/capabilities/cli-session-ui.md`, `docs/specs/capabilities/shared-terminal-view-model.md`

## Why

Pibo needs a native terminal session UI for SSH, bootstrap, recovery, and fast local use. The Web Chat UI remains the primary full-featured interface, but users need a smaller shell-native path to operate sessions when a browser or Web Gateway is unavailable.

## Goal

Implement an Ink-based CLI Session UI that provides the minimal Pibo chat/session subset while sharing trace/terminal view-model logic with Web Chat and leaving Web Chat behavior unchanged.

## Background / Current State

The report found:

- Ink is appropriate for native terminal rendering.
- Web DOM components are not directly reusable in Ink.
- `buildCompactTerminalRows()` and trace/session view models are the main reuse point.
- The CLI should exclude Projects, Workflows, Cron, Ralph, Agent Designer, and full settings/context surfaces.

## Scope

### In Scope

- New Ink CLI Session UI command surface.
- Shared terminal row model extraction or re-export.
- Ink compact transcript renderer.
- Session/status bar, bounded transcript viewport, input line.
- Slash Commands: `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, `/quit`.
- Session creation and selection.
- Agent/profile selection from existing profiles.
- Live display of assistant output, tool calls/results, yielded runs, and errors.
- Terminal-safe JSON and markdown simplification.
- Non-TTY and error fallback behavior.
- Tests and documentation.

### Out of Scope

- Projects.
- Workflows and Workflow/XState visualization.
- Cron jobs.
- Ralph jobs.
- Agent Designer or agent editing.
- Full settings UI.
- Full context-management UI.
- Browser DOM component reuse.
- Web UI visual/behavior changes.

## Requirements

### Requirement: New CLI command starts the Ink session UI

The system MUST provide a discoverable CLI command that starts the Ink CLI Session UI.

#### Current

`pibo tui` and `pibo tui:routed` exist, but they do not provide the target reduced Web Chat-derived session UI.

#### Target

The `pibo tui:sessions` command starts the new CLI. The command must be documented in root CLI discovery text.

#### Acceptance

Running the command in a TTY renders the Ink app. Running the command with `--help` or root discovery shows a clear description.

#### Scenario: Start CLI

- GIVEN Pibo is installed
- WHEN the user runs the CLI Session UI command
- THEN the terminal shows a status bar, transcript area, and input line.

### Requirement: CLI remains a reduced Web Chat subset

The CLI MUST only expose core chat/session operations in V1.

#### Acceptance

The V1 interactive CLI does not expose Projects, Workflows, Cron, Ralph, Agent Designer, or full Settings screens.

#### Scenario: Unsupported command

- GIVEN the user is in the CLI
- WHEN the user enters `/ralph` or `/workflow`
- THEN the CLI explains that the feature is Web-only or unsupported in CLI V1.

### Requirement: Shared terminal view model powers transcript rendering

The CLI MUST render transcript rows from the shared terminal view model.

#### Acceptance

The Ink renderer receives shared compact rows derived from `PiboSessionTraceView`. No separate CLI-only trace-to-row mapper is introduced for V1.

### Requirement: Web Chat behavior is preserved

The implementation MUST keep existing Web Chat terminal behavior intact.

#### Acceptance

Chat Web typecheck/build passes after extraction. Web session view registry behavior remains unchanged unless separately specified.

### Requirement: Bounded transcript viewport

The Ink renderer MUST render a bounded row window to avoid terminal performance issues on large sessions.

#### Acceptance

The renderer has a documented default row limit or viewport strategy. Large sessions do not render all rows at once by default.

### Requirement: Terminal-safe row presentation

The Ink renderer MUST represent row kinds and statuses using terminal-safe text, colors, and ASCII/Unicode markers.

#### Acceptance

Representative user, assistant, tool call, tool result, yielded run, and error rows render without browser icons or CSS. Terminal width constraints are handled by wrapping or truncating.

### Requirement: Slash Commands are implemented as a small explicit command set

The CLI MUST implement the V1 Slash Command set and reject unknown commands explicitly.

#### Acceptance

`/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit` work as documented. Unknown commands show a bounded error message.

### Requirement: Session picker supports existing and new sessions

The CLI MUST support selecting an existing session and creating a new session.

#### Acceptance

`/session` opens a room/session selection flow where data is available. `/new` creates a session through the current session source and opens it.

### Requirement: Agent picker selects existing profiles only

The CLI MUST allow choosing an existing agent/profile but MUST NOT edit profiles in V1.

#### Acceptance

`/agent` lists available profiles, applies the selected profile according to runtime/session-source rules, and returns to the transcript. No edit/create/delete controls are present.

### Requirement: Live updates are reflected in the transcript

The CLI MUST update transcript rows as the selected session receives new trace/session events.

#### Acceptance

During a running assistant turn, new assistant/tool/error state appears without restarting the CLI. Final states replace or settle live states according to shared trace data.

### Requirement: Clear exit and recovery behavior

The CLI MUST clean up terminal state and subscriptions on exit or failure.

#### Acceptance

`/exit`, `/quit`, and `Ctrl+C` exit without leaving corrupted terminal output. Session-source subscriptions are closed.

## Edge Cases

- TTY unavailable.
- No sessions exist.
- No rooms are listable.
- No agents are listable.
- Active session disappears.
- Runtime reports an error while streaming.
- Trace row has unknown kind or missing details.
- Output contains large JSON/text values.
- Terminal width is less than expected.

## Constraints

- **Ink required:** Interactive terminal rendering uses Ink.
- **No DOM reuse:** Web DOM components must not be imported into CLI renderer.
- **Web-first product:** The Web UI remains the primary control center.
- **Shared model:** Trace-to-row mapping must be shared where feasible.
- **Bounded rendering:** CLI must avoid unbounded transcript rendering.

## Success Criteria

- [ ] SC-001: New command starts an Ink CLI Session UI in a TTY.
- [ ] SC-002: Shared compact terminal rows feed both Web and CLI renderers.
- [ ] SC-003: CLI can create/select a session, send a message, and show live output.
- [ ] SC-004: `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit` pass documented acceptance checks.
- [ ] SC-005: Web Chat UI remains unchanged and builds successfully.
- [ ] SC-006: V1 excludes Web-only product areas listed in out-of-scope.

## Assumptions and Open Questions

### V1 Scope Decisions

- Final V1 command name: `pibo tui:sessions`.
- V1 starts with local/direct session source integration and keeps a `SessionSource` interface for later Gateway mode.
- V1 Slash Commands are `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit`.
- `/model`, `/thinking`, `/fork`, and `/details` are later-scope commands unless separately approved.

### Open Questions

- Exact room source and local owner-scope semantics.
- Exact default transcript row window for the first renderer.

## Traceability

| Requirement | PRD coverage | Task phase | Status |
|---|---|---|---|
| New command | PRD 05 | Phase 3 | Draft |
| Reduced subset | PRD 01 | All | Draft |
| Shared view model | PRD 02 | Phase 1 | Draft |
| Ink renderer | PRD 03 | Phase 2 | Draft |
| Session source | PRD 04 | Phase 3 | Draft |
| SSH/recovery | PRD 06 | Phase 4 | Draft |
