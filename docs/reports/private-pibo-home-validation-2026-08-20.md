---
type: "Evidence Report"
title: "Private Pibo Home Validation — 2026-08-20"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/private-pibo-home-validation-2026-08-20.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "974d175b28144f56671500ff3102bb3777ecdf68"
  source_bytes: 5500
  source_sha256: "c3ab02d6badebc66c26d8bfdbd7b970249a794c3eb6dca51177cbb8c5a6b73d8"
  source_body_sha256: "c3ab02d6badebc66c26d8bfdbd7b970249a794c3eb6dca51177cbb8c5a6b73d8"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:private-pibo-home-validation-2026-08-20"
  published_at: "2026-09-01T07:57:34Z"
---
# Private Pibo Home Validation — 2026-08-20

**Branch:** `fix/private-pibo-home`
**Base:** `upstream/dev` at `a399dcd7`
**Pull request:** #529
**Status:** PASS for focused, integrated, packed-install, and Pibo2 POSIX validation; direct Windows/NTFS validation pending

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
| Disposable integrated package | **175/175 focused; 1,823/1,823 canonical across 313 files** |
| Packed installed artifact | Zero production advisories; private-home/config/gateway smoke passed |
| Exact Pibo2 candidate | Private home `0700`; cross-account read denied; authenticated bootstrap and browser passed |
| Windows/NTFS ACL inheritance | Blocked on powered-off authorized Windows host |

## Integrated and packed evidence

The focused fix was included in disposable integration commit `64fb3d954285d8de5acb53ed8dfd8236be9e66f9` with Runtime Portability v4.1, Better Auth migration hardening, production dependency hardening, resource-reaper home scoping, private upload storage, and yielded-run cancellation.

- Integrated typecheck and production build passed.
- Integrated focused suite: **175/175 passed**.
- Integrated canonical suite: **1,823/1,823 passed across 313 files**, with zero failures, skips, or cancellations.
- Packed archive SHA-256: `1955fc3665fffd701bd65a00d6a1935bbdecdb603f2c2112c6de230c33accad9`.
- An isolated production install reported zero advisories, Pi `0.84.2`, Better Auth `1.6.30`, `js-yaml@4.3.1`, and no MDX Editor production dependency.
- The installed CLI left Pibo Home absent for `--version`, created it as `0700` for stateful use, repaired a widened home, wrote config as `0600`, protected direct default-store use, and started/stopped a local-auth gateway with Chat and bootstrap HTTP 200.

## Exact Pibo2 evidence

The checksum-verified package was activated as candidate `runtime-portability-v4-1-secure` at commit `64fb3d954285d8de5acb53ed8dfd8236be9e66f9`.

- Live Pibo Home remained `0700`; live configuration remained `0600`.
- An isolated exact-package test under a public `0755` parent created Pibo Home as `0700`; the unprivileged browser account could not read through it.
- `pibo.sqlite`, `auth.sqlite`, `pibo-events.sqlite`, and `chat-agents.sqlite` each passed SQLite `PRAGMA integrity_check`.
- Machine-key bootstrap returned HTTP 200 with an authenticated session, 13 agents, and 43 rooms.
- The existing authenticated headful browser retained PID `1023085`, restart count `4`, one Chat target, and no browser-console warnings or errors.
- The gateway started at 2026-08-20 16:15:56 UTC and retained PID `1054421` with restart count `0` through an eight-sample soak ending at 16:31:55 UTC. Every sample returned local unauthenticated HTTP 302, public HTTP 200, and exactly one browser page; four reaper cycles completed with no journal warnings/errors or active yielded units.
- The exact installed package cancelled a live 30-second isolated Bash run, left its systemd unit inactive, immediately completed a replacement run under a one-run admission limit, and left zero yielded units.
- The exact installed package saved a benign upload with directory mode `0700` and file mode `0600`.
- No provider turn was used.

## Security boundary

The fix deliberately secures the Pibo-owned root rather than recursively chmodding installed tools, browser profiles, or arbitrary user content. A `0700` Pibo Home prevents other local accounts from traversing to otherwise broadly readable nested SQLite files. Explicit state paths outside Pibo Home remain operator-owned configuration and are not used as a reason to rewrite unrelated directory permissions.

## Remaining release gate

Direct Windows validation must confirm startup, NTFS ACL inheritance, existing-home repair behavior where applicable, Better Auth migration recovery, restart idempotence, rollback, and packed-install behavior. The authorized Windows host remained powered off and unreachable on ports 22, 3389, 5985, and 5986 during this validation pass.
