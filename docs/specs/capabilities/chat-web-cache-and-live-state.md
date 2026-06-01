# Spec: Chat Web Cache and Live State

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Chat Web Browser Shell State](./chat-web-browser-shell-state.md), [Chat Web Trace and Terminal View](./chat-web-trace-and-terminal-view.md), [Pibo Session Signals](./pibo-session-signals.md)

## Why

Chat Web combines durable server state, live stream frames, browser-local preferences, and optimistic UI mutations. Without a clear cache contract, users can see stale session titles, unread counts, running statuses, or trace pages after a mutation, reconnect, or room switch.

The cache layer must make navigation feel immediate while still treating server responses, trace versions, and signal snapshots as the source of truth.

## Goal

Chat Web MUST keep bootstrap, navigation, session-list, trace, and live-status caches coherent across user navigation, mutations, SSE frames, and signal patches without exposing stale or cross-session data.

## Background / Current State

The current implementation defines cache keys and invalidation categories in `src/apps/chat-ui/src/cache.ts`. `src/apps/chat-ui/src/App.tsx` owns bootstrap state, React Query cache updates, optimistic mutations, room and session selection, live room SSE handling, and signal-tree subscription handling.

Bootstrap and navigation data use room id, selected Pibo Session id, and archived visibility in their query keys. Trace summary and trace page caches are keyed by Pibo Session id and trace paging options. Mutations update local bootstrap state optimistically where safe, then refresh or merge authoritative server data. Live SSE and signal patches update coarse navigation status without forcing every trace page to reload.

## Scope

### In Scope

- Chat Web React Query key shape for bootstrap, navigation, session pages, trace summaries, and trace pages.
- Browser bootstrap state mirroring into React Query cache.
- Optimistic cache updates for session create, rename, archive/restore, delete, and message send.
- Live room SSE updates that patch session status and schedule bounded navigation refreshes.
- Signal-tree snapshots and patches that update visible session status.
- Trace cache invalidation and refetch behavior for selected or affected sessions.
- Merging older trace pages and navigation unread counts without duplicating entries.

### Out of Scope

- Server-side event storage and replay semantics — covered by Chat Web Rooms and Event Streams and Pibo Data Store specs.
- Server-side trace materialization and ETag behavior — covered by Chat Web Trace and Terminal View.
- Browser route canonicalization, drafts, and local preferences except where they affect cache keys — covered by Chat Web Browser Shell State.
- Visual rendering details of trace nodes or navigation rows.

## Requirements

### Requirement: Query keys partition state by selection and visibility

The browser MUST key cached Chat Web data by the identifiers and options that change its contents.

#### Current

`chatBootstrapQueryKey`, `chatSessionNavigationQueryKey`, `chatSessionPageQueryKey`, and `chatTracePageQueryKey` include Pibo Session id, room id, archived visibility, cursor, page size, raw-event mode, raw-event limit, and trace page cursor as applicable.

#### Acceptance

- Bootstrap cache entries for active and archived session views are distinct.
- Navigation cache entries for different rooms or selected sessions are distinct.
- Trace page cache entries for raw and compact views are distinct.
- Loading older trace pages does not overwrite the tail page cache key.

#### Scenario: Raw trace toggle

- GIVEN a user views a session trace in compact mode
- WHEN the user enables raw events
- THEN Chat Web reads or fetches a trace page using a different query key
- AND the compact trace page remains reusable when raw events are disabled again.

### Requirement: Bootstrap state and query cache stay in sync

The browser MUST update its local bootstrap state and matching bootstrap query-cache entries together.

#### Current

`updateBootstrapCache` updates component bootstrap state and all React Query entries under the `chat/bootstrap` prefix. Catalog sub-mutations for MCP servers, Pi packages, and user skills also patch bootstrap query data.

#### Acceptance

- A visible session title, archive state, status, or catalog row change updates both current UI state and cached bootstrap data.
- Navigating back to a recently cached Chat Web view does not reintroduce the old bootstrap row.
- Catalog edits that are visible in bootstrap update cached bootstrap entries without requiring a full page reload.

#### Scenario: Rename a selected session

- GIVEN a selected session is visible in the navigation tree
- WHEN the user renames it successfully
- THEN the visible tree and any cached bootstrap result show the new title
- AND a later navigation refresh may replace the optimistic value with the authoritative session row.

### Requirement: Optimistic mutations are reversible on failure

The browser MUST only apply optimistic mutations when it can restore the previous visible and cached state if the server rejects the mutation.

#### Current

Session create, rename, archive/restore, and delete cancel bootstrap queries, capture a bootstrap mutation snapshot, patch visible state, and restore the snapshot on error. Message send marks a session as running and marks it as error on failure.

#### Acceptance

- A failed create removes the temporary session and restores the previous selection.
- A failed rename or archive operation restores the previous bootstrap state.
- A failed delete restores the removed session subtree.
- A failed send does not fabricate an assistant message; it only marks the session status as error.

#### Scenario: Delete fails after optimistic removal

- GIVEN an archived session subtree is visible
- WHEN the user confirms deletion and the server rejects it
- THEN the subtree returns to the navigation tree
- AND the previous selected session state is restored when it was changed optimistically.

### Requirement: Live room events patch navigation cheaply and refresh when structure may change

The browser MUST use room SSE frames for cheap status updates and schedule a bounded full navigation refresh when an event can change tree structure, unread state, or ordering.

#### Current

`/api/chat/events` is subscribed with the active room id and latest stream cursor. Incoming frames update session status and activity timestamps. Events classified by `eventShouldRefreshNavigation` schedule a debounced bootstrap refresh.

#### Acceptance

- Streaming or running status updates appear without reloading every trace page.
- Structural changes such as new sessions or room/session mutations schedule a bootstrap refresh.
- Multiple refresh-worthy events in a short burst collapse into one scheduled refresh.
- Closing or changing the active room closes the old EventSource.

#### Scenario: Running status arrives

- GIVEN a room SSE stream is connected
- WHEN an event for a visible Pibo Session maps to a running status
- THEN Chat Web updates that session node status and last activity time locally
- AND it does not immediately refetch all trace pages.

### Requirement: Signal patches are applied conservatively

The browser MUST apply session-signal snapshots and patches to visible navigation state, and recover with a fresh snapshot when a patch cannot be applied.

#### Current

For the selected Pibo Session, `subscribeSignalTree` delivers snapshots and patches. Snapshots and patches update `sessionSignals` and bootstrap state. If applying a patch returns the unchanged current state, the client fetches a fresh signal tree.

#### Acceptance

- Opening a session subscribes to signal state for that session tree.
- Leaving the sessions area or clearing the selected Pibo Session removes the active signal state.
- Patches update visible statuses for active tools, queued work, or recent completion markers.
- An unapplicable patch triggers a snapshot fetch instead of silently diverging.

#### Scenario: Patch misses local baseline

- GIVEN the browser has an outdated signal snapshot
- WHEN a signal patch cannot be applied to that snapshot
- THEN the browser fetches the current signal tree
- AND applies the returned snapshot to visible navigation state.

### Requirement: Trace refresh affects only the addressed session

The browser MUST invalidate and refetch trace summary and trace page data by Pibo Session id instead of flushing unrelated sessions.

#### Current

`refreshTrace` invalidates and actively refetches `trace-summary` and `trace-page` queries for one Pibo Session id. Send-message mutations cancel only trace page queries for the message target.

#### Acceptance

- Refreshing one session trace does not invalidate trace pages for sibling sessions.
- Sending a message cancels stale trace-page work for the target session only.
- Session mutations that affect the selected trace refresh that selected trace after the authoritative bootstrap load.

#### Scenario: Rename sibling session

- GIVEN session A is selected and session B is visible in the navigation tree
- WHEN session B is renamed
- THEN session A trace cache remains valid
- AND only navigation/bootstrap state needs authoritative refresh.

### Requirement: Paged data merges without duplicates

The browser MUST merge paged navigation and trace data by stable identifiers to avoid duplicate session nodes, trace nodes, or raw events.

#### Current

`appendSessionRoots` appends only unseen root sessions. `mergeOlderTracePage` prepends older trace nodes and raw events while filtering duplicate node ids and raw-event keys.

#### Acceptance

- Loading additional session pages does not duplicate root sessions already shown.
- Loading older trace events preserves the current tail page version and visible nodes.
- Raw events with the same id or fallback event key appear once after page merge.

#### Scenario: Load older trace twice

- GIVEN the user has already loaded an older trace page
- WHEN the same page is merged again after a retry
- THEN trace nodes and raw events from that page are not duplicated.

### Requirement: Read-state merges preserve recent unread changes

The browser MUST merge navigation responses with local unread-clearing intent so selecting a session does not show stale unread counts from an overlapping request.

#### Current

`mergeNavigationIntoBootstrap` collects the selected session subtree ids, calculates cleared unread counts from the previous bootstrap tree, and merges room/session unread counts while zeroing the selected subtree.

#### Acceptance

- Selecting a session clears unread counts for that session subtree in the visible tree.
- Parent room unread counts are reduced by the cleared amount when the selected room contains the session.
- Navigation responses that arrive after mark-read do not restore just-cleared unread counts for the selected subtree.

#### Scenario: Select unread child session

- GIVEN a child session and its room show unread counts
- WHEN the user selects the child session and navigation data returns
- THEN the child subtree unread count is cleared
- AND the containing room count is reduced by the cleared amount.

## Edge Cases

- Browser storage or cached bootstrap data may be absent; the UI must fall back to fresh API loads.
- Temporary optimistic session ids must be replaced with server Pibo Session ids after creation succeeds.
- Archived visibility changes must reset visible page counts and use archived-specific query keys.
- EventSource errors must not corrupt cached state; the next successful fetch or stream frame may repair it.
- Trace page merges must tolerate missing raw-event ids by using a deterministic fallback key.

## Constraints

- **Compatibility:** Cache keys must remain stable for current Chat Web React Query callers.
- **Security / Privacy:** Cache entries are browser-local and must not be used as authorization; all authoritative app context data still comes from authenticated APIs.
- **Performance:** Live frames should patch status locally and debounce full refreshes; trace invalidation should be session-scoped.
- **Dependencies:** The client depends on React Query, Chat Web API contracts, room SSE frames, and Pibo Session Signals.

## Success Criteria

- [ ] SC-001: Bootstrap, navigation, session-page, trace-summary, and trace-page query keys include all content-changing options.
- [ ] SC-002: Session create, rename, archive/restore, and delete optimistic updates restore prior state on failure.
- [ ] SC-003: Live SSE status frames update visible status without invalidating unrelated trace caches.
- [ ] SC-004: Signal patch failures recover by fetching a fresh signal snapshot.
- [ ] SC-005: Older trace pages and additional session pages merge without duplicate ids.
- [ ] SC-006: Selecting an unread session clears local unread counts without restoring stale counts from overlapping navigation responses.

## Assumptions and Open Questions

### Assumptions

- The server remains the source of truth for room membership, Pibo Session metadata, event persistence, trace versions, and access control.
- Browser-local cache data is per authenticated browser session and is not a durable synchronization layer.
- The current debounce-based full bootstrap refresh is intentional for bursty live events.

### Open Questions

- Should the cache invalidation matrix be exposed in developer docs or debug output so future UI mutations can be checked mechanically?
- Should failed EventSource connections trigger a visible stale-state indicator when the gateway remains reachable?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| REQ-001 Query keys partition state by selection and visibility | Raw trace toggle | `src/apps/chat-ui/src/cache.ts` | Implemented |
| REQ-002 Bootstrap state and query cache stay in sync | Rename a selected session | `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-003 Optimistic mutations are reversible on failure | Delete fails after optimistic removal | `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-004 Live room events patch navigation cheaply and refresh when structure may change | Running status arrives | `src/apps/chat-ui/src/App.tsx`, `src/apps/chat/stream.ts` | Implemented |
| REQ-005 Signal patches are applied conservatively | Patch misses local baseline | `src/apps/chat-ui/src/App.tsx`, `src/apps/chat-ui/src/traceLiveReducer.ts` | Implemented |
| REQ-006 Trace refresh affects only the addressed session | Rename sibling session | `src/apps/chat-ui/src/cache.ts`, `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-007 Paged data merges without duplicates | Load older trace twice | `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-008 Read-state merges preserve recent unread changes | Select unread child session | `src/apps/chat-ui/src/App.tsx` | Implemented |

## Verification Basis

This spec is based on the current workspace code in:

- `src/apps/chat-ui/src/cache.ts`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/api.ts`
- `src/apps/chat-ui/src/traceLiveReducer.ts`
- `src/apps/chat/stream.ts`
- `src/apps/chat/web-app.ts`
