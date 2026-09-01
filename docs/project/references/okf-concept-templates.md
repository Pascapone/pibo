---
type: "Reference"
title: "Pibo OKF concept templates"
description: "Provides compact Pibo-profile templates for each supported documentation function."
tags: ["documentation", "okf", "templates"]
status: "stable"
authority: "informative"
generated:
  by: "openai/codex"
  at: "2026-08-29T18:40:48Z"
---

# Shared frontmatter

Replace every placeholder. Use one template body below with this base:

```yaml
---
type: "<allowed type>"
title: "<title>"
description: "<one-sentence description.>"
tags: ["<subject>"]
status: "draft"
authority: "<authority>"
generated: { by: "<actor/version>", at: "<ISO-8601 datetime>" }
---
```

The full approved vocabulary is `Documentation Profile`, `Architecture`, `Design System`, `Decision Record`, `Guide`, `Runbook`, `Reference`, `Status`, `Specification`, `Plan`, `Change Proposal`, `Technical Design`, `Product Requirement`, `Task Ledger`, `Evidence Report`, `Validation Report`, `Investigation Report`, `Incident Report`, `Coverage Report`, `Review Record`, `Release Record`, `Research`, `Feedback`, and `Historical Record`. The profile defines their allowed roots and authorities.

Keep `title`, `description`, and tags visible and single-line. Do not use bidi controls, format characters, default-ignorable code points, U+2800 BRAILLE PATTERN BLANK, the blank fillers U+115F, U+1160, U+17B4, U+17B5, U+3164, or U+FFA0, or labels made only from whitespace and combining marks. Visible Unicode and normalized accented text are allowed.

# Specification

Use `type: "Specification"`, `authority: "normative"`, and `docs/specs/<domain>/<spec-name>.md`. Describe implemented behavior only. Do not place canonical specifications at `docs/specs/` root, under a broad `capabilities/` catch-all, or in the migration-input `specs/changes/` tree. Add globally unique requirement IDs with at least two semantic uppercase components, such as `<DOMAIN>-<TOPIC>-001` or `<DOMAIN>-<TOPIC>-REQ-001`, and the traceability structure from the [profile](/project/documentation-profile.md). The `REQ` component is optional.

Only a fence-aware ATX heading whose content starts exactly with the case-sensitive marker `Requirement:` is a formal body requirement. Put one raw, unformatted ASCII ID immediately after the marker, then use a colon or whitespace before the prose title. Every frontmatter ID has exactly one explicit heading, and every valid explicit heading has one frontmatter owner. Plain technical, date, prose, and unmarked ID-looking headings are ordinary headings. Do not use raw `<!--` or `-->` anywhere outside fenced code in a current Specification; use visible prose or a fenced example. Follow CommonMark fence syntax: a backtick opener's info string cannot contain a backtick, and a closer must use the opener character with at least the opener length. The scanner treats LF, CRLF, and lone CR as equivalent line endings.

```markdown
# Scope
# Current behavior
# Requirements and invariants
## Requirement: <DOMAIN>-<TOPIC>-001: <Implemented behavior>
# Interfaces and ownership
# Failure and security behavior
# Known limits
# Verification and traceability
# Related concepts
```

# Plan

Use `type: "Plan"`, `authority: "directive"`, and `docs/plans/<kebab-name>.md`.

```markdown
# Context
# Goal
# Non-goals
# Work
# Acceptance
# Risks and rollback
# Completion and successors
```

# Other planning concepts

Use `Change Proposal` or `Technical Design` with `authority: "supporting"`; use `Product Requirement` or `Task Ledger` with `authority: "directive"`. Keep all four under `docs/plans/`. Product requirements use globally prefixed IDs such as `PIBO-AUTH-PRD-001`.

```markdown
# Context and scope
# Proposed or required outcome
# Constraints and interfaces
# Acceptance or decision gate
# Risks and rollback
# Successors
```

# Decision record

Use `type: "Decision Record"`, `authority: "supporting"`, and `docs/project/decisions/<kebab-name>.md`.

```markdown
# Context
# Decision
# Alternatives
# Consequences
# Rollback
# Evidence
```

# Guide

Use `type: "Guide"`, `authority: "directive"`, and `docs/project/guides/<kebab-name>.md`.

```markdown
# Purpose
# Prerequisites
# Procedure
# Verification
# Failure recovery
# Related concepts
```

# Architecture, design system, and runbook

Put `Architecture`, `Design System`, and `Runbook` concepts under `docs/project/`. Architecture is `normative`, `supporting`, or `informative` according to scope; a Design System is `normative` or `supporting`; a Runbook is `directive`.

```markdown
# Scope
# Owned model or procedure
# Interfaces and invariants
# Verification
# Failure recovery or change policy
# Related concepts
```

# Research

Use `type: "Research"`, `authority: "informative"`, and `docs/reports/research/<kebab-name>.md`.

```markdown
# Question
# Scope and method
# Findings
# Analysis
# Recommendation
# Uncertainty and follow-up
```

# Status

Use `type: "Status"`, `authority: "informative"`, and `docs/project/status/<kebab-name>.md` for current project state or `docs/reports/status/<kebab-name>.md` for dated report status. Add `stale_after` when the snapshot has a known review horizon.

```markdown
# Snapshot
# Current state
# Blockers and risks
# Next checkpoint
```

# Feedback

Use `type: "Feedback"`, `authority: "source"`, and `docs/reports/feedback/<kebab-name>.md`. Preserve the original wording.

```markdown
# Context
# Original feedback
# Attachments
# Follow-up
```

# Evidence

Use `type: "Evidence Report"`, `authority: "evidentiary"`, and `docs/reports/evidence/<kebab-name>.md`. Stable publication requires `evidence: { id, published_at }` and a matching SHA-256 manifest entry under `docs/reports/artifacts/okf-migration/`.

```markdown
# Question
# Setup and inputs
# Procedure
# Raw result
# Verdict
# Limitations
# Artifacts
```

# Validation, investigation, incident, coverage, review, and release records

Use the exact report role: `Validation Report`, `Investigation Report`, `Incident Report`, `Coverage Report`, `Review Record`, or `Release Record`. Store it under a justified nested `docs/reports/` path. Use the type-specific authority from the profile.

```markdown
# Question or event
# Scope and inputs
# Method or timeline
# Findings
# Verdict or outcome
# Limitations and follow-up
```

# Historical record

Use `type: "Historical Record"`, `authority: "historical"`, `status: "deprecated"`, and `docs/legacy/<kebab-name>.md`. Link the successor when one exists. If an exact preserved body retains broken links, use only the profile's `preserved_body` metadata; do not alter the body or add a broad exception.

```markdown
# Original scope
# Closed record
# Durable outcome
# Successors
```

# Reference

Use `type: "Reference"`, `authority: "source"` or `"informative"`, and `docs/project/references/<kebab-name>.md` for current references or `docs/reports/<group>/<kebab-name>.md` for report-bound source material. Declare source resource, version, retrieval date, and license when mirroring external material.

```markdown
# Source
# Scope
# Mirrored or summarized material
# Local use
# License and update policy
```
