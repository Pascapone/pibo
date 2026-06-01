# Tasks: Compute Browser Resource Lifecycle

## 1. Spec and Discovery Baseline

- [x] 1.1 Record the 2026-05-17 incident baseline in `docs/reports/` with counts for containers, images, BuildKit cache, and Chromium processes.
- [x] 1.2 Update capability specs for Docker compute workers, browser automation, browser-use leases, and Ralph jobs with the resource lifecycle contract.
- [x] 1.3 Add CLI help snapshots or command-stub tests for planned `compute list --all`, `compute reap`, and browser-use health/pool commands.

## 2. Requirement: Browser automation uses a managed browser pool

- [ ] 2.1 Add tests that simulate repeated browser-use invocations and assert one managed browser main process is reused.
- [ ] 2.2 Add pool state model and locking for acquire/release/reap.
- [ ] 2.3 Update `src/tools/browser-use-wrapper.ts` so browser-use receives a Pibo-managed CDP endpoint by default in compute workers.
- [ ] 2.4 Add JSON/text pool status output.

## 3. Requirement: Browser cleanup and stale process reaping

- [ ] 3.1 Add tests for stale `/usr/bin/chromium` and `google-chrome` process command lines with Pibo-managed user-data dirs.
- [ ] 3.2 Fix stale process matching to include `chrome|chromium` and prefer pid/process-group cleanup.
- [ ] 3.3 Add release cleanup for tabs/contexts when CDP is reachable.
- [ ] 3.4 Add idle reaper behavior for browser pools.

## 4. Requirement: Compute containers enforce resource budgets

- [ ] 4.1 Add Docker command construction tests for one-time and dev worker limits.
- [ ] 4.2 Update `src/compute/docker.ts` Docker run options with memory, swap, pids, shm, init, restart, and log limits.
- [ ] 4.3 Add labels that record resource policy and owner/Ralph/worktree metadata.
- [x] 4.4 Add a real-Docker limited-worker smoke script that starts a bounded one-time worker, validates shell/gateway-adjacent access and Chromium smoke when explicitly applied, records inspect/list resource policy evidence, skips clearly without Docker or apply permission, and releases the worker.

## 5. Requirement: Compute listing, reaping, and Docker hygiene

- [ ] 5.1 Extend list logic to support all-state Pibo containers, including stopped and OOM-killed containers.
- [ ] 5.2 Add dry-run cleanup planning for stopped, dirty, old, one-time, and dev workers.
- [ ] 5.3 Keep worktree deletion out of container reap unless an explicit worktree cleanup command/flag is added.
- [ ] 5.4 Update `.dockerignore` to exclude `.worktrees`, local browser state, logs, screenshots, and Pibo-local state that should not enter images.
- [ ] 5.5 Add Docker disk/build-cache diagnostics with safe next commands.

## 6. Requirement: Ralph resource ownership

- [ ] 6.1 Add Ralph job/run resource metadata for assigned worker id and cleanup state.
- [ ] 6.2 Add worker labels for `pibo.ralph.jobId`, `pibo.ralph.runId`, and `pibo.compute.ownerScope` when Ralph uses a worker.
- [ ] 6.3 Release browser leases after each run and apply worker retention/recycle policy after promise-complete, max-iteration, stop, and cancel.
- [ ] 6.4 Add CLI/API visibility for disabled jobs with retained workers or cleanup failures.

## 7. Operational Health and Validation

- [x] 7.1 Add resource health output for browser process counts, dirty workers, stale CDP files, OOM containers, Docker disk usage, and reaper/timer status.
- [x] 7.2 Add JSON output suitable for agents and monitoring.
- [x] 7.3 Add an explicit Docker integration smoke path for bounded worker/browser validation; repeated stress execution remains operator-run through the same safe script rather than normal unit tests.
- [x] 7.4 Add rollout playbook for enabling automatic reap timers after manual dry-run validation.

## 8. Documentation and Rollout

- [x] 8.1 Document default resource limits, override knobs, and the limited-worker validation command.
- [x] 8.2 Document safe cleanup flow: inspect, browser-pool reap, compute reap dry-run, compute reap apply, optional worktree cleanup.
- [x] 8.3 Document Ralph prompt guidance: agents should use assigned workers, but lifecycle is enforced by Pibo policy.
- [x] 8.4 Update PRD traceability after implementation decisions settle.
