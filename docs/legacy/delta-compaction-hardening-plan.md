---
type: "Historical Record"
title: "Delta Compaction Hardening Plan"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/delta-compaction-hardening-plan.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "58747a98e56c718d5250ab961de3b238e2c4b3a2"
  source_bytes: 11888
  source_sha256: "aef9e94c156b5d6f618e3c84cb87615245797ac37893bee007238c5b33046296"
  source_body_sha256: "aef9e94c156b5d6f618e3c84cb87615245797ac37893bee007238c5b33046296"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Delta Compaction Hardening Plan

Date: 2026-05-05

## Goal

Keep Chat Web streaming as smooth as it is today, but stop storing streaming deltas permanently. While a turn is running, the UI may receive and render deltas. As soon as the complete message, reasoning block, or tool span is available, replace the delta-built state with the complete canonical span/event. Reloading a session must never depend on `assistant_delta`, `thinking_delta`, or `tool_execution_updated` rows.

## Non-negotiable invariants

1. **No message loss.** If the user saw streamed text, the completed session must contain the same text after reload.
2. **No persisted deltas.** New writes to durable stores must not include `assistant_delta`, `thinking_delta`, or `tool_execution_updated`.
3. **Live streaming stays incremental.** Active SSE clients still receive small text chunks with the same latency profile.
4. **Final state is canonical.** Completed assistant text, reasoning text, and tool state replace their delta-built temporary nodes.
5. **Trace ordering is stable.** Compaction must preserve `eventId`, content indices, tool call IDs, timestamps, and trace order keys.
6. **Reconnects are safe.** A reconnect during an active turn receives enough current in-memory state to continue rendering without gaps.
7. **Reloads are compact.** A page reload reads only canonical persisted events plus any currently open in-memory span snapshots.

## Current risk points

- `ensureEventIndexing()` stores every `PiboOutputEvent` in three places: `ChatEventLog`, `ChatWebReadModel`, and `PiboReliabilityStore`.
- `chatStreamFramesFromOutputEvent()` always appends a `RAW_EVENT` frame, so the client adds live deltas to `selectedTraceEvents`.
- `/api/chat/trace` rebuilds from persisted events, and `rawEventsLimit` can drop the beginning of long histories.
- The trace engine currently knows how to merge deltas, so tests may pass even though the store contains thousands of rows.
- Existing sessions already contain deltas and need migration or fallback handling.

## Target architecture

Split the pipeline into two paths:

```text
PiboOutputEvent
  ├─ live stream path: every event, including deltas, goes to active SSE clients
  └─ durable path: only canonical compact events go to persistent stores
```

Add one shared component:

```text
src/apps/chat/output-compactor.ts
```

It owns active-turn aggregation and exposes:

```ts
type CompactorResult = {
  liveEvents: PiboOutputEvent[];        // normally the original event
  persistedEvents: PiboOutputEvent[];   // never live-only deltas
  snapshots: PiboOutputEvent[];         // current complete partial spans for reconnect/reload while running
};
```

## Event rules

### Assistant text

- `assistant_delta`
  - Broadcast live.
  - Append to in-memory assistant buffer keyed by:
    - `piboSessionId`
    - `eventId`
    - `assistantIndex ?? contentIndex ?? 0`
  - Do not persist.
  - Emit/update an in-memory assistant span snapshot for reconnects.

- `assistant_message`
  - Treat as authoritative final text if `text` is present.
  - If final text is empty but a buffer exists, use the buffered text.
  - Persist exactly one canonical `assistant_message` for that assistant part.
  - Clear the buffer.
  - Notify live clients to replace the delta-built node with the final assistant span/event.

### Reasoning text

- `thinking_started`
  - Persist. It creates the stable reasoning span shell.
  - Start/reset the in-memory reasoning buffer for the part.

- `thinking_delta`
  - Broadcast live.
  - Append to in-memory reasoning buffer keyed by:
    - `piboSessionId`
    - `eventId`
    - `thinkingIndex ?? contentIndex ?? 0`
  - Do not persist.
  - Emit/update an in-memory reasoning span snapshot for reconnects.

- `thinking_finished`
  - If `text` is present, use it.
  - Otherwise use the buffered reasoning text.
  - Persist exactly one canonical `thinking_finished` with full text.
  - Clear the buffer.
  - Notify live clients to replace the delta-built reasoning node with the final reasoning span/event.

### Tool spans

- `tool_call`
  - Persist only if it materially changes the complete tool-call input.
  - Prefer one final args-complete `tool_call` per `toolCallId`.
  - If args stream in multiple `tool_call` events, compact by `toolCallId` and replace previous incomplete tool-call state.

- `tool_execution_started`
  - Persist once per `toolCallId`.

- `tool_execution_updated`
  - Broadcast live if needed for active progress UI.
  - Do not persist.
  - Keep only the latest in-memory progress snapshot for reconnects.

- `tool_execution_finished`
  - Persist once per `toolCallId` with final result and `isError`.
  - Clear any progress snapshot for that tool.
  - This is the canonical complete tool span result.

### Run and error boundaries

- `message_finished`
  - Persist.
  - Flush any open assistant or reasoning buffers for the same `eventId` before or with this event.

- `session_error`
  - Persist.
  - Flush open assistant/reasoning buffers as synthetic final events marked as incomplete in metadata, then clear them.

- Gateway shutdown
  - Best effort: flush open buffers before close.
  - On next startup, existing persisted canonical events remain valid. No live-only deltas should be needed for completed sessions.

## Client hardening

The client must compact its live `selectedTraceEvents`, not just the server stores.

Add a client-side trace event reducer, e.g.:

```text
src/apps/chat-ui/src/traceLiveReducer.ts
```

Rules:

1. Apply live delta frames to temporary in-memory span state for smooth rendering.
2. When final `assistant_message` arrives, remove matching `assistant_delta` events from client state and keep only the canonical `assistant_message`.
3. When final `thinking_finished` arrives, remove matching `thinking_delta` events and keep `thinking_started` + canonical `thinking_finished`.
4. When `tool_execution_finished` arrives, remove matching `tool_execution_updated` events and keep started + finished.
5. Preserve `eventSequence`, `streamId`, and frame ordering for final events.
6. Never rebuild a completed trace from unbounded live deltas.

This keeps long active sessions from growing in browser memory and ensures `TraceTimeline` receives complete spans after completion.

## SSE hardening

Keep two kinds of SSE payloads:

1. **Live delta frames** for active clients:
   - `TEXT_MESSAGE_CONTENT`
   - `REASONING_MESSAGE_CONTENT`
   - progress frames for tool updates

2. **Canonical trace frames** for durable state:
   - `RAW_EVENT` should carry only persistable canonical events.
   - Do not emit `RAW_EVENT` for live-only deltas.

For reconnects:

- Replay persisted compact events from `ChatEventLog`.
- Then send current in-memory snapshots for still-running messages/tools.
- Resume new live deltas after the snapshot.
- Use monotonic SSE frame IDs. Snapshot frames should not pretend to be durable DB rows unless they map to a real persisted `streamId`.

## Store hardening

### ChatEventLog

- Reject or ignore live-only deltas in `appendOutputEvent()`.
- Add a guard test that `chat_events` never contains:
  - `assistant_delta`
  - `thinking_delta`
  - `tool_execution_updated`

### ChatWebReadModel

- Reject or ignore live-only deltas in `recordEvent()`.
- Prefer receiving only compact events from `ensureEventIndexing()`.
- Status should rely on starts/finishes, not deltas.

### PiboReliabilityStore

- Do not append live-only deltas to topic `pibo.output`.
- Keep durable audit/trace events only.

## Migration plan

Add an idempotent command:

```bash
pibo debug events compact-deltas --dry-run
pibo debug events compact-deltas --apply
```

Migration per session:

1. Read all events ordered by durable sequence.
2. Group deltas by `piboSessionId`, `eventId`, part index, and type.
3. For each assistant group:
   - Keep existing `assistant_message` if present.
   - If missing, create one synthetic `assistant_message` from joined deltas.
4. For each reasoning group:
   - Keep `thinking_started`.
   - Keep or create `thinking_finished` with full text.
5. For each tool group:
   - Drop `tool_execution_updated`.
   - Keep start and finish.
   - Compact repeated/incomplete `tool_call` rows to the latest complete args row when possible.
6. Delete old delta/update rows.
7. Recompute or preserve ordering so the trace engine renders the same logical order.
8. Run consistency checks after each session.

The migration must support `--dry-run` with counts and sample IDs before destructive changes.

## Rollout plan

1. Add compactor and unit tests in isolation.
2. Wire live SSE path first, but keep existing persistence behind a feature flag.
3. Enable compact persistence in Docker worker only.
4. Run synthetic streaming tests:
   - long assistant response
   - long reasoning response
   - interrupted response
   - reconnect mid-stream
   - tool call with long args and updates
5. Compare trace snapshots before and after compaction.
6. Add store-level assertions that no deltas are durable.
7. Add migration command and dry-run on current data.
8. Apply migration in staging/worker copy.
9. Deploy only after browser E2E confirms:
   - live text streams chunk by chunk
   - final spans replace temporary delta spans
   - first message in long sessions remains reachable
   - reload shows same completed trace without deltas

## Test matrix

### Unit tests

- Assistant deltas compact to one `assistant_message`.
- `assistant_message.text` overrides buffered text.
- Missing final assistant text falls back to buffer.
- Thinking deltas compact to one `thinking_finished.text`.
- `thinking_finished.text` overrides buffered text.
- `tool_execution_updated` is live-only.
- Repeated `tool_call` args compact without losing the final args.
- `session_error` flushes open text buffers.
- Compactor cleanup removes per-turn state.

### Integration tests

- `ensureEventIndexing()` broadcasts deltas live but persists only canonical events.
- `/api/chat/events` replay returns compact history plus active snapshots.
- `/api/chat/trace` builds the same logical nodes from compact events.
- `web_chat_events`, `chat_events`, and `pibo_events` contain no live-only deltas after a run.
- Existing delta-heavy sessions still render through migration or fallback.

### Browser tests

- Send a prompt that streams many assistant chunks; verify the text appears incrementally.
- Wait for completion; reload; verify the full message is still present.
- Verify the DOM/trace row count does not grow with each delta after finalization.
- Reconnect mid-stream; verify no duplicated or missing text.
- Scroll to top in a long session; verify the first user message is reachable.

## Implementation notes

- Keep stable keys. The final event must use the same `eventId` and part index as its deltas so `TraceTimeline` updates in place instead of mounting a different span.
- Prefer replacement over append in live client state. Duplicate assistant or reasoning nodes are worse than delayed finalization.
- Keep compactor state bounded. Clear by `eventId` on message finish/error and by TTL as a last-resort cleanup.
- Make store guards defensive. Even if a future caller bypasses the compactor, durable stores should refuse live-only delta events.
- Add debug counters: buffered parts, flushed parts, dropped live-only deltas, synthetic finals, and persistence rejections.

## Definition of done

- New sessions persist zero `assistant_delta`, `thinking_delta`, and `tool_execution_updated` rows.
- Active streaming feels unchanged in the browser.
- Completed messages and reasoning render as complete spans after final events arrive.
- Reloading a completed session renders from compact canonical events only.
- Long sessions no longer lose early history due to raw event tail limits.
- Migration can compact existing sessions safely with a dry-run report.
