---
type: "Specification"
title: "Isolated Deployment Pool"
description: "Defines the implemented isolated deployment pool contract and its current ownership, security, compatibility, and verification boundaries."
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
    - id: "CMP-POOL-001"
      status: "implemented"
      sources:
        - path: src/compute/pool/store.ts
          symbol: DeploymentPoolStore
        - path: src/compute/pool/service.ts
          symbol: acquireDeployment
      tests:
        - path: test/compute-deployment-pool.test.mjs
          name: "deployment store reserves unique slots and enforces maxActive"
        - path: test/compute-deployment-pool.test.mjs
          name: "deployment pool config creates fixed slots and caps active count"
      public:
        - "deployment_pool_slots"
        - "deployment_pool_leases"
        - "pibo compute pool status|acquire"
      failures:
        - "Transactional reservation prevents duplicate active leases and enforces the configured maxActive bound."
      confidence: high
    - id: "CMP-POOL-002"
      status: "implemented"
      sources:
        - path: src/compute/pool/service.ts
          symbol: renewDeploymentLease
        - path: src/compute/pool/service.ts
          symbol: releaseDeploymentLease
        - path: src/compute/pool/service.ts
          symbol: planDeploymentPoolReap
        - path: src/compute/pool/service.ts
          symbol: applyDeploymentPoolReapPlan
      tests:
        - path: test/compute-deployment-pool.test.mjs
          name: "deployment reap selects expired leases and caps retained failures"
        - path: test/compute-deployment-pool.test.mjs
          name: "deployment reap reconciles missing and orphan containers and removes stale artifacts"
      public:
        - "pibo compute pool renew|release|reap"
      failures:
        - "Renew/release require holder identity; expiry, missing containers, dirty state, and failed cleanup remain explicit for retry."
      confidence: high
    - id: "CMP-POOL-003"
      status: "implemented"
      sources:
        - path: src/compute/pool/artifacts.ts
          symbol: ensureDeploymentArtifact
        - path: src/compute/pool/seeds.ts
          symbol: prepareDeploymentSeed
      tests:
        - path: test/compute-deployment-pool.test.mjs
          name: "installed runtime artifact digest covers the complete Pibo package"
        - path: test/compute-deployment-pool.test.mjs
          name: "seed modes provide full, medium, and fresh state with slot auth URL"
      public:
        - "pibo compute pool acquire --artifact|--runtime --seed"
        - "pibo compute pool artifacts|seed"
      failures:
        - "Exactly one runtime source is accepted; seed copying is allowlisted and excludes auth.sqlite, previews.sqlite, and transient secrets."
      confidence: high
    - id: "CMP-POOL-004"
      status: "implemented"
      sources:
        - path: src/compute/pool/service.ts
          symbol: getDeploymentPoolStatus
        - path: src/compute/pool/service.ts
          symbol: getDeploymentPoolDoctor
        - path: src/compute/pool/docker.ts
          symbol: buildDeploymentContainerArgs
      tests:
        - path: test/compute-deployment-pool.test.mjs
          name: "deployment container args use one image, loopback ports, isolated mounts, and no Docker socket"
      public:
        - "pibo compute pool status|doctor|artifacts --json"
        - "lease publicUrl"
      failures:
        - "Status and doctor expose bounded operational metadata only; isolated mounts and no Docker socket prevent broader host access."
      confidence: high
---
# Isolated Deployment Pool

## Why

Deployment previews need isolated, repeatable local slots with explicit lease ownership and reproducible runtime contents.

## Scope

This specification describes implemented behavior at the traceability commit. It owns the contracts listed below and does not turn adjacent implementation or future plans into current authority.

### In scope

- Fixed local deployment slots, exclusive holder leases, slot containers, exact runtime artifacts, seed modes, status/doctor, renewal/release/reap.

### Out of scope

- General worker lifecycle and aggregate resource reaping owned by SPC-CMP-001.
- Product authentication semantics owned by SPC-SEC-001; the pool only seeds allowed machine configuration and exposes slot URLs.
- Release/deployment promotion or Git orchestration.

## Current behavior

### Commands

- pibo compute pool status|acquire|renew|release|reap|doctor|artifacts|seed; acquire requires --holder and exactly one --artifact or --runtime; release requires matching --holder unless --force; reap defaults dry-run.

### Apis

- DeploymentPoolStore and service functions acquireDeployment, renewDeploymentLease, releaseDeploymentLease, planDeploymentPoolReap, applyDeploymentPoolReapPlan, getDeploymentPoolStatus, getDeploymentPoolDoctor.

### State

- pool.sqlite tables deployment_pool_slots and deployment_pool_leases; slot states free|provisioning|ready|releasing|dirty|quarantined; lease states provisioning|ready|releasing|released|failed|expired; seed modes full|medium|fresh.

### Lifecycle

- Reserve a free fixed slot transactionally; prepare exact artifact and allowlisted seed; create isolated loopback container; publish ready lease; holder-renew or release; plan/reconcile expired, missing, orphaned, dirty, failed, and stale-artifact state.

### Failure

- No free slot or maxActive breach fails acquisition; holder mismatch fails renew/release; reap caps retained failure snapshots and replans during apply; doctor reports bounded state.

### Security

- Pool directories/database are private; seed allowlists exclude auth.sqlite and previews.sqlite; containers use isolated mounts, loopback ports, exact labels, and no Docker socket.

### Compatibility

- Artifact identity is SHA-256 of the complete installed runtime/package; seed modes and public URL metadata are explicit. Machine auth wording must not imply pool-owned auth policy.

## Requirements and invariants

### Requirement: CMP-POOL-001

Persist a fixed slot inventory and reserve at most one active lease per slot under an exclusive transaction and max-active bound.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/compute/pool/store.ts` — `DeploymentPoolStore`; `src/compute/pool/service.ts` — `acquireDeployment`
- Tests: `test/compute-deployment-pool.test.mjs` — “deployment store reserves unique slots and enforces maxActive”; `test/compute-deployment-pool.test.mjs` — “deployment pool config creates fixed slots and caps active count”
- Failure/security boundary: Transactional reservation prevents duplicate active leases and enforces the configured maxActive bound.
- Confidence: **high**

### Requirement: CMP-POOL-002

Require holder-matched renewal/release, expire leases predictably, and reconcile expired, missing, orphaned, dirty, and failed resources through plan/apply reap.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/compute/pool/service.ts` — `renewDeploymentLease`; `src/compute/pool/service.ts` — `releaseDeploymentLease`; `src/compute/pool/service.ts` — `planDeploymentPoolReap`; `src/compute/pool/service.ts` — `applyDeploymentPoolReapPlan`
- Tests: `test/compute-deployment-pool.test.mjs` — “deployment reap selects expired leases and caps retained failures”; `test/compute-deployment-pool.test.mjs` — “deployment reap reconciles missing and orphan containers and removes stale artifacts”
- Failure/security boundary: Renew/release require holder identity; expiry, missing containers, dirty state, and failed cleanup remain explicit for retry.
- Confidence: **high**

### Requirement: CMP-POOL-003

Accept exactly one runtime source, identify it by complete artifact digest, and copy only the selected full, medium, or fresh seed allowlist.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/compute/pool/artifacts.ts` — `ensureDeploymentArtifact`; `src/compute/pool/seeds.ts` — `prepareDeploymentSeed`
- Tests: `test/compute-deployment-pool.test.mjs` — “installed runtime artifact digest covers the complete Pibo package”; `test/compute-deployment-pool.test.mjs` — “seed modes provide full, medium, and fresh state with slot auth URL”
- Failure/security boundary: Exactly one runtime source is accepted; seed copying is allowlisted and excludes auth.sqlite, previews.sqlite, and transient secrets.
- Confidence: **high**

### Requirement: CMP-POOL-004

Expose bounded status, doctor, artifact, slot URL, holder, expiry, and next-command metadata without granting broader host access.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/compute/pool/service.ts` — `getDeploymentPoolStatus`; `src/compute/pool/service.ts` — `getDeploymentPoolDoctor`; `src/compute/pool/docker.ts` — `buildDeploymentContainerArgs`
- Tests: `test/compute-deployment-pool.test.mjs` — “deployment container args use one image, loopback ports, isolated mounts, and no Docker socket”
- Failure/security boundary: Status and doctor expose bounded operational metadata only; isolated mounts and no Docker socket prevent broader host access.
- Confidence: **high**

## Interfaces and ownership

**Capability IDs:** pibo.compute.deployment-pool

**Public surfaces:**

- deployment_pool_slots
- deployment_pool_leases
- pibo compute pool status|acquire
- pibo compute pool renew|release|reap
- pibo compute pool acquire --artifact|--runtime --seed
- pibo compute pool artifacts|seed
- pibo compute pool status|doctor|artifacts --json
- lease publicUrl

Security owns authentication semantics; this pool only provisions an isolated local runtime and allowlisted seed data.

Related concepts:

- [/specs/compute/workers-and-resource-lifecycle.md](/specs/compute/workers-and-resource-lifecycle.md)
- [/specs/security/web-machine-and-dev-auth.md](/specs/security/web-machine-and-dev-auth.md)
- [/specs/product/home-workspace-configuration.md](/specs/product/home-workspace-configuration.md)

## Failure and security behavior

- No free slot or maxActive breach fails acquisition; holder mismatch fails renew/release; reap caps retained failure snapshots and replans during apply; doctor reports bounded state.
- Pool directories/database are private; seed allowlists exclude auth.sqlite and previews.sqlite; containers use isolated mounts, loopback ports, exact labels, and no Docker socket.

## Known limits

- The quarantined slot state is declared, but no focused test proves every transition into and out of quarantine.
- No real artifact install/container/URL path was executed in this turn.

## Reconciled stale claims

- Reject proposal/change-packet material as an active implementation plan.
- Reject broad environment/deployment management; this owner manages fixed local slots only.
- Reject machine auth as a pool-owned authentication scheme; SPC-SEC-001 owns authentication semantics.

## Verification and traceability

All source and named-test references are bound to Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. The traceability commit is evidence authority; it does not imply that a test, build, package, Docker, deployment-pool, browser/CDP, headful, PTY, gateway-restart, real-host/provider, Windows, or Pibo2 path passed. Focused execution and build/typecheck/package results are recorded in the implementation report.

Later validation commands:

- node --test test/compute-deployment-pool.test.mjs
- npm run build
- pibo compute pool status --json && pibo compute pool doctor --json && pibo compute pool artifacts --json
- pibo debug pty run --expect 'status' --expect 'acquire' -- pibo compute pool --help
