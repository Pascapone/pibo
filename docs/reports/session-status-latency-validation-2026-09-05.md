---
type: "Validation Report"
title: "Session status latency validation — 2026-09-05"
description: "Records the external quota bottleneck, bounded status-cache correction, Docker regressions, and headful Pibo2 status and queue measurements."
tags: ["performance", "sessions", "terminal", "pibo2"]
status: "stable"
authority: "evidentiary"
generated:
  by: "process:session-latency-ps1f203c85"
  at: "2026-09-05T20:34:00Z"
evidence:
  id: "session-status-latency-2026-09-05"
  published_at: "2026-09-05T20:34:00Z"
sources:
  - id: "implementation"
    resource: "../../src/auth/openai-codex-usage.ts"
  - id: "regressions"
    resource: "../../test/openai-codex-usage.test.mjs"
  - id: "issue"
    resource: "https://github.com/Pascapone/pibo/issues/923"
---

# Outcome

The focused status-cache correction passes local Docker and exact-package, authenticated headful Pibo2 acceptance. Repeated `/status` action median changed from **490.8 ms** to **28.3 ms** in the observed samples, a 94.2% reduction. The candidate's first quota fetch still took **351.4 ms**; this is not a claim that cold status initialization is instantaneous.

This is one completed investigation within the broader Session/Room/Terminal performance effort. Large-session switching, optimistic behavior under navigation races, and extended streaming remain unproven. No production deployment, release, or merge was performed.

# Reproduction and change

`getStatusSnapshot` in the Pi runtime awaited a fresh external Codex quota request on every invocation. The quota helper had no cache, coalescing, failure backoff, or HTTP timeout. Each baseline sample returned a distinct `providerUsage.fetchedAt`. A stalled advisory quota endpoint could therefore delay otherwise-local status.

Implementation commit **8300578c**, based on `upstream/dev` **d3632593**, adds:

- One credential-hashed snapshot shared across Sessions; no raw credentials retained in the cache.
- A 30-second refresh/backoff interval and stale-while-revalidate response.
- A five-minute maximum stale age, in-flight request sharing, and two-second HTTP abort deadline covering response consumption.
- Cache invalidation when credentials change or disappear.
- Unchanged live Session fields: processing, queue depth, context usage, and model are not cached.

The deadline bounds the quota HTTP request, not runtime startup or OAuth credential resolution. Cold misses can still wait for quota; stale values retain their original `fetchedAt`. Provider failure may omit quota after the maximum stale age. This cache is advisory, not a provider-enforcement mechanism.

# Local Docker evidence

Worker/worktree: `pibo-dev-session-latency-ps1f203c85`, `.worktrees/session-latency-ps1f203c85`.

- New quota regressions failed before implementation: repeated requests, blocking stale refresh, failed refresh behavior, and missing abort deadline.
- `npm run build`: passed.
- `node --test test/openai-codex-usage.test.mjs test/session-actions.test.mjs test/agent-runtime-auth.test.mjs`: **37 passed, zero failed**.
- `NODE_OPTIONS=--max-old-space-size=1536 npm run typecheck`: passed across root and package/UI typechecks.
- The initial direct `npx tsc` attempt exhausted the worker's default approximately 1 GB Node heap. It was not a passing check; the bounded 1536 MB rerun passed.
- `npm pack`: passed. Full repository test suite was not run in this pass.
- Documentation validation runs on the controller worktree because the worker cannot resolve the host's Git worktree metadata. Strict validation remains blocked by three pre-existing missing PNG links in `session-native-workflow-transition-validation-2026-09-05.md`; this pass does not fabricate or replace that unrelated evidence.

# Pibo2 target and measurements

All times are UTC on September 5, 2026. One non-headless Chrome/Xvfb browser was authenticated through public HTTPS using Machine Auth. Browser Use drove navigation; Chrome DevTools MCP/CDP inspected DOM, Resource Timing, screenshots, and console. No controller gateway was modified.

Baseline canonical target: `https://pibo2.neuralnexus.me`, installed candidate `vscode-resize-pointer/b601b6e0`, reported package version `1.7.2`.

- Room: `room_2fee9b4d-a447-441e-b9a7-21ca0dd87d2a`.
- Session: `ps_f29f1c3d-8b5f-4ec1-98f7-d0ff55702fa9`.
- Model: `openai-codex/gpt-5.3-codex-spark`, no fallback models.
- Initial `/status` composer submission at 20:16:51: **1068.6 ms** HTTP duration, **1065.7 ms** server wait.
- Five subsequent actions at 20:17:14–20:17:16: **490.8, 449.5, 566.1, 920.7, 469.4 ms**.
- Room and Session creation earlier in the same browser: **14.7 ms / 18.2 ms**.

Candidate target: `https://slot-01.pool.pibo2.neuralnexus.me`, medium-seeded isolated lease `lease_be45c89b86d16dc517`, holder `ps_1f203c85-5c7c-46b3-bb1e-0aedc730c3c7`.

- Runtime: `/opt/pibo-candidates/session-latency/8300578c/runtime`.
- Package SHA-256: `22c2dcff7610879b084fb5739eadac9b213e317b8b007dcff63fc6d76fdecfc3`.
- Pool runtime identity hash: `eadb06a55a6d5138c91bc9a8d605f584bf6be1ad1fc0bce454bd22d7e04da8ac` (distinct from the package archive checksum).
- Room: `room_6a3d085b-d44b-4daf-83c4-d35ac45f5dc7`.
- Session: `ps_5d168a03-61f8-4322-a1ba-3c3aef662691`.
- Model: `openai-codex/gpt-5.3-codex-spark`, no fallback models.
- At 20:28:53: first quota-bearing status **351.4 ms**; five warm actions **72.0, 28.1, 24.7, 28.3, 37.8 ms**, all with identical quota `fetchedAt`.
- Real composer `/status` at 20:29:21: request **29.8 ms**, new rendered status card **45.5 ms** after click.
- During a real tool/queue turn at 20:30:05: status reflected **processing=true, queue=1**; browser action duration **91.9 ms**, fetch-to-parsed-result wall time **138.3 ms** while tracing/streaming.
- After completion: **processing=false, queue=0**, status wall time **25.0 ms**. Quota `fetchedAt` advanced in the background, proving expired quota did refresh.

These are small observational samples on two different application revisions and seeded targets, not a controlled statistical benchmark attributing every millisecond solely to this patch. The deterministic tests independently establish the eliminated external-request dependency on warm/stale status paths.

# Real queue and persistence checks

Both environments executed a bounded bash `sleep 4; printf ...` turn and a queued reply-only second turn, using only Spark.

- Baseline: first `message_finished` **20:26:17.057**, queued `message_started` **20:26:17.072**: **15 ms** drain gap.
- Candidate: first `message_finished` **20:30:10.944**, queued `message_started` **20:30:10.955**: **11 ms** drain gap.
- Candidate initial/queued message acknowledgments: **64.1 / 30.1 ms**.
- The second turn naturally waited for the active four-second tool and first model turn; this is not an avoidable queue delay.
- An earlier automation attempt clicked Send during a running turn but left the Queue/Steer choice dialog open. It was later explicitly submitted after the first turn finished and is excluded from queue-drain measurements.
- Candidate product-history trace: **16 nodes, zero errors, checks OK**. Both final markers remained visible after reload and the composer was usable.
- No console warnings/errors observed in the sampled candidate window.

The reported intermittent ten-second queue delay was **not reproduced** by these short tests. Do not close that broader investigation based on the 11–15 ms drain gaps.

# Artifacts and limitations

Artifacts: [measurements](artifacts/session-status-latency-2026-09-05/measurements.json), [baseline screenshot](artifacts/session-status-latency-2026-09-05/baseline-status.png), [candidate screenshot](artifacts/session-status-latency-2026-09-05/candidate-status.png), [baseline events](artifacts/session-status-latency-2026-09-05/baseline-events.json), [candidate events](artifacts/session-status-latency-2026-09-05/candidate-events.json), and [trace check](artifacts/session-status-latency-2026-09-05/candidate-trace-check.txt).

DevTools performance recording was attempted during the candidate real turn, but `performance_stop_trace` returned no analysis or saved trace file. No CPU profile, long-task conclusion, or flame-chart evidence is claimed. DOM and Resource Timing evidence above were collected separately. Resource Timing buffers filled during the initial exploratory run; later probes explicitly cleared/increased them.

The isolated lease was released after acceptance, as recorded in the measurements artifact. The canonical Pibo2 gateway remained unchanged. Follow-up should profile large-history Sessions and navigation under active streaming, including the unexplained initial bootstrap samples near 2.8–2.9 seconds on the canonical target, without confusing them with this quota-only fix.
