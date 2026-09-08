---
type: "Validation Report"
title: "Isolated telemetry and output write budgets: package E validation"
description: "Records bounded diagnostic workers, output checkpoint reductions, contention measurements and exact candidate validation."
tags: ["performance", "telemetry", "storage"]
status: "stable"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-07T11:08:00Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/specs/data/telemetry.md"
  - resource: "/reports/performance-scalability-capacity-2026-09-07.md"
---

# Candidate

Source `2700e24d3f9597cc1467af67e09804983a115325`, isolated Docker worker `pibo-dev-performance-telemetry`, package SHA-256 `a85f1a2d210b14deb2a03247b583eca29bfcf3ce8cca9c50ec6b04a6c4725f87`. The full build passed. Packaging used the built files with explicit shrinkwrap prepare/clean and lifecycle hooks disabled. Two overlapping compiler invocations exhausted the 2 GiB worker limit; the subsequent single build and final 64-test regression passed. No host gateway was modified.

# Behavior and local evidence

File-backed diagnostics now execute as structured commands on a separate SQLite worker. Count, bytes, age and batch budgets include in-flight work; queue pressure never drains SQL on the producer. Progress leaves capacity for other diagnostic records. SQLite retains FULL synchronization and foreign keys. Optional diagnostics can expire or fail with explicit counters; durable product outputs retain their existing outbox, claim, receipt and replay ownership. Worker restart requires actual exit of its predecessor and is throttled. In-memory test compatibility remains asynchronous.

The earlier broad build/Web/telemetry/outbox run passed 193 tests. After removing redundant checkpoints, 140 Web/outbox/retry tests passed, including all six process-crash boundaries. The final 64-test run covers runtime/provider/store diagnostics, worker contention/expiry/restart, phase query plans, output write budgets and all six outbox crash boundaries.

# Contention measurements

All fixtures are private synthetic databases, ten Sessions, nine noisy and one quiet, offered 500 diagnostic deltas/s, 100 semantic outputs/s and five durable admissions/s. Commands complete immediately through fenced storage operations; no provider, HTTP, browser, output-retry orchestration or integrated capacity claim is made. Results retain rejected attempts. Payloads are repeated synthetic text; these are warm fresh-store measurements, not historical cold runs.

Early measurements omitted the diagnostic copies of semantic outputs and provider lifecycle. Their artifacts remain explicitly partial-scope: 60 seconds at 1 KiB passed 299 admissions and 5,999 outputs; 30 seconds at 64 KiB passed 149 admissions and 2,998 outputs. At 1 MiB for every output, 474 of 999 outputs were stored and 525 explicitly rejected with storage_overloaded; all 49 admissions completed. This is an overload boundary, not a passing large-payload profile.

The first complete diagnostic workload failed: 8,495 diagnostic records failed and 301 were rejected after the worker deadline closed its transport. Open-phase queries scanned completed history and repeated counts grew with the turn. Partial open-phase indexes and bounded sequence caches remove that growth. Near-expired batches now expire before dispatch; a future batch can replace an exited worker without spawning overlapping workers. The failed artifact is retained.

The corrected complete 60-second run accepted and completed all 299 commands, stored all 5,997 semantic outputs and completed all 36,035 diagnostics without rejection, expiry, failure or restart. Admission p95/p99 were 27.66/31.49 ms; output p95/p99 30.47/38.87 ms; caller loop p99/max 12.06/13.60 ms. Peak queued telemetry payload was 115,411 bytes. Process RSS rose from 95.5 to 241.0 MiB; this minute-long run is not a memory plateau or soak. Maximum observed telemetry batch was 20.64 ms: the eight-millisecond batch target is cooperative, not a preemptive native-SQL deadline. The final candidate additionally corrects sequence-cache handling after failed writes/rolled-back transactions and throttles failed worker construction; the final regression passed, but this successful-path timing sample does not measure those failures.

# Output write amplification

The explicit SQL observer and strace measured the actual Web output-persistence pipeline by event type. Removing a reconstructible pre-append payload checkpoint and a redundant post-delivery-receipt checkpoint leaves both canonical-identity and reliability-append recovery boundaries intact. For the six semantic event types in the 1 KiB fixture, fsync/fdatasync call counts fell from 12 to 10 per event. Assistant-message SQL UPDATE executions fell from five to three and bound payload bytes from 23,293 to 16,937; tool-finished updates fell from five to three and bound bytes from 20,657 to 13,769. Assistant delta and tool-progress retained their existing live-only compaction behavior; their minimal projections still made two and one synchronization calls respectively.

Statement counts classify UPSERT by the leading INSERT verb and are not physical inserted-row counts. Bound SQL bytes estimate serialization/write amplification, not physical memory-copy counts. WAL file length is neither cumulative WAL bytes written nor fsync count. CPU samples include observer and tracing overhead. One sample per event type demonstrates the checkpoint change, not a percentile or throughput capacity. No cross-database transaction or weaker synchronization was introduced.

Artifacts are under `artifacts/performance-scalability-telemetry-20260907/`. Integrated workload, larger payload paths, maintenance and the two-hour soak remain open in F–H.

# Remote acceptance

The first exact candidate (64812c56) completed a real headful Composer/provider/direct-tool turn through HTTPS and Machine Auth. HTTP 202 took 62.9 ms (server ACK 28.0 ms), and product trace/receipt showed exactly one completed turn with the expected tool result and final answer. Its diagnostic health exposed two rejected commands: the bounded payload traversal confused shared acyclic model metadata with a cycle. The worker transport now tracks the active object path, accepting shared references while counting each serialized occurrence and still rejecting cycles and byte/field overflow. The 44-test regression and six-worker-test follow-up, including a shared-model provider request, passed. This lease was released. Final candidate 2700e24d passed in a fresh full-seed Pibo2 lease `lease_9b633284817d4a0e43`. At 11:14:48 UTC a real headful Composer click received HTTP 202 in 72.1 ms (server ACK 38.63 ms). One turn, two provider requests and one tool call persisted with successful terminal statuses. All 53 diagnostic commands completed with zero rejection, failure, expiry or restart. The worker was thread 2 of gateway process 7 with FULL synchronization. Reload retained exactly one final answer and the completed receipt. These individual observations are not percentile estimates.

Public browser health polling passed 300/300 requests, p95 8.1 ms, p99 9.0 ms and maximum 12.2 ms. The final isolated lease was released after acceptance; exact lease metadata, scoped persisted results and screenshot are in the adjacent artifacts.
