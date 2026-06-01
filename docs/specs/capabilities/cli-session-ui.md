# Spec: CLI Session UI

**Status:** Draft
**Created:** 2026-05-16
**Updated:** 2026-05-17
**Controller / Source:** User request and `docs/reports/ink-cli-session-subset-report.md`
**Related docs:** `docs/specs/capabilities/chat-web-trace-and-terminal-view.md`, `docs/specs/capabilities/local-routed-tui.md`, `docs/specs/capabilities/shared-terminal-view-model.md`, `docs/specs/changes/ink-cli-session-ui/`

## Why

Pibo needs a native shell-first interface for operators and agents who connect over SSH, work on a fresh server, recover from a broken Web UI/Web Gateway, or want to interact with a Pibo session without opening a browser.

The existing Chat Web UI remains the primary Pibo control center. The CLI Session UI is a reduced session-oriented interface derived from the Web Chat session experience. It must provide the minimum viable Pibo chat/session workflow while excluding project, workflow, automation, and designer surfaces that belong in the Web UI.

## Goal

Provide an Ink-based native terminal UI for starting, selecting, and operating Pibo chat sessions while reusing shared Pibo session/trace view models and preserving the Web Chat UI as the full-featured primary interface.

## Background / Current State

Pibo exposes terminal-related commands such as `pibo tui`, `pibo tui:routed`, `pibo tui:sessions`, and `pibo client`. The Web Chat UI remains the richer browser session interface, including the compact terminal view and trace-derived session rendering.

The implemented `pibo tui:sessions` command starts an Ink app for a reduced Web Chat-derived session workflow. It uses a `CliSessionSource` abstraction with fake and local/direct implementations, creates local `cli-session-ui` sessions, lists sessions/derived rooms and profiles, opens a bounded transcript viewport, sends messages through a local routed runtime when available, and supports `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit`. The command rejects non-interactive stdin/stdout before rendering.

The investigation in `docs/reports/ink-cli-session-subset-report.md` found that Ink can render a native terminal interface using React components, but it cannot directly reuse DOM-specific Web UI components such as `div`, `button`, Tailwind classes, `react-virtuoso`, `lucide-react`, `react-markdown`, or `@uiw/react-json-view`.

The durable reuse point is the shared data and view-model layer: `PiboSessionTraceView`, trace events, and compact terminal rows. Current tests cover reducer behavior, slash-command handling, redacted recovery messages, bounded terminal rendering, non-TTY rejection, command help, and fake-source smoke behavior.

## Scope

### In Scope

- A native interactive terminal session UI built with Ink.
- Session-oriented chat workflows: start session, select session, send message, view streamed output.
- Minimal room/session selection where supported by local data or session source.
- Agent/profile selection via CLI interaction, for example `/agent`.
- Compact terminal transcript rendering using shared terminal view-model data.
- Basic Slash Commands: `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, `/quit`.
- Recovery/SSH use where Web UI is unavailable.
- Non-TTY fallback behavior for clear errors or plain output.
- Tests for shared row generation and Ink rendering snapshots.

### Out of Scope

- Replacing the Web Chat UI — the Web UI remains the main interface.
- Projects and project dashboards.
- Workflows and Workflow/XState visualizations.
- Cron job management.
- Ralph job management.
- Agent Designer or agent profile editing UI.
- Full settings UI.
- Full context-file or knowledge-management UI.
- Browser-style modals, hover controls, drag-and-drop, tables, SVG icons, or DOM markdown rendering.
- Direct reuse of Web DOM presentation components inside Ink.

## Requirements

### Requirement: CLI is a subset of Web Chat, not a replacement

The CLI Session UI MUST present a reduced session/chat workflow derived from the Web Chat UI while leaving the Web UI as Pibo's full-featured control center.

#### Current

The Web Chat UI contains session views, compact terminal rendering, workflow view registration, settings, context, projects, and other browser-first controls. `pibo tui:sessions` provides only the reduced session/chat subset and leaves Projects, Workflows, Cron, Ralph, Agent Designer, full Settings, context management, `/model`, `/thinking`, `/fork`, and `/details` outside V1.

#### Target

The CLI continues to support only the session/chat subset. Web-only capabilities remain discoverable and operable in the Web UI, not recreated in V1 CLI.

#### Acceptance

A reviewer can inspect the CLI documentation and implementation and verify that project, workflow, Cron, Ralph, and Agent Designer workflows are not exposed through the V1 interactive Ink surface.

#### Scenario: Operator uses CLI over SSH

- GIVEN an operator has SSH access to a machine with Pibo installed
- AND the Web UI is not running
- WHEN the operator starts the CLI Session UI
- THEN the operator can select or create a Pibo session and send messages
- AND the CLI does not require the Web UI to be open.

### Requirement: CLI uses Ink presentation components

The CLI Session UI MUST use Ink primitives for terminal presentation and MUST NOT depend on browser DOM components for rendering.

#### Acceptance

Terminal UI components render through Ink `Box`, `Text`, and terminal-safe helpers. They do not import `react-dom`, `react-virtuoso`, Tailwind CSS classes, `lucide-react`, `@uiw/react-json-view`, or browser-only markdown renderers.

### Requirement: CLI and Web share view-model/data logic

The CLI Session UI MUST reuse shared Pibo trace/session data and compact terminal row models instead of reimplementing trace-to-row mapping only for CLI.

#### Acceptance

The CLI transcript renderer consumes `PiboSessionTraceView` and shared `CompactTerminalRow`-style records. Row-generation tests cover both Web-compatible and CLI-compatible usage.

### Requirement: Web UI remains behaviorally unchanged

Implementing the CLI Session UI MUST NOT force visual or behavioral changes to the existing Web Chat UI.

#### Acceptance

Existing Chat Web typecheck/build tests pass after shared view-model extraction. Web terminal view imports may change, but rendered behavior must remain intentionally unchanged unless a separate Web UI spec approves a change.

### Requirement: Session selection is CLI-native

The CLI Session UI MUST let a user select or create a session with terminal controls and Slash Commands.

#### Acceptance

`/session` opens a terminal selection flow. `/new` creates a local CLI session through the selected source and opens it in the transcript. Both flows return to the transcript after completion or cancellation.

### Requirement: Agent selection is CLI-native and limited

The CLI Session UI MUST support selecting an existing agent/profile but MUST NOT include profile editing or Agent Designer behavior in V1.

#### Acceptance

`/agent` lists available profiles from the session source. The local/direct source reads current plugin-registry profiles and custom agents converted to profile definitions. Selecting the current profile is a no-op; changing an existing local session profile is rejected with guidance to create a new session. The CLI does not create, edit, or delete profiles.

### Requirement: Transcript renders live compact session state

The CLI Session UI MUST show user messages, assistant output, tool calls, tool results, yielded runs, and errors in a compact terminal transcript.

#### Acceptance

Given a trace view containing user and assistant output, and representative compact terminal rows, the Ink renderer produces bounded terminal output with status markers, truncation for narrow terminals, and an omitted-row notice for large sessions. It does not crash on missing optional fields.

### Requirement: Slash Commands are explicit and bounded

The CLI Session UI MUST expose a small, documented Slash Command surface and reject unsupported commands with clear feedback.

#### Acceptance

`/help` lists V1 commands. Unknown commands display an error and do not fall through to unrelated Pi or Web behavior. `/exit` and `/quit` terminate cleanly.

### Requirement: CLI supports recovery and non-TTY behavior

The CLI Session UI MUST fail clearly when required local state is unavailable and MUST avoid corrupting terminal state.

#### Acceptance

If no sessions or rooms are available, the CLI displays an actionable message that points to `/new`. If stdin or stdout is not a TTY, the command exits before rendering with a clear error that instructs the operator to rerun from a terminal or SSH session.

## Edge Cases

- No sessions exist yet.
- Room list is empty or unavailable in local mode.
- Agent/profile list is empty or profile resolution fails.
- Current session is deleted or unavailable while selected.
- Runtime sends malformed or incomplete trace data.
- Terminal width is small.
- Large sessions exceed the default render window.
- User presses `Ctrl+C` during streaming.
- Session source disconnects or Web/Gateway source becomes unavailable.

## Constraints

- **Primary interface:** Web Chat UI remains the authoritative full-control interface.
- **Presentation:** Ink components are required for terminal rendering.
- **Reuse boundary:** Share data/view models, not DOM components.
- **Performance:** V1 must render a bounded transcript window, not the full unbounded session history.
- **Compatibility:** Existing `pibo tui` and `pibo tui:routed` behavior must not be broken without an explicit migration plan.
- **Security / privacy:** CLI output must not reveal more session/tool detail by default than existing Web compact terminal and debug conventions allow.

## Success Criteria

- [x] SC-001: A user can run the CLI Session UI from a shell and create or select a Pibo session without opening Web Chat, as source-inspected in `src/apps/cli-ui/cliSessionsCommand.ts` and covered by fake-source command tests.
- [x] SC-002: The CLI renders compact transcript rows from shared `PiboSessionTraceView`/terminal row data, as covered by `test/cli-ui-session-app.test.mjs`.
- [x] SC-003: `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit` are implemented and documented, as covered by `test/cli-ui-session-app.test.mjs`.
- [x] SC-004: V1 CLI excludes Projects, Workflows, Cron, Ralph, Agent Designer, and full Settings surfaces, as documented in CLI help and slash help tests.
- [ ] SC-005: Web Chat UI builds and behaves as before after shared view-model extraction.
- [x] SC-006: Ink rendering has snapshot/string tests for representative trace rows, as covered by `test/cli-ui-session-app.test.mjs`.
- [x] SC-007: The command rejects non-interactive stdin/stdout before rendering, as covered by `test/cli-ui-session-app.test.mjs`.

## Assumptions and Open Questions

### V1 Scope Decisions

- V1 command name is `pibo tui:sessions`.
- V1 uses a local/direct session source first, with a fake/demo source and a debug PTY mocked-source seam, and keeps the `CliSessionSource` interface open for later Gateway-backed operation.
- V1 Slash Commands are `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit`.
- `/model`, `/thinking`, `/fork`, and `/details` are later-scope commands unless a separate spec approves them.
- Room support in V1 depends on what the chosen local/direct session source can list without Web UI.

### Open Questions

- What exact maximum row window should the first renderer use?
- Should changing the profile of an existing local CLI session remain unsupported, or should the CLI add a separate current-session migration/action once runtime semantics are clear?

## Traceability

| Requirement | Related change docs | Status |
|---|---|---|
| CLI subset of Web Chat | `src/apps/cli-ui/InkSessionApp.ts`, `src/apps/cli-ui/cliSessionsCommand.ts`, `test/cli-ui-session-app.test.mjs` | Component-tested |
| Shared terminal model | `src/session-ui/`, `src/shared/trace-types.ts`, `test/cli-ui-session-app.test.mjs` | Component-tested |
| Ink renderer | `src/apps/cli-ui/InkSessionApp.ts`, `test/cli-ui-session-app.test.mjs` | Component-tested |
| Slash Commands | `src/apps/cli-ui/InkSessionApp.ts`, `test/cli-ui-session-app.test.mjs` | Component-tested |
| Local/direct session source | `src/cli-session/localSessionSource.ts`, `src/apps/cli-ui/cliSessionsCommand.ts`, `test/cli-session-source.test.mjs` | Component-tested |
| PTY validation seam | `src/debug/pty.ts`, `src/apps/cli-ui/cliSessionsCommand.ts`, `test/debug-pty.test.mjs` | Source-inspected / partly component-tested |
| Web unchanged | `docs/specs/changes/ink-cli-session-ui/tasks.md` | Source-inspected |

## Verification Basis

This spec was refreshed against current code in `src/cli.ts`, `src/apps/cli-ui/InkSessionApp.ts`, `src/apps/cli-ui/cliSessionsCommand.ts`, `src/cli-session/sessionSource.ts`, `src/cli-session/localSessionSource.ts`, `src/cli-session/fakeSessionSource.ts`, `src/session-ui/`, `src/apps/chat/trace.ts`, `src/debug/pty.ts`, and tests including `test/cli-ui-session-app.test.mjs`, `test/cli-session-source.test.mjs`, and `test/debug-pty.test.mjs`.
