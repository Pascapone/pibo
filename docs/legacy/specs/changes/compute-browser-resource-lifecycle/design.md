# Design: Compute Browser Resource Lifecycle

## Context

The change fixes a resource-lifecycle gap that appeared during Ralph-driven browser verification. A Docker image can be reused correctly while a long-lived container still accumulates unmanaged Chromium process trees. The design therefore treats browser processes, browser leases, Docker containers, worktrees, and build cache as separate resources with separate ownership and cleanup rules.

## Goals / Non-Goals

### Goals

- Make Pibo the owner of browser lifecycle inside compute workers.
- Reuse a bounded CDP browser instead of starting unlimited Chromium processes.
- Clean up stale `chrome` and `chromium` process trees tied to Pibo-managed profiles.
- Protect the host with container memory/PID/shm/log limits.
- Make stopped/OOM Pibo containers and Docker disk usage visible.
- Bind Ralph jobs/runs to worker ownership and cleanup policy.

### Non-Goals

- Replace browser-use.
- Delete worktrees automatically without an explicit policy.
- Build a distributed scheduler.
- Add external monitoring infrastructure.

## Decisions

### Decision: Pibo owns Chromium lifecycle; browser-use attaches by CDP

- **Choice:** Pibo starts or reuses a managed Chromium process and passes a CDP URL to browser-use.
- **Rationale:** browser-use is useful for automation, but Pibo needs a central authority for process limits, leases, idle recycling, and cleanup.
- **Alternatives considered:** Let browser-use continue to start browsers and only add better cleanup. Rejected because cleanup alone cannot prevent concurrent process spikes.

### Decision: Default to one browser lane per small worker

- **Choice:** The default pool allows one browser main process per worker unless configured otherwise.
- **Rationale:** The known target host class is small. One headed Chromium process can already consume significant memory.
- **Alternatives considered:** One browser per agent session. Rejected because Ralph loops create many sessions and would reproduce the leak under load.

### Decision: Use lease files or records as the browser-pool authority

- **Choice:** Store pool state with pid, process group id, CDP port, user-data dir, active lease id, owner, last-used time, and health state.
- **Rationale:** State must survive wrapper invocations and be inspectable by CLI/doctor commands.
- **Alternatives considered:** Keep state only in process memory. Rejected because browser-use wrapper calls are short-lived and cross-session.

### Decision: Cleanup prefers exact pid/process-group metadata, then Pibo profile matching

- **Choice:** Reap uses pid/process group first. If metadata is stale, it matches commands that include a Pibo-managed user-data dir and `chrome|chromium`.
- **Rationale:** Exact pid/process-group cleanup is safer. Profile matching handles cases where pid files are missing or stale.
- **Alternatives considered:** Broad `pkill chromium`. Rejected because it can kill unrelated browser sessions.

### Decision: Container resource limits are default behavior, not optional hardening

- **Choice:** Compute containers include memory, memory-swap, pids-limit, shm-size, init, restart policy, and log options by default.
- **Rationale:** Resource limits are the final safety net when browser cleanup fails.
- **Alternatives considered:** Document operator-only limits. Rejected because agents can spawn workers without remembering external Docker flags.

### Decision: `list --all` and dry-run cleanup precede destructive changes

- **Choice:** Pibo exposes all-state listing and cleanup previews before removing stopped containers, dev workers, images, cache, or worktrees.
- **Rationale:** Debug state may be valuable. The user explicitly does not want hidden destructive cleanup.
- **Alternatives considered:** Automatic aggressive prune. Rejected because it can destroy debugging evidence.

### Decision: Ralph resource policy overrides prompt wording

- **Choice:** Ralph-owned workers follow machine-readable TTL/release/recycle policy even if prompt text tells the agent not to release a container.
- **Rationale:** Prompt text is not enforceable lifecycle management.
- **Alternatives considered:** Improve prompt instructions only. Rejected because the failure was caused by missing system enforcement.

## Resource Model

### Browser Pool

A worker-scoped browser pool has:

- `workerId`
- `poolId`
- `maxBrowserProcesses`
- `cdpPort`
- `pid`
- `processGroupId`
- `userDataDir`
- `profileName`
- `activeLeaseId`
- `ownerScope`
- `lastUsedAt`
- `idleExpiresAt`
- `state`: `empty | starting | ready | leased | stale | dirty | reaping`
- `lastError`

### Browser Lease

A browser lease has:

- `leaseId`
- `poolId`
- `owner`
- `piboSessionId` or `ralphRunId` when known
- `acquiredAt`
- `releasedAt`
- `expiresAt`
- `cdpUrl`
- `cleanupStatus`

### Worker Resource Policy

A worker has labels or inspectable metadata for:

- role: `worker` or `dev`
- owner scope
- Ralph job/run ids when applicable
- worktree name/path
- created time
- last used time
- ttl/idle expiry
- memory limit
- memory-swap limit
- pids limit
- shm size
- restart policy
- dirty reason

## CLI Shape

Exact command names may change during implementation, but the product shape is:

```text
pibo tools browser-use health [--json]
pibo tools browser-use pool status [--json]
pibo tools browser-use pool reap [--idle] [--stale] [--json]
pibo compute list --all [--json]
pibo compute reap --dry-run --include-dev --stopped --dirty --max-age-minutes <n>
pibo compute doctor resources [--json]
pibo ralph resources --owner-scope <scope> [--json]
```

## Migration / Rollback

- Browser pool management should be introduced behind default-compatible wrapper behavior. If pool acquire fails due to a bug, operators can temporarily disable managed pool mode through a documented env var while Docker limits remain active.
- Docker run limit defaults should be conservative but overrideable for development hosts.
- Reaping commands should start with dry-run support before automatic timers are installed.
- Worktree deletion should remain opt-in until operators confirm the policy.

## Risks / Trade-offs

- **CDP reuse can leak tab state across checks.** Mitigate by closing tabs/contexts on lease release and using isolated profiles when auth isolation is required.
- **One-browser default can serialize browser checks.** Accept for small hosts; expose an override for larger machines.
- **Killing stale processes can be dangerous.** Mitigate by matching Pibo-managed pid/profile metadata and never broad-killing arbitrary Chromium.
- **Resource limits can break legitimate heavy tests.** Mitigate through documented overrides and clear diagnostics.
- **Ralph release after completion may remove useful debug state.** Mitigate with short idle-retention policy and explicit worktree preservation.

## Open Questions

- Should the browser pool queue or fail fast when busy?
- Should pool state be host-side for easier `pibo compute doctor`, or worker-side for isolation?
- What is the default post-completion Ralph worker idle-retention period?
- Should automatic reaper timers be enabled by install/deploy scripts or documented first as operator setup?
