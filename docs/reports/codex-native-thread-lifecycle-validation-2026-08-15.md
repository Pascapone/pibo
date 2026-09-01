---
type: "Evidence Report"
title: "Codex Native Thread Lifecycle Validation"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/codex-native-thread-lifecycle-validation-2026-08-15.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "0a09d535d9aea27fb0311d548b3f155e544c71d3"
  source_bytes: 9718
  source_sha256: "1210869ff32e772b84e2d1544d49ac58dd141d0451807cc3f7edc693d8d88423"
  source_body_sha256: "1210869ff32e772b84e2d1544d49ac58dd141d0451807cc3f7edc693d8d88423"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:codex-native-thread-lifecycle-validation-2026-08-15"
  published_at: "2026-09-01T07:57:34Z"
---
# Codex Native Thread Lifecycle Validation

**Date:** 2026-08-15

**Status:** Pass — task 9.4 complete

**Branch:** `feature/agent-runtime-codex-thread`

**Implementation commit:** `1155529a85bdbc9d80049d8d413ad0ed5abdc011`

**Pull request:** #492

**Stacked on:** Codex process/isolation PR #491 at `465a5cc7`

**Candidate package SHA-256:** `7c21d5d0cc78f70e929eede24f1c9edb85fc7cadfd032d888b0516b7c1b9309f`

**Protocol:** official Codex App Server `0.147.0`, stable v2 JSONL, `experimentalApi: false`

## Scope

Task 9.4 adds the first native Codex runtime driver and session implementation without registering a built-in runtime instance or profile. The checkpoint implements only capabilities proven through stable App Server methods:

- fresh `thread/start` and exact thread-id binding;
- revisioned Pibo binding persistence through the existing router CAS path;
- exact `thread/resume` for bound durable threads;
- missing-thread detection without silently creating a replacement thread;
- stable `thread/read` and `thread/list` normalization;
- supported `thread/fork` and full-history clone behavior;
- adapter-owned native history inspection, pagination, cursor scoping, and redaction;
- runtime session status, capability-gated controls, idempotent disposal, and access to the private typed client for later checkpoints.

The driver advertises lifecycle and history capabilities only. Text turns, streaming events, tools, MCP delivery, skills, context, models, reasoning controls, approvals, compaction, and context usage remain explicitly unsupported until tasks 9.5 and later. The existing Pi-backed `codex` meaning is unchanged, and no `codex-native` profile is registered by this checkpoint.

## Lifecycle and binding behavior

The adapter follows the frozen binding contract:

1. An `unbound` Pibo Session starts one native thread and returns a `bound` binding containing the exact native thread id, stable protocol metadata, and an opaque `adapter-resolved` locator with no value.
2. A `bound` Pibo Session resumes only its recorded native thread id.
3. Binding inspection uses stable `thread/read` and returns `missing` when the exact App Server reports `thread not loaded`, `thread ... not found`, or `no rollout found` variants.
4. A missing binding is never repaired by calling `thread/start` implicitly.
5. The existing router persists initial and changed bindings with revisioned compare-and-swap semantics.
6. Fork and clone update only the live session binding; the router owns persistence of that changed binding through the generic control path.

### Exact `0.147.0` empty-thread boundary

The exact binary returns a fresh thread immediately, but before the first user turn its native rollout is not yet durable or discoverable through `thread/list`. The adapter therefore merges the current live thread and successful live forks into the normalized list without inventing a native id or transcript. If the process exits before the first turn materializes native history, a later resume reports the binding as missing and Pibo does not create a replacement.

This boundary does not weaken the restart requirement: REQ-015 requires restart continuity after a completed turn. Task 9.5 will materialize the first real turn before integrated service-restart validation in task 10.4.

`thread/list` receives every stable source kind explicitly. This avoids the App Server's omitted-filter behavior, which includes only interactive sources, while remaining safe because each configured runtime instance has a private Codex home.

## Native history behavior

`src/agent-runtimes/codex-native/history.ts` maps stable `thread/read` results into Pibo-owned history entries without exposing Codex protocol types through the generic SPI.

Coverage includes:

- user and assistant messages;
- reasoning summaries and content;
- command execution as normalized tool messages;
- failed turns and safe error summaries;
- deterministic oldest-to-newest pagination;
- `beforeTimestamp` filtering;
- opaque cursor envelopes scoped to Pibo Session, runtime instance, adapter, and native thread;
- rejection of malformed or cross-thread cursors;
- redaction of bearer values, tokens, keys, secrets, passwords, JWT-shaped values, command output secrets, and native working paths;
- unavailable-history inspection and empty fallback pages for missing native state.

Native history remains a compatibility, resume, import, and debug surface. Pibo product history remains authoritative for normal product-visible conversation history.

## Code and deterministic coverage

Primary code:

- `src/agent-runtimes/codex-native/adapter.ts`
- `src/agent-runtimes/codex-native/thread.ts`
- `src/agent-runtimes/codex-native/history.ts`
- `src/agent-runtimes/codex-native/redaction.ts`
- `src/agent-runtimes/codex-native/protocol-types.ts`
- `test/codex-native-thread.test.mjs`
- `test/fixtures/codex-app-server-thread-fake.mjs`

The deterministic child-process fixture mirrors the exact binary's important lifecycle boundary: newly started empty threads are process-loaded but not durable, while seeded or forked threads are persistent. Tests prove:

- truthful driver capabilities and profile validation;
- exact stable missing-thread error variants;
- fresh start, binding, live listing, disposal, and empty-thread missing behavior after restart;
- resume of a durable exact thread id;
- normalized and redacted native history;
- bounded pagination and cursor isolation;
- stable list, fork-at-turn, and clone controls;
- missing binding/history fallback without replacement creation;
- router restart with a durable binding and deletion-to-missing transition;
- initial unbound-thread binding compare-and-swap under concurrent creation.

## Local verification

### Focused protocol/client/process/thread suite

Command:

```text
node --test \
  test/codex-native-protocol-checkpoint.test.mjs \
  test/codex-native-client.test.mjs \
  test/codex-native-process.test.mjs \
  test/codex-native-thread.test.mjs
```

Result:

- tests: 31
- pass: 31
- fail: 0
- duration: 3,477.625 ms

### Typecheck and build

The authoritative sequential commands passed:

- `npm run typecheck`;
- `npm run build`.

The repository's configured 1.2-GB TypeScript heap was retained. No parallel typecheck was used.

### Full suite

After the successful build, the canonical isolated test runner passed:

- suites: 12
- tests: 1,691
- pass: 1,691
- fail: 0
- duration: 350,042.665 ms

`git diff --check` also passed before the implementation commit and before the documentation commit.

## Exact Pibo2 verification

The exact committed package was packed locally, checksum-verified on Pibo2, extracted without activation, and exercised against the pinned official binary. The development gateway was not restarted or replaced.

Validated binary:

- version: `codex-cli 0.147.0`;
- binary SHA-256: `cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40`.

The persistent test thread used a private deterministic rollout matching the official tagged Codex test-fixture shape, with one canonical completed turn and sanitized validation text. This allowed stable lifecycle/history verification without sending a model request, reading authentication state, or transferring credentials.

Exact verification established:

- availability diagnostics returned `codex_native_home_ready` and `codex_native_available` for `0.147.0`;
- a fresh unbound session started and returned an exact bound thread id;
- the fresh loaded thread appeared in the adapter's normalized list even though the server had not materialized its rollout;
- after the fresh process closed, the unmaterialized binding became `missing` rather than creating a replacement;
- a durable official-format thread was discovered, resolved, resumed, and read through stable methods;
- native history contained normalized user and assistant entries;
- fork at the stable canonical turn created a distinct thread;
- full-history clone created another distinct thread;
- the source, fork, and clone all appeared in normalized native-session listing;
- the clone resumed with the same native id after its owning process closed;
- deleting clone, fork, and source caused later binding resolution and history inspection to report missing;
- configured-instance home mode was `0700` and the deterministic rollout mode was `0600`;
- no locator value, transcript path, configuration value, account metadata, or credential value was emitted;
- the invoking user's global Codex-home state was unchanged;
- the development gateway remained active at the same main PID (`414306`);
- Codex App Server process count was `0` before and `0` after validation;
- temporary package, process, rollout, and validation state was removed.

Measured timings:

| Operation | Time |
|---|---:|
| Availability/version diagnostics | 61 ms |
| Fresh thread start and bind | 253 ms |
| Durable binding resolution | 181 ms |
| Durable thread resume | 209 ms |
| Fork at canonical turn | 47 ms |
| Full-history clone | 55 ms |
| Deleted-thread missing detection | 195 ms |

No authentication file or credential value was read, copied, printed, or included in the evidence.

## Result

Task 9.4 passes. Pibo can now start and bind native Codex threads, resume durable exact thread ids, expose truthful list/fork/clone controls, map native history safely, persist binding changes through the generic CAS path, and fail closed when native state is missing.

The next checkpoint is task 9.5: stable turn start, steering where supported, assistant/reasoning/item/tool/usage event normalization, terminal completion/failure, and interrupt. Integrated authenticated completed-turn restart validation remains task 10.4.
