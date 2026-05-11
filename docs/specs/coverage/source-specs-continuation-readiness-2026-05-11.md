# Coverage Analysis: Source Specs Continuation Readiness 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code and spec inventory  
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Direct Source Path Coverage Closure](./direct-source-path-coverage-closure-2026-05-11.md), [Source Test Gap Priorities](./source-test-gap-priorities-2026-05-11.md), [Residual Source Islands](./residual-source-islands-2026-05-11.md)

## Why

This scheduled run inspected the current spec tree before adding more prose. The existing capability specs already cover the main current Pibo product and technical surfaces, and the coverage artifacts now identify the remaining weak points as verification work rather than missing behavior contracts.

Creating another broad capability spec in this run would duplicate current source-backed specs. This continuation note records the current decision boundary for future scheduled runs: write or update a capability spec only when source behavior has changed or when a specific existing spec lacks an observable requirement.

## Goal

Future source-spec runs SHOULD use the current docs/specs tree as a coverage baseline, avoid duplicate capability specs, and focus next on source changes, stale requirements, or direct-test readiness gaps.

## Scope

### In Scope

- Current `docs/specs/` inventory.
- Current source surfaces under `src/`, `packages/`, `scripts/`, and `test/` inspected at inventory level.
- Existing coverage decisions for source-path closure, residual helper seams, and weak verification areas.

### Out of Scope

- Source-code, test-code, build, gateway, browser, or Docker changes.
- Repeating full capability requirements already owned by existing specs.
- Treating legacy documents as source of truth over current code.

## Findings

### Finding: Capability coverage is currently more complete than verification coverage

The spec inventory contains durable capability specs for routing, sessions, stores, gateway lifecycle, Chat Web, auth, profiles, tools, MCP, cron, Ralph, workflows, deployment, signals, and local/operator CLIs. Coverage artifacts also record that current `src/` and checked-in `scripts/` paths are directly referenced by specs or coverage notes.

#### Acceptance for future runs

- New capability specs should be created only for a new or newly discovered behavior boundary.
- Existing capability specs should be extended when source changes affect their current contracts.
- If no source behavior changed, a run should add at most a short coverage note or no-op handoff, not restate existing requirements.

### Finding: The next valuable work is direct verification, not more prose

The current highest-value gaps are already named in `source-test-gap-priorities-2026-05-11.md`: Ralph tests, Projects tests, newer CLI discovery parity, settings/provider UI, OpenAI Codex usage normalization, and safe content rendering tests.

#### Acceptance for future runs

- A future documentation-only scheduled run should not duplicate those test gaps unless the current source or tests changed.
- A future implementation run should prefer focused tests in `test/*.test.mjs` or browser-independent UI tests for the named gaps.
- When tests land, the owning capability specs should update their Verification Coverage sections and Success Criteria.

### Finding: Current uncommitted docs do not require source-spec merging work in this run

The workspace contains many uncommitted `docs/specs/` changes from prior scheduled coverage work. This run avoids editing those existing files to reduce conflict risk and creates one focused continuation artifact instead.

#### Acceptance for future runs

- Future scheduled jobs should read the full spec inventory, including uncommitted docs, before deciding whether a gap remains.
- If a future job finds two specs with the same behavior owner, it should create a coverage triage note or consolidate only with explicit user approval.

## Success Criteria

- [x] SC-001: `GLOSSARY.md` and project instructions were read before writing this artifact.
- [x] SC-002: The full `docs/specs/` file inventory was inspected before choosing a coverage artifact.
- [x] SC-003: This artifact lives under `docs/specs/coverage/` because it is a gap/continuation analysis, not a duplicate capability spec.
- [x] SC-004: The artifact names the current next useful work without changing source code or tests.
- [x] SC-005: No Docker worker, gateway restart, cron job creation, build, or browser run was performed.

## Verification Basis

This analysis is based on the current workspace files and inventories:

- `GLOSSARY.md`
- `AGENTS.md`
- complete `docs/specs/` file inventory
- `docs/specs/coverage/direct-source-path-coverage-closure-2026-05-11.md`
- `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`
- `docs/specs/coverage/residual-source-islands-2026-05-11.md`
- source inventory under `src/`, `packages/`, `scripts/`, and `test/`
- `git status --short` for workspace-change awareness
