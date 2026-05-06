---
title: Web Chat Tracing UI Reference
date_created: 2026-04-28
purpose: Reference context for designing Pibo's next-generation Chat Web App from the pydantic-tracing UI.
---

# Web Chat Tracing UI Reference

This document is not the feature specification. It is reference context for a separate specification session. It explains the existing tracing UI in `<HOME>/code/pydantic-tracing`, why it fits Pibo, and how it should influence the Pibo Chat Web App design.

## Source Project

The relevant cloned project is:

```text
<HOME>/code/pydantic-tracing
```

The useful part is the TypeScript/React tracing UI, not the Python worker system or job queue.

Important files:

```text
src/components/tracing/TraceTerminal.tsx
src/components/tracing/TraceSidebar.tsx
src/components/tracing/TraceTimeline.tsx
src/components/tracing/SpanNode.tsx
src/components/tracing/JsonRenderer.tsx
src/components/tracing/TraceLogStream.tsx
src/components/tracing/traceTree.ts
src/types/tracing.ts
src/lib/tracing/db.ts
src/lib/hooks/use-traces.ts
src/lib/hooks/use-trace-websocket.ts
design/tracing-design-concept.html
```

## What The Tracing System Is

The tracing UI models execution as a nested tree:

```text
Trace
  -> Span
    -> Child Span
      -> Child Span
```

Each span has:

- an id
- an optional parent id
- a span type
- a name
- start and end time
- duration
- status: `UNSET`, `OK`, or `ERROR`
- attributes, usually JSON-compatible
- events
- children

The UI renders that tree as collapsible nested execution cards. A user can stay at a high level or open deeper levels step by step.

The existing span types include:

```text
agent.run
tool.call
tool.result
model.request
model.response
model.reasoning
agent.delegation
user.prompt
user_input
```

The most important concept is not the exact type names. The important concept is that agent execution is rendered as structured, nested, inspectable work rather than a flat text log.

## Why It Fits Pibo

Pibo already emits the right kind of normalized events:

```text
message_queued
message_started
assistant_delta
assistant_message
thinking_started
thinking_delta
thinking_finished
tool_call
tool_execution_started
tool_execution_updated
tool_execution_finished
execution_result
session_error
pi_event
```

These events map naturally to trace nodes. Pibo also already has parent-child session relationships through subagents:

```text
main session
  -> pibo_subagent_<name>
    -> subagent session
      -> possible nested subagent session
```

That means the pydantic-tracing UI is a strong fit for Pibo because both systems need to show nested work:

- Pibo tool calls can be rendered like `tool.call` spans.
- Pibo tool results can be rendered as tool output sections or `tool.result` spans.
- Pibo thinking events can be rendered like `model.reasoning`.
- Pibo assistant output can be rendered like `model.response`.
- Pibo subagent tool calls can be rendered like `agent.delegation`.
- Pibo session errors can be rendered with the existing error banner pattern.
- Pibo execution actions such as `session.fork`, `session.clone`, `session.tree`, and `thinking` can become structured `execution.command` nodes.

The match is especially good because Pibo's product boundary already normalizes Pi events before sending them to channels. The Web App should consume a stable Pibo view model, not raw Pi events.

## UI Pattern To Preserve

The existing Trace Terminal layout is:

```text
Left Sidebar     Center Timeline / Execution Flow     Right Log / Inspector
```

For Pibo, adapt it as:

```text
Session Sidebar  Chat + Nested Trace View             Details / Raw Events / Inspector
```

Required behavior for Pibo:

- Main sessions are shown in the left sidebar.
- Main sessions are expandable.
- Subagent sessions are shown nested below their parent session.
- Subagent sessions can themselves be expanded if they called further subagents.
- A user can click a main session or any subagent session in the sidebar.
- The selected session always gets a full main view.
- The main view also shows agent delegations inline, so a user can inspect subagent work from the parent trace without switching sessions.

This gives two complementary navigation modes:

1. Navigate directly to a session or subagent session from the sidebar.
2. Stay in the parent session and drill down through nested trace cards.

Both modes are required.

## Components Worth Reusing Or Porting

### `SpanNode.tsx`

This is the core component. It recursively renders a span and its children.

Useful behaviors:

- collapsible card header
- nested child rendering
- status colors
- active/running indicator
- duration and relative timestamp display
- span-type icons
- special rendering for tool calls, tool results, reasoning, user input, model response, agent delegation, and errors

For Pibo, this should become a Pibo trace node renderer. It should not keep Python-specific assumptions.

### `JsonRenderer.tsx`

This component should be reused conceptually.

Useful behaviors:

- accepts objects, arrays, JSON strings, or plain text
- parses JSON strings when possible
- falls back to a readable preformatted text block
- supports expand all and collapse all
- is useful for tool args, tool results, execution results, session tree data, and errors

### `TraceTimeline.tsx`

This gives the center execution-flow layout.

Useful behaviors:

- computes flattened stats from nested spans
- supports default, expand all, collapse all, and expand-to-depth controls
- auto-scrolls while streaming
- shows active, done, and error counts
- keeps the timeline readable even with nested children

For Pibo, this should render one selected session's transcript and per-turn trace nodes, not just one standalone trace.

Pibo's adapted timeline should default to a shallow expanded view: top-level user and assistant message spans are expanded so the chat remains readable, while nested tool, reasoning, and delegation details stay collapsed until inspected.

### `TraceSidebar.tsx`

The visual style is useful, but the data model must change.

For Pibo, the sidebar should be session-oriented:

```text
Main Session
  Subagent Session
    Nested Subagent Session
```

The sidebar should show status, profile, last activity, and possibly running tools/runs.

### `traceTree.ts`

This file contains an important filtering pattern:

- hide noisy technical nodes
- preserve and hoist useful child nodes

For Pibo, this pattern should be used to hide noise while keeping important nested work visible.

## Suggested Pibo View Model

The spec should define a Pibo-specific view model similar to this:

```ts
type PiboTraceNodeType =
  | "user.message"
  | "assistant.message"
  | "agent.turn"
  | "model.reasoning"
  | "tool.call"
  | "tool.result"
  | "agent.delegation"
  | "execution.command"
  | "error";

type PiboTraceNodeStatus = "running" | "done" | "error";

type PiboTraceNode = {
  id: string;
  parentId?: string;
  piboSessionId: string;
  eventId?: string;
  toolCallId?: string;
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
  children: PiboTraceNode[];
};
```

For sessions:

```ts
type PiboWebSessionNode = {
  piboSessionId: string;
  piSessionId: string;
  parentId?: string;
  profile: string;
  title: string;
  status: "idle" | "running" | "error";
  lastActivityAt?: string;
  children: PiboWebSessionNode[];
};
```

These names are only recommendations. The important point is that the UI should consume a Pibo-specific tree model, not raw SSE events directly.

## Event Mapping

Recommended mapping from Pibo events to trace nodes:

| Pibo event | UI node |
| --- | --- |
| `message_queued` | `user.message` |
| `message_started` | start `agent.turn` |
| `thinking_started` / `thinking_delta` / `thinking_finished` | `model.reasoning` |
| `assistant_delta` / `assistant_message` | `assistant.message` |
| `tool_call` | `tool.call` with args |
| `tool_execution_started` | mark tool node running |
| `tool_execution_updated` | update tool partial output |
| `tool_execution_finished` | finish tool node; render output or error |
| `execution_result` | `execution.command` |
| `session_error` | `error` |
| `pibo_subagent_*` tool call | `agent.delegation` linked to subagent session |

Subagent sessions should also be independently selectable. The delegation node should link to the child session, but the child session should also appear in the sidebar.

## Design Requirements To Carry Into The Spec

- The Pibo Chat Web App should be built with React and Tailwind.
- The visual design should stay close to the pydantic-tracing Trace Terminal.
- Nested trace cards are a primary product feature.
- The UI must support both broad overview and deep inspection.
- Tool calls must render as structured function-like cards, not as raw JSON text.
- Tool args and results must use a JSON renderer.
- Errors must render as clear error cards or banners.
- Agent delegations must be visually distinct from ordinary tool calls.
- Subagent calls must be navigable both inline and through the sidebar.
- The sidebar must support arbitrary nesting depth, at least to the same depth allowed by Pibo subagents.
- The selected session view must work for both main sessions and subagent sessions.
- The main parent session view must be able to show nested subagent execution inline when expanded.
- Execution commands such as fork, clone, tree, switch, thinking, status, abort, and clear queue need structured display.

## Important Architecture Guidance

Do not make the frontend reconstruct everything from raw DOM state or ad hoc event strings.

The preferred architecture is:

```text
PiboOutputEvent stream
  -> server/client event aggregator
  -> persisted or reconstructable Pibo trace/session view model
  -> React components
```

Pibo already has `.pibo/pibo-sessions.sqlite` for Pibo Sessions. For a full Web App, the spec should consider adding a separate persisted web event or trace index so reloads can restore:

- session list
- parent-child session relationships
- user messages
- assistant messages
- thinking blocks
- tool calls
- tool results
- execution results
- errors

The raw Pi session files should remain Pi-owned. The Web App should store only product/UI index data needed for rendering and navigation.

## Scope Recommendation

Recommended V1:

- React + Tailwind Chat Web App shell.
- Nested session sidebar.
- Selected session main view.
- Per-turn nested trace rendering.
- Tool call rendering.
- JSON rendering.
- Thinking rendering.
- Error rendering.
- Agent delegation rendering.
- Basic execution result rendering.
- Archived-session deletion guarded by a destructive confirmation modal requiring `Delete this session`.
- Agent Designer for persisted custom profiles built from native plugin tools, skills, context files, subagents, and the `pibo-run-control` package toggle. The Agents area uses a single profile sidebar with editable custom agents, archived custom agents, and read-only plugin profile inspection plus copy-to-custom actions. Archived custom agents are read-only and can be permanently deleted only after exact-name confirmation.

Recommended later phases:

- Custom agent import/export.
- Agent runtime inspection previews.
- Workspace selection model.
- Advanced session tree editor.
- Export/import of trace views.

The initial Agent Designer is now part of the web surface. It intentionally configures native Pibo agent capabilities only; curated external CLI tools remain global operator tooling outside the profile builder.

## Key Conclusion

The pydantic-tracing UI fits Pibo because it already solves the hardest UX problem: making nested agent work understandable without forcing the user into raw logs. Pibo has the runtime concepts that match this UI: sessions, subagent sessions, tool calls, thinking, execution actions, and errors. The new Web Chat App should adopt the nested trace-card model as its main interaction pattern and adapt it to Pibo's session router and event contracts.
