# Pibo documentation update log

## 2026-09-05

- **Session Preview auto-open**: Extended [Session Live Previews](/specs/compute/session-live-previews.md#requirement-cmp-preview-006) with an authenticated Session-scoped creation stream so a newly created Preview opens the deduplicated Desktop Preview tab only for the still-selected Pibo Session; background Sessions, mobile layouts, and pre-existing Previews remain non-opening.
- **Compute worker Preview authentication**: Added `pibo preview expose-worker` and an internal proxy mode that preserves Preview credential isolation while allowing a validated local-auth Pibo compute worker to accept HTTP and WebSocket traffic without a second Google login; updated the [Session Live Previews and Safe Proxy specification](/specs/compute/session-live-previews.md).
- **Running-session forks**: Added capability-gated snapshot forks for completed user messages while Pi or Codex Native continues an active turn; the active message remains excluded, the source binding stays attached, and OMP retains idle-only fork semantics. Updated the [routing contract](/specs/gateway/routing-events-and-actions.md), [Pi adapter](/specs/runtime/pi-adapter.md), [Codex Native adapter](/specs/runtime/codex-native-adapter.md), and [OMP adapter](/specs/runtime/omp-adapter.md).
- **Preview production setup**: Added a supported production activation flow with exact wildcard-DNS guidance, bounded Caddy on-demand TLS authorization, public DNS/TLS/routing diagnostics, and the stable [Session Live Preview operations runbook](/project/session-live-previews.md).
- **Transition closure**: Published the [Session-native validation report](/reports/session-native-workflow-transition-validation-2026-09-05.md) with final-code root results (2,747 total; 2,742 passed; 0 failed; 5 skipped), standalone package installation, and headed real-execution evidence; archived the original directive body without changing the main checkout. No production deployment.

- **Session-native product model**: Replaced the current Projects product contract with [Rooms and normal Session trees](/specs/web/rooms-and-session-trees.md), including Room workspace defaults and canonical Session continuity.
- **Workflow ownership**: Recast [Workflow catalog and execution](/specs/orchestration/workflow-catalog-and-session-execution.md) around normal Pibo Sessions and one Workflow store, and aligned the Web UI, runtime, product-store, shell, projection, validation, and follow-up documents.
- **Navigation cleanup**: Removed the empty Projects parity change directory and regenerated its owning indexes.
- **Integrated traceability**: Rebound affected specifications to checked code commit `14cbaf0fd04cfa321674b570baeb40e543d957cb`, exact current symbols, and renamed tests; documented pending configured starts, canonical manual-run facts, inspection-derived headers, and recoverable two-target migration durability.
- **Validation evidence**: Recorded the passing clean build, all typechecks, 144 Workflow package tests, 56 focused migration/storage/router/header tests, 62 focused UI source tests, complete isolated root suite at `14cbaf0f` (2,744 total; 2,739 passed; 0 failed; 5 skipped), and completed headed Room, Workflow Session, desktop/mobile, and normal provider-backed Session checks.
- **Final manual Workflow acceptance**: Rebound changed contracts to `7ec71c2cca2108423002be0e7330d2a20c4c5b67` after upstream #911/#912 integration; documented the defaulted Run Room selector, optional API Room/workspace, write-permission and workspace-inheritance behavior, persistent pending explanation, actual `openai-codex` manual execution, canonical completed inspection, viewport fit, and clean `npm install --omit=dev` smoke. The final-code whole-root rerun remains underway and unclaimed.
- **Shared observation ownership**: Clarified that live agent observation and persisted debug inspection are adapters over one normalized observation/query core, so source-independent improvements apply to both unless a documented lifetime or durability constraint prevents parity.

## 2026-09-04

- **Observe regex filtering**: Added and review-hardened the optional `textRegex` contract for [delegated-agent observation](/specs/orchestration/subagents.md#requirement-orch-sub-005), preserving case-insensitive `textContains` and conjunctive behavior while representing empty normalized text as one record, bounding dense matching and streaming pagination, rejecting unsafe NUL boundaries, and resolving optional rg binaries only for regex use.
- **Runtime dependency refresh**: Updated the [Codex Native](/specs/runtime/codex-native-adapter.md), [OMP](/specs/runtime/omp-adapter.md), and [Pi](/specs/runtime/pi-adapter.md) contracts for validated Codex 0.153.2, OMP 18.1.10, and Pi 0.85.0 compatibility, including exact version diagnostics and the Pi server package required by the published 0.85.0 entrypoint.
- **Operator and architecture guidance**: Refreshed the [runtime operations guide](/project/agent-runtime-operations.md) and [adapter architecture record](/project/architecture/agent-runtime-adapters.md) to remove stale Codex 0.147.0 operational wording and record the current stable native-tool inspection boundary.

## 2026-09-03

- **Payload identity correction**: Updated the [product store and payload contract](/specs/data/product-store-history-and-read-models.md#requirement-wp02-data-store-003) to isolate equal bytes with different content types or retention classes, preserve indexed semantic deduplication, and migrate legacy SHA-only uniqueness without rewriting payload files.
- **Security contract correction**: Narrowed the [sensitive-output redaction policy](/specs/security/private-files-and-http.md#requirement-sec-file-004-narrow-credential-redaction-protects-identified-output-sinks-without-treating-product-identifiers-as-secrets) to strong credential signals, preserved ordinary `pibo-*` identifiers and paths, and recorded the pre-persistence threat-model decision and sink-coverage limit.

## 2026-09-02

- **Project documentation rules**: Replaced migration-era instructions in `AGENTS.md` with concise OKF v0.2 guidance that delegates detailed workflow rules to `maintain-okf-docs` and the documentation profile.
- **Integration correction**: Converted the three sidebar browser-tab validation reports to conformant OKF concepts and moved the completed inventory, specification/design, and task ledger into [legacy change history](/legacy/specs/changes/sidebar-browser-tabs/).

## 2026-09-01

- **Upstream refresh**: Merged `upstream/dev` at `39090b8850758293e69380a52bb7498d7c955bc2` into the accepted migration chain, classified all six upstream documentation modifications, preserved the historical agent-management body, and folded retired capability-document deltas into canonical current specifications.
- **Current-contract reconciliation**: Refreshed canonical specifications and traceability for durable output sequencing, retries, integrity repair, compute and browser lifecycle, signals and routing, runtime workers, resources, Project lifecycle, and Chat/CLI accessibility against current source and tests.
- **Package closure**: Updated strict-mode validation as the default documentation gate and retained package-owned compute-image inputs plus actual-archive link-closure coverage.
- **Migration closure**: Reconstructed the complete 762-record migration ledger with zero pending records, retired 13 superseded README controls, and generated the final 106-index navigation closure.
- **Evidence publication**: Registered 61 accepted C-REPORTS Evidence Reports in the immutable evidence manifest with hashes over their complete published files.
- **Independent audit closure**: Re-resolved all 44 upstream-impacted normative specifications at `39090b8850758293e69380a52bb7498d7c955bc2`, corrected stale pre-refresh execution accounting and one renamed schema-migration test locator, and retained explicit real-path, browser, external-provider, Windows, publication, and Pibo2 evidence boundaries.

## 2026-08-31

- **Validator/profile correction**: Corrected the [preserved-body link rule](/project/documentation-profile.md#preserved-body-link-exception) so an exact raw relative target with literal dot segments is suppressible only when inspection observes the same in-bundle missing link, and recorded the narrow future-correction authority in the [migration plan](/plans/okf-migration.md#standing-authorization-for-trivial-corrections).

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
