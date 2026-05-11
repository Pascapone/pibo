# Spec: Live-Only Event Delta Maintenance

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** [Debug CLI](./debug-cli.md), [Chat Web Output Compaction and Stream Projection](./chat-web-output-compaction-and-stream-projection.md), [Reliable Event Core](./reliable-event-core.md), [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md)

## Why

Pibo treats assistant deltas, thinking deltas, and tool-progress updates as live-only stream events. They are useful while a session is running, but they should not accumulate as durable replay rows when final compacted events already represent the long-term conversation state.

The current code includes a focused debug maintenance command for finding and optionally deleting historical live-only delta rows from the unified data store and reliability event stream. This capability needs its own behavior contract because it is intentionally destructive only when explicitly applied, spans two store schemas, and protects operators from confusing normal output compaction with manual maintenance.

## Goal

Pibo MUST provide a bounded debug maintenance operation that reports live-only delta rows by store and event type, defaults to dry-run behavior, and deletes only the live-only event classes selected by the operator.

## Background / Current State

`src/debug/delta-compaction.ts` implements `runDeltaCompaction()` and `formatDeltaCompaction()`. `src/debug/index.ts` wires them to `pibo debug events compact-deltas [--dry-run|--apply] [--store pibo-data|chat|reliability] [--session ps_...] [--json]`.

The command inspects the current Pibo home debug stores through `resolveDebugStore()`. Without `--store`, it checks `pibo-data` and `reliability`. For the unified Chat/Pibo data store, it counts and optionally deletes matching rows from `event_log` by `type` and optional `session_id`. For the reliability store, it counts and optionally deletes rows from `pibo_event_stream` where `topic = 'pibo.output'`, `payload_json.type` is live-only, and optional `key` matches the requested session. Missing stores and missing tables produce bounded zero-count results instead of unhandled failures.

## Scope

### In Scope

- `pibo debug events compact-deltas` behavior.
- Dry-run, apply, store selection, session filtering, and JSON/text output.
- Live-only event type classification for this maintenance operation.
- Safe handling of missing stores and missing expected tables.
- Separate behavior for unified Chat/Pibo data and reliability event stream schemas.

### Out of Scope

- Normal live stream classification and runtime output compaction — covered by Chat Web Output Compaction and Stream Projection.
- General reliability pruning by topic, retention class, and consumer state — covered by Reliable Event Core.
- Trace rendering behavior after deltas have been removed — covered by Chat Web Trace and Terminal View.
- Automatic scheduled deletion of live-only rows — the current code exposes an explicit debug command only.

## Requirements

### Requirement: Live-only maintenance uses a bounded event vocabulary

The maintenance operation MUST target only event types that the current code classifies as live-only deltas.

#### Current

`LIVE_ONLY_TYPES` is `assistant_delta`, `thinking_delta`, and `tool_execution_updated`.

#### Target

Operators can run delta maintenance without deleting final assistant messages, final thinking messages, user messages, session lifecycle events, tool terminal results, or unrelated reliability events.

#### Acceptance

- Rows with type `assistant_delta` are counted as live-only.
- Rows with type `thinking_delta` are counted as live-only.
- Rows with type `tool_execution_updated` are counted as live-only.
- Rows with any other type are not counted and are not deleted by this command.

#### Scenario: Final message is preserved

- GIVEN a store contains one `assistant_delta` row and one `assistant_message` row
- WHEN `compact-deltas --apply` runs for that store
- THEN the `assistant_delta` row is deleted
- AND the `assistant_message` row remains.

### Requirement: Dry-run is the default behavior

The command MUST report planned live-only deletions without mutating stores unless `--apply` is present.

#### Current

`runDeltaCompaction()` receives `apply` from parsed CLI options. When `apply` is absent, the result status is `dry-run`, `plannedDeletes` equals the current live-only row count, and `deleted` is zero.

#### Target

A normal operator inspection cannot accidentally remove event rows.

#### Acceptance

- Running without `--apply` reports `status: "dry-run"` for existing stores.
- Dry-run output includes per-type counts and planned delete counts.
- Dry-run output leaves matching rows in place.
- `--dry-run` is accepted as a user-facing option but does not need to change behavior beyond the default.

#### Scenario: Inspect before deleting

- GIVEN the reliability store has three live-only rows
- WHEN the operator runs `pibo debug events compact-deltas --store reliability`
- THEN the output reports `plannedDeletes` as `3`
- AND `deleted` as `0`
- AND the three rows remain queryable.

### Requirement: Apply deletes matching rows only from selected stores

The command MUST delete matching live-only rows only when `--apply` is supplied and only for the selected store set.

#### Current

Without `--store`, the command inspects `pibo-data` and `reliability`. With `--store`, it inspects only that named store. The `chat` store name resolves through the same unified database path as `pibo-data` but is treated as a chat-schema inspection by `delta-compaction.ts`.

#### Target

Operators can clean one store at a time or use the default two-store sweep while preserving unrelated configured stores.

#### Acceptance

- `--store reliability --apply` deletes matching rows only from `pibo_event_stream`.
- `--store pibo-data --apply` deletes matching rows only from the unified store `event_log` table.
- Running with no `--store --apply` returns one result for `pibo-data` and one for `reliability`.
- Store names unsupported by `resolveDebugStore()` fail with the shared unknown-store error before mutation.

#### Scenario: Apply to reliability only

- GIVEN both `pibo-data` and `reliability` contain live-only rows
- WHEN the operator runs `compact-deltas --store reliability --apply`
- THEN only reliability matching rows are deleted
- AND the pibo-data matching rows remain.

### Requirement: Session filtering narrows deletion by session identity

The command MUST support a session filter that narrows counts and deletes to one Pibo Session identity.

#### Current

CLI parsing passes `--session` through `options.key`. Chat store inspection filters `event_log.session_id = ?`. Reliability inspection filters `pibo_event_stream.key = ?` while retaining `topic = 'pibo.output'`.

#### Target

Operators can clean live-only residue for a single problematic Pibo Session without affecting other sessions.

#### Acceptance

- In the unified store, `--session ps_1` counts only live-only rows whose `session_id` is `ps_1`.
- In the reliability store, `--session ps_1` counts only live-only `pibo.output` rows whose stream key is `ps_1`.
- `--session` never broadens deletion beyond live-only types.

#### Scenario: Clean one session

- GIVEN `ps_1` and `ps_2` each have `assistant_delta` rows
- WHEN the operator runs `compact-deltas --session ps_1 --apply`
- THEN only rows for `ps_1` are deleted
- AND rows for `ps_2` remain.

### Requirement: Missing stores and tables produce bounded results

The maintenance operation MUST return a structured zero-count result for missing stores or missing expected tables instead of crashing.

#### Current

`inspectStore()` returns status `missing` when the resolved path does not exist. Chat inspection returns zero counts when `event_log` is absent. Reliability inspection returns zero counts when `pibo_event_stream` is absent.

#### Target

The command is safe to run in fresh Pibo homes, partial migrations, and test fixtures that do not include all stores.

#### Acceptance

- A missing store path returns `exists: false`, `status: "missing"`, and zero counts.
- An existing chat store without `event_log` returns zero counts and dry-run or applied status according to `--apply`.
- An existing reliability store without `pibo_event_stream` returns zero counts and dry-run or applied status according to `--apply`.

#### Scenario: Fresh home has no reliability DB

- GIVEN the reliability database file does not exist
- WHEN the operator runs `compact-deltas --store reliability`
- THEN the command reports the resolved path with `status: "missing"`
- AND exits without opening a database.

### Requirement: Output supports human and machine consumers

The command MUST produce compact tabular text by default and structured JSON when requested.

#### Current

`formatDeltaCompaction()` prints columns `store`, `path`, `status`, `liveOnlyRows`, `plannedDeletes`, `deleted`, and `byType`. With `--json`, the debug CLI prints the raw result through the shared JSON formatter.

#### Target

Humans can inspect counts in a terminal, while agents and scripts can parse exact store results.

#### Acceptance

- Text output includes one header row and one row per inspected store.
- The `byType` text field uses comma-separated `type:count` entries.
- JSON output has a top-level `results` array.
- Each result includes store name, resolved path, existence, live-only row count, per-type counts, planned delete count, deleted count, and status.

#### Scenario: Agent parses dry-run JSON

- GIVEN a store has one `thinking_delta` row
- WHEN the operator runs `compact-deltas --store pibo-data --json`
- THEN JSON output includes `results[0].byType` with `{ "type": "thinking_delta", "count": 1 }`
- AND `results[0].deleted` is `0`.

## Edge Cases

- `--apply` on a missing store must not create that store.
- `--apply` on an existing store without the expected table must not create the missing table.
- A reliability row with a live-only payload type under a topic other than `pibo.output` must remain untouched.
- A malformed or missing `payload_json.type` in reliability should not match the live-only predicate.
- The `read-model` internal alias in `delta-compaction.ts` resolves to the chat store shape if called directly, but the public debug store list does not expose `read-model` as a supported store name.

## Constraints

- **Compatibility:** The public command remains under `pibo debug events compact-deltas` and follows Debug CLI discovery conventions.
- **Safety:** Mutation requires the explicit `--apply` flag. The operation deletes only rows matching the live-only predicate and optional session filter.
- **Performance:** Counts and deletes are SQL-bounded by simple predicates and optional session key; large-store cleanup may still be operator-driven and should not run automatically.
- **Dependencies:** The operation depends on local SQLite store paths resolved from Pibo home through the debug store registry.

## Success Criteria

- [ ] SC-001: Dry-run reports live-only row counts and deletes nothing.
- [ ] SC-002: Apply deletes only `assistant_delta`, `thinking_delta`, and `tool_execution_updated` rows.
- [ ] SC-003: Store selection limits both counts and deletion to the requested store.
- [ ] SC-004: Session filtering limits both counts and deletion to the requested Pibo Session identity.
- [ ] SC-005: Missing stores and missing tables return bounded zero-count results.
- [ ] SC-006: JSON and text formats expose the same per-store result fields.

## Assumptions and Open Questions

### Assumptions

- Live-only delta rows are safe to remove only because final compacted or terminal events represent durable user-facing state.
- Operators run this command manually as part of debugging or data maintenance, not as a scheduled background cleanup.

### Open Questions

- Should future versions require an additional destructive flag, similar to reliability pruning, before `--apply` deletes rows?
- Should the command verify that compacted final events exist before deleting live-only rows for a session?
- Should `chat` be documented as a public alias for `pibo-data` in this command, or should help text restrict the command to one unified-store name?

## Traceability

| Requirement | Scenario / Story | Source Basis | Status |
|---|---|---|---|
| REQ-001 Live-only maintenance uses a bounded event vocabulary | Final message is preserved | `src/debug/delta-compaction.ts` | Draft |
| REQ-002 Dry-run is the default behavior | Inspect before deleting | `src/debug/delta-compaction.ts`, `src/debug/index.ts` | Draft |
| REQ-003 Apply deletes matching rows only from selected stores | Apply to reliability only | `src/debug/delta-compaction.ts`, `src/debug/stores.ts` | Draft |
| REQ-004 Session filtering narrows deletion by session identity | Clean one session | `src/debug/delta-compaction.ts`, `src/debug/index.ts` | Draft |
| REQ-005 Missing stores and tables produce bounded results | Fresh home has no reliability DB | `src/debug/delta-compaction.ts`, `src/debug/stores.ts` | Draft |
| REQ-006 Output supports human and machine consumers | Agent parses dry-run JSON | `src/debug/delta-compaction.ts`, `src/debug/index.ts` | Draft |

## Verification Basis

This spec was derived from the current workspace code in `src/debug/delta-compaction.ts`, `src/debug/index.ts`, and `src/debug/stores.ts`, with related behavior checked against existing specs for Debug CLI, Chat Web output compaction, Reliable Event Core, and Pibo Data Store ingestion. No source code was changed.
