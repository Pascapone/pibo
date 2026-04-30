# pibo

Pibo turns Pi Coding Agent into an agent-native runtime with discoverable CLI tools, plugins, channels, and local gateways.

Pi remains the inner engine for model turns, tools, streaming, sessions, and compaction. Pibo owns the outer product boundary: profiles, plugin registration, channels, routing, Pibo Sessions, auth, policy, and transport-specific adapters.

## Docs

- `docs/architecture.md` describes the current runtime architecture and boundaries.
- `docs/mcp.md` documents the MCP CLI and registry.
- `docs/tools.md` documents curated external CLI tools.
- `docs/agent-run-yield-spec.md` documents yielded agent runs and run-control tools.
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
- `npm run client -- <piboSessionId>` starts a console client connected to the gateway.
- `npm run dev -- mcp` lists configured MCP servers and tools.
- `npm run dev -- tools` lists curated external CLI tools.
- `npm run dev -- config keys` lists supported local config keys.
- `npm run build` compiles to `dist/`.
- `npm run start` runs the compiled entrypoint.
- `npm test` builds and runs the test suite.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run clean` removes `dist/`.

## Philosophy

Keep the wrapper thin. Pi Coding Agent should remain the inner engine; pibo adds only the product boundary we actually need: profiles, plugins, channels, auth, policy, routing, and opt-in operator tooling.

Optional integrations stay outside the core package until the user installs them. MCP servers, Python virtual environments, and third-party CLIs are configured on demand through `pibo mcp` and `pibo tools`, not bundled into pibo itself.

## Plugin Layer

`src/plugins/` contains the minimal static plugin layer. Built-in plugins register tools, subagents, skills, context files, profiles, gateway actions, event listeners, channels, auth services, and web apps through `PiboPluginRegistry`.

This is an extension boundary, not a marketplace. Plugins are internal and statically loaded for now, which keeps the runtime simple while supporting web auth, web apps, new tools, new skills, subagents, and future transports.

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

## Channels And Pibo Sessions

Plugins can register channels through `api.registerChannel(...)`. A channel maps an external transport into pibo events and maps pibo output events back to that transport.

The channel context exposes only the pibo boundary:

- `emit(event)` sends a `PiboInputEvent` to the session router.
- `subscribe(listener)` receives normalized `PiboOutputEvent` values.
- `getSession(id)`, `createSession(...)`, `updateSession(...)`, and `findSessions(...)` work with first-class Pibo Session records.
- `getGatewayActions()` exposes discoverable execution actions for channel UIs.

Pibo Sessions are stored in SQLite by default at `.pibo/pibo-sessions.sqlite`. A Pibo Session keeps product identity (`id`), technical Pi identity (`piSessionId`), channel, kind, profile, owner scope, optional parent/origin relationships, optional workspace, title, and plugin metadata.

The main source folders are:

- `src/core/` for runtime, events, profiles, and session routing
- `src/plugins/` for the static plugin registry and built-in plugins
- `src/channels/` for channel contracts
- `src/sessions/` for Pibo Session storage
- `src/gateway/` for the local TCP gateway transport
- `src/runs/` for yielded run tracking and run-control tools
- `src/auth/`, `src/web/`, and `src/apps/` for Better Auth, the same-origin web host, and web apps

## Profiles

The default profile is registered by the core plugin. It loads the local `pi-agent-harness` skill, registers the core tools `pibo_echo`, `pibo_workspace_info`, and `pibo_exec`, and appends the example context files from `examples/context/`.

Profiles can opt into registered subagents. Pibo exposes enabled subagents to Pi as generated tools named `pibo_subagent_<name>`, routed through normal pibo sessions.

The `run-yield-qa` profile adds two simple QA subagents. Profiles with yieldable tools expose generated run-control tools for tracked or detached work:

```text
pibo_run_start
pibo_run_list
pibo_run_status
pibo_run_wait
pibo_run_read
pibo_run_cancel
pibo_run_ack
```

Try the QA profile through the routed runtime:

```bash
npm run profile -- run-yield-qa
npm run tui:routed -- run-yield-qa
```

Subagent profiles require the routed runtime. Do not use direct `npm run tui -- run-yield-qa` for this profile.

## Gateway

The gateway is the current local transport boundary. It owns the session router, accepts newline-delimited JSON frames over TCP, routes messages by Pibo Session ID, and broadcasts normalized session events back to connected clients.

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
npm run dev -- mcp config path
npm run dev -- mcp config paths
npm run dev -- mcp config schema
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
npm run dev -- mcp registry remove <name>
```

The registry currently has no bundled presets. The command surface remains in place so curated external MCP servers can be added later without changing the config model.

Config lookup order is `-c/--config`, `MCP_CONFIG_PATH`, `./mcp_servers.json`, `~/.mcp_servers.json`, then `~/.config/mcp/mcp_servers.json`. Use `MCP_NO_DAEMON=1` to force fresh MCP connections instead of using the short-lived connection cache.

## CLI Tools

Pibo includes a separate `pibo tools` registry for curated external CLI tools. These tools are not MCP servers and their guides are not loaded into every agent profile. Agents can discover them on demand:

```bash
npm run dev -- tools list
npm run dev -- tools installed
npm run dev -- tools show browser-use
npm run dev -- tools install browser-use
npm run dev -- tools remove browser-use
npm run dev -- tools doctor browser-use
npm run dev -- tools guides browser-use
npm run dev -- tools guide browser-use browser-use
npm run dev -- tools guide browser-use remote-browser
npm run dev -- tools path browser-use
npm run dev -- tools env browser-use
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

LAN development through an sslip.io host is also supported when a local reverse proxy exposes Pibo on port 80:

```text
http://4788.192.168.0.204.sslip.io/api/auth/callback/google
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

For LAN access from another device, set the public origin as both the Better Auth base URL and a trusted origin:

```bash
npm run dev -- config set auth.baseURL http://4788.192.168.0.204.sslip.io
npm run dev -- config set auth.trustedOrigins http://4788.192.168.0.204.sslip.io
```

The web host binds to `127.0.0.1` when `auth.baseURL` is loopback. When `auth.baseURL` is a non-loopback host, `npm run gateway:web` binds the HTTP web host to `0.0.0.0` by default. The internal TCP gateway remains on loopback.

When running behind a local nginx sslip.io proxy, preserve the original browser origin:

```nginx
proxy_set_header Host 127.0.0.1:$target_port;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_pass http://127.0.0.1:$target_port;
```

Pibo trusts `X-Forwarded-Host` and `X-Forwarded-Proto` only from loopback proxy connections. Chat mutation routes still require JSON and same-origin `Origin` headers.

`auth.secret` must be at least 32 characters. `auth.allowedEmails` must contain at least one email; pibo fails closed if the allowlist is missing or empty. Authenticated Google users whose email is not listed receive `403` from the pibo web API. Unauthenticated pibo API requests receive `401`.

All web chat API requests require Better Auth, including localhost.

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

Supported V1 keys are `auth.baseURL`, `auth.secret`, `auth.googleClientId`, `auth.googleClientSecret`, `auth.allowedEmails`, `auth.trustedOrigins`, and `auth.databasePath`.
Secret keys such as `auth.secret` and `auth.googleClientSecret` are stored in full but redacted in `config get` and `config show` output.
