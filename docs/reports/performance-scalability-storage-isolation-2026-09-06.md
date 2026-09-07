---
type: "Validation Report"
title: "Chat storage isolation: package B validation"
description: "Records the bounded worker storage boundary, crash regressions and isolated Pibo2 acceptance."
tags: ["performance", "storage", "workers", "sqlite"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-06T22:50:00.000Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
---

# Scope

Package B of the [performance and scalability plan](/plans/pibo-performance-and-scalability.md). It moves chat admission, idempotency and V2 semantic output ingest across a bounded `worker_threads` storage boundary. Package C still owns durable runtime commands and early HTTP 202 acknowledgement; runtime dispatch therefore remains inside the current request for this package.

# Implementation

`BoundedWorkerClient` permits one hidden worker RPC at a time and bounds pending work by count, estimated structured-clone bytes and absolute age. Admission, output and background priorities preserve FIFO within a class and use aging to prevent starvation. Queue expiry fails before execution; expiry or worker loss during execution returns an explicit unknown-commit state. The worker uses a 10 ms SQLite busy timeout with asynchronous jittered retries until the request deadline. Authenticated resource diagnostics expose queue count, bytes, oldest age, completion and rejection counts, worker identity, operation duration and effective WAL/durability settings without message contents.

`AsyncChatStorage` owns a dedicated writer and a lazy independent reader. The atomic admission command validates room state, checks the canonical transaction key, appends `user.message.accepted`, updates the product session/navigation projection and ingests the message in one transaction. Only `created: true` can dispatch. Semantic output ingest runs through the output priority and preserves the durable retry, reliability event and delivery-receipt phases.

Large payload hashing, compression and atomic file publication now finish before the short metadata transaction. The transaction links only prepared metadata and the event/message references. A failed DB transaction can leave a content-addressed unreferenced file; package G must provide bounded resumable orphan reconciliation before any deletion policy is enabled.

Session and output projections preserve an independently advanced runtime binding. This prevents stale projection snapshots from lowering a live binding revision or restoring an obsolete native session ID. Scheduled telemetry retention is cancelled during app disposal, and storage workers are terminated and unreferenced cleanly.

# Local Docker evidence

Worker `pibo-dev-performance-storage`, 2 GiB memory limit, Node 24.15.0 and SQLite 3.51.3.

- Exact candidate build and package prepack passed.
- Seven storage-isolation tests passed: CPU isolation, count/byte bounds, priority/FIFO, crash and deadline uncertainty, cyclic/large IPC rejection, payload staging outside the transaction, runtime-binding preservation, atomic concurrent admission, restart replay and a held writer lock.
- Thirteen V2 ingest tests and fifteen runtime-binding/storage tests passed.
- Five telemetry-retention tests passed, including cancellation before database close.
- All six real-process output crash boundaries passed: before/after V2 write, after reliability append, during projection, after live send before receipt and after receipt before checkpoint.
- The real HTTP client-transaction test passed with the file-backed worker path. Test fixtures now dispose their apps so worker handles cannot hide resource leaks.
- The complete application build passed. The existing Vite large-chunk warnings remain unchanged and are not a failure of this storage package.

# Pibo2 acceptance

The final full-seed isolated candidate was commit `051455e5d80ccfe48958e0ff1d998f60e231edf4`, package SHA-256 `854cb7629bc149fdbffd857fb5de909f475f9f73064fb15678edb16623c1f5a6`, lease `lease_17f01b253ac81b55f1`. The canonical Pibo2 service was not changed.

- A fresh authenticated headful Chat Web session admitted in 78.8 ms browser time. Server timing was 7.42 ms for atomic worker append and 66.16 ms through the current post-dispatch ACK.
- Retrying the same transaction returned the same stream ID and did not redispatch. A 20-request concurrent duplicate burst returned 20 HTTP 200 duplicate responses with one stream ID: p50 73.3 ms, p95 96.5 ms, p99/max 97.8 ms.
- A deliberate 50-request simultaneous stress beyond the approved burst profile remained lossless but reached p95 499.7 ms and max 506.8 ms. Package D must enforce calibrated admission capacity instead of treating this as approved throughput.
- An independent 15-second health pulse collected 297 HTTP 200 responses with no error: p95 2.29 ms, p99 3.48 ms and max 175.55 ms.
- The semantic output reached both durable trace and the headful browser as `STORAGE_OK`. The first candidate exposed stale runtime-binding projection writes; a deterministic regression was added, the projection was corrected locally, and the exact corrected candidate completed with zero binding errors.
- Worker diagnostics reported WAL, SQLite synchronous level 2, 10 ms lock waits, empty queues after the run and no rejected operation.

[Machine-readable acceptance](artifacts/performance-scalability-storage-20260906/pibo2-acceptance.json), [health samples](artifacts/performance-scalability-storage-20260906/pibo2-health.json), and [headful screenshot](artifacts/performance-scalability-storage-20260906/pibo2-browser.png) retain the bounded evidence.

# Gate result

Package B's vertical storage slice is accepted: slow SQL, lock waiting, IPC pressure and payload compression in the migrated admission/output paths do not execute on the gateway thread; overload and uncertain commit states are explicit. Remaining synchronous product reads, reliability-store work, telemetry batching, read models and maintenance are assigned to packages E–G. Runtime startup remains part of the HTTP request until package C introduces a durable command receipt and dispatcher.
