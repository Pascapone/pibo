# PRD: Compute Browser Resource Lifecycle — Product Overview and Incident Baseline

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../proposal.md`, `../spec.md`, `../design.md`, `../tasks.md`

## 1. Executive Summary

- **Problem Statement**: Ralph loops and compute workers can reuse the same Docker image while still accumulating unmanaged runtime state inside long-lived containers. Repeated browser verification can start new Chromium process trees until the host exhausts RAM, swap, PIDs, or disk.
- **Proposed Solution**: Add a resource lifecycle layer that makes browser processes, browser leases, compute containers, Docker cache, and Ralph-owned workers bounded, inspectable, reusable, and recyclable.
- **Success Criteria**:
  - SC-01: Repeated browser-use checks in one worker do not increase Chromium main-process count beyond the configured pool limit.
  - SC-02: A worker-level health command identifies stale browser processes, stale CDP files, dirty workers, OOM-killed containers, Docker disk pressure, and next cleanup commands.
  - SC-03: Compute containers start with memory, swap, PID, shm, init, restart, and log policies by default.
  - SC-04: Ralph completion/cancel paths release browser leases and mark workers released, idle-retained, or dirty.
  - SC-05: Operators can inspect stopped/OOM containers and cleanup candidates before deleting containers, images, cache, or worktrees.

## 2. User Experience & Functionality

- **User Personas**:
  - AI coding agent running repeated browser/UI verification in a Docker worker.
  - Human Pibo operator diagnosing server overload.
  - Ralph job author expecting long-running loops to reuse workers safely.
  - Compute/tooling engineer maintaining Docker worker lifecycle.
  - SRE-style maintainer responsible for host RAM, swap, PID, and disk budgets.

- **User Stories**:
  - As an agent, I want browser-use to attach to a managed browser so that repeated checks do not leak Chromium processes.
  - As an operator, I want one command to show resource pressure so that I do not need to combine Docker, kernel, journal, and process commands manually.
  - As a Ralph user, I want jobs to preserve debugging state only within an explicit retention window so that completed jobs do not leave unbounded workers behind.
  - As a compute engineer, I want all Pibo containers, including stopped and OOM-killed containers, visible in Pibo CLI so that cleanup decisions are traceable.
  - As a maintainer, I want Docker build context and cache bounded so that worktrees and browser profiles do not inflate images or cache indefinitely.

- **Acceptance Criteria**:
  - Product documentation explains the difference between Docker image reuse, container reuse, Pibo/Ralph sessions, and Chromium process reuse.
  - The incident baseline records that the failure class is unbounded runtime state, not merely too many image tags.
  - Resource health output is read-only by default and suggests safe next commands.
  - Cleanup commands separate browser cleanup, container cleanup, image/cache cleanup, and worktree cleanup.
  - Default policies protect small hosts around the 2 vCPU / 4 GiB RAM class while allowing documented overrides.

- **Non-Goals**:
  - Replacing browser-use.
  - Building distributed compute scheduling.
  - Automatically deleting Git worktrees without explicit policy.
  - Adding external observability SaaS.
  - Hiding cleanup behind prompt instructions.

## 3. AI System Requirements

- **Tool Requirements**:
  - `pibo tools browser-use` wrapper and health command.
  - `pibo compute` CLI for list, reap, release, and diagnostics.
  - Docker command construction and inspection.
  - Ralph store/service metadata for job/run resource ownership.
  - JSON output for agent-driven cleanup planning.

- **Evaluation Strategy**:
  - Use command-stub tests for Docker run options and all-state list/reap parsing.
  - Use process-matching tests with both `chromium` and `chrome` command lines.
  - Run a real Docker worker stress validation that performs repeated browser checks and verifies bounded main-process count.
  - Run a cleanup dry-run fixture with running, stopped, OOM, dirty, and dev workers.
  - Verify no default output exposes profile cookies, browser profile contents, or full transcripts.

## 4. Technical Specifications

- **Architecture Overview**:
  - Browser automation routes through a worker-scoped pool. The pool owns Chromium startup, CDP URL selection, lease acquisition, release, stale-process cleanup, and idle recycling.
  - Compute workers are labeled and limited at Docker run time. Pibo list/reap commands inspect running and stopped containers using labels and Docker state.
  - Ralph records or labels worker ownership and applies cleanup policy after each run and after terminal job outcomes.
  - Resource health aggregates browser pool state, Docker state, worker labels, OOM evidence, and disk usage into text and JSON output.

- **Integration Points**:
  - `src/tools/browser-use-wrapper.ts`
  - `src/tools/browser-use-cdp.ts`
  - `src/tools/browser-use-leases.ts`
  - `src/compute/docker.ts`
  - `src/compute/cli.ts`
  - `src/ralph/service.ts`
  - `src/ralph/store.ts`
  - `.dockerignore`
  - `Dockerfile`

- **Security & Privacy**:
  - Browser profile paths and ids may be shown; profile contents and cookies must not be printed.
  - Reapers must not target unrelated host browser profiles.
  - Auth template profiles must be preserved unless explicitly targeted by the auth-template workflow.
  - Cleanup must be scoped by Pibo-managed metadata, labels, pid files, profile dirs, or container labels.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: fix `chrome|chromium` cleanup, add Docker resource limits, add `.dockerignore` hygiene, and add read-only all-state diagnostics.
  - V1: add managed browser pool acquire/release/reap, compute list/reap all-state cleanup, and Ralph resource metadata.
  - V1.1: add automatic idle timers after dry-run validation and real-world stress checks.
  - V2: richer Chat Web resource dashboard and host-level monitoring integrations.

- **Technical Risks**:
  - Browser reuse may leak tab state; mitigate with tab/context cleanup and profile isolation.
  - Conservative one-browser limit may serialize tests; mitigate with configurable pool size for larger hosts.
  - Reapers can kill wrong processes if matching is broad; mitigate with pid/process-group/profile scoping.
  - Docker limits can break heavy tests; mitigate with explicit override knobs and clear diagnostics.
  - Automatic cleanup can delete useful debug state; mitigate with dry-run, retention windows, and explicit worktree cleanup.
