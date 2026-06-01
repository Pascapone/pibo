# PRD Catalog: Compute Browser Resource Lifecycle

**Status:** Draft  
**Created:** 2026-05-17  
**Source change:** `docs/specs/changes/compute-browser-resource-lifecycle/`

This directory translates the compute/browser resource lifecycle specs into implementation-grade Markdown PRDs and Ralph-ready `prd_*.json` files.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`
- `../../../../reports/compute-browser-resource-lifecycle-incident-baseline-2026-05-17.md`
- `../../../../project/compute-browser-resource-operating-model.md`
- `../../../../project/compute-browser-resource-rollout-checklist.md`
- `../../../capabilities/docker-compute-workers.md`
- `../../../capabilities/browser-automation-desktop-environment.md`
- `../../../capabilities/browser-use-authenticated-leases.md`
- `../../../capabilities/continuous-ralph-jobs.md`

## Baseline and Operating Model

- Incident baseline: `docs/reports/compute-browser-resource-lifecycle-incident-baseline-2026-05-17.md`
- Canonical resource model: `docs/project/compute-browser-resource-operating-model.md`
- Rollout checklist: `docs/project/compute-browser-resource-rollout-checklist.md`

## PRDs

| PRD | Scope | Primary implementers | Ralph JSON |
|---|---|---|---|
| `01-product-overview-and-incident-baseline.md` | Product framing, user personas, success metrics, incident baseline, rollout boundaries | Product/engineering leads | `prd_01_product_overview_and_incident_baseline.json` |
| `02-managed-browser-pool-and-cdp-reuse.md` | Worker-scoped browser pool, CDP reuse, leases, concurrency, pool status | Browser/tooling engineers | `prd_02_managed_browser_pool_and_cdp_reuse.json` |
| `03-browser-cleanup-and-stale-process-reaping.md` | Release cleanup, stale `chrome|chromium` process reaping, idle recycling, auth-slot coordination | Browser/tooling engineers | `prd_03_browser_cleanup_and_stale_process_reaping.json` |
| `04-compute-worker-limits-and-lifecycle.md` | Docker resource limits, all-state list/reap, TTL/idle retention, Docker hygiene, worktree policy | Compute/CLI engineers | `prd_04_compute_worker_limits_and_lifecycle.json` |
| `05-ralph-resource-ownership-and-operational-health.md` | Ralph resource ownership, cleanup on completion/cancel, resource doctor, monitoring/rollout | Ralph/runtime/SRE engineers | `prd_05_ralph_resource_ownership_and_operational_health.json` |

## Global Decisions Inherited by All PRDs

- Pibo owns browser process lifecycle inside compute workers.
- browser-use should attach to a managed CDP endpoint instead of starting unbounded browsers.
- The default pool limit for small workers is one browser main process.
- Cleanup must match both `chrome` and `chromium`, scoped to Pibo-managed pid/profile metadata.
- Docker resource limits are default safety behavior, not optional documentation.
- `pibo compute list --all` and dry-run cleanup must make stopped/OOM/debug state visible before destructive actions.
- Worktree deletion remains explicit and separate from container/browser cleanup.
- Ralph prompt text cannot override hard resource limits, TTL, dirty-worker recycling, or browser-pool reaping.

## Traceability Matrix

| Spec requirement | PRD coverage |
|---|---|
| Managed browser pool | `02` |
| Browser lease cleanup and stale process reaping | `03` |
| Idle browser and worker recycling | `03`, `04`, `05` |
| Compute container resource budgets | `04` |
| All-state compute list/reap | `04` |
| Ralph resource ownership and cleanup policy | `05` |
| Docker image/build-cache/worktree hygiene | `04`, `05` |
| Operator resource health diagnostics | `01`, `05` |

## Execution Readiness

Implementation can proceed without new product clarification if the first implementation slice keeps these defaults:

- Use one browser lane per worker.
- Prefer CDP reuse. Fail or queue when busy; do not start an unmanaged browser fallback silently.
- Add Docker memory/PID/shm/init/log limits before enabling long-running browser stress tests.
- Add read-only/all-state diagnostics before automatic destructive cleanup.
- Preserve worktrees unless the user explicitly requests worktree cleanup.

## Shared QA Conventions

- Every destructive cleanup path needs dry-run or preview output first.
- Every operator-facing list/status command needs `--json` for agents and monitoring.
- Stress validation should run repeated browser-use checks in a real Docker worker and assert bounded Chromium main-process count.
- Tests must cover `chromium` and `chrome` command names.
- Tests must distinguish browser main-process trees from normal Chromium renderer/utility child processes.
