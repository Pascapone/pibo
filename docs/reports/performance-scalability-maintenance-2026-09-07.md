---
type: "Validation Report"
title: "Bounded telemetry maintenance, backups and scoped captures: package G validation"
description: "Records the resumable bounded telemetry maintenance worker, SQLite online backups with external payload manifests, opt-in scoped capture storage, bounded manual prune and backup WAL quotas, and the isolated Pibo2 slot acceptance."
tags: ["performance", "telemetry", "maintenance", "backup", "retention"]
status: "stable"
authority: "evidentiary"
generated: { by: "qwen/qwen3.8-max", at: "2026-09-07T21:40:00Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/reports/performance-scalability-fgh-handoff-2026-09-07.md"
  - resource: "/reports/performance-scalability-reads-2026-09-07.md"
---

# Candidate

Source `d77b8402` (branch `performance-maintenance`, package G merged on top of package F `11fb25c1`), isolated Docker worker `pibo-dev-performance-maintenance`, package SHA-256 `400d0bc2d4ab6694c2a74a5db5e4fd780f9b4a105f7cf86ff641e1e6029ec298` (version 1.7.2). The full build and typecheck passed inside the worker. Packaging used the built files with explicit shrinkwrap prepare/clean and lifecycle hooks disabled. No host gateway was modified.

# Behavior and local evidence

Telemetry cleanup no longer requires global idle windows. A resumable maintenance job advances in small bounded batches over an explicit cursor, protects rows belonging to queued or running turns and active sessions, persists its progress so a reopened store resumes instead of restarting, and rolls deletion and progress back together when a batch fails (exercised with a real SQLite "disk full" injection). Product messages, receipts, retries and recovery payloads are never eligible. Manual prune calls and backup WAL growth observe the same bounds as automatic maintenance: the synchronous prune guarantees at least one bounded step (a do-while replaces a while-guard that could skip every step when the process was preempted past its 20 ms budget under load), and backups hold a WAL growth quota so writers keep appending while the snapshot is copied.

Backups use the SQLite online backup API plus a manifest covering external payload references; concurrent WAL writes during the snapshot are tested, copying can be aborted and resumed, and an incomplete backup is never marked restorable. The scoped capture store keeps optional provider detail behind an explicit session selection with runtime and row/byte limits; default telemetry stays aggregated, and completed captures are discoverable through manifests and opened only on explicit request. A settings surface exposes the telemetry retention window.

Local test evidence in the worker:

- Focused maintenance selection (storage-backup, telemetry-maintenance, telemetry-capture, telemetry-retention-service, telemetry-store, debug-cli) passed, including the WAL growth quota, checkpoint observation, disk-full rollback, backup abort/resume, and capture limit tests.
- The merged (F+G) full repository suite passed 2764 tests (0 failures). One earlier merged run showed a single load-induced flake in a room-pinning order assertion; it passes in isolation, at file level (6/6), in both package-F full runs, and did not recur in the final merged run.
- `npm run typecheck`: clean.

# Merge note

Package G was merged onto package F (`11fb25c1`) with two conflicts resolved by union: `src/data/schema.ts` keeps schema version 13 while executing both the F read-projection/navigation-revision schemas and the G telemetry-maintenance schema (all idempotent `CREATE … IF NOT EXISTS`, applied on every open), and `src/apps/chat/web-app.ts` disposal awaits the command dispatcher before the (now asynchronous) telemetry retention disposal while keeping the subscription unsubscribe ahead of the first await.

# Remote acceptance

Isolated deployment-pool lease `lease_d665da6593151a9c82` on slot-01 (`https://slot-01.pool.pibo2.neuralnexus.me/`), seed mode `medium`, holder `ps_c14df867-a054-495c-bfe6-4637238f4245`, acquired 2026-09-07T21:21:10Z and released 2026-09-07T21:31Z (pool returned to 0/3 active). The exact checksum-addressed candidate (version 1.7.2, commit `d77b8402`, SHA-256 `400d0bc2…ec298`) was installed into the slot by the pool; no source was edited on Pibo2 and the canonical gateway was untouched. Machine Auth authenticated every API and browser step.

- **Target/HTTP:** `/api/health` 200 (36 ms); machine-session exchange 200 (provider `machine-key`).
- **Retention settings:** GET `/api/chat/user-settings` 200; PATCH with `telemetryRetention {enabled:true,days:30}` persisted and read back as `{enabled:true,days:30,lastPrunedAt:…}`.
- **Bounded prune over real seeded telemetry:** POST `/api/chat/telemetry-retention/prune` with `days:30` returned 200 with `{applied:true, completed:true, rowsDeleted:134031, cutoff:2026-08-08T21:22:05Z}` in 18 s wall-clock, and recorded `lastPrunedAt` in user settings (the persistent due-check survives restarts). The gateway stayed healthy throughout; no restart.
- **Package-F regression on the merged candidate:** trace first call `trace_cache;desc="miss"`, repeat `watermark-hit`, conditional `If-None-Match` → 304; composer POST durably accepted then graceful 409 (seeded session has no live runtime), repeat with same `clientTxnId` → `{"duplicate":true}` echoing the persistent event (streamId 987973 carried over from the package-F run, confirming durable persistence across candidate swaps).
- **Browser (headful):** remote non-headless Chrome/Xvfb behind a loopback-only SSH CDP tunnel, authenticated against slot-01; the Settings view renders (GENERAL section with timezone/model defaults, telemetry-retention section present in the DOM) beside a working chat shell whose terminal shows the durably accepted "G acceptance probe" message and the graceful runtime-missing Session Error row. Screenshots: `artifacts/performance-scalability-maintenance-20260907/`.
- **Expected non-regressions (documented):** `/api/previews/events` 503 (preview server not running in a pool slot) and `fork-candidates` 500 for the seeded runtime-less session; both handled gracefully and unrelated to maintenance.

Browser stopped and lease released after the run; pool back to 0/3 active, 10 free.

Artifacts are under `artifacts/performance-scalability-maintenance-20260907/`.
