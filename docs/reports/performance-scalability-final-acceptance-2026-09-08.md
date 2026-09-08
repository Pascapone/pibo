---
type: "Validation Report"
title: "Performance A–H: concurrency and complete large-message acceptance"
description: "Closes the bounded mixed-workload and complete-content acceptance gaps, records Luna low provider execution and OAuth seed isolation, and preserves the deferred soak and statistical capacity limits."
tags: ["performance", "validation", "chat", "concurrency"]
status: "stable"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-08T06:21:00Z" }
sources:
  - id: "plan"
    resource: "/plans/pibo-performance-and-scalability.md"
  - id: "prior-review"
    resource: "/reports/performance-scalability-review-2026-09-08.md"
  - id: "reader-contract"
    resource: "/specs/web/trace-terminal-scrolling-and-workflow-projection.md"
  - id: "seed-contract"
    resource: "/specs/compute/deployment-pool.md"
---

# Decision and scope

The two remaining functional gates from the [independent A–H review](/reports/performance-scalability-review-2026-09-08.md) are addressed: concurrent model work with simultaneous reads/writes, and complete retrieval of large messages. The user explicitly deferred the two-hour soak as a merge/release prerequisite. This report supports merging the corrected PR stack for a trial installation; it does not establish sustained capacity, a 10,000-admission latency distribution, or release-specific package acceptance. No PR was merged and no npm release was published during this validation.

The latest source candidate is `0fe71c72a1d3bcb3b0d06295d323317a452b367a`, including upstream `dev`'s selectable Luna Reserve addition. Remaining fixes are carried by PR 971 on top of the reviewed chain. PR 971 also merges package A's original branch history and acceptance evidence, so its head contains all eight PR heads. The history/documentation integration changes no source, test or build-script bytes relative to the accepted candidate. Merge the integrated head with a merge commit to preserve that ancestry; independently applying A after the later copied patch history would require conflict resolution. Earlier report measurements and failures are preserved, not retrospectively relabeled as successful.

# Concurrent writing and real model responses

[Real-provider evidence](/reports/artifacts/performance-final-20260908/luna-low-concurrency.json) records ten independent agent Sessions receiving simultaneous requests through the public authenticated Chat API on Pibo2. Every Session's active model and reasoning configuration was checked before sending: `openai-codex/gpt-5.6-luna`, `low`. All ten returned their exact expected marker. Up to **five real turns overlapped**; bounded scheduling queued the rest. Sixteen concurrent navigation/history reads succeeded, with no failed reads or model calls. SSE delivered 180 frames. These are short functional calls, not token-throughput measurements. No Sol/high calls were made for this acceptance work.

The [deterministic mixed workload](/reports/artifacts/performance-final-20260908/mixed-load.json) uses real HTTP admission, SQLite writer/read workers, durable outbox and SSE, replacing only the provider boundary with deterministic output. Ten Sessions write concurrently across three rounds: **30 accepted, started and completed turns**, **30 persisted answers**, **600 persisted Tool results**, and more than 3,000 SSE frames, while navigation, history and a slow SSE consumer remain active. The harness asserts completion and persisted counts, so successful HTTP receipts alone cannot pass. Its target during active output is 500 deltas/s and 100 Tool events/s; timer scheduling means this is offered behavior rather than a measured sustained throughput guarantee. Exact timings and resource samples are in the artifact.

This fixture does not exercise the full RuntimeRouter; the real Luna run covers that path separately. The bounded tests found no blocked writes, lost final output or failed concurrent reads. They are not proof that SQLite permits multiple simultaneous write transactions: the implementation still serializes writes, while keeping their work off the main event loop and bounding delivery/read work.

# Complete large messages

The former gap concerned the body of a single large message, separately from paging older messages in the conversation. Infinite scrolling and existing conversation history paging remain available. Large assistant, thinking and Tool events now retain their durable full-content reference in both live delivery and replay, including projection into the Terminal row.

The reader opens a **4-KiB section**, advances and returns through sections without accumulating the entire body in the DOM, and offers a streamed full-content download. Chunk reads use bounded byte ranges for identity payloads and streaming decompression for gzip. Up to three extra bytes preserve UTF-8 characters at a boundary. Neither a chunk request nor download requires a full-buffer read of the external body.

[Public API evidence](/reports/artifacts/performance-final-20260908/large-content.json) reconstructs 1,048,625-byte and 10,485,809-byte Unicode messages exactly by SHA-256 and final marker, verifies complete download hashes, and observes both references after SSE replay. Automated regressions also exercise live delivery and replay for assistant and Tool results, full projection, unauthorized download rejection, and identity/gzip chunk reconstruction.

Headful browser testing found that appending a megabyte, and even shaping one 64-KiB unbroken emoji section, could stall Chrome for seconds. Smaller sections bound this work. The [headful browser record](/reports/artifacts/performance-final-20260908/reader-headful.json) verifies 4,096 bytes in the first section, 4,098 bytes at the next Unicode boundary, exact restoration when returning, and one rendered section. Observed long tasks during opening and paging were 103–186 ms. The [screenshot](/reports/artifacts/performance-final-20260908/reader-headful.png) shows the deployed controls. API reconstruction checks full content independently of what the viewport displays.

# Provider login persistence

After the user completed login, real responses succeeded across canonical Pibo2 gateway restarts. The deployment pool previously copied Pi authentication files; OAuth refresh-token rotation makes such clones unsafe. Pool seeding now excludes OAuth and unknown credential records and permits only explicit API-key records with whitelisted fields. Invalid input cannot replace an existing credential seed. Nine focused pool tests cover the behavior. On Pibo2, automatic copying of the Pi home into deployment seeds is also disabled persistently. Canonical user credentials were not copied or exposed.

This removes the identified seed-cloning failure mechanism. It does not promise that provider credentials can never expire or be revoked externally.

# Local and remote validation

All source implementation, builds and local tests ran in owned Docker workers. The [complete-suite summary](/reports/artifacts/performance-final-20260908/full-suite-summary.txt) records **2,905 tests: 2,895 passed, zero failed, ten skipped**, using the repository's bounded test runner. That complete run covers the backend/read/download fixes at `e1326daa`. Subsequent changes were the 4-KiB reader bound, plain reader labels and the upstream model-catalog addition; the final integrated source passed the build, complete typecheck and 27 focused provider, HTTP live/replay and chunk tests. Web and VS Code webview assets were rebuilt after the final label change.

Two broad-run fixture failures were corrected before the clean run: overly restrictive worker source-file permissions made the unprivileged release fixture unreadable; MCP ownership probes shared a temporary home with another suite's orphan cleanup and now use independent directories. Production deadlines and assertions were not weakened.

Exact-candidate details and final public-path checks are recorded in [candidate evidence](/reports/artifacts/performance-final-20260908/candidate.json). The first earlier activation took longer than the CLI health window against the seeded database; the process subsequently became healthy and completed acceptance. A later restart completed promptly. This observation is not treated as a measured cold-start SLO or silently attributed to a proven cause. The controller gateway was untouched.

# Remaining limits

The two-hour soak is deliberately deferred. A statistically meaningful sustained, open-loop mixed-capacity run remains separate follow-up work. No general claim of unlimited writers, maximum production concurrency or permanent OAuth validity follows from these bounded checks. The ten-Session real-provider concurrency artifact is from `e1326daa`. After the final UI/catalog changes and restart, [two further Luna/low calls](/reports/artifacts/performance-final-20260908/final-luna-low-smoke.json) both passed on the exact candidate. The final deterministic mixed run and full-content/browser checks also use that candidate.
