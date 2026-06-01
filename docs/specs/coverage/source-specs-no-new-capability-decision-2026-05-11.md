# Coverage Analysis: Source Specs No-New-Capability Decision 2026-05-11

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Source Specs Coverage Checkpoint 2026-05-11](./source-specs-coverage-checkpoint-2026-05-11.md), [Direct Source Path Coverage Closure 2026-05-11](./direct-source-path-coverage-closure-2026-05-11.md), [Source Test Gap Priorities 2026-05-11](./source-test-gap-priorities-2026-05-11.md), [Spec Inventory Deduplication 2026-05-11](./spec-inventory-deduplication-2026-05-11.md)

## Why

The scheduled source-spec process should keep expanding real project coverage, but it should not create duplicate capability specs after the current source tree is already mapped to durable behavior contracts. This run rechecked the current code and spec inventory before writing new prose.

The useful finding is negative: no current `src/` or checked-in `scripts/` path needs a new standalone capability spec in this run. The remaining work is verification tightening and careful updates to owning specs when source behavior changes.

## Goal

Future scheduled source-spec runs SHOULD create a new capability spec only when current source introduces a user-visible or operator-visible behavior that is not already managed by an existing spec; otherwise they SHOULD update the owning spec or write a short coverage decision instead of duplicating contracts.

## Scope

### In Scope

- Current specs under `docs/specs/`.
- Current TypeScript source under `src/`.
- Current checked-in operational scripts under `scripts/`.
- Current workflow package source and test artifacts under `packages/workflows/src/`.
- Current root test inventory under `test/` as a verification signal.

### Out of Scope

- Source-code or test-code changes.
- Docker worker setup, gateway restarts, browser checks, or external services.
- Generated `dist/`, local `.pibo` state, worktrees, dependencies, and legacy documents as source of truth.
- Creating component-level specs for implementation helpers already managed by broader behavior specs.

## Findings

### Finding: Current `src/` and `scripts/` paths are already mapped

A current path-reference scan found that all `src/**/*.ts`, `src/**/*.tsx`, and checked-in `scripts/*` files are named somewhere in `docs/specs/**/*.md`. Path references are not proof of complete verification, but they are enough to avoid creating another broad coverage spec for the same source areas.

#### Acceptance

- A future run MAY create a new capability spec when a new `src/` or `scripts/` path exposes behavior not covered by an existing capability spec.
- A future run SHOULD NOT create a new spec merely because an implementation helper could be described in more detail.
- If the path inventory remains unchanged, future work should target test gaps, stale requirement statuses, or behavior changes in owning specs.

### Finding: Workflow test artifacts remain verification evidence

The remaining directly unmatched workflow paths are package test files under `packages/workflows/src/testing/`. Existing coverage notes classify them as verification/support artifacts for `pibo-workflow-framework-package.md`, not separate product surfaces.

#### Acceptance

- New workflow package behavior belongs in `docs/specs/capabilities/pibo-workflow-framework-package.md` unless it crosses into Chat Web, Projects, routing, gateway, or another product boundary.
- Individual workflow test files should be cited in verification matrices only when they clarify coverage for a requirement.
- Do not create one spec per workflow test case.

### Finding: The highest-value next work is verification, not more capability prose

The current test inventory still lacks focused coverage for some already-specified behavior, especially Ralph, Projects, newer CLI discovery branches, provider usage and settings UI, safe rendering, and browser-use lease edge cases. Those gaps are already listed in source coverage artifacts and in the owning capability specs.

#### Acceptance

- Future source-spec runs should update `source-test-gap-priorities-2026-05-11.md` only if the source or test inventory changes materially.
- If a scheduled run cannot write tests, it should record only new coverage decisions or source-backed deltas, not restate the same missing tests.
- Requirement statuses in owning specs should move toward `CLI-tested`, `API-tested`, `unit-tested`, or `source-inspected` labels when direct evidence changes.

## Requirements

### Requirement: New specs require uncovered behavior

The source-spec process MUST create a new capability spec only when current code shows behavior that lacks an owning behavior contract.

#### Current

The current workspace has broad capability specs for routing, sessions, Chat Web, data stores, gateway behavior, auth, models, tools, MCP, cron, Ralph, workflow, deployment, Docker workers, CLI discovery, and validation.

#### Target

New specs are reserved for new product or technical capabilities, not for duplicating helper details already covered by an owning spec.

#### Acceptance

- Given a future source inventory with no new uncovered behavior, the scheduled job writes no duplicate capability spec.
- Given a new source path with externally visible behavior, the scheduled job either creates one focused capability spec or extends the owning existing spec.

#### Scenario: No uncovered source behavior

- GIVEN the existing spec tree already owns current source behavior
- WHEN a scheduled source-spec run inspects the workspace
- THEN it writes at most one coverage decision
- AND it names the owning specs for any inspected helper seams.

### Requirement: Verification gaps stay separate from capability contracts

Coverage artifacts MUST distinguish missing tests from missing behavior specs.

#### Current

Several requirements are source-inspected or partially verified, but their behavior is already specified in existing capability specs.

#### Target

Future work can add tests or update verification matrices without producing duplicate contracts for the same behavior.

#### Acceptance

- A missing direct test does not by itself justify a new capability spec.
- A coverage artifact names the owning capability spec and the missing evidence type.
- Existing test matrices remain the traceability target for future implementation work.

#### Scenario: A behavior is specified but weakly tested

- GIVEN a requirement is present in an owning capability spec
- AND current tests do not cover it directly
- WHEN the source-spec process finds the gap
- THEN it records the gap as verification work
- AND does not create a second behavior spec for the same requirement.

## Coverage Decision

No new product capability spec was created in this run. The current code remains the source of truth, and the current spec tree already names every `src/` and `scripts/` path. This artifact is the single output for the run because a duplicate capability spec would reduce clarity.

## Success Criteria

- [x] SC-001: `GLOSSARY.md` and project instructions were read before writing this artifact.
- [x] SC-002: The current `docs/specs/` inventory was inspected before deciding against a new capability spec.
- [x] SC-003: Current source and test inventories were inspected without changing source code.
- [x] SC-004: The artifact lives under `docs/specs/coverage/` because it is a gap/decision analysis.
- [x] SC-005: No Docker worker, gateway restart, browser run, source edit, or extra cron job was used.

## Verification Basis

This analysis is based on the current workspace files and inventories:

- `GLOSSARY.md`
- `AGENTS.md`
- full `docs/specs/` file inventory and heading scan
- path-reference scan of `src/**/*.ts` and `src/**/*.tsx` against `docs/specs/**/*.md`
- path-reference scan of checked-in `scripts/*` against `docs/specs/**/*.md`
- workflow package path-reference scan under `packages/workflows/src/`
- current root `test/*.test.mjs` inventory
- `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`
- `docs/specs/coverage/direct-source-path-coverage-closure-2026-05-11.md`
- `docs/specs/coverage/unreferenced-artifact-triage-2026-05-11.md`
