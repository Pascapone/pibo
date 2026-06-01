# Spec: Spec Status and Traceability

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** `docs/specs/README.md`, `docs/specs/coverage/source-specs-coverage-2026-05-10.md`, `GLOSSARY.md`, `AGENTS.md`

## Why

Pibo uses specs as the durable contract between the current source tree and future implementation work. The current specs are broad, but almost all are marked `Draft`, several implemented source-backed specs lack a verification basis, and traceability rows use mixed status words. That makes it hard for agents to tell whether a spec is exploratory, current behavior, or ready work.

A small status and traceability contract prevents future scheduled coverage runs from creating duplicate specs or treating status labels as decoration.

## Goal

Specs under `docs/specs/` MUST use consistent status, traceability, and verification signals so agents can decide whether to create, update, validate, or ignore a spec.

## Background / Current State

`docs/specs/README.md` states that specs describe intended behavior, interfaces, invariants, and acceptance criteria. The coverage snapshot maps top-level `src/` areas to existing specs and names inconsistent spec status as a remaining gap.

A current inventory of `docs/specs/**/*.md` shows that capability specs generally include requirements and traceability, but all specs are still marked `Draft`, some lack `## Verification Basis`, and no current spec defines what `Draft`, `Approved`, `Implementing`, or `Done` mean for Pibo.

## Scope

### In Scope

- Status meanings for files under `docs/specs/`.
- Required traceability fields for behavior specs.
- Required verification-basis content for source-backed specs.
- Rules for coverage analyses that are not capability specs.
- Agent behavior when a spec conflicts with current code.

### Out of Scope

- Moving existing specs between directories.
- Reclassifying every existing spec status in this cron run.
- Defining implementation-task workflow under `docs/plans/`.
- Treating legacy docs as authoritative over current code.

## Requirements

### Requirement: Status labels have bounded meanings

The specs system MUST define a small status vocabulary and use each status consistently.

#### Current

Most current specs use `Draft` even when they describe implemented behavior from source inspection. The skill template mentions `Draft`, `Approved`, `Implementing`, and `Done`, but the repo does not define their Pibo-specific meaning.

#### Target

- `Draft` means the spec is useful but may still need review, verification mapping, or gap checks.
- `Approved` means maintainers accept the behavior contract as the target.
- `Implementing` means work is actively changing code toward the contract.
- `Done` means current code satisfies the spec's success criteria and verification basis.

#### Acceptance

A reviewer can inspect a spec status and decide whether to implement, review, or validate it without reading unrelated files.

#### Scenario: Implemented behavior remains Draft until verified

- GIVEN a new capability spec is based on source inspection
- AND no explicit validation maps requirements to passing tests or commands
- WHEN the spec is written
- THEN its status remains `Draft` even if the code appears to implement the behavior.

### Requirement: Source-backed specs include a verification basis

A behavior spec that claims current source behavior MUST include a `## Verification Basis` section naming the source files, tests, commands, or manual inspection used.

#### Current

Most capability specs include `## Verification Basis`, but several current specs do not.

#### Target

Every new or materially updated source-backed capability spec includes a verification basis. The section may list source inspection only, but it must not imply tests ran unless they did.

#### Acceptance

A reader can distinguish behavior inferred from code inspection from behavior proven by automated tests or manual UI checks.

#### Scenario: Source inspection only

- GIVEN an agent writes a spec from current TypeScript files
- WHEN no test command is run
- THEN the verification basis lists inspected files and says no automated validation was run.

### Requirement: Traceability rows use requirement-level status

Capability specs SHOULD include traceability rows that map each requirement to scenarios or validation work, and row status MUST describe the requirement's verification state.

#### Current

Traceability tables exist in most specs, but status labels vary and sometimes duplicate the document status.

#### Target

Traceability row status uses one of:

- `Unverified`: source behavior is described but not validated.
- `Partially Verified`: some acceptance checks are covered.
- `Verified`: current tests or manual checks satisfy the acceptance checks.
- `Planned`: requirement describes target behavior not yet implemented.

#### Acceptance

A future coverage run can identify which requirements need test mapping without re-reading the whole spec.

#### Scenario: One requirement has tests

- GIVEN a spec has three requirements
- AND only one requirement maps to an existing passing test
- WHEN traceability is updated
- THEN only that row is marked `Verified`; the others remain `Unverified` or `Planned`.

### Requirement: Coverage analyses are separate from capability contracts

Coverage documents under `docs/specs/coverage/` MUST report gaps and evidence, not introduce durable product requirements that should live in capability specs.

#### Current

The coverage snapshot correctly maps source areas and names future gaps, but it does not define status behavior itself.

#### Target

Coverage files may recommend a new or updated spec. They must not become the only place where durable capability requirements live.

#### Acceptance

If a coverage analysis identifies a long-lived behavior rule, a future run creates or updates a capability, phase, or change spec for that rule.

#### Scenario: Coverage gap becomes a capability spec

- GIVEN a coverage analysis says spec status is inconsistent
- WHEN a scheduled coverage run handles that gap
- THEN it creates a focused capability spec instead of appending product requirements only to the coverage file.

### Requirement: Code remains the conflict authority

When a spec conflicts with current code during a source-specs coverage run, the agent MUST treat current code as the single source of truth and either update the spec or record the mismatch as a gap.

#### Current

The scheduled job explicitly instructs agents to use current code as the single source of truth and to avoid legacy-doc truth over code.

#### Target

Spec status and traceability must reinforce that rule: a `Done` or `Verified` label is invalid if current code no longer satisfies the acceptance checks.

#### Acceptance

A future agent that finds a mismatch downgrades or updates the spec instead of preserving stale status.

#### Scenario: Verified behavior regresses

- GIVEN a spec row is marked `Verified`
- WHEN current code no longer satisfies the row's acceptance check
- THEN the agent changes the row to `Unverified` or records a coverage gap, and names the conflicting source area.

## Edge Cases

- Minimal specs may omit full traceability only when their acceptance criteria are already direct and small.
- Coverage analyses may omit requirement sections because they are reports, not capability contracts.
- A spec can be `Draft` while some rows are `Verified`.
- A spec can be `Done` only when all mandatory requirements are verified or explicitly out of scope.
- Legacy docs may explain history but cannot justify `Verified` status against current source.

## Constraints

- **Documentation boundary:** This spec changes only documentation behavior under `docs/specs/`.
- **Compatibility:** Existing specs do not need immediate bulk migration; future edits should converge on this contract.
- **Source of truth:** Current code and current spec files are authoritative for coverage work.
- **Agent usability:** Status and traceability terms must stay compact and easy to apply during scheduled jobs.

## Success Criteria

- [ ] SC-001: New source-backed capability specs include a verification basis.
- [ ] SC-002: Traceability rows use requirement verification states instead of ad hoc labels.
- [ ] SC-003: Coverage analyses report gaps without becoming the sole home for durable behavior requirements.
- [ ] SC-004: Specs that conflict with current code are updated, downgraded, or recorded as gaps.

## Assumptions and Open Questions

### Assumptions

- Existing specs can migrate gradually as they are touched by future scheduled runs.
- `Draft` remains the safe default for source-derived specs until explicit validation is mapped.

### Open Questions

- Should this contract be summarized in `docs/specs/README.md` after review?
- Should a script check missing verification basis and unknown traceability status values?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| Status labels have bounded meanings | Implemented behavior remains Draft until verified | Future README summary or lint task | Unverified |
| Source-backed specs include a verification basis | Source inspection only | Future spec authoring checks | Unverified |
| Traceability rows use requirement-level status | One requirement has tests | Future traceability cleanup | Unverified |
| Coverage analyses are separate from capability contracts | Coverage gap becomes a capability spec | This spec handles the status gap | Partially Verified |
| Code remains the conflict authority | Verified behavior regresses | Future coverage runs | Unverified |

## Verification Basis

This spec is based on:

- `GLOSSARY.md`
- `AGENTS.md`
- `docs/specs/README.md`
- `docs/specs/coverage/source-specs-coverage-2026-05-10.md`
- a complete inventory of current `docs/specs/**/*.md` files and their `Status`, `Traceability`, and `Verification Basis` sections

No source code or automated tests were changed or run for this documentation-only update.
