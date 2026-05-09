# Chat Session Caching Hardening Implementation Plan

## Summary

Implement the caching hardening from `spec/spec-process-chat-session-caching-hardening.md` with surgical changes around the existing Chat Web cache path:

- Keep the browser URL as the selected room/session authority.
- Reuse TanStack Query trace data immediately and validate freshness through the server ETag/Trace Version.
- Make Bootstrap, Session Navigation, and Trace cache keys explicit.
- Keep live SSE deltas trace-scoped by default and refresh navigation only for status/title/unread/order-affecting frames.
- Bound the backend trace cache so it cannot grow without limit.

## Implementation

- Add a small Chat UI cache contract module for query keys, trace query lookup, session navigation projection, and the Cache Invalidation Matrix.
- Patch room-scoped SSE frames with `piboSessionId` so the browser can update a previously opened but currently unfocused session trace cache.
- Change the browser SSE subscription to prefer the selected room stream and apply frames to the matching trace query cache, not only the active pane.
- Keep full trace refetches limited to terminal trace frames; do not refresh Bootstrap/Session Navigation for ordinary text, reasoning, tool, or delegation deltas.
- Add `x-pibo-trace-version` and keep ETag support on `/api/chat/trace`; bound the in-memory backend trace cache with explicit LRU eviction.

## Cache Invalidation Matrix

| Mutation / Event | Cache Action |
| --- | --- |
| Send message | Patch Trace via SSE; refresh Session Navigation only when title/status/unread/order may change |
| Slash command execution | Patch/refetch Trace; refresh Bootstrap/Session Navigation only for shell/navigation actions |
| Session rename | Refresh Session Navigation and selected Bootstrap title; keep Trace reusable |
| Session archive/restore | Refresh Bootstrap and Session Navigation; keep Trace cache unless selection becomes invalid |
| Session delete | Refresh Bootstrap and Session Navigation; removed selected Trace must not remain selected |
| Room rename | Refresh Bootstrap and Session Navigation |
| Room archive/restore | Refresh Bootstrap and Session Navigation |
| Room delete | Refresh Bootstrap and Session Navigation and converge to a valid route |
| Session clone/fork/new session | Refresh Bootstrap and Session Navigation; create/reuse target Trace without evicting source Trace |
| Live SSE delta | Patch affected Trace Query only by default |

## Verification

- Run focused server tests for Trace Version/ETag freshness and room-scoped SSE session attribution.
- Run `npm run chat-ui:typecheck` and targeted `node --test test/web-channel.test.mjs` after build.
- Build the Chat UI and, if a usable authenticated web session is available, validate `/apps/chat` in a real browser for A -> B -> A cache reuse and unfocused-session convergence.

## Residual Risks

- The Session Navigation query is now explicit and populated, but the existing UI still carries `BootstrapData` as its main app state. A deeper split can follow after this hardening pass.
- Browser validation depends on having a runnable authenticated Chat Web environment and realistic sessions available.
