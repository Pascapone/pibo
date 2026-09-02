---
type: "Evidence Report"
title: "PRs #523–#530 independent merge-readiness review"
description: "Preserves the original report body as stable evidence without promoting historical claims."
tags: ["evidence","migration","report"]
status: "stable"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/reports/prs-523-530-merge-readiness-review-2026-08-21.md"
  source_commit: "15f2cd832e627d49c71be6a60708e5409be8772f"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "a992b5cdcefb39446615c9c9ee6ab41406c57b3c"
  source_bytes: 12831
  source_sha256: "9fede68f5ca76ac1142b1b7d5d2f15cafcf73c272427e9baed62c5ffec361497"
  source_body_sha256: "9fede68f5ca76ac1142b1b7d5d2f15cafcf73c272427e9baed62c5ffec361497"
generated:
  by: "process:pibo-okf-c-reports"
  at: "2026-09-01T07:57:34Z"
evidence:
  id: "pibo-okf-c-reports:prs-523-530-merge-readiness-review-2026-08-21"
  published_at: "2026-09-01T07:57:34Z"
---
# PRs #523–#530 independent merge-readiness review

Date: August 21, 2026

## Verdict

PRs #523–#530 are ready for maintainer review and ordered merge. Four PRs contained merge-blocking defects found during this independent review; all confirmed defects were fixed in their owning branches, pushed, and revalidated. No additional defect was confirmed in #524, #526, #527, or #529.

The final validated code integration was built from current `upstream/dev` at `a399dcd718364397de61cfa7e32da1eb5fe01b09` and the live PR heads listed below. The ordered merge completed with Git's `ort` strategy and no manual conflict resolution.

No PR was merged, no npm package was published, and no production deployment was performed.

## Final reviewed heads

| PR | Final reviewed head | Independent review result |
|---|---|---|
| #523 | `7f5283e93dd007e9b8c3f0fffadd12e5ca112b47` | Defect fixed; ready |
| #524 | `4a17cae22326d0beccc771122cd5c3df8d244112` | No additional defect confirmed; ready |
| #525 | `5d82f3e38d191646f9389431b96ae0971a7f7313` | Defects fixed; ready |
| #526 | `5a1e7459d0411e5616affb89743beea8f158a7d2` | No additional defect confirmed; ready |
| #527 | `70c7ecaab0ce0bfc62c6b84db6afda31c88e399b` | No additional defect confirmed; ready |
| #528 | `ab67ae96c86e0fb162ec457483f69101aaded664` | Defect fixed; ready |
| #529 | `f6b7221b73936ca34b734368006a268610127ad6` | No additional defect confirmed; ready |
| #530 | `003d3f89e6e74ff014f2fa39a4fc290ef2c049ae` before this report-only commit | Defects fixed; ready |

All eight branches had merge base `a399dcd718364397de61cfa7e32da1eb5fe01b09` with `upstream/dev` when the final simulation was built.

## Confirmed defects and owning-branch fixes

### #523 — Better Auth SQLite migration recovery

**Confirmed defect:** destructive recovery could replace a configured SQLite database containing unrelated product tables when an incompatible Better Auth schema was detected. A backup existed, but replacing the active database still violated the required boundary that recovery must not destroy unrelated product data.

**Fix:** recovery now verifies that every non-SQLite table belongs to the recognized Better Auth schema before allowing database replacement. A regression creates an unrelated sentinel table and proves recovery is refused without changing the database.

**Review commit:** `7f5283e9` (`fix(auth): refuse mixed-database recovery`).

### #525 — Runtime Portability v4.1

**Confirmed defects:**

1. Native context deduplication compared lexical workspace paths, so the same context file selected through a symlinked or junction-backed workspace could be delivered twice.
2. The first canonicalization fix still depended on `realpath`. On native Windows with Node `24.18.0`, `realpath`, `stat`, and file open through the test junction returned `UNKNOWN`, while `readlink` correctly exposed the target. This left the context file unreadable through the linked path.

**Fixes:** workspace context discovery now uses physical paths. If `realpath` fails, canonicalization walks to the nearest linked ancestor, resolves it through `readlink`, reattaches any nested suffix, and retries the physical path. The regression uses a working directory nested below a directory link and asserts that the physical context source is selected once.

**Review commits:**

- `e1704850` — canonicalize linked context workspaces;
- `d5b4345f` — resolve context files from the physical workspace;
- `5d82f3e3` — resolve native Windows junction ancestors.

### #528 — yielded-run cancellation

**Confirmed defect:** session disposal, session kill, child-session kill, and router shutdown could mark tracked runs cancelled without invoking the registered termination handler for the active yieldable tool. A process tree could therefore outlive the Pibo run state.

**Fix:** all owning session/router cancellation paths now invoke run termination handlers and await bounded settlement before disposal completes. Regressions prove active yielded execution is terminated during session disposal and admission is released.

**Review commit:** `ab67ae96` (`fix(runs): terminate work during session disposal`).

### #530 — Windows canonical portability and package reproducibility

**Confirmed defects:**

1. Chat Web app disposal did not release its channel event subscription.
2. Multiple Web Annotation app instances shared a singleton store, but disposing one instance could close the store while another still used it.
3. A `PiboSessionRouter` created an internal compatibility plugin registry whose Web Annotation app was never disposed. On NTFS this left `web-annotations.sqlite` open and made gateway cleanup fail with `EBUSY`.

**Fixes:** Chat Web now unsubscribes idempotently; default Web Annotation store use is reference-counted; and routers dispose web apps owned by their internal default or compatibility registries. Regressions cover subscription release, shared-store ownership, router disposal, and immediate NTFS directory removal.

**Review commits:**

- `44ad9d77` — make app resource disposal ownership-safe;
- `003d3f89` — dispose router-owned compatibility web apps.

## PRs with no additional confirmed defect

- **#524:** resource-reaper decisions remain scoped to the active Pibo/browser-use home while preserving explicit PID/profile exemptions and supervised-browser boundaries.
- **#526:** the Pi `0.84.2` migration, exact dependency pins, production dependency removal, and package-lock changes remained coherent in the integrated source and packed installation.
- **#527:** uploads remain under the active `$PIBO_HOME/uploads` boundary, with private path creation and instance-scoped attachment checks intact.
- **#529:** Pibo Home, config, data-store, machine-key, and Windows ACL ownership behavior remained the correct shared privacy foundation for the other PRs.

## Ordered integration

Recommended order:

1. #529 — shared Pibo Home/private-path foundation
2. #523 — Better Auth migration safety
3. #525 — runtime portability and context canonicalization
4. #524 — resource-reaper home scoping
5. #526 — Pi/dependency migration and lockfile convergence
6. #527 — private Chat upload storage
7. #528 — yielded-run cancellation lifecycle
8. #530 — final Windows harness, resource-disposal, and package-shrinkwrap layer

Why this order:

- #529 establishes privacy primitives used or extended by later security work.
- #523, #525, and #526 overlap package/runtime surfaces; applying #526 after #525 preserves the larger portability change while converging the final dependency graph.
- #527 overlaps Chat Web and private-path surfaces already changed earlier.
- #528 and #530 both touch router lifecycle; #530 is intentionally last so its cross-platform cleanup and package-generation changes apply to the final integrated tree.

Final validated integration identity before this report-only commit:

- commit: `d0b39653cec8e6c3347e7f2af25d05369f0ed932`
- tree: `a05c7c3b0ab3181ab1cd0ad03ef9371cdf5b20d8`
- merge log: all eight merges used `ort`; no manual resolution

## Linux validation

Environment:

- Linux `6.8.0-124-generic` x86_64
- Node `24.15.0`
- npm `11.12.1`

Final integrated results:

- typecheck: passed
- production build: passed
- repaired-defect focused set: 70 passed, 0 failed
- canonical suite: 1,833 passed, 0 failed, 0 skipped across 12 suites
- source production audit: 0 advisories
- source worktree: clean after restoring the canonical suite's expected executable-bit fixture mutation

The host's yielded-run PSI guard interrupted two earlier Linux command wrappers during dependency/build I/O. Those were infrastructure resource-policy terminations, not test failures. The same commands completed successfully when rerun directly with a bounded Node heap.

## Native Windows / NTFS validation

Environment:

- host: `PASKOPC`
- account: `PaskoPC\piboagent` (standard non-admin SSH account)
- Windows version reported by the runtime: `10.0.26200.0`
- PowerShell: `5.1.26100.9168`
- Node: `24.18.0`
- npm: `11.16.0`

The Git bundle and tarball were copied into a fresh disposable NTFS workspace. Their SHA-256 values matched the Linux originals before execution.

Final integrated results at `d0b39653cec8e6c3347e7f2af25d05369f0ed932`:

- clean bundle checkout: passed
- `npm ci`: 1,080 packages, 0 vulnerabilities
- typecheck: passed
- production build: passed
- canonical suite: 1,834 tests; 1,815 passed, 0 failed, 19 intentional platform skips
- isolated repaired-defect checks: 6 passed, 0 failed
- final source status: clean

The six isolated native regressions covered:

- mixed auth/product database recovery refusal;
- context deduplication through a nested NTFS junction;
- yielded execution termination during session disposal;
- Chat Web subscription release;
- shared Web Annotation store ownership;
- router-owned Web Annotation app disposal and immediate NTFS cleanup.

A post-canonical attempt to run six full test files in one Node invocation produced two cross-file environment/database-interference failures. This was not the canonical harness and was discarded as an invalid aggregate. The canonical suite passed, and each changed regression passed in its own isolated process.

### Defects found by native reruns

The first repaired candidate exposed two real Windows failures: the context file could not be opened through an NTFS junction, and `web-annotations.sqlite` remained locked after gateway shutdown. After the router cleanup fix, one junction failure remained. The final `readlink`-ancestor fix removed the last failure, producing the clean 1,815/0/19 result above.

## Final package candidate

Package: `@pasko70/pibo@1.7.2`

- filename: `pasko70-pibo-1.7.2.tgz`
- size: 3,456,011 bytes
- unpacked size: 13,450,354 bytes
- entries: 814
- SHA-256: `d439e5a56e7d793c20aedc4dab62cf8b646a4bca12c4252496e1185c2f017a02`
- npm SHA-1: `4ea9163e82608080371fe8ba08da5142f5d79245`
- npm integrity: `sha512-MYfaTyZmxDkFtpqEBvGTOcGDEUmZA9iC7FxhbnB9KppKBLonh8CK4jMdIac8eZ2NOMLzBllI8WecFvCib3cLNA==`

Reproducibility and install checks:

- packaged `npm-shrinkwrap.json` SHA-256: `a473c6cb307152e205448d99bc43d006149374db4eb469be5d279c37f7aa6887`
- repository `package-lock.json` SHA-256: `a473c6cb307152e205448d99bc43d006149374db4eb469be5d279c37f7aa6887`
- fresh Linux install: 633 packages, CLI `1.7.2`, 0 production advisories
- fresh Windows install: 633 packages, CLI `1.7.2`, 0 production advisories
- package SHA-256 rechecked on Windows: exact match

This report is under `docs/reports/`, which is not included by the package `files` manifest; the report-only commit therefore does not alter the validated package payload.

## NTFS ownership, ACL, machine-key, and BOM evidence

A fresh installed-package fixture created and audited eight private paths:

1. Pibo Home
2. `pibo.sqlite`
3. Chat upload directory
4. uploaded file
5. Codex `config.toml`
6. generated machine-key secret
7. generated hash-only machine-key record
8. UTF-8-BOM config file

All eight passed:

- owner was the current non-admin user SID;
- DACL inheritance was disabled;
- no inherited access rules remained;
- the only principals were the current user, SYSTEM, and Administrators;
- all three principals had Full Control;
- no deny or unexpected access rule was present.

The implementation intentionally refuses to take ownership of a path owned by another principal; it tightens ACLs only when the current process already owns the path. No administrator tunnel, UAC elevation, or ownership takeover was used.

The machine-key CLI generated separate secret and hash-record files without printing the raw token. PowerShell 5.1 loaded a config whose first bytes were `EF-BB-BF` and parsed `auth.mode=local`.

## GitHub state at final code-head review

Immediately before this report-only commit, all eight PRs were:

- open;
- non-draft;
- unmerged;
- mergeable with GitHub state `clean`;
- based on `dev` at `a399dcd718364397de61cfa7e32da1eb5fe01b09`;
- showing 0 check runs and 0 submitted reviews.

The absence of repository-hosted checks means the Linux and native Windows evidence in this report is the automated merge gate. Maintainer review remains required.

## Remaining uncertainty and non-actions

- No npm publication or production deployment was attempted.
- No PR was merged.
- Browser/UI evidence from the prior Windows validation remains applicable to unchanged UI/upload code, but the final repaired candidate was revalidated through source, canonical, focused, package, ACL, machine-key, and BOM gates rather than repeating the browser walkthrough.
- Integration should use the order above; although Git resolved that order automatically, reordering the overlapping package, Chat Web, router, and private-path PRs increases conflict and semantic-regression risk.
