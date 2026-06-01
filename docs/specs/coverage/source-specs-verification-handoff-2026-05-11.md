# Coverage Analysis: Source Specs Verification Handoff 2026-05-11

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage; current workspace code and specs
**Related docs:** [Direct Source Path Coverage Closure](./direct-source-path-coverage-closure-2026-05-11.md), [Source Test Gap Priorities](./source-test-gap-priorities-2026-05-11.md), [Spec Status and Traceability](../capabilities/spec-status-and-traceability.md), [Project Validation Harness](../capabilities/project-validation-harness.md)

## Why

The current `docs/specs/` tree already names every current TypeScript source file under `src/` and every checked-in support script under `scripts/`. Adding another broad capability spec in this run would duplicate existing behavior contracts.

The useful next artifact is a handoff from source-spec coverage to verification work. Future scheduled source-spec runs need a rule for when to write more docs, when to update an owning spec, and when to stop writing prose and add tests instead.

## Goal

Future source-spec coverage work SHOULD create or update specs only for changed or uncovered behavior, and SHOULD treat unchanged, already specified behavior as ready for direct test implementation rather than more duplicate documentation.

## Scope

### In Scope

- Current markdown specs under `docs/specs/`.
- Current source files under `src/`.
- Current checked-in scripts under `scripts/`.
- Current Node test inventory under `test/`.
- Verification-readiness decisions for already specified behavior.

### Out of Scope

- Source-code or test-code changes in this scheduled run.
- Docker workers, gateway restarts, browser checks, or deployment.
- Legacy documents as a source of truth against current code.
- Repeating the detailed requirement text already present in capability specs.

## Current Coverage State

A direct path-reference scan found:

| Area | Current count | Directly referenced by `docs/specs/**/*.md` | Decision |
|---|---:|---:|---|
| `src/**/*.ts` and `src/**/*.tsx` | 220 | 220 | Closed until source files change |
| checked-in `scripts/*` | 7 | 7 | Closed until scripts change |
| `test/*.test.mjs` | 49 | Used as verification inventory | Improve traceability through owning specs |

The remaining coverage work is no longer path discovery. It is verification depth: converting requirements marked `Pending`, `Partial`, or `Source-inspected only` into direct tests.

## Requirements for Future Scheduled Runs

### Requirement: New prose requires changed or uncovered behavior

Future scheduled source-spec runs MUST NOT create another capability spec for an unchanged behavior area that already has an owning spec.

#### Current

Coverage analyses now show direct source-path closure and identify existing owning specs for major seams such as Ralph, Projects, provider auth, safe rendering, CLI discovery, data services, signals, gateway lifecycle, tools, jobs, and Chat Web state.

#### Acceptance

- If new source files are added, the run either updates the owning spec or creates one new spec for the new behavior.
- If no source behavior changed and an owning spec exists, the run writes at most a short coverage note instead of a duplicate capability spec.
- The coverage note names the owning spec and the exact verification gap.

#### Scenario: Ralph source is unchanged

- GIVEN `continuous-ralph-jobs.md` still matches current `src/ralph/*` behavior
- WHEN a scheduled source-spec run examines Ralph again
- THEN it does not create a second Ralph capability spec
- AND it either adds tests from the existing Ralph matrix or records that tests remain the next step.

### Requirement: Owning specs remain the traceability target

Future verification work MUST attach new tests to the existing owning spec instead of scattering duplicate matrices across coverage files.

#### Current

Several capability specs already include verification sections and recommended test matrices. Coverage files identify which owning spec should receive future requirement-status updates.

#### Acceptance

- New Ralph tests update traceability in `continuous-ralph-jobs.md`.
- New Projects tests update traceability in `chat-web-projects-area.md`.
- New provider-auth tests update traceability in `model-provider-auth-and-session-selection.md`.
- New safe-rendering tests update traceability in `chat-web-safe-content-rendering.md`.
- New CLI discovery tests update traceability in `operator-cli-discovery-and-dispatch.md` or the relevant command-family spec.

#### Scenario: Provider usage normalization test is added

- GIVEN a future change adds `test/openai-codex-usage.test.mjs`
- WHEN documentation is updated
- THEN `model-provider-auth-and-session-selection.md` records the requirement as directly tested
- AND no new provider-usage capability spec is created.

### Requirement: Test readiness is judged by behavior, not file count

Future runs SHOULD prioritize the highest-risk source-inspected behaviors even when every source file is already referenced by a spec.

#### Current

The test inventory has broad coverage for stores, routing, gateway, MCP, model defaults, login device flow, data ingestion, signals, and plugin registry behavior. It remains weaker for continuous Ralph service/API/UI behavior, selected Projects HTTP flows, some provider-auth edge cases, safe rendering component behavior, and newer CLI discovery branches.

#### Acceptance

- A requirement marked `Source-inspected only` is treated as a test candidate when it touches auth, stewardship, data deletion, external credentials, untrusted rendering, routing, or gateway control.
- A requirement marked `Covered` is not retested solely to increase file-count coverage.
- Verification work uses isolated stores and built artifacts where the validation harness requires them.

#### Scenario: Safe renderer remains source-inspected

- GIVEN `chat-web-safe-content-rendering.md` specifies markdown URL filtering and raw HTML skipping
- WHEN future coverage work chooses the next verification target
- THEN component or renderer tests are preferred over another prose-only safe-rendering document.

### Requirement: Coverage notes stay concise and non-normative

Coverage artifacts MUST identify gaps and handoffs without overriding the behavior contracts in capability specs.

#### Current

The project separates capability specs from coverage analyses. Capability specs define durable behavior. Coverage analyses document inventory state, source-reference closure, and verification gaps.

#### Acceptance

- A coverage note links to the owning spec rather than restating full requirements.
- If coverage and source disagree, source plus the owning spec review wins over the coverage note.
- Coverage notes do not introduce behavior that is absent from current source.

#### Scenario: Source behavior changes after this handoff

- GIVEN a future commit changes Projects deletion behavior
- WHEN a scheduled spec run inspects the code
- THEN it updates `chat-web-projects-area.md` for the new behavior
- AND treats this handoff only as historical coverage context.

## Recommended Verification Handoff Queue

| Priority | Area | Owning spec | Next non-duplicate action |
|---|---|---|---|
| High | Continuous Ralph jobs | `docs/specs/capabilities/continuous-ralph-jobs.md` | Add isolated store/service/API tests from the existing matrix |
| High | Chat Web Projects | `docs/specs/capabilities/chat-web-projects-area.md` | Add store and HTTP-route tests for CRUD, bootstrap, message, and route behavior |
| High | CLI discovery parity | `docs/specs/capabilities/operator-cli-discovery-and-dispatch.md`; `docs/specs/coverage/cli-discovery-coverage-2026-05-11.md` | Add built-CLI help assertions for newer command families |
| Medium | Provider auth and usage | `docs/specs/capabilities/model-provider-auth-and-session-selection.md` | Add PKCE, state-expiry, runtime-validation, and usage-normalization tests |
| Medium | Safe content rendering | `docs/specs/capabilities/chat-web-safe-content-rendering.md` | Add renderer/component tests for raw HTML, URLs, JSON fallback, and terminal details |
| Medium | Browser-use auth leases | `docs/specs/capabilities/browser-use-authenticated-leases.md` | Add focused lease lifecycle tests where feasible without live browser dependence |

## Success Criteria

- [x] SC-001: The run inspected `GLOSSARY.md`, project instructions, the full `docs/specs/` inventory, current source paths, and current test inventory.
- [x] SC-002: No duplicate capability spec was created for behavior that already has an owning spec.
- [x] SC-003: The artifact records that direct source-path coverage for current `src/` and `scripts/` files is closed.
- [x] SC-004: The artifact gives future runs a testable decision rule for docs-vs-tests handoff.
- [x] SC-005: No source code, tests, cron jobs, Docker workers, gateways, or deployments were changed.

## Verification Basis

This coverage handoff is based on current workspace files and inventories:

- `GLOSSARY.md`
- `AGENTS.md`
- complete `docs/specs/` file inventory
- direct path-reference scan of `src/**/*.ts` and `src/**/*.tsx` against `docs/specs/**/*.md`
- direct path-reference scan of checked-in `scripts/*` against `docs/specs/**/*.md`
- `test/*.test.mjs` inventory
- `package.json` validation scripts
- `docs/specs/coverage/direct-source-path-coverage-closure-2026-05-11.md`
- `docs/specs/coverage/source-test-gap-priorities-2026-05-11.md`
- representative owning capability specs for Ralph, Projects, provider auth, safe rendering, CLI discovery, browser-use leases, and validation harness behavior
