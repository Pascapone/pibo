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
