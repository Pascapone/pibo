# Compute Browser Resource Lifecycle Rollout Checklist

**Status:** Draft
**Change:** `docs/specs/changes/compute-browser-resource-lifecycle/`

Use this checklist before enabling automatic browser-pool or compute-worker cleanup timers. Prefer read-only diagnostics and dry-run plans first. Do not delete Git worktrees as part of container/browser cleanup unless a separate explicit worktree cleanup command or approval is used.

## Preflight

- [ ] Confirm the target host has current specs and capability docs linked from `docs/specs/changes/compute-browser-resource-lifecycle/`.
- [ ] Record a read-only baseline: `docker system df`, all Pibo containers, stopped/OOM containers, browser process counts, RAM/swap class, and affected worker names.
- [ ] Confirm host production and dev gateways will not be restarted by the rollout. Use Docker workers for validation.

## Dry-run diagnostics

- [ ] Run the read-only aggregate resource health command in text and JSON mode: `pibo compute health` and `pibo compute health --json`.
- [ ] Confirm health output reports browser main-process counts, active browser leases, stale CDP files, dirty workers, OOM-killed containers, Docker disk pressure, and reaper/timer status without changing resources.
- [ ] Run browser-pool health/status commands in text and JSON mode when available: `pibo tools browser-use pool status` and `pibo tools browser-use pool status --json`.
- [ ] Run all-state compute listing, including stopped, OOM-killed, dirty, running, and restarting Pibo containers.
- [ ] Run compute reap in dry-run/preview mode for one-time, dev, stopped, dirty, and max-age candidates.
- [ ] Run Docker hygiene diagnostics for image size, container writable size, BuildKit cache, volumes, and reclaimable bytes.
- [ ] Verify cleanup plans distinguish browser cleanup, container cleanup, build-cache pruning, image pruning, and worktree cleanup.

## Tests before enablement

- [ ] Resource health fixture tests cover healthy state, browser leak warning, dirty worker, OOM container, Docker disk pressure, and missing reaper/timer state.
- [ ] Docker command construction tests cover one-time and dev worker memory, memory-swap, PID, shm, init, restart, and log options.
- [ ] Browser cleanup tests cover stale `/usr/bin/chromium`, `google-chrome`, pid/process-group cleanup, profile-path fallback matching, and non-Pibo profile safety.
- [ ] Repeated browser-use stress validation runs in a real Docker worker and confirms Chromium main-process count remains bounded.
- [ ] Authenticated browser-use lease tests confirm auth-slot release coordinates with browser-pool release and never deletes the template profile.
- [ ] All-state compute list/reap verification covers stopped, OOM, dirty, old, one-time, and dev workers; reap output preserves worktrees.
- [ ] Ralph completion cleanup verification covers promise-complete, max-iteration, stop, cancel, and interrupted-run paths.

## Real Docker worker validation

- [ ] Start or use a disposable Docker compute worker with default resource limits.
- [ ] Confirm Chat Web starts and remains reachable under the default memory/PID/shm policy.
- [ ] Run `pibo compute health --json` before browser checks and record severity, browser process counts, active leases, stale CDP files, Docker disk pressure, and timer status.
- [ ] Run browser-use or the closest browser automation wrapper path repeatedly with `DISPLAY` set and record browser process counts before and after.
- [ ] Run `pibo compute health --json` after repeated browser checks and confirm managed browser main-process counts remain bounded or warnings point to `pibo tools browser-use pool reap --json` / `pibo compute reap --dry-run --json`.
- [ ] Confirm a stale browser-pool reap removes only Pibo-managed processes and leaves unrelated host/browser profiles untouched.
- [ ] Confirm `pibo compute list --all --json` or equivalent shows resource policy, status, OOM flag, controller, worktree, age, and cleanup eligibility.
- [ ] Confirm stopped/OOM container visibility with fixture tests or an operator-approved disposable worker; do not create OOM conditions on the shared host.
- [ ] Confirm Ralph terminal cleanup by inspecting `pibo ralph list --json` and `pibo ralph runs --json` for released/dirty resource metadata after promise-complete, max-iteration, stop, cancel, and interrupted-run scenarios.

## Enablement sequence

1. Land read-only aggregate health: `pibo compute health --json`.
2. Land browser-pool status/reap dry-run-safe inspection and validate `pibo tools browser-use pool reap --json` manually against an idle managed pool.
3. Land compute all-state list/reap dry-run and validate `pibo compute reap --dry-run --json` for one-time, dev, stopped, dirty, and max-age selectors.
4. Land Docker run limits and labels.
5. Land managed browser-pool acquire/release/reap in a Docker worker.
6. Land Ralph resource stewardship metadata and cleanup recording.
7. Run one manual apply on an operator-approved disposable browser pool or worker before enabling any timer.
8. Enable automatic browser idle reaping only after manual validation passes.
9. Enable broader compute reaping timers only after real Docker worker validation and operator approval.

## Optional automatic timer policy

Recommended starting cadence after dry-run validation:

- Browser-pool cleanup: every 5 minutes, using idle-pool selectors only. Equivalent manual command: `pibo tools browser-use pool reap --json` for each known worker/pool.
- Compute worker cleanup: every 15 minutes in dry-run/report mode for the first rollout window. Equivalent manual command: `pibo compute reap --dry-run --json --max-age-minutes 60`.
- Compute worker apply: no more often than every 30 minutes, one-time workers only by default. Include dev workers only with an explicit operator-approved selector such as `--include-dev`.
- Docker disk hygiene: report daily with `pibo compute diagnostics --json`; run `docker builder prune` or `docker image prune` manually after reviewing reclaimable bytes.

Timer selectors should preserve Git worktrees, skip active runs/leases, and prefer dirty/OOM/stopped resources over age-only cleanup.

## Rollback

- Disable automatic reaper timers first; manual commands must remain available: `pibo compute health --json`, `pibo tools browser-use pool status --json`, `pibo tools browser-use pool reap --json`, and `pibo compute reap --dry-run --json`.
- Re-run `pibo compute health --json` after disabling timers and record that timer status is missing/disabled while manual diagnostics still work.
- Disable managed browser-pool mode through the documented environment/configuration knob if CDP reuse breaks automation.
- Keep Docker memory/PID/shm/log limits active during browser-pool rollback unless the limit itself is the proven cause.
- Preserve dev-worker worktrees for debugging unless the operator explicitly approves worktree cleanup.

## Evidence to retain

For each rollout stage, record:

- command run;
- whether evidence is real Docker, browser, manual, source-inspected, or mocked;
- observed result;
- resource counts before and after;
- limitations or skipped checks;
- rollback decision if a check fails.
