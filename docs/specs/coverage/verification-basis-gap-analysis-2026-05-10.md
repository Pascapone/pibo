# Coverage Analysis: Verification Basis Gaps

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code and `docs/specs/`
**Related docs:** [Spec Status and Traceability](../capabilities/spec-status-and-traceability.md), [Source Specs Coverage Snapshot](./source-specs-coverage-2026-05-10.md), [Test Traceability Across Source Specs](./test-traceability-coverage-2026-05-10.md)

## Why

The current source tree is broadly covered by behavior specs. The next important gap is not a missing product capability but uneven evidence inside existing specs. Some specs state behavior and traceability but do not name the source files or tests that verified those requirements during source-spec coverage.

This matters because scheduled source-spec work treats the current code as the single source of truth. Future agents need a quick way to identify which specs are source-backed, which need test pointers, and which artifacts are intentionally plans rather than implemented behavior contracts.

## Scope

### In Scope

- Durable specs under `docs/specs/`.
- Whether each spec has `Status`, `Success Criteria`, `Traceability`, and `Verification Basis` sections.
- Current test files under `test/` that can support future verification-basis updates.
- Prioritization for future source-spec runs.

### Out of Scope

- Changing existing specs in this run.
- Source-code or test changes.
- Legacy documents outside `docs/specs/`.
- Reclassifying roadmap/change artifacts as implemented source-backed specs.

## Current State

Most capability specs include behavior-first requirements, scenarios, success criteria, and traceability. Many newer specs also include a `Verification Basis` section that lists inspected source files and tests.

A focused scan of `docs/specs/` found these current gaps:

| Artifact | Gap | Priority | Rationale |
|---|---|---:|---|
| `docs/specs/capabilities/scheduled-pibo-jobs.md` | Missing `Verification Basis` | High | Scheduled jobs are active product behavior and have dedicated cron source and tests. |
| `docs/specs/capabilities/docker-compute-workers.md` | Missing `Verification Basis` | High | Project instructions require Docker workers for Pibo development; the spec should name CLI/source evidence. |
| `docs/specs/capabilities/plugin-registry-and-capability-catalog.md` | Missing `Verification Basis` | High | Many capabilities depend on plugin registration and catalog behavior. |
| `docs/specs/capabilities/local-config-cli.md` | Missing `Verification Basis` | Medium | Config behavior is important but already backed by focused tests. |
| `docs/specs/capabilities/chat-web-static-shell-and-pwa-assets.md` | Missing `Verification Basis` | Medium | Static assets and PWA behavior should name web app source and web-channel tests. |
| `docs/specs/capabilities/mcp-registry-python-runtimes.md` | Missing `Verification Basis` | Medium | MCP registry install behavior should identify source evidence and current test coverage. |
| `docs/specs/spec-product-projects-area.md` | Missing `Verification Basis`; path is outside `capabilities/` | Medium | Projects are implemented behavior, but the spec path and evidence format are inconsistent with current conventions. |
| `docs/specs/changes/pibo-workflow-system-v1/spec.md` | Missing `Verification Basis` | Low | This is a change spec/proposal area, so verification may remain plan-oriented until implementation exists. |
| `docs/specs/changes/pibo-workflow-system-v1/{proposal,design,tasks}.md` | Not shaped like capability specs | Low | These are supporting change artifacts and do not need full capability metadata unless promoted. |
| `docs/specs/README.md` | Not a behavior spec | None | README files do not need spec template sections. |

## Recommended Next Work

### Gap: Source-backed specs without verification basis

Future scheduled runs should update one high-priority existing capability spec at a time when adding `Verification Basis` is clearer than writing a new capability spec.

Acceptance for each update:

- The spec names the source files inspected for each major behavior family.
- The spec names current tests where they exist.
- The spec explicitly says when an acceptance check is source-inspected but not directly tested.
- Traceability status remains requirement-level, not whole-spec-level.

Suggested first candidates:

1. `docs/specs/capabilities/scheduled-pibo-jobs.md`
2. `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`
3. `docs/specs/capabilities/docker-compute-workers.md`

### Gap: Implemented project behavior spec path is inconsistent

`docs/specs/spec-product-projects-area.md` describes implemented Chat Web Projects behavior, but it does not follow the dominant `docs/specs/capabilities/<capability>.md` layout.

Acceptance for a future cleanup:

- Either move or supersede it with `docs/specs/capabilities/chat-web-projects-area.md`.
- Keep the same behavior requirements unless current code inspection shows changes.
- Add `Verification Basis` with project service, Chat Web API/UI, and integration-test evidence.
- Avoid creating a duplicate Projects spec while both files exist.

### Gap: Change specs need a distinct verification rule

The workflow system artifacts are proposal/design/task documents. They should not be forced to cite implementation tests before the feature exists, but they should still say how future implementation will be verified.

Acceptance for future change-spec convention work:

- Change specs distinguish `Implementation Evidence` from `Planned Verification`.
- Proposal/design/task files are exempt from capability-template sections unless they claim implemented behavior.
- Once implemented, durable workflow behavior moves into a capability spec or the change spec gains source-backed verification.

## Success Criteria for This Analysis

- [x] It inspected the full `docs/specs/` file list before identifying gaps.
- [x] It avoided creating a duplicate behavior spec for already covered source areas.
- [x] It identified a concrete next action for future scheduled runs.
- [x] It stayed under `docs/specs/coverage/` because the remaining issue is coverage quality, not an uncovered capability.

## Verification Basis

This analysis is based on:

- `GLOSSARY.md`
- `AGENTS.md`
- `docs/specs/README.md`
- Full `docs/specs/` inventory from `find docs/specs -type f`
- Section scan for `Status`, `Success Criteria`, `Traceability`, and `Verification Basis`
- Current source/test inventory under `src/` and `test/`, especially cron, plugin registry, Docker compute, config, Chat Web assets, MCP registry, and Projects-related files.
