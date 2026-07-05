# Spec: Gateway Resource Protection and Isolated Runtime Workers

**Status:** Draft; Phase 0 gateway survival guardrails shipped in v1.7.0
**Created:** 2026-07-04
**Updated:** 2026-07-05
**Requester / Source:** Production reliability incident and gateway starvation from heavy background work
**Related docs:**

- `proposal.md`
- `design.md`
- `tasks.md`
- `docs/specs/changes/chat-web-trace-v2-fast-path/`
- `docs/specs/changes/telemetry-opt-in-archive-isolation/`
- `docs/specs/capabilities/docker-compute-workers.md`
- `docs/specs/capabilities/yielded-run-control.md`

## Why

Pibo serves humans through a Web UI. If the gateway stalls, the user sees loading indicators and loses control, even if the machine is still doing background work. The gateway must remain reachable during heavy agent/runtime/tool/maintenance workloads.

The system needs a durable separation between critical serving work and untrusted or expensive execution work. Resource limits must apply to the whole process tree of each worker, not just the parent process. Long work must report progress and be cancellable.

## Goal

Pibo MUST protect the gateway/Web UI from resource starvation by running heavy work outside the gateway in resource-limited worker groups with explicit jobs, progress, heartbeat, and cancellation.

## Background / Current State

Pibo can run agents, tools, shell commands, browser automation, maintenance tasks, and telemetry operations. These tasks may consume CPU, memory, disk I/O, process slots, and SQLite locks. Some work can currently run in the gateway process or be triggered by gateway requests as long synchronous operations.

Linux provides systemd/cgroups and Docker to isolate workloads. Windows provides process priority, CPU affinity, and Job Objects; Docker Desktop or WSL can also provide isolation. Pibo needs a platform-aware model that works everywhere but uses strong controls where available.

## Scope

### In Scope

- Define gateway as a protected critical service.
- Define heavy-work categories that must not run in the gateway.
- Define job model for long operations.
- Define worker pools and resource policies.
- Define platform resource-controller behavior for Linux, Docker, and Windows.
- Define install/bootstrap defaults.
- Define gateway health and overload behavior.
- Define diagnostics and operator commands.
- Define migration plan from in-process work to worker execution.

### Out of Scope

- Requiring Docker for every installation — systemd/cgroups and Windows Job Objects must be supported.
- Full Kubernetes orchestration — unnecessary for local/hosted Pibo.
- Complete database engine replacement — DB lock minimization is required, but SQLite may remain.
- Removing local native Windows support.
- Implementing telemetry archive isolation — covered by the telemetry spec, though this spec supplies worker execution for telemetry maintenance.
- Designing the default Chat Web trace transport — covered by `chat-web-trace-v2-fast-path`, though this spec supplies worker execution for trace projection rebuild/backfill.

## Definitions

### Gateway

The critical Pibo service that handles:

- HTTP/WebSocket/SSE serving;
- Chat Web assets and APIs;
- auth/session identity;
- lightweight status and metadata reads;
- job creation and cancellation requests;
- event/status projection;
- health checks.

### Heavy Work

Any operation that may run longer than a short request budget or consume significant CPU, memory, I/O, processes, DB locks, or external resources.

Examples:

- agent runtime execution;
- model/tool loop execution;
- shell commands;
- package install/build/test commands;
- browser automation;
- PTY sessions;
- file indexing and transformations;
- image/PDF/media processing;
- telemetry capture inspection;
- retention/prune/backup/vacuum;
- large SQLite reads/writes;
- archive export/import;
- repository scans.

### Worker

A separate process, service, container, or supervised process group that runs heavy work outside the gateway.

### Resource Policy

A named set of limits/preferences for CPU, memory, I/O, task count, process priority, runtime duration, and child-process containment.

### Job

A durable representation of long work with ID, owner, type, status, progress, heartbeat, resource policy, worker identity, logs, and cancellation state.

## Requirements

### Requirement: Gateway remains responsive under worker load

The system MUST keep the gateway reachable while resource-limited workers perform heavy work.

#### Current

Heavy work can block the gateway or consume shared resources until health checks and UI requests time out.

#### Target

The gateway has protected resources and does not execute heavy work inline. Worker overload degrades worker throughput, not gateway availability.

#### Acceptance

- During a CPU-heavy worker job, `/health` responds within the configured health budget.
- During a memory-heavy worker job, the worker is throttled or killed before the gateway loses reserved/protected memory.
- During a maintenance job, Chat Web can still load Settings and job status.

#### Scenario: CPU-bound agent job

- GIVEN a CPU-bound agent job is running
- WHEN the user opens Chat Web
- THEN the gateway serves the page and job status
- AND the job remains isolated in its worker resource group.

### Requirement: Gateway exposes resource pressure before failure

The gateway MUST expose bounded resource-pressure diagnostics that can be read while the system is degraded.

#### v1.7.0 Status

Implemented for the Chat Web gateway hot path: diagnostics expose process memory, event-loop delay, stream/listener counts, trace cache bytes, transient replay buffer bytes, reliability payload buckets, externalized payload count, and recent warnings. Worker/job diagnostics remain pending.

#### Target

Diagnostics include:

- process heap/RSS/external memory;
- event-loop delay;
- active request/SSE/listener counts;
- trace cache count and estimated bytes;
- replay buffer count and estimated bytes;
- job/worker counts;
- large payload write counters;
- DB/WAL file sizes;
- recent threshold warnings.

#### Acceptance

- `pibo resources status` or `pibo gateway web status --resources` reports current gateway memory and pressure state.
- `/health` remains lightweight, while a separate diagnostics endpoint returns bounded details.
- Diagnostics do not parse large event payloads or scan large tables.
- A rolling crash context survives process restart.

#### Scenario: Approaching heap limit

- GIVEN gateway heap exceeds a warning threshold
- WHEN an operator checks resources
- THEN Pibo reports which hot-path structures are largest
- AND emits actionable warnings before OOM.

### Requirement: Gateway has emergency degradation under memory pressure

The gateway MUST prefer degraded behavior over crashing when memory pressure crosses configured thresholds.

#### v1.7.0 Status

Partially implemented: trace timeline cache and transient replay buffers have byte/count budgets and eviction, V1 trace over-budget responses fail safely, and large reliability payloads are externalized. Full heap-threshold degraded mode and crash-context files remain follow-up work.

#### Target

Possible degradation actions include:

- evict trace cache entries by estimated bytes;
- stop serving unbounded trace/history pages;
- shrink replay windows;
- reject archive/debug queries with `503` plus retry guidance;
- disable large payload previews;
- refuse new heavy jobs while preserving health/status APIs.

#### Acceptance

- Under synthetic heap pressure, gateway evicts non-critical caches before reaching fatal heap limit.
- Health/status endpoints remain available in degraded mode.
- Users see a clear overload/degraded message instead of indefinite loading.

#### Scenario: Trace cache pressure

- GIVEN trace cache memory exceeds its budget
- WHEN another trace is requested
- THEN older/larger cache entries are evicted
- AND the gateway returns a bounded response or a clear overload response.

### Requirement: Gateway does not run heavy work inline

The gateway MUST NOT run heavy work directly in its event loop, request handlers, or child-process group.

#### Target

Request handlers create jobs or dispatch work to workers. They return bounded responses such as `202 Accepted` with a job id.

#### Acceptance

- No route performs a long retention/prune/export/build/tool execution synchronously.
- Code audit identifies and removes direct heavy work from gateway handlers.
- Tests assert selected heavy endpoints return quickly and create jobs.

#### Scenario: Maintenance request

- GIVEN a user starts a retention/prune operation from Settings
- WHEN the gateway receives the request
- THEN it creates a maintenance job and returns immediately
- AND the operation runs in a maintenance worker.

### Requirement: Long operations use the job model

The system MUST represent long operations as jobs with progress, heartbeat, logs, and cancellation.

#### Job Fields

A job MUST include at least:

- job id;
- type;
- owner/session/room where applicable;
- status: `queued`, `starting`, `running`, `stopping`, `cancelled`, `failed`, `completed`;
- resource policy;
- worker id;
- startedAt/updatedAt/finishedAt;
- heartbeat timestamp;
- progress fields;
- cancellable flag;
- last error;
- log/event cursor.

#### Acceptance

- Chat Web can show queued/running/completed/failed jobs.
- CLI can list and inspect jobs.
- Stale heartbeats are detected.
- Cancellation changes job state and signals the worker.

#### Scenario: User closes page during job

- GIVEN a long job is running
- WHEN the user closes the browser tab
- THEN the job continues or cancels according to its policy
- AND the user can later reopen Chat Web and see the job state.

### Requirement: Worker resource policies are explicit

The system MUST define named resource policies and assign every heavy job to one.

#### Initial Policies

The first implementation SHOULD define:

- `gateway-critical`;
- `agent-standard`;
- `agent-heavy`;
- `maintenance-low`;
- `browser-medium`;
- `telemetry-debug`;
- `untrusted-tool-low`.

#### Acceptance

- Every worker process has a policy visible in diagnostics.
- Jobs cannot start without a valid policy.
- Policies have platform-specific implementations or documented fallbacks.

#### Scenario: Agent job starts with policy

- GIVEN an agent session starts
- WHEN the worker is created
- THEN diagnostics show the worker uses `agent-standard` or another configured policy.

### Requirement: Worker child processes stay inside worker limits

The system MUST ensure subprocesses spawned by a worker remain inside that worker's resource group where platform support exists.

#### Acceptance

- On Linux systemd/cgroups, worker children remain in the worker cgroup.
- In Docker, worker children remain inside the container limits.
- On Windows strong mode, worker children remain inside the Job Object.
- Diagnostics warn when the platform cannot contain children reliably.

#### Scenario: Tool starts child process

- GIVEN a tool starts a child process that consumes CPU
- WHEN resource diagnostics are inspected
- THEN the child is accounted to the worker policy
- AND cannot escape to the gateway resource group.

### Requirement: Linux resource control uses systemd/cgroups by default

On Linux systems with systemd and cgroup v2, Pibo SHOULD use systemd/cgroups as the default resource control backend.

#### Target

Gateway is a protected service. Workers run as systemd transient units or managed services with properties such as:

- `CPUAccounting=yes`;
- `CPUWeight`;
- `CPUQuota`;
- `MemoryAccounting=yes`;
- `MemoryLow`/`MemoryHigh`/`MemoryMax`;
- `IOAccounting=yes`;
- `IOWeight`;
- `TasksMax`.

#### Acceptance

- Installer detects cgroup v2 and systemd support.
- Gateway service gets configured resource protection.
- Worker jobs run in separate cgroups.
- `pibo resources status` reports cgroup paths and limits.

#### Scenario: Linux install configures resources

- GIVEN Pibo installs on Ubuntu with systemd/cgroup v2
- WHEN host service setup runs
- THEN gateway and worker resource policies are installed or recommended
- AND diagnostics show active limits.

### Requirement: Docker is optional isolation backend

Pibo MAY use Docker as a worker isolation backend when available, but Docker MUST NOT be required for all installations.

#### Acceptance

- Linux host can run worker isolation without Docker using systemd.
- Docker backend supports CPU/memory/process limits.
- Operator can choose Docker for stronger filesystem/process isolation.
- Docs describe when to use Docker.

#### Scenario: Docker worker backend

- GIVEN Docker is available and selected
- WHEN an agent worker starts
- THEN it runs inside a container with configured CPU and memory limits.

### Requirement: Native Windows uses a resource-controller fallback hierarchy

On native Windows, Pibo MUST use the best available resource controls and clearly report the protection level.

#### Target Hierarchy

1. Windows Job Objects for worker containment and memory/CPU limits.
2. Process priority and CPU affinity as weaker fallback.
3. Docker Desktop or WSL worker backend as optional stronger isolation.

#### Acceptance

- Native Windows gateway can start without WSL.
- Worker supervisor can assign workers to a Windows Job Object where supported.
- Diagnostics report `strong`, `partial`, or `none` isolation.
- If only priority/affinity is available, UI/CLI warns that memory isolation is partial.

#### Scenario: Native Windows worker starts

- GIVEN Pibo runs natively on Windows
- WHEN a heavy job starts
- THEN Pibo starts it through the Windows worker supervisor
- AND diagnostics show the applied protection level.

### Requirement: Install/bootstrap configures safe defaults

Pibo install or host setup MUST configure resource policies or produce explicit actionable guidance.

#### Acceptance

- Linux service setup writes or validates gateway resource properties.
- Windows setup installs or verifies the worker supervisor if available.
- Docker backend setup validates Docker limits.
- `pibo resources doctor` reports missing protections and remediation commands.

#### Scenario: Resource doctor

- GIVEN Pibo is installed
- WHEN an operator runs `pibo resources doctor`
- THEN the command reports gateway protection, worker backend, policy defaults, and warnings.

### Requirement: Backpressure protects the gateway

The system MUST refuse, queue, or delay new heavy jobs when worker resources are exhausted.

#### Acceptance

- Worker pool has concurrency limits.
- Job queue position is visible.
- Starting too many jobs returns queued/overloaded status instead of spawning unlimited processes.
- Gateway remains responsive when queues are full.

#### Scenario: Worker pool full

- GIVEN all agent workers are busy
- WHEN a new agent job is submitted
- THEN it is queued or rejected with a clear overload message
- AND no unlimited extra worker starts.

### Requirement: Resource and job diagnostics are visible

The system MUST expose operator diagnostics for gateway and workers.

#### CLI/API Targets

```bash
pibo resources status
pibo resources doctor
pibo jobs list
pibo jobs inspect <job-id>
pibo workers list
pibo workers inspect <worker-id>
```

Diagnostics SHOULD include:

- gateway PID and policy;
- worker PID/container/unit/job object id;
- CPU/memory/I/O limits;
- current usage where available;
- child-process count;
- job heartbeat;
- cancellation state;
- stale/overloaded warnings.

#### Acceptance

- Operators can identify which worker consumes resources.
- Diagnostics do not require direct systemd/Docker/Windows knowledge for first-level triage.

## Edge Cases

- Worker ignores cancellation.
- Worker spawns grandchildren.
- Worker exceeds memory limit.
- Worker fills disk.
- Worker holds SQLite lock.
- Gateway restarts while workers run.
- Worker supervisor restarts while jobs run.
- Platform lacks strong isolation.
- Docker daemon unavailable.
- Windows Job Object setup fails.
- Multiple users start heavy jobs concurrently.
- Host has fewer CPUs/RAM than default policy assumes.

## Constraints

- **Gateway priority:** Gateway responsiveness takes precedence over worker throughput.
- **Cross-platform:** Linux, native Windows, and Docker-backed installs must have defined behavior.
- **Graceful degradation:** Weak platforms must warn, not silently claim strong isolation.
- **Security:** Worker isolation reduces blast radius but does not replace authorization or sandboxing.
- **Data safety:** Maintenance jobs must use batch operations to avoid long DB locks.
- **Compatibility:** Migration must support existing local installs.

## Success Criteria

- [ ] SC-001: Gateway `/health` responds during CPU-heavy worker load.
- [ ] SC-002: Gateway `/health` responds during memory-heavy worker load until worker limit is reached.
- [ ] SC-003: Heavy gateway routes are converted to job creation and return quickly.
- [ ] SC-004: Agent/tool subprocesses run outside the gateway process group/resource group.
- [ ] SC-005: Linux systemd/cgroup backend applies separate gateway and worker policies.
- [ ] SC-006: Docker backend applies equivalent container resource limits when selected.
- [ ] SC-007: Native Windows reports and applies the strongest available worker protection.
- [ ] SC-008: Job progress, heartbeat, cancellation, and stale detection are visible in CLI and Web.
- [ ] SC-009: Worker pool backpressure prevents unbounded process spawning.
- [ ] SC-010: `pibo resources doctor` reports effective protection and remediation.
- [x] SC-011: Chat Web gateway hot-path diagnostics report memory, event-loop, trace cache, replay, and reliability payload pressure.
- [x] SC-012: Trace timeline cache, replay buffers, V1 trace responses, and reliability payloads have bounded survival guardrails before full worker isolation.

## Assumptions and Open Questions

### Assumptions

- The gateway can be refactored to orchestrate sessions and workers instead of executing all runtime work in-process.
- Linux systemd/cgroup v2 is the preferred production path.
- Docker remains useful for stronger isolation but should not be mandatory.
- Native Windows needs a helper/supervisor for strong process-tree resource control.

### Open Questions

- Should agent sessions always run out-of-process, or should small/local sessions have an in-process dev mode?
- What default Linux resource budgets should Pibo choose for machines with 2, 4, 6, 8, and 16+ CPUs?
- Should Windows Job Object support be implemented in Rust, Go, C#, or native Node addon?
- Should resource profiles be user-configurable in YAML/JSON?
- Should worker logs live in SQLite, files, journal, or a combination?
- How should Pibo handle DB locks caused by worker jobs that need operational data writes?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| Gateway responsive under load | CPU-bound agent job | `tasks.md` Phase 1/5 | Pending |
| No inline heavy work | Maintenance request | `tasks.md` Phase 2 | Pending |
| Job model | User closes page during job | `tasks.md` Phase 3 | Pending |
| Resource policies | Agent job starts with policy | `tasks.md` Phase 4 | Pending |
| Child containment | Tool starts child process | `tasks.md` Phase 4/6 | Pending |
| Linux cgroups | Linux install configures resources | `tasks.md` Phase 5 | Pending |
| Docker optional | Docker worker backend | `tasks.md` Phase 6 | Pending |
| Windows native | Native Windows worker starts | `tasks.md` Phase 7 | Pending |
| Safe defaults | Resource doctor | `tasks.md` Phase 8 | Pending |
| Backpressure | Worker pool full | `tasks.md` Phase 3/4 | Pending |
| Diagnostics | Operator inspects workers | `tasks.md` Phase 8 | Pending |
