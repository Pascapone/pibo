---
type: "Documentation Profile"
title: "Pibo OKF documentation profile"
description: "Defines Pibo's taxonomy, authority, lifecycle, provenance, migration, and validation rules for the docs bundle."
tags: ["documentation-governance", "okf"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T03:21:15Z"
sources:
  - id: "okf-v0.2"
    resource: "https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/3fcbb9f828c2f23d109c855ee403c3a4c81f3a96/okf/SPEC.md"
    title: "Open Knowledge Format v0.2"
    sha256_canonical_lf: "5a3311d270bebb16d558010e75064f5b75323f284992641732b1c8097511f948"
  - id: "okf-v0.2-controller-copy"
    resource: "controller-local:/root/.pibo/user-skills/maintain-okf-docs/references/okf-v0.2-spec.md"
    title: "Whitespace-normalized OKF v0.2 audit input"
    sha256: "fadb0acfc0e7372eb39fb7ede62a1d45f2427a996660914c10ca3fef1fe1f93e"
    relation: "Semantically identical after four trailing-space removals; not byte-identical to the pinned upstream file."
---

# Purpose and scope

This profile governs the OKF bundle rooted at `docs/`. Every non-reserved Markdown file under that root is a concept. Markdown outside `docs/` is outside the bundle and must be either a justified host-owned file or a pending migration input while migration mode is active. Pibo preserves the five top-level roots required by `AGENTS.md`: `project/`, `specs/`, `plans/`, `reports/`, and `legacy/`.

This concept separates two rule sets:

- **OKF v0.2 core** requires parseable YAML frontmatter with a non-empty `type` on concepts. Exact `---` delimiter lines accept LF, CRLF, lone CR, or mixed Markdown line endings; parsing preserves the original body bytes. OKF reserves `index.md` and `log.md` and defines their structure. The root index may declare `okf_version: "0.2"`.
- **Pibo policy** adds the required fields, taxonomy, authority model, naming, traceability, link integrity, index coverage, evidence controls, host exceptions, and migration gates below. These additions are not OKF core requirements.[^okf-v0.2]

The pinned upstream specification has canonical-LF SHA-256 `5a3311d270bebb16d558010e75064f5b75323f284992641732b1c8097511f948`. The controller-local audit input has SHA-256 `fadb0acfc0e7372eb39fb7ede62a1d45f2427a996660914c10ca3fef1fe1f93e`; it removes trailing spaces from four prose lines. The copies are semantically identical after whitespace normalization, but they are not byte-identical.[^okf-v0.2-controller-copy]

[^okf-v0.2]: Open Knowledge Format v0.2 at `GoogleCloudPlatform/knowledge-catalog`, commit `3fcbb9f828c2f23d109c855ee403c3a4c81f3a96`, path `okf/SPEC.md`.
[^okf-v0.2-controller-copy]: Controller-local copy used by the foundation audits.

# Required Pibo fields

Every Pibo concept requires these fields:

| Field | Pibo rule |
|---|---|
| `type` | One allowed type from the taxonomy below. |
| `title` | A non-empty display name. |
| `description` | One non-empty sentence. |
| `tags` | A non-empty list of non-empty strings. |
| `status` | `draft`, `stable`, or `deprecated`; this field records lifecycle only. |
| `authority` | One allowed Pibo authority value. |
| `generated` | A mapping with actor `by` and ISO 8601 datetime `at`. |

Unknown OKF or project extension fields must survive round trips. A consumer may not reject a concept only because it carries an unknown extension.

`title`, `description`, and every `tags` value are trimmed, non-empty, single-line strings. CR, LF, Unicode line separators, controls, format characters, bidi controls, default-ignorable code points, U+2800 BRAILLE PATTERN BLANK, and the visually blank fillers U+115F, U+1160, U+17B4, U+17B5, U+3164, and U+FFA0 are invalid anywhere in a value. After NFC normalization and removal of whitespace, combining marks, default-ignorable characters, and those explicit blank fillers, each value must still contain visible content. Normal visible Unicode, including normalized accented text, remains valid. These rules prevent hidden or direction-spoofed labels and keep generated indexes to exactly one bounded list entry per concept.

# Taxonomy and authority

The first directory below `docs/` determines the broad documentation class. Nested directories and concept types express the knowledge function.

| Directory | Allowed types | Required authority | Claims owned |
|---|---|---|---|
| `project/` | `Documentation Profile`, `Architecture`, `Design System`, `Decision Record`, `Guide`, `Runbook`, `Reference`, `Status` | Type-specific | Current project governance, architecture, decisions, guides, operations, references, and status. |
| `specs/` | `Specification` | `normative` | Implemented current contracts only. |
| `plans/` | `Plan`, `Change Proposal`, `Technical Design`, `Product Requirement`, `Task Ledger` | Type-specific | Intended work, acceptance, risks, rollback, supporting proposals, and designs. |
| `reports/` | `Evidence Report`, `Validation Report`, `Investigation Report`, `Incident Report`, `Coverage Report`, `Review Record`, `Release Record`, `Research`, `Feedback`, `Reference`, `Status` | Type-specific | Investigations, validation, incidents, research, feedback, evidence, and generated report artifacts. |
| `legacy/` | `Historical Record` | `historical` | Superseded narrative, completed change packets, closed plans, and handoffs. |

Allowed authority values are `normative`, `directive`, `supporting`, `source`, `evidentiary`, `informative`, and `historical`. `authority` is a Pibo extension. The provisional audit values `code-derived`, `evidence`, and `operational` are invalid; migration maps them to `normative`, `evidentiary`, and `directive`, respectively.

A current specification describes implemented behavior only. Desired or unimplemented behavior belongs in a plan. One public behavior, type, command, route, store or table, and invariant has one canonical normative owner. Code and current tests win when a document conflicts with implementation.

Type-specific authorities are bounded. `Documentation Profile` and `Specification` are `normative`. `Plan`, `Product Requirement`, `Task Ledger`, `Guide`, and `Runbook` are `directive`. `Change Proposal`, `Technical Design`, and `Decision Record` are `supporting`. `Architecture` may be `normative`, `supporting`, or `informative`; `Design System` may be `normative` or `supporting`. `Feedback` is `source`; `Evidence Report`, `Validation Report`, `Coverage Report`, and `Release Record` are `evidentiary`; `Investigation Report` and `Incident Report` may be `evidentiary` or `informative`; `Review Record` may be `evidentiary`, `informative`, or `source`; `Research` and `Status` are `informative`; `Historical Record` is `historical`; and `Reference` is `source` or `informative`.

The existing `specs/changes/` tree is migration input. Fold implemented deltas into canonical specifications, move genuinely unimplemented work to `plans/`, and move completed packets to `legacy/`. A change packet never remains a competing current authority.

# Lifecycle, provenance, and verification

- Use `status` only for OKF lifecycle. Put implementation progress, approval, test outcomes, and blockers in the body or a domain field.
- Change `generated.at` only after a meaningful content or metadata change.
- Use OKF actors: `<producer>/<version>` for an agent or tool, `human:<id>` for a person, and `process:<id>` for an automated process.
- Add `verified` only after checking the concept against named sources or the described resource. Machine verification is not human review. Each event requires `by` and ISO 8601 `at`.
- Derived concepts declare `sources`. Every source entry requires `resource`; cited sources have stable `id` values joined to body footnotes.
- Local paths declared by `sources`, specification traceability, computations, executors, or attesters must exist. External URLs and explicit scope descriptors are exempt from path existence checks.
- Deprecated concepts link to a current successor when one exists. Historical concepts normally remain unverified unless migration checks fidelity to the original.

## Preserved-body link exception

Strict mode normally rejects every unresolved local link. One narrow exception exists for an envelope-preserved body whose legacy bytes must remain unchanged. The concept must use `status: "deprecated"` and `authority: "historical"` or `"evidentiary"`, and must declare:

```yaml
preserved_body:
  source_path: "docs/legacy-source.md"
  source_sha256: "<lowercase 64-hex SHA-256 of the exact body bytes after frontmatter>"
  unresolved_links:
    - target: "/removed-file.md"
      reason: "The preserved source referenced a file that is not retained."
```

`source_path` is one exact repository-relative Markdown lineage path, not a directory or pattern. `source_sha256` is the immutable body hash: strict mode hashes every byte after the frontmatter envelope and rejects a mismatch. The exception may suppress only an exact `PIBO_LINK_MISSING` whose resolved target remains inside `docs/`. Escape, invalid-encoding, external, traversal, broad, directory, and every other link failure are never suppressible. Declared targets may not contain `.` or `..` traversal segments. Each missing local link target must appear exactly, with a non-empty reason, in `unresolved_links`; strict mode rejects undeclared failures, duplicate or broad targets, and stale entries that no longer fail. Current or editable concepts cannot use this exception. Changing the body, including adding or repairing a link, requires normal migration into an editable concept instead of updating this envelope.

# Specification traceability

Every `Specification` carries stable requirement IDs in the body and this frontmatter extension:

```yaml
traceability:
  commit: "<40-character Git commit>"
  requirements:
    - id: "PROD-CTX-001"
      status: "implemented"
      sources:
        - path: "src/example.ts"
          symbol: "publicSurface"
      tests:
        - path: "test/example.test.mjs"
          name: "proves the public behavior"
      public: ["command: pibo example"]
      failures: ["Invalid input fails without mutation."]
      confidence: "high"
```

`traceability.commit` must identify a real commit in the current repository. Every source and test path is a normalized exact repository-relative file path: absolute paths, empty or `.`/`..` segments, globs, directories, control characters, and symlink escapes are prohibited. Evidence paths must be regular files at `traceability.commit`, even when the working tree differs. Every source needs a non-empty `symbol`, unless the requirement declares a non-empty approved `public` surface list; every test needs a non-empty `name`. `public`, `failures`, and a present `follow_up` contain only trimmed non-empty strings.

Each requirement ID has at least two semantic uppercase components before a numeric suffix of three or more digits. Valid forms include `PROD-CTX-001`, `WP02-DATA-STORE-001`, and `PIBO-ROUTING-REQ-001`; `REQ` is an optional component, not a required literal. Bare `REQ-001`, one-component `CTX-001`, lowercase, unprefixed, and malformed forms are invalid. Each requirement uses `status: implemented`, names source evidence, names tests or sets `source_inspected: true` with a non-empty follow-up action, describes failure or security behavior, and records `high`, `medium`, or `low` confidence. IDs must be unique across current specifications.

A formal body requirement uses one fence-aware ATX heading whose content starts exactly with the case-sensitive marker `Requirement:`. The first complete token after the marker is the ID. Write it as raw, unformatted ASCII, then separate an optional prose title with a colon or whitespace:

```markdown
## Requirement: PROD-CTX-001: Product context is static
## Requirement: WP02-DATA-STORE-001 Storage is durable
```

Every frontmatter requirement ID has exactly one explicit heading. A valid explicit heading has exactly one frontmatter owner. Missing, duplicate, unbound, or malformed explicit headings fail Pibo-profile validation. Markdown wrappers, inline code, HTML, links, escapes, trailing punctuation or dashes, Unicode hyphens or confusables, invisible or control characters, short suffixes, malformed separators, and missing tokens are invalid in the ID position. Plain headings—including `RFC-9110 semantics`, `ISO-8601 timestamps`, `HTTP-404 responses`, dates, prose, and unmarked ID-looking text—are ordinary headings, not formal requirements.

Current `Specification` bodies cannot contain raw `<!--` or `-->` delimiters outside fenced code. The validator rejects these delimiters even when they appear in inline code, escaped text, an ID, or a multiline-comment transition. Authors use visible prose or fenced examples instead. Requirement parsing reads each raw non-fenced line without removing, joining, or reinterpreting comment fragments. LF, CRLF, and lone CR are equivalent line endings for this scan. Fence recognition follows CommonMark 0.31.2: an opener uses at least three matching backticks or tildes after at most three spaces; a backtick opener is invalid when its info string contains a backtick; and a closer uses the same character, at least the opener length, and only trailing spaces or tabs. Only content inside a valid fence is ignored.

# Naming, links, indexes, and logs

- Concept filenames use lowercase kebab-case and `.md`. Only `index.md` and `log.md` are reserved. Do not create top-level documentation roots outside the five approved roots.
- Prefer bundle-relative links beginning with `/` in specifications and guides. Relative concept links remain valid.
- Strict validation rejects unresolved internal Markdown links. Migration mode permits broken links only in pending files recorded by the ledger.
- Every directory containing bundle Markdown or bundle subdirectories has an `index.md`. An index has no frontmatter except the root `okf_version`, and it lists every direct child concept and bundle subdirectory once.
- Migration validation requires a complete index chain for every conformant concept. The concept's directory and each ancestor through `docs/` must have a `reserved` ledger record and must list its direct concept or child directory exactly once. This gate applies while strict mode remains red for pending corpus debt.
- `npm run docs:indexes:write` regenerates every ledger-reserved index from direct concept metadata and managed child directories. Before deriving managed indexes, preflight recursively walks the real bundle and requires every Markdown path to be a regular, non-symlinked file with exactly one ledger owner. Every docs ledger path must exist. Every state must be `pending`, `conformant`, `reserved`, or `host-exception`; host exceptions are invalid inside the bundle; every `index.md` and `log.md` stays `reserved`; and `reserved` applies only to those filenames. Only exact ordinary `pending` files are skipped.
- Index preflight parses and validates every `conformant` concept, requires its complete reserved index chain through the bundle root, and caches safe metadata for rendering. `type` must match the ledger; `title`, `description`, and every non-empty tag must satisfy the visible single-line rule. Missing or duplicate ownership, incomplete index ancestry, missing current paths, invalid states, malformed metadata, and non-regular or symlinked Markdown fail globally before any output is rendered or written.
- Index preflight resolves the real `docs/` root and rejects symlinked or non-directory parents, symlinked or non-regular managed targets, and physical paths outside the bundle before reads and again before writes. Every ledger-declared current Markdown path, including a managed index, must already exist.
- Generated titles and descriptions are visible plain text. The renderer HTML-encodes `&`, `<`, and `>` and entity-escapes Markdown punctuation so comments, tags, links, emphasis, code, and entity-like input cannot alter list structure or hide another entry. All managed outputs render successfully before write mode changes any file. Generation sorts deterministically, removes stale entries, avoids no-op writes, and never creates or rewrites `README.md`. Use `npm run docs:indexes:check` for a deterministic non-writing check.
- The bundle has a top-level `log.md`. OKF core requires every present log to have a title and at least one descending `YYYY-MM-DD` section containing a list entry. It normalizes LF, CRLF, lone CR, and mixed line endings and ignores content inside valid CommonMark backtick or tilde fences. Pibo additionally requires the root log, keeps its semantic entries explicit, and links changed concepts when practical.
- Log entries remain explicit because they summarize the meaning of a change; filenames and frontmatter cannot generate that prose safely. Update the relevant log deliberately and run `npm run docs:log:check`.
- Update the owning concept, regenerate its indexes, and update the relevant log in one change.

# Evidence immutability

A stable `Evidence Report` requires `evidence.id` and `evidence.published_at`. Its bytes are registered by SHA-256 in `docs/reports/artifacts/okf-migration/evidence-manifest.json`. Migration and strict validation reject missing, malformed, duplicate, stale, or orphaned manifest entries. They inspect every manifest path component without following symlinks before reading the file. Never edit published evidence in place; corrections and reruns receive a new ID and concept path and link the earlier publication.

Draft workbench output is not published evidence and may be replaced or deleted. A report becomes evidence only through deliberate publication under `docs/reports/`, normally in a nested `evidence/` directory.

# Host-owned exceptions

Do not add OKF frontmatter to files whose exact path or native format belongs to another host. This includes:

- root host contracts and landing files such as `AGENTS.md`, `GLOSSARY.md`, `DESIGN.md`, and `README.md`;
- `SKILL.md` packages and their bundled references, fixtures, or colocated readmes;
- runtime-loaded prompts under `context/`;
- package, source-app, example, and test-fixture readmes whose location is part of their interface.

The exact normative exception list is the set of ledger entries with `state: "host-exception"` in `docs/project/okf-migration-ledger.json`. Every entry requires a specific reason. The validator rejects exceptions inside `docs/`, broad patterns, missing files, and unlisted Markdown additions.

Before reading any repository Markdown ledger path, validation walks every path component with non-following filesystem inspection. Ledger and evidence-manifest reads are additionally bound to opened directory and file descriptors: leaves are opened without following symlinks, bytes are consumed from the opened file, parent and leaf identities and types are compared throughout the operation, and every descriptor is closed. Index generation applies the same stable-read rule to the ledger. Paths must remain inside the repository and end at a regular, non-symlinked file; symlinked parents or leaves, directories, devices, missing paths, traversal, and identity or type changes receive structured diagnostics without parsing alternate bytes.

# Migration behavior

The [migration plan](/plans/okf-migration.md) controls staged conversion. During migration:

1. Every repository Markdown path has exactly one ledger record.
2. A record is `pending`, `conformant`, `reserved`, or `host-exception`.
3. Current paths and relocated `source_path` values are exact and unique. Pending destinations are unique unless an explicit reserved-file replacement merges a `README.md` into an already owned `index.md`; all destinations remain inside the five-root taxonomy.
4. `conformant` metadata must match the file, `reserved` files must have reserved structure, and host exceptions must be exact existing paths outside `docs/` with specific reasons. Globs and directory-wide exceptions are invalid.
5. New documentation enters the bundle in conformant form and is added through generated indexes and an explicit log update. New host-owned Markdown requires an exact justified exception.
6. A pending file keeps its original bytes until its owning migration wave moves, splits, or rewrites it. Migration validation enumerates the complete, non-shallow ancestry reachable from the validated revision and treats a commit as an introduction only when it contains a regular ledger blob and none of its parents contains that path. The ledger must have exactly one such introduction commit with exactly one resolvable parent, and `base_commit` must equal that parent. The validator uses the derived parent—not the mutable ledger value—to resolve and hash every ordinary pending blob and every approved relocated `source_path`. Default Git path-history simplification, later rebinding, and independently merged introductions cannot bless changed pending bytes. Normal uncommitted, amended, linear multi-commit, and ordinary merge packages retain the original anchor.
7. Moving completed change material to `legacy/` follows consolidation into a canonical current specification. A move must not discard implemented facts.
8. Migration mode remains the CI-facing default only while pending records exist. Strict mode is the final gate and must remain red until all pending ownership is resolved.

# Validation

Run these exact commands from the repository root:

```text
npm run docs:validate
npm run docs:validate:okf
npm run docs:validate:migration
npm run docs:indexes:check
npm run docs:log:check
npm run docs:validator:test
npm run docs:validate:strict
```

`docs:validate:okf` is ledger-independent OKF v0.2 core validation. It checks only concept frontmatter, non-empty `type`, and the normative structure of present `index.md` and `log.md` files, including exact line-ending-independent frontmatter envelopes and fence-aware date-grouped log list entries; unknown concept types and keys, missing optional fields or reserved files, and broken links do not fail it. `docs:validate` aliases Pibo migration mode during the controlled migration. `docs:validate:migration` enforces complete-history pending lineage, descriptor-stable control-file reads, safe ledger paths, complete conformant index chains, and stable-evidence registration while global strict debt remains. Migration validation, index checking, log checking, and focused tests must pass on every migration commit. `docs:validate:strict` must fail while pending entries or profile violations remain; never weaken it to make an incomplete corpus pass.
