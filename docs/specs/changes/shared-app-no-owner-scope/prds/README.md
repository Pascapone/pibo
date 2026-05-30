# PRD Catalog: Shared App Without Owner Scope

**Status:** Draft  
**Created:** 2026-05-29  
**Source change:** `docs/specs/changes/shared-app-no-owner-scope/`

This directory turns the shared-app change spec into implementation-grade PRDs and a Ralph-ready story batch.

## Source Documents

- `../proposal.md`
- `../spec.md`
- `../design.md`
- `../tasks.md`
- `../../../../plans/no-owner-scope-shared-app-umbauplan-2026-05-28.md`

## PRDs

| PRD | Scope | Ralph JSON |
|---|---|---|
| `shared-app-no-owner-scope-prd.md` | Complete product requirements, acceptance criteria, verification gates, rollout, and risks | `shared-app-no-owner-scope.prd.json` |

## Ralph Execution Readiness

Ralph can start from `shared-app-no-owner-scope.prd.json` after a clean branch/worktree and Docker worker are prepared. The story batch is ordered by dependency:

1. Baseline inventory and regression gates.
2. Shared app auth contract.
3. Chat sessions, rooms, navigation, and read-state.
4. Shared resources: agents, projects, workflows, annotations, settings, and workspace assumptions.
5. Automation: Ralph, Cron, yielded runs, and scheduled work.
6. Migration dry-run, backup, mutation, and schema cleanup.
7. Docs, product copy, deployment validation, and PR readiness.

Each story requires typecheck/build or focused tests. User-facing integration stories require real-path validation where feasible.

## Global Completion Rule

The change is not done while active product code still uses account-derived owner/principal values to decide visibility, routing, workspace selection, profile registration, job control, or write location. Remaining owner/principal references must be confined to explicitly marked legacy migration/debug evidence or archived documentation.
