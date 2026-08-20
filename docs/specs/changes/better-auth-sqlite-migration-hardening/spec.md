# Spec: Better Auth SQLite Migration Hardening

**Status:** Ready for review; direct Windows-host validation remains a release gate
**Created:** 2026-08-20
**Requester / Source:** Windows startup failure reported after Pibo 2.x installation
**Related docs:** `proposal.md`, `design.md`, `tasks.md`, `../../capabilities/web-auth-and-same-origin-host.md`, `../bootstrap-host-installation/spec.md`

## Why

A malformed or older Better Auth SQLite schema can prevent the entire Pibo gateway from starting. The observed Windows failure is SQLite's rejection of a required column addition without a non-NULL default. Authentication storage must not be allowed to make Pibo permanently unstartable when it can either be repaired or safely replaced without touching conversation data.

## Goal

Make Better Auth startup deterministic across installations and recover safely from incompatible SQLite schemas while preserving evidence and minimizing authentication-state loss.

## Background / Current State

Pibo opens `auth.sqlite`, asks Better Auth for pending migrations, and executes them directly. Better Auth can generate an unsupported SQLite migration for an existing table. Pibo has no preflight, backup, rollback, or recovery path. The package also uses a semver range for a migration-owning dependency, so a global npm install is not guaranteed to use the dependency version exercised by Pibo's lockfile.

## Scope

### In Scope

- SQLite databases opened by Pibo's Better Auth service.
- Exact dependency pinning.
- Safe preflight repair for required fields with deterministic backfill semantics.
- Protected backup and auth-only fresh-schema recovery for unsafe migration shapes.
- Rollback if recovery cannot create a valid fresh schema.
- Windows-safe paths and repeatable gateway restarts.

### Out of Scope

- Automatic repair of arbitrary non-auth Pibo databases.
- Preserving active browser sessions when the auth database requires full recovery.
- General Better Auth schema evolution for adapters Pibo does not configure.

## Requirements

### REQ-001: Validated dependency identity

Pibo MUST declare the validated Better Auth version exactly rather than through a range.

#### Acceptance

- `package.json` and `package-lock.json` resolve the same exact version.
- A packed/global-style installation resolves that version.

### REQ-002: Safe in-place repair

Before running Better Auth migrations, Pibo MUST detect required columns that SQLite cannot add to populated tables without a default. Pibo MUST repair only additions with deterministic safe backfills.

#### Scenario: Missing update timestamp

- GIVEN a populated Better Auth table is missing `createdAt` or `updatedAt`
- WHEN the auth service starts
- THEN Pibo adds the field with a valid non-NULL date value
- AND preserves existing rows
- AND Better Auth migrations finish successfully.

#### Scenario: Missing defaulted boolean

- GIVEN a populated table is missing a required boolean with a literal default
- WHEN the auth service starts
- THEN Pibo backfills the declared default and preserves existing rows.

### REQ-003: Protected auth-only recovery

When a populated auth table needs a required field that cannot be backfilled safely, Pibo MUST preserve a consistent backup and create a fresh Better Auth database instead of leaving the gateway unstartable.

#### Acceptance

- The backup name is valid on Windows and does not overwrite an existing backup.
- The backup is owner-readable/writable where POSIX mode bits apply.
- The backup retains the original rows and schema.
- Only the configured auth database is replaced.
- The startup warning states that authentication sessions were reset and identifies the backup path without exposing record contents.

### REQ-004: Recovery rollback

If fresh-schema creation fails after backup, Pibo MUST restore the original database and surface an actionable error.

### REQ-005: Restart safety

After either in-place repair or auth-only recovery, a second start MUST be migration-free and MUST NOT create another backup.

### REQ-006: Secret and data boundaries

Migration diagnostics MUST NOT print auth rows, OAuth tokens, cookies, machine keys, or database contents. Product and reliability databases MUST remain unchanged.

### REQ-007: Real installation validation

The exact packed candidate MUST start through a global-install-shaped path with a malformed legacy auth fixture. The default gateway command MUST reach readiness on both a fresh home and the recovered home.

## Edge Cases

- `:memory:` databases cannot be backed up as durable recovery artifacts and must surface the original migration failure.
- A backup-name collision receives a bounded numeric suffix.
- SQLite sidecar files from the failed connection are removed only after the consistent backup exists and the connection is closed.
- A failed replacement is removed before restoring the backup.
- Repeated starts do not repeatedly rewrite repaired columns or reset authentication.

## Constraints

- **Compatibility:** Existing valid Better Auth databases and local-auth mode remain unchanged.
- **Security / Privacy:** Backups contain credentials and must never be logged or inspected beyond schema/count metadata during tests.
- **Data:** Recovery may invalidate browser login sessions but must not alter Pibo sessions, rooms, messages, projects, workflows, or reliability state.
- **Cross-platform:** File names and file operations must work on Windows and POSIX hosts.

## Success Criteria

- [x] SC-001: The reported SQLite exception is reproduced by a deterministic populated-schema fixture.
- [x] SC-002: Safe missing fields are repaired in place with rows preserved.
- [x] SC-003: Unsafe missing fields trigger protected auth-only backup/recovery and a successful second start.
- [x] SC-004: Exact dependency and packed-install checks pass.
- [x] SC-005: Focused tests, typecheck, build, canonical suite, and exact-candidate Pibo2 gateway smoke tests pass.
- [ ] SC-006: The exact packed candidate passes the malformed-schema upgrade and NTFS ACL checks on an actual Windows host.

## Assumptions and Open Questions

### Assumptions

- `auth.sqlite` stores replaceable authentication/account/session state and is not the source of truth for Pibo conversations.
- Reauthentication is preferable to a permanently unavailable gateway when an auth schema cannot be repaired without inventing identity data.

### Open Questions

- The exact missing column in the user's private database is not available. Recovery therefore must cover the SQLite failure class without reading or logging private records.

## Traceability

| Requirement | Tasks | Status |
|---|---|---|
| REQ-001 | 2.1, 4.3 | Pass: source, lockfile, packed install, and Pibo2 candidate resolve exactly `1.6.30` |
| REQ-002 | 1.1-1.3, 2.2 | Pass |
| REQ-003 | 1.4, 2.3, 3.1 | Pass on POSIX/Pibo2; direct NTFS ACL proof remains under task 5.1 |
| REQ-004 | 2.4, 3.2, 3.5 | Pass: injected replacement failure restores the original auth database |
| REQ-005 | 3.3, 4.5 | Pass locally and across two production gateway restarts |
| REQ-006 | 2.5, 3.4, 4.5 | Pass |
| REQ-007 | 4.1-4.5 | Pass for exact source, packed/global-style, and Pibo2 candidate paths; actual Windows-host execution remains task 5.1 |
