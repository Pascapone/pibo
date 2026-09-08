---
type: "Validation Report"
title: "Isolated read models and bounded navigation: package F validation"
description: "Records the isolated read worker, resumable history and unread projections, bounded SSE and HTTP streaming, the startup sequence-repair index fix and the ten-million-event load evidence."
tags: ["performance", "read-models", "storage", "streaming"]
status: "stable"
authority: "evidentiary"
generated: { by: "qwen/qwen3.8-max", at: "2026-09-07T20:32:00Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/reports/performance-scalability-fgh-handoff-2026-09-07.md"
  - resource: "/reports/performance-scalability-telemetry-2026-09-07.md"
  - resource: "/reports/performance-scalability-capacity-2026-09-07.md"
---

# Candidate

Source `bf2db4c4` (branch `performance-reads`, stacked on package E `c01f4bb3`), isolated Docker worker `pibo-dev-performance-reads`, package SHA-256 `c5a9b7ddc0e38c3747b2ce3ba211a38b938f0a626658f85a183090a4f2ef851c` (version 1.7.2). The full build passed inside the worker. Packaging used the built files with explicit shrinkwrap prepare/clean and lifecycle hooks disabled. No host gateway was modified.

# Behavior and local evidence

Heavy trace, history and navigation reads now execute on a separate read-only worker connection with their own bounded queue, priorities and fairness keys; admission and output commits keep their existing storage worker. History pages, coverage and turn timings are served from indexed keyset queries, and a resumable bounded backfill maintains the history and unread projections; pause, resume and concurrent insert/update/delete merge without duplicate counts. Unread counts are a continuously maintained projection over committed events with a monotonic read marker; the pre-projection event-history scan remains only as the indexed fallback while a backfill is incomplete, which the updated contract test now pins explicitly. Session navigation for 10,000 sessions transfers through indexed 500-row pages instead of one unbounded worker message, and a revision clock lets cache hits skip trace reconstruction. Streaming bounds: the HTTP transport waits on socket backpressure instead of reading ahead, SSE client queues are bounded by bytes and age, and live deltas no longer trigger continuous history reloads. Bounded history pages pass full message payload references through to the trace view.

Local test evidence in the worker:

- The focused combined read/web/outbox selection passed 315 tests, including all six outbox process-crash boundaries, SSE replay, read-worker restart after failure, and slow or aborted HTTP streams.
- The full repository suite passed 2752 tests (0 failures) in the worker.
- A new schema regression pins the interrupted-repair scan to its bounded partial index and verifies that a simulated pre-atomic v7 crash (negative and NULL `session_sequence` values) still recovers on reopen.

# Startup deadline fix

The first ten-million-event attempt failed before any measurement: a request expired against the storage worker's 2,000 ms age limit while the worker was still opening the database. Root cause: every writable store open re-runs the schema maintenance block, whose interrupted-v7-repair candidate scan (`session_id IS NOT NULL AND (session_sequence IS NULL OR session_sequence <= 0)`) had no matching index and degraded into an effectively full `event_log` traversal at ten million rows. The fix adds the partial index `idx_event_log_sequence_repair_candidates` and pins the scan with `INDEXED BY`; on a healthy database the partial index is empty, so each open stays bounded. The benchmark now also separates worker startup (explicit readiness wait, reported as `startupMs`) from the measurement phase, keys admission idempotency per run, and retains failed fixtures for diagnosis.

# Read-model measurements

Synthetic owned fixtures in the isolated worker; ten hot sessions carry the history, 10,000 sessions exercise navigation. Scope: worker reads and concurrent durable admission with immediate fenced completion; no HTTP, browser, provider, cold-cache or sustained-rate claim. Failed attempts would be retained in the artifacts; both runs recorded zero errors.

One-million-event fixture recheck (50 samples, reused fixture): worker startup 114 ms; 50/50 admissions completed. Trace p95 8.8 ms, history p95 34.7 ms, coverage p95 49.0 ms, turn timings p95 66.3 ms, admission p95 17.9 ms; caller event-loop p99 23.3 ms.

Ten-million-event fixture (500 samples, fast bulk seed of 10,000,000 events in 457 s, final database 8.5 GiB):

| Operation (per sample) | p95 | p99 | max |
|---|---|---|---|
| Trace page, 100 events (1 M-event session history) | 6.0 ms | 7.4 ms | 87.3 ms |
| History page, 50 entries | 22.7 ms | 28.6 ms | 163.5 ms |
| History coverage | 36.3 ms | 45.9 ms | 179.9 ms |
| Turn-timing scan | 53.1 ms | 67.4 ms | 265.5 ms |
| Durable admission + fenced completion | 12.3 ms | 16.5 ms | 114.5 ms |
| Unread sweep, all 10,000 session ids | 46.8 ms | 178.9 ms | 178.9 ms |
| Full navigation walk, 20 × 500-row pages (4.42 MB) | 375.1 ms | 574.6 ms | 574.6 ms |

Worker startup on the ten-million-event database took 311 ms with both workers ready; the read worker completed 3,101 bounded operations with zero rejections, expiries or restarts. All 500 admitted durable commands completed through fenced claims. Caller event-loop delay was p99 17.4 ms / max 30.1 ms; process RSS grew from 316 MB to 419 MB inside the 2 GiB worker. The single-page server budgets of PERF-READ-001 (p95 ≤ 100 ms, p99 ≤ 250 ms) hold at ten times production history scale; the full navigation walk is a whole-portfolio aggregate (≈19–29 ms per 500-row page), not a single-page latency. These are warm owned-fixture measurements on a 6-vCPU worker, not integrated HTTP capacity claims.

# Retention and boundary evidence under large history

Product history retention under the new read models is pinned deterministically: the backfill merges concurrent inserts, updates and deletes without duplicate counts; deleting an event removes its unread projection row; bounded history pages keep full-text payload references resolvable in the trace view; and read-worker restart resumes from persisted watermarks. The ten-million-event run exercised reads and durable admissions concurrently against the same 1 M-event session histories with zero lost or rejected commands. Telemetry retention, pruning, backup and archive bounds are package G scope and are not claimed here.

# Remote acceptance

Isolated deployment-pool lease `lease_ae3891d2a08828b8f1` on slot-01 (`https://slot-01.pool.pibo2.neuralnexus.me/`), seed mode `medium`, holder `ps_c14df867-a054-495c-bfe6-4637238f4245`, acquired 2026-09-07T20:16:59Z and released 2026-09-07T20:30Z (pool returned to 0/3 active). The exact checksum-addressed candidate (version 1.7.2, commit `bf2db4c4`, SHA-256 `c5a9b7dd…ef851c`) was installed into the slot by the pool; no source was edited on Pibo2 and the canonical gateway was untouched. Machine Auth (header credential exchanged for a host-only cookie, provider `machine-key`) authenticated every API and browser step. All timings below are wall-clock from the controller over the public DNS/TLS/nginx path.

- **Target:** pool `doctor` ok; lease `ready`; `/api/health` 200 `{"status":"ok"}` (66 ms incl. DNS+TLS), `/health` 200 `mode:main` (32 ms).
- **API (authenticated):** bootstrap 200, 588 KB (ttfb 591 ms first call); rooms 200, 22 KB (41 ms); sessions 200, 28 KB (52 ms); `trace` 200 (61 ms, `trace_cache;desc="miss"`, `x-pibo-trace-version 8d30fb05…`), repeat 200 (42 ms, `trace_cache;desc="watermark-hit"`), conditional `If-None-Match` → **304** (38 ms, 0 B) proving the revision-clock cache skips reconstruction; `trace/timeline` 200 (54 ms); `trace/summary` 200 (42 ms); `message-receipts` 200; SSE `events` 200; `status` and `signals/events` 200. Trace p95-equivalent single calls stayed far below the PERF-READ-001 p95 ≤ 100 ms budget.
- **Composer + duplicates:** POST `/api/chat/message` with `clientTxnId acc-f-…` durably appended `user.message.accepted` (streamId 987973) then returned a graceful 409 because the seeded session has no live `pi` runtime (seed artifact, not a defect); a second POST with the same `clientTxnId` returned 200 `{"duplicate":true,"event":…}` echoing the original event, i.e. no second durable event. This exercises the durable admission write path and clientTxnId deduplication without consuming provider quota.
- **Browser (headful):** remote non-headless Chrome/Xvfb (display `:99`, reaper-exempt) behind a loopback-only SSH CDP tunnel (local 9223); authenticated against slot-01. `chat-shell` render snapshot `state=ready` with composer textarea (`composer-input`, role textbox), terminal usage status, and `compact-terminal-session-view` rows including a `terminal-row:event:message_queued:…` user-message row (the package-F `terminalRows` path) over a virtualized history list. After reload the shell reached `state=complete` in 3.5 s and the durably accepted composer probe message rendered as a terminal row (`hasProbeText: true`, row count 2→4), closing the write→read→render loop; the graceful runtime-missing failure rendered as a structured Session Error row, not a crash. Screenshot: `artifacts/performance-scalability-reads-20260907/pibo2-slot01-composer-terminal.png`.
- **Expected non-F noise (documented, not regressions):** `/api/previews/events` 503 (the optional preview server is not running inside a pool slot) and `…/fork-candidates` 500 with `native session … is missing from runtime instance "pi"` (the medium seed copies Pibo session/history records but no live pi runtime state; the same condition shows as the `pi · missing` badge). Both are handled gracefully with clean JSON and do not involve the read models.

Browser stopped and lease released after the run; pool back to 0/3 active, 10 free.

Artifacts are under `artifacts/performance-scalability-reads-20260907/`.
