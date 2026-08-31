---
type: "Historical Record"
title: "Spec: Runtime-Neutral Provider Authentication Control Plane"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["runtime-auth-control-plane", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Spec: Runtime-Neutral Provider Authentication Control Plane

**Status:** Ready for review
**Created:** 2026-08-16
**Requester / Source:** Active multi-agent runtime adapter goal
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `../../capabilities/runtime-provider-authentication.md`, `../multi-agent-runtime-adapters/spec.md`

## Why

The current Chat Web provider-auth path bypasses runtime selection and invokes Pi credential code directly. Native Codex therefore cannot be authenticated from Pibo's product UI, per-runtime account state is not visible, and missing status can be misrepresented as authenticated.

## Goal

Chat Web MUST become a runtime-neutral provider-auth control plane that routes every operation to an explicit configured runtime adapter and reports truthful, secret-safe state for that target.

## Scope

### In Scope

- Runtime auth SPI and contract validation.
- Adapter-neutral registry/router dispatch.
- Pi compatibility through the Pi adapter.
- Stable native Codex App Server 0.147.0 account operations in private homes.
- Product-scoped Web API and per-runtime settings UI.
- Safe legacy session-bound action compatibility.
- Auth-aware Agent Designer and model menus.
- Deterministic, integrated, and Pibo2 readiness evidence.

### Out of Scope

- Credential synchronization or account federation.
- Real OAuth approval during automated validation.
- Production deployment, merge, release, or npm publication.
- Unstable/internal Codex token-injection APIs.

## Requirements

### REQ-001: Explicit adapter auth contract

The runtime SPI MUST expose capability-backed status, login start, progress/completion, API-key setup, cancellation where claimed, and logout operations using Pibo-owned types.

#### Acceptance

- Registration rejects inconsistent capability/method combinations.
- Unsupported operations fail explicitly without adapter-name branching or Pi fallback.

### REQ-002: Product/account-scoped routing

The Web settings API MUST require an explicit runtime instance for mutations. Read operations MUST return all configured targets or one explicit target. An arbitrary or missing Pibo Session ID MUST NOT bypass target selection.

#### Scenario: Conflicting compatibility target

- GIVEN a legacy session-bound action with a frozen runtime binding
- WHEN params also name a different runtime instance
- THEN Pibo rejects the conflict.

### REQ-003: Per-runtime catalog and states

The settings UI MUST derive providers and methods from runtime inspection, identify the default runtime, explain credential scope, and show connected, disconnected, pending, partial, unsupported, and failed states.

### REQ-004: Pi parity

The Pi adapter MUST preserve existing device-code/browser/API-key/status/logout behavior and model authentication semantics. Existing action names and legacy `state` input remain accepted, but product responses use opaque Pibo flow IDs and omit account identifiers.

### REQ-005: Native Codex managed auth

`codex-native` MUST implement stable `account/read`, device-code and API-key `account/login/start`, login completion notification handling, cancellation, and logout through an adapter-owned App Server process in its private configured-instance home.

#### Acceptance

- Pending processes close on terminal outcome, timeout, cancellation, or adapter disposal.
- `account/read` after process restart reports the persisted state.
- No global Codex or Pi credential location is read or mutated.

### REQ-006: Isolation and no secret leakage

Two configured instances of an adapter declaring `runtime-instance` MUST remain credential-isolated. An `adapter-shared` mutation MUST be labeled as shared and recycle sessions for every affected instance. Product types, output events, bindings, diagnostics, logs, reports, and snapshots MUST omit native login IDs, separate OAuth state/verifier fields, credentials, account identifiers, and credential paths/contents. Ephemeral verification URLs/user codes are UI-only and MUST be excluded from captured evidence.

### REQ-007: Truthful model surfaces

Agent Designer and model menus MUST use provider status from the selected runtime. Missing status for a runtime that declares auth MUST evaluate as unauthenticated or failed, not authenticated.

### REQ-008: Validation and handoff

Focused tests, typecheck, build, and the canonical full suite MUST pass. A focused unmerged PR MUST be pushed. The exact candidate MUST be installed on Pibo2 and the public provider settings page MUST be ready for the user to start native-Codex login while the runtime remains unauthenticated.

## Edge Cases

- Malformed and mismatched App Server responses.
- Process exit or timeout during pending login.
- Completion notification after cancellation.
- Logout while sessions are cached.
- Disabled/unknown runtime and unknown provider.
- Partial Pi provider configuration.
- Two same-adapter instances with different statuses.

## Constraints

- **Compatibility:** Do not alter Pi bindings, profiles, transcripts, or native behavior.
- **Security:** Do not copy, inspect, print, or persist credentials outside adapter-owned stores.
- **Protocol:** Native Codex uses stable official App Server v2 only.
- **Environment:** Work in the focused clean worktree; validate on disposable Pibo2 only.

## Success Criteria

- [x] SC-001: Every runtime auth action reaches the selected adapter instance and reports that target.
- [x] SC-002: Pi behavior remains compatible, including device, browser-PKCE, API-key, status, and logout paths.
- [x] SC-003: Native Codex official auth matrix passes deterministically with isolation and restart persistence.
- [x] SC-004: Web settings and model surfaces are truthful for unauthenticated native Codex.
- [x] SC-005: Full local verification and exact Pibo2 provider-settings UI readiness pass.
- [x] SC-006: Focused PR #518 is open; subsequent authorized managed login, safe connected status, one bounded production-provider turn, trace validation, and cleanup also pass.

## Traceability

| Requirement | Capability requirement | Tasks | Status |
|---|---|---|---|
| REQ-001 | REQ-AUTH-001 | 1.1-1.4 | Pass: capability/method/disposal consistency, bounds, unsupported and malformed-result tests. |
| REQ-002 | REQ-AUTH-002 | 2.1-2.4 | Pass: explicit Web targets and frozen-session conflict/missing-session tests. |
| REQ-003 | REQ-AUTH-003 | 5.1-5.4 | Pass: catalog aggregation/all six states are runtime-scoped; exact Pibo2 renders prove Pi shared scope plus native Codex private disconnected and connected states. |
| REQ-004 | REQ-AUTH-004 | 3.1-3.5 | Pass: Pi device/browser/API-key/status/logout/shared-scope matrix. |
| REQ-005 | REQ-AUTH-005 | 4.1-4.8 | Pass: stable App Server account matrix, persistence, isolation, cleanup, failure paths, managed Device code authentication, and a real provider turn. |
| REQ-006 | REQ-AUTH-006, REQ-AUTH-007 | 6.1-6.4 | Pass: private Codex home/auth modes, Pi shared scope, redaction, no global-store mutation, and validation-rollout cleanup. |
| REQ-007 | REQ-AUTH-008 | 5.5-5.7 | Pass: missing/failed state remains unauthenticated, while the bound connected runtime renders its actual provider/model. |
| REQ-008 | all | 7.1-9.5 | Pass: local/full/Pibo2 evidence, focused PR #518, managed login, bounded production-provider turn, trace, and cleanup are complete. |
