# Spec: Data Maintenance CLI

**Status:** Current  
**Created:** 2026-05-11  
**Updated:** 2026-06-01  
**Related docs:** [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md), [Operator CLI Discovery and Dispatch](./operator-cli-discovery-and-dispatch.md), [Pibo Session Store](./pibo-session-store.md)

## Purpose

`pibo data` is the bounded operator surface for local Pibo store inspection and final app-space cutover preparation. It must be discoverable, explicit about target paths, safe by default, and machine-readable for agents.

## Current model

Pibo has one product app space after login. Data maintenance commands must not create product partitions from auth identity. Historical account-partitioned SQLite layouts are handled only by the explicit final cutover command and only against a caller-selected root.

## Supported command families

- `pibo data inventory` reports local store presence, size, WAL metadata, integrity status, and table counts without mutating stores.
- `pibo data migrate sessions-to-v2` imports legacy Pibo Session rows into the v2 data store by Pibo Session ID and is idempotent.
- `pibo data final-cutover inspect` reads a selected root and reports historical schema artifacts, row counts, redacted value summaries, and conflict groups.
- `pibo data final-cutover dry-run` reports planned rebuild/drop/merge/rename actions without writes.
- `pibo data final-cutover apply` requires an explicit root plus verified backup path, runs transactional per-database rebuilds, performs post-checks, and writes a migration report.

## Safety requirements

- Discovery output must stay compact and point to the next useful command.
- Read-only commands must open existing SQLite files without creating missing stores.
- Mutating commands require explicit subcommands and target paths.
- Final cutover commands require `--root` or `PIBO_MIGRATION_SANDBOX_HOME`; the autonomous Ralph loop must use Docker fixture or sandbox roots only.
- The final apply path must refuse unsafe host roots in autonomous validation, require backups outside the target root, verify backup copies with SQLite quick checks, and record rollback instructions.
- Reports may include local filesystem paths but must not dump prompts, tokens, provider secrets, or unredacted user-derived values.

## Acceptance criteria

- `pibo data` and `pibo data --help` show only the bounded data command surface.
- `inventory --json` returns a parseable `{ stores: [...] }` report and does not create missing stores.
- `migrate sessions-to-v2 --json` can be rerun without duplicate sessions and preserves Pibo Session IDs.
- Final cutover inspect/dry-run/apply JSON outputs include target root, affected databases, planned/applied actions, conflict summaries, post-checks, and report paths where applicable.
- Apply is idempotent on already-cutover schemas and transactional per database file.
- All final cutover fixture validation runs against temporary roots or Docker sandbox homes, not live host data.

## Traceability

| Requirement | Validation basis |
|---|---|
| Compact discovery and JSON output | `src/data/cli.ts`, `test/data-cli.test.mjs` |
| Session import idempotency | `src/data/cli.ts`, `test/pibo-data-session-store.test.mjs` |
| Final cutover inspect/dry-run/apply | `src/data/final-app-space-cutover-migration.ts`, `test/final-app-space-cutover-migration.test.mjs` |
| Fresh app-space schemas | `test/shared-app-fresh-schema.test.mjs`, `test/ownerless-fresh-runtime-regression.test.mjs` |

## Notes

The previous unread-baseline repair workflow was a pre-final migration aid and is no longer documented as active behavior. Historical details belong in `docs/legacy/` or final cutover reports.
