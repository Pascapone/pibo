---
title: Pibo Session Signal System Implementation Plan
version: 0.1
date_created: 2026-05-06
last_updated: 2026-05-06
owner: Pibo maintainers
tags: [implementation-plan, signals, sessions, chat, notifications, traces]
related_specs:
  - spec/spec-architecture-session-signal-system.md
---

# Introduction

This plan turns the Session Signal System specification into implementation work. It focuses on the code we must add, the services we must change, and the places where current UI state is derived from traces or notification messages and should instead come from signals.

The target is not a large one-shot rewrite. The target is a staged migration that adds a stable signal interface first, then moves Chat Web and notification flows onto it, then removes duplicated status derivation.

## 1. Implementation Goals

1. Create a first-class `PiboSignalRegistry` that owns live session state.
2. Add a typed, extensible signal interface for new signal producers.
3. Publish run, tool, subagent, message, compaction, retry, abort, dispose, and queue changes into signals.
4. Replace run-notification parsing as a UI live-state source.
5. Replace trace-derived activity status with signal-derived activity status.
6. Keep traces as historical rendering only.
7. Preserve existing behavior during migration.
8. Keep projection fast, incremental, and bounded.

## 2. New Signal Subsystem

Add a new subsystem under `src/signals/`.

### 2.1 Files to add

- `src/signals/types.ts`
- `src/signals/registry.ts`
- `src/signals/projector.ts`
- `src/signals/aggregate.ts`
- `src/signals/events.ts`
- `src/signals/store.ts` or `src/signals/persistence.ts`
- `src/signals/test-utils.ts` if tests need builders

### 2.2 Public TypeScript interface

The core interface should be small and stable:

```ts
export type PiboSignalKind =
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

export type PiboSignalStatus =
  | "idle"
  | "queued"
  | "starting"
  | "running"
  | "streaming"
  | "waiting"
  | "blocked"
  | "retrying"
  | "compacting"
  | "paused"
  | "done"
  | "error"
  | "cancelled"
  | "disposed"
  | "interrupted"
  | "unknown"
  | string;

export type PiboSignalNode = {
  id: string;
  kind: PiboSignalKind;
  status: PiboSignalStatus;
  rootPiboSessionId: string;
  piboSessionId?: string;
  parentNodeId?: string;
  parentPiboSessionId?: string;
  childPiboSessionId?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  error?: PiboSignalError;
  metadata?: Record<string, unknown>;
};

export type PiboSignalPatch = {
  rootPiboSessionId: string;
  fromVersion: number;
  toVersion: number;
  generatedAt: string;
  upserts: PiboSignalNode[];
  removes: string[];
  sessionSnapshots: PiboSessionSignalSnapshot[];
};

export interface PiboSignalRegistry {
  project(event: PiboSignalInput): PiboSignalPatch | undefined;
  snapshotSession(piboSessionId: string): PiboSignalSnapshot;
  snapshotTree(rootPiboSessionId: string): PiboSignalSnapshot;
  subscribe(rootPiboSessionId: string, listener: PiboSignalListener): () => void;
  registerProducer(producer: PiboSignalProducer): void;
}
```

### 2.3 Extensible producer interface

Signals must be easy to extend. Add a producer interface that converts domain-specific facts into generic node updates.

```ts
export type PiboSignalInput =
  | { type: "pibo_output"; event: PiboOutputEvent; session?: PiboSession }
  | { type: "session_created"; session: PiboSession }
  | { type: "session_disposed"; piboSessionId: string; reason?: string }
  | { type: "session_processing_changed"; piboSessionId: string; processing: boolean; queuedMessages: number }
  | { type: "run_changed"; run: PiboRunSnapshot; previousStatus?: PiboRunStatus; reason?: string }
  | { type: "run_removed"; runId: string; ownerPiboSessionId: string }
  | { type: "queue_changed"; piboSessionId: string; queuedMessages: number }
  | { type: "recovery"; piboSessionId: string; reason: string }
  | { type: string; [key: string]: unknown };

export interface PiboSignalProducer {
  readonly name: string;
  accepts(input: PiboSignalInput): boolean;
  project(input: PiboSignalInput, context: PiboSignalProjectorContext): PiboSignalMutation[];
}
```

A new activity kind should be added by registering a producer, not by editing every consumer. Existing producers should cover messages, tools, subagents, runs, compaction, retry, queue, and session lifecycle.

### 2.4 Mutation interface

The registry should apply normalized mutations:

```ts
export type PiboSignalMutation =
  | { type: "upsert_node"; node: PiboSignalNode }
  | { type: "patch_node"; nodeId: string; patch: Partial<PiboSignalNode> }
  | { type: "remove_node"; nodeId: string }
  | { type: "link_parent"; nodeId: string; parentNodeId: string }
  | { type: "set_session_queue"; piboSessionId: string; queuedMessages: number };
```

This keeps producer code simple and keeps aggregation centralized.

## 3. Registry Architecture

### 3.1 Internal indexes

`PiboSignalRegistry` should maintain these indexes:

- `nodesById: Map<string, PiboSignalNode>`
- `nodeIdsBySessionId: Map<string, Set<string>>`
- `childSessionIdsByParentId: Map<string, Set<string>>`
- `parentSessionIdByChildId: Map<string, string>`
- `rootSessionIdBySessionId: Map<string, string>`
- `versionByRootId: Map<string, number>`
- `sessionSnapshotById: Map<string, PiboSessionSignalSnapshot>`
- `subscribersByRootId: Map<string, Set<PiboSignalListener>>`

### 3.2 Versioning

Each root session tree gets its own monotonically increasing version. A mutation that affects any descendant increments the root version and emits a patch for that root.

### 3.3 Aggregation

Implement aggregation in `src/signals/aggregate.ts`. It must update only the changed session and ancestor chain.

For a changed node:

1. Find its owning session.
2. Recompute local aggregate for that session from local nodes.
3. Recompute recursive aggregate using cached child aggregates.
4. Walk ancestors until root or until no aggregate changes.
5. Emit changed session snapshots in the patch.

### 3.4 Terminal-node retention

The registry should keep:

- all active nodes
- recently terminal nodes used by visible UI
- summarized terminal errors until acknowledged or TTL expires

Suggested defaults:

- terminal success nodes: 60 seconds
- terminal error nodes: 10 minutes or until acknowledged
- consumed yielded run nodes: follow run-registry TTL

Exact values can be configurable later. Do not make configurability part of the first implementation unless needed.

## 4. Services To Change

### 4.1 `src/core/events.ts`

Add new Pibo output events for run lifecycle if we want them on the existing output bus:

```ts
export type PiboRunLifecycleEvent = {
  type: "run_lifecycle";
  piboSessionId: string;
  runId: string;
  status: PiboRunStatus;
  previousStatus?: PiboRunStatus;
  completionPolicy: PiboRunCompletionPolicy;
  toolName: string;
  consumed: boolean;
  acknowledged?: boolean;
  summary?: string;
  error?: string;
};
```

Preferred approach: publish run changes directly to `PiboSignalRegistry` and also emit `run_lifecycle` as an output event for durable event logs. That makes run changes visible to non-web clients too.

Also consider a generic signal output event later:

```ts
{ type: "session_signal_patch"; piboSessionId: string; patch: PiboSignalPatch }
```

Do not make Chat Web depend only on this event if it can subscribe to the registry directly in-process.

### 4.2 `src/core/session-router.ts`

Add a signal registry field:

```ts
private readonly signalRegistry: PiboSignalRegistry;
```

Wire it in the constructor near `PiboRunRegistry`.

Change `emitOutput`:

1. Notify the signal registry before or after plugin listeners. Prefer before web indexing if Chat Web can fetch the latest signal immediately.
2. Pass `PiboOutputEvent` into `signalRegistry.project({ type: "pibo_output", event })`.
3. If a patch is emitted, fan it out to Chat Web signal subscribers.

Change session creation paths:

- Root session creation.
- Runtime session creation.
- Subagent child session creation.

Each should call:

```ts
signalRegistry.project({ type: "session_created", session });
```

Change disposal paths:

- `dispose` action.
- router dispose.
- owner run cancellation during session disposal.

Each should project `session_disposed` and run cancellation changes.

Replace or reduce run notification scheduling:

- Keep service-message reminders for the agent.
- Stop treating service-message reminders as UI state.
- Emit/project run transitions when they occur, not only after `message_finished`.

### 4.3 `src/core/routed-session.ts`

Current status action returns:

```ts
{
  queuedMessages,
  processing,
  streaming,
  activeTools,
  cwd,
  disposed,
}
```

Change or supplement it:

- Rename `activeTools` semantics to `enabledTools`.
- Add `executingToolCalls` or `pendingToolCalls` when available.
- Add `signal` or `signals` summary from `PiboSignalRegistry` if reachable through router context.

Add explicit projection points:

- After enqueue: `queue_changed`.
- Before prompt: `session_processing_changed(processing: true)`.
- After prompt success and in `finally`: `session_processing_changed(processing: false)`.
- On abort: terminal/interrupted signal update.
- On dispose: disposed signal update.

`message_finished` must remain an output event, but it must not be the only signal that makes a session idle.

### 4.4 `src/runs/registry.ts`

Add transition listeners:

```ts
export type PiboRunRegistryListener = (event: PiboRunRegistryEvent) => void;

export type PiboRunRegistryEvent =
  | { type: "run_started"; run: PiboRunSnapshot }
  | { type: "run_changed"; run: PiboRunSnapshot; previousStatus?: PiboRunStatus; reason?: string }
  | { type: "run_consumed"; run: PiboRunSnapshot }
  | { type: "run_acknowledged"; run: PiboRunSnapshot }
  | { type: "run_removed"; runId: string; ownerPiboSessionId: string };
```

Emit events from:

- `startToolRun`
- `complete`
- `fail`
- `cancel`
- `ack`
- `read` when it marks terminal runs consumed
- `cancelOwnerRuns`
- `cancelAll`
- `prune`
- recovery in constructor, if recovered records need signal bootstrap

The registry should not import Chat Web or signal-specific UI code. It should expose generic lifecycle events. `PiboSessionRouter` or a run signal producer should subscribe and project those events.

### 4.5 `src/runs/tools.ts`

No major signal logic should live in tool definitions. They already call the controller. Ensure controller methods return snapshots with enough metadata:

- run id
- owner session
- tool name
- status
- completion policy
- consumed/acknowledged state
- summary/error

### 4.6 `src/plugins/*` and plugin registry

Do not make plugins responsible for core signals. Plugins may later register signal producers for plugin-owned activities. Add extension points only after the core registry exists.

Possible future interface:

```ts
plugin.registerSignalProducer(producer)
```

Do not block the first implementation on plugin extensibility unless another feature needs it immediately.

## 5. Chat Web Changes

### 5.1 `src/apps/chat/web-app.ts`

Add signal state to `ChatWebAppState`:

```ts
signalRegistry: PiboSignalRegistry;
signalBridge: ChatSignalBridge;
```

If the router owns the registry, expose it through `PiboWebAppContext` or another context field. Avoid creating a separate web-only registry that can diverge.

Add API routes:

- `GET /api/chat/signals/session/:piboSessionId`
- `GET /api/chat/signals/tree/:piboSessionId`
- `GET /api/chat/signals/events?rootPiboSessionId=...`

Access control must match existing session/trace APIs.

Indexing changes:

- `ensureEventIndexing()` should still store historical events.
- It should stop being the authority for live `running/idle/error` once signal snapshots are available.
- It may store a legacy mapped status from signals for old screens.

### 5.2 `src/apps/chat/read-model.ts`

Current problem:

- `statusFromEvent()` maps many events to `running` and `message_finished` to `idle`.
- This breaks for child sessions, yielded runs, and post-message work.

Migration:

1. Keep `statusFromEvent()` for legacy fallback.
2. Add `updateSessionSignalStatus(snapshot)` or `recordSignalSnapshot(snapshot)`.
3. Store a legacy status derived from signal aggregate:
   - `error` if `hasError` or aggregate status is `error`
   - `running` if `isTreeActive`
   - `idle` otherwise
4. Once UI uses signals directly, reduce reliance on `web_chat_sessions.status`.

Do not delete `statusFromEvent()` in the first phase. Mark it as fallback-only after signals are wired.

### 5.3 `src/apps/chat/trace.ts` and `src/shared/trace-engine.ts`

Current trace engine derives live status from:

- session status
- open transcript event ids
- `message_finished`
- parsed run notifications
- compaction events
- async-agent run snapshots embedded in tool output

Replacement plan:

- Keep trace engine responsible for historical nodes.
- Stop using trace engine as the source for current session activity.
- Add optional signal overlay input to trace projection if the trace needs to decorate current nodes.
- Remove run-notification parsing from live status decisions.

Specific code to replace later:

- `parseRunNotificationText()` should become legacy trace support only.
- `buildRunNotificationNode()` should remain only for old stored service messages.
- `syncAsyncAgentStatuses()` should prefer signal run nodes when available.
- Status assignments based on `sessionStatus === "running"` should be replaced by signal overlay for live open nodes.

### 5.4 `src/apps/chat/output-compactor.ts`

Keep this component. It compacts live text deltas and tool updates for stream efficiency. It should not own session activity status.

Changes:

- Do not emit status semantics from compaction.
- Ensure compaction boundaries still flush final assistant/thinking messages for history.
- Let signals handle `streaming` vs `done` status transitions.

### 5.5 `src/apps/chat/stream.ts`

Current stream frames include `RUN_STARTED`, `RUN_FINISHED`, and `RUN_ERROR` for message turns, not yielded runs. Keep them for transcript streaming compatibility.

Add separate signal stream events rather than overloading these frames. Possible approach:

```ts
{ type: "SIGNAL_SNAPSHOT"; snapshot: SignalSnapshotResponse }
{ type: "SIGNAL_PATCH"; patch: PiboSignalPatch }
```

Prefer a dedicated `/signals/events` stream to avoid mixing transcript deltas and signal patches.

## 6. Chat UI Changes

### 6.1 `src/apps/chat-ui/src/api.ts`

Add client functions:

- `fetchSessionSignals(piboSessionId)`
- `fetchSignalTree(piboSessionId)`
- `subscribeSignalTree(rootPiboSessionId, handlers)`

Add TypeScript types matching `src/signals/types.ts`. If shared types are not imported into the browser bundle, duplicate minimal wire types carefully or move common types into `src/shared/`.

### 6.2 `src/apps/chat-ui/src/App.tsx`

Current places to migrate:

- Bootstrap cache status updates around message send.
- `selectedSessionNode?.status` passed into terminal/session views.
- `patchTraceViewWithEvents(..., sessionStatus)`.
- session tree status dot classes.
- working animation decisions.

Plan:

1. Add a signal query for the selected root/session.
2. Add signal SSE subscription with snapshot-resync on version gaps.
3. Map signal aggregate to legacy UI status during transition.
4. Drive the compact terminal working footer from `signalSnapshot.isTreeActive` or selected local activity policy.
5. Drive session tree badges from `activeChildren`, `hasErrorDescendant`, and `hasBlockedDescendant`.
6. Stop manually setting session status to `running` in bootstrap cache after send once signal patches arrive reliably.

### 6.3 Compact terminal session view

`src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx` should receive explicit signal-derived state:

```ts
isWorking: boolean;
workingPhase?: string;
activeDescendantCount?: number;
```

It should not infer working state from trace row statuses.

## 7. Notification System Migration

### 7.1 Current behavior

Run notifications are currently created by `PiboRunRegistry.createNotification()` and inserted into the conversation as service messages with XML-like text:

```text
<pibo_run_notification>
...
</pibo_run_notification>
```

Then `src/shared/trace-engine.ts` parses those service messages to create run notification trace nodes. This couples agent reminders, UI state, and historical trace rendering.

### 7.2 Target behavior

Split notification responsibilities:

1. **Agent reminder**: service messages remain available to remind the model about tracked runs.
2. **UI live state**: signal run nodes show current run state.
3. **History**: durable run lifecycle events or trace nodes show what happened.

The UI must not parse service messages to know whether a run is active, failed, completed, or cancelled.

### 7.3 Required changes

- Add run-registry listeners.
- Project every run transition into signals immediately.
- Emit durable `run_lifecycle` events or persist equivalent signal lifecycle edges.
- Keep `scheduleRunNotification()` only for agent reminders.
- Rename helper functions to clarify purpose:
  - `formatRunNotification` -> `formatRunReminderMessage`
  - `isRunNotificationServiceMessage` -> `isRunReminderServiceMessage`
- In trace engine, mark parsed run notifications as legacy/reminder nodes, not source-of-truth live run nodes.

### 7.4 What to replace

Replace live-state dependency on:

- `parseRunNotificationText()` in `src/shared/trace-engine.ts`
- `runNotificationRuns()` and `runNotificationSummary()` for current status
- UI `RunNotificationSummary` as live status display
- service-message detection as signal for unread/active run state

Keep for compatibility:

- rendering old stored run reminder messages
- agent-facing reminder messages
- transcript audit of reminders sent to the model

## 8. Trace-Derived Signal Replacement Matrix

| Current source | Current use | Replacement |
| --- | --- | --- |
| `ChatWebReadModel.statusFromEvent()` | `idle/running/error` session status | Signal aggregate mapped to legacy status |
| `TraceEngine` node status from `sessionStatus` | open/running trace nodes | Signal overlay for live nodes; trace for history |
| `message_finished` | marks session idle | `session_processing_changed(false)` plus aggregate rules |
| `subagent_session` trace edge | child link display | Signal `subagent_session` node and child aggregate |
| run service message | yielded-run live state | Signal `yielded_run` node from registry events |
| `syncAsyncAgentStatuses()` | async-agent completion status | Signal run status or durable run lifecycle event |
| compaction trace node | live compaction state | Signal `compaction` node; trace remains historical |
| `activeTools` in status action | misleading enabled-tool list | `enabledTools`; add executing tool calls from signals |
| UI bootstrap optimistic status | immediate running dot | short optimistic fallback until signal patch arrives |
| Output compactor flush boundaries | sometimes imply final state | signals own final state; compactor owns output text only |

## 9. Persistence Plan

### 9.1 Minimal first pass

Use in-memory registry plus run-registry recovery. On gateway startup:

- create session nodes for known sessions as they are indexed or accessed
- recover runs from `PiboRunRegistry`
- mark any unknown active state as `unknown` or `interrupted`

### 9.2 Durable lifecycle journal

Add a durable signal/lifecycle table after the in-memory path works.

Possible table:

```sql
CREATE TABLE pibo_signal_events (
  id TEXT PRIMARY KEY,
  root_pibo_session_id TEXT NOT NULL,
  pibo_session_id TEXT,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX idx_pibo_signal_events_root_created
ON pibo_signal_events(root_pibo_session_id, created_at);
```

Possible snapshot table:

```sql
CREATE TABLE pibo_signal_snapshots (
  root_pibo_session_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);
```

Start with snapshots if faster. Add journal if audit/replay becomes necessary.

## 10. API And Streaming Plan

### 10.1 Snapshot endpoints

Implement in Chat Web route handling:

- Validate auth/session ownership.
- Resolve root session.
- Return registry snapshot.
- Include ETag or version header if easy.

### 10.2 SSE stream

Implement a dedicated signal SSE endpoint:

1. Client connects with root Pibo Session ID and optional last known version.
2. Server sends current snapshot first.
3. Server streams patches.
4. If patch buffer overflows or version gap occurs, server sends resync instruction or fresh snapshot.

Suggested events:

```text
event: signal_snapshot
data: {...}

event: signal_patch
data: {...}

event: signal_resync
data: {"reason":"version_gap"}
```

## 11. Testing Plan

### 11.1 Unit tests

Add tests for:

- message queued -> running -> idle
- assistant streaming status
- tool call running -> done/error
- subagent child active makes parent aggregate active
- three-level nested child active makes root aggregate active
- yielded run active after parent message finished
- yielded run completed/failed/cancelled
- compaction start/end
- retry start/end if event source exists
- abort/dispose terminal states
- version increments and patch ordering
- terminal node eviction
- unknown node kinds do not crash aggregation

### 11.2 Integration tests

Add tests around:

- router emits/project signals from real `PiboOutputEvent`s
- run registry listener produces signal patches
- Chat Web endpoint returns snapshot
- SSE sends snapshot then patch
- UI status mapping from signal aggregate

### 11.3 Regression tests

Cover known failures:

- parent session not idle while child is active
- session not idle while yielded run is active
- `message_finished` does not override active descendant
- service run reminder parsing not required for live run status

## 12. Rollout Phases

### Phase 1: Core signal types and registry

- Add `src/signals/*`.
- Implement node storage, patching, versioning, snapshots, and aggregation.
- Add unit tests.
- No UI changes yet.

Verification: unit tests pass; registry can model nested sessions and runs.

### Phase 2: Router and run-registry producers

- Wire registry into `PiboSessionRouter`.
- Project `PiboOutputEvent`s.
- Add explicit processing/queue/dispose projections.
- Add run-registry listeners.
- Keep existing notifications unchanged.

Verification: integration test shows signal snapshot changes for messages, tools, subagents, and runs.

### Phase 3: Chat Web signal API

- Add HTTP snapshot endpoints.
- Add SSE patch stream.
- Enforce access control.
- Add tests.

Verification: browser/client can fetch tree snapshot and receive patches.

### Phase 4: UI consumes signals

- Add API client and subscription hook.
- Drive selected session working state from signals.
- Drive session tree badges from signals.
- Keep legacy status as fallback.

Verification: yielded run and child subagent keep parent visibly active after parent message finishes.

### Phase 5: Notification cleanup

- Rename run notification helpers to run reminder helpers.
- Stop using parsed run reminders for live UI status.
- Add durable run lifecycle events if not already added.
- Keep legacy trace rendering for old service messages.

Verification: deleting service reminder parsing from live path does not break run badges/status.

### Phase 6: Trace/live separation cleanup

- Remove or reduce `sessionStatus === "running"` live inference from trace projection.
- Use optional signal overlay for currently active trace nodes.
- Keep trace engine historical and deterministic.

Verification: trace renders history correctly when session is idle; signals render current state.

## 13. Risks And Mitigations

### Risk: two live sources of truth during migration

Mitigation: define signals as authoritative as soon as Phase 2 passes. Keep read-model status as legacy projection only.

### Risk: patches get lost or arrive out of order

Mitigation: per-root versions and snapshot resync.

### Risk: signal registry grows forever

Mitigation: terminal-node TTL and run-registry-aligned pruning.

### Risk: plugins need new signal kinds

Mitigation: producer interface and generic node rendering.

### Risk: UI becomes too dependent on detailed node kinds

Mitigation: expose aggregate booleans and phase labels. UI should not reimplement aggregation.

### Risk: run reminders and run signals diverge

Mitigation: run registry remains source of truth. Reminders and signals both derive from registry transitions.

## 14. Done Definition

The implementation is complete when:

- `PiboSignalRegistry` exists and is tested.
- Router, routed sessions, subagents, compaction, and run registry feed signals.
- Chat Web exposes signal snapshots and patches.
- Chat UI uses signals for working state and session tree badges.
- Run notifications are agent reminders only, not UI live state.
- Trace engine no longer owns current activity semantics.
- Nested sessions at least three levels deep aggregate correctly.
- A yielded run keeps the owning session tree active after `message_finished`.
- Gateway restart does not leave stale running signals.
