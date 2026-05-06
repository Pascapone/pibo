# Harden Chat Web Subagent Run E2E

## Purpose

This plan captures findings from a real Chat Web end-to-end test of direct subagent delegation plus an async subagent started through `pibo_run_start`. It is intended as a complete handoff for a fresh session with no memory of the original test.

The goal is to fix correctness and operability issues found while exercising a realistic multi-agent trace:

- transient `database is locked` failures from debug CLI read paths while Chat Web is actively writing
- stale or misleading active status in the Chat Web trace header for completed child sessions
- horizontal overflow and clipped long text in the trace panel
- high `live_delta` row volume in the new reliability event mirror without an operational pruning path

This plan does not implement code. It documents the reproduction, findings, suspected causes, implementation plan, and verification criteria.

## Context

The repo root is `<HOME>/code/pibo`.

Always read these first:

- `RULES.md`
- `GLOSSARY.md`
- `DESIGN.md` if touching frontend UI

Relevant project docs and code:

- `docs/architecture.md`
- `plans/harden-chat-trace-rendering.md`
- `plans/optimize-chat-trace-streaming-performance.md`
- `src/apps/chat/web-app.ts`
- `src/apps/chat/read-model.ts`
- `src/apps/chat/event-log.ts`
- `src/apps/chat/trace.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/tracing/*`
- `src/debug/index.ts`
- `src/debug/session.ts`
- `src/debug/trace.ts`
- `src/debug/events.ts`
- `src/debug/sql.ts`
- `src/reliability/store.ts`
- `src/runs/registry.ts`
- `src/runs/tools.ts`
- `test/chat-trace.test.mjs`
- `test/debug-cli.test.mjs`
- `test/reliability-store.test.mjs`
- `test/runs.test.mjs`
- `test/web-channel.test.mjs`

## Test Scenario That Produced The Findings

### Environment

The authenticated Chat Web app was running at:

```text
http://4788.192.168.0.204.sslip.io/apps/chat
```

The running gateway process was:

```bash
npm run gateway:web
```

Browser testing used the existing authenticated Browser Use session:

```bash
eval "$(npm run --silent dev -- tools env browser-use)"
browser-use --session pibo-auth state
```

### Profile Setup Observed

The Chat Web Agents screen showed read-only/custom profiles:

- `main-agent`
- `sub-agent`

`main-agent` had access to `sub-agent` through generated subagent tooling and run-control tooling.

### Prompt Used

Use this exact prompt to reproduce:

```text
Ich möchte, dass du einen Subagent beauftragst, sich seinen Workspace anzuschauen und dir einen Überblick über das Projekt zu geben. Gebe mir dann davon das TLDR. Starte den ersten Agent direkt und dann im Anschluss einen über `pibo_start_run`.
```

Note: the model corrected `pibo_start_run` to `pibo_run_start`, which is expected because the actual tool is named `pibo_run_start`.

### Observed Test Session IDs

These IDs are from the original manual run and may not exist in a new environment:

- Parent session: `ps_8c16dba0-cff9-4761-8716-da32067072d8`
- Direct child subagent: `ps_3d2e4311-dec4-498c-b301-7842d575b1ae`
- Async child subagent: `ps_8ebd3cb3-a15d-4cfd-9b5d-53f92db81a97`
- Async run: `run_37eca340-ab5c-4de4-9c2a-a22b52df9c3e`

The expected shape is:

```text
parent main-agent session
  -> direct pibo_subagent_sub_agent call
       -> child sub-agent session
  -> pibo_run_start(toolName=pibo_subagent_sub_agent)
       -> async child sub-agent session
       -> pibo_run_wait(runId)
       -> pibo_run_read(runId)
  -> final assistant TLDR
```

## What Worked

The core product flow worked.

Observed success criteria:

- New `main-agent` Chat Web session was created from the UI.
- Prompt sent successfully.
- Direct subagent was rendered as `Agent Delegation`.
- Direct subagent node linked to the correct child session.
- Async subagent was started via `pibo_run_start`.
- Async subagent was rendered as `Async Agent`.
- `pibo_run_wait` waited until the async child completed.
- `pibo_run_read` consumed the completed result.
- Parent produced a final TLDR.
- Durable run state became `completed`, `consumed: true`.
- Live `runs` queue became empty.
- `pibo debug trace <parent> --check --json` returned `checks.status: "ok"`.
- `pibo debug trace <async-child> --check --json` returned `checks.status: "ok"`.
- `pibo.output` mirroring recorded events for parent and both child sessions.

## Findings

### Finding 1: Debug CLI Can Fail With `database is locked` During Active Chat Writes

Severity: medium.

During the active long-running session, these commands transiently failed:

```bash
node dist/bin/pibo.js debug trace <parent-pibo-session-id> --check --json
node dist/bin/pibo.js debug events <parent-pibo-session-id> --limit 40 --json
```

Observed stderr:

```text
database is locked
```

After the session completed, the same debug commands succeeded.

Likely affected code:

- `src/debug/trace.ts`
- `src/debug/events.ts`
- `src/debug/session.ts`
- `src/debug/sql.ts`
- `src/apps/chat/read-model.ts`
- `src/apps/chat/event-log.ts`
- `src/apps/chat/rooms.ts`
- any `new DatabaseSync(path, { readOnly: true })` paths that do not set `busy_timeout`

Likely cause:

- Chat Web write paths use SQLite while debug read paths open separate read-only `DatabaseSync` handles.
- Some stores do not consistently set `PRAGMA busy_timeout`.
- Some stores may not enable WAL on open.
- `debug/sql.ts` opens a generic read-only database and currently does not apply store-specific pragmas.

Implementation target:

- Make local SQLite store opening consistent for read and write handles.
- Add `PRAGMA busy_timeout = 5000` for debug read handles.
- Ensure Chat Web stores use WAL where appropriate for file-backed DBs.
- Avoid long writer transactions if any exist around event ingestion.

Acceptance:

- Running `pibo debug trace ... --check` repeatedly during an active streamed Chat Web run does not fail with `database is locked`.
- If a lock lasts too long, error output should identify the store path and command context.

### Finding 2: Child Trace UI Shows Stale/Misleading Active Status After Completion

Severity: medium.

In the async child session UI, after the child had completed and after page reload, the header still showed:

```text
1 ACTIVE
25 DONE
sub-agent
Active main-agent
```

But debug and stored state said the child was complete:

```bash
node dist/bin/pibo.js debug trace <async-child-id> --check --json
```

returned:

```json
{
  "status": "done",
  "checks": {
    "status": "ok",
    "issues": []
  }
}
```

and:

```bash
node dist/bin/pibo.js debug session <async-child-id> --events --limit 10 --json
```

showed Chat Web session status:

```json
{
  "chat": {
    "status": "idle"
  }
}
```

Likely affected code:

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/tracing/adapt.ts`
- `src/apps/chat-ui/src/tracing/traceTree.ts`
- possibly `src/apps/chat/trace.ts` if status summary includes inherited/linked active state

Likely cause:

- Trace header/status summary may count linked parent session, active root session, or stale live status rather than only visible trace nodes for the selected session.
- The label `Active main-agent` in a child session suggests profile/status metadata from the parent is leaking into child trace summary, or a linked-session badge is being interpreted as active state.
- Since reload did not clear it, this is probably derived from server trace data plus UI summarization, not only transient live overlay state.

Implementation target:

- Define exactly what trace header status should mean for selected session:
  - count active/done nodes from the selected trace only
  - do not count parent session as active inside child session
  - display linked parent/child metadata separately from execution activity
- Add a test fixture where a child session is `idle/done` while its parent exists, then verify the UI/status adapter does not show an active parent as an active child node.
- If the UI intentionally shows ancestor context, rename it so it cannot be confused with active execution.

Acceptance:

- Completed child session header does not show `ACTIVE` when `debug trace` status is `done`.
- Completed child session does not show `Active main-agent` unless there is a genuinely active main-agent node in that selected trace.
- Browser reload preserves the correct completed state.

### Finding 3: Trace Panel Has Horizontal Overflow And Clips Long Lines

Severity: low-to-medium.

Screenshots from the manual run:

- `.pibo/test-trace-parent.png`
- `.pibo/test-trace-child.png`

Observed UI:

- horizontal scrollbar in the trace panel
- long final summary lines clipped at the right edge
- this happens at a normal desktop viewport around `880x847`

Browser metric collected:

```json
{
  "url": "http://4788.192.168.0.204.sslip.io/apps/chat/rooms/.../sessions/...",
  "title": "Pibo Web Chat",
  "textLength": 8715,
  "buttons": 81,
  "svgs": 97,
  "scrollHeight": 847,
  "clientHeight": 847,
  "bodyOverflowX": "visible",
  "heap": {
    "used": 8876575,
    "total": 9976655
  },
  "nav": {
    "domContentLoaded": 75,
    "load": 75,
    "duration": 75
  }
}
```

Likely affected code:

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/styles.css`
- `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`
- `src/apps/chat-ui/src/tracing/JsonRenderer.tsx`
- `src/apps/chat-ui/src/tracing/SpanNode.tsx`

Likely cause:

- Trace content uses code/pre/inline-code or grid/flex children without `min-width: 0`.
- Markdown/prose blocks do not wrap long tokens or preserve readable code wrapping.
- The trace container allows horizontal overflow instead of constraining child content.

Implementation target:

- Add `min-width: 0` to flex/grid columns that contain trace content.
- Ensure markdown text wraps with `overflow-wrap: anywhere` or equivalent only where needed.
- Keep code blocks readable with local horizontal scroll inside code blocks, not the whole app panel.
- Avoid clipping normal paragraphs and list items.
- Confirm status/tool metadata rows remain aligned after wrapping.

Acceptance:

- At 880px desktop viewport, no app-wide horizontal scrollbar appears in the trace panel.
- Long assistant summaries wrap or code blocks scroll locally.
- Tool args/results remain inspectable.
- Mobile viewport remains readable and controls do not overlap.

### Finding 4: `pibo.output` Mirror Produces High `live_delta` Row Volume

Severity: medium for operations, low for current correctness.

For one manual test:

```bash
node dist/bin/pibo.js debug db query reliability \
  "select topic, key, retention_class, count(*) as count from pibo_event_stream where key in (...) group by topic, key, retention_class order by key, retention_class" \
  --json
```

showed approximately:

```text
parent:      1154 live_delta rows
direct child:1436 live_delta rows
async child:3010 live_delta rows
```

This is functionally expected because every normalized output delta is mirrored, but it needs an operational retention path.

Relevant code:

- `src/apps/chat/web-app.ts`
- `src/reliability/store.ts`
- `src/debug/index.ts`
- `docs/architecture.md`

Implementation target:

- Decide V1 retention policy for `pibo.output`:
  - keep `chat_message` and `trace_event` longer
  - prune `live_delta` aggressively after final message is persisted, or after a short age
  - preserve rows still needed by named consumers
- Add an operator CLI for pruning if not already exposed.
- Consider compacting or sampling live deltas in the reliability mirror if full-fidelity replay is not required.

Acceptance:

- There is a documented and tested way to prune old `live_delta` rows without deleting rows required by named consumers.
- Debug CLI can show approximate event counts by topic/session/retention class.
- Long-running sessions do not grow `.pibo/pibo-events.sqlite` without a maintenance path.

## Proposed Implementation Plan

### Phase 1: Reproduce And Add Regression Tests

Goal: capture the observed failures before changing behavior.

Work:

- Add or extend tests around debug read handles:
  - one writer transaction holds the Chat Web DB briefly
  - debug read path waits instead of immediately failing
  - use small timeouts in test to avoid slow suite
- Add server/client trace status tests for completed child sessions:
  - parent with two child subagent sessions
  - selected child trace is done
  - status summary does not report active parent/main-agent
- Add frontend or pure adapter test for status aggregation if the logic is extractable.
- Add CSS/layout regression via a lightweight browser test if available; otherwise add component-level assertions around class/style behavior and manually verify with Browser Use.
- Add reliability retention tests for `live_delta` pruning with named consumers.

Verification:

```bash
npm run typecheck
npm run build
node --test test/debug-cli.test.mjs test/chat-trace.test.mjs test/reliability-store.test.mjs
```

### Phase 2: Harden SQLite Debug/Chat Read Paths

Goal: remove transient `database is locked` during normal active sessions.

Work:

- Audit all `new DatabaseSync(...)` usages.
- Apply `PRAGMA busy_timeout = 5000` consistently after opening writable and read-only SQLite handles.
- Enable WAL for file-backed Chat Web stores where safe:
  - `web-chat.sqlite`
  - `pibo-events.sqlite` already uses WAL
  - session store may already have its own behavior; inspect before changing
- For generic debug SQL read-only handles, set `busy_timeout`.
- Include store path in lock error messages if SQLite still throws.

Important constraints:

- Keep changes surgical.
- Do not introduce async DB wrappers.
- Do not change table schemas unless needed.
- Do not mask real persistent locks forever.

Verification:

```bash
node --test test/debug-cli.test.mjs
npm test
```

Manual stress check:

```bash
while true; do
  node dist/bin/pibo.js debug trace <active-session-id> --check --json >/tmp/pibo-trace-check.json || break
done
```

Run that during an active Chat Web response.

### Phase 3: Fix Trace Status Aggregation In UI

Goal: make status badges match selected session trace state.

Work:

- Find where `ACTIVE`/`DONE` counts and profile status chips are computed in `src/apps/chat-ui/src/App.tsx` and tracing components.
- Determine whether `Active main-agent` is:
  - a selected-session parent/ancestor chip
  - a trace node status
  - profile metadata
  - stale live overlay state
- Separate selected trace execution status from linked session context.
- Ensure server trace `status: done` maps to no active node count in UI.
- If selected child has an ancestor parent, render it as context, not as active execution.

Verification:

- Reopen the async child session URL after the run completes.
- UI shows no active execution if debug trace says done.
- Parent trace still shows direct delegation and async agent correctly.
- Existing trace tests remain green.

### Phase 4: Fix Trace Layout Overflow

Goal: no whole-panel horizontal overflow for normal prose.

Work:

- Inspect CSS around:
  - app shell layout
  - trace viewport
  - span nodes/cards
  - markdown renderer
  - JSON/code renderer
- Apply `min-width: 0` to the main content flex/grid chain.
- Apply wrapping to prose:
  - paragraphs
  - list items
  - table cells if any
- Keep code blocks and JSON blocks locally scrollable, not forcing the whole trace panel wider.
- Test at desktop and mobile-ish widths.

Manual Browser Use check:

```bash
browser-use --session pibo-auth open http://4788.192.168.0.204.sslip.io/apps/chat/rooms/<roomId>/sessions/<parentId>
browser-use --session pibo-auth screenshot /tmp/pibo-parent.png
browser-use --session pibo-auth eval 'JSON.stringify({bodyOverflowX:getComputedStyle(document.body).overflowX, docScrollWidth:document.documentElement.scrollWidth, clientWidth:document.documentElement.clientWidth})'
```

Acceptance:

- `docScrollWidth <= clientWidth + small tolerance` for normal viewport.
- No content overlap.
- Long code remains accessible.

### Phase 5: Add Reliability Retention/Inspection For Live Deltas

Goal: make `pibo.output` operationally maintainable.

Work:

- Add debug command for event counts, for example:

```bash
pibo debug events stats --topic pibo.output [--session <id>] [--json]
```

- Add prune command, for example:

```bash
pibo debug events prune --topic pibo.output --retention live_delta --before <iso-date>
```

- Or expose a safer maintenance command outside debug if preferred.
- Use `PiboReliabilityStore.prune(...)`.
- Preserve rows needed by named consumers by default.
- Require an explicit destructive flag for unsafe deletion.
- Document the operational behavior in `docs/architecture.md`.

Verification:

- Unit test `PiboReliabilityStore.prune` already exists; extend for `pibo.output`-style data.
- Add debug CLI tests for stats/prune if commands are added.
- Confirm event counts drop for old `live_delta` rows while `chat_message` remains.

## Manual End-To-End Verification Script

After implementation, run this manual workflow.

1. Start web gateway:

```bash
npm run gateway:web
```

2. Open authenticated app:

```bash
eval "$(npm run --silent dev -- tools env browser-use)"
browser-use --session pibo-auth state
browser-use --session pibo-auth open http://4788.192.168.0.204.sslip.io/apps/chat
```

3. Create a new `main-agent` session from Agents UI or existing profile controls.

4. Send the prompt:

```text
Ich möchte, dass du einen Subagent beauftragst, sich seinen Workspace anzuschauen und dir einen Überblick über das Projekt zu geben. Gebe mir dann davon das TLDR. Starte den ersten Agent direkt und dann im Anschluss einen über `pibo_start_run`.
```

5. Observe:

- direct `Agent Delegation`
- async `pibo_run_start`
- `Async Agent`
- `pibo_run_wait`
- `pibo_run_read`
- final assistant TLDR

6. Run debug checks:

```bash
node dist/bin/pibo.js debug trace <parent-id> --check --json
node dist/bin/pibo.js debug trace <direct-child-id> --check --json
node dist/bin/pibo.js debug trace <async-child-id> --check --json
node dist/bin/pibo.js debug runs list <parent-id> --json
node dist/bin/pibo.js debug jobs list --queue runs --json
node dist/bin/pibo.js debug jobs dead --queue runs --json
```

Expected:

- all trace checks `ok`
- parent run completed and consumed
- live `runs` jobs empty
- dead jobs empty
- UI status matches debug status
- no lock errors during repeated debug checks
- no whole-panel horizontal overflow

## Final Verification Commands

Run:

```bash
npm run typecheck
npm run build
node --test test/debug-cli.test.mjs test/chat-trace.test.mjs test/reliability-store.test.mjs test/runs.test.mjs test/web-channel.test.mjs
npm test
```

## Notes For The Implementer

- Keep changes scoped. Do not refactor unrelated Chat UI or agent profile code.
- Do not delete unrelated dirty files.
- Prefer existing store patterns before adding new helpers.
- Browser Use is required for frontend validation per `AGENTS.md`.
- Use existing authenticated Browser Use session `pibo-auth` first.
- If adding CLI commands, keep Pibo's progressive discovery rule: short help at each level, detailed output behind explicit commands and `--json`.
- If a finding turns out to be expected behavior, update this plan or docs with the reason and add a regression test that locks that expectation.
