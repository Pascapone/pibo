---
type: "Investigation Report"
title: "Muse-native view recovery validation"
description: "Live and deterministic validation of automatic view-death recovery for Muse-native turns."
tags: ["muse-native", "session-lifecycle", "recovery", "validation"]
status: "draft"
authority: "evidentiary"
generated:
  by: "meta/muse-spark"
  at: "2026-09-19T20:30:00Z"
sources:
  - id: "detection-report"
    resource: "/reports/muse-native-session-settlement-detection-2026-09-19.md"
    title: "Muse-native session settlement detection report"
---

# Candidate identity

```yaml
run_id: 2026-09-19T20-00Z-muse-view-recovery-validate
source_commit: 27ab39cb
working_tree_clean: false # recovery implementation uncommitted at validation time
muse_sdk_version: 1.3.0
muse_binary_version: 1.3.0-R3401.1
node_version: v24.21.0
dev_container: pibo-dev-muse-settlement-debug
worktree: .worktrees/muse-settlement-debug
provider: meta
model: muse-spark-1.3-contributor
real_inference_turns_used: 3 # healthy, dead-view recovery, dead-view abort
```

# What was built

Automatic view-death recovery in the muse-native turn controller
(`src/agent-runtimes/muse-native/turn.ts`), wired through adapter, config,
and pump:

- Each silence window (default 60s poll, never coarser than
  `requestTimeoutMs`) reconciles via `session/read`: a running native turn is
  backfilled from `view/page` starting at the last live cursor; a finished
  native turn is recovered the same way and settles through the normal
  terminal path.
- Walks are bounded (25 pages default, 15s per request), fold each cursor at
  most once, never re-fold `turn/started`, and stop behind an in-flight gap
  fill with a loud warning instead of deadlocking.
- Recovery announces itself with one `reconciling` line and, on success, one
  `recovered` line (warning plus reasoning text), plus per-check redacted
  `native_event` telemetry.
- A natively finished turn whose terminal stays missing fails fast after one
  retry window; abort waits up to `abortTimeoutMs` (default 15s) before
  settling locally as cancelled.

# Deterministic evidence

New committed tests (fail-first observed on old code, green on new code):

- `Muse native view-death turn recovers via page walk and settles`: fake-host
  `[viewdeath]` script withholds mid-turn frames and the terminal while
  `view/page` keeps serving them. Old code rejects after the outer silence
  budget (`timed out after ... without activity (host responsive)`); new code
  backfills across windows and settles `turn_completed` with both honest
  lines and recovery telemetry.
- `Muse native abort settles a stuck turn within the abort bound`: stub turn
  that never settles; old code hangs unbounded (demonstrated via shell
  timeout); new code emits `turn_completed/cancelled` after the abort bound.
- `Muse native turn fails fast when the native turn is over but unrecoverable`:
  `activeTurnId: null` plus empty pages rejects with `could not be reconciled`
  in ~60ms instead of the outer budget.
- Pump cursor tracking; config defaults/ranges for `viewRecoveryPollMs`,
  `viewRecoveryMaxPages`, `abortTimeoutMs`.

Suites (isolated container): 72/72 muse-native, 60/60 adjacent
runtime/routed/capacity/telemetry/interrupt suites, `tsc --noEmit` clean.
The `host stops answering` test now hangs `session/read` too, because the
authoritative read replaced the legacy probe as the primary silence signal.

# Live evidence (isolated container, approved device credential)

- Healthy adapter turn on new code: `turn_completed` in 9.4s, zero recovery
  emissions (no polling overhead on the healthy path).
- Dead-view recovery on the real incident artifact (native `01a0b98a…`,
  resumed with `projectionUnavailable`): zero live frames for the new turn;
  first 60s poll reads `activeTurnId: null`, walks 13 pages / 2410 frames,
  finds the terminal, emits both honest lines plus telemetry, and settles
  `turn_completed` at 70.6s with the assistant message intact.
- Bounded abort on a silent dead-view turn: abort returns after 15.079s with
  `settled locally as cancelled` and `turn_completed/cancelled`; the prompt
  returns and releases capacity. Previously this hung ~90 minutes.

# Residual risks

- A hung `view/page` behind a live gap (Tier-2 shape) is detected
  (`bufferedDuringGap` tripwire) but not locally settled; no incident has
  shown this shape, and the new transport telemetry will expose it if it
  appears.
- The host-side view death itself is still an upstream muse 1.3.0 bug; this
  recovery masks it per turn instead of fixing the host.
- Full `view/page` replays on cursorless sessions refold history; turn-scoped
  routing keeps user-visible output clean (observed: 2410 folded, 1 message
  routed), but very large sessions pay walk time on every silent turn.

# Cleanup status

- Host gateway untouched throughout (no start/stop/restart).
- Container `pibo-dev-muse-settlement-debug`, worktree
  `.worktrees/muse-settlement-debug`, and branch `muse-settlement-debug`
  retained for review/merge; release the container when done.
- Container credential confined to the container; host scratch probes in
  `/tmp/*.mjs` and `/tmp/muse-incident-605` intentionally left.
