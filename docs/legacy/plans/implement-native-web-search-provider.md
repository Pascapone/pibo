# Native Web Search Provider Implementation Plan

## Goal

Move `web_search` out of the Codex compatibility plugin and make it a normal Pibo native tool with a stable tool name and provider-adapter backing. The first adapter is OpenAI Responses hosted `web_search`. The previous DuckDuckGo/local fallback implementation is removed.

## Design

1. Add provider metadata to native tool profiles.
   - Keep the selected tool name as `web_search`.
   - Store the provider selection and options on the selected `ToolProfile`.
   - Do not put provider selection in Codex-specific `toolPackages`.

2. Add a generic Web Search tool module.
   - Register a `web_search` native tool profile from the core plugin.
   - Define a small adapter interface for `web_search` providers.
   - Implement the OpenAI adapter by injecting the Responses hosted `web_search` provider tool during `before_provider_request`.
   - Add a generic prompt extension explaining that `web_search` is available through the configured provider adapter.

3. Remove the old local search path.
   - Delete DuckDuckGo parsing/fetching from the Codex compatibility tool module.
   - Remove the `codex-local` / `codex-duckduckgo` profile variant.
   - Stop registering `web_search` from the Codex plugin.

4. Wire runtime support through selected native tools.
   - Runtime discovers selected provider-backed native tools from `profile.tools`.
   - Runtime adds provider extensions independently of Codex compatibility.
   - Profile inspection marks provider-backed native tools as active even though they are provider-hosted rather than Pi function tools.

5. Update docs and tests.
   - Codex profile should include native `web_search`, `apply_patch`, and `view_image`.
   - Inspection should show `web_search` as active and provider-backed.
   - Provider serialization tests move from Codex naming to generic Web Search naming.

## Verification

- `npm run build`
- `node --test test/codex-compat.test.mjs`
- `node --test test/plugin-registry.test.mjs`
- `npm run typecheck`
- `npm run dev -- profile codex`
