# Spec: Compute Browser Resource Lifecycle

**Status:** Draft  
**Created:** 2026-05-17  
**Owner / Source:** User request in Pibo session `ps_22a69e7e-a2a2-4450-be8e-17ce8056d3d8`; 2026-05-17 server overload analysis  
**Related docs:** `docs/reports/compute-browser-resource-lifecycle-incident-baseline-2026-05-17.md`, `docs/project/compute-browser-resource-operating-model.md`, `docs/project/compute-browser-resource-rollout-checklist.md`, `docs/specs/capabilities/docker-compute-workers.md`, `docs/specs/capabilities/browser-automation-desktop-environment.md`, `docs/specs/capabilities/browser-use-authenticated-leases.md`, `docs/specs/capabilities/continuous-ralph-jobs.md`, `docs/specs/changes/compute-browser-resource-lifecycle/design.md`, `docs/specs/changes/compute-browser-resource-lifecycle/tasks.md`

## Why

Pibo compute workers let agents run browser checks and development gateways without touching the host gateway. Ralph loops rely on that isolation for long-running autonomous work. The 2026-05-17 overload incident showed that isolation without lifecycle control is unsafe on small hosts: persistent dev containers accumulated many Chromium processes, swap was exhausted, and Docker retained old containers, layers, and build cache.

The system needs a clear resource contract. Agents may request browser verification, but Pibo must decide whether to reuse, recycle, or reject browser and worker resources. Prompt instructions are not a cleanup mechanism. The durable terms and ownership rules are captured in `docs/project/compute-browser-resource-operating-model.md`; rollout validation is tracked in `docs/project/compute-browser-resource-rollout-checklist.md`.

## Goal

Pibo MUST manage browser automation, Docker compute workers, and Ralph-owned resources as bounded, inspectable, reusable, and recyclable resources so repeated agent sessions cannot accumulate unbounded Chromium processes, containers, worktrees, images, or Docker cache.

## Background / Current State

Current compute workers are started from a shared Docker image. Dev workers stay alive with `tail -f /dev/null` and expose gateway, CDP, web, and UI ports. Browser-use runs inside the worker with Chromium and Xvfb available.

The incident analysis found these gaps:

- Browser-use/browser wrapper cleanup can miss `chromium` when it searches for `chrome` process patterns.
- Browser starts are not governed by a worker-scoped pool or lease authority.
- Dev-worker containers have no `--memory`, `--memory-swap`, `--pids-limit`, `--init`, or `--shm-size` policy.
- Reaping defaults exclude dev workers and do not clearly cover stopped containers.
- Docker build context and cache can grow without an operator-visible budget.
- Ralph jobs can leave workers alive through prompt instructions, without machine-enforced ownership, TTL, or cleanup policy.

## Scope

### In Scope

- Worker-scoped browser pool with CDP reuse, locking, lease metadata, health checks, and idle recycling.
- Stale Chromium process detection and cleanup using pid files, process groups, profile paths, and `chrome|chromium` matching.
- Coordination between authenticated browser-use profile leases and managed browser leases.
- Docker resource limits for compute containers: memory, swap, PIDs, shared memory, init, restart behavior, and log bounds.
- Worker labels for owner scope, Ralph job/run ids, TTL, idle timestamps, resource policy, worktree, and browser pool state.
- `pibo compute list` and `pibo compute reap` behavior that can inspect and clean running and stopped Pibo containers.
- Docker hygiene for build context, cache pruning, stale images, and old worktrees.
- Ralph integration for worker acquisition, reuse, stop/complete release, and dirty-worker recycling.
- Operator diagnostics for browser process count, stale leases, dirty workers, OOM evidence, Docker disk usage, and cleanup candidates.

### Out of Scope

- Replacing browser-use as the automation tool — Pibo manages lifecycle and passes browser endpoints to browser-use.
- Distributed worker scheduling across machines.
- Deleting worktrees automatically without an explicit lifecycle policy or operator-approved retention rule.
- Production browser automation for arbitrary external user profiles.
- External monitoring/SaaS integration.

## Requirements

### Requirement: Browser automation uses a worker-scoped managed browser pool

The system MUST prevent unbounded browser process creation inside a compute worker by routing browser-use through a Pibo-managed pool.

#### Current

Browser-use can start new Chromium processes across sessions. State exists in CDP pid/port files and profile directories, but there is no single worker-level authority that enforces a max browser count.

#### Target

Each worker has a browser pool authority. By default, the pool allows one active Chromium main process per browser lane and exposes a stable CDP URL. Browser-use invocations attach to that CDP URL instead of starting unmanaged browsers.

#### Acceptance

- A browser-use command in a compute worker receives a Pibo-managed CDP URL when browser automation is requested.
- The pool records pid, process group id when available, CDP port, user-data dir, lease id, owner, active count, last-used time, and health state.
- Concurrent acquire requests serialize through a lock and never start more browser main processes than the configured pool limit.
- Reusing an existing healthy browser does not create another Chromium main process.
- If the managed browser is dead or unreachable, the pool marks it stale and starts at most one replacement.
- Pool defaults are conservative for small workers: one browser lane, bounded startup timeout, and explicit failure when the pool is exhausted.

#### Scenario: Reuse existing browser

- GIVEN a worker has a healthy managed Chromium process listening on its CDP port
- WHEN a second agent session requests browser-use verification
- THEN Pibo returns the existing CDP URL
- AND no second Chromium main process is started.

#### Scenario: Concurrent browser requests

- GIVEN two agent sessions request browser-use at the same time in the same worker
- WHEN both acquire the browser pool
- THEN one request obtains the lease first
- AND the second waits, reuses the existing browser, or fails with a pool-exhausted error according to the configured queue policy
- AND the worker never exceeds the configured browser main-process limit.

### Requirement: Browser leases clean tabs, contexts, profiles, and stale processes

The browser pool MUST clean up after each lease and MUST remove stale Chromium process trees that belong to Pibo-managed profiles.

#### Current

The wrapper attempts stale process cleanup, but process matching can miss `chromium`. Cleanup is not tied to a pool lease lifecycle.

#### Target

Release and reap paths close or reset browser state for the lease and terminate stale process groups owned by Pibo-managed pid/profile metadata. The system distinguishes normal Chromium child processes from separate orphan browser main processes.

#### Acceptance

- Release closes lease-owned tabs or contexts when CDP is reachable.
- Release updates `lastUsedAt` and active lease counters even when tab cleanup fails.
- Reap kills stale managed browsers by pid/process group first, then by profile path and `chrome|chromium` command matching.
- Reap never targets unrelated host browser profiles or the auth template profile.
- Stale pid/port/profile lock files are removed only after the associated process is confirmed dead or explicitly killed.
- Cleanup reports how many leases, browsers, processes, and stale files were affected.

#### Scenario: Chromium pattern cleanup

- GIVEN a stale managed browser was launched as `/usr/bin/chromium` with a Pibo user-data directory
- WHEN the browser pool reaper runs
- THEN it detects and terminates that process tree
- AND removes the stale CDP state files for that managed profile.

### Requirement: Idle browser and worker resources are recycled

The system MUST recycle idle browser pools and eligible workers according to explicit TTL and idle policies.

#### Current

Dev workers can stay alive indefinitely, and browser processes may remain until the container exits or cleanup happens manually.

#### Target

Browser pools have short idle timeouts. Workers have longer idle retention and max-age policies. Dirty workers can be recycled earlier.

#### Acceptance

- Browser pool idle timeout defaults to a bounded value such as 15 minutes unless configured differently.
- Worker idle retention defaults to a bounded value such as 60–180 minutes for dev/Ralph workers unless explicitly extended.
- A worker becomes dirty when browser process count, PIDs, memory, CDP state, or cleanup failures exceed policy thresholds.
- Dirty workers are marked in list/status output and become eligible for recycle after active leases/runs finish.
- Recycle stops browsers before stopping/removing the worker container.
- Operators can inspect the recycle reason before destructive worktree deletion.

#### Scenario: Idle browser recycle

- GIVEN a worker browser pool has no active lease and `lastUsedAt` is older than the idle timeout
- WHEN the pool reaper runs
- THEN it terminates the managed Chromium process tree
- AND keeps the worker available for later reuse.

### Requirement: Compute containers enforce host-safe resource budgets

Every Pibo compute container MUST start with resource limits that prevent one worker from exhausting the host.

#### Current

Compute Docker runs do not set memory, swap, PID, init, shm, restart, or log limits.

#### Target

Docker run options apply explicit limits by default and expose safe override hooks for larger hosts.

#### Acceptance

- One-time and dev workers include memory, memory-swap, PIDs, shm-size, init, restart policy, and log options in the Docker run contract.
- Defaults are safe for small hosts and configurable through documented environment variables or CLI options.
- The container reports its resource policy through labels and `pibo compute list/status`.
- PID exhaustion inside one container does not prevent host Pibo services from accepting health checks.
- OOM in one compute worker marks that worker dirty/failed and does not silently restart it in a loop.

#### Scenario: Worker reaches PID limit

- GIVEN a browser leak tries to start too many Chromium processes
- WHEN the worker reaches its configured PID limit
- THEN the container blocks or fails that work inside the worker
- AND host Pibo web services remain responsive
- AND diagnostics show that the worker hit a PID/resource limit.

### Requirement: Compute listing and reaping cover all Pibo worker states

The compute CLI MUST make running and stopped Pibo containers visible and eligible for controlled cleanup.

#### Current

Operator-facing list/reap behavior emphasizes running workers and excludes dev workers by default. Stopped containers and dev retention can be hidden from normal inspection.

#### Target

Operators can list all Pibo compute containers, including stopped/OOM containers, see why they exist, and reap eligible resources by class.

#### Acceptance

- `pibo compute list --all` shows running, exited, dead, OOM-killed, and restarting Pibo compute containers.
- Output includes role, owner, Ralph job/run ids, worktree, created time, last-used time, age, resource policy, status, OOM flag, ports when available, and cleanup eligibility.
- `pibo compute reap` supports explicit selectors for one-time workers, dev workers, stopped containers, dirty workers, and max age.
- Reap has a dry-run mode or preview output before destructive cleanup.
- Reap does not delete Git worktrees unless a separate explicit worktree cleanup flag or command is provided.

#### Scenario: OOM-killed dev worker is visible

- GIVEN a dev worker container exited after OOM
- WHEN an operator runs `pibo compute list --all`
- THEN the worker appears with exited/OOM status, worktree, owner, age, and cleanup suggestion.

### Requirement: Ralph owns and releases compute resources by policy

Ralph jobs and runs MUST bind to compute resources through machine-readable ownership metadata and deterministic cleanup policy.

#### Current

Some Ralph prompts can instruct agents not to release containers. The system does not consistently bind job/run lifecycle to container release or idle retention.

#### Target

Ralph records which worker it uses, labels the worker with job/run ownership, and applies cleanup after stop, cancel, max-iteration, or promise-complete outcomes.

#### Acceptance

- Ralph job/run metadata includes assigned worker id or reuse policy when Docker workers are used.
- Worker containers include `pibo.ralph.jobId`, `pibo.ralph.runId` when applicable, and `pibo.compute.ownerScope` labels.
- Prompt text cannot override hard TTL, browser pool cleanup, or resource limits.
- On promise-complete or max-iteration stop, Ralph releases the browser pool and either releases the worker or marks it idle-retained with an expiry.
- On cancel, Ralph aborts active browser leases and marks the worker dirty when cleanup cannot complete.
- Disabled jobs are visible with their last resource ids and cleanup status.

#### Scenario: Promise complete releases resources

- GIVEN a Ralph job uses a dev worker and finishes with the completion marker
- WHEN Ralph disables the job with reason `promise-complete`
- THEN the associated browser pool is reaped
- AND the worker is released or marked idle-retained according to the configured policy
- AND `pibo compute list --all` shows no active browser lease for that job.

### Requirement: Docker image, build cache, and worktree growth are bounded

The system MUST keep Docker disk usage and build contexts inspectable and bounded.

#### Current

Docker image tags may be few, but old layers, stopped containers, worktrees, and BuildKit cache can occupy large disk space. `.dockerignore` does not explicitly ignore worktrees.

#### Target

Pibo documents and enforces a Docker hygiene policy for compute builds and cleanup.

#### Acceptance

- The Docker build context excludes `.worktrees`, local browser profiles, logs, screenshots, and Pibo local state that should not be copied into images.
- `pibo compute doctor` or equivalent reports image count, container count, build-cache size, volume size, and reclaimable bytes.
- Operators can prune Pibo-owned build cache/images through a clear command or documented procedure with dry-run/confirmation semantics.
- Old images are not retained solely because stopped Pibo containers are hidden from listing.
- Worktree cleanup is reported separately from Docker cleanup and requires explicit selection.

#### Scenario: Build cache over budget

- GIVEN Docker BuildKit cache exceeds the configured budget
- WHEN an operator runs the compute doctor command
- THEN output shows the cache size, reclaimable bytes, and the exact safe prune command.

### Requirement: Operators receive actionable resource health diagnostics

Pibo MUST provide diagnostics that show browser leaks and cleanup risk before the host is overloaded.

#### Current

Operators must combine `docker ps -a`, `docker system df`, `journalctl`, kernel OOM logs, and process listings manually.

#### Target

A Pibo command summarizes resource health and points to safe next commands.

#### Acceptance

- Health output includes browser main-process count per worker, total Chromium process count, active browser leases, stale CDP files, dirty workers, OOM-killed containers, Docker disk use, and reaper/timer status.
- Text output gives concrete next commands for cleanup.
- JSON output is stable for agents and monitoring.
- The command is read-only unless an explicit cleanup subcommand or flag is used.
- OOM evidence includes absolute timestamps when available.

#### Scenario: Browser leak warning

- GIVEN one worker has multiple Chromium main processes outside the managed pool
- WHEN an operator runs resource health
- THEN Pibo marks the worker dirty, shows the process count, and suggests browser-pool reap or worker recycle before host OOM.

## Edge Cases

- Chromium child processes are normal; diagnostics MUST distinguish separate main/browser process trees from renderer/utility children when possible.
- A browser lease may be released after the worker container has already exited; release MUST become a state update and not fail the whole cleanup.
- CDP may be reachable while the pid file is stale; the pool MUST validate both reachability and process identity.
- Auth template profiles may contain lock files during manual login; reapers MUST NOT delete or kill the auth template browser unless the template is explicitly managed by the pool.
- Docker may report no ports for stopped containers; list output MUST still show identity and cleanup fields.
- Cleanup commands may race with active Ralph runs; ownership locks and active-run checks MUST prevent deleting resources still in use.

## Constraints

- **Host Safety:** Resource limits and reapers must protect host Pibo services on small machines with about 2 vCPU and 4 GiB RAM.
- **Compatibility:** Existing `browser-use` workflows should keep working through environment/CDP injection where possible.
- **Security / Privacy:** Authenticated Chrome profiles may contain cookies; cleanup must not expose or copy profile contents into logs, Docker images, or default diagnostics.
- **Concurrency:** Browser pool acquire/release/reap operations require a lock or transactional state update.
- **Operator Control:** Worktree deletion remains explicit because worktrees may contain unsaved debugging state.

## Success Criteria

- [ ] SC-001: Repeated browser-use verification in one worker reuses the managed CDP browser and does not increase Chromium main-process count beyond the configured pool limit.
- [ ] SC-002: Stale `chromium` and `chrome` process trees created by Pibo-managed profiles are detected and cleaned by browser-pool reap tests.
- [ ] SC-003: Compute Docker run command construction includes memory, swap, PIDs, shm, init, restart, and log limits for one-time and dev workers.
- [ ] SC-004: `pibo compute list --all` reports running and stopped/OOM Pibo containers with owner, worktree, Ralph, resource policy, and cleanup eligibility fields.
- [ ] SC-005: Ralph promise-complete, max-iteration stop, and cancel paths release browser leases and apply worker retention/recycle policy.
- [ ] SC-006: Docker hygiene excludes `.worktrees` and local browser state from image build contexts and exposes build-cache/disk usage diagnostics.
- [ ] SC-007: A real Docker worker stress validation runs repeated browser checks without host OOM and with bounded process counts.

## Assumptions and Open Questions

### Assumptions

- Pibo should own browser lifecycle and pass CDP URLs to browser-use rather than allowing browser-use to make independent lifecycle decisions by default.
- The default pool limit for small compute workers should be one browser main process.
- Worker browser pool state can start as local files inside the worker or mounted workspace, as long as commands can inspect it reliably.
- Resource limits can be overridden for larger hosts, but defaults must protect small hosts.

### Open Questions

- Should browser-pool state live inside the worker filesystem, the mounted worktree, or host-side Pibo state keyed by container id?
- Should the pool queue concurrent browser requests or fail fast when the lease is busy?
- What default memory limit should Pibo use for dev workers on hosts larger than 4 GiB RAM?
- Should Ralph default to releasing dev workers after completion or idle-retaining them for a short post-run debugging window?
- Should Docker pruning be implemented as Pibo CLI commands or documented as operator playbooks first?

## Traceability

| Requirement | Scenario / Story | PRD | Status |
|---|---|---|---|
| REQ-001 Browser automation uses a worker-scoped managed browser pool | Reuse existing browser; Concurrent browser requests | `prds/02-managed-browser-pool-and-cdp-reuse.md` | Draft |
| REQ-002 Browser leases clean tabs, contexts, profiles, and stale processes | Chromium pattern cleanup | `prds/03-browser-cleanup-and-stale-process-reaping.md` | Draft |
| REQ-003 Idle browser and worker resources are recycled | Idle browser recycle | `prds/03-browser-cleanup-and-stale-process-reaping.md`, `prds/04-compute-worker-limits-and-lifecycle.md` | Draft |
| REQ-004 Compute containers enforce host-safe resource budgets | Worker reaches PID limit | `prds/04-compute-worker-limits-and-lifecycle.md` | Draft |
| REQ-005 Compute listing and reaping cover all Pibo worker states | OOM-killed dev worker is visible | `prds/04-compute-worker-limits-and-lifecycle.md` | Draft |
| REQ-006 Ralph owns and releases compute resources by policy | Promise complete releases resources | `prds/05-ralph-resource-ownership-and-operational-health.md` | Draft |
| REQ-007 Docker image, build cache, and worktree growth are bounded | Build cache over budget | `prds/04-compute-worker-limits-and-lifecycle.md`, `prds/05-ralph-resource-ownership-and-operational-health.md` | Draft |
| REQ-008 Operators receive actionable resource health diagnostics | Browser leak warning | `prds/05-ralph-resource-ownership-and-operational-health.md` | Draft |
