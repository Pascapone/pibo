---
title: Pibo Web Chat Trace UI
version: 0.1
date_created: 2026-04-28
last_updated: 2026-05-02
owner: Pibo
tags: [design, web, chat, tracing, sessions, subagents]
---

# Introduction

This specification defines the next-generation Pibo Chat Web App. The app must expose Pibo's routed runtime features through a first-class web interface: sessions, subagent sessions, tool calls, yielded runs, execution commands, thinking output, errors, fork/clone controls, and future agent templates.

The Web App must use the nested trace-card interaction model from `<HOME>/code/pydantic-tracing` as its primary execution rendering pattern. Pibo must adapt that model to its own session router, output events, and product boundaries.

All Web Chat UI elements that are not directly copied from the tracing UI, including sidebars, top bars, tabs, settings screens, agent inventory screens, buttons, modals, command menus, empty states, inputs, and inspectors, must follow `DESIGN.md`.

## 1. Purpose & Scope

The purpose of this specification is to define V1 requirements for rebuilding the current minimal Chat Web App into a React/TanStack Start/Tailwind application with nested session and trace rendering.

In scope for V1:

- React/TanStack Start/Tailwind Web App shell.
- Personal authenticated sessions only.
- Dedicated SQLite read model for Web Chat session indexing and raw Pibo event storage.
- Main session and subagent session navigation.
- Inline nested trace rendering inside the selected session transcript.
- Tool call, tool result, thinking, assistant, user, execution command, yielded run, subagent delegation, and error rendering.
- Slash command discovery and execution behavior similar to the Local Routed TUI, with Web Chat-specific `/clone`.
- Clone and fork support, excluding full tree editing.
- Preparatory app areas for `Sessions`, `Agents`, and `Settings`.

Out of scope for V1:

- Team or multi-user session sharing.
- Full session tree editor UI.
- Cron/job management.
- Full custom agent profile builder implementation.
- Export/import of custom agent templates.
- Treating the pydantic-tracing project as a runtime dependency.

## 2. Definitions

- **Pibo**: The TypeScript product harness around Pi Coding Agent.
- **Pi Coding Agent**: The embedded engine that owns model turns, tools, streaming, sessions, and compaction.
- **Chat Web App**: The same-origin authenticated Pibo web application served under `/apps/chat`.
- **Pibo Room**: A user-facing Chat Web container that groups one or more Pibo Sessions for display, membership, room events, and room-scoped sending.
- **Main Session**: A user-visible routed Pibo session that is not a subagent child session.
- **Subagent Session**: A routed Pibo session created by a generated `pibo_subagent_<name>` tool call.
- **Selected Pibo Room**: The Pibo Room currently active in the Chat Web App.
- **Selected Pibo Session**: The Pibo Session currently active for transcript rendering and composer routing.
- **Canonical Chat URL**: The browser URL that identifies the active Chat Web App area and, for the `Sessions` area, the selected Pibo Room and/or selected Pibo Session.
- **Deep Link**: A Chat Web App URL under `/apps/chat/*` that can be opened directly or reloaded and reconstructs the intended app area and selection.
- **Delegation**: A trace node representing a subagent call from one session to another session.
- **Async Agent**: A trace node representing a subagent call started indirectly through a yielded run, usually by `pibo_run_start`.
- **Trace Node**: A UI node representing a structured unit of agent work.
- **Trace Order Key**: Explicit ordering metadata attached to a trace node. Transcript-backed nodes use Pi transcript order, stored event nodes use the Chat Web read-model event sequence, and live nodes use the SSE stream cursor and frame index.
- **Live Segment Identity**: The stable identity used while a visible assistant or thinking segment is streaming. Visible assistant segments use `assistantIndex` when present. Thinking segments use `thinkingIndex` when present. Both fall back to provider `contentIndex` only for older events.
- **Read Model**: Pibo-owned SQLite data optimized for web rendering and navigation. It is derived from Pibo events, Pibo Sessions, and Pi session files.
- **Source of Truth**: The canonical owner of state. Pi session JSONL files remain the source of truth for persisted agent transcript content.
- **Execution Command**: A Pibo wrapper action such as `status`, `abort`, `clear_queue`, `session.clone`, `session.fork`, or `thinking`.
- **Slash Command**: A command entered through the chat composer command menu, modeled after the Local Routed TUI command behavior.
- **Composer**: The bottom chat input area containing the user message textarea, slash command menu, and send control.
- **Trace Expansion Depth**: A UI-only integer depth rule for expanding trace nodes. Depth `0` collapses all nodes, depth `1` expands only top-level trace nodes, and the special all state expands every node.
- **Agent Template**: A future persisted user-defined agent profile selection containing tools, skills, subagents, and runtime options.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: The current plain HTML Chat Web App must be replaced by a React application.
- **REQ-002**: The frontend stack must use React, Tailwind, and TanStack Start.
- **REQ-002A**: TanStack Start must be implemented as its own Chat Web App project structure. It must not own or bypass the Pibo product harness boundaries for auth, session routing, gateway actions, or agent execution.
- **REQ-003**: The Web App must provide top-level areas for `Sessions`, `Agents`, and `Settings`.
- **REQ-004**: V1 must implement the `Sessions` area as the primary functional area.
- **REQ-005**: The `Agents` and `Settings` areas must be represented in the app shell as non-functional or lightly mocked V1 areas.
- **REQ-006**: The `Sessions` area must have a left sidebar containing main sessions.
- **REQ-007**: Main sessions in the sidebar must be expandable to show subagent sessions.
- **REQ-008**: Subagent sessions must support arbitrary nesting up to the maximum depth allowed by Pibo subagent configuration.
- **REQ-009**: The selected session, whether main or subagent, must render as the active main view.
- **REQ-010**: When a main session is selected, inline expanded subagent traces are inspectable but composer input still routes to the selected main session.
- **REQ-011**: When a subagent session is selected directly from the sidebar or a delegation link, composer input routes to that selected subagent session.
- **REQ-012**: Delegation trace nodes must include a direct navigation control to switch into the linked subagent session.
- **REQ-013**: The main view must render user messages, assistant messages, thinking blocks, tool calls, tool results, execution commands, yielded runs, delegations, and errors as visually distinct nodes.
- **REQ-014**: The trace-card UI must closely preserve the visual language of `<HOME>/code/pydantic-tracing`: nested cards, borders, colors, spacing, typography, expand/collapse behavior, status coloring, and JSON rendering patterns.
- **REQ-015**: Pibo must copy/adapt the tracing UI source into its own project. Pibo must not depend on the pydantic-tracing project at runtime.
- **REQ-016**: All UI elements that are not copied directly from the tracing UI must follow `DESIGN.md`.
- **REQ-017**: Any modifications or additions to copied tracing UI components must preserve the visual system defined in `DESIGN.md`.
- **REQ-018**: The session sidebar, global top bar, app-area tabs, command menu, fork modal, buttons, inputs, settings mock, agents mock, empty states, raw-event inspector, and any new Pibo-specific UI controls must use the colors, typography, spacing, borders, density, and operational tone defined in `DESIGN.md`.
- **REQ-019**: Tool calls must render as structured cards, not raw JSON text.
- **REQ-020**: Tool arguments and results must use a JSON renderer with readable fallback for plain text.
- **REQ-021**: Subagent calls must render as `agent.delegation` trace nodes and link to the child session.
- **REQ-022**: Yielded runs must include metadata showing whether work is tracked or detached when that metadata is available.
- **REQ-023**: Execution commands and their results must render inline in the transcript.
- **REQ-024**: Error messages must render inline as clear error cards or banners.
- **REQ-025**: The chat composer must support a slash command menu that opens when the user types `/`.
- **REQ-026**: The slash command menu must support keyboard navigation with up/down and selection with Enter.
- **REQ-026A**: The slash command menu must keep the active keyboard-selected command scrolled into view.
- **REQ-026B**: The slash command menu must stay visually anchored above the composer as the composer height changes.
- **REQ-027**: Slash command availability must be derived from gateway/channel capabilities, not hardcoded only in the frontend.
- **REQ-028**: Slash commands must dispatch to the same Pibo execution semantics as the local routed TUI when applicable.
- **REQ-029**: V1 slash commands must include the Local Routed TUI routed commands `/status`, `/clear`, `/abort`, `/thinking`, `/session-current`, `/sessions`, and `/fork-candidates`; browser-local `/thinking-show`; and Web Chat V1-specific `/clone`.
- **REQ-030**: `session.clone` must be available in V1 only through the slash command flow, not as a persistent visible toolbar button.
- **REQ-031**: Running `/clone` must create a new copied Pi session and return a clone result that the Web App can select.
- **REQ-032**: Fork must be available from user message trace nodes via a small per-message UI control.
- **REQ-033**: Fork must use the selected user message entry as the fork point and then return a fork result that the Web App can select.
- **REQ-034**: After a successful fork, the Web App must show a small confirmation modal asking whether to switch to the forked session.
- **REQ-035**: If the user confirms the fork switch modal, the Web App must select the forked session and reload that session's transcript and reconstructed traces.
- **REQ-036**: If the user declines the fork switch modal, the selected session and visible transcript must remain unchanged.
- **REQ-037**: Full session tree browsing and tree navigation UI are deferred from V1.
- **REQ-038**: The Web App must use a separate SQLite database for web read-model state, distinct from `.pibo/pibo-sessions.sqlite`.
- **REQ-039**: The dedicated web database must be `.pibo/web-chat.sqlite` and must not replace Pi JSONL session files.
- **REQ-040**: Pi JSONL files remain canonical for persisted transcript messages, thinking content, tool calls, tool results, session tree entries, compaction, fork, and clone data.
- **REQ-041**: The web read model must store product/session index data and raw Pibo events needed for reload and trace reconstruction.
- **REQ-042**: The web read model must not become a competing canonical transcript store.
- **REQ-043**: Raw Pibo events in `.pibo/web-chat.sqlite` must be retained for as long as their associated Pi session exists, unless an explicit future session deletion feature removes them.
- **REQ-044**: V1 must target personal sessions only.
- **REQ-045**: V1 must not introduce team sharing behavior.
- **REQ-046**: Trace nodes must use trace expansion depth `1` by default so top-level user and assistant messages are readable immediately while nested child spans remain collapsed until inspected.
- **REQ-047**: The UI must provide accessible compact controls for default expansion, collapse all, expand all, and expand trace nodes up to a selected nesting level. Controls may be icon-only when they include accessible labels and hover titles.
- **REQ-048**: Trace node expanded/collapsed UI state must be stored in the browser only, for example in component state or local storage.
- **REQ-049**: Thinking display must be hidden by default.
- **REQ-050**: When thinking display is enabled through `/thinking-show` or an equivalent UI toggle, historical thinking blocks in the currently visible reconstructed transcript must become visible.
- **REQ-051**: `/thinking-show` must affect only browser display state and must not change model thinking effort.
- **REQ-052**: V1 must not create durable agent template/profile tables. The `Agents` area may use mock data only.
- **REQ-053**: The `Agents` area should display real profile inventory from the plugin registry when practical, but must not create, update, or persist agent templates in V1.
- **REQ-054**: Assistant visible text deltas must update a live `assistant.message` trace node before the final `assistant_message` event is available.
- **REQ-055**: Thinking deltas must update a live `model.reasoning` trace node when thinking display is enabled. `thinking_finished` closes only the reasoning node and must not imply that the full agent turn is finished.
- **REQ-056**: Trace reconstruction must keep live transcript echo events for a running turn when the retained raw event window contains `assistant_delta`, `assistant_message`, `thinking_started`, `thinking_delta`, or `thinking_finished` for the same `eventId`, even if `message_started` is no longer present in the retained window.
- **REQ-057**: The Raw Events inspector must be hidden by default and exposed through an explicit debug control.
- **REQ-058**: The Raw Events inspector must compact adjacent `assistant_delta` and `thinking_delta` events with the same `piboSessionId`, `eventId`, and live segment identity for readability.
- **REQ-059**: Sidebar sessions must support manual rename and archive/unarchive operations.
- **REQ-060**: Archived sessions must be hidden by default and retrievable through an explicit archived-session display control.
- **REQ-061**: The chat composer textarea must default to one visible line.
- **REQ-062**: The chat composer textarea must auto-grow as the user adds new lines until five visible lines are reached.
- **REQ-063**: After five visible lines, the chat composer textarea must keep a stable height and use an internal vertical scrollbar for additional content.
- **REQ-064**: The chat composer textarea must keep cursor position stable during ordinary typing and must not move the cursor to the end unless an explicit focus action, such as fork text insertion, requests that behavior.
- **REQ-065**: The chat composer resize calculation must use the same rendered font size, line height, padding, and border metrics as the textarea so the cursor baseline and bottom padding do not shift when the internal scrollbar appears.
- **REQ-066**: The send control must be a compact icon button, stay one-line high, and align to the bottom of the composer textarea instead of growing with the textarea.
- **REQ-067**: The Web App MUST treat the browser URL as the primary source of truth for top-level area, selected Pibo Room, and selected Pibo Session.
- **REQ-068**: The Web App MUST expose stable URLs for `/apps/chat`, `/apps/chat/rooms/:roomId`, `/apps/chat/sessions/:piboSessionId`, `/apps/chat/rooms/:roomId/sessions/:piboSessionId`, `/apps/chat/agents`, and `/apps/chat/settings`.
- **REQ-069**: When the user opens `/apps/chat` without an explicit room or session, the Web App MAY use `localStorage` as a fallback to request the user's last valid selection, but it MUST canonicalize the browser URL to the resolved room/session selection after bootstrap.
- **REQ-069A**: When the user navigates to a room or session deep link, the Web App MUST request bootstrap data for the URL-selected room and/or session before considering browser-local fallback state.
- **REQ-070**: If a stored room or room-session selection is unavailable, unauthorized, archived outside the current filter, or no longer present, the Web App must discard only the invalid stored selection and fall back to a valid server-selected room or session.
- **REQ-071**: When no selected Pibo Session is available during a room switch or bootstrap refresh, the composer must be disabled and must not send messages to the previously selected session.
- **REQ-071A**: The Web App MUST display the `Personal Chat` room separately above user-created rooms and visually communicate that it is locked.
- **REQ-071B**: The Web App MUST NOT expose rename, archive, or delete controls for the `Personal Chat` room.
- **REQ-071C**: User-created rooms MUST support archive and restore controls. Archived rooms MUST be hidden from the active room list by default and retrievable through an explicit archived-room display control.
- **REQ-071D**: Selecting an archived room MUST keep its sessions visible when the backend returns them and MUST disable new-session creation, composer sending, slash-command execution, and fork actions for that room.
- **REQ-071E**: Room deletion UI MUST be available only for archived non-personal rooms, display a destructive warning, require typing the exact room name, and call the permanent delete API only after confirmation matches.
- **REQ-072**: Assistant messages must render safe Markdown, including GitHub-Flavored Markdown tables, lists, blockquotes, code blocks, links, and inline code.
- **REQ-073**: Markdown rendering must skip raw HTML and must restrict link targets to safe URL forms such as relative links, anchors, `http:`, `https:`, and `mailto:`.
- **REQ-074**: Direct generated subagent calls must render visible `agent.delegation` trace nodes linked to the child Pibo Session.
- **REQ-075**: Subagent calls started through `pibo_run_start` must preserve both the yielded-run context and a visible async agent or delegation child node that identifies the wrapped `pibo_subagent_*` tool.
- **REQ-076**: Async subagent trace nodes must expose the started-by tool, wrapped subagent tool name, subagent name, run id when available, completion policy when available, delegated arguments, thread key when available, status, and linked child Pibo Session when known.
- **REQ-077**: Service run notifications wrapped in `<pibo_run_notification>` must render as `yielded.run` trace nodes instead of ordinary user messages.
- **REQ-078**: The transcript must scroll to the latest content when a new trace is selected or loaded.
- **REQ-079**: During live streaming, the transcript must remain bottom-locked only while the user is already at or near the bottom.
- **REQ-080**: If the user scrolls upward, live streaming must not force the transcript back to the bottom.
- **REQ-081**: When the user is away from the bottom, the UI must show a compact scroll-to-bottom affordance.
- **REQ-082**: The scroll-to-bottom affordance must hide after the user returns to the bottom or activates the affordance.
- **REQ-083**: Async subagent trace nodes created from `pibo_run_start` MUST reconcile their displayed terminal status from later run-control snapshots such as `pibo_run_wait` or `pibo_run_read`.
- **REQ-084**: A final visible assistant text entry after intermediate assistant text and tool calls MUST remain a separate `assistant.message` node in canonical transcript order.
- **REQ-085**: Chat Web live updates MUST refresh trace/bootstrap state after `TEXT_MESSAGE_END` in addition to run finish and run error lifecycle frames, so final persisted transcript state can replace stale live execution state.
- **REQ-086**: Chat Web live assistant message identity MUST prefer `assistantIndex` over provider `contentIndex` so separate assistant text segments remain separate when a provider reuses `contentIndex` in one turn.
- **REQ-087**: Chat Web live reasoning identity MUST prefer `thinkingIndex` over provider `contentIndex` so separate thinking segments remain separate when a provider reuses `contentIndex` in one turn.
- **REQ-088**: Trace sorting MUST use explicit trace order metadata from Pi transcript order, Chat Web read-model event sequence, or SSE stream cursor/frame order instead of wall-clock timestamps as the primary ordering source.
- **REQ-089**: Trace reconstruction MUST NOT use the bounded Raw Events inspector window as its projection input. While a turn is running, the trace endpoint MUST retain all stored events needed to reconstruct the open turn so older live reasoning, assistant, and tool nodes do not disappear and reappear during refresh.
- **CON-001**: Pibo must not move channel, auth, profile, or UI policy into Pi Coding Agent.
- **CON-002**: Pibo must preserve the existing product boundary: Pi owns agent execution and session JSONL; Pibo owns channels, routing, auth, policy, web UI, and read models.
- **CON-003**: The Web App must consume Pibo view models derived from Pi JSONL and Pibo events, not raw Pi events directly.
- **CON-004**: SQLite single-writer constraints must be considered. The Web App read model uses a separate database to reduce coupling with the Pibo Session store.
- **CON-005**: V1 must not persist materialized trace nodes as durable state. Trace nodes are a reconstructable projection.
- **CON-006**: TanStack Start server-side features must not become the authority for Pibo auth, session routing, profile resolution, or agent execution. Those responsibilities remain in the Pibo web host, channel, router, and plugin/runtime layers.
- **GUD-001**: The left sidebar may be dynamic by app area. In the `Sessions` area, it shows sessions. In future areas, it may show agents or settings navigation.
- **GUD-002**: The app shell should make future areas easy to add without overbuilding V1.
- **GUD-003**: UI additions for Pibo-specific metadata should be minimal and should preserve the tracing UI's visual rhythm.
- **GUD-004**: The default visual mode should be dark-first and operational, matching the Pibo Trace Terminal design language in `DESIGN.md`.

## 4. Interfaces & Data Contracts

### 4.1 Pibo Web Session Node

```ts
type PiboWebSessionStatus = "idle" | "running" | "error";

type PiboWebSessionNode = {
  piboSessionId: string;
  piSessionId: string;
  parentId?: string;
  profile: string;
  title: string;
  subtitle?: string;
  archived?: boolean;
  status: PiboWebSessionStatus;
  lastActivityAt?: string;
  children: PiboWebSessionNode[];
};
```

Session title selection order:

1. Use the manually stored Pibo Session title when present.
2. Otherwise use `session_info.name` from the Pi session file when present.
3. Otherwise use the first user message from the Pi session, truncated for sidebar display.
4. Otherwise use the Pibo Session ID.

The sidebar must also expose the Pibo Session ID as secondary text or tooltip so technical identity remains visible even when a friendly title exists.

### 4.2 Pibo Trace Node

```ts
type PiboTraceNodeType =
  | "user.message"
  | "assistant.message"
  | "agent.turn"
  | "model.reasoning"
  | "tool.call"
  | "tool.result"
  | "agent.delegation"
  | "agent.async"
  | "execution.command"
  | "yielded.run"
  | "error";

type PiboTraceNodeStatus = "running" | "done" | "error";

type PiboTraceSource = "transcript" | "event-log" | "live";

type PiboTraceOrderKey = {
  sourceRank: number;
  turnSeq: number;
  transcriptIndex?: number;
  contentPartIndex?: number;
  eventSequence?: number;
  streamId?: number;
  streamFrameIndex?: number;
  phaseRank: number;
};

type PiboTraceNode = {
  id: string;
  parentId?: string;
  entryId?: string;
  piboSessionId: string;
  eventId?: string;
  toolCallId?: string;
  runId?: string;
  type: PiboTraceNodeType;
  title: string;
  status: PiboTraceNodeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  linkedPiboSessionId?: string;
  source?: PiboTraceSource;
  stableKey?: string;
  orderKey?: PiboTraceOrderKey;
  children: PiboTraceNode[];
};

type ChatWebStoredEvent = {
  id: string;
  piboSessionId: string;
  eventSequence?: number;
  eventId?: string;
  type: string;
  createdAt: string;
  payload: unknown;
};

type PiboSessionTraceView = {
  piboSessionId: string;
  piSessionId: string;
  title: string;
  version: string;
  latestStreamId?: number;
  nodes: PiboTraceNode[];
  rawEvents: ChatWebStoredEvent[];
};
```

### 4.3 Event Mapping

| Pibo event | UI trace node |
| --- | --- |
| `message_queued` | `user.message` |
| `message_started` | `agent.turn` start |
| `thinking_started` / `thinking_delta` / `thinking_finished` | `model.reasoning` |
| `assistant_delta` / `assistant_message` | `assistant.message` |
| `tool_call` | `tool.call` |
| `tool_execution_started` | Mark tool node running |
| `tool_execution_updated` | Append/update tool partial output |
| `tool_execution_finished` | Finish tool node and render result or error |
| `execution_result` | `execution.command` |
| `session_error` | `error` |
| `subagent_session` router output event | `agent.delegation` linked to child session |
| Direct `pibo_subagent_*` tool call | `agent.delegation` linked to child session when the link is known |
| `pibo_run_start` wrapping a `pibo_subagent_*` tool | `tool.call` or `yielded.run` parent with an `agent.async` child that preserves the wrapped subagent identity |
| run notification/tool result for `pibo_run_*` | `yielded.run` where detectable |
| Chat Stream Event `AGENT_DELEGATION` | `agent.delegation`, or `agent.async` child when the referenced tool call is an existing `pibo_run_start` node |

Trace reconstruction must treat empty or whitespace-only reasoning text as transport/provider noise. Persisted Pi `thinking` parts and live `thinking_finished` events only produce `model.reasoning` nodes when they contain visible text after trimming.

Trace reconstruction must distinguish persisted transcript content from live transcript echo events. When Pi JSONL already contains persisted messages, live transcript echo events are normally filtered to avoid duplicate user and assistant nodes. The exception is a currently running turn: any retained live delta or thinking event for the turn's `eventId` is sufficient evidence that the event is still open, even if `message_started` has fallen outside the retained raw event window.

Live trace updates must assign stable keys by segment, not only by turn. `assistant.message` live nodes use `assistantIndex` when available and fall back to `contentIndex`; `model.reasoning` live nodes use `thinkingIndex` when available and fall back to `contentIndex`. This prevents a later final assistant answer from merging into an earlier progress answer when the provider reuses a content index.

Trace sorting must use `orderKey` metadata. Transcript-backed nodes use Pi JSONL entry and content-part order, event-log nodes use the read model's per-session event sequence, and live nodes use the SSE cursor's stream id and frame index.

Trace reconstruction must reconcile yielded-run snapshots by `runId`. If an `agent.async` node was created from an initial `pibo_run_start` result with status `running`, and a later run-control result reports `completed`, `cancelled`, or `failed` for the same `runId`, the `agent.async` node must reflect the terminal status and terminal timestamp.

### 4.4 Web Read Model Storage

The implementation must add a dedicated SQLite database at `.pibo/web-chat.sqlite`.

The read model must store raw inputs for reconstructing the Web Chat view:

- **Raw Pibo event log**: the original normalized Pibo output events, stored in order. This is the receipt trail. It is useful for debugging, replay, and rebuilding a view model after code changes.
- **Session index**: session and parent-child metadata needed to list main sessions, nested subagent sessions, and session status efficiently.

The trace API may return a bounded latest-event window for Raw Events inspector rendering. This bounded window is a display/debug payload only. Trace node reconstruction must use the complete stored event set required for the selected session, or an equivalent open-turn-complete event set, before applying `rawEventsLimit`. If a bounded raw event window is returned, it must preserve insertion order within the returned window and must not assume that `message_started` or `message_queued` is always present for a still-running turn.

V1 must not persist materialized trace nodes. Trace nodes such as `tool.call`, `agent.delegation`, and `execution.command` are derived at read time or in memory from Pi JSONL plus the raw Pibo event log. Pi JSONL remains canonical for transcript content.

Expected stored categories:

- Session index rows derived from Pibo Sessions and Pi session metadata.
- Parent-child session relationships for sidebar nesting.
- Pibo event log rows for web-renderable product events.
- Browser-local or server-side session selection metadata if required for navigation, including selected Pibo Room and selected Pibo Session per room.

The database must not be treated as the canonical source for Pi transcript messages. If performance later requires caching, a future implementation may add a versioned, disposable projection cache that can be deleted and rebuilt without data loss.

### 4.5 V1 Slash Commands

| Slash command | Action | Notes |
| --- | --- | --- |
| `/status` | `status` | Routed command matching Local Routed TUI behavior. |
| `/clear` | `clear_queue` | Routed command matching Local Routed TUI behavior. |
| `/abort` | `abort` | Routed command matching Local Routed TUI behavior. |
| `/thinking` | `thinking` | Cycles thinking level. |
| `/thinking <level>` | `thinking` with params | Sets thinking level. |
| `/thinking-show` | browser-local display toggle | Does not change model thinking effort. |
| `/session-current` | `session.current` | Shows active Pi session metadata. |
| `/sessions` | `session.list` | Lists persisted Pi sessions for the workspace. |
| `/fork-candidates` | `session.fork_candidates` | Useful for debugging forkable user entries. |
| `/clone` | `session.clone` | Web Chat V1-specific command; clone is slash-only in V1. |

The full `/tree` command is not a V1 Web Chat command because full tree browsing and tree navigation are deferred.

## 5. Acceptance Criteria

- **AC-001**: Given an authenticated user opens `/apps/chat`, When the app loads, Then it renders the React/TanStack Start/Tailwind shell with `Sessions`, `Agents`, and `Settings` areas.
- **AC-002**: Given the user is in `Sessions`, When main and subagent sessions exist, Then the left sidebar shows main sessions with nested expandable subagent sessions.
- **AC-003**: Given a main session is selected, When the user expands a subagent delegation inline, Then the subagent trace is inspectable without changing the composer target.
- **AC-004**: Given a subagent delegation node is visible, When the user clicks its session link, Then the selected session changes to the linked subagent session.
- **AC-005**: Given a subagent session is selected, When the user sends a message, Then the message routes to that selected subagent session.
- **AC-006**: Given a tool call runs, When events stream from Pibo, Then the UI shows a structured running tool card and later a completed or error result.
- **AC-007**: Given a subagent is called, When the subagent session is created, Then the parent session shows an `agent.delegation` node and the sidebar shows the child session under the parent.
- **AC-008**: Given an execution command runs, When an `execution_result` event is emitted, Then the result appears inline in the transcript as an execution command node.
- **AC-009**: Given a `session_error` occurs, When the event is emitted, Then the UI displays an inline error card.
- **AC-010**: Given the user types `/` in the composer, When commands are available, Then a keyboard-navigable slash command menu opens and the active command remains visible while arrow-key navigation changes selection.
- **AC-011**: Given the user selects `/clone`, When the command completes, Then the Web App switches to the cloned session returned by Pibo.
- **AC-012**: Given a user message trace node, When the user clicks its fork control and fork succeeds, Then the Web App shows a small modal asking whether to switch to the forked session.
- **AC-013**: Given the server restarts, When the app reloads, Then previously persisted session transcript content is reconstructed from Pi JSONL and session relationships from Pibo Sessions/read model.
- **AC-014**: Given live events were indexed before reload, When the app reloads, Then execution command/error/tool lifecycle display is reconstructed from Pi JSONL plus the raw Pibo event log where the stored data is sufficient.
- **AC-015**: Given the transcript contains thinking blocks and thinking display is off, When the user enables `/thinking-show`, Then historical thinking blocks become visible without changing model thinking effort.
- **AC-016**: Given trace nodes are visible for the first time, When the view renders, Then top-level trace nodes are expanded and nested child nodes are collapsed.
- **AC-017**: Given the user uses expansion controls, When they select default, collapse all, expand all, or expand to a nesting level, Then the trace tree updates according to that selected expansion depth.
- **AC-018**: Given a running turn has emitted many thinking deltas, When the trace endpoint returns a latest-event window that no longer contains `message_started`, Then subsequent `assistant_delta` events for the same `eventId` still appear as a live assistant response.
- **AC-019**: Given a `thinking_finished` event is received, When no `message_finished` event has been received for that `eventId`, Then the selected session remains in a running state and the UI continues to accept assistant streaming updates.
- **AC-020**: Given the Raw Events inspector is opened, When adjacent assistant or thinking delta events share `piboSessionId`, `eventId`, and live segment identity, Then they are displayed as one compacted raw event with an aggregate count.
- **AC-021**: Given a session is renamed or archived, When the sidebar reloads, Then the manual title or archive visibility state is reflected without changing the linked Pi Session ID.
- **AC-022**: Given the composer contains one line, When the user inserts line breaks up to five lines, Then the textarea grows and the send icon button remains one-line high and bottom-aligned.
- **AC-023**: Given the composer contains more than five lines, When the internal scrollbar appears, Then the textarea height remains stable and the cursor baseline and bottom spacing do not visually jump.
- **AC-024**: Given the cursor is placed in the middle of composer text, When the user types a character, Then the cursor stays at the edited position instead of moving to the end.
- **AC-025**: Given the user reloads `/apps/chat/rooms/:roomId/sessions/:piboSessionId`, When the room and session are still available, Then the same Pibo Room and Pibo Session are selected without relying on `localStorage`.
- **AC-025A**: Given the user opens `/apps/chat`, When bootstrap resolves a room and session, Then the browser URL is replaced with `/apps/chat/rooms/:roomId/sessions/:piboSessionId`.
- **AC-026**: Given the user switches from Room A to Room B and back to Room A, When Room A has a stored selected session, Then that session is restored instead of selecting a different room default.
- **AC-027**: Given a stored room-session pair no longer exists, When bootstrap for that pair fails, Then the app removes that stored room-session entry and loads a valid fallback for the room.
- **AC-028**: Given a room switch is in progress with no selected session, When the user presses send, Then no message is emitted to the previous session.
- **AC-028A**: Given an archived room contains sessions, When the user selects it from the archived-room list, Then the room's sessions remain visible and the composer and new-session button are disabled.
- **AC-028B**: Given the `Personal Chat` room is visible, When the user hovers or focuses its room row, Then rename, archive, and delete controls are not available and a locked affordance is visible.
- **AC-028C**: Given an archived non-personal room, When the user opens delete confirmation, Then the delete button stays disabled until the exact room name is entered.
- **AC-029**: Given assistant output contains Markdown, When it renders, Then supported Markdown renders structurally and unsafe raw HTML is not rendered.
- **AC-030**: Given a direct generated subagent tool runs, When the parent trace is reconstructed or streamed, Then an `agent.delegation` node links to the child Pibo Session when known.
- **AC-031**: Given `pibo_run_start` starts a `pibo_subagent_*` tool, When the trace is reconstructed or streamed, Then the trace shows the `pibo_run_start` context and a visible async agent child identifying the subagent.
- **AC-032**: Given a service message contains `<pibo_run_notification>`, When the trace is reconstructed, Then it renders as a `yielded.run` node with completed, failed, cancelled, and running groups.
- **AC-033**: Given the user opens a different session trace, When the trace finishes rendering, Then the transcript is positioned at the bottom.
- **AC-034**: Given the user has manually scrolled upward during streaming, When new assistant or tool content arrives, Then the scroll position is not forced to the bottom and a scroll-to-bottom control is visible.
- **AC-035**: Given the scroll-to-bottom control is visible, When the user activates it, Then the transcript scrolls to the latest content and the control hides.
- **AC-036**: Given `pibo_run_start` initially reports an async subagent run as `running`, When a later `pibo_run_wait` or `pibo_run_read` result reports the same `runId` as `completed`, Then the reconstructed `agent.async` node is `done`.
- **AC-037**: Given an assistant emits progress text, then a tool call, then final assistant text, When the trace is reconstructed from persisted Pi entries, Then both assistant text entries remain visible in transcript order around the tool call.
- **AC-038**: Given the client receives `TEXT_MESSAGE_END`, When the selected session is still mounted, Then Chat Web schedules an immediate trace/bootstrap refresh.
- **AC-039**: Given a provider reuses the same `contentIndex` for an intermediate assistant response and a final assistant response in one routed turn, When live SSE frames are applied before reload, Then the responses render as separate `assistant.message` nodes in the streamed order.
- **AC-040**: Given live trace nodes and persisted trace nodes have overlapping timestamps, When the trace view sorts nodes, Then explicit `orderKey` metadata determines the order before timestamp fallback is considered.
- **AC-041**: Given a running turn has emitted more events than the Raw Events inspector limit, When the trace endpoint refreshes with a small `rawEventsLimit`, Then previously visible live reasoning, assistant, and tool nodes for that open turn remain present in the trace view.

## 6. Test Automation Strategy

- **Unit Tests**:
  - Pi JSONL plus raw Pibo event-to-trace-node aggregation.
  - Session tree construction from Pibo Sessions and `parentId`.
  - Subagent tool-name detection and delegation linking.
  - Slash command normalization and dispatch mapping.
  - Read-model repository insert/query behavior.
  - Async yielded-run snapshot reconciliation by `runId`.
  - Persisted assistant progress/final text ordering around tool calls.
  - Live assistant and reasoning segment identity when providers reuse `contentIndex`.
  - Trace order-key comparison across transcript, event-log, and live sources.
  - Read-model full event retrieval for trace projection separate from bounded Raw Events display retrieval.

- **Integration Tests**:
  - Chat API session list and selected session endpoints.
  - SSE or streaming event ingestion into the read model.
  - Live assistant and thinking delta aggregation while a turn is running.
  - Latest-event-window reconstruction when the retained window does not include `message_started`.
  - Running-turn trace refresh after more than the default read-model event window has been recorded.
  - Clone and fork execution flows.
  - Reconstruction from Pi session JSONL plus raw Pibo event log.
  - Trace refresh triggers for `TEXT_MESSAGE_END` lifecycle frames.

- **End-to-End Tests**:
  - Authenticated chat load.
  - Send message and observe user/assistant render.
  - Tool call render lifecycle.
  - Subagent delegation render and navigation.
  - Slash command menu keyboard behavior.
  - Slash command menu active-item scrolling.
  - Composer cursor stability and auto-resize behavior.
  - Composer send icon button alignment while the textarea grows.
  - Fork from a user message.
  - Clone current session.
  - Reload restores selected room and selected session.
  - Room switching restores the last selected session for each room.
  - Streaming autoscroll preserves manual scroll position and exposes the scroll-to-bottom control.

- **Visual Checks**:
  - Desktop and mobile screenshots for the app shell.
  - Deeply nested trace rendering.
  - Long JSON arguments/results.
  - Error cards and execution command cards.
  - Sidebar, top bar, command menu, modal, agents mock, settings mock, and inspector consistency with `DESIGN.md`.
  - Browser-driven composer geometry checks for one-line, five-line, and overflowing six-line textarea states.

## 7. Rationale & Context

Pi Coding Agent already persists the canonical agent transcript in JSONL files. These files include user messages, assistant messages, thinking blocks, tool calls, tool result messages, and session tree entries. Pibo should therefore avoid duplicating the complete transcript as a second source of truth.

However, Pibo Web Chat needs data that Pi JSONL does not fully own or does not expose in a web-optimized form:

- Live streaming state before message persistence.
- Running-turn status while thinking and visible assistant text are streamed as separate event families.
- Tool execution start/update/end lifecycle and durations.
- Pibo execution command events and results.
- Pibo session errors.
- Web navigation indexes.
- Subagent session relationships by Pibo Session `parentId`.
- Yielded run lifecycle and policy metadata.

The dedicated SQLite read model solves web rendering and reload requirements without changing Pi ownership of transcript persistence. V1 stores raw Pibo events rather than durable materialized trace nodes so future execution concepts such as workflows, agent teams, approvals, and scheduled runs can be represented by new events without migrating a UI-shaped storage model. Because live streams can produce many delta events, trace reconstruction must be robust when the API returns a latest-event window rather than the full raw event history.

The pydantic-tracing UI is the chosen reference because it already solves nested execution inspection with recursive cards, structured JSON rendering, status styling, and delegation-like spans.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Pi Coding Agent session JSONL files - Canonical transcript and session tree data.
- **EXT-002**: Pibo Session store - SQLite persistence for Pibo Session IDs, Pi Session IDs, channel, kind, profile, owner scope, parent/origin relationships, workspace, title, and metadata.

### Third-Party Services

- **SVC-001**: Better Auth Google OAuth - Required for authenticated Chat Web App access.

### Infrastructure Dependencies

- **INF-001**: Dedicated Web Chat SQLite database - Required for session index and raw Pibo event persistence.
- **INF-002**: Same-origin web host - Required to serve the app, auth routes, and chat API routes from one origin.

### Technology Platform Dependencies

- **PLT-001**: React - Required frontend UI library.
- **PLT-002**: Tailwind - Required styling system for the adapted trace UI.
- **PLT-003**: TanStack Start - Required frontend app framework, implemented as an app project that consumes Pibo APIs instead of controlling Pibo runtime boundaries.
- **PLT-004**: Node.js runtime - Must remain compatible with the repository runtime requirements.
- **PLT-005**: `DESIGN.md` - Required design-system source for all Web Chat UI elements and adaptations.

## 9. Examples & Edge Cases

### 9.1 Main Session With Inline Subagent Inspection

```text
Main Session A selected
  User asks for research
  Assistant calls pibo_subagent_research
    Delegation node appears inline
    User expands delegation node
      Subagent trace is shown inline
      Subagent tool calls are inspectable
  Composer target remains Main Session A
```

### 9.2 Direct Subagent Session Chat

```text
User clicks "Open session" on a delegation node
Selected session becomes the linked child Pibo Session
Composer target becomes the subagent session
New messages are sent to the subagent session
```

### 9.3 Fork From User Message

```text
User opens an earlier user.message node
User clicks fork control
Pibo executes session.fork with that entry id
Web App shows a small modal asking whether to switch to the forked result
If the user confirms, the Web App selects the forked session and reloads the transcript and reconstructed traces
If the user declines, the current selected session remains visible
```

### 9.4 Clone Current Session

```text
User opens slash command menu with /
User selects clone
Pibo executes session.clone
Web App switches selected session to the cloned result
```

### 9.5 Composer Growth

```text
Composer starts with one visible line
User adds newline content up to five lines
Textarea grows while the send icon remains one-line high and bottom-aligned
User adds a sixth line
Textarea keeps the five-line height and scrolls internally
Cursor baseline and bottom spacing stay visually stable
```

### 9.6 Room And Session Selection Restore

```text
User selects Room A and Session A2
Web App navigates to /apps/chat/rooms/<room-a-id>/sessions/<session-a2-id>
User switches to Room B and selects Session B1
Web App navigates to /apps/chat/rooms/<room-b-id>/sessions/<session-b1-id>
User switches back to Room A
Web App navigates to /apps/chat/rooms/<room-a-id>/sessions/<session-a2-id> or uses browser-local fallback only when the URL does not specify a session
If Session A2 is valid, the main trace renders Session A2
If Session A2 is invalid, only Room A's stored session entry is removed and Room A falls back to a valid server-selected session
Web App replaces the URL with the valid fallback room/session selection
User selects Archived Rooms and opens archived Room C
If Room C contains sessions, the session tree remains visible
Composer, New Session, slash command execution, and fork actions stay disabled while Room C is archived
```

### 9.7 Async Subagent Run

```text
Assistant calls pibo_run_start
  toolName = pibo_subagent_explorer
  arguments.message = inspect auth
Trace shows pibo_run_start as the parent execution context
Trace shows an agent.async child with target qa_researcher
If the subagent session link is known, the child node can open that Pibo Session
```

## 10. Validation Criteria

- The app builds and typechecks.
- The web app can run through `npm run gateway:web`.
- Authenticated users can load the React Web App.
- The Web App can display the URL-selected session after a page reload.
- The Web App can preserve `/apps/chat/agents` and `/apps/chat/settings` across page reloads.
- Tool calls render as nested trace cards with structured args/results.
- Subagent sessions are visible in both sidebar nesting and inline delegation nodes.
- Slash command keyboard selection works.
- Slash command keyboard navigation keeps the selected command visible in long command lists.
- Composer auto-resize preserves one-line, five-line, and overflowing states with a bottom-aligned send icon.
- Clone switches the selected session after success.
- Fork asks before switching to the forked session.
- The read model does not replace or mutate Pi transcript history.
- Materialized trace nodes are not persisted as durable V1 state.
- Async subagent nodes do not remain `running` after later run-control snapshots prove terminal completion.
- Final assistant responses do not disappear after intermediate assistant progress text and tool calls.

## 11. Related Specifications / Further Reading

- [Runtime Boundary Spec](spec-architecture-runtime-boundary.md)
- [Events And Gateway Spec](spec-schema-events-and-gateway.md)
- [Web Auth Chat Spec](spec-infrastructure-web-auth-chat.md)
- [Architecture](../docs/architecture.md)
- [Progress](../docs/progress.md)
- [Design System](../DESIGN.md)
- [Web Chat Tracing UI Reference](../docs/web-chat-tracing-ui-reference.md)
- `<HOME>/code/pydantic-tracing/src/components/tracing/SpanNode.tsx`
- `<HOME>/code/pydantic-tracing/src/components/tracing/TraceTimeline.tsx`
- `<HOME>/code/pydantic-tracing/src/components/tracing/JsonRenderer.tsx`
- `<HOME>/code/pydantic-tracing/src/components/tracing/traceTree.ts`

## 12. Open Questions

- **OQ-001**: None for the current V1 design pass.
