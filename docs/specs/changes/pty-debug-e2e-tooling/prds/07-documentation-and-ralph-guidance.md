# PRD: PTY Debug and E2E Tooling — Documentation and Ralph Guidance

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: Even with PTY tooling, agents may still mark CLI/TUI work complete after weak tests unless documentation and Ralph guidance require real-path evidence and artifact reporting.
- **Proposed Solution**: Document `pibo debug pty`, artifact interpretation, host vs Docker targeting, real-provider safety rules, and Ralph validation gates for future CLI/TUI PRDs.
- **Success Criteria**:
  - SC-01: Maintainers can run `pibo debug pty` from help/docs without reading source code.
  - SC-02: Docs explain artifact files and how to inspect failures.
  - SC-03: Docs explain host vs Docker target selection.
  - SC-04: Docs make real-provider opt-in and max-iteration safety explicit.
  - SC-05: Ralph guidance requires PTY validation and evidence notes for interactive CLI/TUI work.

## 2. User Experience & Functionality

- **User Personas**:
  - Maintainer using the tool during an SSH debug session.
  - Ralph agent implementing a future CLI/TUI feature.
  - Reviewer evaluating whether a story actually tested the user path.

- **User Stories**:
  - As a maintainer, I want concise examples so that I can run a PTY scenario quickly.
  - As a Ralph agent, I want validation gates so that I know which checks are required before marking a story done.
  - As a reviewer, I want artifact and evidence rules so that “tests pass” is not accepted as the only proof for user-facing terminal behavior.

- **Acceptance Criteria**:
  - Documentation includes `pibo debug pty run`, `scenario`, and `list-scenarios` examples.
  - Documentation includes a host command example and a Docker-worker command example.
  - Documentation explains required artifact files and how to read raw ANSI versus cleaned text.
  - Documentation states that mocked/deterministic provider mode is default.
  - Documentation states that real provider mode requires `--real-provider` and defaults to `--max-iterations 10`.
  - Documentation warns that PTY E2E scenarios are not part of default `npm test` unless explicitly opted in.
  - Ralph guidance says CLI/TUI stories must run a PTY scenario when interactive terminal behavior changes.
  - Ralph evidence notes must include commands run, host/Docker target, provider mode, artifact path, and whether the check was fake/demo/mocked/real.
  - Guidance distinguishes supporting demo checks from required real default-path checks.

- **Non-Goals**:
  - Writing a full terminal testing textbook.
  - Requiring every non-interactive CLI command to use PTY.
  - Replacing existing unit/typecheck/test guidance.

## 3. AI System Requirements

- **Tool Requirements**:
  - CLI help text.
  - Durable documentation under `docs/` or command help output.
  - Ralph prompt/skill guidance updates where appropriate.

- **Evaluation Strategy**:
  - Documentation review against the implemented command behavior.
  - Help output includes core command examples or points to docs.
  - Existing tests/typecheck pass after doc/help changes.
  - A sample evidence note demonstrates acceptable completion proof.

## 4. Technical Specifications

- **Architecture Overview**:
  - Add user-facing docs near the PTY debug spec/change docs or CLI docs.
  - Update agent/Ralph guidance to require PTY validation for interactive terminal changes.
  - Keep guidance concise and explicit about safety and artifacts.

- **Integration Points**:
  - `pibo debug pty` command help.
  - `docs/specs/capabilities/cli-pty-validation.md`.
  - Ralph loop and PRD JSON guidance.
  - Canonical CLI Session UI scenario docs.

- **Security & Privacy**:
  - Docs warn that artifacts can contain secrets, transcripts, and provider output.
  - Docs warn that real-provider mode can incur provider cost and must stay bounded.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Command examples, artifact guide, safety guide, Ralph evidence checklist.
  - v1.1: Troubleshooting guide for common Ink/PTTY issues.
  - v1.2: Links from future CLI/TUI PRD templates.

- **Technical Risks**:
  - Guidance becomes stale; mitigate by linking to canonical scenarios and command help.
  - Agents ignore guidance; mitigate by putting PTY evidence directly into PRD acceptance criteria.
