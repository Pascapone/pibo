---
type: "Historical Record"
title: "Native Web Search Provider Implementation Plan"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/plans/implement-native-web-search-provider.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "cd6efaf538988c1643ec2c99c4b9113ed130aa01"
  source_bytes: 2069
  source_sha256: "882c0b185c39917f77f3ad03aedf932d242e2173ece6c2e24a48318ea2129983"
  source_body_sha256: "882c0b185c39917f77f3ad03aedf932d242e2173ece6c2e24a48318ea2129983"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
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
