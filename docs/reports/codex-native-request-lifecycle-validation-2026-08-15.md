---
type: "Evidence Report"
title: "Native Codex Approval and User-Input Validation — 2026-08-15"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/codex-native-request-lifecycle-validation-2026-08-15.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "e3c8bb911926d8f837706c12d76b1dbbded59071"
  source_bytes: 9836
  source_sha256: "40ace87ec524d3b70b0784d3d1465a2cf30865d8a57a585dd1bab06268b791a7"
  source_body_sha256: "40ace87ec524d3b70b0784d3d1465a2cf30865d8a57a585dd1bab06268b791a7"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:codex-native-request-lifecycle-validation-2026-08-15"
  published_at: "2026-09-01T07:57:34Z"
---
# Native Codex Approval and User-Input Validation — 2026-08-15

## Scope

This report records native Codex checkpoint 9.6 for `@pasko70/pibo@1.7.2` at implementation commit `b2f90d14421801db0e7e8c947c5f630839d0a0d5`, delivered in PR #494 stacked on turn-lifecycle PR #493.

The checkpoint adds normalized runtime requests over official Codex App Server JSON-RPC:

- stable `item/commandExecution/requestApproval` requests;
- stable `item/fileChange/requestApproval` requests;
- experimental `item/tool/requestUserInput` requests behind explicit configured-instance opt-in;
- `serverRequest/resolved` cleanup;
- generic Pibo status, semantic events, gateway actions, SSE frames, Chat Web controls, and public TypeScript contracts;
- interruption, turn transition, process failure, malformed request, duplicate response, disposal, and stale-response cleanup.

It does not parse terminal output, persist native request ids, or reinterpret the Pi-backed compatibility meaning of `codex`.

## Implemented contract

`CodexNativeRequestController` owns server-initiated requests for one live native Codex session. It validates the exact native thread and active turn before creating an opaque product request id. Native JSON-RPC request ids remain adapter-private and memory-only.

### Request mapping

| Codex App Server surface | Normalized Pibo behavior |
|---|---|
| `item/commandExecution/requestApproval` | `approval_requested` with a redacted command summary and `accept`, `acceptForSession`, `decline`, and `cancel` decisions |
| `item/fileChange/requestApproval` | `approval_requested` with file-change scope and the same official decisions |
| `item/tool/requestUserInput` | `user_input_requested` with bounded questions/options when `experimentalUserInput: true` |
| `serverRequest/resolved` | pending request removed and deferred server response cancelled without a stale JSON-RPC error |
| turn replacement/completion | stale requests expire or clear before the next active turn |
| process/protocol failure | all pending requests resolve as aborted and no late response is written |

Generic routing exposes pending requests only while they exist:

- `PiboSessionStatus.pendingApprovals`;
- `PiboSessionStatus.pendingUserInputs`;
- hidden generic gateway actions `runtime.approval.respond` and `runtime.user_input.respond`;
- `approval_requested`, `approval_resolved`, `user_input_requested`, and `user_input_resolved` output events;
- dedicated Chat SSE frames and a Chat Web request panel.

The Chat Web panel renders approval decisions, bounded request arguments, structured options, free-form answers, and password inputs for questions marked secret. Responses contain only the product request id and decision/answers required by the active request. Execution results do not echo structured answers.

## Capability boundary

Stable command/file approvals are advertised for `codex-native` after this checkpoint.

Structured user input remains experimental and defaults to disabled. It is advertised only for a configured runtime instance with:

```json
{
  "experimentalUserInput": true
}
```

The adapter still initializes App Server with `experimentalApi: false`. The exact process receives only the two official request-user-input config overrides for the selected private instance. Global Codex configuration is not mutated.

Pi behavior remains unchanged. Pi does not advertise either request capability and explicitly rejects the new hidden response actions.

## Security and privacy

- Product request ids are random opaque ids and cannot be used across sessions.
- Native server request ids, environment ids, approval callback ids, private process homes, and binding locators are not projected into Pibo events or UI.
- Request text is redacted and bounded before projection.
- Structured values recursively redact authorization, cookie, credential, token, API-key, secret, and password keys.
- Command network context and proposed policy amendments are included only after recursive redaction so the approval scope remains inspectable.
- Structured answers are validated in memory, sent only to the active App Server request, and are not copied into request-resolution events or execution results.
- Questions marked secret render password inputs. Deterministic tests verify that a secret answer is absent from semantic events and fixture state.
- Interrupt, server-side resolution, turn completion, process failure, and disposal cancel deferred request handlers without writing stale JSON-RPC responses.

## Deterministic validation

Primary coverage:

- `test/codex-native-requests.test.mjs`;
- `test/codex-native-process.test.mjs`;
- `test/codex-native-protocol-checkpoint.test.mjs`;
- `test/chat-runtime-request-stream.test.mjs`;
- `test/chat-ui-runtime-request-panel.test.mjs`;
- `test/chat-ui-runtime-request-stream.test.mjs`;
- `test/web-channel.test.mjs`;
- `test/fixtures/codex-app-server-thread-fake.mjs`.

Covered scenarios include:

1. Config-aware capability advertisement.
2. Command approval with session-scoped acceptance.
3. File approval decline and command cancellation.
4. Invalid, duplicate, foreign-thread, and malformed requests.
5. Structured-input opt-in, listed-option validation, free-form answers, and secret-answer non-projection.
6. Pending status through generic routed orchestration.
7. Generic gateway/API response actions.
8. Dedicated Chat SSE request/resolution frames.
9. Chat Web approval and structured-input rendering.
10. Interrupt and process-crash cleanup with no stale server response.

Final focused protocol/process/thread/turn/request/UI suite:

- 36 tests;
- 36 passed;
- 0 failed.

Final workspace validation:

- `npm run typecheck` — passed;
- `npm run build` — passed;
- canonical full suite — 1,710/1,710 passed across 12 suites;
- `git diff --check` — passed.

## Exact Codex 0.147.0 validation on Pibo2

The exact committed package was installed and activated on the dedicated Pibo2 development service.

Validated artifacts:

- implementation commit: `b2f90d14421801db0e7e8c947c5f630839d0a0d5`;
- package SHA-256: `29c2451b081b7df9315ac07b76eb6d97ba5d4c9be15fb1ea756deb2e7f3e9d97`;
- Codex CLI/App Server: `0.147.0`;
- exact Codex native binary SHA-256: `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40`.

The exact binary used an isolated loopback Responses-compatible provider with deterministic SSE. No OAuth file, API key, access token, refresh token, account metadata, or device code was read, copied, transferred, or emitted.

Exact scenarios passed:

1. Exact-version diagnostics and config-aware request capabilities.
2. Native command execution requested approval, exposed one pending normalized request, accepted the official decision, executed successfully, resolved once, and completed the model loop.
3. Native file change requested approval, accepted the official decision, applied the intended workspace patch, resolved once, and completed the model loop.
4. Experimental native structured input was enabled only for the selected instance, reported the exact question/options, accepted a validated answer, resolved once, and completed the model loop.
5. Interrupt while command approval was pending emitted a cleared request followed by terminal `interrupted`, without a stale client response.
6. Child-process shutdown and restart resumed the same completed native thread and continued with another turn.
7. Runtime directories and config retained private `0700`/`0600` permissions.
8. The global Codex home metadata was unchanged.
9. All owned App Server processes exited; post-validation process count was zero.

Exact package timings:

| Scenario | Elapsed |
|---|---:|
| Command approval and completed tool loop | 269 ms |
| File approval and completed tool loop | 315 ms |
| Structured user input and completed turn | 129 ms |
| Pending-approval interrupt cleanup | 178 ms |
| Child-process restart, resume, and next turn | 321 ms |
| Exact validation scenario total | 1,630 ms |

The public Chat Web candidate reloaded successfully in the authenticated headful browser after activation. The real application shell, selected session, Terminal view, composer, and runtime badge rendered with no browser console warnings or errors. Live native request cards through the public Chat path remain part of the distinct `codex-native` profile and integrated validation checkpoints because this checkpoint intentionally registers no built-in native Codex instance/profile.

## Deliberate boundary after checkpoint 9.6

Still pending:

- native model, reasoning, service-tier, options, and context-usage surfaces (9.7);
- Pibo MCP tools, external MCP, skills, and context delivery (9.8);
- broader native-tool inspection (9.9);
- Pibo-managed subagents (9.10);
- distinct `codex-native` profile/Designer registration (9.11);
- the remaining comprehensive protocol fixture matrix and final Codex contract audit (9.12–9.14);
- public Chat Web live-request interaction and service-restart scenarios after profile integration (10.4 and 10.8).

The coarse approval capability does not claim unsupported MCP elicitation, permission-request, dynamic-tool, attestation, or auth-refresh server requests. Those methods continue to fail explicitly unless a later scoped checkpoint implements them.

## Result

Task 9.6 is complete. Native Codex command/file approvals and explicitly enabled structured user input now flow through official App Server requests, normalized Pibo events/status/actions, SSE, and Chat Web controls. Pending requests are scoped, bounded, redacted, race-safe, and cleared on response, interruption, terminal turns, process failure, and disposal. Exact Codex `0.147.0` evidence proves command approval, file approval, structured input, interruption cleanup, restart/resume, isolation, and process cleanup.
