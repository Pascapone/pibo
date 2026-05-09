# V2-Native Query Services Finalization Plan

Date: 2026-05-09
Status: Planned

## Goal

Finish the architectural cleanup after the Chat Data V2 cutover by replacing compatibility-style Chat Web adapters with explicit V2-native query and command services.

The migration is already functionally complete: runtime data is in `pibo.sqlite`, old databases are archived, and legacy store code is removed. This plan finishes the internal shape so future Chat Web features use V2 concepts directly instead of expanding compatibility shells.

## Non-Goals

- Do not change the `pibo.sqlite` schema unless a small index or clearly necessary field is discovered.
- Do not reintroduce legacy stores or legacy DB migration logic.
- Do not change UI behavior except where required to preserve existing behavior through new services.
- Do not do broad frontend refactors.

## Current State

Current V2 access still includes compatibility adapters:

```text
src/data/chat-v2-adapters.ts
```

Classes:

```text
ChatV2ReadModel
ChatV2EventLog
ChatV2RoomStore
```

These classes are V2-backed, not legacy-backed, but their APIs mirror old Chat Web storage boundaries. They are useful transitional shells, but they should not become the long-term feature surface.

Related neutral type files already exist:

```text
src/apps/chat/types/event-store.ts
src/apps/chat/types/read-model.ts
src/apps/chat/types/rooms.ts
```

V2 store components already exist:

```text
src/data/pibo-store.ts
src/data/session-store.ts
src/data/event-log.ts
src/data/message-store.ts
src/data/observation-store.ts
src/data/navigation-store.ts
src/sessions/pibo-data-store.ts
```

## Desired End State

Chat Web runtime should depend on V2-native services named around product concepts, for example:

```text
ChatSessionQueryService
ChatTimelineQueryService
ChatEventCommandService
ChatRoomService
ChatReadStateService
ChatNavigationQueryService
```

These services should expose operations in current V2 terms:

- sessions
- rooms
- event streams
- messages
- observations
- navigation
- read state / unread counters

The old adapter classes should become unnecessary and then be removed:

```text
ChatV2ReadModel
ChatV2EventLog
ChatV2RoomStore
```

The facade files should export V2-native interfaces/types rather than old read-model/event-log concepts:

```text
src/apps/chat/event-log.ts
src/apps/chat/read-model.ts
src/apps/chat/rooms.ts
```

## Proposed Service Boundaries

### 1. ChatSessionQueryService

Read session summaries and detail rows from:

```text
sessions
session_navigation
session_stats
```

Responsibilities:

- list sessions for owner/room/profile/status filters
- get one session summary
- expose status and last activity
- avoid reconstructing UI lists from raw event streams

### 2. ChatTimelineQueryService

Read timeline pages from:

```text
event_log
chat_messages
observations
payloads
```

Responsibilities:

- cursor-based history pages
- latest event sequence / stream id
- bounded reconstruction of trace/timeline payloads
- live/non-live filtering rules

Important invariant:

- Session cursors are only used with session streams.
- Room cursors are only used with room streams.

### 3. ChatEventCommandService

Append user/client events and other Chat Web command events through V2:

```text
event_log
chat_messages where applicable
session_stats where applicable
principal_*_stats where applicable
```

Responsibilities:

- idempotent client transaction handling
- user accepted message events
- explicit event append commands that are not Pi runtime output ingestion

Runtime output event ingestion should remain owned by the existing ingest service, not duplicated.

### 4. ChatReadStateService

Read/write read markers and unread counts:

```text
principal_session_stats
principal_room_stats
```

Responsibilities:

- mark session read
- mark room read
- calculate unread fallback when counters need repair
- expose repair/inventory hooks if needed

### 5. ChatRoomService

Manage rooms through:

```text
rooms
room_members
principal_room_stats
```

Responsibilities:

- create/update/get/list rooms
- room membership
- room tree queries
- current default room behavior

### 6. ChatNavigationQueryService

Serve sidebar/navigation data from:

```text
session_navigation
sessions
rooms
principal_session_stats
principal_room_stats
```

Responsibilities:

- sidebar session pages
- child/origin/root relationships
- room-scoped navigation
- unread indicators

## Implementation Steps

### 1. Map current adapter call sites

Run:

```bash
grep -R "ChatV2ReadModel\|ChatV2EventLog\|ChatV2RoomStore\|readModel\|eventLog\|roomStore" -n src test
```

Create a short call-site inventory grouped by behavior:

- session list/detail
- trace/timeline events
- user/client event append
- read markers/unread
- room CRUD/tree
- test-only helpers

### 2. Add V2-native service files

Add files under `src/data/` or a more specific namespace such as `src/apps/chat/data/`.

Suggested paths:

```text
src/apps/chat/data/session-query-service.ts
src/apps/chat/data/timeline-query-service.ts
src/apps/chat/data/event-command-service.ts
src/apps/chat/data/read-state-service.ts
src/apps/chat/data/room-service.ts
src/apps/chat/data/navigation-query-service.ts
```

Keep constructors simple:

```ts
constructor(private readonly store: PiboDataStore) {}
```

Do not add abstraction layers beyond what existing call sites need.

### 3. Move behavior out of `chat-v2-adapters.ts`

Migrate methods incrementally:

- `listSessions`, `getSession`, `upsertSession`, `hasSessionActivity` -> session/navigation services
- `listTraceEvents`, `listEvents`, `getLatestEventSequence`, `getLatestStreamId` -> timeline service
- `appendEvent`, `findByClientTxn` -> event command service
- `markSessionRead`, `getUnreadCount` -> read state service
- room methods -> room service

Preserve behavior with targeted tests before changing call sites.

### 4. Switch Chat Web wiring

Edit current construction/wiring sites, likely including:

```text
src/apps/chat/web-app.ts
src/gateway/server.ts
```

Replace adapter dependencies with the specific V2-native services each subsystem needs.

Avoid passing a large generic object where a smaller service is enough.

### 5. Update type facades

Review:

```text
src/apps/chat/event-log.ts
src/apps/chat/read-model.ts
src/apps/chat/rooms.ts
src/apps/chat/types/*.ts
```

Goal:

- Use names that describe current V2 concepts.
- Avoid names that imply old storage implementations.
- Keep compatibility exports only if many call sites still need them during one commit; remove them before final acceptance.

### 6. Remove `chat-v2-adapters.ts`

After call sites are migrated and tests pass:

```text
src/data/chat-v2-adapters.ts
```

should either be deleted or reduced to a tiny temporary re-export. Preferred final state: deleted.

### 7. Tests

Add/adjust tests around native services:

```text
test/chat-v2-session-query-service.test.mjs
test/chat-v2-timeline-query-service.test.mjs
test/chat-v2-event-command-service.test.mjs
test/chat-v2-read-state-service.test.mjs
test/chat-v2-room-service.test.mjs
```

Existing tests can be renamed/moved if they already cover the behavior.

Regression assertions:

- no import of `src/data/chat-v2-adapters`
- no runtime reference to `web-chat.sqlite`
- no runtime reference to `pibo-sessions.sqlite` except explicit migration/explicit-path tests
- timeline pagination remains bounded and cursor-based
- live-only events are not incorrectly replayed into persisted history views
- unread/read markers still work

### 8. Validation

Run:

```bash
npm run typecheck
npm run build
npm test
```

Then test in a Docker compute worker before host deployment:

```bash
pibo compute spawn
# in returned worktree/container:
npm run typecheck
npm run build
npm test
# browser smoke-test Chat Web
pibo compute release <id>
```

Deploy flow:

```bash
./scripts/deploy-web-dev.sh
# dev smoke-test
./scripts/deploy-web.sh
# production restart only with approval if blocked
```

## Acceptance Criteria

- Chat Web call sites use V2-native services, not `ChatV2ReadModel`, `ChatV2EventLog`, or `ChatV2RoomStore`.
- `src/data/chat-v2-adapters.ts` is removed or empty temporary compatibility is justified and tracked.
- No old Chat Web storage vocabulary remains in runtime service names except where discussing archived legacy data.
- Tests pass.
- Production behavior remains unchanged from the user's perspective.

## Suggested Sequencing

Do this in small commits:

1. Add service skeletons and tests for one boundary.
2. Move session/navigation queries.
3. Move timeline/event queries.
4. Move event commands/read state.
5. Move rooms.
6. Delete adapters and clean facades.
7. Deploy to dev, then production.

## Risks / Notes

- The biggest risk is behavior drift in timeline reconstruction. Keep trace/timeline tests tight.
- Do not duplicate output-event ingestion. `ChatDataIngestService` should remain the writer for Pi runtime output events.
- The service names should guide future feature work: new features should add V2-native query methods, not revive adapter-style read-model APIs.
