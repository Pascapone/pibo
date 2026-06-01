# Coverage Analysis: Scheduled Run Source Delta Check 2026-05-11

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Direct Source Path Coverage Closure](./direct-source-path-coverage-closure-2026-05-11.md), [Source Test Gap Priorities](./source-test-gap-priorities-2026-05-11.md), [Spec Inventory Deduplication](./spec-inventory-deduplication-2026-05-11.md)

## Why

This scheduled job must keep extending source-backed specs without creating duplicates. The current `docs/specs/` inventory already contains capability specs for the major Pibo product seams and multiple same-day coverage analyses that close direct source-path gaps.

This run found no changed source files in the workspace. The visible workspace delta is documentation-only plus a generated backup directory. Creating another capability spec would restate existing behavior instead of improving coverage. A short delta check is the safest useful artifact for this run.

## Goal

Future scheduled source-spec runs SHOULD create or extend capability specs only when the current workspace contains new or changed source behavior that is not already managed by an existing spec; otherwise they SHOULD record a narrow coverage or verification-readiness note.

## Scope

### In Scope

- Current `docs/specs/` inventory.
- Current tracked source layout under `src/`, `scripts/`, and `packages/workflows/src/`.
- Workspace status used to decide whether new source-backed behavior exists for this run.
- Existing coverage decisions that classify remaining work as verification rather than new capability prose.

### Out of Scope

- Source-code changes.
- Test-code changes.
- Docker workers, gateway restarts, browser checks, or deployment.
- Legacy documentation as truth over current source.
- Rewriting existing specs only to change style or wording.

## Findings

### Finding: No source delta requires a new capability spec in this run

`git status --short` shows modified and untracked files under `docs/specs/` and a generated `dist.backup-before-workflows-preview-*` directory, but no modified or untracked files under `src/`, `scripts/`, or `packages/workflows/src/`.

The current source surface remains the same surface already covered by the existing capability specs and the direct path-coverage closure note.

#### Acceptance for future runs

- If a future run sees no source delta and no newly discovered behavior gap, it SHOULD NOT create a duplicate capability spec.
- If a future run sees source changes, it SHOULD map each changed source path to an existing owning spec before choosing whether to create a new spec.
- If source changes only affect tests, fixtures, or generated artifacts, the run SHOULD prefer verification coverage notes over product capability specs.

### Finding: The next useful work is verification, not prose duplication

Existing coverage analyses identify weakly verified areas such as Ralph jobs, Projects, CLI discovery parity, provider/settings UI, OpenAI Codex usage, and safe content rendering. Those areas already have owning capability specs and recommended test matrices.

#### Acceptance for future runs

- Ralph behavior changes update `continuous-ralph-jobs.md`; unchanged Ralph source should lead to tests or a short verification-readiness note.
- Projects behavior changes update `chat-web-projects-area.md`; unchanged Projects source should lead to tests or a short verification-readiness note.
- CLI discovery behavior changes update the relevant CLI capability spec; unchanged help surfaces should be validated by built-CLI tests rather than new prose.
- Renderer safety behavior changes update `chat-web-safe-content-rendering.md`; unchanged renderer code should be covered by component or browser-independent tests.

## Coverage Decision

No new capability spec was created in this run. The single useful output is this coverage analysis under `docs/specs/coverage/`, because the current codebase has no source delta that would justify a new source-backed behavior contract.

## Success Criteria

- [x] SC-001: `GLOSSARY.md` and project instructions were read before writing.
- [x] SC-002: The full `docs/specs/` file inventory was inspected before choosing this artifact.
- [x] SC-003: Current source areas were inspected and compared against existing coverage decisions.
- [x] SC-004: The artifact avoids duplicating an existing capability spec.
- [x] SC-005: No source code, tests, cron jobs, Docker workers, gateways, or deployments were changed.

## Verification Basis

This analysis is based on the current workspace files and commands:

- `GLOSSARY.md`
- `AGENTS.md`
- full `docs/specs/` inventory from `find docs/specs -type f | sort`
- source layout from `find src packages/workflows/src scripts -type f`
- workspace status from `git status --short`
- `docs/specs/coverage/direct-source-path-coverage-closure-2026-05-11.md`
- `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`
- `docs/specs/coverage/spec-inventory-deduplication-2026-05-11.md`
