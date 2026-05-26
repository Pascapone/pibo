# Spec: Curated CLI Tools

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** `GLOSSARY.md`, `AGENTS.md`, `docs/specs/capabilities/plugin-registry-and-capability-catalog.md`, `docs/specs/capabilities/docker-compute-workers.md`

## Why

Pibo agents need external CLIs for browser automation, screenshots, authenticated Chat Web checks, and other workflows that are too large to load into every runtime prompt. These CLIs must be discoverable, installable, diagnosable, and usable without requiring each agent to rediscover setup details from source code.

Curated CLI tools keep external command setup outside profiles and MCP. The CLI remains the source of truth, while installed tools may contribute a short runtime context hint so agents know where to start without receiving full guides by default.

## Goal

Pibo MUST provide a progressive `pibo tools` interface for curated external CLI tools, install each tool into an isolated Pibo-owned runtime, and expose only compact installed-tool context to agent runtimes.

## Background / Current State

The current implementation lives in `src/tools/`. `src/tools/registry.ts` defines the curated registry and includes `browser-use` pinned to `browser-use[cli]==0.12.6` with Python 3.12, `agent-browser` pinned to `agent-browser@0.27.0` in a local npm runtime, and built-in Ralph. `src/tools/index.ts` implements `pibo tools` commands for listing, showing, installing, removing, diagnosing, printing guides, printing paths, printing shell environment, and browser helper commands.

Tool runtimes use `~/.pibo/tools/<name>` unless `PIBO_HOME` overrides the Pibo home path. Python tools use a dedicated uv-created virtual environment and a separate tool home directory. npm tools use `node/` with local `node_modules/.bin` and the same separate tool home directory. Runtime creation in `src/core/runtime.ts` injects `.pibo/context/installed-pibo-tools.md` only when curated tools are installed.

## Scope

### In Scope

- `pibo tools` progressive CLI discovery.
- Curated tool registry entries and installed-tool status.
- Isolated Python and npm runtime installation, removal, doctor output, and executable path reporting.
- Tool guides stored behind explicit `guide` commands.
- Compact installed-tool context injection into Pibo runtimes.
- Browser-use wrapper behavior for Pibo-managed persistent Chrome via CDP.
- Agent Browser wrapper behavior for Pibo-owned state and default profiles.
- Browser-use and Agent Browser authenticated template profiles, leases, target discovery, and health checks.

### Out of Scope

- Registering curated CLIs as Pibo native tools — curated tools are shell-operated external CLIs.
- MCP server configuration and tool calls — covered by the MCP server integration spec.
- Pi Package loading into runtimes — covered by the Pibo Pi Packages spec.
- Browser UI test strategy for a specific product feature.
- Guaranteeing safety of arbitrary third-party CLI behavior after installation.

## Requirements

### Requirement: Tool CLI discovery is progressive

The `pibo tools` CLI MUST expose only the immediate command surface at each level and MUST place long guides behind explicit guide commands.

#### Current

`runToolsCli()` prints compact discovery text for `pibo tools --help`, lists immediate commands, and points to `pibo tools list`. `show`, `guides`, and `guide` reveal progressively more detail for one selected tool.

#### Acceptance

- `pibo tools --help` lists immediate commands and a next command.
- `pibo tools list` prints curated tools without printing long guide content.
- `pibo tools show <name>` prints one tool's package, status, paths, guides, notes, and next commands.
- `pibo tools guides <name>` lists guide names only.
- `pibo tools guide <name> [guide]` prints exactly the selected guide content.
- Unknown tool or guide names fail with a structured CLI error and a useful suggestion.

#### Scenario: Agent discovers browser-use

- GIVEN an agent does not know the browser automation setup
- WHEN it runs `pibo tools --help`, `pibo tools list`, and `pibo tools show browser-use`
- THEN it sees the next setup and guide commands without receiving the full browser-use guide at the root level.

### Requirement: Curated tools install into isolated Pibo-owned runtimes

The system MUST install each curated CLI into a tool-specific runtime under the Pibo home directory and MUST NOT depend on global Python or npm package state for normal use.

#### Current

`installToolPythonRuntime()` creates `~/.pibo/tools/<name>/.venv`, installs the pinned package with uv, and creates `~/.pibo/tools/<name>/home`. `installToolNpmRuntime()` creates `~/.pibo/tools/<name>/node`, installs the pinned npm package with `npm install --prefix`, and creates the same separate home directory. Runtime path helpers derive executable, runtime root, and home paths from the tool registry entry.

#### Acceptance

- Installing `browser-use` creates a tool root, home directory, virtual environment, and executable path under the selected Pibo home.
- Installing `agent-browser` creates a tool root, home directory, local npm runtime, and executable path under the selected Pibo home.
- `pibo tools path <name>` prints the executable path, or the Pibo wrapper path when a wrapper exists.
- `pibo tools env <name>` prints shell exports that put the wrapper and runtime bin directory on `PATH` and set the tool home variable.
- `pibo tools remove <name>` removes only the tool runtime root for that tool.

#### Scenario: Install target is local to Pibo

- GIVEN `PIBO_HOME=/tmp/pibo-home`
- WHEN an operator installs `browser-use` or `agent-browser`
- THEN the executable path is under `/tmp/pibo-home/tools/<name>/`
- AND no global Python site-packages or global npm package path is required for normal execution.

### Requirement: Tool doctor output reports missing prerequisites and runtime state

The CLI MUST provide a bounded diagnostic command for each curated tool that reports setup state and next actions.

#### Current

`doctorCliTool()` delegates to `printToolPythonRuntimeDoctor()`, which checks uv, requested Python, runtime paths, executable presence, desktop display state, and the tool's own doctor command when installed. Browser-use health adds wrapper, Chrome, display, stale CDP state, and expired lease checks.

#### Acceptance

- `pibo tools doctor browser-use` reports uv status, Python status, runtime paths, venv state, executable state, and display state.
- `pibo tools doctor agent-browser` reports Node, npm, package pin, runtime paths, executable state, display state, and upstream offline doctor state when installed.
- Missing uv produces installation instructions instead of a stack trace.
- Missing Python produces OS-oriented installation hints.
- `pibo tools browser-use health` reports `ok`, `degraded`, or `critical` and prints corrective suggestions for missing wrapper, missing Chrome, stale CDP state, or expired leases.
- JSON health output is available when `--json` is passed.

#### Scenario: Browser-use wrapper is missing

- GIVEN the browser-use Python executable exists but the Pibo wrapper has not been generated
- WHEN an operator runs `pibo tools browser-use health`
- THEN the result is `critical`
- AND the suggestion includes reinstalling or installing `browser-use` through `pibo tools`.

### Requirement: Installed tools contribute compact runtime context only

The runtime MUST inject compact installed-tool hints only for tools that are installed and MUST keep full guides out of default agent context.

#### Current

`getInstalledCliToolContextFile()` returns `.pibo/context/installed-pibo-tools.md` only when at least one registry entry is installed. Each registry entry must define a non-empty `agentContextSnippet` no longer than 480 characters. `createPiboRuntime()` merges that context file with profile context files.

#### Acceptance

- A runtime created before any curated CLI is installed does not receive `.pibo/context/installed-pibo-tools.md`.
- A runtime created after `browser-use` is installed receives a context file with the tool name, short snippet, and discovery commands.
- Full browser-use guide text is not injected into runtime context unless a profile separately selects a context file containing it.
- A registry entry with an empty or oversized context snippet fails at module initialization.

#### Scenario: Browser-use is installed

- GIVEN `browser-use` is installed in the Pibo tool runtime
- WHEN Pibo creates an agent runtime
- THEN the runtime context includes a compact installed-tools file
- AND the file points the agent to `pibo tools show browser-use` and `pibo tools guide browser-use browser-use` for details.

### Requirement: Agent Browser wrapper keeps state under the Pibo tool home

The Agent Browser executable exposed by Pibo MUST prefer a Pibo-owned home and default profile, while preserving explicit upstream flags.

#### Current

`ensureAgentBrowserWrapper()` writes `home/bin/agent-browser`. `pibo tools env agent-browser` puts that wrapper before the local npm bin directory and sets `AGENT_BROWSER_HOME`. Because `agent-browser@0.27.0` uses `HOME` for `~/.agent-browser` state, the wrapper redirects `HOME` to `AGENT_BROWSER_HOME` unless `PIBO_AGENT_BROWSER_PRESERVE_HOME=1` is set. The wrapper injects `--profile $AGENT_BROWSER_HOME/profiles/PIBo` for launch commands unless the caller passes `--fresh-profile` or explicit profile, state, CDP, provider, engine, executable, or config flags.

#### Acceptance

- `pibo tools show agent-browser` prints the wrapper path and warns operators to use it instead of the raw executable.
- `pibo tools env agent-browser` puts the wrapper directory before `node/node_modules/.bin` on `PATH`.
- Launch commands use `home/profiles/PIBo` by default.
- `--fresh-profile` and explicit upstream runtime flags disable profile injection.
- Doctor, config, socket, and auth vault paths stay under the Pibo tool home by default.
- The wrapper never prints cookies, saved state, headers, or auth vault data.

#### Scenario: Explicit profile wins

- GIVEN the Agent Browser wrapper is on `PATH`
- WHEN an operator runs `agent-browser --profile /tmp/profile open https://example.com`
- THEN the wrapper forwards that profile and does not add the Pibo default profile.

### Requirement: Browser-use wrapper defaults to Pibo-managed persistent Chrome

The browser-use executable exposed by Pibo MUST prefer a Pibo-managed Chrome profile and CDP connection for new sessions, while still allowing an explicit fresh profile.

#### Current

`ensureBrowserUseWrapper()` writes a wrapper under the tool home `bin` directory. The wrapper starts or reuses Chrome with a session-specific CDP port, uses profile name `PIBo` by default, stores CDP pid and port files under `BROWSER_USE_HOME/pibo-cdp`, and supports `--fresh-profile` to bypass persistent Pibo-managed Chrome.

#### Acceptance

- `pibo tools show browser-use` prints the wrapper path and warns operators to use it instead of the raw executable.
- `pibo tools env browser-use` puts the wrapper directory before the Python virtual environment on `PATH`.
- A browser-use command that starts a browser uses the Pibo-managed Chrome user-data directory unless `--fresh-profile` is passed or explicit Chrome/profile environment variables override it.
- Stale Chrome lock files for the managed profile are cleaned or reported before a new managed session starts.
- Session-specific CDP pid and port files are reused only while the recorded process is alive and the CDP endpoint responds.

#### Scenario: Reuse existing managed Chrome

- GIVEN a browser-use session has a live Chrome process and a reachable CDP port file
- WHEN the operator runs another browser-use command in the same session
- THEN the wrapper connects to the existing CDP endpoint instead of launching a second Chrome for that session.

### Requirement: Authenticated browser leases isolate concurrent Chat Web agents

The browser-use and Agent Browser helpers MUST let agents acquire isolated authenticated browser slots from a template profile and release or reap those slots explicitly.

#### Current

`browser-use lease acquire` locks a JSON lease registry, reaps expired inactive leases, reuses a released or expired slot when possible, copies the authenticated template profile without Chrome singleton files, writes lease metadata, prints shell exports or JSON, and warms up Chrome unless disabled internally. Lease release marks the lease released, terminates the recorded Chrome process, and optionally deletes the slot profile.

#### Acceptance

- `pibo tools browser-use auth-template env` and `pibo tools agent-browser auth-template env` create the template directory when needed and print exports for preparing the template profile.
- `pibo tools browser-use lease acquire` prints `BROWSER_USE_HOME`, `PIBO_BROWSER_USE_LEASE_ID`, `PIBO_BROWSER_USE_SESSION`, `PIBO_BROWSER_USE_CHROME_USER_DATA_DIR`, and `PIBO_BROWSER_USE_DEFAULT_PROFILE`.
- `pibo tools agent-browser lease acquire` prints `AGENT_BROWSER_HOME`, `PIBO_AGENT_BROWSER_LEASE_ID`, `AGENT_BROWSER_SESSION`, `AGENT_BROWSER_PROFILE`, and `AGENT_BROWSER_SESSION_NAME`.
- Lease acquisition fails with `BROWSER_USE_AUTH_POOL_EXHAUSTED` when `--max-slots` is reached for active unexpired leases.
- Lease acquisition fails with `BROWSER_USE_AUTH_TEMPLATE_RUNNING` when the template profile contains Chrome singleton files.
- `lease list` shows active, expired, and released leases and can emit JSON.
- `lease release <id>` terminates the lease process when known and marks the lease released.
- `lease reap-stale` releases expired active leases and terminates their recorded Chrome process when it is alive.

#### Scenario: Pool is exhausted

- GIVEN two active unexpired leases exist for app `pibo-chat`
- WHEN an agent runs `pibo tools browser-use lease acquire --app pibo-chat --max-slots 2`
- THEN the command fails with a client error
- AND the suggestion tells the agent to release a lease or increase the maximum slot count.

### Requirement: Browser target discovery prefers usable Chat Web tabs

The browser-use and Agent Browser helpers MUST inspect Chrome CDP targets and identify authenticated Chat Web tabs that can accept input.

#### Current

`listBrowserUseCdpTargets()` discovers a CDP URL from explicit input or recent Pibo/browser-use CDP state, reads `/json/list`, probes `/apps/chat` targets through CDP runtime evaluation, classifies auth state from page text and composer availability, and records textarea counts. `attach-chat` selects the highest-scored target that is a Chat Web URL, has a websocket URL, is not unauthenticated, and has an enabled composer.

#### Acceptance

- `pibo tools browser-use targets` and `pibo tools agent-browser targets` print target id, URL, auth classification, composer availability, and title.
- `targets --json` emits machine-readable target data.
- `targets --no-probe` lists CDP targets without DOM probing.
- `attach-chat` fails with a tool-specific structured error when no authenticated Chat Web target with a composer exists.
- Successful `attach-chat` prints exports for `PIBO_CDP_URL`, `PIBO_CDP_TARGET_ID`, `PIBO_CDP_TARGET_WS`, and `PIBO_CHAT_URL`.

#### Scenario: Authenticated composer exists

- GIVEN Chrome has multiple CDP targets
- AND one `/apps/chat` target has an enabled composer textarea
- WHEN the operator runs `pibo tools browser-use attach-chat`
- THEN the command selects that target and prints shell exports for direct CDP debugging.

## Edge Cases

- A curated tool can be listed as available even when it is not installed.
- An installed tool can be missing its wrapper; health must make the degraded state visible.
- CDP state files can outlive Chrome processes; target discovery and health must not treat stale files as healthy.
- Lease registry JSON can be invalid; commands that depend on it may fail rather than silently destroying state.
- A lease profile copy must exclude Chrome singleton files and `DevToolsActivePort`.
- Runtime context snippets must remain short enough to avoid replacing progressive guide discovery with always-on documentation.

## Constraints

- **Compatibility:** Existing `pibo tools` commands and browser-use shell exports must remain stable for agents and AGENTS.md guidance.
- **Security / Privacy:** Authenticated template profiles and lease profiles may contain credentials; commands must keep them under the tool home and must not print cookie contents.
- **Performance:** Runtime creation should only read installed-tool status and inject compact context; it must not run tool doctors or enumerate guide content.
- **Dependencies:** Python tool installation depends on uv and the pinned package in the registry entry. npm tool installation depends on Node.js, npm, and the pinned package in the registry entry. Browser helpers depend on a Chrome or Chromium binary for managed browser sessions.

## Success Criteria

- [ ] SC-001: `pibo tools --help`, `list`, `show`, `guides`, and `guide` support progressive discovery without duplicate long output.
- [ ] SC-002: `pibo tools install browser-use` and `pibo tools install agent-browser` create isolated runtimes under the Pibo home and expose wrapper-first path and env.
- [ ] SC-003: `pibo tools doctor browser-use` and `pibo tools browser-use health` give actionable diagnostics for missing prerequisites and stale state.
- [ ] SC-004: Installed curated tools inject only `.pibo/context/installed-pibo-tools.md` compact hints into runtimes.
- [ ] SC-005: Browser-use leases can be acquired, listed, released, and reaped without sharing a mutable running Chrome profile across concurrent agents.
- [ ] SC-006: Chat Web CDP target discovery can distinguish authenticated composer tabs from unauthenticated or unusable tabs.

## Assumptions and Open Questions

### Assumptions

- `browser-use`, `agent-browser`, and built-in Ralph are currently the curated CLI tools in the registry.
- Curated CLI tool guides are operational documentation, not profile-selected skills.
- Agents normally invoke curated tools through shell commands after applying `pibo tools env <name>`.

### Open Questions

- Should future curated tools support runtimes other than Python/uv and npm while preserving the same CLI contract?
- Should lease records eventually move from JSON files into the Reliable Event Core or another SQLite store?
- Should browser-use health auto-repair stale CDP state, or should it remain diagnostic-only except for explicit reap commands?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Tool CLI discovery is progressive | Agent discovers browser-use | None | Pending |
| REQ-002 Curated tools install into isolated Pibo-owned runtimes | Install target is local to Pibo | None | Pending |
| REQ-003 Tool doctor output reports missing prerequisites and runtime state | Browser-use wrapper is missing | None | Pending |
| REQ-004 Installed tools contribute compact runtime context only | Browser-use is installed | None | Pending |
| REQ-005 Browser-use wrapper defaults to Pibo-managed persistent Chrome | Reuse existing managed Chrome | None | Pending |
| REQ-006 Authenticated browser leases isolate concurrent Chat Web agents | Pool is exhausted | None | Pending |
| REQ-007 Browser-use target discovery prefers usable Chat Web tabs | Authenticated composer exists | None | Pending |

## Verification Basis

This spec is based on the current workspace code in:

- `src/tools/index.ts`
- `src/tools/registry.ts`
- `src/tools/python-runtime.ts`
- `src/tools/browser-use-wrapper.ts`
- `src/tools/browser-use-leases.ts`
- `src/tools/browser-use-cdp.ts`
- `src/tools/guides.ts`
- `src/core/runtime.ts`
