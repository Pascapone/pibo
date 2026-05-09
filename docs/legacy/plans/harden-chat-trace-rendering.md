# Harden Chat Trace Rendering

## Purpose

This plan hardens Pibo Chat Web trace rendering so traces are reliable, deterministic, inspectable, and fast enough for long streaming sessions.

The trace view is a product boundary. Users use it to understand what the agent actually did. It must not permanently or temporarily imply a false causal order for assistant responses, reasoning, tool calls, subagent delegations, yielded runs, or errors.

This is a planning and analysis update. It does not implement runtime changes yet.

## Current Assumptions

- Pi Coding Agent JSONL remains the canonical transcript source.
- Pibo Sessions remain the product source of truth for session identity, hierarchy, ownership, and Pi session linkage.
- Chat Web trace nodes remain a read-time projection for now; no durable materialized trace table is introduced in this hardening pass.
- Compact SSE frames from `src/apps/chat/stream.ts` remain the live transport format.
- The existing Chat Web UI may keep rendering spans temporarily, but trace semantics should move toward `PiboTraceNode` as the primary model.
- We should reuse the existing `pibo debug trace` command and extend it, not create a second debugging path.
- The separate performance plan in `plans/optimize-chat-trace-streaming-performance.md` is still relevant; this plan focuses on correctness first and folds in only the performance work needed to keep correctness changes scalable.

## Code Findings

Relevant current paths:

- `src/apps/chat/trace.ts`: server-side trace reconstruction from Pi JSONL plus stored Chat Web events.
- `src/apps/chat/stream.ts`: conversion from `PiboOutputEvent` to compact live `ChatStreamEvent` frames.
- `src/apps/chat/read-model.ts`: storage of raw Chat Web output events in `web_chat_events`.
- `src/apps/chat-ui/src/App.tsx`: client-side live overlay via `applyChatStreamEvents`.
- `src/apps/chat-ui/src/tracing/adapt.ts`: conversion from `PiboTraceNode` to spans.
- `src/apps/chat-ui/src/tracing/traceTree.ts`: display filtering, hoisting, and sorting.
- `src/debug/trace.ts`: existing debug trace reconstruction command.
- `test/chat-trace.test.mjs`: current server trace coverage.
- `test/debug-cli.test.mjs`: current debug CLI coverage.

Confirmed current strengths:

- Persisted assistant entries are now separated per entry. Tests cover assistant progress text before tools and final assistant text after tools.
- Server trace tests already cover content-part order, empty reasoning filtering, live assistant/reasoning delta replacement, missing retained start events, run notifications, async subagent nodes, repeated subagent session linking, and interleaved persisted reasoning/tool order.
- The client already batches pending stream frames with `requestAnimationFrame`, so "add batching" is not a new Phase 1 task.
- A `pibo debug trace` command already exists and reuses `buildTraceView`.

Confirmed risks:

- Server and client still have two separate trace projectors. `buildTraceView` and `applyChatStreamEvent` duplicate ids, parent rules, status transitions, async subagent handling, and raw event handling.
- Client live nodes use `new Date().toISOString()` as semantic timing. Refreshed server nodes later use persisted event timestamps or Pi entry timestamps, so visible order can move after refresh.
- `adaptTrace` falls back to `Date.now()` for missing start times. `processSpanTree` then sorts by span `startTime`, so missing or client-created timestamps can change display order.
- `processSpanTree` hoists `agent.run` and `model.response` spans. That can be visually useful, but it means display order can diverge from trace node order.
- `web_chat_events` is ordered by SQLite `rowid` when read, but the event schema does not expose a stable event sequence to the trace projector or debug output.
- Server merging still uses repeated linear scans such as `[...byId.values()].find(...)` inside event processing. That is acceptable for small sessions but can become expensive for long traces.
- Client live updates still traverse and clone recursive node paths per frame. Batching reduces commit frequency but does not remove O(trace size) lookups and rebuilds.
- `adaptTrace` has a `WeakMap<PiboTraceNode, Span>` cache, but frequent node object replacement weakens its value.
- The debug trace command prints rebuilt nodes, but it does not yet explain ordering keys, duplicate ids, parent integrity, source conflicts, or live/persisted replacement decisions.

## Required Trace Invariants

These invariants should drive the implementation and tests:

- Completed transcript-backed traces follow canonical Pi transcript order unless a named display rule deliberately changes presentation.
- A final assistant response never appears before the tool calls or tool results it consumed.
- Reasoning, assistant text, and tool calls from one persisted assistant entry preserve content-part order.
- Tool results attach only to the matching `toolCallId`.
- Repeated subagent calls link to the exact child Pibo Session when metadata is available.
- Live frames are idempotent: replaying the same frame or stored event must not duplicate nodes.
- Applying live frames in chunks produces the same final conceptual trace as applying them all at once.
- Refreshing `/api/chat/trace` after a live run does not move a completed conceptual node to a semantically earlier position.
- Missing retained start events may create a best-effort live node, but they must not duplicate the final persisted assistant/reasoning node.
- Timestamps are display metadata, not the primary semantic ordering source.

## Target Model

Introduce a narrow trace projection core, not a broad event-sourcing framework.

The smallest useful internal model is:

```text
TraceState
  nodesById: Map<traceNodeId, PiboTraceNode>
  rootIds: string[]
  childIdsByParentId: Map<traceNodeId, string[]>
  orderById: Map<traceNodeId, TraceOrderKey>
  sourceById: Map<traceNodeId, TraceSource>
  replacementByStableKey: Map<stableKey, traceNodeId>

TraceMutation
  source: transcript | event-log | live
  stableKey: string
  nodeId: string
  parentId?
  order: TraceOrderKey
  operation: upsert | appendText | finish | error | attachChild | mergeToolResult
```

`PiboTraceNode[]` can remain the API response initially. The internal state gives the projection deterministic order, indexed updates, and testable replacement semantics.

Suggested order key:

```text
TraceOrderKey = {
  sourceRank,
  turnSeq,
  transcriptIndex?,
  contentPartIndex?,
  eventSequence?,
  streamFrameIndex?,
  phaseRank
}
```

Minimal V1:

- Transcript-derived nodes use entry index and content part index.
- Stored event-derived nodes use event row order or a new stored event sequence.
- Live nodes use SSE frame order within the selected session.
- Wall-clock time is kept for display only.

## Proposed Implementation Plan

### Phase 1: Lock Down Invariants And Debuggability

Goal: make correctness failures obvious before changing projection internals.

Work:

- Add trace assertion helpers for duplicate ids, missing parents, causal order, tool result attachment, and repeated subagent linkage.
- Extend `test/chat-trace.test.mjs` with refresh-convergence and idempotency cases that compare live-like event-log projection to final transcript-backed projection.
- Add client/projector tests for chunked-vs-one-shot live frame application. If direct client tests are awkward, extract only enough pure logic to test without React.
- Extend `pibo debug trace` with a deeper consistency mode, for example `pibo debug trace <pibo-session-id> --check`.
- The check should report duplicate ids, missing parents, unstable sort inputs, node order keys, source, stable key, linked child ambiguity, and live/persisted conflicts.

Verification:

- `npm run dev -- debug trace --help` stays progressive.
- `node --test test/chat-trace.test.mjs`
- `node --test test/debug-cli.test.mjs`

### Phase 2: Add Stable Ordering Without Changing The Public API

Goal: remove timestamp-driven semantic movement.

Work:

- Add internal order metadata while building trace nodes in `src/apps/chat/trace.ts`.
- Preserve transcript array order as the default display order.
- Use stored event order for event-derived nodes. Prefer adding an explicit monotonic `event_sequence` to `web_chat_events`; if that is too much for the first patch, expose the selected `rowid` as an internal read-model field.
- Stop using `startedAt` as the semantic sort key for trace display when an explicit trace order exists.
- Update `adaptTrace` and `processSpanTree` so they preserve trace order or use a trace order attribute instead of only `startTime`.
- Keep timestamps visible and useful, but make them non-authoritative for ordering.

Verification:

- Same-timestamp nodes keep canonical order.
- Client-created timestamps no longer reorder spans after server refresh.
- Existing trace tests remain green.

### Phase 3: Extract A Shared Pure Trace Projector

Goal: one semantic implementation for server reconstruction and client live overlay.

Work:

- Extract a pure trace projector module that owns ids, parent rules, ordering, merge rules, idempotency, and source priority.
- Map Pi transcript entries to projector mutations.
- Map stored `PiboOutputEvent` rows to projector mutations.
- Map `ChatStreamEvent` frames to projector mutations.
- Keep server `buildTraceView` as an adapter around the projector.
- Replace the client `applyChatStreamEvent` tree-manipulation code with the same projector semantics, either directly or through a small live-state wrapper.

Source priority:

- Transcript nodes win for completed persisted transcript content.
- Event-log nodes fill runtime metadata gaps such as tool execution status, subagent linkage, yielded runs, and live in-progress nodes.
- Live nodes are temporary unless no persisted equivalent exists yet.

Verification:

- Server projection and client live overlay produce equivalent final trace for the same logical event stream.
- Duplicate SSE frames and duplicate stored rows do not duplicate visible nodes.
- Refresh after `RUN_FINISHED`, `RUN_ERROR`, and `TEXT_MESSAGE_END` does not cause semantic node jumps.

### Phase 4: Make Identity And Replacement Explicit

Goal: avoid React replacement and visual movement when a live node matures into persisted data.

Work:

- Add internal `stableKey` values for conceptual spans, such as `turn:<eventId>`, `assistant:<eventId>`, `reasoning:<eventId>`, `tool:<toolCallId>`, and `entry:<entryId>:part:<index>`.
- Track `source` and replacement relation internally, for example `live -> event-log -> transcript`.
- Define when a persisted transcript node updates an existing conceptual live node and when it remains separate. Multiple persisted assistant entries in a tool-using turn must remain separate.
- Keep public ids stable where possible. Where public ids must differ between live and transcript, keep display position stable through the internal stable key.

Verification:

- Live assistant/reasoning nodes mature without moving earlier in the trace.
- Intermediate assistant progress text and final assistant text remain separate persisted nodes.
- React sees fewer full node replacements during live-to-final transition once the client uses the shared projector.

### Phase 5: Performance Hardening In The Trace Path

Goal: keep deterministic projection scalable.

Work:

- Replace repeated recursive lookups and `[...byId.values()].find(...)` scans with indexed maps for ids, event ids, tool call ids, and child sessions.
- Keep client state normalized during live streaming: `nodesById`, `rootIds`, and `childIdsByParentId`.
- Update only affected nodes for text deltas, reasoning deltas, tool results, and delegation updates.
- Preserve object identity for unchanged nodes so `adaptTrace` caching or a direct `PiboTraceNode` renderer can be effective.
- Avoid raw event compaction and span adaptation on every text delta when the raw event panel or affected UI region is not visible.
- Add a small local benchmark or perf test for long traces if the implementation touches hot loops.

Verification:

- A text delta does not clone or re-adapt the full trace tree.
- Long traces avoid O(events * nodes) server reconstruction behavior.
- Existing performance plan checks still apply: `npm run typecheck`, trace tests, and Browser Use QA for long live sessions.

### Phase 6: Schema Hardening

Goal: reduce inference over time without blocking earlier fixes.

Work:

- Add a monotonic event sequence to stored Chat Web events.
- Carry available turn/content metadata through `PiboOutputEvent` where Pi exposes it.
- Ensure `subagent_session` and related tool events consistently carry `eventId`, `toolCallId`, `threadKey`, and child session id.
- Keep migration compatible with existing `web_chat_events` rows.

Verification:

- Repeated subagent and yielded-run fixtures do not need "likely child" fallback when modern metadata is present.
- Legacy rows still project with best-effort behavior.

## Acceptance Criteria

The hardening work is complete when:

- Completed transcript-backed traces render in canonical causal order.
- Live rendering and refreshed server rendering converge without semantic node jumps.
- Duplicate or replayed SSE frames do not duplicate nodes.
- Repeated subagent and yielded-run cases link to the correct child sessions.
- Trace projection tests cover persisted, event-log, and live paths.
- The debug CLI can explain why each displayed node appears where it appears.
- Long sessions avoid full-tree work on every token-sized update.

## Recommended First Implementation Slice

Do this first:

1. Add invariant helpers and missing tests.
2. Extend `pibo debug trace` with `--check`.
3. Add internal order metadata and stop span display from sorting only by wall-clock start time.

This slice is small enough to review, directly addresses reliability, and gives later reducer/performance work a test harness.

Do not start with a broad UI rewrite or a durable trace table. The core problem is deterministic projection, not visual redesign or new persistence.
