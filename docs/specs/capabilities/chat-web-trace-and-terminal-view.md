# Spec: Chat Web Trace and Terminal View

**Status:** Draft
**Created:** 2026-05-10
**Updated:** 2026-08-15
**Controller / Source:** Scheduled Pibo Source Specs Coverage
**Related docs:** [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Pibo Data Store and Chat Ingestion](./pibo-data-store-and-ingestion.md), [Pibo Session Routing](./pibo-session-routing.md), [Pibo Session Signals](./pibo-session-signals.md), [Yielded Run Control](./yielded-run-control.md), [Chat Web Trace V2 Fast Path](../changes/chat-web-trace-v2-fast-path/spec.md)

## Why

Chat Web is useful only if users can understand what a routed runtime did. The raw sources for a turn are split across Pibo product messages, normalized output events, optional adapter-provided native compatibility history, live stream frames, child sessions, yielded run notifications, compaction events, and session metadata. Users need one stable execution view that shows messages, thinking, tool calls, delegated agents, background runs, errors, and compactions in the right order without duplicating persisted echoes or losing live updates.

The current UI presents the active conversation through a compact terminal session view, while an older nested trace view remains dormant. This spec captures the behavior that must stay true for both the trace materialization contract and the active terminal projection.

The Trace V2 Fast Path change is now the default hot-path architecture for this capability: compact timeline pages, lazy payload refs, raw events as a separate debug API, and later formal live patches instead of full-history reloads.

## Goal

Pibo MUST materialize authenticated Chat Web trace data into stable ordered trace rows and render those rows as a compact, live-updating terminal view that preserves identity, ordering, access control, debuggability, and gateway responsiveness. The normal browser path MUST use Trace V2 timeline/payload/raw APIs instead of the old full-trace response.

## Background / Current State

The server builds trace views in `src/apps/chat/trace.ts` from Pibo Sessions, Pibo product history, normalized stored events, optional normalized adapter history, and session metadata. `src/apps/chat/data/history-query-service.ts` reads durable messages and externalized payloads. The generic trace engine in `src/shared/trace-engine.ts` and `src/shared/trace-history.ts` maps Pibo-owned history entries and output events to `PiboTraceNode` records without importing a harness package. Pi JSONL discovery, parsing, and pagination live only in `src/agent-runtimes/pi/history.ts`.

Chat Web exposes `/api/chat/trace/summary`, `/api/chat/trace/timeline`, `/api/chat/trace/payload/:payloadRef`, `/api/chat/trace/raw-events`, old compatibility `/api/chat/trace`, and a debug-only trace-at-sequence endpoint from `src/apps/chat/web-app.ts`. These endpoints require the authenticated web session, resolve only managed sessions, use ETags based on trace versions where applicable, page trace events, keep raw events separate, and cache bounded structural timeline pages without unbounded payload bodies.

The active frontend session view is the compact terminal in `src/apps/chat-ui/src/session-views/compact-terminal/*`. It derives terminal rows from Trace V2 timeline pages through a compatibility adapter, hides model reasoning unless enabled, groups routine exploration tools, shows profile/model/breadcrumb/session-derivation context, supports sticky scrolling and automatic older-history loading, preserves row identity during live updates, lazily reads large payload chunks on expansion, and lets users open linked sessions or fork from user-message rows.

## Scope

### In Scope

- Server-side trace summary, Trace V2 timeline, payload, raw-events, and bounded compatibility full trace API behavior.
- Materialization from Pibo product history, normalized adapter history, stored output events, live stream frames, child session metadata, and session status into `PiboTraceNode` trees.
- Trace node identity, ordering, deduplication, status, separate raw-event pagination, timeline cursor metadata, and versioning.
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

`/api/chat/trace/summary`, `/api/chat/trace/timeline`, `/api/chat/trace/payload/:payloadRef`, `/api/chat/trace/raw-events`, and compatibility `/api/chat/trace` call `requireSession` or validate the payload ref's session, resolve the requested Pibo Session through shared resource semantics, compute trace versions where applicable, return `ETag` and `x-pibo-trace-version` for summary/timeline, and return `304` for unchanged tail reads. Structural timeline pages are cached by session id, version, limit, and page cursor with byte budgets.

#### Acceptance

- A trace request for an inaccessible session fails instead of returning nodes or raw events.
- A matching `If-None-Match` request for an unchanged tail trace returns `304` when raw events are not requested.
- Trace cache entries are not reused across different versions, page sizes, or page cursors.
- Trace timeline page cache entries respect byte and count budgets.

#### Scenario: Unchanged trace summary

- GIVEN an authenticated user has a visible Pibo Session
- AND the client already holds the current trace version
- WHEN the client requests `/api/chat/trace/summary` with `If-None-Match`
- THEN the server returns `304` with the trace version headers and no JSON body.

### Requirement: Trace versions change when observable trace inputs change

The system MUST compute trace versions from the selected session and frozen runtime binding, related session metadata, product-history coverage, event progress, runtime status, optional native-history version, and latest stream id.

#### Current

`createTraceViewVersion` and `createFastTraceV2Version` hash selected session and binding fields, related parent/origin session fields, product-history coverage, event sequence markers, status, optional adapter history version, and latest stream id.

#### Acceptance

- A new stored event sequence or durable product message changes the trace version.
- A changed native-history version changes legacy compatibility traces without making native history a dependency for fresh sessions.
- A changed child or origin session relationship changes the trace version.
- A changed latest live stream id changes the trace version.

#### Scenario: Child session updates trace version

- GIVEN a root session trace has a delegated child session
- WHEN the child session metadata changes
- THEN the next trace summary version differs from the previous version.

### Requirement: Trace materialization produces stable ordered execution nodes

The system MUST convert Pibo-owned normalized history entries and Pibo output events into trace nodes with stable ids, stable keys, source labels, order keys, status, timestamps, inputs, outputs, errors, and parent-child relationships.

#### Current

`buildTraceViewFromEvents` projects product/native history messages, session-info entries, queued messages, turn starts/finishes, assistant and thinking deltas, final assistant and thinking messages, tool executions, subagent sessions, execution results, compactions, session errors, yielded run notifications, and async agent runs into `PiboTraceNode` values. `nestTraceNodes` and `compareTraceNodes` sort and nest nodes by timestamp, trace order, and id.

#### Acceptance

- User, assistant, reasoning, tool, delegation, async-agent, yielded-run, execution-command, compaction, and error nodes use the documented node types.
- Agent turn children appear under their turn when an event id allows parent linkage.
- Subagent tool calls link to the child Pibo Session when an explicit child-session event or likely child session exists.
- Nodes with equal timestamps remain deterministic through trace order and id comparison.

#### Scenario: Tool call lifecycle

- GIVEN stored events for an agent turn with a tool start, tool update, and tool finish
- WHEN the trace is built
- THEN one tool node exists for the tool call id, its input comes from arguments, its output comes from the final result, and its status is `done` or `error` based on the final event.

### Requirement: Normal product history is runtime neutral

The system MUST reconstruct new Pibo-routed turns from Pibo-owned durable messages, normalized terminal events, and payload storage without locating or parsing a harness-native transcript.

#### Current

`ChatHistoryQueryService` reads `chat_messages` and hydrates externalized content through `PayloadStore`. `ChatTimelineQueryService` hydrates externalized terminal event payloads before projection. Chat Web requests adapter history only for migrated/forked compatibility sessions or a validated runtime-history cursor. Every existing session at the schema-v5 migration boundary receives a compatibility marker; sessions created after migration do not.

#### Acceptance

- Fresh Pi and non-Pi sessions can render user, assistant, reasoning, and tool history after restart with native history reads disabled.
- Large externalized message, reasoning, and tool values render at full fidelity rather than as stored previews.
- Old Pi sessions read JSONL only through the frozen binding's Pi history provider.
- A missing native transcript does not hide surviving product history or create a replacement native conversation.
- Runtime-history cursors are opaque to product code and bound to the Pibo Session, configured runtime instance, and adapter.

#### Scenario: Fresh Pi trace avoids JSONL

- GIVEN a fresh Pi-backed Pibo Session completes a routed turn
- AND native history inspection/read functions fail if called
- WHEN Chat Web requests summary, timeline, and compatibility trace data
- THEN the turn renders from Pibo product data and no native history function is called.

### Requirement: Persisted history does not duplicate event or live nodes

The system MUST avoid showing duplicate trace rows when Pibo product history or adapter-provided native history already represents the same content as stored or live events.

#### Current

The trace engine identifies product versus native history. Product history suppresses duplicate assistant output while retaining terminal reasoning, tool, and lifecycle events that are not represented in `chat_messages`. Native compatibility history suppresses full transcript echoes and stale tool-call events. Running sessions keep open delta content until durable history catches up.

#### Acceptance

- A completed assistant response in product or native history is not duplicated by older assistant output events.
- Product-history reconstruction retains terminal reasoning and tool results from normalized events.
- Running sessions keep open delta content visible until durable history catches up.
- Stale tool events do not reappear as duplicate tool rows after native history persistence.

#### Scenario: Product history catches up after streaming

- GIVEN a running assistant message was shown from live deltas
- WHEN Pibo persists its terminal assistant message and the trace rebuilds while the session is idle
- THEN the terminal shows one assistant message and retains its associated reasoning and tools.

### Requirement: Raw events are opt-in and bounded

The system MUST omit raw event payloads from the normal timeline and expose raw events only through a separate bounded debug API.

#### Current

`/api/chat/trace/raw-events` returns bounded raw event pages with cursor metadata. Default `/api/chat/trace/timeline` responses contain no raw events. Compatibility `/api/chat/trace` can still expose a bounded raw tail when explicitly requested for debug use, but normal Chat Web no longer uses it.

#### Acceptance

- Default trace responses contain no raw events.
- Raw Events UI requests `/api/chat/trace/raw-events` instead of enlarging the timeline.
- Page metadata includes enough information to request older events when older events exist.

#### Scenario: Request raw tail for debugging

- GIVEN a session has more than 80 trace events
- WHEN the client requests `/api/chat/trace/raw-events?limit=80`
- THEN the response includes at most the latest 80 raw events and the structural trace remains available.

### Requirement: Default timeline keeps large payloads cold

The default session view MUST render from compact Trace V2 timeline pages that include only bounded inline-small payloads, previews, and payload refs. Large tool outputs, large arguments, oversized reasoning, and raw payloads MUST be fetched explicitly.

#### Current

`/api/chat/trace/timeline` returns `TraceTimelinePage` rows derived from bounded current sources. Rows may include `inlinePayloads` for small values, but large values are written to the payload store and exposed as `payloadRefs`. `TerminalDetails` fetches the first payload chunk from `/api/chat/trace/payload/:payloadRef` when an expanded row references a payload.

#### Acceptance

- A 10 MB tool output does not make the timeline response large.
- Expanding a payload-ref row performs a payload request.
- The old V1 full trace endpoint is not called by the default session view.
- Over-budget V1 compatibility responses fail safely with guidance to use Trace V2.

#### Scenario: Expand large tool output

- GIVEN a timeline row has an output payload ref
- WHEN the user expands the row details
- THEN Chat Web fetches a bounded payload chunk
- AND the base timeline remains unchanged.

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

- Missing or removed native history still produces a trace from Pibo product messages, normalized events, and session metadata.
- A runtime-history cursor presented for a different Pibo Session, runtime instance, or adapter is rejected.
- Sessions with no trace nodes return an empty trace and the terminal shows an empty state.
- Unknown output event types are ignored rather than rendered as malformed nodes.
- Internal session operations are not shown as user-facing execution-command rows.
- Raw-event and page-size query parameters are clamped to safe limits.
- Duplicate stream frames or repeated stored event sequences are deduplicated.
- A tool error is visible as a tool error but does not imply the whole runtime failed unless a session/runtime error exists.

## Constraints

- **Compatibility:** Trace node types and fields are consumed by Chat Web, debug tooling, and tests; additions must be backward-compatible.
- **Security / Privacy:** Trace APIs must require authenticated access and must not expose raw events by default.
- **Performance:** The server should page event reads, cache bounded structural timeline pages, avoid loading raw payloads unless requested, and let the terminal virtualize long sessions.
- **Identity:** Live updates should preserve unchanged node and row identity to avoid unnecessary rerenders and lost expansion state.
- **Source of Truth:** Current Pibo Session records, Pibo product history, normalized events, frozen runtime bindings, and runtime status are authoritative for product-visible history; native transcripts remain adapter-owned compatibility and resume state.

## Success Criteria

- [ ] SC-001: Trace summary and trace APIs reject unauthorized sessions and return trace version headers for authorized sessions.
- [ ] SC-002: Trace rebuilds produce deterministic node ids, nesting, ordering, statuses, inputs, outputs, errors, and linked sessions for product, adapter-history, and event sources.
- [ ] SC-003: Product/native persisted content and event-log/live content do not create duplicate terminal rows after a turn settles.
- [ ] SC-004: Raw events are absent from default timeline responses and bounded when requested from the raw-events endpoint.
- [ ] SC-005: Single-event patches preserve object identity for unaffected nodes.
- [ ] SC-006: The compact terminal renders visible node kinds, hides thinking when configured, preserves expansion, follows output only when sticky, and distinguishes tool errors from system errors.
- [ ] SC-007: Session-view resolution exposes only active terminal/workflow views, defaults unknown ids to terminal, and keeps the nested trace view dormant unless deliberately reactivated.
- [x] SC-008: Default Chat Web trace rendering uses Trace V2 timeline/payload/raw APIs and no longer uses old `/api/chat/trace` as the hot path.
- [x] SC-009: Large payloads remain cold by default and load through payload refs on expansion.

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
| REQ-004 Persisted history does not duplicate event or live nodes | Product history catches up after streaming | `src/shared/trace-engine.ts`, `src/shared/trace-history.ts`, `src/apps/chat/trace.ts` | Implemented |
| REQ-005 Raw events are opt-in and bounded | Request raw tail for debugging | `src/apps/chat/web-app.ts`, `test/chat-trace-materialization.test.mjs` | Implemented |
| REQ-006 Live patches preserve unaffected node identity | Tool result patch | `src/shared/trace-engine.ts`, `test/trace-patch-identity.test.mjs` | Implemented |
| REQ-007 Compact terminal renders trace nodes as a readable conversation surface | Thinking hidden by default | `src/apps/chat-ui/src/session-views/compact-terminal/*`, including `TerminalLine.tsx` | Implemented |
| REQ-008 Terminal interaction stays stable during streaming | Inspect old output while tools run | `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx`, `src/apps/chat-ui/src/components/useStickyVirtuoso.ts` | Implemented |
| REQ-009 Session view selection is bounded to active view ids | Unknown view id falls back to terminal | `src/apps/chat-ui/src/session-views/types.ts`, `src/apps/chat-ui/src/session-views/registry.tsx`, `src/apps/chat-ui/src/session-views/TraceSessionView.tsx` | Implemented |
| REQ-010 Default timeline keeps large payloads cold | Expand large tool output | `src/apps/chat/trace-v2.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/tracing/use-session-trace-page.ts`, `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx` | Implemented in v1.7.0 |
| REQ-011 Normal product history is runtime neutral | Fresh Pi trace avoids JSONL | `src/agent-runtime/history.ts`, `src/apps/chat/data/history-query-service.ts`, `src/agent-runtimes/pi/history.ts`, `test/agent-runtime-history.test.mjs`, `test/data-v2-ingest-service.test.mjs`, `test/web-channel.test.mjs` | Implemented |

## Verification Basis

Current behavior is covered or illustrated by `test/agent-runtime-history.test.mjs`, `test/data-v2-ingest-service.test.mjs`, `test/chat-trace-materialization.test.mjs`, `test/trace-patch-identity.test.mjs`, `test/chat-ui-integration.test.mjs`, `test/debug-cli.test.mjs`, `test/web-channel.test.mjs`, and the trace/terminal/session-view implementation files listed in Traceability. Session-view registry behavior is source-inspected from `src/apps/chat-ui/src/session-views/types.ts`, `src/apps/chat-ui/src/session-views/registry.tsx`, and `src/apps/chat-ui/src/session-views/TraceSessionView.tsx`; add a focused registry test if selectable session views become user-configurable.
