---
type: "Investigation Report"
title: "Critical review of the performance and scalability chain A-H"
description: "Records the critical review of all eight stacked performance pull requests against the plan budgets and existing contracts, the three confirmed defects corrected with deterministic regressions in packages B, F and G, the findings reported without a code change, and the resulting validation and merge-order consequences."
tags: ["performance", "scalability", "review", "storage", "read-models", "telemetry"]
status: "stable"
authority: "evidentiary"
generated: { by: "qwen/qwen3.8-max", at: "2026-09-07T22:45:00Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/reports/performance-scalability-fgh-handoff-2026-09-07.md"
  - resource: "/reports/performance-scalability-storage-final-2026-09-07.md"
  - resource: "/reports/performance-scalability-reads-2026-09-07.md"
  - resource: "/reports/performance-scalability-maintenance-2026-09-07.md"
  - resource: "/reports/performance-scalability-runtime-isolation-decision-2026-09-07.md"
---

# Scope and method

Reviewed the full stacked chain, not only packages F to H: A `d178416c`, B `60d48f1b`, C `0b2bbdc3`, D `17d11f61`, E `c01f4bb3`, F `11fb25c1`, G `eaded6ae`, H `2f2a7f4e`. Each package was read in its own worktree against the plan budgets (PERF-READ-001, PERF-LOOP-001, PERF-ACCEPT-001, PERF-BOUNDS-001) and against the contracts the plan names: read-worker isolation, navigation, streaming, the schema-v13 merge, disposal order, the delivery badge, the vocabulary gate, maintenance/backup/capture and the do-while prune.

Every defect below was reproduced first and fixed second, in the package that introduced it, with a deterministic regression. Validation ran in the isolated Docker workers `pibo-dev-performance-reads`, `pibo-dev-performance-maintenance` and a newly spawned `pibo-dev-performance-storage`. No host gateway and no canonical Pibo2 service was touched. Nothing was merged.

Topology confirmed by ancestry, not by assumption: B through H are strictly linear, each branch an ancestor of the next. A is not an ancestor of B; B carries A's code patch as `79df038e` (patch-equivalent to A's `79984bc7`) plus a merge of `upstream/dev`, while A's two documentation commits `29eebe7d` and `d178416c` are absent from B to H. `upstream/dev` has moved two commits past the chain's merge base `3d0d1869` (`f1c6d143`, `8062aad8`).

# Confirmed defects and corrections

## B: an exited storage worker disabled durable admission permanently

`BoundedWorkerClient.fail()` closes the client for good on a worker error, a worker exit or one breached execution deadline. `AsyncChatStorage` had no replacement path, so every later admission, output ingest and receipt command rejected with `storage_closed` and chat acceptance stayed unavailable until a gateway restart. The 503 mapping was correct and visible, but the condition was unrecoverable. The diagnostic telemetry writer (package E) and the chat read worker (package F) already replace an exited worker; the admission writer, the most critical of the three, did not.

Reproduced: after terminating the writer worker, `append` rejected with `storage_closed` indefinitely. Correction: expose the worker exit on the bounded client status and let `AsyncChatStorage` replace an exited writer or reader on the next command, waiting for the exit and bounded to one replacement per second so two writers never own the same SQLite file. Admission is idempotent by request key, so recovery needs no replay protection, and inside the bounded window the failure stays visible instead of becoming a false acceptance. Regression: `an exited storage worker is replaced instead of disabling durable admission permanently`.

## F: the isolated read worker answered with less content than the fallback it replaced

The read worker built its timeline service with a 64 KiB hydration budget while the in-process fallback uses the shared 1 MiB default. Measured on one persisted `assistant_message` of 176,000 bytes: the in-process path returned all 176,000 bytes, the read worker returned the 17-byte stored preview. `StoredChatEvent` carries no payload reference, so nothing on that path could recover the body, and tool-call arguments and tool results above the budget came back as `null`. The same `listEvents` query therefore answered differently depending only on whether the database was file-backed or in-memory, which is also why the suite never observed it: `:memory:` stores disable `readQueries`. Plan invariant 6 bounds large content by carrying references, not by dropping them.

Correction: use the shared hydration default in the worker so both paths agree. The IPC bound stays owned by `maxMessageBytes` and by the bounded page-halving recovery already present in the event-stream replay loop. Regression: `the isolated read worker answers a timeline query with the same content as the in-process fallback`.

## G: the configured provider event detail mode was dropped at the worker boundary

The telemetry worker built its runtime recorder with a hardcoded aggregate mode while still keying the recorder cache on the requested mode. `PIBO_TELEMETRY_PROVIDER_EVENTS=detailed` reached the worker and was discarded there: no detailed `telemetry_provider_events` rows were written, and the cache could hold two recorders that behaved identically. The scoped capture store is not a replacement; it records bounded event metadata for one explicitly selected session, not detailed provider event rows.

Reproduced through the real file-backed worker: five commands processed, zero failures, zero detailed provider events. Correction: propagate the requested mode. Regression: `an explicitly detailed provider event mode survives the telemetry worker boundary`.

## G: one narrow manual prune could disable automatic retention permanently

All callers share a single maintenance job row, and a scope conflict rejected any other scope while that row read running or paused. `pibo debug telemetry prune --retention diagnostic --apply` performs one bounded batch and its process then exits, leaving the row running with a scoped retention. From that moment the unscoped automatic retention job was rejected on every attempt, so retention stopped silently until someone cleared the row by hand. The existing regression `manual pruning observes the same row bound and retains its selected class on resume` already pinned that the scoped row survives the call.

Correction: treat the persisted stamp as an owner lease. A live owner updates the job on every bounded batch, so a stamp older than the lease proves it stopped and the new scope may reclaim and reset the job. A fresh stamp still protects a running owner and the same scope still resumes its persisted cursor unchanged. Regression: `a scoped job whose owner stopped stepping is reclaimable instead of blocking retention forever`.

## G: a failing retention job respawned a worker thread about four times per second forever

A failing maintenance attempt closed its worker and rescheduled after a fixed 250 ms, without backoff, without a limit and without ever clearing the running flag. Measured on the scope conflict above: 4 failures after 1 s, 7 after 2 s, 10 after 3 s, each one a new worker thread with a fresh SQLite connection, continuing until disposal, while the stuck running flag blocked every later due check from recovering the job. That is unbounded growth under a persistent failure and contradicts PERF-BOUNDS-001.

Correction: back off exponentially to a bounded ceiling and stop after a bounded number of consecutive failures with the failure count retained and running cleared, so a later due check retries instead of burning one worker per attempt. Regression: `a persistently failing retention job backs off instead of respawning a worker forever`.

# Findings reported without a code change

- **F, navigation index key ordering.** `indexKey()` re-reads the structure revision after `indexSharedSessions()` and stores that later value. A session inserted between the indexed snapshot and the key computation is recorded under the new revision while the index was built from the old one, so the next request skips indexing and the session can be missing from the room-scoped index page; `sessions.room_id` stays NULL until `indexSharedSessions` writes it. The remedy is one line (store the revision captured before indexing), but the window is only reachable through a concurrent insert inside a single request, so no deterministic regression exists for it. Reported rather than fixed to avoid an unverifiable change.
- **F, no payload reference on the streaming wire contract.** Even with aligned hydration, `StoredChatEvent` has no payload reference, so any event above the hydration bound is still unrecoverable on the SSE and room-events paths. The trace path is fine because `storedPiboEventFromV2Row` keeps `storedPayloadRef`. Closing this properly is an additive wire-contract change plus chat-ui consumption, which is design work rather than defect repair.
- **F, `/api/rooms/:roomId/events` pages 1000 events with no halving.** The read client caps one message at 4 MiB. At 64 KiB hydration this endpoint could already fail with `storage_payload_limit` above roughly 64 hydrated large events; at the shared 1 MiB default the threshold is lower. The SSE replay loop halves its page size on that error; this endpoint does not. Pre-existing exposure, not introduced by the correction above, but it should get the same bounded paging.
- **F, per-frame structural walk in the streaming hot path.** `writeSse` and `writeJsonSse` walk every payload with `boundedMessageBytes`, and `writeChatEventFrames` walks live-only payloads a second time, before `JSON.stringify` encodes the frame. Bounded, but it is repeated traversal per delta in exactly the path PERF-LOOP-001 governs.
- **F, unrelated whitespace churn.** `message-command-store.ts` changes `owner=NULL` to `owner = NULL` in five statements. Neither the legacy product vocabulary gate nor the session-native boundary gate matches either form; verified by running the gate against the pre-change file. Noise in a stacked diff.
- **B, C, D, shared references rejected as cycles.** `boundedMessageBytes` added every object to its `seen` set and never removed it, so a shared but acyclic reference was rejected as cyclic. Package E corrected this in `2700e24d` and pinned it with a regression. Because the chain is linear, the defect exists only in the intermediate states B, C and D; the merged result is correct.
- **G, manual prune reporting.** The applied synchronous prune now performs one bounded batch and returns `rowsMatched` as rows scanned and `bytesMatched` as 0. The bound is intended and documented, but `pibo debug telemetry prune --apply` calls it once and prints those numbers, so an operator sees a small deletion and no byte figure without an explicit incomplete marker. The HTTP path got `pruneTelemetryOlderThanAsync` with a 30 s drain loop; the debug CLI did not.
- **G, backup hashes the snapshot twice.** `createStorageBackup` digests the snapshot at the end of the snapshot stage and then digests it again immediately after falling through to the payload stage. Correct, but it doubles the read cost of the largest artifact on every first run.

# Per-package conclusion

- **A (#953)** — No defect found. The canonical key is formed once, the redundant pre-check is gone, `eventLog.appendEvent` still resolves an ignored insert by idempotency key so the winner stays singular, the legacy empty-transaction lookup keeps its direct-call contract without adding a scan fallback, and `scripts/audit-chat-transaction-keys.mjs` is read-only, keyset-paged and exits non-zero on a non-canonical key as the plan requires.
- **B (#959)** — One real defect, corrected above. Isolation itself holds: `busy_timeout` 10 ms with bounded jittered retry against an absolute deadline, one in-flight RPC, priority with aging, payload staging outside the metadata transaction.
- **C (#961)** — No defect found. Command and `user.message.accepted` share one short transaction, the receipt owns delivery state, `recordOutput` only advances state so a late emit result cannot downgrade it, and disposal deliberately does not release dispatched claims for replay.
- **D (#964)** — No defect found. Cold starts, provider turns and waiters are separately bounded, room round-robin re-inserts a served room at the end of the map, cancellation removes a waiter without consuming a slot, and the provider extension releases before tool work and on abort, error, message end, agent end and shutdown.
- **E (#965)** — No defect found. Batching, the progress reserve that keeps lifecycle commands from being starved by deltas, front-of-queue re-queueing of partially processed batches and exited-worker recovery are all consistent with the plan.
- **F (#969)** — One real defect corrected, three findings reported. Read isolation, resumable projections, bounded SSE and the startup sequence-repair index are sound, and the disposal order (unsubscribe, then await the dispatcher, then awaited retention, then workers, then the store) is correct.
- **G (#970)** — Three real defects corrected, two findings reported. The bounded resumable job, the disk-full rollback of deletion and cursor together, the online backup with its WAL growth quota and manifest, and the scoped capture store are sound. The schema-v13 merge keeps both F and G blocks idempotent and applied on every open.
- **H (#971)** — No defect found; documentation only. The decision is bounded to the measured profiles and carries explicit revisit triggers. Its substance is unaffected by the corrections above, which address recovery, fidelity and retry bounding rather than the measured loop, fairness or memory profiles, but the candidate SHAs it cites are no longer the branch tips.

# Validation status and consequence for acceptance

In the isolated workers: build and typecheck clean at B, at F and at the merged chain tip; `test/storage-worker-isolation.test.mjs` 8/8 and `test/web-channel.test.mjs` 131/131 at B; the focused telemetry selection 30/30; and at the merged chain tip `npm run build`, `npm run typecheck` and the full repository suite, which reported 2896 tests with 0 failures. The diff from the pre-review package-G tip to the chain tip is exactly the five corrected source files and their five regression files, so no other content moved. One failure seen in a five-file parallel run at B (`missing legacy native history preserves surviving Pibo product history`) was load-induced, not a regression: it passes in isolation and passes with the whole file, 131/131, with the correction applied.

The corrections postdate the recorded Pibo2 acceptances. The package reports pin exact checksum-addressed candidates (B `60d48f1b`, F `bf2db4c4`/`11fb25c1`, G `d77b8402`), and those candidates are no longer the branch tips. Each report remains true about the candidate it describes; none of them covers the corrected code. B, F and G therefore need the relevant isolated pool-slot acceptance re-run on their new tips before merge, or an explicit maintainer decision to accept the gap. H needs no runtime acceptance. OKF gates at the chain tip: strict validation, index check and log check all pass.

# Merge order

Merge strictly in chain order: #953, #959, #961, #964, #965, #969, #970, #971. B to H are strict descendants, so merging any of them out of order pulls the whole preceding diff in under the wrong pull request and destroys per-package reviewability. A must go first because its code patch is already inside B; merging B first would orphan A's two documentation commits and force a rebase of A.

Before A, bring the chain current with `upstream/dev`, which is two commits ahead of the merge base. Prefer merging `upstream/dev` into A and cascading forward, the pattern this stack already uses, over rewriting 45 commits across eight open pull requests. The forward merges that carry these corrections were resolved the same way; the only conflicts were two both-sides-appended test blocks in `test/storage-worker-isolation.test.mjs`, resolved by keeping both.
