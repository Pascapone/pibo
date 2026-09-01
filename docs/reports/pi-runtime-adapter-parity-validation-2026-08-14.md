---
type: "Evidence Report"
title: "Pi Runtime Adapter Parity Validation"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/pi-runtime-adapter-parity-validation-2026-08-14.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "da07f77a7e53cabc9d4c5346cc52e70e5ac31a0c"
  source_bytes: 7076
  source_sha256: "7721225f8e02668d3e2d5af5bcce1a74d3184bafda9a91954b9ac8f246949850"
  source_body_sha256: "7721225f8e02668d3e2d5af5bcce1a74d3184bafda9a91954b9ac8f246949850"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:pi-runtime-adapter-parity-validation-2026-08-14"
  published_at: "2026-09-01T07:57:34Z"
---
# Pi Runtime Adapter Parity Validation

**Status:** Local parity passed; authenticated Pibo2 structural/restart parity passed; real-model scenarios blocked by provider credentials/quota
**Date:** 2026-08-15
**Branch:** `feature/agent-runtime-pi-parity`
**Validated implementation commit:** `af90539e`
**Validated candidate commit:** `f369448a8e9055e0248d202eaddaa416e757b06f`
**Dependency:** PR #476 (`feature/agent-runtime-foundation`)

## Implemented boundary

- `PiboSessionRouter` now owns product session lookup, queue lifecycle, correlation, signals, telemetry hooks, subagent hierarchy, run control, and output distribution through `RuntimeRoutedSession`.
- `RuntimeRoutedSession` consumes only `AgentRuntimeSession` and capability-gated controls. It has no direct Pi/Codex package or adapter import.
- Pi runtime assembly and routed Pi behavior now live under `src/agent-runtimes/pi/`.
- The Pi adapter owns event normalization, prompt settlement, skill expansion, run-reminder tool scope, context-guard continuation, durable provider recovery, transcript-integrity continuation, fast-mode patches, compaction, status, models, thinking, provider/context usage, and native session controls.
- `src/core/runtime.ts` and `src/core/routed-session.ts` are explicit deprecated compatibility facades only.
- Existing direct JavaScript compatibility tests can still inspect the Pi runtime handle through the generic routed-session compatibility property.
- Deprecated `pi_event` output remains opt-in through adapter-declared compatibility metadata rather than an adapter-id branch in generic orchestration.

## Deterministic non-Pi proof

A registered fake adapter now routes through the production `PiboSessionRouter` without a Pi compatibility handle. Tests prove:

- queued prompts remain ordered;
- assistant events correlate to the active Pibo message id;
- status comes from the generic runtime session;
- unadvertised native clone control fails with `AgentRuntimeCapabilityUnavailableError`;
- generic runtime/router source files do not import Pi, Codex, or adapter implementations.

## Local verification

| Check | Result | Evidence |
|---|---|---|
| Root/workspace typecheck | Pass | `npm run typecheck` |
| Build | Pass | `npm run build` through `npm test` |
| Focused extraction/parity tests | Pass: 99/99 | Registry/fake, generic routing, Pi steering/actions/recovery/compaction/quiescence/subagents/transcript/fast mode |
| Full suite | Pass: 1,609/1,609 | 12 suites, 0 failures, 322.1s |
| Import boundaries | Pass: 2/2 | `test/agent-runtime-boundaries.test.mjs` |
| Generic fake routing | Pass: 2/2 | `test/runtime-routed-session.test.mjs` |
| Existing Pi reopen fixture | Pass | Same requested Pi id and transcript file reused by `createPiboRuntime` compatibility facade |

## Authenticated Pibo2 evidence

The exact candidate was installed under `/opt/pibo-candidates/agent-runtime-pi-parity/f369448a8e9055e0248d202eaddaa416e757b06f/runtime` and activated through the Pibo candidate workflow. The authenticated Chat Web browser used the real public Pibo2 application and persisted product/session data.

| Check | Result | Evidence |
|---|---|---|
| Candidate identity | Pass | Gateway environment reported `PIBO_DEPLOY_CANDIDATE=agent-runtime-pi-parity` and exact commit `f369448a…`; package version `1.7.2` |
| Fresh product session | Pass | Created Pibo Session `ps_3b183bfd-48c1-4a6f-84ee-36a93bfbe45f` in a dedicated room/workspace |
| Native Pi identity | Pass | Pi id `57923c0e-b7d4-4964-910b-3c4d1b076657` and its original JSONL path remained stable across candidate/baseline swaps and gateway restarts |
| Restart/reopen | Pass | After each gateway restart, status returned idle with the same workspace, active model, Pi id, session file, and leaf id |
| Runtime catalog | Pass | Authenticated Agent Catalog exposed enabled embedded runtime instance `pi` with adapter id `pi` |
| Context inspection | Pass | Context build returned six runtime-owned top-level nodes, 81 total nodes, approximately 7,047 tokens, zero warnings/errors, and the expected profile/workspace |
| Session controls | Pass | `status`, `session.current`, `session.list`, `session.tree`, `thinking`, `fast_mode`, and `abort` returned through Chat Web APIs; thinking remained `high`, MiniMax correctly reported fast mode unsupported |
| Trace reconstruction | Pass | `pibo debug trace ... --check --json` reported `checks.status=ok`; browser timeline reconstructed user, execution, and normalized error nodes |
| Debug inspection | Pass | `pibo debug session ... --events --json` preserved product id, Pi id, room/workspace, and ordered reliability events |
| Browser rendering | Pass | Authenticated Terminal view displayed the new room/session, selected profile/model, composer, trace rows, and idle/processing transitions |
| Accepted-message latency | Observed | First candidate message POST returned in 42 ms; active processing was visible in 244 ms. Completion timing cannot be compared while providers are unavailable. |

### Provider availability blocker

Real assistant/tool/skill/MCP/subagent turns could not complete on either the pre-existing Pibo2 candidate or the parity candidate on August 15, 2026:

- the stored `openai-codex` OAuth credential had expired and refresh returned `Failed to refresh OAuth token for openai-codex`; both binaries emitted the same normalized `provider_auth_failed` error;
- the only other stored provider credential, MiniMax, returned HTTP 429 with provider code 2056 (`Token Plan usage limit reached`) for both `MiniMax-M2.7-highspeed` and `MiniMax-M3`;
- the pre-existing candidate `feature-terminal-image-preview-v3@6b421066…` was reactivated and reproduced the same failures before the parity candidate was restored, so this is not an adapter-extraction regression;
- an OpenAI device authorization flow reached the provider sign-in page, but the isolated machine browser had no authenticated OpenAI/Google account. No credentials or tokens were copied or exposed.

The failed provider turns still verified normalized auth/rate-limit errors, retry/recovery transcript persistence, abort handling, restart cleanup, trace projection, and debug inspection. They do not constitute evidence for successful streaming or tool execution.

## Remaining parity gate

The following Pibo2 checks still require one usable model provider credential or restored quota:

- successful real streamed Pi turn and Pi built-in tool call;
- selected skills/user skills, context files, MCP, subagents, and run reminders;
- Loop execution and model-backed restart continuation;
- model-backed compact/fork/clone/tree/switch scenarios where safe;
- startup, first-delta, completion, and end-to-end timing comparison against the pre-existing candidate.

There is no known Pi adapter regression in local tests or the available authenticated Pibo2 paths. Native Codex work remains unstarted at this milestone; later work may proceed only while preserving this explicit external validation gap and must return to close it when provider access is restored.
