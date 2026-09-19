---
type: "Plan"
title: "Muse-native session settlement Docker and deployment-pool validation"
description: "Defines a falsifiable Docker, real-inference, deployment-pool, and browser validation program for Muse-native settlement failures."
tags: ["muse-native", "validation", "docker", "deployment-pool", "session-lifecycle"]
status: "draft"
authority: "directive"
generated:
  by: "openai/codex"
  at: "2026-09-19T15:24:46Z"
sources:
  - id: "incident-investigation"
    resource: "/reports/muse-native-session-settlement-investigation-2026-09-19.md"
    title: "Muse-native session settlement investigation"
  - id: "muse-adapter-spec"
    resource: "/specs/runtime/muse-native-adapter.md"
    title: "Muse-native adapter"
  - id: "deployment-pool-spec"
    resource: "/specs/compute/deployment-pool.md"
    title: "Isolated Deployment Pool"
  - id: "capacity-control"
    resource: "scope:repository source src/core/runtime-capacity.ts at the investigated checkout"
    title: "Provider runtime-capacity controller"
  - id: "muse-turn-adapter"
    resource: "scope:repository source src/agent-runtimes/muse-native/turn.ts at the investigated checkout"
    title: "Muse-native turn lifecycle adapter"
  - id: "muse-session-pump"
    resource: "scope:repository source src/agent-runtimes/muse-native/sessions.ts at the investigated checkout"
    title: "Muse-native connection and session routing"
---

# Objective

Determine which layer loses Muse-native terminal settlement, reproduce each credible failure mode under controlled conditions, validate bounded recovery and capacity release, and prove the full user-visible lifecycle in an isolated Pibo instance using real inference and the isolated deployment pool.

“Headpool” in the operator request is treated here as Pibo's implemented isolated deployment pool, exposed by `pibo compute pool`. If the execution environment uses an additional headpool wrapper, the executor must record that wrapper and map it to the same lease, artifact, seed, isolation, and cleanup requirements rather than silently substituting a different shared gateway.

The plan deliberately begins with deterministic fault injection. Real inference is authorized for this validation, but it is used only after the instrumentation can explain a failure and with explicit run, time, and cost bounds.

# Success criteria

The validation is complete only when all of the following are true:

- every terminal native turn causes a bounded Pibo terminal outcome, even when one notification path is lost;
- a raw trace identifies whether terminal notification was absent, buffered, rejected, or applied;
- diagnostics distinguish persistent Muse process liveness, native turn completion, view-projection availability, and Pibo routed-turn settlement as four separate states;
- no provider-capacity lease remains held beyond the documented grace period after native completion, abort, host death, or Pibo terminal settlement;
- kill/abort settles a stuck prompt within a bounded duration and releases its capacity exactly once;
- configured capacity, reserved capacity, active usage, waiting work, and rejection cause are observable and agree across CLI, telemetry, and UI;
- `assistant_message`, native terminal, Pibo `message_finished`, signal revision, SSE delivery, and rendered status are timestamped separately;
- a backend-terminal session cannot remain rendered as running beyond one reconnect/reconciliation interval;
- consistency diagnostics flag a native-terminal/Pibo-running divergence;
- deterministic tests pass before real-provider testing, and real-provider testing passes before a candidate is proposed for merge; and
- the evidence bundle contains enough identifiers and timestamps for a second agent to reproduce every conclusion.

# Safety and isolation contract

1. Perform source edits, builds, gateways, tests, and browser validation only in a fresh `pibo compute dev spawn` worktree/container.
2. Never start, stop, or restart the host production gateway for this plan. Use only the isolated dev gateway or a deployment-pool lease.
3. Use a unique `PIBO_HOME`, workspace, provider state, ports, and evidence directory for every run. Do not reuse the operator's incident home.
4. Discover commands progressively before mutation:

   ```text
   npm run dev -- debug session --help
   pibo compute --help
   pibo compute pool --help
   pibo compute pool acquire --help
   ```

5. Acquire a pool slot with a unique holder, exact candidate artifact or runtime, explicit seed mode, commit metadata, and finite TTL. Record the returned lease ID, slot, URL, expiry, artifact digest, and release command.
6. Prefer `fresh` seed for fault injection and synthetic concurrency. Use `medium` only if real Muse authentication/configuration requires it. Pool seed policy must not copy OAuth credentials; authenticate the isolated runtime through the approved operator flow if required.
7. Put a hard ceiling on real inference before starting: maximum turns, maximum wall time, model, reasoning level, and an operator-approved cost budget. The recommended first pass is 12 short turns, 30 minutes, and the cheapest representative Muse model/configuration that exercises the same view protocol.
8. Redact prompt/assistant content, tokens, credentials, headers, cookies, and environment secrets. Retain event names, IDs, cursors, timestamps, durations, status, and bounded error classifications.
9. Stop the phase if costs exceed the cap, the isolated runtime affects a host gateway, pool isolation cannot be proven, auth would need to be copied unsafely, or evidence timestamps cannot be correlated.
10. Release the deployment-pool lease with the matching holder and release the dev container after evidence capture. Keep the Git worktree until its commit is merged or explicitly rejected.

# Candidate identity record

Create one immutable header before testing:

```yaml
run_id: <UTC timestamp plus short random suffix>
source_commit: <40-character Git commit>
working_tree_clean: true|false
candidate_artifact_sha256: <sha256>
pibo_version: <version>
muse_sdk_version: <exact version; incident inspection used 1.3.0>
muse_binary_version: <version>
node_version: <version>
docker_image_id: <id>
pool_lease_id: <id or null>
pool_slot_id: <id or null>
seed_mode: fresh|medium
provider: <provider id>
model: <model id>
reasoning: <setting>
capacity_global_configured: <integer>
capacity_room_configured: <integer>
real_inference_turn_cap: <integer>
real_inference_wall_clock_cap_minutes: <integer>
real_inference_cost_cap: <currency and amount>
```

Any code change after this record creates a new candidate and a new run ID. Do not append results from different commits under one identity.

# Required instrumentation

Implement or temporarily inject structured, redacted instrumentation before attempting real reproduction. Every record needs `run_id`, monotonic time, wall-clock UTC, Pibo session ID, native session ID, turn ID when known, process identity, and sequence number.

## Muse transport and view projection

Record:

- every incoming raw notification method and its cursor/range metadata before SDK application;
- every `view/gap` with expected and received positions;
- `view/page` request start, requested range, success/error/timeout, duration, and returned item count;
- GapFiller transition into/out of filling and current buffer depth;
- connection close/reconnect/resume and host process liveness;
- native log observation of final assistant item and terminal turn state; and
- `.msp-view-v1` `HEAD.json` status changes, `source_through.sequence`, view ordinal, and the delta to the authoritative native terminal sequence.

If the SDK does not expose these fields, use a pinned local instrumentation patch or protocol proxy for the experiment. Do not make private internals part of the production contract merely to obtain one trace.

## Pibo adapter and routed lifecycle

Record:

- `Session.apply` method, synchronous outcome, returned I/O presence, I/O settlement, error, and duration;
- `Session.onGapError` invocation and classification;
- `turn.completed` settlement source and time;
- each idle-window expiry and liveness-probe result;
- interrupt request, native response such as `already_processed`, and local completion result;
- routed prompt start/end/throw;
- persistent Muse server process identity and liveness without treating process liveness as proof that a native turn remains active;
- provider lease request, queue, acquire, release, and active/waiting counts; and
- emitted `message_queued`, `message_started`, `assistant_message`, `message_finished`, and `session_error` events.

## Signals, SSE, and browser

Record:

- durable event-store timestamp and sequence;
- signal projection revision, status, active tree, and patch;
- SSE connect, disconnect, retry, last-event ID if present, patch receipt, and reconciliation fetch;
- document visibility and `pageshow`/resume transitions; and
- DOM timestamp for final assistant content and each rendered status change.

Use a headful authenticated browser for UI acceptance. CDP network/console/DOM evidence should accompany screenshots; screenshots alone cannot locate the layer.

# Evidence bundle

Write raw evidence outside Git first, under one run-specific directory such as `/tmp/pibo-muse-settlement/<run_id>/`. Include:

```text
identity.yaml
commands.log
environment-redacted.txt
events.ndjson
muse-transport.ndjson
native-turn-terminal.ndjson
view-gap-pages.ndjson
view-head.json
adapter-lifecycle.ndjson
capacity.ndjson
signals.ndjson
sse.ndjson
browser-console.json
browser-network.json
screenshots/
test-results/
summary.md
checksums.sha256
```

`commands.log` must contain commands and exit codes, not secrets. Generate `checksums.sha256` after redaction. Promote only a bounded, sanitized summary or deliberately approved fixtures into `docs/reports/`; do not commit raw model content, browser storage, credentials, or oversized logs.

# Incident-derived acceptance fixture

Use the later failed turn in `ps_60529962-a178-4b83-a5c1-d9b699ce791b`, native session `01a0b98a-dea2-7141-b2b8-8f0b956bfbed`, as the concrete shape that deterministic fixtures must reproduce without importing its private transcript content:

- Pibo accepted the turn at 14:57:11 UTC and stopped persisting output after a successful 232.6 ms shell call at 15:06:39 UTC.
- Native Muse continued, committed a final assistant response at 15:14:16 UTC, reported `stream_succeeded` and `model_completed`, and emitted `terminal: completed` with `reason: null` at 15:14:53 UTC.
- The native turn duration was 1,060,260 ms and its end-of-turn gate was 36,575 ms; neither value explains the missing Pibo tail.
- The current view head became `status: unavailable` at `source_through.sequence: 15791` and `head_view_ordinal: 2500`, while the native transcript reached terminal sequence 17677.
- Pibo retained `processing=true`, `streaming=true`, and a running durable queue row, with no new assistant message or terminal lifecycle event in product history.
- The persistent Muse server process remained alive and idle after the native terminal. The process did not die, and the native turn did not remain active.

The 1,886-record difference is an incident fact, not a required reproduction size. Likewise, `head_view_ordinal: 2500` is not a presumed universal threshold because other unavailable views were observed at different ordinals. A valid fixture reproduces the state divergence, not these incidental counts.

# Phase gates

| Phase | Work | Gate to proceed |
|---|---|---|
| A | Baseline, instrumentation, clock correlation | A healthy turn is explainable end to end and all required timestamps share one run ID. |
| B | Deterministic protocol and lifecycle fault injection | Gap/page, missing terminal, abort, and capacity behavior are reproducible without inference. |
| C | Isolated real Muse inference | Short and tool-using turns settle; instrumentation is complete and cost bounds hold. |
| D | Deployment-pool concurrency soak | Capacity/reservations behave as specified and no completed turn strands a lease. |
| E | Headful browser/SSE validation | Rendered state converges from all tested visibility/reconnect conditions. |
| F | Candidate fix and regression | Root-cause discriminator is proven, defenses pass, full relevant regression is green, and evidence is reviewed. |

Do not skip Phase B because a real run happens to pass. A non-reproduction without injected failure does not validate recovery.

# Test matrix

## T0 — Healthy end-to-end baseline

**Setup:** Fresh isolated home, one room, one Muse-native session, configured 10/5 capacity, full instrumentation. Run at least five short deterministic prompts and one bounded tool prompt.

**Capture:** Raw notifications, native final/terminal, apply outcome, Pibo lifecycle events, lease lifecycle, signal revisions, and browser status.

**Expected:** Every turn produces one started and one terminal Pibo outcome. Every acquired lease releases once. No gap remains filling. Debug and telemetry agree.

**Failure meaning:** Fix baseline instrumentation or general lifecycle defects before fault injection.

## T1 — Final content versus end-of-turn gate

**Setup:** Repeat healthy turns that produce a final message and exercise Muse's end-of-turn gate.

**Stimulus:** Record `assistant_message`, native `eot_gate_ms`, native terminal, `message_finished`, SSE receipt, and DOM status.

**Expected:** Content may precede lifecycle completion. The measured content-to-terminal interval should correlate with `eot_gate_ms`; backend-terminal-to-rendered-idle must remain within the explicit UI reconciliation bound.

**Failure meaning:** A delay before native terminal belongs to Muse gate behavior; a delay after Pibo terminal belongs to signal/SSE/UI; a native terminal absent from Pibo belongs to transport/view/adapter.

Do not turn the incident sample's 41.609-second maximum into a universal SLA. Use it as a baseline comparison and publish the new distribution.

## T2 — Capacity semantics at configured 10/5

**Setup:** Same provider and room, ordinary top-level prompts held at a deterministic barrier. Verify configured global ten and room five.

**Stimulus:** Acquire four ordinary room turns, submit a fifth ordinary turn, then submit the supported nested/reserved workload if available. Release one ordinary barrier.

**Expected:** Four ordinary turns run; the fifth is queued because one room slot is reserved. Reserved work can use its protected admission according to policy. Releasing one lease starts the waiter without altering existing turns. Metrics show configured, reserved, usable, active, and waiting counts.

**Failure meaning:** Admission accounting or documentation/UI wording is incorrect. A queued message must not be mislabeled as a started runtime turn.

Repeat across rooms to verify the provider-global ordinary ceiling of eight under 10 configured with two reserved.

## T3 — Stuck prompt creates a capacity cascade

**Setup:** Fake or instrumented runtime whose prompts can finish natively while withholding Pibo terminal settlement.

**Stimulus:** Hold four affected turns in one room and submit another ordinary turn. Then release/reconcile one affected turn.

**Expected current behavior:** The waiter times out or waits according to configured admission policy while stuck prompts retain leases.

**Expected candidate behavior:** Reconciliation or bounded failure releases leases; waiting work either starts or receives one explicit terminal error. Existing turns are never canceled or mutated merely because capacity is full.

**Failure meaning:** Demonstrates or disproves the proposed capacity-amplification chain.

## T4 — Hung `view/page` during gap recovery

**Setup:** Deterministic fake MSP host or protocol proxy. It must emit an initial valid sequence, then `view/gap`, accept `view/page`, and deliberately never resolve that request while continuing to emit assistant and terminal frames.

**Stimulus:** Observe SDK and Pibo for longer than the proposed page bound, then trigger abort.

**Expected current behavior to confirm:** GapFiller enters filling, later frames accumulate, `turn.completed` does not settle, and host liveness probes can still succeed.

**Required candidate result:** The page request times out or reconnects within a documented bound, buffered frames are safely reconciled or an explicit terminal error is emitted, abort settles, and capacity releases.

**Failure meaning:** If raw terminal arrives but remains buffered, the SDK/gap path is causal. If Pibo receives and applies it, investigate later adapter/routing state instead.

## T5 — Explicit `view/page` error and unavailable view

**Setup:** Same harness as T4, but reject `view/page` and separately return an unavailable/stale projection response.

**Stimulus:** Continue live frames after the error.

**Expected:** `onGapError` is surfaced with session/range context, no exception is silently swallowed, buffer state exits deterministically, and Pibo reaches one explicit terminal outcome or reconnect path.

**Failure meaning:** Error propagation and recovery are incomplete even when the page request does not hang.

## T6 — Real host view-projection loss

**Setup:** Isolated real Muse host with a supported diagnostic/fault mechanism. Do not corrupt an operator session. If no supported mechanism exists, retain T4/T5 as deterministic proof and mark this test blocked rather than editing live state blindly.

**Stimulus:** Make the session log continue while its view projection becomes unavailable or stops notifying.

**Expected:** Raw host evidence identifies the projection transition. Pibo reconnects/reconciles or terminates within the bound and releases capacity. The trace must show the last healthy view source sequence, the first unavailable observation, the authoritative native final and terminal sequences, and whether the persistent Muse process remained alive.

**Failure meaning:** Distinguishes host-side notification absence from SDK-side buffering. The `ps_605…` incident is a real post-hoc example of this test's failure shape, but it is not a passing execution because raw transport and gap/page evidence were not enabled at the time.

## T7 — Missed terminal replay and authoritative reconciliation

**Setup:** Native log contains final and terminal state; Pibo adapter has intentionally missed the final and terminal notification. Include one fixture whose view head is unavailable while the persistent Muse server stays alive, matching the `ps_605…` divergence.

**Stimulus:** Exercise reconnect, session resume, status query, and interrupt returning `already_processed` as separate cases.

**Expected:** At least one documented authoritative path recovers terminal state idempotently. It must settle from authoritative native turn state even when process liveness is healthy and the view head is unavailable. Repeated recovery must not duplicate assistant content, tool results, `message_finished`, or lease release.

**Failure meaning:** Pibo depends exclusively on one ephemeral terminal notification and needs an authoritative reconciliation contract.

## T8 — Kill during a stuck view or completed native turn

**Setup:** T4 state and a second case where native terminal already exists but Pibo remains running.

**Stimulus:** Invoke the normal Pibo kill/abort surface once, then repeat it after settlement.

**Expected:** First request reaches a terminal Pibo state within the bound, retains the native response classification, and releases capacity. The repeated request is idempotent. No 90-minute wait is required.

**Failure meaning:** Abort remains coupled to the missing event rather than acting as a local lifecycle boundary with reconciliation.

## T9 — Silence-window watchdog

**Setup:** Parameterized test-only silence window; do not wait 90 real minutes for the deterministic suite. Cover responsive and unresponsive hosts.

**Stimulus:** Withhold activity through three shortened windows, then emit activity just before a boundary in another case.

**Expected:** Responsive-host retries and unresponsive-host fast failure match contract; activity resets the window; final failure releases capacity once and reports total silence accurately.

**Real check:** One optional, explicitly budgeted run may exercise production durations only if needed. It is not required to establish the arithmetic.

## T10 — UI/SSE final-visible while running

**Setup:** Headful authenticated browser attached to the isolated gateway. Capture CDP network, console, DOM, visibility, signal revisions, and durable events.

**Stimulus:** Cover normal end-of-turn gate, background/foreground transition, EventSource disconnect/reconnect, missed patch followed by reconciliation, page reload, and browser `pageshow`.

**Expected:** The UI may show an explicit finishing state after final content, but once backend `message_finished` exists it converges to idle within one reconnect/reconciliation interval. No ten-minute stale running badge is acceptable. Console/network failures are zero or explained.

**Failure meaning:**

- DB terminal but signal running: projector/status bug.
- Signal idle but no SSE patch: subscription/version/reconnect bug.
- SSE idle patch received but DOM running: client state/render bug.
- No backend terminal: return to transport/view/adapter tests.

## T11 — Real-inference deployment-pool soak

**Setup:** Build the exact candidate, acquire one deployment-pool lease with finite TTL and fresh/approved seed, start the candidate through the pool contract, and attach full instrumentation. Use a unique holder and save the exact release command.

**Workload:** Run bounded waves:

1. sequential short prompts in one session;
2. parallel short prompts across rooms;
3. four ordinary prompts in one room plus one waiting prompt;
4. up to eight ordinary prompts across rooms under configured 10/5;
5. a mix of short, tool-using, and intentionally delayed turns; and
6. browser observation during at least one wave.

Start with 12 total real turns. Expand only after reviewing cost, error rate, and evidence completeness. Do not exceed the recorded cap.

**Expected:** All native-terminal turns settle in Pibo, no gap/page operation remains unresolved, capacity counts return to zero, waiters start in order permitted by policy, and the browser converges.

**Failure meaning:** Preserve the entire failing run before restart. Classify it with the decision tree below; do not rerun until the evidence gap is understood.

## T12 — Isolated gateway restart and recovery

**Setup:** Dev container or leased pool slot only. Create active, queued, and completed-but-unreconciled fixtures.

**Stimulus:** Restart through the Pibo CLI for that isolated gateway. Never use process killing as the operator path.

**Expected:** Durable terminal state remains terminal, active work follows the documented recovery/error contract, queued admission is settled, no lease remains orphaned, and diagnostics explain every recovery decision.

**Failure meaning:** Startup reconstruction introduces a second path for stuck state or lease leakage.

## T13 — Telemetry and consistency diagnostics

**Setup:** Healthy, queued, artificially stale, missed-terminal, and released fixtures.

**Stimulus:** Run session debug help/discovery, focused session inspection, telemetry active listing, gateway status, and trace consistency checking.

**Expected:** `staleForMs` advances with time; stale classification changes at the threshold; active counts agree; queued and running are distinct; native-terminal/Pibo-running divergence is reported as an issue with actionable Pibo session, native session, turn, native terminal sequence, view source sequence, and queue-row IDs. A live Muse server must not suppress the divergence warning.

**Failure meaning:** Operational tooling can still pronounce the system healthy while user-visible state is wrong.

# Root-cause decision tree

Use this order for every failure:

0. **What are the independent lifecycle facts?**
   - Record persistent Muse process liveness, authoritative native turn state, view-head state, and Pibo routed-turn state separately.
   - A live process plus a native terminal plus Pibo running is a settlement divergence, not an active native turn.
1. **Does the raw Pibo-process transport trace contain the native terminal notification?**
   - No: inspect host view log and `HEAD.json`. If native log is terminal but view emits nothing, classify host projection/subscription loss.
   - Yes: continue.
2. **Was GapFiller filling or a `view/page` request outstanding when terminal arrived?**
   - Yes: classify SDK gap/page buffering and record range, duration, and buffer depth.
   - No: continue.
3. **Did `Session.apply` accept the terminal, and did returned I/O settle?**
   - No or error: classify SDK application/routing error.
   - Yes: continue.
4. **Did `turn.completed` settle?**
   - No: classify SDK turn-handle correlation/completion defect.
   - Yes: continue.
5. **Did Pibo emit/store `message_finished` or `session_error` and release capacity?**
   - No: classify adapter/routed-session lifecycle defect.
   - Yes: continue.
6. **Did projected signal state become idle/error?**
   - No: classify projector/status defect.
   - Yes: continue.
7. **Did the browser receive the signal revision and render it?**
   - No receipt: classify SSE/reconciliation defect.
   - Receipt but no render: classify client state/render defect.

Separately, a message with `message_queued`, no `message_started`, and a capacity deadline is an admission failure. It is not evidence that its runtime broke an existing turn.

# Candidate behavioral requirements

The executor may implement a fix only after instrumentation identifies the failing layer. Any candidate must preserve these invariants:

- native frames remain ordered and deduplicated across page fill and live delivery;
- timeout/reconnect never silently drops buffered terminal state;
- Pibo emits at most one terminal lifecycle event per turn;
- abort is bounded even when native state is already terminal or the view is unavailable;
- capacity release is idempotent and follows local terminal settlement;
- ordinary capacity never consumes the protected nested reserve;
- reaching capacity does not cancel or mutate admitted turns;
- queued messages remain visibly queued until `message_started`;
- UI final-content and lifecycle state are separate but clearly labeled;
- raw diagnostics are bounded and redact content/secrets; and
- reconnect/reconciliation does not duplicate messages or tool results.
- process liveness is never used as a substitute for authoritative native turn state, and a live idle Muse server cannot keep a terminal native turn classified as active in Pibo.

Likely layered defenses to evaluate are an explicit `view/page` deadline, gap-error handling, bounded reconnect/resume, authoritative terminal reconciliation, local abort settlement, lease-release safeguards, dynamic telemetry, and a signal/SSE convergence check. This list is not a predetermined implementation decision.

# Regression scope

At minimum, run in the isolated container:

- focused Muse-native adapter tests;
- connection/gap/page fault-injection tests;
- routed-session abort and capacity tests;
- signal projector/status and ingest tests;
- debug trace and telemetry tests;
- typecheck and build for touched packages;
- the relevant serial integration suite; and
- headful browser acceptance for desktop and a narrow/mobile viewport if rendered status behavior changes.

Run repository commands from their documented surfaces; discover exact test names from the current tree instead of copying stale command lines. Record every command, exit code, duration, and skipped test. A skipped root-cause test does not count as acceptance.

# Stop, preserve, and escalate conditions

Stop the active workload and preserve evidence when:

- any native turn is terminal for more than the proposed settlement bound;
- a gap/page operation exceeds its bound;
- capacity remains nonzero after all native turns are terminal;
- the pool lease approaches expiry without enough time for clean capture and release;
- real-inference cost or turn count reaches its cap;
- a browser shows running while backend and signal are terminal beyond one reconciliation interval; or
- isolation, authentication ownership, or secret redaction is uncertain.

Do not restart first. Capture identity, process liveness, authoritative native final/terminal sequence, current view-head status and source sequence, active leases, raw view/gap state, session debug output, durable events, signals, browser state, and checksums. Then use only the isolated Pibo CLI restart path if restart is part of the test.

# Result classification

Each test row in the final report must be one of:

- **pass** — expected behavior observed with linked evidence;
- **fail** — acceptance violated with preserved evidence;
- **blocked** — prerequisite unavailable, with the exact blocker and safe alternative attempted; or
- **not run** — deliberately outside the authorized budget or scope.

“Could not reproduce” is not a pass for recovery. It is a baseline result and must be paired with deterministic injection.

# Final handoff template

The validating agent must publish a Markdown validation report containing:

1. candidate identity and exact commit/artifact digest;
2. deployment-pool lease identity, seed mode, TTL, and confirmed release;
3. real-inference model, reasoning, turn count, wall time, and cost against cap;
4. a T0–T13 result table with evidence links;
5. the root-cause decision-tree path for every failure;
6. before/after timelines for Muse process state, native final, native terminal, view-head transition, Pibo terminal, lease release, signal, SSE, and DOM;
7. exact code changes and why evidence selected them;
8. tests/build/browser commands and outcomes;
9. known gaps and residual risks;
10. cleanup confirmation for containers, leases, temporary auth, and raw evidence; and
11. a recommendation: merge, revise, or reject.

The merge recommendation must remain **revise** unless the root-cause discriminator, bounded settlement, abort, capacity release, diagnostic consistency, real inference, and browser convergence all have direct evidence.

# Cleanup checklist

- Stop real-inference submission.
- Capture final capacity and session status.
- Verify no active provider leases remain in the candidate instance.
- Save and checksum the redacted evidence bundle.
- Release the deployment-pool lease with its recorded holder.
- Confirm pool status/doctor no longer reports the lease or dirty slot.
- Release the dev container through `pibo compute release <id>`.
- Keep the Git worktree until merge confirmation.
- Remove temporary credentials through the owning authentication flow.
- Record every retained artifact and its retention reason.
