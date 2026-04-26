# Pibo Architecture

Pibo is a thin TypeScript harness around Pi Coding Agent. Pi remains the inner engine for model turns, tools, streaming, sessions, and compaction. Pibo owns the outer product boundary: profiles, plugin registration, channels, routing, session bindings, and transport-specific adapters.

## Design Principles

- Keep Pi Coding Agent embedded as the execution engine, not expanded into the whole product.
- Keep pibo responsible for product boundaries: profiles, plugins, channels, auth, policy, and routing.
- Keep optional integrations opt-in. External MCP servers, Python runtimes, and third-party CLIs are installed only when a user asks for them.
- Keep runtime configuration explicit and local. Project config lives in `.pibo/config.json`; MCP server definitions live in `mcp_servers.json`; installed external CLI tools live under `~/.pibo/tools`.
- Prefer ordinary, inspectable boundaries over hidden coupling: plugins register capabilities, channels translate transports, and MCP servers remain external processes.

## Core Boundary

```text
Channel / Tool / Client
  -> Pibo event
  -> Session router
  -> Routed Pi runtime
  -> Normalized Pibo output event
  -> Channel / Client
```

The core contracts live in:

- `src/core/events.ts` for message, execution, and output events.
- `src/core/profiles.ts` for profile, tool, skill, and context-file selection.
- `src/core/runtime.ts` for creating a Pi Coding Agent runtime from a profile.
- `src/core/session-router.ts` and `src/core/routed-session.ts` for per-session queues and execution actions.

Message events are user input. They are queued per session and sent into Pi.

Execution events are wrapper-level actions such as status, queue clear, abort, and dispose. They are not model messages.

## Plugin Layer

Plugins are static and internal for now. They register capabilities into `PiboPluginRegistry`:

- tools
- subagents
- skills
- context files
- profiles
- gateway execution actions
- event listeners
- channels

The registry is a catalog. It does not run sessions and does not own transport. Runtime code consumes the catalog when it creates profiles, exposes actions, or starts plugin channels.

## Subagents

Subagents are profile-scoped capabilities, exposed to Pi as generated tools. A plugin registers a subagent definition, and a profile chooses which subagents are visible in the same builder pattern used for tools, skills, and context files.

```text
Profile
  -> tools
  -> subagents
  -> skills
  -> context files
```

A subagent definition points at another registered profile. That target profile may have its own tools, skills, context files, and subagents. Nothing is inherited automatically from the parent profile; each target profile declares its own capabilities.

At runtime, each subagent call creates or reuses a normal routed session:

```text
parent-session
  -> pibo_subagent_<name> tool
  -> parent-session::sub::<name>::<threadKey>
  -> Session router
  -> Pi runtime for targetProfile
```

If `threadKey` is omitted, pibo creates a new subagent session. If the caller passes the same `threadKey` again, the same subagent session is continued, which allows multi-turn delegation. The generated session key can be used through the gateway like any other session key while the router is running.

Subagent tools support `sync` and `async` modes. Sync mode waits for the correlated assistant reply and returns it to the calling agent. Async mode enqueues the message and returns the child `sessionKey` and event id immediately. A depth guard prevents accidental recursive subagent loops.

## Channels

Channels are plugin-owned adapters. They translate an external transport into pibo events and translate pibo output events back to that transport.

The channel context intentionally exposes only:

- `emit(event)` to route a `PiboInputEvent`.
- `subscribe(listener)` to observe `PiboOutputEvent` values.
- `resolveSession(input)` to create or reuse a persistent binding.
- `getGatewayActions()` to discover execution actions for channel UIs.

Session bindings are stored in SQLite by default at `.pibo/session-bindings.sqlite`. A binding keeps a stable `sessionKey` separate from the original agent profile and channel identity.

## Auth

Auth is a thin core service boundary exposed to channels through `PiboChannelContext`. The gateway validates that channels marked with `auth.mode: "required"` have an auth service before they start.

The first concrete implementation is Better Auth, registered through a built-in plugin for the web gateway path. It is intentionally not loaded by the default local gateway so trusted-local TCP and remote-agent flows do not require Google OAuth configuration. Web apps always require the web auth service, including localhost. The Auth plugin owns identity and allowlist checks; it does not own chat UI or agent routing.

Runtime config lives in `.pibo/config.json` and is managed through `pibo config ...`. Better Auth reads this local config; environment variables are not part of the auth configuration path.

```text
Same-Origin Web Host
  -> Better Auth /api/auth/*
  -> Chat Web App /apps/chat and /api/chat/*
  -> auth/session policy
  -> resolveSession(channel=chat-web, externalId=userId)
  -> Session router
```

The V1 chat web app uses Better Auth Google sign-in for every request path, including localhost. The authenticated Better Auth user id maps to the session binding external id, producing `chat-web:<userId>`.

The auth boundary is enforced before channel input reaches the session router:

- no Better Auth session returns `401`
- a missing or empty `auth.allowedEmails` allowlist prevents Better Auth startup
- a Google account outside `auth.allowedEmails` returns `403`
- allowed users resolve a persistent `chat-web` session binding
- chat mutation routes require same-origin JSON requests

Google OAuth redirect URIs remain per deployment. Local QA can use `http://localhost:4788/api/auth/callback/google`; internet-facing deployments must configure their own `https://<host>/api/auth/callback/google` in Google Cloud Console and set `auth.baseURL` to the same origin. Pibo does not attempt wildcard redirect support because Google requires exact redirect URI matching for web-server OAuth. Private LAN IP Google OAuth redirects are intentionally not a supported V1 mode.

## Web Host And Apps

The same-origin web path is intentionally split:

- `pibo.web-host` starts the HTTP channel and routes `/api/auth/*` plus registered web apps.
- `pibo.chat-web` registers the current chat UI/API as a web app.
- Future apps can register additional web apps without becoming part of the Auth plugin.

This avoids iframe and cross-origin complexity for V1. Apps can use normal same-origin cookies and call their own API routes while sharing the gateway auth boundary.

## Remote Agent Channel

The built-in `pibo.remote-agent` plugin starts the local `remote-agent` channel on `127.0.0.1:4790`.

```text
Controller
  -> remote_attach(sessionName, profile)
  -> capabilities(gateway actions)
  -> remote_input(message | execution)
  -> Session router
  -> Pi runtime
  -> remote_event
```

The reusable pieces are:

- `src/remote/protocol.ts` for newline-delimited frame types.
- `src/remote/channel.ts` for the server-side channel.
- `src/remote/session-client.ts` for client-side attach, discovery, request/response correlation, and remote events.
- `src/remote/client.ts` for the minimal line-based debug client.

## Remote TUI Example

`src/remote/examples/tui-controller.ts` is intentionally an example, not a product direction. It proves that a Pi Coding Agent TUI can act as a local remote controller by using Pi extension hooks:

- `session_start` attaches to the `remote-agent` channel.
- `input` intercepts normal TUI input and forwards it as remote messages.
- discovered gateway actions are registered as Pi extension slash commands.
- autocomplete is filtered to the remote commands plus `/quit`.
- remote output is rendered back into the TUI as styled custom messages.

This is useful as a reference for future channel adapters, but Pi TUI is not treated as the long-term primary remote UI. A dedicated web or terminal client can reuse the same channel and `RemoteAgentSessionClient` without coupling itself to Pi TUI internals.

## Operator CLIs

`pibo mcp` is a local operator tool for discovering and calling external MCP servers from the shell. It is separate from the pibo plugin/runtime boundary: MCP servers are configured in `mcp_servers.json`, not in `PiboPluginRegistry`, and their tools are invoked directly by the CLI. The usage guide lives in `docs/mcp.md`.

`pibo tools` is the matching operator surface for curated external CLI tools. These are not MCP servers and are not Pibo profile skills. A tool entry can install an isolated runtime, expose doctor/path/env commands, and print on-demand guides for agents. The first curated tool is `browser-use`, installed under `~/.pibo/tools/browser-use` with its own Python venv and tool home.

## MCP CLI

The CLI supports:

- stdio MCP servers through `command`, `args`, `env`, and `cwd`.
- HTTP MCP servers through `url` and optional `headers`.
- per-server `allowedTools` and `disabledTools` glob filters.
- listing tools, inspecting server/tool schemas, grep-style tool search, and JSON tool calls.
- short-lived daemon connections for faster repeated calls, disabled with `MCP_NO_DAEMON=1`.

The config helper commands live under `pibo mcp config ...` and can create, show, add, and remove server definitions. The runtime lookup order is explicit `-c/--config`, `MCP_CONFIG_PATH`, project-local `mcp_servers.json`, then the user-level MCP config paths.

`pibo mcp registry ...` is a thin convenience layer over the same config file. Registry entries are curated presets for optional MCP servers and are not active until installed. Python-based presets get isolated virtual environments under `~/.pibo/mcp-tools/<name>`, managed on demand through `uv`. Installing a preset writes a normal `mcpServers` entry, so the runtime path stays identical to manually added servers. The registry currently has no bundled presets.

The MCP daemon keeps expensive stdio server connections warm between CLI invocations. It is a local convenience cache only; server state and security still belong to the configured MCP server.

## CLI Tools

`pibo tools` keeps curated command-line tools discoverable without pushing their usage instructions into every agent context. Installed tool runtimes live under `~/.pibo/tools/<name>`. A tool can expose one or more guides, but those guides are only printed when requested through the CLI.

The first bundled tool preset is `browser-use`. Its guides are available through:

```bash
npm run dev -- tools guides browser-use
npm run dev -- tools guide browser-use browser-use
npm run dev -- tools guide browser-use remote-browser
```

## Current Scripts

```bash
npm run gateway
npm run gateway:web
npm run client -- <sessionKey>
npm run remote -- <sessionName> [profile]
npm run remote:line -- <sessionName> [profile]
npm run tui -- [profile]
npm run profile -- [profile]
npm run dev -- mcp
```

`npm run remote` runs the Pi-TUI proof-of-concept controller. `npm run remote:line` runs the simpler debug client.
