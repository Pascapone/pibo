# Chat Trace Rendering Incident Report: Thinking Blocks And Tool Visibility

Date: 2026-05-02

Status: fixed for the observed failure mode, with follow-up hardening recommended.

## Executive Summary

The Chat Web Trace View briefly lost audit reliability in two related ways:

1. Hosted web search tool use was not visible as normal Pibo tool activity.
2. Multiple streamed Thinking blocks in one assistant turn collapsed into a single visible block during live rendering and event-log reconstruction.

The second issue was the more subtle one. Pi Coding Agent emitted multiple `thinking_start` / `thinking_delta` / `thinking_end` content parts for the same assistant turn. Those parts shared the same Pibo turn `eventId`, but Pi also provided a `contentIndex` that identifies the content part. Pibo discarded that `contentIndex` while normalizing Pi events. The live stream and trace UI then used only `eventId` as the Thinking block identity, so every Thinking block inside that turn had the same node id and stable cache key. The UI did what it was told: it merged/replaced the earlier Thinking block instead of rendering separate blocks between tool calls.

This is an audit correctness issue, not just a cosmetic rendering bug. The trace UI is the operator's record of how an agent reasoned, which tools it called, in which order, and where an agent made a mistake. If the trace collapses or reorders events, debugging agent quality and performance becomes unreliable.

## Observed Symptoms

Open browser session:

- Pibo Session ID: `ps_81af874a-d25c-4f2a-8451-0d5dbc05ee49`
- Pi Session ID: `5148783a-9d45-442e-8370-23bd8f1cacfa`
- URL: `/apps/chat/rooms/room_074f6ebf-028b-4012-b5ef-60c090aa332c/sessions/ps_81af874a-d25c-4f2a-8451-0d5dbc05ee49?view=trace`

Symptoms seen in the browser:

- Tool calls were visible after the first fix, but Thinking blocks were still wrong.
- A Thinking block streamed, then a later Thinking block appeared to reuse/replace the same visual block.
- Web searches were executed between reasoning phases, but the UI did not show the Thinking blocks in the correct positions around those tool calls.
- The final transcript-backed trace looked more correct after completion, which made the live/event-log bug easier to miss.

Database event counts for the repro showed the mismatch clearly:

```text
thinking_started              6
thinking_delta              443
thinking_finished             6
tool_call                   274
tool_execution_started        5
tool_execution_finished       5
assistant_delta             541
assistant_message             1
```

The raw Pibo event log contained six Thinking blocks, but they all had the same `eventId`. Before the fix, no Pibo-level Thinking event carried Pi's `contentIndex`, so the downstream layers could not distinguish the blocks.

## Root Cause

Pi message updates have two different identities that matter:

- `eventId`: the Pibo assistant turn / active message id.
- `contentIndex`: the index of a content part inside that assistant message, such as Thinking part 0, tool call part 1, Thinking part 2.

Pibo treated `eventId` as both the turn identity and the content-part identity. That is invalid for multi-part assistant messages.

The broken path was:

```text
Pi message_update
  -> RoutedSession normalizePiEvent(...)
    -> PiboOutputEvent thinking_* without contentIndex
      -> Chat stream REASONING_MESSAGE_* messageId = eventId
        -> Chat UI reasoning node id/stableKey = eventId
          -> later Thinking block updates the same node
```

The persisted transcript path did not have the same failure because transcript reconstruction already iterates assistant message content parts and produces ids such as `entry:<id>:thinking:<partIndex>`.

## Fix Applied

### 1. Preserve `contentIndex` on Thinking output events

Files:

- `src/core/events.ts`
- `src/core/routed-session.ts`
- `test/session-actions.test.mjs`

Change:

- Added optional `contentIndex?: number` to:
  - `PiboThinkingStartedEvent`
  - `PiboThinkingDeltaEvent`
  - `PiboThinkingFinishedEvent`
- Added `messageContentIndex(...)` in `RoutedSession`.
- `normalizePiEvent(...)` now copies Pi `assistantMessageEvent.contentIndex` onto all Thinking events.

Result:

Pibo no longer loses the content-part identity at the product boundary.

### 2. Give live Reasoning frames their own content-part ids

Files:

- `src/apps/chat/stream.ts`
- `src/apps/chat-ui/src/App.tsx`
- `test/chat-trace.test.mjs`

Change:

- `chatStreamFramesFromOutputEvent(...)` now builds Reasoning message ids as:

```text
<eventId>:thinking:<contentIndex>
```

when `contentIndex` exists.

- The stream frames also carry `runId` separately:

```text
REASONING_MESSAGE_START {
  messageId: "turn-1:thinking:2",
  runId: "turn-1"
}
```

This keeps two identities separate:

- `messageId`: identity of the visible Reasoning block.
- `runId`: identity of the parent assistant turn.

Result:

The live UI can render several Thinking blocks under the same turn without merging them, while preserving the correct parent-child relationship.

### 3. Make event-log trace nodes use content-part identity

Files:

- `src/apps/chat/trace.ts`
- `test/chat-trace.test.mjs`

Change:

- `thinking_finished` event-log nodes use `thinkingEventNodeId(...)`.
- `thinking_delta` merging uses the same content-aware id.
- `eventStableKey(...)` uses `reasoning:<eventId>:thinking:<contentIndex>` when possible.

Result:

Event-log reconstruction now keeps multiple live Thinking blocks distinct and can place them around tool calls in event sequence order.

### 4. Keep provider web search visible as normal tool activity

Files from the earlier fix in this incident:

- `src/tools/codex-compat.ts`
- `src/plugins/codex-compat.ts`
- `src/core/codex-compat.ts`
- `test/codex-compat.test.mjs`

Change:

- Codex-compatible web search was moved from a provider-hosted invisible tool path into a local Pibo tool path.
- `providerWebSearch` is disabled for the Codex-compatible profile.

Result:

Web search now emits normal Pibo tool events, so the trace can show tool calls and results.

## Verification Already Performed

Commands run:

```bash
npm run typecheck
npm run build
node --test test/chat-trace.test.mjs test/session-actions.test.mjs
node --test test/codex-compat.test.mjs
```

Observed results:

- Typecheck passed.
- Build passed.
- `test/chat-trace.test.mjs` and `test/session-actions.test.mjs` passed after rebuilding `dist`.
- `test/codex-compat.test.mjs` passed.
- Gateway was restarted.
- The open browser tab was hard reloaded.

New/updated tests:

- `test/session-actions.test.mjs`
  - Confirms routed session normalization preserves `contentIndex` on Thinking events.
- `test/chat-trace.test.mjs`
  - Confirms the stream adapter emits separate Reasoning frame ids for separate content parts in one turn.
  - Confirms event-log trace reconstruction keeps multiple Thinking blocks ordered around a tool call.

## Why This Matters

The Chat Web Trace View is an audit surface. It must answer:

- What did the user ask?
- What did the agent think before each action?
- Which tool did it call?
- What arguments did it send?
- What result did the tool return?
- What did the agent think after seeing that result?
- What final answer did it produce?
- Where did latency, wrong assumptions, or bad tool choice happen?

If the trace collapses several Reasoning blocks into one block, the operator loses causality. The trace may look as if the agent reasoned once, then called several tools, when in reality the agent reasoned between tool calls. That invalidates debugging, quality review, and performance analysis.

## Invariants The Trace System Should Enforce

These invariants should be treated as product requirements, not implementation details.

### Identity Invariants

- A Pibo Session ID identifies a routed product session.
- A Pi Session ID identifies the underlying Pi transcript/cache session.
- A turn `eventId` identifies one assistant turn.
- A content-part identity must include the turn id plus content position or another stable part id.
- A tool call identity must be `toolCallId`, not the assistant turn id.
- A visible trace node must never use a parent turn id as its own identity when multiple child content parts can exist.

### Ordering Invariants

- Transcript order is authoritative after persistence.
- Live stream order must use stream frame order.
- Raw Pibo event-log order must use per-session `eventSequence`.
- Reasoning/tool/text ordering must preserve assistant content part order when that information exists.
- Source precedence must be explicit: transcript nodes, event-log nodes, and live nodes should not silently overwrite each other unless the merge is intentional and tested.

### Merge/Cache Invariants

- Delta merging is allowed only when two deltas refer to the same semantic node.
- Cache keys must include content-part identity for Reasoning.
- Stable keys must not collapse separate reasoning parts, tool calls, or assistant text parts.
- A completed transcript-backed trace should be able to replace live echo events without losing nodes.

## Areas To Inspect Next

### 1. Shared identity model for trace nodes

Current risk:

Reasoning identity logic now exists in more than one place:

- `src/apps/chat/stream.ts`
- `src/apps/chat/trace.ts`
- `src/apps/chat-ui/src/App.tsx`

Recommendation:

Create a small shared identity helper module for trace/event ids. For example:

```text
traceNodeIdentityForOutputEvent(event)
reasoningPartId(eventId, contentIndex)
turnNodeId(eventId)
toolNodeId(toolCallId)
assistantTextNodeId(eventId, contentIndex?)
```

The goal is not abstraction for its own sake. The goal is to prevent future changes from fixing server reconstruction but forgetting live UI, or vice versa.

### 2. Assistant text content parts

Current fix targets Thinking blocks because that was the observed bug. Assistant text still mostly uses `eventId` as message id.

Risk:

If Pi streams multiple text parts in one assistant turn around tools, assistant text may have similar identity/merge problems.

Recommendation:

Inspect whether Pi emits `contentIndex` for `text_delta` and whether Pibo should preserve it for `assistant_delta`. If multi-text-part turns are possible, extend the same content-part identity approach to assistant text.

### 3. Tool call lifecycle consistency

Current state:

Tool calls are keyed by `toolCallId`, which is correct. However, the raw event counts in the repro showed many `tool_call` updates for only a handful of tool executions.

Recommendation:

Review whether `tool_call` argument deltas are retained, merged, and rendered in a way that preserves:

- start
- argument accumulation
- argument completion
- execution start
- partial updates
- execution finish

The UI should make clear whether a node is still receiving argument deltas or has actually started executing.

### 4. Transcript echo suppression

Current state:

When a persisted transcript exists, `buildTraceView(...)` suppresses stale event-log echoes unless the transcript event is still open.

Risk:

This is necessary, but it is also a place where a correct live node can disappear if the open/closed detection is wrong.

Recommendation:

Add fixtures for:

- active running turn with partial transcript plus live deltas
- completed turn where transcript replaces live echo events
- interrupted turn that never received `message_finished`
- mixed transcript/event-log sequence around tool calls

### 5. Retention and raw delta compaction

Current state:

The Chat Web Read Model can limit event history and classify deltas as live-retention events.

Risk:

If old start events fall out of retention but deltas remain, reconstruction must still create valid trace nodes. There are tests for some of this, but the Thinking/tool interleaving case should be expanded.

Recommendation:

Add retention tests where:

- `thinking_started` falls out, but `thinking_delta` and `thinking_finished` remain.
- tool-call start falls out, but execution finish remains.
- only final transcript is available.
- live stream reconnect resumes from the middle of a reasoning block.

### 6. UI local cache and raw-event merge logic

Current risk points:

- `applyChatStreamEvent(...)`
- `upsertTraceNode(...)`
- `appendTextToNode(...)`
- `canMergeRawDelta(...)`
- `eventKeyFromPayload(...)`

Recommendation:

Audit every merge path for the question:

```text
Does this key identify one semantic trace node, or only a broader parent turn?
```

If the answer is "broader parent turn", it must not be used to merge visible child nodes.

### 7. Debug CLI as regression oracle

Current state:

The debug CLI was essential:

```bash
npm run dev -- debug session <piboSessionId> --events --limit 120 --json
npm run dev -- debug trace <piboSessionId> --check --json
```

Recommendation:

Extend `debug trace --check` with stricter invariants:

- duplicate stable key detection by node type
- collapsed Reasoning detection when multiple thinking finish events exist with distinct `contentIndex`
- tool execution without visible tool node
- tool node out of order relative to surrounding Reasoning event sequences
- transcript/event-log mismatch summary

The CLI should fail loudly when the trace is not audit-grade.

## Recommended Test Plan

### Unit Tests

Add or maintain tests for:

- Pi `message_update` -> Pibo `thinking_*` preserves `contentIndex`.
- Pibo `thinking_*` -> stream frames use distinct `messageId` and parent `runId`.
- Event-log trace reconstructs `thinking -> tool -> thinking -> assistant`.
- Duplicate `eventId` with distinct `contentIndex` creates distinct Reasoning nodes.
- Duplicate `eventId` without `contentIndex` retains backward-compatible behavior.
- Tool calls remain keyed by `toolCallId`.

### Fixture Replay Tests

Create small JSON fixtures for real sessions:

- hosted-search issue before local tool conversion
- six Thinking blocks plus five web searches
- interrupted stream with incomplete final assistant message
- transcript persisted after live trace already rendered

Replay each fixture through:

```text
PiboOutputEvent log -> ChatStreamEvent frames -> live UI trace reducer
PiboOutputEvent log -> buildTraceView event-log path
Pi transcript JSONL -> traceNodesFromEntries transcript path
```

Expected output should be a golden list of:

```text
type, id, stableKey, parentId, orderKey, title/toolName
```

### Browser / E2E Tests

Add Playwright coverage for the trace UI:

- Start a session that performs at least two visible tool calls and multiple Thinking blocks.
- Assert visible order in the trace tree.
- Assert expanding raw details shows tool arguments and tool result.
- Assert hard reload produces the same final trace order.
- Assert SSE reconnect does not duplicate or collapse nodes.

For this specific class of bug, DOM checks should not only count nodes. They should also verify order:

```text
Thinking
web_search
Thinking
web_search
Thinking
Assistant Message
```

### Property / Fuzz Tests

Generate random assistant content streams with:

- one or more Thinking parts
- zero or more tool calls
- one or more text parts
- missing starts
- delayed finishes
- repeated deltas
- stale event-log echoes

Assert:

- no duplicate stable keys for distinct semantic nodes
- order is monotonic according to source-specific order key
- no visible node disappears after final transcript reconstruction
- no tool execution result is orphaned if a `toolCallId` exists

## Recommended Architecture Hardening

### Make trace identity explicit

Introduce a typed identity layer:

```ts
type TraceSemanticId =
  | { kind: "turn"; eventId: string }
  | { kind: "reasoning"; eventId: string; contentIndex?: number }
  | { kind: "assistantText"; eventId: string; contentIndex?: number }
  | { kind: "tool"; toolCallId: string }
```

Then derive all UI ids, stable keys, and parent ids from this typed identity. Avoid ad hoc string construction in reducers.

### Share stream event types

`ChatStreamEvent` is currently declared in both server and UI code. That increases drift risk.

Recommendation:

Move the type to a shared module used by:

- `src/apps/chat/stream.ts`
- `src/apps/chat-ui/src/App.tsx`

### Add trace check gates before release

The trace should have a release gate equivalent to:

```bash
npm run typecheck
npm run build
node --test test/chat-trace.test.mjs test/session-actions.test.mjs test/codex-compat.test.mjs
npm run dev -- debug trace <fixture-session> --check --json
```

Long term, fixture sessions should be committed in a deterministic test format so `debug trace --check` can run in CI without relying on a developer's local `.pibo` database.

### Treat provider-hosted tools as audit risks

Provider-hosted tools may not produce normal Pi/Pibo tool lifecycle events. If a tool matters for audit, performance, or user trust, it should go through the Pibo tool system or emit a complete synthetic lifecycle.

Rule of thumb:

```text
If the user/operator must understand that a tool was used, it must become a visible Pibo trace node.
```

## Open Questions

- Does Pi always provide `contentIndex` for every `thinking_*` update across supported providers?
- Does Pi provide `contentIndex` for text deltas, and can multiple text parts occur in one assistant turn?
- Should trace nodes represent `thinking_started` as an empty running node even before the first non-empty delta?
- Should raw event retention preserve all non-empty `thinking_finished` events longer than transient deltas?
- Should `debug trace --check` compare transcript part count against event-log part count for the same turn?
- Should the UI expose a "source" marker for transcript vs live vs event-log nodes while debugging trace issues?

## Follow-Up Checklist

- Add shared trace identity helpers.
- Move `ChatStreamEvent` type to shared code.
- Extend assistant text events with `contentIndex` if Pi supports multi-text-part turns.
- Add fixture replay tests for real broken sessions.
- Add Playwright trace-order tests.
- Extend `debug trace --check` with duplicate/collapse/orphan checks.
- Review raw delta retention for mid-stream reconnect and history truncation.
- Review `canMergeRawDelta(...)` and `eventKeyFromPayload(...)` with content-part identities.
- Document the invariant: trace nodes represent semantic actions, not just transport frames.

## Current Assessment

The immediate failure mode is fixed:

- Web search tool calls are visible.
- Multiple Thinking blocks in one turn no longer share the same live/message identity when `contentIndex` is present.
- Event-log trace reconstruction no longer collapses distinct Thinking content parts.
- Existing transcript reconstruction already had correct content-part ordering.

The system still needs hardening because trace correctness spans several layers:

```text
Pi event shape
  -> Pibo output event normalization
  -> Chat Web Read Model event storage
  -> Chat Stream Event adapter
  -> SSE delivery/reconnect
  -> live UI reducer
  -> event-log trace builder
  -> transcript trace builder
  -> cache/stable-key merging
```

Every layer must preserve identity, order, and parentage. Any layer that collapses a content part into only the parent turn id can make the trace misleading again.
