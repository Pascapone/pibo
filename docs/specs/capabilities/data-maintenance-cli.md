# Spec: Data Maintenance CLI

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md), [Local Store Ownership and Canonical Data Boundaries](./local-store-ownership-and-canonical-data-boundaries.md), [Operator CLI Discovery and Dispatch](./operator-cli-discovery-and-dispatch.md), [Project Validation Harness](./project-validation-harness.md)

## Why

Pibo has several local SQLite stores with overlapping historical and current responsibilities. Operators and agents need a bounded maintenance surface to inspect store health, migrate legacy session rows into the current v2 data store, and repair unread baselines after importing historical chat events.

This behavior deserves its own source-backed contract because `pibo data` can read or mutate durable local state. The command must be discoverable, explicit about target paths, safe by default, and machine-readable when used by agents.

## Goal

`pibo data` MUST provide bounded, explicit, and testable maintenance commands for local Pibo data stores without changing runtime routing behavior or silently mutating data during inspection.

## Background / Current State

The current implementation lives in `src/data/cli.ts` and is dispatched from `src/cli.ts` as the `pibo data` command family. It supports:

- `inventory` for read-only store size, WAL, integrity, and table-count reporting.
- `migrate sessions-to-v2` for idempotent import from `pibo-sessions.sqlite` into `pibo.sqlite`.
- `repair unread-baseline` for seeding `principal_session_stats` read cursors for historical events up to a caller-supplied timestamp.

Tests in `test/data-cli.test.mjs` and `test/pibo-data-session-store.test.mjs` cover inventory, unread baseline repair, and idempotent session migration.

## Scope

### In Scope

- `pibo data` help and command dispatch.
- Store inventory for current, shadow, legacy, reliability, and auth stores.
- JSON and tabular command output.
- Session migration from the legacy Pibo Session store into the v2 Pibo data store.
- Unread baseline repair for imported or historical events.
- Explicit path selection through `--root`, `--from`, and `--to`.

### Out of Scope

- General data-store schema ownership — covered by the Pibo Data Store spec.
- Chat Web runtime ingestion behavior — covered by Chat Web and ingestion specs.
- Online gateway lifecycle, locking, or quiescing running sessions before maintenance.
- Destructive database compaction, pruning, or deletion commands.
- Cross-machine backup and restore workflows.

## Requirements

### Requirement: Data CLI discovery is compact and bounded

The CLI MUST show only the supported data maintenance command surface at `pibo data`, `pibo data --help`, and `pibo data -h`.

#### Current

`runDataCli()` prints a custom help page when no data subcommand or help flags are supplied. It lists `inventory`, `migrate sessions-to-v2`, and `repair unread-baseline`, shared options, and next commands.

#### Target

Agents can discover the data maintenance surface without invoking generic Commander help or guessing hidden subcommands.

#### Acceptance

- Running `pibo data` prints the data command list and next commands.
- Running `pibo data --help` or `pibo data -h` prints the same bounded discovery output.
- Unknown data commands fail with a message that points back to `pibo data --help`.

#### Scenario: Agent starts data discovery

- GIVEN an agent needs to inspect Pibo stores
- WHEN it runs `pibo data`
- THEN the output lists only the supported data maintenance commands
- AND it points to `pibo data inventory --json` as the first inspection command.

### Requirement: Inventory is read-only and explicit about store paths

The `inventory` command MUST report local store presence and health without creating, migrating, or mutating any store.

#### Current

`collectInventory()` checks configured store files under `PIBO_HOME` or `--root`. For existing stores, it opens SQLite read-only, runs `PRAGMA integrity_check`, collects page metadata, WAL size, byte size, and expected table counts. Missing stores are reported with `exists: false` and zero byte counts.

#### Target

Operators can audit what store files exist and whether expected tables are present before running any maintenance mutation.

#### Acceptance

- `pibo data inventory --json` returns a `stores` array.
- Missing stores are included with `exists: false` instead of causing failure.
- Existing stores are opened read-only.
- The report includes the resolved path for each store.
- Expected table counts are included only when the table exists.

#### Scenario: Empty Pibo home inventory

- GIVEN a temporary Pibo home contains no SQLite stores
- WHEN `pibo data inventory --root <dir> --json` runs
- THEN the output includes `v2` and `legacy-chat` store entries with `exists: false`
- AND no store files are created by the command.

### Requirement: Session migration is idempotent and preserves product identity

The `migrate sessions-to-v2` command MUST copy legacy Pibo Session rows into the v2 data store without duplicating sessions or replacing newer v2 rows with older legacy data.

#### Current

`migrateSessionsToV2()` reads `pibo_sessions` from a legacy source path, creates/opens the target `PiboDataStore`, inserts missing sessions, updates existing sessions only when the legacy `updated_at` is newer, and skips older or equal rows. It preserves Pibo Session id, Pi Session id, owner scope, channel, kind, profile, parent/origin ids, workspace, title, metadata, active model JSON, and derives `root_session_id` from metadata or parent/session id.

#### Target

Legacy migration can be rerun safely during a local data transition and continues to treat Pibo Session id as the canonical product identity.

#### Acceptance

- A missing source database returns a report with `inputExists: false` and no mutation.
- A source without `pibo_sessions` returns a zero-read report.
- Running the same migration twice does not create duplicate v2 sessions.
- Existing v2 rows are updated only when the legacy row is newer.
- Missing legacy owner scope is normalized to `user:unknown`.

#### Scenario: Rerun migration

- GIVEN a legacy `pibo-sessions.sqlite` contains one session `ps_legacy`
- WHEN `pibo data migrate sessions-to-v2 --root <dir> --json` runs twice
- THEN the v2 store contains one session with id `ps_legacy`
- AND the second report does not insert a duplicate row.

### Requirement: Unread baseline repair requires owner and cutoff

The `repair unread-baseline` command MUST require an explicit owner scope and cutoff timestamp before it changes read cursors.

#### Current

`runDataCli()` rejects `repair unread-baseline` unless `--owner-scope` and `--before` are supplied. The command resolves the target `pibo.sqlite` through `--to`, `--root`, or the default Pibo home path.

#### Target

Agents cannot accidentally mark all historical messages read for all users or all time.

#### Acceptance

- Missing `--owner-scope` fails before opening the target database.
- Missing `--before` fails before opening the target database.
- The report echoes `ownerScope`, `before`, `to`, and `dryRun`.
- A missing target database returns `inputExists: false` instead of creating a new store.

#### Scenario: Missing owner scope

- GIVEN an operator runs the repair command without `--owner-scope`
- WHEN the CLI parses the request
- THEN it fails with a message requiring `--owner-scope <ownerScope>`
- AND it does not write any read-state rows.

### Requirement: Unread baseline repair is monotonic and dry-run capable

The repair command MUST seed or advance per-session read cursors for only the requested owner and MUST support a dry run that reports the same candidates without writing.

#### Current

`repairUnreadBaseline()` selects non-deleted sessions owned by `ownerScope` with events at or before the cutoff, computes each session's maximum matching stream id, compares it to the existing `principal_session_stats.last_read_stream_id`, and uses an upsert with `MAX()` so read cursors do not move backward. `--dry-run` skips the transaction and upsert.

#### Target

Historical imports can be marked read without clearing new unread activity or changing other owners' state.

#### Acceptance

- Only sessions whose `owner_scope` equals the requested owner are candidates.
- Only events with `created_at <= before` contribute to the target stream id.
- Existing read cursors are advanced only when the target stream id is greater than the previous cursor.
- `dryRun: true` reports candidates, insert/update counts, and sessions without modifying `principal_session_stats`.
- Non-dry-run execution uses a transaction and rolls back on failure.

#### Scenario: Seed historical cursors

- GIVEN owner `user:test` has old events in `ps_old` and another owner has old events in `ps_other`
- WHEN repair runs with `--owner-scope user:test --before <cutoff>`
- THEN `ps_old` receives a read cursor at the latest matching stream id
- AND `ps_other` is not modified.

### Requirement: Reports support human and machine consumers

Each data command MUST provide JSON output for agents and compact tabular output for humans.

#### Current

Each supported command checks `--json`. JSON output serializes the report object; text output prints line-oriented tabular fields for inventory, migration, and unread repair reports.

#### Target

Automation can parse stable report fields while operators can still inspect results from a terminal.

#### Acceptance

- `inventory --json` emits `{ stores: [...] }`.
- `migrate sessions-to-v2 --json` emits source/target paths plus read/insert/update/skip counts.
- `repair unread-baseline --json` emits candidate/change counts plus per-session previous and target read stream ids.
- Text output remains bounded and line-oriented.

#### Scenario: Agent parses migration report

- GIVEN a migration command runs with `--json`
- WHEN an agent parses stdout as JSON
- THEN it can read `inputExists`, `read`, `inserted`, `updated`, and `skipped` without parsing table text.

## Edge Cases

- A listed inventory store may exist but lack expected tables; the command reports available counts without treating absence as fatal.
- Malformed legacy session metadata or active-model JSON is copied as stored JSON text where applicable, while metadata parsing falls back to `{}` for derived v2 fields.
- Lexicographic timestamp comparison assumes ISO timestamp strings; callers must supply ISO-like `--before` values for repair.
- Repair uses `owner_scope` as both owner and principal id in `principal_session_stats`, matching current single-owner Chat Web semantics.
- The data CLI does not verify that a gateway is stopped; callers remain responsible for avoiding concurrent operational maintenance risks.

## Constraints

- **Safety:** `inventory` MUST remain read-only. Mutating commands require explicit subcommands and target inputs.
- **Compatibility:** Default paths MUST follow `PIBO_HOME` or Pibo home path resolution used by the rest of the product.
- **Security / Privacy:** Reports include local filesystem paths and owner scopes; they are operator-facing CLI output, not browser APIs.
- **Performance:** Inventory and repairs should stay bounded to expected store lists and target owner/cutoff filters.
- **Dependencies:** Commands depend on Node SQLite support and the current v2 schema names.

## Success Criteria

- [ ] SC-001: `pibo data` help remains compact and points to the next inspection command.
- [ ] SC-002: Inventory reports missing stores without creating files and opens existing SQLite stores read-only.
- [ ] SC-003: Session migration can be rerun without duplicate sessions and updates only newer legacy rows.
- [ ] SC-004: Unread baseline repair rejects missing owner/cutoff, supports dry-run, and advances only matching owner cursors.
- [ ] SC-005: All data commands provide parseable JSON reports and compact text reports.

## Assumptions and Open Questions

### Assumptions

- `ownerScope` is the correct principal id for current Chat Web read-state repair.
- Legacy session timestamps are ISO-formatted strings that can be compared lexicographically.
- The data CLI is an operator/agent tool and can expose local paths in reports.

### Open Questions

- Should future mutating data commands require an explicit gateway-stopped or backup confirmation?
- Should `repair unread-baseline` validate `--before` as an ISO timestamp instead of relying on SQLite string comparison?
- Should inventory include additional store families as Pibo adds durable features?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Data CLI discovery is compact and bounded | Agent starts data discovery | `src/data/cli.ts`, `src/cli.ts` | Implemented |
| REQ-002 Inventory is read-only and explicit about store paths | Empty Pibo home inventory | `src/data/cli.ts`, `test/data-cli.test.mjs` | Covered |
| REQ-003 Session migration is idempotent and preserves product identity | Rerun migration | `src/data/cli.ts`, `test/pibo-data-session-store.test.mjs` | Covered |
| REQ-004 Unread baseline repair requires owner and cutoff | Missing owner scope | `src/data/cli.ts` | Implemented |
| REQ-005 Unread baseline repair is monotonic and dry-run capable | Seed historical cursors | `src/data/cli.ts`, `test/data-cli.test.mjs` | Covered |
| REQ-006 Reports support human and machine consumers | Agent parses migration report | `src/data/cli.ts` | Implemented |

## Verification Basis

This spec is based on the current workspace code in `src/data/cli.ts`, `src/cli.ts`, `src/data/pibo-store.ts`, `src/sessions/pibo-data-store.ts`, and tests in `test/data-cli.test.mjs` and `test/pibo-data-session-store.test.mjs`. Existing specs under `docs/specs/` were inspected to avoid duplicating the broader v2 data-store, Chat Web ingestion, and CLI dispatch contracts.
