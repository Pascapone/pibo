# Chat Signals and Unread Debug Report

Date: 2026-05-09  
Environment: Docker compute worker `signals-debug` plus read-only production DB inspection  
Status: diagnosis, no code changes yet

## Summary

The unread/signal problem has two separate causes.

1. **Old imported messages became unread after the V2 cutover.** Production has many sessions with chat events but no `principal_session_stats` read cursor. The unread query treats those messages as unread from stream id `0`.
2. **The frontend temporarily wipes all unread badges after selecting a session.** The selection flow marks one session read, then calls `/api/chat/navigation`. That endpoint intentionally skips unread counts. `mergeNavigationIntoBootstrap()` replaces the current session and room tree with the navigation response, so all unread counts disappear locally. A later full `/api/chat/bootstrap` recomputes counts, so the old unread messages come back.

This matches the observed behavior: a large unread count appears, clicking/reading one message makes all badges vanish, and later a count like 40 or 90 returns.

## Tools Used

- Docker compute worker:

```text
id: signals-debug
webPort: 32882
cdpPort: 32884
gatewayPort: 32883
```

- Browser Use against the worker Chat Web app.
- Browser DOM/performance inspection through `browser-use eval`.
- Direct same-origin API calls with the worker dev-auth cookie.
- Read-only production SQLite inspection with Node's `DatabaseSync`.

I did not restart the host production gateway.

## User Stories Considered

### Story 1 — Open Chat Web

Expected:

- `GET /api/chat/bootstrap?...&markRead=true` loads rooms, sessions, unread counts, capabilities, and selected trace context.
- If a selected session exists, the backend marks only that selected session read.
- Unread badges remain for other sessions.

Observed:

- Bootstrap can compute unread counts correctly.
- In production, many old imported sessions have no read cursor, so bootstrap reports historical messages as unread.

### Story 2 — Select a session with unread messages

Expected:

- `POST /api/chat/sessions/:id/read` advances that session's read cursor.
- The selected session's unread count clears.
- Other sessions' unread counts remain visible.
- Room unread count decreases by only the selected session's unread count.

Observed:

- The backend read cursor advances correctly for the selected session.
- The frontend then calls `/api/chat/navigation`.
- `/api/chat/navigation` returns no unread counts by design.
- `mergeNavigationIntoBootstrap()` replaces all rooms and sessions with that no-unread response.
- Result: all unread badges disappear locally, including unread sessions that were not read.
- A later `/api/chat/bootstrap` recomputes unread counts, and the remaining old unread messages come back.

### Story 3 — Refresh after selection

Expected:

- Remaining unread counts stay stable.

Observed:

- A full bootstrap response shows the remaining unread count again.
- This explains the flicker/reappearance pattern.

### Story 4 — Send a message in Docker worker

Expected:

- Signal registry moves session from idle to running or error.
- Unread count for the sender's own user message should not increase.

Observed:

- The worker had no provider key, so the message ended in a provider-key error.
- Signal snapshot settled with `localStatus: "error"`, `isTreeActive: false`, and `queuedMessages: 0`.
- No infinite active/running signal was observed.
- The snapshot contained duplicate-looking error entries because session, message, and turn nodes all carried the same error. That is a UI quality issue, not the unread-count bug.

### Story 5 — Subagent / child session messages

Expected behavior needs a product decision.

Current code marks only the selected session read:

```ts
markSessionsRead(state, [selectedSession], principalId)
```

Archive marks a whole subtree, but normal read/select does not:

```ts
markSessionsRead(state, sessionSubtree(...), principalId)
```

Implication:

- If a parent session is selected and child/subagent messages are visible or represented in the tree, child session unread counts can remain.
- If the UI collapses child sessions, this can look like a room-level unread count that will not clear when reading the parent.

Recommendation: decide whether opening a root session should mark only the root or the visible root subtree. For subagent-heavy sessions, marking the visible subtree read is probably the better UX.

## Reproduction in Docker

I seeded two sessions with three assistant messages each in the worker's V2 `event_log`.

Initial bootstrap:

```json
{
  "rooms": [{ "unread": 6 }],
  "sessions": [
    { "id": "ps_528ecf70-ac57-4145-bf3e-116d3c41aa16", "unread": 3 },
    { "id": "ps_94fcf7d8-a879-4928-b1f3-1c098522aac9", "unread": 3 }
  ]
}
```

After marking `ps_94fc...` read and loading navigation:

```json
{
  "navigation": {
    "rooms": [{ "id": "room_10db06dc-f083-4cbc-b469-ca4a105ac343" }],
    "sessions": [
      { "id": "ps_528ecf70-ac57-4145-bf3e-116d3c41aa16" },
      { "id": "ps_94fcf7d8-a879-4928-b1f3-1c098522aac9" }
    ]
  }
}
```

A full bootstrap immediately after that:

```json
{
  "rooms": [{ "unread": 3 }],
  "sessions": [
    { "id": "ps_528ecf70-ac57-4145-bf3e-116d3c41aa16", "unread": 3 },
    { "id": "ps_94fcf7d8-a879-4928-b1f3-1c098522aac9" }
  ]
}
```

So the backend state is mostly correct after marking one session read. The frontend uses a navigation response that lacks unread counts and temporarily hides remaining unread state.

## Production Data Findings

Read-only DB inspection of `/root/.pibo/pibo.sqlite` showed:

```text
owner principal: user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB
owned sessions: 261
owned sessions lacking read stats: 234
principal_session_stats rows for owner: 27
computed unread chat messages for owner: 2567
```

Top computed unread sessions include old imported sessions:

```text
Performance             134 unread, no read cursor
Gateway backup          116 unread, no read cursor
Web Tool + Provider      78 unread, no read cursor
Docker Workflow          78 unread, no read cursor
Archive Problem          68 unread, no read cursor
Render Problem           62 unread, no read cursor
Notification             56 unread, no read cursor
Skills                   40 unread, no read cursor
```

This strongly indicates the V2 import/cutover did not establish a baseline `last_read_stream_id` for old sessions. The UI is therefore reporting historical assistant messages as new unread messages.

## Code Paths

### Backend unread calculation

`src/data/chat-v2-adapters.ts`

```ts
countUnreadMessagesBySession(input) {
  ...
  e.stream_id > COALESCE(reads.last_read_stream_id, 0)
  ...
  e.type IN ('user.message.accepted', 'assistant_message')
}
```

If no row exists in `principal_session_stats`, every matching historical event after stream id `0` counts as unread.

### Backend mark-read

`src/apps/chat/web-app.ts`

```ts
function markSessionsRead(state, sessions, principalId) {
  for (const session of sessions) {
    const latestStreamId = state.eventLog.getLatestStreamId({ piboSessionId: session.id });
    if (latestStreamId !== undefined) state.eventLog.markSessionRead(session.id, principalId, latestStreamId);
  }
}
```

This writes the selected session's latest stream id to `principal_session_stats`.

### Frontend selection flow

`src/apps/chat-ui/src/App.tsx`

```ts
await markSessionRead(piboSessionId);
const data = await loadNavigation(...);
```

`loadNavigation()` merges navigation into bootstrap:

```ts
function mergeNavigationIntoBootstrap(current, navigation) {
  return {
    ...current,
    rooms: navigation.rooms,
    sessions: navigation.sessions,
  };
}
```

But `/api/chat/navigation` intentionally skips unread work:

```ts
roomsWithUnreadCounts(roomTree, new Map())
```

and returns `server-timing: navigation;desc="no_catalog_no_unread_no_jsonl"`.

## Root Causes

### Root Cause A — Missing migration baseline for read cursors

The V2 cutover imported old events but did not seed `principal_session_stats` for old sessions. Missing rows default to stream id `0`, which marks all historical assistant messages unread.

### Root Cause B — Navigation responses erase unread counts in the frontend cache

The lightweight navigation endpoint omits unread counts, but the frontend treats it as a full replacement for room/session navigation state. That creates false local clearing.

### Root Cause C — Read semantics ignore child/subagent sessions

Normal read/select marks only one session. Subagent outputs live in child sessions. If the user reads a parent session and expects the visible tree to count as read, current behavior will leave child unread counts behind.

## Recommended Fix Plan

### Fix 1 — Add a production-safe read-cursor baseline migration

Add a one-shot CLI command, for example:

```bash
pibo data repair unread-baseline --owner-scope <owner> --before <timestamp> --json
```

It should:

1. Find owned sessions with chat events.
2. For each session, set `principal_session_stats.last_read_stream_id` to the latest historical stream id at or before the chosen cutoff.
3. Never move a cursor backward.
4. Produce a report with changed sessions and previous/new cursor values.
5. Support `--dry-run`.

Production can use the V2 cutover timestamp as the cutoff. That preserves future unread behavior while clearing historical imported backlog.

Emergency manual version, after backup and approval:

```sql
INSERT INTO principal_session_stats (
  session_id,
  principal_id,
  unread_count,
  last_read_stream_id,
  last_read_message_sequence,
  last_read_at,
  updated_at
)
SELECT
  s.id,
  s.owner_scope,
  0,
  MAX(e.stream_id),
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM sessions s
JOIN event_log e ON e.session_id = s.id
WHERE s.owner_scope = :owner_scope
  AND s.deleted_at IS NULL
  AND e.created_at <= :cutoff
GROUP BY s.id
ON CONFLICT(session_id, principal_id) DO UPDATE SET
  last_read_stream_id = MAX(principal_session_stats.last_read_stream_id, excluded.last_read_stream_id),
  last_read_at = excluded.last_read_at,
  updated_at = excluded.updated_at;
```

Do this through code/CLI, not ad hoc SQL, unless the user explicitly approves an emergency repair.

### Fix 2 — Preserve unread counts when merging lightweight navigation

Change `mergeNavigationIntoBootstrap()` so it does not blindly discard existing unread counts when the navigation response omits them.

Rules:

- If a navigation node has `unreadCount`, use it.
- If it omits `unreadCount`, preserve the previous node's `unreadCount`.
- After marking a selected session read, explicitly clear that selected node's unread count and subtract it from room counts, or force a full bootstrap.

Simpler but slower option:

- After `markSessionRead()`, call full `loadBootstrap(..., { force: true })` instead of `loadNavigation()`.

Preferred option:

- Keep `/navigation` lightweight.
- Make frontend merge unread-preserving and selected-session-read-aware.
- Add tests for both selected and non-selected unread badges.

### Fix 3 — Decide and implement subtree read semantics

For subagents, choose one policy:

- **Policy A:** selecting a session marks only that exact session read.
- **Policy B:** selecting a root marks the visible subtree read.
- **Policy C:** selecting a root marks child sessions read only when their messages are rendered inline in the selected view.

I recommend Policy C long-term. Policy B is simpler and likely closer to what users expect for subagent trees.

### Fix 4 — Reduce duplicate signal errors in snapshots

The signal snapshot can list the same provider error from the session, message, and turn nodes. Dedupe errors by `{source, message}` in `computeSessionSnapshot()` or the UI.

This is not the unread-count root cause, but it will make the Signals UI less noisy.

## Tests to Add

1. `chat web app navigation preserves unread counts for unfocused sessions`
   - Create two sessions with unread assistant messages.
   - Select/read one.
   - Load navigation.
   - Assert the other session still shows unread.

2. `chat web app bootstrap does not resurrect historical unread after baseline repair`
   - Seed old events before cutoff.
   - Run repair.
   - Assert unread count is zero.
   - Add a new event after cutoff.
   - Assert unread count is one.

3. `chat web app read semantics for child sessions`
   - Parent plus child session.
   - Child has unread assistant message.
   - Select parent.
   - Assert behavior according to chosen policy.

4. `signal snapshot dedupes identical errors`
   - Session, message, and turn nodes carry the same error.
   - Snapshot has one error entry.

## Immediate Operational Recommendation

Do not manually edit production DB yet. First implement the repair command with dry-run and report output. Then run:

```bash
pibo data repair unread-baseline --owner-scope user:Z0xS45cCzyDBL7bAxQLyD1YNfC1mWnnB --dry-run --json
```

After review and backup, run the real repair. Then deploy the frontend merge fix so counts do not flicker or disappear incorrectly.
