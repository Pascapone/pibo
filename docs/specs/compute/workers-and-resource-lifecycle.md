---
type: "Specification"
title: "Docker Workers and Aggregate Resource Lifecycle"
description: "Defines the implemented docker workers and aggregate resource lifecycle contract and its current ownership, security, compatibility, and verification boundaries."
tags:
- compute
- resources
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T10:45:00Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:Foundation 38bb6e57f118c1543e7263c68d27e5103d3b1262"
    title: "Foundation source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-05+09-COMPUTE-OPERATOR"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_and_typecheck_execution: "performed in owned Docker after authoring; see implementation report"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "CMP-WORKER-001"
      status: "implemented"
      sources:
        - path: src/compute/docker.ts
          symbol: buildWorkerDockerRunArgs
        - path: src/compute/docker.ts
          symbol: buildDevWorkerDockerRunArgs
        - path: src/compute/docker.ts
          symbol: createWorktree
        - path: src/compute/cli.ts
          symbol: runComputeCli
      tests:
        - path: test/compute-resource-policy.test.mjs
          name: "one-time worker docker run args include resource policy and inspectable labels"
        - path: test/compute-resource-policy.test.mjs
          name: "dev worker docker run args include resource policy labels worktree metadata and bounded logs"
      public:
        - "pibo compute spawn"
        - "pibo compute dev spawn"
        - "Docker worker labels"
      failures:
        - "Docker absence, pressure, dirty state, and failed cleanup remain inspectable; exact labels and preserved worktrees constrain lifecycle actions."
      confidence: high
    - id: "CMP-WORKER-002"
      status: "implemented"
      sources:
        - path: src/compute/resource-policy.ts
          symbol: resolveComputeResourcePolicy
        - path: src/compute/resource-policy.ts
          symbol: buildDockerResourcePolicyArgs
        - path: src/compute/docker.ts
          symbol: resolveComputeWorkerLifecycle
      tests:
        - path: test/compute-resource-policy.test.mjs
          name: "compute resource policy resolves safe defaults and documented env overrides"
        - path: test/compute-resource-policy.test.mjs
          name: "compute worker lifecycle labels resolve safe defaults and env overrides"
        - path: test/compute-resource-policy.test.mjs
          name: "docker resource policy args include memory pids shm init restart and log bounds"
      public:
        - "compute resource-policy environment"
        - "Docker run arguments"
      failures:
        - "Policy inputs are bounded and resolved from safe defaults; invalid or unsafe resource values must not widen the worker limits."
      confidence: high
    - id: "CMP-WORKER-003"
      status: "implemented"
      sources:
        - path: src/compute/resource-health.ts
          symbol: getComputeResourceHealth
        - path: src/resources/cli.ts
          symbol: runResourcesCli
        - path: src/resources/reaper.ts
          symbol: ResourceReaperService
      tests:
        - path: test/compute-resource-policy.test.mjs
          name: "compute resource health reports healthy read-only state with stable JSON fields"
        - path: test/resources-cli.test.mjs
          name: "resource status and active browser-pool leases keep stable text and JSON fields"
        - path: test/ralph-resource-visibility.test.mjs
          name: "Ralph CLI text and JSON expose concise retained and dirty resource state"
      public:
        - "pibo compute health|doctor"
        - "pibo resources status|doctor|leases"
      failures:
        - "Aggregate status is read-only and retains the underlying compute, browser, and reaper ownership identities."
      confidence: high
    - id: "CMP-WORKER-004"
      status: "implemented"
      sources:
        - path: src/compute/docker.ts
          symbol: buildComputeWorkerReapPlan
        - path: src/compute/docker.ts
          symbol: applyComputeWorkerReapPlan
        - path: src/resources/lifecycle.ts
          symbol: planResourceReap
        - path: src/resources/lifecycle.ts
          symbol: applyResourceReapPlan
      tests:
        - path: test/compute-resource-policy.test.mjs
          name: "compute reap apply removes only selected containers and never deletes worktrees"
        - path: test/resources-cli.test.mjs
          name: "resource reap dry-run aggregates browser, stale-file, and compute plans while preserving worktrees"
        - path: test/resources-cli.test.mjs
          name: "unmanaged Chromium planning honors home scope, grace, and explicit exemptions before terminating process groups"
      public:
        - "pibo compute reap"
        - "pibo resources reap"
      failures:
        - "Reap is dry-run by default; apply requires an explicit flag, rechecks mutable state, honors exemptions, and never deletes worktrees."
      confidence: high
---
# Docker Workers and Aggregate Resource Lifecycle

## Why

Pibo needs bounded, inspectable compute resources without allowing cleanup to erase unrelated state or cross ownership boundaries.

## Scope

This specification describes implemented behavior at the traceability commit. It owns the contracts listed below and does not turn adjacent implementation or future plans into current authority.

### In scope

- Docker image/build decisions and one-time/dev worker container creation.
- Worker labels, deterministic worktree and port-block metadata, compute limits, list/health/release/reap behavior.
- Aggregate read-only resource inventory and plan/apply cleanup coordination without merging underlying owners.

### Out of scope

- Deployment-slot lease semantics owned by SPC-CMP-002.
- Browser auth-template, profile, lease, and CDP semantics owned by SPC-CMP-003; aggregate cleanup only consumes their state and exemptions.
- Yielded-run scheduling, completion, and process-tree orchestration owned by SPC-ORCH-001; compute supplies an isolation boundary only.
- Git branch/worktree strategy, gateway lifecycle, or worker dev-auth policy.

## Current behavior

### Commands

- pibo compute spawn|dev spawn|rebuild|list|health|doctor|diagnostics|disk|release|reap and pibo compute pool delegation.
- pibo resources status|doctor|leases|reap; status is read-only and reap is dry-run unless --apply is explicit.

### Apis

- No network API is owned; exported TypeScript planning, parsing, rendering, and health functions are internal package surfaces.

### State

- Docker labels pibo.compute.role, createdAt, holder, worktree, worktreePath, portBlock, ttlSeconds, idleSeconds, lastUsedAt, cleanupState, dirtyReason, plus Ralph job/run labels.
- Resource policy defaults: memory 2g, memory-swap 2g, pids 512, shm 512m, init enabled, restart=no, json-file logs 10m x3.
- Worker lifecycle defaults: TTL 3600 seconds and idle 1800 seconds; resource-reaper state records last/next run and failures.

### Lifecycle

- Build or reuse image; create/preserve worktree; spawn labeled worker; inspect health/list state; release one worker or plan then apply bounded reap. Worktrees are never deleted by worker reap.

### Failure

- Docker-unavailable and disk-pressure states become diagnostics; dirty/OOM/stopped workers remain inspectable; aggregate cleanup continues browser planning when Docker planning fails; failed cleanup remains dirty/auditable.

### Security

- Exact labels, roots, profile exemptions, PID/process-group checks, resource limits, and explicit apply constrain cleanup. Broad home/profile/worktree deletion is forbidden.

### Compatibility

- health aliases doctor; diagnostics aliases disk; text and JSON keep stable worker/resource fields. The canonical ownership label is holder, not the legacy controller wording.

## Requirements and invariants

### Requirement: CMP-WORKER-001

Create one-time and dev workers with inspectable labels, preserved worktrees, deterministic port metadata, and bounded Docker policy.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/compute/docker.ts` — `buildWorkerDockerRunArgs`; `src/compute/docker.ts` — `buildDevWorkerDockerRunArgs`; `src/compute/docker.ts` — `createWorktree`; `src/compute/cli.ts` — `runComputeCli`
- Tests: `test/compute-resource-policy.test.mjs` — “one-time worker docker run args include resource policy and inspectable labels”; `test/compute-resource-policy.test.mjs` — “dev worker docker run args include resource policy labels worktree metadata and bounded logs”
- Failure/security boundary: Docker absence, pressure, dirty state, and failed cleanup remain inspectable; exact labels and preserved worktrees constrain lifecycle actions.
- Confidence: **high**

### Requirement: CMP-WORKER-002

Resolve and enforce CPU, memory, swap, pid, shared-memory, restart, log, TTL, and idle policy from documented defaults and overrides.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/compute/resource-policy.ts` — `resolveComputeResourcePolicy`; `src/compute/resource-policy.ts` — `buildDockerResourcePolicyArgs`; `src/compute/docker.ts` — `resolveComputeWorkerLifecycle`
- Tests: `test/compute-resource-policy.test.mjs` — “compute resource policy resolves safe defaults and documented env overrides”; `test/compute-resource-policy.test.mjs` — “compute worker lifecycle labels resolve safe defaults and env overrides”; `test/compute-resource-policy.test.mjs` — “docker resource policy args include memory pids shm init restart and log bounds”
- Failure/security boundary: Policy inputs are bounded and resolved from safe defaults; invalid or unsafe resource values must not widen the worker limits.
- Confidence: **high**

### Requirement: CMP-WORKER-003

Report aggregate compute/browser/reaper health while retaining each resource owner's identity and cleanup authority.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/compute/resource-health.ts` — `getComputeResourceHealth`; `src/resources/cli.ts` — `runResourcesCli`; `src/resources/reaper.ts` — `ResourceReaperService`
- Tests: `test/compute-resource-policy.test.mjs` — “compute resource health reports healthy read-only state with stable JSON fields”; `test/resources-cli.test.mjs` — “resource status and active browser-pool leases keep stable text and JSON fields”; `test/ralph-resource-visibility.test.mjs` — “Ralph CLI text and JSON expose concise retained and dirty resource state”
- Failure/security boundary: Aggregate status is read-only and retains the underlying compute, browser, and reaper ownership identities.
- Confidence: **high**

### Requirement: CMP-WORKER-004

Plan cleanup by default, require explicit apply, recheck mutable state, preserve worktrees, and honor exact active-profile/process exemptions.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/compute/docker.ts` — `buildComputeWorkerReapPlan`; `src/compute/docker.ts` — `applyComputeWorkerReapPlan`; `src/resources/lifecycle.ts` — `planResourceReap`; `src/resources/lifecycle.ts` — `applyResourceReapPlan`
- Tests: `test/compute-resource-policy.test.mjs` — “compute reap apply removes only selected containers and never deletes worktrees”; `test/resources-cli.test.mjs` — “resource reap dry-run aggregates browser, stale-file, and compute plans while preserving worktrees”; `test/resources-cli.test.mjs` — “unmanaged Chromium planning honors home scope, grace, and explicit exemptions before terminating process groups”
- Failure/security boundary: Reap is dry-run by default; apply requires an explicit flag, rechecks mutable state, honors exemptions, and never deletes worktrees.
- Confidence: **high**

## Interfaces and ownership

**Capability IDs:** pibo.compute.workers, pibo.compute.resource-lifecycle

**Public surfaces:**

- pibo compute spawn
- pibo compute dev spawn
- Docker worker labels
- compute resource-policy environment
- Docker run arguments
- pibo compute health|doctor
- pibo resources status|doctor|leases
- pibo compute reap
- pibo resources reap

Resource and run ownership remains split: deployment leases belong to the deployment-pool concept, browser leases belong to the browser-pool concept, and yielded-run orchestration belongs to the orchestration concept.

Related concepts:

- [/specs/compute/deployment-pool.md](/specs/compute/deployment-pool.md)
- [/specs/compute/browser-pools-and-leases.md](/specs/compute/browser-pools-and-leases.md)
- [/specs/orchestration/yielded-runs.md](/specs/orchestration/yielded-runs.md)
- [/specs/resources/native-and-curated-tools.md](/specs/resources/native-and-curated-tools.md)

## Failure and security behavior

- Docker-unavailable and disk-pressure states become diagnostics; dirty/OOM/stopped workers remain inspectable; aggregate cleanup continues browser planning when Docker planning fails; failed cleanup remains dirty/auditable.
- Exact labels, roots, profile exemptions, PID/process-group checks, resource limits, and explicit apply constrain cleanup. Broad home/profile/worktree deletion is forbidden.

## Known limits

- No live Docker inspect/spawn/release evidence was performed in this turn.
- The target source list includes browser-pool state for aggregate cleanup; the spec must cite it only as consumed state, not owned lease semantics.

## Reconciled stale claims

- Reject legacy controller as the canonical worker ownership label; current code uses pibo.compute.holder.
- Reject a six-command compute surface; pool, health/doctor, and diagnostics/disk are registered now.
- Reject aggregate reaper ownership of browser leases or worktrees; it consumes lease exemptions and never deletes worktrees.
- Reject compute ownership of yielded-run orchestration; only the execution isolation boundary belongs here.

## Verification and traceability

All source and named-test references are bound to Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. The traceability commit is evidence authority; it does not imply that a test, build, package, Docker, deployment-pool, browser/CDP, headful, PTY, gateway-restart, real-host/provider, Windows, or Pibo2 path passed. Focused execution and build/typecheck/package results are recorded in the implementation report.

Later validation commands:

- node --test test/compute-resource-policy.test.mjs test/resources-cli.test.mjs test/browser-pool-state.test.mjs test/ralph-resource-visibility.test.mjs
- npm run build
- pibo compute list --all --json && pibo compute health --json && pibo resources status --json && pibo resources reap --json
- pibo debug pty run --expect 'Commands:' -- pibo compute --help
