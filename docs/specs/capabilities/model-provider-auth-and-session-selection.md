# Spec: Model Provider Auth and Session Model Selection

**Status:** Draft
**Created:** 2026-05-10
**Owner / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Pibo Session Routing](./pibo-session-routing.md), [Runtime Prompt and Compaction Configuration](./runtime-prompt-and-compaction.md), [Web Auth and Same-Origin Host](./web-auth-and-same-origin-host.md)

## Why

Pibo sessions must run on a model that is known, authenticated, and stable for the lifetime of the product session. Operators and Chat Web users also need a discoverable provider catalog, safe login actions, and shared app settings that affect runtime context consistently for all allowed accounts.

Without this contract, changing global defaults could silently move old sessions to different models, unauthenticated providers could be selected, and provider-specific login state could be confused with Pibo Web authentication.

## Goal

Define how Pibo discovers model providers, stores provider credentials, chooses default models, freezes a session's active model, and exposes user settings that affect runtime context.

## Background / Current State

Pibo builds the model catalog from Pi Coding Agent services, groups models by provider, and annotates each provider with auth status. Model defaults live in Pibo home as `model-defaults.json`. User settings live in Pibo home as `user-settings.json` and are keyed by the shared app compatibility key. Older owner-keyed entries are migration fallback only.

When the Session Router creates a routed runtime, it resolves the Pibo Session's active model from the stored session record first, then profile overrides, then main/subagent defaults. If a resolved model exists and the session has no stored active model, the router backfills the session store so later default changes do not alter that Pibo Session.

Provider login is exposed as gateway actions. OpenAI Codex supports device-code OAuth and a browser PKCE fallback that both store credentials in Pi Coding Agent auth storage under the `openai-codex` provider. API-key login can store credentials for arbitrary provider names.

## Scope

### In Scope

- Provider model catalog shape and auth annotations.
- Provider login, logout, and auth-status gateway actions.
- Model default persistence and sanitization.
- Active model resolution and session-store freezing for chat and subagent Pibo Sessions.
- Runtime validation that selected models exist and have configured auth.
- User timezone settings that are injected into runtime session context.
- Provider usage status returned for OpenAI Codex sessions when available.

### Out of Scope

- Better Auth web user authentication — covered by Web Auth and Same-Origin Host.
- Pi Coding Agent provider implementation internals — Pibo consumes the registry and auth storage contracts.
- Model pricing, ranking, or recommendation policy — no such behavior exists in the current code.
- UI layout details for model and login menus — this spec covers only observable behavior and API contracts.

## Requirements

### Requirement: Model catalog is grouped by provider

The system MUST expose a model catalog grouped by provider, with provider id, display label, provider auth status, and sorted model entries.

#### Current

`loadModelCatalog` creates Pi agent session services and reads the service model registry. If service creation fails, it returns an empty provider list.

#### Target

Catalog consumers can render available providers without creating a runtime session, and can distinguish authenticated from unauthenticated providers.

#### Acceptance

- Given registry models from multiple providers, the catalog returns one provider entry per provider.
- Provider entries are sorted by label and then id.
- Model entries are sorted by label and then id.
- Each model entry includes provider, id, label, provider auth status, and `supportsReasoning` only when true.
- If the registry cannot load, the catalog response is `{ providers: [] }` rather than an uncaught error.

#### Scenario: Authenticated provider is visible

- GIVEN the model registry contains OpenAI models and reports OpenAI auth as configured
- WHEN Chat Web or a gateway model action loads the catalog
- THEN OpenAI appears with `authConfigured: true`
- AND each OpenAI model inherits that auth status.

### Requirement: Login actions manage provider credentials, not web sessions

The system MUST expose gateway actions that start provider login, complete provider login, set API keys, report auth status, and remove provider credentials without changing Pibo Web authentication.

#### Current

The core plugin registers `login`, `login.start`, `login.complete`, `login.apikey`, `login.status`, and `logout` gateway actions.

#### Target

Provider credentials are stored in Pi Coding Agent auth storage and are later visible through provider auth status in the model catalog.

#### Acceptance

- `/login` returns an interactive provider menu with configured flags.
- `login.start` for `openai-codex` returns a device-code login payload with verification URL, user code, state, provider, polling interval, and instructions.
- `login.complete` for `openai-codex` polls the device authorization flow, treats pending 403/404 responses as retryable until timeout, exchanges the authorization code, stores OAuth access and refresh tokens, and returns the detected account id when present.
- `login.start` for `openai-codex-browser` returns a browser PKCE authorization URL and stores transient verifier state under the browser flow provider.
- `login.complete` for `openai-codex-browser` requires an authorization code, exchanges it with the browser redirect URI, and stores the resulting credential under canonical provider `openai-codex`.
- `login.apikey` stores an API-key credential for the requested provider.
- `login.status` returns stored auth status for all providers or a requested provider.
- `logout` removes the requested provider credential.
- Unsupported OAuth providers fail with an explicit unsupported-provider error.

#### Scenario: OpenAI Codex device login completes

- GIVEN a user starts `login.start` with provider `openai-codex`
- AND the provider returns a device auth id and one-time code
- WHEN the user completes `login.complete` with the returned state after authorizing
- THEN Pibo stores an OAuth credential under `openai-codex`
- AND later `login.status` reports `openai-codex` as configured.

#### Scenario: Browser PKCE login canonicalizes credentials

- GIVEN a user starts `login.start` with provider `openai-codex-browser`
- AND the provider redirects with an authorization code for the returned state
- WHEN the user completes `login.complete` with provider `openai-codex-browser`
- THEN Pibo exchanges the code with the browser redirect URI
- AND stores the resulting OAuth credential under provider `openai-codex`.

### Requirement: Pending OAuth login state is provider-bound and expires

The system MUST bind pending OAuth login state to the provider and expire stale state before token exchange.

#### Current

Pending login state is held in memory with provider, flow type, and creation time. Completion rejects missing, mismatched, or older-than-ten-minute state.

#### Target

A login completion cannot reuse another provider's state or complete after the state has expired.

#### Acceptance

- Completing with an unknown state fails and asks the user to start a new login flow.
- Completing with a different provider than the pending state fails with a state mismatch error.
- Completing a browser flow as a device flow, or a device flow as a browser flow, fails with a flow mismatch error.
- Expired pending state is deleted before returning the error.

#### Scenario: Provider mismatch is rejected

- GIVEN pending state was created for `openai-codex`
- WHEN completion is attempted for `openai-codex-browser` with that state
- THEN the action fails and does not store credentials.

### Requirement: Model defaults are sanitized and persisted locally

The system MUST persist model defaults as sanitized local Pibo configuration and ignore malformed fields.

#### Current

Model defaults are loaded from Pibo home unless a test path is supplied. Invalid JSON or invalid fields return an empty or partially sanitized defaults object.

#### Target

Corrupt or user-edited defaults cannot crash runtime creation or inject invalid model profiles.

#### Acceptance

- A model profile default is accepted only when `provider` and `id` are non-empty strings after trimming.
- Thinking defaults are accepted only when the value is one of the Pibo thinking levels.
- Fast-mode defaults are accepted only when boolean.
- Invalid JSON loads as `{}`.
- Saving writes only sanitized fields.

#### Scenario: Invalid default is ignored

- GIVEN `model-defaults.json` contains a `main` model without a provider
- WHEN defaults are loaded
- THEN the loaded defaults omit `main`
- AND runtime model selection falls through to the next source.

### Requirement: Session active model is frozen before runtime use

The system MUST freeze the resolved active model on the Pibo Session record before or during first routed runtime creation.

#### Current

The Session Router resolves active model from the stored session first. If absent, it derives a model from profile and defaults, then updates the Pibo Session store.

#### Target

Existing sessions keep their original active model even when global defaults change later.

#### Acceptance

- A stored `activeModel` always wins over current defaults.
- A new main chat session without `activeModel` uses the profile's hard model pin, then main profile override, then main default.
- A new subagent session without `activeModel` uses the profile's hard model pin, then subagent profile override, then subagent default.
- Forked or cloned sessions inherit the source session's `activeModel`.
- The SQLite-backed Pibo Session Store persists `activeModel` across reopen.

#### Scenario: Defaults change after session creation

- GIVEN a session was first created while the main default was `openai/gpt-5`
- AND the session store was backfilled with that active model
- WHEN the main default later changes to `moonshot/kimi-k2`
- THEN the existing session still resolves to `openai/gpt-5`.

### Requirement: Runtime rejects unknown or unauthenticated selected models

The system MUST validate the requested active model against the runtime model registry before creating a Pi agent session.

#### Current

Runtime creation looks up the requested model by provider and id, then checks configured auth through the model registry.

#### Target

The user sees an explicit runtime creation failure instead of silently falling back to another model or starting unauthenticated work.

#### Acceptance

- Unknown provider/model pairs fail with a message that names the requested provider and model id.
- Known models without configured auth fail with a message that names the requested provider and model id.
- Valid and authenticated models are passed to Pi Coding Agent session creation.

#### Scenario: User chooses an unauthenticated model

- GIVEN a Pibo Session has `activeModel` set to a model whose provider auth is not configured
- WHEN the Session Router creates the runtime
- THEN runtime creation fails before any model call is attempted.

### Requirement: Model menu exposes only authenticated model choices

The system MUST make interactive model selection show only providers and models that are currently authenticated.

#### Current

The core `model` gateway action loads the model catalog, filters providers to `authConfigured`, and filters models whose auth status is not false.

#### Target

Interactive model selection avoids offering choices that runtime creation would reject for missing auth.

#### Acceptance

- The model menu payload uses action `show_model_menu`.
- Unauthenticated providers are absent from the menu payload.
- Models explicitly marked unauthenticated are absent from their provider's model list.
- Selecting a model through Chat Web updates the Pibo Session's `activeModel` with provider and id.

#### Scenario: No providers are authenticated

- GIVEN the catalog has providers but none have configured auth
- WHEN the user opens the model menu
- THEN the menu contains no selectable providers
- AND the UI can present an empty authenticated-provider state.

### Requirement: Terminal action cards provide safe provider operations

The Chat Web terminal MUST render provider login, model selection, and status action results as bounded interactive cards instead of raw JSON when the gateway action payload is recognized.

#### Current

The compact terminal maps `login` tool output with `action: "show_login_menu"` to `tool.login`, maps `model` tool output with `action: "show_model_menu"` to `tool.model`, and maps `status` output to `tool.status`. `TerminalLoginCard` starts provider login through `login.start`, completes device/browser-code flows through `login.complete`, stores API keys through `login.apikey`, and requires a selected Pibo Session before starting session-bound actions. `TerminalModelCard` filters authenticated model choices by search and writes the selected `{ provider, id }` to the current Pibo Session through `PATCH /api/chat/sessions/:id`. `TerminalStatusCard` parses status JSON defensively and renders session state, queue state, context usage, provider usage, credits, and foldable enabled tools.

#### Target

Provider operations remain usable from slash-command output while preserving session ownership, avoiding accidental credential display, and degrading safely when payloads cannot be parsed.

#### Acceptance

- A recognized `/login` result renders provider choices, configured-provider badges, supported auth methods, device/browser-code completion, and API-key entry without showing the API key after save.
- Login actions are not started when no Pibo Session is selected; the card shows a local error instead.
- Device and browser-code login flows expose the returned URL, user code or code-entry field, copied-state feedback, provider instructions, busy state, success, and errors.
- A recognized `/model` result renders only the authenticated providers supplied by the gateway action, supports search across provider/model labels and ids, and patches the selected session active model.
- A model-selection failure leaves the card visible and reports the mutation error instead of pretending the model changed.
- A recognized `/status` result renders parseable status fields and shows an unparseable status fallback for invalid output.
- Provider usage and context usage are display-only in the terminal status card.
- Unrecognized login or model payloads remain normal tool output and are not treated as trusted interactive cards.

#### Scenario: Select an authenticated model from the terminal

- GIVEN a Chat Web session receives a `/model` action result with one authenticated provider and two models
- WHEN the user searches for one model and selects it
- THEN Chat Web patches the selected Pibo Session active model to that provider/model id
- AND the card reports the selected model after the patch completes.

#### Scenario: Complete provider login from the terminal

- GIVEN a Chat Web session receives a `/login` action result listing OpenAI Codex with device-code support
- WHEN the user starts device login, authorizes with the returned user code, and chooses Complete
- THEN Chat Web calls `login.start` and `login.complete` against the selected Pibo Session
- AND the card reports success or the returned action error without exposing stored credential material.

### Requirement: User timezone is shared app runtime context

The system MUST store user settings at shared app scope and inject the sanitized timezone into runtime session context.

#### Current

Chat Web exposes authenticated `GET` and same-origin `PATCH` endpoints for user settings. The Session Router loads shared app settings and passes `timezone` into runtime session context.

#### Target

Scheduled jobs, sessions, and agents can rely on a concrete IANA timezone value while settings remain shared across allowed accounts.

#### Acceptance

- Missing user settings load as timezone `UTC`.
- Invalid timezone values are rejected by the Chat Web PATCH endpoint.
- Valid timezone values are persisted under the shared app settings key.
- Any allowed account reads the same timezone.
- Runtime session context includes the sanitized shared app timezone.

#### Scenario: User sets timezone

- GIVEN an authenticated user patches user settings with `Europe/Berlin`
- WHEN a new routed runtime is created
- THEN the runtime session context includes timezone `Europe/Berlin`.

### Requirement: Provider usage is optional and provider-specific

The system MUST return provider usage only when the active model and credential type support it, and MUST omit it otherwise.

#### Current

The status action asks the routed session context for provider usage. OpenAI Codex usage is fetched only for active model provider `openai-codex` with OAuth credentials.

#### Target

Status output can show OpenAI Codex rate-limit and credit information without failing other providers or unauthenticated sessions.

#### Acceptance

- Non-`openai-codex` active models return no provider usage.
- Missing or non-OAuth `openai-codex` credentials return no provider usage.
- Successful usage responses normalize limit windows, remaining percentages, reset timestamps, plan type, and credits when present.
- JWT account-id extraction prefers a stored credential account id and otherwise reads the OpenAI auth claim from the access token when present.
- Failed usage HTTP responses surface an explicit OpenAI Codex usage error.

#### Scenario: API key credential has no usage status

- GIVEN the active model provider is `openai-codex`
- AND the stored credential is an API key rather than OAuth
- WHEN status requests provider usage
- THEN provider usage is omitted.

## Edge Cases

- Model registry service creation can fail; catalog loading must degrade to an empty catalog.
- A session may be created from an older store schema without `activeModel`; lazy backfill must still work after migration.
- Clearing a session active model through the session API allows the next first-use path to resolve from current profile/defaults again.
- OpenAI Codex device polling treats pending authorization responses as retryable but fails on unexpected provider errors.
- Browser PKCE login stores credentials under `openai-codex` even when the transient login provider is `openai-codex-browser`.
- User settings files can be missing or malformed; loading must return defaults, not throw.

## Constraints

- **Compatibility:** Existing sessions without `activeModel` remain loadable and can be backfilled lazily.
- **Security / Privacy:** Provider OAuth tokens and API keys live in Pi Coding Agent auth storage, not in Chat Web room or session projections. Same-origin JSON protection applies to Chat Web settings and model-default mutation endpoints.
- **Performance:** Bootstrap catalog caching may cache catalog/defaults briefly, but mutation endpoints must invalidate it after model defaults change.
- **Dependencies:** Model discovery and auth checks depend on Pi Coding Agent service contracts. OpenAI Codex usage depends on OpenAI/ChatGPT OAuth credential shape and usage endpoint availability.

## Success Criteria

- [ ] SC-001: Model catalog tests verify provider grouping, auth annotations, reasoning support, and deterministic sorting.
- [ ] SC-002: Model-default tests verify persistence, sanitization, main/subagent precedence, thinking defaults, and invalid input handling.
- [ ] SC-003: Session-model tests verify active model freezing, default changes, subagent defaults, SQLite persistence, and older-schema backfill.
- [ ] SC-004: Login-action tests verify OpenAI Codex device login stores OAuth credentials and reports configured status.
- [ ] SC-005: Runtime validation tests or integration checks verify unknown and unauthenticated selected models fail before a Pi agent run starts.
- [ ] SC-006: Chat Web API checks verify model-default and user-settings mutations require authenticated same-origin JSON requests.
- [ ] SC-007: Chat Web terminal checks verify login, model, and status action cards parse recognized payloads, call the correct session-bound actions, handle errors, and fall back safely for malformed payloads.

## Verification Coverage

This section separates currently direct verification from source-inspected behavior. It is part of the provider/model contract so future work can add focused tests without expanding this spec into duplicate capability documents.

### Directly Tested

- Model catalog grouping, model sorting, provider auth annotations, and reasoning-support flags are verified by `test/model-catalog.test.mjs`.
- Model-default loading, saving, invalid JSON handling, and partial sanitization are verified by `test/model-defaults.test.mjs`.
- Session active-model source-of-truth behavior, default precedence, fork/clone inheritance, SQLite persistence, and older-schema backfill are verified by `test/session-model-source-of-truth.test.mjs`.
- OpenAI Codex device-code login starts the device flow, exchanges the authorization code, stores OAuth credentials under `openai-codex`, extracts account id from the JWT auth claim, and reports configured login status. Verified by `test/login-actions.test.mjs`.

### Source-Inspected Only

- Browser PKCE login for `openai-codex-browser` is implemented in `src/auth/login-actions.ts`; it creates a verifier/challenge pair, returns an OpenAI authorization URL, requires a code at completion, exchanges with the browser redirect URI, and stores credentials under canonical provider `openai-codex`.
- Pending login state mismatch, browser/device flow mismatch, ten-minute expiry, retryable device polling, and unsupported-provider errors are implemented in `src/auth/login-actions.ts` but do not have focused direct tests in the current test inventory.
- OpenAI Codex usage status is implemented in `src/auth/openai-codex-usage.ts`; it only runs for active `openai-codex` OAuth credentials, derives account id from stored credential or JWT claim, normalizes rate-limit windows and credits, and throws explicit errors for failed usage responses.
- Runtime rejection of unknown or unauthenticated selected models is implemented in `src/core/runtime.ts` and selected by `src/core/session-router.ts`, but current direct tests focus on selection/freezing rather than runtime provider-auth failure.
- Terminal action-card behavior for `/login`, `/model`, and `/status` is implemented in `src/apps/chat-ui/src/session-views/compact-terminal/*` and remains source-inspected only.
- Shared app user settings and timezone injection are implemented in `src/core/user-settings.ts`, `src/apps/chat/web-app.ts`, and `src/core/session-router.ts`; current tests do not directly exercise the Chat Web settings mutation plus runtime-context path.

### Recommended Test Matrix

| Test target | Required cases | Primary requirements | Suggested file |
|---|---|---|---|
| Browser PKCE login | `login.start` for `openai-codex-browser` returns an authorization URL with `state`, PKCE challenge, redirect URI, and supported scope; `login.complete` requires a code; successful completion stores OAuth credentials under `openai-codex`; the returned provider is canonicalized to `openai-codex`. | Login actions manage provider credentials; Pending OAuth login state is provider-bound and expires | `test/login-actions.test.mjs` |
| Pending login state safety | Unknown state fails; provider mismatch fails without storing credentials; browser/device flow mismatch fails; expired state is deleted and fails; unsupported providers report explicit unsupported-provider errors. | Pending OAuth login state is provider-bound and expires | `test/login-actions.test.mjs` |
| Device polling failures | Device polling treats `403` and `404` as retryable pending states; unexpected HTTP status fails with response text; malformed device/token responses fail before storing credentials. | Login actions manage provider credentials | `test/login-actions.test.mjs` |
| Runtime model validation | Unknown provider/model fails before Pi session creation; known unauthenticated model fails before Pi session creation; authenticated model is passed to Pi runtime options without fallback. | Runtime rejects unknown or unauthenticated selected models | `test/runtime-model-validation.test.mjs` |
| Gateway model menu | Menu payload uses `show_model_menu`; unauthenticated providers and explicitly unauthenticated models are excluded; empty authenticated-provider state returns a bounded empty menu. | Model menu exposes only authenticated model choices | `test/gateway-model-action.test.mjs` |
| OpenAI Codex provider usage | Non-`openai-codex` active models return no usage; API-key credentials return no usage; OAuth credentials add bearer and account headers; snake_case and camelCase usage payloads normalize to limit windows, reset times, remaining percentages, plan type, and credits; failed HTTP status throws a usage error. | Provider usage is optional and provider-specific | `test/openai-codex-usage.test.mjs` |
| Shared app user settings | Missing settings default to `UTC`; invalid timezones are rejected by the Chat Web PATCH endpoint; valid timezones persist at shared app scope; any allowed account reads them; runtime session context includes the sanitized timezone. | User timezone is shared app runtime context | `test/user-settings-runtime-context.test.mjs` |
| Terminal provider cards | Recognized login/model/status payloads render cards; missing selected session blocks session-bound actions; API keys are not echoed after save; model selection patches the selected Pibo Session; malformed or unrecognized payloads fall back to normal tool output. | Terminal action cards provide safe provider operations | component test or browser-independent terminal renderer test |

## Assumptions and Open Questions

### Assumptions

- Pi Coding Agent auth storage is the source of truth for provider credentials.
- Pibo's stored `activeModel` is a product-level choice and may reference provider/model ids even if that provider later becomes unavailable.
- The model catalog is descriptive. It does not activate a provider or change a session by itself.

### Open Questions

- Should Chat Web validate selected `activeModel` against the current authenticated catalog before writing it, or is runtime-time validation sufficient?
- Should model defaults stay Pibo-home-global or move to another non-account-scoped app setting file?
- Should provider usage failures be hidden from `/status` to avoid making status unreliable when an external provider endpoint is down?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Model catalog is grouped by provider | Authenticated provider is visible | `test/model-catalog.test.mjs` | Covered |
| REQ-002 Login actions manage provider credentials | OpenAI Codex device login completes; Browser PKCE login canonicalizes credentials | `src/auth/login-actions.ts`, `test/login-actions.test.mjs` | Partial: device flow tested; browser PKCE source-inspected |
| REQ-003 Pending OAuth login state is provider-bound and expires | Provider mismatch is rejected | `src/auth/login-actions.ts`; add focused login-state tests | Partial |
| REQ-004 Model defaults are sanitized and persisted locally | Invalid default is ignored | `test/model-defaults.test.mjs` plus invalid-input cases | Partial |
| REQ-005 Session active model is frozen before runtime use | Defaults change after session creation | `test/session-model-source-of-truth.test.mjs` | Covered |
| REQ-006 Runtime rejects unknown or unauthenticated selected models | User chooses an unauthenticated model | Add runtime validation test | Pending |
| REQ-007 Model menu exposes only authenticated model choices | No providers are authenticated | Add gateway action test | Pending |
| REQ-008 Terminal action cards provide safe provider operations | Select an authenticated model from the terminal; Complete provider login from the terminal | `src/apps/chat-ui/src/session-views/compact-terminal/TerminalLoginCard.tsx`, `TerminalModelCard.tsx`, `TerminalStatusCard.tsx`, `loginMenu.ts`, `terminalRows.ts`; add terminal-card tests | Source-inspected only |
| REQ-009 User timezone is shared app runtime context | User sets timezone | Add user-settings API/router test | Pending |
| REQ-010 Provider usage is optional and provider-specific | API key credential has no usage status | `src/auth/openai-codex-usage.ts`; add provider usage test | Source-inspected only |

## Verification Basis

This spec is based on the current code in:

- `src/apps/chat/model-catalog.ts`
- `src/apps/chat/web-app.ts`
- `src/auth/login-actions.ts`
- `src/auth/openai-codex-usage.ts`
- `src/core/model-defaults.ts`
- `src/core/session-model.ts`
- `src/core/session-router.ts`
- `src/core/runtime.ts`
- `src/core/user-settings.ts`
- `src/plugins/builtin.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalLoginCard.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalModelCard.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/TerminalStatusCard.tsx`
- `src/apps/chat-ui/src/session-views/compact-terminal/loginMenu.ts`
- `src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts`
- `src/sessions/store.ts`
- `src/sessions/sqlite-store.ts`
- `test/model-catalog.test.mjs`
- `test/model-defaults.test.mjs`
- `test/session-model-source-of-truth.test.mjs`
- `test/login-actions.test.mjs`

## Change Log

- 2026-05-11: Tightened the provider-login and OpenAI Codex usage contract from current `login-actions` and `openai-codex-usage` source inspection; no source changes.
- 2026-05-11: Added Chat Web terminal action-card behavior for `/login`, `/model`, and `/status` from current compact-terminal source inspection; no source changes.
- 2026-05-11: Added verification coverage and a focused test matrix for provider auth, model selection, user settings, terminal cards, and OpenAI Codex usage; no source changes.
