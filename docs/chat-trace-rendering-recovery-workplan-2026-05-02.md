# Chat Trace Rendering Recovery Workplan

Date: 2026-05-02

Status: working agreement for the next debugging session.

## Purpose

The Chat Web live rendering is still not trustworthy. Reloaded sessions can render correctly, but live streaming can show partial, stale, duplicated, missing, or incorrectly ordered trace rows. We must stop applying speculative fixes in the main worktree.

This document defines how the next session should work: create a safe worktree, remove the recently added caching/refresh complexity, verify the raw event-to-rendering path, and proceed interactively with the human observer.

## Non-Negotiable Working Rules

- Do not keep patching the current dirty worktree as the source of truth.
- Do not make broad refactors while investigating this incident.
- Do not hide uncertainty. If the event path is unclear, stop and document the exact gap.
- Do not claim a fix from final/reload rendering alone. The bug is live streaming.
- Do not use `git reset --hard`, `git checkout --`, or any destructive command in the user's main worktree.
- Do not revert unrelated dirty files.
- Every code change must have a single stated hypothesis.
- Every hypothesis must name the exact boundary it affects:
  - Pi event
  - Pibo output event
  - Chat Event Log row
  - Chat Stream Event / SSE frame
  - React query cache
  - Trace node merge
  - Terminal row rendering
- Prefer deleting or disabling new complexity over adding more compensating logic.
- After each meaningful change, run the tests listed below and ask the user to run the live browser prompt.
- If the user reports a bad live state, capture the Pibo Session ID and inspect the stored events before changing code again.

## Recovery Branch And Worktree

Start from a safe, separate worktree. The existing worktree is dirty and must be treated as evidence, not as a place to keep experimenting.

Recommended setup:

```bash
cd <HOME>/code/pibo
git status --short
git branch --show-current
git rev-parse --short HEAD
git worktree add ../pibo-chat-render-recovery -b recovery/chat-rendering-cache-rollback HEAD
cd ../pibo-chat-render-recovery
git status --short
```

If `../pibo-chat-render-recovery` already exists, choose a new directory name such as:

```bash
../pibo-chat-render-recovery-2
```

Rules for the recovery worktree:

- Keep it isolated from unrelated current worktree changes.
- Only port changes deliberately, one patch at a time.
- Prefer starting from `HEAD` and then removing or reapplying specific changes after inspection.
- Keep screenshots, event dumps, and notes under `.pibo/` or `docs/`.

## Immediate Direction

The next session should first remove the caching/refresh complexity that can obscure the event path. The goal is not performance. The goal is correctness and observability.

Candidate areas to review and possibly disable:

- `src/apps/chat-ui/src/cache.ts`
  - Query key helpers
  - navigation cache helpers
  - cache invalidation matrix
- `src/apps/chat-ui/src/App.tsx`
  - `loadBootstrapQueryData(...)`
  - `loadTraceQueryData(...)`
  - `knownVersion`
  - `queryClient.getQueryData(...)`
  - `queryClient.setQueryData(...)`
  - `invalidateQueries(...)`
  - `refetchQueries(...)`
  - live SSE merge into React Query data
  - trace refresh timers / debouncing
- `src/apps/chat-ui/src/api.ts`
  - `knownVersion`
  - `If-None-Match`
  - `notModified`
- `src/apps/chat/web-app.ts`
  - `traceCache`
  - `TRACE_CACHE_MAX_ENTRIES`
  - `traceCacheKey(...)`
  - `setTraceCache(...)`
  - trace API `ETag` / `304` behavior
  - SSE cursor / replay behavior, only if directly implicated
- `src/apps/chat-ui/src/tracing/adapt.ts`
  - `spanCache`, only if it causes stale node adaptation

Do not remove unrelated static asset compression caching unless it is clearly in the rendering path. Asset compression is probably unrelated.

## Target Simplified Model

For the recovery branch, temporarily aim for this simple model:

1. Trace API always returns a fresh `Chat Web Trace View`.
2. Browser does not reuse a cached trace response via `knownVersion` / `304`.
3. Live SSE frames are applied to one clearly owned in-memory live trace state.
4. Server refreshes replace live state only at explicit boundaries, or not at all during an active stream.
5. The UI can print or expose the last N incoming SSE frames for debugging.

The system should be boring before it is fast.

## Required Event Pipeline Map

Before changing rendering logic, write down the actual pipeline for one test prompt:

```text
Pi event
  -> normalizePiEvent(...)
  -> PiboOutputEvent
  -> Chat Event Log row
  -> Chat Stream Event frame
  -> applyChatStreamEvent(...)
  -> PiboTraceNode
  -> CompactTerminalRow
  -> DOM row
```

For each visible row, there must be one obvious source:

- User prompt row comes from the user message / transcript source.
- Reasoning row comes from one thinking content part.
- Tool call row comes from one `toolCallId`.
- Tool result row comes from the matching tool execution result.
- Final answer row comes from one assistant message.

If two sources can produce the same row at the same time, the ownership rule must be made explicit before coding.

## Interactive Debugging Loop

Use this exact loop:

1. State the current hypothesis in one sentence.
2. Make the smallest code or config change that tests that hypothesis.
3. Run automated checks.
4. Restart the gateway from the recovery worktree.
5. Ask the user to run the browser prompt and report live behavior.
6. Record the Pibo Session ID.
7. Dump stored event counts and key event sequence.
8. Compare live symptom against the event dump.
9. Decide:
   - keep the change,
   - revert only that change,
   - or form the next hypothesis.

Do not stack multiple unverified hypotheses.

## Test Prompt

Use this prompt every time unless the user explicitly changes it:

```text
Führe eine Websuche zu `honker` einem SQL Event System durch.
```

Use the `codex-compat` agent/profile.

The user is the final live-stream observer. The agent may use screenshots, but screenshots are not enough to declare success.

## Debug Commands

Session debug:

```bash
npm run dev -- debug session <pibo-session-id> --events --json
```

Event counts:

```bash
node --experimental-sqlite - <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('.pibo/web-chat.sqlite', { readOnly: true });
const sid = process.argv[1];
console.log(db.prepare('select status,last_activity_at from web_chat_sessions where pibo_session_id=?').get(sid));
console.log(db.prepare('select type, count(*) c from web_chat_events where pibo_session_id=? group by type order by type').all(sid));
NODE <pibo-session-id>
```

Key event sequence:

```bash
node --experimental-sqlite - <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('.pibo/web-chat.sqlite', { readOnly: true });
const sid = process.argv[1];
const rows = db.prepare(`
  select event_sequence,type,event_id,payload_json
  from web_chat_events
  where pibo_session_id=?
  order by event_sequence
`).all(sid);
for (const row of rows) {
  const event = JSON.parse(row.payload_json);
  if (![
    'message_started',
    'thinking_started',
    'thinking_delta',
    'thinking_finished',
    'tool_call',
    'tool_execution_started',
    'tool_execution_finished',
    'assistant_delta',
    'assistant_message',
    'message_finished',
    'session_error',
  ].includes(row.type)) continue;
  const text = typeof event.text === 'string' ? event.text.slice(0, 80).replace(/\n/g, '\\n') : '';
  console.log(row.event_sequence, row.type, row.event_id ?? '', event.toolCallId ?? '', event.thinkingIndex ?? event.contentIndex ?? '', text);
}
NODE <pibo-session-id>
```

## Automated Checks

Run at minimum:

```bash
npm run chat-ui:typecheck
node --test test/session-actions.test.mjs test/chat-trace.test.mjs
npm run build
```

If `codex-compat` event behavior changes, also run:

```bash
node --test test/codex-compat.test.mjs
```

If web app API/cache behavior changes, add or run focused tests before asking the user to retest.

## Human Retest Request Template

After each verified change, ask the user something concrete:

```text
Bitte teste im Headful Browser neu:

Agent: codex-compat
Prompt: Führe eine Websuche zu `honker` einem SQL Event System durch.

Bitte beobachte live, nicht nur nach Reload:
- Wird der finale Antwortblock zusammenhängend gestreamt?
- Bleiben Tool Calls sichtbar?
- Verschwindet der running-Zähler am Ende?
- Werden Thinking-Blöcke ersetzt, dupliziert oder falsch einsortiert?
- Welche Pibo Session ID ist betroffen?
```

## Success Criteria

The issue is not fixed until all are true in live streaming:

- The final assistant text grows cumulatively, not as only the last token.
- Tool call start, args, result, and final answer remain visible.
- Thinking blocks do not overwrite unrelated Thinking blocks.
- Tool calls do not disappear after completion.
- The `running` indicator clears without requiring reload.
- Reloaded rendering and live rendering converge to the same structure.
- Event counts are plausible for the run:
  - `tool_call` should be close to tool start/end count, not hundreds from arg deltas.
  - `assistant_message` should appear once for the final answer.
  - `message_finished` should appear once for a completed turn.

## Stop Conditions

Stop and ask the user before continuing if:

- A fix requires changing several architectural layers at once.
- The same symptom can be explained by two different event ownership models.
- The recovery worktree diverges too far from the starting branch.
- A test passes but live behavior contradicts the hypothesis.
- The system only looks correct after a page reload.

## Current Evidence To Carry Forward

Observed before this workplan:

- The initial broken run persisted hundreds of `tool_call` events from one tool call because `toolcall_delta` was normalized as `tool_call`.
- Removing that reduced the event storm, but live rendering was still unstable.
- Replayed/start frames can reset live node output if start handling is not idempotent.
- Reloaded rendering can look correct even when the live stream is wrong.
- Therefore, the next work must make live ownership and cache/refresh boundaries explicit before adding new fixes.

## First Concrete Task For The Next Session

In the recovery worktree:

1. Disable trace response caching (`knownVersion` / `ETag` / `304` / server `traceCache`) for the Chat Trace API.
2. Remove or bypass live trace refetch timers while a stream is active.
3. Keep one clear live merge path.
4. Run checks.
5. Ask the user for the live retest.

Only after this simplified baseline is understood should the session reintroduce any caching.
