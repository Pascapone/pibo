# Web Chat Trace UI Session Handoff

Date: 2026-04-30

## Goal

Bring the Pibo Chat Web App closer to the existing `pydantic-tracing` trace UI:

- Render user messages, assistant messages, tool calls, tool results, reasoning, execution commands, errors, and subagent delegations as trace spans.
- Keep top-level spans expanded by default so messages are readable, while nested spans remain collapsible.
- Show nested trace structure inline in the main chat view.
- Keep subagent sessions available as nested sidebar entries and allow opening linked child sessions from delegation spans.
- Support browser-local Thinking visibility.
- Support Clone via slash command and Fork from user-message spans with a switch confirmation modal.

## Implemented

- Added a dedicated React/TanStack Router/Vite chat UI under `src/apps/chat-ui`.
- Ported/adapted the tracing components from `<HOME>/code/pydantic-tracing`:
  - `SpanNode`
  - `TraceTimeline`
  - `JsonRenderer`
  - `traceTree`
- Added Pibo-to-trace adaptation:
  - `user.message` -> `user.prompt`
  - `assistant.message` -> `model.response`
  - `agent.turn` -> `agent.run`
  - `model.reasoning` -> `model.reasoning`
  - `tool.call` -> `tool.call`
  - `tool.result` -> `tool.result`
  - `agent.delegation` -> `agent.delegation`
  - `execution.command` -> `tool.result`
- Added a web read model in `.pibo/web-chat.sqlite`.
  - Raw Pibo events are stored.
  - Materialized trace projections are not stored.
  - Trace nodes are reconstructed from Pi session JSONL plus raw Pibo events.
- Added web APIs for bootstrap, trace view, SSE updates, messages, and execution actions.
- Added nested session listing based on Pibo Sessions and `parentId`.
- Added explicit new-session creation from the Web Chat UI through `POST /api/chat/sessions`.
- Added session rename, archive, unarchive, and archived-session visibility controls.
- Replaced the basic Agents placeholder with an Agent Designer.
  - Custom agents are persisted in `.pibo/chat-agents.sqlite`.
  - The designer exposes native plugin tools, skills, context files, subagents, and capability packages from the Pibo capability catalog.
  - Curated external CLI tools from `pibo tools` remain global operator tools and are not configured per agent.
  - `pibo_run_*` is represented as the `pibo-run-control` package toggle instead of seven independent tool choices.
- Added slash command menu behavior and Enter/Shift+Enter handling.
- Added slash command active-item scrolling so keyboard navigation keeps the selected command visible.
- Added a one-line default composer that grows to five visible lines, then scrolls internally.
- Replaced the text send button with a compact send icon button that stays one-line high and bottom-aligned while the composer grows.
- Fixed composer cursor stability so normal typing in the middle of text does not move the cursor to the end.
- Added live assistant response streaming in the trace view by aggregating `assistant_delta` events into a running `model.response` span before the final assistant message arrives.
- Added live thinking streaming in the trace view by aggregating `thinking_delta` events into a running `model.reasoning` span when thinking display is enabled.
- Hid the Raw Events panel behind an explicit debug toggle and compacted adjacent assistant/thinking delta events in the inspector.
- Fixed duplicate/stale transcript echo behavior:
  - Persisted transcript events are filtered only when safe.
  - Open live event ids are kept so follow-up turns render before page reload.
  - Live deltas keep a running turn visible even when the retained raw event window no longer contains `message_started`.
  - `message_finished` updates the matching `agent.turn` status.
- Fixed running state around thinking: `thinking_finished` ends only the reasoning block and no longer makes the session appear idle while visible assistant text is still streaming.
- Fixed persisted assistant-turn reconstruction so tool calls are grouped under the final assistant response instead of duplicating as flat spans.
- Empty or whitespace-only Pi reasoning artifacts are filtered during trace reconstruction, both for persisted `thinking` parts and live `thinking_finished` events.
- Added compact trace expansion controls for default depth, collapse all, expand all, and expand to a selected nesting level. The default expansion depth is `1`.
- Added clickable session breadcrumbs to the trace header for nested session navigation.
  - The breadcrumb path is derived from the selected session's `parentId` chain in the room-scoped session tree.
  - Parent and child sessions can be reopened directly from the trace header without switching back to the sidebar first.
- Added an origin-session shortcut in the trace header for forked or cloned sessions.
  - When the selected session has an `originId`, the header exposes a separate origin control instead of treating the origin as part of the parent breadcrumb chain.
- Added a derived-session picker in the trace header for sessions that already produced forks or clones.
  - The picker lists direct derived sessions from the selected session, including status and profile, and opens them without requiring a sidebar search.
- Served the built chat UI from `/apps/chat`, falling back to the older inline HTML only if the build is missing.

## Important Design Decisions

- The web app currently stores raw events in SQLite, not materialized trace nodes. This keeps reconstruction flexible for future workflows and agent-team traces.
- The trace API returns a latest raw-event window for rendering. Trace reconstruction must therefore infer open running turns from retained live deltas, not only from `message_started`.
- The trace UI is copied/adapted into Pibo instead of imported as a dependency.
- The current frontend uses TanStack Router with a Vite client build. `@tanstack/react-start` is installed, but the app is not yet a full TanStack Start SSR/server-entry app.
- Browser settings such as Thinking visibility are stored in `localStorage`.
- Trace expansion state is browser-local component state. The default expansion depth is `1`, so top-level messages are readable without expanding nested tool and reasoning details.
- Trace-header breadcrumbs follow session hierarchy only. They reflect `parentId` nesting for subagent sessions and do not imply that fork or clone origin sessions are nested.
- Fork and clone derivation stays visible through a dedicated header affordance backed by `originId`, so branch ancestry is inspectable without changing the session tree semantics.
- Sessions also expose their direct derived branches in the header so users can move laterally across the branch family without collapsing the distinction between hierarchy (`parentId`) and derivation (`originId`).
- Composer auto-resize is based on rendered textarea metrics. Global form-control font overrides must not override Tailwind text and line-height utilities used by the composer.
- Custom agent definitions are persisted by the web app and registered as dynamic profiles before routed sessions are created.
- The Agent Designer configures native Pibo agent capabilities only. CLI tools remain globally available through the operator environment and stay outside agent profile configuration.

## Known Gaps

- Full TanStack Start structure is still pending if SSR/server-entry semantics are required.
- The Agents page is a V1 Agent Designer. It supports custom agent creation and editing, but does not yet support deleting, importing/exporting, or deep inspection previews.
- The Settings page only exposes browser-local Thinking visibility.
- Tree command is intentionally excluded from V1.
- The legacy inline fallback HTML still exists in `src/apps/chat/web-app.ts`; it is only used when the built UI is missing.
- Full browser smoke coverage is still manual; the local Web Chat flow has been exercised during development against `/apps/chat`.
- Browser-use can validate authenticated flows when a session is available. In unauthenticated local runs, composer geometry can still be verified in the served app/CSS environment with a DOM fixture.

## Verification

Last verified in this session:

```bash
npm run typecheck
npm run chat-ui:build
npm test
```

Result:

- Typecheck passed.
- Chat UI build passed.
- Test suite passed: 108/108 tests.
- Browser-use geometry check passed for composer states with one line, five lines, and overflowing six lines.

## Next Best Steps

1. Add automated browser smoke coverage for `/apps/chat` once a stable test harness for authenticated Web Chat is available.
2. Compare the rendered UI visually against `pydantic-tracing` with real tool-call and subagent sessions.
3. Decide whether to migrate the chat UI from TanStack Router/Vite to full TanStack Start.
4. Add delete/import/export flows and runtime inspection preview for custom agents.
