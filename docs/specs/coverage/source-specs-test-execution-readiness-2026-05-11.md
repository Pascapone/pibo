# Coverage Analysis: Source Specs Test Execution Readiness 2026-05-11

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code and specs
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, [Direct Source Path Coverage Closure](./direct-source-path-coverage-closure-2026-05-11.md), [Source Test Gap Priorities](./source-test-gap-priorities-2026-05-11.md), [Continuous Ralph Jobs](../capabilities/continuous-ralph-jobs.md), [Chat Web Projects Area](../capabilities/chat-web-projects-area.md), [Chat Web Safe Content Rendering](../capabilities/chat-web-safe-content-rendering.md)

## Why

The current source tree is already broadly represented in `docs/specs/`. A new capability spec in this run would duplicate existing contracts for routing, Chat Web, data stores, gateways, tools, jobs, Ralph, Projects, workflows, auth, and deployment.

The next useful source-spec artifact is a readiness contract for future verification work: which source-backed specs are ready to turn into tests without more prose, and when a future scheduled documentation run should stop instead of restating the same gaps.

## Goal

Future source-spec runs SHOULD create or update prose only when source behavior changes; otherwise they SHOULD use the existing test matrices as implementation-ready verification backlogs.

## Scope

### In Scope

- Current `docs/specs/` inventory.
- Current source and test inventories under `src/`, `packages/workflows/`, `scripts/`, and `test/`.
- Existing source-backed specs with detailed verification matrices.
- Documentation-only decision criteria for future scheduled source-spec runs.

### Out of Scope

- Source-code changes.
- Test implementation.
- Docker workers, browser automation, gateway restarts, or live-store mutation.
- Legacy documents as truth over current source.

## Current State

The current coverage artifacts report that direct source-path coverage is closed for `src/**/*.ts`, `src/**/*.tsx`, and checked-in `scripts/` files. The remaining high-value gaps are not missing capability descriptions. They are missing direct tests for already specified behavior.

Three high-priority areas now have enough behavior detail to implement tests directly:

1. `continuous-ralph-jobs.md` defines Ralph store, service, API, CLI, and UI behavior plus a recommended test matrix.
2. `chat-web-projects-area.md` defines Projects store, bootstrap, Project Session, message, patch, workflow-link, and route behavior plus a recommended test matrix.
3. `chat-web-safe-content-rendering.md` defines markdown safety, safe links, JSON fallback, inline terminal JSON, and terminal detail parsing plus a recommended test matrix.

## Requirements

### Requirement: Do not duplicate covered capabilities

Future source-spec runs MUST NOT create a new capability spec for a behavior area that already has a current source-backed capability spec unless current source adds materially new behavior.

#### Acceptance

- Ralph prose work references `continuous-ralph-jobs.md` unless Ralph source changes.
- Projects prose work references `chat-web-projects-area.md` unless Projects source changes.
- Renderer-safety prose work references `chat-web-safe-content-rendering.md` unless renderer source changes.
- New files under `src/`, `packages/workflows/`, or `scripts/` trigger a fresh owning-spec check before creating a new spec.

### Requirement: Treat existing test matrices as executable backlogs

The existing test matrices SHOULD be treated as ready-to-implement verification work rather than as prompts for more documentation.

#### Acceptance

- A future Ralph run should implement or request `test/ralph-store.test.mjs`, `test/ralph-service.test.mjs`, `test/chat-ralph-api.test.mjs`, or `test/ralph-cli.test.mjs` before expanding Ralph prose.
- A future Projects run should implement or request store/API/route tests from the Projects matrix before expanding Projects prose.
- A future renderer-safety run should implement or request component tests from the renderer matrix before expanding renderer prose.
- If documentation is still required, it should update the owning spec's verification status after tests land.

### Requirement: Coverage notes stay short and decision-oriented

When no source behavior has changed and no new source files exist, a scheduled documentation run SHOULD write at most one short coverage note that records the decision not to duplicate specs.

#### Acceptance

- The note names the inspected specs and source areas.
- The note states why no new capability spec was created.
- The note points to the next useful verification action.
- The note does not restate full test matrices already present in owning specs.

## Success Criteria

- [x] SC-001: This artifact lives under `docs/specs/coverage/` because it is a coverage decision, not a new product capability.
- [x] SC-002: Existing specs were inspected before creating this artifact.
- [x] SC-003: The artifact identifies the next useful work without duplicating existing capability specs.
- [x] SC-004: No source code, tests, gateway processes, cron jobs, or Docker workers were changed.

## Traceability

| Decision | Source basis | Next action | Status |
|---|---|---|---|
| Do not create another Ralph capability spec | `src/ralph/*`, `src/apps/chat/ralph-api.ts`, `src/apps/chat-ui/src/RalphArea.tsx`, `continuous-ralph-jobs.md` | Implement focused Ralph tests from the existing matrix | Ready for tests |
| Do not create another Projects capability spec | `src/apps/chat/data/project-service.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/App.tsx`, `chat-web-projects-area.md` | Implement Projects store/API/route tests from the existing matrix | Ready for tests |
| Do not create another renderer-safety capability spec | `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx`, `JsonRenderer.tsx`, compact-terminal renderers, `chat-web-safe-content-rendering.md` | Implement browser-independent renderer/component tests | Ready for tests |
| Keep future coverage notes decision-oriented | Current `docs/specs/coverage/` inventory | Add prose only for new or changed source behavior | Active |

## Verification Basis

This coverage decision is based on current workspace inspection of:

- `GLOSSARY.md`
- `AGENTS.md`
- full `docs/specs/` file inventory
- `docs/specs/coverage/direct-source-path-coverage-closure-2026-05-11.md`
- `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`
- `docs/specs/capabilities/continuous-ralph-jobs.md`
- `docs/specs/capabilities/chat-web-projects-area.md`
- `docs/specs/capabilities/chat-web-safe-content-rendering.md`
- current `src/`, `packages/workflows/`, `scripts/`, and `test/` inventories
