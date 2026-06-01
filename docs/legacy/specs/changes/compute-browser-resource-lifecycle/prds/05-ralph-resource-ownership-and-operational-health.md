# PRD: Ralph Resource Ownership and Operational Health

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../spec.md`, `../design.md`, `../../../capabilities/continuous-ralph-jobs.md`

## 1. Executive Summary

- **Problem Statement**: Ralph jobs can create many agent sessions against retained workers, but worker/browser cleanup is not tied strongly enough to Ralph job/run lifecycle. Operators also lack a single Pibo-native resource health view.
- **Proposed Solution**: Bind Ralph jobs/runs to compute/browser resource ownership, apply cleanup policy after run/job outcomes, and expose read-only resource health diagnostics plus safe cleanup suggestions.
- **Success Criteria**:
  - SC-01: Ralph-owned workers carry job/run/owner labels or linked metadata.
  - SC-02: Promise-complete, max-iteration, stop, and cancel paths release browser leases and set worker cleanup state.
  - SC-03: Prompt text cannot disable hard TTL, browser-pool reap, Docker limits, or dirty-worker recycling.
  - SC-04: Resource health output identifies browser leaks, dirty workers, OOM containers, Docker disk pressure, and reaper/timer status.
  - SC-05: Disabled Ralph jobs can expose retained worker ids or cleanup failures for follow-up.

## 2. User Experience & Functionality

- **User Personas**:
  - Ralph job author running long implementation loops.
  - AI operator checking whether jobs are still active or left resources behind.
  - SRE-style operator monitoring resource pressure.
  - Runtime engineer debugging Ralph stop/cancel behavior.

- **User Stories**:
  - As a Ralph user, I want job resources to be released or retained by explicit policy so that completed loops do not leak workers.
  - As an operator, I want disabled jobs to show whether any worker/browser resources remain so that I can clean them safely.
  - As an SRE, I want one health command to warn before browser or Docker state overloads the host.
  - As an agent, I want JSON resource health output so that I can choose safe next cleanup actions.

- **Acceptance Criteria**:
  - Ralph service records assigned worker id or resource policy when a loop uses a compute worker.
  - Worker labels include Ralph job id, run id when applicable, and owner scope.
  - After each run, active browser leases are released unless the next immediate run is configured to reuse the same lease safely.
  - After terminal job stop, Ralph releases the worker or marks it idle-retained with an expiry.
  - Cancel aborts active browser leases and marks the worker dirty when cleanup fails.
  - Resource health text includes next commands and is read-only by default.
  - Resource health JSON includes stable fields for workers, browser pools, Docker usage, OOM evidence, and cleanup eligibility.

- **Non-Goals**:
  - Replacing Ralph stop-condition semantics.
  - Deleting worktrees automatically after Ralph completion.
  - Adding a full Chat Web resource dashboard in V1.

## 3. AI System Requirements

- **Tool Requirements**:
  - Ralph store/service hooks for resource metadata.
  - Compute labels/inspection support.
  - Browser pool release/reap APIs.
  - Resource health CLI with text and JSON output.

- **Evaluation Strategy**:
  - Service tests for promise-complete, max-iteration, stop, cancel, timeout, and interrupted-run cleanup paths.
  - Store tests for persisted worker/resource metadata.
  - CLI/API tests showing disabled jobs with retained worker cleanup state.
  - Health fixture tests for browser leak, dirty worker, OOM container, Docker disk pressure, and missing reaper/timer.
  - End-to-end Ralph loop smoke test in a Docker worker with browser verification and bounded cleanup.

## 4. Technical Specifications

- **Architecture Overview**:
  - Ralph resource ownership links jobs/runs to worker ids and browser lease ids. The link may start as metadata and Docker labels, then evolve into richer store records.
  - Ralph completion code calls browser-pool release/reap and compute retention/recycle policy.
  - Resource health aggregates Ralph jobs/runs, compute workers, browser pools, process counts, Docker usage, and system evidence into one read-only command.
  - Automatic cleanup timers should only be enabled after dry-run behavior is validated.

- **Integration Points**:
  - `src/ralph/service.ts`
  - `src/ralph/store.ts`
  - `src/ralph/cli.ts`
  - `src/compute/docker.ts`
  - `src/tools/browser-use-wrapper.ts`
  - `src/tools/browser-use-leases.ts`
  - future `pibo compute doctor` or `pibo doctor resources` command branch

- **Security & Privacy**:
  - Health output must not reveal profile cookies, auth tokens, or full prompts by default.
  - Owner scope should be visible where needed for cleanup decisions but cross-owner management surfaces must preserve existing access controls.
  - Cleanup must not remove resources still held by an active run.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: add Ralph worker labels/metadata and release browser leases after terminal outcomes.
  - V1: add disabled-job retained-resource visibility and resource health command.
  - V1.1: add automatic idle-retention timers and operational playbooks.
  - V2: optional Chat Web resource health panel.

- **Technical Risks**:
  - A Ralph loop may intentionally need a retained worker for debugging; mitigate with idle-retention expiry and explicit worktree preservation.
  - Cleanup can race with the next run; mitigate with active-run checks and resource locks.
  - Health command can become noisy; mitigate with severity levels and next-command suggestions.
  - Prompt guidance may conflict with policy; mitigate by documenting that policy wins over prompt text.
