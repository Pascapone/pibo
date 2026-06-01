# Coverage Analysis: Source Test Gap Priorities 2026-05-11

**Status:** Draft  
**Created:** 2026-05-11  
**Updated:** 2026-05-11  
**Owner / Source:** Scheduled Pibo Source Specs Coverage; current workspace code and specs  
**Related docs:** `docs/specs/capabilities/spec-status-and-traceability.md`, `docs/specs/coverage/test-traceability-coverage-2026-05-10.md`, `docs/specs/coverage/cli-discovery-coverage-2026-05-11.md`, `docs/specs/capabilities/continuous-ralph-jobs.md`, `docs/specs/capabilities/chat-web-projects-area.md`, `docs/specs/capabilities/chat-web-safe-content-rendering.md`

## Why

The current `docs/specs/` tree now covers the main Pibo product capabilities: routing, profiles, Chat Web, data stores, gateway lifecycle, tools, jobs, Ralph, workflow, deployment, auth, and validation. Creating another broad capability spec would risk duplicating existing contracts.

The more useful next step is to identify source-backed behavior that is already specified but still weakly verified. This keeps the code as the source of truth while giving future implementation runs a focused test-priority map.

## Goal

Future coverage work SHOULD convert the highest-value source-inspected requirements into direct tests before adding duplicate capability specs.

## Scope

### In Scope

- Current capability specs under `docs/specs/capabilities/`.
- Current coverage analyses under `docs/specs/coverage/`.
- Current source and tests under `src/` and `test/`.
- Requirements that are behaviorally specified but still marked pending, source-inspected, partial, or weakly tested.

### Out of Scope

- Changing source code or tests in this scheduled run.
- Rewriting existing capability specs.
- Treating legacy documents as truth over source code.
- Docker, gateway, or browser execution.

## Current Coverage State

| Area | Existing spec coverage | Current verification weakness | Priority |
|---|---|---|---|
| Continuous Ralph jobs | `continuous-ralph-jobs.md` | No focused `test/*.test.mjs` coverage found for store, service, API, CLI, or UI behavior. | High |
| Chat Web Projects | `chat-web-projects-area.md` | Only workflow-link child-session behavior has a focused direct test; store CRUD and HTTP bootstrap/message paths are source-inspected. | High |
| CLI discovery parity | `operator-cli-discovery-and-dispatch.md`, `cli-discovery-coverage-2026-05-11.md` | Compute, skills, Ralph, data, gateway, cron, profile, TUI, and web-gateway help surfaces lack direct discovery assertions. | High |
| Settings and provider UI | `chat-web-settings-area.md`, `model-provider-auth-and-session-selection.md` | Browser-local settings, provider panel blocked state, stale model display, and owner-scoped timezone mutation lack focused UI/API tests. | Medium |
| OpenAI Codex provider usage | `model-provider-auth-and-session-selection.md` | Device login is directly tested, but browser PKCE, pending-state mismatch/expiry, and usage normalization are mostly source-inspected. | Medium |
| Safe content rendering | `chat-web-safe-content-rendering.md` | Markdown URL safety, raw HTML skipping, JSON fallback, and compact-terminal detail normalization are specified but not directly tested. | Medium |
| Browser-use auth leases | `browser-use-authenticated-leases.md` | Lease copy, lock, running-template rejection, warm-up warning, release, and reap behavior are partly covered through CLI tests but not exhaustively verified. | Medium |
| Project/data service HTTP integration | `pibo-data-store-and-ingestion.md`, `chat-web-rooms-and-event-streams.md` | V2 service units are tested, but higher-level Chat Web HTTP routes through v2-native services remain mostly source-inspected. | Medium |
| Web deployment scripts | `web-deployment-scripts.md` | Script behavior is specified from source but has no direct shell-level validation in the current test inventory. | Low |

## Follow-up Coverage Decision: Test-Matrix Specs Are Now the Limiting Artifact

A follow-up scan in this scheduled run found that the highest-priority documentation-only gaps from this table now have source-backed test matrices inside their owning capability specs:

- `continuous-ralph-jobs.md` now contains a verification coverage section and a recommended Ralph store, service, API, CLI, and UI test matrix.
- `chat-web-projects-area.md` now contains a verification coverage section and a Projects store, API, message, patch, and route test matrix.
- `chat-web-safe-content-rendering.md` now contains renderer-specific safety, JSON, inline-terminal, and detail-panel test cases.

Future source-spec runs SHOULD NOT create new duplicate capability specs for these three areas unless new source behavior lands. The next useful work is to implement or tighten direct tests against the listed matrices, then mark the relevant success criteria from unchecked to checked.

### Acceptance for future continuation

- A future Ralph-focused documentation run updates `continuous-ralph-jobs.md` only when current source adds or changes behavior; otherwise it should add tests instead of prose.
- A future Projects-focused documentation run updates `chat-web-projects-area.md` only when Projects source behavior changes; otherwise it should add store/API/route tests from the matrix.
- A future renderer-safety documentation run updates `chat-web-safe-content-rendering.md` only when renderer source behavior changes; otherwise it should add component or browser-independent tests from the matrix.
- If all source behavior remains unchanged and tests are still absent, a future coverage artifact should report test execution readiness instead of restating the same missing tests.

## Findings

### Finding: Ralph is the largest implemented capability without focused tests

Ralph has a complete behavior spec and substantial source surface under `src/ralph/*`, `src/apps/chat/ralph-api.ts`, and `src/apps/chat-ui/src/RalphArea.tsx`. Current test inventory does not include a Ralph-focused test file.

#### Acceptance for future improvement

- Add an isolated `test/ralph-store.test.mjs` for validation, owner filtering, reservation, stop/cancel state, max-iteration blocking, and interrupted-run recovery.
- Add a service test with a fake channel context for session metadata, message correlation, timeout, promise-complete, and cancel abort behavior.
- Add API tests for same-origin JSON, room access, personal target ownership, unknown profile rejection, and start/stop/cancel paths.

### Finding: Projects behavior is specified broadly but tested narrowly

The Projects spec now matches current code, but the only focused direct test found is `test/project-service-workflow-link.test.mjs`. Store CRUD, bootstrap empty-state behavior, project message idempotency, and route separation remain source-inspected.

#### Acceptance for future improvement

- Add store tests for Personal Project idempotency, duplicate name/folder rejection, archive-before-delete, and Project Session archive filtering.
- Add web-app route tests for `simple-chat` session creation, unsupported workflow rejection, bootstrap empty-state selection, and Project message deduplication.
- Add a route-parser or UI integration test for `/projects/:projectId/sessions/:piboSessionId`.

### Finding: Progressive CLI discovery is strong in core tools and weak in newer command families

Root, config, MCP, tools, pi-packages, and debug discovery have direct tests. Newer or more operational families are still mostly source-inspected.

#### Acceptance for future improvement

- Add one built-CLI discovery assertion each for `pibo compute --help`, `pibo skills --help`, `pibo ralph --help`, `pibo data --help`, `pibo gateway --help`, and `pibo cron --help`.
- Each assertion should check one next-step command and one absence condition that prevents deep, noisy output.
- Discovery tests must not start Docker, mutate live stores, or restart gateways.

### Finding: UI rendering safety deserves focused component-level tests

The safe rendering spec captures concrete contracts for raw HTML, markdown URL protocols, JSON fallback, and terminal detail parsing. These are high-risk browser behaviors because model and tool output are untrusted.

#### Acceptance for future improvement

- Add component tests for `MarkdownRenderer` covering skipped raw HTML and rejected `javascript:` links.
- Add component tests for `JsonRenderer` covering object input, JSON-like strings, invalid JSON-like text, and scalar fallback.
- Add compact-terminal tests for inline argument collapse and status-prefixed JSON detail parsing.

## Recommended Next Scheduled Runs

1. Prefer direct tests for Ralph, Projects, and renderer safety using the matrices now present in their owning capability specs.
2. Add CLI discovery parity rows or tests for weak command families rather than writing another broad CLI spec.
3. For settings/provider UI and OpenAI Codex usage, update the owning specs only if current source behavior has changed; otherwise add focused API or normalization tests.
4. If no code behavior has changed, create only a short coverage continuation note that references this artifact instead of duplicating the same test-gap list.

## Success Criteria

- [x] This artifact is under `docs/specs/coverage/` because it is a gap analysis, not a duplicate capability contract.
- [x] It inspected the current `docs/specs/` inventory before naming gaps.
- [x] It uses current source and test inventory as its verification basis.
- [x] It identifies testable future work without changing source code or spawning Docker.
- [x] Follow-up edits name the existing capability specs that now hold detailed test matrices instead of creating duplicate capability specs.

## Verification Basis

This analysis is based on current workspace files and inventories, especially:

- `GLOSSARY.md`
- `AGENTS.md`
- `docs/specs/` file inventory
- `docs/specs/capabilities/continuous-ralph-jobs.md`
- `docs/specs/capabilities/chat-web-projects-area.md`
- `docs/specs/capabilities/chat-web-settings-area.md`
- `docs/specs/capabilities/model-provider-auth-and-session-selection.md`
- `docs/specs/capabilities/chat-web-safe-content-rendering.md`
- `docs/specs/capabilities/browser-use-authenticated-leases.md`
- `docs/specs/coverage/cli-discovery-coverage-2026-05-11.md`
- `src/ralph/*`
- `src/apps/chat/ralph-api.ts`
- `src/apps/chat/data/project-service.ts`
- `src/apps/chat/web-app.ts`
- `src/apps/chat-ui/src/RalphArea.tsx`
- `src/apps/chat-ui/src/App.tsx`
- `src/apps/chat-ui/src/tracing/*`
- current `test/*.test.mjs` inventory
