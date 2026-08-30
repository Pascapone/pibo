---
type: "Specification"
title: "Operator CLI Discovery, Dispatch, Errors, and Domain Commands"
description: "Defines the implemented operator cli discovery, dispatch, errors, and domain commands contract and its current ownership, security, compatibility, and verification boundaries."
tags:
- operator
- tooling
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T10:45:00Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:Foundation 38bb6e57f118c1543e7263c68d27e5103d3b1262"
    title: "Foundation source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-05+09-COMPUTE-OPERATOR"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_and_typecheck_execution: "performed in owned Docker after authoring; see implementation report"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "OP-CLI-001"
      status: "implemented"
      sources:
        - path: src/bin/pibo.ts
          symbol: runPiboCli
        - path: src/cli.ts
          symbol: runPiboCli
      tests:
        - path: test/mcp-cli.test.mjs
          name: "pibo without args prints compact discovery"
        - path: test/resources-cli.test.mjs
          name: "root discovery includes resources and resources help exposes only immediate actions"
        - path: test/cli-ui-session-app.test.mjs
          name: "pibo tui:sessions command help and root discovery describe the new UI without hiding existing TUI commands"
      public:
        - "pibo"
        - "src/bin/pibo.ts"
      failures:
        - "Compatibility entrypoints remain callable even when discovery omissions exist; root dispatch must not claim absent registrations."
      confidence: high
    - id: "OP-CLI-002"
      status: "implemented"
      sources:
        - path: src/cli.ts
          symbol: printRootDiscoveryText
        - path: src/mcp/index.ts
          symbol: runMcpCli
        - path: src/skills/cli.ts
          symbol: runSkillsCli
      tests:
        - path: test/mcp-cli.test.mjs
          name: "pibo root help prints compact discovery"
        - path: test/mcp-cli.test.mjs
          name: "pibo mcp help stays progressive"
        - path: test/skills-cli.test.mjs
          name: "skills help exits successfully without a subcommand"
      public:
        - "pibo --help"
        - "domain --help/show/schema/paths/doctor/guides/guide surfaces"
      failures:
        - "Help output is bounded and immediate; deeper operational detail belongs behind explicit subcommands."
      confidence: high
    - id: "OP-CLI-003"
      status: "implemented"
      sources:
        - path: src/cli-errors.ts
          symbol: CliError
        - path: src/cli-errors.ts
          symbol: formatCliError
        - path: src/mcp/index.ts
          symbol: runMcpCli
      tests:
        - path: test/mcp-cli.test.mjs
          name: "pibo mcp parser reports focused errors for invalid command shapes"
      public:
        - "CliError"
        - "formatCliError"
        - "--json domain outputs"
      failures:
        - "CliError categories and JSON parity are incomplete; plain errors remain an explicit compatibility gap rather than silently normalized behavior."
      confidence: medium
    - id: "OP-CLI-004"
      status: "implemented"
      sources:
        - path: src/cli.ts
          symbol: runPiboCli
        - path: src/data/cli.ts
          symbol: runDataCli
        - path: src/resources/cli.ts
          symbol: runResourcesCli
        - path: src/previews/cli.ts
          symbol: runPreviewCli
      tests:
        - path: test/data-cli.test.mjs
          name: "pibo data inventory is read-only and reports missing stores"
        - path: test/profile-cli.test.mjs
          name: "pibo profile resolves active saved Chat custom agents"
      public:
        - "runPiboCli domain dispatch"
        - "runDataCli"
        - "runResourcesCli"
        - "runPreviewCli"
      failures:
        - "The root runner delegates and does not become authoritative for domain persistence, lifecycle, or security state."
      confidence: high
    - id: "OP-CLI-005"
      status: "implemented"
      sources:
        - path: src/cli.ts
          symbol: runPiboCli
        - path: src/config/config.ts
          symbol: redactPiboConfig
        - path: src/data/cli.ts
          symbol: runDataCli
        - path: src/resources/cli.ts
          symbol: runResourcesCli
      tests:
        - path: test/data-cli.test.mjs
          name: "pibo data inventory is read-only and reports missing stores"
        - path: test/resources-cli.test.mjs
          name: "resource reap dry-run aggregates browser, stale-file, and compute plans while preserving worktrees"
      public:
        - "pibo data inventory"
        - "pibo resources reap"
        - "pibo config show"
      failures:
        - "Risky operations are read-only or dry-run by default; mutation requires explicit flags, private home initialization, and secret redaction."
      confidence: high
---
# Operator CLI Discovery, Dispatch, Errors, and Domain Commands

## Why

Operators need one discoverable CLI surface that delegates to feature owners while keeping risky actions explicit and errors understandable.

## Scope

This specification describes implemented behavior at the traceability commit. It owns the contracts listed below and does not turn adjacent implementation or future plans into current authority.

### In scope

- Root command registration/dispatch, iterative discovery conventions, shared CLI error vocabulary/formatter, private-home initialization, config redaction, and operator data/resources domain entrypoints.

### Out of scope

- Feature-domain state machines or persistence merely reached through dispatch.
- Gateway lifecycle/auth/data truth owned by gateway, security, and data specs.
- Terminal rendering/interactions owned by SPC-OP-003; this spec only registers entrypoints.
- Browser tooling and compute resource semantics owned by compute specs.

## Current behavior

### Commands

- Registered root surface: auth, mcp, tools, pi-packages, debug, data, gateway, compute, resources, preview, setup, skills, cron, loop, ralph, vscode, config, profile, tui, tui:routed, tui:sessions, router, gateway:web, client. Root discovery currently prints all except compatibility router.

### Apis

- Installed bin src/bin/pibo.ts invokes runPiboCli; domain CLIs receive normalized argv. No network API is owned.

### State

- Any non-help/version command initializes private PIBO_HOME; config/profile and each feature retain their own stores. pibo data inventory is read-only; migrate sessions-to-v2 is idempotent but writes its explicit target.

### Lifecycle

- Parse root help/version without home mutation; initialize private home for commands; dispatch one domain branch or Commander command; domain owner executes and closes its resources.

### Failure

- CliError defines CLIENT_ERROR=1, SERVER_ERROR=2, NETWORK_ERROR=3, and AUTH_ERROR=4 plus stable formatting, but normalization is not universal: several domain CLIs still throw plain Error and use exit 1; JSON error parity is incomplete.

### Security

- Config display redacts secret keys; private home permissions are initialized; public gateway binds/auth modes are validated before start; destructive domain operations require their explicit flags.

### Compatibility

- ralph remains a root family; gateway:web, router, and TUI variants remain compatibility/direct entrypoints. Help must expose only immediate choices and next commands.

## Requirements and invariants

### Requirement: OP-CLI-001

Register and dispatch the complete root command surface, including compatibility entrypoints, from the installed pibo binary.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/bin/pibo.ts` — `runPiboCli`; `src/cli.ts` — `runPiboCli`
- Tests: `test/mcp-cli.test.mjs` — “pibo without args prints compact discovery”; `test/resources-cli.test.mjs` — “root discovery includes resources and resources help exposes only immediate actions”; `test/cli-ui-session-app.test.mjs` — “pibo tui:sessions command help and root discovery describe the new UI without hiding existing TUI commands”
- Failure/security boundary: Compatibility entrypoints remain callable even when discovery omissions exist; root dispatch must not claim absent registrations.
- Confidence: **high**

### Requirement: OP-CLI-002

Keep root and nested help iterative: show immediate actions, concise context, and a concrete next discovery command without repeating full project guidance.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/cli.ts` — `printRootDiscoveryText`; `src/mcp/index.ts` — `runMcpCli`; `src/skills/cli.ts` — `runSkillsCli`
- Tests: `test/mcp-cli.test.mjs` — “pibo root help prints compact discovery”; `test/mcp-cli.test.mjs` — “pibo mcp help stays progressive”; `test/skills-cli.test.mjs` — “skills help exits successfully without a subcommand”
- Failure/security boundary: Help output is bounded and immediate; deeper operational detail belongs behind explicit subcommands.
- Confidence: **high**

### Requirement: OP-CLI-003

Use bounded text/JSON output and shared error categories where adopted, while documenting and closing remaining plain-Error and JSON-error inconsistencies.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/cli-errors.ts` — `CliError`; `src/cli-errors.ts` — `formatCliError`; `src/mcp/index.ts` — `runMcpCli`
- Tests: `test/mcp-cli.test.mjs` — “pibo mcp parser reports focused errors for invalid command shapes”
- Failure/security boundary: CliError categories and JSON parity are incomplete; plain errors remain an explicit compatibility gap rather than silently normalized behavior.
- Confidence: **medium**

### Requirement: OP-CLI-004

Delegate domain execution through one root entrypoint without copying each feature's normative state, lifecycle, or security contract into the operator CLI spec.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/cli.ts` — `runPiboCli`; `src/data/cli.ts` — `runDataCli`; `src/resources/cli.ts` — `runResourcesCli`; `src/previews/cli.ts` — `runPreviewCli`
- Tests: `test/data-cli.test.mjs` — “pibo data inventory is read-only and reports missing stores”; `test/profile-cli.test.mjs` — “pibo profile resolves active saved Chat custom agents”
- Failure/security boundary: The root runner delegates and does not become authoritative for domain persistence, lifecycle, or security state.
- Confidence: **high**

### Requirement: OP-CLI-005

Default risky cleanup and inspection to read-only or dry-run, require explicit mutation flags, initialize a private home, and redact secret configuration.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/cli.ts` — `runPiboCli`; `src/config/config.ts` — `redactPiboConfig`; `src/data/cli.ts` — `runDataCli`; `src/resources/cli.ts` — `runResourcesCli`
- Tests: `test/data-cli.test.mjs` — “pibo data inventory is read-only and reports missing stores”; `test/resources-cli.test.mjs` — “resource reap dry-run aggregates browser, stale-file, and compute plans while preserving worktrees”
- Failure/security boundary: Risky operations are read-only or dry-run by default; mutation requires explicit flags, private home initialization, and secret redaction.
- Confidence: **high**

## Interfaces and ownership

**Capability IDs:** pibo.operator.cli, pibo.operator.data-resources

**Public surfaces:**

- pibo
- src/bin/pibo.ts
- pibo --help
- domain --help/show/schema/paths/doctor/guides/guide surfaces
- CliError
- formatCliError
- --json domain outputs
- runPiboCli domain dispatch
- runDataCli
- runResourcesCli
- runPreviewCli
- pibo data inventory
- pibo resources reap
- pibo config show

The operator CLI registers and dispatches domain commands; each domain specification remains authoritative for its state, persistence, and security behavior.

Related concepts:

- [/specs/product/home-workspace-configuration.md](/specs/product/home-workspace-configuration.md)
- [/specs/data/product-store-history-and-read-models.md](/specs/data/product-store-history-and-read-models.md)
- [/specs/security/private-files-and-http.md](/specs/security/private-files-and-http.md)
- [/specs/operator/debug-web-and-pty.md](/specs/operator/debug-web-and-pty.md)

## Failure and security behavior

- CliError defines CLIENT_ERROR=1, SERVER_ERROR=2, NETWORK_ERROR=3, and AUTH_ERROR=4 plus stable formatting, but normalization is not universal: several domain CLIs still throw plain Error and use exit 1; JSON error parity is incomplete.
- Config display redacts secret keys; private home permissions are initialized; public gateway binds/auth modes are validated before start; destructive domain operations require their explicit flags.

## Known limits

- Root discovery omits the registered compatibility router command.
- No single test proves registration/discovery parity across the whole root surface.
- Shared CliError adoption and JSON error shape are incomplete across domain CLIs.
- The synthesis assigns debug-cli tests here although debug behavior belongs to SPC-OP-002; use them only for root dispatch/discovery traces.

## Reconciled stale claims

- Reject old root command lists that omit resources, preview, setup, loop, vscode, or the newer TUI entrypoint.
- Reject final-cutover data commands and obsolete tests; current data commands are inventory and migrate sessions-to-v2.
- Reject universal error/exit/JSON normalization as already complete.
- Reject operator CLI ownership of gateway, data-store, browser, compute, or terminal state machines.

## Verification and traceability

All source and named-test references are bound to Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. The traceability commit is evidence authority; it does not imply that a test, build, package, Docker, deployment-pool, browser/CDP, headful, PTY, gateway-restart, real-host/provider, Windows, or Pibo2 path passed. Focused execution and build/typecheck/package results are recorded in the implementation report.

Later validation commands:

- node --test test/mcp-cli.test.mjs test/profile-cli.test.mjs test/legacy-product-vocabulary-gate.test.mjs test/data-cli.test.mjs test/resources-cli.test.mjs test/skills-cli.test.mjs
- npm run build && npm pack --dry-run
- pibo --help && pibo --version && pibo data --help && pibo resources --help
- pibo debug pty run --expect 'Commands:' -- pibo --help
