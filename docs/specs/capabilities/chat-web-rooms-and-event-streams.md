# Spec: Chat Web Rooms and Event Streams

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Current Pibo codebase  
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`, `docs/specs/capabilities/pibo-session-routing.md`

## Why

Chat Web needs a user-facing container above Pibo Sessions. Rooms give users a shared place to group sessions, choose a workspace, see unread activity, and follow live output without exposing raw router internals.

The room and event-stream layer must stay separate from the Pibo Session source of truth. Pibo Sessions own runtime identity and routing. Chat Web rooms, membership, read state, event log rows, SSE frames, and navigation projections make those sessions usable in the browser.

## Goal

Pibo MUST provide authenticated Chat Web rooms and event streams that group shared Pibo Sessions, persist trace/chat events, resume live streams with cursors, and maintain app-global unread state for rooms and session trees.

## Background / Current State

The current implementation is centered on `src/apps/chat/web-app.ts`, `src/apps/chat/data/room-service.ts`, `src/apps/chat/data/event-command-service.ts`, `src/apps/chat/data/read-state-service.ts`, `src/apps/chat/data/session-query-service.ts`, `src/apps/chat/data/timeline-query-service.ts`, and `src/data/schema.ts`.

Rooms, room members, event logs, read state, sessions, payloads, observations, and navigation projections live in the Pibo data store. Chat Web APIs expose bootstrap, navigation, room CRUD, session CRUD, message send, read marks, trace reads, and SSE streams under `/api/chat/*`. Runtime output is ingested into Chat Web projections and mirrored to the reliability store as `pibo.output` events.

## Scope

### In Scope

- Shared default Chat room creation for the app.
- Room listing, hierarchy, creation, update, archive, restore, and permanent deletion.
- Room existence/state checks; legacy membership rows are migration compatibility only.
- Room workspace metadata and session workspace inheritance.
- Room-scoped session creation, selection, metadata mutation, archiving, deletion, and tree rendering.
- Runtime termination controls for selected Chat Web sessions.
- User message acceptance with client transaction idempotency.
- Runtime output ingestion into event log, session index, trace projections, unread state, and live listeners.
- Server-sent event streams for selected sessions or whole rooms.
- SSE cursor parsing and replay from persisted event log rows.
- Read cursors, unread session counts, and unread room counts.

### Out of Scope

- Pibo Session routing internals — covered by the session-routing spec.
- Custom-agent profile design — covered by the custom-agents spec.
- Project-specific containers and workflows — covered by the Projects spec.
- Distributed event storage or multi-gateway stream fanout.
- Team, role, admin, or per-resource permission management.

## Requirements

### Requirement: Shared default Chat room is created on demand

The system MUST ensure the shared app has a default Chat room before Chat Web returns a default session or navigation payload.

#### Current

`ChatRoomService.ensureDefaultRoom()` finds a shared default room with `metadata.default === true` or creates one named `Shared Chat`. Legacy member rows may be written for migration compatibility, but they do not gate access.

#### Acceptance

- Bootstrap or session APIs create a default room when none exists.
- The default room belongs to the shared app context.
- Existing default rooms are reused instead of duplicated.
- The shared default room cannot be archived or deleted through normal room mutation flows.

#### Scenario: First Chat Web open

- GIVEN the shared app has no rooms
- WHEN an allowed user opens Chat Web bootstrap
- THEN Pibo creates a Shared Chat room and returns it as the selected room.

### Requirement: Rooms are shared hierarchical containers

The system MUST list and mutate rooms in the shared app context and MUST preserve parent-child room relationships.

#### Current

Fresh room records are app-global. Legacy `app_scope_marker` and membership data may exist in migrated stores, but active room APIs build one shared room tree.

#### Acceptance

- `GET /api/chat/rooms`, bootstrap, and navigation return the same rooms for all allowed accounts.
- Creating or moving a child room requires the parent room to exist and not be archived.
- Room tree output nests children under their parent when the parent exists.
- Missing parents do not crash tree rendering.

#### Scenario: Create child room

- GIVEN shared room `A` exists
- WHEN an allowed user creates room `B` with parent `A`
- THEN `B` appears as a child of `A` in the room tree for all allowed accounts.

### Requirement: Room state controls room-scoped actions

The system MUST use room existence and archive state, not account membership, before reading, writing, or mutating room resources.

#### Current

`ChatRoomService` resolves rooms by shared resource existence. Legacy membership records are retained only for migration/debug compatibility.

#### Acceptance

- Reading a room requires an authenticated request and an existing room.
- Sending a room message or creating a session in a room requires a non-archived room.
- Updating, archiving, restoring, or deleting a room requires a valid room id and normal mutation guards.
- Archived rooms reject new sessions, messages, and runtime actions.
- Missing room ids are reported as unavailable.

#### Scenario: Archived room is read-only

- GIVEN a room has `chatRoomArchivedAt` metadata
- WHEN an allowed user tries to create a session or send a message in that room
- THEN the API rejects the request and creates no session or message.

### Requirement: Room workspaces seed new session workspaces

The system MUST use room workspace metadata as the default workspace for sessions created in that room.

#### Current

Room metadata stores `workspace`. `createPersonalChatSession()` receives the room and sets session workspace from `roomWorkspaceFromMetadata()` when present.

#### Acceptance

- Creating a room may store a workspace path.
- Updating room workspace changes the workspace used for future sessions.
- New sessions in that room receive the room workspace.
- Existing sessions keep their stored workspace unless explicitly changed elsewhere.

#### Scenario: New session in workspace room

- GIVEN a room has workspace `/work/project`
- WHEN a user creates a new session in that room
- THEN the created Pibo Session stores `/work/project` as its workspace.

### Requirement: Chat messages are accepted once per client transaction

The system MUST make user-submitted chat messages idempotent when a client transaction id is supplied.

#### Current

`ChatEventCommandService.appendEvent()` derives an idempotency key from room, actor, and `clientTxnId`. `findByClientTxn()` returns the existing event when the same transaction is retried.

#### Acceptance

- Message mutations require authenticated same-origin JSON requests.
- A non-empty message is required before emitting router input.
- A repeated `clientTxnId` for the same room and actor returns the existing accepted event instead of appending a duplicate.
- Sending to an archived room is rejected before input is emitted.
- Accepted user messages are associated with the selected room and Pibo Session.

#### Scenario: Browser retries message post

- GIVEN a user submits a message with client transaction id `tx-1`
- AND the browser retries the same request
- WHEN both requests reach the server
- THEN Chat Web records one accepted user event and emits at most one router message for that transaction.

### Requirement: Runtime output is ingested into Chat Web projections

The system MUST subscribe to routed output and update Chat Web event, session, trace, unread, and live-stream state.

#### Current

`ensureEventIndexing()` subscribes to channel output, compacts output events, ingests persistable events through `ChatDataIngestService`, updates session indexes, appends `pibo.output` reliability events, and notifies live listeners.

#### Acceptance

- Persistable output events receive stream ids and session-local sequence numbers.
- Live-only deltas are available to active listeners without becoming durable chat-message rows.
- Session status and last activity update when output arrives.
- Assistant completions and session errors can mark active focused streams read.
- Ingestion errors are counted in persistence metrics and do not silently disappear.

#### Scenario: Assistant finishes a message

- GIVEN a session is selected in Chat Web
- WHEN the router emits assistant output and `message_finished`
- THEN the event log, trace version, session status, live stream, and read state reflect the finished turn.

### Requirement: Event streams replay persisted events and forward live events

The system MUST expose SSE streams that can replay missed persisted frames and then continue with live frames for either one session or one room.

#### Current

`GET /api/chat/events` creates a `text/event-stream` response. It parses `since` or `Last-Event-ID`, replays stored events via `timelineQuery.listEvents()`, adds compactor snapshots for selected sessions, subscribes to live listeners, and sends heartbeat comments.

#### Acceptance

- Event streams require an authenticated session.
- Room streams require read access to the room.
- Session streams require the selected session to exist and, when room-scoped, to be associated with the room.
- `since=<streamId>:<frameIndex>` skips already delivered frames for the same stream id.
- Stored events are emitted before live events.
- Room streams include the `piboSessionId` for unfocused sessions.
- Session streams only forward frames for the selected session.
- Streams send heartbeat comments while open and remove listeners when cancelled.

#### Scenario: Resume after disconnect

- GIVEN a browser last received SSE id `42:3`
- WHEN it reconnects with `since=42:3`
- THEN Pibo replays stored frames after that cursor and then forwards new live events.

### Requirement: Read state drives unread session and room counts

The system MUST track app-global read cursors and use them to compute unread counts for visible sessions and rooms.

#### Current

`ChatReadStateService` writes app-global read state. Legacy `principal_session_stats` rows may be read during migration, but fresh schemas use app read-state tables. Bootstrap and navigation call `countUnreadMessagesBySession()` and aggregate counts to rooms through `buildRoomUnreadCounts()`.

#### Acceptance

- Unread counts exclude events authored by the same app actor.
- Unread session counts include chat messages and session errors.
- Unread room counts aggregate visible non-archived session and child-session counts.
- Opening a room-level stream alone does not mark assistant messages read.
- Focusing a session stream can mark that selected session's completions read.
- `POST /api/chat/sessions/:id/read` marks the selected session subtree read.
- Bootstrap with `markRead=true` marks the selected session subtree read.
- Archiving a session marks its subtree read and removes it from normal unread aggregation.

#### Scenario: Mark child session read

- GIVEN a parent session has an unread child session
- WHEN the user marks the parent session subtree read
- THEN unread counts disappear from the child, parent tree, and room.

### Requirement: Session metadata mutations are bounded

The system MUST allow Chat Web to patch only supported Pibo Session metadata and MUST reject unsafe profile changes after the session has observable activity.

#### Current

`PATCH /api/chat/sessions/:id` accepts title, archived state, profile, and active model updates. It resolves the session by shared resource existence, requires same-origin JSON, delegates persistence to the channel session store, and rejects profile changes when the session has an active trace or indexed activity.

#### Acceptance

- Session patch mutations require an authenticated same-origin JSON request.
- The addressed session must exist and be in a state that allows the requested mutation.
- Title updates are normalized through the session update path.
- Archiving a session marks the selected session subtree read for the shared app read state.
- Profile changes are accepted only before the session has active trace state or indexed activity.
- Active-model changes update the Pibo Session record without changing unrelated room metadata.
- If the channel cannot update sessions, the API returns an explicit not-implemented failure.

#### Scenario: Profile change after activity is rejected

- GIVEN a Chat Web session has indexed activity
- WHEN the user patches that session with a different profile
- THEN the API rejects the patch
- AND the stored profile remains unchanged.

### Requirement: Runtime termination controls are explicit session actions

The system MUST expose authenticated Chat Web controls that terminate only the addressed owned Pibo Session or its session tree through router execution events.

#### Current

`POST /api/chat/sessions/:id/kill` and `POST /api/chat/sessions/:id/kill-all` resolve the requested shared session and emit execution actions `kill` or `kill_all` to the channel context.

#### Acceptance

- Termination mutations require same-origin JSON requests.
- Invalid or path-like session ids fail before action emission.
- The addressed session is resolved by Pibo Session ID before emission.
- `/kill` emits an execution event with action `kill` for the selected Pibo Session ID.
- `/kill-all` emits an execution event with action `kill_all` for the selected Pibo Session ID.
- The HTTP response returns the correlated execution output from the channel context.
- Termination controls do not archive, delete, or mutate room membership by themselves.

#### Scenario: Kill selected session

- GIVEN session `S` exists
- WHEN the user posts to `/api/chat/sessions/S/kill`
- THEN Chat Web emits an execution event targeting Pibo Session `S` with action `kill`
- AND returns the execution result.

### Requirement: Destructive deletion requires archive and confirmation

The system MUST require archive state before permanent deletion of rooms or sessions and MUST delete related projections consistently.

#### Current

Room deletion rejects default rooms and requires confirmation by room name. Session deletion requires archive plus the text `Delete this session`. Deletion removes affected session subtrees, room members, room records, and event/navigation projections.

#### Acceptance

- Active rooms cannot be permanently deleted until archived.
- Shared default Chat rooms cannot be permanently deleted.
- Active sessions cannot be permanently deleted until archived.
- Deleting a room deletes contained sessions and descendant room data.
- Deleting a session deletes its child-session subtree.
- Deletion responses list deleted room and session ids.

#### Scenario: Delete archived room tree

- GIVEN an archived non-default room has a parent session and child subagent session
- WHEN the user confirms deletion with the exact room name
- THEN the room, its contained session subtree, and associated Chat Web projections are removed.

## Edge Cases

- A session may lack `chatRoomId` metadata; Chat Web treats it as part of the default room when needed.
- A stored room may reference a missing parent; tree building must not crash.
- SSE cursors may be malformed; invalid cursors are ignored rather than trusted.
- A session can be a Project session; session-only event streams are used when no normal room context should be applied.
- Session profile changes after first activity are rejected even if the session is idle, because runtime and transcript assumptions may already depend on the original profile.
- Runtime termination requests can race with already-finished sessions; the execution result, not Chat Web metadata mutation, reports the outcome.
- Runtime output may arrive for a session that has not yet been indexed; indexing must upsert the session before storing activity.
- Live listeners are best-effort; persisted event replay is the recovery path after disconnect.

## Constraints

- **Product Boundary:** Rooms, members, event-log rows, read state, and navigation projections are Chat Web product data. Pibo Sessions remain the routing source of truth.
- **Security / Privacy:** All Chat Web APIs require an authenticated web session. Mutations MUST require same-origin JSON requests.
- **Compatibility:** Existing Pibo Sessions without room metadata remain reachable through the default room bridge.
- **Reliability:** Persisted stream ids and SSE cursors provide replay after browser disconnects, but do not guarantee distributed exactly-once delivery.
- **Performance:** Bootstrap and navigation SHOULD use indexed projections and avoid rebuilding full traces unless explicitly requested.

## Success Criteria

- [ ] SC-001: Opening Chat Web in a fresh shared app creates one Shared Chat room and one default selected session.
- [ ] SC-002: Room CRUD is app-global and enforces room existence/archive-state rules.
- [ ] SC-003: New sessions created in a workspace room inherit that room workspace.
- [ ] SC-004: User message posts are authenticated, same-origin, room-safe, and idempotent by client transaction id.
- [ ] SC-005: Router output updates event log, session navigation, trace freshness, live listeners, and reliability mirror events.
- [ ] SC-006: SSE streams replay persisted events after a cursor and forward only room- or session-matching live events.
- [ ] SC-007: Unread counts update for sessions, child-session trees, and rooms, and read endpoints clear the selected subtree.
- [ ] SC-008: Session metadata patches enforce shared session resolution, same-origin JSON, archive-read side effects, and profile-change limits.
- [ ] SC-009: Runtime termination endpoints emit only `kill` or `kill_all` execution actions for the resolved session.
- [ ] SC-010: Permanent deletion requires prior archive and exact confirmation, and removes associated projections.

## Assumptions and Open Questions

### Assumptions

- Authentication is the app access gate; room membership is legacy storage compatibility, not a product authorization boundary.
- The default room bridge for sessions without `chatRoomId` is still required for compatibility.
- Room-level streams are for observation and should not mark messages read unless a session is actively selected.

### Open Questions

- When should legacy `room metadata` and old principal read-state columns be fully removed from migrated stores?
- Should archived rooms still allow read-only SSE replay indefinitely?
- Should room deletion offer export before deleting sessions and event history?
- Should runtime termination endpoints be hidden or disabled for already-terminal session signals?
- No room roles are planned in this shared-app migration; any future permission model requires a separate spec.

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 Shared default Chat room is created on demand | First Chat Web open | `src/apps/chat/data/room-service.ts`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-002 Rooms are shared hierarchical containers | Create child room | `src/apps/chat/data/room-service.ts`, `src/data/schema.ts` | Implemented |
| REQ-003 Room state controls room-scoped actions | Archived room is read-only | `src/apps/chat/data/room-service.ts`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-004 Room workspaces seed new session workspaces | New session in workspace room | `src/apps/chat/web-app.ts`, `src/apps/chat/types/rooms.ts` | Implemented |
| REQ-005 Chat messages are accepted once per client transaction | Browser retries message post | `src/apps/chat/data/event-command-service.ts`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-006 Runtime output is ingested into Chat Web projections | Assistant finishes a message | `src/apps/chat/web-app.ts`, `src/data/ingest-service.ts`, `src/apps/chat/output-compactor.ts` | Implemented |
| REQ-007 Event streams replay persisted events and forward live events | Resume after disconnect | `src/apps/chat/web-app.ts`, `src/apps/chat/stream.ts`, `src/apps/chat/data/timeline-query-service.ts` | Implemented |
| REQ-008 Read state drives unread session and room counts | Mark child session read | `src/apps/chat/data/read-state-service.ts`, `src/apps/chat/web-app.ts` | Implemented |
| REQ-009 Session metadata mutations are bounded | Profile change after activity is rejected | `src/apps/chat/web-app.ts`, `src/sessions/store.ts`, `src/sessions/sqlite-store.ts` | Implemented |
| REQ-010 Runtime termination controls are explicit session actions | Kill owned session | `src/apps/chat/web-app.ts`, `src/core/events.ts`, `src/core/session-router.ts` | Implemented |
| REQ-011 Destructive deletion requires archive and confirmation | Delete archived room tree | `src/apps/chat/web-app.ts`, `src/apps/chat/data/session-query-service.ts`, `src/apps/chat/data/event-command-service.ts` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/web-channel.test.mjs`, `test/chat-ui-integration.test.mjs`, `test/chat-trace-materialization.test.mjs`, `test/chat-v2-native-services.test.mjs`, `test/data-v2-ingest-service.test.mjs`, `test/session-actions.test.mjs`, and `test/session-router-store.test.mjs`.
