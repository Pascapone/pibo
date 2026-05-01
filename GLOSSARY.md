# Pibo Glossary

This glossary is the shared vocabulary for Pibo design, specs, docs, and implementation discussion.

## Terms

**Pibo**:
The thin TypeScript product harness around Pi Coding Agent.

**Pi Coding Agent**:
The embedded inner agent engine responsible for model turns, tools, streaming, sessions, and compaction.

**Product Boundary**:
The outer layer owned by Pibo, including profiles, plugins, channels, routing, auth, policy, Pibo Sessions, and transport adapters.

**Runtime**:
The executable agent environment created from a selected profile and backed by Pi Coding Agent.

**Routed Runtime**:
A Pibo runtime reached through the session router instead of by talking to Pi Coding Agent directly.

**Profile**:
A named selection of tools, subagents, skills, context files, and runtime options exposed to an agent session.

**Plugin**:
A statically loaded internal module that registers Pibo capabilities with the plugin registry.

**Plugin Registry**:
The catalog where plugins register tools, subagents, skills, context files, profiles, gateway actions, event listeners, channels, auth services, and web apps.

**Channel**:
A plugin-owned adapter that maps an external transport into Pibo input events and maps Pibo output events back to that transport.

**Transport**:
The external communication mechanism used by a channel, such as local TCP, same-origin HTTP, or an in-process TUI adapter.

**Session Router**:
The Pibo component that owns routed sessions, queues input by Pibo Session ID, and emits normalized output events.

**Routed Session**:
A single Pibo conversation managed by the session router.

**Pibo Session**:
The stable product-level session record owned by Pibo. It carries route identity, channel, kind, profile, owner scope, hierarchy, derivation metadata, and the linked Pi Session ID.

**Pibo Session ID**:
The opaque `PiboSession.id` value used by channels, APIs, UI, routing, access control, and event correlation.

**Pibo Session Store**:
The Pibo-owned store for Pibo Session records, backed by `.pibo/pibo-sessions.sqlite` in the gateway path or by memory in local adapters.

**Pi Session ID**:
The technical Pi Coding Agent session identifier stored as `PiboSession.piSessionId`, used for Pi persistence, transcript files, provider cache affinity, fork, clone, switch, tree navigation, and compaction.

**Owner Scope**:
The product-level ownership string used for access control and listing, such as `user:<auth-user-id>`.

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
The in-memory Pibo component that tracks yielded run ids, owners, status, policy, summaries, results, cancellation, and cleanup.

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

**MCP CLI**:
The `pibo mcp` operator CLI for configuring, discovering, and calling external MCP servers from the shell.

**MCP Server**:
An external stdio or HTTP Model Context Protocol server configured outside the Pibo plugin runtime.

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

**Personal Chat Room**:
The default Pibo Room automatically created for an owner scope when that user first opens the Chat Web App.

**Room Membership**:
The Chat Web access record that links a principal to a Pibo Room with a role and read cursor.

**Chat Event Log**:
The durable Pibo-owned event store for Chat Web room and session events, backed by `chat_events` in `.pibo/web-chat.sqlite`.

**Chat Event Cursor**:
The frame-specific SSE resume cursor formatted as `<streamId>:<frameIndex>`.

**Chat Web Read Model**:
The `.pibo/web-chat.sqlite` projection used by the Chat Web App for raw Pibo event storage and web-oriented session indexing.

**Raw Pibo Event Log**:
The ordered normalized `PiboOutputEvent` records stored by the Chat Web Read Model. It is a reconstruction and debugging input, not the canonical transcript.

**Chat Web Trace View**:
The read-time projection that combines Pi session JSONL, Pibo Sessions, Chat Web Read Model rows, and live Pibo events into nested trace nodes for the Chat Web App.

**Chat Web SSE Stream**:
The same-origin server-sent event stream at `/api/chat/events` that sends compact chat stream frames to the Chat Web App.

**Chat Stream Event**:
An AG-UI-inspired live UI frame derived from a normalized `PiboOutputEvent`, such as `TEXT_MESSAGE_CONTENT`, `REASONING_MESSAGE_CONTENT`, `TOOL_CALL_RESULT`, or `AGENT_DELEGATION`.

**Retention Class**:
The Chat Event Log category that controls how long a stored chat event should be kept, such as `live_delta`, `trace_event`, `chat_message`, or `audit_event`.

**Config CLI**:
The `pibo config` operator CLI for managing local runtime config in `.pibo/config.json`.

**Local Config**:
Machine-local Pibo configuration stored in `.pibo/config.json`.

## Relationships

- **Pibo** embeds **Pi Coding Agent** and owns the **Product Boundary**.
- A **Profile** selects tools, subagents, skills, context files, and runtime options for a **Runtime**.
- A **Plugin** registers capabilities in the **Plugin Registry**.
- A **Channel** translates a **Transport** into **Input Events** and translates **Output Events** back to that transport.
- The **Session Router** owns many **Routed Sessions**.
- A **Pibo Session** is the product session record used for routing, profile selection, ownership, hierarchy, and plugin metadata.
- A **Pibo Session** links to one **Pi Session ID** for Pi Coding Agent persistence.
- The **Pibo Session Store** is the source of truth for Pibo Session metadata.
- A **Pibo Room** is a user-facing Chat Web container; it does not replace a **Pibo Session**.
- A **Pibo Session** belongs to a **Pibo Room** through `PiboSession.metadata.chatRoomId` in the current migration bridge.
- A **Canonical Chat URL** is the browser-visible route for a **Pibo Room** and **Pibo Session** selection; browser-local last-selection state is only an entry fallback.
- A **Personal Chat Room** is created automatically for a new **Owner Scope** when the Chat Web App bootstraps.
- The **Chat Web Read Model** is a projection and is not the source of truth for Pibo Sessions or Pi transcripts.
- The **Chat Event Log** is durable Chat Web room/session event storage, while the **Raw Pibo Event Log** remains a read-model/debugging projection of normalized output events.
- A **Chat Web Trace View** is reconstructed from Pi transcript data plus the **Raw Pibo Event Log**.
- The **Chat Web SSE Stream** carries **Chat Stream Events** for live UI updates; durable frames resume with a **Chat Event Cursor**.
- A **Subagent** call creates or reuses a routed child **Pibo Session** with `parentId`.
- A **Yielded Run** is tracked in the **Run Registry** and identified by a **runId**.
- A **Run-Control Tool** manages a **Yielded Run**; a **Yieldable Tool** is the wrapped work.
- The **MCP CLI** manages **MCP Servers** outside the Pibo plugin runtime.
- `pibo tools` manages **Curated CLI Tools** outside profiles and MCP.
- The **Same-Origin Web Host** serves **Auth Service** routes and registered **Web Apps**.

## Ambiguities

- Use **Pibo** for the product harness and **Pi Coding Agent** for the embedded engine; do not call both "the agent runtime" without context.
- Use **Pibo Session ID** for product routing identity and **Pi Session ID** for Pi's technical persistence/cache identity.
- Use **parentId** only for true hierarchy and UI nesting. Use **originId** for fork or clone derivation.
- Use **Pibo Room** for the user-facing chat container and **Pibo Session** for the runtime conversation. Do not call rooms "sessions".
- Use **Personal Chat Room** for the automatically created first room. Do not call it a "global default room"; it is scoped to one owner.
- Use **Channel** for Pibo transport adapters and **Transport** for the underlying communication mechanism.
- Use **Plugin** for internal static extension modules and **MCP Server** for external Model Context Protocol processes.
- Use **Curated CLI Tool** for `pibo tools` entries and **Tool** for capabilities exposed to agents in profiles.
- Use **Gateway Action** for channel/client execution actions and **Run-Control Tool** for agent-facing yielded-run tools.
- Use **Local Routed TUI** for `npm run tui:routed` and direct **Pi TUI** for `npm run tui`.
