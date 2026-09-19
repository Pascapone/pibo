---
type: "Investigation Report"
title: "Muse-native session settlement detection report"
description: "Proves the host-side view-death trigger, SDK buffering mechanics, and viable Pibo recovery paths for Muse-native turns stuck on running."
tags: ["muse-native", "session-lifecycle", "incident", "detection", "recovery"]
status: "draft"
authority: "evidentiary"
generated:
  by: "meta/muse-spark"
  at: "2026-09-19T18:30:00Z"
sources:
  - id: "incident-investigation"
    resource: "/reports/muse-native-session-settlement-investigation-2026-09-19.md"
    title: "Muse-native session settlement investigation"
  - id: "validation-plan"
    resource: "/plans/muse-native-session-settlement-docker-headpool-validation.md"
    title: "Muse-native session settlement Docker and deployment-pool validation"
---

# Candidate identity

```yaml
run_id: 2026-09-19T18-00Z-muse-settlement-detect
source_commit: 1d15764159182f024b8c21f8250df804b6a81ec9
working_tree_clean: false # unrelated untracked docs/plans/pibo-remote-agent-entwurf.md in main checkout; worktree clean
muse_sdk_version: 1.3.0
muse_binary_version: 1.3.0-R3401.1
node_version: v24.21.0
dev_container: pibo-dev-muse-settlement-debug
worktree: .worktrees/muse-settlement-debug
provider: meta
model: muse-spark-1.3-contributor
real_inference_turns_used: 3 # 2 SDK-level + 1 adapter-level, all short
```

No host gateway was started, stopped, or restarted. All live-gateway state was read read-only.
Real inference ran only in the isolated container with a user-approved device-code credential
that never left the container.

# Executive conclusion

The contact loss is a **host-side, per-session view-subsystem death** in `muse serve`,
not a transport or network failure:

1. In all four incidents the host marked the session view projection `unavailable`
   within seconds of Pibo's last received event (6 ms in the best-measured case).
2. After that instant the host pushes **no further view notifications at all** --
   no `view/gap`, no `turn/completed` -- while staying alive, answering requests,
   and completing the native turn.
3. Pibo depends exclusively on the ephemeral push plane, so the routed turn hangs
   until the 90-minute silence watchdog, holds its capacity lease, and makes
   `kill`/`abort` hang as well.

Separately proven: Pibo *could* detect and recover, because the host request plane
stays truthful -- `session/read` reports `activeTurnId: null` for the dead turn and
a `view/page` walk reaches the lost `turn/completed`. Pibo queries neither during
silence. `turn/interrupt` does **not** replay the terminal, so interrupt-based
recovery cannot work.

# Finding 1 -- view-death coincides with live cutoff (4/4)

All timestamps UTC. `HEAD.json` mtime vs Pibo's last persisted live event:

| Native session | Pibo last event | HEAD `unavailable` | Delta |
|---|---|---|---|
| `01a0b909…` (ps_f8f) | 11:35:37.827 | 11:35:44 | ~7 s |
| `01a0b924…` (ps_cde) | 11:35:52.402 | 11:35:57 | ~5 s |
| `01a0b8d8…` (ps_002) | 11:40:28.114 | 11:40:28.140 | same second |
| `01a0b98a…` (ps_605) | 15:06:39.667 | 15:06:39.673 | 6 ms |

Method: read-only comparison of `event_log.created_at` in the live `pibo.sqlite`
against `.msp-view-v1/<native>/HEAD.json` mtimes (`--time-style=full-iso`).
All four heads report `status: unavailable`; all ten unaffected sessions on the
same runtime instance report `healthy`, including sessions larger than two of
the victims -- size is not the trigger.

All four cutoffs land on a `tool_execution_finished` frame. The turns are
tool-heavy, so this may be base rate rather than causation; recorded as an
observation, not a claim.

# Finding 2 -- live push and persisted projection die together, writer stalls first

In all four cases the projection journal/index stopped being written **minutes
before** the cutoff (6-21 min), while live push continued. At the cutoff the
host marks the head `unavailable` and live push stops in the same instant.

This means the persisted projection is not on the synchronous live path, but
both are fed by one view subsystem whose death kills live delivery without
emitting the designed `view/gap` signal (the gap bracket only flushes on a
later accepted delivery, which never comes).

# Finding 3 -- hung `view/page` deadlocks the SDK (deterministic, T4 proven)

A protocol-level probe against SDK 1.3.0 `Session` with a stub connection:

- `view/gap` -> fold `deliveryGap`, one `view/page` request issued;
- while the page hangs, `turn/completed` applies as `bufferedDuringGap`;
- `turn.completed` and the gap `io` stay unsettled indefinitely with **zero**
  gap errors;
- resolving the page splices the buffered terminal and settles `completed`;
- a *rejected* page reports `MuseGapFillError` via `onGapError`, drains the
  buffer, and settles -- only the hang is fatal.

Pibo has no defense or observability here: `src/` contains zero references to
`onGapError`, gap fill, or `bufferedDuringGap`; `MuseNativeConnectionPump`
discards the `Session.apply` return value and swallows routing errors.

Probe: `/tmp/muse-gap-probe.mjs` (host scratch; imports the container SDK at
`/workspace/node_modules/@muse-code/sdk`).

# Finding 4 -- incident artifact interrogation (real host, copied state)

A read-only copy of the ps_605 incident `xdg-data` (40 MB) was served by a
fresh `muse serve --disable-sandbox` in the container. Results:

- `session/list` / `session/read`: `activeTurnId: null` -- the host knows the
  turn is over.
- `session/resume`: succeeds with `history: {mode: "none",
  noneReason: "projectionUnavailable"}` -- resume works but carries no history,
  and it does not settle the previously minted turn handle.
- `view/page` from the beginning walks 13 pages / 2405 events to source
  sequence 17678 and **finds the lost `turn/completed`** for run `01a0ba2b`
  (terminal `completed`). Recovery via paging is possible (~18 s wall time
  for a 17k-record session).
- Paging directly from the frozen head cursor (`v:<session>:2500`) fails with
  `unknown cursor anchor` -- recovery must walk from an older cursor.
- `turn/interrupt` on the natively terminal turn returns `status: accepted`
  but emits **no** `turn/completed` afterwards. Interrupt cannot settle Pibo.
- `approval/listPending` answers normally -- consistent with the incident's
  "host responsive" probes.

Scripts: `/tmp/muse-incident-interrogate.mjs`, `/tmp/muse-page-walk.mjs`,
`/tmp/muse-page-walk2.mjs` (host scratch; run in the container).

# Finding 5 -- silence is host-authored, not Pibo-side

Each Pibo session owns a separate `serve` process, yet three died within five
minutes (11:35-11:40) while a fourth actively streaming session on the same
runtime instance (ps_95fb, native `01a0b8eb…`) survived past 11:49. A
Pibo-side reader stall is ruled out: the same stdio pipe answered liveness
probes during the silence (the watchdog took three windows instead of failing
at the first). The host stopped emitting view notifications per session while
continuing to answer requests.

# Finding 6 -- healthy live baseline (T0, real inference)

With a user-approved device-code credential in the container (3 turns total):

- SDK level: 2/2 turns settle (`completed`), full notification trace captured,
  zero gaps, zero gap errors.
- `session/read` during a turn reports `activeTurnId = <turnId>`; after the
  terminal it reports `null` -- the proposed silence detector works live.
- Adapter level (real Pibo `muse-native` adapter, live binary): 1/1 turn
  settles `turn_started -> assistant_message -> turn_completed` in ~20 s.
- Final content precedes the terminal by ~11-16 s (end-of-turn gate plus
  background reminder children) -- normal, matches prior controls.

Scripts: `/tmp/muse-live-baseline.mjs`, `/tmp/muse-live-adapter.mjs`.

# Finding 7 -- Pibo-side defects (all confirmed in code)

1. **No raw transport record.** Notification method/cursor/gap/page lifecycle
   is never logged; post-hoc discrimination is impossible.
2. **`Session.apply` outcome ignored** (`sessions.ts`, `MuseNativeConnectionPump.route`).
   `bufferedDuringGap` is invisible; routing exceptions are swallowed.
3. **No `Session.onGapError` registration** anywhere in `src/`.
4. **No authoritative reconciliation.** The silence watchdog
   (`turn.ts`, 3 x `requestTimeoutMs` = 90 min default) only probes liveness
   (`approval/listPending`), which stays green exactly when this failure
   occurs. It never queries `session/read` / `activeTurnId`.
5. **`abort`/`kill` unbounded.** `adapter.abort()` awaits
   `turns.interrupt()`, which awaits the stuck turn's `finished` promise;
   `routed-session.kill()` awaits `abort()` with no timeout. Kill hangs with
   the turn (observed: "kill appears ineffective").
6. **Capacity held 90 minutes.** The routed prompt holds the provider lease
   around the awaited runtime prompt; stuck turns exhaust the room's ordinary
   ceiling (4 of configured 5) and reject unrelated work.
7. **Interrupt response swallowed.** `turn.ts interrupt()` catches all errors
   from `turn/interrupt`; an `already_processed`/terminal answer never
   triggers local settlement (and per Finding 4 no replay follows anyway).

# Updated causal chain

1. The host's per-session view subsystem dies mid-turn (host bug, trigger
   unknown); head marked `unavailable`, live push stops instantly, no gap.
2. Pibo's `turn.completed` promise never settles; no error, no telemetry.
3. The routed prompt and its capacity lease stay active (up to 90 min).
4. Room capacity exhausts; unrelated queued messages fail admission.
5. `kill`/cancel hang on the same stuck promise.
6. The 90-minute watchdog eventually errors and releases the lease.
   (ps_605 settled after ~61 min via operator archive/disposal instead.)

Frequency on 2026-09-19: 4 view-deaths in 57 Muse-native `message_started`
(~7%), plus downstream capacity victims.

# Hypothesis resolution (updates the prior investigation)

| Hypothesis | Verdict |
|---|---|
| Host view projection stops publishing | **Proven.** 4/4 with ms-precision coincidence. |
| `view/gap` + hung `view/page` buffers terminal in SDK | Mechanism proven, incident role **unlikely**: no gap was emitted (nothing arrived at all), and post-mortem `view/page` answers. A transient hang during the incident cannot be fully excluded but is not needed to explain anything. |
| Transport/connection died | **Rejected.** Requests answered throughout. |
| Pibo-side reader stall | **Rejected.** Liveness responses flowed on the same pipes; a fourth session survived. |
| Capacity caused the loss | **Rejected** (already was). Effect, not cause. |
| Stale UI/SSE only | **Rejected** for these four: the durable Pibo event stream itself stops. |

# Recommended fix direction (not implemented)

Layered, in priority order:

1. **Silence detector via `session/read`.** On N seconds without view activity
   (short: 60-180 s, not 30 min), query `session/read`; if `activeTurnId` is
   null/absent while Pibo holds an in-flight turn, the native turn is over.
2. **Authoritative reconciliation.** Walk `view/page` from the last known
   cursor (bounded pages/time); fold recovered frames; settle the turn locally
   with a `warning` recording the recovery. If paging cannot reach a terminal,
   settle as failed-with-recovery-attempted and release the lease exactly once.
3. **Bounded abort.** `interrupt()`/`abort()`/`kill()` must settle locally
   within seconds (e.g. bounded wait + forced local settlement + lease
   release), never wait on the stuck turn promise.
4. **Raw transport observability.** Log notification method/cursor (redacted),
   `apply` fold kind, gap/page lifecycle, and `onGapError` as structured
   diagnostics so the next incident discriminates itself.
5. **Upstream host report.** The view-subsystem death (silent push stop, no
   gap, `projectionUnavailable`) is a muse 1.3.0 host bug. Report with the
   four session specimens, HEAD/journal evidence, and the non-emission of
   `view/gap`.

Invariants to preserve: at most one terminal event per turn; idempotent lease
release; no duplication of content across recovery; ordinary capacity never
touches the nested reserve.

# Residual risks and non-goals

- The host-side trigger for the view death is unknown; no on-demand
  reproduction exists. The next occurrence must be caught with Finding-4
  instrumentation already in place.
- `view/page` recovery cost (~18 s for 17k records) is acceptable for a
  recovery path but should be bounded and measured per incident size.
- No browser/SSE validation was run: the failure was proven below the UI
  layer, so UI work would not discriminate anything.
- Deployment-pool soak (T11) was not run; the evidence did not require it.

# Cleanup status

- Host gateway untouched (no start/stop/restart; read-only forensics only).
- Dev container `pibo-dev-muse-settlement-debug` and worktree
  `.worktrees/muse-settlement-debug` (branch `muse-settlement-debug`) are
  **kept** for the fix phase; release with `pibo compute release
  pibo-dev-muse-settlement-debug` when done.
- Container credential (`/tmp/probe-config/muse/auth.json`) is confined to
  the container; revoke via `muse logout` in the container if undesired.
- Host scratch probes in `/tmp/*.mjs` (gap probe, interrogation, page walks,
  live baselines) and `/tmp/muse-incident-605` (40 MB incident copy) are
  intentionally left for reproduction.
