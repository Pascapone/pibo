# Spec: Chat Web Trace and Terminal View

**Status:** Draft
**Created:** 2026-05-10
**Updated:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md), [Pibo Session Routing](./pibo-session-routing.md), [Pibo Session Signals](./pibo-session-signals.md), [Yielded Run Control](./yielded-run-control.md)

## Why

Chat Web is useful only if users can understand what a routed runtime did. The raw sources for a turn are split across Pibo output events, Pi transcript entries, live stream frames, child sessions, yielded run notifications, compaction events, and session metadata. Users need one stable execution view that shows messages, thinking, tool calls, delegated agents, background runs, errors, and compactions in the right order without duplicating transcript echoes or losing live updates.

The current UI presents the active conversation through a compact terminal session view, while an older nested trace view remains dormant. This spec captures the behavior that must stay true for both the trace materialization contract and the active terminal projection.

## Goal

Pibo MUST materialize authenticated Chat Web trace data into stable ordered trace nodes and render those nodes as a compact, live-updating terminal view that preserves identity, ordering, access control, and debuggability.

## Background / Current State

The server builds trace views in `src/apps/chat/trace.ts` from Pibo Sessions, Chat Web stored events, Pi transcript entries, and session metadata. The shared trace engine in `src/shared/trace-engine.ts` maps transcript entries and output events to `PiboTraceNode` records, deduplicates events, merges live deltas, orders nodes with `TraceOrderKey`, links child subagent sessions, and can patch an existing view with a single stored event.

Chat Web exposes `/api/chat/trace/summary`, `/api/chat/trace`, and a debug-only trace-at-sequence endpoint from `src/apps/chat/web-app.ts`. These endpoints require the authenticated web session, resolve only managed sessions, use ETags based on trace versions, page trace events, optionally include a bounded raw-event tail, and cache structural trace views without raw events.

The active frontend session view is the compact terminal in `src/apps/chat-ui/src/session-views/compact-terminal/*`. It derives terminal rows from trace nodes, hides model reasoning unless enabled, groups routine exploration tools, shows profile/model/breadcrumb/session-derivation context, supports sticky scrolling, preserves row identity during live patches, exposes expandable details, and lets users open linked sessions or fork from user-message rows.

## Scope

### In Scope

- Server-side trace summary and full trace API behavior.
- Materialization from transcript entries, stored output events, live stream frames, child session metadata, and session status into `PiboTraceNode` trees.
- Trace node identity, ordering, deduplication, status, raw-event opt-in, pagination metadata, and versioning.
- Single-event patch behavior used by live UI updates.
- Compact terminal row projection, grouping, thinking visibility, expansion, linked-session navigation, fork affordances, and sticky-scroll behavior.
- Chat Web session-view registry behavior for active terminal/workflow views and the dormant nested trace view adapter.

### Out of Scope

- Chat room creation, message sending, and event ingestion rules — covered by Chat Web and data-store specs.
- Signal aggregation for navigation badges — covered by the session-signals spec.
- Debug CLI trace commands — covered by the debug-cli spec.
- Re-enabling the dormant nested Trace session view as the default UI.

## Requirements

### Requirement: Trace APIs are authenticated, app-context, and cache-aware

The system MUST serve trace summaries and trace views only for sessions the authenticated web user can access, and MUST expose version metadata that allows clients to avoid rebuilding unchanged traces.

#### Current

`/api/chat/trace/summary` and `/api/chat/trace` call `requireSession`, resolve the requested Pibo Session through shared resource semantics, compute a trace version, return `ETag` and `x-pibo-trace-version`, and return `304` when the request version matches. Structural traces are cached by session id, version, event limit, and page cursor.

#### Acceptance

- A trace request for an inaccessible session fails instead of returning nodes or raw events.
- A matching `If-None-Match` request for an unchanged tail trace returns `304` when raw events are not requested.
- Trace cache entries are not reused across different versions, page sizes, or page cursors.

#### Scenario: Unchanged trace summary

- GIVEN an authenticated user has a visible Pibo Session
- AND the client already holds the current trace version
- WHEN the client requests `/api/chat/trace/summary` with `If-None-Match`
- THEN the server returns `304` with the trace version headers and no JSON body.

### Requirement: Trace versions change when observable trace inputs change

The system MUST compute trace versions from the selected session, related session metadata, event progress, runtime status, transcript metadata, and latest stream id.

#### Current

`createTraceViewVersion` hashes selected session fields, related parent/origin session fields, event sequence markers, status, Pi transcript metadata, and latest stream id.

#### Acceptance

- A new stored event sequence changes the trace version.
- A changed transcript file size or modification marker changes the trace version.
- A changed child or origin session relationship changes the trace version.
- A changed latest live stream id changes the trace version.

#### Scenario: Child session updates trace version

- GIVEN a root session trace has a delegated child session
- WHEN the child session metadata changes
- THEN the next trace summary version differs from the previous version.

### Requirement: Trace materialization produces stable ordered execution nodes

The system MUST convert transcript entries and Pibo output events into trace nodes with stable ids, stable keys, source labels, order keys, status, timestamps, inputs, outputs, errors, and parent-child relationships.

#### Current

`buildTraceViewFromEvents` projects transcript messages, session-info entries, queued messages, turn starts/finishes, assistant and thinking deltas, final assistant and thinking messages, tool executions, subagent sessions, execution results, compactions, session errors, yielded run notifications, and async agent runs into `PiboTraceNode` values. `nestTraceNodes` and `compareTraceNodes` sort and nest nodes by timestamp, trace order, and id.

#### Acceptance

- User, assistant, reasoning, tool, delegation, async-agent, yielded-run, execution-command, compaction, and error nodes use the documented node types.
- Agent turn children appear under their turn when an event id allows parent linkage.
- Subagent tool calls link to the child Pibo Session when an explicit child-session event or likely child session exists.
- Nodes with equal timestamps remain deterministic through trace order and id comparison.

#### Scenario: Tool call lifecycle

- GIVEN stored events for an agent turn with a tool start, tool update, and tool finish
- WHEN the trace is built
- THEN one tool node exists for the tool call id, its input comes from arguments, its output comes from the final result, and its status is `done` or `error` based on the final event.

### Requirement: Persisted transcript echoes do not duplicate live event nodes

The system MUST avoid showing duplicate trace rows when the Pi transcript already persists the same assistant, thinking, or tool content as previously stored events.

#### Current

The trace engine detects persisted transcript entries, open transcript event ids, transcript echo events, and stale tool-call echo events. It keeps only live/open content that is still needed for a running session.

#### Acceptance

- A completed assistant response that exists in the transcript is not duplicated by older assistant output events.
- Running sessions keep open delta content visible until the transcript catches up.
- Stale tool events do not reappear as duplicate tool rows after transcript persistence.

#### Scenario: Transcript catches up after streaming

- GIVEN a running assistant message was shown from live deltas
- WHEN the Pi transcript is persisted and the trace rebuilds while the session is idle
- THEN the terminal shows one assistant message for that content, not both transcript and event-log copies.

### Requirement: Raw events are opt-in and bounded

The system MUST omit raw event payloads by default and include only a bounded raw-event tail when the caller explicitly requests raw events.

#### Current

`buildTraceViewFromEvents` returns `rawEvents: []` unless `includeRawEvents` is true. `/api/chat/trace` parses `includeRawEvents`, `rawEventsLimit`, `pageSize`/`eventLimit`, and `beforeSequence`, and annotates trace pages with event count and cursor metadata.

#### Acceptance

- Default trace responses contain no raw events.
- `includeRawEvents=true` returns no more than the accepted raw event limit.
- Page metadata includes enough information to request older events when older events exist.

#### Scenario: Request raw tail for debugging

- GIVEN a session has more than 80 trace events
- WHEN the client requests `/api/chat/trace?includeRawEvents=true&rawEventsLimit=80`
- THEN the response includes at most the latest 80 raw events and the structural trace remains available.

### Requirement: Live patches preserve unaffected node identity

The system MUST apply a single new stored event to an existing trace view without replacing unchanged node objects.

#### Current

`patchTraceViewWithEvent` skips duplicate events, flattens the current tree, applies one event, nests and reconciles statuses, and uses structural sharing for unchanged nodes.

#### Acceptance

- Applying an assistant delta changes only the matching assistant node and required ancestors.
- Applying a reasoning delta changes only the matching reasoning node and required ancestors.
- Applying a tool finish changes only the matching tool node and required ancestors.
- Applying an event already present in `rawEvents` returns the same trace view object.

#### Scenario: Tool result patch

- GIVEN a terminal has assistant and two tool rows
- WHEN a finish event arrives for one tool call
- THEN the updated trace preserves the assistant row and unrelated tool row identities, while the matching tool row shows final output and status.

### Requirement: Compact terminal renders trace nodes as a readable conversation surface

The system MUST project trace nodes into terminal rows that prioritize human-readable conversation flow while preserving access to details.

#### Current

`buildCompactTerminalRows` flattens and sorts trace nodes, hides `agent.turn`, optionally hides `model.reasoning`, maps each visible node type to a row kind, previews bounded tool output, exposes expandable input/output/error details, groups routine exploration tools, and carries debug fields such as event id, run id, source, and stream order.

#### Acceptance

- User and assistant messages render as message rows in trace order.
- Thinking rows appear only when thinking display is enabled.
- Tool rows show a concise verb, tool name, optional function-call input, bounded preview, error state, and expandable details.
- Delegation and async-agent rows expose linked Pibo Session ids when present.
- Yielded run, compaction, execution command, and system error rows remain visible as distinct row kinds.

#### Scenario: Thinking hidden by default

- GIVEN a trace contains user, reasoning, tool, and assistant nodes
- WHEN the terminal builds rows with `showThinking=false`
- THEN the reasoning node is omitted and the other rows keep their relative order.

### Requirement: Terminal interaction stays stable during streaming

The terminal view MUST keep users near the latest output when they are at the bottom, avoid forcing scroll when they inspect older output, and expose running/error context without requiring a full trace debug view.

#### Current

`CompactTerminalSessionView` uses sticky virtualization keyed by session id and row content, follows output only near the bottom, shows a streaming footer when signals, selected-session status, running rows, or unset trace status indicate work, keeps expanded rows if rows still exist, and shows header badges for profile, model, breadcrumbs, origin/derived sessions, system errors, and tool errors.

#### Acceptance

- A user at the bottom follows new rows during streaming.
- A user scrolled away from the bottom sees a “Scroll to latest” affordance instead of being forced down.
- Expanded rows remain expanded across live updates when their ids still exist.
- Header error counts distinguish tool-call errors from non-tool/system errors.

#### Scenario: Inspect old output while tools run

- GIVEN the selected session is streaming and the user scrolls above the latest row
- WHEN more trace rows arrive
- THEN the viewport does not jump to the bottom and the terminal shows a control to return to the latest output.

### Requirement: Session view selection is bounded to active view ids

The Chat Web session surface MUST expose only supported active session views to normal selection while keeping the legacy nested trace view available as dormant code that can render the same trace props if explicitly reactivated by a future change.

#### Current

`chatSessionViewIds` accepts only `terminal` and `workflow`, with `terminal` as the default. `listChatSessionViews` returns those active views. `getChatSessionView` falls back to the default terminal view for unknown active view ids. `inactiveChatSessionViews` keeps the nested `trace` view as an unregistered adapter around `TraceTimeline`.

#### Acceptance

- Normal session-view parsing accepts `terminal` and `workflow` and rejects any other string.
- The default session view is `terminal`.
- Listing active session views returns terminal and workflow, not the dormant trace view.
- Looking up an unknown active view id falls back to terminal.
- The dormant trace view, if manually invoked by code, passes trace, loading, thinking, profile/model, breadcrumb, derivation, profile-change, fork, and open-session props through to `TraceTimeline` without owning separate trace state.

#### Scenario: Unknown view id falls back to terminal

- GIVEN a stored or query-provided session-view id is not one of the active ids
- WHEN Chat Web resolves the view
- THEN it renders the terminal view instead of exposing the dormant trace view or failing the session surface.

## Edge Cases

- Missing or removed Pi transcript files still produce a trace from stored events and session metadata.
- Sessions with no trace nodes return an empty trace and the terminal shows an empty state.
- Unknown output event types are ignored rather than rendered as malformed nodes.
- Internal session operations are not shown as user-facing execution-command rows.
- Raw-event and page-size query parameters are clamped to safe limits.
- Duplicate stream frames or repeated stored event sequences are deduplicated.
- A tool error is visible as a tool error but does not imply the whole runtime failed unless a session/runtime error exists.

## Constraints

- **Compatibility:** Trace node types and fields are consumed by Chat Web, debug tooling, and tests; additions must be backward-compatible.
- **Security / Privacy:** Trace APIs must require authenticated access and must not expose raw events by default.
- **Performance:** The server should page event reads, cache structural traces, avoid loading raw payloads unless requested, and let the terminal virtualize long sessions.
- **Identity:** Live updates should preserve unchanged node and row identity to avoid unnecessary rerenders and lost expansion state.
- **Source of Truth:** Current Pibo Session records, stored Chat Web events, Pi transcript metadata, and runtime status are authoritative over legacy docs.

## Success Criteria

- [ ] SC-001: Trace summary and trace APIs reject unauthorized sessions and return trace version headers for authorized sessions.
- [ ] SC-002: Trace rebuilds produce deterministic node ids, nesting, ordering, statuses, inputs, outputs, errors, and linked sessions for supported event and transcript sources.
- [ ] SC-003: Transcript-persisted content and event-log/live content do not create duplicate terminal rows after a turn settles.
- [ ] SC-004: Raw events are absent by default and bounded when requested.
- [ ] SC-005: Single-event patches preserve object identity for unaffected nodes.
- [ ] SC-006: The compact terminal renders visible node kinds, hides thinking when configured, preserves expansion, follows output only when sticky, and distinguishes tool errors from system errors.
- [ ] SC-007: Session-view resolution exposes only active terminal/workflow views, defaults unknown ids to terminal, and keeps the nested trace view dormant unless deliberately reactivated.

## Assumptions and Open Questions

### Assumptions

- The compact terminal is the default active Chat Web session surface; the workflow view is also active for workflow-backed sessions, and the older nested trace view remains dormant unless a future change reactivates it.
- Trace materialization may ignore unknown event types until a new node type is specified.
- The trace API may rebuild from the current event page instead of the full event history when pagination parameters request a bounded page.

### Open Questions

- Should raw event access require an additional debug permission if multi-user deployments add finer-grained roles?
- Should the dormant nested trace view be removed, kept as an internal debug view, or reactivated as an optional session view?
- Should terminal grouping rules for exploration tools be user-configurable or remain fixed by code?

## Traceability

| Requirement | Scenario / Story | Code Basis | Status |
|---|---|---|---|
| REQ-001 Trace APIs are authenticated, app-context, and cache-aware | Unchanged trace summary | `src/apps/chat/web-app.ts` trace endpoints | Implemented |
| REQ-002 Trace versions change when observable trace inputs change | Child session updates trace version | `src/apps/chat/trace.ts`, `test/chat-trace-materialization.test.mjs` | Implemented |
| REQ-003 Trace materialization produces stable ordered execution nodes | Tool call lifecycle | `src/shared/trace-engine.ts`, `src/shared/trace-order.ts`, `src/shared/trace-types.ts` | Implemented |
| REQ-004 Persisted transcript echoes do not duplicate live event nodes | Transcript catches up after streaming | `src/shared/trace-engine.ts`, `src/apps/chat/trace.ts` | Implemented |
| REQ-005 Raw events are opt-in and bounded | Request raw tail for debugging | `src/apps/chat/web-app.ts`, `test/chat-trace-materialization.test.mjs` | Implemented |
| REQ-006 Live patches preserve unaffected node identity | Tool result patch | `src/shared/trace-engine.ts`, `test/trace-patch-identity.test.mjs` | Implemented |
| REQ-007 Compact terminal renders trace nodes as a readable conversation surface | Thinking hidden by default | `src/apps/chat-ui/src/session-views/compact-terminal/*`, including `TerminalLine.tsx` | Implemented |
| REQ-008 Terminal interaction stays stable during streaming | Inspect old output while tools run | `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`, `src/apps/chat-ui/src/components/useStickyVirtuoso.ts` | Implemented |
| REQ-009 Session view selection is bounded to active view ids | Unknown view id falls back to terminal | `src/apps/chat-ui/src/session-views/types.ts`, `src/apps/chat-ui/src/session-views/registry.tsx`, `src/apps/chat-ui/src/session-views/TraceSessionView.tsx` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/chat-trace-materialization.test.mjs`, `test/trace-patch-identity.test.mjs`, `test/chat-ui-integration.test.mjs`, `test/web-channel.test.mjs`, and the trace/terminal/session-view implementation files listed in Traceability. Session-view registry behavior is source-inspected from `src/apps/chat-ui/src/session-views/types.ts`, `src/apps/chat-ui/src/session-views/registry.tsx`, and `src/apps/chat-ui/src/session-views/TraceSessionView.tsx`; add a focused registry test if selectable session views become user-configurable.
