# Spec: Reliable Event Core

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** `GLOSSARY.md`, [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md), [Yielded Run Control](./yielded-run-control.md), [Debug CLI](./debug-cli.md)

## Why

Pibo needs a local reliability layer for product events, consumer replay, durable operational jobs, and yielded-run recovery. This layer must be separate from Pi transcripts, Pibo Session metadata, Chat Web projections, and the newer Pibo Data Store so that operational state can be inspected, replayed, pruned, and recovered without changing user-facing transcript truth.

## Goal

Define the behavior of the Pibo Reliability Store at `.pibo/pibo-events.sqlite` as the durable local core for append-only product events, consumer offsets, background jobs, dead jobs, and yielded-run records.

## Background / Current State

The current code implements `PiboReliabilityStore` in `src/reliability/store.ts`. It creates SQLite tables for `pibo_event_stream`, `pibo_event_consumers`, `pibo_jobs`, `pibo_dead_jobs`, and `pibo_runs`, enables WAL for file-backed stores, and is wired into the session router, Chat Web app, debug CLI, and run registry. Unit tests in `test/reliability-store.test.mjs` cover event idempotency, monotonic consumer offsets, retention-safe pruning, event counts, exclusive job claims, retry exhaustion, expired claim handling, and dead-job replay.

## Scope

### In Scope

- Append-only reliability event streams.
- Idempotent event append by topic/event id and topic/idempotency key.
- Cursor-based named consumer offsets.
- Retention-class-aware event counting and pruning.
- Durable job enqueue, claim, heartbeat, acknowledge, retry, fail, and dead-letter replay behavior.
- Durable yielded-run records used by the run registry.
- Conservative recovery of interrupted durable yielded runs.
- Debuggable local SQLite storage under Pibo home.

### Out of Scope

- Chat Web room/event-log semantics — covered by `chat-web-rooms-and-event-streams.md` and `pibo-data-store-and-ingestion.md`.
- Pibo Session metadata persistence — covered by `pibo-session-routing.md`.
- Agent-facing yielded-run tool UX — covered by `yielded-run-control.md`.
- Cron job product behavior — covered by `scheduled-pibo-jobs.md`.
- Distributed multi-host queue guarantees — the current implementation is local SQLite.

## Requirements

### Requirement: Reliability state is stored in a Pibo-managed SQLite store

The system MUST store reliability events, consumer offsets, durable jobs, dead jobs, and durable yielded-run records in `.pibo/pibo-events.sqlite` by default.

#### Current

`createDefaultPiboReliabilityStore()` opens `piboHomePath("pibo-events.sqlite")`. File-backed stores create parent directories, use `busy_timeout`, enable SQLite foreign keys, and use WAL mode.

#### Target

The reliability store remains a Pibo-managed operational store and does not become the canonical Chat Web transcript, Pibo Session store, or Pi transcript store.

#### Acceptance

Opening the default reliability store creates the expected tables and indexes without requiring an existing `.pibo` directory.

#### Scenario: Fresh default store

- GIVEN no reliability database exists at the Pibo home path
- WHEN Pibo opens the default reliability store
- THEN the database exists
- AND the event stream, consumer, job, dead-job, and run tables are available
- AND file-backed writes use WAL-compatible local persistence

### Requirement: Event append is ordered and idempotent

The system MUST append events with a monotonically increasing `streamId` and MUST return the existing event when an append is retried with the same `topic` and `eventId` or the same `topic` and `idempotencyKey`.

#### Current

`append()` inserts into `pibo_event_stream`. `appendOnce()` catches uniqueness conflicts and returns the matching existing row when possible.

#### Target

Producers can retry event writes without duplicating product events in the same topic.

#### Acceptance

A repeated `appendOnce()` call with either duplicate event id or duplicate idempotency key returns the first row and leaves only one stored event for that logical write.

#### Scenario: Retried output event append

- GIVEN a producer appends event `event-1` to topic `pibo.output` with idempotency key `idem-1`
- WHEN the producer retries with the same event id
- THEN the store returns the original stream row
- WHEN the producer retries with a different event id but the same idempotency key
- THEN the store still returns the original stream row

### Requirement: Consumer replay is cursor-based and monotonic

The system MUST let named consumers read events after their saved cursor and MUST prevent saved offsets from moving backward.

#### Current

`readFromConsumer()` reads after `pibo_event_consumers.last_stream_id`. `saveConsumerOffset()` stores the maximum of the previous and new stream id.

#### Target

Projectors can resume after restart without replaying acknowledged events or losing newer offsets due to stale saves.

#### Acceptance

Saving stream id `2` and later attempting to save stream id `1` leaves the consumer cursor at `2`.

#### Scenario: Stale projector offset save

- GIVEN a consumer has saved offset `2` for topic `topic`
- WHEN an older worker saves offset `1`
- THEN the stored offset remains `2`
- AND the next read returns only events with stream id greater than `2`

### Requirement: Event pruning protects unread consumer data by default

The system MUST prune events by topic, retention class, time, stream id, and limit, and MUST preserve rows that named consumers still need unless destructive pruning is explicitly requested.

#### Current

`prune()` adds a consumer-offset guard unless `destructive` is true. Event counts group by topic, optional key, and retention class.

#### Target

Operational cleanup can reduce store size without breaking registered replay consumers by default.

#### Acceptance

A non-destructive prune removes only rows at or below the minimum saved consumer offset for that topic; destructive pruning may remove matching rows regardless of offsets.

#### Scenario: Retain unread live delta

- GIVEN two `live_delta` events exist for a topic
- AND a consumer cursor only covers the first event
- WHEN non-destructive pruning runs for old `live_delta` events
- THEN only the first covered event is deleted
- AND the unread second event remains

### Requirement: Durable job claims are exclusive and time-bounded

The system MUST let workers claim due jobs by queue with exclusive leases, visibility timeouts, and priority/run-time ordering.

#### Current

`claimBatch()` moves due `pending` jobs and expired `running` jobs to `running`, sets `workerId`, increments attempts, and sets `claimExpiresAt`. `ack()`, `retry()`, `fail()`, and `heartbeat()` require the current non-expired worker claim.

#### Target

Only the active lease controller can complete, retry, fail, or extend a claimed job. Expired jobs become claimable again.

#### Acceptance

A second worker cannot claim or acknowledge a job while the first worker has a valid lease, but can reclaim it after the lease expires.

#### Scenario: Expired worker claim

- GIVEN worker A claims a due job with a short visibility timeout
- WHEN the claim expires before worker A acknowledges it
- THEN worker A cannot acknowledge the job
- AND worker B can claim the same job

### Requirement: Job retry exhaustion moves work to the dead-job queue

The system MUST reschedule retryable jobs while attempts remain and MUST move exhausted or explicitly failed jobs to `pibo_dead_jobs` with error context.

#### Current

`retry()` backs off pending jobs until `attempts >= maxAttempts`, then moves the job to dead with reason `max_attempts`. `fail()` moves a live worker job to dead with reason `failed`. `requeueDead()` creates a new live job and removes the dead row.

#### Target

Operators can distinguish live work from failed work and replay dead work deliberately.

#### Acceptance

A job with `maxAttempts: 2` that fails twice appears once in the dead-job list, and replaying it creates a new job id.

#### Scenario: Replay dead job

- GIVEN a job has moved to the dead-job queue
- WHEN an operator requeues that dead job
- THEN a new live job is created in the original queue
- AND the old dead-job row is removed

### Requirement: Yielded-run records recover conservatively after interruption

The system MUST persist yielded-run records and MUST recover running records conservatively when a new run registry starts.

#### Current

`createRun()` creates both a `runs` queue job and a `pibo_runs` record. `PiboRunRegistry` calls `recoverInterruptedRuns()` and loads stored runs at startup. Interrupted non-retryable runs become failed; retryable runs with attempts remaining become queued for retry.

#### Target

After process interruption, agents can inspect terminal failures or queued retry state instead of seeing silent lost background work.

#### Acceptance

A running non-retryable stored run without a live unexpired job claim becomes `failed` with an interruption error and completion timestamp during recovery.

#### Scenario: Gateway restart during background tool

- GIVEN a durable yielded run is marked `running`
- AND its job claim no longer exists or has expired
- WHEN the run registry starts
- THEN a non-retryable run becomes `failed`
- AND a retryable run with retry capacity becomes `queued`

### Requirement: Terminal yielded runs are pruned by policy

The system MUST retain unread tracked terminal runs and MUST prune only eligible terminal records according to completion policy and TTL.

#### Current

`pruneRuns()` deletes detached terminal runs after the detached TTL and consumed tracked terminal runs after the consumed TTL. Unconsumed tracked terminal runs remain.

#### Target

Run reminders remain inspectable until handled, while old detached or consumed records do not grow without bound.

#### Acceptance

A completed tracked run that is not consumed is not deleted by terminal-run pruning, regardless of age.

#### Scenario: Unread tracked result

- GIVEN a tracked run completed earlier than the consumed-run TTL
- AND the run has not been consumed
- WHEN terminal run pruning executes
- THEN the run remains listed for its controller session

## Edge Cases

- Duplicate event ids are scoped by topic; the same event id may appear in different topics.
- `idempotencyKey` uniqueness applies only when a key is provided.
- Event list limits are clamped to a bounded range.
- Expired jobs are moved out of live work before claim selection.
- A worker cannot acknowledge, retry, fail, or heartbeat a job after its claim expires.
- Dead-job replay may override payload, run time, priority, attempt limit, or idempotency key.
- In-memory reliability stores are valid for tests but do not use file-backed WAL.

## Constraints

- **Compatibility:** Public behavior must keep using `Pibo Session ID` for run stewardship and `runId` for yielded-run identity.
- **Security / Privacy:** Reliability payloads may contain operational data; debug and API access must remain app-spaced where exposed above the store.
- **Performance:** Queries must remain bounded by limits and indexes for event replay, job claim selection, dead-job listing, and run lookup.
- **Dependencies:** The current implementation depends on Node SQLite via `node:sqlite` and local filesystem access.

## Success Criteria

- [ ] SC-001: `test/reliability-store.test.mjs` passes for event idempotency, consumer offsets, pruning, job claims, retry, and replay.
- [ ] SC-002: Debug CLI store discovery lists `pibo-events.sqlite` as the reliability store and can inspect event, job, dead-job, and run data without mutating it unless an explicit replay/prune action is invoked.
- [ ] SC-003: Restarting a run registry with a reliability store recovers interrupted durable runs as failed or queued according to retryability.
- [ ] SC-004: Non-destructive event pruning never deletes events above the minimum saved consumer offset for their topic.

## Assumptions and Open Questions

### Assumptions

- The reliability store is local to one Pibo installation and does not promise distributed queue semantics.
- Reliability events are operational replay records, not the canonical Chat Web transcript.
- Dead-job replay is an operator action and may alter idempotency if the operator supplies a new key.

### Open Questions

- Should cron jobs eventually move from their dedicated cron store into `PiboReliabilityStore`, or remain separate as implemented today?
- Which retention classes should have default pruning policies beyond the manual `prune()` API?
- Should the reliability store schema gain an explicit schema version table before broader migrations?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Reliability state is stored in a Pibo-managed SQLite store | Fresh default store | Existing implementation | Draft |
| REQ-002 Event append is ordered and idempotent | Retried output event append | Existing test coverage | Draft |
| REQ-003 Consumer replay is cursor-based and monotonic | Stale projector offset save | Existing test coverage | Draft |
| REQ-004 Event pruning protects unread consumer data by default | Retain unread live delta | Existing test coverage | Draft |
| REQ-005 Durable job claims are exclusive and time-bounded | Expired worker claim | Existing test coverage | Draft |
| REQ-006 Job retry exhaustion moves work to the dead-job queue | Replay dead job | Existing test coverage | Draft |
| REQ-007 Yielded-run records recover conservatively after interruption | Gateway restart during background tool | Existing implementation | Draft |
| REQ-008 Terminal yielded runs are pruned by policy | Unread tracked result | Existing implementation | Draft |

## Verification Basis

- `src/reliability/store.ts`
- `src/runs/registry.ts`
- `src/core/session-router.ts`
- `src/apps/chat/web-app.ts`
- `src/debug/index.ts`
- `src/debug/stores.ts`
- `test/reliability-store.test.mjs`
