# Private Pibo Home Validation — 2026-08-20

**Branch:** `fix/private-pibo-home`
**Base:** `upstream/dev` at `a399dcd7`
**Status:** Focused implementation validation passed; integrated and direct Windows/NTFS validation pending

## Confirmed defect

A clean default data-store initialization under a traversable parent and `umask 022` produced:

- Pibo Home mode `0755`;
- `pibo.sqlite` mode `0644`;
- successful reads by a second local POSIX account.

This made local confidentiality depend on the parent account home being non-traversable. That is not a safe product invariant for normal multi-user Linux hosts.

## Fix

- Added a centralized private-Pibo-Home guard.
- Stateful CLI dispatch creates or tightens Pibo Home before loading product state.
- Default Pibo data and reliability stores apply the same guard when initialized outside the CLI.
- Root discovery, root help, and version output remain side-effect free.
- Configuration writes create mode `0600` and repair broader existing modes on POSIX.
- Existing Pibo Home contents are not recursively modified.
- Paths outside Pibo Home are not chmodded by store initialization.

## Validation matrix

| Check | Result |
|---|---|
| Fresh POSIX Pibo Home becomes `0700` | Passed |
| Existing `0755` Pibo Home tightens to `0700` while preserving contents | Passed |
| Default store path tightens Pibo Home outside CLI | Passed |
| Root version output does not create Pibo Home | Passed |
| Stateful CLI command creates private Pibo Home | Passed |
| Config file creation and rewrite remain `0600` | Passed |
| TypeScript/typecheck and production build | Passed |
| Focused security/config suite | **10/10 passed** |
| Canonical suite | **1,786/1,786 passed across 310 files**; zero failures, skips, or cancellations |
| Disposable integrated package and Pibo2 | Pending integration |
| Windows/NTFS ACL inheritance | Blocked on powered-off authorized Windows host |

## Security boundary

The fix deliberately secures the Pibo-owned root rather than recursively chmodding installed tools, browser profiles, or arbitrary user content. A `0700` Pibo Home prevents other local accounts from traversing to otherwise broadly readable nested SQLite files. Explicit state paths outside Pibo Home remain operator-owned configuration and are not used as a reason to rewrite unrelated directory permissions.

## Remaining release gate

Direct Windows validation must confirm startup, NTFS ACL inheritance, existing-home repair behavior where applicable, Better Auth migration recovery, restart idempotence, rollback, and packed-install behavior. The authorized Windows host remained powered off and unreachable on ports 22, 3389, 5985, and 5986 during this validation pass.
