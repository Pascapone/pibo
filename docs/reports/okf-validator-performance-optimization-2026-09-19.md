---
type: "Validation Report"
title: "OKF validator performance optimization — September 19, 2026"
description: "Records batched Git evidence checks and filesystem memoization that cut OKF validation time by an order of magnitude with byte-identical diagnostics."
tags: ["okf", "validation", "performance", "tooling"]
status: "draft"
authority: "evidentiary"
generated:
  by: "meta/muse-code"
  at: "2026-09-19T20:16:13Z"
sources:
  - id: "validator"
    resource: "scope:repository script scripts/validate-okf-docs.mjs on branch perf/okf-validator-batched-git"
    title: "Batched OKF documentation validator"
  - id: "index-generator"
    resource: "scope:repository script scripts/generate-okf-indexes.mjs on branch perf/okf-validator-batched-git"
    title: "Memoized OKF index generator"
  - id: "validator-tests"
    resource: "scope:repository test test/okf-validator.test.mjs on branch perf/okf-validator-batched-git"
    title: "OKF validator equivalence and regression tests"
---

# Summary

Strict OKF validation took several minutes because traceability evidence was verified with one Git process per evidence path (about 2.300 spawns), and the index generator resolved every path with a separate `realpathSync` call. The change keeps every check, error code, and message identical and only batches the expensive operations: one `git ls-tree -r` per commit plus per-run memoization for commits, trees, path existence, file contents, and directory resolution. All timings below were measured on the same WSL/Windows-mount machine against the same docs tree.

# Measurements

| Command | Before | After |
|---|---|---|
| `docs:validate:strict` | 206 s | ~17 s |
| `docs:validate:migration` | 203 s | ~16 s |
| `docs:indexes:check` | ~26 s | ~6 s |

# Changes

- `scripts/validate-okf-docs.mjs`: `gitFileAtCommit` now reads the full regular-file tree once per commit through `gitCommitRegularFiles` and answers evidence lookups from that cached set. If a tree read fails, it falls back to the previous per-path `ls-tree` check, so diagnostics stay identical in every case. Commit existence, directory chains, path existence, and file contents are memoized per run.
- `scripts/generate-okf-indexes.mjs`: directory chains are validated once per run and resolved paths are joined from the validated parent instead of calling `realpathSync` per path. Every symlink, escape, and regularity check and every error message is unchanged.
- `test/okf-validator.test.mjs`: a new test asserts that batched and per-path lookups agree on regular, executable, nested, symlinked, directory, missing, and post-commit paths, and that each distinct commit reads its tree exactly once.

# Equivalence evidence

- Old (pre-change) versus new validator output was compared byte-for-byte as JSON on the same tree: strict, migration, and index check are all identical, including the pre-existing findings below.
- The focused suites pass: `node --test test/okf-validator.test.mjs test/okf-authoring-guidance.test.mjs` reports 87 pass, 0 fail.

# Review notes

- The join-based resolution in the index generator equals `realpathSync` for the checked paths: every ancestor segment is verified by `lstat` to exist as a real directory without symlinks, so the real path of a child is exactly the parent real path plus the segment. Caches live for one run only and are never persisted.
- Two review nits were applied on top of the implementation: dead fields were removed from the filesystem cache constructor, and `cachedRealpath` guards a missing cache like its sibling helpers.
- No specification changes were needed: behavior is unchanged and no normative document pins the previous per-path implementation.

# Pre-existing findings

One `PIBO_TRACE_COMMIT` error in `docs/specs/data/storage-maintenance.md` exists identically before and after the change and is unrelated to it. A stale managed index (`docs/specs/runtime/index.md`, missing "sandbox control" from a description update) was regenerated as a drive-by in this change so `docs:indexes:check` passes again.

# Residual

The remaining ~17 seconds are almost entirely Git and filesystem wait time on this WSL/Windows mount; the same code runs in a few seconds on a native Linux filesystem.
