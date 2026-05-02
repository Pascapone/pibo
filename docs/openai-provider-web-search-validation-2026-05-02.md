# OpenAI Provider Web Search Validation - 2026-05-02

## Session Reviewed

- Pibo Session: `ps_1111b95d-9762-491c-94c6-1c80bc1b92cf`
- Pi Session: `d207365b-5758-4e38-b744-285c05c2783c`
- Chat room: `room_b389c2f3-9175-4a4c-ac23-8dc772d4f5c7`
- Created: `2026-05-02T14:14:28.318Z`

## Findings

The session did not validate OpenAI provider-backed web search. Debug CLI output showed the session profile was `codex-compat`, and the trace contained multiple normal Pibo tool calls named `web_search`.

Those `web_search` calls returned DuckDuckGo-backed local search results with `result.details.searches`, titles, URLs, and snippets. No provider-side `web_search_call` trace node or source include was present. The model answer was coherent for the user's Honker research request, but it was produced through the local fallback path rather than OpenAI Responses hosted search.

## Corrective Change

The visible Codex alias now resolves to the provider-backed profile:

- `codex` -> `codex-compat-openai-web`
- local fallback -> `codex-compat-local-web`
- local fallback aliases -> `codex-local`, `codex-duckduckgo`

`codex-compat-openai-web` does not expose local `web_search` as an active native tool. It injects OpenAI Responses hosted `web_search` through the provider request extension. The local profile still exposes the DuckDuckGo-backed `web_search` tool for explicit fallback testing.

## Verification

- `npm run build`
- `node --test test/codex-compat.test.mjs`
- `npm run typecheck`
- `npm run dev -- profile codex`
- `npm run dev -- profile codex-local`

`npm run dev -- profile codex` now reports `profileName: "codex-compat-openai-web"` and no active `web_search` native tool. `npm run dev -- profile codex-local` reports `profileName: "codex-compat-local-web"` and an active local `web_search` native tool.
