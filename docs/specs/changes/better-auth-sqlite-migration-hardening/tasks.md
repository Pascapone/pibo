# Tasks: Better Auth SQLite Migration Hardening

**Status:** Ready for review; direct Windows-host validation remains a release gate
**Updated:** 2026-08-20

## 1. Evidence and fixtures

- [x] 1.1 Confirm published Pibo 2.0.0 and 2.1.1 declare Better Auth with a caret range.
- [x] 1.2 Compare Better Auth 1.6.9, 1.6.29, and 1.6.30 core schemas.
- [x] 1.3 Add a populated SQLite fixture that reproduces `Cannot add a NOT NULL column with default value NULL`.
- [x] 1.4 Add an unsafe-schema fixture that requires auth-only backup recovery.

## 2. Implementation

- [x] 2.1 Pin Better Auth `1.6.30` exactly in `package.json` and `package-lock.json`.
- [x] 2.2 Add deterministic required-column preflight repair in `src/auth/better-auth.ts`.
- [x] 2.3 Add consistent backup, fresh-schema recovery, and Windows-safe naming.
- [x] 2.4 Restore the original database if fresh-schema creation fails.
- [x] 2.5 Emit bounded recovery diagnostics without auth record contents.

## 3. Regression verification

- [x] 3.1 Prove safe repair preserves existing rows and schema invariants.
- [x] 3.2 Prove unsafe recovery preserves the original database in a protected backup.
- [x] 3.3 Prove a second start is idempotent and creates no additional backup.
- [x] 3.4 Prove product/reliability stores and secret values are not touched or logged.
- [x] 3.5 Inject fresh-schema failure and prove the original auth database is restored from the protected snapshot.

## 4. Installation and release-candidate validation

- [x] 4.1 Run focused auth and gateway tests: 20/20 focused tests pass, and both safe-repair and fallback gateway smokes reach readiness on port 3700.
- [x] 4.2 Run typecheck, build, and canonical test suite: build passes and 1,785/1,785 tests pass.
- [x] 4.3 Pack commit `a52ccb03`, verify SHA-256 `af2f89ba754d80355b7832854b464cd340a420905cefc34614d4cc20e74b9df5`, and prove a global-install-shaped directory resolves Better Auth `1.6.30` exactly.
- [x] 4.4 Start `pibo gateway:web --web-port 3700` from source and the packed global-style install against safely repairable and fallback-recovery homes.
- [x] 4.5 Validate the exact candidate on Pibo2 without merging, publishing, or releasing, including isolated repair/recovery/rollback, two production restarts, database integrity, public health/Chat, and machine authentication.
- [x] 4.6 Record evidence under `docs/reports/` and open focused PR #523 to `dev`.

## Remaining release gate

- [ ] 5.1 Run the exact packed candidate on an actual Windows host and verify malformed-schema upgrade, second-start idempotence, Windows backup naming, NTFS ACL protection, and rollback.
