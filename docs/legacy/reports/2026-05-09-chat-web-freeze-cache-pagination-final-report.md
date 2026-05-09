# Chat Web Freeze, Cache, and Pagination Final Report

Date: 2026-05-09

## Summary

Chat Web session switching, empty sessions, slash commands, archived sessions, and trace loading are now stable and performant in production.

Production runs:

```text
5bb53c8 Add cursor pagination for chat cache pages
```

The final implementation keeps TanStack Query, but uses it only as a bounded transport cache. Large derived UI objects no longer rehydrate synchronously from the query cache during session switches.

## Production Status

Verified after forced production gateway restart:

```text
Production gateway status
  reachable: yes
  mode: prod

/health -> {"status":"ok","mode":"main"}
```

The user confirmed after production activation:

```text
Läuft stabil und performant.
```

## Root Causes Found

### 1. Session SSE replay used the wrong scope

The first large freeze came from `/api/chat/events` replaying too much history. The stream mixed room scope and session scope. A session cursor could be used against a room-wide stream, causing excessive replay.

Fix:

- Session trace EventSource now uses only `piboSessionId`.
- Room-wide streams remain explicit.
- Server treats `piboSessionId` as a session-scoped stream; `roomId` only validates access when both are present.

Commit:

```text
24c8852 Fix chat session switch freezes
```

### 2. Sidebar render did repeated recursive work

A later trace showed a long click task with heavy React work, many microtasks, and repeated sidebar path checks.

Fix:

- Precompute selected session path ids once.
- Pass a `ReadonlySet` to `SessionNode`.
- Avoid recursive selected-descendant checks per node.

Commit:

```text
b537a293 Reduce chat sidebar render work
```

### 3. Query cache rehydrated large trace/session objects synchronously

Disabling query-cache reuse removed the freezes. This proved that TanStack Query itself was not the issue. The issue was direct synchronous render rehydration of large derived objects, especially full trace views and full navigation/session trees.

Diagnostic/fallback commits:

```text
d2c47e4 Bypass chat web query cache
6d8f4c4 Fix trace loading after cache bypass
90fc354 Disable chat query cache after freeze regression
```

### 4. Bounded cache alone was not enough

The first bounded-cache attempt added limits and load-more controls, but still allowed large cached objects to re-enter the render path directly. The user confirmed that freezes returned.

Commit:

```text
980be36 Restore bounded chat cache with pagination controls
```

This was superseded by the final safe cache model.

## Final Design

### Query Cache Rule

TanStack Query now caches small, bounded transport data:

- trace summaries,
- trace cursor pages,
- session pages.

It does not directly own large UI projections.

### Render Path Rule

Trace rendering now uses local render state. Cached trace pages are copied into local state inside `startTransition(...)` where practical. Cached query results do not directly drive full trace rendering after a session switch.

### Pagination Rule

The final implementation avoids growing history windows for trace history.

Old long-term pattern:

```text
eventLimit = 2,000 -> 4,000 -> 6,000
```

New pattern:

```text
beforeSequence = 12345, pageSize = 2,000
beforeSequence = 10345, pageSize = 2,000
```

## Implemented Work

### Trace Summary Cache

Added small trace summaries:

```text
GET /api/chat/trace/summary?piboSessionId=...
```

Summary payload excludes trace nodes and raw events.

Commit:

```text
fca1999 Cache chat trace pages safely
```

### Bounded Trace Page Cache

Added safe trace-page caching with query keys that include:

- session id,
- raw/compact mode,
- raw-event limit,
- page size,
- cursor.

Final key shape:

```ts
["chat", "trace-page", piboSessionId, "raw" | "compact", rawEventsLimit, pageSize, cursor]
```

### Cursor-Based Trace Pages

Trace responses now include cursor metadata:

```ts
pageSize?: number;
beforeSequence?: number;
firstEventSequence?: number;
lastEventSequence?: number;
nextBeforeSequence?: number;
hasOlderEvents?: boolean;
```

`Load older trace history` fetches one older page instead of increasing a full-window limit.

Commit:

```text
5bb53c8 Add cursor pagination for chat cache pages
```

### Session Page Endpoint

Added page-mode support to:

```text
GET /api/chat/sessions?roomId=...&limit=...&cursor=...&archived=...
```

Page response:

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

The legacy `GET /api/chat/sessions` array response remains available when no page parameters are used.

### Session Page Cache

Added query keys for sidebar session pages:

```ts
["chat", "session-page", roomId, "active" | "archived", cursor, limit]
```

`Load more active sessions` and `Load more archived sessions` now fetch page data and append it to local sidebar state.

### Performance Harness

Added:

```text
scripts/chat-web-performance-check.mjs
```

It connects to Chrome DevTools Protocol, opens Chat Web, performs common actions, records long tasks, writes a JSON report, and can fail if the maximum long task exceeds a threshold.

### Thinking Test

The previously reported unrelated test now passes:

```text
thinking action without level reports current level without cycling
```

No product change was needed for that path.

## Validation

Validated before production deployment:

```text
npm run typecheck ✅
npm run build ✅
npm test ✅
```

Full test result:

```text
346 passing
0 failing
```

Additional focused tests were added for:

- cursor trace pages,
- session cursor pages,
- trace summary cache behavior,
- raw-event opt-in behavior.

Docker worker validation also passed for typecheck, build, and focused web-channel tests.

Dev gateway was deployed and tested before production. The user confirmed dev stability and performance before production deployment.

## Production Deployment

Production stable backup was installed:

```text
Backup installed at /root/.pibo/stable
Commit: 5bb53c893deee4ff0497c6c4f04a9235ba464952
Installed at: 2026-05-09T09:34:13.622Z
```

The normal production restart was blocked because active agent work was running. The user granted explicit force-restart approval. Production was then restarted with:

```bash
npm run --silent dev -- gateway web restart --force --confirm restart-active-agents
```

After the service completed its stop/start cycle, production recovered to main mode and passed health checks.

## Key Files Changed

- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/cache.ts`
- `src/apps/chat-ui/src/types.ts`
- `src/apps/chat/read-model.ts`
- `src/apps/chat/web-app.ts`
- `src/shared/trace-types.ts`
- `test/web-channel.test.mjs`
- `scripts/chat-web-performance-check.mjs`

## Commits in the Fix Series

```text
24c8852 Fix chat session switch freezes
b537a293 Reduce chat sidebar render work
d2c47e4 Bypass chat web query cache
6d8f4c4 Fix trace loading after cache bypass
980be36 Restore bounded chat cache with pagination controls
90fc354 Disable chat query cache after freeze regression
fca1999 Cache chat trace pages safely
524fdb5 Document remaining chat cache pagination plan
5bb53c8 Add cursor pagination for chat cache pages
```

## Current Git State

At the time of this report:

```text
main...origin/main [ahead 10]
```

The work is committed locally but not pushed.

## Remaining Follow-Up

No urgent freeze work remains.

Recommended follow-up:

1. Observe production under normal usage.
2. Push commits to the fork.
3. Prepare an upstream PR.
4. Optionally tighten the performance harness threshold after more real-world traces.
5. Later, split bootstrap/navigation further so bootstrap only carries small metadata. This is no longer urgent because the freeze path is fixed and session page caching is in place.

## Final Status

The freeze incident is resolved. Production is active, healthy, stable, and performant with safe cache pagination.
