# Design: Better Auth SQLite Migration Hardening

**Status:** Ready for review; direct Windows-host validation remains a release gate
**Created:** 2026-08-20

## Context

Better Auth owns its schema description and migration plan, while Pibo owns the SQLite file and gateway availability. Better Auth's generated SQLite migration can contain `ADD COLUMN ... NOT NULL` without a default. SQLite rejects that operation for existing populated tables. Pibo must keep the provider library authoritative for normal migrations but add a narrow compatibility boundary for this unsupported shape.

## Goals / Non-Goals

### Goals

- Preserve valid auth rows when a missing required field has a deterministic safe value.
- Recover gateway availability without deleting the only copy of incompatible auth state.
- Keep dependency resolution reproducible across npm installations.
- Make recovery idempotent and testable.

### Non-Goals

- Reimplement Better Auth's complete migration engine.
- Infer missing identity relationships or token values.
- Migrate Pibo product databases through this path.

## Decisions

### Decision: Inspect Better Auth's pending migration metadata

- **Choice:** Use `getMigrations(authOptions).toBeAdded` before execution.
- **Rationale:** Better Auth remains the schema authority, while Pibo can identify required additions that SQLite cannot execute safely.
- **Alternative considered:** Parse generated SQL. Rejected because metadata is less brittle and retains field semantics.

### Decision: Repair only deterministic fields in place

- **Choice:** Backfill `createdAt`/`updatedAt` with a bounded ISO timestamp and required fields with literal primitive defaults declared by Better Auth. Empty-table additions may use type-safe constants when they are not foreign keys.
- **Rationale:** These values do not invent an account identity, provider relationship, session token, or foreign key.
- **Alternative considered:** Add every field as nullable. Rejected because it weakens required schema invariants and can preserve invalid identity rows.

### Decision: Backup and reset unsafe auth schemas

- **Choice:** Use Node SQLite's online `backup()` API, close the failed database, remove only the configured auth database and sidecars, create a fresh schema, and retain the protected backup.
- **Rationale:** Authentication can be re-established, while fabricated identity data would be unsafe. The backup avoids irreversible loss.
- **Alternative considered:** Abort with manual instructions. Rejected because the default gateway would remain unavailable.

### Decision: Roll back failed recovery

- **Choice:** If fresh migration fails, close and remove the replacement, restore the consistent backup to the configured path, and throw an error naming the preserved backup.
- **Rationale:** Recovery must not turn a migration failure into data loss.

### Decision: Rebuild the Better Auth runtime after recovery

- **Choice:** Treat the database, auth options, and Better Auth instance as one replaceable runtime object.
- **Rationale:** A Better Auth instance must never retain a closed database handle after recovery.

### Decision: Pin Better Auth exactly

- **Choice:** Replace `^1.6.9` with the exact validated release.
- **Rationale:** npm package consumers do not install dependencies from Pibo's lockfile. A caret range otherwise makes release behavior depend on installation date.

## Risks / Trade-offs

- Unsafe-schema recovery logs users out. The warning must state this clearly.
- Retained backups contain sensitive auth state. They use restrictive permissions where supported and are never inspected or uploaded.
- Exact pinning requires deliberate dependency upgrades, which is preferable for a migration-owning security dependency.

## Migration / Rollback

1. Open the configured SQLite database.
2. Read pending Better Auth migration metadata.
3. Apply safe required-column backfills transactionally.
4. Recompute and run Better Auth migrations.
5. If unsafe required additions exist or the known SQLite NOT NULL failure remains, create a consistent protected backup and fresh auth schema.
6. If step 5 fails, restore the original database.

Code rollback restores the previous startup behavior; retained recovery backups remain untouched.

## Open Questions

- None blocking implementation. The private failing database is not required because deterministic fixtures cover both safe and unsafe missing-column classes.
