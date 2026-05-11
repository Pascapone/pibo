# Coverage Analysis: Source Specs Gap Analysis 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code  
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, `docs/specs/coverage/source-specs-coverage-2026-05-10.md`, `docs/specs/coverage/test-traceability-coverage-2026-05-10.md`

## Why

The current `docs/specs/` tree now covers the major Pibo source areas and several recent additions, including Projects, Workflow framework code, standalone Docker runtime, Ralph jobs, PWA icon generation, validation harness behavior, and Workflow session views. A new capability spec in this run would likely duplicate an existing contract.

This analysis records the remaining weak spots found after inspecting the current spec tree and representative code. It gives future scheduled runs concrete, non-duplicative targets.

## Goal

Future source-spec runs SHALL improve weak verification and ownership coverage before adding overlapping capability specs for already covered product areas.

## Scope

### In Scope

- Current files under `docs/specs/`.
- Current source and test inventories under `src/`, `packages/workflows/`, `scripts/`, and `test/`.
- Gaps that can become one focused spec update or one focused coverage artifact in a later run.

### Out of Scope

- Source-code or test changes.
- Legacy documents as authority over current code.
- Rewriting existing specs only to change style.
- Creating duplicate behavior specs for areas already covered by current capability specs.

## Current Coverage State

The inspected spec tree includes durable capability specs for the top-level source areas: API, Chat Web, Context Files, auth, CLI, compute workers, config, runtime core, cron, data store, debug CLI, gateway, local TUI, MCP, Pi packages, plugins, reliability, yielded runs, sessions, shared trace code, signals, skills, subagents, curated tools, web search, workflows, Projects, Ralph, standalone Docker runtime, package/build behavior, and project validation.

The current source tree also includes focused tests for many of those areas, including session stores, data ingestion, Chat Web projections, gateway behavior, auth mode selection, cron store behavior, MCP CLI, runtime tools, workflow-linked Project sessions, and signal aggregation.

Because the product behavior surface is broadly specified, the next useful work is to tighten weak or fast-moving contracts rather than add another broad spec.

## Findings and Future Work

### Finding: Workflow and Projects specs are source-backed but still draft-heavy

Recent workspace code adds or exposes `packages/workflows/` and `src/apps/chat/data/project-service.ts`. Current specs cover these areas, but most traceability rows remain `Draft` and many success criteria name expected tests instead of current direct tests.

#### Acceptance for a future run

- A future update to `docs/specs/capabilities/pibo-workflow-framework-package.md` maps each requirement to package-level source files and current package tests or marks it `Source-inspected only`.
- A future update to `docs/specs/capabilities/chat-web-projects-area.md` separates store-tested Project Session behavior from source-inspected web/UI behavior.
- The update does not restate the Workflow System V1 change spec unless the current package code implements that behavior.

### Finding: Dev-auth safety is covered in multiple specs but not easy to audit in one verification row

Dev auth behavior appears in web auth, compute-worker, standalone-Docker, and browser-auth guidance. The code makes three safety claims: normal host gateways cannot enable dev auth by legacy environment variable, explicit dev auth is accepted only inside Docker/runtime guard, and auth-route requests must be loopback by `Host` and `X-Forwarded-Host`.

#### Acceptance for a future run

- One existing auth-related spec cites `test/web-gateway.test.mjs` and `test/dev-auth.test.mjs` together for the dev-auth safety contract.
- The traceability row distinguishes Docker runtime selection from loopback request filtering.
- No standalone dev-auth capability spec is created unless dev auth becomes a supported product mode outside Docker workers.

### Finding: CLI discovery contracts are broad and command-family verification is uneven

The project rule requires progressive CLI discovery. Current specs cover general CLI dispatch and many command families, but traceability is split across command-specific tests and broad operator specs.

#### Acceptance for a future run

- A future coverage artifact lists each command family with its direct test file and whether help output is directly asserted.
- Command-specific specs cite the command-family tests rather than relying on the general operator CLI spec.
- Output examples remain compact and do not copy full help text into every spec.

### Finding: Performance diagnostics are source-backed but not consistently treated as contracts

`bench-signal-registry.mjs` and `scripts/chat-web-performance-check.mjs` support regression investigation. Chat Web scrolling and session signals have behavior specs, but the benchmark script itself remains a diagnostic rather than a product contract.

#### Acceptance for a future run

- If a script is a required release check, its owning capability spec states its required inputs, output shape, and pass/fail threshold.
- If a script is only diagnostic, coverage docs mark it as non-contractual and avoid creating a redundant capability spec.

## Recommended Next Scheduled Runs

1. Extend `docs/specs/capabilities/chat-web-projects-area.md` with a requirement-to-test verification matrix focused on `src/apps/chat/data/project-service.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/App.tsx`, and `test/project-service-workflow-link.test.mjs`.
2. Extend `docs/specs/capabilities/pibo-workflow-framework-package.md` with current package test names or `Source-inspected only` labels per requirement.
3. Add a focused CLI-discovery coverage report under `docs/specs/coverage/` if command-family verification remains hard to audit.
4. Update one auth spec row to cite both dev-auth host-gateway and loopback tests.

## Success Criteria

- [x] This artifact is under `docs/specs/coverage/` because a duplicate capability spec would be lower value.
- [x] It inspected existing specs before naming gaps.
- [x] It treats current code and tests as the source of truth.
- [x] It gives future runs concrete, testable next actions.
- [x] It avoids source-code changes and Docker usage.

## Verification Basis

This analysis is based on the current workspace files:

- `GLOSSARY.md`
- `AGENTS.md`
- full `docs/specs/` file inventory
- `src/apps/chat/data/project-service.ts`
- `src/plugins/dev-auth.ts`
- `src/gateway/web.ts`
- `packages/workflows/src/**`
- `scripts/bench-signal-registry.mjs`
- `scripts/chat-web-performance-check.mjs`
- `test/dev-auth.test.mjs`
- `test/web-gateway.test.mjs`
- `test/project-service-workflow-link.test.mjs`
- current `test/*.test.mjs` inventory
