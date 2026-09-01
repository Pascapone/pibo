---
type: "Plan"
title: "OKF documentation-system migration"
description: "Controls the staged migration of Pibo documentation into a complete OKF v0.2 bundle."
tags: ["documentation", "migration", "okf"]
status: "stable"
authority: "directive"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - id: "foundation-decisions"
    resource: "scope: /tmp/pibo-okf-audits/foundation-decisions.md at base commit 2aef244301f5d181624662fdad53e18e83e80bd9"
    title: "Pibo OKF foundation decisions"
migration:
  base_commit: "2aef244301f5d181624662fdad53e18e83e80bd9"
  phase: "closure-refresh"
  strict_ready: true
---

# Goal

Migrate every Pibo documentation path into one conformant OKF concept or reserved file under `docs/`, or retain it as one justified host-owned exception, while replacing stale and duplicate current specifications with code-grounded canonical owners.

# Non-goals

- Do not reopen accepted preserved bodies or rewrite accepted migration history during refreshes.
- Do not promote legacy reports, completed change packets, or unchecked specifications to current truth.
- Do not add OKF metadata to host-owned files.
- Do not claim the migration is complete while strict validation fails.

# Work

| Phase | State | Completion condition |
|---|---|---|
| Evidence and ledger | complete | Every repository Markdown path is classified once; ledger and evidence-manifest accounting are closed. |
| Foundation | complete | Profile, reserved files, ledger, validators, tests, templates, and authoring rules are executable. |
| Corpus migration | complete | Every concept is conformant or reserved and every native host document is an exact justified exception. |
| Specification rewrite | complete | Implemented behavior has a code-grounded canonical owner with requirement traceability; desired work remains in plans. |
| Closure audit | complete for the accepted migration; refresh validation required per code update | Strict validation and package/link closure pass before a refreshed candidate is committed. |

# Resolved plan dispositions

The ledger records these paths once with the following binding decisions from the foundation audit:

| Current path | Disposition |
|---|---|
| `docs/plans/agent-management-tool-design.md` | Fold implemented behavior into Subagents and Yielded Runs specifications, then preserve rationale under `project/decisions/` or the closed record under `legacy/`. |
| `docs/plans/codex-chatgpt-image-generation-tool-implementation-plan-2026-06-30.md` | Fold the native-tool contract into the canonical tools specification, then archive the plan. |
| `docs/plans/local-auth-gateway-implementation-plan-2026-06-14.md` | Fold implemented behavior into the Web access and authentication specification, then archive the plan. |
| `docs/plans/multi-agent-runtime-adapter-implementation-plan-2026-08-14.md` | Fold the implemented adapter baseline into runtime specifications, then archive the plan. |
| `docs/plans/pibo-fast-gateway-and-trace-roadmap.md` | Split shipped phases into current gateway and trace specifications; retain only unimplemented work as a directive plan. |
| `docs/plans/session-turn-lifecycle-signals-plan.md` | Fold completed requirements into signals and routing specifications, then archive the plan. |
| `docs/plans/windows-better-auth-direct-validation.md` | Retain as an active draft directive plan until Windows validation runs or the owner retires it. |

# Acceptance

- Migration mode reports no missing, extra, or duplicate Markdown ownership.
- Core mode runs without the Pibo ledger or profile and reports only OKF v0.2 conformance errors.
- Every ledger authority uses the Pibo authority vocabulary.
- Current/source ownership and pending destinations are unique, collision-checked, and valid for the five-root taxonomy.
- Foundation concepts and reserved files validate in migration mode.
- Generated indexes and the explicit log checker report no drift or structural error.
- Deprecated historical or evidentiary preserved bodies may except only exact declared unresolved links while their immutable body hash matches.
- Focused validator and authoring-guidance tests pass in the Docker worker.
- Strict mode runs deterministically and reports the pending/profile baseline as failure.
- Later completion requires zero pending records, strict conformance, canonical specification coverage, and an independent closure audit.

# Standing authorization for trivial corrections

Future agents may autonomously make similarly trivial, mechanically proven validator/profile corrections that do not generalize policy. Each correction must include focused tests, matching profile documentation, exact-scope evidence, and a fresh independent review. Material authority, security, package-scope, or ownership changes still require explicit user approval.

# Risks and rollback

- **False authority:** A structural conversion could preserve stale claims. Keep a file pending until source and tests settle its facts.
- **Lost implemented behavior:** Archiving a change packet too early could remove its only owner. Fold verified deltas into a current specification first.
- **Ledger drift:** A new Markdown file could bypass migration ownership. Migration validation fails on any unlisted path.
- **Validator overreach:** Pibo policy could be mislabeled as OKF core. The profile and diagnostics identify the governing layer.

Rollback the foundation as one commit if its validator or profile blocks legitimate migration work. Do not delete or rewrite pending corpus files as part of rollback.

# Completion and successors

The accepted migration reached zero pending ledger records and strict conformance on 2026-09-01. Subsequent upstream refreshes preserve the accepted commit chain, classify every upstream documentation delta, update canonical specifications against current code and tests, regenerate indexes and accounting, and rerun the full closure gates. The [migration status](/project/status/okf-migration-foundation.md) retains the foundation history and records the current closure state.
