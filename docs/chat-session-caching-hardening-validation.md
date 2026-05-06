# Chat Session Caching Hardening Validation

Date: 2026-05-02

Environment:

- Worktree: `<HOME>/code/pibo-chat-session-caching-hardening`
- Browser: Google Chrome 146 via local Chrome DevTools Protocol on port 18800
- App URL: `/apps/chat` served by the real Chat Web App through `createWebHostChannel` with a local test auth service
- Browser-Use note: the Browser-Use wrapper could not start because the persistent PIBo Chrome profile had an existing `SingletonLock`; CDP against the already running Chrome instance was used instead.

## Checklist

| Scenario | Result | Notes |
| --- | --- | --- |
| Load real `/apps/chat` UI | Pass | Browser rendered the Chat Web shell and selected a canonical room/session route. |
| Session A -> Session B -> Session A unchanged | Pass | Returning to Session A showed the cached trace immediately and `Loading trace` was not visible. |
| Session A receives trace content while Session B is focused | Pass | Room-scoped SSE delivered frames with the target `piboSessionId`; returning to Session A converged to two assistant responses. |
| Loading/flicker observation | Pass | No full loading reset was visible on cached return. |
| Trace ordering | Pass | Returned trace preserved the two assistant response nodes in canonical display order. |
| Session Tree isolation | Partial | Server and browser checks confirm live deltas patch trace caches by session; visual rerender counts were not captured in Chrome devtools. |

## Implementation Note

- Backend trace freshness is ETag-based and also exposed as `x-pibo-trace-version`.
- Backend trace caching is process-local and explicitly capped at 128 LRU entries.
- The frontend now has named Bootstrap, Session Navigation, and Trace query keys plus a code-level invalidation matrix.
- Room-scoped SSE frames include `piboSessionId`, allowing cached traces for previously opened but unfocused sessions to be patched without a full Session Tree reload.

Residual risk:

- The existing `App` still carries `BootstrapData` as the primary shell state. The Session Navigation query contract is explicit and populated, but a deeper UI split can further reduce incidental rerendering in a later pass.
