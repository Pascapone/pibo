---
type: "Historical Record"
title: "Plan: Canonical Session Turn Lifecycle Signals"
description: "Preserves the completed session-turn lifecycle signals plan as historical rationale after canonical consolidation."
tags: ["historical-plan", "sessions", "signals"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/plans/session-turn-lifecycle-signals-plan.md"
  source_commit: "debba32a68137205df6351da9f3ae461004ca0c0"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "f7e247c07c1f2b89f89051d9b066efc95699235e"
  source_bytes: 6850
  source_sha256: "f210e42343c06d3bba8ed10f25bf1005978d92f0313440cf61933ff40f41d9df"
  source_body_sha256: "f210e42343c06d3bba8ed10f25bf1005978d92f0313440cf61933ff40f41d9df"
generated:
  by: "process:pibo-okf-p-current-project-plans"
  at: "2026-08-31T22:47:46Z"
---
# Plan: Canonical Session Turn Lifecycle Signals

**Status:** Completed
**Created:** 2026-07-15
**Source:** Live Working/timer and sidebar status divergence in Pibo 1.9.2
**Related spec:** `docs/specs/capabilities/pibo-session-signals.md`

## Why

Chat Web currently derives sidebar status and the Working footer from different state machines. Sidebar status follows room-summary and signal snapshots. Working combines trace state, signal state, running rows, and a local latch. The latch prevents early disappearance but can remain active after the runtime has stopped when its transient terminal trace event disappears.

The UI needs one canonical turn lifecycle that survives trace pagination, SSE reconnects, and trace refreshes. Trace data should explain a turn, not decide whether it is still running.

## Goal

Make the signal registry the canonical source for active-turn start and termination, then expose one reusable activity resolver and React hook to all selected-session status surfaces.

## Invariants

1. A turn leaves `running` at most once. A processing-stop fallback may be refined by a later explicit terminal event, but no terminal state may reactivate the turn.
2. After an explicit terminal event, the turn state is immutable. Only a different turn id can start new work.
3. A running turn keeps the selected session status active.
4. A stopped runtime cannot retain a running turn. Processing shutdown terminalizes any unresolved turn as interrupted.
5. Assistant, reasoning, and tool phase boundaries do not end the turn.
6. Working visibility and elapsed time never depend on trace pagination, trace status, raw-event visibility, or terminal-row retention.
7. Sidebar and Working derive their selected-session state from the same signal snapshot and resolver.
8. Yielded runs or active descendants may keep a session tree active after its local turn ends, but they do not keep the local Working footer visible.

## Canonical Signal Contract

Add `latestTurn` to `PiboSessionSignalSnapshot`:

```ts
{
  nodeId: string;
  eventId: string;
  state: "running" | "completed" | "failed" | "cancelled" | "interrupted";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

The registry derives this summary from the newest turn node. Terminal turn nodes remain available until normal terminal-node pruning. Removing an old terminal node cannot reactivate Working.

## Event Mapping

| Input | Turn transition | Session effect |
|---|---|---|
| `message_started` | New turn becomes `running` | Session becomes active |
| Assistant/reasoning/tool events | No turn transition | Phase may change |
| `message_finished` | Matching turn becomes `completed` | Session may become idle |
| `session_error` | Matching turn becomes `failed` | Session becomes error |
| `session_interrupted` | Unresolved latest turn becomes `interrupted` | Session becomes interrupted |
| `session_disposed` | Unresolved latest turn becomes `cancelled` | Session becomes disposed |
| `session_processing_changed(false)` | Any unresolved turn becomes `interrupted` | Runtime cannot remain falsely active |

Explicit terminal events win over the processing-stop fallback. A later fallback must not overwrite `completed` or `failed`.

## Shared UI Activity Model

Create a renderer-neutral resolver under `src/session-ui/`:

```ts
resolveSessionActivity(signalSnapshot, fallback)
```

It returns:

- coarse status: `idle`, `running`, or `error`;
- `isTreeActive`;
- `isTurnActive`;
- active turn id and start time;
- latest terminal turn state when available.

Create a React hook under Chat UI:

```ts
useSessionActivity({ signal, fallbackStatus, fallbackTurnStartedAt })
```

When a signal snapshot exists, the hook ignores trace-derived lifecycle state. Trace fallback is allowed only while the signal API is unavailable or has not produced an initial snapshot.

## UI Integration

1. `app-signal-status.ts` derives navigation status from the shared resolver.
2. The selected room-summary stream does not overwrite a session-tree status with a conflicting summary event while an authoritative signal snapshot exists.
3. Compact Terminal uses `isTurnActive` and the signal turn start time for Working and the timer.
4. Remove the local active-turn latch and its trace-terminal dependency.
5. Keep trace-based message timestamps and completed durations unchanged.

## Compatibility

- Existing signal fields remain available.
- `latestTurn` is additive.
- Clients that ignore the new field continue to work.
- If the signal API is unavailable, Chat Web falls back to the existing coarse status and trace start time without a persistent latch.

## Test Plan

### Signal registry

- Turn remains running through assistant, reasoning, tool, subagent, and compaction phases.
- `message_finished`, `session_error`, interruption, disposal, and processing stop produce the expected terminal state.
- Abort and kill actions terminalize the turn before awaiting runtime shutdown.
- Late processing-stop events do not overwrite explicit completion or failure.
- A new turn replaces a terminal latest turn.
- Patches include `latestTurn` changes and remain monotonic.
- Pruning a terminal turn cannot produce an active turn.

### Shared resolver and hook contract

- Running turn makes sidebar status running and Working active with one start time.
- Completed, failed, cancelled, and interrupted turns stop Working.
- An active yielded run keeps tree status running but does not show local Working.
- Trace state cannot reactivate a terminal signal turn.
- Fallback behavior works when no signal snapshot exists.

### API and integration

- Signal snapshot and SSE patch payloads expose `latestTurn`.
- Bootstrap/navigation overlays use the shared status projection.
- Room-summary updates cannot race the selected authoritative signal snapshot.
- Existing trace timing, signal API, sidebar, and terminal tests remain green.

### User-visible validation

- Start a turn and verify sidebar active, Working visible, and timer increasing.
- Verify tool and reasoning transitions do not hide Working.
- Verify success, provider error, and abort each stop sidebar activity and Working together.
- Verify a long turn that exceeds the trace tail limit retains its timer and still stops at completion.

## Acceptance Criteria

- [x] Working never disappears while `latestTurn.state === "running"`.
- [x] Working is absent whenever `latestTurn.state` is terminal or no local turn exists.
- [x] The selected sidebar status cannot be idle while the canonical turn is running.
- [x] Runtime processing shutdown leaves no running turn signal.
- [x] No Compact Terminal lifecycle decision reads trace terminal events or uses a local latch.
- [x] Typecheck, production build, focused tests, broader signal/trace tests, and browser validation pass before PR creation.
