# Chat Web Remaining Cache and Pagination Implementation Plan

Date: 2026-05-09

## Current State

The production freeze is fixed. Production runs commit `fca1999 Cache chat trace pages safely`.

The current safe cache model is:

- TanStack Query caches small trace summaries.
- TanStack Query caches bounded trace pages.
- The UI does not render directly from large `query.data` objects.
- Trace pages move into local render state through `startTransition(...)`.
- Bootstrap and navigation still bypass query-cache reuse.

This plan covers the remaining work needed to make caching complete without reintroducing synchronous main-thread freezes.

## Goals

1. Cache navigation and sidebar data safely.
2. Replace growing trace `eventLimit` windows with cursor-based trace pages.
3. Keep TanStack Query as the transport cache, not the owner of large UI projections.
4. Add performance checks that catch session-switch regressions before deployment.
5. Resolve the unrelated failing thinking-action test.

## Non-Goals

- Do not cache full `PiboSessionTraceView` objects as the primary session state.
- Do not cache full bootstrap/navigation objects if they contain large session trees.
- Do not reintroduce synchronous full-tree or full-trace rehydration on session switch.
- Do not restart production without the gateway CLI and explicit approval when active work exists.

## Design Rules

### Query Cache Rule

TanStack Query may cache:

- small summaries,
- small pages,
- metadata,
- immutable or bounded fetch results.

TanStack Query must not directly drive rendering of:

- full trace views,
- full session trees,
- terminal rows,
- timeline rows,
- large derived UI projections.

### Render Path Rule

Components must not render large cached query objects directly after a session switch. Instead:

1. Query returns a bounded page or summary.
2. An effect transfers data into local state or a small UI store.
3. The transfer happens inside `startTransition(...)` where practical.
4. Derived data stays page-local or virtualized.

### Pagination Rule

Use true cursor pagination for durable history. Avoid increasing-window pagination for long-term behavior.

Bad long-term pattern:

```text
eventLimit = 2,000 -> 4,000 -> 6,000
```

Target pattern:

```text
beforeSequence = 12345, limit = 1,000
beforeSequence = 11345, limit = 1,000
```

## Phase 1: Page-Based Session Navigation Cache

### Problem

`/api/chat/bootstrap` and `/api/chat/navigation` still return enough session tree data to risk large synchronous rehydration if cached directly.

### API Work

Add a dedicated session page endpoint:

```text
GET /api/chat/sessions?roomId=...&archived=false&cursor=...&limit=...
```

Response shape:

```ts
type ChatSessionPage = {
  roomId: string;
  archived: boolean;
  sessions: PiboWebSessionNode[];
  nextCursor?: string;
  totalCount?: number;
  version?: string;
};
```

Cursor should be stable across refreshes. Prefer sort keys already used by navigation:

- `lastActivityAt`,
- session id as a tiebreaker,
- archived flag,
- room id.

### UI Work

Use TanStack Query for session pages:

```ts
["chat", "session-page", roomId, archived ? "archived" : "active", cursor, limit]
```

Sidebar state should render the concatenated loaded pages. Loading more should fetch the next page instead of increasing a visible count over a full tree.

Keep `/api/chat/bootstrap` for small app metadata:

- identity,
- rooms,
- selected room/session ids,
- agents,
- model/catalog metadata,
- capabilities.

Move bulky session lists out of bootstrap where possible.

### Acceptance Criteria

- Opening Chat does not fetch the entire session tree when many sessions exist.
- Showing archived sessions fetches archived pages only on demand.
- Loading more active sessions fetches the next page.
- Session switching stays under 100 ms long-task budget in a Chrome trace with 100+ sessions.
- No direct `query.data` render of a full session tree.

### Tests

- Unit/API test for cursor ordering and page boundaries.
- API test for active vs archived page separation.
- Browser test with at least 150 sessions:
  - initial sidebar shows first page,
  - load more appends data,
  - session switch has no multi-second stall.

## Phase 2: Cursor-Based Trace Pages

### Problem

Trace history currently uses `eventLimit`. It is safe enough now because pages are bounded and cached carefully, but each "Load older" increases the window size. Large histories will eventually rebuild larger trace views than needed.

### API Work

Add a cursor/page endpoint:

```text
GET /api/chat/trace/events?piboSessionId=...&beforeSequence=...&limit=...
```

or, if keeping server-built projections:

```text
GET /api/chat/trace/page?piboSessionId=...&beforeSequence=...&limit=...&includeRawEvents=false
```

Preferred response shape:

```ts
type PiboSessionTraceEventPage = {
  piboSessionId: string;
  version: string;
  events: ChatWebStoredEvent[];
  firstSequence?: number;
  lastSequence?: number;
  hasOlderEvents: boolean;
};
```

If the client still needs a server projection, keep it bounded:

```ts
type PiboSessionTraceProjectedPage = {
  summary: PiboSessionTraceSummary;
  page: PiboSessionTraceEventPage;
  nodes: PiboTraceNode[];
};
```

### UI Work

Use TanStack Query or `useInfiniteQuery`:

```ts
["chat", "trace-events", sessionId, beforeSequence ?? "tail", limit]
```

The visible trace should come from loaded pages, not from a single growing `eventLimit` result.

Implementation options:

1. Server projects each bounded page and the UI merges page projections.
2. Server sends event pages and the client projects incrementally.
3. A Web Worker projects pages off the main thread.

Start with option 1 if it is simpler. Move to option 2 or 3 if traces show projection cost remains high.

### Acceptance Criteria

- "Load older trace history" fetches one older page, not a larger complete window.
- Cached pages remain individually small.
- Session switching to a cached session does not synchronously rebuild all historical pages.
- Raw events use the same cursor model or a separate bounded raw-event page query.

### Tests

- API test for `beforeSequence` correctness.
- API test for `hasOlderEvents`.
- Browser test with a large trace:
  - initial tail loads quickly,
  - load older appends one page,
  - switching away and back uses cached pages without a freeze.

## Phase 3: Split Trace Projection from Transport Cache

### Problem

Even bounded pages can become expensive if projection work runs in the render path.

### Work

Create a small trace-page store or reducer that owns visible trace state per session:

```ts
type TracePageState = {
  piboSessionId: string;
  pages: Map<string, TracePage>;
  visibleWindow: TraceWindow;
};
```

TanStack Query remains responsible only for fetching and caching pages. The store decides what is visible and when to merge pages.

Use `startTransition(...)` for page merges. Consider `requestIdleCallback` or a Web Worker for expensive projection if traces show long tasks.

### Acceptance Criteria

- Query cache contains transport pages only.
- UI store contains visible projection state.
- Derived rows remain virtualized or page-local.
- Trace page merges do not create multi-second tasks.

## Phase 4: Performance Regression Harness

### Problem

Manual traces caught the freeze. We need a repeatable check.

### Work

Add a Browser Use or direct CDP script that measures long tasks while performing:

1. Open Chat.
2. Switch between cached sessions.
3. Toggle raw events.
4. Show archived sessions.
5. Load more sessions.
6. Load older trace history.

The script should report:

- max long task duration,
- number of long tasks over 50 ms,
- event count loaded,
- session count loaded,
- whether `/api/chat/events` replay stayed scoped.

### Acceptance Criteria

- CI or pre-deploy local check can fail if max long task exceeds a threshold.
- Threshold starts lenient, for example 500 ms, then tightens after stabilization.
- Reports are saved under `reports/` or `/tmp` with timestamps.

## Phase 5: Fix Unrelated Thinking-Action Test

### Current Failure

Full test run showed one unrelated failure:

```text
thinking action without level reports current level without cycling
'off' !== 'medium'
```

### Work

Investigate the thinking action path. Confirm whether the expected current level should come from:

- profile default,
- model default,
- session override,
- command argument parsing.

Fix the behavior or update the test if the product semantics changed intentionally.

### Acceptance Criteria

- Full `npm test` passes.
- The fix does not change Chat Web caching behavior.

## Phase 6: Git and Release Hygiene

### Current State

`main` is ahead of `origin/main` with the freeze/cache commit series.

### Work

Before pushing:

1. Check remotes:

```bash
git remote -v
```

2. Decide whether to push as `main` or create a feature branch.
3. Run final validation:

```bash
npm run typecheck
npm run build
node --test test/web-channel.test.mjs --test-name-pattern="chat web trace"
```

4. Push to the fork.
5. Prepare a PR to upstream if desired.

### Acceptance Criteria

- Commit history is understandable.
- Deployment status is documented.
- PR description names the freeze root causes and the safe cache model.

## Suggested Implementation Order

1. Fix the unrelated thinking-action test.
2. Add performance regression harness.
3. Implement page-based session navigation cache.
4. Implement cursor-based trace pages.
5. Move remaining trace projection work out of render-critical paths if traces still show long tasks.
6. Push and open PR.

## Risk Notes

- Re-caching bootstrap/navigation as full objects can reintroduce the freeze.
- `useInfiniteQuery` can still freeze if the UI flattens all pages synchronously on every render.
- Cursor pagination must preserve stable ordering during live updates.
- Archived-session views may be much larger than active views; keep archived fetches on demand.
- Browser DevTools can amplify React commit cost. Always compare with and without React DevTools when diagnosing marginal long tasks.

## Definition of Done

This work is complete when:

- Trace uses cursor pages, not growing `eventLimit` windows.
- Sidebar sessions use page queries, not cached full trees.
- Bootstrap contains only small app metadata.
- Full tests pass.
- A repeatable browser performance check shows no multi-second stalls on cached session switches.
- Production runs the final implementation without reported freezes.
