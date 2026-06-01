---
name: pibo-spec-writing
description: Defines how Pibo specs are written, structured, reviewed, and split into proposals, capability specs, phase specs, designs, and tasks. Use this whenever the user asks to create, review, rewrite, compare, or implement a spec; mentions requirements, acceptance criteria, scope, roadmap, proposal, design plan, tasks, OpenSpec, Spec Kit, GSD, or spec-driven development; or asks where project documentation should live.
---

# Pibo Spec Writing

Use this skill when creating or reviewing specs for Pibo. A good Pibo spec is behavior-first, scoped, testable, concise, and traceable to implementation work. Keep implementation details out of the spec unless they are externally visible constraints.

## Core principles

Write specs so another agent can implement and verify the work without reading the original chat.

1. Start with why the change matters.
2. Define the observable behavior, not the code shape.
3. Bound the scope with clear in-scope and out-of-scope lists.
4. Make every requirement testable.
5. Add scenarios or acceptance criteria for each important behavior.
6. Track assumptions and open questions instead of hiding them.
7. Link requirements to phases, tasks, or plans when the work is large.
8. Use clear prose: active voice, concrete words, short paragraphs, and no puffery.
9. For user-facing UI, CLI, TUI, gateway, runtime, or agent-routing changes, name the expected verification level instead of assuming unit tests are enough.

## Where specs live

Follow the project documentation structure:

```text
docs/
  project/  Current project docs and canonical documentation
  specs/    Product, technical, and implementation specifications
  plans/    Implementation plans and design plans
  reports/  Investigation, validation, and generated reports
  legacy/   Old documentation kept for reference
```

Do not create new root-level `plans/`, `reports/`, or `specs/` directories.

Use `docs/specs/` for durable specs. Use `docs/plans/` for implementation plans. Use `docs/reports/` for analyses, validations, and findings.

## Choose the right spec shape

### Capability spec

Use a capability spec for durable system behavior, especially behavior that should remain true after the current change ships.

Good path:

```text
docs/specs/capabilities/<capability-name>.md
```

Use this for auth behavior, session routing, profile behavior, tool registration, gateway contracts, API behavior, UI behavior, or other long-lived contracts.

### Change spec

Use a change spec when proposing a feature, fix, or migration.

Good path:

```text
docs/specs/changes/<change-name>/
  proposal.md
  spec.md
  design.md       # include when technical choices matter
  tasks.md        # include when ready to implement
```

### Phase spec

Use a phase spec for multi-step work that needs a roadmap.

Good path:

```text
docs/specs/phases/<NN-phase-name>/
  spec.md
  context.md      # implementation decisions, references, existing-code notes
```

## Required structure for most Pibo specs

Use this template unless the task clearly needs a smaller artifact.

```markdown
# Spec: [Name]

**Status:** Draft | Approved | Implementing | Done
**Created:** YYYY-MM-DD
**Requester / Source:** [user, issue, discussion, or change]
**Related docs:** [links]

## Why

[Problem, opportunity, or user need. One or two concrete paragraphs.]

## Goal

[One precise sentence that says what changes from current state to target state.]

## Background / Current State

[What exists today. What is broken, missing, confusing, slow, unsafe, or expensive.]

## Scope

### In Scope

- [Concrete behavior or deliverable]

### Out of Scope

- [Excluded item] — [reason]

## Requirements

### Requirement: [Name]

The system MUST/SHALL [observable behavior].

#### Current

[Current behavior or absence of behavior.]

#### Target

[Desired behavior.]

#### Acceptance

[Concrete pass/fail check.]

#### Scenario: [Name]

- GIVEN [state]
- WHEN [action/event]
- THEN [expected outcome]

## Edge Cases

- [Boundary, failure, permission, concurrency, or empty-state case]

## Constraints

- **Compatibility:** ...
- **Security / Privacy:** ...
- **Performance:** ...
- **Dependencies:** ...

## Success Criteria

- [ ] SC-001: [Measurable or directly observable outcome]
- [ ] SC-002: [Another pass/fail outcome]

## Assumptions and Open Questions

### Assumptions

- [Reasonable default taken to keep progress moving]

### Open Questions

- [Question that materially affects scope, UX, security, or architecture]

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 | [Scenario] | [Plan or task] | Pending |
```

## Minimal spec

For small work, use the shortest form that remains testable:

```markdown
# Spec: [Name]

## Why
## Goal
## Scope
### In Scope
### Out of Scope
## Requirements
## Acceptance Criteria
## Assumptions / Open Questions
```

Use the full template when the change touches multiple modules, changes public behavior, affects auth/security/data, or will be implemented across multiple sessions.

## Requirement rules

Write requirements as behavior contracts.

Good:

```markdown
### Requirement: Dev gateway status is discoverable

The CLI MUST show whether the dev gateway is running, its PID when known, and the command to inspect logs.

#### Scenario: Gateway is running
- GIVEN the dev gateway process is active
- WHEN an operator runs `pibo gateway dev status`
- THEN the output includes status, PID, port, and next diagnostic command
```

Weak:

```markdown
### Requirement: Improve gateway status
Make gateway status better and more robust.
```

A requirement is ready when a reviewer can say pass or fail without guessing.

## Reuse, parity, and verification clarity

When a feature is described as "same as Web", "derived from Web", "reuse the view", "shared UI", "Terminal View", or similar, do not silently reduce that to shared data. State the intended reuse level:

- data/state only
- renderer-neutral view model
- interaction/controller logic
- renderer/component logic
- visual and behavioral parity

If visual or behavioral parity is required, add acceptance checks that compare the relevant surfaces with the same fixture or user flow. If parity is intentionally out of scope, say so and describe the user-visible difference.

For user-facing UI, CLI, TUI, gateway, runtime, auth, or agent-routing specs, include at least one realistic validation scenario for the default user path when feasible. Fake data, demo mode, mocks, and render snapshots are useful, but they should not be the only acceptance evidence for behavior users will exercise directly unless the real path is unavailable or explicitly out of scope.

## Scenario rules

Prefer GIVEN / WHEN / THEN for user-visible behavior and system contracts. Use WHEN / THEN only for simple event-response behavior.

Cover at least:

- primary success path
- empty or missing state
- invalid input or permission failure
- migration or compatibility path when relevant

## Proposal structure

Use `proposal.md` to explain intent before deep design.

```markdown
# Proposal: [Change]

## Why

## What Changes

## Capabilities

### New Capabilities
- `<kebab-name>`: [brief behavior area]

### Modified Capabilities
- `<existing-name>`: [changed behavior]

## Impact

- **Code:** ...
- **APIs / CLI:** ...
- **Data:** ...
- **Auth / Security:** ...
- **Docs:** ...
```

## Design structure

Use `design.md` when technical choices matter. Keep requirements in the spec; put implementation choices here.

```markdown
# Design: [Change]

## Context
## Goals / Non-Goals
## Decisions
### Decision: [Choice]
- **Choice:** ...
- **Rationale:** ...
- **Alternatives considered:** ...

## Risks / Trade-offs
## Migration / Rollback
## Open Questions
```

## Tasks structure

Use `tasks.md` only after the spec and design are stable enough to act on.

```markdown
# Tasks: [Change]

## 1. Setup / Foundation
- [ ] 1.1 [Concrete task with file path]

## 2. Requirement: [Name]
- [ ] 2.1 [Test or validation task]
- [ ] 2.2 [Implementation task]

## 3. Validation
- [ ] 3.1 Run [command]
- [ ] 3.2 Verify [observable behavior]
```

Tasks should be small enough for one agent session. Include file paths and validation commands when known.

## Review checklist

Before treating a spec as ready, check:

- [ ] The `Why` names a real problem or opportunity.
- [ ] The `Goal` is specific and measurable.
- [ ] Scope has both in-scope and out-of-scope items.
- [ ] Requirements use MUST or SHALL for mandatory behavior.
- [ ] Each requirement has acceptance checks or scenarios.
- [ ] Edge cases include failure and empty-state behavior where relevant.
- [ ] Assumptions are visible.
- [ ] Open questions are few and material.
- [ ] Implementation details live in `design.md` or `tasks.md`, not in behavioral requirements.
- [ ] The spec is concise, concrete, and free of promotional language.

## Writing style

Write for humans and agents. Prefer short sentences. Use active voice. Omit needless words. Avoid vague adjectives such as robust, seamless, powerful, and cutting-edge. Replace them with concrete behavior.

Use tables only when they make comparison or traceability easier. Do not decorate specs with excessive emoji or bold text.
