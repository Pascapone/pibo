---
type: "Investigation Report"
title: "Performance PRs A–H: independent regression review and renewed acceptance"
description: "Records reproduced lifecycle, pagination, navigation and maintenance defects, their corrections, renewed Docker and Pibo2 checks, and the remaining capacity and provider acceptance limits."
tags: ["performance", "scalability", "review", "validation"]
status: "stable"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-08T04:20:00Z" }
sources:
  - id: "plan"
    resource: "/plans/pibo-performance-and-scalability.md"
  - id: "prior-review"
    resource: "/reports/performance-scalability-chain-review-2026-09-07.md"
  - id: "isolation-decision"
    resource: "/reports/performance-scalability-runtime-isolation-decision-2026-09-07.md"
---

# Assessment

This review covers PRs 953, 959, 961, 964, 965, 969, 970 and 971 against the [performance plan](/plans/pibo-performance-and-scalability.md). The corrected chain has stronger deterministic correctness evidence. It does **not** yet have an integrated capacity or release approval.

The conclusion here supersedes the capacity-proof interpretation in the [previous package-H decision](/reports/performance-scalability-runtime-isolation-decision-2026-09-07.md), while preserving its measurements. Deferring another runtime-isolation layer is a provisional engineering choice. Separate admission, read, telemetry and runtime-ramp benchmarks do not establish that all budgets hold simultaneously. The plan's mixed ten-active-session workload and two-hour soak remain open. A ramp of empty runtimes without actual provider work is not evidence for sustained streaming under that workload.

# Reproduced defects and changes

| Package | Finding and consequence | Correction and regression |
|---|---|---|
| B | Calling `find()` after storage disposal instantiated the lazy reader and returned a result. Concurrent `close()` calls, or closing after failure, could finish before worker termination. | Reject reads before accessing the lazy-reader getter once storage is closed. Share and await the worker termination promise. The regression failed before the fix and now checks both forbidden resurrection and completed worker exit. |
| B | The shared bounded-message implementation rejected repeated references to the same acyclic metadata object. E already contained the repair, leaving B–D exposed when reviewed or deployed separately. | Move the existing recursion-path cycle check and its regression into B, then merge B forward through the stack. Cycles still fail; shared acyclic objects remain valid. Remove the duplicate inherited test in E. |
| F | A room event page with twelve 512-KiB bodies exceeded the 4-MiB IPC bound and returned HTTP 500. Hydrating the entire requested page before rejecting also wasted memory. | Bound hydration while iterating rows; halve the HTTP page limit on the explicit payload-limit error, matching replay recovery. The HTTP regression failed before the fix and now traverses every event and complete body without gaps. A single event beyond the wire budget remains a separate contract limitation. |
| F | If Session structure changed during indexing, the cache recorded the later revision against the earlier snapshot and could retain stale navigation. | Capture the structural revision before the snapshot and keep that revision in the cache key. A deterministic index-time mutation reproduces the old failure and verifies that the next navigation request rebuilds the index. |
| G | A deliberately paused scoped maintenance job became reclaimable by another scope after its timestamp aged out, allowing automatic retention to override an explicit pause. | Preserve paused ownership independently of lease age. The regression backdates a paused job, rejects another scope, confirms no deletion, then explicitly resumes the original scope. |
| G | Fresh backups hashed the newly created SQLite snapshot twice consecutively. | Reuse the just-computed digest for a fresh snapshot. Resumed snapshots still undergo verification; existing resume and corruption tests cover that distinction. |

Two additional test-fixture defects appeared during the broad runs. F's legacy-room fixture performed artificial schema DDL with a zero SQLite busy timeout while read projection maintenance could hold a transaction; it now has a bounded fixture-only wait and awaits complete app disposal before deleting its files. B's signal acknowledgement test assumed live error delivery meant durable persistence; it now explicitly drains the existing persistence queue before asserting unread state. Neither correction increases production deadlines or weakens an assertion. Both affected files passed together (29 tests), and the storage/read/maintenance/backup group plus room tests passed together (41 tests).

The lifecycle, navigation, paging and pause regressions were run against the unfixed code first. These findings extend the [prior review](/reports/performance-scalability-chain-review-2026-09-07.md); they do not relabel its earlier fixes as new work.

# Per-PR disposition

| PR | Review disposition |
|---|---|
| A / 953 | Indexed transaction lookup remains appropriate. No additional source fix found. Its code patch is already in B, but its documentation commits are not ancestors of B. |
| B / 959 | Lifecycle correction and acyclic-message repair added at their earliest owner. Renewed standalone build, typecheck, focused crash/storage tests and Pibo2 HTTP checks. |
| C / 961 | Durable transaction, conflict, fencing and recovery paths reviewed. Inherits B corrections. Concurrency and command regressions are part of the chain tests. |
| D / 964 | Capacity reservations, bounded scheduling and cancellation reviewed. Inherits B corrections. No additional source defect established; synthetic capacity evidence retains its original limits. |
| E / 965 | Telemetry isolation and failure bounds reviewed. Shared-message repair now originates in B; inherited duplicate regression removed. No additional telemetry behavior change. |
| F / 969 | Navigation race and bounded HTTP paging corrected, with failing-before/passing-after tests and renewed candidate checks. Large external payload replay still lacks a complete reference contract. |
| G / 970 | Explicit pause ownership corrected and redundant snapshot hashing removed. Includes inherited corrections and combined-chain verification. |
| H / 971 | Adds this evidence correction. Full capacity proof and successful real-provider acceptance remain open. |

The branches were updated by forward merges, without rewriting existing history. No PR was merged and no controller gateway was changed.

# Validation record

Local builds and tests ran in dedicated Docker workers, never the controller gateway. B's standalone build and typecheck passed, followed by 151 focused admission, storage, Web and crash tests. F's exact candidate build and 19 read/payload/storage tests passed. The combined corrections passed 30 focused regression tests; the initial unchanged-chain baseline passed 47 tests. Counts overlap and must not be summed as distinct tests.

On final G `37129bfa`, all **59 tests** in the six affected test files passed together: signals, shared-room navigation, isolated reads, storage lifecycle, telemetry maintenance and backups. The [complete final focused output](/reports/artifacts/performance-review-20260908/final-tree-tests.txt) and [local run summary](/reports/artifacts/performance-review-20260908/local-checks.json) preserve counts and broad-run failures separately.

The renewed [indexed-admission benchmark](/reports/artifacts/performance-review-20260908/indexed-admission.json) used 1,000,001 synthetic events and 10,000 indexed hits plus 10,000 misses. Hit p99 was 0.123 ms and miss p99 0.087 ms. The old room-scan comparison used only three samples each (hit median 956.6 ms). This demonstrates lookup behavior with a freshly populated database, not cold-cache, HTTP or mixed-load capacity.

| Candidate | Package SHA-256 | Renewed Pibo2 evidence |
|---|---|---|
| B `c49b4f69` | `cc7dc553123ad860b55dc01a2fa1859497d137203f0d83632ee34c471a4ca8a7` | [Public API record](/reports/artifacts/performance-review-20260908/b-public-api.json): legacy HTTP 200 acceptance, ten duplicates sharing one durable stream identity, trace and room-event reads. |
| F `f508c1cc` | `4d5700983126bbf9f07d339cff12f54fc42f61c205b2590f8334e71ce271e9a9` | [Public API record](/reports/artifacts/performance-review-20260908/f-public-api.json): HTTP 202 receipt, ten identical retries and a changed-payload HTTP 409. [Large-page record](/reports/artifacts/performance-review-20260908/f-large-pages.json): twelve 512-KiB bodies retrieved completely across pages of seven and five, each below 4 MiB. |
| G `d24e3efd` | `ebea455549dae0688b92a98d0c95be98b25ee4ff19496704b65dfea64bfa9cb9` | [Public API record](/reports/artifacts/performance-review-20260908/g-public-api.json), [complete large pages](/reports/artifacts/performance-review-20260908/g-large-pages.json), and [11 installed-package maintenance/backup tests](/reports/artifacts/performance-review-20260908/g-installed-maintenance-backup-tests.txt), including paused ownership, disk-full rollback, WAL quotas, cancellation/resume and payload restore. |

Each archive was built and packed from its committed worktree in Docker, transferred unchanged, and installed in an isolated Pibo2 pool lease. The large-page fixture was appended only to the disposable review Session in that lease, then checked through authenticated public HTTPS. The two nonempty pages took 405 ms and 147 ms respectively; this is a correctness check for large pages, not a latency-budget pass.

[Headful Browser Use/CDP checks](/reports/artifacts/performance-review-20260908/browser-checks.json) confirmed that B, F and G could reload the selected Session, display the persisted prompt and expose the Composer. All exposed the provider's `refresh_token_reused` error. Screenshots stay private because the realistic seed's sidebar includes unrelated Session titles. All three leases were released after their checks, and the remote browser was stopped.

Subsequent commits at B and F change tests only; [Git object comparisons](/reports/artifacts/performance-review-20260908/runtime-equivalence.json) confirm that the final B, F and G runtime source, scripts and package manifests are identical to their respective candidate trees. The candidate checks establish correctness of the exercised paths, not complete latency acceptance: G's ten concurrent duplicates took approximately 177–391 ms while scratch maintenance/backup checks also ran on the slot.

Documentation strict, core, migration, index and log checks passed without warnings, and all 84 documentation validator tests passed. Worker validation used a private Git history bundle for traceability because the worktree's controller Git path is not mounted inside Docker. That Git environment was scoped to document validation; validator unit tests use their own fixture repositories.

# Remaining limits

- `StoredChatEvent` has no payload reference. External bodies above its shared 1-MiB hydration limit can still become previews or null on historical replay, although trace payload APIs expose references separately. This predates the new paging repair and is not a claim of full payload-contract compliance. A complete fix needs a coordinated event/SSE/client reference contract and tests for reconnect, authorization and chunk resolution.
- Manual bounded telemetry prune reports scanned rows as `rowsMatched` and reports zero `bytesMatched` in apply mode. Inspect `completed`; one invocation need not finish the job. Dry-run accounting has different semantics. These fields must not be used as evidence of total reclaimed bytes or completed retention.
- Existing workload measurements are disjoint. No new mixed-load or two-hour soak pass is claimed. Real-provider output on the renewed pool seed is blocked by `refresh_token_reused`; admission and persisted error recovery can be checked, successful model streaming cannot.
- The first combined suite was run with an additional compiler/browser workload in a 2-GiB worker. It recorded 2 failures among 2,900 tests (2,888 passed, 10 skipped): the release-test child could not traverse mode-700 source directories, and a cold storage command exceeded its deadline under load. After granting traversal/read access only to the public test/script paths, both files passed in isolation (24 tests). An overlapping typecheck was OOM-killed; the isolated typecheck passed. These failed runs are retained as limitations, not counted as successful acceptance.
- The second broad run recorded 2,889 passes, one failure and ten skips. Its failure was `database is locked` at the fixture's artificial `ALTER TABLE`, not at a product API assertion. The test-only coordination fix above followed that run. Both corrected timing-sensitive tests also passed ten consecutive combined repetitions (20 executions).
- The third broad run recorded 2,889 passes, one failure and ten skips. The acknowledgement test observed `idle` before the error became durable; its persistence-barrier fix was made after that file had already run. Final focused checks cover the corrected files. No single clean full-suite run after the last test-only correction is claimed, and the earlier nonzero suite exits are not relabelled as passes.
