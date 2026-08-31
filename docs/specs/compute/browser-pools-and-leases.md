---
type: "Specification"
title: "Browser Pools, Auth Templates, and Leases"
description: "Defines the implemented browser pools, auth templates, and leases contract and its current ownership, security, compatibility, and verification boundaries."
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
    - id: "CMP-BROWSER-001"
      status: "implemented"
      sources:
        - path: src/tools/browser-pool.ts
          symbol: BrowserPoolState
        - path: src/tools/browser-pool.ts
          symbol: withBrowserPoolLock
        - path: src/tools/browser-pool.ts
          symbol: acquireBrowserPoolLease
        - path: src/tools/browser-pool.ts
          symbol: reapIdleBrowserPool
      tests:
        - path: test/browser-pool-state.test.mjs
          name: "browser pool lock serializes a successful mutation"
        - path: test/browser-pool-state.test.mjs
          name: "browser pool CDP health accepts /json/version and rejects malformed responses"
        - path: test/browser-pool-state.test.mjs
          name: "browser pool reap marks dirty when managed process cleanup fails"
      public:
        - "BrowserPoolState"
        - "pibo tools browser-use pool status|reap"
      failures:
        - "Lock timeout, identity mismatch, dead PID, unreachable CDP, busy lanes, and cleanup failures remain explicit stale/dirty state."
      confidence: high
    - id: "CMP-BROWSER-002"
      status: "implemented"
      sources:
        - path: src/tools/browser-use-leases.ts
          symbol: printBrowserUseAuthTemplateEnv
        - path: src/tools/browser-use-leases.ts
          symbol: assertTemplateIsNotRunning
        - path: src/tools/agent-browser-leases.ts
          symbol: printAgentBrowserAuthTemplateEnv
      tests:
        - path: test/tools-cli.test.mjs
          name: "pibo tools browser-use manages isolated authenticated leases"
      public:
        - "pibo tools browser-use auth-template path|env"
        - "pibo tools agent-browser auth-template path|env"
      failures:
        - "Templates must be closed before use and each acquired lease receives a private profile; live profiles are never shared."
      confidence: high
    - id: "CMP-BROWSER-003"
      status: "implemented"
      sources:
        - path: src/tools/browser-use-leases.ts
          symbol: acquireBrowserUseLease
        - path: src/tools/browser-use-leases.ts
          symbol: releaseBrowserUseLease
        - path: src/tools/browser-use-leases.ts
          symbol: reapStaleBrowserUseLeases
        - path: src/tools/agent-browser-leases.ts
          symbol: acquireAgentBrowserLease
        - path: src/tools/agent-browser-leases.ts
          symbol: releaseAgentBrowserLease
        - path: src/tools/agent-browser-leases.ts
          symbol: reapStaleAgentBrowserLeases
      tests:
        - path: test/tools-cli.test.mjs
          name: "pibo tools browser-use auth leases coordinate managed browser-pool leases"
        - path: test/browser-pool-state.test.mjs
          name: "browser pool acquire permits same-lease reuse and expired lease takeover"
      public:
        - "pibo tools browser-use lease acquire|list|release|reap-stale"
        - "pibo tools agent-browser lease acquire|list|release|reap-stale"
      failures:
        - "Leases are holder/session scoped; there is no general renew command, and stale or expired state is reclaimed only through explicit lifecycle operations."
      confidence: medium
    - id: "CMP-BROWSER-004"
      status: "implemented"
      sources:
        - path: src/tools/index.ts
          symbol: runToolsCli
        - path: src/tools/registry.ts
          symbol: listCliToolEntries
        - path: src/tools/browser-use-cdp.ts
          symbol: listBrowserUseCdpTargets
      tests:
        - path: test/tools-cli.test.mjs
          name: "pibo tools exposes agent-browser npm runtime, guide, wrapper, and helpers"
        - path: test/tools-cli.test.mjs
          name: "pibo tools browser-use lists Chrome targets without launching a browser"
        - path: test/tools-cli.test.mjs
          name: "browser-use target helpers prefer authenticated Chat targets with composers"
        - path: test/cdp-client.test.mjs
          name: "evaluateJson applies one deadline to setup, chunks, and cleanup"
      public:
        - "pibo tools browser-use"
        - "pibo tools agent-browser"
      failures:
        - "Discovery remains progressive and tool-specific; target helpers do not imply browser launch or shared-profile access."
      confidence: high
---
# Browser Pools, Auth Templates, and Leases

## Why

Browser automation needs private authenticated profiles and bounded lifecycle control while keeping Browser Use and Agent Browser contracts honest.

## Scope

This specification describes implemented behavior at the traceability commit. It owns the contracts listed below and does not turn adjacent implementation or future plans into current authority.

### In scope

- Browser pool state/locking/CDP health, Browser Use and Agent Browser installation wrappers, auth templates, isolated lease profiles, holder/session leases, targets, local desktop/display helpers.

### Out of scope

- Aggregate resource inventory and reap policy owned by SPC-CMP-001, which only consumes exemptions and cleanup results.
- Debug snapshots, scenarios, and acceptance interpretation owned by SPC-OP-002.
- Chat product authentication semantics owned by SPC-SEC-002; this spec copies a closed authenticated template into private profiles.
- Product renderer behavior or gateway lifecycle.

## Current behavior

### Commands

- pibo tools browser-use health|targets|attach-chat|pool status|pool reap|auth-template path|env|lease acquire|list|release|reap-stale; agent-browser exposes health|sessions|targets|attach-chat|auth-template path|env|lease acquire|list|release|reap-stale.

### Apis

- BrowserPoolState and acquireBrowserPoolLease/releaseBrowserPoolLease/reapIdleBrowserPool; Browser Use and Agent Browser lease functions; Browser Use CDP target listing/selection/attachment.

### State

- Pool states empty|ready|leased|stale|dirty guarded by filesystem lock; Browser Use and Agent Browser lease registries and private per-slot profile directories; local CDP/display metadata.

### Lifecycle

- Prepare and close an authenticated template; acquire by cloning a private profile and holder/session environment; reuse or replace one-lane browser state under lock; release bounded process/CDP/profile state; reap expired/stale/idle state.

### Failure

- Lock timeout, malformed identity, dead PID, unreachable CDP, busy lane, and failed process cleanup are explicit; cleanup failures retain stale/dirty state and next commands.

### Security

- Templates are never live shared profiles; cookies remain in private profile directories; CDP and displays bind locally; active profiles are exempt from aggregate reap; template transient locks are excluded.

### Compatibility

- Both curated tools share discover/install/doctor/guide/env concepts, but their subcommand surfaces are not identical. There is no explicit renew command: Browser Use reacquire refreshes a reusable lease; Agent Browser requires release/reap/reacquire.

## Requirements and invariants

### Requirement: CMP-BROWSER-001

Serialize pool mutations and persist identity, lifecycle, PID, CDP, lease, idle, and cleanup state with bounded health and cleanup.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/tools/browser-pool.ts` — `BrowserPoolState`; `src/tools/browser-pool.ts` — `withBrowserPoolLock`; `src/tools/browser-pool.ts` — `acquireBrowserPoolLease`; `src/tools/browser-pool.ts` — `reapIdleBrowserPool`
- Tests: `test/browser-pool-state.test.mjs` — “browser pool lock serializes a successful mutation”; `test/browser-pool-state.test.mjs` — “browser pool CDP health accepts /json/version and rejects malformed responses”; `test/browser-pool-state.test.mjs` — “browser pool reap marks dirty when managed process cleanup fails”
- Failure/security boundary: Lock timeout, identity mismatch, dead PID, unreachable CDP, busy lanes, and cleanup failures remain explicit stale/dirty state.
- Confidence: **high**

### Requirement: CMP-BROWSER-002

Create reusable closed auth templates and clone each lease into a private profile without sharing a live browser profile.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/tools/browser-use-leases.ts` — `printBrowserUseAuthTemplateEnv`; `src/tools/browser-use-leases.ts` — `assertTemplateIsNotRunning`; `src/tools/agent-browser-leases.ts` — `printAgentBrowserAuthTemplateEnv`
- Tests: `test/tools-cli.test.mjs` — “pibo tools browser-use manages isolated authenticated leases”
- Failure/security boundary: Templates must be closed before use and each acquired lease receives a private profile; live profiles are never shared.
- Confidence: **high**

### Requirement: CMP-BROWSER-003

Acquire, list, release, and stale-reap holder-scoped leases; describe renewal only where implemented by reusable Browser Use reacquisition.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/tools/browser-use-leases.ts` — `acquireBrowserUseLease`; `src/tools/browser-use-leases.ts` — `releaseBrowserUseLease`; `src/tools/browser-use-leases.ts` — `reapStaleBrowserUseLeases`; `src/tools/agent-browser-leases.ts` — `acquireAgentBrowserLease`; `src/tools/agent-browser-leases.ts` — `releaseAgentBrowserLease`; `src/tools/agent-browser-leases.ts` — `reapStaleAgentBrowserLeases`
- Tests: `test/tools-cli.test.mjs` — “pibo tools browser-use auth leases coordinate managed browser-pool leases”; `test/browser-pool-state.test.mjs` — “browser pool acquire permits same-lease reuse and expired lease takeover”
- Failure/security boundary: Leases are holder/session scoped; there is no general renew command, and stale or expired state is reclaimed only through explicit lifecycle operations.
- Confidence: **medium**

### Requirement: CMP-BROWSER-004

Expose both browser tools through progressive install, health, guide, environment, target, attach, template, and lease discovery while documenting intentional surface differences.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/tools/index.ts` — `runToolsCli`; `src/tools/registry.ts` — `listCliToolEntries`; `src/tools/browser-use-cdp.ts` — `listBrowserUseCdpTargets`
- Tests: `test/tools-cli.test.mjs` — “pibo tools exposes agent-browser npm runtime, guide, wrapper, and helpers”; `test/tools-cli.test.mjs` — “pibo tools browser-use lists Chrome targets without launching a browser”; `test/tools-cli.test.mjs` — “browser-use target helpers prefer authenticated Chat targets with composers”; `test/cdp-client.test.mjs` — “evaluateJson applies one deadline to setup, chunks, and cleanup”
- Failure/security boundary: Discovery remains progressive and tool-specific; target helpers do not imply browser launch or shared-profile access.
- Confidence: **high**

## Interfaces and ownership

**Capability IDs:** pibo.compute.browser-tools

**Public surfaces:**

- BrowserPoolState
- pibo tools browser-use pool status|reap
- pibo tools browser-use auth-template path|env
- pibo tools agent-browser auth-template path|env
- pibo tools browser-use lease acquire|list|release|reap-stale
- pibo tools agent-browser lease acquire|list|release|reap-stale
- pibo tools browser-use
- pibo tools agent-browser

The browser pool consumes product authentication templates but does not own product authentication, Web rendering, or debug evidence interpretation.

Related concepts:

- [/specs/compute/workers-and-resource-lifecycle.md](/specs/compute/workers-and-resource-lifecycle.md)
- [/specs/security/web-machine-and-dev-auth.md](/specs/security/web-machine-and-dev-auth.md)
- [/specs/operator/debug-web-and-pty.md](/specs/operator/debug-web-and-pty.md)

## Failure and security behavior

- Lock timeout, malformed identity, dead PID, unreachable CDP, busy lane, and failed process cleanup are explicit; cleanup failures retain stale/dirty state and next commands.
- Templates are never live shared profiles; cookies remain in private profile directories; CDP and displays bind locally; active profiles are exempt from aggregate reap; template transient locks are excluded.

## Known limits

- The synthesis source list omits src/tools/browser-pool.ts, wrappers, and desktop/display helpers that materially implement this target.
- Agent Browser does not expose Browser Use's explicit pool status/reap branch and has thinner focused lifecycle coverage.
- No authenticated headed lease/CDP validation was performed in this turn.

## Reconciled stale claims

- Reject explicit renew as a current command for either tool.
- Reject a no-warmup Browser Use acquire contract; current acquire warms the lease.
- Reject Browser Use as the only curated desktop browser tool; Agent Browser is registered.
- Reject an auth template as a shared live session; it must be closed and cloned.
- Reject aggregate compute ownership of browser lease semantics.

## Verification and traceability

All source and named-test references are bound to Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. The traceability commit is evidence authority; it does not imply that a test, build, package, Docker, deployment-pool, browser/CDP, headful, PTY, gateway-restart, real-host/provider, Windows, or Pibo2 path passed. Focused execution and build/typecheck/package results are recorded in the implementation report.

Later validation commands:

- node --test test/tools-cli.test.mjs test/browser-pool-state.test.mjs test/cdp-client.test.mjs
- npm run build
- pibo tools browser-use pool status --json && pibo tools browser-use lease list --json && pibo tools agent-browser lease list --json
- pibo tools browser-use targets --json && pibo tools agent-browser targets --json
