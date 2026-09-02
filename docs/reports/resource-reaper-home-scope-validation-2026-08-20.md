---
type: "Evidence Report"
title: "Resource Reaper Home-Scope Validation — 2026-08-20"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/resource-reaper-home-scope-validation-2026-08-20.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "78a12acf39a76beea8079657f4974ba1971a6771"
  source_bytes: 3414
  source_sha256: "b7acde6c1670e16d4ff8549f66836e7546273ed83f771bf93194901ab72e89cd"
  source_body_sha256: "b7acde6c1670e16d4ff8549f66836e7546273ed83f771bf93194901ab72e89cd"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:resource-reaper-home-scope-validation-2026-08-20"
  published_at: "2026-09-01T07:57:34Z"
---
# Resource Reaper Home-Scope Validation — 2026-08-20

**Status:** PASS for focused implementation, integrated deployment, and sustained Pibo2 browser stability.
**Pull request:** #524

## Scope

This report validates `fix/resource-reaper-home-scope` at commit `f72aba6b42073f550f57eff18e756379c378cc64`.

The defect was cross-instance cleanup: one Pibo gateway could classify and terminate Chromium profiles owned by another Pibo instance. On Pibo2, an orphan gateway reaper repeatedly terminated the supervised headful validation browser.

## Implemented behavior

Unmanaged Chromium cleanup is now restricted to profiles inside the current Pibo instance's browser-use home. A Chromium process with a user-data directory outside that home is retained even when the unmanaged-browser grace period is zero. Existing explicit profile exemptions remain independently effective.

Changed files:

- `src/resources/lifecycle.ts`
- `test/resources-cli.test.mjs`

## Local validation

- TypeScript typecheck: passed.
- Production build: passed.
- Focused resource lifecycle and CLI tests: passed.
- `git diff --check`: passed.
- Fixture modes remained `0644`.

The tests cover in-home cleanup selection, out-of-home retention, exact profile ownership, and explicit exemption behavior.

## Integrated candidate

The fix was included without changing focused branch history in final disposable integration commit `64fb3d954285d8de5acb53ed8dfd8236be9e66f9`, together with private Pibo Home hardening.

Integrated validation passed:

- typecheck and production build;
- **175/175** targeted integration tests;
- **1,823/1,823** canonical tests across 313 files;
- packed local gateway smoke;
- installed production audit with zero advisories.

The checksum-verified archive was activated on Pibo2 as candidate `runtime-portability-v4-1-secure`.

## Pibo2 resource evidence

The supervised browser uses profile `/dev/shm/pibo2-headful-browser/profile`, outside the active gateway's browser-use home.

A zero-grace dry-run returned:

- action: `skip`;
- reason: `browser user-data-dir is outside this Pibo browser-use home`;
- browser PID: `1023085`.

A second zero-grace dry-run with the configured exact profile exemption returned:

- action: `skip`;
- reason: `explicitly exempted browser user-data-dir`;
- browser PID: `1023085`.

Automatic gateway reaper cycles from `2026-08-20 13:52:51 UTC` through `14:04:05 UTC` reported zero unmanaged browsers.

## Sustained browser stability

The authenticated non-headless Chrome instance remained:

- active since `2026-08-20 11:07:47 UTC`;
- PID `1023085`;
- supervised restart count `4`;
- one public Pibo Chat page;
- healthy CDP endpoint;
- authenticated through the machine identity;
- free of console warnings and errors during the final check.

The PID and restart count did not change through more than three hours of dwell and repeated automatic reaper cycles. This distinguishes the fixed behavior from the earlier approximately 15-minute cross-instance termination pattern.

## Safety boundary

The change does not broaden ownership or suppress cleanup globally. It prevents one Pibo home from reaping another home's browser profile. Processes under the active browser-use home remain eligible under the existing age, lease, and safety rules, and exact explicit exemptions continue to work.

No package was published, no branch was merged, and no release was created.
