---
type: "Specification"
title: "Bounded SQLite Storage Health and Maintenance"
description: "Defines bounded operator status, verification, checkpoint, backup, and retention behavior for Pibo SQLite stores."
tags: ["data", "sqlite", "operations", "maintenance"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-08T18:00:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "730cf01fcfa1032ce9c4640656617b8bdd831ba2"
  requirements:
    - id: "PIBO-STORAGE-MAINT-001"
      status: "implemented"
      sources:
        - path: "src/data/storage-maintenance.ts"
          symbol: "inspectStorageStatus"
        - path: "src/data/storage-maintenance.ts"
          symbol: "verifyStorage"
        - path: "src/data/storage-verification-worker.ts"
          symbol: "worker verification entrypoint"
        - path: "src/debug/storage-maintenance.ts"
          symbol: "runStorageMaintenanceCli"
      tests:
        - path: "test/storage-maintenance.test.mjs"
          name: "bounded storage status and verification report positive, partial, and WAL-pressure state without blocking writers"
        - path: "test/storage-maintenance.test.mjs"
          name: "payload-reference status scans are explicitly bounded"
        - path: "test/storage-maintenance.test.mjs"
          name: "real temporary-store CLI exposes status, bounded verification, dry-run retention, and explicit checkpoint apply"
      public:
        - "command: pibo debug storage status"
        - "command: pibo debug storage doctor"
        - "command: pibo debug storage verify"
      failures:
        - "Verification timeout or cancellation is partial and never healthy."
        - "Integrity errors and worker failures are failed and never healthy."
      confidence: "high"
    - id: "PIBO-STORAGE-MAINT-002"
      status: "implemented"
      sources:
        - path: "src/data/storage-maintenance.ts"
          symbol: "checkpointStorage"
        - path: "src/data/storage-maintenance.ts"
          symbol: "maintainStorageRetention"
        - path: "src/data/storage-backup.ts"
          symbol: "createStorageBackup"
        - path: "src/data/storage-backup.ts"
          symbol: "verifyStorageBackup"
        - path: "src/debug/storage-backup.ts"
          symbol: "runStorageBackupCli"
      tests:
        - path: "test/storage-maintenance.test.mjs"
          name: "checkpoint and retention are dry-run by default; apply is bounded, audited, and retains orphan payloads"
        - path: "test/storage-maintenance.test.mjs"
          name: "checkpoint refuses missing paths and invalid runtime modes"
        - path: "test/storage-backup.test.mjs"
          name: "online WAL backup restores product history and both compressed and large external payloads"
        - path: "test/storage-backup.test.mjs"
          name: "wal growth quota releases the source snapshot while writers keep appending"
      public:
        - "command: pibo debug storage checkpoint"
        - "command: pibo debug storage retention"
        - "command: pibo debug backup create"
        - "command: pibo debug backup verify"
      failures:
        - "Mutation requires explicit apply and uses bounded batches or quotas."
        - "Retention preserves durable product and audit classes and reports bounded newly unreferenced payload candidates without deleting payload metadata or files."
      confidence: "high"
---

# Scope

Operator health and maintenance for file-backed Pibo SQLite stores, including bounded inspection, cancellable verification, WAL pressure, consistent backup, and policy-limited retention.

# Current behavior

`pibo debug storage status` and `doctor` open one selected store read-only. They report database, WAL, and SHM sizes plus a clearly labelled bounded sample of payload metadata bytes; page/freelist counts; SQLite statistics where available; table counts capped at 10,000 rows; bounded payload-reference/orphan samples with completeness flags; prior maintenance metadata; and configurable size thresholds. They do not run whole-history payload-reference unions or correlated orphan counts. Crossing a threshold or finding sampled payload-reference inconsistency reports degraded health.

Verification runs `quick_check` or full `integrity_check` in a dedicated child-process boundary with progress stages and a caller timeout that starts when the native pragma stage begins. Timeout or cancellation sends `SIGKILL` and returns only after the verification process exits, so a synchronous native SQLite operation cannot outlive a reported cancellation. Only a completed `ok` result is healthy. Timeout and cancellation are partial; errors are failed.

Checkpoint and retention are dry-run unless `--apply` is present. Checkpoint rejects missing database paths and invalid modes, then uses SQLite's bounded `PASSIVE`, `RESTART`, or `TRUNCATE` result and reports busy/log/checkpointed pages. Retention planning reports bounded counts and dispositions for live delta, normalized trace, chat, and audit classes in either the product event log or Reliability stream. Apply processes at most 10,000 rows per invocation and currently permits only `live_delta` rows that carry neither idempotency keys nor reliability event IDs; trace-event removal remains explicitly deferred until a preservation policy exists. It does not treat durable conversation, audit, trace, reliability, consumer-offset, or idempotency evidence as implicitly disposable. Candidate selection, deletion, and bounded payload-reference evidence occur in one `BEGIN IMMEDIATE` transaction. Newly unreferenced payload metadata and files are report-only and retained for future explicit offline policy. The same transaction writes the authoritative completed audit row, so deletion cannot commit without its audit; a bounded JSON sidecar is best-effort supplementary metadata.

The existing backup command uses SQLite's online-backup API, holds a consistent read snapshot, limits duration, bytes, payload count, and source-WAL growth, and supports explicit resume. Backup and verification outcomes update maintenance metadata for status inspection.

# Verification and locking guide

- Use `storage verify --quick` for routine online structural assurance. It still reads the whole database and can consume substantial I/O; a timeout is partial, not a healthy result. The source is opened read-only, but the additional reader may delay WAL truncation while it exists.
- Use `storage verify --full` for deeper online B-tree and constraint checking when the I/O window is explicitly large enough. It has the same read-lock/WAL lifetime concern and normally costs more than quick check.
- Use `debug backup create` when the authoritative Gateway must remain writable and a consistent artifact is required. The online snapshot includes committed WAL content. WAL-growth quota failure releases the snapshot; resume continues only from the already-created snapshot.
- Use `debug backup verify` to validate database and external payload hashes in an isolated archive. Prefer this over repeatedly scanning the authoritative store during incident response.
- Use offline maintenance for `VACUUM`, large index rebuilds, filesystem repair, or any operation whose estimated rewrite exceeds the online budget. Stop the authoritative writer through its documented gateway lifecycle, take and verify a backup, perform the operation on an isolated copy first, and do not use ad hoc SQL as the default procedure.
- `PASSIVE` checkpoint is the least disruptive online action and does not wait for active readers. `RESTART` and especially `TRUNCATE` can require reader cooperation; a nonzero busy result is observable failure to complete, not permission to interrupt active requests.

# Requirements and invariants

## Requirement: PIBO-STORAGE-MAINT-001

Storage status SHALL be read-only, bounded, thresholded, and explicit about database/WAL/SHM/payload size, pages/freelist, bounded row information, payload-reference integrity, maintenance metadata, and degraded conditions. Verification SHALL expose progress and SHALL return only `complete`, `partial`, or `failed`; timeout and cancellation SHALL never report healthy.

## Requirement: PIBO-STORAGE-MAINT-002

Checkpoint, retention, and backup maintenance SHALL default to dry-run or explicit creation, use bounded time/row/byte/WAL budgets, and record auditable outcomes. Retention SHALL preserve chat messages, audit records, idempotency and consumer-offset evidence, non-eligible reliability/trace history, and all payload metadata/files unless a future explicit offline policy says otherwise. Candidate selection and deletion SHALL share one write transaction, and that transaction SHALL include the authoritative completion audit.

# Interfaces and ownership

- `inspectStorageStatus`
- `verifyStorage`
- `checkpointStorage`
- `maintainStorageRetention`
- `createStorageBackup`
- `verifyStorageBackup`
- `pibo debug storage status|doctor|verify|checkpoint|retention`
- `pibo debug backup create|inspect|verify|restore`

# Known limits

Status reports only a bounded sample of committed payload metadata bytes; this is neither total metadata size nor actual external filesystem size. Payload and reference counts carry explicit sample/completeness fields. Row counts are exact only below the 10,000-row cap; SQLite statistics are estimates and may be absent. The current deletion policy intentionally supports only unkeyed `live_delta`; broader normalized trace or reliability retention requires an approved retention class and preservation period rather than an indiscriminate delete switch.
