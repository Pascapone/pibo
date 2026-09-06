---
type: "Validation Report"
title: "Indexed chat admission: P0 validation"
description: "Records the isolated indexed-admission implementation, measurements and completed Pibo2 acceptance."
tags: ["performance", "admission", "sqlite"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-06T21:37:22.192687Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
---

# Scope

Package A of the [performance plan](/plans/pibo-performance-and-scalability.md). Packages B–H are not complete. No production deployment or data cleanup is authorized by this report.

# Implementation

`ChatEventCommandService` uses the existing unique idempotency index for nonempty client transaction keys. The redundant command-level append precheck is removed; store deduplication and `INSERT OR IGNORE` remain. The canonical room/actor/transaction scope and original-event duplicate response remain compatible, including retries targeting another session or carrying changed content. Missing room/actor lookups still return no match. Empty transaction IDs still do not deduplicate inserts; the legacy direct empty-key lookup retains its historical query. Normal HTTP keys cannot be empty and indexed misses never fall back to a room scan.

`sendChatMessage()` emits bounded, content-free `Server-Timing` values for lookup, append, ingest, emit and response preparation. These monotonic durations do not claim a durable commit timestamp or client ACK receipt. No server-side samples or high-cardinality labels are retained.

# Local Docker evidence

Worker `pibo-dev-performance-scalability-p0`, 2 GiB memory limit, host 6 CPUs / approximately 16 GiB, Node 24.15.0 and SQLite 3.51.3. WAL and synchronous=FULL were preserved.

- `npm run build` and `npm run typecheck`: passed.
- Existing real HTTP-channel client-transaction idempotency test: passed.
- Focused tests: 50 passing across `chat-indexed-admission`, `chat-v2-native-services`, `data-v2-store`, `data-v2-ingest-service` and `chat-web-app-sessions`.
- Independent child processes converge on one stored event; this does not prove multi-gateway dispatch ownership.
- Query-plan regression checks index usage for hits/misses with 100,000 history events.
- [Million-event measurement](artifacts/performance-scalability-p0-20260906/million-event-lookup.json): 1,000,001 rows, approximately 1.60 GB database. New hit p99 0.169 ms; miss p99 0.135 ms; 10,000 samples each. Old lookup median approximately 8.8 seconds from three samples each. These are synthetic lookup measurements, not an HTTP capacity test. Data was populated immediately before repeated queries; physical cache residency was not verified. The artifact's “warm” label means no deliberate cache eviction, not a verified fully resident dataset. Build/browser work overlapped on the same host.
- Headful Browser Use composer flow at 945×917: HTTP duration 105.5 ms, lookup 0.39 ms, append 3.51 ms, ingest 3.55 ms, emit 57.96 ms, response preparation 73.1 ms. Message became visible; provider subsequently rejected the worker's placeholder credential. [Screenshot](artifacts/performance-scalability-p0-20260906/docker-browser.png). This verifies admission and visible provider failure, not successful provider output.
- One initial run reported asynchronous database access after app disposal; subsequent focused runs passed. The researcher traced this to the uncancelled retention timer in `telemetry-retention-service.ts`; its lifecycle correction is tracked for the maintenance slice.

Reproduce: build inside Docker, then run `node scripts/performance-admission-benchmark.mjs --events 1000000 --samples 10000 --output /tmp/result.json`. The benchmark creates and removes only its own temporary database.

# Pibo2 acceptance

The exact committed candidate package built from `79984bc7a1a6bf6cd06130e35aa5da6a152cb332` had SHA-256 `860018876c8ced87d3cc4fa4a03817f6925712b94260c8a74afca766006d3ee3`. It was installed in an isolated full-seed Pibo2 pool slot and exercised through its public authenticated Chat Web path. The lease expired cleanly after evidence collection; no canonical Pibo2 service was changed.

- The private consistent snapshot audit scanned all 167,886 events and found 339 nonempty client transaction identifiers. All 339 used the canonical room/actor/transaction key; no empty, missing-scope or noncanonical key was found. [Audit artifact](artifacts/performance-scalability-p0-20260906/pibo2-key-audit.json).
- The seeded large room contained about 131,000 events. Its admitted request completed in 74.1 ms with 0.22 ms lookup, 1.49 ms append and 1.76 ms ingest timing. A warm small-room baseline completed in 37.8 ms. During the staggered two-session exercise the large-room request completed in 47.2 ms and the small-room request in 162.2 ms; the latter's 124.94 ms emit segment dominated the response. A retry of the large-room transaction returned the original event in 35.2 ms with no second append or dispatch. [HTTP and Server-Timing artifact](artifacts/performance-scalability-p0-20260906/pibo2-http.json).
- An independent health pulse collected 450 samples during the exercise: 450 HTTP 200 responses, 0 errors, 1.76 ms median, 2.16 ms p95, 19.67 ms p99 and 118.04 ms maximum. [Health artifact](artifacts/performance-scalability-p0-20260906/pibo2-health.json).
- The headful browser received successful model output (`P0_OK`) after mapping the historical seeded workspace path to the candidate workspace inside the disposable slot. [Screenshot](artifacts/performance-scalability-p0-20260906/pibo2-browser.png). The workspace mapping was test-container state only and is not part of this candidate.

These measurements validate package A and its compatibility with the seeded dataset. They do not establish the plan's ten-session capacity objective; that depends on packages B–G and the final load and soak gates.

# Documentation validation

Index generation, strict validation and all 84 focused documentation validator tests pass. The three screenshots missing from the branch baseline were restored byte-for-byte from the original workflow-validation worktree. The Docker worktree initially lacked accessible Git metadata; validation uses a private bare Git copy of the complete upstream/dev history via `GIT_DIR` and `GIT_WORK_TREE`, without changing the worker's source `.git` pointer.

# Package boundary

Package A's local and Pibo2 acceptance gates are complete. `node scripts/audit-chat-transaction-keys.mjs --snapshot <private-consistent-snapshot>` remains the reusable read-only audit command; it audits all rooms without schema initialization or writes and fails on noncanonical nonempty keys. Packages B–H and the integrated capacity, fault and soak gates remain tracked by the performance plan.
