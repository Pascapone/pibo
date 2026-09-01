---
type: "Historical Record"
title: "Chat Web Trace And Streaming Architecture"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/chat-web-trace-streaming-architecture.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "9ddb7009eef8787a67082882ac5713dedd595906"
  source_bytes: 11922
  source_sha256: "d0698551a3d6a0eb39ca97e862ba43d056947cb3d402d2a8214ef2bd6569c21a"
  source_body_sha256: "d0698551a3d6a0eb39ca97e862ba43d056947cb3d402d2a8214ef2bd6569c21a"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Chat Web Trace And Streaming Architecture

Date: 2026-05-06

This document describes the current Chat Web trace system after the live-overlay fix from commit `096348f`. It focuses on the three data layers that produce the visible session view, the SSE streaming path, and the rule that prevents truncated history.

## Summary

Chat Web renders a session from three layers:

```text
Layer 1: Pi transcript JSONL
  -> complete persisted conversation and tool transcript

Layer 2: Chat Web event stores
  -> durable room/session events, raw Pibo output events, trace metadata

Layer 3: Live UI overlay
  -> current SSE frames patched onto the server trace until refresh catches up
```

The server-built trace is the canonical render base. Raw events and SSE events are supporting data. They must not replace the complete trace view.

## Key Terms

- **Pibo Session ID** routes product actions, API requests, SSE streams, room membership, and UI selection.
- **Pi Session ID** identifies Pi Coding Agent's persisted JSONL transcript and provider cache affinity.
- **Chat Web Trace View** is the read-time projection returned by `/api/chat/trace`.
- **Raw Pibo Event Log** is a bounded debugging and reconstruction input, not the canonical transcript.
- **Live Overlay** is the frontend-only list of unrefreshed SSE-derived events for the selected session.

## The Three Layers

### Layer 1: Pi Transcript JSONL

The Pi transcript is the source of truth for completed model conversation history. It contains persisted user messages, assistant messages, reasoning parts, tool calls, and tool results.

Server code reads it through `buildTraceView`:

```text
src/apps/chat/trace.ts
  -> loadPiSessionMetadata(...)
  -> readEntries(metadata.sessionPath)
  -> parseSessionEntries(...)
  -> buildTraceViewFromEvents({ transcriptEntries, events, sessions })
```

The trace engine converts transcript entries into stable trace nodes:

```text
src/shared/trace-engine.ts
  -> traceNodesFromEntries(...)
```

Transcript-backed nodes use Pi JSONL entry order and content-part order. They do not depend on wall-clock timestamps or event replay order.

### Layer 2: Chat Web Event Stores

Chat Web stores product and trace events in `.pibo/web-chat.sqlite`.

The important tables are:

- `chat_events`: durable room/session event log with monotone `stream_id` values.
- `web_chat_events`: read-model rows for raw normalized `PiboOutputEvent` values and per-session `event_sequence`.
- room/session tables such as `pibo_rooms`, `pibo_room_members`, and `chat_session_reads`.

The event layer serves several jobs:

- rebuild event-derived trace nodes that are not present in Pi JSONL yet,
- provide raw event inspection in the right-side Raw Events panel,
- support SSE catch-up and reconnect,
- keep room/session unread cursors and audit events durable.

The trace endpoint reads event rows with a limit:

```text
GET /api/chat/trace?piboSessionId=...&includeRawEvents=true&rawEventsLimit=80
```

That limit bounds raw debug payloads. It must not limit visible history.

### Layer 3: Live UI Overlay

The live overlay exists only in the React app. It holds SSE-derived `ChatWebStoredEvent` values that arrived after the last server trace response.

Relevant code:

```text
src/apps/chat-ui/src/App.tsx
  -> liveTraceOverlay state
  -> applyTraceLiveEvents(...)
  -> patchTraceViewWithEvents(...)
  -> trimLiveOverlayForBaseTrace(...)

src/apps/chat-ui/src/traceLiveReducer.ts
  -> converts compact SSE frames to stored-event-shaped live events
```

The overlay keeps streaming responsive. The UI does not wait for `/api/chat/trace` after every token. Instead, it patches deltas into the current server trace and refreshes the server trace at lifecycle boundaries.

## Server Trace Build Flow

The server trace endpoint combines Layer 1 and Layer 2:

```text
GET /api/chat/trace
  -> require Better Auth session
  -> resolve selected Pibo Session
  -> find linked Pi Session metadata
  -> read Pi transcript JSONL
  -> list Chat Web trace events
  -> buildTraceView(...)
  -> return PiboSessionTraceView
```

The returned `PiboSessionTraceView` contains:

- `piboSessionId`
- `piSessionId`
- `title`
- `version`
- `latestStreamId`
- `nodes`
- optional bounded `rawEvents`

The `nodes` array is the render base. The `rawEvents` array is an optional tail for debug and live reconciliation.

## SSE Streaming Flow

The live stream endpoint sends compact frames:

```text
GET /api/chat/events?piboSessionId=...&roomId=...&since=<streamId>:<frameIndex>
```

The server emits plain SSE frames with `event: pibo`. The payload shape is compact and AG-UI-inspired:

- `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`
- `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END`
- `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`
- `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_RESULT`
- `AGENT_DELEGATION`
- `EXECUTION_RESULT`
- `RAW_EVENT`

Each persistent frame uses this cursor format:

```text
id: <streamId>:<frameIndex>
```

One durable chat event can expand into several UI frames, so `frameIndex` is required for precise reconnect.

In the frontend:

```text
EventSource('/api/chat/events?...')
  -> pendingStreamEventsBySession
  -> requestAnimationFrame batching
  -> applyTraceLiveEvents(...)
  -> liveTraceOverlay
  -> patchTraceViewWithEvent(...)
```

The timing path remains intentionally small. Token deltas are batched with `requestAnimationFrame`, then patched locally. The client schedules `/api/chat/trace` refreshes on terminal or structural events so the server view eventually absorbs the overlay.

## The Bug Fixed In This Session

Before commit `096348f`, the UI used `rawEvents` as the full render input:

```text
server trace nodes + rawEvents
  -> frontend keeps rawEvents
  -> frontend rebuilds trace from rawEvents only
  -> visible history is limited by rawEventsLimit
```

Because the default raw event limit is 80, old messages disappeared from long sessions. The Pi transcript still contained them, and the server trace still built them, but the frontend replaced the server nodes with a client rebuild from the bounded raw tail.

The fix changed the frontend rule:

```text
server trace nodes
  + live overlay events
  -> patched current trace view
```

The UI now keeps `traceQuery.data.nodes` as the canonical base. It uses live events only as an overlay until the next server trace refresh.

## Current Frontend Contract

`SessionTracePane` follows this contract:

1. Fetch `/api/chat/trace` for the selected Pibo Session.
2. Treat `traceQuery.data` as the complete base trace.
3. Keep `liveTraceOverlay` separate from `rawEvents`.
4. Build `currentTraceView` by patching overlay events onto the base trace.
5. Clear overlay events that the refreshed server trace has caught up with.

The key functions are:

```text
patchTraceViewWithEvents(view, events, status)
  -> folds events through patchTraceViewWithEvent(...)

trimLiveOverlayForBaseTrace(overlay, baseTrace)
  -> drops overlay events whose streamId is already included in baseTrace.latestStreamId
```

This keeps old transcript nodes visible while new streaming output appears immediately.

## Raw Events Panel

The Raw Events panel still reads from `currentTraceView.rawEvents` and shows a bounded, compacted tail. This panel is for inspection, not for canonical rendering.

Rules:

- Keep `DEFAULT_RAW_EVENTS_LIMIT` small enough for UI/debug use.
- Do not infer complete chat history from `rawEvents`.
- Do not rebuild the visible trace solely from `rawEvents`.
- Use `pibo debug trace <pibo-session-id>` when complete server reconstruction needs inspection.

## Ordering Model

Trace order comes from explicit source-aware order keys:

- transcript nodes use Pi entry/content-part order,
- stored event nodes use per-session `event_sequence`,
- live nodes use SSE `streamId` and `streamFrameIndex`.

Shared ordering code lives in:

```text
src/shared/trace-order.ts
```

This avoids UI jumps caused by timestamp variance during refresh or replay.

## Refresh And Overlay Reconciliation

The frontend refreshes the trace after important stream frames. Examples include:

- `TEXT_MESSAGE_END`
- `RUN_FINISHED`
- `RUN_ERROR`
- structural tool/delegation events

Refresh does not block token streaming. The overlay remains active until a successful server trace response arrives.

After refresh, `trimLiveOverlayForBaseTrace` compares overlay event `streamId` values to `baseTrace.latestStreamId`. Events already represented by the server trace are removed. Events beyond the server trace remain in the overlay so a partial refresh does not make a live message disappear.

## Debugging Checklist

When a trace looks incomplete, check the layers in order.

### 1. Confirm the Pibo Session and Pi Session

```bash
npm run dev -- debug session <pibo-session-id>
```

Look for the linked `piSessionId`, workspace, room id, parent id, and origin id.

### 2. Rebuild the server trace

```bash
npm run dev -- debug trace <pibo-session-id> --check
```

If this contains the missing messages, the server has the history. The problem is likely in the frontend overlay/render path.

### 3. Inspect raw event limits

```bash
curl '/api/chat/trace?piboSessionId=<id>&includeRawEvents=true&rawEventsLimit=80'
```

A small `rawEvents` tail is expected. Missing old events in `rawEvents` are not a bug by themselves.

### 4. Inspect live stream cursors

Check `latestStreamId` in `/api/chat/trace` and SSE frame ids from `/api/chat/events`. If the overlay contains events with stream ids greater than `latestStreamId`, the client should keep them until a later refresh catches up.

## Tests Covering This Contract

`test/chat-ui-integration.test.mjs` includes regression coverage for the overlay rule:

```text
live event patching preserves transcript history
```

The test builds a base trace from transcript entries, applies live events, and asserts that old transcript-backed messages remain visible while the live assistant output is added.

Related tests cover:

- live stream simulation,
- refresh during streaming,
- replayed stream frames,
- incremental patch parity with full rebuild,
- patch performance.

Run them with:

```bash
npm run build
node --test test/chat-ui-integration.test.mjs
```

## Rules For Future Changes

Follow these rules when changing trace or streaming code:

1. The server trace view is the canonical render base.
2. Pi JSONL remains the source of truth for completed transcript history.
3. Raw events are a bounded debug/reconstruction tail.
4. SSE frames are live transport, not durable canonical state.
5. The frontend may patch live events, but it must not replace server nodes with a raw-event-only rebuild.
6. Trace refresh must not block token streaming.
7. Overlay cleanup must be conservative: keep live events when the server has not caught up.
8. Ordering must use `trace-order.ts`, not wall-clock timestamps alone.
9. Session routing uses Pibo Session IDs; Pi persistence uses Pi Session IDs.
10. Subagent display must preserve both inline delegation nodes and selectable child sessions.

## Files To Read First

For trace and streaming work, start with these files:

```text
src/apps/chat/trace.ts
src/shared/trace-engine.ts
src/shared/trace-order.ts
src/shared/trace-types.ts
src/apps/chat/stream.ts
src/apps/chat/web-app.ts
src/apps/chat-ui/src/App.tsx
src/apps/chat-ui/src/traceLiveReducer.ts
src/apps/chat-ui/src/session-views/TraceSessionView.tsx
test/chat-ui-integration.test.mjs
```

## Incident Lesson

The failure mode was subtle because all layers contained valid data. The server had the complete transcript, and the client had a valid raw-event tail. The bug came from treating the tail as the whole trace.

Keep source roles explicit. Complete history comes from the server trace. Streaming responsiveness comes from the live overlay. Debug inspection comes from raw events.
