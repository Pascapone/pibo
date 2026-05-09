# Implement OpenAI Provider-Backed Web Search

## Goal

Replace the current lightweight local `web_search` implementation for the Codex-compatible OpenAI path with real OpenAI Responses hosted `web_search`, while preserving Pibo's existing Pi/Pibo provider authentication path.

This plan is for approval before implementation.

## Assumptions

- "OpenAI Dutch Provider Profil" means an OpenAI/Codex provider-backed profile that uses OpenAI Responses hosted web search.
- Pibo should not create a second OpenAI auth flow.
- Provider-backed search should run through Pi Coding Agent model requests, so the active model/provider account remains the same account used for normal inference.
- The current DuckDuckGo HTML `web_search` remains only as fallback or as a separate local-search profile option, not as the default for the provider-backed Codex profile.
- The first implementation should stay within Pibo's plugin/profile/runtime layer and avoid changes in `pi-mono` unless a hard blocker appears.

## Current State

- `src/plugins/codex-compat.ts` registers `codex-compat` and currently sets `providerWebSearch: false`.
- `src/tools/codex-compat.ts` registers local `web_search`, backed by DuckDuckGo HTML parsing.
- `src/core/codex-compat.ts` already has `addCodexCompatWebSearchProviderTool(...)`.
- `src/core/runtime.ts` wires `createCodexCompatExtension(...)` into Pi extension hooks.
- Pi calls Pibo's hook through `before_provider_request`, after `modelRegistry.getApiKeyAndHeaders(model)` has resolved auth.
- Tests already cover basic provider web-search payload injection.

## OpenAI Contract To Target

- Source: https://developers.openai.com/api/docs/guides/tools-web-search
- Use Responses API hosted `tools: [{ type: "web_search" }]`, not `web_search_preview`.
- Support:
  - `search_context_size: "low" | "medium" | "high"`
  - `filters.allowed_domains`
  - `filters.blocked_domains`
  - `user_location` with approximate country/city/region/timezone
  - `external_web_access: true | false`
  - `include: ["web_search_call.action.sources"]` when Pibo wants complete source data for trace/debug UI
- Keep `tool_choice: "auto"` for normal Codex-like behavior unless we explicitly add a force-search mode later.

## Proposed Design

### 1. Add A Real Provider Search Mode

- Extend `ToolPackageProfile` from booleans to a small provider-search config, while preserving old booleans:
  - `providerWebSearch?: boolean`
  - `providerWebSearchOptions?: { externalWebAccess?: boolean; searchContextSize?: "low" | "medium" | "high"; allowedDomains?: string[]; blockedDomains?: string[]; userLocation?: ...; includeSources?: boolean }`
- Keep compatibility with current `providerWebSearch: true`.
- Normalize old boolean to `{ externalWebAccess: true, searchContextSize: "medium", includeSources: true }`.

### 2. Add A Provider-Backed Profile Variant

- Keep existing `codex-compat` stable until approved.
- Add one explicit profile variant:
  - profile: `codex-compat-openai-web`
  - aliases: `codex-openai-web`, maybe `codex-web`
  - same tool/subagent/run-control surface as `codex-compat`
  - `providerWebSearch: true`
  - local DuckDuckGo `web_search` disabled by default in this profile
- Open question: after validation, decide whether alias `codex` should move to the provider-backed profile.

### 3. Split Local And Provider Search Tool Surfaces

- Change Codex-compatible generated tools so local `web_search` is included only when `providerWebSearch !== true` or when an explicit fallback flag is set.
- Keep `apply_patch` and `view_image` active in both profiles.
- In provider-backed mode, the model sees hosted search as an OpenAI built-in tool in the provider payload, not as a Pibo native `web_search` function tool.
- Update prompt wording:
  - provider mode: "Web search is provided by OpenAI Responses hosted web_search."
  - local mode: "Web search is provided by Pibo local search."

### 4. Harden Provider Payload Injection

- Update `addCodexCompatWebSearchProviderTool(...)`:
  - preserve existing `include` values and append `web_search_call.action.sources` when configured
  - include `external_web_access` explicitly
  - include `filters.allowed_domains` and `filters.blocked_domains`
  - validate domain strings without protocol
  - include `user_location` only with valid approximate fields
  - leave existing web_search/web_search_preview entries untouched or replace preview only if we explicitly choose migration behavior
- Restrict injection to Responses-shaped payloads and preferably OpenAI/OpenAI-Codex Responses providers.

### 5. Decide Trace Behavior

- Immediate v1.1:
  - rely on provider output and citations already flowing through Pi/Pibo transcript.
  - include `web_search_call.action.sources` for debugging/source visibility.
- Follow-up:
  - inspect whether Pi's `processResponsesStream(...)` preserves `web_search_call` output items and source lists.
  - if not, plan a Pi/Pibo trace normalization pass so Chat Web can show provider search calls as first-class trace nodes.

### 6. Agent Designer Support

- Add a package toggle or profile option for provider-backed web search only after static profile validation.
- First pass can be static profile only to reduce blast radius.
- If added to custom agents:
  - persist `providerWebSearch`
  - optionally persist `providerWebSearchOptions`
  - expose a compact UI under Packages, not Native Tools.

## Acceptance Criteria

- `codex-compat-openai-web` exists and can be inspected.
- The provider-backed profile does not expose local DuckDuckGo `web_search` as an active native Pibo tool by default.
- Provider-backed profile injects `tools: [{ type: "web_search", ... }]` into OpenAI Responses payloads.
- Injection preserves existing OpenAI auth because requests still flow through Pi/Pibo `modelRegistry.getApiKeyAndHeaders(...)`.
- Payload tests cover:
  - default live search
  - cache-only mode through `external_web_access: false`
  - `search_context_size`
  - allowed and blocked domains
  - user location
  - source inclusion
  - no duplicate web search tool insertion
- Existing `codex-compat` behavior remains unchanged unless we explicitly approve switching its default.
- `npm run typecheck` and focused Codex-compat tests pass.

## Implementation Steps

1. Update types and config normalization.
   - Files: `src/core/profiles.ts`, `src/core/codex-compat.ts`.
   - Verify: unit tests for option normalization and provider payload shape.

2. Split Codex-compatible native tool creation.
   - Files: `src/core/runtime.ts`, `src/tools/codex-compat.ts`.
   - Verify: profile inspection shows local `web_search` active only in local-search profiles.

3. Add provider-backed profile variant.
   - Files: `src/plugins/codex-compat.ts`, tests.
   - Verify: registry exposes `codex-compat-openai-web` and aliases.

4. Harden prompt wording.
   - Files: `src/core/codex-compat.ts`, `context/codex-base-prompt.md` only if necessary.
   - Verify: prompt tests distinguish provider/local search text.

5. Add source include and domain/location tests.
   - Files: `test/codex-compat.test.mjs`.
   - Verify: focused tests pass before wider build.

6. Optional after static profile approval: Agent Designer package toggle.
   - Files: `src/apps/chat/agent-store.ts`, `src/apps/chat/agent-profiles.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/App.tsx`, API/types.
   - Verify: custom agent persistence and profile inspection.

## Risks

- Hosted web search is provider-side, so Pibo cannot enforce per-call query parameters the same way it can in local `web_search`.
- If the model does not choose search under `tool_choice: "auto"`, no search occurs; forcing search should be a separate decision.
- Pi may not currently surface `web_search_call` items as rich trace nodes; source inclusion may need a follow-up trace task.
- OpenAI-Codex subscription-backed provider behavior may differ from direct OpenAI API behavior; validation should test the actual provider account path.
- `recency` has no direct documented Responses `web_search` control in the current target contract; do not pretend it is supported until we design a separate strategy.

## Open Questions For Approval

- Should `codex` alias stay on local `codex-compat` until validation, or move to `codex-compat-openai-web` immediately?
- Should provider-backed search be default live internet access, or cache-only by default with explicit live mode?
- Do we want local DuckDuckGo fallback if provider search fails, or should provider failure be surfaced clearly?
- Should Agent Designer support provider web search in the same implementation, or after the static profile works?
- Do we need first-class Chat Web trace rendering for `web_search_call` in this pass?
- Should domain filters be profile-level only, or should custom agents expose them?
