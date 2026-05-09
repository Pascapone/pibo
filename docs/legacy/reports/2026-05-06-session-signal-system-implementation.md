# Session Signal System Implementation Report

Date: 2026-05-06

## Summary

Implemented the first end-to-end Pibo Session Signal System. The new signal layer provides a canonical live-state projection for a session and its descendants, including messages, turns, streams, tool calls, subagent sessions, yielded runs, compaction, queue state, processing state, disposal, and errors.

The implementation is additive. Existing trace and read-model behavior remains in place as a fallback while Chat Web starts consuming signal snapshots and patches.

## What changed

### Signal subsystem

Added `src/signals/`:

- `types.ts` defines signal nodes, statuses, snapshots, patches, producers, mutations, and registry interfaces.
- `aggregate.ts` defines active/terminal status semantics and aggregate status ranking.
- `projector.ts` maps routed output events, session lifecycle facts, queue facts, and run lifecycle facts into signal mutations.
- `registry.ts` stores live nodes, versions roots, computes session/tree aggregates, and publishes patches.
- `events.ts` re-exports signal event types.
- `store.ts` reserves the persistence boundary for a later durable store.

### Router and routed sessions

Changed `src/core/session-router.ts` and `src/core/routed-session.ts`:

- Router owns a `PiboSignalRegistry`.
- Router projects `PiboOutputEvent`s into signals.
- Session creation, known-session discovery, subagent child creation, disposal, queue changes, and processing changes feed the signal registry.
- `RoutedSession` now emits explicit processing and queue state changes, including the important `processing=false` transition.
- `PiboSessionStatus` now includes `enabledTools`; `activeTools` remains for compatibility but is deprecated because it lists configured tools, not currently executing tool calls.

### Yielded runs

Changed `src/runs/registry.ts`:

- Added generic run lifecycle listeners.
- Run start, complete, fail, cancel, ack, read/consume, owner cancellation, global cancellation, and prune now emit registry events.
- The router projects those events into `yielded_run` signal nodes.

### Chat Web API and SSE

Changed `src/apps/chat/web-app.ts`, `src/channels/types.ts`, and `src/gateway/server.ts`:

- Added signal snapshot endpoints:
  - `GET /api/chat/signals/session/:piboSessionId`
  - `GET /api/chat/signals/tree/:piboSessionId`
- Added signal SSE endpoint:
  - `GET /api/chat/signals/events?rootPiboSessionId=...`
- The SSE stream sends an initial `signal_snapshot` and then `signal_patch` events.
- Signal endpoints enforce the same owner-scope session access check as other Chat Web session APIs.

### Chat UI

Changed `src/apps/chat-ui/src/api.ts`, `src/apps/chat-ui/src/types.ts`, and `src/apps/chat-ui/src/App.tsx`:

- Added signal wire types.
- Added `fetchSessionSignals`, `fetchSignalTree`, and `subscribeSignalTree` API helpers.
- The app subscribes to the selected session tree signal stream.
- Signal aggregate state maps to the existing legacy UI statuses: `idle`, `running`, and `error`.
- This lets current session dots and working states react to signal patches without a full UI rewrite.

### Public exports

Changed `src/index.ts`:

- Exported signal registry factory/classes and signal public types.

## Tests added

Added `test/signal-registry.test.mjs` with coverage for:

1. Three-level nested descendant activity aggregates to the root.
2. A yielded run keeps the owning session tree active after `message_finished` and `processing=false`.
3. Root patch versions advance monotonically.

## Verification

Passed:

- `npm run typecheck -- --pretty false`
- `node --test test/signal-registry.test.mjs`

Also ran broader suites. Most tests passed, but full-suite verification is not clean yet:

- `npm test` reached the suite but timed out because of long runtime/open handles.
- One existing trace test failed in the legacy trace path:
  - `chat trace shows async subagent runs under pibo_run_start tool calls`
  - expected `qa_researcher`, got `explorer`

That failure is in the legacy trace async-subagent display path, not in the new signal registry tests. I did not change the trace engine as part of this first additive signal implementation.

## Docker and subagent usage

- Used the Pibo Docker compute system.
- Spawned worker `signal-system` for isolated build/test work.
- Released the worker after use.
- Used an explorer subagent to map relevant files and integration points before implementing.

## Remaining work

Recommended next steps:

1. Move more Chat UI working indicators directly to rich signal fields instead of only mapping to legacy `idle|running|error`.
2. Add signal overlays to trace rendering where live node decoration is needed.
3. Stop using run reminder service messages as a live UI source.
4. Add durable signal snapshot or lifecycle persistence.
5. Add terminal-node eviction/TTL policies.
6. Fix or rebaseline the legacy async-subagent trace test.
7. Add integration tests for Chat Web signal endpoints and SSE.

## Commit

This report was written before committing. The commit includes the implementation and this report.
