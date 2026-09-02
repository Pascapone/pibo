---
name: pibo-spec-writing
description: Defines how Pibo current domain specifications and supporting plans, proposals, technical designs, product requirements, task ledgers, and decisions are written and reviewed. Use this whenever the user asks to create, review, rewrite, compare, or implement a spec; mentions requirements, acceptance criteria, scope, roadmap, proposal, design plan, tasks, OpenSpec, Spec Kit, GSD, or spec-driven development; or asks where project documentation should live.
---

# Pibo Spec Writing

Use this skill when creating or reviewing specs for Pibo. A good Pibo spec is behavior-first, scoped, testable, concise, and traceable to implementation work. Keep implementation details out of the spec unless they are externally visible constraints.

Before writing, read `docs/index.md` and `docs/project/documentation-profile.md`. Keep this host-owned `SKILL.md` in its native format; apply OKF metadata only to concepts under `docs/`.

## Core principles

Write current specs so another agent can understand and verify implemented behavior without reading the original chat. Put behavior that is not implemented in a Plan.

1. Start with why the change matters.
2. Define the observable behavior, not the code shape.
3. Bound the scope with clear in-scope and out-of-scope lists.
4. Make every requirement testable.
5. Add scenarios or acceptance criteria for each important behavior.
6. Track assumptions and open questions instead of hiding them.
7. Give every requirement a stable ID and exact source/test traceability at the checked commit.
8. Use clear prose: active voice, concrete words, short paragraphs, and no puffery.
9. For user-facing UI, CLI, TUI, gateway, runtime, or agent-routing behavior, name the concrete source, test, build, browser, and Pibo2 evidence that applies instead of assuming unit tests are enough.

## Where specs live

Follow the five-root Pibo OKF profile:

```text
docs/
  project/  Current governance, architecture, decisions, guides, operations, references, and status
  specs/    Implemented current contracts only
  plans/    Intended changes, acceptance, risks, and rollback
  reports/  Investigation, validation, incidents, research, feedback, evidence, and artifacts
  legacy/   Superseded material, completed packets, closed plans, and handoffs
```

Do not create another top-level directory under `docs/`. Every concept requires profile frontmatter, migration-ledger ownership, generated-index coverage through `npm run docs:indexes:write`, and an explicit `docs/log.md` entry.

Write visible single-line `title`, `description`, and tag values. Do not use bidi controls, format characters, default-ignorable code points, U+2800 BRAILLE PATTERN BLANK, the blank fillers U+115F, U+1160, U+17B4, U+17B5, U+3164, or U+FFA0, or labels composed only of whitespace and combining marks. Normal visible Unicode and normalized accented text are valid.

The complete approved type vocabulary is:

- `project/`: `Documentation Profile`, `Architecture`, `Design System`, `Decision Record`, `Guide`, `Runbook`, `Reference`, `Status`.
- `specs/`: `Specification`.
- `plans/`: `Plan`, `Change Proposal`, `Technical Design`, `Product Requirement`, `Task Ledger`.
- `reports/`: `Evidence Report`, `Validation Report`, `Investigation Report`, `Incident Report`, `Coverage Report`, `Review Record`, `Release Record`, `Research`, `Feedback`, `Reference`, `Status`.
- `legacy/`: `Historical Record`.

Use the compact templates in `docs/project/references/okf-concept-templates.md`. Requirement IDs need at least two semantic uppercase components before the numeric suffix, for example `PROD-CTX-001`, `WP02-DATA-STORE-001`, or `PIBO-ROUTING-REQ-001`. The `REQ` component is optional; a repository-global `REQ-001` is invalid.

Only a fence-aware ATX heading whose content starts exactly with the case-sensitive marker `Requirement:` is a formal body requirement. Put one raw, unformatted ASCII ID immediately after the marker, then separate its prose title with a colon or whitespace. Every frontmatter requirement ID needs exactly one explicit heading, and every valid explicit heading needs one frontmatter owner. Formatting, links, escapes, trailing punctuation, Unicode lookalikes, invisible or control characters, malformed IDs, and missing tokens are invalid in the ID position. Plain headings such as `RFC-9110 semantics`, `ISO-8601 timestamps`, `HTTP-404 responses`, dates, prose, and unmarked ID-looking text are ordinary headings.

Do not write raw `<!--` or `-->` anywhere outside fenced code in a current Specification, including inline-code or escaped examples. The validator rejects both delimiters and parses requirements from unchanged non-fenced source lines. Use visible prose or fenced examples instead. Use CommonMark fences: a backtick opener's info string cannot contain a backtick, and a closer must use the opener character with at least the opener length. An invalid opener does not protect example content from validation. LF, CRLF, and lone CR are equivalent line endings for scanning.

## Choose the right spec shape

### Current domain specification

Use one domain-scoped Specification for durable behavior implemented at the checked code baseline. Do not mix target behavior into a current specification.

Good path:

```text
docs/specs/<domain>/<spec-name>.md
```

Choose a stable product or technical domain such as authentication, routing, tools, gateway, API, or UI. Do not create a broad `docs/specs/capabilities/` catch-all. Do not create new change packets under `docs/specs/changes/`; that existing tree is migration input whose implemented facts must fold into canonical domain specifications.

### Change plan

Use a Plan when proposing a feature, fix, or migration. Put supporting rationale in a Decision Record under `docs/project/decisions/` when it must outlive the plan.

Good path:

```text
docs/plans/<change-name>.md
```

### Phased plan

Use one Plan with phases for multi-step work that needs a roadmap.

Good path:

```text
docs/plans/<change-name>.md
```

## Required structure for most Pibo specs

Use this template unless the task clearly needs a smaller artifact.

```markdown
---
type: "Specification"
title: "<name>"
description: "<one-sentence implemented contract.>"
tags: ["<subject>"]
status: "draft"
authority: "normative"
generated: { by: "<actor/version>", at: "<ISO-8601 datetime>" }
traceability:
  commit: "<40-character checked commit>"
  requirements:
    - id: "PIBO-EXAMPLE-001"
      status: "implemented"
      sources: [{ path: "src/example.ts", symbol: "publicSurface" }]
      tests: [{ path: "test/example.test.mjs", name: "proves the behavior" }]
      public: ["<command, route, type, table, or plugin id>"]
      failures: ["<failure or security behavior>"]
      confidence: "high"
---

# Scope
# Current behavior
# Requirements and invariants
## Requirement: PIBO-EXAMPLE-001: <Implemented behavior>
# Interfaces and ownership
# Failure and security behavior
# Known limits
# Verification and traceability
# Related concepts
```

Use `status: stable` only after source and test reconciliation. Add `verified` only after an actual check; authorship or a passing formatter is not verification.

Requirement `confidence` is exactly `high`, `medium`, or `low`. Do not invent numeric levels, extra labels, or synonyms.

## Minimal spec

For a small implemented contract, keep the required frontmatter and traceability above, then use the shortest body that remains verifiable:

```markdown
# Scope
# Current behavior
## Requirement: PIBO-EXAMPLE-001: <Implemented behavior>
# Failure behavior
# Verification
```

Use a Plan, not a Specification, when the behavior will be implemented later.

## Requirement rules

Write requirements as behavior contracts.

Good:

```markdown
### Requirement: PIBO-GATEWAY-001: Dev gateway status is discoverable

The CLI MUST show whether the dev gateway is running, its PID when known, and the command to inspect logs.

#### Scenario: Gateway is running
- GIVEN the dev gateway process is active
- WHEN an operator runs `pibo gateway dev status`
- THEN the output includes status, PID, port, and next diagnostic command
```

Weak:

```markdown
### Requirement: PIBO-GATEWAY-001: Improve gateway status
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

Record concrete verification evidence where it applies:

- source evidence: exact paths, symbols, commands, routes, types, tables, or other public surfaces inspected;
- test evidence: exact test paths, cases, and commands run;
- build evidence: the exact build or type-check command and result;
- browser evidence: the exercised user flow, relevant viewport, and console, network, or DOM checks;
- Pibo2 evidence: the worker, session, command, or runtime flow and its observable result.

Do not replace these facts with an undefined verification scale. Set requirement `confidence` to exactly one of `high`, `medium`, or `low`, and use it only for confidence in the traced claim, not as a substitute for evidence.

## Scenario rules

Prefer GIVEN / WHEN / THEN for user-visible behavior and system contracts. Use WHEN / THEN only for simple event-response behavior.

Cover at least:

- primary success path
- empty or missing state
- invalid input or permission failure
- migration or compatibility path when relevant

## Plan structure

Use a `Plan` concept under `docs/plans/` to explain intent before implementation.

```markdown
# Context
# Goal
# Non-goals
# Work
# Acceptance
# Risks and rollback
# Completion and successors
```

## Design structure

Use a `Decision Record` under `docs/project/decisions/` when technical choices must outlive the plan. Use `type: "Decision Record"` and `authority: "supporting"`.

```markdown
# Context
# Decision
# Alternatives
# Consequences
# Rollback
# Evidence
```

## Tasks structure

Keep executable tasks in the owning Plan only after the goal and acceptance conditions are stable enough to act on.

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

- [ ] The file is a conformant OKF concept under `docs/specs/` and has one ledger owner.
- [ ] Every claim describes implemented behavior at `traceability.commit`.
- [ ] Requirements use MUST or SHALL for mandatory behavior.
- [ ] Each requirement has acceptance checks or scenarios.
- [ ] Edge cases include failure and empty-state behavior where relevant.
- [ ] Every requirement names exact source paths, symbols or public surfaces, tests or an explicit source-inspected gap, failure behavior, and `confidence` set to `high`, `medium`, or `low`.
- [ ] Planned work and open product choices live in a Plan; durable rationale lives in a Decision Record.
- [ ] Generated indexes and the explicit `docs/log.md` entry link the concept.
- [ ] The spec is concise, concrete, and free of promotional language.

## Writing style

Write for humans and agents. Prefer short sentences. Use active voice. Omit needless words. Avoid vague adjectives such as robust, seamless, powerful, and cutting-edge. Replace them with concrete behavior.

Use tables only when they make comparison or traceability easier. Do not decorate specs with excessive emoji or bold text.
