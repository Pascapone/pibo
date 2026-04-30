# Chat Rooms And Durable Event Log

The Chat Web App is now organized around user-facing **Pibo Rooms** while still routing agent execution through **Pibo Sessions**.

This split is intentional:

- **Pibo Rooms** are the chat containers users select in the web UI.
- **Pibo Sessions** are runtime conversations backed by Pi Coding Agent.
- A room can contain one or more sessions.
- A session belongs to a room through `PiboSession.metadata.chatRoomId`.

Rooms do not replace sessions. They give the web app a stable user-facing place to group sessions, persist chat events, and recover from reconnects.

## First Login

When a user signs in for the first time, the Chat Web App creates a personal default room automatically.

The flow is:

```text
GET /api/chat/bootstrap
  -> require Better Auth session
  -> ownerScope = user:<auth-user-id>
  -> ensure default room for ownerScope
  -> ensure a top-level chat Pibo Session in that room
  -> return rooms, selectedRoomId, selectedPiboSessionId, and room-scoped sessions
```

The default room is named `Personal Chat` and is stored in `.pibo/web-chat.sqlite` with metadata `{ "default": true }`. The authenticated owner is added as an `owner` member.

This means a brand-new user should always land in a usable personal room with a writable selected session. No manual room creation is required for first use.

## Data Model

Chat room data is stored in `.pibo/web-chat.sqlite`.

`pibo_rooms` stores:

- room identity
- owner scope
- name and topic
- room type: `space`, `chat`, or `agent`
- optional parent room
- optional retention policy id
- metadata

`pibo_room_members` stores:

- room id
- principal id, currently the web `ownerScope`
- role: `owner`, `admin`, `member`, or `viewer`
- join timestamp
- last read stream id

`chat_events` stores durable room/session events with a monotone `stream_id`. It records user accepts/failures, router output events, event type, actor, optional `client_txn_id`, retention class, and JSON payload.

## Message Sends

The main send path is still compatible with the existing session API:

```text
POST /api/chat/message
```

The request may include:

- `piboSessionId`
- `roomId`
- `text`
- `clientTxnId`

For room-specific callers, the equivalent endpoint is:

```text
POST /api/chat/rooms/:roomId/messages
```

The server persists `user.message.accepted` before emitting to the session router. If the router throws, it records `user.message.failed`.

`clientTxnId` makes retries idempotent per `(roomId, actorId, clientTxnId)`. Retrying the same payload returns the already accepted event and does not start another agent run.

## Live Events And Reconnects

The Chat Web SSE stream remains the live transport:

```text
GET /api/chat/events?piboSessionId=...&roomId=...
```

Persistent SSE frames use a frame cursor:

```text
id: <streamId>:<frameIndex>
```

This is frame-specific because one stored chat event can expand into multiple UI stream frames. Reconnects can resume with `Last-Event-ID` or `?since=<streamId>:<frameIndex>` without replaying partial frame bundles incorrectly.

Heartbeat comments keep stale connections detectable.

## UI Behavior

The Chat Web App sidebar shows:

- Rooms first.
- Sessions for the selected room below.
- Subsessions under their parent session when present.

Selecting a room clears the previous selected session in the client, asks `/api/chat/bootstrap?roomId=...` for the room-scoped default selection, and disables the composer until the new selected session is ready.

The composer sends messages to the selected session and active room. On non-secure LAN origins where `crypto.randomUUID()` is unavailable, the UI falls back to a timestamp/random client transaction id so sends still work.

## Retention

Chat events have retention classes:

- `live_delta`
- `trace_event`
- `chat_message`
- `audit_event`

`ChatEventLog.purgeExpired(...)` can delete old events by class without touching Pi JSONL transcripts or the Pibo Session Store.

The current implementation provides the store and purge primitive. A scheduled background purge policy is still a later operational hardening step.

## Compatibility

The old `web_chat_events` read model remains in place for trace reconstruction and debugging. The durable `chat_events` log is written in parallel and is used for room/event recovery and SSE catch-up.

Legacy session-based clients can continue to call `/api/chat/bootstrap`, `/api/chat/message`, `/api/chat/trace`, and `/api/chat/events?piboSessionId=...`.

The React UI also tolerates older bootstrap payloads without room fields so a stale backend does not crash the app. Full room controls require a backend that serves the room APIs.
