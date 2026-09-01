---
type: "Specification"
title: "External MCP and Pi Package Management"
description: "Defines the implemented external mcp and pi package management contract and its current ownership, security, and verification boundaries."
tags: ["resources", "security-boundaries"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
    title: "Source and test evidence inspected for SPC-RES-004"
implementation:
  state: "current"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-03-RESOURCES-SECURITY"
  source_evidence: "performed"
  focused_test_execution: "performed: 383 passed, 2 baseline failures in local-auth.test.mjs"
  build_and_typecheck_execution: "performed: npm run typecheck and npm run build passed"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "RES-MCP-001"
      status: "implemented"
      sources:
        - path: "src/mcp/config.ts"
          symbol: "getConfigSearchPaths"
        - path: "src/mcp/config.ts"
          symbol: "loadConfigUnresolved"
        - path: "src/mcp/config.ts"
          symbol: "loadConfig"
        - path: "src/mcp/config.ts"
          symbol: "filterTools"
        - path: "src/mcp/config.ts"
          symbol: "resolveMcpServerConfigSource"
        - path: "src/mcp/agent-context.ts"
          symbol: "setMcpServerDescription"
        - path: "src/mcp/daemon.ts"
          symbol: "runDaemon"
        - path: "src/mcp/daemon.ts"
          symbol: "processIdentityMatches"
        - path: "src/mcp/daemon.ts"
          symbol: "removeDaemonState"
        - path: "src/mcp/daemon-client.ts"
          symbol: "getDaemonConnection"
        - path: "src/mcp/daemon-client.ts"
          symbol: "cleanupOrphanedDaemons"
      tests:
        - path: "test/mcp-cli.test.mjs"
          name: "pibo mcp config path follows explicit env cwd home priority"
        - path: "test/mcp-cli.test.mjs"
          name: "pibo mcp info without a server merges an empty cwd config with home servers"
        - path: "test/mcp-daemon.test.mjs"
          name: "simultaneous first calls across processes elect one daemon in repeated rounds"
        - path: "test/mcp-daemon.test.mjs"
          name: "dead stale ownership and PID metadata recover under concurrent callers"
        - path: "test/mcp-daemon.test.mjs"
          name: "simultaneous config changes serialize active daemon generations"
        - path: "test/mcp-daemon-ownership.test.mjs"
          name: "stale PID metadata never signals an unrelated reused process"
        - path: "test/mcp-daemon-ownership.test.mjs"
          name: "PID and endpoint cleanup preserve a newer generation in every owner path"
        - path: "test/mcp-config-merge.test.mjs"
          name: "MCP config source resolution follows merged precedence"
        - path: "test/mcp-agent-context.test.mjs"
          name: "MCP descriptions update the winning config source"
      public:
        - "pibo mcp command family"
        - "pibo pi-packages command family"
        - "Chat MCP descriptions and Pi package CRUD"
        - "CLI/runtime manage MCP config, daemon clients, tools/resources/calls and registered Pi extension packages; Chat exposes package CRUD and MCP descriptions."
      failures:
        - "Configuration filters and scoped secret rebinding prevent broad credential delivery; mutation is same-origin, Chat Web deletion checks selected-agent conflicts, and CLI registration removal does not perform that cross-record check."
        - "Config filters and scoped secret rebinding prevent broad credential delivery; mutations require same origin, while package-removal conflict checks are surface-specific."
      confidence: "high"
    - id: "RES-MCP-002"
      status: "implemented"
      sources:
        - path: "src/mcp/config.ts"
          symbol: "ServerConfig"
        - path: "src/mcp/config.ts"
          symbol: "isHttpServer"
        - path: "src/mcp/config.ts"
          symbol: "isStdioServer"
        - path: "src/mcp/config.ts"
          symbol: "getConcurrencyLimit"
        - path: "src/mcp/config.ts"
          symbol: "getMaxRetries"
        - path: "src/mcp/client.ts"
          symbol: "McpConnection"
        - path: "src/mcp/client.ts"
          symbol: "getConnection"
        - path: "src/mcp/client.ts"
          symbol: "callTool"
        - path: "src/mcp/daemon-client.ts"
          symbol: "DaemonConnection"
        - path: "src/mcp/index.ts"
          symbol: "runMcpCli"
      tests:
        - path: "test/mcp-cli.test.mjs"
          name: "pibo mcp help stays progressive"
        - path: "test/mcp-cli.test.mjs"
          name: "pibo mcp parser reports focused errors for invalid command shapes"
        - path: "test/mcp-cli.test.mjs"
          name: "pibo mcp config can create, add, show, and remove servers"
      public:
        - "pibo mcp command family"
        - "pibo pi-packages command family"
        - "Chat MCP descriptions and Pi package CRUD"
        - "CLI/runtime manage MCP config, daemon clients, tools/resources/calls and registered Pi extension packages; Chat exposes package CRUD and MCP descriptions."
      failures:
        - "Configuration filters and scoped secret rebinding prevent broad credential delivery; mutation is same-origin, Chat Web deletion checks selected-agent conflicts, and CLI registration removal does not perform that cross-record check."
        - "Config filters and scoped secret rebinding prevent broad credential delivery; mutations require same origin, while package-removal conflict checks are surface-specific."
      confidence: "high"
    - id: "RES-MCP-003"
      status: "implemented"
      sources:
        - path: "src/pi-packages/store.ts"
          symbol: "listPiPackages"
        - path: "src/pi-packages/store.ts"
          symbol: "upsertPiPackage"
        - path: "src/pi-packages/store.ts"
          symbol: "removePiPackage"
        - path: "src/pi-packages/store.ts"
          symbol: "setPiPackageEnabled"
        - path: "src/pi-packages/runtime.ts"
          symbol: "getPiPackageRuntimeOptions"
        - path: "src/pi-packages/metadata.ts"
          symbol: "parsePiPackageSource"
        - path: "src/pi-packages/metadata.ts"
          symbol: "inspectPiPackageSource"
      tests:
        - path: "test/pi-packages.test.mjs"
          name: "pi package store preserves previous installed package when refresh input is error"
        - path: "test/pi-packages.test.mjs"
          name: "pi package runtime bridge only loads selected registered packages"
        - path: "test/pi-packages.test.mjs"
          name: "pi package runtime skips globally disabled selected packages"
      public:
        - "pibo mcp command family"
        - "pibo pi-packages command family"
        - "Chat MCP descriptions and Pi package CRUD"
        - "CLI/runtime manage MCP config, daemon clients, tools/resources/calls and registered Pi extension packages; Chat exposes package CRUD and MCP descriptions."
      failures:
        - "Configuration filters and scoped secret rebinding prevent broad credential delivery; mutation is same-origin, Chat Web deletion checks selected-agent conflicts, and CLI registration removal does not perform that cross-record check."
        - "Config filters and scoped secret rebinding prevent broad credential delivery; mutations require same origin, while package-removal conflict checks are surface-specific."
      confidence: "high"
    - id: "RES-MCP-004"
      status: "implemented"
      sources:
        - path: "src/mcp/runtime-session.ts"
          symbol: "scopePiboMcpServerConfig"
        - path: "src/mcp/runtime-session.ts"
          symbol: "redactMcpRuntimeError"
        - path: "src/apps/chat/chat-capability-routes.ts"
          symbol: "handleChatCapabilityRoute"
        - path: "src/apps/chat/chat-capability-routes.ts"
          symbol: "chatCapabilityRouteRequiresSameOrigin"
        - path: "src/pi-packages/metadata.ts"
          symbol: "parsePiPackageSource"
        - path: "src/pi-packages/cli.ts"
          symbol: "runPiPackagesCli"
        - path: "src/mcp/config-command.ts"
          symbol: "configCommand"
      tests:
        - path: "test/pi-packages.test.mjs"
          name: "pi package source parser rejects non-pi.dev URLs"
        - path: "test/pi-packages.test.mjs"
          name: "pibo pi-packages CLI provides progressive help and local add/list/remove"
        - path: "test/web-channel.test.mjs"
          name: "chat web app manages Pi package registrations and custom agent selections"
        - path: "test/web-channel.test.mjs"
          name: "chat web app rejects non-pi.dev package sources from browser adds"
        - path: "test/mcp-cli.test.mjs"
          name: "pibo mcp config refuses to remove servers selected by custom agents"
        - path: "test/mcp-cli.test.mjs"
          name: "pibo mcp config allows removing an override when a lower-priority source retains the selected server"
      public:
        - "pibo mcp command family"
        - "pibo pi-packages command family"
        - "Chat MCP descriptions and Pi package CRUD"
        - "CLI/runtime manage MCP config, daemon clients, tools/resources/calls and registered Pi extension packages; Chat exposes package CRUD and MCP descriptions."
      failures:
        - "Configuration filters and scoped secret rebinding prevent broad credential delivery; mutation is same-origin, Chat Web deletion checks selected-agent conflicts, and CLI registration removal does not perform that cross-record check."
        - "Config filters and scoped secret rebinding prevent broad credential delivery; mutations require same origin, while package-removal conflict checks are surface-specific."
      confidence: "medium"
verification:
  required_evidence_classes:
    - "source inspection"
    - "focused tests"
    - "build/package checks"
    - "external-provider/Pibo2 acceptance"
  performed:
    - evidence_class: "source inspection"
      status: "performed"
      detail: "Exact source files, symbols, test files, and test names were reconciled to upstream/dev refresh commit 39090b8850758293e69380a52bb7498d7c955bc2."
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
    claim: "Removing any selected Pi package is always conflict-checked."
    reason: "Chat Web deletion checks custom-agent selection; the CLI remove path removes the registration without that cross-record check."
  - id: "WP03-STALE-002"
    claim: "Unsupported agent runtimes are rejected by the Pi-package registry."
    reason: "Only the Pi adapter consumes package paths; runtime compatibility is validated by runtime/profile owners."
open_evidence_gaps:
  - id: "WP03-GAP-002"
    specs: ["SPC-RES-003", "SPC-RES-004"]
    gap: "Selected-only generation delivery is primarily tested by runtime-package suites outside WP-03; add cross-spec links and focused trace evidence rather than duplicating mechanics."
  - id: "WP03-GAP-003"
    specs: ["SPC-RES-004"]
    gap: "Chat Web selected-Pi-package delete conflict lacks a narrowly named dedicated test; the broad management integration test covers the route."
  - id: "WP03-GAP-009"
    specs: ["SPC-RES-001", "SPC-RES-002", "SPC-RES-003", "SPC-RES-004", "SPC-RES-005", "SPC-SEC-001", "SPC-SEC-002", "SPC-SEC-003"]
    gap: "Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance."
---

# Scope and exclusions

External MCP registry/config/daemon/tool/resource/call surfaces and Pi extension-package registration, installation, profile selection, and removal conflicts.

This specification records current behavior only. It does not authorize unimplemented hardening, duplicate the linked runtime/gateway/data owner, or convert unperformed validation into evidence.

# Current behavior and public surfaces

The implementation state is current at upstream refresh commit `39090b8850758293e69380a52bb7498d7c955bc2`.

Implemented behavior:
- "pibo mcp command family"
- "pibo pi-packages command family"
- "Chat MCP descriptions and Pi package CRUD"
- "CLI/runtime manage MCP config, daemon clients, tools/resources/calls and registered Pi extension packages; Chat exposes package CRUD and MCP descriptions."
- "MCP configuration search order is explicit path, MCP_CONFIG_PATH, cwd, then home variants; first source wins a duplicate server name and disabledTools overrides allowedTools."
- "Description edits update the highest-priority writable config source that contributes the server; they do not create shadow entries for unknown or registry-owned servers. Removing the last effective definition of an MCP server selected by any active or archived custom agent is rejected, while removing an override is allowed when a lower-priority source still supplies the server."
- "MCP supports stdio or HTTP, bounded retries/timeouts/concurrency, filtered tools, resources/templates, daemon ownership/election/recovery, and a 1 MiB daemon response bound."
- "Runtime resource sessions scope selected MCP secrets into generated environment references, retain resolved values only in ephemeral adapter environment, and redact known secret values from errors."
- "Pi package records persist registered/install/error/enabled state; runtime options include only selected, enabled, installed packages and diagnose skipped entries."

Public surfaces:
- "pibo mcp command family"
- "pibo pi-packages command family"
- "Chat MCP descriptions and Pi package CRUD"
- "CLI/runtime manage MCP config, daemon clients, tools/resources/calls and registered Pi extension packages; Chat exposes package CRUD and MCP descriptions."

# State, lifecycle, and invariants

- "Only profile-selected MCP servers and Pi packages enter a runtime; Pi packages remain Pi-only."
- "Only profile-selected servers/packages enter a runtime; Chat Web deletion checks selected-package conflicts, while CLI registration removal lacks that cross-record check."
- "MCP daemon PID/claim/lease cleanup verifies process/generation identity and must not signal or remove a newer/unrelated owner."
- "Failed Pi package refresh preserves the previous installed record."
- "Chat Web deletion conflicts when a package is selected by a custom agent; the CLI remove path currently does not perform that cross-record conflict check."
- "Pi package installation may invoke the package manager; real untrusted sources require isolated validation and must not be used by deterministic focused tests."

Persistence and lifecycle state: MCP config/registry state and pi-packages.json-style store under PIBO_HOME.

# Requirements and invariants

## Requirement: RES-MCP-001: Merge MCP configuration with the documented first-source-wins precedence and manage one identity-checked daemon generation through election, claim/lease/PID ownership, stale recovery, and safe cleanup

Merge MCP configuration with the documented first-source-wins precedence and manage one identity-checked daemon generation through election, claim/lease/PID ownership, stale recovery, and safe cleanup.

**Implementation state:** `implemented_at_baseline` at `39090b8850758293e69380a52bb7498d7c955bc2`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/mcp/config.ts` — `getConfigSearchPaths`
- `src/mcp/config.ts` — `loadConfigUnresolved`
- `src/mcp/config.ts` — `loadConfig`
- `src/mcp/config.ts` — `filterTools`
- `src/mcp/daemon.ts` — `runDaemon`
- `src/mcp/daemon.ts` — `processIdentityMatches`
- `src/mcp/daemon.ts` — `removeDaemonState`
- `src/mcp/daemon-client.ts` — `getDaemonConnection`
- `src/mcp/daemon-client.ts` — `cleanupOrphanedDaemons`

**Named test traceability:**
- `test/mcp-cli.test.mjs` — `pibo mcp config path follows explicit env cwd home priority`
- `test/mcp-cli.test.mjs` — `pibo mcp info without a server merges an empty cwd config with home servers`
- `test/mcp-daemon.test.mjs` — `simultaneous first calls across processes elect one daemon in repeated rounds`
- `test/mcp-daemon.test.mjs` — `dead stale ownership and PID metadata recover under concurrent callers`
- `test/mcp-daemon.test.mjs` — `simultaneous config changes serialize active daemon generations`
- `test/mcp-daemon-ownership.test.mjs` — `stale PID metadata never signals an unrelated reused process`
- `test/mcp-daemon-ownership.test.mjs` — `PID and endpoint cleanup preserve a newer generation in every owner path`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-MCP-002: Expose MCP tools, resources, templates, and calls through transport-exclusive validated configs, tool filters, configured concurrency/retry/time limits, bounded daemon messages, and focused progressive CLI errors

Expose MCP tools, resources, templates, and calls through transport-exclusive validated configs, tool filters, configured concurrency/retry/time limits, bounded daemon messages, and focused progressive CLI errors.

**Implementation state:** `implemented_at_baseline` at `39090b8850758293e69380a52bb7498d7c955bc2`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/mcp/config.ts` — `ServerConfig`
- `src/mcp/config.ts` — `isHttpServer`
- `src/mcp/config.ts` — `isStdioServer`
- `src/mcp/config.ts` — `getConcurrencyLimit`
- `src/mcp/config.ts` — `getMaxRetries`
- `src/mcp/client.ts` — `McpConnection`
- `src/mcp/client.ts` — `getConnection`
- `src/mcp/client.ts` — `callTool`
- `src/mcp/daemon-client.ts` — `DaemonConnection`
- `src/mcp/index.ts` — `runMcpCli`

**Named test traceability:**
- `test/mcp-cli.test.mjs` — `pibo mcp help stays progressive`
- `test/mcp-cli.test.mjs` — `pibo mcp parser reports focused errors for invalid command shapes`
- `test/mcp-cli.test.mjs` — `pibo mcp config can create, add, show, and remove servers`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-MCP-003: Persist Pi package registration/install/error/enabled state and pass only selected, enabled, installed package paths to the Pi adapter, diagnosing unknown, disabled, failed, or missing selections

Persist Pi package registration/install/error/enabled state and pass only selected, enabled, installed package paths to the Pi adapter, diagnosing unknown, disabled, failed, or missing selections.

**Implementation state:** `implemented_at_baseline_with_RUN_004_execution_boundary` at `39090b8850758293e69380a52bb7498d7c955bc2`.

**Confidence:** `high`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/pi-packages/store.ts` — `listPiPackages`
- `src/pi-packages/store.ts` — `upsertPiPackage`
- `src/pi-packages/store.ts` — `removePiPackage`
- `src/pi-packages/store.ts` — `setPiPackageEnabled`
- `src/pi-packages/runtime.ts` — `getPiPackageRuntimeOptions`
- `src/pi-packages/metadata.ts` — `parsePiPackageSource`
- `src/pi-packages/metadata.ts` — `inspectPiPackageSource`

**Named test traceability:**
- `test/pi-packages.test.mjs` — `pi package store preserves previous installed package when refresh input is error`
- `test/pi-packages.test.mjs` — `pi package runtime bridge only loads selected registered packages`
- `test/pi-packages.test.mjs` — `pi package runtime skips globally disabled selected packages`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


## Requirement: RES-MCP-004: Scope MCP secret-bearing fields into ephemeral generated environment references and redact known values from runtime errors; reject invalid package source forms; enforce selected-package deletion conflict on the Chat Web route while documenting that CLI registration removal is not conflict-checked

Scope MCP secret-bearing fields into ephemeral generated environment references and redact known values from runtime errors; reject invalid package source forms; enforce selected-package deletion conflict on the Chat Web route while documenting that CLI registration removal is not conflict-checked.

**Implementation state:** `implemented_at_baseline_with_explicit_surface_asymmetry` at `39090b8850758293e69380a52bb7498d7c955bc2`.

**Confidence:** `medium`. Confidence describes source/test trace quality, not a claim that the package validation suite has passed.

**Source traceability:**
- `src/mcp/runtime-session.ts` — `scopePiboMcpServerConfig`
- `src/mcp/runtime-session.ts` — `redactMcpRuntimeError`
- `src/apps/chat/chat-capability-routes.ts` — `handleChatCapabilityRoute`
- `src/apps/chat/chat-capability-routes.ts` — `chatCapabilityRouteRequiresSameOrigin`
- `src/pi-packages/metadata.ts` — `parsePiPackageSource`
- `src/pi-packages/cli.ts` — `runPiPackagesCli`

**Named test traceability:**
- `test/pi-packages.test.mjs` — `pi package source parser rejects non-pi.dev URLs`
- `test/pi-packages.test.mjs` — `pibo pi-packages CLI provides progressive help and local add/list/remove`
- `test/web-channel.test.mjs` — `chat web app manages Pi package registrations and custom agent selections`
- `test/web-channel.test.mjs` — `chat web app rejects non-pi.dev package sources from browser adds`

**Acceptance boundary:** The named source and test records are exact regular-file evidence records. Their presence does not mean the named test ran in this package execution.


# Interfaces and ownership

Capability IDs: "pibo.resources.mcp-pi-packages".

Exact source files inspected for this owner:
- "src/apps/chat/chat-capability-routes.ts"
- "src/mcp/client.ts"
- "src/mcp/config.ts"
- "src/mcp/daemon-client.ts"
- "src/mcp/daemon.ts"
- "src/mcp/index.ts"
- "src/mcp/runtime-session.ts"
- "src/pi-packages/cli.ts"
- "src/pi-packages/metadata.ts"
- "src/pi-packages/runtime.ts"
- "src/pi-packages/store.ts"

Related ownership boundaries:
- SPC-RUN-003: [generation-resources-and-portable-tools.md](/specs/runtime/generation-resources-and-portable-tools.md) owns the linked contract; this specification does not duplicate it.
- SPC-RUN-004: [pi-adapter.md](/specs/runtime/pi-adapter.md) owns the linked contract; this specification does not duplicate it.
- SPC-OP-001: [operator-cli.md](/specs/operator/operator-cli.md) owns the linked contract; this specification does not duplicate it.

The security policy/mechanics split is explicit: this specification defines the resource or security decision, while linked runtime, gateway, data, web, orchestration, compute, and operator owners provide their execution mechanics.

# Failure, security, privacy, and compatibility behavior

- "Configuration filters and scoped secret rebinding prevent broad credential delivery; mutation is same-origin, Chat Web deletion checks selected-agent conflicts, and CLI registration removal does not perform that cross-record check."
- "Config filters and scoped secret rebinding prevent broad credential delivery; mutations require same origin, while package-removal conflict checks are surface-specific."

Compatibility and privacy limits:
- "MCP daemon PID/claim/lease cleanup verifies process/generation identity and must not signal or remove a newer/unrelated owner."
- "Failed Pi package refresh preserves the previous installed record."
- "Chat Web deletion conflicts when a package is selected by a custom agent; the CLI remove path currently does not perform that cross-record conflict check."
- "Pi package installation may invoke the package manager; real untrusted sources require isolated validation and must not be used by deterministic focused tests."

# Known limits and rejected stale claims

The following over-broad claims are rejected and must not be inferred from this specification:

- **Rejected claim:** Removing any selected Pi package is always conflict-checked. — Chat Web deletion checks custom-agent selection; the CLI remove path removes the registration without that cross-record check.
- **Rejected claim:** Unsupported agent runtimes are rejected by the Pi-package registry. — Only the Pi adapter consumes package paths; runtime compatibility is validated by runtime/profile owners.

Open evidence gaps carried forward:
- `WP03-GAP-002` — Selected-only generation delivery is primarily tested by runtime-package suites outside WP-03; add cross-spec links and focused trace evidence rather than duplicating mechanics.
- `WP03-GAP-003` — Chat Web selected-Pi-package delete conflict lacks a narrowly named dedicated test; the broad management integration test covers the route.
- `WP03-GAP-009` — Canonical synthesis and this read-only brief executed no focused tests, build/package checks, real paths, browser flows, or external/Pibo2 acceptance.

# Verification and traceability

All requirement traceability records use exact repository-relative regular files at `39090b8850758293e69380a52bb7498d7c955bc2`. The brief and synthesis were generated from a stale baseline, so this package deliberately rebinds operational authority to `39090b8850758293e69380a52bb7498d7c955bc2`.

Performed evidence:
- Source inspection: performed. Exact source paths, symbols, test paths, test names, ownership seams, and the accepted parent commit were checked.

Additional unperformed evidence:
- No browser, real provider, external MCP, real Pi package, Windows ACL/auth-recovery, real-host/systemd/pressure/restart, or Pibo2 evidence is claimed.

Package commands after authoring:
- `npm run typecheck` — passed
- `npm run build` — passed, with existing Vite chunk-size warnings
- Exact focused test inventory from the WP-03 brief — 385 tests: 383 passed and 2 identical local-auth baseline failures in exact parent/candidate runs
- upstream/dev refresh validator/authoring suite — 82 passed

# Related concepts

- [SPC-RUN-003](/specs/runtime/generation-resources-and-portable-tools.md)
- [SPC-RUN-004](/specs/runtime/pi-adapter.md)
- [SPC-OP-001](/specs/operator/operator-cli.md)
