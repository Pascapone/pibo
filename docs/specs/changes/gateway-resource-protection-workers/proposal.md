# Proposal: Gateway Resource Protection and Isolated Runtime Workers

**Status:** Draft
**Created:** 2026-07-04
**Requester / Source:** Production reliability incident and recurring gateway starvation from heavy runtime/maintenance work
**Related docs:**

- `docs/specs/capabilities/local-gateway-protocol-and-lifecycle.md`
- `docs/specs/capabilities/pibo-session-routing.md`
- `docs/specs/capabilities/yielded-run-control.md`
- `docs/specs/capabilities/docker-compute-workers.md`
- `docs/specs/changes/chat-web-trace-v2-fast-path/`
- `docs/specs/changes/telemetry-opt-in-archive-isolation/`

## Why

Pibo's Web UI and gateway must remain reachable even while agents, tools, browser automation, file processing, telemetry capture, retention, indexing, build commands, or data transformations run in the background. Today, heavy work can share the gateway process, its child-process tree, or its resource pool. When a background task consumes CPU, RAM, disk I/O, SQLite locks, or the Node event loop, users see a stuck Web UI and have no clear progress, cancellation, or recovery path.

The production incident exposed this through telemetry retention, but the problem is broader. Agent runtimes can launch subprocesses, run computations, transform large files, start browsers, install packages, scan repositories, and write large artifacts. Maintenance jobs can do large SQLite deletes or compactions. Any of these can starve the gateway unless Pibo separates critical serving work from heavy execution work.

## What Changes

Pibo will adopt a resource-protected architecture:

1. The gateway is a small, protected service responsible for Web UI, auth, APIs, status, job orchestration, and lightweight operational reads/writes.
2. Heavy work runs outside the gateway process in resource-limited worker groups.
3. Every long operation becomes a job with status, progress, heartbeat, logs, and cancellation.
4. Platform-specific resource controllers enforce CPU, memory, task, and I/O limits where available.
5. The gateway receives reserved or preferred resources and must remain responsive when worker pools are busy.
6. Install/bootstrap flows configure sane defaults per platform and expose diagnostics for operators.

The goal is not only to prevent crashes. The goal is to preserve user trust: the Web UI should keep responding, show what is running, and let the user cancel or inspect work.

## Prioritization Note

Full worker isolation is the right long-term direction, but the next release must first add gateway survival guardrails. A later local OOM happened after several hours with published `1.6.0`, reaching the V8 heap limit near 4 GB. The strongest immediate suspects are unbounded trace/cache/replay paths and large operational event payloads, not only telemetry retention.

Therefore the first implementation slice should be:

1. Trace V2 fast path for compact timeline rows and lazy payloads;
2. bounded trace/replay/cache behavior;
3. bounded reliability event payloads;
4. always-on gateway memory/resource diagnostics;
5. emergency degradation before fatal heap pressure;
6. only then full worker/process isolation.

## Capabilities

### New Capabilities

- `gateway-resource-protection`: reserves/preferentially protects gateway CPU, memory, I/O, and process limits.
- `runtime-worker-pools`: runs agent sessions, tools, browser automation, maintenance, and telemetry work in separate constrained workers.
- `cross-platform-resource-controller`: abstracts Linux systemd/cgroups, Docker limits, Windows Job Objects, and weaker fallback mechanisms.
- `job-orchestration-and-progress`: represents long operations as jobs with status, progress, heartbeat, logs, and cancellation.
- `worker-resource-policies`: defines named resource profiles such as gateway, agent-standard, agent-heavy, maintenance-low, browser, telemetry-debug.

### Modified Capabilities

- `pibo-session-routing`: session execution moves out of the gateway process or uses a remote/local worker boundary.
- `yielded-run-control`: yielded runs get resource policy, worker identity, heartbeat, and cancellation metadata.
- `docker-compute-workers`: becomes one possible isolation backend, not the only strategy.
- `local-gateway-protocol-and-lifecycle`: gains health, overload, resource, and worker status contracts.
- `data-maintenance-cli`: long maintenance jobs run in maintenance workers or CLI processes, never synchronously in gateway requests.

## Impact

### Product Impact

- Chat Web remains reachable during heavy work.
- Users see queued/running/failed/cancelled jobs instead of indefinite spinners.
- Operators can diagnose which worker or job consumes resources.
- Resource pressure slows or rejects background work before it starves the gateway.

### Code Impact

- Introduce a worker supervisor abstraction.
- Move heavy execution paths behind worker/job APIs.
- Add resource policy definitions and platform adapters.
- Add job store and progress/event reporting for long tasks.
- Audit gateway code for direct heavy work and child-process spawning.
- Update install/bootstrap scripts and service definitions.

### Operations Impact

- Linux installs can use systemd/cgroups v2 directly.
- Docker can be used for stronger worker isolation where available.
- Windows native installs require a Windows Job Object based supervisor for robust limits; weaker priority/affinity fallback is acceptable only as an interim mode.
- Operators need commands to inspect gateway and worker resource state.

## Non-Goals

- This proposal does not require Kubernetes.
- This proposal does not require Docker for all installations.
- This proposal does not replace all storage with a server database.
- This proposal does not solve every SQLite lock issue by itself; long DB work must still be batch-oriented.
- This proposal does not remove local Pibo operation on Windows.

## Success Definition

The change succeeds when a heavy agent/tool/maintenance workload can run, stall, or hit its resource limit while the gateway continues to answer `/health`, serve Chat Web, show job progress, and accept cancellation/status requests.
