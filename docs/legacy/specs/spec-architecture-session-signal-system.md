---
title: Pibo Session Signal System Specification
version: 0.1
date_created: 2026-05-06
last_updated: 2026-05-06
owner: Pibo maintainers
tags: [architecture, signals, sessions, chat, observability, performance]
---

# Introduction

This specification defines the target architecture for a Pibo-owned session signal system. The signal system answers one product question:

> What is this session tree doing right now?

The current system can answer this question only indirectly. Chat Web reconstructs live state from routed events, trace projections, bootstrap session status, yielded-run notifications, and browser stream overlays. That works for simple turns, but it becomes ambiguous when a session streams text, executes tools, delegates to subagents, starts yielded runs, retries, compacts, or has nested child sessions.

The signal system introduces one canonical live-state projection for sessions and their descendants. Trace and event logs remain the historical record. Signals become the source of truth for current activity, status badges, working animations, active-child indicators, error badges, waiting states, and future orchestration UI.

## 1. Purpose & Scope

This specification covers:

- The product-level signal model for Pibo sessions.
- The signal graph that represents sessions, turns, messages, tools, subagents, yielded runs, compaction, retry, and queues.
- Status vocabulary and aggregation rules.
- Runtime, router, run-registry, and Chat Web integration boundaries.
- API and streaming contracts needed by Chat Web and future clients.
- Persistence and recovery expectations.
- Performance, scalability, and extensibility requirements.
- Acceptance criteria for a future implementation.

This specification does not prescribe the exact implementation sequence. A separate implementation plan should derive phases, migrations, and code tasks from these requirements.

## 2. Background

Pibo already emits useful lifecycle events. Pi Coding Agent exposes agent lifecycle events, streaming events, tool execution events, and runtime state such as `isStreaming` and `pendingToolCalls`. Pibo wraps these into product events such as `message_queued`, `message_started`, `assistant_delta`, `tool_execution_started`, `tool_execution_finished`, `subagent_session`, `message_finished`, and `session_error`. Chat Web stores and projects those events into traces and read models.

The missing piece is a first-class model for live activity. Today, each consumer infers status for itself. A session may be shown as idle because the parent message finished even though a yielded run continues. A parent may appear settled even though a child subagent is still working. A tool may be visible in the trace but not represented in the session status. The field `activeTools` is especially misleading because it means configured/enabled tools, not currently executing tools.

The signal system fixes this by projecting normalized lifecycle facts into one graph. Consumers query or subscribe to that graph instead of deriving current state from historical traces.

## 3. Definitions

- **Signal System**: The product-owned subsystem that projects lifecycle events and imperative runtime transitions into live session state.
- **Signal Graph**: A directed graph of live and recently terminal signal nodes, keyed by stable ids and rooted at a Pibo Session.
- **Signal Node**: One observable unit of current activity, such as a session, turn, tool call, child session, yielded run, compaction, or retry.
- **Signal Snapshot**: A complete view of one session or session tree at a specific version.
- **Signal Patch**: A small, ordered change that moves a snapshot from one version to the next.
- **Session Tree**: A root Pibo Session and all descendant sessions linked by parent-child session relationships.
- **Active Descendant**: Any child, grandchild, tool, run, compaction, retry, or queue node whose status is non-terminal.
- **Settled**: A session tree state in which no node is queued, starting, running, streaming, waiting, retrying, compacting, or blocked.
- **Historical Trace**: The persisted reconstruction of what happened. It is not the live source of truth.

## 4. Design Goals

### 4.1 One live source of truth

Pibo MUST expose one canonical answer for live session state. Chat Web and future clients MUST NOT need to merge bootstrap status, trace status, SSE overlays, run notifications, and delayed refreshes to decide whether a session is working.

### 4.2 Session-tree awareness

Signals MUST represent a whole session tree, not only one flat session. A parent session can be locally idle while a child or yielded run is active. The system MUST expose both local state and recursive aggregate state.

### 4.3 Product-owned semantics

The Pibo layer MUST own signal semantics. Pi Coding Agent should continue to emit raw lifecycle events. Pibo should normalize these events into product concepts such as session, turn, tool call, subagent, run, compaction, retry, and queue.

### 4.4 Clear separation from history

Signals represent what is happening now. Traces represent what happened before. The signal system MUST NOT replace the event log or trace engine, and the trace engine MUST NOT remain the source of truth for current activity.

### 4.5 Fast UI updates

The UI MUST receive low-latency status changes without polling full traces. A working animation, active-child badge, or error badge should update from signal patches.

### 4.6 Bounded cost

The signal system MUST avoid unbounded memory, storage, and network growth. It MUST persist important lifecycle edges, not every text delta. It MUST compact or evict terminal nodes after they no longer affect live status.

### 4.7 Extensibility

The model MUST allow new activity kinds without rewriting every consumer. Future examples include pause/resume, human approval, remote jobs, MCP server activity, project workflows, model handoffs, background indexing, and external channel connections.

## 5. Non-Goals

- The signal system does not store full assistant text, reasoning text, or tool output payloads.
- The signal system does not define trace rendering layout.
- The signal system does not require immediate changes in Pi Coding Agent.
- The signal system does not make every transient provider delta durable.
- The signal system does not decide final UX copy for every badge; it provides the state needed by UI components.

## 6. Requirements

### 6.1 Core requirements

- **SIG-001**: Pibo MUST provide a canonical signal projection for each routed Pibo Session.
- **SIG-002**: Pibo MUST provide a recursive signal projection for a session tree.
- **SIG-003**: Every signal snapshot MUST include a monotonic version.
- **SIG-004**: Every signal patch MUST identify the snapshot version it advances from and to.
- **SIG-005**: Signal patches MUST be ordered per root session tree.
- **SIG-006**: Consumers MUST be able to recover from missed patches by requesting a fresh snapshot.
- **SIG-007**: Signal state MUST distinguish local session state from descendant aggregate state.
- **SIG-008**: Signal state MUST represent yielded runs as first-class nodes.
- **SIG-009**: Signal state MUST represent subagent sessions as first-class nodes linked to parent tool calls when available.
- **SIG-010**: Signal state MUST represent currently executing tool calls, not only configured tools.
- **SIG-011**: Pibo MUST rename or supplement `activeTools` with a clearly named enabled-tool field. `activeTools` MUST NOT be used for currently executing tools unless its semantics change with a migration.
- **SIG-012**: Pibo MUST emit or project an explicit state change when `processing` becomes false. Consumers MUST NOT infer this only from `message_finished`.
- **SIG-013**: Run-registry transitions MUST produce signal updates.
- **SIG-014**: Compaction and retry lifecycle MUST produce signal updates.
- **SIG-015**: Session disposal and abort must produce terminal or interrupted signal states.

### 6.2 UI requirements

- **SIG-020**: Chat Web session status indicators MUST be able to read from signals.
- **SIG-021**: The compact-terminal working animation MUST be controlled by signal activity, not by trace inference alone.
- **SIG-022**: Session tree UI MUST be able to show active descendant count, error descendant count, and blocked/waiting indicators.
- **SIG-023**: Parent sessions MUST be able to show child activity even when the parent is not currently streaming text.
- **SIG-024**: UI components MUST be able to subscribe to a root session tree and receive patches for all descendants.
- **SIG-025**: UI components MUST be able to request a single-session snapshot when they do not need the full tree.

### 6.3 Persistence and recovery requirements

- **SIG-030**: Pibo MUST persist important lifecycle edges needed for recovery and audit.
- **SIG-031**: Pibo SHOULD persist latest snapshots or enough lifecycle state to rebuild them after a gateway restart.
- **SIG-032**: On startup, any previously active node whose true runtime state cannot be proven MUST become `unknown`, `interrupted`, `cancelled`, or another explicit non-active recovery state. It MUST NOT silently remain `running` forever.
- **SIG-033**: Yielded runs MUST recover from their existing registry state when possible.
- **SIG-034**: Signal persistence MUST NOT store every assistant, thinking, or tool-output delta.

### 6.4 Performance requirements

- **SIG-040**: Signal projection MUST be incremental. Processing one event SHOULD update only affected nodes and ancestors.
- **SIG-041**: Signal patches SHOULD be small enough for frequent UI updates.
- **SIG-042**: High-volume text deltas MUST NOT produce high-volume signal patches unless they change activity state.
- **SIG-043**: Recursive aggregate updates MUST scale with the depth of the changed path, not with the size of the entire session tree.
- **SIG-044**: The signal registry MUST bound memory for terminal nodes.
- **SIG-045**: API endpoints MUST support efficient snapshot fetches for large session trees.
- **SIG-046**: Signal streaming MUST support reconnect without replaying unbounded history.
- **SIG-047**: Signal code MUST avoid blocking the model runtime path on slow web clients.

### 6.5 Extensibility requirements

- **SIG-050**: New signal node kinds MUST be addable without breaking old clients.
- **SIG-051**: Unknown node kinds and statuses MUST be safely renderable by clients.
- **SIG-052**: Signal metadata MUST be namespaced or typed so new producers can attach details without polluting the core contract.
- **SIG-053**: Aggregation rules MUST be explicit and testable for each status.
- **SIG-054**: The signal model MUST support future pause, approval, blocked, and external-job states.

## 7. Signal Graph Model

The signal graph contains nodes. Each node represents one observable entity. Nodes have stable identity, parentage, kind, status, timestamps, optional error information, and metadata.

### 7.1 Node kinds

The first implementation SHOULD support these node kinds:

| Kind | Meaning |
| --- | --- |
| `session` | A Pibo Session. |
| `queue` | Queued user/service messages for a session. |
| `message` | One accepted message input. |
| `turn` | One model/runtime turn caused by a message. |
| `assistant_stream` | Visible assistant text streaming for a turn. |
| `thinking_stream` | Reasoning/thinking stream for a turn. |
| `tool_call` | One tool call and its execution lifecycle. |
| `subagent_session` | A parent-to-child session delegation edge. |
| `yielded_run` | A yielded/background run managed by `PiboRunRegistry`. |
| `compaction` | A compaction lifecycle activity. |
| `retry` | An automatic retry lifecycle activity. |

The model MAY later add `approval`, `pause`, `external_job`, `connection`, `project_task`, or `mcp_activity`.

### 7.2 Node identity

Every node MUST have a stable id. The id SHOULD be deterministic when an upstream id exists.

Examples:

- Session node: `session:<piboSessionId>`
- Queue node: `queue:<piboSessionId>`
- Tool node: `tool:<piboSessionId>:<toolCallId>`
- Subagent edge node: `subagent:<parentPiboSessionId>:<childPiboSessionId>`
- Yielded run node: `run:<runId>`
- Compaction node: `compaction:<piboSessionId>:<sequence>`
- Retry node: `retry:<piboSessionId>:<attempt>`

### 7.3 Node shape

```ts
type SignalNodeKind =
  | "session"
  | "queue"
  | "message"
  | "turn"
  | "assistant_stream"
  | "thinking_stream"
  | "tool_call"
  | "subagent_session"
  | "yielded_run"
  | "compaction"
  | "retry"
  | string;

type SignalStatus =
  | "idle"
  | "queued"
  | "starting"
  | "running"
  | "streaming"
  | "waiting"
  | "blocked"
  | "retrying"
  | "compacting"
  | "pausing"
  | "paused"
  | "done"
  | "error"
  | "cancelled"
  | "disposed"
  | "interrupted"
  | "unknown"
  | string;

type SignalNode = {
  id: string;
  kind: SignalNodeKind;
  status: SignalStatus;
  rootPiboSessionId: string;
  piboSessionId?: string;
  parentNodeId?: string;
  parentPiboSessionId?: string;
  childPiboSessionId?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  error?: SignalError;
  metadata?: Record<string, unknown>;
};

type SignalError = {
  message: string;
  code?: string;
  source?: "pi" | "pibo" | "tool" | "run" | "network" | "unknown";
  retryable?: boolean;
};
```

### 7.4 Status semantics

Statuses MUST have clear activity semantics:

| Status | Active | Terminal | Meaning |
| --- | --- | --- | --- |
| `idle` | no | no | Session has no local active work. |
| `queued` | yes | no | Work is accepted but not started. |
| `starting` | yes | no | Work is being prepared. |
| `running` | yes | no | Work is executing. |
| `streaming` | yes | no | Text or reasoning is streaming. |
| `waiting` | yes | no | Waiting for a child, tool, run, provider, or external condition. |
| `blocked` | yes | no | Cannot proceed without intervention. |
| `retrying` | yes | no | Automatic retry is active. |
| `compacting` | yes | no | Context compaction is active. |
| `pausing` | yes | no | Pause has been requested but not settled. |
| `paused` | no | no | Execution is intentionally paused. |
| `done` | no | yes | Activity completed successfully. |
| `error` | no | yes | Activity failed. |
| `cancelled` | no | yes | Activity was cancelled. |
| `disposed` | no | yes | Session or activity was disposed. |
| `interrupted` | no | yes | Activity was active before process loss and cannot be resumed. |
| `unknown` | no | no | State cannot be determined. |

Clients MUST treat unknown statuses conservatively. Unknown active semantics MUST NOT break rendering.

## 8. Session Aggregate Model

A session aggregate summarizes local and descendant state for one Pibo Session.

```ts
type SessionSignalSnapshot = {
  piboSessionId: string;
  piSessionId?: string;
  parentPiboSessionId?: string;
  rootPiboSessionId: string;
  version: number;
  updatedAt: string;

  localStatus: SignalStatus;
  aggregateStatus: SignalStatus;
  phase?: "queued" | "prompting" | "streaming" | "tools" | "subagent" | "run" | "compaction" | "retry" | "blocked";

  queuedMessages: number;
  currentMessageId?: string;
  currentTurnId?: string;

  isLocalActive: boolean;
  hasActiveDescendant: boolean;
  isTreeActive: boolean;
  isSettled: boolean;
  hasError: boolean;
  hasErrorDescendant: boolean;
  hasBlockedDescendant: boolean;

  activeToolCalls: ToolCallSignalSummary[];
  activeRuns: RunSignalSummary[];
  activeChildren: ChildSessionSignalSummary[];
  errors: SignalError[];
};
```

The aggregate MUST preserve both local and tree-level meaning. For example, a parent can have `localStatus: "idle"` and `aggregateStatus: "running"` when a child subagent is still active.

## 9. Aggregation Rules

The signal registry MUST compute aggregate state from nodes and descendants with deterministic rules.

1. Terminal errors outrank successful completion for error badges.
2. `blocked` outranks `waiting`, `running`, and `queued` for aggregate status.
3. `retrying` and `compacting` outrank generic `running` because they explain what the runtime is doing.
4. `streaming` outranks `running` for local UI copy when visible text or reasoning is streaming.
5. `running` outranks `queued` when both are true.
6. `queued` applies when accepted work exists but no active turn has started.
7. `idle` applies only when no local active node exists.
8. `done`, `error`, `cancelled`, `disposed`, and `interrupted` are terminal node statuses, but a session aggregate may still be active if another node remains active.
9. A session tree is settled only when all descendants are inactive and no blocked/paused state requires attention.
10. A parent MUST count active descendants recursively, not only direct children.

The implementation MUST keep these rules in tests. UI code SHOULD consume derived booleans instead of reimplementing the hierarchy.

## 10. Event and Projection Architecture

### 10.1 Ownership

The Pibo product layer owns the signal projection. It sits above Pi Coding Agent and below Chat Web.

The projection SHOULD be implemented as a service such as:

- `src/signals/types.ts`
- `src/signals/registry.ts`
- `src/signals/projector.ts`

The exact file names may differ, but the subsystem MUST have a clear boundary and tests.

### 10.2 Inputs

The signal projector MUST consume normalized lifecycle facts from these sources:

- `PiboOutputEvent` from routed sessions.
- Explicit routed-session state changes that are not currently emitted, especially `processing=false`.
- `PiboRunRegistry` transitions.
- Session creation, disposal, and parent-child relationships from `PiboSessionStore` and router actions.
- Compaction and retry lifecycle events from Pi session wrappers when exposed through Pibo.

### 10.3 Outputs

The signal subsystem MUST expose:

- In-process snapshot reads.
- In-process patch subscriptions.
- HTTP snapshot APIs for Chat Web.
- SSE or equivalent browser stream patches for live updates.
- Optional persisted lifecycle events for recovery.

### 10.4 Domain events vs UI frames

Internally, Pibo SHOULD prefer domain events such as `tool_lifecycle_changed`, `run_lifecycle_changed`, and `session_lifecycle_changed`. Externally, Chat Web SHOULD receive snapshots and patches. UI-specific frames MUST NOT be the only representation of signal state.

## 11. API Contract

The Chat Web API SHOULD expose these endpoints or equivalent routes:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/chat/signals/session/:piboSessionId` | Return one session aggregate and relevant local nodes. |
| `GET /api/chat/signals/tree/:piboSessionId` | Return a recursive tree snapshot rooted at the given session. |
| `GET /api/chat/signals/events?rootPiboSessionId=...` | Stream signal patches for one session tree. |

Snapshot response:

```ts
type SignalSnapshotResponse = {
  rootPiboSessionId: string;
  version: number;
  generatedAt: string;
  sessions: Record<string, SessionSignalSnapshot>;
  nodes: Record<string, SignalNode>;
};
```

Patch stream event:

```ts
type SignalPatchEvent = {
  type: "signal_patch";
  rootPiboSessionId: string;
  fromVersion: number;
  toVersion: number;
  generatedAt: string;
  upserts?: SignalNode[];
  removes?: string[];
  sessionSnapshots?: SessionSignalSnapshot[];
};
```

If a client receives a patch whose `fromVersion` does not match its local version, it MUST discard local signal state for that root and fetch a fresh snapshot.

## 12. Persistence Strategy

The system SHOULD use two storage layers:

1. An in-memory registry for exact live state and low-latency patches.
2. A durable lifecycle journal or latest-snapshot store for recovery.

The durable layer SHOULD persist:

- Session/message/turn/tool/run/subagent start edges.
- Status changes that affect activity semantics.
- Terminal states: done, error, cancelled, disposed, interrupted.
- Compaction and retry start/end.
- Parent-child session links when not already durable elsewhere.

The durable layer SHOULD NOT persist:

- Every assistant text delta.
- Every thinking delta.
- Large tool outputs.
- High-frequency progress payloads unless they change status or a bounded summary.

On process restart, the registry MUST rebuild as much as possible. Any node that was active before shutdown and cannot be verified as active MUST be marked with a recovery state such as `interrupted` or `unknown`.

## 13. Performance Requirements And Constraints

### 13.1 Projection cost

Projection must run in the runtime path, so it must be cheap. One event should update the affected node, its owning session aggregate, and ancestors up to the root. It should not rescan all sessions or rebuild full traces.

### 13.2 Patch size

Signal patches should contain only changed nodes and changed session aggregates. Text streaming should not emit signal patches for every token unless the signal state changes from, for example, `running` to `streaming` or `streaming` to `done`.

### 13.3 Memory bounds

The registry must evict or compact terminal detail nodes. A reasonable policy is to keep active nodes, recently terminal nodes, and summaries needed for visible badges. Full history belongs in the event log and trace engine.

### 13.4 Large trees

Aggregation must scale with nesting depth. If a grandchild tool changes, the registry should update that tool, the grandchild session, each ancestor aggregate, and the root version. It should not traverse unrelated branches.

### 13.5 Client fanout

Slow browser clients must not block model execution. Patch delivery should use buffering with limits. If a client falls behind, the server should ask it to resync from a snapshot rather than retaining unlimited patches.

## 14. Extensibility Model

The signal model must remain open. New node kinds and statuses may appear. Clients should render unknown kinds with generic labels and should rely on common fields: `kind`, `status`, `updatedAt`, `error`, and aggregate booleans.

Metadata must be optional. Producers may add typed metadata for specialized UI, but core status rendering must work without it.

Future examples the model should support:

- Pause and resume.
- Human approval gates.
- Blocking tool review.
- Background project tasks.
- Remote deployment jobs.
- MCP server connection state.
- External browser automation jobs.
- Multi-model handoffs.
- Per-room or per-project aggregate activity.

## 15. Integration With Existing Systems

### 15.1 Pi Coding Agent

Pi Coding Agent should remain mostly unchanged for the first iteration. Pibo should consume existing Pi lifecycle events and session wrapper state. If gaps remain later, Pi may expose a richer activity snapshot, but Pibo should not depend on that for the initial signal system.

Useful Pi facts include:

- `isStreaming`
- `pendingToolCalls`
- streaming message state
- error state
- compaction state
- retry attempt
- pending queued message counts

### 15.2 Pibo router and routed sessions

`RoutedSession` and `PiboSessionRouter` should emit or directly project all message lifecycle and processing transitions. The transition to not-processing must become observable.

### 15.3 Subagents

Generated subagent tools must create a child-session signal edge. The edge should link:

- parent Pibo Session ID
- parent tool call id, when available
- generated tool name
- configured subagent name
- child Pibo Session ID
- thread key, when available

Parent aggregates must include child activity recursively.

### 15.4 Yielded runs

`PiboRunRegistry` must publish lifecycle transitions. Service messages may remain for agent context, but Chat Web must not depend on parsing those messages for live run state.

Run signals should include:

- run id
- owner Pibo Session ID
- wrapped tool name
- completion policy
- status
- started/completed timestamps
- error summary
- consumed/acknowledged state when relevant to UI

### 15.5 Chat Web

Chat Web should use signals for current activity and traces for history. The read model may cache signal snapshots, but it should not independently invent conflicting status semantics.

The UI should use signal data for:

- session list status
- session tree active badges
- compact terminal working footer
- active child indicators
- yielded run badges
- compaction/retry indicators
- blocked/error states

## 16. Compatibility And Migration Requirements

The implementation must preserve existing event logs and traces. New signals should be additive at first.

Migration should observe these constraints:

- Existing clients that know only `idle | running | error` must continue to work during migration.
- New clients may map rich statuses to old status labels where needed.
- `activeTools` must not silently change meaning without a compatibility path.
- Signal APIs should tolerate sessions that predate the signal system.
- Replayed historical events may produce partial signal snapshots; unknown or interrupted states are acceptable when live truth is unavailable.

## 17. Security And Access Control

Signal APIs must enforce the same session access rules as Chat Web session and trace APIs. A user who cannot read a session must not read its signal nodes, child links, run ids, tool metadata, errors, or aggregate state.

Signal metadata may contain sensitive tool names, paths, arguments, or error summaries. API responses must follow existing owner-scope and authentication checks.

## 18. Observability And Debugging

The implementation should include developer-facing diagnostics:

- Dump signal snapshot for one session.
- Dump signal tree for one root.
- Show raw lifecycle inputs that last changed a node.
- Show version, subscriber count, and patch drop/resync counts.
- Detect stuck active nodes older than a configured threshold.

Diagnostics should support the existing progressive-discovery CLI style if exposed through CLI commands.

## 19. Acceptance Criteria

A future implementation satisfies this specification when:

1. A root session snapshot shows local state, descendant state, active tools, active runs, active children, errors, and aggregate booleans.
2. A parent session remains tree-active while any child subagent or yielded run is active.
3. Run transitions update the signal graph without parsing service messages.
4. Tool execution start and finish update currently executing tool nodes.
5. Compaction and retry states are visible as signals.
6. `processing=false` produces an explicit signal update.
7. Chat Web can drive the working animation from signal activity.
8. A browser can reconnect, fetch a snapshot, and continue from later patches.
9. Terminal nodes do not grow memory without bound.
10. A gateway restart does not leave stale nodes permanently running.
11. Unknown future node kinds do not break existing clients.
12. Tests cover aggregation rules for nested sessions at least three levels deep.

## 20. Open Questions

- Should `paused` count as settled for all UIs, or should some surfaces treat it as requiring attention?
- Should child errors automatically mark parent aggregates as error, or should acknowledgement policy control that?
- How long should recently terminal nodes remain in memory?
- Should signal snapshots be stored in the existing Chat Web event database or in a separate signal store?
- Should the gateway expose signal state over the local TCP protocol as well as HTTP/SSE?
- What exact legacy mapping should convert rich statuses back to `idle | running | error` during migration?

## 21. North Star

Pibo should make live activity explicit. A client should ask one subsystem what a session tree is doing and receive a precise, current answer. The trace can then stay focused on history, while the signal graph owns the present.
