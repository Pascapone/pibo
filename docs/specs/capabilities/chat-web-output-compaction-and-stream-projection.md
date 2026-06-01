# Spec: Chat Web Output Compaction and Stream Projection

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md), [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md)

## Why

Router output is optimized for live runtime delivery. It may contain many small assistant deltas, thinking deltas, and tool-progress updates before a final event arrives. Chat Web needs to show these updates live, replay useful state after reconnects, and persist only durable events that are safe for long-term timelines and projections.

Without a clear compaction contract, Chat Web can duplicate assistant text, lose in-progress thinking, persist noisy live-only rows, or replay a stream that starts in the middle of a tool call with no useful current snapshot.

## Goal

Pibo MUST convert raw `PiboOutputEvent` values into live frames, durable events, and reconnect snapshots so Chat Web can stream current activity without polluting the durable event log with live-only deltas.

## Background / Current State

The current implementation uses `OutputCompactor` and `output-event-policy` in `src/apps/chat/`. `ensureEventIndexing()` in `src/apps/chat/web-app.ts` compacts each routed output event, persists `persistedEvents` through `ChatDataIngestService`, emits `liveEvents` to active listeners, and stores `snapshots` for reconnects. `chatStreamFramesFromOutputEvent()` maps output events to browser-facing stream frames such as `TEXT_MESSAGE_CONTENT`, `REASONING_MESSAGE_END`, `TOOL_CALL_RESULT`, `AGENT_DELEGATION`, and `RAW_EVENT`.

## Scope

### In Scope

- Classification of live-only and persistable output event types.
- Assistant, thinking, and tool-progress compaction for Chat Web streams.
- Boundary flushing when a turn finishes or errors.
- Session-scoped snapshot replay for active assistant text, thinking text, and tool-progress state.
- Mapping compacted output events into Chat Web stream frames.
- Idempotent durable ingestion expectations for compacted output events.

### Out of Scope

- Room membership, unread counts, and SSE cursor access control — covered by the Chat Web Rooms and Event Streams spec.
- Trace row ordering and terminal UI rendering — covered by the Chat Web Trace and Terminal View spec.
- The canonical Pibo output event type definitions — managed by the routed runtime and event-core specs.
- Pi transcript persistence and Pi session compaction prompts.

## Requirements

### Requirement: Live-only output is not persisted directly

The system MUST classify `assistant_delta`, `thinking_delta`, and `tool_execution_updated` as live-only events for Chat Web durable ingestion.

#### Current

`isLiveOnlyOutputEvent()` returns true for those three event types. `ChatEventCommandService.appendOutputEvent()` and V2 data queries treat these event types as excluded from durable chat event rows unless they are compacted into a terminal event.

#### Target

Active listeners still receive every live-only event, but durable stores receive final assistant messages, final thinking messages, and terminal tool results instead of raw delta spam.

#### Acceptance

- A raw `assistant_delta` is emitted to live listeners and is not appended as a durable event-log row by normal ingestion.
- A raw `thinking_delta` is emitted to live listeners and is not appended as a durable event-log row by normal ingestion.
- A raw `tool_execution_updated` is emitted to live listeners and is not appended as a durable event-log row by normal ingestion.
- Non-live-only output events remain eligible for durable ingestion.

#### Scenario: Assistant streams text

- GIVEN the router emits three `assistant_delta` events for one turn
- WHEN Chat Web indexes those events
- THEN connected clients receive the deltas live
- AND the durable chat event log does not store three separate assistant-delta rows.

### Requirement: Assistant deltas compact into one final assistant message

The system MUST buffer assistant deltas by session, turn event id, and assistant/content part index until a final `assistant_message` or boundary event arrives.

#### Current

`OutputCompactor` keys assistant output with `assistantOutputKey()`, appends delta text, emits accumulated snapshot events, and replaces an empty final assistant message with buffered text when available.

#### Target

Chat Web can recover the full assistant text even when the provider sends the text as deltas and the final event carries empty text.

#### Acceptance

- Deltas for different sessions, event ids, or part indexes do not merge.
- Each assistant snapshot contains the accumulated text for that key.
- `assistant_message.text` uses explicit final text when present.
- `assistant_message.text` falls back to buffered delta text when final text is empty.
- The assistant buffer is cleared after finalization.

#### Scenario: Empty final assistant event

- GIVEN a turn emits `assistant_delta` text `hel` and `lo`
- AND then emits `assistant_message` with empty text
- WHEN Chat Web compacts the output
- THEN the persisted assistant message text is `hello`
- AND subsequent assistant output for the same turn starts from an empty buffer.

### Requirement: Thinking output preserves start and final text semantics

The system MUST persist `thinking_started`, compact `thinking_delta` text, and persist `thinking_finished` with the final or buffered thinking text.

#### Current

`OutputCompactor` persists `thinking_started`, buffers delta text by `thinkingOutputKey()`, emits accumulated thinking snapshots, and replaces an empty `thinking_finished.text` with the buffered text.

#### Target

Trace and terminal views can show the existence of a thinking block early while avoiding durable storage of every reasoning delta.

#### Acceptance

- `thinking_started` is persistable and appears before the finalized thinking text.
- Thinking deltas for distinct part indexes remain separate.
- Snapshot replay can expose in-progress thinking as a `thinking_delta` event even when only `thinking_started` has been seen.
- `thinking_finished.text` uses final text when present and buffered text when final text is empty.
- The thinking buffer is cleared after finalization.

#### Scenario: Reconnect during thinking

- GIVEN a session emitted `thinking_started` and two `thinking_delta` events
- WHEN a browser reconnects to that session's stream before `thinking_finished`
- THEN snapshot replay includes the accumulated thinking text as an in-progress reasoning frame.

### Requirement: Tool progress snapshots are live and terminal results are durable

The system MUST treat `tool_execution_updated` as current live state and `tool_execution_finished` as the durable terminal result for a tool call.

#### Current

`OutputCompactor` stores the latest `tool_execution_updated` by session, event id, and tool call id, emits it as a snapshot, deletes the snapshot when `tool_execution_finished` arrives, and persists the finished event.

#### Target

Reconnects show the latest active tool progress without writing each progress update as a durable observation, and terminal tool output remains available after completion.

#### Acceptance

- Only the latest progress update per tool call is held for snapshot replay.
- A finished tool call removes its progress snapshot.
- `tool_execution_finished` is persisted and mapped to a terminal tool-result frame.
- Multiple tool calls in the same turn remain keyed independently by `toolCallId`.

#### Scenario: Tool progress updates twice

- GIVEN a tool call emits progress update `A` and then progress update `B`
- WHEN a browser reconnects before the tool finishes
- THEN the stream snapshot contains progress update `B`
- AND it does not replay progress update `A` as current state.

### Requirement: Turn boundaries flush unfinished text buffers

The system MUST flush assistant and thinking buffers for a turn when `message_finished` or `session_error` arrives.

#### Current

`flushForBoundary()` emits synthetic `assistant_message` and `thinking_finished` events for matching buffered state before persisting the boundary event. `message_finished` matches by session and event id. `session_error` matches by session and, when an event id is present, by event id.

#### Target

A partial finalization or runtime error does not leave invisible assistant or thinking text trapped only in memory.

#### Acceptance

- `message_finished` persists matching buffered assistant text before the finish event.
- `message_finished` persists matching buffered thinking text before the finish event.
- `session_error` without an event id flushes all buffered state for that session.
- `session_error` with an event id flushes only matching buffered state for that turn.
- Buffers for other sessions are not flushed by the boundary.

#### Scenario: Runtime error after partial answer

- GIVEN a session has buffered assistant text for turn `run-1`
- WHEN a `session_error` for that same session arrives without an event id
- THEN Chat Web persists a final assistant message with the buffered text before the error event.

### Requirement: Stream frames expose stable browser-facing lifecycle events

The system MUST map output events into Chat Web stream frames that separate run, message, reasoning, tool, delegation, execution, error, and raw-event lifecycles.

#### Current

`chatStreamFramesFromOutputEvent()` emits start/content/end frames for assistant text and reasoning, tool start/args/result frames for tool events, delegation frames for subagent sessions, execution-result frames for gateway actions, run start/finish/error frames, and `RAW_EVENT` by default.

#### Target

The browser can render a stable stream protocol without directly depending on every internal output-event shape.

#### Acceptance

- `message_started` maps to `RUN_STARTED` when it has an event id.
- Assistant deltas/messages map to `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, and `TEXT_MESSAGE_END` without duplicate starts.
- Thinking events map to `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, and `REASONING_MESSAGE_END` without duplicate starts.
- Tool events map to `TOOL_CALL_START`, `TOOL_CALL_ARGS`, and `TOOL_CALL_RESULT` without duplicate starts.
- `subagent_session`, `execution_result`, and `session_error` map to explicit stream frames.
- Raw event inclusion is on by default and can be disabled for callers that need only projected frames.

#### Scenario: Tool result without prior start frame

- GIVEN a stream state has not seen a tool call
- WHEN a `tool_execution_finished` event arrives
- THEN Chat Web first emits `TOOL_CALL_START`
- AND then emits `TOOL_CALL_RESULT` for the same tool call id.

### Requirement: Durable ingestion remains idempotent after compaction

The system MUST preserve idempotency when compacted output events are ingested into the V2 data store.

#### Current

`ChatDataIngestService.ingestOutputEvent()` derives an output idempotency key, returns existing rows for repeated events, writes event-log rows inside a transaction, and creates message or observation projections from the durable output event.

#### Target

Retries, reconnect processing, or duplicate routed notifications do not create duplicate assistant messages or observations.

#### Acceptance

- Re-ingesting the same compacted output event returns the existing stream id when an idempotency key is available.
- Assistant-message projection uses a deterministic message id for the output event.
- Output event ingestion creates at most one observation for the same durable event identity.
- Durable ingestion and navigation projection updates happen in one transaction.

#### Scenario: Duplicate final assistant message

- GIVEN Chat Web ingested an `assistant_message` for event id `run-1`
- WHEN the same event is delivered again
- THEN ingestion reports a duplicate
- AND no second assistant message is inserted for that output event.

## Edge Cases

- A final assistant or thinking event can arrive without prior deltas; it must still persist normally.
- A delta can arrive without an event id; compaction still keys it by session and part index, but boundary flushing can only match according to available event identity.
- A stream client can reconnect after the final event; snapshots must not include already-finished assistant, thinking, or tool state.
- Multi-part assistant and thinking content must not merge indexes that represent separate content parts.
- Runtime errors may be turn-scoped or session-scoped; flushing behavior depends on whether the error event includes an event id.

## Constraints

- **Compatibility:** Browser-facing stream frame names must remain stable for Chat Web clients.
- **Storage:** Live-only deltas must not become durable rows unless they are represented by a compacted terminal event.
- **Security / Privacy:** Compaction must not bypass the authenticated stream and room/session access checks that wrap event delivery.
- **Performance:** Buffer and snapshot state must be bounded by active sessions and in-flight output, not by historical event-log size.
- **Dependencies:** This capability depends on `PiboOutputEvent` shapes from `src/core/events.ts` and V2 store ingestion behavior from `src/data/ingest-service.ts`.

## Success Criteria

- [ ] SC-001: Unit coverage verifies live-only classification for assistant deltas, thinking deltas, and tool progress updates.
- [ ] SC-002: Output compactor tests verify assistant fallback text, thinking fallback text, tool snapshot replacement, and boundary flushing.
- [ ] SC-003: Stream projection tests verify start/content/end frame ordering and de-duplication for assistant, reasoning, and tool lifecycles.
- [ ] SC-004: Ingestion tests verify compacted final events are persisted idempotently while raw live-only deltas are not durable chat rows.
- [ ] SC-005: Reconnect behavior can replay current in-progress snapshots without replaying stale finished buffers.

## Assumptions and Open Questions

### Assumptions

- The in-memory compactor state is per Chat Web app instance; process restarts rely on persisted durable events and do not recover in-flight live-only buffers.
- Current live-only event types are intentionally limited to assistant deltas, thinking deltas, and tool execution updates.
- Browser clients still receive `RAW_EVENT` frames by default for compatibility and debugging.

### Open Questions

- Should compactor state expose metrics for buffer count and age to detect stuck in-flight turns?
- Should a future durable live-delta retention class exist for debugging, or should live-only remain strictly non-durable?
- Should stream frame versioning be explicit before third-party clients depend on this protocol?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| REQ-001 Live-only output is not persisted directly | Assistant streams text | `src/apps/chat/output-event-policy.ts`, `src/apps/chat/data/event-command-service.ts`, `src/apps/chat/data/timeline-query-service.ts` | Draft |
| REQ-002 Assistant deltas compact into one final assistant message | Empty final assistant event | `src/apps/chat/output-compactor.ts` | Draft |
| REQ-003 Thinking output preserves start and final text semantics | Reconnect during thinking | `src/apps/chat/output-compactor.ts`, `src/apps/chat/stream.ts` | Draft |
| REQ-004 Tool progress snapshots are live and terminal results are durable | Tool progress updates twice | `src/apps/chat/output-compactor.ts`, `src/apps/chat/output-event-policy.ts` | Draft |
| REQ-005 Turn boundaries flush unfinished text buffers | Runtime error after partial answer | `src/apps/chat/output-compactor.ts` | Draft |
| REQ-006 Stream frames expose stable browser-facing lifecycle events | Tool result without prior start frame | `src/apps/chat/stream.ts` | Draft |
| REQ-007 Durable ingestion remains idempotent after compaction | Duplicate final assistant message | `src/data/ingest-service.ts` | Draft |

## Verification Basis

This spec was derived from the current workspace code in:

- `src/apps/chat/output-compactor.ts`
- `src/apps/chat/output-event-policy.ts`
- `src/apps/chat/stream.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/data/event-command-service.ts`
- `src/apps/chat/data/timeline-query-service.ts`
- `src/data/ingest-service.ts`
