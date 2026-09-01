---
type: "Historical Record"
title: "Proposal: Compute Browser Resource Lifecycle"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/specs/changes/compute-browser-resource-lifecycle/proposal.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "be98568bb1df10c61c2e6e20d1d34f44d1418606"
  source_bytes: 3721
  source_sha256: "3d89e44e70e26e12751aae499219f4f2a250b6e29a770baa2b00111741a709ca"
  source_body_sha256: "3d89e44e70e26e12751aae499219f4f2a250b6e29a770baa2b00111741a709ca"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Proposal: Compute Browser Resource Lifecycle

## Why

Ralph loops and Docker compute workers were designed to reuse a prepared Pibo Docker image and keep agent work isolated from the host. The 2026-05-17 overload incident showed that the image reuse story is not enough: long-lived dev workers can accumulate unmanaged Chromium processes, stale browser-use state, stopped containers, build-cache layers, and worktrees until the host runs out of RAM, swap, PIDs, or disk.

The immediate failure mode was not a large number of Docker image tags. It was unbounded runtime state inside persistent workers: repeated browser verification started new Chromium process trees, cleanup did not reliably match `chromium`, and Docker containers had no memory or PID limits. A durable fix must make browser automation and worker lifecycle bounded resources instead of prompt-level conventions.

## What Changes

Add a resource lifecycle contract for Pibo compute workers, browser-use automation, and Ralph loops:

- Pibo owns browser process lifecycle inside compute workers.
- browser-use attaches to a managed CDP endpoint instead of freely starting unlimited browsers.
- Each worker has a bounded browser pool with leases, reuse, stale-process cleanup, and idle recycling.
- Compute workers start with Docker memory, swap, PID, shm, init, log, and lifecycle labels.
- `pibo compute list/reap` can inspect and clean running and stopped Pibo containers without hiding dev-worker state.
- Ralph jobs bind to worker/container ownership and cannot rely on prompt text such as “do not release container” as the only lifecycle policy.
- Operators get health/doctor output for browser process count, dirty workers, stale leases, Docker disk usage, and cleanup candidates.

## Capabilities

### New Capabilities

- `compute-browser-resource-lifecycle`: manages worker-scoped browser pools, browser leases, idle recycling, stale process cleanup, and resource health checks.

### Modified Capabilities

- `docker-compute-workers`: gains enforced container resource budgets, all-state listing/reaping, TTL/idle labels, Docker hygiene, and safer build context requirements.
- `browser-automation-desktop-environment`: gains managed CDP reuse, process-group cleanup, and browser pool health semantics.
- `browser-use-authenticated-leases`: coordinates auth profile slots with managed browser leases and process cleanup.
- `continuous-ralph-jobs`: binds jobs/runs to owned compute resources and deterministic release or idle-retention policies.
- `runtime-observability-telemetry`: may expose resource pressure, stale browser, and cleanup evidence through future debug/doctor commands.

## Impact

- **Code:** update browser-use wrapper/state handling, compute Docker run options, worker listing/reaping, Ralph resource ownership, and health/doctor commands.
- **CLI:** add or extend `pibo tools browser-use health/reap`, `pibo compute list --all`, `pibo compute reap --include-dev --stopped`, and a resource-focused doctor/status surface.
- **Data:** add local state files or records for worker browser pool leases, pid/process-group metadata, idle timestamps, and cleanup decisions.
- **Auth / Security:** preserve authenticated browser profile isolation. Cleanup must not delete active auth template profiles or unrelated host browser profiles.
- **Docs:** update capability specs and create PRDs for browser pooling, cleanup, Docker resource limits, Ralph integration, and rollout validation. Baseline and rollout docs live at `docs/reports/compute-browser-resource-lifecycle-incident-baseline-2026-05-17.md`, `docs/project/compute-browser-resource-operating-model.md`, and `docs/project/compute-browser-resource-rollout-checklist.md`.
