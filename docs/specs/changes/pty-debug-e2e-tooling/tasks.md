# Tasks: PTY Debug and E2E Tooling

**Status:** Implemented with follow-up test gaps
**Created:** 2026-05-16
**Updated:** 2026-05-17
**Related docs:** `proposal.md`, `spec.md`, `design.md`, `docs/specs/capabilities/cli-pty-validation.md`

## Phase 1: Command and Scenario Contract

- [x] T1.1 Register `pibo debug pty` command group.
- [x] T1.2 Add `pibo debug pty run -- <command...>` help and option parsing.
- [x] T1.3 Add `pibo debug pty scenario <file>` help and option parsing.
- [x] T1.4 Define scenario JSON schema/types for command, target, steps, assertions, timeouts, provider mode, max iterations, and artifacts.
- [x] T1.5 Add schema validation errors with actionable messages.

## Phase 2: Host PTY Runner

- [x] T2.1 Implement host PTY process spawn with rows/cols.
- [x] T2.2 Implement raw output collection.
- [x] T2.3 Implement per-character `typeText` with configurable input delay.
- [x] T2.4 Implement named key presses: Enter, Escape, CtrlC, Up, Down.
- [x] T2.5 Implement wall-clock timeout and idle timeout termination.
- [x] T2.6 Add unit/integration tests for a deterministic local command under PTY.

## Phase 3: Assertions and Artifacts

- [x] T3.1 Implement ANSI-stripped `clean.txt` generation while preserving `raw.ansi.log`.
- [x] T3.2 Implement expected-text and forbidden-text assertions.
- [x] T3.3 Implement artifact directory creation.
- [x] T3.4 Write `metadata.json`, `input.json`, `assertions.json`, `raw.ansi.log`, `clean.txt`, and best-effort `screen.txt`.
- [x] T3.5 Ensure failed runs always preserve artifacts and print the artifact path.

## Phase 4: Docker Worker Target

- [x] T4.1 Add `--docker-worker <name>` and `--workdir <path>` support.
- [x] T4.2 Detect required container capabilities and report missing tools clearly.
- [x] T4.3 Run a PTY scenario inside the worker.
- [x] T4.4 Write artifacts where the host can inspect them.
- [ ] T4.5 Add tests or documented smoke checks for Docker execution.

## Phase 5: Provider Modes and Safety Bounds

- [x] T5.1 Make mocked/deterministic provider mode the default for model-output scenarios.
- [x] T5.2 Require explicit `--real-provider` for live provider calls.
- [x] T5.3 Enforce default `--max-iterations 10` for real-provider mode.
- [x] T5.4 Enforce wall-clock and idle timeout in real-provider mode.
- [x] T5.5 Fail closed when max-iteration enforcement is unavailable.
- [x] T5.6 Record provider mode and iteration counts in `metadata.json`.

## Phase 6: Canonical CLI Session UI Scenario

- [x] T6.1 Add a canonical mocked-provider `pibo tui:sessions` scenario.
- [x] T6.2 Scenario verifies startup, new/open session, message send, assistant response, `/status`, and `/quit`.
- [ ] T6.3 Scenario verifies expected custom/test agent visibility where configured.
- [x] T6.4 Scenario can run on host.
- [ ] T6.5 Scenario can run inside Docker worker or documents missing worker capability.
- [x] T6.6 Add instructions for optional real-provider smoke with `--real-provider --max-iterations 10`.

## Phase 7: Documentation and Ralph Guidance

- [x] T7.1 Document `pibo debug pty` usage in debug help/docs.
- [x] T7.2 Document artifact structure and debugging workflow.
- [x] T7.3 Document host vs Docker target selection.
- [x] T7.4 Document real-provider safety rules.
- [x] T7.5 Add Ralph prompt guidance: CLI/TUI stories should include PTY scenario validation when touching interactive terminal behavior.

## Acceptance Checklist

- [x] `pibo debug pty run` can start an interactive process under PTY.
- [x] `pibo debug pty scenario` executes scripted input with waits and assertions.
- [x] Failed runs produce actionable artifacts.
- [x] Docker-worker execution is supported or fails with clear diagnostics.
- [x] Real-provider mode requires `--real-provider` and defaults to max 10 iterations.
- [x] Canonical CLI Session UI scenario catches failures like missing router replies; custom agent visibility is a remaining scenario extension.
- [x] PTY E2E scenarios are not part of default `npm test` unless explicitly opted in.

## Remaining Follow-ups

- Add Docker-worker smoke coverage for the `--docker-worker` backend.
- Extend the built-in CLI Session UI scenario to verify custom/test agent visibility when the fixture configures one.
