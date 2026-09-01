---
type: "Coverage Report"
title: "Web Annotations Branch Triage — Source Spec Refresh"
description: "Preserves a dated coverage analysis as deprecated evidentiary context."
tags: ["coverage", "historical-evidence"]
status: "deprecated"
authority: "evidentiary"
migration_lineage:
  source_path: "docs/specs/coverage/web-annotations-branch-triage-2026-05-17.md"
  baseline_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  baseline_blob_oid: "b114bf36929e2299d61d215b2a0ec5f75674f336"
  source_bytes: 2724
  source_sha256: "9ba37bd7d8189e64492f5c172f4cc17f914168f83022be3bcbbcc2c67aa3aae1"
  source_body_sha256: "9ba37bd7d8189e64492f5c172f4cc17f914168f83022be3bcbbcc2c67aa3aae1"
generated:
  by: "process:pibo-okf-b03-catalog-rebuild"
  at: "2026-08-31T17:59:41Z"
---
# Web Annotations Branch Triage — Source Spec Refresh

**Date:** 2026-05-17
**Queue item:** `q-web-annotations-uncommitted`
**Status:** Coverage note, not a behavior spec

## Summary

The Web Annotations docs in `docs/specs/changes/web-annotations-plugin/` are intentional future/target change specs for behavior that is not present in this source-spec refresh worktree.

This source-spec loop should not rewrite those change specs to match the current worktree absence of Web Annotations implementation, and it should not import the parallel Web Annotations branch while that work is still separate and has uncommitted changes.

## Evidence

Current source-spec refresh worktree:

- No `src/web-annotations/` implementation exists.
- No `docs/specs/capabilities/web-annotations-plugin.md` capability spec exists.
- The existing `proposal.md`, `spec.md`, `design.md`, and `tasks.md` under `docs/specs/changes/web-annotations-plugin/` describe target behavior and contain explicit `Current` sections that say the annotation store, overlay, Chat Web flow, and agent tools do not exist yet.

Parallel branch/worktree observed read-only:

- Worktree: `/root/code/pibo/.worktrees/dev/.worktrees/web-annotations-plugin`
- Branch: `web-annotations-plugin`
- The branch contains committed PRD and implementation progress through PRD05, including a capability spec, `src/web-annotations/`, plugin registration, store/tool/CDP/overlay work, and focused tests.
- The branch also has uncommitted changes in Chat Web UI/API and Web Annotations CDP code, plus PRD progress notes.

## Triage decision

For this source-spec refresh branch:

1. Treat `docs/specs/changes/web-annotations-plugin/` as target/change documentation, not current source-backed behavior.
2. Do not merge or copy PRD/capability docs from the parallel `web-annotations-plugin` worktree in this loop.
3. Do not wait on the parallel branch before continuing the source-spec refresh inventory.
4. After Web Annotations code lands in the audited base, refresh or add the durable capability spec from the landed source and reconcile the change spec/task status then.

## Verification basis

- `rg` over current `src/`, `test/`, `packages/`, and project docs found no current Web Annotations source symbols outside the target change spec.
- `git worktree list --porcelain` shows the separate `web-annotations-plugin` worktree.
- `git -C /root/code/pibo/.worktrees/dev/.worktrees/web-annotations-plugin status --short` shows uncommitted Web Annotations branch changes.
- `git diff --stat HEAD..web-annotations-plugin -- docs/specs/changes/web-annotations-plugin docs/specs/capabilities/web-annotations-plugin.md` shows branch-local docs/PRDs not present in this worktree.
