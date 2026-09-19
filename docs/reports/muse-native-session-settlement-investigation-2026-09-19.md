---
type: "Investigation Report"
title: "Muse-native session settlement investigation"
description: "Consolidates the evidence, causal assessment, and unresolved hypotheses for Muse-native turns that remained running after native completion."
tags: ["muse-native", "session-lifecycle", "incident", "signals", "capacity"]
status: "draft"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-19T13:46:17Z"
sources:
  - id: "operator-observations"
    resource: "scope:Operator observations and two incident-report drafts supplied on 2026-09-19"
    title: "Observed Muse-native running-state incidents"
  - id: "muse-turn-adapter"
    resource: "scope:repository source src/agent-runtimes/muse-native/turn.ts at the investigated checkout"
    title: "Muse-native turn lifecycle adapter"
  - id: "muse-session-pump"
    resource: "scope:repository source src/agent-runtimes/muse-native/sessions.ts at the investigated checkout"
    title: "Muse-native connection and session routing"
  - id: "runtime-routing"
    resource: "scope:repository source src/agent-runtime/routed-session.ts at the investigated checkout"
    title: "Routed runtime prompt and abort lifecycle"
  - id: "signal-projector"
    resource: "scope:repository source src/signals/projector.ts at the investigated checkout"
    title: "Session signal projection"
  - id: "signal-status"
    resource: "scope:repository source src/signals/status.ts at the investigated checkout"
    title: "Projected session status"
  - id: "event-ingest"
    resource: "scope:repository source src/data/ingest-service.ts at the investigated checkout"
    title: "Durable event state projection"
  - id: "capacity-control"
    resource: "scope:repository source src/core/runtime-capacity.ts at the investigated checkout"
    title: "Provider runtime-capacity controller"
  - id: "deployment-pool"
    resource: "/specs/compute/deployment-pool.md"
    title: "Isolated Deployment Pool"
---

# Executive conclusion

The affected Muse-native work did not primarily fail inside the model turn. The native Muse executions continued, produced final assistant output, completed their tool work, and in the inspected cases committed or otherwise finished successfully. Pibo stopped observing or applying the corresponding tail of the Muse view stream and therefore retained a `running` turn until its independent silence watchdog expired after three 30-minute windows.

The strongest current explanation is a failure in the Muse view-projection path: either the Muse host stopped publishing notifications for the affected view, or the SDK entered gap recovery and waited indefinitely for `view/page` while buffering all later live notifications. Existing evidence cannot distinguish these two variants because Pibo does not record the raw notification sequence, `view/gap`, `view/page` lifecycle, GapFiller state, or gap errors. Any report claiming that the host definitely sent no notifications, or that gap filling definitely did not participate, goes beyond the available evidence.

The capacity limit was real and operationally important, but it was downstream of the original loss of settlement. The stuck prompts retained provider-capacity leases. With configured limits of ten provider turns globally and five per room, the normal-turn admission ceiling is effectively eight globally and four per room because two global and one per-room slots are reserved for nested work. A later turn waited without starting and failed after 60 seconds. It could not have caused the older turns to lose their notification tails; the older stuck turns caused the later capacity starvation.

The separately observed condition in which a final assistant message was visible while the session still appeared `running` is not automatically the same defect. Pibo deliberately treats `assistant_message` as content completion and `message_finished` as lifecycle completion. In the inspected healthy sample, all 27 final assistant messages had a matching `message_finished`; the maximum delay was 41.609 seconds. A reported delay of roughly ten minutes therefore requires a specific session and browser/SSE trace. It may be a front-end reconciliation problem, a later active turn displayed below an older final message, another gateway/home, or an unobserved backend settlement defect.

No inspected source work was lost. The target work had already been committed and merged, and its isolated worktree had been removed. The incident is nevertheless severe: incorrect lifecycle state occupied capacity for about 90 minutes, made kill/abort appear ineffective, hid the divergence from the debug consistency check, and allowed ordinary work in the room to be rejected.

# Scope

This report evaluates:

- the three closely timed stuck Muse-native sessions;
- the supplied incident reports and later operator observations;
- the relationship between native completion, Pibo lifecycle events, capacity admission, telemetry, and browser state;
- the plausibility of competing causal explanations; and
- the evidence required to prove the exact failing layer.

This report does not claim to reproduce the failure, validate a fix, or change implemented behavior. The executable follow-up is the [Docker and deployment-pool validation plan](/plans/muse-native-session-settlement-docker-headpool-validation.md).

# Incident identities

| Role | Pibo session | Native Muse session | Room | Observed result |
|---|---|---|---|---|
| Primary incident | `ps_f8f6c3d1-0ee3-48ad-b0f0-0cc6c55235c0` | `01a0b909…` | `room_4bfe…` | Native work completed; Pibo timed out after 90 minutes of silence. |
| Requested session | `ps_cde8d951-19bf-4d6b-92db-3e7a97728a4c` | `01a0b924…` | `room_4bfe…` | Native work completed, committed, and merged; Pibo timed out after 90 minutes. |
| Corroborating incident | `ps_00203e13-6a5f-491d-82a0-083031e0abab` | not needed for this conclusion | another room | Similar delayed timeout and settlement. |
| Healthy control | `ps_60529962…` | not needed for this conclusion | `room_4bfe…` | Final-message-to-terminal delays of 20.445 and 38.355 seconds, matching the native end-of-turn gate. |
| Capacity victim | `ps_6d98110f-c7f7-4cdf-952c-9b66f43ca02f` | no started turn | `room_4bfe…` | Queued, never started, then failed admission after 60.103 seconds. |

Abbreviated identifiers are used only where the full value was not necessary to distinguish evidence. The validation run must record full IDs.

# Reconstructed timeline

Times below are from the inspected event and native records. UTC is authoritative; CEST is UTC+02:00 on the incident date.

| UTC | CEST | Observation | Interpretation |
|---|---|---|---|
| 11:35:37 | 13:35:37 | Last Pibo event for `ps_f8f…`. | Pibo-visible activity stops while native execution continues. |
| 11:35:52 | 13:35:52 | Same pattern begins for `ps_cde…`. | Closely timed failures in the same room/provider make a shared view/projection condition plausible. |
| about 11:41:35 | about 13:41:35 | Native final output exists for `ps_f8f…`. | The model/runtime work did not stop at the Pibo event boundary. |
| about 11:42:23 | about 13:42:23 | Native terminal completion exists for `ps_f8f…`. | Pibo should eventually have settled, but did not observe/apply the terminal tail. |
| 12:19:47 | 14:19:47 | `ps_6d98…` emits `message_queued`. | Admission is waiting; no runtime turn has started. |
| 12:20:47 | 14:20:47 | `ps_6d98…` emits `session_error`: `Runtime capacity wait deadline exceeded.` | Capacity starvation is now visible, roughly 44 minutes after the original stream loss. |
| 13:05:46 | 15:05:46 | `ps_f8f…` errors after 5,400,000 ms without activity; host remained responsive. | Three 30-minute silence windows expired. |
| 13:06:00 | 15:06:00 | `ps_cde…` settles by the same watchdog path. | Same adapter fallback, not prompt-derived completion. |
| 13:10:36 | 15:10:36 | `ps_002…` settles similarly. | Failure was not confined to one Pibo session. |

The `.msp-view-v1` `HEAD.json` records for the two primary native sessions later reported `status: unavailable`; the healthy control reported `status: healthy`. That is relevant evidence for a view/projection failure but does not prove whether the host failed before emitting frames or the client stopped applying them during gap recovery.

# What the implementation establishes

## Native turn completion is server-authored

`src/agent-runtimes/muse-native/turn.ts` waits on `turn.completed` and an idle timeout. A responsive host can earn three silence windows. With the current 30-minute window, a silent but responsive turn can therefore remain held for approximately 90 minutes before Pibo fails it. The SDK completion promise is settled by server-authored terminal events, not by the presence of final assistant text.

This design explains the observed duration exactly, but the duration is a fallback symptom rather than the original cause.

## A routed prompt retains its capacity lease

`src/agent-runtime/routed-session.ts` holds the provider capacity lease around the awaited runtime prompt. If the Muse adapter never resolves its prompt because the terminal event is missing or buffered, the capacity lease remains active until completion, abort settlement, or timeout. Multiple such prompts can consume the room's normal admission capacity.

## Content completion and lifecycle completion are separate

`src/signals/projector.ts` treats `assistant_message` as the end of the assistant content stream. Only `message_finished` transitions the session to idle and marks the turn done. `src/data/ingest-service.ts` follows the same durable lifecycle distinction: queued/started events produce running state, `message_finished` produces idle, and `session_error` produces error.

This distinction is legitimate because Muse can delay terminal completion after final text while it performs its end-of-turn gate. The UI should, however, make that intermediate state explicit and must reconcile quickly once the backend has settled.

## Capacity settings include reserved admission

`src/core/runtime-capacity.ts` reserves up to two provider-global slots and one per-room slot for nested work. At configured limits of ten globally and five per room:

- ordinary top-level work can use at most eight provider-global slots;
- ordinary top-level work can use at most four slots in one room; and
- the remainder is intentionally protected for nested execution.

The current Settings wording presents only a gateway limit and a per-room limit. Without explaining reservations or provider scoping, an operator can reasonably expect the fifth ordinary room turn to start when it will actually wait. Capacity pools are keyed by provider, so “global” is global to that provider pool, not necessarily to every runtime in the gateway.

## The connection pump hides decisive evidence

`src/agent-runtimes/muse-native/sessions.ts` routes incoming methods through `session.apply(...)`, but the routing path does not retain the returned outcome or I/O completion as an observable signal and catches routing errors. There is no registered `Session.onGapError` handler in the inspected Pibo source.

The Muse SDK GapFiller reacts to `view/gap` by marking the view as filling and buffering subsequent live frames. It awaits `connection.request("view/page", ...)` without an explicit request timeout in the inspected installed SDK. A request that rejects can drain and recover, but a request that never resolves can leave filling active indefinitely and hold every later notification, including terminal events. This is a concrete mechanism consistent with the incident, not proof that it occurred.

# Evidence-backed causal chain

The most defensible causal chain is:

1. Multiple accepted Muse turns were already running normally.
2. The Pibo-visible notification tail stopped for several sessions at closely related times.
3. Native Muse work continued and reached final and terminal states.
4. Pibo did not receive or apply the terminal state to its turn completion promise.
5. Routed prompts and their provider-capacity leases remained active.
6. The room reached its effective ordinary admission ceiling of four.
7. A later message stayed queued, never started a native turn, and failed its 60-second capacity wait.
8. Kill/interrupt could not promptly settle the Pibo prompt because the native turn was already terminal and returned an already-processed response without replaying the missing terminal event.
9. The three-window idle watchdog eventually emitted errors after 90 minutes and released capacity.

This chain explains the timing, the successful native artifacts, the delayed Pibo errors, the capacity symptom, and the apparent ineffectiveness of kill without making an unsupported choice between host-side projection loss and client-side gap-fill deadlock.

# Hypothesis assessment

| Hypothesis | Confidence | Evidence for | Evidence against or missing | Required discriminator |
|---|---|---|---|---|
| Muse host view projection stopped publishing for affected views. | Medium-high | Multiple views lost their tails; later `HEAD.json` was unavailable; native execution continued. | No raw host notification audit exists. | Host-side raw view log correlated by session, turn, cursor, and timestamp. |
| A `view/gap` caused an indefinitely pending `view/page`, buffering later frames in the SDK. | Medium-high, mechanism proven but incident unproven | SDK control flow permits it; Pibo lacks a page timeout and gap telemetry; symptom matches complete tail suppression while connection liveness probes work. | No recorded gap/page event for the incident. | Log `view/gap`, page request start/end, filling state, and buffer depth; inject a hung page deterministically. |
| The entire Muse stdio/transport connection died. | Low | Would explain missing frames. | Host liveness probes remained responsive and native work continued. | Raw request/response and transport health trace. |
| Reaching the capacity maximum caused the original notification loss. | Rejected as primary cause | Capacity did fail later. | Stream loss preceded the capacity failure by about 44 minutes; the later waiter never started a runtime. | Provider lease timeline is sufficient unless contrary earlier evidence appears. |
| Capacity amplified the incident and blocked unrelated work. | High | Stuck prompts held leases; a later queued message timed out without `message_started`. | None material. | Repeat controlled admission test with lease traces. |
| Compaction was a common trigger. | Low/rejected for these incidents | A separate intake incident involved compaction. | Two primary incidents show no compaction event; the third had compaction nearly two hours earlier. Turns were accepted and executed, unlike the rejected-start incident. | Raw timeline only if new evidence connects a gap cursor to compaction. |
| Long tools or legitimate silence caused native failure. | Rejected | Long silence invokes the timeout. | Native work completed; loss occurred across active turns and omitted terminal tails. | Baseline long-tool run confirms activity accounting but does not explain this incident. |
| Gateway-wide failure stopped all sessions. | Rejected | Several sessions were affected. | Healthy Muse sessions completed through the same gateway. | Provider/session-scoped tracing. |
| The roughly ten-minute final-visible/running observation is a backend terminal delay. | Unresolved | Such a delay is possible in principle. | Today's inspected 27/27 finals settled; maximum was 41.609 seconds. | Exact session ID plus DB, signal, SSE, and browser timestamps. |
| The roughly ten-minute observation is stale UI/SSE state. | Plausible, unproven | Backend sample does not show the delay; client relies on EventSource plus reconciliation. | No browser trace or exact session was captured. | Compare durable event time, signal revision, SSE patch, DOM state, visibility changes, and reconciliation. |

# Review of the supplied incident reports

## First report

The first report is materially correct about the timeline, continued native execution, eventual 90-minute timeout, status settlement, and the inability of kill to resolve the missing terminal event. Its strongest causal sentence is too definite: the evidence shows that Pibo did not observe/apply notifications, not that the Muse host definitely sent none. Its exclusion of gap filling is also unsupported because the SDK can buffer live frames behind a hung `view/page` without producing the Pibo evidence that the report expected.

The local copy inspected during this investigation was also textually truncated, so it should not remain the canonical handoff artifact.

## Second report

The second report is more cautious and broadly consistent with the evidence. Its phrase “no assistant completion” should be narrowed to “no assistant completion was projected into Pibo,” because native final assistant output existed. It treats `ps_605…` as suspicious, but the later event correlation makes that session a healthy control: its 20.445-second and 38.355-second gaps nearly match Muse `eot_gate_ms` values of 20,305 and 37,933.

Any worktree statement in that report was a point-in-time observation. The target changes were subsequently committed and merged, and the worktree was removed.

# Distinct defects and risks

The incident is not one bug. The following independently actionable weaknesses were exposed:

1. **Unlocated event-delivery failure.** Pibo cannot currently distinguish host projection loss from SDK gap-fill buffering.
2. **Unbounded or excessively delayed settlement.** A native-terminal turn can consume a lease for three 30-minute windows.
3. **Abort reconciliation failure.** Interrupting an already-terminal native turn can return `already_processed` without replaying the terminal event or settling Pibo promptly.
4. **Capacity cascade.** Stuck prompts retain leases and can reject unrelated room work.
5. **Capacity UX ambiguity.** Configured 10/5 appears to mean ten/five ordinary turns although reservations make the ordinary ceilings eight/four.
6. **Stale telemetry.** Observed `stale=false` and `staleForMs` values could remain frozen, and active-session telemetry could disagree with gateway status.
7. **Incomplete consistency checking.** `debug trace --check` reported no issue despite a native terminal tail absent from Pibo.
8. **UI lifecycle ambiguity.** Final assistant text can coexist with a still-running turn, but the UI does not clearly distinguish a normal end-of-turn gate from pathological stale state.
9. **Evidence loss.** Raw notification method, view cursor, gap state, page lifecycle, and apply outcome are absent from the retained diagnostic record.

# Final-message delay analysis

Across the inspected Muse assistant messages for the day:

- 27 `assistant_message` events had 27 corresponding `message_finished` events;
- the maximum measured interval was 41.609 seconds; and
- no measured interval exceeded 60 seconds.

For the healthy control `ps_605…`, two intervals were 20.445 and 38.355 seconds. The corresponding native end-of-turn gates were 20.305 and 37.933 seconds. This tight correlation supports the intended interpretation: final content becomes visible before Muse completes its terminal gate.

The operator's roughly ten-minute observation remains important but cannot be assigned to the same root cause without the session identity. The validation plan therefore separates:

- backend content-to-terminal latency;
- backend-terminal-to-signal latency;
- signal-to-SSE delivery latency; and
- SSE-to-DOM/rendered status latency.

# Current work and data safety

The requested `ps_cde…` work was already durable before this report:

- implementation commits: `049a9304` and `10cc7b19`;
- merge commit: `f8bbc443` on `beta/4.0-plugin-system`; and
- the associated worktree was removed after merge.

This confirms that the misleading running state did not imply lost source changes. It does not lower the lifecycle severity: a future turn may have non-Git side effects, may block a user decision, or may exhaust capacity before its independent work can be verified.

# Required proof before choosing a fix

A fix should not be selected solely from this report. The next run must answer these questions:

1. Did a raw terminal notification reach the Pibo process?
2. If yes, did `session.apply` accept it immediately, buffer it behind a gap, reject it, or return I/O that never settled?
3. If no, did the host view projection stop, become unavailable, or lose its subscriber while the session log continued?
4. Was a `view/page` request outstanding, for which range, and for how long?
5. Could reconnect/resume or authoritative native-state reconciliation recover a missed terminal event?
6. Can kill settle Pibo and release capacity when native Muse says the turn is already processed?
7. Does a final-visible/running delay exist in durable backend state, projected signal state, SSE delivery, or only the rendered client?

The linked validation plan defines the instrumentation, fault injection, real-inference runs, pool soak, evidence bundle, and acceptance gates needed to answer them.

# Recommended priority

1. Add diagnostic visibility before attempting a behavioral fix.
2. Reproduce the SDK gap-fill hang deterministically without inference.
3. Prove bounded abort and lease release under the deterministic failure.
4. Run a low-cost real Muse baseline and controlled concurrency test.
5. Use the deployment pool for repeated real-inference and browser/SSE acceptance.
6. Only then choose between SDK page timeout/reconnect, host projection repair, Pibo terminal reconciliation, or a layered defense.

A layered defense is likely appropriate even if one root cause is proven: page requests need a bound, Pibo needs authoritative terminal reconciliation, abort needs a terminal fallback, capacity needs truthful visibility, and diagnostics must identify future divergence.

# Limitations

- No raw Muse notification capture was retained for the incident.
- No exact browser trace or session ID was supplied for the reported ten-minute UI observation.
- The installed SDK control flow demonstrates a possible deadlock but not its occurrence in these sessions.
- The post-incident `HEAD.json` status may describe a later projection condition rather than the first failing moment.
- The 27-message latency sample is a useful same-day control, not a statistical service-level guarantee.
- This report records analysis only; it does not claim Docker, deployment-pool, real-inference, browser, or fault-injection validation.
