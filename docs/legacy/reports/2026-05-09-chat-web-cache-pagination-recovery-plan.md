# Chat Web Cache and Pagination Recovery Plan

Date: 2026-05-09

## Summary

We confirmed that the remaining Chat Web freezes stopped when we bypassed React Query cache reuse for session navigation and trace loading. That fix is intentionally blunt. It stabilizes production, but it increases network traffic and removes useful `knownVersion`/`notModified` behavior.

The long-term fix is not "no cache". The long-term fix is bounded, asynchronous cache hydration plus pagination for every large data surface. Users must be able to inspect the full chat history, but the UI must never synchronously mount or derive state from an unbounded cached payload.

## Current Production Behavior

Recent relevant commits:

- `24c8852 Fix chat session switch freezes`
- `b537a29 Reduce chat sidebar render work`
- `d2c47e4 Bypass chat web query cache`
- `6d8f4c4 Fix trace loading after cache bypass`

Current stabilizing changes:

1. `/api/chat/events` is session-scoped when `piboSessionId` is present.
2. Normal session EventSource no longer sends both `roomId` and `piboSessionId`.
3. Sidebar selected-path lookup is computed once instead of recursively inside every `SessionNode`.
4. Query cache reuse is bypassed for Bootstrap, Navigation, and Trace.
5. Several hard display limits protect the UI from large synchronous renders.

## Current Hard Limits and Their Risks

These limits prevent freezes but can hide history or make older items unreachable from the UI.

| Area | Current limit | File | Risk |
| --- | ---: | --- | --- |
| Active sidebar sessions | 120 | `src/apps/chat-ui/src/App.tsx` | Older active sessions are hidden without pagination/search. |
| Archived sidebar sessions | 60 | `src/apps/chat-ui/src/App.tsx` | Older archived sessions are hidden without pagination/search. |
| Server trace render events | 2,000 | `src/apps/chat/web-app.ts` | Older trace events may not reach the client. |
| Live trace reducer events | 2,000 | `src/apps/chat-ui/src/traceLiveReducer.ts` | Long live sessions lose older live-tail events in memory. |
| Compact terminal trace nodes | 800 | `src/apps/chat-ui/src/session-views/compact-terminal/terminalRows.ts` | Terminal view hides older nodes. |
| Raw debug events | 80 | `src/apps/chat-ui/src/cache.ts`, `App.tsx` | Raw event debugging only shows the tail. |
| Catalog group items | 100 | `src/apps/chat-ui/src/App.tsx` | Probably acceptable; separate from chat history. |
| Composer history | 100 | `src/apps/chat-ui/src/App.tsx` | Acceptable user-history cap, not chat history. |

Goal: replace chat-history and session-list hard caps with pagination or lazy loading. Keep only explicit user-history/debug caps where acceptable.

## Principles

1. Cache small data first. Cache large trace data only after the render path is safe.
2. Never synchronously render an unbounded cached trace or session list.
3. Preserve complete history through pagination.
4. Use stable cursors, not offset-only pagination, for event streams and trace history.
5. Keep virtualized rendering, but do not rely on virtualization alone. Pre-render derivation can still freeze.
6. Use `startTransition`, deferred state, or idle work for cache hydration that can trigger large React updates.
7. Keep SSE cursor scopes strict: session cursors only for session streams; room cursors only for room streams.

## Target Architecture

### 1. Split data by size and volatility

Use different cache policies for each data class.

| Data | Endpoint | Cache policy |
| --- | --- | --- |
| Current selected metadata | bootstrap/navigation | short cache, safe to reuse |
| Sidebar session pages | new paged navigation endpoint | page cache by room/filter/cursor |
| Trace summary | trace summary endpoint | cache by session version |
| Trace pages | new paged trace endpoint | page cache by session/version/cursor |
| Live SSE events | `/api/chat/events` | no long-lived client cache; merge into current visible tail |
| Raw debug events | paged raw endpoint | load on demand only |

### 2. Prefer summaries plus pages

Do not fetch or render full trace by default. Load:

1. Session header and latest trace summary.
2. Latest page of messages/events.
3. Older pages only when the user scrolls upward or clicks "Load older".

### 3. Keep cache but make hydration asynchronous

When selecting an already cached session:

1. Set selected session id immediately.
2. Render a lightweight placeholder/header.
3. Schedule cached page hydration in a transition.
4. Render only the visible page/window.
5. Fetch fresh version metadata in parallel.
6. Reconcile only changed pages.

## API Plan

### Phase A: Session Sidebar Pagination

Add or extend an endpoint for paged session lists.

Suggested request:

```text
GET /api/chat/navigation?roomId=...&includeArchived=false&cursor=...&limit=50
```

Suggested response shape:

```ts
type SessionPageResponse = {
  selectedRoomId: string;
  selectedPiboSessionId: string;
  rooms: PiboRoom[];
  sessionPage: {
    items: PiboWebSessionNode[];
    nextCursor?: string;
    previousCursor?: string;
    totalEstimate?: number;
  };
};
```

Cursor requirements:

- Sort by `lastActivityAt`, then stable id.
- Include filter scope in cursor validation: room id, archived flag, owner/identity.
- Reject cursors from a different scope.

UI behavior:

- Show first page.
- Add "Load more sessions" for older active sessions.
- Add "Load more archived sessions" for archived sessions.
- Add search later for direct access to old sessions.
- Always include the selected session path, even if outside the current page.

### Phase B: Trace Pagination

Add a paged trace endpoint. The current trace endpoint can remain for compatibility, but the main UI should move to pages.

Suggested request:

```text
GET /api/chat/trace/page?piboSessionId=...&beforeSequence=...&limit=200
GET /api/chat/trace/page?piboSessionId=...&afterSequence=...&limit=200
```

Suggested response:

```ts
type TracePageResponse = {
  piboSessionId: string;
  version: string;
  order: "ascending";
  page: {
    events: ChatWebStoredEvent[];
    firstSequence?: number;
    lastSequence?: number;
    hasOlder: boolean;
    hasNewer: boolean;
  };
  summary: {
    title: string;
    status: PiboWebSessionStatus;
    messageCount: number;
    eventCount: number;
    latestActivityAt?: string;
  };
};
```

Default load:

- Fetch latest page, e.g. 200 events.
- Fetch older pages when the user scrolls near the top.
- Append live SSE events at the bottom.
- Merge pages by event identity and sequence.

Important: the current `TRACE_RENDER_EVENTS_LIMIT = 2_000` must become a default page size/window size, not an irreversible server-side cap.

### Phase C: Raw Event Pagination

Raw events are debug data. Keep the default tail small, but allow complete inspection.

Suggested UI:

- Default: latest 80 raw events.
- Button: "Load older raw events".
- Optional search/filter by event type.

Suggested API:

```text
GET /api/chat/raw-events?piboSessionId=...&beforeSequence=...&limit=100
```

## Cache Reintroduction Plan

### Step 1: Reintroduce Navigation Cache Only

Restore React Query caching for navigation, not trace.

Recommended policy:

```ts
staleTime: 5_000 to 10_000
 gcTime: 5 * 60_000
refetchOnWindowFocus: false
```

Safety rules:

- Cache only the current page and selected path.
- Do not cache an unbounded session tree.
- On room/session mutations, invalidate only affected page keys.
- Keep force-refresh path.

Success criteria:

- Repeated clicks on already loaded sessions do not freeze.
- Network requests drop for sidebar navigation.
- Performance trace shows no long synchronous cached commit.

### Step 2: Reintroduce Trace Cache for Metadata and Latest Page

Cache only:

- Trace summary.
- Latest page.
- Already loaded pages by cursor.

Do not cache one giant full trace object.

Query keys:

```ts
["chat", "traceSummary", piboSessionId]
["chat", "tracePage", piboSessionId, version, cursorOrTail]
```

Safety rules:

- Use `select` or page-level derivation to keep cached objects small.
- Render cached data inside `startTransition` if it can update many rows.
- Avoid `knownVersion` against a full trace response. Use it against summary or page metadata.

### Step 3: Restore `knownVersion` Safely

Use version checks for summaries and pages.

Safe pattern:

1. Request trace summary with `knownVersion`.
2. If unchanged, keep page cache.
3. If changed, fetch only affected latest page(s).
4. Do not return a huge cached trace to the render path synchronously.

### Step 4: Remove Current Cache Bypass

After pagination is in place:

- Replace direct `getBootstrap`/`getNavigation` calls with bounded cached queries.
- Replace full `getTrace` with paged trace queries.
- Remove `gcTime: 0` for trace pages.
- Keep `staleTime: 0` only where freshness is critical.

## UI Plan

### Sidebar

Replace "Showing first N" with pagination controls.

Minimum UI:

- "Load more active sessions"
- "Load more archived sessions"
- Loading spinner per section
- Selected session always visible
- Later: search box by title/id/profile

Do not mount all pages at once. Keep either:

- a virtualized sidebar list, or
- a page window with only visible/recent pages mounted.

### Trace Timeline

`TraceTimeline` already uses `react-virtuoso`, so scroll rendering is virtualized. The remaining risk is pre-virtualization work: flattening, deriving rows, patching trace objects, and hydrating cached data.

Required changes:

- Keep row derivation page-local where possible.
- Memoize per page, not across the full history.
- Load older pages on top-reached.
- Keep scroll position stable when prepending older pages.
- Do not flatten unbounded history on every render.

### Compact Terminal View

Replace `TERMINAL_TRACE_NODE_LIMIT = 800` with paged nodes.

Minimum UI:

- Default latest page.
- "Load older terminal output" at top.
- Keep follow-output behavior at bottom.

### Raw Events

Keep default tail, but add "Load older" so debugging can reach the full event history.

## Server/Data Plan

### Add read-model pagination primitives

Needed functions:

```ts
listSessionsPage({ roomId, archived, before, after, limit })
listTraceEventsPage({ piboSessionId, beforeSequence, afterSequence, limit })
listRawEventsPage({ piboSessionId, beforeSequence, afterSequence, limit })
getTraceSummary({ piboSessionId })
```

Database/index checks:

- Ensure index on `(piboSessionId, eventSequence)` or equivalent.
- Ensure index on session room/archive/activity ordering.
- Avoid scans over all `web_chat_events` for a page.

### Cursor discipline

Each cursor must encode or validate:

- resource type: sessions, trace events, raw events
- room id, when applicable
- pibo session id, when applicable
- archived filter, when applicable
- ordering key
- stable id tie-breaker

## Testing Plan

### Unit tests

- Cursor round trip.
- Cursor rejects wrong scope.
- Trace page order and boundaries.
- Session page includes selected path when requested.
- No event loss across adjacent pages.
- Live SSE merge dedupes events already present in latest page.

### Browser/performance tests

Create synthetic data:

- 5,000 sessions.
- 2,000 archived sessions.
- One trace with 100,000 events.
- One active live session receiving SSE updates.

Scenarios:

1. Click never-loaded session.
2. Click already-loaded session.
3. Toggle archived sessions.
4. Scroll trace up to load older pages.
5. Return to a cached session.
6. Keep React DevTools enabled and disabled for comparison.

Success criteria:

- No input task over 100 ms for normal clicks.
- No multi-second `RunMicrotasks` spike.
- No full-history network payload on default session open.
- Memory remains stable after repeated session switches.

### Regression tests

Keep existing SSE scope tests from `24c8852`.

Add tests for:

- `/api/chat/events?piboSessionId=...` remains session-scoped.
- Room-only stream remains room-scoped.
- Session cursor cannot be used as room cursor.
- Trace pages do not omit events across page boundaries.

## Rollout Plan

### Milestone 1: Instrument before reintroducing cache

Add lightweight performance marks around:

- session click start
- navigation response
- trace page response
- trace page commit
- cache hydration start/end

Expose only in development or behind a debug flag.

### Milestone 2: Sidebar pagination

Implement session pagination first. This removes the riskiest hard sidebar limits and reduces render work.

Deploy and test production-like data.

### Milestone 3: Trace pagination

Move default trace loading to latest-page mode.

Keep old full trace endpoint behind debug or fallback path until stable.

### Milestone 4: Cache small pages

Re-enable cache for:

- navigation pages
- trace summaries
- trace pages

Avoid full trace object cache.

### Milestone 5: Remove hard history caps

Replace these caps with page sizes:

- `TRACE_RENDER_EVENTS_LIMIT`
- `LIVE_TRACE_EVENTS_LIMIT`
- `TERMINAL_TRACE_NODE_LIMIT`
- active/archived sidebar render limits

Keep UI page sizes configurable as constants, but make them "items per page", not maximum reachable items.

## Open Questions

1. Should sidebar pagination be per room or global across all accessible rooms?
2. Should archived sessions default to a separate paged endpoint or share navigation pages?
3. Should trace pages be event-based, message-based, or hybrid?
4. How should search work across paged sessions and trace history?
5. Do we need server-side full-text search for old messages?
6. Should raw events remain debug-only and hidden by default?

## Recommended Next Task

Start with sidebar pagination. It gives the safest performance win and removes the most visible hard limits. Then implement trace page loading and reintroduce cache only for page-sized data.
