# Tasks: Gateway Resource Protection and Isolated Runtime Workers

**Status:** Draft; Phase 0 gateway survival guardrails shipped in v1.7.0
**Created:** 2026-07-04
**Updated:** 2026-07-05
**Related spec:** `spec.md`
**Related changes:** `../chat-web-trace-v2-fast-path/`, `../telemetry-opt-in-archive-isolation/`

## Work Estimate

Estimated implementation size: **very large**, likely **6–12 engineering weeks** for a robust cross-platform version.

Suggested staged delivery:

- Phase 1 audit and immediate guardrails: 3–5 days.
- Phase 2 job model and heavy-route conversion: 1–2 weeks.
- Phase 3 Linux systemd worker backend: 1–2 weeks.
- Phase 4 maintenance/telemetry workers: 1 week.
- Phase 5 agent/runtime worker boundary: 2–4 weeks.
- Phase 6 Docker backend: 1–2 weeks.
- Phase 7 Windows native supervisor: 2–4 weeks.
- Phase 8 install/doctor/UI hardening: 1–2 weeks.

A smaller first release can ship Linux systemd-backed maintenance jobs and diagnostics before moving every agent runtime out-of-process.

## Phase 0: Gateway Survival Guardrails

This phase is smaller than full worker isolation and should ship first.

**v1.7.0 status:** Shipped for the Chat Web gateway hot path. Full job/worker/resource-policy isolation remains pending.

### Tasks

- [x] T0.1 Add gateway resource snapshot API/CLI: heap, RSS, external, event-loop delay, active streams, listener counts.
- [x] T0.2 Add trace cache byte/count budgets and eviction by estimated size for Trace V2 timeline page cache.
- [x] T0.3 Add transient replay buffer byte/count budgets and eviction metrics.
- [x] T0.4 Add reliability event inline payload budgets and large-payload reference storage.
- [x] T0.5 Add memory/resource warning ring for degraded-operation visibility.
- [x] T0.6 Add cache eviction when configured trace cache budgets are exceeded.
- [x] T0.7 Add synthetic large trace and large tool-output load tests for the Trace V2 hot path.
- [x] T0.8 Add startup warning/failure for unsupported Node versions.
- [ ] T0.9 Add a rolling crash-context file under `$PIBO_HOME/diagnostics/` with fixed size.
- [x] T0.10 Apply Trace V2 response-byte and serialization/compression metrics to gateway diagnostics.

### Acceptance

- [x] Gateway reports memory/cache/replay/payload pressure without scanning large stores.
- [x] Synthetic large-output workloads do not OOM the released hot path.
- [x] Large trace/session switching cannot retain more than the configured timeline page cache budget.
- [x] Operators get actionable warnings before heap exhaustion through bounded diagnostics and recent warnings.

## Phase 1: Audit and Immediate Guardrails

### Tasks

- [ ] T1.1 Inventory every gateway route that can run longer than a bounded request budget.
- [ ] T1.2 Inventory all direct child-process spawning from gateway/runtime code.
- [ ] T1.3 Inventory agent runtime execution paths.
- [ ] T1.4 Inventory browser, PTY, shell, build, file-processing, indexing, export, import, retention, and telemetry operations.
- [ ] T1.5 Classify each path as gateway-safe or heavy work.
- [ ] T1.6 Add temporary warnings/logging when heavy work runs in the gateway.
- [ ] T1.7 Add emergency kill/restart guidance for currently blocking paths.
- [ ] T1.8 Add tests or static checks for the most dangerous known route classes.

### Acceptance

- [ ] A document or generated report lists heavy execution paths.
- [ ] Telemetry retention and other maintenance routes are marked unsafe until moved.
- [ ] Gateway-heavy work audit is repeatable.

## Phase 2: Job Model

### Tasks

- [ ] T2.1 Define job schema/types.
- [ ] T2.2 Add job store.
- [ ] T2.3 Add job lifecycle transitions.
- [ ] T2.4 Add progress model.
- [ ] T2.5 Add heartbeat model.
- [ ] T2.6 Add job events/log cursor model.
- [ ] T2.7 Add cancellation state.
- [ ] T2.8 Add stale job detection.
- [ ] T2.9 Add CLI commands: `pibo jobs list`, `inspect`, `cancel`.
- [ ] T2.10 Add basic Chat Web job list/status surface.

### Acceptance

- [ ] Long operations can create a job and return a job id.
- [ ] Jobs survive browser tab close/reopen.
- [ ] CLI and Web can inspect job status.
- [ ] Cancellation state is visible even before worker enforcement is complete.

## Phase 3: Heavy Routes Become Jobs

### Tasks

- [ ] T3.1 Convert telemetry retention/archive operations to job creation.
- [ ] T3.2 Convert export/import operations that can be long-running to jobs.
- [ ] T3.3 Convert indexing/file-scan operations to jobs.
- [ ] T3.4 Convert build/test/tool operations that are initiated through Web APIs to jobs.
- [ ] T3.5 Ensure converted routes return quickly with `202 Accepted` or equivalent JSON.
- [ ] T3.6 Add UI progress and cancel actions for converted routes.
- [ ] T3.7 Add regression tests that no converted route blocks on the heavy operation.

### Acceptance

- [ ] Maintenance requests no longer perform synchronous heavy work.
- [ ] UI shows progress instead of indefinite spinner.
- [ ] Closing the page does not orphan unknown work.

## Phase 4: Resource Policy Model

### Tasks

- [ ] T4.1 Define resource policy config format.
- [ ] T4.2 Define default policies for gateway, agent, maintenance, browser, telemetry, tool.
- [ ] T4.3 Add host-size scaling logic based on CPU/RAM.
- [ ] T4.4 Add validation and fallback behavior.
- [ ] T4.5 Attach resource policy to each job.
- [ ] T4.6 Reject jobs without valid policy.
- [ ] T4.7 Add `pibo resources status` basic output.

### Acceptance

- [ ] Every heavy job has a resource policy.
- [ ] Policies can be inspected.
- [ ] Invalid policy config fails safely.

## Phase 5: Linux systemd/cgroups Backend

### Tasks

- [ ] T5.1 Detect Linux systemd and cgroup v2 support.
- [ ] T5.2 Implement systemd property mapping for resource policies.
- [ ] T5.3 Implement transient worker unit creation.
- [ ] T5.4 Implement worker cancellation via systemd stop/kill.
- [ ] T5.5 Implement worker status inspection.
- [ ] T5.6 Implement log discovery via journalctl hints.
- [ ] T5.7 Implement gateway service drop-in generation.
- [ ] T5.8 Add `pibo resources doctor` checks for systemd properties.
- [ ] T5.9 Add integration test using a CPU-burn worker.
- [ ] T5.10 Add integration test using a memory-burn worker.

### Acceptance

- [ ] Linux workers run outside the gateway cgroup.
- [ ] Worker children remain in worker cgroup.
- [ ] CPU/memory limits apply.
- [ ] Gateway `/health` remains responsive during worker CPU load.

## Phase 6: Worker Supervisor and Maintenance Workers

### Tasks

- [ ] T6.1 Implement generic worker command protocol.
- [ ] T6.2 Implement job heartbeat from worker.
- [ ] T6.3 Implement progress update from worker.
- [ ] T6.4 Implement cancellation signal handling.
- [ ] T6.5 Move telemetry archive/prune jobs to maintenance worker.
- [ ] T6.6 Move batch DB maintenance to maintenance worker.
- [ ] T6.7 Move long export/import jobs to maintenance worker.
- [ ] T6.8 Add batch-operation helper with progress/cancel support.

### Acceptance

- [ ] Maintenance work runs in a limited worker.
- [ ] Gateway is not blocked by maintenance.
- [ ] Cancelling maintenance stops future batches and marks the job.

## Phase 7: Agent Runtime Worker Boundary

### Tasks

- [ ] T7.1 Define runtime worker host protocol.
- [ ] T7.2 Identify what session router state must remain in gateway.
- [ ] T7.3 Move model/tool execution loop into worker host or adapter.
- [ ] T7.4 Stream worker events back to gateway/event store.
- [ ] T7.5 Preserve Chat Web live output semantics.
- [ ] T7.6 Preserve yielded run controls.
- [ ] T7.7 Ensure tool subprocesses inherit worker resource group.
- [ ] T7.8 Add cancellation and force-kill path.
- [ ] T7.9 Add tests for active session, queued message, cancellation, crash, and restart.

### Acceptance

- [ ] Agent execution can run outside gateway.
- [ ] Gateway can restart or remain healthy while worker is busy.
- [ ] Chat Web still shows live session output.
- [ ] Subprocesses started by tools stay under worker limits.

## Phase 8: Docker Backend

### Tasks

- [ ] T8.1 Define Docker backend selection/config.
- [ ] T8.2 Map resource policies to Docker flags.
- [ ] T8.3 Define required mounts and environment.
- [ ] T8.4 Add labels for job/worker cleanup.
- [ ] T8.5 Implement Docker worker start/cancel/inspect.
- [ ] T8.6 Add Docker logs integration.
- [ ] T8.7 Add cleanup/reap logic.
- [ ] T8.8 Add tests or smoke tests with CPU/memory-limited containers.

### Acceptance

- [ ] Docker workers run with CPU/memory/pid limits.
- [ ] Gateway can use Docker backend when selected.
- [ ] Docker is optional; Linux systemd path still works without Docker.

## Phase 9: Native Windows Resource Backend

### Tasks

- [ ] T9.1 Decide implementation language for Windows worker supervisor helper.
- [ ] T9.2 Implement worker process launch through Windows Job Objects.
- [ ] T9.3 Apply kill-on-close/process-tree containment.
- [ ] T9.4 Apply memory limit where supported.
- [ ] T9.5 Apply CPU rate/priority where supported.
- [ ] T9.6 Implement child process containment validation.
- [ ] T9.7 Implement inspect/status output.
- [ ] T9.8 Implement partial fallback: priority and affinity.
- [ ] T9.9 Add `pibo resources doctor` Windows checks.
- [ ] T9.10 Add Windows smoke tests for process tree kill and protection-level reporting.

### Acceptance

- [ ] Native Windows can run workers outside gateway process with reported protection level.
- [ ] Strong mode uses Job Objects.
- [ ] Partial mode warns clearly when strong isolation is unavailable.

## Phase 10: Backpressure and Scheduling

### Tasks

- [ ] T10.1 Add per-policy concurrency limits.
- [ ] T10.2 Add global concurrency limits.
- [ ] T10.3 Add per-user/session queue limits.
- [ ] T10.4 Add queue position reporting.
- [ ] T10.5 Add overload status to Web and CLI.
- [ ] T10.6 Add fair scheduling rules.
- [ ] T10.7 Add tests for worker pool saturation.

### Acceptance

- [ ] New heavy jobs queue or fail cleanly when capacity is exhausted.
- [ ] Pibo does not spawn unlimited workers.
- [ ] Users can see why a job is waiting.

## Phase 11: Install, Bootstrap, and Operations

### Tasks

- [ ] T11.1 Add host capability detection.
- [ ] T11.2 Generate default resource policy config.
- [ ] T11.3 Add Linux systemd drop-in generation/apply command.
- [ ] T11.4 Add Windows supervisor installation/verification.
- [ ] T11.5 Add Docker backend validation.
- [ ] T11.6 Add operator docs.
- [ ] T11.7 Add upgrade notes for existing installs.
- [ ] T11.8 Add incident playbook for worker runaway and gateway starvation.

### Acceptance

- [ ] `pibo resources doctor` gives actionable output on Linux and Windows.
- [ ] Install docs explain resource profiles and platform behavior.
- [ ] Operators can verify that gateway is protected.

## Phase 12: Validation and Performance Testing

### Tasks

- [ ] T12.1 Build CPU-burn test worker.
- [ ] T12.2 Build memory-burn test worker.
- [ ] T12.3 Build child-process escape test.
- [ ] T12.4 Build SQLite batch-maintenance load test.
- [ ] T12.5 Validate gateway health under each load.
- [ ] T12.6 Validate Chat Web navigation under each load.
- [ ] T12.7 Validate cancellation and stale worker detection.
- [ ] T12.8 Capture validation reports under `docs/reports/`.

### Acceptance

- [ ] Gateway remains responsive under controlled CPU and memory worker stress.
- [ ] Worker limit violations do not crash gateway.
- [ ] Validation evidence is documented.

## Implementation Notes

- Start with maintenance jobs because they caused the immediate incident and are easier to isolate than full agent runtime.
- Linux systemd/cgroups should be the first strong backend because production runs on Ubuntu/systemd.
- Native Windows support should not be ignored; Pibo runs natively on Windows for the requester.
- Docker should be optional, not the baseline requirement.
- Do not rely on process priority alone for strong isolation.
- DB lock behavior must be fixed separately with batching; resource limits alone do not prevent SQLite lock starvation.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Refactoring agent runtime out-of-process is large | Deliver maintenance and heavy-route jobs first; then move agent runtime in phases. |
| Windows strong isolation is complex | Use helper executable with Job Objects; report partial fallback clearly. |
| Worker communication adds latency | Keep gateway projection/event store efficient and bounded. |
| Resource defaults are wrong for small hosts | Scale by host CPU/RAM and allow override. |
| Child processes escape limits | Use cgroups/Docker/Job Objects; add escape tests. |
| SQLite locks still block UI | Batch maintenance and avoid long gateway DB operations. |
| Operators misconfigure limits | Provide `pibo resources doctor` and safe defaults. |
