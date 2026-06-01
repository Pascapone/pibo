# Spec: Docker Compute Workers

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-17  
**Owner / Source:** Current Pibo codebase; Scheduled Pibo Source Specs Coverage; 2026-05-17 compute/browser resource incident analysis  
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, `docs/specs/README.md`, `docs/specs/capabilities/web-auth-and-same-origin-host.md`, `docs/specs/changes/compute-browser-resource-lifecycle/spec.md`

## Why

Pibo development and browser testing need an isolated runtime that can run gateways, Chat Web, browser automation, and end-to-end checks without mutating or restarting the host production gateway. Docker compute workers provide that boundary.

The compute system is an operator-facing capability. It builds the Pibo image from the current workspace, starts short-lived worker containers, creates development worktrees when requested, exposes gateway and browser ports, and supports cleanup through the Pibo CLI.

## Goal

Pibo MUST let operators create, inspect, connect to, and release Docker compute workers while keeping development gateways, dev auth, browser automation, and worktree state isolated from the host checkout and host gateway.

## Background / Current State

The current implementation is centered on `src/compute/cli.ts`, `src/compute/docker.ts`, `Dockerfile`, `scripts/docker-entrypoint.sh`, and web-gateway dev-auth selection in `src/gateway/web.ts` and `src/plugins/dev-auth.ts`.

`pibo compute spawn` creates a one-time worker container from image `pibo:latest` and starts `gateway:web` through the Docker entrypoint. `pibo compute dev spawn --worktree <name>` creates `.worktrees/<name>`, starts a long-running container mounted on that worktree, and prints stable port assignments. The image includes Node, Python, Chromium, Xvfb, Browser Use, and the built Pibo CLI.

## Scope

### In Scope

- `pibo compute` CLI discovery and worker lifecycle commands.
- Docker image build, rebuild, and hash-based rebuild checks.
- One-time worker spawn with dynamic Docker-assigned ports.
- Development worker spawn with Git worktree creation and deterministic port blocks.
- Container labels for role, created time, owner, port block, and worktree metadata.
- Worker release and old one-time-worker reaping.
- Docker entrypoint behavior for gateway, web gateway, shell, and CLI commands.
- Worker-only dev auth and browser automation prerequisites.

### Out of Scope

- Host gateway lifecycle management — host gateways are managed by `pibo gateway ...` commands.
- Production deployment flow after worker validation.
- Distributed worker scheduling across machines.
- Automatic removal of Git worktrees after container release.
- Rich UI management for compute workers.

## Requirements

### Requirement: Compute CLI is discoverable and scoped

The `pibo compute` CLI MUST expose worker lifecycle actions without requiring operators to call Docker directly.

#### Current

`runComputeCli()` registers `spawn`, `dev spawn`, `rebuild`, `list`, `release`, and `reap` commands through Commander.

#### Acceptance

- `pibo compute --help` lists the immediate compute commands and next-step examples.
- `pibo compute spawn --help` explains that the command creates a worker and prints JSON with ports.
- `pibo compute dev --help` points to `pibo compute dev spawn --help`.
- `pibo compute dev spawn --worktree <name>` requires a worktree name.
- Unknown compute commands fail through the CLI help/error path rather than silently doing nothing.

#### Scenario: Discover development worker command

- GIVEN an operator does not know the dev-worker syntax
- WHEN the operator runs `pibo compute dev --help`
- THEN the output points to `pibo compute dev spawn --help`.

### Requirement: Image builds are cached by source or dependency hashes

The compute system MUST rebuild `pibo:latest` only when the selected command's rebuild predicate says the image is missing or stale.

#### Current

One-time `spawn` checks `imageExists()` and `shouldRebuild()` using a source hash stored at `~/.pibo/compute-image-hash`. Dev `spawn` checks `shouldRebuildDeps()` using package and Dockerfile hashes stored at `~/.pibo/compute-dep-hash`. `rebuild` always builds and saves both hashes.

#### Acceptance

- Missing image `pibo:latest` triggers a build before spawn.
- One-time spawn rebuilds when TypeScript/TSX source, package files, or Dockerfile hashes differ from the saved source hash.
- Dev spawn rebuilds when `package.json`, `package-lock.json`, or `Dockerfile` hashes differ from the saved dependency hash.
- `pibo compute rebuild` forces a Docker build and refreshes both hash files.
- Hash files are stored under `~/.pibo/` and their parent directory is created when needed.

#### Scenario: Dependency change before dev spawn

- GIVEN `package-lock.json` changed since the last dev-worker build
- WHEN an operator runs `pibo compute dev spawn --worktree fix-a`
- THEN Pibo rebuilds `pibo:latest` before creating the worktree container.

### Requirement: One-time workers start the web gateway with dynamic ports

`pibo compute spawn` MUST create a short-lived worker container that starts the web gateway and returns connection details.

#### Current

`spawnWorker()` runs `docker run -d`, labels the container with role `worker`, exposes container ports `4789`, `56663`, and `4788` on Docker-assigned host ports, starts the image command `gateway:web`, then reads the assigned ports with `docker port`.

#### Acceptance

- The returned JSON includes `id`, `image`, `gatewayHost`, `gatewayPort`, `cdpPort`, `webPort`, and `connect`.
- Container names default to `pibo-worker-<random>` when no name is supplied.
- Custom `--name` and `--owner` values are applied to the container name or labels.
- `gatewayPort` maps container port `4789`.
- `cdpPort` maps container port `56663`.
- `webPort` maps container port `4788`.
- The connect command uses `docker exec -it <id> bash`.

#### Scenario: Spawn isolated worker

- GIVEN Docker is available and the image is current
- WHEN an operator runs `pibo compute spawn --owner alice`
- THEN Pibo starts a worker container, prints JSON with mapped ports, and labels the container with owner `alice`.

### Requirement: Development workers use Git worktrees and deterministic port blocks

`pibo compute dev spawn` MUST isolate code changes in a Git worktree and assign a non-overlapping block of host ports.

#### Current

`spawnDevWorker()` creates `.worktrees/<name>` with `git worktree add`, selects the first unused `pibo.compute.portBlock` among running dev containers, maps ports from base `4800 + block * 10`, mounts the worktree at `/workspace`, and keeps the container alive with `tail -f /dev/null`.

#### Acceptance

- Dev spawn creates or attaches the named Git worktree under `.worktrees/<name>`.
- Dev worker ids use `pibo-dev-<worktree>`.
- The returned JSON includes `worktree`, `gatewayPort`, `cdpPort`, `webPort`, `webUIPortChat`, `webUIPortContext`, and `connect`.
- The container is labeled with role `dev`, created time, port block, worktree name, and optional owner.
- Port blocks do not overlap with currently running dev containers that carry a port-block label.
- Host `node_modules` is mounted into `/workspace/node_modules` when it exists.

#### Scenario: Two dev workers do not collide

- GIVEN a dev worker is already running with port block `0`
- WHEN an operator spawns another dev worker
- THEN the second worker receives the next unused port block and different host ports.

### Requirement: Worker entrypoint prepares browser-capable runtime

Every compute container MUST start with the environment needed for Pibo gateway and browser automation tasks.

#### Current

The Docker image installs Chromium, Chromium Driver, Xvfb, Python, uv, Browser Use, build tools, and fonts. `scripts/docker-entrypoint.sh` starts Xvfb on `DISPLAY=:99`, prepares the Browser Use wrapper when missing, updates `PATH`, sets `BROWSER_USE_HOME`, and dispatches commands.

#### Acceptance

- Container startup ensures Xvfb is running before gateway or CLI commands continue.
- `DISPLAY` is set to `:99`.
- Browser Use binaries are available on `PATH`.
- `BROWSER_USE_HOME` points to the worker's Browser Use home directory.
- `gateway` starts the local gateway on `0.0.0.0:4789`.
- `gateway:web` starts the web gateway with worker dev auth on `0.0.0.0`.
- `shell`, `bash`, and `sh` open a shell instead of starting a gateway.
- Other entrypoint arguments are passed to the built Pibo CLI.

#### Scenario: Browser automation dependency is available

- GIVEN a compute container starts with the default entrypoint
- WHEN a Pibo browser-use tool runs inside the worker
- THEN Chromium and the Browser Use wrapper are available in the container environment.

### Requirement: Dev auth remains worker-only

The compute web gateway MUST use dev auth only inside Docker workers and MUST NOT make dev auth available to normal host gateways.

#### Current

The Docker entrypoint starts `gateway:web` with the internal `{ devAuth: true }` option. `resolveWebGatewayAuthMode()` accepts dev auth only when Docker/container runtime detection succeeds. The dev-auth plugin accepts only loopback auth-route requests.

#### Acceptance

- A compute worker web gateway registers dev auth instead of Better Auth.
- A non-Docker process requesting dev auth fails before server startup.
- Setting `PIBO_DEV_AUTH=1` for a normal host gateway fails closed with an explicit error.
- Dev auth sign-in routes reject non-loopback host or forwarded-host context.
- Successful worker dev auth maps the browser session to the fixed dev user identity.

#### Scenario: Host cannot enable dev auth by accident

- GIVEN Pibo is not running inside Docker
- AND `PIBO_DEV_AUTH=1` is set
- WHEN the host web gateway starts
- THEN startup fails and does not serve a dev-auth gateway.

### Requirement: Worker cleanup is explicit and bounded

The compute CLI MUST let operators inspect, stop, and remove workers explicitly, and MUST remove old workers only when the operator selects the eligible worker class.

#### Current

`releaseWorker()` stops a named container with a 10-second timeout and removes it. `listWorkers()` lists role `worker` and `dev` containers by default. `pibo compute reap` builds a dry-run cleanup plan by default, selects stopped, dirty/OOM, and old one-time workers, and includes dev workers only when `--include-dev` is supplied. Destructive removal requires `--apply`.

#### Acceptance

- `pibo compute release <id>` stops and removes the named container or id.
- Releasing an already stopped container still attempts removal.
- `pibo compute reap --dry-run --max-age-minutes <n>` previews one-time workers selected because they are stopped, dirty/OOM-killed, or older than the requested age.
- The default reap age is 60 minutes.
- `pibo compute reap --apply --max-age-minutes <n>` removes selected containers.
- `pibo compute reap --include-dev` also makes selected dev workers eligible for removal.
- `pibo compute list` shows running one-time and dev workers with name, role, status, ports, and created time, or an empty-state message.
- Releasing or reaping a dev worker container does not remove its Git worktree automatically.

#### Scenario: Preview and reap old one-time worker

- GIVEN a running one-time worker has a created-at label older than 60 minutes
- WHEN an operator runs `pibo compute reap --dry-run`
- THEN Pibo reports that worker as selected with reason `old`
- AND old dev workers are skipped unless `--include-dev` is supplied.
- WHEN the operator runs `pibo compute reap --apply`
- THEN Pibo stops and removes only selected containers
- AND Git worktrees are preserved.

### Requirement: Worker containers enforce resource budgets

Compute workers MUST start with host-safe resource limits and MUST expose those limits in inspectable metadata.

#### Current

Docker run commands apply the default compute resource policy to one-time and dev workers: `memory=2g`, `memory-swap=2g`, `pids-limit=512`, `shm-size=512m`, `--init`, `restart=no`, and bounded Docker JSON logs. The same policy is written to inspectable labels. Worker metadata labels include role, created time, worktree/path when known, port block or dynamic ports, TTL/idle seconds, and Ralph job/run ids when supplied by the spawn caller. Legacy app-space labels, when present, are compatibility metadata only.

#### Target

Every compute worker has a resource policy. Defaults protect small hosts, and operators can override limits for larger hosts through documented settings.

Default policy values are intentionally conservative for small hosts: `memory=2g`, `memory-swap=2g`, `pids-limit=512`, `shm-size=512m`, `--init`, `restart=no`, Docker JSON logs with `max-size=10m`, and `max-file=3`. Larger hosts may override only the sizing fields through environment variables read at spawn time: `PIBO_COMPUTE_MEMORY`, `PIBO_COMPUTE_MEMORY_SWAP`, `PIBO_COMPUTE_PIDS_LIMIT`, `PIBO_COMPUTE_SHM_SIZE`, `PIBO_COMPUTE_INIT`, `PIBO_COMPUTE_LOG_MAX_SIZE`, and `PIBO_COMPUTE_LOG_MAX_FILE`. TTL and idle labels default to 3600 and 1800 seconds and can be overridden with `PIBO_COMPUTE_TTL_SECONDS`, `PIBO_COMPUTE_IDLE_SECONDS`, or the `pibo compute spawn` / `pibo compute dev spawn` options `--ttl-seconds` and `--idle-seconds`. Ralph-owned callers can pass `--ralph-job-id` and `--ralph-run-id` so the worker is traceable. The restart policy remains `no` so OOM or PID-limit failures do not create restart loops.

#### Acceptance

- One-time and dev worker Docker runs include memory, memory-swap, PIDs, shm-size, init, restart, and log options.
- Resource policy values are recorded through labels or equivalent inspectable metadata.
- A worker that is OOM-killed or hits a PID/resource limit is marked visible in compute status output.
- Limits do not apply to host `pibo-web` or `pibo-web-dev` services.

#### Scenario: Browser leak remains contained

- GIVEN a worker starts too many browser processes
- WHEN it reaches the configured PID or memory limit
- THEN the failure is contained to the worker
- AND host Pibo health checks remain available
- AND compute diagnostics identify the constrained worker.

### Requirement: Worker listing and reaping cover stopped and dirty resources

The compute CLI MUST make stopped, OOM-killed, and dirty Pibo worker containers visible before cleanup.

#### Current

Listing covers all-state containers when `--all` is supplied. Reaping is plan-first, defaults to dry-run, selects stopped/dirty/OOM/old one-time workers, and requires explicit `--include-dev` before dev workers can be removed.

#### Target

Operators can inspect all Pibo compute containers and preview cleanup for stopped, dirty, old, one-time, and dev worker classes.

#### Acceptance

- `pibo compute list --all` or an equivalent command shows running and stopped Pibo compute containers.
- Output includes status, OOM flag when available, role, owner, worktree, Ralph ids, created time, last-used time, and cleanup eligibility.
- Reap supports dry-run/preview output and `--apply` for destructive cleanup.
- Reap selectors cover stopped containers, dirty/OOM workers, age filters, one-time workers, and explicitly included dev workers.
- Reap explains why each worker is selected or skipped.
- Reap never deletes Git worktrees unless an explicit worktree cleanup option or command is used.

#### Scenario: Stopped OOM worker remains inspectable

- GIVEN a dev worker exited after host pressure
- WHEN an operator lists all compute workers
- THEN the stopped container appears with its worktree, owner, OOM/exit status, and next cleanup command.

### Requirement: Docker build context and cache stay bounded

The compute build workflow MUST avoid copying local worktrees, browser profiles, logs, screenshots, and Pibo local state into images and MUST expose Docker disk pressure diagnostics.

#### Current

The Docker build context excludes generated dependencies and now explicitly excludes local worktrees, Pibo state, browser-use/profile state, logs, screenshots, and browser/debug artifacts. BuildKit cache and old image layers are visible through read-only compute diagnostics.

#### Target

Build context excludes local state, and Pibo exposes image/container/cache usage and safe cleanup suggestions.

#### Acceptance

- `.dockerignore` excludes `.worktrees`, browser-use local profiles, screenshots, logs, and Pibo local state that should not enter images.
- `pibo compute diagnostics` (alias `pibo compute disk`) is read-only and reports Docker image size, container size, build-cache size, volume size, and reclaimable bytes.
- `pibo compute diagnostics --json` exposes stable rows, byte counts, totals, Docker availability, and cleanup suggestions for agents.
- Cleanup suggestions distinguish container cleanup, image cleanup, build-cache prune, and worktree cleanup.

#### Scenario: Build cache exceeds budget

- GIVEN Docker build cache exceeds the configured or documented budget
- WHEN an operator runs compute resource diagnostics
- THEN Pibo reports the cache size and a safe prune command.

### Requirement: Aggregate resource health is read-only and actionable

Operators and agents MUST have one Pibo-native health command that summarizes browser, worker, Docker disk, and reaper/timer risk without cleaning anything.

#### Current

`pibo compute health` (alias `pibo compute doctor`) is read-only. Text output summarizes severity, browser process counts, active browser leases, stale CDP files, dirty/OOM workers, Docker disk pressure, and reaper/timer status. `--json` exposes stable fields for agents and monitoring.

#### Acceptance

- `pibo compute health` performs no browser reap, Docker removal, image prune, build-cache prune, gateway restart, or worktree deletion.
- JSON output includes `readOnly`, `severity`, `checks`, `browserProcesses`, `browserLeases`, `computeWorkers`, `dockerDisk`, `reaperTimers`, and `nextCommands`.
- Browser health includes total Chromium process count, total Chromium main-process count, per-pool/worker managed counts, active browser-pool leases, and stale CDP pid/port files.
- Worker health includes dirty workers, OOM-killed containers, cleanup-eligible workers, and Docker availability.
- Docker health includes disk totals, reclaimable bytes, BuildKit cache bytes, and disk-pressure warnings.
- Text output gives concrete next commands such as `pibo tools browser-use pool reap --json`, `pibo compute reap --dry-run --json`, and `pibo compute diagnostics --json`.

#### Scenario: Browser leak warning

- GIVEN a worker has more Chromium main processes than its managed browser-pool limit
- WHEN an operator runs `pibo compute health --json`
- THEN health severity is at least `warning`
- AND the `browser-leak` check points to browser-pool status/reap and compute reap dry-run commands.

## Resource lifecycle obligations

This capability participates in the compute/browser resource lifecycle change. It must follow the canonical model in `docs/project/compute-browser-resource-operating-model.md` and the rollout checks in `docs/project/compute-browser-resource-rollout-checklist.md`.

- Compute workers must enforce memory, memory-swap, PID, shm, init, restart, and log budgets by default.
- Worker labels/status must expose resource policy, worktree, Ralph job/run ids when present, last-used time, dirty state, and cleanup eligibility. Legacy app-space labels may be shown only as compatibility metadata.
- `pibo compute list --all` and reap dry-run behavior must include running, stopped, OOM-killed, dirty, one-time, and dev workers.
- Docker hygiene diagnostics must distinguish image reuse from container writable state, BuildKit cache, volumes, logs, browser state, screenshots, and worktrees.
- `pibo compute health` must stay read-only and report browser leaks, active leases, stale CDP files, dirty/OOM workers, Docker disk pressure, and reaper/timer status with safe next commands.
- Container/browser cleanup must not delete Git worktrees unless a separate explicit worktree cleanup command or flag is selected.

## Edge Cases

- Existing Git branches or worktrees can make `git worktree add -b <name>` fail; the current code retries by adding the existing branch name.
- Docker port parsing can return `0` if Docker returns no parseable host port; callers should treat that as unusable connection data.
- `pibo compute list` includes dev containers by default, but `pibo compute reap` excludes dev containers unless `--include-dev` is supplied.
- `pibo compute reap` is dry-run by default; `--apply` is required to remove containers.
- `release` and `reap --apply` remove containers but intentionally do not delete worktree directories.

## Constraints

- **Isolation:** Pibo development and browser checks should run in compute workers, not against the host production gateway.
- **Security / Auth:** Dev auth is Docker-only and loopback-restricted.
- **Compatibility:** The Docker image name is currently `pibo:latest`; changing it requires updating CLI and Docker operations together.
- **Dependencies:** Docker, Git, Node, and network access for image build/package installation are required for full operation.
- **Performance:** Dev-worker spawning avoids full source-hash rebuilds and only rebuilds on dependency/Dockerfile changes.

## Success Criteria

- [ ] SC-001: `pibo compute spawn` returns usable JSON with gateway, web, CDP, and connect fields.
- [ ] SC-002: `pibo compute dev spawn --worktree <name>` creates a worktree, starts a dev container, and returns deterministic non-overlapping ports.
- [ ] SC-003: Worker `gateway:web` exposes Chat Web with Docker-only dev auth and rejects host dev-auth activation.
- [ ] SC-004: `pibo compute release <id>` removes the target container without deleting source worktrees.
- [ ] SC-005: `pibo compute reap --dry-run` previews old/stopped/dirty one-time worker cleanup, `--apply` removes selected containers, dev workers are skipped by default, and old dev workers are included only with `--include-dev`.
- [ ] SC-006: A built-CLI discovery test verifies `pibo compute --help` and `pibo compute dev --help` expose only immediate next-step commands without starting Docker.
- [ ] SC-007: Worker Docker run command tests verify resource limits and labels for one-time and dev workers.
- [ ] SC-008: `pibo compute list --all` and reap dry-run tests cover stopped/OOM containers, dirty workers, and worktree-preserving cleanup.
- [x] SC-009: Docker hygiene diagnostics report image, container, build-cache, volume, and reclaimable byte counts.
- [x] SC-010: Resource health tests cover healthy state, browser leak warning, dirty worker, OOM container, Docker disk pressure, and missing reaper/timer state.

## Verification Coverage

### Directly Tested

- Dev-auth host safety is covered outside the compute command path by `test/web-gateway.test.mjs` and `test/dev-auth.test.mjs`; these tests verify the host cannot enable dev auth through `PIBO_DEV_AUTH=1` and dev-auth routes require loopback host context.

### Source-Inspected Only

- Compute CLI discovery, command registration, help text, required `--worktree`, and JSON printing are source-inspected from `src/compute/cli.ts`.
- Image rebuild predicates, source/dependency hash files, Docker build invocation, one-time worker spawn, dev worker spawn, deterministic port blocks, worktree creation, list/release/reap behavior, dry-run/apply planning, and `--include-dev` cleanup selection are source-inspected from `src/compute/docker.ts`.
- Worker entrypoint browser setup and dev-auth gateway dispatch are source-inspected from `scripts/docker-entrypoint.sh`.
- Docker image dependencies and port exposure are source-inspected from `Dockerfile`.

### Test Matrix

| Test target | Required cases | Primary requirements | Suggested file |
|---|---|---|---|
| CLI discovery | `pibo compute --help` lists `spawn`, `dev`, `rebuild`, `list`, `release`, and `reap`; output points to `pibo compute spawn --help` and `pibo compute dev --help`; `pibo compute dev --help` points only to `pibo compute dev spawn --help`. | REQ-001 | `test/compute-cli.test.mjs` |
| CLI validation without Docker | `pibo compute dev spawn` without `--worktree` fails through Commander before Docker or Git commands run; unknown compute subcommands fail with help/error output. | REQ-001, REQ-004 | `test/compute-cli.test.mjs` |
| Hash predicates | Dependency hash changes for `package.json`, `package-lock.json`, or `Dockerfile`; source hash includes TypeScript/TSX and package/Dockerfile inputs while skipping generated or local-state directories. | REQ-002 | unit test with temporary workspace |
| Docker command construction | Mock `docker` and `git` commands to verify one-time worker labels, dynamic exposed ports, dev worker labels, deterministic port mapping, optional owner labels, and node_modules mount behavior. | REQ-003, REQ-004 | command-stub unit test |
| Cleanup selection | `listWorkers()` includes worker and dev roles by default; `reapWorkers()` removes only role `worker` by default and includes old dev workers only with `includeDev: true`; release never removes worktree directories. | REQ-007 | command-stub unit test |

### Verification Gaps

- Add built-CLI discovery tests before changing compute help text so the progressive discovery rule remains enforced.
- Add Docker-command stub tests before changing worker labels, port mappings, or cleanup defaults; these tests should not require a real Docker daemon.
- Keep real Docker spawn validation as an explicit integration check outside normal unit tests because it requires host Docker privileges and can create containers. The checked-in smoke script defaults to a dry run and skips clearly when Docker is unavailable or worker creation is not requested:

  ```bash
  npm run compute:limited-worker-smoke -- --dry-run
  npm run compute:limited-worker-smoke -- --apply --json
  ```

  The apply path creates a temporary one-time worker with the default resource policy, verifies shell access, runs a bounded Chromium smoke command when browser dependencies are present, records Docker inspect values for memory, swap, PID, shm, restart, log, TTL/idle, owner, and resource-policy labels, confirms the worker appears in `pibo compute list --all --json`, and releases the worker in a `finally` cleanup path. Operators who need each primitive command can run the equivalent manual sequence:

  ```bash
  worker="pibo-worker-policy-smoke-$(date +%s)"
  npm run dev -- compute spawn --name "$worker" --owner user:smoke --ttl-seconds 600 --idle-seconds 300
  docker inspect "$worker" --format '{{json .HostConfig.Memory}} {{json .HostConfig.MemorySwap}} {{json .HostConfig.PidsLimit}} {{json .HostConfig.ShmSize}} {{json .HostConfig.RestartPolicy}} {{json .HostConfig.LogConfig}} {{json .Config.Labels}}'
  docker exec "$worker" bash -lc 'node --version && test -x /usr/bin/chromium && /usr/bin/chromium --version'
  docker exec "$worker" bash -lc "export DISPLAY=:99; timeout 20s /usr/bin/chromium --headless --no-sandbox --disable-gpu --dump-dom 'data:text/html,<p>pibo-smoke</p>' | grep pibo-smoke"
  npm run dev -- compute list --all --json
  npm run dev -- compute release "$worker"
  ```

## Assumptions and Open Questions

### Assumptions

- Operators have permission to run Docker and create Git worktrees in the repository.
- One-time workers and dev workers intentionally have different lifecycle shapes.
- Dev worker worktree cleanup is a separate human or future workflow decision.

### Open Questions

- Should `pibo compute list` eventually support `--one-time-only` or `--include-dev` flags for symmetric filtering with `reap`?
- Should release optionally delete the associated worktree after confirmation?
- Should one-time workers mount the current workspace or remain image-only after build?

## Traceability

| Requirement | Scenario / Story | Code Basis | Verification | Status |
|---|---|---|---|---|
| REQ-001 Compute CLI is discoverable and scoped | Discover development worker command | `src/compute/cli.ts` | Source-inspected; add `test/compute-cli.test.mjs` | Source-inspected |
| REQ-002 Image builds are cached by source or dependency hashes | Dependency change before dev spawn | `src/compute/cli.ts`, `src/compute/docker.ts` | Source-inspected; add hash predicate tests | Source-inspected |
| REQ-003 One-time workers start the web gateway with dynamic ports | Spawn isolated worker | `src/compute/docker.ts`, `Dockerfile` | Source-inspected; real Docker integration check deferred | Source-inspected |
| REQ-004 Development workers use Git worktrees and deterministic port blocks | Two dev workers do not collide | `src/compute/docker.ts` | Source-inspected; add Docker/Git command-stub tests | Source-inspected |
| REQ-005 Worker entrypoint prepares browser-capable runtime | Browser automation dependency is available | `scripts/docker-entrypoint.sh`, `Dockerfile` | Source-inspected; real container integration check deferred | Source-inspected |
| REQ-006 Dev auth remains worker-only | Host cannot enable dev auth by accident | `src/gateway/web.ts`, `src/plugins/dev-auth.ts`, `scripts/docker-entrypoint.sh` | `test/web-gateway.test.mjs`, `test/dev-auth.test.mjs`; compute entrypoint source-inspected | Partly tested |
| REQ-007 Worker cleanup is explicit and bounded | Reap old one-time worker | `src/compute/cli.ts`, `src/compute/docker.ts` | Source-inspected; add cleanup selection tests | Source-inspected |
| REQ-008 Worker containers enforce resource budgets | Browser leak remains contained | `src/compute/docker.ts` | Add Docker command construction tests | Draft |
| REQ-009 Worker listing and reaping cover stopped and dirty resources | Stopped OOM worker remains inspectable | `src/compute/cli.ts`, `src/compute/docker.ts` | Add all-state list/reap tests | Draft |
| REQ-010 Docker build context and cache stay bounded | Build cache exceeds budget | `.dockerignore`, `src/compute/cli.ts`, `src/compute/docker.ts` | `test/compute-resource-policy.test.mjs`; real read-only `pibo compute diagnostics --json` validation | Implemented |
