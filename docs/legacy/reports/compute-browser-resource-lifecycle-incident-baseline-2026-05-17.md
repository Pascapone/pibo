# Report: Compute Browser Resource Lifecycle Incident Baseline

**Date:** 2026-05-17  
**Change:** `docs/specs/changes/compute-browser-resource-lifecycle/`  
**Evidence tier:** Host read-only Docker/process inspection plus source/spec inspection. No cleanup was performed.

## Summary

The overload incident was a runtime-lifecycle failure, not an image-count failure. Pibo reused a small number of Docker images, but retained compute workers accumulated unbounded runtime state: Chromium process trees, browser-use/CDP state, stopped or dirty containers, build cache, and worktrees.

The durable fix is to treat browser processes, browser leases, compute containers, Ralph runs, and worktrees as separate resources with separate ownership and release policy.

## Baseline snapshot

Read-only commands were run from the `compute-browser-resource-lifecycle` worktree on 2026-05-17 at `08:33:06Z`.

| Metric | Observed value | Evidence command |
|---|---:|---|
| Docker image count | 1 unique image | `docker images -q \| sort -u \| wc -l` |
| Docker container count | 4 containers | `docker ps -aq \| wc -l` |
| Docker image size | 18.37 GB | `docker system df` |
| Docker container writable size | 2.109 GB | `docker system df` |
| BuildKit/build cache | 10.75 GB total; 6.316 GB reclaimable | `docker system df` |
| Local Docker volumes | 4 volumes; 456.7 kB total | `docker system df` |
| Stopped/dead/created Pibo containers | 0 at snapshot time | `docker ps -a --filter status=...` |
| OOM-killed Pibo containers | 0 at snapshot time | `docker inspect .State.OOMKilled` |
| Host-visible Chrome/Chromium processes | 0 real browser processes at snapshot time | `pgrep -af '[c]hrome|[c]hromium'` |
| Worker-internal Chrome/Chromium processes | 0 in reachable Pibo dev workers at snapshot time | `docker exec -w / <worker> pgrep -af '[c]hrome|[c]hromium'` |
| Host RAM / swap class | Small host: 7.7 GiB RAM, 0 B swap | `free -h` |

Affected or relevant retained workers visible at snapshot time:

| Worker | Status | Role | Worktree | Owner |
|---|---|---|---|---|
| `pibo-dev-compute-browser-resource-lifecycle` | Up 7 minutes | `dev` | `compute-browser-resource-lifecycle` | `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa` |
| `pibo-dev-ink-cli-v2-web-parity` | Up 8 hours | `dev` | `ink-cli-v2-web-parity` | `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa` |
| `pibo-dev-ralph-ink-cli-session-ui` | Up 21 hours | `dev` | `ralph-ink-cli-session-ui` | `user:ueR3mwuqBMPNTber3xuTwLmODbUlF4Sa` |
| `pibo-dev-ralph-observability-telemetry` | Up 24 hours | `dev` | `ralph-observability-telemetry` | `ralph-telemetry` |

The live snapshot was already cleaner than the incident peak. It still shows why the fix must cover retained dev workers and Docker build cache: a single active image can coexist with multiple long-lived containers and more than 10 GB of build cache.

## Resource distinctions

- **Docker image reuse** means many workers can start from the same built image. It does not bound process, PID, memory, writable-layer, or browser state inside running containers.
- **Container reuse** means a compute worker stays alive across commands or sessions. It preserves useful debug state, but it also preserves stale browser processes, CDP files, and dirty runtime state unless Pibo reaps them.
- **Ralph sessions** are repeated agent runs for a Ralph job. A fresh Ralph session can still reuse the same worker and therefore inherit that worker's process and browser state.
- **browser-use sessions** are browser automation invocations or profile sessions inside a worker. They can attach to a CDP endpoint or start Chromium. Without a managed pool, repeated invocations can create more browser process trees.
- **Chromium process trees** are OS resources: a browser main process plus renderer, GPU, utility, zygote, and crashpad children. They consume memory and PIDs independently of Docker image count.

## Failure class

The primary failure class was unbounded runtime state inside retained workers. Many tagged Docker images were not the main problem in this snapshot: there was one unique Docker image. The unsafe behavior was that persistent workers could accumulate browser process trees, stale CDP/browser-use state, stopped or dirty containers, build cache, and worktrees without hard lifecycle policy.

## Required follow-up

- Manage browser automation through a worker-scoped browser pool with CDP reuse and max process limits.
- Reap stale managed `chrome|chromium` process trees using pid/process-group metadata and Pibo-managed profile paths.
- Start compute containers with memory, swap, PID, shm, restart, init, and log limits.
- Make `pibo compute list --all`, dry-run reap planning, Docker hygiene diagnostics, and Ralph resource ownership visible before enabling automatic destructive cleanup.
- Keep worktree deletion explicit and separate from browser/container cleanup.
