# Chat Web Cache Status Follow-Up

Date: 2026-05-09

## Status

Caching is functional again where it matters for Chat Web performance and freeze prevention.

The active production implementation caches bounded transport data, not large derived UI objects. This is intentional.

Production is running the cursor pagination implementation:

```text
5bb53c8 Add cursor pagination for chat cache pages
```

## What Is Cached Again

### Trace Summary Cache

Enabled and safe.

```text
GET /api/chat/trace/summary?piboSessionId=...
```

Cached data is small and excludes trace nodes and raw events.

### Trace Page Cache

Enabled and safe.

Trace pages are cached by:

```ts
["chat", "trace-page", piboSessionId, "raw" | "compact", rawEventsLimit, pageSize, cursor]
```

Older trace history now uses cursor pages:

```text
beforeSequence=...&pageSize=...
```

This replaced the unsafe growing-window pattern:

```text
eventLimit = 2000 -> 4000 -> 6000
```

### Session Page Cache

Enabled and safe.

Session pages are cached by:

```ts
["chat", "session-page", roomId, "active" | "archived", cursor, limit]
```

Active and archived sidebar load-more actions fetch and cache bounded pages.

## What Is Still Not Fully Cached

### Bootstrap

`/api/chat/bootstrap` is still not reintroduced as a broad full-object cache.

Reason: bootstrap can still carry large app/session structures. Rehydrating it directly from TanStack Query was part of the freeze pattern.

### Navigation

`/api/chat/navigation` is also not reintroduced as a broad full-object cache.

Reason: navigation can still carry large sidebar/session structures. Sidebar data now has a safer path through session pages.

## Design Decision

TanStack Query is used as a transport cache for small or bounded data:

- summaries,
- pages,
- cursors,
- metadata.

It is not used as the owner of large UI projections:

- full trace views,
- full sidebar trees,
- terminal rows,
- timeline rows.

Large render state is absorbed through local state and transitions rather than rendered directly from cached query data.

## Current Answer

Caching is not restored as “cache everything.” That was unsafe.

Caching is restored for the important performance paths:

```text
Trace summary cache        ✅
Trace cursor page cache    ✅
Session page cache         ✅
Archived session page cache ✅
Raw event bounded cache    ✅
Full bootstrap cache       intentionally not restored
Full navigation cache      intentionally not restored
```

## Remaining Non-Urgent Work

1. Shrink bootstrap so it only returns small app metadata.
2. Shrink navigation or replace it with page-based session APIs.
3. Add the performance harness to CI or a pre-deploy checklist.
4. Push local commits and prepare a PR.

## Conclusion

The freeze-causing cache pattern has been removed. The useful cache paths are active and production-tested. The remaining uncached bootstrap/navigation paths are deliberately conservative and should only be re-enabled after their payloads are small and page-based.
