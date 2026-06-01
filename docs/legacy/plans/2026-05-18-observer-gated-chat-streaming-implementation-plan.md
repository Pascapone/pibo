# Implementation Plan: Observer-gated Chat Streaming

**Date:** 2026-05-18
**Status:** Draft / Ready for implementation
**Source:** User request in Pibo session `ps_da8af6f0-77b0-4f94-abb3-1b1aac6c1907`
**Related report:** `docs/reports/2026-05-18-observer-gated-chat-streaming.md`

## Goal

Reduce unnecessary Chat Web streaming by sending live token/tool/thinking deltas only while a selected-session observer actively requests live streaming. Room/navigation streams should remain lightweight and receive only summary/structural events needed to update status and schedule refreshes. Final output must still persist and replay correctly when no observer is present.

## Fresh-session handoff

A new implementation session should be able to start from this section.

### Problem in one paragraph

Chat Web currently opens SSE streams for both room/navigation updates and selected-session trace rendering. Live-only runtime events (`assistant_delta`, `thinking_delta`, `tool_execution_updated`) can be sent to streams that do not need them. This wastes transfer and UI work. The fix is to distinguish **summary observers** from **live observers** and only fan out live-only deltas when at least one selected-session live observer exists.

### Desired behavior in one paragraph

Room streams should keep the sidebar/navigation current without receiving token deltas. Selected-session streams should still render live output. If nobody is watching a session live, Pibo should suppress live-only SSE fanout but continue compacting and persisting final output. If a user opens the session mid-turn, Pibo should send the current compactor snapshot and then stream subsequent deltas. If the user disconnects, Pibo should stop sending future deltas but let the running turn finish normally.

### Files that matter

| File | Why it matters |
|---|---|
| `src/apps/chat/web-app.ts` | Main implementation file. Owns `/api/chat/events`, `createEventStream`, `ensureEventIndexing`, `activeEventStreams`, read marking, SSE frame writing. |
| `src/apps/chat/stream.ts` | Maps `PiboOutputEvent` to SSE `ChatStreamEvent` frames. Usually no change needed, but useful for expected frame types. |
| `src/apps/chat/output-compactor.ts` | Buffers live deltas, creates snapshots, flushes final events. Do not disable this. |
| `src/apps/chat/output-event-policy.ts` | Defines live-only events and persistable events. Import `isLiveOnlyOutputEvent` from here. |
| `src/apps/chat-ui/src/App.tsx` | Opens the room and selected-session `EventSource` connections. Add `mode=summary` and `mode=live` here. |
| `test/web-channel.test.mjs` | Primary backend/SSE/read-state test file. Add most tests here. |
| `test/chat-ui-integration.test.mjs` | UI live-trace integration coverage. Run and extend only if needed. |
| `test/chat-signals-api.test.mjs` | Signal stream regression check. This feature should not break it. |

### Must-not-break invariants

- Do not gate event ingestion into `OutputCompactor`.
- Do not gate durable/final event persistence.
- Do not mark room summary streams as read observers.
- Do not remove SSE cursor replay for durable events.
- Do not add WebSockets for this change.
- Do not try to disable upstream provider streaming in Pi Coding Agent in this change.

## Non-goals

- Do not add a WebSocket transport in this change.
- Do not change Pi Coding Agent provider streaming behavior in this change.
- Do not gate durable persistence.
- Do not gate `OutputCompactor` processing.
- Do not change auth, room permissions, or session ownership semantics.
- Do not change the public durable trace/event-log contract beyond adding optional SSE mode behavior.

## Current facts to preserve

1. `OutputCompactor` must see every router output event.
2. Live-only events are:
   - `assistant_delta`
   - `thinking_delta`
   - `tool_execution_updated`
3. Live-only events are not durable event-log rows today.
4. Final and structural events must still reach storage, trace, unread counts, and refresh triggers.
5. Room streams must not mark assistant messages read.
6. Selected-session live streams may mark terminal assistant events read for the active principal.
7. `snapshotsForSession()` is the mechanism for mid-turn observer joins.
8. SSE cursor behavior must remain stable: durable frames use `streamId:frameIndex` IDs.

## High-level design

Add an explicit stream mode to `/api/chat/events`:

- `mode=live`: selected-session stream. Counts as a live observer. Sends live-only deltas and snapshots.
- `mode=summary`: room/navigation stream. Does not count as a live observer. Does not send live-only token/thinking/tool-update frames.

Default behavior should preserve likely existing clients:

- If `piboSessionId` is requested and no `mode` is provided, use `live`.
- If `roomId` is requested and no `piboSessionId` is provided, use `summary`.
- If neither is provided, the existing route resolves an implicit selected session; use `live`.
- If both `roomId` and `piboSessionId` are provided, the route is session-scoped; use `live`.

Route behavior matrix:

| Request | Default mode | Registers live observer | Sends live-only deltas | Sends compactor snapshots |
|---|---:|---:|---:|---:|
| `/api/chat/events?piboSessionId=ps_...` | `live` | yes | yes, if observer still active | yes |
| `/api/chat/events?piboSessionId=ps_...&mode=summary` | `summary` override | no | no | no |
| `/api/chat/events?roomId=room_...` | `summary` | no | no | no |
| `/api/chat/events?roomId=room_...&piboSessionId=ps_...` | `live` | yes | yes, for that session | yes |
| `/api/chat/events` | `live` for implicit selected session | yes | yes | yes |

Add server-side observer accounting:

- Live observers are tracked per `piboSessionId`.
- Only `mode=live` selected-session streams register as live observers.
- When the last live observer disconnects, live-only fanout for that session stops.
- The agent turn continues. The compactor keeps buffering. Final events persist.

## Implementation phases

## Phase 0: Pre-flight and branch setup

This phase happens in the implementation session, not while writing this plan.

1. Read required context:
   - `GLOSSARY.md`
   - `AGENTS.md`
   - `docs/reports/2026-05-18-observer-gated-chat-streaming.md`
   - this plan
2. Use the standard GitHub server flow skill before code changes.
3. Spawn a Docker compute worker before editing code:
   - `pibo compute spawn`
4. Implement and test inside the worker worktree only.
5. Do not restart or modify the host production gateway during development.

Verification:

- Worker exists and returned web/CDP ports if browser checks are needed.
- Git branch/worktree strategy follows the GitHub server flow.

## Phase 1: Introduce stream mode types and parsing

### Target files

- `src/apps/chat/web-app.ts`
- optional test coverage in `test/web-channel.test.mjs`

### Tasks

1. Add a stream mode type near existing chat event stream types:

```ts
type ChatEventStreamMode = "live" | "summary";
```

2. Add a parser helper:

```ts
function parseEventStreamMode(value: string | null, fallback: ChatEventStreamMode): ChatEventStreamMode {
  if (value === "live" || value === "summary") return value;
  return fallback;
}
```

3. Add a resolver helper for the route:

```ts
function defaultEventStreamMode(input: { requestedRoomId?: string; requestedPiboSessionId?: string }): ChatEventStreamMode {
  if (input.requestedPiboSessionId) return "live";
  if (input.requestedRoomId) return "summary";
  return "live";
}
```

This matches the current route shape: a request with only `roomId` is a room stream; a request with `piboSessionId`, or no explicit room, resolves to a session stream.

4. Extend `createEventStream(...)` input with:

```ts
mode: ChatEventStreamMode;
```

5. Update all calls to `createEventStream(...)` in `/api/chat/events` route to pass the resolved mode.

Acceptance:

- `GET /api/chat/events?piboSessionId=...&mode=live` behaves like the old selected-session stream.
- `GET /api/chat/events?roomId=...&mode=summary` opens successfully.
- Invalid mode values fall back safely instead of throwing.

## Phase 2: Add live observer accounting

### Target files

- `src/apps/chat/web-app.ts`

### Current structure

`ChatWebAppState` has:

```ts
activeEventStreams: Map<string, Map<string, string>>;
```

This currently maps:

```text
piboSessionId -> streamId -> principalId
```

It is used for read-state updates. We can extend it conservatively rather than replace it in the first implementation.

### Recommended minimal implementation

Keep `activeEventStreams` as the live selected-session observer registry. Only register streams there when:

- `mode === "live"`
- `activePiboSessionId` exists

This preserves existing read-state semantics and makes `activeEventStreams.has(piboSessionId)` a live-observer check.

Add helper:

```ts
function hasLiveObserver(state: ChatWebAppState, piboSessionId: string): boolean {
  return (state.activeEventStreams.get(piboSessionId)?.size ?? 0) > 0;
}
```

Update `createEventStream().start()`:

- old behavior: register when `activePiboSessionId` exists
- new behavior: register only when `mode === "live" && activePiboSessionId`

Update `createEventStream().cancel()` similarly:

- unregister only if the stream was registered as a live observer
- avoid calling `markEventStreamDisconnected()` for summary streams

Implementation detail:

Use a local boolean inside `createEventStream`:

```ts
let registeredLiveObserver = false;
```

Set it to true after `markEventStreamConnected(...)`. In `cancel()`, only disconnect when true.

Acceptance:

- Summary streams do not appear in `activeEventStreams`.
- Live selected-session streams do appear in `activeEventStreams`.
- Existing read-state behavior still uses only selected live streams.

## Phase 3: Suppress live-only frames on summary streams

### Target files

- `src/apps/chat/web-app.ts`
- `src/apps/chat/output-event-policy.ts` already exposes `isLiveOnlyOutputEvent(...)`

### Tasks

1. Import or reuse `isLiveOnlyOutputEvent` in `web-app.ts` if it is not already imported. It currently imports `isPersistableOutputEvent`; extend the import.

2. Update `writeChatEventFrames(...)` signature with a fifth options argument:

```ts
function writeChatEventFrames(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: ChatLiveEvent,
  state: ReturnType<typeof createChatStreamState>,
  cursor?: ChatEventCursor,
  options: { mode: ChatEventStreamMode } = { mode: "live" },
): void
```

Use the fifth argument to avoid rewriting existing cursor call sites. Calls with cursors pass `input.cursor, { mode: input.mode }`. Calls without cursors pass `undefined, { mode: input.mode }`.

3. Before mapping frames, detect live-only payloads:

```ts
if (options.mode === "summary" && isLiveOnlyOutputEvent(event.payload)) return;
```

4. For snapshot events sent from `outputCompactor.snapshotsForSession(...)`, only send them for `mode === "live"`.

5. Replayed durable history should still be written for both modes. Durable history does not include live-only deltas in normal operation.

Acceptance:

- Summary streams do not receive `TEXT_MESSAGE_CONTENT` frames for `assistant_delta`.
- Summary streams do not receive `REASONING_MESSAGE_CONTENT` frames for `thinking_delta`.
- Summary streams do not receive `TOOL_CALL_ARGS` frames caused only by `tool_execution_updated` live updates.
- Summary streams can still receive structural/final frames that trigger navigation refreshes.

## Phase 4: Gate central live-only fanout when no live observer exists

### Target files

- `src/apps/chat/web-app.ts`

### Current behavior

In `ensureEventIndexing(...)`, live-only events from `result.liveEvents` are sent immediately to all `state.liveListeners`.

### New behavior

For live-only events:

- Keep compaction.
- Keep session read model update if needed.
- Do not notify SSE listeners unless at least one live observer exists for that event's `piboSessionId`.

Pseudo-code:

```ts
for (const liveEvent of result.liveEvents) {
  if (isPersistableOutputEvent(liveEvent)) continue;
  state.sessionQuery.recordEvent(liveEvent, session);

  if (isLiveOnlyOutputEvent(liveEvent) && !hasLiveObserver(state, liveEvent.piboSessionId)) {
    continue;
  }

  for (const listener of state.liveListeners) {
    listener({ roomId: room?.id, piboSessionId: liveEvent.piboSessionId, eventType: liveEvent.type, payload: liveEvent });
  }
}
```

Important nuance:

Even with one live observer, all listeners currently receive the event and filter locally. Summary stream listeners will still suppress live-only payloads because Phase 3 filters per stream. This two-layer gate means:

- no live observer: no live delta enters SSE listener fanout;
- some live observer: selected live stream can receive it;
- room summary stream still ignores it.

Acceptance:

- With no live observer, live-only events are not delivered to any SSE stream.
- With a live observer, live-only events are delivered to matching live streams.
- Persisted final events still deliver to summary and live streams.
- `OutputCompactor` still accumulates deltas even when fanout is suppressed.

## Phase 5: Update Chat UI EventSource URLs

### Target file

- `src/apps/chat-ui/src/App.tsx`

### Tasks

1. In the room/navigation EventSource effect, add:

```ts
params.set("mode", "summary");
```

Current area:

```ts
const params = new URLSearchParams({ roomId: activeRoomId });
params.set("since", `${latestRoomStreamId ?? 0}:999999`);
const events = new EventSource(`/api/chat/events?${params.toString()}`);
```

Target:

```ts
const params = new URLSearchParams({ roomId: activeRoomId });
params.set("mode", "summary");
params.set("since", `${latestRoomStreamId ?? 0}:999999`);
```

2. In the selected trace/session EventSource effect, add:

```ts
params.set("mode", "live");
```

Current area:

```ts
const params = new URLSearchParams({ piboSessionId: selectedPiboSessionId });
```

Target:

```ts
const params = new URLSearchParams({ piboSessionId: selectedPiboSessionId });
params.set("mode", "live");
```

Acceptance:

- Chat UI still renders live output for the selected session.
- Room navigation still updates statuses and refreshes.
- Room stream no longer consumes token deltas.

## Phase 6: Tests

Before writing new helpers, inspect the existing SSE helper style in `test/web-channel.test.mjs`. That file already has tests around room streams, stream cursors, read-state behavior, and event replay. Prefer extending those patterns over introducing a new test harness.

Useful existing test anchors:

- room streams do not mark assistant messages read;
- active selected session marks own completions read while unfocused sessions remain unread;
- SSE cursor skips replayed history;
- room SSE scopes events by room/session.

## Test group A: SSE stream mode behavior

### Target file

- `test/web-channel.test.mjs`

### Test A1: room summary stream suppresses assistant deltas

Scenario:

- Start Chat Web test server.
- Create/resolve a room and session.
- Open `/api/chat/events?roomId=<room>&mode=summary`.
- Emit or inject an `assistant_delta` for a session in that room through the test channel/router harness.
- Assert no SSE frame of type `TEXT_MESSAGE_CONTENT` appears.
- Emit final `assistant_message` or `message_finished`.
- Assert a structural/final frame appears or bootstrap refresh-relevant event remains available.

Expected:

- No token-level frame in summary mode.
- Final durable event remains visible.

### Test A2: selected live stream receives assistant deltas

Scenario:

- Open `/api/chat/events?piboSessionId=<session>&mode=live`.
- Emit `assistant_delta`.
- Assert `TEXT_MESSAGE_CONTENT` appears.

Expected:

- Live stream behavior matches old behavior.

### Test A3: invalid mode falls back safely

Scenario:

- Open `/api/chat/events?piboSessionId=<session>&mode=invalid`.
- Emit `assistant_delta`.
- Assert selected-session stream still behaves as live by default.

Expected:

- No 400 solely because of invalid mode.
- No compatibility break for older clients.

## Test group B: observer gating

### Test B1: no live observer suppresses live-only fanout

Scenario:

- Open only a room summary stream.
- Emit `assistant_delta`.
- Assert the summary stream does not receive token frames.
- If test harness can observe server liveListeners indirectly, assert no live delta was written to the stream.

Expected:

- No live-only frame reaches the browser stream.

### Test B2: live observer enables live-only fanout

Scenario:

- Open selected-session live stream.
- Emit `assistant_delta`.
- Assert token frame arrives.

Expected:

- Live observer presence enables live output.

### Test B3: disconnect removes live observer

Scenario:

- Open selected-session live stream.
- Emit first `assistant_delta`; assert it arrives.
- Close/cancel the stream.
- Emit second `assistant_delta`.
- Open a new summary or diagnostic stream and assert the second token was not replayed as a durable event.
- Finish the message and assert final output is durable.

Expected:

- Live-only delivery stops after disconnect.
- Final output persists.

## Test group C: mid-turn join and graceful finalization

### Test C1: mid-turn join receives snapshot

Scenario:

- Emit `assistant_delta` while no live observer exists.
- Open selected-session `mode=live` stream.
- Assert the stream receives a current partial snapshot from `snapshotsForSession()` as `TEXT_MESSAGE_CONTENT` or equivalent generated frames.
- Emit another `assistant_delta`; assert it arrives live.

Expected:

- Late observer sees accumulated partial content and subsequent live content.

### Test C2: no observer still persists final message

Scenario:

- No selected live stream.
- Emit multiple `assistant_delta` events.
- Emit `message_finished` or `assistant_message`.
- Fetch `/api/chat/trace?piboSessionId=...` or bootstrap/trace summary.
- Assert final assistant text appears.

Expected:

- Suppressed live fanout does not lose final assistant output.

## Test group D: read-state compatibility

Existing test to preserve:

- `chat web app room event streams do not mark assistant messages read`

Add or update tests:

- Summary streams never mark assistant messages read.
- Live selected-session streams still mark terminal assistant events read.

Expected:

- Existing unread behavior remains unchanged.

## Test group E: UI integration

Target files:

- `test/chat-ui-integration.test.mjs`
- optionally browser smoke through worker CDP if available

Scenarios:

1. Selected session live trace still patches token text.
2. Persisted catch-up still replaces live intermediate state.
3. Room/sidebar status updates still work from summary events.

Expected:

- No visible regression in Chat UI live trace rendering.
- No visible regression in navigation refresh behavior.

## Phase 7: Diagnostics and observability

This is optional but recommended if small.

### Target file

- `src/apps/chat/web-app.ts`

### Tasks

1. Extend `/api/chat/debug/persistence` or add a small internal debug payload to expose:

```ts
liveObservers: Array<{ piboSessionId: string; count: number }>
```

2. Keep this behind authenticated Chat Web requests.

3. Do not add public unauthenticated diagnostics.

Acceptance:

- During manual testing, a selected-session live stream increments observer count.
- Closing the tab/stream decrements observer count.

If implementation time is tight, skip this phase and rely on tests.

## Phase 8: Manual verification in Docker worker

### Server-side checks

First inspect `package.json` scripts in the worker. Then run the targeted test command that matches the repo's current convention. Candidate commands:

```bash
npm test -- test/web-channel.test.mjs
npm test -- test/chat-ui-integration.test.mjs
npm test -- test/chat-signals-api.test.mjs
```

If those commands do not match the repo's script setup, use the discovered equivalent. Do not skip targeted backend tests.

### Browser checks

If the worker exposes web/CDP ports:

1. Start/restart the worker web gateway using the worker's CLI flow.
2. Open Chat Web in the worker browser.
3. Select a session.
4. Send a prompt.
5. Confirm selected trace streams live text.
6. Switch away or close selected live view.
7. Confirm final message still appears after refresh.
8. Inspect network/SSE if practical:
   - room stream URL has `mode=summary`;
   - selected stream URL has `mode=live`;
   - room stream does not receive token-level deltas.

### Debug checks

Use Pibo-native debug tools where helpful:

```bash
pibo debug --help
pibo debug session <ps_...>
pibo debug trace <ps_...> --check
pibo debug events <ps_...>
```

## Detailed code-change checklist

## `src/apps/chat/web-app.ts`

- [ ] Add `ChatEventStreamMode` type.
- [ ] Add stream mode parser/resolver.
- [ ] Extend `createEventStream(...)` input with `mode`.
- [ ] Register `activeEventStreams` only for `mode=live` selected-session streams.
- [ ] Unregister only when registered.
- [ ] Add `hasLiveObserver(...)` helper.
- [ ] Update `ensureEventIndexing(...)` live-only fanout gate.
- [ ] Update `writeChatEventFrames(...)` to suppress live-only payloads for summary mode.
- [ ] Ensure `snapshotsForSession()` only writes snapshots for live mode.
- [ ] Pass mode through all `writeChatEventFrames(...)` calls.
- [ ] Parse `mode` in `/api/chat/events` route.
- [ ] Preserve room access checks before stream creation.
- [ ] Preserve cursor replay behavior.
- [ ] Preserve heartbeat behavior.

## `src/apps/chat-ui/src/App.tsx`

- [ ] Add `mode=summary` to room EventSource params.
- [ ] Add `mode=live` to selected-session EventSource params.
- [ ] Ensure dependency arrays do not need changes solely because static mode params are added.

## Tests

- [ ] Add/adjust SSE helper utilities if needed.
- [ ] Add summary stream suppression test.
- [ ] Add selected live stream delta test.
- [ ] Add no-observer final persistence test.
- [ ] Add mid-turn snapshot test if feasible with current harness.
- [ ] Preserve existing read-state tests.
- [ ] Run targeted test files.

## Edge cases and expected behavior

## Multiple live tabs

If two tabs open the same selected session in live mode:

- Observer count is 2.
- Closing one tab leaves streaming active.
- Closing both stops live-only fanout.

## Room page with no selected session

A room-only view should use summary mode:

- It can update status and navigation.
- It should not receive token deltas.
- It should not mark messages read.

## Selected session inside a room

The selected-session trace stream should use live mode:

- It receives token deltas.
- It can mark terminal assistant messages read.
- The room stream remains summary-only.

## Network disconnect

On normal browser close/reload:

- SSE cancel fires.
- Live observer is removed.
- Later deltas stop.
- Final output persists.

On half-open connection:

- Current implementation may wait for TCP/SSE failure detection.
- Phase 2 heartbeat can tighten this if needed.

## Server restart

If the server restarts mid-turn:

- In-memory live observer state and compactor snapshots are lost.
- Durable final events remain the source of truth after completion.
- This plan does not attempt to solve restart-time partial live replay.

## Provider still streams internally

This plan reduces Pibo/Chat Web transport and UI work. It does not reduce upstream model stream events inside Pi. A later cross-boundary Pi runtime change is required for true provider final-only mode.

## Rollout strategy

1. Ship server support with backwards-compatible defaults.
2. Ship UI URL changes.
3. Verify existing clients without `mode` still work.
4. Watch for any regressions in:
   - trace live rendering;
   - unread counts;
   - room/sidebar status updates;
   - SSE resume behavior.

## Acceptance criteria

- [ ] AC-001: Room summary streams do not receive token-level assistant/thinking/tool-update frames.
- [ ] AC-002: Selected-session live streams still receive token-level live frames.
- [ ] AC-003: With no selected-session live observer, live-only events are not fanned out to browser SSE streams.
- [ ] AC-004: Final assistant output persists and appears in trace after completion even when no live observer was connected.
- [ ] AC-005: A live observer joining mid-turn receives current partial state from compactor snapshots and then subsequent live deltas.
- [ ] AC-006: Disconnecting the last live observer stops later live-only delivery without aborting the running turn.
- [ ] AC-007: Room streams still do not mark assistant messages read.
- [ ] AC-008: Selected-session live streams still mark terminal assistant output read as before.
- [ ] AC-009: SSE cursor replay for durable events remains compatible.
- [ ] AC-010: Targeted web-channel and UI integration tests pass in the Docker worker.

## Suggested implementation order for the next session

1. Implement stream mode parsing and pass-through with no behavior change except explicit defaults.
2. Add UI `mode` params.
3. Add per-stream summary suppression.
4. Add live observer registration gating.
5. Add central live-only fanout gate.
6. Add tests in the same order.
7. Run targeted tests.
8. Do a browser smoke if the worker web gateway is available.

## Done definition for the implementation PR

The implementation is done when a fresh reviewer can verify all of this:

- Code changes are limited to Chat Web SSE routing, Chat UI EventSource params, and related tests unless a small helper import is needed.
- Summary streams never register as live observers.
- Live streams register and unregister exactly once per SSE connection.
- Live-only fanout is suppressed when observer count is zero.
- Final events persist and replay regardless of observer count.
- Mid-turn live joins receive snapshots.
- Existing read-state behavior remains intact.
- Targeted tests pass in the Docker worker.
- Browser smoke confirms selected-session live rendering still works.

## Open questions for implementation

1. Should invalid `mode` values silently fall back or return HTTP 400? This plan recommends fallback for compatibility.
2. Should summary streams receive `TEXT_MESSAGE_END` final frames, or rely only on `RAW_EVENT` and refresh scheduling? This plan allows final/structural frames because they are durable and useful for refresh.
3. Should observer diagnostics be added in phase 1 or deferred? This plan treats them as optional.
4. Do we want a TTL heartbeat in the first implementation? This plan defers it unless tests/manual checks show stale observers are a real problem.
