# Spec: Pibo Session Store

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** [Pibo Session Routing](./pibo-session-routing.md), [Pibo Home and Workspace State Layout](./pibo-home-and-workspace-state.md), [Model Provider Auth and Session Model Selection](./model-provider-auth-and-session-selection.md)

## Why

Pibo needs a durable product-level session record that remains stable while runtimes, browser views, subagents, and Pi session files change around it. The store is the boundary that preserves Pibo Session IDs, Pi Session bindings, owner scope, hierarchy, workspace, metadata, and active model selection.

Without an explicit store contract, session routing could accidentally reuse a Pi session from another Pibo Session, lose parent or origin relationships, or make session lists slow and inconsistent as the database grows.

## Goal

Define the behavior of the in-memory, legacy SQLite, and v2 data-backed Pibo Session Stores as the source of truth for product session identity, persistence, updates, filtering, and compatibility migrations.

## Background / Current State

`src/sessions/store.ts` defines the shared `PiboSessionStore` interface and the in-memory implementation. `src/sessions/sqlite-store.ts` implements the legacy durable store at `piboHomePath("pibo-sessions.sqlite")`. `src/sessions/pibo-data-store.ts` implements the v2 data-backed store on the shared `PiboDataStore` `sessions` table. All stores create opaque `ps_` Pibo Session IDs when no id is supplied and create UUID Pi Session IDs when no Pi session id is supplied.

The legacy SQLite store creates the `pibo_sessions` table, enables a busy timeout, uses WAL mode for file-backed databases, creates indexes for common filters, and adds `active_model_json` when opening an older schema. The v2 data-backed store stores Pibo Session identity in `pibo.sqlite`, fills room/root/navigation-adjacent columns from session metadata, and supports migration from legacy `pibo-sessions.sqlite`. Query filtering first applies store-specific SQL predicates where possible, then reuses the shared semantic matcher where needed so JSON metadata and active-model equality stay aligned.

## Scope

### In Scope

- Pibo Session record shape and generated identities.
- One-to-one Pibo Session to Pi Session binding.
- In-memory, legacy SQLite, and v2 data-backed create, read, update, delete, list, and find behavior.
- Legacy SQLite persistence, schema initialization, index-backed filtering, and active-model compatibility migration.
- V2 data-backed session persistence and legacy session migration into `pibo.sqlite`.
- Metadata and active-model JSON parsing tolerance.

### Out of Scope

- Runtime queueing and event routing — covered by Pibo Session Routing.
- Chat room, project, and navigation projections — covered by Chat Web Rooms and Event Streams and Chat Web Projects Area.
- Active model selection policy before persistence — covered by Model Provider Auth and Session Model Selection.
- Pi Coding Agent transcript file format — owned by Pi Coding Agent, not the Pibo Session Store.

## Requirements

### Requirement: Session creation produces stable product and Pi identities

The store MUST create a complete Pibo Session record with a Pibo Session ID, Pi Session ID, routing fields, timestamps, metadata, and optional active model.

#### Current

`createPiboSession` creates `ps_<uuid>` ids and UUID Pi session ids when the caller does not supply explicit values.

#### Target

Every created session can be routed by Pibo identity and attached to exactly one Pi session identity.

#### Acceptance

- A generated Pibo Session ID starts with `ps_` and contains an opaque UUID suffix.
- A generated Pi Session ID is a UUID string.
- `createdAt` and `updatedAt` are set to the same ISO timestamp on creation.
- Missing metadata is stored as an empty JSON object.
- Supplied `activeModel` is copied as `{ provider, id }` rather than shared by reference.

#### Scenario: Default identities are generated

- GIVEN a caller creates a session with channel, kind, and profile only
- WHEN the store persists the session
- THEN the returned record has generated Pibo and Pi identities
- AND the record can be read back by Pibo Session ID.

### Requirement: Pi session ownership is unique

The store MUST prevent two Pibo Sessions from owning the same Pi Session ID.

#### Current

The in-memory store checks its Pi-session index before create and before Pi-session update. The legacy SQLite store relies on a unique database constraint for `pi_session_id`. The v2 data-backed store checks for another non-deleted row before Pi-session update and relies on the v2 schema for insert uniqueness.

#### Target

A Pi Session file or runtime state cannot be ambiguously attached to multiple product sessions.

#### Acceptance

- Creating a second session with an existing Pi Session ID fails.
- Updating a session to another session's Pi Session ID fails.
- Updating a session without changing its Pi Session ID succeeds.

#### Scenario: Duplicate Pi ownership is rejected

- GIVEN session `ps_a` owns Pi Session ID `pi_1`
- WHEN a caller creates or updates `ps_b` to use `pi_1`
- THEN the operation fails
- AND `ps_a` remains attached to `pi_1`.

### Requirement: Updates preserve omitted fields and clear nullable fields explicitly

The store MUST distinguish omitted update fields from explicit field removal.

#### Current

`update` keeps existing values for omitted fields. `null` clears parent, origin, workspace, title, and active model. Metadata replacement is explicit and complete.

#### Target

Callers can safely patch one field without losing unrelated session state, and can intentionally clear optional relationships or selections.

#### Acceptance

- Omitting `profile`, `ownerScope`, `workspace`, `title`, `metadata`, or `activeModel` preserves the existing value.
- Setting `parentId`, `originId`, `workspace`, `title`, or `activeModel` to `null` removes that value.
- Setting `metadata` replaces the metadata object.
- `updatedAt` changes after a successful update.
- Updating an unknown session returns `undefined`.

#### Scenario: Active model is cleared

- GIVEN a session has `activeModel: { provider: "openai", id: "gpt" }`
- WHEN the session is updated with `activeModel: null`
- THEN the stored session no longer has an active model
- AND other fields remain unchanged unless specified.

### Requirement: Find behavior is shared and semantically stable

The store MUST return sessions that match the requested filters using the same semantics in memory, legacy SQLite, and v2 data-backed storage.

#### Current

All stores use `matchesFindInput` directly or after SQL filtering; durable stores apply SQL predicates first, then run the shared matcher over deserialized rows when needed.

#### Target

Callers can switch between test and durable stores without changing query results.

#### Acceptance

- `ids` filters return only requested existing ids and return an empty list for an empty id array.
- `channel`, `kind`, `ownerScope`, `originId`, and `profile` use exact string matching.
- `parentId: null` matches only root sessions with no parent.
- `parentId: <id>` matches only direct children of that parent.
- `activeModel: null` matches sessions with no active model.
- `activeModel: { provider, id }` matches only sessions with the same provider and id.
- Metadata filters match when every requested metadata key is JSON-equal to the stored value.
- Results are ordered by descending `updatedAt`.

#### Scenario: Metadata and indexed filters compose

- GIVEN sessions in different rooms and owned by different users
- WHEN a caller finds sessions with `ownerScope: "user:a"` and `metadata: { room: "room-1" }`
- THEN only sessions matching both filters are returned
- AND SQLite may use the owner index before metadata comparison.

### Requirement: SQLite store initializes and migrates safely

The SQLite store MUST create its parent directory, initialize the required schema, and migrate older databases that lack `active_model_json`.

#### Current

The constructor resolves the path, creates parent directories for file-backed databases, creates the table and indexes, and checks `PRAGMA table_info` before adding `active_model_json`.

#### Target

Opening the default store is idempotent and compatible with older Pibo Session databases.

#### Acceptance

- `:memory:` opens without creating filesystem directories.
- File-backed stores create the parent directory when needed.
- Opening a new store creates `pibo_sessions` and indexes for owner, parent, origin, and channel/kind filters.
- Opening an older table without `active_model_json` adds the column without dropping data.
- Reopening a database returns previously persisted sessions.

#### Scenario: Older database opens after active-model migration

- GIVEN an existing `pibo_sessions` table without `active_model_json`
- WHEN `SqlitePiboSessionStore` opens it
- THEN the column is added
- AND existing sessions remain readable.

### Requirement: V2 data-backed store preserves session-store semantics

The v2 data-backed store MUST implement the shared `PiboSessionStore` contract while storing session identity in the v2 `sessions` table used by Chat Web projections.

#### Current

`PiboDataSessionStore` accepts either an existing `PiboDataStore` or a path to `pibo.sqlite`. It creates, reads, updates, deletes, lists, and finds sessions in the v2 `sessions` table. `pibo data migrate sessions-to-v2` copies legacy `pibo_sessions` rows into the v2 store idempotently.

#### Target

Callers can move from legacy `pibo-sessions.sqlite` to the v2 data store without changing Pibo Session identity or routing fields.

#### Acceptance

- Creating a v2-backed session persists Pibo Session ID, Pi Session ID, owner scope, channel, kind, profile, title, metadata, workspace, and active model.
- Reopening the same v2 store returns the persisted session fields.
- Updating a v2-backed session preserves omitted fields, clears nullable fields such as `activeModel` when explicitly set to `null`, and refreshes `updatedAt`.
- The v2 store rejects attaching a Pi Session ID already used by another non-deleted session.
- Deleting a v2-backed session makes it unavailable through `get`, `list`, and `find`.
- Migrating legacy sessions into v2 is idempotent and does not duplicate rows on repeated runs.

#### Scenario: Legacy session migrates to v2 once

- GIVEN `pibo-sessions.sqlite` contains legacy session `ps_legacy`
- WHEN `pibo data migrate sessions-to-v2` runs twice for the same root
- THEN `pibo.sqlite` contains one session with id `ps_legacy`
- AND the migrated Pi Session ID, room metadata, workspace, title, and active model remain readable through `PiboDataSessionStore`.

### Requirement: Malformed JSON fields degrade to empty or absent values

The legacy SQLite store MUST tolerate malformed stored JSON for optional structured fields.

#### Current

`parseMetadata` returns `{}` for missing, invalid, non-object, or array JSON. `parseModelProfile` returns `undefined` unless JSON is an object with string `provider` and `id`.

#### Target

A corrupted metadata or active-model field does not prevent session listing, routing diagnostics, or manual repair.

#### Acceptance

- Missing metadata reads as `{}`.
- Invalid metadata JSON reads as `{}`.
- Metadata arrays or primitives read as `{}`.
- Invalid active-model JSON reads as no active model.
- Active-model JSON without string `provider` and `id` reads as no active model.

#### Scenario: Corrupt metadata does not crash list

- GIVEN a SQLite row has invalid `metadata_json`
- WHEN callers list or get sessions
- THEN the session is returned with empty metadata
- AND the store does not throw because of the malformed field.

## Edge Cases

- A SQLite uniqueness violation may surface as a database error rather than the in-memory store's custom duplicate message.
- Foreign keys describe parent and origin relationships, but the current code does not explicitly enable SQLite foreign-key enforcement.
- JSON metadata matching uses `JSON.stringify` equality, so object key order can affect object-valued metadata comparisons.
- The store exposes optional `delete`; consumers must not assume every implementation supports deletion unless the method exists.
- The v2 data-backed store currently deletes session rows directly, while some Chat Web service projections use soft-delete columns. Callers must use the store that owns their projection semantics.

## Constraints

- **Compatibility:** Store implementations must preserve the `PiboSessionStore` interface and keep in-memory, legacy SQLite, and v2 data-backed find semantics aligned.
- **Security / Privacy:** Owner Scope is stored as data and used by callers for access control; the store itself does not authenticate callers.
- **Performance:** SQLite queries must apply simple indexed filters before semantic JSON matching to avoid full scans when common filters are present.
- **Dependencies:** The durable implementation depends on Node's `node:sqlite` `DatabaseSync` API and Pibo home path resolution.

## Success Criteria

- [ ] SC-001: In-memory and SQLite tests cover create, get, list, update, delete, and find behavior with the same expected records.
- [ ] SC-002: Duplicate Pi Session ID tests cover create and update paths.
- [ ] SC-003: SQLite persistence tests verify default store placement under Pibo home and reopening an existing database.
- [ ] SC-004: SQLite migration tests verify `active_model_json` is added to older databases without data loss.
- [ ] SC-005: Query performance tests verify SQLite applies indexed filters before semantic metadata and active-model matching.
- [ ] SC-006: Malformed JSON tests verify metadata and active-model parsing degrade safely.
- [x] SC-007: V2 data-backed session-store tests verify persistence, update clearing, delete behavior, find behavior, and idempotent legacy migration.

## Assumptions and Open Questions

### Assumptions

- The Pibo Session Store is a persistence boundary, not an authorization boundary.
- Pibo Session IDs remain opaque; consumers should not parse any meaning beyond the `ps_` prefix convention.
- Session metadata is intentionally schemaless at the store layer because room, project, cron, and subagent systems own their own metadata keys.

### Open Questions

- Should SQLite enable `PRAGMA foreign_keys = ON` and reject dangling parent or origin ids at the database layer?
- Should metadata filtering use canonical JSON comparison to avoid object key-order differences?
- Should duplicate Pi Session errors be normalized between in-memory and SQLite implementations?

## Requirement Verification Matrix

This matrix records current protection separately from the behavior contract. `Source-inspected only` means the behavior exists in the current code but this pass did not find a direct test that proves the full acceptance check.

| Requirement | Current direct tests | Verification kind | Remaining gap |
|---|---|---|---|
| REQ-001 Session creation produces stable product and Pi identities | `test/session-store.test.mjs` (`pibo session builder creates opaque product and Pi identities`) | Direct unit test | Add a copy-by-value assertion for supplied `activeModel` if that behavior becomes risky. |
| REQ-002 Pi session ownership is unique | `test/session-store.test.mjs` (`in-memory pibo session store rejects duplicate Pi session ownership`) | Partial direct unit test | Add SQLite duplicate-create coverage and update-path duplicate coverage for both stores. |
| REQ-003 Updates preserve omitted fields and clear nullable fields explicitly | `test/session-store.test.mjs` (`in-memory pibo session store creates, updates, and finds sessions`) | Partial direct unit test | Add explicit null-clearing tests for parent, origin, workspace, title, and `activeModel`; add unknown-session update coverage. |
| REQ-004 Find behavior is shared and semantically stable | `test/session-store.test.mjs` (`in-memory pibo session store creates, updates, and finds sessions`, `sqlite pibo session store persists structured session fields`); `test/performance-optimizations.test.mjs` (`sqlite session find applies indexed filters before semantic matching`) | Direct and partial performance regression tests | Add side-by-side memory/SQLite tests for empty `ids`, `activeModel: null`, and ordered results. |
| REQ-005 SQLite store initializes and migrates safely | `test/session-store.test.mjs` (`default sqlite pibo session store uses PIBO_HOME, not cwd`, `sqlite pibo session store persists structured session fields`) | Partial direct integration test | Add an older-schema migration fixture without `active_model_json`. |
| REQ-006 V2 data-backed store preserves session-store semantics | `test/pibo-data-session-store.test.mjs` (`pibo data session store persists structured session fields`, `pibo data migrate sessions-to-v2 is idempotent`) | Direct integration test | Add duplicate Pi Session ID coverage for the v2 data-backed update path if v2 becomes the default router store. |
| REQ-007 Malformed JSON fields degrade to empty or absent values | Source-inspected only: `parseMetadata` and `parseModelProfile` in `src/sessions/sqlite-store.ts` | Source inspection | Add malformed `metadata_json` and `active_model_json` row tests. |

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Session creation produces stable product and Pi identities | Default identities are generated | `test/session-store.test.mjs` | Covered |
| REQ-002 Pi session ownership is unique | Duplicate Pi ownership is rejected | `test/session-store.test.mjs`; add SQLite/update coverage | Partial |
| REQ-003 Updates preserve omitted fields and clear nullable fields explicitly | Active model is cleared | Add update-null behavior tests | Pending |
| REQ-004 Find behavior is shared and semantically stable | Metadata and indexed filters compose | `test/session-store.test.mjs`; `test/performance-optimizations.test.mjs` | Partial |
| REQ-005 SQLite store initializes and migrates safely | Older database opens after active-model migration | `test/session-store.test.mjs`; add migration compatibility test | Partial |
| REQ-006 V2 data-backed store preserves session-store semantics | Legacy session migrates to v2 once | `test/pibo-data-session-store.test.mjs` | Covered |
| REQ-007 Malformed JSON fields degrade to empty or absent values | Corrupt metadata does not crash list | Add malformed row test | Pending |

## Verification Basis

This spec is based on the current code in:

- `src/sessions/store.ts`
- `src/sessions/sqlite-store.ts`
- `src/sessions/pibo-data-store.ts`
- `src/data/pibo-store.ts`
- `src/data/cli.ts`
- `src/core/pibo-home.ts`
- `test/session-store.test.mjs`
- `test/pibo-data-session-store.test.mjs`
- `test/session-router-store.test.mjs`
- `test/performance-optimizations.test.mjs`
