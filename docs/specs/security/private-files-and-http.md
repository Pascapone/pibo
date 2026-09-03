---
type: "Specification"
title: "Private Filesystem and HTTP/File Boundaries"
description: "Defines the implemented private filesystem and http/file boundaries contract and its current ownership, security, and verification boundaries."
tags: ["security", "trust-boundaries"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-03T09:44:17Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for SPC-SEC-002"
implementation:
  state: "current"
  baseline_commit: "3118eb35403a5f2037c97f7cf408572cc24c2b68"
  package: "WP-03-RESOURCES-SECURITY"
  source_evidence: "performed"
  focused_test_execution: "performed in Docker: redaction, Codex Native, portable-history, terminal, OMP, context-build, and MCP bridge suites passed; the full suite passed once, and a repeated run's known patchTraceViewWithEvent performance flake passed in isolation"
  build_and_typecheck_execution: "performed: npm run typecheck and npm run build passed"
traceability:
  commit: "3118eb35403a5f2037c97f7cf408572cc24c2b68"
  requirements:
    - id: "SEC-FILE-001"
      status: "implemented"
      sources:
        - path: "src/core/private-path.ts"
          symbol: "protectPrivatePathsSync"
        - path: "src/core/private-path.ts"
          symbol: "protectPrivateDirectorySync"
        - path: "src/core/private-path.ts"
          symbol: "protectPrivateFileSync"
        - path: "src/core/private-path.ts"
          symbol: "protectPrivateTreeSync"
        - path: "src/core/pibo-home.ts"
          symbol: "ensurePrivatePiboHome"
        - path: "src/core/pibo-home.ts"
          symbol: "ensurePrivatePiboHomeForPath"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "ensurePrivateChatUploadDirectory"
      tests:
        - path: "test/pibo-home-security.test.mjs"
          name: "ensurePrivatePiboHome creates a private directory"
        - path: "test/pibo-home-security.test.mjs"
          name: "ensurePrivatePiboHome tightens an existing directory"
        - path: "test/pibo-home-security.test.mjs"
          name: "ensurePrivatePiboHome rejects a file path"
        - path: "test/pibo-home-security.test.mjs"
          name: "default data stores protect Pibo Home outside the CLI"
        - path: "test/chat-file-security.test.mjs"
          name: "chat uploads follow PIBO_HOME and use a private directory"
      public:
        - "Private path and PIBO_HOME permission helpers"
        - "shared HTTP JSON/same-origin/error helpers"
        - "authorized upload, download, image preview, payload, and artifact file access"
        - "Protects PIBO_HOME trees and validates upload/download/image/payload paths, JSON bodies, same-origin requests, and identified redaction sinks."
      failures:
        - "Implemented path, body, origin, file-type, and identified redaction checks fail closed where their route applies; authenticated downloads and universal redaction coverage retain the documented boundaries."
        - "Identified redaction sinks remove known secret values from their outputs; universal config, log, trace, and error sink coverage is unproven."
      confidence: "high"
    - id: "SEC-FILE-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/chat-files.ts"
          symbol: "saveUploadedChatFiles"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "resolveDownloadPath"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "responseChatFileDownload"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "resolveImagePreviewPathWithinRoots"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "responseChatImagePreview"
        - path: "src/apps/chat/chat-files.ts"
          symbol: "responseChatTraceImage"
      tests:
        - path: "test/chat-image-file-boundary.test.mjs"
          name: "image preview rejects a symlink swap after path authorization"
        - path: "test/chat-image-file-boundary.test.mjs"
          name: "image preview rejects an authorized parent directory swapped outside its root"
        - path: "test/web-channel.test.mjs"
          name: "chat web app uploads multipart files to the private Pibo uploads directory"
        - path: "test/web-channel.test.mjs"
          name: "chat web app downloads files relative to the selected session workspace"
        - path: "test/web-channel.test.mjs"
          name: "chat web app image paths stay authenticated, bounded, sniffed, and non-cacheable"
        - path: "test/web-channel.test.mjs"
          name: "chat web app serves node-bound exact images concurrently and never falls back to changed path bytes"
      public:
        - "Private path and PIBO_HOME permission helpers"
        - "shared HTTP JSON/same-origin/error helpers"
        - "authorized upload, download, image preview, payload, and artifact file access"
        - "Protects PIBO_HOME trees and validates upload/download/image/payload paths, JSON bodies, same-origin requests, and identified redaction sinks."
      failures:
        - "Implemented path, body, origin, file-type, and identified redaction checks fail closed where their route applies; authenticated downloads and universal redaction coverage retain the documented boundaries."
        - "Identified redaction sinks remove known secret values from their outputs; universal config, log, trace, and error sink coverage is unproven."
      confidence: "high"
    - id: "SEC-FILE-003"
      status: "implemented"
      sources:
        - path: "src/web/http.ts"
          symbol: "MAX_WEB_REQUEST_BODY_BYTES"
        - path: "src/web/http.ts"
          symbol: "nodeRequestToWebRequest"
        - path: "src/web/http.ts"
          symbol: "readJsonBody"
        - path: "src/apps/chat/web-app.ts"
          symbol: "requireSameOriginRequest"
        - path: "src/apps/chat/web-app.ts"
          symbol: "requireSameOriginJsonRequest"
        - path: "src/apps/chat/web-app.ts"
          symbol: "requireSameOriginMultipartRequest"
        - path: "src/web/channel.ts"
          symbol: "createRequestBaseURL"
        - path: "src/web/channel.ts"
          symbol: "createCanonicalRedirect"
      tests:
        - path: "test/web-http.test.mjs"
          name: "readJsonBody rejects empty, invalid, and primitive JSON bodies"
        - path: "test/web-http.test.mjs"
          name: "nodeRequestToWebRequest rejects oversized request bodies"
        - path: "test/web-channel.test.mjs"
          name: "chat web app rejects cross-origin mutation requests"
        - path: "test/web-channel.test.mjs"
          name: "chat web app accepts same-origin mutations behind a local reverse proxy"
        - path: "test/web-channel.test.mjs"
          name: "chat web app accepts same-origin mutations through a Docker-published canonical host"
        - path: "test/web-channel.test.mjs"
          name: "web host rejects oversized request bodies"
      public:
        - "Private path and PIBO_HOME permission helpers"
        - "shared HTTP JSON/same-origin/error helpers"
        - "authorized upload, download, image preview, payload, and artifact file access"
        - "Protects PIBO_HOME trees and validates upload/download/image/payload paths, JSON bodies, same-origin requests, and identified redaction sinks."
      failures:
        - "Implemented path, body, origin, file-type, and identified redaction checks fail closed where their route applies; authenticated downloads and universal redaction coverage retain the documented boundaries."
        - "Identified redaction sinks remove known secret values from their outputs; universal config, log, trace, and error sink coverage is unproven."
      confidence: "high"
    - id: "SEC-FILE-004"
      status: "implemented"
      sources:
        - path: "src/core/sensitive-data-redaction.ts"
          symbol: "redactSensitiveText"
        - path: "src/core/sensitive-data-redaction.ts"
          symbol: "redactSensitiveValue"
        - path: "src/agent-runtimes/codex-native/redaction.ts"
          symbol: "redactCodexNativeSensitiveText"
        - path: "src/agent-runtime/portable-history.ts"
          symbol: "PiboDataPortableHistoryProvider"
        - path: "src/session-ui/statusViewModel.ts"
          symbol: "redactTerminalSecret"
        - path: "src/agent-runtime/auth.ts"
          symbol: "redactAgentRuntimeAuthText"
        - path: "src/mcp/runtime-session.ts"
          symbol: "redactMcpRuntimeError"
      tests:
        - path: "test/sensitive-data-redaction.test.mjs"
          name: "sensitive text redaction preserves ordinary Pibo identifiers and paths"
        - path: "test/codex-native-turn.test.mjs"
          name: "Codex native preserves ordinary Pibo identifiers in assistant streaming and completed messages"
        - path: "test/runtime-portability.test.mjs"
          name: "portable history is bounded, checkpointed, role-aware, and secret-redacted"
        - path: "test/cli-ui-session-app.test.mjs"
          name: "renderCliStatusCardText renders shared status bars and redacts secrets"
      public:
        - "Central free-text and structured-value credential redaction policy"
        - "Codex Native output, portable history, runtime auth diagnostics, MCP diagnostics, and shared terminal rendering"
      failures:
        - "Known credential formats, bearer values, JWT-shaped values, named secret assignments, and structured secret fields are replaced before identified sinks persist or render them."
        - "Ordinary Pibo product identifiers and paths are not credential formats and must remain unchanged."
        - "Redaction remains best-effort at identified callers; universal config, log, trace, and error coverage is not claimed."
      confidence: "high"
verification:
  required_evidence_classes:
    - "source inspection"
    - "focused tests"
    - "build/package checks"
    - "external-provider/Pibo2 acceptance"
  performed:
    - evidence_class: "source inspection"
      status: "performed"
      detail: "Exact source files, symbols, test files, and test names were reconciled to topic implementation commit 3118eb35403a5f2037c97f7cf408572cc24c2b68."
    - evidence_class: "focused tests"
      status: "performed"
      detail: "Focused redaction, Codex Native, portable-history, terminal, OMP, context-build, and MCP bridge suites passed in the isolated Docker worker. The full suite passed once. A repeated full-suite run hit only the known patchTraceViewWithEvent performance threshold flake, which passed immediately in isolation."
    - evidence_class: "build/package checks"
      status: "performed"
      detail: "npm run typecheck and npm run build passed."
  unperformed:
    - evidence_class: "local real-path/PTY/headful browser validation"
      status: "unperformed"
      reason: "No browser, PTY, or real-path acceptance flow was performed for this package."
    - evidence_class: "external-provider/Pibo2 acceptance"
      status: "unperformed"
      reason: "No real provider, external MCP, package-manager, host lifecycle, or Pibo2 acceptance was performed."
stale_claims_to_reject:
  - id: "WP03-STALE-001"
    claim: "All private-file downloads are limited to approved workspace/upload roots and reject traversal."
    reason: "Image previews are root-bounded; authenticated downloads intentionally accept absolute or workspace-relative regular files without a root sandbox."
  - id: "WP03-STALE-002"
    claim: "All logs, traces, configuration, and errors are universally redacted."
    reason: "Redaction helpers and selected sinks exist; complete sink coverage is not proven."
open_evidence_gaps:
  - id: "WP03-GAP-005"
    specs: ["SPC-SEC-001", "SPC-SEC-002"]
    gap: "Direct Windows Better Auth recovery, ACL, symlink/reparse-point, and machine-session validation remains unperformed."
  - id: "WP03-GAP-006"
    specs: ["SPC-SEC-002"]
    gap: "No dedicated comprehensive sink-coverage test proves redaction across every security-sensitive subsystem; scope the requirement to the helper and identified adopters."
  - id: "WP03-GAP-007"
    specs: ["SPC-SEC-002"]
    gap: "The broad authenticated download surface has no approved-root sandbox by design; confirm this accepted local-operator policy before writing normative prose, or treat hardening as future work."
  - id: "WP03-GAP-009"
    specs: ["SPC-RES-001", "SPC-RES-002", "SPC-RES-003", "SPC-RES-004", "SPC-RES-005", "SPC-SEC-001", "SPC-SEC-002", "SPC-SEC-003"]
    gap: "No real-path, browser, external-provider, package-manager, host-lifecycle, Windows, or Pibo2 acceptance was performed; deterministic tests, build, typecheck, and package checks are recorded in the implementation report."
---

# Scope and exclusions

Private PIBO_HOME paths, upload/download/image/payload roots, traversal/symlink checks, request bodies/origins, and sensitive-data redaction.

This specification records current behavior only. It does not authorize unimplemented hardening, duplicate the linked runtime/gateway/data owner, or convert unperformed validation into evidence.

# Current behavior and public surfaces

The implementation state is current at the exact accepted upstream/dev refresh traceability commit `3118eb35403a5f2037c97f7cf408572cc24c2b68`.

Implemented behavior:
- "Private path and PIBO_HOME permission helpers"
- "shared HTTP JSON/same-origin/error helpers"
- "authorized upload, download, image preview, payload, and artifact file access"
- "Protects PIBO_HOME trees and validates upload/download/image/payload paths, JSON bodies, same-origin requests, and identified redaction sinks."
- "Private Pibo directories/files are tightened to 0700/0600 on POSIX and protected ACLs on Windows; Pibo Home validation rejects file paths."
- "Uploads use a private Pibo directory, sanitized basenames, and exclusive creation. Image preview authorization realpaths approved workspace/upload roots, uses no-follow/opened-inode checks, size/MIME sniffing, no-store, nosniff, and cross-origin-resource policy."
- "Downloads accept authenticated absolute paths or paths resolved from the session workspace and require a regular file, but intentionally do not enforce a workspace/upload-root sandbox."
- "Node request conversion enforces a 4 MiB body bound; JSON parsing requires a non-null object; mutating product routes invoke content-type and exact-origin checks after canonical host translation."
- "Sensitive redaction helpers recursively redact named sensitive keys and common token patterns with bounded depth; sink adoption is not universal proof."

Public surfaces:
- "Private path and PIBO_HOME permission helpers"
- "shared HTTP JSON/same-origin/error helpers"
- "authorized upload, download, image preview, payload, and artifact file access"
- "Protects PIBO_HOME trees and validates upload/download/image/payload paths, JSON bodies, same-origin requests, and identified redaction sinks."

# State, lifecycle, and invariants

- "Resolved paths stay inside authorized roots and regular-file constraints; private state is owner-only."
- "Resolved paths must stay in authorized roots; symlink/traversal escapes fail; private files are owner-only."
- "Image preview traversal, root escape, unsupported active formats, oversize decoded bytes, symlink swaps, and opened-file identity changes fail."
- "Same-origin validation compares Origin with the canonical request URL origin; reverse-proxy/channel mechanics belong to GW-003."
- "The download route is a trusted authenticated local-operator feature, not a workspace-only sandbox; specifications must not claim traversal/root escape rejection for downloads."
- "Redaction is best-effort at callers that invoke the helper; do not claim every log, trace, config, or error sink is automatically sanitized."

Persistence and lifecycle state: Private directories/files and bounded upload/artifact roots.

# Requirements and invariants

## Requirement: SEC-FILE-001: Create and tighten Pibo Home, private product directories, and private files with platform-appropriate protections, rejecting an invalid file-at-directory path

Create and tighten Pibo Home, private product directories, and private files with platform-appropriate protections, rejecting an invalid file-at-directory path.

**Implementation state:** `implemented_at_baseline; direct Windows evidence required` at `3118eb35403a5f2037c97f7cf408572cc24c2b68`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/core/private-path.ts` — `protectPrivatePathsSync`
- `src/core/private-path.ts` — `protectPrivateDirectorySync`
- `src/core/private-path.ts` — `protectPrivateFileSync`
- `src/core/private-path.ts` — `protectPrivateTreeSync`
- `src/core/pibo-home.ts` — `ensurePrivatePiboHome`
- `src/core/pibo-home.ts` — `ensurePrivatePiboHomeForPath`
- `src/apps/chat/chat-files.ts` — `ensurePrivateChatUploadDirectory`

**Named test traceability:**
- `test/pibo-home-security.test.mjs` — `ensurePrivatePiboHome creates a private directory`
- `test/pibo-home-security.test.mjs` — `ensurePrivatePiboHome tightens an existing directory`
- `test/pibo-home-security.test.mjs` — `ensurePrivatePiboHome rejects a file path`
- `test/pibo-home-security.test.mjs` — `default data stores protect Pibo Home outside the CLI`
- `test/chat-file-security.test.mjs` — `chat uploads follow PIBO_HOME and use a private directory`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-FILE-002: Apply route-specific file authorization: private sanitized/exclusive uploads; root-bounded, realpath/no-follow, inode-checked and MIME/size-bounded image previews; and authenticated regular-file downloads resolved from absolute or workspace-relative paths without falsely claiming a download root sandbox

Apply route-specific file authorization: private sanitized/exclusive uploads; root-bounded, realpath/no-follow, inode-checked and MIME/size-bounded image previews; and authenticated regular-file downloads resolved from absolute or workspace-relative paths without falsely claiming a download root sandbox.

**Implementation state:** `implemented_at_baseline_with_intentional_download_breadth` at `3118eb35403a5f2037c97f7cf408572cc24c2b68`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/apps/chat/chat-files.ts` — `saveUploadedChatFiles`
- `src/apps/chat/chat-files.ts` — `resolveDownloadPath`
- `src/apps/chat/chat-files.ts` — `responseChatFileDownload`
- `src/apps/chat/chat-files.ts` — `resolveImagePreviewPathWithinRoots`
- `src/apps/chat/chat-files.ts` — `responseChatImagePreview`
- `src/apps/chat/chat-files.ts` — `responseChatTraceImage`

**Named test traceability:**
- `test/chat-image-file-boundary.test.mjs` — `image preview rejects a symlink swap after path authorization`
- `test/chat-image-file-boundary.test.mjs` — `image preview rejects an authorized parent directory swapped outside its root`
- `test/web-channel.test.mjs` — `chat web app uploads multipart files to the private Pibo uploads directory`
- `test/web-channel.test.mjs` — `chat web app downloads files relative to the selected session workspace`
- `test/web-channel.test.mjs` — `chat web app image paths stay authenticated, bounded, sniffed, and non-cacheable`
- `test/web-channel.test.mjs` — `chat web app serves node-bound exact images concurrently and never falls back to changed path bytes`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-FILE-003: Reject oversized host request bodies, reject invalid/non-object JSON, and require expected content type plus exact canonical same-origin evidence for mutating product routes; leave canonical URL translation and route mounting to GW-003

Reject oversized host request bodies, reject invalid/non-object JSON, and require expected content type plus exact canonical same-origin evidence for mutating product routes; leave canonical URL translation and route mounting to GW-003.

**Implementation state:** `implemented_at_baseline_with_GW_003_mechanics` at `3118eb35403a5f2037c97f7cf408572cc24c2b68`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/web/http.ts` — `MAX_WEB_REQUEST_BODY_BYTES`
- `src/web/http.ts` — `nodeRequestToWebRequest`
- `src/web/http.ts` — `readJsonBody`
- `src/apps/chat/web-app.ts` — `requireSameOriginRequest`
- `src/apps/chat/web-app.ts` — `requireSameOriginJsonRequest`
- `src/apps/chat/web-app.ts` — `requireSameOriginMultipartRequest`
- `src/web/channel.ts` — `createRequestBaseURL`
- `src/web/channel.ts` — `createCanonicalRedirect`

**Named test traceability:**
- `test/web-http.test.mjs` — `readJsonBody rejects empty, invalid, and primitive JSON bodies`
- `test/web-http.test.mjs` — `nodeRequestToWebRequest rejects oversized request bodies`
- `test/web-channel.test.mjs` — `chat web app rejects cross-origin mutation requests`
- `test/web-channel.test.mjs` — `chat web app accepts same-origin mutations behind a local reverse proxy`
- `test/web-channel.test.mjs` — `chat web app accepts same-origin mutations through a Docker-published canonical host`
- `test/web-channel.test.mjs` — `web host rejects oversized request bodies`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: SEC-FILE-004: Narrow credential redaction protects identified output sinks without treating product identifiers as secrets

Pibo MUST retain best-effort free-text redaction at identified runtime, portable-history, diagnostic, and terminal sinks because providers and tools can echo credentials into ordinary output. The shared policy MUST match only strong credential signals: bearer values, documented credential prefixes with bounded minimum lengths, JWT-shaped values, named secret assignments, and structured fields whose keys identify secrets.

Ordinary product names, command arguments, and paths MUST remain unchanged. In particular, `pibo-v2-github-flow`, `pibo-docker-system`, `pibo-docker-dev`, `pibo-debug-auth`, and paths containing those components are not credentials. `pibo` MUST NOT be a credential prefix.

The identified sinks redact before Pibo persistence or rendering. This deliberately prevents likely credentials from becoming canonical product data. Pibo does not retain a parallel raw copy in Product History. Harness-native history may retain source text under its own protection, but callers MUST NOT depend on that as a recovery channel.

Redaction helpers and adapters MUST use the shared text policy instead of maintaining independent credential-prefix expressions. Sink-specific code may add narrower protection for private paths, account identities, or explicitly supplied secret values.

**Implementation state:** `implemented_with_narrow_shared_policy; universal sink coverage not claimed` at `3118eb35403a5f2037c97f7cf408572cc24c2b68`.

**Confidence:** `high`. Confidence describes source/test trace quality, not universal sink coverage.

**Source traceability:**
- `src/core/sensitive-data-redaction.ts` — `redactSensitiveText`, `redactSensitiveValue`
- `src/agent-runtimes/codex-native/redaction.ts` — `redactCodexNativeSensitiveText`, `redactCodexNativeValue`
- `src/agent-runtime/portable-history.ts` — `PiboDataPortableHistoryProvider`
- `src/session-ui/statusViewModel.ts` — `redactTerminalSecret`
- `src/agent-runtime/auth.ts` — `redactAgentRuntimeAuthText`
- `src/mcp/runtime-session.ts` — `redactMcpRuntimeError`

**Named test traceability:**
- `test/sensitive-data-redaction.test.mjs` — `sensitive text redaction preserves ordinary Pibo identifiers and paths`
- `test/codex-native-turn.test.mjs` — `Codex native preserves ordinary Pibo identifiers in assistant streaming and completed messages`
- `test/runtime-portability.test.mjs` — `portable history is bounded, checkpointed, role-aware, and secret-redacted`
- `test/cli-ui-session-app.test.mjs` — `renderCliStatusCardText renders shared status bars and redacts secrets`

**Scenario: Ordinary product output survives**
- GIVEN an assistant message, tool argument or result, portable-history entry, or terminal field contains an ordinary `pibo-*` identifier or path
- WHEN an identified sink applies the shared redaction policy
- THEN the identifier or path remains unchanged

**Scenario: Strong credential evidence is removed**
- GIVEN text contains a bearer value, documented credential token, JWT-shaped value, or named secret assignment, or a structured object contains a secret-keyed field
- WHEN an identified sink applies the shared redaction policy
- THEN the likely credential value is replaced before persistence or rendering

**Acceptance boundary:** The implementation proves the shared helper and named adopters. It does not claim universal redaction across every config, log, trace, or error sink.


# Interfaces and ownership

Capability IDs: "pibo.security.files-http".

Exact source files inspected for this owner:
- "src/agent-runtime/auth.ts"
- "src/agent-runtime/portable-history.ts"
- "src/agent-runtime/resource-service.ts"
- "src/agent-runtimes/codex-native/redaction.ts"
- "src/agent-runtimes/omp/client.ts"
- "src/apps/chat/chat-files.ts"
- "src/apps/chat/web-app.ts"
- "src/core/pibo-home.ts"
- "src/core/private-path.ts"
- "src/core/sensitive-data-redaction.ts"
- "src/mcp/runtime-session.ts"
- "src/session-ui/statusViewModel.ts"
- "src/web/channel.ts"
- "src/web/http.ts"

Related ownership boundaries:
- SPC-PROD-003: [home-workspace-configuration.md](/specs/product/home-workspace-configuration.md) owns the linked contract; this specification does not duplicate it.
- SPC-GW-003: [web-host-and-channel.md](/specs/gateway/web-host-and-channel.md) owns the linked contract; this specification does not duplicate it.

The security policy/mechanics split is explicit: this specification defines the resource or security decision, while linked runtime, gateway, data, web, orchestration, compute, and operator owners provide their execution mechanics.

# Failure, security, privacy, and compatibility behavior

- "Implemented path, body, origin, file-type, and identified redaction checks fail closed where their route applies; authenticated downloads and universal redaction coverage retain the documented boundaries."
- "Identified redaction sinks remove likely credentials while preserving ordinary Pibo identifiers and paths; universal config, log, trace, and error sink coverage is unproven."

Compatibility and privacy limits:
- "Image preview traversal, root escape, unsupported active formats, oversize decoded bytes, symlink swaps, and opened-file identity changes fail."
- "Same-origin validation compares Origin with the canonical request URL origin; reverse-proxy/channel mechanics belong to GW-003."
- "The download route is a trusted authenticated local-operator feature, not a workspace-only sandbox; specifications must not claim traversal/root escape rejection for downloads."
- "Redaction is best-effort at callers that invoke the helper; do not claim every log, trace, config, or error sink is automatically sanitized."
- "The false-positive budget excludes generic product prefixes and public identifiers; `pibo-*` and generic `pk-*` text remain visible unless a separate strong signal marks the containing value as sensitive."

# Known limits and rejected stale claims

The following over-broad claims are rejected and must not be inferred from this specification:

- **Rejected claim:** All private-file downloads are limited to approved workspace/upload roots and reject traversal. — Image previews are root-bounded; authenticated downloads intentionally accept absolute or workspace-relative regular files without a root sandbox.
- **Rejected claim:** All logs, traces, configuration, and errors are universally redacted. — Redaction helpers and selected sinks exist; complete sink coverage is not proven.

Open evidence gaps carried forward:
- `WP03-GAP-005` — Direct Windows Better Auth recovery, ACL, symlink/reparse-point, and machine-session validation remains unperformed.
- `WP03-GAP-006` — No dedicated comprehensive sink-coverage test proves redaction across every security-sensitive subsystem; scope the requirement to the helper and identified adopters.
- `WP03-GAP-007` — The broad authenticated download surface has no approved-root sandbox by design; confirm this accepted local-operator policy before writing normative prose, or treat hardening as future work.
- `WP03-GAP-009` — No real-path, browser, external-provider, package-manager, host-lifecycle, Windows, or Pibo2 acceptance was performed; deterministic tests, build, typecheck, and package checks are recorded in the implementation report.

# Verification and traceability

All requirement traceability records use exact repository-relative regular files at `3118eb35403a5f2037c97f7cf408572cc24c2b68`. The brief and synthesis were generated from a stale baseline, so this package deliberately rebinds operational authority to `3118eb35403a5f2037c97f7cf408572cc24c2b68`.

Performed evidence:
- Source inspection: performed. Exact source paths, symbols, test paths, test names, ownership seams, and the topic implementation commit were checked.

Additional evidence boundaries:
- No browser, real provider, external MCP, real Pi package, Windows ACL/auth-recovery, real-host/systemd/pressure/restart, or Pibo2 evidence is claimed.

Package commands after authoring:
- `npm run typecheck` — passed
- `npm run build` — passed, with existing Vite chunk-size warnings
- Affected-test selection — 1,071 passed, 0 failed in the isolated worker
- Clean full suite — 2,638 passed, 0 failed, 5 skipped
- upstream/dev refresh validator/authoring suite — 84 passed

# Related concepts

- [SPC-PROD-003](/specs/product/home-workspace-configuration.md)
- [SPC-GW-003](/specs/gateway/web-host-and-channel.md)
