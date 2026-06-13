# Pibo Glossary

This glossary is the shared vocabulary for Pibo design, specs, docs, and implementation discussion.

## Terms

**Pibo**:
The thin TypeScript product harness around Pi Coding Agent.

**Pi Coding Agent**:
The embedded inner agent engine responsible for model turns, tools, streaming, sessions, and compaction.

**Product Boundary**:
The outer layer managed by Pibo, including profiles, plugins, channels, routing, auth, policy, Pibo Sessions, and transport adapters.

**Runtime**:
The executable agent environment created from a selected profile and backed by Pi Coding Agent.

**Routed Runtime**:
A Pibo runtime reached through the session router instead of by talking to Pi Coding Agent directly.

**Profile**:
A named selection of tools, subagents, skills, context files, and runtime options exposed to an agent session.

**Agent Designer**:
The Chat Web App area used to inspect plugin profiles and create, edit, archive, restore, or delete custom agents.

**Custom Agent**:
A user-managed editable agent definition persisted by Chat Web and registered as a profile for routed sessions.

**Dynamic Profile**:
A profile registered from product state, such as a saved custom agent, rather than from static plugin code.

**Native Tool**:
A Pibo plugin-registered tool that can be selected by profiles and exposed directly to the runtime.

**Provider-Backed Native Tool**:
A native tool whose stable Pibo tool name is selected by a profile, while the runtime exposes the capability through a model provider extension instead of a local Pi function tool definition.

**Web Search Provider Adapter**:
The product-level adapter that maps Pibo's stable `web_search` native tool to a concrete provider implementation, such as OpenAI Responses hosted web search.

**Built-In Pi Tool**:
A Pi Coding Agent engine tool, such as `read`, `bash`, `edit`, or `write`, that can be exposed through a profile without being registered as a Pibo native tool.

**Skill**:
A profile-selected instruction package loaded into runtime context from a `SKILL.md` file.

**Capability Catalog**:
The product-facing catalog of registered native tools, skills, subagents, context files, capability packages, MCP servers, and curated CLI tool hints.

**Capability Package**:
A named profile option that enables a group of generated capabilities, such as the `pibo-run-control` tools.

**Pi Package**:
A Pi Coding Agent package that can provide Pi-managed extensions, skills, prompt templates, or themes through npm, git, a `pi.dev/packages` listing, or a local path.

**Pibo Pi Package**:
A Pi Package registered in Pibo's local package store with source, install spec, metadata, discovered resources, install status, and diagnostics.

**Pi Package Selection**:
The per-profile list of registered Pibo Pi Packages that Pibo asks Pi Coding Agent to load for a runtime.

**Context File**:
A profile-selected markdown resource loaded into runtime context alongside project instructions and skills.

**Agents Context File**:
A repo-level `AGENTS.md` context file that is loaded into the agent context at startup, usually from the repository root.

**Managed Context File**:
An editable Pibo-managed context file stored with metadata and revisions by the Context Files system.

**Plugin Context File**:
A read-only context file shipped by a plugin and registered in the capability catalog.

**Pibo Base Prompt**:
The Pibo-managed base system prompt template, using either the library prompt or a persisted custom prompt.

**Pibo Compaction Prompt**:
The Pibo-managed prompt set used for Pi session compaction summaries, using either the library prompt or a persisted custom prompt.

**Plugin**:
A statically loaded internal module that registers Pibo capabilities with the plugin registry.

**Plugin Registry**:
The catalog where plugins register tools, subagents, skills, context files, profiles, gateway actions, event listeners, channels, auth services, and web apps.

**Channel**:
A plugin-managed adapter that maps an external transport into Pibo input events and maps Pibo output events back to that transport.

**Transport**:
The external communication mechanism used by a channel, such as local TCP, same-origin HTTP, or an in-process TUI adapter.

**Session Router**:
The Pibo component that owns routed sessions, queues input by Pibo Session ID, and emits normalized output events.

**Routed Session**:
A single Pibo conversation managed by the session router.

**Pibo Session**:
The stable product-level session record managed by Pibo. It carries route identity, channel, kind, profile, legacy controller compatibility metadata when needed, hierarchy, derivation metadata, and the linked Pi Session ID.

**Pibo Session ID**:
The opaque `PiboSession.id` value used by channels, APIs, UI, routing, access control, and event correlation.

**Pibo Session Store**:
The Pibo-managed store for Pibo Session records, backed by `.pibo/pibo-sessions.sqlite` in the gateway path or by memory in local adapters.

**Pi Session ID**:
The technical Pi Coding Agent session identifier stored as `PiboSession.piSessionId`, used for Pi persistence, transcript files, provider cache affinity, fork, clone, switch, tree navigation, and compaction.

**App Context Context**:
The single product data context for a Pibo host after login. Auth decides whether a person may enter the app; it does not create a separate product space.

**Controller Scope**:
A removed historical storage concept from the previous account-partitioned model. Current product behavior has one app space after login and must not use historical partition values for visibility, routing, workspace selection, profile registration, job control, read-state, or write location. Remaining references belong only to reviewed historical documentation or explicit final cutover migration evidence.

**Parent Session**:
A true hierarchical child relationship represented by `PiboSession.parentId`, used for subagents and nested agent work.

**Origin Session**:
A derivation relationship represented by `PiboSession.originId`, used for forks and clones without implying UI nesting.

**Input Event**:
A normalized event sent into Pibo, either as user message input or as a wrapper-level execution request.

**Message Event**:
An input event that carries user-facing conversation text into the routed runtime.

**Execution Event**:
An input event that asks Pibo to perform a wrapper-level action such as status, abort, queue clear, dispose, or Pi session control.

**Output Event**:
A normalized event emitted by the router, such as assistant text, thinking, tool status, errors, or execution results.

**Gateway**:
The local transport boundary that accepts newline-delimited JSON frames over TCP, routes messages by Pibo Session ID, and broadcasts session events.

**Gateway Action**:
A discoverable execution action exposed through the gateway for channel UIs or clients.

**Remote Agent Channel**:
The built-in local channel that lets a controller attach to a Pibo session without speaking directly to Pi Coding Agent.

**Local Routed TUI**:
An optional terminal adapter that routes local TUI input through Pibo's session router without starting the gateway daemon.

**Subagent**:
A profile-scoped capability exposed to Pi as a generated tool that calls another registered profile through a routed child session.

**Yielded Run**:
A long-running tool invocation started through run-control tools so the agent can continue work and inspect the result later.

**Run Registry**:
The in-memory Pibo component that tracks yielded run ids, controllers, status, policy, summaries, results, cancellation, and cleanup.

**runId**:
The stable identifier for one yielded run.

**Completion Policy**:
The yielded-run policy that controls reminder behavior, currently `tracked` or `detached`.

**Tracked Run**:
The default yielded run type that reminds the owning agent until the result is read, cancelled, or acknowledged.

**Detached Run**:
A fire-and-forget yielded run that remains inspectable but does not create automatic reminders.

**Run-Control Tool**:
An agent-facing tool for managing yielded runs, such as `pibo_run_start`, `pibo_run_status`, or `pibo_run_read`.

**Yieldable Tool**:
A normal synchronous tool that can also be wrapped by `pibo_run_start`.

**Docker Image**:
A built container filesystem template, such as `pibo:latest`, reused by compute containers. Image reuse does not bound runtime state inside containers.

**Compute Container**:
A Docker container started by Pibo compute commands. It owns runtime processes, writable-layer state, exposed ports, and resource limits for a worker.

**Dev Worker**:
A long-lived compute container tied to a Git worktree and deterministic port block for isolated development and browser validation.

**Worktree**:
A Git checkout used by a dev worker. Worktree deletion is explicit and separate from browser or container cleanup.

**Browser Pool**:
A worker-scoped Pibo authority that starts, reuses, leases, health-checks, and reaps managed Chromium CDP browser processes.

**Browser Lease**:
A time-bounded claim on a browser pool's CDP browser for one automation task, Pibo Session, or Ralph run.

**Auth Profile Lease**:
An isolated browser-use profile slot cloned from a closed authenticated template profile. It is distinct from a browser process lease.

**Ralph Job**:
A durable continuous-work definition managed by Ralph, with a target, profile, prompt, stop policy, and run state.

**Ralph Run**:
One execution attempt for a Ralph Job, usually backed by a routed Pibo Session and resource cleanup state.

**MCP CLI**:
The `pibo mcp` operator CLI for configuring, discovering, and calling external MCP servers from the shell.

**MCP Server**:
An external stdio or HTTP Model Context Protocol server configured outside the Pibo plugin runtime.

**MCP Tool Context**:
The short model-visible description for a configured MCP server, edited through the Context area's MCP Tools view or `pibo mcp config describe` and injected only when a profile selects that server.

**MCP Registry**:
A curated list of optional MCP server presets that can be installed into the normal MCP config path.

**Curated CLI Tool**:
An optional external command-line tool managed by `pibo tools` instead of by the Pibo profile or MCP systems.

**Tool Guide**:
On-demand usage documentation printed by an operator CLI command instead of loaded into every agent profile.

**Progressive Discovery**:
The CLI design rule that each command level shows only the immediate command surface and points to the next useful command.

**Auth Service**:
A Pibo service boundary that validates identity for channels that require authentication.

**Same-Origin Web Host**:
The web gateway host that serves auth routes and registered web apps from one HTTP origin.

**Web App**:
A plugin-registered same-origin application served by the Pibo web host.

**Chat Web App**:
The current web app registered under `/apps/chat` and `/api/chat/*`.

**Canonical Chat URL**:
The browser URL that identifies the active Chat Web App area and, in the Sessions area, the selected Pibo Room and selected Pibo Session, such as `/apps/chat/rooms/<roomId>/sessions/<piboSessionId>`.

**Chat Web Deep Link**:
A URL under `/apps/chat/*` that can be opened directly or reloaded and restores the intended Chat Web App area and selection.

**Pibo Room**:
A user-facing Chat Web container that groups one or more Pibo Sessions for display, membership, room events, and room-scoped sending.

**Shared Default Chat Room**:
The default Pibo Room automatically created for the app context when Chat Web needs a room and none exists. Legacy storage may still mark older rows with personal/default metadata, but the room is not account-managed.

**Room Membership**:
A legacy Chat Web record that used to link a principal to a Pibo Room with a role and read cursor. Current app-context behavior does not use room membership for access control.

**Chat Event Log**:
The durable Pibo-managed event store for Chat Web room and session events, backed by `chat_events` in `.pibo/web-chat.sqlite`.

**Chat Event Cursor**:
The frame-specific SSE resume cursor formatted as `<streamId>:<frameIndex>`.

**Chat Web Read Model**:
The `.pibo/web-chat.sqlite` projection used by the Chat Web App for raw Pibo event storage and web-oriented session indexing.

**Raw Pibo Event Log**:
The ordered normalized `PiboOutputEvent` records stored by the Chat Web Read Model. It is a reconstruction and debugging input, not the canonical transcript.

**Chat Web Trace View**:
The read-time projection that combines Pi session JSONL, Pibo Sessions, Chat Web Read Model rows, and live Pibo events into nested trace nodes for the Chat Web App.

**Chat Session View**:
A Chat Web UI renderer for the selected Pibo Session, backed by the current Chat Web Trace View and session metadata.

**Trace Session View**:
The built-in Chat Session View that renders the full nested trace timeline.

**Compact Terminal Session View**:
The built-in Chat Session View that renders trace data as a compact terminal-style transcript.

**Trace Version**:
A server-issued freshness token for one Chat Web Trace View, exposed through ETag-style trace responses.

**Cache Invalidation Matrix**:
The Chat Web cache contract mapping each mutation or live event to the query classes that must be refreshed or patched.

**Chat Web SSE Stream**:
The same-origin server-sent event stream at `/api/chat/events` that sends compact chat stream frames to the Chat Web App.

**Chat Stream Event**:
An AG-UI-inspired live UI frame derived from a normalized `PiboOutputEvent`, such as `TEXT_MESSAGE_CONTENT`, `REASONING_MESSAGE_CONTENT`, `TOOL_CALL_RESULT`, or `AGENT_DELEGATION`.

**Retention Class**:
The Chat Event Log category that controls how long a stored chat event should be kept, such as `live_delta`, `trace_event`, `chat_message`, or `audit_event`.

**Reliable Event Core**:
The Pibo-managed local reliability layer for append-only product events, consumer offsets, durable jobs, yielded-run records, and operational replay.

**Pibo Reliability Store**:
The SQLite store at `.pibo/pibo-events.sqlite` used by the Reliable Event Core.

**pibo.output Topic**:
The reliability event stream topic that mirrors normalized Pibo output events for operational replay and debugging.

**Debug CLI**:
The `pibo debug` operator CLI for compact read-only diagnostics against Pibo-managed SQLite stores and Chat Web projections.

**Config CLI**:
The `pibo config` operator CLI for managing local runtime config in `.pibo/config.json`.

**Local Config**:
Machine-local Pibo configuration stored in `.pibo/config.json`.

**Tool Review**:
A Pibo-managed wrapper-level process that summarizes tool usage in a Pibo Session and asks an agent to evaluate tool or workflow quality.

## Relationships

- **Pibo** embeds **Pi Coding Agent** and owns the **Product Boundary**.
- A **Profile** selects tools, subagents, skills, context files, and runtime options for a **Runtime**.
- The **Agent Designer** creates **Custom Agents**; active **Custom Agents** become **Dynamic Profiles**.
- A **Profile** can select **Native Tools**, **Built-In Pi Tools**, **Skills**, subagents, **Context Files**, MCP servers, and **Capability Packages**.
- A **Plugin** registers capabilities in the **Plugin Registry**.
- The **Capability Catalog** is assembled from the **Plugin Registry** plus product-managed metadata for Chat Web inspection.
- A **Managed Context File** is an editable **Context File**; a **Plugin Context File** is a read-only source that can be copied into a managed file.
- The **Pibo Base Prompt** is applied before project context, selected **Context Files**, and skills are appended.
- A **Channel** translates a **Transport** into **Input Events** and translates **Output Events** back to that transport.
- The **Session Router** owns many **Routed Sessions**.
- A **Pibo Session** is the product session record used for routing, profile selection, stewardship, hierarchy, and plugin metadata.
- A **Pibo Session** links to one **Pi Session ID** for Pi Coding Agent persistence.
- The **Pibo Session Store** is the source of truth for Pibo Session metadata.
- A **Pibo Room** is a user-facing Chat Web container; it does not replace a **Pibo Session**.
- A **Pibo Session** belongs to a **Pibo Room** through `PiboSession.metadata.chatRoomId` in the current migration bridge.
- A **Canonical Chat URL** is the browser-visible route for a **Pibo Room** and **Pibo Session** selection; browser-local last-selection state is only an entry fallback.
- A **Shared Default Chat Room** is created automatically for the **App Context Context** when the Chat Web App bootstraps.
- The **Chat Web Read Model** is a projection and is not the source of truth for Pibo Sessions or Pi transcripts.
- The **Chat Event Log** is durable Chat Web room/session event storage, while the **Raw Pibo Event Log** remains a read-model/debugging projection of normalized output events.
- A **Chat Web Trace View** is reconstructed from Pi transcript data plus the **Raw Pibo Event Log**.
- **Chat Session Views** render the selected session from the current **Chat Web Trace View** and related session metadata.
- A **Trace Version** controls trace freshness; the **Cache Invalidation Matrix** controls which Chat Web caches are updated after mutations or live events.
- The **Chat Web SSE Stream** carries **Chat Stream Events** for live UI updates; durable frames resume with a **Chat Event Cursor**.
- A **Subagent** call creates or reuses a routed child **Pibo Session** with `parentId`.
- A **Yielded Run** is tracked in the **Run Registry** and identified by a **runId**.
- A **Run-Control Tool** manages a **Yielded Run**; a **Yieldable Tool** is the wrapped work.
- A **Docker Image** may be reused by many **Compute Containers**, but each container owns separate runtime state.
- A **Dev Worker** is a long-lived **Compute Container** tied to a **Worktree**; releasing the container does not delete the worktree.
- A **Browser Pool** grants **Browser Leases** for managed Chromium CDP use, while an **Auth Profile Lease** grants isolated authenticated profile state.
- A **Ralph Job** creates **Ralph Runs**; when runs use compute/browser resources, Ralph policy records stewardship and cleanup state.
- The **Reliable Event Core** uses the **Pibo Reliability Store** and mirrors normalized output events into the **pibo.output Topic**.
- The **MCP CLI** manages **MCP Servers** outside the Pibo plugin runtime.
- `pibo tools` manages **Curated CLI Tools** outside profiles and MCP.
- The **Debug CLI** inspects Pibo-managed stores and projections; it is not an agent-facing profile tool.
- The **Same-Origin Web Host** serves **Auth Service** routes and registered **Web Apps**.
- **Tool Review** runs at the **Product Boundary** and uses **Pibo Session IDs**, not **Pi Session IDs**, as its review target identity.
- The **Pibo VS Code Extension** is a thin WebView client that reuses the Chat Web **Composer** and **Chat Session View**; it does not own a separate data store.
- A **VS Code Session Room** is a **Pibo Room** whose `workspace` field equals the canonical path of a VS Code `WorkspaceFolder`; the extension resolves one per folder.
- The **Workspace Room Resolver** (`resolveRoomForWorkspace`) lists rooms by workspace and auto-creates a room when none match; multi-match results surface a **Room Picker** inside the WebView.
- The **Pibo VS Code Distribution Flow** ships the extension as a `.vsix` that lives on GitHub Releases and the VS Code Marketplace; `pibo vscode install` downloads the latest VSIX from the GitHub Release of the configured repo and runs `code --install-extension`. The **WebView Bundle** (`dist/apps/chat-vscode-web/`) ships inside the `@pasko70/pibo` npm package so the gateway can serve it same-origin at `/apps/chat-vscode/`.

## Ambiguities

- Use **Pibo** for the product harness and **Pi Coding Agent** for the embedded engine; do not call both "the agent runtime" without context.
- Use **Profile** for the runtime capability selection and **Custom Agent** for a user-managed editable profile definition. Do not call every profile an agent.
- Use **Pibo Session ID** for product routing identity and **Pi Session ID** for Pi's technical persistence/cache identity.
- Use **parentId** only for true hierarchy and UI nesting. Use **originId** for fork or clone derivation.
- Use **Pibo Room** for the user-facing chat container and **Pibo Session** for the runtime conversation. Do not call rooms "sessions".
- Use **Shared Default Chat Room** for the automatically created first room. Do not call it personal or partitioned in current docs; legacy personal/default metadata is migration context only.
- Use **Channel** for Pibo transport adapters and **Transport** for the underlying communication mechanism.
- Use **Plugin** for internal static extension modules and **MCP Server** for external Model Context Protocol processes.
- Use **Native Tool** for Pibo plugin tools selected in profiles, **Built-In Pi Tool** for Pi engine tools, **Curated CLI Tool** for `pibo tools` entries, and **MCP Server** for external MCP integrations.
- Use **Context File** for runtime context resources, **Managed Context File** for editable product-managed content, and **Plugin Context File** for read-only shipped content.
- Use **Pibo Base Prompt** for Pibo's base system prompt template. Use **Codex Base Prompt** only for Codex-compatibility context.
- Use **Chat Web Trace View** for the data projection and **Chat Session View** for the UI renderer that presents it.
- Use **Pibo Reliability Store**, **Pibo Session Store**, **Chat Event Log**, and **Chat Web Read Model** for their separate stores; do not collapse them into one "session database".
- Use **Gateway Action** for channel/client execution actions and **Run-Control Tool** for agent-facing yielded-run tools.
- Use **Local Routed TUI** for `npm run tui:routed` and direct **Pi TUI** for `npm run tui`.
