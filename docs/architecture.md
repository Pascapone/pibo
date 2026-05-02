# Pibo Architecture

Pibo is a thin TypeScript harness around Pi Coding Agent. Pi remains the inner engine for model turns, tools, streaming, sessions, and compaction. Pibo owns the outer product boundary: profiles, plugin registration, channels, routing, Pibo Sessions, and transport-specific adapters.

## Design Principles

- Keep Pi Coding Agent embedded as the execution engine, not expanded into the whole product.
- Keep pibo responsible for product boundaries: profiles, plugins, channels, auth, policy, and routing.
- Keep optional integrations opt-in. External MCP servers, Python runtimes, third-party CLIs, and Pi Packages are installed or registered only when a user asks for them.
- Keep runtime configuration explicit and local. Project config lives in `.pibo/config.json`; MCP server definitions live in `mcp_servers.json`; registered Pi Packages live in `.pibo/pi-packages.json`; installed external CLI tools live under `~/.pibo/tools`.
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
- `src/core/profiles.ts` for profile, tool, skill, Pi Package, and context-file selection.
- `src/core/runtime.ts` for creating a Pi Coding Agent runtime from a profile.
- `src/core/session-router.ts` and `src/core/routed-session.ts` for per-session queues and execution actions.

Message events are user input. They are queued per session and sent into Pi.

Execution events are wrapper-level actions such as status, queue clear, abort, dispose, and Pi session controls. They are not model messages. Parameterized execution actions use typed params in `src/core/events.ts`; JSON transports validate those params at the protocol boundary before the router sees them.

Output events are normalized router events. Assistant text and thinking are separate streams: `assistant_delta` carries visible assistant text, while `thinking_started`, `thinking_delta`, and `thinking_finished` carry model thinking traces when the provider emits them. `thinking_finished` ends only the thinking block; the agent turn stays active until `message_finished` or `session_error`. Channels decide independently whether to display thinking; the router always preserves the event boundary so web, gateway, and local TUI clients can opt in without changing Pi runtime behavior.

## Pibo And Pi Sessions

Pibo separates product session identity from Pi Coding Agent's technical session identity. `PiboSession.id` is the stable product route used by channels, APIs, UI, access control, and event correlation. `PiboSession.piSessionId` is the Pi Coding Agent session id used for Pi persistence, transcript files, provider cache affinity, fork, clone, switch, tree navigation, and compaction.

Pibo Sessions are stored in `.pibo/pibo-sessions.sqlite`. They carry channel, kind, profile, owner scope, optional `parentId` for true hierarchy, optional `originId` for fork/clone derivation, workspace, title, and plugin metadata. Core code must not parse meaning out of the Pibo Session ID.

Chat Web sessions have an archive-first lifecycle. Archived sessions remain restorable and visible through the archived-session filter. Permanent deletion is allowed only for archived sessions, requires confirming `Delete this session`, and deletes the selected session plus child sessions from the Pibo Session store, Chat Web read model, and durable chat event log.

## Pi Session Controls

Pibo exposes Pi session controls through typed execution actions while keeping the selected Pibo Session as the route.

The built-in session actions are:

- `session.current` returns the active `piSessionId`, session file, leaf id, cwd, and parent session file.
- `session.list` lists persisted Pi sessions for the current workspace/session directory.
- `session.fork_candidates` returns user message entry ids that can be used as fork targets.
- `session.fork` calls Pi's fork behavior for a selected user message and returns a new visible Pibo Session with `kind: "branch"` and `originId` pointing at the source session.
- `session.clone` clones the current leaf and returns a new visible Pibo Session with `kind: "branch"` and `originId` pointing at the source session.
- `session.tree` returns Pi's current session tree plus the active leaf.
- `session.tree_navigate` moves the active leaf inside the current Pi session tree.
- `session.switch` switches the active Pi runtime to a persisted session file.

Fork and clone intentionally become new product sessions instead of silently replacing the original route. The previous session file is preserved by Pi and returned in the action result. Channels can select the returned Pibo Session ID when they want to continue on the branch.

Tree navigation stays inside the current Pi session file. It changes the active leaf and returns any editor text Pi would prefill for a user-message target. Channels decide how to render tree selection; Pibo only exposes the typed infrastructure.

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

Context file registration is no longer static-only at process start. Plugins can upsert and remove context-file catalog entries later, which allows product-managed context files to appear in the same capability catalog as plugin-shipped files. Product-level changes that are not routed agent output, such as context-file lifecycle events, are emitted as separate product events so UIs can refresh catalog state without pretending those changes are model turns.

## Pi Packages

Pibo can register Pi Coding Agent packages from `https://pi.dev/packages/...` URLs or local paths without making them globally active. The Pibo store at `.pibo/pi-packages.json` is the product source of truth for package source, install spec, metadata, discovered resource types, install status, and diagnostics.

Registered does not mean loaded. A profile or custom agent must select a registered Pi Package before a runtime receives it. Runtime creation resolves the selected package ids through the Pibo store and passes only the selected Pibo-managed install paths or resolved local package paths into Pi's package resource loading path. Global packages configured directly in Pi settings are not automatically injected into Pibo profiles.

Pi Packages remain Pi-owned resources. Pibo does not rewrite package extensions, skills, prompts, or themes into native Pibo tools. Pibo's product boundary still owns MCP selection, subagents, routed sessions, run-control tools, Chat Web, auth, and policy. Package diagnostics are surfaced through profile inspection and runtime diagnostics so operators can see which packages were loaded and why a package failed.

## Subagents

Subagents are profile-scoped capabilities, exposed to Pi as generated tools. A plugin registers a subagent definition, and a profile chooses which subagents are visible in the same builder pattern used for tools, skills, and context files.

```text
Profile
  -> tools
  -> subagents
  -> skills
  -> Pi Packages
  -> context files
```

A subagent definition points at another registered profile. That target profile may have its own tools, skills, context files, and subagents. Nothing is inherited automatically from the parent profile; each target profile declares its own capabilities.

At runtime, each subagent call creates or reuses a normal routed session:

```text
parent Pibo Session
  -> pibo_subagent_<name> tool
  -> child Pibo Session with channel=pibo.subagents, kind=subagent, parentId=<parent id>
  -> Session router
  -> Pi runtime for targetProfile
```

If `threadKey` is omitted, pibo creates a new subagent session. If the caller passes the same `threadKey` again, the same subagent session is continued, which allows multi-turn delegation. Reuse is based on structured Pibo Session fields: parent id, target profile, and metadata containing the subagent name/tool name/thread key.

When the parent session belongs to a Chat Web room, subagent child sessions inherit the parent's `metadata.chatRoomId`. This keeps subagent work visible in the same room-scoped session tree and lets room deletion remove the full contained session subtree.

Subagent tools are synchronous normal tools: they wait for the correlated child reply and return it to the calling agent. Generated subagent tools are always parallel-capable at the Pi tool scheduler boundary; Pibo does not expose a per-subagent sequential execution mode. Agents that need ordered work issue the next direct call only after the prior result is available, or start independent work through `pibo_run_start`. A depth guard prevents accidental recursive subagent loops. Long-running subagent work should be started through yielded runs by wrapping the subagent tool with `pibo_run_start`.

## Yielded Runs

Profiles with yieldable tools can receive run-control tools through the `pibo-run-control` capability package. These are agent-facing tools, not gateway actions:

```text
pibo_run_start
pibo_run_list
pibo_run_status
pibo_run_wait
pibo_run_read
pibo_run_cancel
pibo_run_ack
```

`pibo_run_start` wraps one yieldable tool call as a yielded run and returns a `runId`. The wrapped tool still exists as a normal synchronous tool; the run wrapper only changes execution lifecycle. When `pibo-run-control` is enabled, Pi Coding Agent's built-in `bash` tool is registered as yieldable through Pibo. Generated `pibo_subagent_<name>` tools are also yieldable.

Yielded runs use `tracked` by default. Tracked runs create compact `<pibo_run_notification>` service messages for the parent agent when they start, finish, fail, or remain unconsumed across natural turn boundaries. Notifications contain only run ids and summaries; the agent must call `pibo_run_read` to retrieve the full result. `detached` runs are explicit fire-and-forget work: they remain inspectable with `includeDetached`, but they do not create automatic reminders.

The router keeps one active parent turn at a time by enqueuing notifications as normal service messages. Service notifications do not immediately re-trigger themselves. Running runs are cancelled when their owning session or router is disposed, detached terminal runs are pruned after a short TTL, and consumed terminal tracked runs are kept briefly for debugging.

## Reliable Event Core

Pibo has a local SQLite reliability store at `.pibo/pibo-events.sqlite`. It is Pibo-owned product metadata and operational state; it does not replace Pi Coding Agent JSONL transcripts, the Pibo Session store, or the Chat Web event log.

The store uses SQLite WAL, `busy_timeout`, and foreign keys for a single-host, multi-process deployment model. It provides at-least-once delivery surfaces, not exactly-once effects. Consumers and projectors must be idempotent, and unsafe side-effect tools are not automatically retried unless a future tool explicitly declares retryability.

The core tables are:

- `pibo_event_stream` for append-only topic streams with `(topic, event_id)` and optional `(topic, idempotency_key)` idempotency.
- `pibo_event_consumers` for named monotonic consumer offsets.
- `pibo_jobs` for bounded live work queues with claim visibility, retry metadata, and expiration.
- `pibo_dead_jobs` for terminal failed or expired jobs that are never scanned by the live claim path.
- `pibo_runs` for durable yielded-run status, ownership, summaries, results, errors, and notification state.

Replay is cursor-based. `appendOnce` returns an existing event when the same topic/event id or topic/idempotency key has already been stored. Consumer offsets only move forward. Retention pruning preserves rows still needed by named consumers unless an explicit destructive prune is used.

The durable job queue is at-least-once. A worker claims a pending job for a visibility window, and `ack` only succeeds for the current worker before that claim expires. Failed or exhausted jobs move to the dead-letter table. Dead jobs are replayable through the debug CLI, which creates a new live job with provenance in its payload instead of leaving the entry as an unrecoverable graveyard.

Yielded runs write both a durable run record and a `runs` queue job when `pibo_run_start` is called. The current execution still runs in-process; the durable records make run state inspectable across restarts. If a process disappears while a run is still marked running, store recovery fails non-retryable runs by default. Retryable runs can be released back to pending, but arbitrary yieldable tools, `bash`, and subagent runs remain non-retryable unless explicitly marked safe later.

Chat Web continues to keep `web_chat_events` as its read model and `chat_events` as the room/user-facing durable log. Normalized `PiboOutputEvent` values are additionally mirrored to the `pibo.output` topic for operational replay/debugging. Trace nodes are still reconstructed at read time from Pi JSONL plus Chat Web stores; Pibo does not materialize trace nodes durably.

`pibo.output` stores streaming deltas as `live_delta`, which can be high volume during long agent and subagent runs. Operators can inspect counts by topic/session/retention class and prune old deltas. Non-destructive pruning keeps rows that named consumers have not advanced past; `--destructive` is explicit and should only be used when replay consumers no longer need the rows.

Debug commands:

```bash
pibo debug events stream --topic pibo.output --after 123
pibo debug events stats --topic pibo.output --session ps_... --retention live_delta
pibo debug events prune --topic pibo.output --retention live_delta --before 2026-05-01T00:00:00.000Z
pibo debug events consumers
pibo debug jobs list --queue runs
pibo debug jobs dead --queue runs
pibo debug jobs replay <job-id>
pibo debug runs list <pibo-session-id>
pibo debug runs inspect <run-id>
```

Text output is compact by default. Use `--json` for full stored payloads and machine-readable inspection.

## Agent Designer

The Chat Web Agents area persists custom agents in `.pibo/chat-agents.sqlite`. Each saved custom agent is registered as a dynamic profile before routed sessions are created.

The Agents UI has a single profile sidebar. User-created custom agents are editable; plugin-registered profiles are read-only inspection targets that expose their selected native tools, skills, context files, subagents, built-in tool mode, and run-control package state. Copying a read-only profile creates an editable custom agent draft.

Custom agent names are canonical profile names. They use lowercase kebab-case, such as `test-agent`, and are stored as `profile_name` so session creation and UI display use the same identifier. Legacy `custom-agent:agent_*` names are migrated to kebab-case names and kept as aliases for compatibility.

Custom agents have an archive-first lifecycle. Active custom agents are registered as dynamic profiles; archived custom agents remain inspectable but are removed from the active profile catalog, disabled for new sessions, and treated as read-only until restored. Permanent deletion is allowed only for archived custom agents, requires confirming the exact profile name, removes the dynamic profile, and deletes Chat Web sessions using that profile plus their child sessions from the Pibo Session store, Chat Web read model, and durable chat event log.

The designer configures profile-scoped agent capabilities:

- plugin-registered native tools
- skills
- Pi Packages
- context files
- subagents
- automatic local context-file loading for files such as `AGENTS.md` and `CLAUDE.md`
- built-in Pi tool visibility
- capability packages such as `pibo-run-control`

Curated external CLI tools managed by `pibo tools` are deliberately not part of the per-agent selection. They are global operator tooling available through the agent environment, while native plugin tools and registered Pi Packages remain profile-specific capability surfaces.

Managed context files are now a product-owned extension of that capability surface. Pibo ships a `pibo.context-files` plugin that:

- serves a managed context-file API at `/api/context-files`
- stores managed file metadata and revisions in `.pibo/context-files/context-files.sqlite`
- supports global and agent-scoped markdown files
- supports linked managed copies created from plugin-shipped context files
- emits product events such as `context-file.created`, `context-file.updated`, `context-file.removed`, and `context-file.external_updated`

Managed files are exposed through the same capability catalog as plugin context files, with extra metadata for source and scope. Plugin files remain read-only source entries. When a user wants to customize one, the product creates a managed copy linked back to the plugin source via `sourceRef` and `sourceHash`. That link produces explicit product states such as `plugin-only`, `linked-clean`, `linked-dirty`, `linked-stale`, `orphaned`, and `managed-unlinked`, so UIs can show whether a managed copy is unchanged, locally edited, behind a changed plugin source, disconnected from its source, or never linked.

The managed context-file API also owns revision and comparison workflows. A managed file keeps an active revision history, can be diffed against its source or a stored revision, can be reset exactly to the current plugin source, can restore an older managed revision, and can adopt a changed plugin source as the new managed baseline. Agent-scoped managed files still become ordinary explicit profile context files at runtime; the extra product metadata exists so the product can manage editing, linking, and recovery flows outside the agent runtime.

## Channels

Channels are plugin-owned adapters. They translate an external transport into pibo events and translate pibo output events back to that transport.

The channel context intentionally exposes only:

- `emit(event)` to route a `PiboInputEvent`.
- `subscribe(listener)` to observe `PiboOutputEvent` values.
- `getSession(id)`, `createSession(input)`, `updateSession(id, input)`, `deleteSession(id)`, and `findSessions(input)` to work with first-class Pibo Session records.
- `getGatewayActions()` to discover execution actions for channel UIs.

Pibo Sessions are stored in SQLite by default at `.pibo/pibo-sessions.sqlite`. Channels and tools route by `PiboSession.id`; Pi and provider cache keys use `PiboSession.piSessionId`. Sidebar/tree nesting follows `parentId` only. Fork/clone derivation uses `originId` and does not imply nesting.

## Auth

Auth is a thin core service boundary exposed to channels through `PiboChannelContext`. The gateway validates that channels marked with `auth.mode: "required"` have an auth service before they start.

The first concrete implementation is Better Auth, registered through a built-in plugin for the web gateway path. It is intentionally not loaded by the default local gateway so trusted-local TCP flows do not require Google OAuth configuration. Web apps always require the web auth service, including localhost. The Auth plugin owns identity and allowlist checks; it does not own chat UI or agent routing.

Runtime config lives in `.pibo/config.json` and is managed through `pibo config ...`. Better Auth reads this local config; environment variables are not part of the auth configuration path.

```text
Same-Origin Web Host
  -> Better Auth /api/auth/*
  -> Chat Web App /apps/chat and /api/chat/*
  -> auth/session policy
  -> create or select Pibo Session(ownerScope=user:<userId>, channel=pibo.chat-web)
  -> Session router
```

The V1 chat web app uses Better Auth Google sign-in for every request path, including localhost. The authenticated Better Auth user id becomes `ownerScope=user:<userId>`. New personal sessions are top-level Pibo Sessions with `channel: "pibo.chat-web"` and `kind: "chat"`. Fork and clone results are visible branch sessions with `originId`. `parentId` is reserved for true child sessions such as subagents, not for ordinary sessions owned by the same user.

Chat Web navigation is URL-based. The browser URL is the primary source of truth for the visible area and selected room/session. The canonical session URL is `/apps/chat/rooms/<roomId>/sessions/<piboSessionId>`, with additional app URLs for `/apps/chat/agents` and `/apps/chat/settings`. Opening `/apps/chat` may use browser-local last-selection state as an entry fallback, but bootstrap must replace it with the canonical room/session URL. The same-origin web host serves the React shell for non-asset `/apps/chat/*` paths so direct links and page reloads keep the selected area instead of falling back to the base app.

Inside the Sessions area, rendering is now mediated by a small Chat-Web-specific session-view registry in the frontend bundle. The registry keeps the existing nested trace renderer as the default `trace` view and adds a second compact `terminal` view that renders the same `PiboSessionTraceView` projection without changing router/runtime contracts. Session-view selection is a browser/UI concern only: it persists through the `view` search param and browser-local preference, and it does not alter the canonical room/session route identity.

The authenticated Chat Web shell also includes a Context area at `/apps/chat/context`. This area reuses the managed context-file API instead of maintaining a second auth flow or a disconnected editor surface. Inside the integrated Chat shell, the Context editor remains the primary center workspace while the managed-file creation and selection panel sits on the right side so the shell does not present two competing left sidebars. The older dedicated `/apps/context-files` web app still exists as a standalone plugin web app, but the main operator path is now the integrated Chat Web area.

The auth boundary is enforced before channel input reaches the session router:

- no Better Auth session returns `401`
- a missing or empty `auth.allowedEmails` allowlist prevents Better Auth startup
- a Google account outside `auth.allowedEmails` returns `403`
- allowed users can list and select their own Pibo Sessions by `ownerScope`
- chat mutation routes require same-origin JSON requests

Google OAuth redirect URIs remain per deployment. Local QA can use `http://localhost:4788/api/auth/callback/google`; internet-facing deployments must configure their own `https://<host>/api/auth/callback/google` in Google Cloud Console and set `auth.baseURL` to the same origin. LAN development can use an sslip.io origin such as `http://4788.192.168.0.204.sslip.io` when that exact callback URI is registered with Google and configured as `auth.baseURL`. Pibo does not attempt wildcard redirect support because Google requires exact redirect URI matching for web-server OAuth.

## Web Host And Apps

The same-origin web path is intentionally split:

- `pibo.web-host` starts the HTTP channel and routes `/api/auth/*` plus registered web apps.
- `pibo.chat-web` registers the current chat UI/API as a web app.
- Future apps can register additional web apps without becoming part of the Auth plugin.

This avoids iframe and cross-origin complexity for V1. Apps can use normal same-origin cookies and call their own API routes while sharing the gateway auth boundary.

Built Chat Web assets under `/apps/chat/assets/*` are served as immutable static assets. The web host advertises long-lived cache headers and negotiates Brotli or gzip compression for compressible JS, CSS, HTML, and JSON payloads so the React shell reload path stays small.

When the web host sits behind a local reverse proxy, it reconstructs the public request origin from `X-Forwarded-Host` and `X-Forwarded-Proto` only for loopback proxy connections. This lets nginx map `http://4788.<lan-ip>.sslip.io` to `127.0.0.1:4788` without breaking chat mutation CSRF checks. Direct non-loopback clients cannot spoof those forwarded headers.

### Chat Web Live Stream

The Chat Web App exposes live updates through `GET /api/chat/events?piboSessionId=...` as server-sent events. This stream is intentionally a transport adapter over normalized `PiboOutputEvent` values, not a new source of truth.

The adapter lives in `src/apps/chat/stream.ts`. It turns full router events into compact, AG-UI-inspired frames:

- `RUN_STARTED`, `RUN_FINISHED`, and `RUN_ERROR` mark the lifecycle of a routed turn.
- `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, and `TEXT_MESSAGE_END` stream assistant text by delta.
- `REASONING_MESSAGE_START`, `REASONING_MESSAGE_CONTENT`, and `REASONING_MESSAGE_END` stream reasoning text separately from visible assistant text.
- `TOOL_CALL_START`, `TOOL_CALL_ARGS`, and `TOOL_CALL_RESULT` stream tool state without resending the whole event history.
- `AGENT_DELEGATION` links subagent child sessions into the parent trace.
- `EXECUTION_RESULT` carries wrapper action results.
- `RAW_EVENT` is the compatibility fallback for output events without a compact frame yet.

The HTTP response still uses plain SSE with `event: pibo`; the optimization is the payload shape. Content deltas send only the new token or character chunk plus a stable message id. Assistant text message ids prefer Pibo's turn-local `assistantIndex` over provider `contentIndex`, while reasoning message ids prefer `thinkingIndex` over `contentIndex`. This keeps separate live assistant or reasoning segments distinct even when the provider reuses a content-part index during one routed turn. The React chat UI applies these frames directly to the current trace view and refreshes `/api/chat/trace` at explicit lifecycle boundaries such as `TEXT_MESSAGE_END`, run finish, and run error. Normal trace reloads stay compact: raw event rows are omitted unless the inspector explicitly requests them with `includeRawEvents=true`, and `rawEventsLimit` bounds the replay window when they are requested. The raw Pibo event log remains persisted in the Chat Web Read Model for reconstruction and debugging.

Trace rendering uses explicit order metadata instead of treating wall-clock timestamps as the semantic ordering source. Transcript-backed nodes use Pi JSONL entry/content-part order. Stored event-derived nodes use the Chat Web read model's per-session `event_sequence`. Live SSE nodes use the stream id and frame index from the SSE cursor. Shared order helpers in `src/shared/trace-order.ts` are used by the server trace rebuild, debug checks, and the React trace display path so refreshes do not reorder completed conceptual nodes just because timestamps changed.

### Chat Web Rooms And Durable Events

The Chat Web App now has a user-facing room layer in front of routed Pibo Sessions.

```text
Authenticated user
  -> ownerScope=user:<auth-user-id>
  -> Pibo Room
  -> one or more Pibo Sessions
  -> Session Router
  -> Pi Coding Agent
```

Rooms are stored in `.pibo/web-chat.sqlite` through `pibo_rooms` and `pibo_room_members`. A room is the UI container and access boundary. A Pibo Session is still the runtime route into Pi Coding Agent. The current migration bridge links sessions to rooms with `PiboSession.metadata.chatRoomId`.

On first Chat Web bootstrap for an owner scope, Pibo ensures a personal default room named `Personal Chat`, adds the user as owner, and ensures a top-level chat session in that room. This makes a first login immediately usable without manual setup.

The personal room is locked product state: it is shown separately in the sidebar, cannot be renamed, cannot be archived, and cannot be deleted. User-created rooms have an archive-first lifecycle. An archived room remains readable and selectable so the user can inspect contained sessions before restoring or deleting it, but it is read-only: session creation, message sends, and execution actions are rejected. Permanent room deletion is available only for archived, non-personal rooms, requires typing the exact room name, and deletes child rooms, contained sessions, subagent session descendants, read-model rows, and durable chat events.

The same SQLite file also contains `chat_events`, a durable event log with monotone `stream_id` values. The event log stores accepted user messages, failure records, router output events, actor information, optional `client_txn_id`, retention class, and JSON payload. It is written in parallel with the older `web_chat_events` read model so trace reconstruction stays compatible while room sync gains a durable source. The older `web_chat_events` table also carries a per-session `event_sequence` used only for deterministic trace reconstruction and diagnostics.

Unread badges are cursor-based. Room badges use `pibo_room_members.last_read_stream_id`, while session badges use `chat_session_reads.last_read_stream_id`. Opening a room through bootstrap with `markRead=true` advances the room cursor and the visible session cursors to the latest durable stream positions, preventing room badges from staying unread after the visible session tree has been read.

Message sends are idempotent when the client provides `clientTxnId`. The idempotency key is `(roomId, actorId, clientTxnId)`, so retries from the same user in the same room return the already accepted event instead of starting a second agent run.

SSE live updates remain the transport, but persistent frames now carry frame-specific cursors:

```text
id: <streamId>:<frameIndex>
```

One stored chat event can generate several UI frames, so the frame index is required for precise reconnect catch-up.

## Local Routed TUI

`src/local/` contains the explicit local routed TUI adapter. It starts a Pi TUI controller shell with builtin tools disabled, then routes normal input through an in-process `PiboSessionRouter`.

The local adapter is intentionally not a gateway replacement and not a second runtime:

- `src/local/client.ts` owns the in-process router client, a local Pibo Session, and router cleanup.
- `src/local/extension.ts` owns Pi TUI input interception, conservative slash-command filtering, autocomplete filtering, and mapping normalized routed events onto Pi TUI render components.
- `src/local/tui.ts` wires the controller profile, client, extension, and `runPiboTui` together.

V1 is opt-in through `npm run tui:routed -- <profile>`. The existing `npm run tui -- <profile>` path remains direct Pi TUI and does not auto-select routed mode. Details live in `docs/local-routed-tui.md`.

## Operator CLIs

The operator CLIs are optimized for agent-driven discovery. Each level should answer only the question for that level and point to the next command. Broad usage guides, schemas, and environment details are printed only by explicit deeper commands such as `schema`, `show`, `doctor`, or `guide`.

`pibo mcp` is a local operator tool for discovering and calling external MCP servers from the shell. It is separate from the pibo plugin/runtime boundary: MCP servers are configured in `mcp_servers.json`, not in `PiboPluginRegistry`, and their tools are invoked directly by the CLI. The usage guide lives in `docs/mcp.md`.

`pibo tools` is the matching operator surface for curated external CLI tools. These are not MCP servers and are not Pibo profile skills. A tool entry can install an isolated runtime, expose doctor/path/env commands, and print on-demand guides for agents. The first curated tool is `browser-use`, installed under `~/.pibo/tools/browser-use` with its own Python venv and tool home. Its Pibo-specific helper commands can inspect existing Chrome CDP targets and export the best authenticated Chat Web target without launching a fresh unauthenticated browser.

`pibo debug` is the local operator surface for targeted diagnostics against Pibo-owned SQLite stores. It is not a profile tool and does not expose runtime capabilities to agents. The command can list known stores, discover table schemas, run read-only SQL with row limits, inspect one Pibo Session from a Pibo Session ID or canonical Chat Web URL, rebuild the Chat Web trace view, and extract selected event payload fields. Session inspection summarizes Pibo Session metadata, child sessions, Chat Web read-model state, and optional event headers without dumping full event payloads or Pi JSONL transcripts. Trace inspection uses the same `buildTraceView` logic as `/api/chat/trace`, so UI trace state can be debugged without writing ad hoc scripts. `pibo debug trace --check` adds consistency diagnostics for duplicate ids, missing parents, missing source/stable-key/order metadata, and sibling order regressions.

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

Chrome DevTools integration is MCP only when `chrome-devtools-mcp` is configured in `mcp_servers.json`. The bundled `browser-use` command remains a separate `pibo tools` entry and is not listed in Agent Designer MCP server selection. Agent Designer selects MCP servers for custom agents, while the Chat Web Context area's `MCP Tools` section owns editing the short model-visible MCP descriptions that become `.pibo/context/enabled-mcp-servers.md`.

## CLI Tools

`pibo tools` keeps curated command-line tools discoverable without pushing their usage instructions into every agent context. Installed tool runtimes live under `~/.pibo/tools/<name>`. A tool can expose one or more guides, but those guides are only printed when requested through the CLI.

The first bundled tool preset is `browser-use`, pinned to `browser-use[cli]==0.12.6` so its CLI surface matches the bundled guide text. Its guides are available through:

```bash
npm run dev -- tools guides browser-use
npm run dev -- tools guide browser-use browser-use
npm run dev -- tools guide browser-use remote-browser
npm run dev -- tools browser-use targets
npm run dev -- tools browser-use attach-chat
```

## Current Scripts

```bash
npm run gateway
npm run gateway:web
npm run client -- <piboSessionId>
npm run tui -- [profile]
npm run tui:routed -- [profile]
npm run profile -- [profile]
npm run dev -- mcp
npm run dev -- tools
npm run dev -- debug
```

`npm run tui:routed` runs the explicit local routed TUI adapter without requiring the gateway daemon.
