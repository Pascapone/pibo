---
type: Specification
title: Loop Jobs, Goals, and Ralph Compatibility
description: Defines the implemented loop jobs, goals, and ralph compatibility contract and its current ownership, security,
  compatibility, and verification boundaries.
tags:
- orchestration
- workflows
status: stable
authority: normative
generated:
  by: openai/codex
  at: '2026-08-30T09:44:54Z'
sources:
- resource: scope:Current implementation and tests at traceability.commit
  title: Foundation source and test evidence for SPC-ORCH-003
implementation:
  state: current
  baseline_commit: 38bb6e57f118c1543e7263c68d27e5103d3b1262
  package: WP-04-ORCHESTRATION
  source_evidence: performed
  focused_test_execution: performed in Docker after authoring; see implementation report
  build_and_typecheck_execution: performed in Docker after authoring; see implementation report
traceability:
  commit: 38bb6e57f118c1543e7263c68d27e5103d3b1262
  requirements:
  - id: ORCH-LOOP-001
    status: implemented
    sources:
    - path: src/loops/store.ts
      symbol: PiboLoopStore
    - path: src/loops/store.ts
      symbol: createDefaultPiboLoopStore
    - path: src/loops/service.ts
      symbol: PiboLoopService
    - path: src/loops/types.ts
      symbol: PiboLoopMode
    - path: src/loops/types.ts
      symbol: PiboGoalStatus
    - path: src/loops/types.ts
      symbol: PiboLoopRunStatus
    tests:
    - path: test/loop-goal-mode.test.mjs
      name: new loops default to goal while legacy rows load as ralph
    - path: test/loop-goal-mode.test.mjs
      name: goal mode reuses one Pibo Session while Ralph mode creates fresh sessions
    failures:
    - Targets and profiles are validated; unknown profile disables/fails instead of retrying forever.
    confidence: high
  - id: ORCH-LOOP-002
    status: implemented
    sources:
    - path: src/loops/tools.ts
      symbol: PIBO_GOAL_TOOL_NAMES
    - path: src/loops/tools.ts
      symbol: createPiboGoalToolDefinitions
    - path: src/loops/accounting.ts
      symbol: LOOP_TOKEN_ACCOUNTING_VERSION
    - path: src/loops/accounting.ts
      symbol: goalCanStartNextTurn
    - path: src/loops/accounting.ts
      symbol: goalBudgetTokens
    - path: src/loops/store.ts
      symbol: PiboLoopStore.reopenGoal
      owner: PiboLoopStore
      member: reopenGoal
    - path: src/loops/service.ts
      symbol: PiboLoopService.reopenGoal
      owner: PiboLoopService
      member: reopenGoal
    tests:
    - path: test/loop-goal-tools.test.mjs
      name: native goal tools create, inspect, complete, and replace a session goal
    - path: test/loop-goal-tools.test.mjs
      name: Goal reserve gates the next turn before the soft budget is exhausted
    - path: test/loop-goal-tools.test.mjs
      name: Goal budget token accounting follows the persisted basis
    - path: test/loop-goal-reopen.test.mjs
      name: operator reopen preserves Goal identity, accounting, history, and writes an audit fact
    - path: test/loop-goal-reopen.test.mjs
      name: operator reopen rejects active, queued, draining, orphaned, or unconsumed controller work
    failures:
    - Model tools cannot reopen; operator reopen requires confirmation/actor and rejects active, competing, or unconsumed
      controller work.
    confidence: high
  - id: ORCH-LOOP-003
    status: implemented
    sources:
    - path: src/cli.ts
      symbol: runPiboCli
    - path: src/gateway/web.ts
      symbol: createWebPiboPluginRegistry
    - path: src/apps/chat/loop-api.ts
      symbol: handleChatLoopApiRequest
    - path: src/ralph/service.ts
      symbol: PiboRalphService
    tests:
    - path: test/loop-goal-mode.test.mjs
      name: new loops default to goal while legacy rows load as ralph
    - path: test/ralph-stop-conditions.test.mjs
      name: Ralph store persists stop policies, state, and run facts
    failures:
    - Compatibility aliases do not create a second authority; direct src/ralph tests prove only that the remaining seam still
      functions in isolation.
    confidence: medium
  - id: ORCH-LOOP-004
    status: implemented
    sources:
    - path: src/loops/service.ts
      symbol: PiboLoopService
    - path: src/loops/service.ts
      symbol: retryBackoffMs
    - path: src/loops/store.ts
      symbol: PiboLoopStore.recoverInterruptedRuns
      owner: PiboLoopStore
      member: recoverInterruptedRuns
    - path: src/loops/store.ts
      symbol: normalizeLoopResourceMetadata
    - path: src/loops/stopping.ts
      symbol: evaluateLoopStopPolicy
    - path: src/loops/stopping.ts
      symbol: createBuiltInLoopStopConditions
    tests:
    - path: test/ralph-run-timeout.test.mjs
      name: Ralph aborts the session before completing an explicitly timed-out run
    - path: test/ralph-run-timeout.test.mjs
      name: Ralph disables the job when a timed-out session cannot be aborted
    - path: test/ralph-resource-cleanup.test.mjs
      name: Ralph cancel request aborts the active session and releases browser leases
    - path: test/ralph-resource-cleanup.test.mjs
      name: Ralph resource cleanup failure marks run and job metadata dirty
    - path: test/ralph-resource-cleanup.test.mjs
      name: Ralph interrupted-run recovery marks possible browser resources dirty
    failures:
    - Named tests exercise the remaining PiboRalphService, not PiboLoopService; current Loop behavior is source-grounded but
      needs direct regression coverage.
    confidence: medium
---
# Spec: Loop Jobs, Goals, and Ralph Compatibility


## Why

Continuous work has two intentionally different modes and a compatibility surface that must not be mistaken for two independent implementations.

## Goal

The common Loop store and registered Loop service define Goal and Ralph behavior, CLI/API aliases, accounting, recovery, stop/cancel, and resource settlement.

## Authority and ownership

- **Stable concept:** `SPC-ORCH-003`
- **Target path:** `docs/specs/orchestration/loops-goals-and-ralph.md`
- **Authority:** Foundation source and test evidence at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- **Normative owner:** This document owns the public surfaces and behavior listed below. Generic reliability schemas, product/session topology, gateway authorization, runtime adapters, resource policy, and Web rendering remain owned by their linked specifications.
- **Evidence rule:** Source and named-test locators are exact references to regular Git blobs at the Foundation commit. They identify evidence; they do not imply that real CLI, process, provider, browser, Windows, host-pressure, restart, or Pibo2 paths were executed.

## Public surfaces

- `pibo loop`
- `pibo ralph`
- `/api/chat/loops*`
- `/api/chat/loop*`
- `/api/chat/ralph*`
- `get_goal`
- `create_goal`
- `update_goal`
- `pibo_ralph_jobs`
- `pibo_ralph_runs`
- `pibo_ralph_run_facts`

## Current implemented contract

### Commands Api

Both CLI names route to runLoopCli; pibo ralph supplies Ralph defaults. Commands are status/list/add/edit/conditions/templates/policy show|set|clear/start/stop/cancel/remove/runs. The registered Web service/API is src/loops, with /loop and /ralph aliases normalized to /loops.

### State

Modes are goal and ralph. Goal status is active/paused/blocked/budget_limited/complete; run status is running/ok/error/cancelled. Goal mode reuses lastPiboSessionId; Ralph mode creates a fresh Pibo Session per run.

### Timeouts Reminders Recovery

Service defaults are 5 s polling, concurrency 2, no run timeout unless configured, exponential retry 5 s..5 min with 0.2 jitter, and interrupted-run recovery after 5 min. Goal causal preflight and reminder root binding reject terminal/paused/stale provenance.

### Goal Accounting

Goal tools are session/Goal-mode scoped. New goals use persisted uncached token accounting; legacy rows default to total. Soft budgets may include a final overshooting response; reserve gates the next turn. Recursive usage includes controller and descendants.

### Resource Failure

Stop is graceful; cancel aborts. Unknown profile is fatal. Retriable failures back off; non-retryable Goal failure blocks. Browser leases renew while active, release on clean settlement, and mark resources dirty on uncertain cleanup.

### Compatibility

The common Loop store still defaults to pibo-ralph.sqlite and pibo_ralph_* tables. src/ralph remains and has direct tests, but current CLI/gateway/Web registration uses src/loops; the seam is not removed.

## Scope

### In scope

- pibo loop
- pibo ralph
- /api/chat/loops*
- /api/chat/loop*
- /api/chat/ralph*
- get_goal
- create_goal
- update_goal
- pibo_ralph_jobs
- pibo_ralph_runs
- pibo_ralph_run_facts
- The current source-grounded behavior and its explicit limits.
- Cross-owner links needed to use the contract safely.

### Out of scope

- Unimplemented future workflow webhook or Cron triggers.
- A claim that manual traversal and separate dispatch primitives form a universal integrated, restart-resuming graph executor.
- Provider, browser, host, Windows, Pibo2, or real process-path guarantees not established by executed validation.

## Requirements

### Requirement: ORCH-LOOP-001

The common Loop store/service MUST persist jobs, runs, facts, modes, stop policy, accounting, message state, and resource metadata; Goal mode MUST reuse one Pibo Session and Ralph mode MUST create a fresh session per run.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at Foundation; execution status is recorded in the implementation report.

#### Current behavior and limits

Targets and profiles are validated; unknown profile disables/fails instead of retrying forever.

#### Acceptance evidence

- Exact source evidence:
  - `src/loops/store.ts:217` — `PiboLoopStore` (type_or_class)
  - `src/loops/store.ts:699` — `createDefaultPiboLoopStore` (exported_symbol)
  - `src/loops/service.ts:68` — `PiboLoopService` (type_or_class)
  - `src/loops/types.ts:5` — `PiboLoopMode` (type_or_class)
  - `src/loops/types.ts:6` — `PiboGoalStatus` (type_or_class)
  - `src/loops/types.ts:151` — `PiboLoopRunStatus` (type_or_class)
- Exact named tests:
  - `test/loop-goal-mode.test.mjs:12` — “new loops default to goal while legacy rows load as ralph”
  - `test/loop-goal-mode.test.mjs:309` — “goal mode reuses one Pibo Session while Ralph mode creates fresh sessions”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-LOOP-002

Goal tools MUST expose only get/create/update in an authorized Goal session; complete/blocked/budget_limited MUST stop continuation; blocked updates MUST follow the repeated-blocker contract; explicit confirmed operator reopen MUST preserve identity/session/history/accounting while starting a fresh blocked audit.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at Foundation; execution status is recorded in the implementation report.

#### Current behavior and limits

Model tools cannot reopen; operator reopen requires confirmation/actor and rejects active, competing, or unconsumed controller work.

#### Acceptance evidence

- Exact source evidence:
  - `src/loops/tools.ts:8` — `PIBO_GOAL_TOOL_NAMES` (constant)
  - `src/loops/tools.ts:211` — `createPiboGoalToolDefinitions` (exported_symbol)
  - `src/loops/accounting.ts:4` — `LOOP_TOKEN_ACCOUNTING_VERSION` (constant)
  - `src/loops/accounting.ts:142` — `goalCanStartNextTurn` (exported_symbol)
  - `src/loops/accounting.ts:118` — `goalBudgetTokens` (exported_symbol)
  - `src/loops/store.ts:274` — `PiboLoopStore.reopenGoal` (method)
  - `src/loops/service.ts:112` — `PiboLoopService.reopenGoal` (method)
- Exact named tests:
  - `test/loop-goal-tools.test.mjs:68` — “native goal tools create, inspect, complete, and replace a session goal”
  - `test/loop-goal-tools.test.mjs:184` — “Goal reserve gates the next turn before the soft budget is exhausted”
  - `test/loop-goal-tools.test.mjs:44` — “Goal budget token accounting follows the persisted basis”
  - `test/loop-goal-reopen.test.mjs:34` — “operator reopen preserves Goal identity, accounting, history, and writes an audit fact”
  - `test/loop-goal-reopen.test.mjs:95` — “operator reopen rejects active, queued, draining, orphaned, or unconsumed controller work”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-LOOP-003

pibo loop and pibo ralph MUST remain aliases over the registered common Loop CLI/service/API and shared pibo_ralph_* compatibility store; documentation MUST NOT present src/ralph as the registered implementation or claim that the legacy seam/database names were removed.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at Foundation; execution status is recorded in the implementation report.

#### Current behavior and limits

Compatibility aliases do not create a second authority; direct src/ralph tests prove only that the remaining seam still functions in isolation.

#### Acceptance evidence

- Exact source evidence:
  - `src/cli.ts:111` — `runPiboCli` (exported_symbol)
  - `src/gateway/web.ts:175` — `createWebPiboPluginRegistry` (exported_symbol)
  - `src/apps/chat/loop-api.ts:37` — `handleChatLoopApiRequest` (exported_symbol)
  - `src/ralph/service.ts:42` — `PiboRalphService` (type_or_class)
- Exact named tests:
  - `test/loop-goal-mode.test.mjs:12` — “new loops default to goal while legacy rows load as ralph”
  - `test/ralph-stop-conditions.test.mjs:21` — “Ralph store persists stop policies, state, and run facts”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-LOOP-004

The registered Loop service MUST distinguish graceful stop from aborting cancel, apply bounded optional timeout/retry policy, recover interrupted rows, and settle browser-resource metadata; uncertain abort or cleanup MUST become terminal/dirty state rather than an assumed clean success.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at Foundation; execution status is recorded in the implementation report.

#### Current behavior and limits

Named tests exercise the remaining PiboRalphService, not PiboLoopService; current Loop behavior is source-grounded but needs direct regression coverage.

#### Acceptance evidence

- Exact source evidence:
  - `src/loops/service.ts:68` — `PiboLoopService` (type_or_class)
  - `src/loops/service.ts:46` — `retryBackoffMs` (exported_symbol)
  - `src/loops/store.ts:607` — `PiboLoopStore.recoverInterruptedRuns` (method)
  - `src/loops/store.ts:48` — `normalizeLoopResourceMetadata` (exported_symbol)
  - `src/loops/stopping.ts:117` — `evaluateLoopStopPolicy` (exported_symbol)
  - `src/loops/stopping.ts:29` — `createBuiltInLoopStopConditions` (exported_symbol)
- Exact named tests:
  - `test/ralph-run-timeout.test.mjs:137` — “Ralph aborts the session before completing an explicitly timed-out run”
  - `test/ralph-run-timeout.test.mjs:152` — “Ralph disables the job when a timed-out session cannot be aborted”
  - `test/ralph-resource-cleanup.test.mjs:187` — “Ralph cancel request aborts the active session and releases browser leases”
  - `test/ralph-resource-cleanup.test.mjs:155` — “Ralph resource cleanup failure marks run and job metadata dirty”
  - `test/ralph-resource-cleanup.test.mjs:238` — “Ralph interrupted-run recovery marks possible browser resources dirty”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

## Ownership links

- [`adapter-contract.md`](/specs/runtime/adapter-contract.md)
- [`generation-resources-and-portable-tools.md`](/specs/runtime/generation-resources-and-portable-tools.md)
- [`provider-model-controls.md`](/specs/runtime/provider-model-controls.md)
- [`routing-events-and-actions.md`](/specs/gateway/routing-events-and-actions.md)
- [`web-host-and-channel.md`](/specs/gateway/web-host-and-channel.md)
- [`agents-and-profiles.md`](/specs/resources/agents-and-profiles.md)
- [`native-and-curated-tools.md`](/specs/resources/native-and-curated-tools.md)
- Web workflow rendering is a projection and interaction surface; it does not replace this package's durable facts.

## Verification boundary

- Source/test baseline: `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Focused inventory: 24 files / 245 top-level declarations; `test/web-channel.test.mjs` is separate cross-boundary evidence with 113 declarations.
- Requirement traceability: 25 unique requirements across six targets, 15 high confidence and 10 medium confidence, 138 source references, 75 named-test references / 74 unique names.
- This document is stable normative documentation of current behavior, not acceptance of future implementation work.
