# Report: Observer-gated Chat Streaming

**Date:** 2026-05-18
**Status:** Analysis
**Scope:** Chat Web SSE streams, gateway router fanout, runtime output persistence, and graceful live/final message delivery.

## TL;DR

Pibo already separates live-only deltas from durable events. `assistant_delta`, `thinking_delta`, and `tool_execution_updated` are buffered by `OutputCompactor` and normally become durable final events such as `assistant_message`, `thinking_finished`, or `tool_execution_finished`. The expensive part is that Chat Web still forwards live deltas over SSE whenever an event stream is connected, and the UI currently opens a room-level stream plus a selected-session stream. That can duplicate streaming metadata and can stream content to views that only need navigation/status updates.

We should not add a WebSocket route first. The existing `/api/chat/events` SSE route already has connection lifecycle, cursors, heartbeats, replay from `event_log`, and active selected-session tracking. The lowest-risk fix is to make this route observer-aware and mode-aware:

- selected-session streams request `mode=live` and count as live observers;
- room streams use `mode=summary` and do not receive token deltas;
- if a session has no live observer, Chat Web suppresses live-only SSE frames but still buffers them and persists the final message;
- if a user enters mid-turn, the existing `outputCompactor.snapshotsForSession()` mechanism can send the current accumulated partial state, then continue with live deltas;
- if the connection drops, the registry removes the observer and future deltas stop; the current turn still finishes and persists complete final output.

This change improves browser/gateway transfer and UI work. It does not stop upstream provider streaming inside Pi Coding Agent. True provider non-streaming would need a Pi/runtime API change; Pibo currently calls `runtime.session.prompt(...)`, and Pi exposes `streamingBehavior` only for queueing while already streaming, not for turning provider streaming off.

## Current architecture

### Runtime and router events

`src/core/routed-session.ts` subscribes to Pi Coding Agent events in `bindRuntimeSession()`. It normalizes Pi `message_update` events into Pibo output events such as `assistant_delta`, `thinking_delta`, `assistant_message`, and tool events. `processQueuedMessage()` emits `message_started`, awaits `runtime.session.prompt(...)`, and then emits `message_finished` or `session_error`.

The router exposes a simple `subscribe(listener)` API in `src/core/session-router.ts`. It has no subscriber intent, presence, or stream mode. Every router listener sees every normalized event and must filter locally.

### TCP gateway fanout

`src/gateway/server.ts` broadcasts router events to connected TCP clients. The protocol in `src/gateway/protocol.ts` supports:

- `legacy-all` subscriptions;
- session-scoped subscriptions by `piboSessionId`.

The gateway already classifies live deltas as droppable under backpressure, but it still sends deltas to matching connected clients. It does not know whether Chat Web has an active human observer.

### Chat Web indexing and compaction

`src/apps/chat/web-app.ts` calls `ensureEventIndexing()`, which subscribes Chat Web to all router events. It sends each event through `OutputCompactor` from `src/apps/chat/output-compactor.ts`.

`OutputCompactor` already does the important durable/live split:

- `assistant_delta` accumulates in memory and emits a snapshot, not a durable row;
- `assistant_message` persists the final text and clears the buffer;
- `thinking_delta` accumulates in memory until `thinking_finished`;
- `tool_execution_updated` is a live snapshot until `tool_execution_finished`;
- `message_finished` and `session_error` flush any remaining buffers so the final message remains complete.

`src/apps/chat/output-event-policy.ts` marks only `assistant_delta`, `thinking_delta`, and `tool_execution_updated` as live-only. `ChatEventCommandService.appendOutputEvent()` intentionally avoids inserting those live-only events into `event_log`.

So the durable storage problem is mostly solved. The live transport problem remains.

### Chat Web SSE streams

`/api/chat/events` in `src/apps/chat/web-app.ts` creates an SSE stream with `createEventStream()`.

Current behavior:

- On start, it replays durable `event_log` rows after the cursor.
- For selected-session streams, it calls `markEventStreamConnected()` and records the principal in `activeEventStreams`.
- It sends `outputCompactor.snapshotsForSession()` for an in-progress selected session.
- It registers a listener in `state.liveListeners` and writes matching events as `pibo` SSE frames.
- It writes a heartbeat comment every 25 seconds.
- On cancel, it removes the listener and calls `markEventStreamDisconnected()`.

`activeEventStreams` currently drives read-state updates. `markActiveSessionRead()` marks a selected session read when terminal assistant events arrive and a selected-session stream is active.

### UI consumption

`src/apps/chat-ui/src/App.tsx` opens two event streams in the session area:

1. A room-level stream: `/api/chat/events?roomId=...&since=...`.
   - It updates session statuses and schedules navigation/bootstrap refreshes.
   - It does not need text token deltas.
   - Because it subscribes by room, it can receive live frames for every session in that room.

2. A selected-session stream: `/api/chat/events?piboSessionId=...&since=...`.
   - It feeds live trace rendering.
   - This is the real live observer for assistant/thinking/tool deltas.

This is the main inefficiency: the room stream and selected-session stream can both receive the same live message frames, and the room stream ignores most of them.

## Existing hooks we can reuse

- `activeEventStreams`: already tracks active selected-session SSE connections by `piboSessionId` and principal.
- `createEventStream().cancel()`: already removes streams when the browser closes or the connection fails.
- SSE heartbeat comments: already keep the connection warm every 25 seconds.
- SSE cursors: `parseSseCursor()` and `Last-Event-ID` support durable replay.
- `OutputCompactor.snapshotsForSession()`: already supports mid-turn join by sending the accumulated partial state.
- `OutputCompactor.flushForBoundary()`: already preserves complete final messages when live deltas are missed or suppressed.
- Gateway backpressure policy: live deltas are already classified as droppable for slow TCP clients.
- `/health` and `/gateway/status` in `src/web/channel.ts`: useful for gateway health, but not for per-session observer intent.
- `/api/chat/signals/events`: already streams signal snapshots/patches for session activity. It can stay separate from text streaming.

## Health and signal channels

The current health stack does not require a WebSocket. The web channel serves `/health` and `/gateway/status`; the Chat UI also uses signal streams through `/api/chat/signals/events` for runtime activity. Those endpoints answer "is the gateway/runtime alive?" They do not answer "does this browser tab want token streaming for this session?"

Observer-gated text streaming should therefore use explicit intent on `/api/chat/events`, not gateway health. Keep signal SSE for activity state. Add an optional app-level observer heartbeat only if SSE cancellation proves too slow for half-open connections.

## Gaps

1. **No stream intent.** `/api/chat/events` has no mode parameter. Room streams receive the same frame shape as selected-session streams.

2. **No observer-gated live fanout.** `ensureEventIndexing()` forwards every live-only event to `state.liveListeners`. Each stream listener filters by room/session, but no central check suppresses live-only events when nobody is watching that session.

3. **Room streams over-subscribe.** The UI room stream needs status and navigation events, not token deltas.

4. **Presence is transport-derived only.** Server presence relies on SSE lifecycle. That is enough for normal browser close/reload. It may be slow for half-open network failures. There is no app-level acknowledgement from the browser.

5. **Upstream model streaming cannot be disabled from Pibo today.** Pi Coding Agent exposes live event subscription and `streamingBehavior` for already-streaming prompt queue behavior, but Pibo has no `stream: false` prompt option.

## Recommended design

### 1. Add stream modes to `/api/chat/events`

Extend `createEventStream()` with a stream mode:

- `mode=live`: selected session, sends live-only deltas and terminal events.
- `mode=summary`: room/session navigation stream, sends durable/structural events needed for status and refresh; suppresses token/thinking/tool-update deltas.
- optional default: `piboSessionId` implies `live`; `roomId` implies `summary`.

This avoids breaking clients while making new intent explicit.

### 2. Promote `activeEventStreams` into a live observer registry

Replace or extend `activeEventStreams` with a named registry:

```ts
type ChatStreamObserver = {
  observerId: string;
  piboSessionId: string;
  principalId: string;
  mode: "live" | "summary";
  connectedAt: string;
  lastSeenAt: string;
};
```

Keep read-state behavior tied to `mode === "live"` and selected-session streams.

### 3. Gate live-only forwarding centrally

In `ensureEventIndexing()`:

- Always pass events through `OutputCompactor`.
- Always persist compacted final events.
- For live-only events, notify live listeners only if `hasLiveObserver(piboSessionId)` is true.
- For non-live events, notify listeners as today.

This preserves final message correctness while stopping unnecessary delta transfer.

### 4. Keep graceful mid-turn behavior

When a live observer connects during an active turn:

- replay durable events after the cursor;
- send `outputCompactor.snapshotsForSession(piboSessionId)`;
- stream subsequent live deltas while the observer remains active.

When the observer disconnects during a turn:

- remove the observer;
- stop forwarding future live-only frames for that session;
- keep compacting in memory;
- persist and send final `assistant_message`, `thinking_finished`, `tool_execution_finished`, `message_finished`, or `session_error` when available.

This creates the requested fluid transition: no partial message is lost, and no new live stream starts until a live observer exists again.

### 5. Make room streams summary-only in the UI

Change the room EventSource in `src/apps/chat-ui/src/App.tsx` to request `mode=summary`. Its handler already ignores token content, so this should be a small UI change.

Change selected-session EventSource to request `mode=live`. This stream remains the only source for live trace rendering.

### 6. Optional app-level heartbeat

SSE cancel usually detects closed browser connections. If we need faster stale detection for half-open links, add a lightweight heartbeat endpoint instead of a WebSocket:

- `POST /api/chat/events/presence` with `{ observerId, piboSessionId, mode }` every 10-15 seconds;
- expire observers after about 45 seconds without a heartbeat;
- send a final heartbeat via `navigator.sendBeacon()` on unload where possible.

This is optional for phase 1. The existing SSE lifecycle plus 25-second heartbeat should be enough to start.

## Why not WebSockets first?

The current web stack uses same-origin HTTP and SSE. It already supports streaming, auth, replay cursors, and browser reconnects through `EventSource`. A WebSocket would add a second transport, more auth/lifecycle code, and new tests without solving the core issue. The missing piece is not bidirectional transport; it is stream intent and observer gating.

Use a WebSocket only if future requirements need bidirectional low-latency control on the same connection. For the current goal, SSE plus optional HTTP heartbeat is simpler.

## Implementation plan

### Phase 1: Stop duplicate and unobserved SSE deltas

1. Add `mode` parsing to `/api/chat/events`.
2. Default `roomId` streams to `summary` and selected `piboSessionId` streams to `live`.
3. Only register live observers for `mode=live` and a concrete `piboSessionId`.
4. Suppress live-only frame writes for summary streams.
5. Gate live-only listener notifications on `hasLiveObserver(sessionId)`.
6. Update Chat UI EventSource URLs to pass `mode=summary` or `mode=live`.
7. Add tests for:
   - room streams do not receive `TEXT_MESSAGE_CONTENT`;
   - selected-session streams do receive it;
   - no live observer still persists final `assistant_message`;
   - mid-turn live observer receives snapshot plus subsequent deltas;
   - disconnect removes observer and stops future live deltas.

### Phase 2: Better stale observer handling

1. Add observer metadata and TTL.
2. Add optional browser heartbeat POST.
3. Expire stale observers and record diagnostics.
4. Add tests for TTL expiry and reconnect.

### Phase 3: True upstream non-streaming, if still needed

1. Add a Pi Coding Agent prompt option for non-streaming provider calls or final-only event emission.
2. Expose that option through `RoutedSession.processQueuedMessage()`.
3. Decide per turn whether to call Pi in live or final-only mode based on observer state at turn start.
4. Preserve the current compactor fallback for providers that cannot disable streaming.

This phase is larger and crosses the Pi/Pibo boundary. It should be a separate design/spec.

## Risks and edge cases

- **Late joiners need current partial state.** The current `snapshotsForSession()` mechanism handles this, but tests should cover assistant, thinking, and tool-update snapshots.
- **Final events must remain complete.** `flushForBoundary()` already handles missing final assistant/thinking events; tests should lock that behavior.
- **Room UI status must still update.** Summary mode must still deliver `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `TEXT_MESSAGE_END`, and user accepted/failed events, or equivalent refresh triggers.
- **Multiple tabs.** The observer registry must count all live observers per session. Streaming stops only when the last live observer disconnects or expires.
- **Read-state semantics.** Room streams must not mark messages read. Only live selected-session observers should update read cursors, matching the existing test intent.
- **Backpressure.** Selected-session live streams can still be slow. Existing gateway policy handles TCP backpressure; SSE writes should get safe enqueue handling so a closed controller does not throw inside a listener.
- **Process restart.** In-memory compactor snapshots vanish on restart. Durable final events remain available through `event_log`; a reconnect after restart may see final-only behavior until the current turn completes or fails.

## Acceptance criteria

- A room-level Chat UI stream no longer receives token-level assistant/thinking/tool update frames.
- A selected-session Chat UI stream still renders live assistant text.
- With no selected-session observer, live-only deltas are not sent to browser SSE clients.
- Final assistant output persists and is available through trace/bootstrap after completion.
- Joining mid-turn shows the current partial output and continues live streaming from that point.
- Disconnecting the last live observer stops live-only delivery without aborting the agent turn.
- Existing unread behavior remains: room streams do not mark assistant messages read; selected live streams do.

## Bottom line

Implement observer-gated SSE first. It fits the existing infrastructure, uses the current compactor, and directly removes the waste we can see today: duplicate room/session streams and live deltas without a useful viewer. Treat upstream provider non-streaming as a later Pi runtime feature, not as the first step.
