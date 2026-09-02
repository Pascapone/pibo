---
type: "Historical Record"
title: "Chat Session Caching Hardening Follow-up"
description: "Preserves the original body as a deprecated historical record without promoting historical claims."
tags: ["historical","legacy","migration"]
status: "deprecated"
authority: "historical"
migration_lineage:
  source_path: "docs/legacy/chat-session-caching-hardening-follow-up.md"
  source_commit: "0cd6a73449e1b555fa6e590d839d7e03c8dc98bf"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "e43784d8fc15b9f5238d64e858406d53b5867d11"
  source_bytes: 3594
  source_sha256: "da063f99076353711d601820d7438dd77b383d54b793b401c260944ca0f680b7"
  source_body_sha256: "da063f99076353711d601820d7438dd77b383d54b793b401c260944ca0f680b7"
generated:
  by: "process:pibo-okf-c-legacy"
  at: "2026-09-01T09:50:26Z"
---
# Chat Session Caching Hardening Follow-up

Date: 2026-05-02

## Current State

The Chat Web session caching hardening is implemented on `main` and should work for the current user-facing caching problem.

Validated behavior:

- Returning from Session B to an unchanged Session A renders Session A from TanStack Query cache immediately.
- `/api/chat/trace` supports ETag-based freshness and returns `304 Not Modified` for unchanged trace versions.
- Changed trace data produces a fresh trace payload with a new `x-pibo-trace-version`.
- Room-scoped SSE frames include `piboSessionId`, so previously opened but unfocused sessions can receive targeted trace cache patches.
- Live text and reasoning deltas no longer force full Session Tree refreshes by default.
- Backend trace caching is process-local and bounded to 128 entries.
- Automated verification passed: `npm run typecheck`, `npm run build`, `node --test test/web-channel.test.mjs`, and `node --test test/*.test.mjs`.
- Browser validation was executed against the real `/apps/chat` UI through Chrome CDP. Browser-Use CLI could not be used because the persistent PIBo Chrome profile was locked.

This is a practical and acceptable stopping point for the current pass.

## Residual Risks

The implementation is intentionally conservative and surgical. A few areas remain worth revisiting if caching becomes a source of bugs or performance issues again:

- Trace versions are broader than ideal because they include all owned sessions, not only the selected session plus trace-relevant child or linked sessions. This can cause avoidable refetches after unrelated session metadata changes.
- The Cache Invalidation Matrix exists as a code-level contract, but mutation handlers still perform manual `loadBootstrap` and `refreshTrace` calls. That leaves some room for drift as new mutations are added.
- The Session Navigation query is explicit and populated, but the UI still renders mostly from `BootstrapData`. Full ownership separation between Bootstrap, Session Navigation, and Trace Pane is not complete.
- Live trace patching still uses recursive tree search and cloning for affected nodes. This is acceptable now, but very long traces may need an indexed trace cache representation.
- The backend trace cache is bounded, but hit recency is not refreshed, so it behaves closer to FIFO-on-insert than strict LRU.
- Browser validation confirmed visible behavior, but did not capture React rerender counts or a DevTools performance profile for Session Tree isolation.

## Future Hardening Candidates

When we decide to revisit this, prefer a small follow-up rather than a broad UI rewrite:

1. Narrow trace version inputs to selected-session trace dependencies only.
2. Replace manual mutation refresh logic with a small `chatCachePolicy` helper that applies the Cache Invalidation Matrix.
3. Promote Session Navigation from a populated query projection to the actual Session Tree data source.
4. Make backend trace cache eviction true LRU by refreshing recency on cache hits.
5. Add an indexed trace patch representation for long sessions, or at least benchmark the current recursive patching path.
6. Add browser automation or instrumentation that records whether Session Tree components rerender during trace-only live updates.

## Recommendation

Do not keep expanding this pass. The current implementation should function for the intended workflow, and the remaining items are incremental hardening work. Reopen this document if caching regressions appear, long sessions become visibly slow, or new room/session mutations are added.
