---
type: "Historical Record"
title: "OpenAI Provider Web Search Validation - 2026-05-02"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/openai-provider-web-search-validation-2026-05-02.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "7e30aaede94eb70f42d0332649b1545fa7f4156a"
  source_bytes: 2267
  source_sha256: "016d498c8ae17ac61905ed0c0c297b29d940a54a614a3a355dd3080f1b9968d7"
  source_body_sha256: "016d498c8ae17ac61905ed0c0c297b29d940a54a614a3a355dd3080f1b9968d7"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
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

The visible Codex alias first moved to the provider-backed profile:

- `codex` -> `codex-compat-openai-web`

That follow-up was then generalized: `web_search` is now registered by the core plugin as a native Pibo tool with an OpenAI provider adapter. The old DuckDuckGo-backed fallback and its `codex-local` / `codex-duckduckgo` profile aliases were removed.

## Verification

- `npm run build`
- `node --test test/codex-compat.test.mjs`
- `npm run typecheck`
- `npm run dev -- profile codex`

`npm run dev -- profile codex` now reports `profileName: "codex-compat-openai-web"` with an active provider-backed native `web_search` tool.

## Follow-Up Validation Session

- Pibo Session: `ps_5ee14c39-b987-4b67-b5ff-75f5a97cb711`
- Pi Session: `380ca3ac-a716-4599-aa7d-33d48aa6b3a1`
- Profile: `codex-compat-openai-web`
- Provider/model: `openai-codex` / `gpt-5.4`

This later session looked functionally correct: the assistant answer included external sources, no local DuckDuckGo `result.details.searches` were present, and no local Pibo `web_search` tool execution events were emitted.

The remaining gap is observability. The persisted trace did not contain a first-class provider-hosted `web_search_call` node, so Chat Web and `pibo debug trace` cannot yet show the hosted search step. That follow-up is documented in `docs/provider-web-search-trace-visibility.md`.
