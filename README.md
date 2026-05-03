# pibo

Pibo turns Pi Coding Agent into an agent-native runtime with discoverable CLI tools, plugins, channels, and local gateways.

Pi remains the inner engine for model turns, tools, streaming, sessions, and compaction. Pibo owns the outer product boundary: profiles, plugin registration, channels, routing, Pibo Sessions, auth, policy, and transport-specific adapters.

## Install

Pibo V1 targets Node.js 24+.

```bash
npm install -g @pasko70/pibo
pibo --help
```

For local development from source:

```bash
npm install
npm run build
npm run start -- --help
```

The current Chat Web build includes two session views over the same routed trace data: the default nested `Trace` view and the compact `Terminal` view. Both views now use virtualization in the UI layer, so long-running sessions stay responsive without changing trace reconstruction, ordering, or live-update semantics.

## Docs

- `docs/architecture.md` describes the current runtime architecture and boundaries.
- `docs/mcp.md` documents the MCP CLI and registry.
- `docs/tools.md` documents curated external CLI tools.
- `docs/pi-packages.md` documents registered Pi Coding Agent packages and per-agent selection.
- `docs/agent-run-yield-spec.md` documents yielded agent runs and run-control tools.
- `docs/chat-rooms-event-log.md` documents Chat Web rooms, default-room startup, durable chat events, unread cursors, SSE cursors, and idempotent sends.
- `docs/codex-compact-terminal-design.md` documents the compact Codex-style Chat session view.
- `docs/progress.md` is the short implementation status snapshot.

## Scripts

- `npm run dev` runs the TypeScript entrypoint with `tsx`.
- `npm run profile` prints the selected profile with loaded skills, tools, and context files.
- `npm run profile -- gateway-producer` prints the parked gateway producer profile.
- `npm run profile -- run-yield-qa` prints the yielded-run QA profile with subagents.
- `npm run tui` starts the Pi TUI through the pibo wrapper.
- `npm run tui:gateway` starts the Pi TUI with the gateway producer profile.
- `npm run gateway` starts the local pibo gateway daemon.
- `npm run gateway:web` starts the local gateway with Better Auth, the same-origin web host, and the chat app.
- `npm run client -- <piboSessionId>` starts a console client connected to the gateway.
- `npm run dev -- mcp` lists configured MCP servers and tools.
- `npm run dev -- tools` lists curated external CLI tools.
- `npm run dev -- pi-packages` lists registered Pi Coding Agent packages.
- `npm run dev -- debug` inspects local Pibo SQLite stores.
- `npm run dev -- config keys` lists supported local config keys.
- `npm run build` compiles to `dist/`.
- `npm run start` runs the compiled entrypoint.
- `npm test` builds and runs the test suite.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run clean` removes `dist/`.
- `scripts/deploy-web.sh` is the production web deploy helper for the server: build main, refresh the stable fallback copy, restart `pibo-web`, wait for `/health`, and stop `pibo-web-fallback` again if main is healthy.

## Philosophy

Keep the wrapper thin. Pi Coding Agent should remain the inner engine; pibo adds only the product boundary we actually need: profiles, plugins, channels, auth, policy, routing, and opt-in operator tooling.

Optional integrations stay outside the core package until the user installs them. MCP servers, Python virtual environments, and third-party CLIs are configured on demand through `pibo mcp` and `pibo tools`, not bundled into pibo itself.

## Plugin Layer

`src/plugins/` contains the minimal static plugin layer. Built-in plugins register tools, subagents, skills, context files, profiles, gateway actions, event listeners, channels, auth services, and web apps through `PiboPluginRegistry`.

This is an extension boundary, not a marketplace. Plugins are internal and statically loaded for now, which keeps the runtime simple while supporting web auth, web apps, new tools, new skills, subagents, and future transports.

The gateway producer plugin is parked outside the default plugin registry. It remains available for explicit local gateway experiments through the `gateway-producer` profile.

## Channels And Pibo Sessions

Plugins can register channels through `api.registerChannel(...)`. A channel maps an external transport into pibo events and maps pibo output events back to that transport.

The channel context exposes only the pibo boundary:

- `emit(event)` sends a `PiboInputEvent` to the session router.
- `subscribe(listener)` receives normalized `PiboOutputEvent` values.
- `getSession(id)`, `createSession(...)`, `updateSession(...)`, `deleteSession(...)`, and `findSessions(...)` work with first-class Pibo Session records.
- `getGatewayActions()` exposes discoverable execution actions for channel UIs.

Pibo Sessions are stored in SQLite by default at `.pibo/pibo-sessions.sqlite`. A Pibo Session keeps product identity (`id`), technical Pi identity (`piSessionId`), channel, kind, profile, owner scope, optional parent/origin relationships, optional workspace, title, and plugin metadata.

In the Chat Web App, personal sessions can be archived before deletion. Permanent deletion is available only for archived sessions and requires typing `Delete this session`; it removes the selected Pibo Session, child sessions, and their Chat Web read-model/event-log rows.

The Chat Web App also has Pibo Rooms. Each user gets a locked `Personal Chat` room automatically. The personal room is shown separately from user-created rooms and cannot be renamed, archived, or deleted. User-created rooms can be archived first, then permanently deleted after typing the room name. Archived rooms remain inspectable and show their contained sessions, but they are read-only: no new sessions, messages, or execution actions can be started in that room. Permanent room deletion removes the room subtree, contained sessions, subagent session descendants, and Chat Web read-model/event-log rows.

Within the Sessions area, the Chat Web App now has an internal session-view registry. The existing nested trace renderer remains the default `Trace` view, and the same `PiboSessionTraceView` data can also be rendered through a compact Codex-style `Terminal` view selected by `?view=trace|terminal` or by browser-local preference. Both session views are virtualized at the rendering layer so very long histories remain fast without changing the underlying trace tree, trace ordering, or live SSE merge logic.

Managed context files are now a first-class product capability. The `pibo.context-files` plugin exposes editable global and agent-scoped markdown context files through `/api/context-files`, stores managed-file metadata and revisions in `.pibo/context-files/context-files.sqlite`, and emits product events when managed files are created, changed, removed, or updated on disk. Plugin-shipped context files remain immutable source files; the product can create linked managed copies from them, track source hashes and link state, diff the managed copy against its source, reset back to source, restore older revisions, or adopt a changed source as the new managed baseline.

The main source folders are:

- `src/core/` for runtime, events, profiles, and session routing
- `src/plugins/` for the static plugin registry and built-in plugins
- `src/channels/` for channel contracts
- `src/sessions/` for Pibo Session storage
- `src/gateway/` for the local TCP gateway transport
- `src/runs/` for yielded run tracking and run-control tools
- `src/auth/`, `src/web/`, and `src/apps/` for Better Auth, the same-origin web host, and web apps

## Agent Designer

The Chat Web App includes an Agent Designer in the Agents area. It creates custom agents, persists them in `.pibo/chat-agents.sqlite`, and registers each saved agent as a dynamic profile for routed sessions.

The Agents area uses one sidebar for both editable custom agents and read-only plugin profiles. Plugin profiles can be inspected with their registered tools, skills, context files, subagents, built-in tool mode, and run-control package state, then copied into a custom agent when changes are needed.

Custom agent names are profile names. They must be lowercase kebab-case, such as `test-agent`, and are used consistently in the UI, session records, and backend profile registry. Legacy `custom-agent:agent_*` names remain aliases for existing agents.

Custom agents can be archived before deletion. Archived custom agents are removed from the active profile catalog, cannot start new sessions, and become read-only until restored. Permanent deletion is available only for archived agents and requires typing the agent profile name; it deletes the custom agent and Chat sessions using that profile.

The designer configures native Pibo agent capabilities only: plugin-registered tools, skills, context files, subagents, automatic local context-file loading, built-in Pi tool visibility, and capability packages such as `pibo-run-control`. Curated external CLI tools from `pibo tools` remain global operator tooling and are not selected per agent.

The Chat Web App also supports User Skills. Operators can create local skills or import them from `skills.sh` or GitHub, and Pibo stores them under `.pibo/user-skills` plus `.pibo/user-skills.json`. Enabled user skills are registered live so they are selectable in the Agent Designer and available to routed sessions without a manual restart.

User Skill names are guarded at two layers: the web app no longer re-registers an already-synced skill on subsequent requests, and create/rename/enable/import flows reject names that would collide with an already registered skill. Imports also refuse to silently overwrite an existing skill name.

The Chat Web App now also has a dedicated Context area at `/apps/chat/context`. It reuses the managed context-file APIs inside the main Chat UI shell so operators can create, edit, relocate, and remove managed context files without leaving the authenticated Chat Web App. Plugin context files are shown there as read-only sources, and both the Context area and Agent Designer can create linked managed copies when a user wants to customize shipped content safely.

The Context area also exposes the Pibo Base Prompt. The library prompt lives at `context/pibo-system-prompt.md`; the Chat Web App can switch between that read-only library prompt and a persisted custom prompt stored under `.pibo/base-prompt.md`. Runtime prompt templates replace `{{availableTools}}` and `{{guidelines}}` from the active Pi/Pibo tool surface before project context and skills are appended.

The Context area also exposes the Pibo Compaction Prompt. The library prompt lives at `context/pibo-compaction-prompt.md`; the Chat Web App can switch between that read-only library prompt and a persisted custom prompt stored under `.pibo/compaction-prompt.md`. At runtime Pibo handles Pi's `session_before_compact` hook and uses the active compaction prompt sections for summary creation, update-summary creation, and split-turn prefix summaries.

## Profiles

The default profile is registered by the core plugin. It loads the local `pi-agent-harness` skill and uses Pi Coding Agent's built-in tools for normal coding work.

The `codex` alias resolves to the `codex-compat-openai-web` profile. It keeps the Pibo runtime boundary while exposing Codex-like coding affordances: Pi/Pibo `read`, `edit`, and `write`; Pibo run-control `bash`; native `web_search`; `apply_patch` and `view_image`; generated `pibo_subagent_default`, `pibo_subagent_explorer`, and `pibo_subagent_worker`; and the `pibo_run_*` lifecycle tools. `web_search` is a normal Pibo native tool with a provider adapter; the default adapter injects OpenAI Responses hosted `web_search` into the model request instead of using a local DuckDuckGo function tool. It intentionally does not expose Pi's separate `grep`, `find`, or `ls` tools by default; codebase search remains Codex-style through `bash` and commands such as `rg`.

Profiles can opt into registered subagents. Pibo exposes enabled subagents to Pi as generated tools named `pibo_subagent_<name>`, routed through normal pibo sessions. Generated subagent tools are always parallel-capable; agents sequence subagent work by waiting for a direct result before issuing a later call or by using `pibo_run_start` for yielded work.

Subagent sessions use `parentId` for hierarchy and inherit the parent session's `metadata.chatRoomId` when the parent belongs to a Chat Web room, so room-scoped session views and room deletion include subagent work.

The `run-yield-qa` profile adds two simple QA subagents. Profiles with yieldable tools can expose generated run-control tools through the `pibo-run-control` capability package:

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

The parked gateway producer profile adds `pibo_gateway_send`, a tool that sends a message into a target gateway session and returns the correlated assistant reply. See `examples/gateway/README.md` for the two supported manual flows.

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
npm run dev -- tools browser-use
npm run dev -- tools browser-use targets
npm run dev -- tools browser-use attach-chat
npm run dev -- tools browser-use lease acquire
```

The first curated tool is `browser-use`, pinned to `browser-use[cli]==0.12.6` so the CLI surface stays aligned with the bundled guides. It is installed into an isolated runtime under `~/.pibo/tools/browser-use` and uses `~/.pibo/tools/browser-use/home` as its tool home. See `docs/tools.md`.

When using Browser Use from this repo, initialize its shell environment once in a persistent terminal with `eval "$(npm run --silent dev -- tools env browser-use)"`, then run later `browser-use` commands directly in that same terminal.

For Chat Web debugging, start by reusing the browser that already exists: `npm run dev -- tools browser-use targets` lists Chrome CDP targets with Chat auth/composer hints, and `npm run dev -- tools browser-use attach-chat` exports the best authenticated Chat target for direct CDP inspection.

## Debug CLI

Pibo includes a local operator CLI under `pibo debug` for targeted SQLite diagnostics. It is not an agent profile tool and does not load Pi transcripts or full Chat Web payloads automatically.

```bash
npm run dev -- debug db stores
npm run dev -- debug db schema sessions
npm run dev -- debug db query sessions "select id, profile from pibo_sessions limit 5"
npm run dev -- debug session /apps/chat/rooms/<roomId>/sessions/<piboSessionId>
npm run dev -- debug trace <piboSessionId> --running-only
npm run dev -- debug trace <piboSessionId> --check
npm run dev -- debug events <piboSessionId> --type tool_execution_finished --fields toolName,toolCallId,result.details.status
npm run dev -- debug events stats --topic pibo.output --session <piboSessionId> --retention live_delta
npm run dev -- debug events prune --topic pibo.output --retention live_delta --before 2026-05-01T00:00:00.000Z
```

`pibo debug db query` opens known stores read-only, accepts only one read-only SQL statement, applies a default row limit when the query has no `limit`, and supports `--json` for machine-readable output. `pibo debug trace` rebuilds the same Chat Web trace view as `/api/chat/trace`; `--check` adds trace consistency diagnostics for ids, parents, stable order metadata, and source/stable-key coverage. `pibo debug events` extracts selected payload fields without dumping full event payloads, can summarize retained event counts by topic/session/retention class, and can prune old `live_delta` rows once replay consumers no longer need them.

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
