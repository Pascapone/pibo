---
type: "Plan"
title: "Gateway Resource Protection and Worker Follow-ups"
description: "Directive plan for remaining gateway admission, worker policy, platform, and heavy-work isolation gaps."
tags: ["gateway", "workers", "resource-lifecycle", "restart-safety"]
status: "draft"
authority: "directive"
generated:
  by: "process:pibo-okf-b01-active-plan-extraction"
  at: "2026-08-30T17:04:59Z"
sources:
  - id: "SPC-SEC-003"
    resource: "/specs/security/gateway-admission-and-restart.md"
    title: "Gateway Resource Admission and Restart Safety"
    relation: "shipped gateway admission and restart facts"
  - id: "SPC-CMP-001"
    resource: "/specs/compute/workers-and-resource-lifecycle.md"
    title: "Docker Workers and Aggregate Resource Lifecycle"
    relation: "shipped compute-worker and resource-lifecycle facts"
  - id: "SPC-ORCH-001"
    resource: "/specs/orchestration/yielded-runs.md"
    title: "Yielded Run Control and Isolation"
    relation: "shipped run ownership and isolation facts"
  - id: "SPC-GW-001"
    resource: "/specs/gateway/routing-events-and-actions.md"
    title: "Routing, Events, Steering, and Session Actions"
    relation: "shipped routing and action-boundary facts"
  - id: "source-1"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/gateway-resource-protection-workers/design.md"
    path: "docs/specs/changes/gateway-resource-protection-workers/design.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-2"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/gateway-resource-protection-workers/proposal.md"
    path: "docs/specs/changes/gateway-resource-protection-workers/proposal.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-3"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/gateway-resource-protection-workers/spec.md"
    path: "docs/specs/changes/gateway-resource-protection-workers/spec.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-4"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/gateway-resource-protection-workers/tasks.md"
    path: "docs/specs/changes/gateway-resource-protection-workers/tasks.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
links:
  - "/specs/security/gateway-admission-and-restart.md"
  - "/specs/compute/workers-and-resource-lifecycle.md"
  - "/specs/orchestration/yielded-runs.md"
  - "/specs/gateway/routing-events-and-actions.md"
---

# Gateway Resource Protection and Worker Follow-ups

## Current shipped guardrails

The canonical specifications own the current baseline: bounded gateway pressure snapshots and warnings, yielded-run admission and reservations, guarded production restart, durable yielded-run control, Docker compute workers with resource policy and cleanup labels, and aggregate resource diagnostics. Current admission does not queue or govern every kind of work, and current evidence does not prove real-host systemd limits or Windows process-tree behavior.

This plan extends those contracts. It does not recreate the existing compute, run-control, routing, or gateway lifecycle surfaces.

## Active follow-up scope

The active work is to inventory heavy gateway paths, route each path through an existing or deliberately extended job/run boundary, make resource policy consistent across worker backends, and close supervision and platform gaps. Work includes bounded crash context, progress and cancellation, process-tree containment, Linux/systemd and Docker integration, a Windows backend or explicit degraded mode, operator diagnostics, and claim-specific validation.

### Non-goals

- Treat all requests, agent turns, or child processes as one undifferentiated job type.
- Replace the Pibo Session router or move durable product authority into a worker.
- Promise delay queues, universal admission, strong isolation, or restart recovery before the selected backend proves it.
- Let worker cleanup delete worktrees, browser profiles, active runs, or broad product-state roots.
- Infer real-host, browser, PTY, provider, deployment, or Pibo2 evidence from documentation or unit tests.

## Worker/resource policy decisions

Before implementation, record these decisions in the owning canonical specifications:

1. **Work classification:** define request-safe, yielded, maintenance, compute, browser, and runtime work; identify the owner and maximum synchronous budget for each class.
2. **Job/run reuse:** map heavy routes to existing durable jobs or yielded runs when their lifecycle fits; introduce a new record only when ownership, persistence, or recovery semantics differ.
3. **Resource policy:** define CPU, memory, PID/process-tree, elapsed-time, concurrency, queue, output, and storage limits by work class, including safe fallback behavior.
4. **Backend strength:** report effective protection for Linux/systemd, Docker, and Windows; distinguish strong containment from priority-only or process-group fallbacks.
5. **Cancellation:** separate cooperative stop, worker termination, subtree kill, timeout, stale-heartbeat handling, and gateway restart behavior.
6. **Evidence and privacy:** persist bounded status and redacted crash context; keep command arguments, payloads, credentials, private locations, and session identifiers out of general diagnostics.

## Rollout and recovery plan

### Phase 1 — Repeatable heavy-path inventory

- Enumerate long request handlers, direct child-process launches, maintenance operations, exports/imports, indexing, browser/PTY activity, and runtime execution paths.
- Classify each against current gateway, yielded-run, and compute contracts.
- Add static or focused regression checks for known blocking classes.
- Publish no claim that a path is isolated until its actual backend and process tree are tested.

### Phase 2 — Lifecycle and route conversion

- Reuse or extend durable job/run state for progress, heartbeat, cancellation, failure, retry, and stale ownership.
- Convert confirmed heavy request paths to quick acceptance plus status lookup.
- Preserve idempotency and show failed, cancelled, orphaned, and capacity-rejected states explicitly.
- Add fixed-size crash context and bounded status logs with redaction at write time.

Dependency: each conversion needs an authoritative owner and rollback path before routing changes.

### Phase 3 — Backend supervision

- Map policy to Linux systemd/cgroup controls where supported and prove child containment.
- Align Docker worker policy, labels, mounts, inspection, release, and reaping with SPC-CMP-001.
- Implement Windows Job Object containment or report an explicit degraded protection level.
- Ensure gateway state remains independent of worker-local process state and can reconcile stale workers.

### Phase 4 — Product and operator hardening

- Add progressively discoverable status, inspect, cancel, doctor, and backend-capability output.
- Surface bounded job status and cancellation in Chat Web only for owned operations.
- Define overload behavior, per-policy concurrency, fairness, and queue visibility.
- Write incident and recovery procedures for runaway workers, stale jobs, resource exhaustion, and backend unavailability.

### Rollback

Each converted path retains a feature gate or reversible routing decision until its new lifecycle passes fault injection. Rollback stops new dispatch to the worker backend, preserves durable job/run facts, reconciles in-flight ownership, and never silently reexecutes non-idempotent work in the gateway.

## Acceptance and validation matrix

| Claim | Acceptance criterion | Required evidence |
|---|---|---|
| Inventory | Every heavy path has one class, owner, sync budget, backend, and test gate. | Source-derived inventory plus static/focused checks. |
| Admission | Capacity exhaustion rejects or queues according to explicit policy without unbounded spawning. | Deterministic saturation tests. |
| Containment | Worker descendants remain in the effective policy boundary; degraded backends say so. | Backend-specific process-tree tests. |
| Gateway safety | CPU, memory, cancellation, and crash workloads do not monopolize gateway health or routing. | Controlled load and fault-injection tests. |
| Lifecycle | Progress, heartbeat, cancellation, stale detection, and recovery remain durable and idempotent. | Store/restart/replay tests. |
| Privacy | Diagnostics are bounded and omit sensitive arguments, payloads, private locations, and identifiers. | Redaction and size-limit tests. |
| Cleanup | Reaping targets exact owned resources and preserves worktrees, active work, and product state. | Dry-run/apply fixtures and ownership checks. |
| Platforms | Linux, Docker, and Windows claims match their measured protection levels. | Separate platform reports; no cross-platform inference. |

Canonical authority remains [SPC-SEC-003](../specs/security/gateway-admission-and-restart.md), [SPC-CMP-001](../specs/compute/workers-and-resource-lifecycle.md), [SPC-ORCH-001](../specs/orchestration/yielded-runs.md), and [SPC-GW-001](../specs/gateway/routing-events-and-actions.md). The Git-pinned packet files are superseded planning inputs, not current product authority.
