# Spec: Chat Web Persistence Diagnostics API

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md), [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md)

## Why

Chat Web indexes routed Pibo output into event logs, session projections, trace views, unread state, reliability records, and live streams. When indexing slows down or fails, users may see stale navigation, missing trace rows, or incomplete live replay even though the underlying routed session still ran.

The current code exposes a small authenticated diagnostics endpoint for those persistence/indexing counters. This spec records that behavior so future agents can validate indexing health without treating the endpoint as a broad user API or duplicating the normal chat-event contracts.

## Goal

Chat Web MUST expose an authenticated, read-only persistence diagnostics endpoint that reports in-memory indexing counters and timing summaries without mutating chat, room, session, or trace state.

## Background / Current State

`createChatWebApp` initializes `persistenceMetrics` in memory with event, error, and indexing-duration counters. `ensureEventIndexing()` subscribes to routed output events. For each output event, it records indexing duration after the compaction, persistence, reliability, session-index, read-state, trace-cache, and live-listener work completes. If indexing throws, it records an error count, the last error message, and an ISO timestamp.

`GET /api/chat/debug/persistence` requires an authenticated Chat Web session and returns `{ persistence }`, where `persistence` includes the counters plus `averageIndexingMs`. The endpoint is diagnostic-only and does not require same-origin JSON because it is a read-only GET.

## Scope

### In Scope

- In-memory Chat Web persistence metric initialization.
- Metric updates from routed output event indexing.
- Error recording for indexing failures.
- `GET /api/chat/debug/persistence` authentication and response shape.
- Diagnostic boundary between this endpoint and normal trace, event, room, and data-store APIs.

### Out of Scope

- Durable storage of diagnostics across gateway restarts.
- Per-owner, per-room, or per-session metric partitioning.
- Operator CLI diagnostics for the same metrics.
- Trace-at-sequence replay diagnostics — covered by trace render diagnostics.
- Guarantees that every indexing failure can be recovered automatically.

## Requirements

### Requirement: Persistence metrics start from a safe zero state

The system MUST initialize Chat Web persistence metrics with zero counters before any routed output event is indexed.

#### Current

`createPersistenceMetrics()` returns `eventCount: 0`, `errorCount: 0`, `totalIndexingMs: 0`, and `maxIndexingMs: 0`.

#### Acceptance

- A new Chat Web app state has no last duration, last error, or last error timestamp before events are processed.
- The diagnostics response can be serialized before any output event is indexed.
- `averageIndexingMs` is `0` when `eventCount` is `0`.

#### Scenario: Fresh app diagnostics

- GIVEN Chat Web has started and no routed output event has been indexed
- WHEN an authenticated user requests `/api/chat/debug/persistence`
- THEN the response has `persistence.eventCount === 0`
- AND `persistence.errorCount === 0`
- AND `persistence.averageIndexingMs === 0`.

### Requirement: Successful indexing records event timing

The system MUST increment indexing counters and timing aggregates after each routed output event is processed by Chat Web indexing.

#### Current

`ensureEventIndexing()` captures `performance.now()` before indexing work and calls `recordPersistenceDuration()` after output compaction, persistence/index fallback, reliability logging, session-query updates, read-state updates, trace-cache invalidation, and live notifications complete.

#### Acceptance

- Each successfully processed output event increments `eventCount` by one.
- `totalIndexingMs` increases by the measured duration.
- `lastIndexingMs` reflects the most recent measured duration.
- `maxIndexingMs` is the maximum observed duration.
- `averageIndexingMs` is computed from `totalIndexingMs / eventCount` at serialization time.

#### Scenario: Two events are indexed

- GIVEN Chat Web indexes two routed output events successfully
- WHEN diagnostics are requested
- THEN `eventCount` is `2`
- AND `averageIndexingMs` is derived from the total and count
- AND `maxIndexingMs` is at least as large as `lastIndexingMs` when the last event was not the slowest.

### Requirement: Indexing errors are counted and exposed safely

The system MUST record indexing failures without hiding them from diagnostics.

#### Current

If the subscription callback catches an error, `recordPersistenceError()` increments `errorCount`, stores the error message or stringified value as `lastError`, and stores `lastErrorAt` as the current ISO timestamp.

#### Acceptance

- An indexing error increments `errorCount` by one.
- The diagnostics response includes `lastError` and `lastErrorAt` after a failure.
- Error serialization does not include stack traces, full event payloads, auth credentials, or private transcript content.
- Later successful indexing does not clear the previous last error unless code explicitly changes the metric behavior.

#### Scenario: Persistence append fails

- GIVEN an output event causes Chat Web indexing to throw
- WHEN the error is caught by the indexing subscription
- THEN diagnostics later report a higher `errorCount`
- AND the last error fields identify the failure at message level only.

### Requirement: Diagnostics endpoint is authenticated and read-only

The system MUST require a valid Chat Web session for persistence diagnostics and MUST NOT mutate product state when serving the diagnostics response.

#### Current

`GET /api/chat/debug/persistence` calls `requireSession(request, context)` and returns `responseJson({ persistence: serializePersistenceMetrics(state.persistenceMetrics) })`.

#### Acceptance

- Unauthenticated requests fail through the normal Chat Web session requirement.
- Authenticated GET requests receive JSON diagnostics.
- The endpoint does not append events, update read cursors, create sessions, mutate rooms, or emit router input.
- The endpoint does not require a selected Pibo Session.

#### Scenario: Authenticated diagnostics read

- GIVEN an authenticated Chat Web user
- WHEN the user sends `GET /api/chat/debug/persistence`
- THEN the server returns a JSON object with a `persistence` field
- AND no chat session, room, event, or read-state mutation occurs.

### Requirement: Metrics remain process-local diagnostics

The system MUST treat persistence metrics as process-local runtime diagnostics, not as durable analytics or billing records.

#### Current

Metrics live in `ChatWebAppState` memory and are created when the Chat Web app state is created. No store table persists them.

#### Acceptance

- Restarting the web gateway resets the counters.
- Metrics are not joined with owner, model, provider, or billing state.
- Operators use these metrics only to diagnose current gateway indexing health.

#### Scenario: Gateway restart resets counters

- GIVEN a gateway has non-zero persistence metrics
- WHEN the Chat Web app state is recreated after restart
- THEN diagnostics start again from the zero metric state.

## Edge Cases

- A routed event can update live-only state without becoming a durable chat-message row; it still counts as an indexed output event when the subscription callback completes.
- If an event falls back from direct append to ingestion, the measured duration includes the fallback path.
- A failing diagnostics request due to missing authentication must not expose metric values.
- Metrics are aggregate process counters. They cannot prove whether a specific user, room, or session lost data.

## Constraints

- **Security / Privacy:** Diagnostics must remain authenticated and must not expose event payloads, credentials, transcripts, or stack traces.
- **Compatibility:** Existing response shape is `{ persistence: { eventCount, errorCount, totalIndexingMs, maxIndexingMs, averageIndexingMs, ...optionalLastFields } }`.
- **Performance:** Computing diagnostics must be constant-time over the in-memory metrics object.
- **Durability:** Counters are intentionally not persisted across process restarts.

## Success Criteria

- [ ] SC-001: An authenticated diagnostics read before any event returns zero counters and `averageIndexingMs: 0`.
- [ ] SC-002: Successful routed output indexing increments event and timing counters.
- [ ] SC-003: Indexing failures increment error counters and expose only bounded error metadata.
- [ ] SC-004: The diagnostics endpoint requires authentication and performs no product-state mutation.
- [ ] SC-005: Restart or app-state recreation resets diagnostics counters.

## Assumptions and Open Questions

### Assumptions

- Persistence diagnostics are intended for local debugging and support, not end-user analytics.
- Aggregated process metrics are enough for the current diagnostic use case.
- Normal trace and event APIs remain the source for investigating a specific session.

### Open Questions

- Should diagnostics eventually include per-store counters for session projection, timeline, reliability, and data-ingestion fallback paths?
- Should operators have a CLI command for the same metrics, or is the authenticated HTTP endpoint enough?
- Should repeated indexing errors trigger a visible Chat Web health warning?

## Traceability

| Requirement | Scenario / Story | Source Basis | Verification | Status |
|---|---|---|---|---|
| REQ-001 Metrics start from zero | Fresh app diagnostics | `src/apps/chat/web-app.ts:createPersistenceMetrics` | Source-inspected | Draft |
| REQ-002 Successful indexing records timing | Two events are indexed | `src/apps/chat/web-app.ts:ensureEventIndexing`, `recordPersistenceDuration` | Source-inspected | Draft |
| REQ-003 Errors are counted safely | Persistence append fails | `src/apps/chat/web-app.ts:recordPersistenceError` | Source-inspected | Draft |
| REQ-004 Endpoint is authenticated and read-only | Authenticated diagnostics read | `src/apps/chat/web-app.ts` debug route | Source-inspected | Draft |
| REQ-005 Metrics are process-local | Gateway restart resets counters | `ChatWebAppState.persistenceMetrics` initialization | Source-inspected | Draft |

## Verification Basis

This spec was derived from current workspace code in:

- `src/apps/chat/web-app.ts`
- `src/apps/chat/output-compactor.ts`
- `src/apps/chat/output-event-policy.ts`
- `src/apps/chat/data/ingest-service.ts`
- `src/data/pibo-store.ts`
- `src/reliability/store.ts`

Existing specs and coverage analyses were inspected first. This file covers only the small persistence diagnostics API and avoids restating normal Chat Web event, trace, room, and data-store behavior.
