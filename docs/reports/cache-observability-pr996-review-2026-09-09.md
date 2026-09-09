---
type: "Validation Report"
title: "PR 996 cache observability review and Pibo2 acceptance"
description: "Records the corrected inference ordering defect and Docker and Pibo2 validation of provider cache diagnostics."
tags: ["cache", "review", "validation", "pibo2"]
status: "stable"
authority: "evidentiary"
generated: { by: "openai/codex", at: "2026-09-09T07:52:16Z" }
sources:
  - id: "pull-request"
    resource: "https://github.com/Pascapone/pibo/pull/996"
  - id: "cache-contract"
    resource: "/specs/web/trace-terminal-scrolling-and-workflow-projection.md"
---

# Review

PR 996 was reviewed at `1480f575`. The review found a reproducible inference-ordering defect: when several usage receipts share a millisecond, a delayed repeat of the second receipt selects the third inference as its predecessor. A valid warm-to-cold warning then disappears. The new regression fails on the original PR with `turn:usage:2` instead of `turn:usage:0` as the predecessor.

Commit `a2bc26d0a340723f114e8f4588b0e801d647f2e4` retains each inference's original event sequence and uses it to break timestamp ties in projection and CLI ordering. Compaction boundaries use the same ordering. Regression coverage exercises full replay, incremental patches, live frames, delayed repeats, and same-millisecond compaction.

The first Pibo2 pass additionally exposed display reordering: updating a repeated receipt appended its metric record after later inferences. Commit `5d0f6b19902c1bdb849f589371d83f74911f7c63` sorts each owner's metrics by original completion order. An additional failing-before assertion now verifies the order across replay, incremental patches, and live frames.

The existing cache-read versus cache-write distinction, unknown-counter behavior, conservative thresholds, and lack of causal attribution were inspected. Runtime adapters remain unchanged.

# Local Docker

Worker: `pibo-dev-review-pr996`. The focused baseline passed 96 tests. The new regression failed before the correction. All 13 focused cache/model-inference tests pass after the correction. `npm run build` and `npm run typecheck` pass. The complete suite ran 2,983 tests: 2,972 passed, 10 skipped, and one failed because a release CLI test runs as UID 65534 and could not traverse the 0700-mounted checkout. The unchanged release test file was copied with its helper scripts into a readable directory inside the same worker; all 13 tests passed there. No release code was changed.

An initial direct TypeScript invocation hit Node's default heap limit; rerunning with the repository's prescribed 1200-MiB heap allowance passed. The normal full build also passed. Documentation validation initially could not resolve Git history inside the worker because its worktree Git directory is not mounted. Read-only core, migration, strict, index, and log validation passed from the controller worktree with the complete Git object database; no controller gateway was started or modified.

The final display-order correction passed a fresh full build and 137 focused cache, CLI, trace, live-reducer, and Terminal-row tests. The complete 2,983-test run predates this final one-line sort; it was not repeated.

# Candidate

- Final code commit: `5d0f6b19902c1bdb849f589371d83f74911f7c63`.
- Package version: `1.7.2`, inherited from the PR.
- Package SHA-256: `f1bc16a421bf28c0d7a8274e374349106ef3e30301eaade8182349a3e1e330db`.
- Built in Docker, packed from the completed build using the repository shrinkwrap preparation and cleanup.

# Pibo2 acceptance

The final package ran in `slot-01` at `https://slot-01.pool.pibo2.neuralnexus.me/`, under lease `lease_e39fbed36b4b8960bd`, from 07:39:55 to 07:50:46 UTC on 2026-09-09. Pool runtime fingerprint: `69b6a1242be8ed0a1880c97db0bda1559aec8e073d71567df0c2ab55139a6199`; this is distinct from the archive SHA-256 above. The install helper verified the transferred archive checksum before installation.

The initial `a2bc26d0` candidate ran under lease `lease_477ae85e59d5212557` from 07:35:03 to 07:37:40 UTC. Its [trace response](/reports/artifacts/cache-pr996-20260909/first-candidate-trace.json) exposed the remaining `0, 2, 1` display order, which was corrected locally before installing the final candidate.

## Deterministic persisted scenario

Machine Auth bootstrap succeeded over public HTTPS. A room and empty session were created through the authenticated API. Only that disposable fixture session was seeded directly in the slot database with seven events: one user message, one assistant message, three usage receipts, a repeated second receipt, and completion. All timestamps were identical. The text explicitly identifies the counters as synthetic.

- Room: `room_7eb98229-5d0e-450e-acfd-09ce7cf11828`.
- Fixture session: `ps_dd734d43-847f-41ab-950f-6869466c68bd`.
- Fixture insertion: 07:40:36.172 UTC.
- Read counters: 18,000, 1,000, 0; input: 20,000 each; writes: 200, 300, 0.
- [Authenticated trace API](/reports/artifacts/cache-pr996-20260909/trace-api.json): HTTP 200 in 51 ms for this request; records remain `0, 1, 2` after the delayed repeat. This timing is a smoke observation, not a performance benchmark.
- [Installed CLI](/reports/artifacts/cache-pr996-20260909/cache-cli.json): three inferences, 60,000 input, 19,000 cache reads, 41,000 uncached input, 500 cache writes, one possible-drop warning.
- [Bounded CLI output](/reports/artifacts/cache-pr996-20260909/cache-limit.json): `--limit 1` returns inference 2 rather than the repeated inference 1.
- [Trace consistency check](/reports/artifacts/cache-pr996-20260909/trace-cli.json): `status: ok`, no issues.

Assertions compared CLI order and totals against the authenticated API response. The warning retains inference 0 as the predecessor of inference 1.

## Headful browser

Browser Use operated the supervised Pibo2 Chrome through loopback CDP forwarded over SSH. Chrome DevTools inspected the same browser. The real public Chat Web page showed three metric rails in the correct order and exactly one `90.0% → 5.0%` warning. Opening its disclosure displayed the previous inference, zero elapsed time, separate read/write counters, and the explicit lack of causal attribution.

The view was inspected at 1440×900 and 390×844. Neither viewport had horizontal document overflow. The [mobile screenshot](/reports/artifacts/cache-pr996-20260909/mobile.png) shows the expanded disclosure and wrapped metrics. Reload at 390×844 retained the three ordered metrics and single warning. Chrome DevTools reported no warning/error console messages during the final inspection. Desktop screenshot evidence remains local to avoid publishing unrelated seeded room names.

A slot resource snapshot near the end was 569.3 MiB / 1.5 GiB, 17 PIDs and 2.67% CPU; this is not sustained-load evidence.

## Live-provider acceptance

Before the user renewed provider authentication, a Browser Use send was verified against the complete composer text and persisted user message. These initial attempts did not obtain a successful provider response:

1. Session `ps_a910786b-4481-4117-abfe-06b6d221f577` used the seeded `base` default `openai-codex/gpt-5.6-sol`. Its durable receipt became interrupted before runtime binding. A separate diagnostic request established the concrete error: configured authentication for that provider is missing in the slot. The interrupted command was not replayed.
2. In a fresh session, `ps_0b24edc0-4598-45ca-90b5-6089d3fe9014`, the model was explicitly changed through the API to `openai/gpt-5.4-mini`, which the catalog advertised as auth-configured. The provider rejected authentication. The receipt reached `failed`, and the persisted trace showed `Provider authentication failed.` The [resulting cache inspection](/reports/artifacts/cache-pr996-20260909/provider-failure-cache.json) correctly remains unknown with no cache-drop warning.

Codex Native was unavailable in this slot because its executable was not installed. The user subsequently authenticated the providers on canonical Pibo2. A fresh default lease (`lease_be3021994409baea82`, 08:05:36–08:06:40 UTC) still lacked Pi authentication: the operator pool configuration had an empty `PIBO_COMPUTE_POOL_SEED_SOURCE_PI_HOME`. For the next acquisition only, this variable was set to `/root/.pi` on Pibo2. The existing pool seeding mechanism transferred the canonical Pi auth into the isolated slot with restricted file permissions; no credentials were printed or committed, and the persistent pool configuration was not changed.

The exact final candidate then ran under lease `lease_cca13374517a66bad5`, created at 08:06:48.485 UTC, with the same runtime fingerprint. In session `ps_30ebb65e-1375-4078-a6da-f46e6f0c5c76`, two authenticated public API sends to the Pi runtime's default `openai-codex/gpt-5.6-sol` completed successfully:

- First request accepted at 08:07:04.685 UTC and completed at 08:07:09.219 UTC (4.534 seconds); HTTP enqueue response took 167 ms.
- Second request accepted at 08:07:28.250 UTC and completed at 08:07:30.197 UTC (1.947 seconds); HTTP enqueue response took 42 ms.
- Both returned exactly `PR996_REAL_USAGE_OK`. An intermediate trace showed the first answer streaming before completion.
- [Live provider CLI evidence](/reports/artifacts/cache-pr996-20260909/live-provider-cache.json) reports two ordered inferences with 1,997 and 2,025 input tokens, nine output tokens each in the trace API, and zero cache reads/writes. The API and CLI agree on input/cache counters and ordering; the second inference references the first as predecessor without a warning.
- [Live trace consistency check](/reports/artifacts/cache-pr996-20260909/live-provider-trace-check.json) passed.

Successful live-provider usage is therefore verified. These short requests did not produce positive provider cache hits, so genuine provider cache-hit/drop behavior remains unverified; warning behavior is covered by the deterministic persisted scenario. This feature acceptance does not establish integrated release readiness.

## Cleanup

All four task-owned isolated leases were released; the [live-test release record](/reports/artifacts/cache-pr996-20260909/live-lease-release.json) covers the successful provider retest; the [final release record](/reports/artifacts/cache-pr996-20260909/lease-release.json) records the exact final candidate and release time. The task-owned Browser Use connection and remote headful browser were stopped. No controller gateway was restarted or deployed, and the PR was not merged.
