# PRD: PTY Debug and E2E Tooling — Canonical CLI Session UI Scenarios

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: The first Ink CLI Session UI implementation passed fake/demo checks but failed the real default runtime path. Future implementations need canonical PTY scenarios that catch missing routers, missing custom agents, missing assistant responses, and session visibility problems.
- **Proposed Solution**: Add canonical `pibo tui:sessions` PTY scenarios: deterministic mocked-provider E2E by default and optional real-provider smoke behind `--real-provider --max-iterations 10`.
- **Success Criteria**:
  - SC-01: A mocked-provider scenario starts `pibo tui:sessions` under PTY without `--demo`.
  - SC-02: The scenario creates or opens a controlled test session, sends `Hi`, receives deterministic assistant output, runs `/status`, and exits with `/quit`.
  - SC-03: The scenario verifies configured custom/test agent visibility where applicable.
  - SC-04: The scenario can run on host and Docker target or reports missing Docker capability clearly.
  - SC-05: The optional real-provider scenario requires explicit `--real-provider` and max iteration safety.

## 2. User Experience & Functionality

- **User Personas**:
  - CLI/TUI implementation agent validating the default user path.
  - Maintainer reproducing a broken `pibo tui:sessions` runtime.
  - Reviewer checking evidence that messaging, status, and exit work through PTY.

- **User Stories**:
  - As an implementation agent, I want a canonical CLI Session UI PTY scenario so that I cannot accidentally validate only demo mode.
  - As a maintainer, I want deterministic mocked assistant output so that I can reproduce the flow without external provider credentials.
  - As a reviewer, I want the scenario to prove session status and assistant response behavior so that missing router/custom-agent regressions are caught.

- **Acceptance Criteria**:
  - The canonical scenario command is `pibo tui:sessions` without `--demo` unless a separate demo scenario is explicitly named.
  - The scenario starts under PTY and waits for the CLI Session UI to render.
  - The scenario creates or opens a controlled test session.
  - The scenario verifies expected profile/agent visibility when a configured test agent or `pibo-agent` fixture is available.
  - The scenario sends `Hi` using terminal-safe per-character typing.
  - In mocked mode, the scenario waits for deterministic assistant output.
  - The scenario runs `/status` and asserts source/session details.
  - The scenario exits using `/quit` and verifies process completion or clean termination.
  - Failure artifacts include raw ANSI, clean text, screen capture, input, assertions, metadata, and provider log when mocked provider tracing exists.
  - A real-provider variant is documented and runnable only with `--real-provider`; it uses max iterations default 10.

- **Non-Goals**:
  - Depending on real provider output for default validation.
  - Making the canonical scenario part of default `npm test`.
  - Requiring Web browser verification in this PRD unless a later Web parity scenario adds it.

## 3. AI System Requirements

- **Tool Requirements**:
  - Mocked provider or deterministic source injection seam for `pibo tui:sessions`.
  - Scenario fixtures for controlled session/profile state.
  - PTY scenario runner from earlier PRDs.
  - Artifact capture and provider logs where available.

- **Evaluation Strategy**:
  - Host mocked-provider scenario passes deterministically.
  - Docker mocked-provider scenario passes or produces a clear missing-capability diagnostic.
  - Negative regression test or scenario fixture catches no-assistant-output behavior.
  - Optional real-provider smoke is documented but not run by default.
  - Typecheck must pass.

## 4. Technical Specifications

- **Architecture Overview**:
  - Add scenario definitions under the PTY debug scenario catalog.
  - Provide deterministic provider/source hooks so the CLI can render a known assistant response.
  - Keep the scenario focused on the real default CLI path: no `--demo` for the canonical E2E scenario.

- **Integration Points**:
  - `pibo tui:sessions` runtime and `LocalCliSessionSource`.
  - Pibo session router and custom-agent store/profile registry.
  - PTY scenario executor, provider safety controller, and artifact writer.
  - Docker worker backend for Ralph validation.

- **Security & Privacy**:
  - Mocked mode should not require live credentials.
  - Real-provider instructions must warn about provider cost and bound enforcement.
  - Artifacts may contain transcript text and must be treated as sensitive debugging material.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Host mocked `pibo tui:sessions` scenario with message/status/quit.
  - v1.1: Agent/profile visibility fixture and Docker execution.
  - v1.2: Optional real-provider smoke and Web/session-store visibility extension.

- **Technical Risks**:
  - Mocked provider injection may be unclear; mitigate by defining a narrow test-only provider/source seam.
  - Custom agents differ between host and Docker; mitigate by using a configured fixture and recording environment metadata.
