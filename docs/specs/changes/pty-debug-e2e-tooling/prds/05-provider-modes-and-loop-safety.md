# PRD: PTY Debug and E2E Tooling — Provider Modes and Loop Safety

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: PTY E2E flows may involve model-backed agents. If a CLI-controlled agent talks to another model-backed agent without bounds, the run can enter an expensive or endless agent-to-agent loop.
- **Proposed Solution**: Make mocked/deterministic provider mode the default, require explicit `--real-provider` for live calls, and enforce fail-closed safety bounds including default `--max-iterations 10`, wall-clock timeout, idle timeout, and stop conditions.
- **Success Criteria**:
  - SC-01: Mocked/deterministic provider mode is the default.
  - SC-02: Real-provider mode cannot run unless `--real-provider` is supplied by the CLI invocation.
  - SC-03: Real-provider mode defaults to max 10 iterations.
  - SC-04: Real-provider runs terminate on max iterations, wall-clock timeout, idle timeout, process exit, expected output, or stop pattern.
  - SC-05: The system fails closed if it cannot enforce iteration bounds.

## 2. User Experience & Functionality

- **User Personas**:
  - Maintainer intentionally running a live smoke test.
  - Ralph agent executing safe deterministic validation.
  - Reviewer checking whether a live-provider run was bounded.

- **User Stories**:
  - As a maintainer, I want live-provider PTY tests to require explicit opt-in so that accidental provider calls do not happen.
  - As an operator, I want max iterations and timeouts so that model-backed tests cannot run forever.
  - As a reviewer, I want provider mode and iteration counts recorded so that I can audit safety behavior.

- **Acceptance Criteria**:
  - Scenario files may declare provider intent, but live calls require the CLI flag `--real-provider`.
  - Without `--real-provider`, model-output scenarios run in mocked/deterministic mode or fail with a message explaining how to configure mocked mode.
  - With `--real-provider`, `maxIterations` defaults to 10 unless a human explicitly provides another value.
  - Real-provider mode requires/defaults a wall-clock timeout and idle timeout.
  - Real-provider mode requires at least one stop condition: expected output, explicit stop pattern, process exit, or scenario completion.
  - Iteration counting uses a documented approximation: submitted user messages, observed assistant completions, or steps marked `iteration: true`.
  - If no enforceable iteration counter is available, the run fails before starting live provider work.
  - Exceeding max iterations terminates the PTY process, marks the run failed, and writes diagnostics.
  - `metadata.json` records provider mode, `realProviderRequested`, max iterations, observed iterations, timeout values, and stop reason.

- **Non-Goals**:
  - Guaranteeing deterministic live provider output.
  - Allowing unbounded autonomous conversations.
  - Adding live-provider PTY tests to default `npm test`.

## 3. AI System Requirements

- **Tool Requirements**:
  - Provider mode resolver.
  - Real-provider opt-in gate.
  - Iteration counter and stop-condition tracker.
  - Timeout/idle integration with runner termination.
  - Safety metadata in artifacts.

- **Evaluation Strategy**:
  - Tests verify real-provider mode fails without `--real-provider`.
  - Tests verify default max iterations is 10.
  - Tests verify explicit max iteration override works.
  - Tests verify fail-closed behavior when no iteration counter is configured.
  - Tests verify timeout/idle/stop reasons are recorded.
  - Typecheck must pass.

## 4. Technical Specifications

- **Architecture Overview**:
  - Resolve provider mode before runner start.
  - Attach a safety controller to scenario execution.
  - The safety controller observes iteration markers, output waits, process exit, and timers.
  - On violation, it terminates the runner and records the stop reason.

- **Integration Points**:
  - Scenario schema from PRD 01.
  - Host runner from PRD 02.
  - Artifacts from PRD 03.
  - Docker backend from PRD 04.
  - Canonical CLI Session UI scenarios from PRD 06.

- **Security & Privacy**:
  - Real provider calls are never implicit.
  - Live-run metadata must redact credentials.
  - Failed safety checks should avoid printing provider secrets.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Provider mode resolver, real-provider flag, max iteration default, timeout/idle fail-closed metadata.
  - v1.1: Richer iteration counting from assistant events where available.
  - v1.2: Provider-specific mocked harness logs.

- **Technical Risks**:
  - Iteration boundaries may be ambiguous in arbitrary terminal apps; mitigate by requiring scenario-marked iteration steps or failing closed for live mode.
  - Users may set too-high limits; mitigate by documenting defaults and printing warnings for overrides above 10.
