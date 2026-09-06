---
type: "Validation Report"
title: "Idle Session history latency validation — 2026-09-05"
description: "Records runtime-free history inspection, passive Terminal status, bounded fork caching, and Docker plus headful Pibo2 performance evidence."
tags: ["performance", "sessions", "terminal", "pibo2"]
status: "stable"
authority: "evidentiary"
generated:
  by: "process:large-session-latency-ps1f203c85"
  at: "2026-09-05T21:29:00Z"
evidence:
  id: "idle-session-history-latency-2026-09-05"
  published_at: "2026-09-05T21:29:00Z"
sources:
  - id: "implementation"
    resource: "../../src/agent-runtimes/pi/history.ts"
  - id: "router"
    resource: "../../src/core/session-router.ts"
  - id: "regressions"
    resource: "../../test/cold-fork-candidates.test.mjs"
  - id: "issue"
    resource: "https://github.com/Pascapone/pibo/issues/925"
---

# Outcome and scope

Opening the largest inspected historical Session no longer initializes a Pi runtime just to discover fork candidates or display background usage. On Pibo2, the observed cold fork request changed from **4398.7 ms to 307.2 ms**; five candidate warm reads had a **35.2 ms median**. The complete 78-candidate response matched the canonical response byte-for-byte. Viewing both this history and a new empty Session left **zero live runtimes**.

These are small observational samples across different revisions and seeded environments, not controlled estimates attributing all navigation latency to this patch. The fix is scoped to idle history inspection and passive Terminal reads. It does not establish that bootstrap, streaming, optimistic updates, or the intermittent ten-second queue delay are fixed. No release, merge, or controller deployment was performed.

# Cause and implemented correction

The Terminal requested fork candidates while opening a Session. `getSessionForkCandidates` unconditionally called `getOrCreateSession`, initializing the full harness and its resources before reading historical user messages. Current `upstream/dev` also polled the Terminal usage header through an activating status snapshot; fixing only fork inspection would leave that second activation path.

Commits **3d96adca** and **bfb31e40143ea149cf77917d787adaf477539f51**, based on `upstream/dev` **b3bda5ef**, implement:

- Optional adapter-owned persisted fork inspection. The router uses it only for a matching bound fork-capable adapter with no live, pending, disposing, or quiescing runtime and outside shutdown. It rechecks runtime absence, workspace, and full binding after the await. Concurrent live runtimes win; unsupported reads use the existing fallback.
- Pi version-3 JSONL streaming inspection preserving all native user entry IDs, order, branches, duplicate prompts, and SDK text concatenation. Unsupported headers fall back rather than migrating or rewriting the file.
- One defensive-copy cache entry with at most 2 MiB of candidate text and ID payload. Native identity, path, device, inode, size, modification time, and change time participate in invalidation; the file fingerprint is rechecked before caching. This is a payload cap, not a claim that JavaScript object overhead is included.
- Passive header status (`activate=false`) that neither creates absent runtimes nor resets idle eviction timers. Inactive usage remains unknown; live runtime status and explicit `/status` behavior remain available.
- Fork queries deferred until loaded trace data contains user messages. Header query identity also tracks selected Session status transitions.

A provisional uncached reader reduced the cold request to 493.1 ms but rescanned the 21-MB file on every read. That warm-path disadvantage was measured on Pibo2, corrected in Docker, and revalidated with the final package. The unrelated quota-cache PR #924 is not included in this candidate; live status can still await quota.

Normative owners: [generic adapter contract](/specs/runtime/adapter-contract.md), [Pi adapter](/specs/runtime/pi-adapter.md), and [Terminal projection](/specs/web/trace-terminal-scrolling-and-workflow-projection.md).

# Local Docker verification

Worktree: `.worktrees/large-session-latency-ps1f203c85`. Worker: `pibo-dev-large-session-latency-ps1f203c85`.

- Cold persisted-read and passive-status tests failed against the original implementation before their respective fixes.
- Final `npm run build`, `NODE_OPTIONS=--max-old-space-size=1536 npm run typecheck`, and `npm pack`: passed.
- Final focused command: **228 passed, zero failed**, covering the following files:

```text
node --test test/cold-fork-candidates.test.mjs test/session-router-store.test.mjs \
  test/session-actions.test.mjs test/agent-runtime-history.test.mjs \
  test/agent-runtime-boundaries.test.mjs test/runtime-routed-session.test.mjs \
  test/web-channel.test.mjs test/chat-ui-terminal-header-usage.test.mjs \
  test/chat-ui-message-delivery-keyboard.test.mjs
```

New coverage includes zero runtime opens, unchanged binding, fallback, concurrent runtime precedence, candidate parity and read-only behavior, defensive cache copies, same-size rewrites with restored mtime, passive API forwarding, explicit activation, and preservation of the existing idle timer. The complete repository suite was not run.

A yielded command monitor was stopped by host memory-pressure policy. The actual Docker process continued; the chained build/typecheck/test logs reached the successful 228-test summary. The monitor failure itself is not reported as a passing run.

# Exact Pibo2 candidate and seeded history

All observation times are UTC on September 5, 2026. Browser Use drove a non-headless Chrome/Xvfb browser at 1431 × 908; Chrome DevTools/CDP supplied DOM, Resource Timing, and a saved sampling CPU profile. Authentication used the configured Machine Auth identity over public HTTPS. No controller gateway was touched.

- Exact source: `bfb31e40143ea149cf77917d787adaf477539f51`.
- Archive SHA-256: `19af74b35d496871e330f8ecefbdfd9124a77fc5dd69a1f95b4a6bad97f6c8e4`.
- Installed runtime: `/opt/pibo-candidates/large-session-latency/bfb31e40/runtime`.
- Isolated full-seeded lease: `lease_d5cd7267256f30593c`; pool runtime hash `de73277a3ac156b714320e7c326481d17a888826f27f8953503b517599cabaeb` is distinct from the archive checksum.
- Historical Session: `ps_069cced9-7902-4b10-8bd6-279d7b98ece1`, with 16,005 events, in Room `room_209cf2ff-6b46-4705-a216-a6d2138604bd`.
- Matching native transcript: 21,023,113 bytes; SHA-256 `c486c0f90709f4bc3061f7386cbf02e49c88c690adf490aa99b664a130c12d2c`, unchanged after acceptance.

Pool full seeding copies product data and native auth but not native transcripts. A first provisional probe therefore failed with missing native history and is excluded from timing acceptance. For the final lease, only the matching transcript was copied from canonical Pibo2 into the slot before its first browser visit. No native transcript or credentials are published in these artifacts.

| Measurement | Canonical `b601b6e0` | Final candidate |
|---|---:|---:|
| Cold fork response | 4398.7 ms | 307.2 ms |
| Warm fork response samples | 49.4, 38.8, 37.8 ms | 35.2, 35.2, 35.8, 34.9, 33.8 ms |
| Candidate count / serialized response bytes | 78 / 602419 | 78 / 602419 |
| SHA-256 of serialized response | `cc432307a4a7fb373d087922e091a5630f7446379d2fedee219c5f9bc611c52c` | identical |

Candidate cold passive header status took 33.2 ms and returned `runtimeActive: false`. A later warm full-page navigation measured bootstrap 164.4 ms and timeline 66.6 ms; browser navigation to composer plus mounted virtual rows took 781.6 ms. That last number is not SPA Session-switch latency or proof of complete historical rendering.

The saved CPU profile spans 5756.1 ms, largely idle/program sampling. It supports inspection, not an inferred bottleneck from minified function names or a claim of a controlled before/after CPU comparison.

# Real Sessions, queue, switching, and persistence

A new Room was created in 13.8 ms; its two Sessions were created in 22.1 and 21.5 ms through authenticated APIs. These measure response latency, not optimistic creation UI timing.

- Room: `room_8caab97c-74e0-4ec9-8769-61f9f3e96d9d`.
- Session A: `ps_eb4a92b9-df92-434b-aabf-9ca9fff7732b`.
- Session B: `ps_16510943-6252-43e4-926f-b644506fa69c`.
- Both explicitly use `rt-pi-spark`, selecting only `openai-codex/gpt-5.3-codex-spark`, with no fallback.

A executed bounded sleep-12 and sleep-30 tool probes and two reply-only turns. The first second-message submission occurred too late for a contention measurement. During the sleep-30 probe, processing was confirmed true, the Queue choice was explicitly clicked, and six real sidebar clicks switched A/B while the tool remained active.

- Initial/queued acknowledgments: **55.5 / 48.9 ms**.
- Predecessor `message_finished`: **21:21:15.723**; queued `message_started`: **21:21:15.734**; drain gap **11 ms**.
- Trace check: **14 nodes, zero node errors, zero issues**.
- Last first/queued reply markers remained present after reload, with a usable composer and no alert banner.
- Only A had an idle runtime after completion; empty B and the large historical Session remained inactive.

The six clicks reached matching route/sidebar selection plus composer in 23.5–44.3 ms. The probe did **not** wait for the correct Terminal trace; these are shell-selection timings only. Queue text was absent in immediate A-selection snapshots, then present in the completed trace. This is an investigation lead for transient loading or optimistic-message loss, not a proven defect or a passing trace-ready switching benchmark.

Live status requests of 1116.8 and 610 ms and a bootstrap request of 817 ms remain relevant follow-up measurements. Long Resource Timing durations for SSE endpoints represent stream lifetimes, not request-processing delays. The intermittent ten-second queue drain was not reproduced.

# Published artifacts and remaining work

- [Measurements, checks, exact identities, and timing caveats](artifacts/idle-session-history-latency-2026-09-05/measurements.json).
- [History screenshot](artifacts/idle-session-history-latency-2026-09-05/history-desktop.png) and [completed queue screenshot](artifacts/idle-session-history-latency-2026-09-05/queue-desktop.png).
- [Saved CDP CPU profile](artifacts/idle-session-history-latency-2026-09-05/history.cpuprofile).
- [Queue events and trace check](artifacts/idle-session-history-latency-2026-09-05/queue-events-and-check.txt).
- [Sidebar switch probe](artifacts/idle-session-history-latency-2026-09-05/switch-probe.json).

The broader performance goal remains active. Next evidence should measure correct-trace readiness, queued-message visibility during switching, and streaming preservation. The native streaming benchmark and wider responsive acceptance were not executed in this focused pass. Historical missing workflow screenshots are not reconstructed or fabricated by this work.
