# Spec: CLI PTY Validation

**Status:** Draft
**Created:** 2026-05-16
**Updated:** 2026-05-17
**Controller / Source:** User investigation after Ink CLI Session UI validation gap
**Related docs:** `docs/specs/changes/pty-debug-e2e-tooling/`, `docs/specs/capabilities/cli-session-ui.md`

## Why

Pibo needs reliable tooling for debugging and validating interactive terminal UIs. The Ink CLI Session UI shipped with unit tests and demo-mode PTY smoke checks, but the real default runtime path was not validated: custom agents were missing, messages did not reach a real router, and Web/CLI session visibility was not proven.

Future agents must be able to run deterministic PTY tests, inspect terminal output, capture artifacts, and optionally run bounded real-provider end-to-end checks without entering unbounded agent-to-agent loops.

## Goal

Provide a standard PTY validation capability, exposed through `pibo debug pty`, that can run on both host and Docker workers, capture terminal artifacts, and verify real CLI behavior with safe bounds.

## Background / Current State

`pibo debug pty` is implemented under `pibo debug` with `run`, `scenario`, and `list-scenarios` subcommands. The command uses a Python PTY driver on the host, can run inside a named Docker container through `docker exec` when `python3` or `python` is available, supports JSON scenario files, and includes a built-in `cli-session-ui-mocked-e2e` scenario. Failed runs always write artifacts; successful runs write artifacts when `--artifact` is set.

The current implementation defaults scenario provider mode to `mocked`. Real-provider scenarios require the `--real-provider` flag, default `maxIterations` to 10, require an iteration-marked step, and require a timeout plus an expected output, stop pattern, or wait condition. The canonical CLI Session UI scenario uses `PIBO_DEBUG_PTY_CLI_SESSIONS_MOCKED=1` and a temporary `PIBO_HOME` under the artifact directory to avoid depending on host custom agents or real providers.

## Scope

### In Scope

- A `pibo debug pty` command family for interactive CLI/TUI validation.
- PTY-backed command execution with scripted input, terminal size, timeout, and output assertions.
- Artifact capture: raw ANSI output, cleaned text, final screen/capture, command metadata, exit status, and failure diagnostics.
- Deterministic mocked-provider flows for repeatable E2E tests.
- Optional real-provider execution behind an explicit flag.
- Safety bounds for real-provider tests, including default maximum interaction/turn count of 10.
- Support for host and Docker-worker execution.
- Clear guidance for Ralph/agent validation gates.

### Out of Scope

- Running real-provider PTY E2E tests by default in `npm test`.
- Replacing normal unit/component tests.
- Visual screenshot diffing as the primary assertion mechanism.
- Unbounded autonomous agent-to-agent conversations.

## Requirements

### Requirement: PTY command execution is first-class

Pibo MUST provide a `pibo debug pty` command that can run an interactive CLI process under a pseudo-terminal.

#### Acceptance

A maintainer can run a Pibo CLI command through `pibo debug pty run -- <command...>` with configured rows, columns, timeout, environment, working directory, scripted input, expectations, rejection patterns, and optional success artifacts.

### Requirement: Artifacts are captured on every failure

PTY validation MUST write diagnostic artifacts when a run fails and SHOULD support artifact capture for successful runs.

#### Acceptance

A failed run produces `metadata.json`, `input.json`, `assertions.json`, `raw.ansi.log`, `clean.txt`, `screen.txt`, and, when available, `events.jsonl` and `driver.stderr.log`.

### Requirement: Host and Docker execution are supported

PTY validation MUST work on the host and inside a dedicated Docker worker.

#### Acceptance

The same validation scenario can target the installed host `pibo` binary or run inside a named Docker worker/container with `--docker-worker` and an optional `--workdir`, failing before execution with actionable diagnostics when the container or Python PTY driver is unavailable.

### Requirement: Mocked provider mode is deterministic

The default E2E mode SHOULD avoid live model calls by using mocked provider responses or deterministic local sources.

#### Acceptance

The built-in `cli-session-ui-mocked-e2e` scenario starts `pibo tui:sessions` without `--demo`, injects a deterministic debug mocked local source, creates a session, sends `Hi`, waits for a mocked assistant response, runs `/status`, exits with `/quit`, and avoids real provider credentials.

### Requirement: Real-provider mode is explicit and bounded

Real provider E2E tests MUST require an explicit flag such as `--real-provider` and MUST enforce safety bounds.

#### Acceptance

A real-provider PTY run requires `--real-provider`, defaults to at most 10 iteration-marked steps, and fails closed if the bound is exceeded or no enforceable iteration step and stop/expectation condition is present. The limit can be lowered or explicitly raised by a human-provided option.

### Requirement: Agent-to-agent loops are prevented

PTY validation MUST avoid unbounded loops when a CLI-controlled agent sends messages to another model-backed agent.

#### Acceptance

Validation scenarios include max iterations, wall-clock timeout, idle timeout, and stop-pattern checks. Exceeding any bound terminates the PTY process and records diagnostics.

### Requirement: Scenarios are scriptable and reviewable

PTY validation scenarios SHOULD be expressible as small scripts or JSON/YAML definitions that agents can read and execute.

#### Acceptance

A scenario can declare command, environment, terminal size, input steps, waits, expected output, forbidden output, timeouts, artifact path, and provider mode.

## Edge Cases

- Ink/React input requires per-character typing with small delays.
- Terminal apps using alternate screen buffers.
- Commands that do not exit after `/quit` or Ctrl+C.
- Provider streaming takes longer than expected.
- Docker worker lacks `tmux` but has Python PTY or `script`.
- ANSI output includes control sequences that cleaned text should remove without hiding raw output.
- The CLI starts but no assistant answer arrives.
- Custom agents exist on host but not inside Docker worker.

## Constraints

- **Safety:** Real-provider runs require explicit opt-in and bounded iterations.
- **Determinism:** Mocked-provider mode is preferred for repeatable CI/Ralph validation.
- **Artifacts:** Failures must leave enough output to diagnose rendering, input, and runtime issues.
- **Portability:** Host and Docker-worker execution must be supported; optional tmux features may be skipped when unavailable.

## Success Criteria

- [x] SC-001: `pibo debug pty` can run a scripted host PTY session and capture artifacts, as covered by `test/debug-pty.test.mjs`.
- [x] SC-002: A deterministic mocked-provider CLI Session UI scenario verifies `/new`, message send, assistant response, `/status`, and `/quit`, as source-inspected in `src/debug/pty.ts` and the CLI mocked-source seam.
- [x] SC-003: A real-provider scenario requires `--real-provider` and enforces `--max-iterations` defaulting to 10, as covered by `test/debug-pty.test.mjs`.
- [ ] SC-004: A scenario can run on both host and Docker worker targets. Host is tested; Docker support is source-inspected from `src/debug/pty.ts` and still needs a worker smoke test.
- [x] SC-005: Failed PTY runs produce raw and cleaned artifacts with actionable diagnostics, as covered by `test/debug-pty.test.mjs`.

## Traceability

| Requirement | Consumer | Status |
|---|---|---|
| PTY command execution | `src/debug/pty.ts`, `test/debug-pty.test.mjs` | Component-tested |
| Artifact capture | `src/debug/pty.ts`, `test/debug-pty.test.mjs` | Component-tested |
| Host + Docker targets | `src/debug/pty.ts`, `test/debug-pty.test.mjs` | Host component-tested; Docker source-inspected |
| Mocked provider | `src/debug/pty.ts`, `src/apps/cli-ui/cliSessionsCommand.ts` | Source-inspected |
| Real provider safety | `src/debug/pty.ts`, `test/debug-pty.test.mjs` | Component-tested |

## Verification Basis

This spec was refreshed against current code in `src/debug/index.ts`, `src/debug/pty.ts`, `src/cli.ts`, `src/apps/cli-ui/cliSessionsCommand.ts`, `src/apps/cli-ui/InkSessionApp.ts`, and tests in `test/debug-pty.test.mjs` and `test/cli-ui-session-app.test.mjs`.
