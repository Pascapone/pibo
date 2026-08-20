# Better Auth SQLite Migration Hardening Validation — 2026-08-20

**Status:** PASS for implementation, deterministic regression coverage, packed installation, and exact-candidate Pibo2 deployment. Direct execution on a Windows host remains an external release gate.

## Scope

This change addresses the Pibo 2.x startup failure:

```text
Error: Cannot add a NOT NULL column with default value NULL
```

The failure occurs when Better Auth asks SQLite to add a required column without a non-NULL default to a populated legacy or incomplete authentication table.

## Exact candidate

| Item | Value |
|---|---|
| Branch | `fix/windows-better-auth-migration` |
| Implementation commit | `e599969f960a06b6061a1a8f10370bf3ea3e3cb6` |
| Rollback-test commit | `a52ccb036dacb997f80a838c6950f4483b40f191` |
| Package | `@pasko70/pibo@1.7.2` candidate archive |
| SHA-256 | `af2f89ba754d80355b7832854b464cd340a420905cefc34614d4cc20e74b9df5` |
| Archive size | 3,336,791 bytes |
| Archive entries | 803 |
| Pibo2 candidate | `windows-better-auth-migration/a52ccb036dacb997f80a838c6950f4483b40f191` |
| Focused review | PR #523 to `dev` |
| Resolved Better Auth | exactly `1.6.30` |

No merge, npm publication, release, or global package replacement was performed.

## Behavior verified

### Safe in-place repair

A populated legacy `user` table missing required `updatedAt` reproduced the raw Better Auth/SQLite exception. Pibo preflighted the pending schema, added a deterministic non-NULL timestamp, preserved the existing identity row, completed Better Auth migrations, and passed a second start without creating a recovery backup.

### Unsafe auth-only recovery

A populated `user` table missing required identity field `email` could not be repaired without inventing account data. Pibo:

1. created a consistent SQLite backup;
2. used a Windows-safe filename without `:`;
3. applied owner-only `0600` mode on POSIX;
4. replaced only the configured authentication database;
5. created the current Better Auth schema;
6. retained the original row and schema in the backup;
7. preserved an unrelated product-data sentinel unchanged; and
8. completed a second start without another backup.

The warning was bounded to recovery status, backup location, and reauthentication guidance. Tests reject disclosure of configured secrets or identity values.

### Recovery rollback

Fresh-schema migration failure was injected after the replacement database had already created a table. Pibo closed and removed the failed replacement, copied the protected backup back to the active database path, restored the original row/schema, removed the partial replacement table, preserved the backup, and surfaced an actionable failure stating that the original was restored.

## Local verification

- `npm run typecheck`: pass.
- `npm run build`: pass.
- Focused Better Auth/gateway regression set: 20/20 pass.
- Canonical repository suite: **1,785/1,785 pass** across 12 suites.
- `git diff --check`: pass.
- Source gateway smoke: reached readiness on port 3700.
- Packed/global-install-shaped gateway smoke: reached readiness on port 3700.
- Packed install resolved one Better Auth version, exactly `1.6.30`.

## Exact Pibo2 verification

The checksum-verified archive was installed below `/opt/pibo-candidates` and activated through the development-server candidate workflow. The active process identified the exact commit before all checks.

An isolated script imported `dist/auth/better-auth.js` from that immutable installed candidate and passed:

- safe populated-schema repair;
- unsafe protected-backup recovery;
- restart idempotence;
- Windows-safe backup naming;
- POSIX `0600` backup protection;
- unrelated-data isolation;
- injected recovery rollback; and
- SQLite integrity checks.

The production gateway was then restarted twice through `pibo gateway web restart`. After both restarts:

- restart safety was `idle` with zero runtime sessions;
- production `pibo.sqlite` integrity was `ok` across 26 tables;
- production `auth.sqlite` integrity was `ok` across 4 tables;
- no production auth recovery backup was required;
- public `/health` returned `{"status":"ok","mode":"main"}`;
- public Chat returned HTTP 200; and
- machine-key bootstrap returned HTTP 200 with an authenticated session, 12 agents, and 43 rooms.

## Data and credential safety

- The migration reads schema metadata and row counts only; it does not log rows, tokens, cookies, machine keys, or OAuth material.
- Unsafe recovery can replace only the configured Better Auth SQLite database.
- The original database remains in a protected backup if recovery is needed.
- Deployment output was restricted to allowlisted operational metadata; complete systemd environments were not printed.
- Validation used dummy credentials in isolated homes and did not copy production credentials.

## Remaining release gates

### Direct Windows validation

The SQLite failure class, packed/global install shape, Windows-safe filename generation, restart behavior, and rollback are covered deterministically. This environment did not provide an actual Windows host, so NTFS ACL inheritance, owner-only protection, and the exact `pibo gateway:web --web-port 3700` upgrade path still require one direct Windows run before release. The implementation deliberately avoids POSIX `chmod` on Windows.

### Production dependency audit

`npm audit --omit=dev` currently reports 24 advisories: 1 critical, 10 high, 10 moderate, and 3 low. They are not introduced by this focused migration change, but they remain release-blocking security debt for the broader Pibo 2 stability objective and must be resolved or explicitly dispositioned in separate focused work.

## Decision

The Better Auth SQLite migration implementation and rollback design are ready for focused review. They remove the reproduced startup-crash class without risking unrelated Pibo data and pass the exact packaged Pibo2 path. This report does not authorize merge, release, npm publication, or replacement of a published installation, and it does not substitute Linux/Pibo2 evidence for the outstanding direct Windows gate.
