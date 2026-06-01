# US-026 Full Docker Validation on Ownerless Fresh Test Databases

**Date:** 2026-06-01  
**Worker:** `pibo-dev-final-owner-scope-removal-ralph`  
**Workspace:** `/workspace`  
**Fresh test home:** `/workspace/.pibo/ralph-test-home`

## Scope

This report records the US-026 full validation pass for the ownerless runtime branch. All commands ran inside the dedicated Docker worker. Before validation, only the worker-local fresh test home was reset:

```bash
rm -rf /workspace/.pibo/ralph-test-home
mkdir -p /workspace/.pibo/ralph-test-home
```

The validation environment printed:

```text
PIBO_HOME=/workspace/.pibo/ralph-test-home
PIBO_MIGRATION_SANDBOX_HOME=/workspace/.pibo/ralph-migration-sandbox
```

No command targeted `/root/.pibo`, host Dev, host Production, host gateways, deploy scripts, or PR creation.

## Test maintenance before the full run

The first full `npm test` exposed stale tests that still expected runtime stores to rebuild old owner/principal schemas or still read moved historical spec files from current docs paths. Those expectations were obsolete after US-024 removed runtime compatibility and US-025 archived superseded docs. This story updated tests only:

- Removed or rewrote runtime-store historical owner-column migration expectations for sessions, Custom Agents, Projects/workflow UI, Web Annotations, Ralph, and Cron. Historical data migration coverage remains in `test/final-app-space-cutover-migration.test.mjs`.
- Updated compute worker tests from technical `ownerScope` labels to `holder` labels.
- Updated user-settings tests for app-level `user-settings.json` storage.
- Updated Ink/TUI parity tests for the ownerless `room-session-message` scenario and archived historical docs paths.
- Updated workflow catalog tests so `publishedBy`/`deletedBy` remain auth audit ids, not product owners.

## Commands and results

### Typecheck

```bash
.pibo/ralph-worker.sh 'npm run typecheck'
```

Result: passed.

### Build

```bash
.pibo/ralph-worker.sh 'npm run build'
```

Result: passed. The build emitted only the existing Vite chunk-size warnings.

### Full root test suite

```bash
.pibo/ralph-worker.sh 'npm test'
```

Result: passed.

```text
tests 895
suites 4
pass 895
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 49647.085616
```

### Fresh ownerless schema/runtime assertions

```bash
.pibo/ralph-worker.sh 'node --test test/shared-app-fresh-schema.test.mjs test/ownerless-fresh-runtime-regression.test.mjs'
```

Result: passed.

```text
tests 2
suites 0
pass 2
fail 0
```

### Worker fresh-home schema inventory

A read-only Python SQLite inventory scanned the fresh test home DBs under `/workspace/.pibo/ralph-test-home` for forbidden product columns/tables:

- columns: `owner_scope`, `principal_id`
- tables: `room_members`, `principal_session_stats`, `principal_room_stats`

Result: passed with zero violations across 6 fresh-home databases:

```text
/workspace/.pibo/ralph-test-home/pibo-cron.sqlite
/workspace/.pibo/ralph-test-home/pibo-events.sqlite
/workspace/.pibo/ralph-test-home/pibo-ralph.sqlite
/workspace/.pibo/ralph-test-home/pibo.sqlite
/workspace/.pibo/ralph-test-home/web-annotations.sqlite
/workspace/.pibo/ralph-test-home/web-projects.sqlite
```

The inventory artifact is in the worker at `/tmp/us026-fresh-home-schema-inventory.json`.

## Safety confirmation

- Host `/root/.pibo` was not read or mutated by validation commands.
- Host Dev and Production gateways were not restarted or deployed.
- No migration apply ran against host or Production data.
- No upstream PR was created.

## Follow-up

US-027 should validate migrated sandbox data through Docker-only Chat Web/CLI/TUI/API paths. US-029 should run final zero-regression search gates and decide whether remaining technical `owner` terminology outside product Owner Scope needs cleanup or explicit documentation.
