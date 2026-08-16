# Spec: Runtime Provider Authentication

**Status:** Implementing
**Created:** 2026-08-16
**Requester / Source:** Active multi-agent runtime adapter goal
**Related docs:** `../changes/runtime-auth-control-plane/spec.md`, `../changes/multi-agent-runtime-adapters/spec.md`, `model-provider-auth-and-session-selection.md`, `pibo-runtime-assembly-and-inspection.md`

## Why

Provider credentials belong to the harness that consumes and persists them. A product-level login control that always writes Pi's credential store cannot truthfully authenticate another harness, cannot support two isolated configured instances of the same harness, and can report a provider as globally connected when only one runtime target is authenticated.

Pibo remains the authentication control plane for product UX, intent, status aggregation, and routing. Runtime adapters own protocol-specific login, credential persistence, and isolation.

## Goal

Pibo MUST route provider authentication to an explicitly selected configured runtime instance through a Pibo-owned adapter contract and MUST report the resulting state at runtime-instance and provider granularity without exposing secrets or harness protocol objects.

## Scope

### In Scope

- Adapter-declared auth methods, credential scope, status, start, progress/completion, cancellation, and logout.
- Product/account-scoped Chat Web APIs and settings UI with explicit runtime targets.
- Session-bound compatibility actions that target the active session's frozen runtime binding.
- Pi compatibility behind the Pi adapter boundary.
- Native Codex account operations through stable Codex App Server methods in the configured instance's private `CODEX_HOME`.
- Truthful model availability/auth rendering.

### Out of Scope

- Copying or synchronizing credentials between runtime instances or harnesses.
- A new multi-user or tenant account model; Pibo's existing App Context remains unchanged.
- Unstable Codex `chatgptAuthTokens` or browser-cookie import.
- Automatic production-provider approval in tests.

## Requirements

### REQ-AUTH-001: Adapter-owned capability contract

Each runtime adapter MUST declare whether it supports auth status, which Pibo-owned auth methods it supports, whether each method completes immediately, explicitly, or by notification, whether cancellation and logout are supported, and whether credentials are scoped to one configured instance or shared by the adapter.

#### Acceptance

- Registration rejects a declared auth operation without its required adapter method.
- Unsupported operations return a capability error and never fall back to Pi.

### REQ-AUTH-002: Explicit configured-runtime targeting

Product-scoped auth mutations MUST name a configured runtime instance and provider. A supplied Pibo Session ID MUST NOT be ignored or used as an arbitrary implicit global target.

#### Scenario: Product settings mutation

- GIVEN two configured runtime instances
- WHEN Chat Web starts login for one explicit instance
- THEN only that adapter instance receives the operation
- AND the response identifies that runtime instance and provider.

#### Scenario: Session compatibility action

- GIVEN a Pibo Session with a frozen runtime binding
- WHEN an existing `login.*` gateway action is used without an explicit runtime instance
- THEN the action targets the bound runtime instance
- AND an unknown or mismatched session is rejected.

### REQ-AUTH-003: Truthful status aggregation

Chat Web MUST show connected, disconnected, pending, partial, unsupported, and failed states per configured runtime instance. It MUST distinguish adapter-shared credentials from instance-private credentials and identify the default runtime target.

Missing status for a runtime that declares provider authentication MUST be treated as unavailable/failed, never authenticated.

### REQ-AUTH-004: Pi compatibility

The Pi adapter MUST preserve existing OAuth/device-code, browser OAuth compatibility, API-key, status, logout, model validation, and client action behavior. Pi SDK credential access MUST remain behind the Pi adapter boundary.

### REQ-AUTH-005: Native Codex official account protocol

The `codex-native` adapter MUST use stable Codex App Server 0.147.0 methods only:

- `account/read`
- `account/login/start` with `chatgptDeviceCode`
- `account/login/start` with `apiKey`
- `account/login/completed` notification handling
- `account/login/cancel`
- `account/logout`

Every process MUST use the selected configured instance's private Pibo-managed `CODEX_HOME`. Pending login processes MUST be bounded and cleaned up on completion, cancellation, timeout, failure, or adapter disposal.

### REQ-AUTH-006: Credential isolation

For adapters declaring `runtime-instance`, authentication and logout for one configured runtime instance MUST NOT alter another instance's credential state, Pi's credential store, global Codex state, or unrelated environment credentials. For adapters declaring `adapter-shared`, the UI MUST state that all instances of that adapter share the mutation scope and cached sessions for every affected instance MUST be recycled.

### REQ-AUTH-007: Secret-safe product contract

Pibo-owned auth results MAY contain the bounded verification/authorization URL and one-time user code needed for an active interactive flow. Provider-generated authorization URLs can contain protocol query parameters; Pibo MUST NOT expose native OAuth state as the public flow identifier or as a separate result field, and MUST NOT persist the URL in bindings or normalized product history. Results MUST NOT contain native login IDs, code verifiers, access/refresh/ID tokens, API keys, cookies, authorization headers, account identifiers, credential paths, or credential-file contents.

Errors, diagnostics, product events, bindings, logs, screenshots, reports, and test snapshots MUST remain free of those values. User-visible screenshots of an active flow MUST exclude the URL and one-time code.

### REQ-AUTH-008: Truthful model rendering

Agent Designer and model menus MUST combine a runtime's model catalog with that runtime's current provider-auth status. Models MAY remain visible while disconnected, but they MUST be marked or disabled according to the UI contract and MUST NOT be represented as authenticated.

## Edge Cases

- A login completion notification arrives after cancellation.
- The App Server exits while a device flow is pending.
- A flow expires or its configured timeout elapses.
- `account/read` or login methods return malformed protocol data.
- Two same-adapter instances authenticate concurrently.
- Logout occurs while bound sessions are cached.
- A disabled runtime or unsupported provider is explicitly targeted.
- A legacy action supplies a valid session but a conflicting explicit runtime target.

## Constraints

- **Compatibility:** Existing Pi profiles, bindings, actions, and credentials remain valid.
- **Security / Privacy:** Raw credentials never cross adapter boundaries or enter durable product state.
- **Protocol:** Native Codex uses stable App Server 0.147.0 v2 JSON-RPC only.
- **Isolation:** Native Codex auth persists only in the configured instance's private `CODEX_HOME`.
- **Testing:** Real user OAuth approval is excluded; deterministic fixtures use fake values only.

## Success Criteria

- [x] SC-AUTH-001: Registry contract, unsupported path, targeting, aggregation, and secret-redaction tests pass.
- [x] SC-AUTH-002: Pi device/browser/API-key/status/logout compatibility tests pass through the Pi adapter.
- [x] SC-AUTH-003: Deterministic Codex account read, device completion, API key, cancel, logout, malformed response, process failure, timeout, restart persistence, and isolation tests pass.
- [x] SC-AUTH-004: Chat Web settings and model surfaces show truthful per-runtime states in local typecheck/build/source/API tests.
- [ ] SC-AUTH-005: The exact candidate is active on Pibo2 and the public provider settings page is ready to start native-Codex device login while native Codex remains unauthenticated.

## Assumptions and Open Questions

### Assumptions

- One App Context may intentionally configure different accounts for different runtime instances.
- Pi credentials remain adapter-shared because Pi's existing `AuthStorage` is shared.
- A Codex device login completes by App Server notification; product clients poll the Pibo flow status to observe it.

### Open Questions

- None blocking this change.
