# Compute Browser Resource Operating Model

**Status:** Draft  
**Change:** `docs/specs/changes/compute-browser-resource-lifecycle/`

This model defines the resource terms used by Pibo compute workers, browser automation, and Ralph jobs. Prompt text may ask agents to reuse or retain resources for debugging, but prompt text cannot override hard resource limits, TTLs, browser-pool reaping, dirty-worker recycling, or explicit cleanup policy.

## Canonical resources

| Resource | Owner | Release / recycle authority |
|---|---|---|
| Docker image | Pibo compute build system | Rebuilt by `pibo compute rebuild` or spawn rebuild predicates; pruned only by explicit Docker hygiene commands. |
| Compute container | Pibo compute CLI | Created by `pibo compute spawn` or `pibo compute dev spawn`; stopped/removed by `pibo compute release` or eligible `pibo compute reap` policy. |
| Dev worker | Pibo compute CLI and operator | Long-lived compute container tied to a worktree; can be released/reaped by explicit compute policy, but its worktree remains until separate cleanup. |
| Worktree | Git/operator | Created or attached by dev-worker spawn; deletion remains explicit and separate from container/browser cleanup. |
| Browser pool | Pibo browser resource lifecycle | Worker-scoped authority that starts, reuses, leases, and reaps managed Chromium CDP browsers. |
| Browser lease | Browser pool | Acquired for an automation task or session; released after use; stale or expired leases are reaped by browser-pool policy. |
| Auth profile lease | Browser-use authenticated lease system | Acquired from a closed template profile; released with `pibo tools browser-use lease release`; optional profile deletion is explicit. |
| Ralph job | Ralph service/store | Owner-scoped durable loop definition; stopped, cancelled, disabled, or completed by Ralph policy. |
| Ralph run | Ralph service/store | One execution attempt for a job; completion/cancel/interruption records resource cleanup state when compute/browser resources are used. |

## Operating rules

1. Docker images, containers, worktrees, browser pools, browser leases, auth profile leases, Ralph jobs, and Ralph runs are different resources. Do not use one count as a proxy for another.
2. Pibo owns browser process lifecycle inside compute workers. browser-use should attach to a managed CDP URL instead of starting unlimited unmanaged Chromium processes.
3. Compute containers must start with host-safe memory, swap, PID, shm, restart, init, and log policies. These limits are system policy, not prompt guidance.
4. Browser-pool cleanup may close tabs/contexts, release leases, kill stale managed `chrome|chromium` process trees, and remove stale state files tied to Pibo-managed profiles.
5. Auth profile cleanup must preserve the authenticated template profile unless the operator explicitly targets that template workflow.
6. Ralph-owned resources must be machine-readable: worker ids, browser lease ids, job id, run id, cleanup state, and retention/dirty reasons should be visible to status and diagnostic commands. Legacy compute owner labels, when present, are compatibility metadata only.
7. Worktree deletion is not part of normal browser or container reaping. Operators must opt into worktree cleanup separately.

## Default ownership flow

1. `pibo compute dev spawn` creates or attaches a worktree, starts a dev worker, labels the container, and exposes gateway/CDP/web ports.
2. Browser automation in that worker asks the browser pool for a lease. The pool reuses a healthy CDP browser or starts one within the configured max process limit.
3. Authenticated checks may also acquire an auth profile lease. The auth lease and browser lease are coordinated, but the auth template profile remains protected.
4. Ralph runs record which worker and browser resources they use. On run completion, cancel, interruption, max-iteration stop, or promise-complete stop, Ralph applies cleanup/retention policy instead of relying on prompt text.
5. Operators inspect retained state through all-state compute listing, browser-pool health, Ralph resource views, and Docker hygiene diagnostics before destructive cleanup.

## Related docs

- Change spec: `docs/specs/changes/compute-browser-resource-lifecycle/spec.md`
- Design: `docs/specs/changes/compute-browser-resource-lifecycle/design.md`
- Incident baseline: `docs/reports/compute-browser-resource-lifecycle-incident-baseline-2026-05-17.md`
- Rollout checklist: `docs/project/compute-browser-resource-rollout-checklist.md`
