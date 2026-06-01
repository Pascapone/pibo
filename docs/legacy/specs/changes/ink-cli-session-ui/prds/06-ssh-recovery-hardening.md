# PRD: Ink CLI Session UI — SSH and Recovery Hardening

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: The CLI is specifically intended for SSH, bootstrap, and recovery scenarios, so it must fail clearly, clean up terminal state, and remain usable in constrained terminals.
- **Proposed Solution**: Add TTY detection, bounded rendering, clean shutdown, empty/error states, documentation, and validation checks.
- **Success Criteria**:
  - SC-01: Non-TTY execution does not start a broken interactive UI.
  - SC-02: `Ctrl+C`, `/exit`, and `/quit` clean up subscriptions and terminal state.
  - SC-03: Empty or unavailable sessions/rooms/agents show actionable messages.
  - SC-04: Large sessions render through bounded windows.
  - SC-05: Docs explain SSH/recovery use and Web-only feature boundaries.

## 2. User Experience & Functionality

- **User Personas**:
  - Operator recovering from Web UI failure.
  - Developer using a narrow SSH terminal.
  - Maintainer validating release readiness.

- **User Stories**:
  - As an SSH operator, I want clear error messages if the local source is unavailable so that I know what to fix next.
  - As a terminal user, I want the app to exit cleanly so that my shell is not corrupted.
  - As a user with large sessions, I want bounded transcript rendering so that the CLI remains responsive.
  - As a maintainer, I want documentation and validation steps so that this recovery path stays reliable.

- **Acceptance Criteria**:
  - The app checks whether it is running in an interactive TTY.
  - Non-TTY behavior is documented and tested.
  - Session-source errors show concise recovery hints.
  - Empty states exist for no sessions, no rooms, and no profiles.
  - Large row lists are windowed or limited by default.
  - Narrow terminals do not crash the renderer.
  - Exit paths close subscriptions and runtime/source resources.
  - Documentation states that Web Chat remains the full control center.

- **Ralph Work Package Derivation**:
  - `US-001`: add TTY detection and fallback/error behavior.
  - `US-002`: add cleanup and source-close tests.
  - `US-003`: add empty/error states.
  - `US-004`: add large-session and narrow-terminal bounds.
  - `US-005`: add user docs and validation checklist.

- **Non-Goals**:
  - Full offline mode without a usable local runtime/source.
  - Rich terminal configuration UI.
  - Web UI recovery automation.

## 3. AI System Requirements (If Applicable)

- **Tool Requirements**:
  - Test hooks for fake TTY/non-TTY state where feasible.
  - Fake source for cleanup/error tests.

- **Evaluation Strategy**:
  - Unit tests for fallback and controller cleanup.
  - Manual TTY smoke test.
  - Manual or scripted non-TTY check.
  - Typecheck.

## 4. Technical Specifications

- **Architecture Overview**:
  - CLI command validates TTY before launching Ink.
  - App owns cleanup callbacks and source lifecycle.
  - Renderer uses bounded viewport defaults.
  - Docs provide command examples and Web-only boundaries.

- **Integration Points**:
  - CLI command bootstrap.
  - `CliSessionSource.close()`.
  - Ink renderer viewport options.
  - docs/specs and README/help text.

- **Security & Privacy**:
  - Error/status messages redact config and auth secrets.
  - Recovery docs must not instruct users to expose secrets.

## 5. SSH Recovery Usage

Start the V1 terminal UI from an interactive shell or SSH session:

```bash
pibo tui:sessions
```

Useful recovery options:

```bash
pibo tui:sessions --session <pibo-session-id>
pibo tui:sessions --owner-scope <owner-scope>
pibo tui:sessions --max-rows 20
pibo tui:sessions --demo
```

The command requires interactive stdin and stdout TTYs. Piped execution exits with a concise error instead of starting a broken Ink UI. The transcript uses a bounded default tail window of 20 rows and truncates long lines for narrow SSH terminals.

Inside the app:

- `/help` lists supported commands and Web-only V1 exclusions.
- `/new` creates a local CLI session.
- `/session` opens the existing-session picker, or explains how to create one when none exist.
- `/agent` lists existing agents/profiles only; it does not edit profiles.
- `/status` prints redacted source/session/agent/model state.
- `/clear` clears only the local rendered transcript window.
- `/exit` and `/quit` leave the app cleanly. `Ctrl+C` uses the same cleanup path.

Web Chat remains the full control center. CLI V1 does not expose Projects, Workflows, Cron, Ralph, Agent Designer, full Settings, or full context-management surfaces. Later-scope Slash Commands remain `/model`, `/thinking`, `/fork`, and `/details` unless a separate spec approves them.

## 6. Validation Checklist

- Run `npm run typecheck` in the Docker worker.
- Run focused CLI UI tests after `npm run build`.
- Run the full test suite.
- Check non-TTY behavior with `node dist/bin/pibo.js tui:sessions --demo` from a non-interactive process and verify it exits with a clear TTY error.
- Run an interactive or pseudo-TTY smoke check for `pibo tui:sessions --demo --max-rows 5`: confirm the status bar, transcript, input prompt, `/help`, `/status`, `/session`, `/agent`, `/new`, `/clear`, `/quit`, and `Ctrl+C` recovery paths.
- For Web-impacting changes, run Chat Web typecheck/build and confirm compact terminal behavior was not intentionally changed.
- Confirm unsupported Web-only areas are not exposed through CLI V1 help or commands.

## 7. Risks & Roadmap

- **Phased Rollout**:
  - MVP: non-TTY guard and cleanup.
  - V1: empty/error states and docs.
  - Later: richer diagnostics and optional plain-output mode.

- **Technical Risks**:
  - Terminal capabilities vary over SSH.
  - Tests may need abstraction to simulate TTY behavior.
  - Overly verbose error messages may expose sensitive local state.
