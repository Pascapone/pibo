# Design: Gateway Resource Protection and Isolated Runtime Workers

**Status:** Draft
**Created:** 2026-07-04
**Related spec:** `spec.md`
**Related changes:** `../chat-web-trace-v2-fast-path/`, `../telemetry-opt-in-archive-isolation/`

## Design Summary

Pibo will separate critical gateway serving from heavy execution. The gateway becomes an orchestrator and status server. Agent runtimes, tools, browser automation, maintenance, telemetry inspection, and long data operations run in worker groups with explicit resource policies. A platform resource-controller layer maps policies to Linux systemd/cgroups, Docker, native Windows Job Objects, or weaker fallbacks.

## Architecture

```text
Browser / API clients
        |
        v
Reverse proxy
        |
        v
pibo-gateway  [protected]
  - Web UI
  - Auth
  - API
  - Health
  - Job creation/cancel/status
  - Lightweight operational reads/writes
        |
        +--> job store / event store
        |
        +--> worker supervisor
                |
                +--> agent workers        [limited]
                +--> tool workers         [limited]
                +--> browser/pty workers  [limited]
                +--> maintenance workers  [limited]
                +--> telemetry workers    [limited]
```

## Core Design Rules

1. Gateway request handlers must complete within a bounded request budget.
2. Heavy operations must be represented as jobs.
3. Workers must have resource policies.
4. Workers must contain child processes where platform support exists.
5. Gateway resource protection must be configured before worker throughput is maximized.
6. Platform fallbacks must be explicit and visible.

## Job Model

### Job Store

The job store may use SQLite operational tables or an existing event store, but it must be lightweight and safe for gateway access.

Recommended tables/entities:

- `jobs`;
- `job_events`;
- `workers`;
- `worker_heartbeats`;
- `resource_policies` or config-backed policy definitions.

### Job Record

```ts
type PiboJob = {
  id: string;
  type: "agent-session" | "tool" | "browser" | "maintenance" | "telemetry" | "indexing" | "export";
  ownerUserId?: string;
  roomId?: string;
  sessionId?: string;
  status: "queued" | "starting" | "running" | "stopping" | "cancelled" | "failed" | "completed";
  resourcePolicy: string;
  workerId?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
  heartbeatAt?: string;
  progress?: JobProgress;
  cancellable: boolean;
  cancelRequestedAt?: string;
  lastError?: string;
  metadata: Record<string, unknown>;
};
```

### Progress Model

```ts
type JobProgress = {
  phase?: string;
  currentStep?: string;
  completedUnits?: number;
  totalUnits?: number;
  unit?: "rows" | "files" | "bytes" | "steps" | "tokens" | "items";
  message?: string;
};
```

Progress must be optional. Some jobs can only provide heartbeat and log cursor.

## Worker Supervisor

The worker supervisor owns worker lifecycle:

```ts
type WorkerSupervisor = {
  capabilities(): ResourceControllerCapabilities;
  startJob(job: PiboJob): Promise<WorkerHandle>;
  cancelJob(jobId: string, mode?: "graceful" | "force"): Promise<void>;
  listWorkers(): Promise<WorkerSummary[]>;
  inspectWorker(workerId: string): Promise<WorkerDetails>;
  reapStaleWorkers(): Promise<void>;
};
```

The supervisor should not be a monolith. It delegates resource enforcement to a resource controller backend.

## Resource Controller Abstraction

```ts
type ResourceController = {
  backend: "linux-systemd" | "docker" | "windows-job-object" | "windows-priority-affinity" | "none";
  protectionLevel: "strong" | "partial" | "none";
  applyGatewayPolicy(policy: ResourcePolicy): Promise<ResourceApplyResult>;
  startWorker(command: WorkerCommand, policy: ResourcePolicy): Promise<WorkerHandle>;
  updatePolicy?(workerId: string, policy: ResourcePolicy): Promise<void>;
  terminate(workerId: string, signal?: string): Promise<void>;
  inspect(workerId: string): Promise<ResourceUsage>;
};
```

## Resource Policy Model

```ts
type ResourcePolicy = {
  name: string;
  role: "gateway" | "agent" | "maintenance" | "browser" | "telemetry" | "tool";
  cpu?: {
    quotaPercent?: number;
    weight?: number;
    affinity?: number[];
    priority?: "idle" | "below-normal" | "normal" | "above-normal" | "high";
  };
  memory?: {
    lowBytes?: number;
    highBytes?: number;
    maxBytes?: number;
  };
  io?: {
    weight?: number;
    readBandwidthMax?: string;
    writeBandwidthMax?: string;
  };
  tasksMax?: number;
  timeoutMs?: number;
  concurrencyCost?: number;
};
```

### Default Policy Intent

For a 6 CPU / 15 GiB RAM host, a reasonable starting point:

| Policy | CPU | Memory | I/O | Notes |
|---|---:|---:|---:|---|
| `gateway-critical` | high weight, no low quota | low 2G, high 4G, max 6G | high weight | must stay responsive |
| `agent-standard` | quota 200–300% | high 4–6G, max 6–8G | medium | normal agent runtime |
| `agent-heavy` | quota 300–400% | max 8–10G | medium | explicit heavy mode |
| `maintenance-low` | quota 25–75% | high 1G, max 2G | low | retention, prune, archive |
| `browser-medium` | quota 100–200% | max 3–5G | medium-low | browser automation |
| `telemetry-debug` | quota 50–100% | max 2–4G | low | archive inspect/export |
| `untrusted-tool-low` | quota 50–100% | max 1–2G | low | risky tools |

The installer should scale defaults by host size and allow override.

## Linux systemd/cgroups Backend

### Gateway Service

For host production service:

```ini
[Service]
CPUAccounting=yes
CPUWeight=1000
MemoryAccounting=yes
MemoryLow=2G
MemoryHigh=4G
MemoryMax=6G
IOAccounting=yes
IOWeight=1000
TasksMax=512
Restart=always
```

Use values from computed policy, not hard-coded constants.

### Worker Units

Workers should run as transient units or templated services:

```bash
systemd-run \
  --unit=pibo-worker-<job-id> \
  --property=CPUAccounting=yes \
  --property=CPUQuota=200% \
  --property=CPUWeight=200 \
  --property=MemoryAccounting=yes \
  --property=MemoryHigh=4G \
  --property=MemoryMax=6G \
  --property=IOAccounting=yes \
  --property=IOWeight=200 \
  --property=TasksMax=512 \
  --collect \
  <worker-command>
```

The worker command must execute the job and report heartbeat/progress back to the gateway/job store.

### Linux Diagnostics

Diagnostics should show:

- unit name;
- cgroup path;
- applied properties;
- current CPU/memory usage if available;
- child process count;
- journal command for logs.

## Docker Backend

Docker is optional. It is useful for stronger filesystem and process isolation.

Worker start example:

```bash
docker run \
  --name pibo-worker-<job-id> \
  --cpus=2 \
  --memory=4g \
  --memory-swap=4g \
  --pids-limit=512 \
  --label pibo.job=<job-id> \
  <image> <worker-command>
```

The Docker backend should:

- map resource policy to container flags;
- mount only required paths;
- label containers for cleanup;
- support log collection;
- report container status and resource usage.

## Native Windows Backend

### Strong Mode: Windows Job Objects

Pibo should implement or ship a Windows worker supervisor that starts worker process trees inside Job Objects.

A Windows Job Object can provide:

- process tree containment;
- kill-on-job-close;
- process memory limits;
- job memory limits;
- CPU rate control;
- process count limits;
- accounting.

Implementation options:

- Rust helper executable;
- Go helper executable;
- C# helper executable;
- Node native addon.

A helper executable is preferred over a Node native addon for packaging and failure isolation.

Potential command shape:

```bash
pibo-worker-supervisor.exe run \
  --job-id <job-id> \
  --memory-max 4G \
  --cpu-rate 25 \
  --priority below-normal \
  --kill-on-close \
  -- <worker-command>
```

### Partial Mode: Priority and Affinity

If Job Objects are unavailable, Pibo can apply:

- lower priority for workers;
- higher priority for gateway;
- CPU affinity for workers;
- optional concurrency limits.

This is partial protection. It does not reliably limit memory or all children. The UI/CLI must report `partial` protection.

### Optional Windows Strong Isolation

Docker Desktop or WSL2 can provide stronger worker isolation. Native Windows should still work, but operators may choose Docker/WSL for heavy workloads.

## Gateway Refactor Pattern

Replace blocking route handlers:

```ts
const result = await doHeavyWork(input);
return responseJson(result);
```

with job creation:

```ts
const job = await jobs.create({ type, input, resourcePolicy });
await supervisor.enqueue(job);
return responseJson({ jobId: job.id, status: job.status }, { status: 202 });
```

For work that needs immediate lightweight validation, validate synchronously, then create the job.

## Agent Runtime Refactor Pattern

Current runtime/session code may assume in-process execution. The new model should introduce a runtime host boundary:

```text
gateway/session router
  -> runtime job
  -> worker runtime host
  -> event/progress stream back to gateway store
  -> Chat Web projection reads store/status
```

The first implementation may keep protocol simple:

- worker writes events to shared event store;
- worker sends heartbeats to gateway API or job store;
- gateway streams stored events to UI.

Later implementations can use IPC/WebSocket/gRPC if needed.

## Database and Lock Strategy

Resource isolation does not solve SQLite locks alone. Heavy DB operations must also be redesigned:

- use batches;
- keep transactions short;
- use busy timeouts;
- report progress;
- avoid full-table scans in gateway;
- avoid `VACUUM` in live gateway;
- consider separate DBs for telemetry/artifacts/jobs.

Gateway reads must be bounded and indexed.

## Backpressure and Scheduling

Worker pools should enforce:

- global max active jobs;
- per-policy max active jobs;
- per-user/session max active jobs;
- queue length limits;
- memory budget estimates;
- explicit overload responses.

Example response:

```json
{
  "status": "queued",
  "jobId": "job_...",
  "queuePosition": 3,
  "reason": "agent-standard worker pool is full"
}
```

## Health and Overload Semantics

Gateway health endpoints should distinguish:

- gateway healthy;
- worker pool degraded;
- job queue overloaded;
- storage degraded;
- telemetry disabled/active;
- maintenance running.

`/health` should stay cheap. A deeper `/status` or CLI command can include more detail.

## Installation and Configuration

### Config File

Resource profiles may live in:

```text
$PIBO_HOME/resource-policies.json
```

or a host-specific config file. Defaults should be generated if absent.

### Install Flow

- Detect OS and backend capability.
- Generate default policies based on CPU/RAM.
- Configure gateway service where applicable.
- Install worker supervisor where applicable.
- Run resource doctor.

### Upgrade Flow

- Do not change service resource limits destructively without confirmation unless install command is explicitly managing host services.
- Show suggested systemd drop-in for existing hosts.
- Provide `pibo resources apply --gateway --workers` for explicit application.

## Diagnostics

### CLI

```bash
pibo resources status
pibo resources doctor
pibo workers list
pibo workers inspect <worker-id>
pibo jobs list
pibo jobs inspect <job-id>
pibo jobs cancel <job-id>
```

### Web UI

Chat Web should show:

- active jobs;
- queued jobs;
- worker status;
- stale jobs;
- cancel buttons;
- resource warnings.

Operator/admin surfaces can show resource-policy details.

## Testing Strategy

### Unit Tests

- resource policy parsing;
- backend capability detection;
- job lifecycle transitions;
- queue/backpressure decisions;
- cancellation state transitions.

### Integration Tests

- route returns job id for heavy operations;
- worker heartbeat updates job status;
- cancellation signals worker;
- stale worker detection;
- Linux cgroup command generation;
- Docker flag generation;
- Windows supervisor command generation.

### System Tests

Linux:

- run CPU-burn worker and assert `/health` responds;
- run memory-burn worker and assert worker limit triggers before gateway failure;
- assert child processes remain in worker cgroup.

Windows:

- run worker through Job Object helper and assert process tree termination;
- assert diagnostics report strong/partial mode correctly.

Docker:

- run worker container with CPU/memory limit;
- assert labels and cleanup work.

## Rollout Strategy

### Phase A: Guardrails

Add resource diagnostics, identify inline heavy paths, add job model skeleton.

### Phase B: Maintenance Jobs First

Move retention/archive/export/index maintenance to jobs. This reduces immediate incident risk.

### Phase C: Agent Worker Boundary

Move agent runtime execution outside gateway or behind worker host.

### Phase D: Platform Backends

Implement Linux systemd backend first, Docker second, Windows supervisor in parallel or next.

### Phase E: Installer Defaults

Add resource policy generation and host setup commands.

## Open Design Questions

- Should Pibo start workers as one job per process or maintain warm worker pools?
- Should agent sessions share a worker process or isolate per session?
- Should browser automation always use Docker where available?
- Should Windows strong isolation ship as Rust helper or C# helper?
- How should job logs be persisted without growing the live DB too quickly?
- Should resource policies be per installation, per workspace, or per user?
