---
type: "Specification"
title: "Reliability Streams, Jobs, and Durable Run State"
description: "Defines the implemented reliability streams, jobs, and durable run state contract and its current ownership boundaries."
tags: ["data", "reliability"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T06:15:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "WP02-DATA-REL-001"
      status: "implemented"
      sources:
        - path: "src/reliability/store.ts"
          symbol: "PiboReliabilityStore"
        - path: "src/reliability/store.ts"
          symbol: "append"
        - path: "src/reliability/store.ts"
          symbol: "appendOnce"
        - path: "src/reliability/store.ts"
          symbol: "readFromConsumer"
        - path: "src/reliability/store.ts"
          symbol: "saveConsumerOffset"
      tests:
        - path: "test/reliability-store.test.mjs"
          name: "event stream appendOnce is idempotent by event id and idempotency key"
        - path: "test/reliability-store.test.mjs"
          name: "consumer offsets are monotonic and replay is cursor based"
        - path: "test/reliability-store.test.mjs"
          name: "retention preserves rows still needed by named consumers"
      failures:
        - "Claims require exact worker ownership and unexpired leases for heartbeat/ack/retry/fail."
        - "Run lookup and mutation are scoped by controller Pibo Session ID."
        - "Wait is bounded; cancellation tooling waits up to 15 seconds for execution settlement before committing cancellation."
      confidence: "high"
    - id: "WP02-DATA-REL-002"
      status: "implemented"
      sources:
        - path: "src/reliability/store.ts"
          symbol: "PiboReliabilityStore"
        - path: "src/reliability/store.ts"
          symbol: "claimBatch"
        - path: "src/reliability/store.ts"
          symbol: "claimJob"
        - path: "src/reliability/store.ts"
          symbol: "heartbeat"
        - path: "src/reliability/store.ts"
          symbol: "ack"
        - path: "src/reliability/store.ts"
          symbol: "retry"
        - path: "src/reliability/store.ts"
          symbol: "fail"
        - path: "src/reliability/store.ts"
          symbol: "requeueDead"
      tests:
        - path: "test/reliability-store.test.mjs"
          name: "job claims are exclusive, retry backs off, and exhausted retry moves to DLQ"
        - path: "test/reliability-store.test.mjs"
          name: "expired claim cannot ack and DLQ replay creates a new live job"
      failures:
        - "Claims require exact worker ownership and unexpired leases for heartbeat/ack/retry/fail."
        - "Run lookup and mutation are scoped by controller Pibo Session ID."
        - "Wait is bounded; cancellation tooling waits up to 15 seconds for execution settlement before committing cancellation."
      confidence: "high"
    - id: "WP02-DATA-REL-003"
      status: "implemented"
      sources:
        - path: "src/runs/registry.ts"
          symbol: "PiboRunRegistry"
        - path: "src/runs/registry.ts"
          symbol: "startToolRun"
        - path: "src/runs/registry.ts"
          symbol: "complete"
        - path: "src/runs/registry.ts"
          symbol: "fail"
        - path: "src/runs/registry.ts"
          symbol: "timeOut"
        - path: "src/runs/registry.ts"
          symbol: "cancel"
        - path: "src/runs/registry.ts"
          symbol: "status"
        - path: "src/reliability/store.ts"
          symbol: "PiboReliabilityStore"
        - path: "src/reliability/store.ts"
          symbol: "createRun"
        - path: "src/reliability/store.ts"
          symbol: "updateRun"
        - path: "src/runs/lifecycle.ts"
          symbol: "PIBO_RUN_CANCELLATION_SETTLEMENT_TIMEOUT_MS"
        - path: "src/runs/lifecycle.ts"
          symbol: "waitForRunCancellationSettlement"
      tests:
        - path: "test/runs.test.mjs"
          name: "repeated acknowledgement of the same run state is a no-op"
        - path: "test/runs.test.mjs"
          name: "registry enumerates active controller runs and commits cancellation only when requested"
        - path: "test/runs.test.mjs"
          name: "cancel wins over a late complete"
        - path: "test/runs.test.mjs"
          name: "run cancellation fails visibly and stays non-cancelled when execution does not settle within 15 seconds"
      failures:
        - "Claims require exact worker ownership and unexpired leases for heartbeat/ack/retry/fail."
        - "Run lookup and mutation are scoped by controller Pibo Session ID."
        - "Wait is bounded; cancellation tooling waits up to 15 seconds for execution settlement before committing cancellation."
      confidence: "high"
    - id: "WP02-DATA-REL-004"
      status: "implemented"
      sources:
        - path: "src/runs/registry.ts"
          symbol: "PiboRunRegistry"
        - path: "src/runs/registry.ts"
          symbol: "createNotification"
        - path: "src/runs/registry.ts"
          symbol: "releaseNotification"
        - path: "src/runs/registry.ts"
          symbol: "read"
        - path: "src/runs/registry.ts"
          symbol: "ack"
        - path: "src/runs/registry.ts"
          symbol: "hasPendingNotification"
      tests:
        - path: "test/runs.test.mjs"
          name: "tracked runs create compact notifications until consumed"
        - path: "test/runs.test.mjs"
          name: "tracked notifications preserve their causal origin and do not mix origins"
        - path: "test/runs.test.mjs"
          name: "detached runs are inspectable but do not notify"
        - path: "test/runs.test.mjs"
          name: "ack suppresses current-state reminders and terminal ack consumes"
      failures:
        - "Claims require exact worker ownership and unexpired leases for heartbeat/ack/retry/fail."
        - "Run lookup and mutation are scoped by controller Pibo Session ID."
        - "Wait is bounded; cancellation tooling waits up to 15 seconds for execution settlement before committing cancellation."
      confidence: "high"
    - id: "WP02-DATA-REL-005"
      status: "implemented"
      sources:
        - path: "src/reliability/store.ts"
          symbol: "PiboReliabilityStore"
        - path: "src/reliability/store.ts"
          symbol: "recoverInterruptedRuns"
        - path: "src/reliability/store.ts"
          symbol: "pruneRuns"
        - path: "src/runs/registry.ts"
          symbol: "PiboRunRegistry"
        - path: "src/runs/registry.ts"
          symbol: "prune"
        - path: "src/data/sqlite-schema.ts"
          symbol: "sqliteTableColumns"
      tests:
        - path: "test/reliability-store.test.mjs"
          name: "recoverInterruptedRuns reconciles an unexpired claim owned by a previous runtime"
        - path: "test/reliability-store.test.mjs"
          name: "recoverInterruptedRuns classifies an elapsed run deadline after restart"
        - path: "test/reliability-store.test.mjs"
          name: "recoverInterruptedRuns queues retryable expired runs and makes their jobs claimable"
        - path: "test/runs.test.mjs"
          name: "registry prunes detached terminal and consumed tracked runs only"
      failures:
        - "Claims require exact worker ownership and unexpired leases for heartbeat/ack/retry/fail."
        - "Run lookup and mutation are scoped by controller Pibo Session ID."
        - "Wait is bounded; cancellation tooling waits up to 15 seconds for execution settlement before committing cancellation."
      confidence: "high"
---

# Scope

pibo-events.sqlite stream, consumer, job, dead-job, and run records; atomic claims; monotonic run settlement; notification/read/ack state; restart reconciliation.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: pibo_event_stream; pibo_event_consumers; pibo_jobs; pibo_dead_jobs; pibo_runs; inline payload_json/result_json; run states queued/running/completed/failed/timed_out/cancelled; tracked/detached completion policy.
- Routes and protocols: No HTTP route or external wire protocol is owned.
- State transitions: appendOnce deduplicates by event ID/idempotency key and stream IDs are monotonic. Consumer offsets advance by MAX and prune preserves rows needed by named consumers unless destructive behavior is explicit. Jobs move pending to leased running, then ack/retry/fail; exhausted work enters DLQ and replay creates a new live job. Run terminal transitions are guarded; cancel wins over late complete; tracked terminal ack consumes notifications. Restart recovery preserves valid claims, times out elapsed deadlines, retries retryable expired runs, and fails non-retryable expired runs.
- Failure and security: Claims require exact worker ownership and unexpired leases for heartbeat/ack/retry/fail. Run lookup and mutation are scoped by controller Pibo Session ID. Wait is bounded; cancellation tooling waits up to 15 seconds for execution settlement before committing cancellation.
- Compatibility: Tracked runs notify until consumed; detached runs remain inspectable without notifications. Pruning removes only detached terminal or consumed tracked runs after TTL.

# Requirements and invariants

## Requirement: WP02-DATA-REL-001

Reliability events SHALL append in monotonic order and deduplicate by event ID or idempotency key; consumer offsets SHALL never move backward.

## Requirement: WP02-DATA-REL-002

Job claims SHALL be atomic and lease/worker exact; retry backoff, exhaustion, DLQ, and replay SHALL be durable.

## Requirement: WP02-DATA-REL-003

Run state SHALL be controller-session scoped, monotonic, and idempotent; terminal cancel SHALL win over late completion and cancellation SHALL commit only after bounded execution settlement.

## Requirement: WP02-DATA-REL-004

Tracked notification state SHALL preserve causal origin, remain repeatable until acknowledgment, and become consumed on terminal read/ack; detached runs SHALL not notify.

## Requirement: WP02-DATA-REL-005

Restart reconciliation and cleanup SHALL classify deadline/retry outcomes without regressing terminal state; pruning SHALL retain unconsumed tracked runs.

# Interfaces and ownership

Capability IDs: `pibo.data.reliability`.

Implemented public contracts:

- `PiboReliabilityStore.append`
- `PiboReliabilityStore.appendOnce`
- `PiboReliabilityStore.readFromConsumer`
- `PiboReliabilityStore.saveConsumerOffset`
- `PiboReliabilityStore.claimBatch`
- `PiboReliabilityStore.claimJob`
- `PiboReliabilityStore.heartbeat`
- `PiboReliabilityStore.ack`
- `PiboReliabilityStore.retry`
- `PiboReliabilityStore.fail`
- `PiboReliabilityStore.requeueDead`
- `PiboRunRegistry.startToolRun`
- `PiboRunRegistry.complete`
- `PiboRunRegistry.fail`
- `PiboRunRegistry.timeOut`
- `PiboRunRegistry.cancel`
- `PiboRunRegistry.status`
- `PiboReliabilityStore.createRun`
- `PiboReliabilityStore.updateRun`
- `PIBO_RUN_CANCELLATION_SETTLEMENT_TIMEOUT_MS`
- `waitForRunCancellationSettlement`
- `PiboRunRegistry.createNotification`
- `PiboRunRegistry.releaseNotification`
- `PiboRunRegistry.read`
- `PiboRunRegistry.ack`
- `PiboRunRegistry.hasPendingNotification`
- `PiboReliabilityStore.recoverInterruptedRuns`
- `PiboReliabilityStore.pruneRuns`
- `PiboRunRegistry.prune`
- `sqliteTableColumns`

Related ownership boundaries:

- SPC-ORCH-001 owns yielded execution orchestration and resource admission.
- SPC-GW-001 owns router actions that invoke run cancellation.
- Process/cgroup isolation belongs to resource/runtime owners, not this store.
- SPC-DATA-001 owns product history; reliability notifications may be projected into it.

# Failure and security behavior

- Claims require exact worker ownership and unexpired leases for heartbeat/ack/retry/fail.
- Run lookup and mutation are scoped by controller Pibo Session ID.
- Wait is bounded; cancellation tooling waits up to 15 seconds for execution settlement before committing cancellation.

# Known limits

- Non-current claim excluded: claim reliability payload files or payload buckets; payload and result values are inline JSON columns in pibo-events.sqlite.
- Non-current claim excluded: assign cgroup/process isolation policy to the reliability store.
- Non-current claim excluded: say kill always cancels yielded runs; router kill and kill_all differ.
- Current limit or evidence gap: No separate size cap for inline reliability payload_json/result_json was found in the store; document this as a current limit rather than inventing bounded payload files.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality; it does not claim that an external, browser, real-provider, or Pibo2 check ran.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/reliability-store.test.mjs test/runs.test.mjs`

# Related concepts

- SPC-ORCH-001 owns yielded execution orchestration and resource admission.
- SPC-GW-001 owns router actions that invoke run cancellation.
- Process/cgroup isolation belongs to resource/runtime owners, not this store.
- SPC-DATA-001 owns product history; reliability notifications may be projected into it.
