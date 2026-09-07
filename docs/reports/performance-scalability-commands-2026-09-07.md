---
type: "Validation Report"
title: "Durable message admission: package C validation"
description: "Records versioned durable receipts, startup dispatch recovery, UI confirmation semantics and the candidate acceptance evidence."
tags: ["performance", "admission", "recovery"]
status: "stable"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-07T08:35:34.027058Z" }
sources:
  - resource: "/plans/pibo-performance-and-scalability.md"
  - resource: "/reports/performance-scalability-storage-final-2026-09-07.md"
  - resource: "/specs/web/composer-delivery-files-and-media.md"
---

# Candidate and boundary

Commit `cf81614fef17fd32ccf48427e2a2065ba8845cf7` in `performance-commands` builds on the accepted storage branch. Docker worker `pibo-dev-performance-commands` has a 2 GiB memory limit. This package introduces schema v10, versioned early HTTP 202, durable receipt/dispatch state, fenced startup recovery and distinct browser acceptance feedback. The [composer admission contract](/specs/web/composer-delivery-files-and-media.md#requirement-web-composer-admission-006) owns the implemented behavior and rollback boundary.

# Local evidence

- Full Docker build passed. The corrected candidate’s combined 189-test run passed across the complete Web channel suite, command store, storage isolation, all six real-process outbox crash boundaries, runtime restart, runtime binding and V2 store/ingest contracts.
- 27 additional schema, Composer and status contract checks passed. The final ten command/UI checks, overlapping those suites, also passed, including independent dispatcher processes, four process-exit boundaries and browser uncertainty classification.
- Browser TypeScript checking and all 84 documentation validator/authoring tests passed. Strict documentation, index and log checks passed before the remote pass. The command-store tests prove duplicate identity and conflict, no event on overload, fencing after expired ownership, FIFO with equal timestamps, separate Steering and no replay of uncertain execution.
- A fixture that previously emitted before its first HTTP request had not exercised the claimed timing overflow. It now seeds 501 timing records directly and verifies the count. Recovery fixtures seed durable work before startup; persistence-dependent assertions explicitly drain instead of sleeping.
- The startup subscription is bound to the Channel context once. A new request does not resubscribe and re-run output recovery.

# First remote candidate and correction

The first checksum-verified archive for `9ace914c` was `c41265bb31b33c12db11cebd3c034dfa6558b454b2a7f07363cfda7a4efed1c7`. It ran in full-seed Pibo2 slot-01, lease `lease_f7d10e6e37f595d36b`, from 08:17:16Z until its release at 08:26:10Z. This isolated deployment did not modify the canonical or controller gateway.

The real headful Composer returned 202 in 79.8 ms on the first send (server ACK 33.12 ms), then 25.2 ms on the warm send (server ACK 8.71 ms). Twenty concurrent duplicates retained one receipt and one accepted stream identity, with p95 128.6 ms. Changed content under that key returned 409. Four completed real messages, including one bounded terminal sleep, remained visible and receipt-completed after reload. A further pair of immediately accepted commands completed in FIFO order after a 20-second tool wait. A 15-second independent loopback health pulse during warm execution returned 293/293 HTTP 200, p95 2.16 ms, p99 25.24 ms, maximum 200.66 ms. These are bounded samples, not capacity or sustained-load SLO evidence.

[Initial admission](artifacts/performance-scalability-commands-20260907/initial/pibo-commands-cold.json), [duplicate identity](artifacts/performance-scalability-commands-20260907/initial/pibo-commands-duplicates.json), [warm admission](artifacts/performance-scalability-commands-20260907/initial/pibo-commands-warm.json), [health](artifacts/performance-scalability-commands-20260907/initial/pibo-commands-health-warm.json), [reload](artifacts/performance-scalability-commands-20260907/initial/pibo-commands-reload.json), [headful rendering](artifacts/performance-scalability-commands-20260907/initial/pibo-commands-reload.png), and [lease release](artifacts/performance-scalability-commands-20260907/initial/pibo-commands-release.json) preserve the first pass.

This candidate was not promoted: a follow-up Docker assertion found that product history lacked a stable Turn ID before the first runtime output. A reload therefore retained the accepted text but could not attach its receipt badge. The correction persists the Pibo input identity at acceptance, preserves existing runtime status instead of marking acceptance as running, avoids an idle dispatcher write transaction, and applies the connection's existing lock wait before the initial schema read. Concurrent opener and pending-history regressions cover these boundaries. The remote command scripts also encountered a repeated top-level JavaScript variable declaration; the attempted empty send produced no request, and scoped evaluation restored the intended input before the successful warm send.

# Final remote gate

The corrected committed candidate `cf81614fef17fd32ccf48427e2a2065ba8845cf7` passed acceptance in isolated Pibo2 slot-01, lease `lease_5e618753e7164cd56d`. The exact locally built archive has SHA-256 `b13c77f552e20c7e35c0d28fd8acdfff272dd9e12b0ce6ef92d40bbc147965f8`. The lease was released after evidence capture; canonical and controller gateways were untouched.

Two immediate authenticated posts returned HTTP 202 in 18.5 and 28.2 ms. During a real 45-second terminal tool call, reloaded history retained the first receipt as running and the second as accepted. Headful mobile inspection at 390 × 844 confirmed the pending badges. Both executed in FIFO order. A third message sent through the real headful Composer returned HTTP 202 in 15.6 ms, with server ACK 8.00 ms and append 5.72 ms. After another reload, all three receipts were completed, exactly three expected assistant outputs were present in product history, and no errors were present.

Twenty concurrent retries of the second key returned 202 with one receipt and duplicate identity; p95 was 105.3 ms. Changed content returned 409. An independent 15-second loopback health pulse returned 300/300 HTTP 200, p95 2.075 ms, p99 9.638 ms, maximum 16.191 ms. These samples establish this functional acceptance boundary, not sustained-load capacity or the plan's full SLO profile.

The seeded provider credentials first produced explicit failed receipts and visible failure feedback. Successful model acceptance required refreshing only the owned slot's access credential through encrypted stdin, without copying refresh capability or modifying controller credentials. A separate MiniMax attempt remained pending and is not counted as successful provider evidence. Releasing the isolated lease cleaned up that attempt.

[Admission](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-setup.json), [pending receipts](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-pending.json), [headful mobile pending state](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-mobile.png), [Composer network timing](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-network.json), [duplicate/conflict probes](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-duplicates.json), [health pulse](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-health.json), [reloaded results](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-result.json), [headful desktop reload](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-reload.png), and [lease release](artifacts/performance-scalability-commands-20260907/final/pibo-commands-final-release.json) preserve the final pass.

Packages D–H remain open; provisional bounds in C do not establish the fair-runtime capacity gate.
