# Spec: Optimize unread message counts

**Status:** Done
**Created:** 2026-08-07
**Requester / Source:** Pibo2 authenticated bootstrap performance investigation

## Why

Chat bootstrap and navigation compute unread counts across every visible session. On Pibo2 this covers 2,585 active sessions and 632,640 event rows. The unread query examines only 10,329 message/error rows but currently uses the general `(session_id, stream_id)` event index. Seven 400-session query batches account for roughly 500–650 ms of authenticated bootstrap/navigation latency.

## Goal

Unread counts retain identical results while SQLite can restrict scans to event types that contribute to unread state.

## Scope

### In Scope

- Add an additive partial index for unread user messages, assistant messages, and session errors.
- Verify new and existing databases create the index.
- Validate unchanged unread-count semantics and measure the real authenticated Pibo2 path.

### Out of Scope

- Changing read-cursor semantics or stored unread counters.
- Changing Chat bootstrap payloads, room/session visibility, or UI rendering.
- Optimizing trace projection or other bootstrap work.

## Requirements

### Requirement: Indexed unread counting

The data schema MUST provide an index on `(session_id, stream_id)` limited to the event types used by `ChatReadStateService.countUnreadMessagesBySession`.

#### Scenario: Existing database starts on the new build

- GIVEN an existing `event_log` without the unread-specific index
- WHEN Pibo initializes the data schema
- THEN the index is created without changing event or read-state rows.

#### Scenario: Unread counts are queried

- GIVEN accepted user messages, assistant messages, session errors, unrelated events, and a read cursor
- WHEN unread counts are requested
- THEN the result remains identical to the current behavior and SQLite can use the unread-specific index.

## Acceptance Criteria

- The schema test confirms the index exists and is partial.
- Existing unread-count behavior tests pass unchanged.
- Pibo2 bootstrap and navigation return the same unread counts and materially reduce their previous roughly 600 ms server wait.
- Full typecheck, build, focused tests, and `git diff --check` pass.

## Assumptions / Open Questions

- SQLite matches the existing unread predicate to the equivalent partial-index predicate.
- No open question blocks the additive index; broader bootstrap/render work remains separate.
