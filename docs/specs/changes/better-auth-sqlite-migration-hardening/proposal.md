# Proposal: Better Auth SQLite Migration Hardening

**Status:** Ready for review; direct Windows-host validation remains a release gate
**Created:** 2026-08-20
**Requester / Source:** Windows startup failure reported after Pibo 2.x installation

## Why

Pibo 2.1.0/2.1.1 can fail before the gateway starts when Better Auth discovers an older or incomplete SQLite schema and emits `ALTER TABLE ... ADD COLUMN ... NOT NULL` without a non-NULL default. SQLite rejects that migration with `Cannot add a NOT NULL column with default value NULL`.

The failure currently makes the complete product unavailable even though the affected `auth.sqlite` contains replaceable authentication state rather than Pibo conversations or project data. Pibo also declares Better Auth with a caret range, so global npm installations can resolve a dependency version different from the version validated in the repository.

## What Changes

- Pin the validated Better Auth version exactly.
- Reconcile safely backfillable required SQLite columns before invoking Better Auth's migration runner.
- Preserve a protected backup and rebuild only `auth.sqlite` when an existing populated schema cannot be migrated safely.
- Restore the original database if fresh-schema creation fails.
- Add regression coverage for in-place repair, backup recovery, restart idempotence, and package dependency pinning.

## Capabilities

### Modified Capabilities

- `web-auth-and-same-origin-host`: Better Auth startup becomes deterministic and recoverable for incompatible SQLite schemas.
- `bootstrap-host-installation`: a supported global npm upgrade must leave `pibo gateway:web` startable on Windows and Linux.

## Impact

- **Code:** `src/auth/better-auth.ts`
- **Dependencies:** exact Better Auth package pin in `package.json` and lockfile
- **Data:** only the configured Better Auth SQLite database may be repaired or replaced; Pibo product and reliability stores are never touched
- **Auth / Security:** unrecoverable auth schemas are preserved as owner-readable backups; existing browser sessions may require a new sign-in after fallback recovery
- **Docs:** change spec, validation report, and release guidance
