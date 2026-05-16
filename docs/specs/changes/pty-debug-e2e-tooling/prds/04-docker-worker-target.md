# PRD: PTY Debug and E2E Tooling — Docker Worker Target

**Status:** Draft  
**Created:** 2026-05-16  
**Related docs:** `../spec.md`, `../design.md`, `../tasks.md`, `README.md`

## 1. Executive Summary

- **Problem Statement**: Ralph and many implementation agents work inside Docker workers, but host-only PTY tooling cannot validate the environment where autonomous implementation happens.
- **Proposed Solution**: Add Docker-worker targeting to `pibo debug pty scenario`, including capability detection, PTY execution inside a named worker, and artifact retrieval or host-readable artifact paths.
- **Success Criteria**:
  - SC-01: A scenario can target a named Docker worker and workdir.
  - SC-02: Missing worker or missing PTY capabilities fail with actionable diagnostics.
  - SC-03: The same scenario contract works for host and Docker targets.
  - SC-04: Docker-run artifacts are available for host-side review.
  - SC-05: Docker execution is validated by a documented smoke or automated test.

## 2. User Experience & Functionality

- **User Personas**:
  - Ralph agent running PTY checks inside its dedicated worker.
  - Maintainer reproducing a worker-only bug.
  - Reviewer inspecting artifacts created inside a container.

- **User Stories**:
  - As a Ralph agent, I want to run PTY scenarios in my Docker worker so that validation matches my implementation environment.
  - As a maintainer, I want clear missing-capability diagnostics so that I know whether to install `script`, Python PTY, or use host mode.
  - As a reviewer, I want container artifacts copied or written to a host-visible path so that I can inspect failures after the job ends.

- **Acceptance Criteria**:
  - `--docker-worker <name>` selects Docker execution.
  - `--workdir <path>` controls the command working directory inside the container.
  - The Docker backend validates that the container exists and is running.
  - The backend detects usable PTY support, such as an internal PTY driver, Python `pty`, `script`, or optional tmux support.
  - Capability failures report the worker name, missing tool/capability, and suggested fallback.
  - The backend executes scenario steps with the same semantics as host mode.
  - Artifacts are copied to or written under a host-readable artifact directory.
  - Metadata records Docker worker name, container id when available, workdir, and detected PTY method.

- **Non-Goals**:
  - Managing Docker worker lifecycle.
  - Requiring tmux inside every worker.
  - Supporting arbitrary remote hosts beyond Docker workers.

## 3. AI System Requirements

- **Tool Requirements**:
  - Docker worker selection and validation.
  - Container command execution with PTY semantics.
  - Capability detection and diagnostics.
  - Artifact sync/copy path.

- **Evaluation Strategy**:
  - Unit tests for Docker option normalization and capability error messages.
  - Smoke test or documented manual check in a worker with Python PTY or `script`.
  - Artifact retrieval verified for a deterministic command.
  - Typecheck must pass.

## 4. Technical Specifications

- **Architecture Overview**:
  - Reuse the scenario model and assertion/artifact pipeline.
  - Introduce a Docker backend behind the same runner interface used by host mode.
  - Prefer a small PTY driver inside the container when possible; fall back to Python `pty` or `script`; use tmux only when available.

- **Integration Points**:
  - Docker CLI or existing Pibo Docker worker helpers.
  - Scenario contract from PRD 01.
  - Assertions/artifacts from PRD 03.
  - Ralph loop workflows and worker naming conventions.

- **Security & Privacy**:
  - Do not leak container environment secrets in metadata.
  - Make artifact copy destinations explicit.
  - Do not run Docker commands against an unexpected container name without clear user input.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: Existing running container, workdir, Python/script PTY fallback, artifact copy.
  - v1.1: Internal container PTY helper for consistent semantics.
  - v1.2: Optional tmux resize/manual smoke support.

- **Technical Risks**:
  - Host and container PTY semantics differ; mitigate by recording backend method and preserving raw output.
  - Worker may not include required tooling; mitigate with clear diagnostics and documented fallback.
