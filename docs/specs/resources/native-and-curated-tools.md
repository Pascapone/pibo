---
type: "Specification"
title: "Pibo Native Tools and Curated CLI Tooling"
description: "Defines the implemented pibo native tools and curated cli tooling contract and its current ownership, security, and verification boundaries."
tags: ["resources", "security-boundaries"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T08:51:56Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for SPC-RES-002"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-03-RESOURCES-SECURITY"
  source_evidence: "performed"
  focused_test_execution: "performed: 383 passed, 2 baseline failures in local-auth.test.mjs"
  build_and_typecheck_execution: "performed: npm run typecheck and npm run build passed"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "RES-TOOL-001"
      status: "implemented"
      sources:
        - path: "src/tools/contract.ts"
          symbol: "PiboToolDefinition"
        - path: "src/tools/contract.ts"
          symbol: "definePiboTool"
        - path: "src/tools/contract.ts"
          symbol: "normalizePiboToolDefinition"
      tests:
        - path: "test/pibo-tool-contract.test.mjs"
          name: "Pibo tool contract preserves JSON Schema types and compiles directly for Pi"
        - path: "test/pibo-tool-contract.test.mjs"
          name: "legacy Pi-shaped registrations normalize without leaking Pi types into generic profiles"
      public:
        - "runtime persistent code tool"
        - "native web search, Codex image generation, and Codex browser interface"
        - "pibo tools list/show/install/env/doctor/guides/guide"
        - "JSON-Schema tools support progress/cancel/structured and image results; built-ins include persistent Node/Python runtime, web search, image generation, and browser interface."
      failures:
        - "Inputs/results/artifacts are bounded; credentials stay outside model-visible output; Docker/SSH runtime targets remain unsupported."
        - "Tool inputs/results are normalized, payloads bounded, and browser/image credentials stay outside model-visible output."
      confidence: "high"
    - id: "RES-TOOL-002"
      status: "implemented"
      sources:
        - path: "src/tools/runtime/types.ts"
          symbol: "RuntimeKind"
        - path: "src/tools/runtime/types.ts"
          symbol: "RuntimeSessionStatus"
        - path: "src/tools/runtime/types.ts"
          symbol: "RuntimeTarget"
        - path: "src/tools/runtime/registry.ts"
          symbol: "RuntimeSessionRegistry"
        - path: "src/tools/runtime/tool.ts"
          symbol: "createRuntimeToolProfile"
        - path: "src/tools/runtime/tool.ts"
          symbol: "createRuntimeToolDefinition"
      tests:
        - path: "test/runtime-tool.test.mjs"
          name: "node runtime preserves variables across exec calls"
        - path: "test/runtime-tool.test.mjs"
          name: "node runtime errors keep prior state and expose failing line"
        - path: "test/runtime-tool.test.mjs"
          name: "node runtime captures stdout, stderr, inspect, vars, and closeOnSuccess"
        - path: "test/runtime-tool.test.mjs"
          name: "runtime can be selected by a registered profile and inspection"
      public:
        - "runtime persistent code tool"
        - "native web search, Codex image generation, and Codex browser interface"
        - "pibo tools list/show/install/env/doctor/guides/guide"
        - "JSON-Schema tools support progress/cancel/structured and image results; built-ins include persistent Node/Python runtime, web search, image generation, and browser interface."
      failures:
        - "Inputs/results/artifacts are bounded; credentials stay outside model-visible output; Docker/SSH runtime targets remain unsupported."
        - "Tool inputs/results are normalized, payloads bounded, and browser/image credentials stay outside model-visible output."
      confidence: "high"
    - id: "RES-TOOL-003"
      status: "implemented"
      sources:
        - path: "src/tools/web-search.ts"
          symbol: "normalizeOpenAiWebSearchConfig"
        - path: "src/tools/web-search.ts"
          symbol: "addOpenAiWebSearchProviderTool"
        - path: "src/tools/codex-image-generation.ts"
          symbol: "createCodexImageGenerationToolDefinition"
        - path: "src/tools/codex-image-artifacts.ts"
          symbol: "saveCodexGeneratedImage"
        - path: "src/tools/codex-browser.ts"
          symbol: "CodexBrowserSessionController"
        - path: "src/tools/codex-browser.ts"
          symbol: "createCodexBrowserToolProfiles"
      tests:
        - path: "test/codex-image-generation.test.mjs"
          name: "codex_image_generation requires openai-codex OAuth"
        - path: "test/codex-image-generation.test.mjs"
          name: "codex_image_generation rejects conflicting edit references before network calls"
        - path: "test/codex-image-generation.test.mjs"
          name: "codex_image_generation generates through the Codex backend and saves the image"
        - path: "test/codex-browser-interface.test.mjs"
          name: "Browser Use controller binds command session and managed pool lease to the Pibo session"
        - path: "test/codex-browser-interface.test.mjs"
          name: "node_repl.js preserves state, reaches the bound browser bridge, resets, and omits host capabilities"
        - path: "test/web-search-lifecycle-adversarial.test.mjs"
          name: "two concurrent routed sessions isolate the same provider id across the first await"
        - path: "test/web-search-lifecycle-adversarial.test.mjs"
          name: "cancelling a provisional lifecycle emits no synthetic finish or message terminal"
        - path: "test/web-search-trace-semantics.test.mjs"
          name: "missing and malformed provider fields cannot create unsafe website descriptors"
      public:
        - "runtime persistent code tool"
        - "native web search, Codex image generation, and Codex browser interface"
        - "pibo tools list/show/install/env/doctor/guides/guide"
        - "JSON-Schema tools support progress/cancel/structured and image results; built-ins include persistent Node/Python runtime, web search, image generation, and browser interface."
      failures:
        - "Inputs/results/artifacts are bounded; credentials stay outside model-visible output; Docker/SSH runtime targets remain unsupported."
        - "Tool inputs/results are normalized, payloads bounded, and browser/image credentials stay outside model-visible output."
      confidence: "high"
    - id: "RES-TOOL-004"
      status: "implemented"
      sources:
        - path: "src/tools/index.ts"
          symbol: "runToolsCli"
        - path: "src/tools/index.ts"
          symbol: "printToolsDiscovery"
        - path: "src/tools/registry.ts"
          symbol: "listCliToolEntries"
        - path: "src/tools/registry.ts"
          symbol: "getCliToolStatus"
        - path: "src/tools/registry.ts"
          symbol: "installCliTool"
        - path: "src/tools/registry.ts"
          symbol: "doctorCliTool"
      tests:
        - path: "test/tools-cli.test.mjs"
          name: "pibo tools lists curated CLI tools"
        - path: "test/tools-cli.test.mjs"
          name: "pibo tools exposes browser-use guides outside the profile skill system"
        - path: "test/tools-cli.test.mjs"
          name: "pibo tools install supports a no-setup dry target"
        - path: "test/tools-cli.test.mjs"
          name: "pibo tools env wraps browser-use with the PIBo default profile"
      public:
        - "runtime persistent code tool"
        - "native web search, Codex image generation, and Codex browser interface"
        - "pibo tools list/show/install/env/doctor/guides/guide"
        - "JSON-Schema tools support progress/cancel/structured and image results; built-ins include persistent Node/Python runtime, web search, image generation, and browser interface."
      failures:
        - "Inputs/results/artifacts are bounded; credentials stay outside model-visible output; Docker/SSH runtime targets remain unsupported."
        - "Tool inputs/results are normalized, payloads bounded, and browser/image credentials stay outside model-visible output."
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
      detail: "Exact source files, symbols, test files, and test names were reconciled to Foundation commit 38bb6e57f118c1543e7263c68d27e5103d3b1262."
    - evidence_class: "focused tests"
      status: "performed_with_baseline_failures"
      detail: "Exact parent/candidate inventory ran in the same fresh isolated worker: 385 tests, 383 passed, and 2 identical local-auth baseline assertions failed; no source or test files were changed."
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
    claim: "All native tools share one artifact and credential contract."
    reason: "Search, image, and browser tools have distinct provider, persistence, and lease semantics."
open_evidence_gaps:
  - id: "WP03-GAP-009"
    specs: ["SPC-RES-001", "SPC-RES-002", "SPC-RES-003", "SPC-RES-004", "SPC-RES-005", "SPC-SEC-001", "SPC-SEC-002", "SPC-SEC-003"]
    gap: "Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance."
---

# Scope and exclusions

Pibo-owned tool inventory and lifecycle, persistent Node/Python runtime, web search, image generation, browser interface, curated CLI discovery/install/env/health/guides, and artifact handling.

This specification records current behavior only. It does not authorize unimplemented hardening, duplicate the linked runtime/gateway/data owner, or convert unperformed validation into evidence.

# Current behavior and public surfaces

The implementation state is current at the exact accepted Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Implemented behavior:
- "runtime persistent code tool"
- "native web search, Codex image generation, and Codex browser interface"
- "pibo tools list/show/install/env/doctor/guides/guide"
- "JSON-Schema tools support progress/cancel/structured and image results; built-ins include persistent Node/Python runtime, web search, image generation, and browser interface."
- "PiboToolDefinition is runtime-neutral, JSON-Schema-based, progress/abort-aware, and explicitly distinguishes portable from native-context execution."
- "RuntimeSessionRegistry owns controller-session-scoped local Node/Python workers, bounded history, busy-state refusal, interruption, close, controller cleanup, and pruning; non-local targets are not implemented."
- "Native web search, image generation, and browser interfaces have different contracts: provider-search filtering/lifecycle, private image artifact persistence with OAuth and edit bounds, and Pibo-session-bound browser controller state."
- "The curated pibo tools CLI is progressively discoverable and separates list/show/install/remove/doctor/guide/env concerns."

Public surfaces:
- "runtime persistent code tool"
- "native web search, Codex image generation, and Codex browser interface"
- "pibo tools list/show/install/env/doctor/guides/guide"
- "JSON-Schema tools support progress/cancel/structured and image results; built-ins include persistent Node/Python runtime, web search, image generation, and browser interface."

# State, lifecycle, and invariants

- "Portable versus adapter-private eligibility is explicit; persistent workers are controller-scoped and bounded."
- "Portable versus adapter-private eligibility is explicit; persistent runtime sessions are bounded and separately keyed."
- "Legacy Pi-shaped tool registrations normalize without leaking Pi types; legacy nonportable tools require native context."
- "A worker is never shared across controller Pibo sessions and close/reap paths are idempotent/bounded."
- "Image edit inputs are mutually exclusive and rejected before network access; generated image bytes are stored under a private Pibo artifact root."
- "Browser pool/lease implementation is CMP-003; search lifecycle rendering is a consumer boundary; native tools must not claim one uniform artifact model."

Persistence and lifecycle state: Runtime worker processes and payload/image artifact files.

# Requirements and invariants

## Requirement: RES-TOOL-001: Register Pibo-owned tool definitions with JSON Schema, content/structured-result metadata, progress, abort, execution-mode, portability, and native-context eligibility

Register Pibo-owned tool definitions with JSON Schema, content/structured-result metadata, progress, abort, execution-mode, portability, and native-context eligibility.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/tools/contract.ts` — `PiboToolDefinition`
- `src/tools/contract.ts` — `definePiboTool`
- `src/tools/contract.ts` — `normalizePiboToolDefinition`

**Named test traceability:**
- `test/pibo-tool-contract.test.mjs` — `Pibo tool contract preserves JSON Schema types and compiles directly for Pi`
- `test/pibo-tool-contract.test.mjs` — `legacy Pi-shaped registrations normalize without leaking Pi types into generic profiles`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-TOOL-002: Manage controller-scoped local Node/Python runtime workers with explicit state, bounded history, startup timeout cleanup, busy refusal, interrupt, inspection, close, controller cleanup, and pruning

Manage controller-scoped local Node/Python runtime workers with explicit state, bounded history, startup timeout cleanup, busy refusal, interrupt, inspection, close, controller cleanup, and pruning.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/tools/runtime/types.ts` — `RuntimeKind`
- `src/tools/runtime/types.ts` — `RuntimeSessionStatus`
- `src/tools/runtime/types.ts` — `RuntimeTarget`
- `src/tools/runtime/registry.ts` — `RuntimeSessionRegistry`
- `src/tools/runtime/tool.ts` — `createRuntimeToolProfile`
- `src/tools/runtime/tool.ts` — `createRuntimeToolDefinition`

**Named test traceability:**
- `test/runtime-tool.test.mjs` — `node runtime preserves variables across exec calls`
- `test/runtime-tool.test.mjs` — `node runtime errors keep prior state and expose failing line`
- `test/runtime-tool.test.mjs` — `node runtime captures stdout, stderr, inspect, vars, and closeOnSuccess`
- `test/runtime-tool.test.mjs` — `runtime can be selected by a registered profile and inspection`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-TOOL-003: Apply each native tool's own bounds: validate search domain filters and lifecycle descriptors, require Codex OAuth and bounded mutually-exclusive image edits with private artifacts, and bind browser controller/lease state to the Pibo session while omitting host capabilities from its Node REPL

Apply each native tool's own bounds: validate search domain filters and lifecycle descriptors, require Codex OAuth and bounded mutually-exclusive image edits with private artifacts, and bind browser controller/lease state to the Pibo session while omitting host capabilities from its Node REPL.

**Implementation state:** `implemented_at_baseline_with_CMP_003_boundary` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/tools/web-search.ts` — `normalizeOpenAiWebSearchConfig`
- `src/tools/web-search.ts` — `addOpenAiWebSearchProviderTool`
- `src/tools/codex-image-generation.ts` — `createCodexImageGenerationToolDefinition`
- `src/tools/codex-image-artifacts.ts` — `saveCodexGeneratedImage`
- `src/tools/codex-browser.ts` — `CodexBrowserSessionController`
- `src/tools/codex-browser.ts` — `createCodexBrowserToolProfiles`

**Named test traceability:**
- `test/codex-image-generation.test.mjs` — `codex_image_generation requires openai-codex OAuth`
- `test/codex-image-generation.test.mjs` — `codex_image_generation rejects conflicting edit references before network calls`
- `test/codex-image-generation.test.mjs` — `codex_image_generation generates through the Codex backend and saves the image`
- `test/codex-browser-interface.test.mjs` — `Browser Use controller binds command session and managed pool lease to the Pibo session`
- `test/codex-browser-interface.test.mjs` — `node_repl.js preserves state, reaches the bound browser bridge, resets, and omits host capabilities`
- `test/web-search-lifecycle-adversarial.test.mjs` — `two concurrent routed sessions isolate the same provider id across the first await`
- `test/web-search-lifecycle-adversarial.test.mjs` — `cancelling a provisional lifecycle emits no synthetic finish or message terminal`
- `test/web-search-trace-semantics.test.mjs` — `missing and malformed provider fields cannot create unsafe website descriptors`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-TOOL-004: Keep pibo tools discovery compact and progressive through list, show, install/remove, doctor, guide, path, and environment subcommands; browser pool operations remain a linked CMP-003 surface

Keep pibo tools discovery compact and progressive through list, show, install/remove, doctor, guide, path, and environment subcommands; browser pool operations remain a linked CMP-003 surface.

**Implementation state:** `implemented_at_baseline` at `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/tools/index.ts` — `runToolsCli`
- `src/tools/index.ts` — `printToolsDiscovery`
- `src/tools/registry.ts` — `listCliToolEntries`
- `src/tools/registry.ts` — `getCliToolStatus`
- `src/tools/registry.ts` — `installCliTool`
- `src/tools/registry.ts` — `doctorCliTool`

**Named test traceability:**
- `test/tools-cli.test.mjs` — `pibo tools lists curated CLI tools`
- `test/tools-cli.test.mjs` — `pibo tools exposes browser-use guides outside the profile skill system`
- `test/tools-cli.test.mjs` — `pibo tools install supports a no-setup dry target`
- `test/tools-cli.test.mjs` — `pibo tools env wraps browser-use with the PIBo default profile`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


# Interfaces and ownership

Capability IDs: "pibo.resources.tools".

Exact source files inspected for this owner:
- "src/tools/codex-browser.ts"
- "src/tools/codex-image-artifacts.ts"
- "src/tools/codex-image-generation.ts"
- "src/tools/contract.ts"
- "src/tools/index.ts"
- "src/tools/registry.ts"
- "src/tools/runtime/registry.ts"
- "src/tools/runtime/tool.ts"
- "src/tools/runtime/types.ts"
- "src/tools/web-search.ts"

Related ownership boundaries:
- SPC-RUN-003: [generation-resources-and-portable-tools.md](/specs/runtime/generation-resources-and-portable-tools.md) owns the linked contract; this specification does not duplicate it.
- SPC-CMP-003: [browser-pools-and-leases.md](/specs/compute/browser-pools-and-leases.md) owns the linked contract; this specification does not duplicate it.
- SPC-OP-001: [operator-cli.md](/specs/operator/operator-cli.md) owns the linked contract; this specification does not duplicate it.

The security policy/mechanics split is explicit: this specification defines the resource or security decision, while linked runtime, gateway, data, web, orchestration, compute, and operator owners provide their execution mechanics.

# Failure, security, privacy, and compatibility behavior

- "Inputs/results/artifacts are bounded; credentials stay outside model-visible output; Docker/SSH runtime targets remain unsupported."
- "Tool inputs/results are normalized, payloads bounded, and browser/image credentials stay outside model-visible output."

Compatibility and privacy limits:
- "Legacy Pi-shaped tool registrations normalize without leaking Pi types; legacy nonportable tools require native context."
- "A worker is never shared across controller Pibo sessions and close/reap paths are idempotent/bounded."
- "Image edit inputs are mutually exclusive and rejected before network access; generated image bytes are stored under a private Pibo artifact root."
- "Browser pool/lease implementation is CMP-003; search lifecycle rendering is a consumer boundary; native tools must not claim one uniform artifact model."

# Known limits and rejected stale claims

The following over-broad claims are rejected and must not be inferred from this specification:

- **Rejected claim:** All native tools share one artifact and credential contract. — Search, image, and browser tools have distinct provider, persistence, and lease semantics.

Open evidence gaps carried forward:
- `WP03-GAP-009` — Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance.

# Verification and traceability

All requirement traceability records use exact repository-relative regular files at `38bb6e57f118c1543e7263c68d27e5103d3b1262`. The brief and synthesis were generated from a stale baseline, so this package deliberately rebinds operational authority to `38bb6e57f118c1543e7263c68d27e5103d3b1262`.

Performed evidence:
- Source inspection: performed. Exact source paths, symbols, test paths, test names, ownership seams, and the accepted parent commit were checked.

Additional unperformed evidence:
- No browser, real provider, external MCP, real Pi package, Windows ACL/auth-recovery, real-host/systemd/pressure/restart, or Pibo2 evidence is claimed.

Package commands after authoring:
- `npm run typecheck` — passed
- `npm run build` — passed, with existing Vite chunk-size warnings
- Exact focused test inventory from the WP-03 brief — 385 tests: 383 passed and 2 identical local-auth baseline failures in exact parent/candidate runs
- Foundation validator/authoring suite — 82 passed

# Related concepts

- [SPC-RUN-003](/specs/runtime/generation-resources-and-portable-tools.md)
- [SPC-CMP-003](/specs/compute/browser-pools-and-leases.md)
- [SPC-OP-001](/specs/operator/operator-cli.md)
