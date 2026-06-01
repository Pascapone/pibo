# Proposal: Ink CLI Session UI

**Status:** Draft  
**Created:** 2026-05-16  
**Owner / Source:** User request and `docs/reports/ink-cli-session-subset-report.md`  
**Related docs:** `docs/specs/capabilities/cli-session-ui.md`, `docs/specs/capabilities/shared-terminal-view-model.md`, `docs/specs/capabilities/local-routed-tui.md`

## Summary

Build a native Ink-based Pibo CLI Session UI that lets users operate Pibo chat sessions directly in a shell. The CLI is a deliberately reduced subset of the Web Chat UI. It supports starting/selecting sessions, sending messages, viewing compact transcript/trace output, and switching existing agents/profiles. It excludes Projects, Workflows, Cron, Ralph, Agent Designer, full settings, and full context-management surfaces.

The Web Chat UI remains Pibo's main control center. The CLI borrows the Web Chat session concept and shared terminal view model, but it does not reuse Web DOM components.

## Motivation

Pibo users need a reliable native interface when:

- connected over SSH,
- setting up a new server,
- the Web UI or Gateway is unavailable,
- working in a low-overhead terminal-only environment,
- quickly interacting with an agent without opening a browser.

The current Web Chat UI is feature-rich but browser-dependent. Existing TUI commands do not provide the desired session-selection and shared compact terminal rendering. Ink provides a React-compatible terminal renderer that fits this need.

## Goals

- Add a native terminal session UI using Ink.
- Preserve Web Chat as the authoritative full-featured UI.
- Reuse shared trace/session and compact terminal row data.
- Avoid reusing or modifying Web DOM presentation components.
- Provide a small Slash Command surface for core session work.
- Support SSH/recovery use without requiring the Web UI.
- Keep implementation phased and testable.

## Non-Goals

- Replacing Web Chat.
- Porting all Web UI features to CLI.
- Implementing Projects, Workflows, Cron, Ralph, Agent Designer, or full Settings in V1.
- Recreating browser markdown, SVG icons, hover controls, or virtualized DOM scrolling in terminal.
- Building a new trace mapping stack separate from the shared terminal view model.

## Proposed Scope

V1 scope:

1. Shared terminal view-model extraction or documented shared boundary.
2. Static Ink compact transcript renderer.
3. Interactive CLI app with status bar, transcript viewport, input line, Slash Commands, and pickers.
4. Session source integration for local/direct operation, with interface seams for future Gateway-backed mode.
5. SSH/recovery hardening and documentation.

## User Experience Summary

A user starts the CLI and sees:

```text
┌──────────────────────────────────────────────┐
│ room/session/agent/model/state               │
├──────────────────────────────────────────────┤
│ compact transcript rows                      │
├──────────────────────────────────────────────┤
│ › message or /command                        │
└──────────────────────────────────────────────┘
```

Supported initial commands:

- `/help`
- `/new`
- `/session`
- `/agent`
- `/status`
- `/clear`
- `/exit`
- `/quit`

Optional later commands:

- `/model`
- `/thinking`
- `/fork`
- `/details`

## Architecture Summary

```text
Pibo stores / runtime / router / event stream
        ↓
PiboSessionTraceView
        ↓
shared buildCompactTerminalRows()
        ↓
 ┌────────────────────────────┬────────────────────────────┐
 │ Web renderer               │ Ink renderer                │
 │ React DOM + Tailwind       │ React Ink + Box/Text        │
 │ existing Web UI            │ new shell UI                │
 └────────────────────────────┴────────────────────────────┘
```

## Impact

### Web UI

Web UI should remain visually and behaviorally unchanged. Shared view-model extraction may change import paths but must not change the user-facing Web Chat session view.

### CLI

The CLI gains a new session-first interactive surface. Existing `pibo tui` and `pibo tui:routed` should continue to work unless a separate migration spec changes them.

### Data model

No new persistent data model is required for the first renderer phase. Runtime/session-source integration may use existing session stores and trace/event streams.

## Risks

- Shared model extraction could accidentally change Web terminal behavior.
- Ink rendering of large sessions could be slow without bounded windowing.
- Runtime/session integration could duplicate Gateway/Web logic if not isolated behind a `SessionSource` boundary.
- Users may expect Web-only features in CLI; documentation and `/help` must clearly state scope.

## Rollout Strategy

1. Documentation/spec approval.
2. Shared view-model extraction with tests.
3. Static Ink renderer and render-to-string tests.
4. Interactive app and Slash Commands.
5. Session source/live runtime integration.
6. SSH/recovery hardening and final docs.

## V1 Decisions and Remaining Questions

### Decisions

- Final V1 command name: `pibo tui:sessions`.
- V1 source mode: local/direct first, with the `SessionSource` seam kept Gateway-/hybrid-ready for later work.
- V1 Slash Commands: `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit`.
- `/model`, `/thinking`, `/fork`, and `/details` are later-scope commands unless a separate spec approves them.

### Remaining Questions

- Exact room semantics in CLI local mode.
- Exact default transcript row window for the first renderer.
