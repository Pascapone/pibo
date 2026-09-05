---
type: Specification
title: Yielded Run Control and Isolation
description: Defines the implemented yielded run control and isolation contract and its current ownership, security, compatibility,
  and verification boundaries.
tags:
- orchestration
- workflows
status: stable
authority: normative
generated:
  by: openai-codex/gpt-5.6-sol
  at: '2026-09-05T08:51:15Z'
sources:
- resource: scope:Current implementation and tests at traceability.commit
  title: Integrated source and test evidence for SPC-ORCH-001
implementation:
  state: current
  baseline_commit: 14cbaf0fd04cfa321674b570baeb40e543d957cb
  package: WP-04-ORCHESTRATION
  source_evidence: performed
  test_execution: complete isolated root suite and 144 Workflow package tests passed
  build_and_typecheck_execution: clean full build and all typechecks passed
traceability:
  commit: 14cbaf0fd04cfa321674b570baeb40e543d957cb
  requirements:
  - id: ORCH-RUN-001
    status: implemented
    sources:
    - path: src/runs/tools.ts
      symbol: PIBO_RUN_TOOL_NAMES
    - path: src/runs/tools.ts
      symbol: createRunToolDefinitions
    - path: src/agent-runtime/routed-session.ts
      symbol: RUN_REMINDER_MAX_DURATION_MS
    - path: src/runs/tools.ts
      symbol: validateYieldedToolArguments
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.startToolRun
      owner: PiboRunRegistry
      member: startToolRun
    - path: src/runs/registry.ts
      symbol: PiboRunStatus
    - path: src/core/session-router.ts
      symbol: PiboSessionRouter
    tests:
    - path: test/runs.test.mjs
      name: run tools start yieldable tools with explicit completion policy
    - path: test/runs.test.mjs
      name: router rejects yielded runs when gateway resource block threshold is crossed
    - path: test/runs.test.mjs
      name: router enforces yielded-run concurrency per controlling session
    failures:
    - Unknown or invalid tools fail before work starts; admission limits are controller-scoped.
    confidence: high
  - id: ORCH-RUN-002
    status: implemented
    sources:
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.wait
      owner: PiboRunRegistry
      member: wait
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.read
      owner: PiboRunRegistry
      member: read
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.ack
      owner: PiboRunRegistry
      member: ack
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.createNotification
      owner: PiboRunRegistry
      member: createNotification
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.releaseNotification
      owner: PiboRunRegistry
      member: releaseNotification
    - path: src/runs/tools.ts
      symbol: createRunToolDefinitions
    tests:
    - path: test/runs.test.mjs
      name: wait returns timeout as normal state and resolves on completion
    - path: test/runs.test.mjs
      name: run read tool returns terminal text and full details
    - path: test/runs.test.mjs
      name: repeated acknowledgement of the same run state is a no-op
    - path: test/runs.test.mjs
      name: tracked notifications preserve their causal origin and do not mix origins
    - path: test/run-reminder-guard.test.mjs
      name: run-reminder turns keep the normal toolset and stop repeated identical tool loops via the bounded guard
    - path: test/runs.test.mjs
      name: router coalesces generic run completion into a compact parent notification
    failures:
    - Run IDs from another controller are rejected; failed reminder delivery only releases unchanged state for retry.
    confidence: high
  - id: ORCH-RUN-003
    status: implemented
    sources:
    - path: src/runs/lifecycle.ts
      symbol: PIBO_RUN_CANCELLATION_SETTLEMENT_TIMEOUT_MS
    - path: src/runs/lifecycle.ts
      symbol: waitForRunCancellationSettlement
    - path: src/runs/resource-isolation.ts
      symbol: prepareYieldedRunExecution
    - path: src/runs/resource-isolation.ts
      symbol: systemdRunCommand
    - path: src/runs/resource-isolation.ts
      symbol: windowsProcessTreeCommand
    - path: src/runs/resource-isolation.ts
      symbol: PiboRunResourceLimitError
    - path: src/core/session-router.ts
      symbol: PiboSessionRouter
    tests:
    - path: test/runs.test.mjs
      name: run cancellation fails visibly and stays non-cancelled when execution does not settle within 15 seconds
    - path: test/runs.test.mjs
      name: pibo_run_cancel aborts the active tool and releases admission before returning
    - path: test/yielded-run-resource-isolation.test.mjs
      name: explicit cancellation terminates the isolated process tree
    - path: test/yielded-run-resource-isolation.test.mjs
      name: Windows process-tree wrapper records the native Bash PID before user work
    failures:
    - A rejected/non-settling cancellation leaves the run non-cancelled and does not free the slot; unit/PID identity scopes
      process termination.
    confidence: high
  - id: ORCH-RUN-004
    status: implemented
    sources:
    - path: src/reliability/store.ts
      symbol: PiboReliabilityStore.recoverInterruptedRuns
      owner: PiboReliabilityStore
      member: recoverInterruptedRuns
    - path: src/reliability/store.ts
      symbol: PiboReliabilityStore.pruneRuns
      owner: PiboReliabilityStore
      member: pruneRuns
    - path: src/reliability/store.ts
      symbol: pibo_runs
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.constructor
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.listRecoveredRuns
      owner: PiboRunRegistry
      member: listRecoveredRuns
    - path: src/runs/registry.ts
      symbol: PiboRunRegistry.prune
      owner: PiboRunRegistry
      member: prune
    tests:
    - path: test/runs.test.mjs
      name: registry restores consumed terminal runs from the reliability store
    - path: test/runs.test.mjs
      name: registry prunes detached terminal and consumed tracked runs only
    failures:
    - Recovery skips runs protected by an unexpired foreign job claim; terminal effects are not re-emitted as execution.
    confidence: medium
---
# Spec: Yielded Run Control and Isolation


## Why

Long-running Pibo-owned tool work needs an explicit lifecycle that an agent can observe without confusing a bounded wait with execution expiry or releasing admission before work has settled.

## Goal

The registered yielded-run tools provide session-owned admission, observation, cancellation, recovery, and process isolation without claiming that every tool is an independently isolated process.

## Authority and ownership

- **Stable concept:** `SPC-ORCH-001`
- **Target path:** `docs/specs/orchestration/yielded-runs.md`
- **Authority:** Current integrated source and test evidence at `14cbaf0fd04cfa321674b570baeb40e543d957cb`.
- **Normative owner:** This document owns the public surfaces and behavior listed below. Generic reliability schemas, product/session topology, gateway authorization, runtime adapters, resource policy, and Web rendering remain owned by their linked specifications.
- **Evidence rule:** Source and named-test locators are exact references to regular Git blobs at the upstream/dev refresh commit. They identify evidence; they do not imply that real CLI, process, provider, browser, Windows, host-pressure, restart, or Pibo2 paths were executed.

## Public surfaces

- `pibo_run_start`
- `pibo_run_list`
- `pibo_run_status`
- `pibo_run_wait`
- `pibo_run_read`
- `pibo_run_cancel`
- `pibo_run_ack`
- `PiboRunStatus`
- `PiboRunRegistryEvent`
- `pibo_runs`

## Current implemented contract

### State

queued, running, completed, failed, timed_out, cancelled; tracked or detached completion policy; consumed terminal state is separate from status.

### Timeouts Reminders

wait clamps to 0..300000 ms and timeout is a non-error observation; configured execution expiry is timed_out with startup/lifetime phase; cancellation settlement is bounded at 15000 ms; tracked reminders remain causal, repeat until acknowledged/consumed, and are guarded without reducing the normal toolset. Reminder guidance states the autonomous turn's 15-minute wall-clock limit and directs the model to finish promptly without starting new subagents, yielded runs, or other long-running work.

### Recovery Failure

On registry construction, expired interrupted runs become timed_out; retryable multi-attempt runs return to queued; non-retryable runs fail. Only consumed tracked terminal and detached terminal rows are TTL-pruned (5 minutes and 1 minute by default).

### Security Compatibility

Controller Pibo Session ownership gates all run-ID operations. Admission is gateway-resource and per-controller bounded. Only yielded Bash-like process work receives systemd/Windows process-tree wrapping; cancellation must not reach unrelated processes.

## Scope

### In scope

- pibo_run_start
- pibo_run_list
- pibo_run_status
- pibo_run_wait
- pibo_run_read
- pibo_run_cancel
- pibo_run_ack
- PiboRunStatus
- PiboRunRegistryEvent
- pibo_runs
- The current source-grounded behavior and its explicit limits.
- Cross-owner links needed to use the contract safely.

### Out of scope

- Unimplemented future workflow webhook or Cron triggers.
- A claim that manual traversal and separate dispatch primitives form a universal integrated, restart-resuming graph executor.
- Provider, browser, host, Windows, Pibo2, or real process-path guarantees not established by executed validation.

## Requirements

### Requirement: ORCH-RUN-001

The runtime MUST validate a registered yieldable target before admission, create a session-owned persisted run, enforce gateway and per-controller concurrency, and expose it through the seven pibo_run_* tools.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Unknown or invalid tools fail before work starts; admission limits are controller-scoped.

#### Acceptance evidence

- Exact source evidence:
  - `src/runs/tools.ts:16` — `PIBO_RUN_TOOL_NAMES` (constant)
  - `src/runs/tools.ts:109` — `createRunToolDefinitions` (exported_symbol)
  - `src/runs/tools.ts:89` — `validateYieldedToolArguments` (exported_symbol)
  - `src/runs/registry.ts:200` — `PiboRunRegistry.startToolRun` (method)
  - `src/runs/registry.ts:7` — `PiboRunStatus` (type_or_class)
  - `src/core/session-router.ts:541` — `PiboSessionRouter` (type_or_class)
- Exact named tests:
  - `test/runs.test.mjs:391` — “run tools start yieldable tools with explicit completion policy”
  - `test/runs.test.mjs:973` — “router rejects yielded runs when gateway resource block threshold is crossed”
  - `test/runs.test.mjs:1046` — “router enforces yielded-run concurrency per controlling session”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-RUN-002

Wait MUST be a bounded non-consuming observation, read MUST return terminal text/details and consume tracked terminal state, ack MUST be idempotent for unchanged state, and tracked reminders MUST preserve causal origin until acknowledged or consumed while stating the 15-minute autonomous-turn limit and deferring new long-running work.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Run IDs from another controller are rejected; failed reminder delivery only releases unchanged state for retry.

#### Acceptance evidence

- Exact source evidence:
  - `src/runs/registry.ts:358` — `PiboRunRegistry.wait` (method)
  - `src/runs/registry.ts:390` — `PiboRunRegistry.read` (method)
  - `src/runs/registry.ts:422` — `PiboRunRegistry.ack` (method)
  - `src/runs/registry.ts:455` — `PiboRunRegistry.createNotification` (method)
  - `src/runs/registry.ts:490` — `PiboRunRegistry.releaseNotification` (method)
  - `src/runs/tools.ts:109` — `createRunToolDefinitions` (exported_symbol)
- Exact named tests:
  - `test/runs.test.mjs:119` — “wait returns timeout as normal state and resolves on completion”
  - `test/runs.test.mjs:800` — “run read tool returns terminal text and full details”
  - `test/runs.test.mjs:91` — “repeated acknowledgement of the same run state is a no-op”
  - `test/runs.test.mjs:67` — “tracked notifications preserve their causal origin and do not mix origins”
  - `test/run-reminder-guard.test.mjs:19` — “run-reminder turns keep the normal toolset and stop repeated identical tool loops via the bounded guard”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-RUN-003

Cancellation MUST target the exact live execution, wait for process/subagent settlement before committing cancelled state or releasing admission, and report a visible failure if settlement does not complete within 15000 ms.

**Confidence:** `high`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

A rejected/non-settling cancellation leaves the run non-cancelled and does not free the slot; unit/PID identity scopes process termination.

#### Acceptance evidence

- Exact source evidence:
  - `src/runs/lifecycle.ts:3` — `PIBO_RUN_CANCELLATION_SETTLEMENT_TIMEOUT_MS` (constant)
  - `src/runs/lifecycle.ts:26` — `waitForRunCancellationSettlement` (exported_symbol)
  - `src/runs/resource-isolation.ts:151` — `prepareYieldedRunExecution` (exported_symbol)
  - `src/runs/resource-isolation.ts:352` — `systemdRunCommand` (exported_symbol)
  - `src/runs/resource-isolation.ts:219` — `windowsProcessTreeCommand` (exported_symbol)
  - `src/runs/resource-isolation.ts:80` — `PiboRunResourceLimitError` (type_or_class)
  - `src/core/session-router.ts:541` — `PiboSessionRouter` (type_or_class)
- Exact named tests:
  - `test/runs.test.mjs:479` — “run cancellation fails visibly and stays non-cancelled when execution does not settle within 15 seconds”
  - `test/runs.test.mjs:1175` — “pibo_run_cancel aborts the active tool and releases admission before returning”
  - `test/yielded-run-resource-isolation.test.mjs:108` — “explicit cancellation terminates the isolated process tree”
  - `test/yielded-run-resource-isolation.test.mjs:75` — “Windows process-tree wrapper records the native Bash PID before user work”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

### Requirement: ORCH-RUN-004

Startup recovery MUST deterministically classify interrupted persisted runs, and pruning MUST retain active and unconsumed tracked terminal runs while removing only eligible consumed/detached terminal records after their TTL.

**Confidence:** `medium`. **Current evidence:** source inspection and named-test source inspection at upstream/dev refresh; execution status is recorded in the implementation report.

#### Current behavior and limits

Recovery skips runs protected by an unexpired foreign job claim; terminal effects are not re-emitted as execution.

#### Acceptance evidence

- Exact source evidence:
  - `src/reliability/store.ts:892` — `PiboReliabilityStore.recoverInterruptedRuns` (method)
  - `src/reliability/store.ts:871` — `PiboReliabilityStore.pruneRuns` (method)
  - `src/reliability/store.ts:245` — `pibo_runs` (schema_identifier)
  - `src/runs/registry.ts:184` — `PiboRunRegistry.constructor` (constructor)
  - `src/runs/registry.ts:196` — `PiboRunRegistry.listRecoveredRuns` (method)
  - `src/runs/registry.ts:523` — `PiboRunRegistry.prune` (method)
- Exact named tests:
  - `test/runs.test.mjs:263` — “registry restores consumed terminal runs from the reliability store”
  - `test/runs.test.mjs:291` — “registry prunes detached terminal and consumed tracked runs only”
- Acceptance must preserve the stated failure/security limit and must not promote unexecuted evidence classes to verified behavior.

## Ownership links

- [`reliability.md`](/specs/data/reliability.md)
- [`sessions-and-runtime-bindings.md`](/specs/data/sessions-and-runtime-bindings.md)
- [`gateway-admission-and-restart.md`](/specs/security/gateway-admission-and-restart.md)
- [`private-files-and-http.md`](/specs/security/private-files-and-http.md)
- [`web-machine-and-dev-auth.md`](/specs/security/web-machine-and-dev-auth.md)
- Web workflow rendering is a projection and interaction surface; it does not replace this package's durable facts.

## Verification boundary

- Source/test baseline: `14cbaf0fd04cfa321674b570baeb40e543d957cb`.
- The clean full build, all typechecks, all 144 Workflow package tests, and complete isolated root suite passed. The root suite reported 2,744 tests: 2,739 passed, 0 failed, and 5 skipped; exit 0.
- Manual editor headful QA remains underway. General graph restart execution, joins, webhooks, and scheduled triggers remain known gaps.

## Package-wide reconciliation appendix

This appendix applies to all six WP-04 specifications. It records the corrections and stale-claim/evidence boundaries carried forward from the independent rebound readiness audit.

### Corrections required and applied

#### CORR-001 — blocking

- **Finding:** All package briefs and synthesis reports were generated against 2aef244301f5d181624662fdad53e18e83e80bd9, not upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2.
- **Reconciliation:** Current traceability is rebound to integrated commit `14cbaf0fd04cfa321674b570baeb40e543d957cb`; the older refresh commit remains historical audit context only.

#### CORR-002 — blocking

- **Finding:** The brief uses 28 dotted class-qualified source labels such as PiboRunRegistry.startToolRun as if each were a single literal symbol.
- **Reconciliation:** Represent each as an exact owner plus exact member/method, with the source file and definition locator; do not use composite strings as literal probes.

#### CORR-003 — blocking

- **Finding:** The brief says the orchestration package owns reliability records while accepted WP-02 owns the generic reliability store and durable run-state contract.
- **Reconciliation:** ORCH-001 owns yielded-run orchestration behavior and consumes reliability persistence; SPC-DATA-004 remains the normative owner of generic reliability schemas, streams, jobs, leases, and durable run persistence.

#### CORR-004 — material

- **Finding:** The synthesis inventory and brief count do not identify the same test set: the synthesis includes test/agent-delegation-cards.test.mjs, while the requirement matrix does not; the matrix includes test/web-channel.test.mjs as a cross-boundary reference.
- **Reconciliation:** Use 24 focused inventory files with 245 top-level test/it declarations, including agent-delegation-cards, and separately record web-channel.test.mjs with 113 declarations as cross-boundary evidence. Keep 75 requirement-level named references (74 unique names).

#### CORR-005 — material

- **Finding:** The brief claims “24 cited test files containing 245 declared cases; 1 additional cross-boundary file,” but its JSON cited test paths omit agent-delegation-cards and include web-channel.
- **Reconciliation:** Use the corrected inventory distinction above; do not treat web-channel as part of the 24 focused orchestration files.

#### CORR-006 — material

- **Finding:** ORCH-LOOP-004 uses timeout/resource named tests targeting the remaining PiboRalphService seam rather than the registered PiboLoopService.
- **Reconciliation:** Keep confidence medium and weaken the claim to source-grounded registered Loop behavior plus compatibility-seam tests; add direct PiboLoopService parity tests before claiming tested parity.

#### CORR-007 — material

- **Finding:** ORCH-WF-004 cites workflow-manual-trigger-recovery.test.mjs, whose name proves final message completion handling, not process-restart recovery.
- **Reconciliation:** Describe it as final-output/message_finished evidence only; do not claim crash or process-restart resumption.

#### CORR-008 — material

- **Finding:** ORCH-WFP-004 project human-action resolution does not validate payloads against token.schema.
- **Reconciliation:** State the exact validation limit and do not claim token-schema enforcement in the project service.

#### CORR-009 — material

- **Finding:** The workflow runtime evidence does not establish one integrated arbitrary-graph executor or restart-resuming executor across all durable record classes.
- **Reconciliation:** Limit the current contract to the manual traversal and separate node/retry/state/wait primitives that source and tests establish; move future executor work to plans.

#### CORR-010 — material

- **Finding:** Cron execution timeout currently times out only the waiter and does not abort the created Pibo Session.
- **Reconciliation:** Record this as current behavior and an open gap; do not promise execution cancellation on waiter timeout.

#### CORR-011 — material

- **Finding:** A failed one-shot at schedule remains enabled without nextRunAt.
- **Reconciliation:** Record this counterexample explicitly; do not state that every enabled Cron job has a nextRunAt.

#### CORR-012 — material

- **Finding:** The current Loop registration path is src/loops and the common store retains pibo_ralph_* compatibility names; src/ralph is not the registered product authority.
- **Reconciliation:** Document pibo loop/pibo ralph as aliases over the common Loop service and label src/ralph as a remaining compatibility seam.

#### CORR-013 — material

- **Finding:** XState/UI output is a projection, not execution truth.
- **Reconciliation:** Keep durable kernel facts authoritative and state exposesPrivatePayloads=false; never describe XState as the workflow executor.

#### CORR-014 — material

- **Finding:** The F-028 readiness material says “35 target files” for the accepted WP-01/WP-02 plus WP-03/WP-04 scope, but the arithmetic is 11+9+8+6=34 concept files.
- **Reconciliation:** Plan 34 temporary concept records for those four packages; separately count reserved indexes and do not fold them into target concept count.

### Stale-claim rejections

1. Ralph is the current independently registered scheduler/service. Current pibo loop, pibo ralph, Web aliases, and gateway startup use src/loops.
2. Ralph mode is synonymous with Goal mode. Goal reuses one Pibo Session and uses native goal status; Ralph compatibility mode creates fresh run sessions and retains completion-marker/stop-policy semantics.
3. The pibo_ralph_* tables or pibo-ralph.sqlite prove the old Ralph service is authoritative. They are compatibility names used by the common Loop store.
4. The src/ralph seam has been removed. It remains in source and direct tests, but is not the currently registered path.
5. Parent turn completion, pibo_run_wait timeout, or stale subagent telemetry cancels child work. They do not.
6. A run reminder is an autonomous recovery turn. The normal toolset remains available; the guidance defers new long-running work, and a separate bounded guard ends repetitive reminder turns.
7. Every enabled Cron job always has nextRunAt. A failed at job remains enabled with no nextRunAt in current settlement code.
8. Cron timeout aborts the created Pibo Session. Current code times out only the waiter and records an error.
9. Workflow XState is execution truth. It is a derived inspection projection; the kernel/store facts are authoritative.
10. The workflow package has one integrated executor that durably resumes arbitrary graphs after restart. Current evidence shows a bounded manual agent traversal plus separate node dispatch primitives and durable records.
11. workflow-manual-trigger-recovery.test.mjs proves general process-restart graph recovery. It verifies bounded manual traversal, ordinary Session routing, final-message behavior, and canonical runtime persistence, not a universal restart-resuming executor.
12. Configured Workflow Session start executes the Workflow. The current start slice creates one canonical `pending` Run and explicitly reports that general graph execution is not connected to this surface.
13. The storage service alone proves complete human-action payload validation. Session-scoped API validation must enforce the wait-token schema before the canonical store resolves an action.
14. Future workflow webhook or Cron triggers are current. No registered runtime slices exist; they belong in plans.

### Open evidence gaps

- **GAP-ORCH-001 — Yielded runs:** Real systemd cgroup limits, Windows process-tree termination, and host-pressure admission remain unperformed; systemd tests are conditionally skipped when unavailable.
- **GAP-ORCH-002 — Subagents:** No executed cross-runtime/provider integration in this brief; test source only was inspected.
- **GAP-ORCH-003 — Loop/Goal/Ralph:** Timeout/resource-cleanup tests named by the synthesis import src/ralph, while current registration uses src/loops. Add direct PiboLoopService parity tests before high confidence.
- **GAP-ORCH-004 — Loop/Goal/Ralph:** Operator/API flow and real provider/browser-lease endurance checks remain unperformed; scripts/goal-endurance-check.mjs was inspected only.
- **GAP-ORCH-005 — Cron:** Current run timeout does not abort the Pibo Session, and failed at jobs remain enabled without nextRunAt; decide whether to preserve or change these contracts in a plan.
- **GAP-ORCH-006 — Workflow runtime:** No general integrated graph executor/restart resumption is evidenced across persisted checkpoints, wakeups, waits, retries, joins, and all node kinds.
- **GAP-ORCH-007 — Workflow registry:** Implicit latest published version uses localeCompare rather than semantic-version ordering; the intended compatibility contract is not explicit.
- **GAP-ORCH-008 — Workflow product:** Focused store/API tests, all 144 Workflow package tests, the complete isolated root suite, build, and typechecks passed at `14cbaf0fd04cfa321674b570baeb40e543d957cb`; manual editor headful QA remains underway.
- **GAP-ORCH-009 — Session execution:** configured Session start persists one pending canonical Run but does not execute the graph; general execution remains planned.
- **GAP-ORCH-010 — Future triggers:** No registered webhook/Cron workflow trigger slices exist; do not include them in current specifications.

### F-028 scope control

- The temporary F-028 validation plan uses 34 concept records: accepted WP-01 (11), accepted WP-02 (9), proposed WP-03 (8), and proposed WP-04 (6).
- It reserves 10 indexes in scratch, with 3 new for WP-03/WP-04; indexes, ledgers, logs, manifests, and reports are not package deliverables.
- WP-03 acceptance is represented by the actual parent of this branch, not by the earlier candidate SHA.
