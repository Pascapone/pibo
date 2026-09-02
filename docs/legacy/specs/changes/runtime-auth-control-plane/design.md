---
type: "Historical Record"
title: "Design: Runtime-Neutral Provider Authentication Control Plane"
description: "Historical copy of a completed Pibo change-packet document."
tags: ["runtime-auth-control-plane", "change-packet", "history"]
status: "deprecated"
authority: "historical"
generated:
  by: "process:pibo-okf-b02-completed-history"
  at: "2026-08-30T18:25:11Z"
---
# Design: Runtime-Neutral Provider Authentication Control Plane

**Status:** Ready for review
**Created:** 2026-08-16
**Related docs:** `proposal.md`, `spec.md`, `tasks.md`

## Context

The runtime registry already separates drivers, configured instances, and live sessions. It exposes read-only auth inspection, but mutations are handled by Chat Web/Pi helpers before runtime resolution. Native Codex already has a private persistent `CODEX_HOME` per configured instance and an official stable account protocol.

## Goals / Non-Goals

### Goals

- Route auth by configured runtime instance and declared capability.
- Keep provider/account intent and public flow state Pibo-owned.
- Keep credential persistence and native protocol state adapter-owned.
- Preserve Pi and legacy action behavior.
- Support bounded App Server device login without exposing native IDs or secrets.

### Non-Goals

- A generic credential vault or cross-runtime synchronization layer.
- Replacing Pibo Web login/App Context authentication.
- Persisting pending provider-login flows across gateway restart.

## Decisions

### Decision: Descriptor methods are evidence-backed

- **Choice:** Add `auth` capability metadata with status support, method IDs and completion modes, cancellation/logout flags, and credential scope. Require matching adapter methods at registration.
- **Rationale:** Product surfaces can discover behavior without adapter-name checks and false capability claims fail early.
- **Alternative considered:** Optional methods only. Rejected because absence cannot distinguish unsupported from incomplete implementation.

### Decision: Public flows use Pibo IDs

- **Choice:** Adapters return Pibo auth status/operation objects. Native login IDs, Pi OAuth state, and code verifiers remain in adapter-private maps. Web clients receive only an opaque flow ID plus the verification URL/user code required for a device flow.
- **Rationale:** Product storage and diagnostics never learn harness protocol identifiers or credential material.

### Decision: Product mutations require explicit targets

- **Choice:** Add a dedicated product-scoped provider-auth API that requires `runtimeInstanceId` for mutations. Legacy gateway actions target the active session's frozen runtime and reject a conflicting explicit target.
- **Rationale:** Settings auth is account/runtime configuration, not a conversation mutation, while existing TUI clients remain functional and safe.

### Decision: Pi remains adapter-shared

- **Choice:** Move Pi SDK `AuthStorage` access into the Pi adapter module and report credential scope `adapter-shared`.
- **Rationale:** This preserves exact Pi storage semantics without falsely presenting them as instance-private.

### Decision: Codex auth owns a bounded App Server process

- **Choice:** A Codex auth controller starts an isolated App Server generation in the configured instance's private home. Device login keeps that process alive for completion notification, then closes it. API-key/status/logout use bounded ephemeral processes.
- **Rationale:** Official Codex manages its own tokens and refresh behavior. The private persistent home survives process restarts while generated process homes remain disposable.

### Decision: Status drives model truth

- **Choice:** Runtime inspection returns provider states/methods. Agent Designer and model menus join each model provider to that status; auth-required missing status evaluates false.
- **Rationale:** Catalog availability and credential availability are distinct facts.

### Decision: Session invalidation follows terminal auth changes

- **Choice:** Router-level auth operations reset cached sessions for the affected credential scope when a login completes immediately, completion is observed, or logout succeeds. `runtime-instance` resets only that instance; `adapter-shared` resets every configured instance of the same adapter. Pending starts do not reset sessions.
- **Rationale:** New runtime processes must observe updated credentials without changing persisted bindings or leaving a second Pi instance on stale shared credentials.

## Risks / Trade-offs

- Device login pending state is in memory and must be restarted after a gateway restart. Completed credentials remain durable and are rediscovered by `account/read`.
- Pi's shared credential store cannot provide true per-instance accounts; the UI explains this scope rather than emulating isolation.
- Status reads start short-lived Codex processes and are cached only briefly; correctness and isolation take priority over premature optimization.

## Migration / Rollback

- No credential or database migration.
- Existing Pi credentials remain in place.
- Existing `login.*` action names remain available.
- Rollback removes the new control plane without altering either adapter's credential store.

## Open Questions

- None blocking implementation.
