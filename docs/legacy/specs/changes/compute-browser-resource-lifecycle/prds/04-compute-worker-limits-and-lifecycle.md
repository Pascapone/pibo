---
type: "Historical Record"
title: "PRD: Compute Worker Limits and Lifecycle"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/changes/compute-browser-resource-lifecycle/prds/04-compute-worker-limits-and-lifecycle.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "b6517fc74cc29bb4334983563dad70f99edeee29"
  source_bytes: 4820
  source_sha256: "0f1f751717835fbc4aa13c50391ca82314e5165b56279af657c96d1e46410a36"
  source_body_sha256: "0f1f751717835fbc4aa13c50391ca82314e5165b56279af657c96d1e46410a36"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# PRD: Compute Worker Limits and Lifecycle

**Status:** Draft  
**Created:** 2026-05-17  
**Related docs:** `../spec.md`, `../design.md`, `../../../capabilities/docker-compute-workers.md`

## 1. Executive Summary

- **Problem Statement**: Compute workers currently run without hard Docker resource budgets and operator listing can hide stopped/OOM containers and retained dev-worker state.
- **Proposed Solution**: Add default Docker resource limits, richer labels, all-state listing, dry-run reaping, idle/TTL lifecycle policy, and Docker hygiene diagnostics.
- **Success Criteria**:
  - SC-01: One-time and dev workers start with memory, swap, PID, shm, init, restart, and log policies.
  - SC-02: `pibo compute list --all` shows running, exited, OOM-killed, dirty, and retained Pibo workers.
  - SC-03: Reap supports dry-run cleanup planning and does not delete worktrees by default.
  - SC-04: Docker diagnostics report image, container, volume, build-cache, and reclaimable usage.
  - SC-05: `.dockerignore` excludes `.worktrees` and local browser/debug state from image builds.

## 2. User Experience & Functionality

- **User Personas**:
  - Operator cleaning a host after Ralph/browser work.
  - Agent spawning or using compute workers.
  - Compute engineer changing Docker worker startup.

- **User Stories**:
  - As an operator, I want to see all Pibo containers, including stopped ones, so that cleanup decisions are based on complete state.
  - As an agent, I want worker resource limits to be automatic so that a browser leak cannot crash the host.
  - As a developer, I want worktrees preserved unless I explicitly delete them so that debug state is not lost.
  - As a maintainer, I want image/cache diagnostics so that few image tags do not hide large retained layers or BuildKit cache.

- **Acceptance Criteria**:
  - Docker run command construction includes configured defaults for memory, memory-swap, pids-limit, shm-size, init, restart=no, and log bounds.
  - Worker labels include role, created time, owner scope, worktree, port block, resource policy, TTL/idle values, and Ralph ids when applicable.
  - `list --all` includes stopped containers and OOM status where Docker exposes it.
  - Reap preview shows what would be removed and why.
  - Reap apply removes selected containers but does not delete worktrees unless explicitly requested.
  - Docker hygiene diagnostics distinguish active images from layers held by stopped containers.

- **Non-Goals**:
  - Automatic worktree deletion in V1.
  - Replacing Docker with another runtime.
  - Retaining unlimited build cache for faster builds.

## 3. AI System Requirements

- **Tool Requirements**:
  - Docker run command builder or command-stub tests.
  - Docker inspect/list parsing for all-state containers.
  - Docker system df parsing or equivalent diagnostics.
  - CLI JSON output for list/reap/doctor.

- **Evaluation Strategy**:
  - Command-stub unit tests for Docker run arguments.
  - Fixture tests for Docker `ps -a`/inspect states: running, exited, OOM-killed, dead, restarting.
  - Reap dry-run tests for one-time, dev, stopped, dirty, and max-age filters.
  - `.dockerignore` tests or review check that worktrees/local state are excluded.
  - Real Docker smoke test for starting a limited worker and running basic web/browser checks.

## 4. Technical Specifications

- **Architecture Overview**:
  - Compute worker spawn paths apply a `ComputeResourcePolicy` with defaults and override sources.
  - Docker labels record resource policy and ownership for later inspection.
  - `list --all` inspects Pibo-labeled containers across all Docker states.
  - Reap builds a cleanup plan first, then applies it only when the operator selects destructive mode.
  - Docker hygiene diagnostics read Docker disk usage and output safe next commands.

- **Integration Points**:
  - `src/compute/docker.ts`
  - `src/compute/cli.ts`
  - `.dockerignore`
  - `Dockerfile`
  - `scripts/docker-entrypoint.sh`

- **Security & Privacy**:
  - List/doctor output must not print environment secrets from containers.
  - Worktree paths may be shown; file contents are not read.
  - Cleanup commands require explicit operator invocation or documented timer policy.

## 5. Risks & Roadmap

- **Phased Rollout**:
  - MVP: add Docker run resource limits and `.dockerignore` hygiene.
  - V1: add all-state list, dry-run reap, dirty/OOM visibility, and Docker disk diagnostics.
  - V1.1: add optional systemd/cron reaper timer after manual validation.

- **Technical Risks**:
  - Too-low memory limits can break browser tests; mitigate with override knobs and documented defaults.
  - Docker inspect output differs by Docker version; mitigate with tolerant parsing and tests.
  - Reap filters can be misunderstood; mitigate with dry-run by default and clear reasons.
