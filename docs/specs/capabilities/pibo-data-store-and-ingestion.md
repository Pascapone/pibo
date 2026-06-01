# Spec: Pibo Data Store and Chat Ingestion

**Status:** Draft
**Created:** 2026-05-10
**Updated:** 2026-05-17
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Pibo Session Routing](./pibo-session-routing.md), [Debug CLI](./debug-cli.md)

## Why

Pibo needs one local, queryable data model for sessions, rooms, messages, observations, payload references, navigation, and migration bookkeeping. Legacy stores still exist for compatibility, but new Chat Web and debugging behavior needs a stable v2 store that can ingest user input and runtime output without duplicating rows or losing large payloads.

This spec captures the current `src/data` behavior as a durable product contract. It does not replace the Pibo Session Store, Chat Web room, runtime telemetry, workflow, or reliability specs; it defines the v2 data-store capability used for default session storage, Chat Web projections, event ingestion, payload storage, navigation, and data CLI repair/migration operations.

## Goal

Pibo SHALL maintain a SQLite-backed v2 data store that can serve as the default routed session store and that idempotently ingests Chat Web user messages and Pibo output events into ordered event, message, observation, payload, session, and navigation projections.

## Background / Current State

The current implementation creates `.pibo/pibo.sqlite` through `PiboDataStore`, applies schema version 2, enables foreign keys, sets a busy timeout, and uses WAL for file-backed stores. The store owns sub-stores for payloads, event log rows, chat messages, observations, session navigation, sessions, and runtime telemetry. Chat Web also creates workflow authoring/catalog tables in this same database; those tables are covered by workflow specs and local store stewardship docs rather than by the `src/data` sub-store contract.

`PiboDataSessionStore` implements the default gateway `PiboSessionStore` on the shared `sessions` table. `ChatDataIngestService` writes accepted user messages and normalized `PiboOutputEvent` records. It records append-only event rows, creates message and observation projections, upserts session and navigation metadata, and externalizes large content into a compressed payload directory.

## Scope

### In Scope

- v2 data-store database creation and schema application.
- Event log append and listing behavior.
- Payload storage, deduplication, compression, and reading.
- Chat Web user-message ingestion.
- Pibo output-event ingestion into event, message, observation, session, and navigation projections.
- V2-native Chat Web room, session, timeline, event-command, and read-state services.
- Data CLI inventory and repair/migration behavior that operates on v2 store files.

### Out of Scope

- Legacy Chat Web read model semantics — covered by Chat Web specs.
- Session-store semantics above the v2 table adapter — covered by the Pibo Session Store spec.
- Runtime telemetry table semantics — covered by Runtime Observability Telemetry.
- Workflow UI authoring/catalog tables created in `pibo.sqlite` by Chat Web — covered by workflow and local-store stewardship specs.
- Reliability event streams, durable jobs, and yielded-run records in `.pibo/pibo-events.sqlite` — separate capability.
- UI rendering of messages and observations — consumers of this store decide presentation.

## Requirements

### Requirement: V2 store initializes deterministically

The system MUST create or open the v2 SQLite store at the configured path and apply the current schema idempotently.

#### Current

`PiboDataStore` defaults to `piboHomePath("pibo.sqlite")`, creates parent directories, enables `PRAGMA busy_timeout = 5000`, enables foreign keys, uses WAL for file-backed stores, and calls `applyPiboDataSchema`.

#### Target

Opening an existing or new v2 store yields the same table/index contract and sets `PRAGMA user_version` to the code-declared schema version.

#### Acceptance

- Applying the schema twice leaves one copy of each expected table and index.
- The database contains sessions, rooms, room members, payloads, event log, chat messages, observations, stats, navigation, indexer offsets, migration import map, and telemetry tables.
- File-backed stores use the configured database path and payload root.

#### Scenario: Fresh v2 store

- GIVEN no v2 database file exists
- WHEN Pibo opens `PiboDataStore`
- THEN the database is created with schema version 2 and all v2 tables are present

### Requirement: Event log appends are ordered and idempotent

The system MUST append conversation events with a monotonically increasing `streamId` and MUST return the existing row when the same idempotency key is appended again.

#### Current

`PiboEventLogStore.appendEvent` checks `idempotencyKey`, inserts an event row, and retrieves the row by stream id or idempotency key.

#### Target

Consumers can safely retry event appends without creating duplicate event rows.

#### Acceptance

- Event rows can be listed by session, room, topic, and `afterStreamId` in ascending stream order.
- Duplicate appends with the same idempotency key return the original `streamId` and original attributes.
- List limits are bounded.

#### Scenario: Retried append

- GIVEN an event was appended with idempotency key `append-1`
- WHEN the same append is retried with different preview text
- THEN only one event row exists and the stored preview remains the first committed value

### Requirement: Payloads are content-addressed and externalized for large values

The system MUST store large or explicitly written payloads as compressed files addressed by SHA-256 and referenced from database rows.

#### Current

`PayloadStore.writePayload` serializes text, JSON, or binary values, gzips bytes, stores files under `payloads/sha256/<prefix>/<prefix>/<hash>.<ext>.gz`, and increments `ref_count` for duplicate SHA-256 content.

#### Target

Large message and event bodies do not bloat the SQLite event or message rows, while repeated payload content is stored once.

#### Acceptance

- Writing the same payload bytes twice returns the same payload id and increments `ref_count`.
- Stored payloads can be read back as bytes, text, or JSON according to caller intent.
- Inline previews remain bounded and safe for navigation or list views.

#### Scenario: Large user message

- GIVEN a user message exceeds the inline message threshold
- WHEN the message is ingested
- THEN the message row references a payload id and does not store the full text inline

### Requirement: User-message ingestion is idempotent per client transaction

The system MUST ingest accepted Chat Web user messages exactly once per room, actor, and client transaction id.

#### Current

`ingestUserMessageAccepted` builds an idempotency key from room id, actor id, and `clientTxnId`, writes a `chat` topic event, inserts a user message projection, upserts the session, and updates session navigation.

#### Target

Client retries after network errors or duplicate sends do not create duplicate messages or event rows.

#### Acceptance

- The first ingest returns `duplicate: false` and creates event, message, session, and navigation rows.
- A retry with the same client transaction returns `duplicate: true` and the same message id.
- The event type is `user.message.accepted`, retention class is `chat_message`, and preview text is normalized.

#### Scenario: Retried accepted input

- GIVEN a Chat Web client sends text with `clientTxnId = txn-1`
- WHEN ingestion runs twice with the same room and actor
- THEN only one chat event and one user message exist for that transaction

### Requirement: Runtime output ingestion shadows messages and observations

The system MUST ingest normalized runtime output into append-only `pibo.output` events and derived projections that support chat views and diagnostics.

#### Current

`ingestOutputEvent` computes an event-specific idempotency key, appends a `pibo.output` event, optionally creates an assistant message, always inserts an observation, and updates navigation for assistant, finish, and session-error events.

#### Target

The v2 store can reconstruct high-level message lists and operational observations from normalized runtime output without relying on Pi transcript files as its primary query path.

#### Acceptance

- Assistant messages create both a `pibo.output` event and an assistant `chat_messages` row.
- Tool output creates a tool observation with the tool name and status.
- Progressive tool-call argument snapshots may create distinct events when their completeness or argument hash differs.
- Re-ingesting the same output event returns the existing stream id when its idempotency key matches.

#### Scenario: Assistant output retry

- GIVEN an assistant message output event has event id `run-output-1`
- WHEN that output event is ingested twice
- THEN one event, one assistant message, and one observation exist for the session

### Requirement: Session and navigation rows track current conversation placement

The system MUST upsert session metadata and navigation rows when session-store operations or ingestion establishes or updates room activity.

#### Current

The `sessions` table stores Pibo Session identity, linked Pi session id, legacy controller compatibility value when present, room id, root/parent/origin ids, channel, kind, profile, active model, workspace, title, status, metadata, timestamps, and first-message preview. In normal gateway startup, `PiboDataSessionStore` uses this table as the routed Pibo Session Store. The navigation projection stores app context room, session hierarchy, title, profile, status, last activity, last message preview, child count, sort key, and archive state.

#### Target

Routing can use the v2 session table through `PiboDataSessionStore`, and room/session lists can query v2 projections by room without scanning transcripts or raw events.

#### Acceptance

- V2-backed session-store create, update, delete, list, and find operations preserve Pibo Session identity semantics.
- User-message ingestion sets first message preview only when not already present.
- Root session id is the session id for roots and uses parent/root metadata for children.
- Navigation listing filters by optional room id, archive visibility, and bounded limit, ordered by sort key descending. Legacy controller filters are migration compatibility only.

#### Scenario: New room activity

- GIVEN a session has no v2 projection row
- WHEN its first user message is ingested for a room
- THEN the session row has that room id and the navigation row appears in that room for all allowed accounts

### Requirement: V2-native Chat Web services read and write through the v2 store

The system MUST provide Chat Web service adapters for rooms, sessions, timelines, event commands, and read state that operate on the v2 data store without using legacy Chat Web stores.

#### Current

`ChatRoomService`, `ChatSessionQueryService`, `ChatTimelineQueryService`, `ChatEventCommandService`, and `ChatReadStateService` wrap `PiboDataStore`. They create shared default rooms, upsert sessions and navigation rows, append idempotent chat events, list bounded room/session timelines, expose trace events in session order, and track app-global read progress.

#### Target

Chat Web call sites can move to v2-native services while retaining existing room, session, timeline, and unread-count behavior.

#### Acceptance

- Default room creation is app-global. Legacy membership rows are compatibility data only.
- Session upsert writes both the session projection and navigation projection.
- Chat event append with the same room, actor, and client transaction id returns the first stored event.
- Timeline listing supports room id, Pibo Session id, `afterStreamId`, and bounded limits ordered by ascending stream id.
- Trace event listing excludes live-only event types by default and orders by ascending session sequence.
- Read-state counting excludes messages sent by the same app actor and ignores events at or below the app read cursor.
- Marking a session read is monotonic; a lower later cursor does not reduce the stored read cursor.

#### Scenario: V2-native chat service flow

- GIVEN a fresh v2 store and the app context read-state actor
- WHEN Chat Web ensures the default room, upserts a Pibo Session, appends a user event and an assistant event, lists the timeline, and marks the session read
- THEN the duplicate user append returns the first event
- AND the timeline returns the stored events in stream order
- AND unread counts drop to zero after the read cursor reaches the latest stream id.

### Requirement: Data CLI reports and repair operations are bounded

The system MUST expose operator-facing data diagnostics and repairs without mutating unrelated stores by default.

#### Current

`pibo data inventory` reports selected store files, sizes, WAL sizes, integrity, page stats, and table counts. `pibo data migrate sessions-to-v2` copies legacy session metadata into the v2 store. `pibo data repair unread-baseline` is a legacy compatibility command that requires app partition and cutoff timestamp and supports dry-run mode.

#### Target

Operators and agents can inspect data-store state, migrate session projections, and repair unread baselines with explicit inputs and JSON output support.

#### Acceptance

- Inventory can run against a configured root and includes v2, v2-shadow, legacy sessions, legacy chat, reliability, and auth stores.
- Session migration reports read, inserted, updated, skipped, and source-existence counts.
- Unread repair is a legacy compatibility command that refuses to run without app partition and cutoff timestamp; app-context migration uses `pibo data app-context` instead.

#### Scenario: Inventory for missing root store

- GIVEN a configured Pibo home has no `pibo.sqlite`
- WHEN `pibo data inventory --json` runs
- THEN the v2 inventory item marks `exists: false` and does not fail integrity checks

## Edge Cases

- Duplicate output events without stable event ids or tool call ids may not be idempotent and can create multiple rows.
- Observation insertion uses `INSERT OR IGNORE`; callers must treat an existing id or sequence as an already-shadowed observation.
- Large JSON and text payloads are externalized only above the inline threshold; small payloads may remain in row attributes.
- Payload deduplication is byte-based after serialization; semantically equivalent JSON with different serialized form is not guaranteed to dedupe.
- The v2 store can coexist with legacy stores; migration must not delete legacy rows.
- V2-native services must not reinsert runtime output events that are already managed by `ChatDataIngestService`.

## Constraints

- **Compatibility:** Existing legacy stores remain readable during migration and debugging.
- **Security / Privacy:** Payload previews must stay bounded; full payloads are read only by explicit payload-reference lookup.
- **Performance:** Append/list operations must use indexed session, room, topic, and idempotency paths; list limits must be bounded.
- **Durability:** File-backed stores use WAL and payload writes use temp-file then rename semantics.
- **Dependencies:** The implementation relies on Node SQLite APIs and local filesystem payload storage.

## Success Criteria

- [x] SC-001: Opening a v2 store twice leaves schema version and table/index inventory stable, as covered by `test/data-v2-store.test.mjs` and telemetry schema coverage in `test/telemetry-store.test.mjs`.
- [x] SC-002: Retried user-message ingestion with the same client transaction creates one event and one message, as covered by `test/data-v2-ingest-service.test.mjs`.
- [x] SC-003: Retried assistant output ingestion with the same event identity creates one output event, one assistant message, and one observation, as covered by `test/data-v2-ingest-service.test.mjs`.
- [x] SC-004: Large message payloads are externalized and readable from their payload reference, as covered by `test/data-v2-ingest-service.test.mjs`.
- [x] SC-005: V2-native Chat Web service tests cover default rooms, session upsert, idempotent event append, timeline ordering, trace-event ordering, and read-state monotonicity, as covered by `test/chat-v2-native-services.test.mjs`.
- [x] SC-006: Data inventory reports v2 and legacy stores without requiring those files to exist, as covered by `test/data-cli.test.mjs`.
- [x] SC-007: V2-backed Pibo Session Store semantics and session migration are covered by `test/pibo-data-session-store.test.mjs`.

## Verification Coverage

This section maps current tests to this source-backed contract. It avoids creating duplicate data-store specs while making weak traceability explicit.

### Directly Tested

- Store initialization, schema idempotency, payload read/write/deduplication, event-log idempotency, and simple message/observation listing are covered by `test/data-v2-store.test.mjs`; telemetry schema additions are covered by `test/telemetry-store.test.mjs`.
- User-message ingestion idempotency, large-message payload externalization, assistant-output idempotency, progressive tool-call snapshots, and tool-output observation projection are covered by `test/data-v2-ingest-service.test.mjs`.
- V2-native room, session, timeline, command-event, trace-event, and read-state service behavior is covered by `test/chat-v2-native-services.test.mjs`.
- Data inventory and unread-baseline repair behavior are covered by `test/data-cli.test.mjs`.
- V2-backed Pibo Session Store structured-field persistence and legacy session migration idempotency are covered by `test/pibo-data-session-store.test.mjs`.

### Source-Inspected Only

- Exact SQLite index inventory and every migration-table column are source-inspected in `src/data/schema.ts` rather than asserted table-by-table.
- File-backed WAL and busy-timeout PRAGMA behavior are source-inspected in `src/data/pibo-store.ts`.
- Payload temp-file rename behavior is source-inspected in `src/data/payload-store.ts`.
- Chat Web web-route use of the v2-native services is covered by higher-level Chat Web specs and source inspection, not by this data-store test set.

### Test Gaps

- Add focused assertions for WAL mode and foreign-key behavior on file-backed stores if those become release gates.
- Add non-telemetry schema inventory assertions when a future migration increases `PIBO_DATA_SCHEMA_VERSION`.
- Add integration tests that exercise Chat Web HTTP routes through v2-native services without legacy read-model fallback.

## Assumptions and Open Questions

### Assumptions

- The v2 store is the normal default store for routed Pibo Session identity and current Chat Web behavior, but it is not the sole canonical replacement for every legacy or focused store.
- Retention classes are stored as strings so new policy names can be introduced without a schema change.
- The current inline threshold of 16 KiB for message and JSON payloads is an implementation-level policy that consumers should not rely on for UX decisions.

### Open Questions

- Should `pibo.output` events in the v2 data store eventually replace or mirror the reliability store topic of the same name?
- Should observation lifecycle updates become explicit updates instead of append/ignore rows for long-running tools?
- Should payload reference counts be decremented by retention or deletion workflows, and where should that behavior be specified?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 V2 store initializes deterministically | Fresh v2 store | `src/data/schema.ts`, `src/data/pibo-store.ts`, `test/data-v2-store.test.mjs`, `test/telemetry-store.test.mjs` | Covered, with PRAGMA details source-inspected |
| REQ-002 Event log appends are ordered and idempotent | Retried append | `src/data/event-log.ts`, `test/data-v2-store.test.mjs` | Covered |
| REQ-003 Payloads are content-addressed and externalized for large values | Large user message | `src/data/payload-store.ts`, `src/data/ingest-service.ts`, `test/data-v2-store.test.mjs`, `test/data-v2-ingest-service.test.mjs` | Covered |
| REQ-004 User-message ingestion is idempotent per client transaction | Retried accepted input | `src/data/ingest-service.ts`, `test/data-v2-ingest-service.test.mjs` | Covered |
| REQ-005 Runtime output ingestion shadows messages and observations | Assistant output retry | `src/data/ingest-service.ts`, `src/data/message-store.ts`, `src/data/observation-store.ts`, `test/data-v2-ingest-service.test.mjs` | Covered |
| REQ-006 Session and navigation rows track current conversation placement | New room activity | `src/data/session-store.ts`, `src/data/navigation-store.ts`, `src/sessions/pibo-data-store.ts`, `test/data-v2-ingest-service.test.mjs`, `test/pibo-data-session-store.test.mjs` | Covered for ingestion and session-store paths; navigation edge cases source-inspected |
| REQ-007 V2-native Chat Web services read and write through the v2 store | V2-native chat service flow | `src/apps/chat/data/*.ts`, `test/chat-v2-native-services.test.mjs` | Covered |
| REQ-008 Data CLI reports and repair operations are bounded | Inventory for missing root store | `src/data/cli.ts`, `test/data-cli.test.mjs`, `test/pibo-data-session-store.test.mjs` | Covered |

## Verification Basis

This spec is based on the current code in `src/data/schema.ts`, `src/data/pibo-store.ts`, `src/data/event-log.ts`, `src/data/payload-store.ts`, `src/data/ingest-service.ts`, `src/data/message-store.ts`, `src/data/observation-store.ts`, `src/data/navigation-store.ts`, `src/data/session-store.ts`, `src/data/telemetry.ts`, `src/sessions/pibo-data-store.ts`, `src/data/cli.ts`, and `src/apps/chat/data/*.ts`, plus behavior asserted in `test/data-v2-store.test.mjs`, `test/data-v2-ingest-service.test.mjs`, `test/chat-v2-native-services.test.mjs`, `test/data-cli.test.mjs`, `test/pibo-data-session-store.test.mjs`, and `test/telemetry-store.test.mjs`.
