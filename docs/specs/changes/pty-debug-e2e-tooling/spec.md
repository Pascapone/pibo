# Spec: PTY Debug and E2E Tooling

**Status:** Done
**Created:** 2026-05-16
**Updated:** 2026-05-17
**Controller / Source:** User request after Ink CLI Session UI validation failure
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `docs/specs/capabilities/cli-pty-validation.md`

## Why

Interactive CLIs fail in ways that unit tests and non-TTY process execution do not catch. Pibo needs built-in PTY tooling so agents can validate real terminal behavior, inspect captures, and run safe E2E tests before declaring CLI/TUI stories complete.

## Goal

Implement `pibo debug pty` as a standard debugging and validation surface for PTY-backed CLI/TUI scenarios on host and Docker targets, with deterministic mocked-provider support and explicit bounded real-provider mode.

## Current Implementation

The current code implements `pibo debug pty run`, `pibo debug pty scenario`, and `pibo debug pty list-scenarios` in `src/debug/pty.ts`. Host and Docker backends use a Python PTY driver; Docker execution requires a running worker/container with `python3` or `python`. Scenario files and CLI overrides support command, environment, workdir, terminal size, scripted steps, expectations, rejection patterns, timeouts, provider mode, max iterations, artifacts, and a built-in `cli-session-ui-mocked-e2e` scenario. Real-provider mode requires `--real-provider` and iteration-marked steps. Failed runs always write artifacts.

## Requirements

### Requirement: `pibo debug pty run` executes arbitrary commands under PTY

The system MUST provide a debug command that runs a command under a pseudo-terminal with configurable terminal size, environment, working directory, timeout, and input script.

#### Acceptance

A command such as `pibo debug pty run --rows 24 --cols 100 -- pibo tui:sessions --demo` starts under PTY and writes artifacts.

### Requirement: Scenarios are declarative

The system MUST support scenario files for repeatable PTY flows.

#### Acceptance

A scenario can define command, target, workdir, env, rows, cols, input steps, waits, expectations, rejection patterns, timeouts, provider mode, max iterations, and artifact settings.

### Requirement: Input steps support terminal-safe typing

The system MUST support both raw bytes and per-character typing with configurable delays.

#### Acceptance

A scenario can reliably enter `/status`, wait for output, then enter `/quit` in an Ink app without merging commands or missing Enter events.

### Requirement: Output assertions include expected and forbidden text

The system MUST support assertions against cleaned terminal text and SHOULD retain raw ANSI for diagnosis.

#### Acceptance

A scenario can fail if expected text is missing or forbidden text appears, while preserving raw output for review.

### Requirement: Artifact capture is mandatory on failure

The system MUST write artifacts for failed PTY runs.

#### Acceptance

A failed run creates an artifact directory containing at least:

- `metadata.json`
- `raw.ansi.log`
- `clean.txt`
- `screen.txt` or best available final capture
- `input.json`
- `assertions.json`

### Requirement: Host and Docker targets are supported

The system MUST support running the PTY process on the host and inside a named Docker worker.

#### Acceptance

A scenario can run with no Docker option on the host, or with `--docker-worker pibo-dev-... --workdir /workspace` inside a worker.

### Requirement: Mocked-provider E2E is the default for model flows

Scenarios that need assistant output SHOULD use a mocked provider unless `--real-provider` is explicitly set.

#### Acceptance

The CLI Session UI scenario can validate assistant response rendering without real provider credentials.

### Requirement: Real provider mode is explicit and bounded

The system MUST require `--real-provider` for live provider calls and MUST enforce safety bounds.

#### Acceptance

When `--real-provider` is set:

- `--max-iterations` defaults to `10`.
- A wall-clock timeout is required or defaulted.
- An idle timeout is required or defaulted.
- Exceeding max iterations terminates the PTY run and marks it failed with diagnostics.

### Requirement: Agent-to-agent loops are guarded

The system MUST prevent unbounded model-backed conversation loops.

#### Acceptance

A real-provider scenario stops on the first satisfied stop condition: expected output, explicit stop pattern, max iterations, wall-clock timeout, idle timeout, process exit, or external cancellation.

### Requirement: CLI Session UI has a canonical scenario

The system MUST include or document a canonical scenario for `pibo tui:sessions`.

#### Acceptance

The canonical scenario covers:

- startup under PTY
- `/new` or opening a test session
- agent/profile visibility where applicable
- sending a message
- receiving assistant output in mocked mode
- `/status`
- `/quit`
- artifact capture

## Edge Cases

- Missing PTY support on a platform.
- Docker worker not running or lacking required command.
- Terminal output uses alternate screen.
- Command exits before expectations are met.
- Command ignores `/quit` and needs Ctrl+C/terminate.
- ANSI cleanup accidentally removes meaningful text.
- Real provider streams partial output but never completes.

## Success Criteria

- [x] SC-001: PTY run command supports host execution and artifacts, as covered by `test/debug-pty.test.mjs`.
- [x] SC-002: PTY scenario command supports declarative scenario files, as covered by `test/debug-pty.test.mjs`.
- [x] SC-003: Docker-worker PTY target works or fails with actionable diagnostics, as source-inspected in `src/debug/pty.ts`; direct worker smoke coverage remains a test gap.
- [x] SC-004: Canonical CLI Session UI mocked-provider scenario is implemented for deterministic execution; it remains source-inspected rather than part of default `npm test`.
- [x] SC-005: Real-provider mode requires explicit opt-in and enforces default max iterations of 10, as covered by `test/debug-pty.test.mjs`.
- [x] SC-006: Future Ralph prompts can reference this tool as a validation gate for CLI/TUI work through `pibo debug pty --help`, this change spec, and the CLI PTY Validation capability spec.

## Verification Basis

Implemented behavior was refreshed against `src/debug/index.ts`, `src/debug/pty.ts`, `src/cli.ts`, `src/apps/cli-ui/cliSessionsCommand.ts`, `test/debug-pty.test.mjs`, and `test/cli-ui-session-app.test.mjs`.
