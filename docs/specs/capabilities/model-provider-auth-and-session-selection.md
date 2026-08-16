# Spec: Model Provider Auth and Session Model Selection

**Status:** Implementing
**Created:** 2026-05-10
**Updated:** 2026-08-16
**Controller / Source:** Pibo capability specs and active multi-runtime adapter goal
**Related docs:** [Runtime Provider Authentication](./runtime-provider-authentication.md), [Pibo Session Routing](./pibo-session-routing.md), [Runtime Assembly and Inspection](./pibo-runtime-assembly-and-inspection.md), [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md)

## Why

Pibo Sessions need stable model choices, while provider credentials belong to the configured runtime that consumes them. A global Pi-only provider list cannot describe native Codex or two configured instances that intentionally use different accounts. Web login state must also remain distinct from model-provider authentication.

## Goal

Pibo MUST expose runtime-scoped model and provider-auth catalogs, route authentication to an explicit configured runtime adapter, and freeze each Pibo Session's selected model without representing missing auth as connected.

## Background / Current State

Each `AgentRuntimeAdapter` may expose a model catalog and capability-backed provider-auth operations. Runtime inspection combines configured-instance metadata, models, and safe provider status. Pi preserves its existing model registry and shared `AuthStorage`; `codex-native` uses official stable Codex App Server account methods in its private configured-instance `CODEX_HOME`.

Model defaults remain Pibo-home configuration. A Pibo Session stores its active model, and that persisted choice wins over later profile/default changes.

## Scope

### In Scope

- Runtime-scoped model catalogs and provider-auth status.
- Product-scoped provider settings and session-bound compatibility actions.
- Provider login, API-key setup, progress/completion, cancellation, and logout where declared.
- Model-default persistence and sanitization.
- Session active-model resolution and freezing for chat and subagent sessions.
- Auth-aware Agent Designer and Terminal model/login cards.
- App Context timezone injection and optional provider usage status.

### Out of Scope

- Pibo Web identity/login — covered by Web Auth and Same-Origin Host.
- Credential copying, account federation, or cross-runtime synchronization.
- Model pricing, ranking, or recommendation policy.
- Unstable/internal harness token-injection protocols.

## Requirements

### REQ-001: Model catalog is scoped to a configured runtime

Each runtime model catalog MUST identify its configured runtime instance and return only models valid for that instance.

#### Acceptance

- Models include provider id, model id, display label, and exact runtime-supported reasoning/options metadata.
- Provider/model ordering is deterministic.
- Catalog failure produces a safe diagnostic or bounded empty catalog, not an implicit fallback to another runtime.
- A custom Pi-backed runtime id remains Pi-compatible without changing native Codex identity.

### REQ-002: Provider auth is adapter-owned and explicitly targeted

Pibo MUST own provider-auth UX, intent, status aggregation, and routing. The selected runtime adapter MUST own login protocol and credential persistence.

#### Acceptance

- Chat Web `GET /api/chat/provider-auth` returns targets grouped by configured runtime.
- Every product mutation names `runtimeInstanceId` and `providerId`.
- A legacy session-bound `login.*` action targets the active session's frozen runtime binding.
- A missing or conflicting session/target is rejected rather than ignored.
- Responses identify the affected runtime; success text never claims a provider is globally connected.

Detailed auth behavior and secret constraints are defined by [Runtime Provider Authentication](./runtime-provider-authentication.md).

### REQ-003: Runtime/provider status is truthful

Each target MUST expose connected, disconnected, pending, partial, unsupported, or failed state and explain whether credentials are runtime-instance-private or adapter-shared.

#### Acceptance

- Pi reports `adapter-shared` because existing Pi instances use one Pi provider store.
- Native Codex reports `runtime-instance` and reads only its private Pibo-managed home.
- Missing status for a runtime that declares auth evaluates as failed/unauthenticated, never connected.
- Public metadata omits credentials, native login ids, OAuth state/verifiers, account identifiers, and credential paths/content.

### REQ-004: Pi auth compatibility remains intact

The Pi adapter MUST preserve existing device-code OAuth, browser-PKCE compatibility, API-key, status, logout, and model validation behavior behind the adapter boundary.

#### Acceptance

- Existing Pi credentials remain readable without migration.
- Existing `login.start`, `login.complete`, `login.apikey`, `login.status`, and `logout` actions remain accepted.
- Legacy `state` input remains an alias for the Pibo flow id in compatibility actions.
- Pi SDK `AuthStorage` is not imported by generic Chat Web/provider-routing code.

### REQ-005: Pending login flow is bounded and provider/runtime-bound

A pending flow MUST be identified by an opaque Pibo flow id and bound to one provider and configured runtime.

#### Acceptance

- Unknown, expired, mismatched, or canceled flow ids cannot complete.
- Explicit and notification-based completion are distinguishable.
- Pending adapter processes/state close on completion, cancellation, timeout, failure, or disposal.
- A completion notification after cancellation cannot produce a second terminal outcome.

### REQ-006: Model defaults are sanitized and persisted locally

Pibo MUST persist only valid model, thinking, and fast-mode defaults.

#### Acceptance

- A model default requires non-empty trimmed provider and id.
- Thinking defaults accept only Pibo thinking values.
- Fast-mode defaults accept only booleans.
- Invalid JSON or malformed fields are ignored safely.

### REQ-007: Session active model is frozen

The persisted Pibo Session active model MUST win over current profile/default values.

#### Acceptance

- New main and subagent sessions resolve the correct profile/default precedence and persist it.
- Existing sessions do not change when global defaults change.
- Forked/cloned sessions inherit the source active model.
- SQLite reopen preserves the active model.

### REQ-008: Model surfaces use the selected runtime's auth status

Agent Designer and model menus MUST join models to provider status from the same configured runtime.

#### Acceptance

- Unauthenticated models may remain visible for discovery, but are marked/disabled and never represented as authenticated.
- The Terminal model card disables choices whose provider reports `authConfigured: false`.
- Agent Designer treats missing status as false when the selected runtime declares auth.
- A stale stored provider/model remains visible with an explicit stale or missing-auth explanation.

### REQ-009: Runtime validates model use

A runtime MUST reject an unknown or unusable model before a provider call rather than silently selecting another model.

#### Acceptance

- Unknown provider/model pairs fail with the requested ids.
- Missing required provider auth fails explicitly.
- A valid model and configured provider are passed to the selected adapter without cross-runtime fallback.

### REQ-010: Terminal provider cards remain safe compatibility surfaces

Recognized `/login`, `/model`, and `/status` results MUST render bounded interactive cards.

#### Acceptance

- `/login` lists providers/methods for the active runtime and identifies configured state.
- Device/browser flows show only the verification URL, one-time user code or code-entry field, bounded instructions, and Pibo flow id.
- Notification flows poll completion; supported cancellation closes the flow.
- API-key fields are password inputs and keys are not echoed after save.
- `/model` keeps missing-auth models visible but disabled.
- Malformed/unrecognized payloads fall back safely rather than becoming trusted controls.

### REQ-011: User timezone is App Context runtime context

The sanitized App Context timezone MUST be injected into runtime session context.

#### Acceptance

- Missing settings default to `UTC`.
- Invalid IANA values are rejected.
- Valid values persist at App Context scope and are visible to all allowed accounts.

### REQ-012: Provider usage remains optional

Provider usage MUST be returned only when the active provider and credential type support it.

#### Acceptance

- Unsupported providers or credential types omit usage.
- Successful responses normalize bounded plan/limit/credit metadata.
- Usage failures do not expose credentials or raw provider bodies.

## Edge Cases

- Two same-adapter configured instances use different private accounts.
- Pi instances intentionally observe one shared Pi credential store.
- Auth changes while runtime sessions are cached; affected cached runtimes are recycled without changing bindings.
- Device completion arrives after cancel or process exit.
- A provider is present in a model catalog but exposes no Pibo-supported setup method.
- A stored model remains selected after its provider becomes disconnected.

## Constraints

- **Compatibility:** Existing Pi credentials, profiles, actions, and active-model records remain valid.
- **Security / Privacy:** Credentials never enter product history, runtime bindings, logs, traces, screenshots, reports, or test snapshots.
- **Protocol:** Native Codex uses stable official App Server 0.147.0 account methods only.
- **Performance:** Bootstrap caching may be brief, but auth mutations invalidate cached runtime/model inspection.

## Success Criteria

- [x] SC-001: Runtime model catalog and model-default tests pass.
- [x] SC-002: Runtime auth contract, explicit targeting, aggregation, and unsupported-path tests pass.
- [x] SC-003: Pi device/browser/API-key/status/logout compatibility passes through the adapter.
- [x] SC-004: Native Codex device/API-key/cancel/logout/restart/isolation/error/redaction matrix passes.
- [x] SC-005: Agent Designer and Terminal model/login surfaces are truthful for disconnected runtimes in local tests/builds.
- [x] SC-006: Session active-model freezing and runtime validation pass in the canonical suite.
- [x] SC-007: Exact-candidate Pibo2 provider settings are ready for managed native-Codex login while the private native runtime remains disconnected.

## Verification Coverage

| Area | Primary evidence |
|---|---|
| Runtime auth contract and redaction | `test/agent-runtime-auth.test.mjs` |
| Pi compatibility | `test/login-actions.test.mjs` |
| Native Codex official account protocol and isolation | `test/codex-native-auth.test.mjs` |
| Product API targeting/aggregation/pending/logout | `test/web-channel.test.mjs` |
| Runtime login/model actions | `test/runtime-routed-session.test.mjs` |
| Catalog-driven UI and missing-auth behavior | `test/chat-ui-provider-auth-methods.test.mjs`, Chat UI typecheck/build, Pibo2 browser validation |
| Model defaults and session freezing | `test/model-defaults.test.mjs`, `test/session-model-source-of-truth.test.mjs` |

## Assumptions and Open Questions

### Assumptions

- A single App Context may intentionally configure different accounts for different runtime instances.
- A stored active model remains a durable product choice even if its provider later disconnects.
- Runtime-time validation remains authoritative for executing a selected model.

### Open Questions

- None blocking the runtime-auth correction.

## Change Log

- 2026-08-16: Replaced the Pi-global provider-auth model with explicit runtime-adapter auth capabilities, per-runtime Web settings, native Codex App Server account operations, and truthful model rendering.
- 2026-05-11: Added Pi provider login, model defaults, Terminal cards, usage, and verification notes from the then-current Pi-only implementation.
