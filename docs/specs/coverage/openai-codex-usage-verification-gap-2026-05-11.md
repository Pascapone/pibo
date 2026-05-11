# Coverage Analysis: OpenAI Codex Usage Verification Gap 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Model Provider Auth and Session Model Selection](../capabilities/model-provider-auth-and-session-selection.md), [Source Test Gap Priorities 2026-05-11](./source-test-gap-priorities-2026-05-11.md)

## Why

The current spec inventory already contains a durable provider-auth and model-selection contract. Creating a separate capability spec for OpenAI Codex usage would duplicate that owner spec because usage status is only exposed as provider-specific status metadata for an active `openai-codex` session.

This coverage note records the remaining source-backed verification gap for `src/auth/openai-codex-usage.ts` so future work can add focused tests without splitting the capability contract.

## Goal

Future verification work SHOULD test OpenAI Codex usage normalization and request behavior against the existing model-provider spec, rather than creating a new product capability.

## Scope

### In Scope

- Current OpenAI Codex usage source behavior in `src/auth/openai-codex-usage.ts`.
- Existing provider/model capability spec ownership.
- Testable cases that are not directly covered by the current `test/*.test.mjs` inventory.

### Out of Scope

- Source-code changes.
- Network calls to the real ChatGPT usage endpoint.
- Changes to provider login flows beyond the usage status dependency on stored OAuth credentials.
- Treating external endpoint schema as more authoritative than the current adapter code.

## Findings

### Finding: Usage status belongs to the model-provider contract

`getOpenAiCodexProviderUsageForActiveModel()` only returns usage for active model provider `openai-codex`. It reads Pi Coding Agent auth storage, requires an OAuth credential, obtains a bearer token without fallback, optionally sends a `ChatGPT-Account-Id` header, fetches the ChatGPT usage endpoint, and normalizes the response into `PiboProviderUsageStatus`.

The owning behavior spec is `model-provider-auth-and-session-selection.md`, especially requirement `Provider usage is optional and provider-specific`. A standalone capability spec would be misleading because no separate user-facing command, store, scheduler, or runtime boundary exists for this helper.

#### Future acceptance

- Keep OpenAI Codex usage requirements in `model-provider-auth-and-session-selection.md`.
- Add direct unit tests with fake auth storage and fake `fetch` instead of hitting the external endpoint.
- Treat provider usage failures as status-action behavior, not as model-selection or login failures, unless source behavior changes.

### Finding: Request eligibility is currently source-inspected only

The helper returns `undefined` when the active model is missing, belongs to another provider, lacks a stored credential, has a non-OAuth credential, or cannot resolve an access token through auth storage.

#### Acceptance for future tests

- GIVEN no active model or a non-`openai-codex` active model
- WHEN provider usage is requested
- THEN the helper returns `undefined` and does not call `fetch`.
- GIVEN an `openai-codex` active model with an API-key credential
- WHEN provider usage is requested
- THEN the helper returns `undefined` and does not call `fetch`.
- GIVEN an OAuth credential but no usable access token
- WHEN provider usage is requested
- THEN the helper returns `undefined` and does not call `fetch`.

### Finding: Header and account-id normalization need direct tests

The helper sets `Authorization: Bearer <token>` and `User-Agent: codex-cli`. It prefers `credential.accountId` when present and otherwise decodes the access-token JWT payload and reads `https://api.openai.com/auth.chatgpt_account_id`.

#### Acceptance for future tests

- GIVEN an OAuth credential with stored `accountId`
- WHEN usage is fetched
- THEN the request includes `ChatGPT-Account-Id` from the stored credential.
- GIVEN no stored account id but an access token with the OpenAI auth JWT claim
- WHEN usage is fetched
- THEN the request includes `ChatGPT-Account-Id` from the JWT claim.
- GIVEN an invalid or claimless access token
- WHEN usage is fetched
- THEN the request omits `ChatGPT-Account-Id` but still sends bearer auth.

### Finding: Payload normalization has clear branch coverage gaps

The normalizer accepts both snake_case and camelCase fields, builds primary and secondary rate-limit windows, appends additional named limits, clamps `remainingPercent` to the range `0..100`, converts reset epoch seconds to ISO timestamps, keeps `planType`, and includes credits only when `has_credits` or `hasCredits` is true.

#### Acceptance for future tests

- GIVEN a snake_case usage payload with primary and secondary rate-limit windows
- WHEN normalized
- THEN the status includes `5h limit` or duration-derived labels, used percentages, clamped remaining percentages, window minutes, reset ISO strings, plan type, and fetched timestamp.
- GIVEN a camelCase payload with `additionalRateLimits`
- WHEN normalized
- THEN each additional limit appears with the limit name prefixed to the window label.
- GIVEN credits with `has_credits: true`
- WHEN normalized
- THEN credits include unlimited and balance fields when present.
- GIVEN a payload with no usable limits and no usable credits
- WHEN normalized
- THEN the helper returns `undefined`.

### Finding: External failure behavior should be deterministic in tests

For non-OK HTTP responses, the helper reads response text when possible and throws an error that includes the HTTP status and response body text. This behavior is important because status output should expose an explicit provider-usage failure instead of silently reporting misleading quota data.

#### Acceptance for future tests

- GIVEN the usage endpoint returns status `429` with text `rate limited`
- WHEN usage is fetched
- THEN the helper throws `OpenAI Codex usage request failed: 429 rate limited`.
- GIVEN the usage endpoint returns a non-OK status and the body cannot be read
- WHEN usage is fetched
- THEN the helper still throws an error containing the HTTP status.

## Coverage Decision

Do not create a new capability spec for OpenAI Codex usage. The behavior is already owned by `model-provider-auth-and-session-selection.md`; the missing work is direct verification. This note narrows the test matrix from the broader source-test gap artifact to the exact source helper and expected request/normalization branches.

## Success Criteria

- [x] SC-001: `GLOSSARY.md` and project instructions were read before this artifact was written.
- [x] SC-002: The full `docs/specs/` inventory was inspected to avoid duplicate specs.
- [x] SC-003: The artifact stays under `docs/specs/coverage/` because it is a gap analysis, not a standalone capability contract.
- [x] SC-004: The artifact identifies one existing owning spec and concrete future tests.
- [x] SC-005: No source code, tests, Docker worker, gateway, or cron configuration was changed.

## Verification Basis

This analysis is based on the current workspace files:

- `GLOSSARY.md`
- `AGENTS.md`
- complete `docs/specs/` file inventory
- `docs/specs/capabilities/model-provider-auth-and-session-selection.md`
- `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`
- `src/auth/openai-codex-usage.ts`
- current `test/*.test.mjs` inventory
