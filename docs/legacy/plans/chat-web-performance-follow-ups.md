# Chat Web Performance Follow-ups

This document preserves performance improvements that were identified but not implemented in the May 7, 2026 optimization patch.

## 1. Move persistence work off the router event path

Current state: Chat Web still writes to SQLite synchronously when router events arrive.

Potential work:

- Cache prepared statements in `ChatEventLog`, `ChatWebReadModel`, and `PiboReliabilityStore`.
- Wrap related writes in explicit transactions.
- Consider a bounded in-process queue for event indexing.
- Consider a separate persistence worker if request latency remains sensitive to SQLite writes.

Acceptance criteria:

- Event indexing preserves event order per Pibo session.
- The gateway remains responsive during high-rate streaming and tool updates.
- Failures surface clearly and do not silently drop durable events.

## 2. Materialize trace views incrementally

Current state: `/api/chat/trace` still rebuilds trace views from stored events.

Potential work:

- Maintain a materialized trace projection as events are indexed.
- Store a compact trace version per session.
- Keep raw-event tails separate from the structural trace cache.
- Rebuild from events only as a recovery path.

Acceptance criteria:

- Trace response time stays stable as session event history grows.
- Incremental projection matches a full rebuild in tests.
- Raw-event debug output remains bounded and opt-in.

## 3. Add gateway subscriptions and backpressure handling

Current state: the gateway broadcasts every router event to every TCP connection.

Potential work:

- Extend the gateway protocol with optional subscriptions by session, room, owner scope, or debug-all.
- Filter broadcasts before writing to sockets.
- Watch `socket.write()` return values.
- Bound or drop noncritical queued events for slow clients.

Acceptance criteria:

- Existing clients keep working or negotiate the legacy all-events mode.
- Normal Chat Web clients only receive relevant events.
- Slow clients cannot create unbounded memory growth.

## 4. Reduce Signal Registry recomputation cost

Current state: `InMemoryPiboSignalRegistry` still uses `JSON.stringify` for equality checks and recomputes ancestor snapshots on signal changes.

Potential work:

- Replace `JSON.stringify` equality with typed comparisons for signal nodes and session snapshots.
- Cache session depth.
- Mark dirty sessions explicitly.
- Recompute only affected ancestors and reuse child snapshots when unchanged.

Acceptance criteria:

- Patch versions remain monotonic per root.
- Signal snapshots remain identical to current behavior in regression tests.
- CPU per signal update drops on deep session trees and tool-heavy sessions.

## 5. Optimize frontend trace transforms further

Current state: the trace UI still transforms large trace trees on each relevant trace object change.

Potential work:

- Memoize trace transforms by trace version instead of object identity where safe.
- Limit live overlay patches to affected subtrees.
- Batch non-text live events for a short frame window.
- Make trace debug snapshot collection dev-only or behind a stronger build-time guard.

Acceptance criteria:

- Streaming remains visually current.
- React commit time stays low on long traces.
- Debug tooling remains available when explicitly enabled.

## 6. Avoid repeated bootstrap indexing

Current state: bootstrap still upserts visible sessions into the read model.

Potential work:

- Upsert only if `updatedAt` changed.
- Batch upserts in a transaction.
- Track a per-session indexed version.

Acceptance criteria:

- Bootstrap no longer performs writes for unchanged session lists.
- Room/session ordering remains unchanged.
- Existing migration and recovery behavior remains intact.

## Suggested order

1. Cache prepared statements and transaction-wrap hot writes.
2. Batch or skip unchanged bootstrap read-model upserts.
3. Reduce Signal Registry equality/recompute cost.
4. Split structural trace cache from raw-event tail.
5. Add gateway subscriptions once client/protocol compatibility is planned.
6. Materialize trace views if trace rebuilds still dominate after smaller fixes.
