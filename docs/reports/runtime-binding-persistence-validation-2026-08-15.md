---
type: "Evidence Report"
title: "Runtime Binding Persistence Validation — 2026-08-15"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/runtime-binding-persistence-validation-2026-08-15.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "b06edb7de322dd6c5bd5534b61a45fae1d5d9462"
  source_bytes: 7206
  source_sha256: "ca6fe2ac6e0fe705d1dacac433bf8f57c636d94853db26ec3d1a858e3735d8d2"
  source_body_sha256: "ca6fe2ac6e0fe705d1dacac433bf8f57c636d94853db26ec3d1a858e3735d8d2"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:runtime-binding-persistence-validation-2026-08-15"
  published_at: "2026-09-01T07:57:34Z"
---
# Runtime Binding Persistence Validation — 2026-08-15

**Status:** Passed for migration, compatibility, authenticated API/UI, empty-session and durable-session restart behavior, CAS, debug, signals, and rollback boundary.

## Scope

Validate additive runtime binding persistence against the existing Pibo2 `pibo.sqlite`, the authenticated Chat Web path, Pi transcript identity, fresh-session binding, compare-and-set conflicts, gateway restart continuity, and temporary rollback to the previous Pi parity candidate.

## Candidates and local verification

- Branch: `feature/agent-runtime-bindings`
- Initial implementation candidate: `e2452b8d3fd377eddd0258dd090cab779a625270`
- Validated replacement candidate: `caa81625f8ba2339d099fca4564f94c25c6068fd`
- Package: `@pasko70/pibo@1.7.2`
- Replacement package SHA-256: `6a2a65e1953b55eed7a7ddb8127d48792b16d040f6a9852556fd9e288343fa3a`
- Typecheck: passed.
- Full build/test suite after the restart fix: 1,622/1,622 passed.

## Existing-data migration

### Before activation

- Active candidate: `agent-runtime-pi-parity` at `f369448a8e9055e0248d202eaddaa416e757b06f`.
- `pibo.sqlite` schema version: 3.
- `session_runtime_bindings`: absent.
- Active session rows: 470.
- Non-null Pi ids: 470; distinct Pi ids: 470.
- Integrity check: `ok`.
- Evidence session:
  - Pibo Session: `ps_3b183bfd-48c1-4a6f-84ee-36a93bfbe45f`
  - Pi id: `57923c0e-b7d4-4964-910b-3c4d1b076657`
  - Transcript: `/root/.pi/agent/sessions/--tmp-pibo-agent-runtime-parity--/2026-08-15T00-14-53-664Z_57923c0e-b7d4-4964-910b-3c4d1b076657.jsonl`

### After activation

- `pibo.sqlite` schema version: 4.
- Session rows immediately after migration: 470.
- Binding rows immediately after migration: 470.
- All migrated rows used runtime instance `pi`, adapter `pi`, and state `bound`.
- Pi ids remained 470 non-null and 470 distinct.
- The adapter-scoped unique index exists on `(runtime_adapter_id, native_session_id)`.
- Integrity check remained `ok`.
- The evidence Pibo Session, Pi id, and transcript path were unchanged.
- A previously empty session (`ps_40f21c33-899f-4761-addb-b219b77c0866`) was backfilled as bound Pi with `nativePresenceExpected:false`, allowing lazy creation rather than a false missing-session error.

## Authenticated API and read models

Authenticated machine-key Chat Web requests proved:

- Bootstrap returned HTTP 200 with the evidence session's complete `runtimeBinding`.
- Session navigation metadata included runtime instance `pi`, adapter `pi`, state `bound`, and the same native id.
- `GET /api/chat/sessions/:id/runtime-binding` returned the persisted binding.
- `GET /api/chat/status` reopened the existing Pi transcript and enriched the binding with Pi protocol version `0.80.6`, the existing local-file locator, and persistence metadata.
- The empty migrated session opened successfully and lazily created its reserved Pi transcript without changing its Pi id.

A fresh session created through authenticated Chat Web:

- Pibo Session: `ps_48ff1e37-c333-4d47-a29d-27e10f4f91cb`
- Pi id: `739fe3b8-ab99-4b1f-83a4-f7045423264c`
- Initial binding: runtime instance `pi`, adapter `pi`, state `unbound`, revision 1.
- First status open: state `bound`, protocol version `0.80.6`, local-file locator, revision 2.
- A stale PATCH with expected revision 1 returned HTTP 409 and reported actual revision 2.

## Defect found and fixed during Pibo2 validation

After restarting `pibo-web.service` on the first candidate, the fresh status-only session's empty Pi JSONL had been removed by normal Pi disposal. Candidate `e2452b8d` had already persisted `nativePresenceExpected:true`, so the next status request returned HTTP 500 and changed the binding to `missing` revision 3.

Root cause: the adapter treated creation of an empty Pi session header as durable conversation history. The binding therefore required a native file that Pi legitimately removes when a session has no messages.

The replacement candidate `caa81625`:

- tracks whether the Pi session has conversation messages rather than merely a session-manager header;
- keeps empty reserved Pi sessions reopenable when their disposable empty transcript is absent;
- persists live binding changes after a runtime turn settles, so a user/provider turn changes `nativePresenceExpected` to true;
- retains visible `missing` diagnostics when a real transcript expected to contain conversation history is absent;
- adds deterministic fake-adapter binding evolution coverage and a two-router empty-session restart regression test.

Post-fix evidence:

1. The disposable affected binding was repaired through the authenticated PATCH endpoint from `missing` revision 3 to `unbound` revision 4.
2. Status opened it as `bound` revision 5 with `nativePresenceExpected:false`.
3. After service restart, status again returned HTTP 200, retained the same Pibo/Pi ids, and moved only the locator/revision as Pi recreated the disposable empty file.
4. A real message attempt changed the binding to `nativePresenceExpected:true` revision 7 after the turn settled.
5. The provider turn ended in the pre-existing external `openai-codex` authentication failure; that failure is not counted as model parity evidence.
6. After another service restart, status returned HTTP 200 with the same native id, locator, state, and revision 7, proving durable transcript resume.

## UI, signals, and debug

- Compact Terminal rendered a visible `pi · bound` runtime badge.
- Screenshot: `runtime-binding-terminal-badge-2026-08-15.png` (cropped to omit account identity and unrelated rooms).
- Authenticated signal snapshot included `runtimeInstanceId: pi`, `runtimeAdapterId: pi`, `runtimeBindingState: bound`, and the native session id.
- `pibo debug session ... --json` included the binding state, adapter/instance, native id, protocol version, revision, sanitized locator, and metadata keys without exposing metadata values or credentials.

## Rollback boundary

The server was temporarily reactivated on the previous Pi parity candidate `f369448a` after migration:

- The old candidate started successfully and authenticated bootstrap returned HTTP 200.
- The evidence fresh session retained the same Pibo Session id and Pi id.
- The old schema writer set `PRAGMA user_version` back to 3 but left all 471 additive binding rows intact.

The fixed binding candidate was then reactivated:

- Schema version returned to 4.
- All 471 binding rows remained present.
- The evidence session retained runtime instance `pi`, adapter `pi`, native id `739fe3b8-ab99-4b1f-83a4-f7045423264c`, state `bound`, and revision 7.

This proves the documented compatibility boundary: old Pi-only binaries can ignore the additive table and continue operating Pi rows. They cannot understand future non-Pi sessions, so production rollback after native-harness sessions exist still requires the documented operator decision.

## Remaining uncertainty

The binding milestone itself passed. Full model-dependent Pi parity remains separately blocked by invalid/exhausted provider authentication on Pibo2, reproduced on the pre-adapter baseline. Native Codex work remains gated by the broader Pi parity requirement, not by runtime-binding persistence.
