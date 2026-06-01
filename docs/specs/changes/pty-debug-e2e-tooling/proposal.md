# Proposal: PTY Debug and E2E Tooling

**Status:** Implemented
**Created:** 2026-05-16
**Updated:** 2026-05-17
**Related docs:** `docs/specs/capabilities/cli-pty-validation.md`

## Summary

Add `pibo debug pty` tooling so Pibo agents and maintainers can run, inspect, and debug interactive CLI/TUI flows under a real pseudo-terminal. The implemented tool supports deterministic mocked-provider E2E scenarios by default and explicit, bounded real-provider scenarios with `--real-provider`.

## Problem

The Ink CLI Session UI was marked complete after unit tests, fake-source tests, and demo-mode PTY smoke checks. Those tests did not catch the real default runtime failures: no real router, missing custom agents, weak `/new` behavior, and no Web visibility validation.

Agents need a standard way to test the real CLI path, capture what a user would see, and stop safely when model-backed agents interact.

## Goals

- Provide a first-class `pibo debug pty` command family.
- Run interactive Pibo CLI commands under PTY from host or Docker worker.
- Script input, waits, assertions, terminal size, and timeouts.
- Capture raw and normalized artifacts for review.
- Support mocked-provider E2E scenarios by default.
- Allow real-provider E2E only with explicit `--real-provider` and safety bounds.

## Non-Goals

- Add real-provider PTY tests to default `npm test`.
- Make visual screenshot diffing the main validation mechanism.
- Permit unbounded autonomous agent-to-agent conversations.
- Replace unit, integration, or renderer tests.

## Implemented Command Shape

Initial command family:

```bash
pibo debug pty run -- <command...>
pibo debug pty scenario <file>
pibo debug pty list-scenarios
```

Common options:

```bash
--rows <n>
--cols <n>
--timeout-ms <n>
--idle-timeout-ms <n>
--artifact-dir <path>
--docker-worker <name>
--workdir <path>
--real-provider
--max-iterations <n>   # default 10 when --real-provider is set
--input-delay-ms <n>
--expect <text>
--reject <text>
```

## Safety Defaults

- Mocked-provider/deterministic mode is the default.
- Real provider mode requires `--real-provider`.
- Real provider mode defaults to `--max-iterations 10`.
- All runs require a wall-clock timeout.
- Idle timeout terminates a run when output stops unexpectedly.
- Ctrl+C/terminate cleanup must be reliable.

## Validation Use Cases

### CLI Session UI deterministic E2E

- Start `pibo tui:sessions` under PTY.
- Create or open a test session.
- Send a message.
- Receive mocked assistant output.
- Run `/status`.
- Exit via `/quit`.
- Assert transcript, status, and artifacts.

### Real-provider smoke

- Human explicitly runs with `--real-provider`.
- Tool sends one or a small bounded number of messages.
- Stops after assistant response, stop pattern, timeout, or max iterations.
- Captures artifacts for review.

### Docker/Ralph validation

- Ralph can run the same scenario inside a named Docker worker.
- The scenario records enough artifacts for host-side review.

## Risks

- PTY input can be flaky if bytes are sent too quickly. Mitigation: per-character input steps with configurable delay.
- Real providers are non-deterministic. Mitigation: mocked default plus bounded real-provider mode.
- Docker and host state differ. Mitigation: scenario metadata records target and environment.
- Terminal output is noisy. Mitigation: store raw ANSI and cleaned text separately.

## Success Criteria

- [x] `pibo debug pty` can reproduce interactive CLI behavior that simple process pipes cannot.
- [x] Failed scenarios leave enough artifacts to diagnose what the agent/user saw.
- [x] Future CLI/TUI PRDs can require PTY scenarios as explicit validation gates.

## Source-Backed Notes

Implemented behavior lives in `src/debug/pty.ts`, `src/debug/index.ts`, `src/apps/cli-ui/cliSessionsCommand.ts`, and tests in `test/debug-pty.test.mjs`. Docker-worker execution is implemented from source inspection but still needs a worker smoke test.
