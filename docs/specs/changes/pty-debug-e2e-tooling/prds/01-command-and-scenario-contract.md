# PRD: PTY Debug and E2E Tooling — Command and Scenario Contract

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: Pibo does not have a first-class, repeatable command contract for running interactive CLI/TUI validation under PTY. Agents therefore fall back to ad hoc `script`, tmux, or demo-only checks that miss real runtime failures.
- **Proposed Solution**: Add the `pibo debug pty` command family with `run`, `scenario`, and `list-scenarios` subcommands, plus a typed scenario schema that declares command, target, terminal size, inputs, waits, assertions, timeouts, provider mode, safety bounds, and artifacts.
- **Success Criteria**:
  - SC-01: `pibo debug pty --help` and subcommand help describe the command family and safety defaults.
  - SC-02: `pibo debug pty run -- <command...>` accepts terminal, timeout, artifact, assertion, Docker, provider, and input-delay options.
  - SC-03: `pibo debug pty scenario <file>` validates scenario files before execution and reports actionable schema errors.
  - SC-04: Scenario definitions are machine-readable and reviewable by Ralph/agents.
  - SC-05: Typecheck and focused CLI parser/schema tests pass.

## 2. User Experience & Functionality

- **User Personas**:
  - Maintainer debugging an interactive CLI problem over SSH.
  - Ralph implementation agent validating CLI/TUI behavior before completion.
  - QA engineer creating repeatable PTY smoke scenarios.

- **User Stories**:
  - As a maintainer, I want a discoverable `pibo debug pty` command family so that I can run terminal validation without custom shell glue.
  - As a QA engineer, I want scenario files so that I can repeat the same PTY flow across host and Docker targets.
  - As an implementation agent, I want clear schema errors so that invalid scenarios fail before any flaky PTY execution begins.

- **Acceptance Criteria**:
  - The CLI registers `pibo debug pty` with `run`, `scenario`, and `list-scenarios` subcommands.
  - `run` supports the common options from the spec: rows, cols, timeout, idle timeout, artifact dir, Docker worker, workdir, real-provider, max iterations, input delay, expect, and reject.
  - `scenario` accepts a JSON scenario file with command, cwd/workdir, env, rows, cols, timeoutMs, idleTimeoutMs, inputDelayMs, providerMode, maxIterations, artifactDir, steps, expect, and reject.
  - Scenario validation rejects unknown provider modes, missing command arrays, invalid step shapes, invalid timeout values, and unsafe real-provider settings.
  - Validation errors identify the field path and expected shape.
  - `list-scenarios` lists built-in or documented canonical scenarios when available and exits successfully when no scenarios are installed.

- **Non-Goals**:
  - Implementing PTY process spawning in this PRD.
  - Implementing Docker execution in this PRD.
  - Implementing mocked provider injection in this PRD.
  - Adding PTY E2E to default `npm test`.

## 3. AI System Requirements

- **Tool Requirements**:
  - CLI command registration and option parsing.
  - Scenario schema/type definitions.
  - Validation service that returns human-readable field-level errors.
  - JSON serialization-compatible scenario representation for Ralph.

- **Evaluation Strategy**:
  - CLI help snapshot or assertion tests for command/subcommand visibility.
  - Schema tests for valid minimal scenarios and invalid field combinations.
  - Parser tests for common options and real-provider safety defaults.
  - Typecheck must pass.

## 4. Technical Specifications

- **Architecture Overview**:
  - Add a small command layer that parses CLI options and loads optional scenario JSON.
  - Normalize CLI options and scenario files into one internal `PtyScenario` structure.
  - Keep execution deferred behind a runner interface so later PRDs can add host and Docker backends without changing the scenario contract.

- **Integration Points**:
  - Existing Pibo CLI command registry.
  - Future host PTY runner.
  - Future Docker PTY target.
  - Future artifact writer and assertion engine.
  - Future canonical CLI Session UI scenarios.

- **Security & Privacy**:
  - Scenario metadata must not print full secrets from environment variables.
  - Real-provider mode must not be implicitly enabled by scenario files alone; the CLI flag is required in later safety PRDs.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Command group, option parsing, scenario load/validation, no-op/dry-run execution boundary.
  - v1.1: Connect host runner.
  - v1.2: Connect Docker, provider modes, artifacts, and canonical scenarios.

- **Technical Risks**:
  - Schema becomes too broad too early; mitigate by supporting only spec-defined step types initially.
  - CLI options and scenario fields diverge; mitigate by normalizing into one internal structure.
