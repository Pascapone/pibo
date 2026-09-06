---
type: "Validation Report"
title: "Gateway status scaling validation — September 6, 2026"
description: "Records removal of redundant ancestor reads and exact-candidate Pibo2 status, safety, streaming, and Queue acceptance."
tags: ["sessions", "signals", "performance", "gateway"]
status: "stable"
authority: "evidentiary"
generated:
  by: "openai/codex"
  at: "2026-09-06T03:00:00Z"
sources:
  - id: "local"
    resource: "/reports/artifacts/gateway-status-scaling-2026-09-06/local-parent.cpuprofile"
    title: "Local parent CPU profile"
  - id: "samples"
    resource: "/reports/artifacts/gateway-status-scaling-2026-09-06/pibo2-setup-and-samples.json"
    title: "Exact Pibo2 setup, verified models, and status samples"
  - id: "active"
    resource: "/reports/artifacts/gateway-status-scaling-2026-09-06/active-flow.json"
    title: "Active tool, Queue, status payloads, restart-safety output, and visible switching"
  - id: "stream"
    resource: "/reports/artifacts/gateway-status-scaling-2026-09-06/streaming-benchmark.json"
    title: "Native 18-second real Spark streaming observation"
  - id: "events"
    resource: "/reports/artifacts/gateway-status-scaling-2026-09-06/events-and-check.txt"
    title: "Native accepted inputs, turn timestamps, and trace checks"
  - id: "code"
    resource: "scope:Commit 7e68cb0fdc69d0f91e469ea86123d273dbf0613c"
    title: "Validated router implementation and regression tests"
---

# Result and scope

Issue #933 is addressed by using the already-listed Session records to calculate ancestor depth during known-session signal projection. This removes one store read per Session/ancestor per projection. The normal gateway-status CLI no longer exceeded its three-second deadline in the tested 29-runtime case. No timeout, public response schema, telemetry field, or restart-safety condition was changed.[^code]

This is not completion of the broader Session/Room/Terminal performance objective. It does not incorporate the independent quota, passive-history, initial-visibility, viewport, or creation fixes in PRs #924, #926, #929, #931, and #934. The intermittent ten-second Queue drain remains unreproduced. No merge, release, or controller deployment was performed.

# Cause and local proof

`createGatewayRuntimeStatuses()` requests a signal snapshot for each live runtime. Each router snapshot projects known Sessions. Previously, that projection listed all records and then used `getSubagentDepth()` to read each record and ancestor again. `PiboDataSessionStore.get()` prepares a joined SQLite query on every call. In the local profiled batch, SQLite preparation accounted for **1187.9 ms** of exclusive sampled time, with another **393.2 ms** attributed to garbage collection; store reads and row parsing also contributed.[^local]

The candidate creates a per-projection read-only lookup from the complete list. Other depth consumers still read live storage. There is no cross-request cache or freshness window. Parent-first sorting, missing-parent/cycle handling, and the complete signal projection remain intact.

The local probe uses real in-memory SQLite `PiboDataStore`, `PiboDataSessionStore`, router, and HTTP channel with 511 stored root Sessions. Only the list of idle runtime-status identities is synthetic; it does not create or prompt model runtimes.

| Runtime-status count | Parent HTTP time | Candidate HTTP time | Parent individual reads | Candidate individual reads |
|---|---:|---:|---:|---:|
| 1 | 63.7 ms | 14.8 ms | 511 | 0 |
| 10 | 695.3 ms | 81.6 ms | 5,110 | 0 |
| 29 | 1606.8 ms | 193.3 ms | 14,819 | 0 |

Full-list counts remain 1/10/29 respectively. The patch does not eliminate repeated full-list projection across runtimes and does not establish constant-time scaling.

The committed regression fails on the parent with **514 individual reads instead of zero** for a 511-record fixture containing a parent chain. The candidate passes, includes a newly stored child on the next snapshot, and preserves an active tool-argument telemetry snapshot and queue depth of two exactly. Separate depth checks cover roots, missing records/parents, self-parenting, and two-node cycles.[^code]

# Exact candidate and Pibo2 method

- Code: `7e68cb0fdc69d0f91e469ea86123d273dbf0613c`, based on `b3bda5ef0a61ff93babeae6f3e91b59c02e41a28`; npm package `1.7.2`.
- Locally built archive SHA-256: `293e83051bbd2a9235d58aa1df013472d02546164bba463d7b9724d750bdabf3`.
- Installed runtime: `/opt/pibo-candidates/gateway-status-scaling/7e68cb0f/runtime`; full-seed lease `lease_16ad9f675b5d12c5f7`, slot-01. Pool fingerprint `fdd2c2e10c6c9c68484a0cf33ef746875fccb1108818849036fd77e1439a70a5` is not the archive checksum.
- Archived and installed `dist/core/session-router.js` both hash to `67b9ff1b11a765e31e45822f70744c10b60ee6d84a299ac0337eb7daf5ac81e1`.
- Official Machine Auth helper authenticated the existing supervised headful browser on the slot's health page before creating test data, avoiding accidental historical runtime activation. All subsequent Chat work used the public HTTPS/authenticated path.
- Created 29 owned `rt-pi-spark` Sessions, explicitly activated them through status reads, and verified every active model as `openai-codex/gpt-5.3-codex-spark`. Six real turns ran across two of these Sessions, with a fresh model check before each submission. No historical Session was prompted.
- Browser Use handled navigation/screenshots; Chrome DevTools/CDP captured streaming, input, visible content, authenticated requests, and console evidence at 1431×908 and 390×844.
- Owned worker and lease were released after idle checks; lease release was `2026-09-06T02:54:53.115Z`. Browser returned to canonical Pibo2. No gateway restart was attempted.[^samples]

# Remote status and contention

| Check | Earlier unchanged-backend Pibo2 observation | Candidate |
|---|---|---|
| 1 live runtime, three status samples | Not sampled | 71.1 / 62.8 / 71.1 ms |
| 10 live runtimes, three samples | Not sampled | 142.2 / 133.8 / 126.1 ms |
| 29 live runtimes, initial three samples | 3663.9 / 3214.8 / 3571.4 ms | 292.3 / 250.5 / 299.2 ms |
| 29 live runtimes, later sequential samples | Same earlier parent set | 410.5 / 387.7 / 274.9 ms |
| Three concurrent status reads | 3390.2 / 6736.2 / 9899.6 ms | 248.9 / 403.5 / 710.1 ms |
| Health request issued 100 ms into that burst | 10079.6 ms | 608.2 ms |
| Normal CLI at 29 idle runtimes | Three-second safety-status timeout | Completed, correct mode/count, idle safety state |

The later sequential candidate responses and parent responses were both **21,100 bytes**, with no active runs or processing/streaming/queued work. Parent observations were captured earlier during #933 diagnosis, not from a newly concurrent parent slot. These are bounded observations with independently created Sessions and ordinary environmental variation, not population percentiles. Initial candidate samples used separate Node clients; the later set used sequential requests in one client like the parent timing command.[^samples]

The diagnosis does not imply that all web traffic shared the slow path: earlier authenticated navigation and message admission remained fast during status contention. No provider-latency improvement or root cause for the original ten-second Queue report is inferred from these measurements.

# Active-work safety and real user flow

A second explicitly named tool/Queue pair was used to automate the entire active-load sequence without operator gaps. While Spark executed `sleep 20`, three concurrent status requests took **270.8 / 431.3 / 703.7 ms**. Every response retained the actual processing Session, queue depth **1**, and active telemetry. The normal CLI reported processing/streaming true and **restart safety: blocked**. No restart command was issued.[^active]

During that same active interval, trusted pointer input switched to the other Session and back on mobile. Both targets required correct route/identity plus identifiable content intersecting the scroller and passing an occlusion check. The other Session showed its real `STATUS_TARGET_B` reply; returning showed the active tool/queued input marker in the source Session. Observed waits were **360.0 / 103.6 ms**, including CDP and readiness-poll overhead, not paired navigation speedups. [Active mobile screenshot](/reports/artifacts/gateway-status-scaling-2026-09-06/active-mobile.png).

| Real Queue pair | Queue accepted UTC | Predecessor finished UTC | Successor started UTC | Drain |
|---|---|---|---|---:|
| Initial tool/Queue | 02:45:45.833 | 02:46:05.488 | 02:46:05.499 | 11 ms |
| Automated status-load pair | 02:49:44.407 | 02:50:03.732 | 02:50:03.742 | 10 ms |

All timestamps are September 6, 2026. The intentional tool wait is not dispatch lag. These samples do not prove the intermittent ten-second Queue delay solved.[^events]

# Streaming and persistence

An 18-second native benchmark around the real 80-paragraph Spark response recorded **21 text deltas / 3528 bytes**, 28 overlay updates, 34 live trace computations totaling **3.9 ms**, and 11 Markdown renders totaling **52.7 ms**. There were **zero Long Tasks**, warnings, render-order findings, or regressions. RAF gap p99 was **16.8 ms**, maximum **33.3 ms**. Benchmark-relative first-visible time includes the operator's pre-submission interval and is not TTFT.[^stream]

Full desktop reload restored all five source-Session assistant outputs, including the complete streamed output in timeline `inlinePayloads.output` and both tool/Queue reply pairs. The final queued reply was visibly inside the viewport, not merely present in mounted text. Native trace checks reported no issues. Console inspection found no warnings/errors. Final CLI showed 29 idle runtimes, no active yielded runs, and idle restart safety. [Desktop reload](/reports/artifacts/gateway-status-scaling-2026-09-06/desktop-reload.png).

# Reproduction and limits

- Docker `npm run build` and `npm run typecheck` passed at the exact code. **109 focused tests passed**: `session-router-store`, `signal-registry`, `gateway-restart-safety`, and `chat-signals-api`. Full repository suite and integrated release gates were not run.
- The final build monitor was PSI-stopped at 5.03. The independent Docker pipeline completed; its explicit exit 0 and complete build/typecheck logs were checked separately. The monitor itself failed.
- Initial local test setup reused a Pi ID and was corrected before meaningful regression capture. A raw-store reparent assertion was not a valid success precondition for existing signal-root behavior; no reparenting fix or public-app reproduction is claimed. The fresh-view test instead adds a newly stored child.
- Initial manually separated status snapshots missed the short stream and first tool's active window. They are not active-load evidence. The published automated flow performs submission, Queue, status load, safety check, and navigation in one bounded sequence and verifies active flags explicitly.
- Parent/candidate CPU profiles, probe sources, complete status payloads, streaming state, timeline, build/tests, and screenshots are published alongside this report. Probes retain run-specific paths/IDs and require a fresh isolated authenticated target before reuse; they are not general production scripts. Text-log trailing whitespace was normalized; structured values were preserved.
- No cache/TTL or persisted-data mutation was introduced by the implementation. Missing-parent and cycle behavior remains the same. Repeated full-list work remains a scaling limit for much larger active populations.
- Documentation core/migration/index/log checks and 84 focused documentation tests passed in the worktree (Docker Git-metadata limitation). `npm run docs:validate` / strict retains only the three pre-existing missing screenshots in the September 5 Session-native workflow report; missing evidence was not fabricated.

[^local]: Source `local`; paired profile and query-count artifacts are in the same directory.
[^samples]: Source `samples`; full setup, active-model verification, and each initial status response. Parent, final, contention, and release artifacts sit alongside it.
[^active]: Source `active`; exact real submissions, active status payloads, CLI safety output, and trusted-pointer workflow.
[^stream]: Source `stream`; native browser streaming counters, RAF, Long Tasks, and render-order observations.
[^events]: Source `events`; accepted input and native lifecycle timestamps, with trace reconstruction checks.
[^code]: Source `code`; listed-view depth traversal and committed no-reread/semantic regression tests.
