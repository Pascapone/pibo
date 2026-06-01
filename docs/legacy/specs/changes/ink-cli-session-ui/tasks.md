# Tasks: Ink CLI Session UI

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `proposal.md`, `spec.md`, `design.md`, `prds/README.md`

## Phase 0: Finalize scope and command naming

- [x] T0.1 Decide final command name: `pibo tui:sessions`.
- [x] T0.2 Decide V1 session source: local/direct first, with `SessionSource` kept Gateway-/hybrid-ready for later work.
- [x] T0.3 Decide `/model`, `/thinking`, `/fork`, and `/details`: later-scope unless separately approved.
- [x] T0.4 Update proposal/spec/design with V1 decisions.

## Phase 1: Shared terminal view model

- [ ] T1.1 Move or re-export `terminalRows.ts` and `terminalValue.ts` through a renderer-neutral boundary.
- [ ] T1.2 Ensure shared modules do not import React DOM, browser APIs, Tailwind/CSS, Virtuoso, lucide, or Ink.
- [ ] T1.3 Update Web compact terminal imports with minimal churn.
- [ ] T1.4 Add fixtures for representative `PiboSessionTraceView` cases.
- [ ] T1.5 Add tests for compact row generation and truncation/preview behavior.
- [ ] T1.6 Run root and Chat Web typechecks.

## Phase 2: Static Ink renderer

- [ ] T2.1 Add Ink dependency/version decision and document it.
- [ ] T2.2 Implement terminal color/symbol mapping for row status and tone.
- [ ] T2.3 Implement `InkTerminalLine` and `InkTerminalRow`.
- [ ] T2.4 Implement bounded JSON and markdown simplification helpers.
- [ ] T2.5 Implement `InkTerminalView` over shared row fixtures.
- [ ] T2.6 Add `renderToString()` tests for representative rows.
- [ ] T2.7 Verify no Web-only dependencies enter the CLI renderer.

## Phase 3: Session controller and interactive app

- [x] T3.1 Define `CliSessionSource` and fake test source.
- [x] T3.2 Implement controller state for current room, session, agent, status, rows, input, picker mode, and errors.
- [x] T3.3 Implement Slash Command parser and command results.
- [x] T3.4 Implement `/help`, `/status`, `/clear`, `/exit`, `/quit`.
- [x] T3.5 Implement `/session` picker with cancellation.
- [x] T3.6 Implement `/new` session flow.
- [x] T3.7 Implement `/agent` picker for existing profiles.
- [x] T3.8 Implement message sending for normal non-command input.
- [x] T3.9 Implement update subscription and row refresh for live session changes.

## Phase 4: CLI command integration

- [x] T4.1 Register the new command in `src/cli.ts`.
- [x] T4.2 Update root CLI discovery text.
- [x] T4.3 Add `--help` output for the command.
- [x] T4.4 Ensure existing `pibo tui` and `pibo tui:routed` continue to work.
- [x] T4.5 Add command-level tests where current CLI test infrastructure allows.

## Phase 5: SSH/recovery hardening

- [x] T5.1 Add TTY detection and non-TTY fallback/error behavior.
- [x] T5.2 Handle no sessions, no rooms, no profiles, and source unavailable states.
- [x] T5.3 Ensure `Ctrl+C`, `/exit`, and `/quit` close subscriptions and restore terminal state.
- [x] T5.4 Add large-session row-window limits.
- [x] T5.5 Add narrow-terminal wrapping/truncation checks.
- [x] T5.6 Document recovery usage and Web-only feature boundaries.

## Phase 6: Validation

- [x] T6.1 Run `npm run typecheck`.
- [x] T6.2 Run relevant tests.
- [x] T6.3 Run manual TTY smoke test.
- [x] T6.4 Verify Web Chat UI build/typecheck still passes.
- [x] T6.5 Verify unsupported Web-only features are not exposed in CLI V1.
- [x] T6.6 Update PRD/task status after implementation.

## Acceptance Checklist

- [x] New CLI command starts an Ink app in a TTY.
- [x] CLI can create/select sessions.
- [x] CLI can send a normal message.
- [x] CLI shows live compact transcript output.
- [x] CLI can choose existing agent/profile.
- [x] `/help`, `/new`, `/session`, `/agent`, `/status`, `/clear`, `/exit`, and `/quit` work.
- [x] Projects, Workflows, Cron, Ralph, Agent Designer, and full Settings are absent from V1 CLI.
- [x] Shared row model is reused by Web and CLI.
- [x] Web Chat UI remains unchanged.
- [x] Typecheck passes.
