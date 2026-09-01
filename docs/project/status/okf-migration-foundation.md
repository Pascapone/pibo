---
type: "Status"
title: "OKF migration status"
description: "Retains the foundation checkpoint and records closure and upstream-refresh status for Pibo's OKF v0.2 bundle."
tags: ["documentation", "migration", "okf"]
status: "stable"
authority: "informative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
stale_after: "2026-09-29"
sources:
  - id: "migration-plan"
    resource: "/plans/okf-migration.md"
    title: "OKF documentation-system migration"
---

# Checkpoint

The foundation wave established policy and executable gates. The accepted migration later closed the corpus and capability-specification migration with 762 ledger records, zero pending records, and 106 generated directory indexes. This document retains the original foundation evidence below and records the current refresh contract rather than presenting that checkpoint as unfinished work.

# Closure refresh

- Accepted migration head before refresh: `7f6ad57f8117b54047ef705b7559225a1d2db5a4` (tree `937bd63140f70cc8552c87c638a4f4b589ad79db`).
- Refresh source: current `upstream/dev` at `39090b8850758293e69380a52bb7498d7c955bc2`, merged without rewriting the accepted chain.
- Upstream documentation disposition: preserve the accepted historical agent-management plan body; fold its new observation-query facts and the five retired capability-spec deltas into their canonical current specifications; do not restore retired competing authorities.
- Closure gates: OKF core, migration, strict profile, indexes, log, preserved bodies, ledger/evidence accounting, focused tests, build/typecheck, and actual extracted-package link closure all must pass before the refresh candidate is ready for independent whole-diff review.

# Baseline

- Audit base: `2aef244301f5d181624662fdad53e18e83e80bd9`.
- Baseline tracked Markdown: 705 paths.
- Baseline bundle Markdown: 647 paths under `docs/`.
- Baseline OKF result: zero concepts, 647 errors, and 88 link warnings.
- Audit capability map: 84 capability nodes; 35 covered, 35 partial, 11 stale, and 3 duplicate.

# Commit history

- Initial local Foundation commit: `dfec402d34f4590af226d066d7ec86e3366dee0f`.
- First corrective amendment: `0f27620a4decfb65488e03c8e06f7fb417f7692c`.
- Foundation validation amendment: `e6d0a281175c583f6b3d68b917bb9e1b556a3f16`.
- Rejected independent-review revision: `3b0840f1c2792cb5a863edea1684517d48f12547`.
- Rejected Review 2 integration revision: `a494693c7fbcb5ea094feafbc999dc89f3c4d6d6`.
- Rejected Review 3 revision: `7f8345fc04e99302488bb05973aca4d39522425c`.
- Rejected Review 4 revision: `94d12af919603a682d134a04182b2e5b08b25d0e`.
- Rejected Review 5 revision: `a38cd049fe7c23540823d124ecb3ec8caa6ae9c7`.
- Rejected Review 6 revision: `e7b0e9521ffec2f30df0128e6a398e17c2616de8`.
- Rejected Review 7 revision: `031ba6b63bc73f44afe3cf741298eaecdba2d914`.
- Rejected Review 8 revision: `3bc3ca90060bc8f3bd841226baf00739fb192cbe`.
- Rejected Review 9 revision: `41915103174806ea1298270b6d6cbda4ffa4df0c`.
- Rejected Review 10 revision: `cd31e45dfa8a9d7bcdb7f072d14fc8bceae5dae5`.
- Final amendment: the `okf-docs-foundation` HEAD containing this status. The post-commit implementation report records its exact SHA because a commit cannot embed its own content-derived identity.

The independent reviews rejected `3b0840f1c2792cb5a863edea1684517d48f12547` for F-001 through F-006, `a494693c7fbcb5ea094feafbc999dc89f3c4d6d6` for F-007, `7f8345fc04e99302488bb05973aca4d39522425c` for F-008 through F-010, `94d12af919603a682d134a04182b2e5b08b25d0e` for F-011 through F-015, `a38cd049fe7c23540823d124ecb3ec8caa6ae9c7` for F-016 through F-019, `e7b0e9521ffec2f30df0128e6a398e17c2616de8` for F-020 and F-021, `031ba6b63bc73f44afe3cf741298eaecdba2d914` for F-022 through F-026, `3bc3ca90060bc8f3bd841226baf00739fb192cbe` for F-027 through F-031, `41915103174806ea1298270b6d6cbda4ffa4df0c` for F-032 and F-033, and `cd31e45dfa8a9d7bcdb7f072d14fc8bceae5dae5` for F-034. The initial iteration and each reviewed revision were amended; these identities are superseded objects, not additional Foundation commits on the branch.

# Foundation state

- Bundle root, profile, root log, five-root indexes, migration plan, status, templates, and evidence manifest: established.
- Migration/exception ledger: 720 Markdown paths accounted for exactly once—4 conformant foundation concepts, 11 reserved files, 658 pending paths, and 47 host-owned exceptions.
- Ledger-independent core, Pibo migration, and Pibo strict validators: implemented with layered diagnostics.
- Core validator baseline: expected failure with 647 errors—629 missing concept frontmatter and 18 missing or empty types. Unknown metadata and types, missing reserved files, and broken links do not add errors.
- Frontmatter portability: core, migration, strict, index generation, and log/profile helpers recognize exact `---` delimiter lines across LF, CRLF, lone CR, and mixed endings. YAML parsing normalizes line breaks internally while body slices retain their original bytes.
- Deterministic index writer/checker: 10 ledger-reserved indexes managed with zero drift; recursive filesystem ownership, all docs ledger states and current paths, every conformant concept's visible metadata, physical containment, and plain-text rendering preflight globally before writes. Repeated generation is byte-identical and never creates `README.md`.
- Pending lineage gate: all 658 pending paths are SHA-256 compared with regular blobs at the immutable parent of the ledger's unique true introduction commit. The validator enumerates complete reachable, non-shallow commit ancestry instead of simplified path history and rejects zero, multiple, root, merge-parented, unresolved, or non-regular introductions. The declared `base_commit` must equal the derived anchor; relocated hashes, later ledger edits, and independently merged introductions cannot bless mutations.
- Migration-era publication gates: every conformant concept needs a complete reserved index chain through `docs/`, and stable evidence needs a matching immutable manifest record even while strict mode remains red.
- Repository path safety: all 720 Markdown ledger paths require in-repository regular non-symlink paths before reads. Ledger and evidence-manifest bytes are read through non-following file descriptors while parent and leaf identities and types remain stable; changes return structured diagnostics without alternate-byte parsing. Index generation applies the same stable ledger read.
- Explicit log checker: passing; ledger-independent OKF core rejects title-only, empty-dated, non-list-entry, and fenced-pseudo-entry logs according to the normative v0.2 structure across LF, CRLF, lone CR, and mixed endings.
- Review remediation: F-001 through F-034 are covered. Formal requirements use only explicit, case-sensitive `Requirement: <ID>` ATX headings. Current specifications reject raw HTML comment delimiters outside valid CommonMark fences and parse unchanged source lines across LF, CRLF, lone CR, and mixed line endings. Plain technical or ID-looking headings remain prose; malformed explicit IDs, missing or unbound headings, and duplicate body headings fail.
- Focused fixtures: 82 validator and authoring tests cover line-ending-independent exact frontmatter envelopes and body offsets, immutable complete-history pending lineage, exact two-commit and merged-introduction rebinding attacks, descriptor-stable control-file reads at each inspection phase, complete conformant index ancestry, control-file symlinks, evidence publication, normative fence-aware core logs, preserved-body handling, traceability, CommonMark boundaries, Unicode visibility, recursive ledger/index preflight, canonical authoring wrappers, and byte-preserved relocations. The package-content suite separately verifies actual-archive link closure.
- Package exposure: the 860-file npm archive excludes the stale VS Code release runbook and incomplete legacy documentation READMEs. It includes the root README, its installation profile and WSL guide targets, the WSL quickstart target, and the self-contained operations subset. Every local link in the installed documentation subset resolves inside the archive.
- Strict validator baseline: expected failure with 1,563 errors, including 658 pending entries and current corpus/profile/index violations.
- Bulk corpus and canonical capability-specification rewrites: not started in this wave.

# Current gates

1. Keep zero pending records and preserve exact host exceptions and immutable body envelopes.
2. Refresh canonical specifications whenever current source/test behavior changes; keep desired work in plans and completed material in legacy.
3. Regenerate ledger file accounting and indexes, update the explicit log, and verify the installed archive rather than trusting a dry-run listing.
4. Require independent whole-diff review after the local refresh candidate passes its closure gates.
