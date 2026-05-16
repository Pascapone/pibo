# PRD: PTY Debug and E2E Tooling — Assertions and Artifacts

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `02-host-pty-runner.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: PTY failures are hard to debug if the only result is pass/fail. Agents need raw terminal output, cleaned text, assertion details, and final screen context to understand what happened.
- **Proposed Solution**: Add assertion evaluation and mandatory failure artifacts for PTY runs: metadata, raw ANSI output, cleaned text, final screen/capture, input steps, and assertion results.
- **Success Criteria**:
  - SC-01: Expected and forbidden output assertions run against cleaned terminal text.
  - SC-02: Raw ANSI output is preserved separately from cleaned text.
  - SC-03: Failed runs always create an artifact directory and print its path.
  - SC-04: Required artifact files exist with actionable diagnostics.
  - SC-05: Tests cover successful assertions, missing expected text, forbidden text, and artifact generation.

## 2. User Experience & Functionality

- **User Personas**:
  - Maintainer reading a failed PTY run after an SSH/debug session.
  - Ralph reviewer checking evidence before accepting a CLI/TUI story.
  - QA engineer comparing raw terminal behavior with normalized assertions.

- **User Stories**:
  - As a maintainer, I want raw and cleaned output artifacts so that I can diagnose ANSI/Ink rendering issues without losing information.
  - As a reviewer, I want assertion reports so that I know exactly why a scenario failed.
  - As an implementation agent, I want the artifact path printed on failure so that I can include evidence in progress notes.

- **Acceptance Criteria**:
  - The assertion engine checks `expect` and `reject` patterns against cleaned text.
  - Missing expected text fails the run with the missing pattern named.
  - Present rejected text fails the run with the forbidden pattern named.
  - ANSI-stripped `clean.txt` is generated from raw output while `raw.ansi.log` preserves exact terminal output.
  - Failed runs write `metadata.json`, `input.json`, `assertions.json`, `raw.ansi.log`, `clean.txt`, and `screen.txt` or a best-effort final capture.
  - Successful runs can write artifacts when configured.
  - `metadata.json` records command, cwd/workdir, backend, timings, exit code, timeout status, provider mode, and artifact schema version.
  - `input.json` records expanded input steps and timing.
  - `assertions.json` records expected/rejected patterns and pass/fail details.

- **Non-Goals**:
  - Pixel screenshots as primary evidence.
  - Perfect terminal emulation in V1.
  - Provider-specific logging, except where later mocked-provider scenarios add it.

## 3. AI System Requirements

- **Tool Requirements**:
  - ANSI cleanup/normalization utility.
  - Assertion result model.
  - Artifact writer with stable file names.
  - Best-effort final screen generation from terminal parser, tmux capture, or cleaned tail.

- **Evaluation Strategy**:
  - Unit tests for ANSI cleanup and assertion matching.
  - Integration test that forces a failed PTY run and verifies artifact files.
  - Tests verify raw ANSI is not overwritten by cleaned text.
  - Typecheck must pass.

## 4. Technical Specifications

- **Architecture Overview**:
  - Runner output flows into an event buffer.
  - The artifact writer serializes raw output first, then derives cleaned text and screen capture.
  - Assertion evaluation uses cleaned text for stable matching while preserving raw output for debugging.

- **Integration Points**:
  - Host PTY runner from PRD 02.
  - Docker worker backend from PRD 04.
  - Provider safety metadata from PRD 05.
  - Canonical CLI Session UI scenarios from PRD 06.

- **Security & Privacy**:
  - Artifact metadata should redact known secret-like environment values.
  - Raw logs may contain user/provider output; docs must warn users before sharing artifacts.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Required files, ANSI stripping, expected/rejected assertions, cleaned-tail screen fallback.
  - v1.1: Timestamped `events.jsonl`.
  - v1.2: Optional frame captures or terminal parser snapshots.

- **Technical Risks**:
  - ANSI stripping can hide meaningful output; mitigate by always preserving raw output.
  - Artifact paths can collide; mitigate with run IDs or timestamps.
