# Tasks: Better Auth SQLite Migration Hardening

**Status:** Implementing
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

## 4. Installation and release-candidate validation

- [x] 4.1 Run focused auth and gateway tests: 19/19 focused tests pass, and both safe-repair and fallback gateway smokes reach readiness on port 3700.
- [x] 4.2 Run typecheck, build, and canonical test suite: build passes and 1,784/1,784 tests pass.
- [ ] 4.3 Pack the candidate and verify exact dependency resolution in a global-install-shaped directory.
- [ ] 4.4 Start `pibo gateway:web --web-port 3700` against fresh, safely repairable, and fallback-recovery homes.
- [ ] 4.5 Validate the exact candidate on Pibo2 without merging, publishing, or releasing.
- [ ] 4.6 Record evidence under `docs/reports/` and open a focused PR to `dev`.
