# Spec: MCP Server Integration

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Current Pibo codebase
**Related docs:** `GLOSSARY.md`, `docs/specs/README.md`, `docs/specs/capabilities/custom-agents.md`

## Why

Pibo users and agents need access to external Model Context Protocol servers without making every MCP server a Pibo plugin or always injecting verbose tool schemas into runtime context. Operators need a discoverable CLI to configure, inspect, and call MCP servers. Agent profiles need a compact way to select configured servers and give the model enough context to decide when to use the MCP CLI.

The MCP integration keeps MCP server configuration outside the Pibo plugin runtime while exposing selected server names and short agent-facing descriptions through the product profile and Chat Web Agent Designer.

## Goal

Pibo MUST provide a local MCP CLI and profile-selectable MCP server hints so configured MCP servers can be discovered, called, described, selected by custom agents, and injected into runtime context only when selected.

## Background / Current State

The current implementation lives under `src/mcp/`. The CLI is routed through `pibo mcp`, reads `mcp_servers.json` configuration, supports stdio and HTTP MCP servers, lists tools, shows schemas, greps tool names, and calls tools. Configuration is managed by `src/mcp/config-command.ts`; connection, filtering, retry, daemon, and timeout behavior live in `src/mcp/config.ts`, `src/mcp/client.ts`, `src/mcp/daemon.ts`, and `src/mcp/daemon-client.ts`.

Agent-facing metadata is handled by `src/mcp/agent-context.ts`. Chat Web includes configured MCP servers in the Agent Designer catalog and exposes a Context-area MCP Tools view for editing short descriptions. Runtime creation in `src/core/runtime.ts` injects `.pibo/context/enabled-mcp-servers.md` only when the active profile selects described MCP servers.

## Scope

### In Scope

- `pibo mcp` progressive CLI discovery.
- MCP configuration lookup, initialization, add, remove, show, schema, paths, and description editing.
- Stdio and HTTP server configuration shapes.
- Environment-variable substitution in configuration.
- Tool filtering through `allowedTools` and `disabledTools`.
- CLI list, info, grep, and call commands.
- Daemon-backed or direct server connections, timeout, retry, and stale daemon cleanup behavior.
- MCP registry command surface, even when no presets are bundled.
- Chat Web catalog listing of configured MCP servers and description editing.
- Custom-agent/profile selection of MCP server names.
- Runtime context injection for selected described MCP servers.

### Out of Scope

- Registering MCP tools as Pibo native tools inside the Pi runtime.
- A Chat Web UI for adding/removing MCP server configs; the current source of truth is the MCP CLI config file.
- Team-shared remote MCP configuration management.
- Secret storage beyond environment-variable references in local config.
- Guaranteeing every MCP tool call is safe or idempotent.

## Requirements

### Requirement: MCP CLI discovery is progressive

The `pibo mcp` CLI MUST expose compact top-level help and move detailed config schemas behind explicit deeper commands.

#### Current

`src/mcp/index.ts` prints compact command surfaces for `pibo mcp --help`, `pibo mcp config help`, and `pibo mcp registry help`. Full server JSON examples are shown by `pibo mcp config schema`.

#### Acceptance

- `pibo mcp --help` lists immediate MCP commands and next steps.
- `pibo mcp config help` lists config actions without printing the full schema example.
- `pibo mcp config schema` prints stdio and HTTP server shapes and examples.
- Unknown or ambiguous commands return structured CLI errors with suggestions.

#### Scenario: Agent discovers MCP config

- GIVEN an agent does not know the MCP config format
- WHEN it runs `pibo mcp --help` and then `pibo mcp config help`
- THEN it sees the next command to inspect the schema without receiving the full schema at the top level.

### Requirement: MCP config lookup and initialization are deterministic

The CLI MUST use a defined config lookup order and MUST create a valid empty config when initialization is requested.

#### Current

`findConfigPath`, `getPreferredConfigPath`, `ensureConfigExists`, and `printConfigPaths` implement lookup order: explicit `--config`, `MCP_CONFIG_PATH`, `./mcp_servers.json`, `~/.mcp_servers.json`, and `~/.config/mcp/mcp_servers.json`.

#### Acceptance

- An explicit `--config` path takes precedence over all other paths.
- `MCP_CONFIG_PATH` takes precedence over default paths when no explicit path is supplied.
- `pibo mcp config paths` shows the lookup order.
- `pibo mcp config init` creates `{ "mcpServers": {} }` at the preferred path when no config exists.
- Loading a missing explicit config fails instead of silently falling back.

#### Scenario: Initialize in project directory

- GIVEN no MCP config exists in the current working directory
- WHEN an operator runs `pibo mcp config init`
- THEN Pibo writes `mcp_servers.json` with an empty `mcpServers` object.

### Requirement: Server configs are validated before use

The CLI MUST reject malformed MCP server definitions before attempting a connection.

#### Current

`loadConfig` and `parseServerConfig` require an object with exactly one transport selector: `command` for stdio or `url` for HTTP.

#### Acceptance

- A config file must contain an object `mcpServers` field.
- Each server config must be an object.
- A server config with neither `command` nor `url` is rejected.
- A server config with both `command` and `url` is rejected.
- Invalid JSON returns a structured config error that names the file.

#### Scenario: Invalid mixed transport

- GIVEN a server config contains both `command` and `url`
- WHEN the CLI loads the config
- THEN the command fails with a client error and does not connect to the server.

### Requirement: Environment references are resolved explicitly

The CLI MUST substitute `${VAR}` references in loaded MCP config and MUST fail in strict mode when required environment variables are missing.

#### Current

`substituteEnvVarsInObject` recursively replaces `${VAR}` references. Strict mode is the default and can be relaxed with `MCP_STRICT_ENV=false` or `0`.

#### Acceptance

- Environment references in strings, arrays, and objects are substituted before server use.
- Missing variables fail by default with a `MISSING_ENV_VAR` error.
- Non-strict mode replaces missing variables with empty strings and writes a warning to stderr.
- Config mutation commands store the JSON as supplied; substitution happens when loading for use.

#### Scenario: Missing token

- GIVEN an HTTP server header contains `${MCP_TOKEN}`
- AND `MCP_TOKEN` is not set
- WHEN strict mode is active and the CLI loads the config
- THEN the command fails before connecting.

### Requirement: Tool visibility follows allow and deny filters

The MCP client MUST filter server tools according to per-server allow and disabled patterns, with disabled patterns taking precedence.

#### Current

`filterTools` and `isToolAllowed` apply case-insensitive glob patterns from `allowedTools` and `disabledTools`.

#### Acceptance

- Without filters, all returned MCP tools are visible.
- With `allowedTools`, only matching tool names are visible.
- With `disabledTools`, matching tool names are hidden.
- When a tool matches both lists, it is hidden.
- Filters apply to listed tools and callable tools.

#### Scenario: Deny overrides allow

- GIVEN `allowedTools` includes `file_*`
- AND `disabledTools` includes `file_delete`
- WHEN the server exposes `file_read` and `file_delete`
- THEN only `file_read` is visible and callable.

### Requirement: CLI commands inspect and call configured MCP servers

The MCP CLI MUST list server tools, show server or tool details, grep tool names, and call one tool with JSON arguments.

#### Current

`listCommand`, `infoCommand`, `grepCommand`, and `callCommand` load config, connect to servers, and format human-readable output. `call` accepts JSON as an argument or reads it from stdin.

#### Acceptance

- `pibo mcp` lists configured servers and tools, or prints a next-step hint when none are configured.
- `pibo mcp info <server>` shows server configuration details, available tools, and server instructions when available.
- `pibo mcp info <server> <tool>` shows one tool schema.
- `pibo mcp grep <pattern>` searches tool names by pattern.
- `pibo mcp call <server> <tool> [json]` executes one tool and prints formatted result content.
- Invalid JSON arguments fail before a tool call is attempted.

#### Scenario: Call with stdin JSON

- GIVEN an MCP server `search` exposes tool `query`
- WHEN an operator pipes `{ "q": "pibo" }` into `pibo mcp call search query -`
- THEN Pibo parses the JSON, calls the tool, prints the result, and closes the connection.

### Requirement: Connections use bounded retry and optional daemons

MCP server connections MUST use bounded timeout/retry behavior and MAY use daemon workers for repeated operations.

#### Current

`getConnection` uses daemon mode unless `MCP_NO_DAEMON=1`. Retry settings come from `MCP_MAX_RETRIES`, `MCP_RETRY_DELAY`, and `MCP_TIMEOUT`. Daemon socket and PID files are keyed by server name and config hash.

#### Acceptance

- Transient connection errors can be retried within the total timeout budget.
- Direct mode is used when daemon mode is disabled.
- Daemon mode reuses a valid matching daemon when possible.
- A daemon with a stale config hash or dead process is cleaned up before use.
- Request timeouts prevent a daemon call from hanging indefinitely.

#### Scenario: Server config changes

- GIVEN a daemon is running for server `docs`
- AND the `docs` server config changes
- WHEN the next CLI command uses `docs`
- THEN Pibo detects the config hash mismatch, kills or ignores the stale daemon, and starts a connection for the new config.

### Requirement: Registry presets remain discoverable even when empty

The MCP registry command surface MUST be present and report clearly when no presets are bundled.

#### Current

`src/mcp/registry.ts` defines `list`, `show`, `doctor`, `install`, and `remove`. The current registry array is empty.

#### Acceptance

- `pibo mcp registry help` lists available registry actions.
- `pibo mcp registry list` prints that no registry entries are currently bundled when the registry is empty.
- Showing, installing, doctoring, or removing an unknown preset fails with a registry not found error.
- Future bundled presets can provide config plus optional registry-sourced agent descriptions.

#### Scenario: Empty registry

- GIVEN no registry entries are bundled
- WHEN an operator runs `pibo mcp registry list`
- THEN the CLI prints a clear empty-state message.

### Requirement: Chat Web exposes MCP server metadata, not full config editing

Chat Web MUST show configured MCP servers in the Agent Designer catalog and MUST allow editing only Pibo-managed agent-facing descriptions.

#### Current

`buildAgentCatalog` calls `listMcpServerInfos()`. `McpToolsView` renders server name, transport, description state, and a 480-character description editor. `PATCH /api/chat/mcp-servers/:name/description` calls `setMcpServerDescription` after same-origin JSON and session checks.

#### Acceptance

- The agent catalog includes configured MCP server names, transport type, description, description source, `hasDescription`, and `editable`.
- Chat Web does not expose command, args, env, URL, headers, or secret-bearing config fields in the catalog.
- Description edits require an authenticated same-origin JSON request.
- Empty descriptions and descriptions over 480 characters are rejected.
- Registry-sourced descriptions are shown as read-only.
- Updating a description invalidates the bootstrap catalog cache.

#### Scenario: Edit MCP description

- GIVEN a configured user-editable MCP server has no description
- WHEN an authenticated user saves a non-empty MCP Tool Context description
- THEN the server metadata is updated in `mcp_servers.json` under `pibo.description` with `descriptionSource: "user"`.

### Requirement: Custom agents select MCP servers by configured name

Custom agents MUST store selected MCP server names and pass them into runtime profiles without embedding server configs.

#### Current

Custom-agent create and update paths normalize `mcpServers` arrays. `createCustomAgentProfileDefinition` adds the selected names to `InitialSessionContext`.

#### Acceptance

- Agent Designer can display configured MCP servers as selectable profile inputs.
- Saving a custom agent stores selected MCP server names.
- Runtime profile construction receives selected names through `InitialSessionContext.mcpServers`.
- Unknown or undescribed selected servers do not create runtime context entries.
- Actual MCP calls remain explicit CLI actions by the agent.

#### Scenario: Agent selects filesystem MCP

- GIVEN the `filesystem` MCP server is configured and described
- WHEN a custom agent selects `filesystem`
- THEN sessions using that agent receive MCP context that names `filesystem` and shows CLI discovery/call commands.

### Requirement: Runtime injects compact context only for selected described servers

The runtime MUST inject an MCP context file only when the active profile selects at least one configured server with a description.

#### Current

`getMcpAgentContextFile` returns `.pibo/context/enabled-mcp-servers.md` for selected servers that have descriptions. `createPiboRuntime` merges that file with other runtime context files.

#### Acceptance

- Profiles with no selected MCP servers receive no MCP context file.
- Selected servers without descriptions are omitted from the context file.
- The generated context lists each included server's name, description, `pibo mcp info` discovery command, and `pibo mcp call` command shape.
- Duplicate context file paths are merged so the MCP context is injected once.
- Runtime injection does not connect to MCP servers; it reads local metadata only.

#### Scenario: Only undescribed server selected

- GIVEN a profile selects one MCP server with no Pibo description
- WHEN Pibo creates or inspects the runtime profile
- THEN no enabled-MCP context file is injected.

## Edge Cases

- A configured MCP server may be temporarily unreachable; list output MAY show that server as an error entry while other servers still list.
- A config file may contain secret placeholders; Chat Web MUST expose only metadata, not raw server config.
- MCP server descriptions may come from registry presets; users cannot edit those descriptions through the current UI.
- The registry can be empty; commands must still be useful for discovery.
- A selected MCP server can be removed from config after a custom agent is saved; runtime context generation omits it until the selection is repaired or the server is re-added.
- Daemon cancellation or process cleanup may fail; the next connection attempt must still validate process, socket, and config hash before reuse.

## Constraints

- **Product Boundary:** Pibo owns MCP CLI orchestration, local config metadata, profile selection, and runtime context hints. External MCP servers own their tools and execution behavior.
- **Security / Privacy:** Server secrets belong in environment variables or local config. Chat Web MUST not reveal raw config fields through the agent catalog.
- **Compatibility:** MCP integration remains CLI-driven; MCP servers are not exposed as native Pi tools by default.
- **Reliability:** CLI calls MUST close connections after use and bound connection, stdin, daemon, and retry waits.
- **Context Economy:** Runtime context MUST include only selected described servers and short CLI usage hints, not full MCP tool schemas.

## Success Criteria

- [ ] SC-001: `pibo mcp --help`, `pibo mcp config help`, and `pibo mcp config schema` follow progressive discovery.
- [ ] SC-002: Config lookup, initialization, show, add, describe, and remove work against a chosen `mcp_servers.json`.
- [ ] SC-003: Invalid config shape, missing environment variables in strict mode, invalid call JSON, unknown servers, and unknown tools fail with clear CLI errors.
- [ ] SC-004: Tool allow/disabled filters hide and reject tools according to configured glob patterns.
- [ ] SC-005: List, info, grep, and call commands operate against stdio and HTTP server configs with bounded retry/timeout behavior.
- [ ] SC-006: Chat Web lists configured MCP servers without exposing raw config and can update user-editable descriptions.
- [ ] SC-007: A custom agent that selects described MCP servers receives `.pibo/context/enabled-mcp-servers.md` at runtime; agents without selected described servers do not.

## Assumptions and Open Questions

### Assumptions

- Local `mcp_servers.json` is the source of truth for configured MCP servers.
- Agent-facing descriptions should be short enough to fit in normal runtime context.
- Agents should use the MCP CLI explicitly instead of receiving MCP tools as direct model tools.

### Open Questions

- Should custom-agent save validate selected MCP server names against the current config instead of storing arbitrary names?
- Should Chat Web eventually support adding/removing MCP server configs with safe secret handling?
- Should MCP CLI support machine-readable JSON output for list/info/call in addition to current human output?
- Should selected but undescribed MCP servers appear as warnings during profile inspection?

## Traceability

| Requirement | Scenario / Story | Code basis | Status |
|---|---|---|---|
| REQ-001 MCP CLI discovery is progressive | Agent discovers MCP config | `src/mcp/index.ts`, `test/mcp-cli.test.mjs` | Implemented |
| REQ-002 MCP config lookup and initialization are deterministic | Initialize in project directory | `src/mcp/config.ts`, `src/mcp/config-command.ts`, `test/mcp-cli.test.mjs` | Implemented |
| REQ-003 Server configs are validated before use | Invalid mixed transport | `src/mcp/config.ts`, `src/mcp/config-command.ts` | Implemented |
| REQ-004 Environment references are resolved explicitly | Missing token | `src/mcp/config.ts` | Implemented |
| REQ-005 Tool visibility follows allow and deny filters | Deny overrides allow | `src/mcp/config.ts`, `src/mcp/client.ts` | Implemented |
| REQ-006 CLI commands inspect and call configured MCP servers | Call with stdin JSON | `src/mcp/commands/list.ts`, `src/mcp/commands/info.ts`, `src/mcp/commands/grep.ts`, `src/mcp/commands/call.ts` | Implemented |
| REQ-007 Connections use bounded retry and optional daemons | Server config changes | `src/mcp/client.ts`, `src/mcp/daemon.ts`, `src/mcp/daemon-client.ts` | Implemented |
| REQ-008 Registry presets remain discoverable even when empty | Empty registry | `src/mcp/registry.ts`, `test/mcp-cli.test.mjs` | Implemented |
| REQ-009 Chat Web exposes MCP server metadata, not full config editing | Edit MCP description | `src/mcp/agent-context.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/context/McpToolsView.tsx` | Implemented |
| REQ-010 Custom agents select MCP servers by configured name | Agent selects filesystem MCP | `src/apps/chat/agent-store.ts`, `src/apps/chat/agent-profiles.ts`, `src/apps/chat-ui/src/App.tsx` | Implemented |
| REQ-011 Runtime injects compact context only for selected described servers | Only undescribed server selected | `src/mcp/agent-context.ts`, `src/core/runtime.ts`, `test/mcp-agent-context.test.mjs` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/mcp-cli.test.mjs`, `test/mcp-agent-context.test.mjs`, `test/agent-store.test.mjs`, `test/agent-profiles.test.mjs`, and runtime profile inspection paths in `src/core/runtime.ts`.
