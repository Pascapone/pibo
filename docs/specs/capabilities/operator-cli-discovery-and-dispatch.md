# Spec: Operator CLI Discovery and Dispatch

**Status:** Draft  
**Created:** 2026-05-10  
**Updated:** 2026-05-17  
**Owner / Source:** Scheduled Pibo source-spec coverage job  
**Related docs:** [Local Config CLI](./local-config-cli.md), [MCP Server Integration](./mcp-server-integration.md), [Curated CLI Tools](./curated-cli-tools.md), [Local Gateway Protocol and Lifecycle](./local-gateway-protocol-and-lifecycle.md), [Continuous Ralph Jobs](./continuous-ralph-jobs.md)

## Why

Pibo is operated mainly by agents. The top-level CLI is the first discovery surface an agent sees before it chooses a narrower command area. It must stay compact, route to specialized sub-CLIs without exposing their full internals, and preserve compatibility commands for runtime inspection and local execution.

Without a durable contract for root discovery and dispatch, new commands can accidentally make `pibo` noisy, bypass progressive help, or route arguments through Commander in ways that change subcommand behavior.

## Goal

The top-level `pibo` command MUST provide compact progressive discovery, delegate owned command families to their specialized CLIs, and expose direct runtime commands with predictable profile defaults.

## Background / Current State

`src/bin/pibo.ts` invokes `runPiboCli`. `src/cli.ts` intercepts several command families before Commander parsing: `mcp`, `tools`, `pi-packages`, `debug`, `data`, `gateway`, `compute`, `skills`, `cron`, `ralph`, compact `config` help, and `tui:sessions --help`. It prints a custom root discovery text for no arguments and `--help`, then defines direct commands for config, profile inspection, direct Pi TUI, routed TUI, the reduced CLI Session UI, demo router status, web gateway startup, and a console gateway client.

Tests in `test/mcp-cli.test.mjs` already assert that root help is compact and does not fall back to generic Commander `Usage:` output.

## Scope

### In Scope

- Root `pibo` no-argument and help output.
- Top-level dispatch to specialized Pibo CLIs.
- `config` discovery delegation at the root CLI layer.
- Direct runtime, CLI Session UI, and gateway commands still owned by `src/cli.ts`.
- Profile resolution defaults used by root-owned commands.

### Out of Scope

- Detailed behavior inside delegated sub-CLIs — each command family has or should have its own capability spec.
- Chat Web UI command surfaces — covered by web and capability-specific specs.
- Deployment scripts and host gateway operational policy beyond command dispatch.

## Requirements

### Requirement: Root discovery is compact and progressive

The CLI MUST print a custom, compact discovery page when invoked as `pibo`, `pibo --help`, or `pibo -h`.

#### Current

`runPiboCli` returns early for root help flags and for no arguments, printing `printRootDiscoveryText()`.

#### Acceptance

- Running `pibo` exits after printing the root discovery text.
- Running `pibo --help` or `pibo -h` prints the same discovery style.
- Output lists immediate command names and a `Next: pibo <command> --help` hint.
- Output does not include Commander-generated `Usage:` text or profile inspection JSON.

#### Scenario: Agent starts discovery

- GIVEN an agent does not know the Pibo command surface
- WHEN it runs `pibo --help`
- THEN it sees only top-level command families and the next command to inspect

### Requirement: Specialized command families bypass root Commander parsing

The CLI MUST delegate recognized command families to their specialized runners before the generic Commander program parses arguments.

#### Current

`runPiboCli` checks `argv[2]` and calls runners such as `runMcpCli`, `runToolsCli`, `runPiPackagesCli`, `runDebugCli`, `runDataCli`, `runGatewayCli`, `runComputeCli`, `runSkillsCli`, `runCronCli`, and `runRalphCli`.

#### Acceptance

- `pibo mcp --help`, `pibo tools --help`, `pibo cron --help`, `pibo ralph --help`, and similar delegated help commands use the delegated CLI's progressive output.
- Unknown options meant for delegated commands are not rejected by the root CLI.
- The delegated argv preserves the displayed command name, such as `pibo mcp`, `pibo tools`, or `pibo ralph`, where that sub-CLI expects it.
- The root discovery output lists each early-dispatched command family so agents can discover delegated commands without reading source.

#### Scenario: MCP version passthrough

- GIVEN the MCP CLI owns a `--version` flag
- WHEN an operator runs `pibo mcp --version`
- THEN the MCP CLI prints its version rather than root help or a root parse error

### Requirement: Config discovery is handled before full config parsing

The CLI MUST show compact config discovery for `pibo config`, `pibo config --help`, and `pibo config -h` without requiring the full Commander help renderer.

#### Current

`runPiboCli` checks for the config command with no subcommand or a help flag and prints `printConfigDiscoveryText()` before Commander parsing.

#### Acceptance

- `pibo config` and `pibo config --help` print the local config path, immediate config actions, and `Next: pibo config keys`.
- The config discovery output does not include generic Commander `Usage:` text.
- Subcommands `keys`, `show`, `get`, `set`, and `del` remain available through the config command.

#### Scenario: Agent inspects config safely

- GIVEN an agent needs to know which config keys exist
- WHEN it runs `pibo config --help`
- THEN the output points to `pibo config keys` instead of dumping all config details

### Requirement: Root-owned profile commands use the default plugin registry

The `profile` and direct `tui` commands MUST create profiles through the default Pibo plugin registry unless the gateway-producer compatibility alias is requested.

#### Current

`createCliProfile()` returns `createGatewayProducerPiboProfile()` for `gateway-producer` or `pibo-gateway-producer`; otherwise it calls `createDefaultPiboPluginRegistry().createProfile(profileName ?? "codex-compat-openai-web")`.

#### Acceptance

- `pibo profile` inspects the `codex-compat-openai-web` profile by default.
- `pibo profile codex` resolves through the default registry and may use aliases registered there.
- `pibo profile gateway-producer` and `pibo profile pibo-gateway-producer` use the gateway producer profile path.
- Unknown profiles fail with the registry's unknown-profile error rather than silently falling back.

#### Scenario: Inspect default profile

- GIVEN no profile argument is provided
- WHEN an operator runs `pibo profile`
- THEN the CLI prints JSON inspection for the canonical default profile

### Requirement: Direct, routed, and session TUI commands remain distinct

The CLI MUST keep direct Pi TUI execution, routed Pibo TUI execution, and the reduced CLI Session UI as separate entry points.

#### Current

`pibo tui [profile]` calls `runPiboTui` with a CLI-created profile. `pibo tui:routed [profile]` calls `runLocalRoutedTui` and accepts routed thinking options. `pibo tui:sessions` starts the Ink-based reduced Web Chat-derived session UI, and its help is printed directly for `pibo tui:sessions --help` so Commander does not replace the compact command guidance.

#### Acceptance

- `pibo tui` starts direct Pi runtime execution with the selected profile.
- `pibo tui:routed` starts the local routed runtime path rather than direct Pi execution.
- `pibo tui:routed --show-thinking` enables local display of routed thinking deltas.
- `pibo tui:routed --thinking <level>` accepts only levels parsed by `parsePiboThinkingLevel`.
- `pibo tui:sessions --help` prints the CLI Session UI help, including `/help /new /session /agent /status /clear /exit /quit` and existing TUI command boundaries.
- `pibo tui:sessions` accepts `--session`, `--app-space`, `--max-rows`, and `--demo` without changing `pibo tui` or `pibo tui:routed` behavior.

#### Scenario: Routed QA with thinking

- GIVEN an operator wants local routed QA with visible thinking
- WHEN it runs `pibo tui:routed --show-thinking --thinking medium codex`
- THEN the routed TUI receives the selected profile and thinking controls

### Scenario: Session UI help

- GIVEN an operator wants the reduced session UI
- WHEN it runs `pibo tui:sessions --help`
- THEN the CLI prints session-UI-specific help instead of root Commander help.

### Requirement: Root gateway commands expose only explicit entry points

The root CLI MUST expose safe gateway management through the delegated `gateway` command and a separate `gateway:web` runtime start command.

#### Current

`pibo gateway` delegates to `runGatewayCli(argv)`. `pibo gateway:web` is root-owned and calls `runWebGatewayServer` with optional `--web-host` and `--web-port` values.

#### Acceptance

- `pibo gateway ...` uses the gateway management CLI and its safety checks.
- `pibo gateway:web` starts a web gateway runtime only when explicitly requested.
- `--web-port` must be an integer from 1 through 65535.
- Invalid ports fail before calling the web gateway server.

#### Scenario: Invalid web port

- GIVEN an operator mistypes a web port
- WHEN it runs `pibo gateway:web --web-port 70000`
- THEN the CLI rejects the value as outside the valid TCP port range

### Requirement: Compatibility commands remain bounded and explicit

Root-owned compatibility commands MUST keep their narrow current purpose and must not become broad hidden operational surfaces.

#### Current

`router` emits a demo router status event for a selected Pibo Session ID. `client` starts a console gateway client for a selected session. Both are explicit commands in `src/cli.ts`.

#### Acceptance

- `pibo router [piboSessionId]` creates a transient non-persistent router and emits a status execution event.
- `pibo router` defaults to the demo Pibo Session ID `demo`.
- `pibo client [piboSessionId]` starts a console gateway client and defaults to `default`.
- These commands do not create scheduled jobs, modify source files, or restart host gateways.

#### Scenario: Demo router status

- GIVEN an operator runs `pibo router ps_demo`
- WHEN the command completes
- THEN it prints the emitted status event JSON and disposes the transient router

## Edge Cases

- A delegated command with its own unknown options must not be blocked by root Commander definitions.
- Adding a new top-level command requires updating root discovery text, early dispatch behavior, fallback Commander passthrough, and this spec's verification coverage consistently.
- Root help should stay useful when the package is executed through `npm run dev --` or installed as `pibo`.
- Port parsing must reject non-numeric, fractional, zero, negative, and above-range values.
- Profile aliases must resolve through the plugin registry, not through ad hoc string matching except for the gateway-producer compatibility aliases.

## Constraints

- **Compatibility:** Keep the installed binary entry point at `dist/bin/pibo.js` through `package.json` and `src/bin/pibo.ts`.
- **Progressive discovery:** Root output must show only immediate command families and next-step hints.
- **Safety:** Host gateway management must remain behind the gateway CLI's safety checks; `gateway:web` must remain an explicit runtime start command.
- **Dependencies:** Commander may define root-owned commands, but custom discovery text controls the root help path.

## Success Criteria

- [ ] SC-001: `pibo`, `pibo --help`, and `pibo -h` print compact root discovery without Commander `Usage:` output.
- [ ] SC-002: Delegated command families receive their arguments without root-level option rejection, including `mcp`, `tools`, `pi-packages`, `debug`, `data`, `gateway`, `compute`, `skills`, `cron`, and `ralph`.
- [ ] SC-003: `pibo config --help` prints compact config discovery and points to `pibo config keys`.
- [ ] SC-004: `pibo profile` defaults to `codex-compat-openai-web`; gateway-producer aliases still resolve.
- [ ] SC-005: `pibo tui`, `pibo tui:routed`, and `pibo tui:sessions` call distinct runtime paths.
- [ ] SC-006: `pibo gateway:web --web-port` rejects invalid ports before server startup.
- [x] SC-007: `pibo tui:sessions --help` and root discovery expose the reduced CLI Session UI without hiding existing TUI commands, as covered by `test/cli-ui-session-app.test.mjs`.

## Verification Coverage

### Directly Tested

- Root help and MCP/config progressive discovery behavior are covered by `test/mcp-cli.test.mjs`.
- Root discovery and `pibo tui:sessions --help` coverage for the CLI Session UI are covered by `test/cli-ui-session-app.test.mjs`.
- `pibo config` load/save, redaction, supported keys, and value mutation behavior are covered by `test/config.test.mjs`, but this is config behavior rather than full root-dispatch coverage.
- Several delegated command families have focused tests for their own behavior, such as `test/mcp-cli.test.mjs`, `test/tools-cli.test.mjs`, `test/pi-packages.test.mjs`, `test/debug-cli.test.mjs`, `test/data-cli.test.mjs`, and `test/cron-schedule-store.test.mjs`.

### Source-Inspected Only

- Early dispatch and fallback Commander passthrough for `mcp`, `tools`, `pi-packages`, `debug`, `data`, `gateway`, `compute`, `skills`, `cron`, and `ralph` are source-inspected from `src/cli.ts`.
- Root discovery output is source-inspected from `printRootDiscoveryText()` in `src/cli.ts`.
- Root-owned `profile`, `tui`, `tui:routed`, `tui:sessions`, `router`, `gateway:web`, and `client` command behavior is source-inspected from `src/cli.ts`.
- The binary entry point is source-inspected from `src/bin/pibo.ts` and `package.json`.

### Test Gaps

- Add a root-dispatch parity test that stubs or invokes each early-dispatched family with `--help` and verifies the root CLI does not emit Commander `Usage:` output or reject delegated options.
- Add a regression test that the command names shown in root discovery match the current early-dispatch list and fallback Commander passthrough list.
- Add built-CLI tests for `pibo ralph --help`, `pibo compute --help`, and `pibo skills --help`, because newer command families are weakest in direct progressive-discovery coverage.
- Add root-owned command tests for invalid `gateway:web --web-port`, profile default selection, `tui:routed --thinking` validation, and `tui:sessions --max-rows` validation without starting long-running runtimes.

## Assumptions and Open Questions

### Assumptions

- Root CLI discovery should remain line-based rather than adopting Commander-generated help.
- The top-level command list in `printRootDiscoveryText()` is the source of the visible root command surface.
- Delegated command-specific specs own deeper behavior and validation.

### Open Questions

- Should `gateway:web` eventually move under the delegated gateway CLI, or remain root-owned for backward compatibility?
- Should `router` remain public discovery output or become a debug-only command once debug coverage is complete?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Root discovery is compact and progressive | Agent starts discovery | Existing tests in `test/mcp-cli.test.mjs` | Draft |
| REQ-002 Specialized command families bypass root Commander parsing | MCP version passthrough | `src/cli.ts` early dispatch for `mcp`, `tools`, `pi-packages`, `debug`, `data`, `gateway`, `compute`, `skills`, `cron`, and `ralph` | Source-inspected |
| REQ-003 Config discovery is handled before full config parsing | Agent inspects config safely | Existing tests in `test/mcp-cli.test.mjs` | Draft |
| REQ-004 Root-owned profile commands use the default plugin registry | Inspect default profile | `createCliProfile()` | Draft |
| REQ-005 Direct, routed, and session TUI commands remain distinct | Routed QA with thinking; Session UI help | `tui`, `tui:routed`, and `tui:sessions` command actions; `test/cli-ui-session-app.test.mjs` | Partly component-tested |
| REQ-006 Root gateway commands expose only explicit entry points | Invalid web port | `parsePort()` and gateway dispatch | Draft |
| REQ-007 Compatibility commands remain bounded and explicit | Demo router status | `router` and `client` command actions | Draft |

## Verification Basis

This spec is based on the current workspace code and tests:

- `src/bin/pibo.ts`
- `src/cli.ts`
- `package.json`
- `test/mcp-cli.test.mjs`
- `test/config.test.mjs`
- `test/tools-cli.test.mjs`
- `test/pi-packages.test.mjs`
- `test/debug-cli.test.mjs`
- `test/data-cli.test.mjs`
- `test/cron-schedule-store.test.mjs`
- `test/cli-ui-session-app.test.mjs`

Change log:

- 2026-05-17: Updated the direct TUI command contract for the current `pibo tui:sessions` command and help path.
- 2026-05-11: Updated the delegated-command contract for the current Ralph dispatch path and added verification coverage/test gaps for root CLI discovery parity.
