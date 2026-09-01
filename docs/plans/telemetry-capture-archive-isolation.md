---
type: "Plan"
title: "Telemetry Capture and Archive Isolation"
description: "Directive plan for opt-in telemetry capture, isolated active stores, inert archives, and bounded maintenance."
tags: ["telemetry", "capture", "archive", "privacy", "gateway-safety"]
status: "draft"
authority: "directive"
generated:
  by: "process:pibo-okf-b01-active-plan-extraction"
  at: "2026-08-30T17:04:59Z"
sources:
  - id: "SPC-DATA-003"
    resource: "/specs/data/telemetry.md"
    title: "Runtime, Provider, and Tool Telemetry"
    relation: "shipped telemetry schema and minimization facts"
  - id: "SPC-SEC-003"
    resource: "/specs/security/gateway-admission-and-restart.md"
    title: "Gateway Resource Admission and Restart Safety"
    relation: "shipped gateway safety facts"
  - id: "SPC-CMP-001"
    resource: "/specs/compute/workers-and-resource-lifecycle.md"
    title: "Docker Workers and Aggregate Resource Lifecycle"
    relation: "shipped maintenance-worker and resource facts"
  - id: "source-1"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/telemetry-opt-in-archive-isolation/design.md"
    path: "docs/specs/changes/telemetry-opt-in-archive-isolation/design.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-2"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/telemetry-opt-in-archive-isolation/proposal.md"
    path: "docs/specs/changes/telemetry-opt-in-archive-isolation/proposal.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-3"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/telemetry-opt-in-archive-isolation/spec.md"
    path: "docs/specs/changes/telemetry-opt-in-archive-isolation/spec.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
  - id: "source-4"
    resource: "git:cc8a3d7904ed10cb48215cd9d7c407d067ed89d6:docs/specs/changes/telemetry-opt-in-archive-isolation/tasks.md"
    path: "docs/specs/changes/telemetry-opt-in-archive-isolation/tasks.md"
    commit: "cc8a3d7904ed10cb48215cd9d7c407d067ed89d6"
    relation: "exact source-file lineage"
links:
  - "/specs/data/telemetry.md"
  - "/specs/security/gateway-admission-and-restart.md"
  - "/specs/compute/workers-and-resource-lifecycle.md"
---

# Telemetry Capture and Archive Isolation

## Current telemetry contract

SPC-DATA-003 owns the implemented telemetry schema, bounded previews, aggregate/default metadata, opt-in provider detail, best-effort failure behavior, explicit pruning, and current privacy limits. Gateway and compute specifications own pressure admission and isolated worker resource boundaries. Archive isolation, archive-backed inspection, and a complete capture lifecycle are not current canonical behavior.

This plan preserves operational data required for product behavior and does not relabel it as optional diagnostic telemetry.

## Active capture/archive scope

- Define opt-in capture runs with explicit scope, detail level, duration, byte/row limits, and payload policy.
- Route capture detail to an isolated active store rather than a default product or reliability store.
- Finalize stopped runs into immutable archive directories with bounded manifests and closed database handles.
- List archives from manifests without opening archive databases; inspect or export only through explicit bounded operations.
- Detect legacy telemetry without startup-wide scans and provide resumable archive/prune tooling outside gateway request paths.
- Add deletion, retention, privacy warning, crash recovery, and archive-state UI/CLI flows.

### Non-goals

- Disable bounded operational metrics, reliability facts, or gateway self-observability needed for safe product operation.
- Claim generic secret redaction where current bounded previews only truncate or allow-list fields.
- Load archive databases during normal gateway startup, health checks, navigation, or default diagnostics.
- Perform large migration, prune, export, delete, or vacuum work synchronously in a Web request.
- Treat dates, measurements, or private locations from the old incident packet as current product facts.

## Isolation and privacy invariants

1. No detailed capture starts without explicit scope, expiry, limits, and an auditable owner action.
2. Active capture data resides in an exact run-owned store; default product, reliability, and archive stores remain separate.
3. Stopping a run closes writers before finalization and records status, schema version, size, counts, timestamps, and integrity metadata in a bounded manifest.
4. Normal startup and archive listing read metadata only; archive database contents remain inert until explicit inspection.
5. Inspection enforces row, byte, time, payload, and concurrency bounds and never makes raw provider payload retrieval implicit.
6. Deletion and retention target exact archive ownership, run outside the gateway request path, expose progress/cancellation, and preserve failed-work evidence safely.
7. Crash, disk-full, corrupt-manifest, and partial-finalization states remain visible and recoverable without silently merging stores.
8. UI and CLI warn that diagnostic detail may contain sensitive data; defaults minimize capture and omit arbitrary payload bodies.

## Rollout/migration steps

### Phase 1 — Contract and gating

- Inventory telemetry writers and classify each field as operational, aggregate, diagnostic, or payload detail.
- Define run IDs, scopes, detail levels, limits, state transitions, and manifest schema.
- Centralize capture gating and prove default product behavior with no active capture.

### Phase 2 — Active-store isolation

- Create run-owned active stores with atomic metadata updates and size/duration enforcement.
- Route only matching events and allowed fields to the active store.
- Recover or mark interrupted active runs without opening unrelated archives.

### Phase 3 — Finalization and bounded access

- Finalize active runs to archives, close handles, and expose manifest-only listing.
- Add bounded summary/inspection/export operations with exact archive ownership and cancellation.
- Keep archives disconnected from startup, health, and routine navigation.

### Phase 4 — Legacy and retention operations

- Detect legacy tables from bounded schema metadata.
- Add resumable batch archive/prune operations with checkpoints, progress, cancellation, and lock budgets.
- Define safe failure, retry, checkpoint, and vacuum guidance; never auto-run expensive migration at startup.

### Phase 5 — Product controls

- Add progressively discoverable status/start/stop/archive commands.
- Add explicit Settings controls, capture warnings, active status, archive list, export, and delete job state.
- Document capture, reproduce, stop, export, and delete workflows without publishing captured private data.

## Acceptance and validation matrix

| Area | Acceptance criterion | Required evidence |
|---|---|---|
| Default state | Product sessions run without an active detailed capture store or detailed rows in default stores. | Fresh-store and writer-gate tests. |
| Scope | Only matching events and allow-listed fields enter a capture; expiry and limits stop writes. | Scope, limit, and clock tests. |
| Isolation | Active and archived stores are never opened by normal startup, health, or list paths. | File-handle and startup regression tests. |
| Finalization | Stop closes writers and produces a bounded, integrity-checked manifest; retry is idempotent. | Crash/fault-injection tests. |
| Privacy | Defaults omit payload bodies; warnings and export controls match actual capture detail. | Field-policy and disclosure tests. |
| Legacy data | Large legacy stores do not block startup; batch work resumes, cancels, and respects lock budgets. | Synthetic large-store tests. |
| Maintenance | Delete, prune, export, and migration execute in bounded workers with visible status. | Worker lifecycle and gateway-responsiveness tests. |
| Corruption | Corrupt or partial archives remain inert, visible, and explicitly recoverable or deletable. | Corrupt-manifest/database fixtures. |

Canonical authority remains [SPC-DATA-003](../specs/data/telemetry.md), [SPC-SEC-003](../specs/security/gateway-admission-and-restart.md), and [SPC-CMP-001](../specs/compute/workers-and-resource-lifecycle.md). The four Git-pinned packet files preserve superseded rationale and unfinished-work lineage only.
