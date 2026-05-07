# Chat Web Performance Optimizations — 2026-05-07

This note documents the low-risk performance work completed on May 7, 2026.

## Scope

The patch targets Chat Web bootstrap, unread-count calculation, trace lookup, and one frontend render hot path. It avoids protocol changes, persistence architecture changes, and background worker changes.

## Changes

### SQL-backed session filtering

`SqlitePiboSessionStore.find()` now pushes common predicates into SQLite before applying the existing semantic matcher. It supports indexed filters for IDs, owner scope, channel, kind, parent, origin, profile, and active-model presence.

This reduces Chat Web bootstrap work because owner-scoped session loading no longer reads every session before filtering in JavaScript.

### Batched unread counts

`ChatEventLog` now exposes `countUnreadMessagesBySession()`. Chat Web bootstrap uses it to compute unread counts for all visible sessions in chunks instead of running read-cursor and unread-count queries per session.

The event log also creates `idx_chat_events_session_type_event` to speed up completed-assistant-message correlation.

### Smaller trace lookups

Trace handlers now call `ChatWebReadModel.getSession()` when they need one indexed session. They no longer call `listSessions().find(...)` for that case.

### Frontend trace stats in one pass

`TraceTimeline` now computes completed, error, and active span counts in one loop instead of three separate `filter()` passes.

## Validation

Validated in a Docker compute worker and on the host checkout after copying the worker changes back.

Commands run:

```bash
npm run typecheck
npm run build
npm test
```

Results:

- Typecheck passed.
- Build passed.
- Test suite passed: 277 tests.
- Worker smoke test authenticated with Docker dev auth and loaded `/api/chat/bootstrap`.
- Micro-benchmark for 500 sessions showed batched unread counting at about 8.3x faster than the old per-session loop on the test dataset.

## Regression coverage

Added `test/performance-optimizations.test.mjs`:

- verifies batched unread counts match per-session counts;
- verifies SQL-backed session `find()` preserves existing matching semantics for indexed filters, metadata matching, and active-model matching.

## Notes

The patch keeps the synchronous SQLite architecture. It reduces query count and CPU work but does not move persistence off the request path. Larger architecture changes remain tracked in `plans/chat-web-performance-follow-ups.md`.
