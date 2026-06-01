# Spec: Native Web Search Provider Adapter

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`, `docs/specs/capabilities/custom-agents.md`, `docs/specs/capabilities/runtime-prompt-and-compaction.md`

## Why

Pibo exposes `web_search` as a stable Native Tool even though the current implementation executes it through a model provider extension instead of a local Pi function tool. Profiles, catalogs, Agent Designer, and prompt generation need one Pibo-level contract so agents can select and reason about `web_search` without depending on OpenAI-specific request details.

## Goal

Define how Pibo registers, selects, configures, and injects provider-backed native web search into runtime requests while keeping the visible tool name stable as `web_search`.

## Background / Current State

The current code defines provider-backed tool metadata in `src/core/profiles.ts`, creates the default web-search profile in `src/tools/web-search.ts`, registers it from the built-in plugin, and converts selected profile tools into runtime extensions in `src/core/runtime.ts`.

For the OpenAI adapter, Pibo normalizes options, appends a provider Responses `web_search` tool to provider payloads that have an `input` shape, and optionally requests source metadata through the provider `include` array. The capability catalog marks `web_search` as registered and active even when it has no local function definition.

## Scope

### In Scope

- Stable Pibo `web_search` Native Tool identity.
- Provider-backed tool registration and profile selection.
- OpenAI provider request injection for selected `web_search` tools.
- Option normalization for external web access, search context size, domain filters, user location, and source inclusion.
- Prompt/context behavior that tells the agent web search is available without exposing provider internals as the public contract.
- Catalog and profile inspection behavior for provider-backed tools.

### Out of Scope

- Non-OpenAI web-search providers — the type model currently allows only the OpenAI provider.
- Local function-tool implementation of web search — current behavior is provider-backed.
- Search result rendering in Chat Web — this belongs to Chat Web trace and stream specs.
- Provider authentication storage — covered by auth/model provider behavior outside this spec.

## Requirements

### Requirement: Web search has a stable Pibo tool identity

The system MUST expose the capability to profiles, catalogs, and agents as `web_search` regardless of the provider request shape used at runtime.

#### Current

`createWebSearchToolProfile()` returns a `ToolProfile` named `web_search` with `providerTool.kind: "web_search"` and `provider: "openai"`.

#### Target

Agents and UIs use `web_search` as the durable product-level name. Provider-specific details remain implementation metadata.

#### Acceptance

- The default capability catalog includes a Native Tool named `web_search`.
- The catalog marks it as provider-backed and without a local function definition.
- Profile inspection can report the tool as registered and active when selected.

#### Scenario: Catalog lists web search

- GIVEN the default plugin registry is created
- WHEN the capability catalog is read
- THEN it contains native tool `web_search`
- AND the tool has `hasDefinition: false`
- AND its provider metadata declares OpenAI web search.

### Requirement: Selected web search activates through a runtime extension

The runtime MUST convert selected provider-backed `web_search` profile tools into Pi extensions before the agent starts.

#### Current

`createPiboRuntime()` filters selected tools with `isWebSearchProviderTool()` and adds `createWebSearchProviderExtension()` outputs to runtime extensions.

#### Target

A selected `web_search` tool is active even though there is no local tool function to call.

#### Acceptance

- Profile inspection reports selected `web_search` as active.
- Runtime startup installs the provider extension for selected provider-backed tools.
- Unselected `web_search` tools do not inject provider request tools.

#### Scenario: Profile enables web search

- GIVEN a profile selects `web_search`
- WHEN Pibo creates the runtime
- THEN the model-visible runtime includes web-search availability context
- AND provider requests receive the provider web-search tool.

### Requirement: OpenAI web-search options normalize to safe provider config

The OpenAI adapter MUST normalize Pibo web-search options before serializing them into provider payloads.

#### Current

`normalizeOpenAiWebSearchConfig()` defaults external access to true, context size to `medium`, source inclusion to true, trims valid domain and location values, and drops invalid domain filters.

#### Target

Provider payloads only receive supported, normalized fields. Invalid optional filters are ignored rather than forwarded.

#### Acceptance

- Missing options normalize to external web access enabled, medium context size, and source inclusion enabled.
- `externalWebAccess: false` is preserved for cache-only provider mode.
- Domain filters reject URL-like strings and values with path, query, fragment, or whitespace.
- User location is emitted only when at least one location field is non-empty.

#### Scenario: Cache-only mode

- GIVEN `externalWebAccess` is false and source inclusion is false
- WHEN the adapter builds a provider request tool
- THEN the tool contains `external_web_access: false`
- AND no web-search source include is added.

### Requirement: Provider request injection is idempotent and shape-aware

The adapter MUST modify only compatible provider request payloads and MUST NOT duplicate an existing provider web-search tool.

#### Current

`addOpenAiWebSearchProviderTool()` returns non-Responses-shaped payloads unchanged, copies existing `tools`, detects existing `web_search` or `web_search_preview` tools, and appends the provider tool only when missing.

#### Target

Provider requests are changed exactly once per request and only when the provider payload supports the expected Responses shape.

#### Acceptance

- Payloads without an `input` property are returned unchanged.
- Payloads with an existing `web_search` or `web_search_preview` tool are returned unchanged.
- Payloads with other tools preserve those tools and append the web-search tool.
- Existing `include` entries are preserved when adding source inclusion.

#### Scenario: Existing provider tool

- GIVEN a provider payload already contains `{ type: "web_search" }`
- WHEN the OpenAI web-search adapter processes the payload
- THEN the original payload object is returned
- AND no second web-search tool is added.

### Requirement: Source inclusion is explicit and non-destructive

When configured to include sources, the adapter MUST add the provider source include key without removing existing include entries.

#### Current

`addOpenAiWebSearchSourcesInclude()` appends `web_search_call.action.sources` only if `includeSources` is true and the key is not already present.

#### Target

Callers that already request provider include fields keep those fields, and web-search source metadata is requested at most once.

#### Acceptance

- Existing include arrays keep their original values.
- The web-search source include is appended when missing.
- No include field is emitted when source inclusion is disabled and no include field already needs mutation.

#### Scenario: Reasoning include is preserved

- GIVEN a provider payload includes `reasoning.encrypted_content`
- WHEN web-search source inclusion is enabled
- THEN the resulting include array contains both `reasoning.encrypted_content` and `web_search_call.action.sources`.

### Requirement: Runtime prompt describes capability, not provider mechanics

The system MUST tell the agent when native web search is available while keeping OpenAI-specific mechanics out of generic profile prompts.

#### Current

The web-search extension appends a `# Native Web Search` system-prompt section. The Codex-compatible prompt says to use `web_search` for current or externally sourced information and tests assert it does not mention OpenAI Responses hosted web search.

#### Target

Agents learn the stable tool name and intended use. Provider internals remain hidden unless a deeper diagnostic or implementation path asks for them.

#### Acceptance

- Selected web search adds concise runtime context.
- Generic compatibility prompts refer to `web_search`, not provider-specific branded mechanics.
- The prompt does not claim a local function tool exists when the profile uses a provider-backed tool.

#### Scenario: Codex-compatible profile prompt

- GIVEN the codex-compatible profile selects `web_search`
- WHEN Pibo builds the compatibility prompt
- THEN the prompt tells the agent to use `web_search` for current or externally sourced information
- AND it does not expose OpenAI provider request internals.

## Edge Cases

- A provider request payload can have a non-array `tools` value; the adapter treats it as no existing tools and emits an array.
- A provider request payload can have a non-array `include` value; the adapter replaces it only when source inclusion is enabled.
- Invalid domain filters are dropped silently by current code; future UI validation may choose to reject them earlier.
- Empty user-location objects are omitted to avoid sending meaningless approximate location data.
- `externalWebAccess: false` still creates a provider web-search tool; it requests provider cache-only behavior rather than disabling the selected Pibo capability.

## Constraints

- **Compatibility:** `web_search` remains the product-facing tool name for profiles and agents.
- **Security / Privacy:** Location and domain filters must be explicit profile options. The adapter must not infer precise user location.
- **Provider Boundary:** OpenAI payload fields are implementation details of the OpenAI provider adapter, not the stable Pibo tool contract.
- **Context Economy:** Runtime prompt additions must stay compact.

## Success Criteria

- [ ] SC-001: The default capability catalog exposes `web_search` as a provider-backed Native Tool with no local function definition.
- [ ] SC-002: Selecting `web_search` in a profile makes it active in profile inspection and runtime startup.
- [ ] SC-003: OpenAI web-search options normalize to deterministic provider config.
- [ ] SC-004: Provider request injection appends web search exactly once and preserves existing tools/includes.
- [ ] SC-005: Generic runtime prompts mention `web_search` by stable Pibo name and do not expose provider internals as the user-facing contract.

## Assumptions and Open Questions

### Assumptions

- OpenAI remains the only implemented web-search provider until `WebSearchProviderToolProfile["provider"]` adds more providers.
- The provider request payload shape with `input` is the compatibility boundary for current OpenAI Responses requests.
- Result frames and citations are handled by the provider/Pi output stream and Chat Web trace layers, not by this adapter spec.

### Open Questions

- Should invalid domain filters be rejected at Agent Designer/API boundaries instead of silently dropped by the adapter?
- Should provider-backed tools have a distinct catalog badge so users understand why no local function schema exists?
- Should web-search source metadata receive a dedicated Chat Web renderer contract?

## Traceability

| Requirement | Scenario / Story | Code / Tests | Status |
|---|---|---|---|
| REQ-001 Web search has a stable Pibo tool identity | Catalog lists web search | `src/core/profiles.ts`, `src/tools/web-search.ts`, `src/plugins/builtin.ts`, `test/codex-compat.test.mjs`, `test/plugin-registry.test.mjs` | Implemented |
| REQ-002 Selected web search activates through a runtime extension | Profile enables web search | `src/core/runtime.ts`, `src/tools/web-search.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-003 OpenAI web-search options normalize to safe provider config | Cache-only mode | `src/tools/web-search.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-004 Provider request injection is idempotent and shape-aware | Existing provider tool | `src/tools/web-search.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-005 Source inclusion is explicit and non-destructive | Reasoning include is preserved | `src/tools/web-search.ts`, `test/codex-compat.test.mjs` | Implemented |
| REQ-006 Runtime prompt describes capability, not provider mechanics | Codex-compatible profile prompt | `src/tools/web-search.ts`, `src/core/codex-compat.ts`, `test/codex-compat.test.mjs` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/codex-compat.test.mjs`, `test/plugin-registry.test.mjs`, `src/tools/web-search.ts`, `src/core/runtime.ts`, `src/core/profiles.ts`, `src/core/codex-compat.ts`, and `src/plugins/builtin.ts`.
