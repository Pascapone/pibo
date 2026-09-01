---
type: "Specification"
title: "Skills and Managed Context Files"
description: "Defines the implemented skills and managed context files contract and its current ownership, security, and verification boundaries."
tags: ["resources", "security-boundaries"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T21:32:28Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for SPC-RES-003"
implementation:
  state: "current"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-03-RESOURCES-SECURITY"
  source_evidence: "performed"
  focused_test_execution: "performed in Docker: 1,071 affected tests passed; full suite 2,638 passed, 0 failed, 5 skipped"
  build_and_typecheck_execution: "performed: npm run typecheck and npm run build passed"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "RES-SKC-001"
      status: "implemented"
      sources:
        - path: "src/user-skills/manager.ts"
          symbol: "ScopedUserSkillManager"
        - path: "src/user-skills/manager.ts"
          symbol: "compareScopedUserSkills"
        - path: "src/user-skills/store.ts"
          symbol: "createUserSkill"
        - path: "src/user-skills/store.ts"
          symbol: "updateUserSkill"
        - path: "src/user-skills/store.ts"
          symbol: "parseSkillMd"
        - path: "src/user-skills/installer.ts"
          symbol: "parseSkillUrl"
        - path: "src/user-skills/installer.ts"
          symbol: "installSkillFromUrl"
        - path: "src/user-skills/installer.ts"
          symbol: "downloadDirectory"
        - path: "src/skills/cli.ts"
          symbol: "runSkillsCli"
      tests:
        - path: "test/user-skills.test.mjs"
          name: "user skill descriptions are stored in SKILL.md frontmatter"
        - path: "test/user-skills.test.mjs"
          name: "user skill names reject duplicates and invalid values"
        - path: "test/user-skills.test.mjs"
          name: "invalid user skill stores fail before returning sanitized entries"
        - path: "test/skills-cli.test.mjs"
          name: "skills catalog lists built-in skills"
        - path: "test/skills-cli.test.mjs"
          name: "skills CLI supports workspace-local skill scope"
        - path: "test/user-skills.test.mjs"
          name: "user skills can be renamed, toggled, sorted, and deleted"
      public:
        - "pibo skills and user-skill APIs"
        - "context_files, context_file_revisions, context_file_manual_revisions, context_file_store_meta"
        - "Context Files app and editor API"
        - "Skills are SKILL.md packages; user skills can be installed/managed; context files have catalog, revisions, SSE, API, and editor app."
      failures:
        - "Implemented installer checks are limited to supported source forms and non-execution during install; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
        - "Supported source forms and same-origin mutations apply; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
      confidence: "high"
    - id: "RES-SKC-002"
      status: "implemented"
      sources:
        - path: "src/plugins/context-files-store.ts"
          symbol: "ContextFileMetadataStore"
        - path: "src/plugins/context-files.ts"
          symbol: "ContextFileService"
        - path: "src/plugins/context-files.ts"
          symbol: "createPiboContextFilesPlugin"
      tests:
        - path: "test/context-files-web.test.mjs"
          name: "context files autosave working content but create named revisions only on manual request"
        - path: "test/context-files-web.test.mjs"
          name: "manual context file revisions persist across store restarts"
        - path: "test/context-files-web.test.mjs"
          name: "manual-revisions v1 storage upgrades transactionally to the compatible schema"
        - path: "test/context-files-web.test.mjs"
          name: "context files revision migration preserves current content and old-writer compatibility"
        - path: "test/context-files-web.test.mjs"
          name: "context files migration retries managed file restoration before recording schema completion"
      public:
        - "pibo skills and user-skill APIs"
        - "context_files, context_file_revisions, context_file_manual_revisions, context_file_store_meta"
        - "Context Files app and editor API"
        - "Skills are SKILL.md packages; user skills can be installed/managed; context files have catalog, revisions, SSE, API, and editor app."
      failures:
        - "Implemented installer checks are limited to supported source forms and non-execution during install; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
        - "Supported source forms and same-origin mutations apply; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
      confidence: "high"
    - id: "RES-SKC-003"
      status: "implemented"
      sources:
        - path: "src/plugins/context-files.ts"
          symbol: "ContextFileService"
        - path: "src/plugins/context-files.ts"
          symbol: "requireManagedRecord"
      tests:
        - path: "test/context-files-web.test.mjs"
          name: "context files refuses to migrate storage owned by another live gateway"
        - path: "test/context-files-web.test.mjs"
          name: "context files web app migrates legacy managed files and preserves orphaned working copies"
        - path: "test/context-files-web.test.mjs"
          name: "context files polling reports persistent storage failures once without crashing the host"
      public:
        - "pibo skills and user-skill APIs"
        - "context_files, context_file_revisions, context_file_manual_revisions, context_file_store_meta"
        - "Context Files app and editor API"
        - "Skills are SKILL.md packages; user skills can be installed/managed; context files have catalog, revisions, SSE, API, and editor app."
      failures:
        - "Implemented installer checks are limited to supported source forms and non-execution during install; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
        - "Supported source forms and same-origin mutations apply; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
      confidence: "high"
    - id: "RES-SKC-004"
      status: "implemented"
      sources:
        - path: "src/core/profiles.ts"
          symbol: "InitialSessionContext"
        - path: "src/core/profiles.ts"
          symbol: "SkillProfile"
        - path: "src/core/profiles.ts"
          symbol: "ContextFileProfile"
        - path: "src/agent-runtime/resource-service.ts"
          symbol: "PiboRuntimeResourceService"
        - path: "src/agent-runtime/resource-service.ts"
          symbol: "PiboRuntimeResourceSession"
      tests:
        - path: "test/agent-profiles.test.mjs"
          name: "custom agent profiles skip unknown context file references"
        - path: "test/agent-profiles.test.mjs"
          name: "custom agent profiles skip unknown skill references"
      public:
        - "pibo skills and user-skill APIs"
        - "context_files, context_file_revisions, context_file_manual_revisions, context_file_store_meta"
        - "Context Files app and editor API"
        - "Skills are SKILL.md packages; user skills can be installed/managed; context files have catalog, revisions, SSE, API, and editor app."
      failures:
        - "Implemented installer checks are limited to supported source forms and non-execution during install; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
        - "Supported source forms and same-origin mutations apply; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
      confidence: "medium"
verification:
  required_evidence_classes:
    - "source inspection"
    - "focused tests"
    - "build/package checks"
    - "local real-path/PTY/headful browser validation"
    - "external-provider/Pibo2 acceptance"
  performed:
    - evidence_class: "source inspection"
      status: "performed"
      detail: "Exact source files, symbols, test files, and test names were reconciled to upstream/dev refresh commit 39090b8850758293e69380a52bb7498d7c955bc2."
    - evidence_class: "focused tests"
      status: "performed"
      detail: "The affected-test selection passed 1,071 tests in the isolated worker. The clean full suite passed 2,638 tests with 0 failures and 5 skips."
    - evidence_class: "build/package checks"
      status: "performed"
      detail: "npm run typecheck and npm run build passed; build emitted existing Vite chunk-size warnings only."
  unperformed:
    - evidence_class: "local real-path/PTY/headful browser validation"
      status: "unperformed"
      reason: "No browser, PTY, or real-path acceptance flow was performed for this package."
    - evidence_class: "external-provider/Pibo2 acceptance"
      status: "unperformed"
      reason: "No real provider, external MCP, package-manager, host lifecycle, or Pibo2 acceptance was performed."
stale_claims_to_reject:
  - id: "WP03-STALE-001"
    claim: "User-skill URL install rejects symlink escapes, oversized trees, excessive depth, and untrusted content before persistence."
    reason: "The installer restricts source forms and does not execute downloaded content, but has no explicit aggregate size/depth/path-containment/signature/trust checks."
  - id: "WP03-STALE-002"
    claim: "Selected skills/context/MCP/Pi packages are loaded entirely by the resource specs."
    reason: "Catalog and selection semantics are here; generation materialization is RUN-003 and Pi adapter loading is RUN-004."
open_evidence_gaps:
  - id: "WP03-GAP-001"
    specs: ["SPC-RES-003"]
    gap: "No focused test proves URL-installer aggregate size/depth/path containment or explicit trust policy; those controls are not implemented in the inspected source."
  - id: "WP03-GAP-002"
    specs: ["SPC-RES-003", "SPC-RES-004"]
    gap: "Selected-only generation delivery is primarily tested by runtime-package suites outside WP-03; add cross-spec links and focused trace evidence rather than duplicating mechanics."
  - id: "WP03-GAP-009"
    specs: ["SPC-RES-001", "SPC-RES-002", "SPC-RES-003", "SPC-RES-004", "SPC-RES-005", "SPC-SEC-001", "SPC-SEC-002", "SPC-SEC-003"]
    gap: "No real-path, browser, external-provider, package-manager, host-lifecycle, Windows, or Pibo2 acceptance was performed; deterministic tests, build, typecheck, and package checks are recorded in the implementation report."
---

# Scope and exclusions

Built-in/user SKILL.md packages, install/manage operations, context-file catalog/revisions/API/SSE/editor, and read-only plugin file boundaries.

This specification records current behavior only. It does not authorize unimplemented hardening, duplicate the linked runtime/gateway/data owner, or convert unperformed validation into evidence.

# Current behavior and public surfaces

The implementation state is current at the exact accepted upstream/dev refresh traceability commit `39090b8850758293e69380a52bb7498d7c955bc2`.

Implemented behavior:
- "pibo skills and user-skill APIs"
- "context_files, context_file_revisions, context_file_manual_revisions, context_file_store_meta"
- "Context Files app and editor API"
- "Skills are SKILL.md packages; user skills can be installed/managed; context files have catalog, revisions, SSE, API, and editor app."
- "Built-in skills are package resources; user skills have global and workspace scopes, with workspace taking precedence for same-id resolution and sorting before global for equal names."
- "User-skill CRUD validates names and SKILL.md metadata; URL install accepts supported skills.sh/GitHub/shorthand forms and downloads without executing content during installation."
- "ContextFileService persists managed files, working content, immutable/manual revisions, source state, and schema ownership; polling emits bounded failures and supports SSE/product events."
- "Plugin-provided context files are read-only until copied/linked into managed storage; optimistic version conflicts return 409."

Public surfaces:
- "pibo skills and user-skill APIs"
- "context_files, context_file_revisions, context_file_manual_revisions, context_file_store_meta"
- "Context Files app and editor API"
- "Skills are SKILL.md packages; user skills can be installed/managed; context files have catalog, revisions, SSE, API, and editor app."

# State, lifecycle, and invariants

- "Plugin-provided files are read-only unless managed; runtime delivery copies selected content only."
- "Plugin files are read-only unless managed; selected skill/context content is copied only into runtime generations."
- "Managed context-file migrations are transactional and refuse storage owned by another live gateway."
- "User-skill rename preserves the exact instruction body while updating frontmatter identity. Context-file migration retries managed-file restoration before recording schema completion, so a transient restoration failure cannot permanently bless missing managed content."
- "Autosave changes working content; only explicit manual revision creation appends named immutable revisions."
- "Current user-skill URL installation has no explicit aggregate byte/depth/path-containment/signature/trust limit; do not claim those defenses exist."
- "Runtime selected-only materialization belongs to RUN-003; this spec owns selection/catalog inputs and context persistence."

Persistence and lifecycle state: User skill directories and context file/revision SQLite store.

# Requirements and invariants

## Requirement: RES-SKC-001: Discover built-in and enabled user SKILL

Discover built-in and enabled user SKILL.md packages, resolve same-id workspace skills before global skills, and support validated CRUD plus supported URL-source installation without executing downloaded skill content during install.

**Implementation state:** `implemented_at_baseline_with_install_hardening_gap` at `39090b8850758293e69380a52bb7498d7c955bc2`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/user-skills/manager.ts` — `ScopedUserSkillManager`
- `src/user-skills/manager.ts` — `compareScopedUserSkills`
- `src/user-skills/store.ts` — `createUserSkill`
- `src/user-skills/store.ts` — `updateUserSkill`
- `src/user-skills/store.ts` — `parseSkillMd`
- `src/user-skills/installer.ts` — `parseSkillUrl`
- `src/user-skills/installer.ts` — `installSkillFromUrl`
- `src/user-skills/installer.ts` — `downloadDirectory`
- `src/skills/cli.ts` — `runSkillsCli`

**Named test traceability:**
- `test/user-skills.test.mjs` — `user skill descriptions are stored in SKILL.md frontmatter`
- `test/user-skills.test.mjs` — `user skill names reject duplicates and invalid values`
- `test/user-skills.test.mjs` — `invalid user skill stores fail before returning sanitized entries`
- `test/skills-cli.test.mjs` — `skills catalog lists built-in skills`
- `test/skills-cli.test.mjs` — `skills CLI supports workspace-local skill scope`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-SKC-002: Persist managed context-file catalog records, working content, source state, immutable/manual revisions, and compatible schema migrations transactionally

Persist managed context-file catalog records, working content, source state, immutable/manual revisions, and compatible schema migrations transactionally.

**Implementation state:** `implemented_at_baseline` at `39090b8850758293e69380a52bb7498d7c955bc2`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/plugins/context-files-store.ts` — `ContextFileMetadataStore`
- `src/plugins/context-files.ts` — `ContextFileService`
- `src/plugins/context-files.ts` — `createPiboContextFilesPlugin`

**Named test traceability:**
- `test/context-files-web.test.mjs` — `context files autosave working content but create named revisions only on manual request`
- `test/context-files-web.test.mjs` — `manual context file revisions persist across store restarts`
- `test/context-files-web.test.mjs` — `manual-revisions v1 storage upgrades transactionally to the compatible schema`
- `test/context-files-web.test.mjs` — `context files revision migration preserves current content and old-writer compatibility`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-SKC-003: Treat plugin context files as read-only source material, permit edits only for managed copies, reject optimistic-version conflicts, and refuse migration storage owned by another live gateway

Treat plugin context files as read-only source material, permit edits only for managed copies, reject optimistic-version conflicts, and refuse migration storage owned by another live gateway.

**Implementation state:** `implemented_at_baseline` at `39090b8850758293e69380a52bb7498d7c955bc2`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/plugins/context-files.ts` — `ContextFileService`
- `src/plugins/context-files.ts` — `requireManagedRecord`

**Named test traceability:**
- `test/context-files-web.test.mjs` — `context files refuses to migrate storage owned by another live gateway`
- `test/context-files-web.test.mjs` — `context files web app migrates legacy managed files and preserves orphaned working copies`
- `test/context-files-web.test.mjs` — `context files polling reports persistent storage failures once without crashing the host`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-SKC-004: Expose stable skill/context contribution identities and selected profile keys to the runtime resource service; require RUN-003 to materialize only the generation's selected contributions and report missing selections diagnostically

Expose stable skill/context contribution identities and selected profile keys to the runtime resource service; require RUN-003 to materialize only the generation's selected contributions and report missing selections diagnostically.

**Implementation state:** `implemented_shared_boundary; direct focused WP-03 test gap` at `39090b8850758293e69380a52bb7498d7c955bc2`.

**Confidence:** `medium`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/core/profiles.ts` — `InitialSessionContext`
- `src/core/profiles.ts` — `SkillProfile`
- `src/core/profiles.ts` — `ContextFileProfile`
- `src/agent-runtime/resource-service.ts` — `PiboRuntimeResourceService`
- `src/agent-runtime/resource-service.ts` — `PiboRuntimeResourceSession`

**Named test traceability:**
- `test/agent-profiles.test.mjs` — `custom agent profiles skip unknown context file references`
- `test/agent-profiles.test.mjs` — `custom agent profiles skip unknown skill references`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


# Interfaces and ownership

Capability IDs: "pibo.resources.skills-context".

Exact source files inspected for this owner:
- "src/agent-runtime/resource-service.ts"
- "src/core/profiles.ts"
- "src/plugins/context-files-store.ts"
- "src/plugins/context-files.ts"
- "src/skills/cli.ts"
- "src/user-skills/installer.ts"
- "src/user-skills/manager.ts"
- "src/user-skills/store.ts"

Related ownership boundaries:
- SPC-RUN-003: [generation-resources-and-portable-tools.md](/specs/runtime/generation-resources-and-portable-tools.md) owns the linked contract; this specification does not duplicate it.
- SPC-SEC-002: [private-files-and-http.md](/specs/security/private-files-and-http.md) owns the linked contract; this specification does not duplicate it.

The security policy/mechanics split is explicit: this specification defines the resource or security decision, while linked runtime, gateway, data, web, orchestration, compute, and operator owners provide their execution mechanics.

# Failure, security, privacy, and compatibility behavior

- "Implemented installer checks are limited to supported source forms and non-execution during install; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."
- "Supported source forms and same-origin mutations apply; aggregate size/depth/path-containment/signature/trust controls remain absent or unproven."

Compatibility and privacy limits:
- "Managed context-file migrations are transactional and refuse storage owned by another live gateway."
- "Autosave changes working content; only explicit manual revision creation appends named immutable revisions."
- "Current user-skill URL installation has no explicit aggregate byte/depth/path-containment/signature/trust limit; do not claim those defenses exist."
- "Runtime selected-only materialization belongs to RUN-003; this spec owns selection/catalog inputs and context persistence."

# Known limits and rejected stale claims

The following over-broad claims are rejected and must not be inferred from this specification:

- **Rejected claim:** User-skill URL install rejects symlink escapes, oversized trees, excessive depth, and untrusted content before persistence. — The installer restricts source forms and does not execute downloaded content, but has no explicit aggregate size/depth/path-containment/signature/trust checks.
- **Rejected claim:** Selected skills/context/MCP/Pi packages are loaded entirely by the resource specs. — Catalog and selection semantics are here; generation materialization is RUN-003 and Pi adapter loading is RUN-004.

Open evidence gaps carried forward:
- `WP03-GAP-001` — No focused test proves URL-installer aggregate size/depth/path containment or explicit trust policy; those controls are not implemented in the inspected source.
- `WP03-GAP-002` — Selected-only generation delivery is primarily tested by runtime-package suites outside WP-03; add cross-spec links and focused trace evidence rather than duplicating mechanics.
- `WP03-GAP-009` — No real-path, browser, external-provider, package-manager, host-lifecycle, Windows, or Pibo2 acceptance was performed; deterministic tests, build, typecheck, and package checks are recorded in the implementation report.

# Verification and traceability

All requirement traceability records use exact repository-relative regular files at `39090b8850758293e69380a52bb7498d7c955bc2`. The brief and synthesis were generated from a stale baseline, so this package deliberately rebinds operational authority to `39090b8850758293e69380a52bb7498d7c955bc2`.

Performed evidence:
- Source inspection: performed. Exact source paths, symbols, test paths, test names, ownership seams, and the accepted parent commit were checked.

Additional evidence boundaries:
- No browser, real provider, external MCP, real Pi package, Windows ACL/auth-recovery, real-host/systemd/pressure/restart, or Pibo2 evidence is claimed.

Package commands after authoring:
- `npm run typecheck` — passed
- `npm run build` — passed, with existing Vite chunk-size warnings
- Affected-test selection — 1,071 passed, 0 failed in the isolated worker
- Clean full suite — 2,638 passed, 0 failed, 5 skipped
- upstream/dev refresh validator/authoring suite — 84 passed

# Related concepts

- [SPC-RUN-003](/specs/runtime/generation-resources-and-portable-tools.md)
- [SPC-SEC-002](/specs/security/private-files-and-http.md)
