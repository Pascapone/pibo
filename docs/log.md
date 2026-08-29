# Pibo documentation update log

## 2026-08-30

- **Review 10 remediation**: Made exact frontmatter envelopes portable across LF, CRLF, lone CR, and mixed Markdown line endings while preserving original body bytes.
- **Review 9 remediation**: Enumerated true ledger introductions across complete reachable Git history and bound ledger and evidence-manifest reads to stable, non-following file descriptors.
- **Review 8 remediation**: Derived the pending-byte trust anchor from ledger-introduction history, required complete conformant index chains, rejected symlinked JSON control paths before reads, made core logs CommonMark-fence-aware, and closed every local link in the installed documentation subset.
- **Review 7 remediation**: Bound all pending records to SHA-256 hashes derived from the declared Git base, required migration-time conformant index and stable-evidence registration, and rejected every unsafe repository Markdown path before reads.
- **Core conformance**: Corrected present `log.md` validation to require the normative date-grouped list-entry structure described by OKF v0.2.
- **Packaging**: Removed the stale pending VS Code release runbook from installed package contents while retaining all three README-linked installation guides.

## 2026-08-29

- **Creation**: Established the OKF v0.2 bundle root and [Pibo documentation profile](/project/documentation-profile.md).
- **Creation**: Added the [OKF migration plan](/plans/okf-migration.md), [foundation status](/project/status/okf-migration-foundation.md), machine-readable ledger, validator, and templates.
- **Correction**: Preserved the five project-approved roots and replaced the provisional top-level function directories with nested project and reports paths.
- **Correction**: Replaced the invalid provisional OKF source URL with the verified pinned `knowledge-catalog` source and recorded upstream and controller-local hashes without claiming byte identity.
- **Validation**: Added ledger-independent OKF core validation, deterministic ledger-owned index generation/checking, explicit log checking, stronger migration-ledger invariants, and the narrow immutable preserved-body link exception.
- **Authoring**: Exposed the full approved type vocabulary, globally prefixed requirement IDs, and thin `.codex` wrappers around the canonical specification-writing skill.
- **Authoring**: Replaced the obsolete capability catch-all path with canonical `specs/<domain>/<spec-name>.md` ownership, bounded confidence to `high|medium|low`, and required concrete source, test, build, browser, or Pibo2 evidence instead of an undefined verification scale.
- **Independent review remediation**: Closed F-001 through F-006 by narrowing preserved-link suppression, binding specification evidence to real Git commits and files, rejecting index metadata injection, aligning templates, enforcing a Pibo dated-log minimum, and assigning path-specific host-exception reasons.
- **Integration correction**: Accepted requirement IDs with two or more uppercase semantic components before the numeric suffix, without requiring a literal `REQ` component.
- **Review 2 remediation**: Added reverse body-heading validation for traced requirements.
- **Review 3 remediation**: Replaced heading heuristics with the explicit `Requirement: <ID>` grammar, enforced one body heading per traced ID, ignored fences and HTML comments, and made index generation preflight all managed outputs before any write.
- **Review 4 remediation**: Prohibited raw HTML comment delimiters in current specifications, made index preflight ledger- and real-path-aware, rejected symlinked/non-regular targets, and rendered concept metadata as structure-safe plain text.
- **Review 5 remediation**: Applied CommonMark fence recognition, made index preflight recursive and globally ledger-complete, rejected invisible or direction-spoofing metadata, and required an exact commit-preserving worker Git mirror.
- **Review 6 remediation**: Treated LF, CRLF, and lone CR uniformly during specification scanning and rejected U+2800 plus the explicit visually blank filler set in index metadata.
- **Relocation**: Moved two guides and four operator runbooks from top-level `guides/` and `ops/` into `project/guides/` and `project/operations/`; their concept conversion remains pending.
