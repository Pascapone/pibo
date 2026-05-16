# PRD: PTY Debug and E2E Tooling — Host PTY Runner

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `01-command-and-scenario-contract.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: Simple pipes do not reproduce how Ink and other terminal apps behave in a real TTY. Without a host PTY runner, maintainers cannot reliably reproduce SSH-like CLI/TUI failures.
- **Proposed Solution**: Implement the host execution backend for `pibo debug pty`, including PTY spawn, terminal size, output capture, scripted input, named keys, and timeout handling.
- **Success Criteria**:
  - SC-01: A command runs under PTY with configured rows and columns.
  - SC-02: Output is captured as raw terminal data for later artifacts/assertions.
  - SC-03: `typeText` sends per-character input with configurable delay.
  - SC-04: Named keys include at least Enter, Escape, CtrlC, Up, and Down.
  - SC-05: Wall-clock timeout and idle timeout terminate stuck processes with diagnostics.

## 2. User Experience & Functionality

- **User Personas**:
  - Maintainer reproducing a real installed `pibo` CLI problem on the host.
  - Ralph agent running a deterministic local PTY scenario.
  - QA engineer validating Ink input timing.

- **User Stories**:
  - As a maintainer, I want host PTY execution so that the debug tool exercises the same terminal path a user sees over SSH.
  - As a QA engineer, I want slow per-character typing so that Ink commands such as `/status` and `/quit` are not merged or dropped.
  - As an implementation agent, I want timeout cleanup so that a stuck interactive process does not block the job indefinitely.

- **Acceptance Criteria**:
  - The host runner starts an arbitrary command under a pseudo-terminal.
  - Rows and columns are applied at process start.
  - The runner collects raw output bytes or text without ANSI stripping.
  - `typeText` writes each character separately with `inputDelayMs`.
  - `writeBytes` supports raw input for advanced cases.
  - `press` maps Enter, Escape, CtrlC, Up, and Down to terminal-safe sequences.
  - The runner tracks wall-clock timeout and idle timeout.
  - On timeout, the runner attempts graceful termination and then force termination if needed.
  - A deterministic test command can be scripted to wait for text, type input, and exit.

- **Non-Goals**:
  - Docker worker execution.
  - Real provider calls.
  - Terminal screen parsing beyond raw capture.
  - Full artifact report generation.

## 3. AI System Requirements

- **Tool Requirements**:
  - Host PTY spawn abstraction.
  - Input scheduler for text, bytes, keys, and sleeps.
  - Output event buffer with timestamps.
  - Timeout/cancellation controller.

- **Evaluation Strategy**:
  - Tests run a small deterministic interactive fixture under PTY.
  - Tests cover rows/cols propagation where practical.
  - Tests cover per-character typing and Enter handling.
  - Tests cover wall-clock timeout and idle timeout.
  - Typecheck must pass.

## 4. Technical Specifications

- **Architecture Overview**:
  - Implement a `PtyRunner` or equivalent interface used by the command layer.
  - Implement a host backend that spawns commands inside a PTY and exposes output, input, resize/start dimensions, exit status, and termination.
  - Keep runner output raw; normalization belongs to the assertions/artifacts PRD.

- **Integration Points**:
  - Scenario contract from PRD 01.
  - Future assertion engine and artifact writer.
  - Future CLI Session UI canonical scenario.

- **Security & Privacy**:
  - Do not log full environment values by default.
  - On termination, avoid leaving orphan child processes where possible.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Spawn, raw output, text/key input, timeout handling.
  - v1.1: Richer event timestamps and resize support if needed.
  - v1.2: Optional terminal screen parser integration.

- **Technical Risks**:
  - PTY dependencies may be platform-sensitive; mitigate with clear errors and host-focused Linux support first.
  - Ink input can be timing-sensitive; mitigate with default `inputDelayMs` and per-step waits.
