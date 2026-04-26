# pibo

Minimal TypeScript wrapper project around Pi Coding Agent.

## Docs

- `docs/architecture.md` describes the current runtime architecture and boundaries.
- `docs/mcp.md` documents the MCP CLI and registry.
- `docs/tools.md` documents curated external CLI tools.
- `docs/progress.md` is the short implementation status snapshot.

## Scripts

- `npm run dev` runs the TypeScript entrypoint with `tsx`.
- `npm run profile` prints the selected profile with loaded skills, tools, and context files.
- `npm run profile -- gateway-producer` prints the gateway producer profile.
- `npm run profile -- run-yield-qa` prints the yielded-run QA profile with subagents.
- `npm run tui` starts the Pi TUI through the pibo wrapper.
- `npm run tui:gateway` starts the Pi TUI with the gateway producer profile.
- `npm run gateway` starts the local pibo gateway daemon.
- `npm run gateway:web` starts the local gateway with Better Auth, the same-origin web host, and the chat app.
- `npm run client -- <sessionKey>` starts a console client connected to the gateway.
- `npm run remote -- <sessionName> [profile]` starts the Pi-TUI remote controller.
- `npm run remote:line -- <sessionName> [profile]` starts the minimal line-based remote client for debugging.
- `npm run dev -- mcp` lists configured MCP servers and tools.
- `npm run dev -- tools` lists curated external CLI tools.
- `npm run dev -- config keys` lists supported local config keys.
- `npm run build` compiles to `dist/`.
- `npm run start` runs the compiled entrypoint.
- `npm test` builds and runs the test suite.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run clean` removes `dist/`.

## Philosophy

Keep the wrapper thin. Pi Coding Agent should remain the inner engine; pibo adds only the small runtime, tool, prompt, and policy layer we actually need.

Optional integrations stay outside the core package until the user installs them. MCP servers, Python virtual environments, and third-party CLIs are configured on demand through `pibo mcp` and `pibo tools`, not bundled into pibo itself.

## Plugin Layer

`src/plugins/` contains the minimal static plugin layer. Built-in plugins register tools, skills, context files, profiles, gateway actions, and event listeners through `PiboPluginRegistry`.

This is an extension boundary, not a marketplace. Plugins are internal and statically loaded for now, which keeps the runtime simple while leaving room for web auth, new tools, new skills, and future transports.

`src/plugins/example.ts` shows the smallest plugin workflow:

- register a skill from `examples/skills/pibo-example-plugin/SKILL.md`
- register the tool `pibo_example_plugin_note`
- register the channel `pibo-example-channel`
- register the profile `pibo-example-plugin`
- add the plugin to `createDefaultPiboPlugins()` in `src/plugins/builtin.ts`

Try it with:

```bash
npm run profile -- example-plugin
npm run tui -- example-plugin
```

## Channels And Session Bindings

Plugins can register channels through `api.registerChannel(...)`. A channel maps an external transport into pibo events and maps pibo output events back to that transport.

The channel context exposes only the pibo boundary:

- `emit(event)` sends a `PiboInputEvent` to the session router.
- `subscribe(listener)` receives normalized `PiboOutputEvent` values.
- `resolveSession(...)` creates or reuses a persistent session binding.
- `getGatewayActions()` exposes discoverable execution actions for channel UIs.

Gateway session bindings are stored in SQLite by default at `.pibo/session-bindings.sqlite`. The binding remembers the stable semantic `sessionKey`, short technical `sessionId`, channel, external id, original profile, optional current profile, optional parent identity, and optional workspace.

The built-in remote agent plugin registers the local `remote-agent` channel on `127.0.0.1:4790`. It lets a local controller attach to a pibo session without speaking directly to Pi Coding Agent:

```bash
npm run gateway
npm run remote -- local-a pibo-minimal
```

`npm run remote` runs the Pi-TUI proof-of-concept controller in `src/remote/examples/tui-controller.ts`. The reusable remote pieces live in `src/remote/protocol.ts`, `src/remote/channel.ts`, and `src/remote/session-client.ts`.

The main source folders are:

- `src/core/` for runtime, events, profiles, and session routing
- `src/plugins/` for the static plugin registry and built-in plugins
- `src/channels/` for channel contracts
- `src/sessions/` for session binding storage
- `src/gateway/` for the local TCP gateway transport
- `src/remote/` for the local Pi-like remote-control channel

## Profiles

The default profile is registered by the core plugin. It loads the local `pi-agent-harness` skill, registers the core tools `pibo_echo`, `pibo_workspace_info`, and `pibo_exec`, and appends the example context files from `examples/context/`.

The `run-yield-qa` profile adds two simple QA subagents. The routed runtime exposes generated run-control tools such as `pibo_run_start` for yieldable tools:

```bash
npm run profile -- run-yield-qa
npm run gateway
npm run remote -- yield-qa run-yield-qa
```

Subagent profiles require the routed runtime. Do not use direct `npm run tui -- run-yield-qa` for this profile.

## Gateway

The gateway is the current local transport boundary. It owns the session router, accepts newline-delimited JSON frames over TCP, routes messages by `sessionKey`, and broadcasts normalized session events back to connected clients.

The gateway producer profile adds `pibo_gateway_send`, a tool that sends a message into a target gateway session and returns the correlated assistant reply. See `examples/gateway/README.md` for the two supported manual flows.

## MCP CLI

Pibo includes an MCP helper CLI under `pibo mcp`. It reads MCP server definitions from `mcp_servers.json`, starts stdio or HTTP MCP servers, lists their tools, shows schemas, searches by glob, and calls tools from shell-friendly JSON input. See `docs/mcp.md` for the full guide.

```bash
npm run dev -- mcp
npm run dev -- mcp info filesystem
npm run dev -- mcp grep "*file*"
npm run dev -- mcp call filesystem read_file '{"path":"README.md"}'
```

The config file is created automatically as `mcp_servers.json` when needed. Manage it with:

```bash
npm run dev -- mcp config init
npm run dev -- mcp config help
npm run dev -- mcp config add filesystem '{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","."]}'
npm run dev -- mcp config add deepwiki '{"url":"https://mcp.deepwiki.com/mcp"}'
npm run dev -- mcp config remove filesystem
```

Pibo also ships a small MCP registry for common optional servers. Presets are not active by default; install one when you want it:

```bash
npm run dev -- mcp registry list
npm run dev -- mcp registry show <name>
npm run dev -- mcp registry doctor <name>
npm run dev -- mcp registry install <name>
```

The registry currently has no bundled presets. The command surface remains in place so curated external MCP servers can be added later without changing the config model.

Config lookup order is `-c/--config`, `MCP_CONFIG_PATH`, `./mcp_servers.json`, `~/.mcp_servers.json`, then `~/.config/mcp/mcp_servers.json`. Use `MCP_NO_DAEMON=1` to force fresh MCP connections instead of using the short-lived connection cache.

## CLI Tools

Pibo includes a separate `pibo tools` registry for curated external CLI tools. These tools are not MCP servers and their guides are not loaded into every agent profile. Agents can discover them on demand:

```bash
npm run dev -- tools list
npm run dev -- tools show browser-use
npm run dev -- tools install browser-use
npm run dev -- tools doctor browser-use
npm run dev -- tools guides browser-use
npm run dev -- tools guide browser-use browser-use
```

The first curated tool is `browser-use`, pinned to `browser-use[cli]==0.12.6` so the CLI surface stays aligned with the bundled guides. It is installed into an isolated runtime under `~/.pibo/tools/browser-use` and uses `~/.pibo/tools/browser-use/home` as its tool home. See `docs/tools.md`.

## Web Auth

`npm run gateway:web` starts three separate pieces on the same origin:

- `pibo.better-auth` registers the Better Auth service and owns `/api/auth/*`.
- `pibo.web-host` owns the HTTP server and dispatches same-origin web apps.
- `pibo.chat-web` registers the chat app under `/apps/chat` and `/api/chat/*`.

V1 uses Better Auth with Google OAuth, the Better Auth bearer plugin, and SQLite at `.pibo/auth.sqlite`. Add the exact Google OAuth redirect URI for your instance. For local QA with `auth.baseURL` set to `http://localhost:4788`, use:

```text
http://localhost:4788/api/auth/callback/google
```

For a deployed instance, replace the host with that instance's public HTTPS origin:

```text
https://pibo.example.com/api/auth/callback/google
```

Google OAuth redirect URIs are exact per instance. Wildcard or "all deployments" redirects are not supported for this web-server flow, so each self-hosted deployment needs its own Google OAuth client or an explicitly configured redirect URI.

Required config values:

```bash
npm run dev -- config set auth.baseURL http://localhost:4788
npm run dev -- config set auth.secret <32+ character secret>
npm run dev -- config set auth.googleClientId <google oauth client id>
npm run dev -- config set auth.googleClientSecret <google oauth client secret>
npm run dev -- config set auth.allowedEmails you@example.com,friend@example.com
```

`auth.secret` must be at least 32 characters. `auth.allowedEmails` must contain at least one email; pibo fails closed if the allowlist is missing or empty. Authenticated Google users whose email is not listed receive `403` from the pibo web API. Unauthenticated pibo API requests receive `401`.

All web chat API requests require Better Auth, including localhost. Private LAN IP Google OAuth redirects are not part of the supported V1 setup.

The Google provider requests `prompt=select_account`, so signing out of pibo and signing in again lets the user choose a different Google account. Pibo signout clears the Better Auth session; it does not sign the user out of Google globally.

## Config CLI

Pibo reads local config from `.pibo/config.json`. The current CLI is intentionally small:

```bash
npm run dev -- config set auth.allowedEmails you@example.com,friend@example.com
npm run dev -- config get auth.allowedEmails
npm run dev -- config del auth.allowedEmails
npm run dev -- config keys
npm run dev -- config show
```

Supported V1 keys are `auth.baseURL`, `auth.secret`, `auth.googleClientId`, `auth.googleClientSecret`, `auth.allowedEmails`, and `auth.databasePath`.
Secret keys such as `auth.secret` and `auth.googleClientSecret` are stored in full but redacted in `config get` and `config show` output.
