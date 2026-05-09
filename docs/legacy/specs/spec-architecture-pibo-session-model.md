---
title: Pibo Session Model Rebuild
version: 1.0
date_created: 2026-04-29
last_updated: 2026-05-01
owner: Pibo
tags: [architecture, sessions, routing, web-chat, plugins]
---

# Introduction

This specification defines the implemented architecture that replaced the previous `sessionKey` and session binding model with a first-class Pibo Session model.

The current prototype has no production data that must be preserved. The implementation may delete existing local session state and rebuild the schema without backward-compatible migration.

## 1. Purpose & Scope

The purpose of this specification is to remove overloaded string-based `sessionKey` routing and replace it with explicit product data:

- A **Pibo Session** is the stable product-level session used by channels, APIs, UI, routing, access control, profile selection, and hierarchy.
- A **Pi Session** is the technical Pi Coding Agent persistence identity used for JSONL transcript files, provider cache affinity, fork, clone, switch, tree navigation, and compaction.

This specification applies to:

- Session store schema and TypeScript contracts.
- Session router routing identity.
- Gateway channel context APIs.
- Chat Web App APIs and UI data contracts.
- Fork, clone, and switch behavior.
- Subagent session creation and reuse.
- Trace/read-model persistence.
- Plugin extensibility for channel-specific session concepts.

This specification does not require migration of existing prototype data.

## 2. Definitions

- **Pibo Session**: Product-level session record owned by Pibo. It has a stable `id`.
- **Pibo Session ID**: The `PiboSession.id` value. It replaces `sessionKey` as the route, API, UI, and event correlation identity.
- **Pi Session ID**: The `PiboSession.piSessionId` value. It is the technical Pi Coding Agent session identifier.
- **Pibo Room**: A user-facing Chat Web container that groups one or more Pibo Sessions for display, membership, room events, and room-scoped sending.
- **Channel**: A plugin-owned transport adapter. Stored as an open string identifier, not a closed enum.
- **Kind**: A plugin-defined session classification string, such as `chat`, `branch`, `subagent`, or a plugin-specific concept.
- **Owner Scope**: A string used for access control and listing, such as `user:<auth-user-id>`.
- **Parent Session**: A true hierarchical child relationship, represented by `parentId`. This is used for subagents and other nested agent work.
- **Origin Session**: A derivation relationship, represented by `originId`. This is used for forked or cloned sessions and must not imply UI nesting.
- **Session Metadata**: Plugin-owned JSON object attached to a Pibo Session. Core may store and return it but must not require plugin-specific fields.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The system must remove `sessionKey` from new core session contracts.
- **REQ-002**: The system must route by `PiboSession.id`.
- **REQ-003**: The system must store the technical Pi session identity separately as `PiboSession.piSessionId`.
- **REQ-004**: The system must use `PiboSession.profile` to select the runtime profile for that session.
- **REQ-005**: The system must use `PiboSession.ownerScope` for access control and user-visible session listing.
- **REQ-006**: The system must use `PiboSession.parentId` as the only source of UI/tree nesting.
- **REQ-007**: Forked and cloned sessions must become new visible Pibo Sessions. The UI must select the new Pibo Session after creation.
- **REQ-008**: Forked and cloned sessions must use `originId` to reference the source Pibo Session.
- **REQ-009**: `originId` must not cause sidebar nesting.
- **REQ-010**: Subagent sessions must use `parentId` and must be nested under the parent session in the UI.
- **REQ-011**: Subagent reuse must be based on structured fields, not string parsing.
- **REQ-012**: Plugin-owned session concepts must be represented through open string fields and JSON metadata.
- **REQ-013**: The Chat Web App must not infer ownership from IDs, prefixes, or string patterns.
- **REQ-014**: The router must not need to know user identity. It should receive a resolved Pibo Session ID and load the corresponding Pibo Session record.
- **REQ-015**: Events emitted by the router must identify the product session with `piboSessionId`.
- **REQ-016**: Events that expose Pi session state must use explicit `piSessionId` fields.
- **REQ-017**: Pibo Rooms must not replace Pibo Session identity; runtime routing, API operations, trace reconstruction, and event correlation must continue to use `PiboSession.id`.
- **REQ-018**: Chat Web room membership must not be inferred from Pibo Session ID prefixes or string patterns.
- **REQ-019**: The current Chat Web room bridge must store room membership on the Pibo Session using `metadata.chatRoomId`.
- **REQ-020**: Room-scoped session listing must filter by structured `metadata.chatRoomId` and owner access, not by parsing session ids.
- **REQ-021**: A Pibo Room may contain multiple top-level Pibo Sessions; subagent nesting inside that room still follows `parentId`.
- **REQ-022**: Pibo Room access and membership are Chat Web product concepts and must not be moved into Pi Session identity.
- **REQ-023**: When a subagent session is created from a parent Pibo Session that has `metadata.chatRoomId`, the subagent session must inherit the same `metadata.chatRoomId`.
- **CON-001**: No backward-compatible data migration is required for existing prototype data.
- **CON-002**: `channel` and `kind` must be open strings, not TypeScript union types.
- **CON-003**: Plugin-specific state must not require new core database columns.
- **CON-004**: Core code must not parse `PiboSession.id` to derive owner, kind, parent, profile, or channel.
- **GUD-001**: Use `id` for stored Pibo Session records.
- **GUD-002**: Use `piboSessionId` in events and request bodies when both Pibo and Pi identities may appear.
- **GUD-003**: Use `piSessionId` only for Pi persistence and Pi session operations.
- **GUD-004**: Keep Pibo Session IDs short and opaque.

## 4. Interfaces & Data Contracts

### 4.1 Pibo Session

```ts
export type PiboJsonObject = Record<string, PiboJsonValue>;

export type PiboSession = {
  id: string;
  piSessionId: string;
  channel: string;
  kind: string;
  profile: string;
  ownerScope?: string;
  parentId?: string;
  originId?: string;
  workspace?: string;
  title?: string;
  metadata?: PiboJsonObject;
  createdAt: string;
  updatedAt: string;
};
```

### 4.2 Session ID Generation

Pibo Session IDs must be short, opaque, and route-safe.

Recommended format:

```text
ps_<uuid>
```

Examples:

```text
ps_7e7d5a0f-2d65-4538-b876-8a12e89f58f1
```

The prefix exists only for debugging and collision avoidance. Core must not parse meaning from the ID.

### 4.3 Session Store

The session store replaces the old binding-oriented store.

```ts
export type CreatePiboSessionInput = {
  id?: string;
  channel: string;
  kind: string;
  profile: string;
  ownerScope?: string;
  parentId?: string;
  originId?: string;
  piSessionId?: string;
  workspace?: string;
  title?: string;
  metadata?: PiboJsonObject;
};

export type UpdatePiboSessionInput = {
  piSessionId?: string;
  profile?: string;
  ownerScope?: string;
  parentId?: string | null;
  originId?: string | null;
  workspace?: string | null;
  title?: string | null;
  metadata?: PiboJsonObject;
};

export type FindPiboSessionsInput = {
  ids?: string[];
  channel?: string;
  kind?: string;
  ownerScope?: string;
  parentId?: string | null;
  originId?: string;
  profile?: string;
  metadata?: PiboJsonObject;
};

export type PiboSessionStore = {
  get(id: string): PiboSession | undefined;
  list?(): PiboSession[];
  create(input: CreatePiboSessionInput): PiboSession;
  update(id: string, input: UpdatePiboSessionInput): PiboSession | undefined;
  find(input: FindPiboSessionsInput): PiboSession[];
  close?(): void;
};
```

### 4.4 SQLite Schema

No migration from the prototype schema is required. Existing local files may be deleted before implementation.

```sql
CREATE TABLE pibo_sessions (
  id TEXT PRIMARY KEY,
  pi_session_id TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  profile TEXT NOT NULL,
  owner_scope TEXT,
  parent_id TEXT,
  origin_id TEXT,
  workspace TEXT,
  title TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(parent_id) REFERENCES pibo_sessions(id),
  FOREIGN KEY(origin_id) REFERENCES pibo_sessions(id)
);

CREATE INDEX idx_pibo_sessions_owner ON pibo_sessions(owner_scope, updated_at);
CREATE INDEX idx_pibo_sessions_parent ON pibo_sessions(parent_id, updated_at);
CREATE INDEX idx_pibo_sessions_origin ON pibo_sessions(origin_id, updated_at);
CREATE INDEX idx_pibo_sessions_channel_kind ON pibo_sessions(channel, kind, updated_at);
```

### 4.5 Router Events

All router input and output events must identify the product session using `piboSessionId`.

```ts
export type PiboMessageEvent = {
  type: "message";
  piboSessionId: string;
  id?: string;
  text: string;
  source?: PiboEventSource;
};
```

Session operation results must expose both identities when relevant.

```ts
export type PiboSessionOperationResult = {
  piboSessionId: string;
  previous: {
    piSessionId: string;
    sessionFile?: string;
    leafId?: string | null;
    cwd?: string;
  };
  current: {
    piSessionId: string;
    sessionFile?: string;
    leafId?: string | null;
    cwd?: string;
  };
  cancelled: boolean;
};
```

### 4.6 Web Chat API

Requests must use `piboSessionId`.

```http
GET /api/chat/bootstrap?piboSessionId=<id>
GET /api/chat/bootstrap?roomId=<id>&piboSessionId=<id>
GET /api/chat/trace?piboSessionId=<id>
POST /api/chat/sessions
POST /api/chat/message
POST /api/chat/action
```

Message body:

```json
{
  "piboSessionId": "ps_...",
  "roomId": "room_...",
  "text": "Hello"
}
```

Create session response:

```json
{
  "session": {
    "id": "ps_...",
    "piSessionId": "...",
    "channel": "pibo.chat-web",
    "kind": "chat",
    "profile": "codex-compat-openai-web",
    "ownerScope": "user:bIibEngJFSvdfQAlDbk43djVBG6Zr2Qc",
    "parentId": null,
    "originId": null,
    "metadata": {
      "chatRoomId": "room_..."
    }
  }
}
```

### 4.7 Plugin Metadata Examples

Slack-like channel:

```json
{
  "channel": "pibo.slack",
  "kind": "thread",
  "ownerScope": "slack-workspace:T123:user:U456",
  "metadata": {
    "slackChannelId": "C123",
    "threadTs": "1710000000.000100"
  }
}
```

Subagent:

```json
{
  "channel": "pibo.subagents",
  "kind": "subagent",
  "parentId": "ps_parent",
  "profile": "researcher",
  "metadata": {
    "subagentName": "researcher",
    "threadKey": "auth-plan"
  }
}
```

## 5. Acceptance Criteria

- **AC-001**: Given a new authenticated web user, When the Chat Web App loads, Then a Pibo Session is created with `ownerScope=user:<userId>` and no `sessionKey`.
- **AC-002**: Given a user clicks New Session, When the API creates the session, Then the new session has a fresh `id`, fresh `piSessionId`, `kind=chat`, and the same `ownerScope`.
- **AC-003**: Given a user requests another user's session ID, When the API resolves the session, Then the request is rejected because `ownerScope` does not match.
- **AC-004**: Given a user forks a message, When the fork succeeds, Then a new visible Pibo Session is created and selected.
- **AC-005**: Given a forked session, When the sidebar renders, Then it is top-level unless it has `parentId`.
- **AC-006**: Given a subagent call with a `threadKey`, When the same parent session calls the same subagent and thread key again, Then the same subagent Pibo Session is reused.
- **AC-007**: Given a subagent session, When the sidebar renders, Then it appears under its parent session because `parentId` is set.
- **AC-008**: Given a plugin creates a custom session kind, When the session is stored, Then no core schema change is required.
- **AC-009**: Given a trace view request, When the selected Pibo Session is loaded, Then Pi transcript loading uses `piSessionId`.
- **AC-010**: Given any new code path, When it needs session ownership, Then it reads `ownerScope` and does not parse the session ID.
- **AC-011**: Given a room-scoped bootstrap request, When the selected room contains multiple sessions, Then only sessions with matching `metadata.chatRoomId` are returned.
- **AC-012**: Given a session has no `metadata.chatRoomId`, When the default room is selected during the migration bridge period, Then the session may be treated as belonging to the default room and should be updated with the default room id when practical.
- **AC-013**: Given a session belongs to Room A, When a message request supplies Room B, Then the request is rejected.
- **AC-014**: Given a parent session belongs to Room A, When a subagent child session is created, Then the child session metadata contains Room A's `chatRoomId`.
- **AC-015**: Given a selected subagent session in Chat Web, When the trace header renders, Then it shows the session's `parentId` chain as breadcrumbs and allows reopening those ancestor sessions without treating fork origins as parents.
- **AC-016**: Given a selected forked or cloned session with an `originId`, When the trace header renders, Then it exposes a separate origin-session control and does not treat the origin as a parent breadcrumb.
- **AC-017**: Given a session that has direct derived fork or clone sessions, When the trace header renders, Then it exposes a derived-session picker that lists those branches without nesting them under `parentId`.

## 6. Test Automation Strategy

- **Unit Tests**:
  - Pibo Session ID generation.
  - Pibo Session store create, update, get, find.
  - Owner scope filtering.
  - Parent and origin relationship storage.
  - Metadata persistence.

- **Integration Tests**:
  - Chat Web App bootstrap creates a first Pibo Session.
  - New Session creates a second visible Pibo Session.
  - Fork creates and selects a new visible Pibo Session.
  - Subagent calls create nested Pibo Sessions.
  - Different users cannot access each other's sessions.

- **Regression Tests**:
  - No new code path creates or expects `sessionKey`.
  - Sidebar nesting only follows `parentId`.
  - Fork/origin sessions are not nested.
  - Plugin-defined `channel`, `kind`, and `metadata` survive round-trips.

- **Manual QA**:
  - Delete `.pibo/pibo-sessions.sqlite`, `.pibo/web-chat.sqlite`, and relevant Pi JSONL sessions before testing a clean rebuild.
  - Start the Chat Web App.
  - Verify first session, new sessions, forks, and subagents in the UI.
  - Open a nested subagent session and verify the trace header breadcrumbs reopen the parent chain from the selected room-scoped session tree.
  - Open a forked or cloned session and verify the trace header origin control reopens the source session without nesting the branch under that origin in the sidebar.
  - Open a session with one or more forked or cloned descendants and verify the trace header derived-session picker opens those branch sessions directly.
  - Inspect raw events and verify they use `piboSessionId`, not `sessionKey`.

## 7. Rationale & Context

The previous `sessionKey` model mixed multiple concerns in one string:

- Routing.
- User ownership.
- Channel identity.
- Session kind.
- Branch/fork relationship.
- Subagent parentage.

This caused long keys, especially for deep subagent nesting, and required prefix parsing in the Chat Web App. It also made plugin extension awkward because every new concept tended to become another string convention.

The new model separates concerns:

- `id` routes.
- `piSessionId` persists Pi state.
- `ownerScope` authorizes.
- `profile` selects runtime behavior.
- `parentId` nests.
- `originId` explains derivation.
- `channel`, `kind`, and `metadata` allow plugin-specific concepts without schema changes.

The new fork behavior is intentionally product-centric: forking creates a new visible Pibo Session and selects it. It does not silently replace the technical Pi Session under the same product route.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Pi Coding Agent SessionManager - Required for Pi JSONL session persistence and transcript loading.
- **EXT-002**: Pibo Plugin Registry - Required for profile resolution, channels, gateway actions, and plugin-owned session concepts.
- **EXT-003**: Pibo Auth Service - Required for authenticated owner scope construction in web channels.

### Infrastructure Dependencies

- **INF-001**: SQLite Session Store - Required local persistence for Pibo Sessions.
- **INF-002**: Chat Web Read Model - Required persisted index of web events and session activity.

### Data Dependencies

- **DAT-001**: Pibo Session Store - Source of truth for Pibo Session metadata and access control.
- **DAT-002**: Pi Session Files - Source of truth for model transcript reconstruction.

## 9. Examples & Edge Cases

### New Chat Session

```json
{
  "id": "ps_7e7d5a0f-2d65-4538-b876-8a12e89f58f1",
  "piSessionId": "4d0449c6-b931-4db6-b797-b89f3630442a",
  "channel": "pibo.chat-web",
  "kind": "chat",
  "profile": "codex-compat-openai-web",
  "ownerScope": "user:bIibEngJFSvdfQAlDbk43djVBG6Zr2Qc",
  "metadata": {
    "chatRoomId": "room_2a3c"
  }
}
```

### Forked Session

```json
{
  "id": "ps_107a7ab8-6db1-4eb6-bf47-54719a2555da",
  "piSessionId": "c8cbfdfa-7fed-409b-b85d-4f980bf0d07e",
  "channel": "pibo.chat-web",
  "kind": "branch",
  "profile": "codex-compat-openai-web",
  "ownerScope": "user:bIibEngJFSvdfQAlDbk43djVBG6Zr2Qc",
  "originId": "ps_7e7d5a0f-2d65-4538-b876-8a12e89f58f1",
  "parentId": null
}
```

### Nested Subagent Session

```json
{
  "id": "ps_d4e0a43e-4f42-4c0d-ae0c-18f9504fdcaa",
  "piSessionId": "d9226b42-535b-4df1-9b54-b7ca99c421fb",
  "channel": "pibo.subagents",
  "kind": "subagent",
  "profile": "researcher",
  "ownerScope": "user:bIibEngJFSvdfQAlDbk43djVBG6Zr2Qc",
  "parentId": "ps_7e7d5a0f-2d65-4538-b876-8a12e89f58f1",
  "metadata": {
    "chatRoomId": "room_2a3c",
    "subagentName": "researcher",
    "threadKey": "auth-plan"
  }
}
```

### Edge Cases

- A session may have no `ownerScope` for trusted local or system-owned workflows.
- A session may have `originId` and `parentId`, but the UI must only nest by `parentId`.
- A plugin may define `kind=thread` or `kind=incident` without changing core code.
- Metadata queries should initially support exact-match fields only. Complex JSON querying can be added later.

## 10. Validation Criteria

- No TypeScript source file references `sessionKey` in new runtime, router, web chat, or event contracts.
- Existing prototype data can be deleted and the system recreates all required tables on startup.
- `npm run typecheck` passes.
- `npm test` passes.
- Chat Web App can create, select, message, fork, and display sessions.
- Subagent traces link to child sessions using `parentId`.
- Sidebar nesting is correct for deep subagent chains without long route IDs.
- Plugin tests can create a custom session `channel`, `kind`, and `metadata` without schema changes.

## 11. Related Specifications / Further Reading

- [Runtime Boundary Specification](./spec-architecture-runtime-boundary.md)
- [Events and Gateway Schema Specification](./spec-schema-events-and-gateway.md)
- [Web Auth and Chat Infrastructure Specification](./spec-infrastructure-web-auth-chat.md)
- [Web Chat Trace UI Specification](./spec-design-web-chat-trace-ui.md)
