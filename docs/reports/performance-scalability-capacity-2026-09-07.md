---
type: "Validation Report"
title: "Fair admission and runtime capacity: package D validation"
description: "Records capacity bounds, room fairness, runtime-control checks and exact-candidate acceptance evidence."
tags: ["performance", "runtime", "capacity"]
status: "stable"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-07T09:45:00Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/specs/runtime/capacity-and-scheduling.md"
  - resource: "/reports/performance-scalability-commands-2026-09-07.md"
---

# Candidate and contract

Commit `e52bd62f86953da2fc316c22b6de55a0c70233a4`, Docker worker `pibo-dev-performance-capacity`, implements the [capacity contract](/specs/runtime/capacity-and-scheduling.md) on top of package C. Final archive SHA-256: `7c8e4414beb27a7f552f22595e305e1519b1c4bcd6d576fb8d5d052cf0973032`. The full build passed; packaging reused those built files with the repository's shrinkwrap prepare/clean steps and npm lifecycle hooks disabled to avoid rebuilding an unchanged candidate.

# Local validation

The combined storage/runtime/schema/Web run passed 236 of 237 checks. Its one failure was a persistence-dependent test that emitted output and immediately read product history. The fixture now awaits the explicit output drain. The final 144-test Web/outbox/telemetry run passed, including all six real-process outbox crash boundaries. The other combined-suite checks remained unchanged and passed. New regressions cover global claims across owners, Room rotation, byte/age rejection, Steering reserve, fenced queue cancellation, pending receipt visibility, cold-start ramps through 20 Sessions, idle generation eviction, provider/nested reservations and abort before cold-start settlement.

The first large synthetic fixture omitted historical Session sequence numbers and consequently exercised startup sequence repair rather than admission. It was discarded. The corrected fixture includes valid sequence numbers; this correction is not a claim that migration repair has become bounded.

An initial scheduler retained Room rotation only while its queue was populated. A million-event, 10,000-message two-Session run measured quiet p95 10.83 ms and a 2.41 ratio to its quiet baseline, failing the plan's relative fairness target despite low absolute latency. The correction keeps bounded Room history across bursts and collects an idle admission burst for one millisecond before selection. Control work bypasses the window. A subsequent two-Session run still missed the relative target (2.18). The longer run exposed a missing FIFO predecessor index: SQLite scanned completed commands of the Session through the recent-history index. A covering Session/state/stream/delivery index now bounds that predecessor lookup by eligible state. The actual claim query plan is regression-tested. The final dispatcher/index/Web/outbox suite passed 162 checks, including all six real-process crash boundaries and the separate lease cadence. Final ramp artifacts follow below.

# Final storage ramp

The ramp used source `878dafbadfb31ec0099216651a7908ba3a22f199`; the final candidate only changes propagation of queue-clear counts, not admission or scheduling. Each run used one million valid historical events, 10,000 admission attempts, 1 KiB text and the same bounded worker. The quiet baseline has 100 sequential samples. Main admission p95 and relative quiet p95 passed the specified thresholds in this synthetic scope; no attempt was rejected and every accepted command reached fenced completion. These are distributions, not an integrated sustained-rate capacity declaration.

| Sessions | Accepted | Rejected | Admission p95 ms | Admission p99 ms | Quiet p95 ms | Quiet/baseline p95 | Caller loop p99 ms |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 10000 | 0 | 5.86 | 8.67 | 5.86 | 1.12 | 11.33 |
| 2 | 10000 | 0 | 10.16 | 15.11 | 12.18 | 1.91 | 11.34 |
| 5 | 10000 | 0 | 24.23 | 40.05 | 8.24 | 1.32 | 18.64 |
| 10 | 10000 | 0 | 38.81 | 59.80 | 7.79 | 1.40 | 11.48 |
| 20 | 10000 | 0 | 79.58 | 115.75 | 6.51 | 1.07 | 11.40 |

Artifacts: `artifacts/performance-scalability-capacity-20260907/final/`. Earlier failed measurements remain under `initial/` and `before-index/`.

# Measurement boundary

`scripts/performance-capacity-benchmark.mjs` creates an isolated synthetic database, invokes the actual storage worker's durable admission and fenced completion operations, and removes only its own fixture. It reports admission distributions, quiet/baseline comparison, explicit rejection, caller event-loop delay, memory and IPC pressure. Immediate simulated completion does not measure a provider, browser, HTTP path, configured message rate or integrated soak.

`scripts/performance-runtime-capacity-benchmark.mjs` rotates real Pi SDK instances with empty native histories, without model requests or forced GC. Its memory observations apply to that activation/eviction fixture only.

# Runtime resource lifetime

A three-cycle real-Pi probe (60 activations, pool limit eight, empty histories, no model requests) kept the active pool within eight, measured caller-loop p99 30.10 ms / maximum 36.60 ms, and disposed all runtimes. RSS still rose through those cycles, so it was not treated as a plateau.

The follow-up extended to ten cycles / 200 activations without forced GC. Cycle-end RSS in the last four cycles was 310.50, 310.63, 311.00 and 312.25 MiB; heap usage oscillated with ordinary GC. Active runtimes remained at most eight and fell to zero after disposal. This is a short activation/eviction plateau for the stated fixture, not a long-running streamed-history memory guarantee. The follow-up ran beside compilation in a separate Docker worker; its timing values are not used for the latency claim.

# Remote acceptance

The first candidate `878dafbadfb31ec0099216651a7908ba3a22f199` was installed in a full-seed isolated Pibo2 lease and exercised through HTTPS/Machine Auth and the real headful browser. A pending command was cancelled while its predecessor ran; provider reservations were empty during a running direct `sleep 45` tool. The first unconstrained model attempt requested a yielded tool, which the pool explicitly refused because systemd isolation was unavailable; a second direct-tool fixture avoided that unrelated path.

The browser exposed a real discrepancy: HTTP reported `cleared: 1` while the persisted execution output still said `0`. The final source propagates the already-cleared ingress count into execution before output emission, for both inactive and active runtimes. Its 155-test routed-runtime/Web/dispatcher run passed, including a regression comparing returned and emitted totals. The first lease was released at 10:24:41 UTC. Final candidate `e52bd62f86953da2fc316c22b6de55a0c70233a4` passed in a new full-seed lease. A real headful Composer click received HTTP 202 in 174.3 ms (server ACK 138.43 ms); these single cold observations are not percentile estimates. The waiting command received 202, then `clear_queue` completed in 21.5 ms and cancelled exactly one unstarted command. Both HTTP and persisted browser output show `cleared: 1`. Provider reservations were empty while the real direct tool ran.

The first command and a later command after clearing each completed once. The cancelled command never produced its requested answer. Desktop reload and a 390 × 844 headful view preserved two completed receipts, one failed/cancelled receipt, both final answers and the correct clear count. Twenty identical retries resolved the same cancelled receipt without dispatch; changed content returned 409. Browser health checks passed 300/300 with p95 7.9 ms, p99 9.4 ms and maximum 15.5 ms. The lease was released at 10:34:36 UTC. Exact inputs/results and screenshots are in `artifacts/performance-scalability-capacity-20260907/final/capacity-pibo2.json` and adjacent PNGs. The global integrated load, full-history/large-payload read paths, retention and two-hour soak remain open in E–H. No controller gateway deployment or production cleanup is part of this work.
