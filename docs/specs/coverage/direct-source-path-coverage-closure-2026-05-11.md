# Coverage Analysis: Direct Source Path Coverage Closure 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Source Test Gap Priorities 2026-05-11](./source-test-gap-priorities-2026-05-11.md), [Unreferenced Artifact Triage 2026-05-11](./unreferenced-artifact-triage-2026-05-11.md), [Pibo Workflow Framework Package](../capabilities/pibo-workflow-framework-package.md)

## Why

The scheduled source-spec process has already produced capability specs for the major Pibo product seams. Before adding another capability spec, this run checked whether current source files are still absent from the spec tree at the path-reference level.

A duplicate capability spec would be lower value than a closure note because every current TypeScript source file under `src/` and every current checked-in script under `scripts/` is now named by at least one spec or coverage artifact. The remaining unmatched files are workflow package test artifacts and package metadata that existing coverage notes intentionally classify as verification or build support, not standalone product capabilities.

## Goal

Future scheduled source-spec runs SHOULD treat direct source-path coverage as closed for `src/` and `scripts/` until new files are added, and SHOULD focus on weak behavior verification, stale requirements, or newly introduced capabilities instead of creating duplicate path-coverage specs.

## Scope

### In Scope

- Current markdown specs under `docs/specs/`.
- Current source files under `src/`.
- Current checked-in support scripts under `scripts/`.
- Current workflow package files under `packages/workflows/` as a separate package-level coverage check.

### Out of Scope

- Source-code, test-code, or gateway changes.
- Docker worker setup or browser execution.
- Generated `dist/`, local `.pibo` state, dependencies, and worktrees.
- Legacy documents as source of truth.

## Current Coverage Findings

### Finding: All `src/` TypeScript paths are directly referenced

The current `docs/specs/**/*.md` tree contains direct references for every `*.ts` and `*.tsx` file under `src/`.

#### Acceptance

- A path-reference scan over `src/**/*.ts` and `src/**/*.tsx` reports no unmatched paths.
- New future `src/` files trigger either an owning capability spec update or a new coverage finding.

### Finding: All checked-in `scripts/` paths are directly referenced

The current spec tree also directly references current checked-in scripts, including deployment, PWA icon, browser-use wrapper, Docker entrypoint, signal benchmark, and Chat Web performance-check scripts.

#### Acceptance

- A path-reference scan over `scripts/` reports no unmatched checked-in script paths.
- Future scripts are classified as product behavior, operator examples, validation support, or non-contractual build support before new specs are written.

### Finding: Remaining unmatched workflow package artifacts are verification/support files

The unmatched package-level paths are concentrated in `packages/workflows/package-lock.json`, `packages/workflows/tsconfig.json`, workflow package test files under `packages/workflows/src/testing/`, and the XState projection snapshot JSON.

These files are already owned at the behavior level by `pibo-workflow-framework-package.md` and by the previous unreferenced-artifact triage decision. They should stay as verification evidence unless the package exposes a new public workflow behavior that is not captured by the workflow package spec.

#### Acceptance

- Workflow package source behavior remains specified through `pibo-workflow-framework-package.md`.
- Individual workflow test files are cited only when they clarify verification coverage for a requirement.
- Package metadata receives a separate spec only if it changes externally visible package build, export, or distribution behavior.

## Coverage Decision

No new capability spec is needed in this run. The useful artifact is this closure analysis under `docs/specs/coverage/`, because adding another broad capability spec would duplicate existing source-backed contracts.

The next high-value work is not path coverage. It is tightening weakly verified requirements already identified in `source-test-gap-priorities-2026-05-11.md`, especially Ralph, Projects, CLI discovery parity, provider usage normalization, and safe content rendering.

## Success Criteria

- [x] SC-001: Existing `docs/specs/` were inventoried before choosing a coverage artifact.
- [x] SC-002: Current `src/**/*.ts` and `src/**/*.tsx` paths have no direct-reference gaps in `docs/specs/**/*.md`.
- [x] SC-003: Current checked-in `scripts/` paths have no direct-reference gaps in `docs/specs/**/*.md`.
- [x] SC-004: Remaining package artifacts are classified without creating duplicate workflow specs.
- [x] SC-005: No source code, tests, gateway process, cron job, or Docker worker was changed.

## Verification Basis

This analysis is based on the current workspace files:

- `GLOSSARY.md`
- `AGENTS.md`
- complete `docs/specs/` inventory
- path-reference scan of `src/**/*.ts` and `src/**/*.tsx` against `docs/specs/**/*.md`
- path-reference scan of checked-in files under `scripts/` against `docs/specs/**/*.md`
- path-reference scan of `packages/workflows/` against `docs/specs/**/*.md`
- `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`
- `docs/specs/coverage/unreferenced-artifact-triage-2026-05-11.md`
- `docs/specs/capabilities/pibo-workflow-framework-package.md`
