---
title: Pibo Session Signal System Remaining Implementation Plan
version: 0.1
date_created: 2026-05-06
last_updated: 2026-05-06
owner: Pibo maintainers
tags: [implementation-plan, signals, sessions, chat, tests, remaining-work]
related_specs:
  - spec/spec-architecture-session-signal-system.md
  - spec/spec-implementation-plan-session-signal-system.md
related_commits:
  - 3edc278 Implement session signal system
---

# Introduction

This plan covers the remaining work after the first additive Session Signal System implementation. The first implementation added the in-memory signal registry, core projections, run-registry listeners, Chat Web signal APIs, signal SSE, and a legacy UI status mapping.

The remaining work should finish the migration: make signals the live source of truth in Chat Web, stop depending on trace/run-reminder inference for current activity, add endpoint and UI tests, add memory bounds and recovery behavior, and clean up legacy naming.

## Current Baseline

Implemented:

- `src/signals/*` core types, registry, aggregation, and projectors.
- Router-owned `PiboSignalRegistry`.
- Session creation, queue, processing, output event, disposal, subagent, compaction, tool, and yielded-run projection.
- Run-registry lifecycle listeners.
- Chat Web signal snapshot endpoints and SSE stream.
- Chat UI signal API helpers and legacy `idle | running | error` mapping.
- Unit tests for nested aggregation, yielded-run activity, and patch versions.

Known gaps:

- Full `npm test` does not complete cleanly yet.
- One legacy trace test fails: `chat trace shows async subagent runs under pibo_run_start tool calls`.
- Chat UI still maps signals to legacy status instead of using rich signal fields directly.
- Trace engine still owns some live-state inference.
- Run reminder service messages still exist as a live-state fallback path in trace rendering.
- Signal registry has no terminal-node TTL eviction yet.
- Signal recovery is in-memory plus run-registry recovery only.
- Signal APIs lack focused integration tests.

## Done Definition For Remaining Work

The remaining work is done when:

1. `npm test` passes without timeout or unexpected open handles.
2. Chat Web signal endpoints and SSE have tests.
3. Chat UI working indicators use signal-derived fields, not trace status inference.
4. Parent sessions stay visibly active while any descendant or yielded run is active.
5. Run reminder parsing is no longer needed for live yielded-run state.
6. Trace engine renders history and optional signal overlays, but does not decide current session activity.
7. Terminal signal nodes are bounded by TTL or an equivalent pruning policy.
8. Gateway restart cannot leave stale active signal nodes permanently running.
9. `activeTools` no longer appears as the preferred field in new code paths; `enabledTools` is used instead.
10. Tests cover endpoint access control, SSE patch delivery, UI signal status mapping, run transitions, child aggregation, compaction, abort/dispose, and recovery.

## Phase 0: Stabilize The Test Baseline

Goal: make the existing test suite reliable before deeper migration.

### Work

1. Reproduce the failing legacy trace test alone:
   - `node --test test/chat-trace.test.mjs --test-name-pattern 'async subagent runs'`
2. Decide whether the expected title should be `qa_researcher` or `explorer`.
   - If `qa_researcher` is the intended profile/subagent display name, fix trace metadata resolution.
   - If `explorer` is now correct, update the test fixture.
3. Investigate full-suite timeout/open handles.
   - Run targeted groups first: runs, session-router, subagents, web-gateway, chat-trace.
   - Use Node test diagnostics if needed.
4. Keep this phase limited to test correctness and obvious leaks. Do not refactor signal code here.

### Tests

- `npm run typecheck`
- `node --test test/chat-trace.test.mjs --test-name-pattern 'async subagent runs'`
- `node --test test/runs.test.mjs test/session-router-store.test.mjs test/subagents.test.mjs`
- `npm test`

### Acceptance

- Full test suite finishes without timeout.
- No unrelated trace behavior changes.

## Phase 1: Add Signal API Integration Tests

Goal: prove Chat Web exposes snapshots and patches correctly.

### Work

1. Add tests for `GET /api/chat/signals/session/:piboSessionId`.
2. Add tests for `GET /api/chat/signals/tree/:piboSessionId`.
3. Add tests for `GET /api/chat/signals/events?rootPiboSessionId=...`.
4. Verify access control matches existing Chat Web session APIs.
5. Verify the stream sends a snapshot before patches.
6. Verify version gaps are detectable by the client contract, even if automatic resync remains client-side.

### Suggested files

- `test/chat-signals-api.test.mjs`, or extend an existing Chat Web API test if one already owns this setup.
- Use an in-memory session store and test web app context where possible.

### Tests

- Snapshot for a single session returns `sessions[piboSessionId]` and local nodes.
- Tree snapshot includes child and grandchild sessions.
- Unauthorized session returns 404 or the existing equivalent access-control error.
- SSE emits `signal_snapshot` first.
- A projected queue or run change emits `signal_patch` with monotonic versions.

### Acceptance

- Signal APIs are covered without browser automation.
- Tests fail if the registry is missing from the channel context.

## Phase 2: Use Rich Signals In Chat UI

Goal: stop treating signal data as only a legacy `idle | running | error` replacement.

### Work

1. Store the latest signal snapshot by root session.
2. Add helpers for selected session signal state:
   - `selectedSignalSnapshot`
   - `selectedSessionSignal`
   - `selectedRootSignal`
3. Drive compact-terminal working state from signal fields:
   - `isWorking = selectedSessionSignal?.isTreeActive`
   - `workingPhase = selectedSessionSignal?.phase`
   - `activeDescendantCount = activeChildren.length + activeRuns.length`
4. Drive session tree badges from signal fields:
   - active descendant indicator
   - error descendant indicator
   - blocked descendant indicator
5. Keep legacy status mapping only for components that still require it.
6. On signal version gap, fetch a fresh tree snapshot.

### Suggested files

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/types.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`
- possibly `src/apps/chat-ui/src/session-views/types.ts`

### Tests

Add UI-level pure helper tests if the project has a browserless test pattern, or isolate helpers into a testable module.

Test cases:

- `aggregateStatus=running` maps to working UI.
- Active yielded run shows working state after selected trace has finished.
- Active child session shows parent active-child indicator.
- Error child sets parent error descendant badge.
- Blocked child sets blocked descendant badge.
- Version gap causes snapshot refetch instead of applying stale patch.

### Acceptance

- The compact terminal no longer needs trace running nodes to show working state.
- Parent session UI remains active when only a child or yielded run is active.

## Phase 3: Split Run Reminders From Live Run State

Goal: keep service-message reminders for the model, but stop using them for live UI state.

### Work

1. Rename run notification helpers to reminder names:
   - `formatRunNotification` -> `formatRunReminderMessage`
   - `isRunNotificationServiceMessage` -> `isRunReminderServiceMessage`
2. Keep reminder delivery behavior for tracked runs.
3. Mark trace parsing of `<pibo_run_notification>` as legacy history support.
4. Ensure yielded-run badges/statuses prefer signal `yielded_run` nodes.
5. Add durable run lifecycle event output if needed by non-web clients.

### Suggested files

- `src/core/session-router.ts`
- `src/shared/trace-engine.ts`
- `src/apps/chat-ui/src/tracing/*`
- `src/apps/chat-ui/src/session-views/*`

### Tests

- Run starts: signal has active `yielded_run`; no service reminder parsing required.
- Run completes: signal changes to terminal state immediately.
- Reading/acknowledging a run updates consumed/acknowledged signal metadata.
- Old stored run reminder messages still render as history.
- Deleting live reminder parsing does not break current yielded-run UI.

### Acceptance

- UI live state comes from `yielded_run` signals.
- Reminder service messages remain agent-facing only.

## Phase 4: Move Trace Engine To Historical Rendering

Goal: make trace rendering deterministic history plus optional signal overlay, not the source of current session activity.

### Work

1. Add optional signal overlay input to trace projection if current node decoration is still needed.
2. Remove or reduce `sessionStatus === "running"` inference for current activity.
3. Stop treating `message_finished` as the decisive idle signal in trace/UI paths.
4. Prefer signal tool nodes for currently executing tools.
5. Prefer signal run nodes for async-agent and yielded-run current state.
6. Keep existing trace behavior for stored historical events.

### Suggested files

- `src/shared/trace-engine.ts`
- `src/apps/chat/trace.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/tracing/adapt.ts`

### Tests

- Trace renders completed history while signal shows idle.
- Trace can show historical run reminders without marking the session active.
- Live active tool is decorated from signals.
- `message_finished` does not close a session tree if a run or child remains active.
- Async subagent run status follows signal run status when available.

### Acceptance

- Trace engine no longer owns session-level live activity semantics.
- Signal aggregate is the source for current activity.

## Phase 5: Terminal Node Retention And Memory Bounds

Goal: prevent unbounded signal node growth.

### Work

1. Add terminal-node retention config inside the registry.
2. Keep active nodes indefinitely.
3. Keep terminal success nodes for a short TTL.
4. Keep terminal error nodes longer.
5. Align consumed run-node pruning with run-registry pruning.
6. Emit remove patches when nodes are evicted.

### Suggested defaults

- Terminal success: 60 seconds.
- Terminal error: 10 minutes.
- Detached terminal runs: match run-registry TTL.
- Consumed tracked runs: match run-registry TTL.

### Tests

- Active nodes are not pruned.
- Terminal success nodes are pruned after TTL.
- Terminal error nodes remain until the longer TTL.
- Remove patches are emitted.
- Aggregates stay correct after pruning terminal children.

### Acceptance

- Large long-running sessions do not grow signal memory without bound.

## Phase 6: Recovery And Startup Behavior

Goal: avoid stale running signals after gateway restart.

### Work

1. On registry creation, seed known sessions as idle/unknown when accessed or listed.
2. Recover run nodes from `PiboRunRegistry` state.
3. Mark unverifiable active nodes as `interrupted` or `unknown`.
4. Decide whether to persist latest signal snapshots or a lifecycle journal.
5. If persisting snapshots, add a small store boundary behind `src/signals/store.ts`.

### Tests

- Restart with running run recovered from reliability store creates a run signal with recovered status.
- Restart without proof of active runtime does not leave a session `running` forever.
- Unknown/interrupted recovery state is rendered safely.
- Signal snapshot for old sessions is valid even if no signal history exists.

### Acceptance

- Gateway restart does not leave permanent false activity.

## Phase 7: Abort, Dispose, Compaction, Retry, And Blocked States

Goal: cover all lifecycle edges in the spec.

### Work

1. Emit explicit signal changes for abort/kill/kill_all.
2. Ensure dispose recursively settles child sessions and owner runs.
3. Complete compaction coverage with distinct active and terminal states.
4. Add retry lifecycle projection when retry events are exposed.
5. Add blocked/waiting support for future approval or pause flows.

### Tests

- Abort marks active turn/tool/stream nodes interrupted or cancelled.
- Dispose marks the session disposed and cancels active runs.
- Compaction start sets `phase=compaction` and aggregate active.
- Compaction end returns to idle or error.
- Retry start/end uses `retrying` and terminal status.
- Blocked status outranks running in aggregate rules.

### Acceptance

- Every lifecycle state in the architecture spec has either implemented projection or an explicit unsupported source note.

## Phase 8: Diagnostics

Goal: make signal debugging discoverable for agents.

### Work

1. Add debug CLI commands, following progressive discovery:
   - `pibo debug signals --help`
   - `pibo debug signals session <piboSessionId>`
   - `pibo debug signals tree <rootPiboSessionId>`
2. Show version, root id, session aggregates, active nodes, errors, and subscriber counts if available.
3. Add stuck-active detection for nodes older than a threshold.

### Tests

- Help output is compact and progressive.
- Session command prints local snapshot.
- Tree command prints recursive aggregate.
- Unknown session returns a clear error or empty recovered snapshot.

### Acceptance

- Agents can inspect signal state without browsing raw event logs.

## Phase 9: Final Cleanup

Goal: remove duplicated live-state paths after signals are authoritative.

### Work

1. Mark `ChatWebReadModel.statusFromEvent()` as fallback-only in comments or naming.
2. Remove UI bootstrap optimistic status overrides where signal patches are reliable.
3. Replace remaining `activeTools` UI references with `enabledTools` or `activeToolCalls`.
4. Update docs/spec status to show which requirements are complete.
5. Add migration notes for old clients.

### Tests

- Existing clients still receive legacy `idle | running | error` status.
- New UI paths use signal data.
- No new code depends on `activeTools` for executing tools.

### Acceptance

- There is one live source of truth: the signal registry.
- Legacy status remains only as compatibility projection.

## Suggested Execution Order

1. Phase 0: stabilize tests.
2. Phase 1: signal API tests.
3. Phase 2: richer UI signal use.
4. Phase 3: run reminder/live-state split.
5. Phase 4: trace/live separation.
6. Phase 5: retention.
7. Phase 6: recovery.
8. Phase 7: lifecycle edge coverage.
9. Phase 8: diagnostics.
10. Phase 9: cleanup.

Do not start Phase 3 or Phase 4 until Phase 1 proves the signal API contract. Do not delete legacy trace/reminder behavior until the UI has direct signal coverage and tests.
EOF

git status --short