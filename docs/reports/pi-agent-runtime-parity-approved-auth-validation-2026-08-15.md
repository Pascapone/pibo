---
type: "Evidence Report"
title: "Pi Agent Runtime Parity with Pibo2-Managed Authentication — 2026-08-15"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/pi-agent-runtime-parity-approved-auth-validation-2026-08-15.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "409e2f3ec9e401bec0757f1f3a411a8a6248e4e8"
  source_bytes: 8132
  source_sha256: "8b069793182cd06899e6d21e45c60a9825481c49ede977b69b41a64b49b60aaf"
  source_body_sha256: "8b069793182cd06899e6d21e45c60a9825481c49ede977b69b41a64b49b60aaf"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:pi-agent-runtime-parity-approved-auth-validation-2026-08-15"
  published_at: "2026-09-01T07:57:34Z"
---
# Pi Agent Runtime Parity with Pibo2-Managed Authentication — 2026-08-15

**Status:** Pass — task 2.11 and the native-Codex entry gate are complete

**Branch:** `feature/agent-runtime-codex-native`

**Exact candidate commit:** `c764dc0deebcfdec69188970c965580fb404f2ac`

**Candidate package SHA-256:** `a9bf2190f9d94792808d12930715d3993748ca1fed78afc77e6083baa7fa8a8e`

**Baseline commit:** `6b42106620baf3eca688c57a74026ffe974f3c92`

**Model:** `openai-codex/gpt-5.6-sol`, thinking `low`

**Pibo Session:** `ps_4c929c8c-fd90-425e-a9f3-ab70ef5ef5b0`

**Temporary profile:** `pi-real-model-parity-approved-auth`

## Outcome

Pi parity gate 2.11 is closed. An operator authenticated OpenAI through Pibo2 Chat Web Settings, so the credential was created and managed on the target through Pibo's supported OAuth flow. No local OAuth/API credential was copied to Pibo2, and no credential value, account identifier, refresh token, access token, or expiry value was read into this report.

The exact committed candidate passed real-model baseline/candidate text and Bash-tool comparisons, authenticated public Chat Web streaming, persistent Pi binding, gateway restart/resume, prior-tool-history recovery, model/thinking/usage controls, a reversible Fast-mode round trip, product trace checks, and sanitized browser rendering evidence.

No material Pi behavior, event-shape, persistence, streaming, or browser regression was observed. The timing measurements are single bounded samples rather than a statistical benchmark.

## Authentication boundary

A target-side metadata-only check established:

- provider `openai-codex` is configured as OAuth;
- access, refresh, and expiry fields are present;
- target-side Pi auth storage remains mode `0600`;
- the Pibo service environment contains no copied OpenAI/Codex/API-key credential;
- no local credential transfer was used for any admissible result in this report.

The earlier transferred-credential diagnostic route remains excluded and was not repeated.

## Exact candidate

The committed tree was built and packed before deployment:

| Item | Value |
|---|---|
| Commit | `c764dc0deebcfdec69188970c965580fb404f2ac` |
| npm version | `1.7.2` |
| Package SHA-256 | `a9bf2190f9d94792808d12930715d3993748ca1fed78afc77e6083baa7fa8a8e` |
| Pibo2 candidate | `agent-runtime-codex-protocol` |
| Active executable commit | `c764dc0deebcfdec69188970c965580fb404f2ac` |

The candidate was installed under Pibo2's versioned candidate directory and activated through the development-server candidate workflow. The active process and commit were checked before requests, before restart, and after restart.

## Direct baseline/candidate parity

Both packages loaded the same Pibo2-managed OAuth credential in place and executed through the real Pi runtime. The tests did not copy or serialize auth material.

### Text-only turn

Prompt contract: no tool call and one exact marker response.

| Measurement | Baseline | Candidate |
|---|---:|---:|
| Completion | 2,725 ms | 2,159 ms |
| First assistant delta | 2,319 ms | 1,735 ms |
| Exact assistant marker | pass | pass |
| Event count | 21 | 21 |
| Message roles | `user`, `assistant` | `user`, `assistant` |

Both normalized structural sequences were:

```text
message_queued
message_started
assistant_delta
assistant_usage
assistant_message
message_finished
```

### Bash-tool turn

Prompt contract: run Bash exactly once, observe the tool marker, and return one exact assistant marker.

| Measurement | Baseline | Candidate |
|---|---:|---:|
| Completion | 5,424 ms | 5,219 ms |
| First tool start | 2,880 ms | 2,639 ms |
| First assistant delta | 5,012 ms | 4,476 ms |
| Exact tool marker | pass | pass |
| Exact assistant marker | pass | pass |
| Event count | 31 | 31 |
| Message roles | `user`, `assistant`, `toolResult`, `assistant` | identical |

The full structural event sequence, active model, and message-role sequence were equal between baseline and candidate. The candidate was not slower in either bounded sample.

## Public Chat Web turn

A new Pibo Session was created from a custom Pi profile pinned to `openai-codex/gpt-5.6-sol`, thinking `low`, with Bash as its enabled built-in tool.

The first authenticated public-Web turn produced:

- HTTP send status `200`;
- completion in 4,324 ms;
- first tool start in 1,905 ms;
- first assistant text in 3,829 ms;
- exact Bash marker and exact final assistant marker;
- canonical live events for run start, tool call/args/result, assistant text, and run finish;
- idle terminal state with zero queued messages;
- active model `openai-codex/gpt-5.6-sol`;
- a `bound` `pi` runtime binding with a native session id;
- product trace nodes containing the user turn, tool call, and assistant result.

## Restart and resume

The service was restarted only after the first turn became idle.

| Check | Before | After |
|---|---|---|
| Gateway PID | `413943` | `414306` |
| Candidate commit | `c764dc0d…` | `c764dc0d…` |
| Runtime instance / adapter | `pi` / `pi` | `pi` / `pi` |
| Binding state | `bound` | `bound` |
| Protocol | `pi-sdk` `0.80.6` | unchanged |
| Binding revision | `3` | `3` |
| Native-session digest | recorded | identical |
| Product history | 2 messages / 10 events | unchanged |
| Target-managed OAuth metadata | configured | configured |

After restart, the same Pibo Session was prompted without repeating the prior tool marker. The assistant recovered the exact marker from the persisted conversation and returned the required combined marker. The resumed turn used no tool. Durable product trace showed both turns as complete.

The first resume instrumentation attached to live SSE without a cursor and consumed replay from the preceding turn. Its apparent one-millisecond timing was rejected. The submitted resume turn was allowed to settle and was verified from idle status and durable trace. A subsequent cursor-scoped post-restart text turn measured 2,278 ms completion and 1,772 ms to first text, returned its exact marker, emitted no tool event, and ended idle.

## Runtime controls

The resumed Pi runtime returned:

- status: idle, zero queued messages, thinking `low`, active model `openai-codex/gpt-5.6-sol`;
- context usage: present;
- provider usage: present;
- thinking control: supported with `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`;
- model catalog: authenticated `openai-codex` provider and `gpt-5.6-sol` present;
- Fast mode: changed `normal -> fast -> normal`, with the original state restored.

## Trace and browser evidence

`pibo debug trace <session> --check --json` reported:

- runtime instance `pi` and adapter `pi`;
- binding state `bound`;
- product history source;
- terminal status `done`;
- zero error nodes;
- consistency status `ok` with zero issues.

Sanitized screenshot:

- `docs/reports/screenshots/pi-real-model-parity-approved-auth-conversation-pibo2-2026-08-15.png`
- SHA-256 `30c3a0c68885637607268fbc91ccfad441fbea4098c75722dab8e7c0d1baae5e`

The screenshot is cropped to the session content. User identity, room listings, and provider account/quota metadata are excluded. It shows the exact tool turn, exact restart-resume answer, frozen `pi` binding, model, thinking level, idle state, and context usage.

## Validation cleanup

After evidence capture:

- the temporary custom agent was archived and permanently deleted through Chat Web;
- its Pibo Session was deleted and no longer appeared in bootstrap data;
- Context Build returned HTTP `404` for the deleted Pibo Session;
- the temporary native Pi transcript was removed and an exact native-id scan returned zero matches;
- local and remote parity scripts/results under `/tmp` were removed;
- the approved target-managed OAuth credential was intentionally retained for continued Pibo2 development and was not copied or printed.

## Gate decision

Task 2.11 passes. REQ-006 and SC-002 now have authenticated Pibo2 evidence, and native Codex task 9.2 may begin. This decision does not claim any native-Codex runtime behavior; it only removes the Pi-parity prerequisite after approved target-managed authentication and exact-candidate proof.
