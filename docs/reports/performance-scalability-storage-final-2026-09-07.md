---
type: "Validation Report"
title: "Storage isolation: restored integration and renewed Pibo2 acceptance"
description: "Records the corrected asynchronous integration barriers and acceptance of the upstream-integrated storage candidate."
tags: ["performance", "storage", "recovery"]
status: "draft"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-07T07:41:00Z" }
sources:
  - resource: "/reports/performance-scalability-handoff-2026-09-07.md"
  - resource: "/reports/performance-scalability-storage-isolation-2026-09-06.md"
  - resource: "/plans/pibo-performance-and-scalability.md"
---

# Corrected integration

The handoff's eager fixture drain forced retries even when callers intended to test natural recovery. The fixture now separates synchronous `emitOutput()` from explicit `emitOutputAndDrain()`. The app exposes `drain()` for quiescent producers. Before/after V2-write injections wrap `AsyncChatStorage.ingestOutput`; the after-write injection waits for successful worker completion. Natural retry validation waits for the complete durable delivery, including reliability and job acknowledgement, instead of treating the earlier product-store commit as delivery completion.

# Exact candidate and local evidence

Candidate `05b027e92f3e93760621d165c8d7a7ea7256b92a` contains `upstream/dev` at `a6009408`. Docker worker `pibo-dev-performance-storage` retained its 2 GiB memory limit.

- Full build and package prepack passed. Archive SHA-256: `bc8852d294ee5db7712a879c18c97f785824cd6d36d65cff84f1ab950bbcb366`.
- 204 tests passed: full Web channel file (131 tests), storage isolation, V2 ingest, runtime bindings, telemetry retention, six real-process outbox crash boundaries, startup recovery, session quiescence, and restart approval.
- 84 documentation validator/authoring tests passed. Strict documentation, index and log checks passed with no warnings; the worker used private complete Git history to resolve traceability commits.
- An initial standalone TypeScript invocation exhausted its default 1 GiB JS heap. Compilation succeeded with increased heap; the normal full build and prepack subsequently passed with the repository's configured compiler heap.

# Renewed Pibo2 evidence

The checksum-verified package was installed at `/opt/pibo-candidates/performance-storage/05b027e9/runtime` and accepted in full-seed pool lease `lease_69dd4b49590c6bb0b6`, slot-01. The pool's runtime digest is distinct from the package archive checksum. The canonical gateway was not changed. The lease was released successfully at 2026-09-07T07:41:28.488Z.

A fresh session `ps_44edc49b-4605-4fda-827e-2c8af5242df7` used the existing bounded validation profile. Browser Use controlled the existing non-headless Chrome/Xvfb browser at 1431×908; direct CDP captured same-page timing and durable trace evidence. Browser Use's initial text input duplicated a partial prefix; value verification caught it before sending, and an atomic native textarea setter restored the exact intended prompt. Exactly one fresh prompt was sent through the Composer.

- Composer POST: HTTP 200 in 104.1 ms browser time; worker admission 18.63 ms; server ACK 51.50 ms. Runtime startup remains in this package's request path.
- Two successive 20-request duplicate bursts returned the original stream ID `987973`. The retained second burst had 20 duplicate responses, p95 121.0 ms and maximum 121.4 ms. It overlapped the independent health pulse.
- 299 loopback health samples over 15 seconds: all HTTP 200, p95 2.16 ms, p99 2.79 ms, maximum 106.71 ms. This bounded closed-loop pulse is availability evidence, not a capacity or sustained-load SLO proof.
- Exactly one assistant message with output `STORAGE_FINAL_OK` came from product history. It remained visible after reload; the composer remained usable.

[Admission and duplicate samples](artifacts/performance-scalability-storage-20260907/pibo2-acceptance.json), [health samples](artifacts/performance-scalability-storage-20260907/pibo2-health.json), [reload and assistant identity](artifacts/performance-scalability-storage-20260907/pibo2-reload.json), and [headful screenshot](artifacts/performance-scalability-storage-20260907/pibo2-browser.png) preserve the evidence.

# Scope remaining

This closes the handoff's package-B integration gap and renews the focused remote acceptance. It does not close C–H, prove a two-hour soak, approve the full 10-session load profile, or authorize production deployment. PR #953 remains open for package A; the storage PR includes that dependency and targets upstream dev. Durable message commands, fair runtime dispatch, output/telemetry batching, read models, maintenance, and the measured runtime-isolation decision remain required.
