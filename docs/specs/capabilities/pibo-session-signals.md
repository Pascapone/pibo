# Spec: Pibo Session Signals

**Status:** Draft  
**Created:** 2026-05-10  
**Owner / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code  
**Related docs:** `GLOSSARY.md`, [Pibo Session Routing](./pibo-session-routing.md), [Chat Web Rooms and Event Streams](./chat-web-rooms-and-event-streams.md), [Yielded Run Control](./yielded-run-control.md), [Debug CLI](./debug-cli.md)

## Why

Chat Web needs a small live status model for Pibo Sessions that is faster and less ambiguous than reconstructing full traces for every navigation update. Users must see whether a selected session, child session, tool call, yielded run, or whole subtree is active, settled, or failed without confusing transient tool failures with runtime failures.

Pibo Session Signals provide that read model at the Product Boundary. They summarize router lifecycle events, normalized output events, yielded-run updates, and parent-child session relationships into snapshots and patches that Chat Web and diagnostics can consume.

## Goal

Expose shared-app live session activity snapshots and monotonic patches that describe local and descendant activity for Pibo Session trees.

## Background / Current State

The current code defines an in-memory signal registry under `src/signals/`. `PiboSessionRouter` projects session creation, processing changes, Pibo output events, subagent sessions, run changes, run removals, interruption, disposal, and known-session recovery into that registry. The web channel exposes `snapshotSignalSession`, `snapshotSignalTree`, and `subscribeSignalTree` through `PiboChannelContext`.

Chat Web serves signal snapshots at `/api/chat/signals/session/:piboSessionId` and `/api/chat/signals/tree/:rootPiboSessionId`. It also serves `/api/chat/signals/events` as an SSE stream that first sends a `signal_snapshot` frame and then `signal_patch` frames. Navigation and bootstrap responses overlay signal-derived `idle`, `running`, and `error` statuses onto stored session indexes.

Signals are currently live and in-memory. `src/signals/store.ts` is a placeholder for future durable signal persistence.

Current snapshots can also include a compact `activeTelemetry` hint derived from active signal nodes and queue depth. The hint uses the default telemetry stale threshold and exposes phase, turn, last-progress, stale-age, and queue-depth metadata without reading or exposing durable telemetry payloads.

## Scope

### In Scope

- Signal nodes, session snapshots, tree snapshots, and patches.
- Projection from router lifecycle events, Pibo output events, and yielded-run registry events.
- Local session status versus aggregate descendant status.
- Chat Web signal HTTP and SSE APIs.
- Ownership checks for signal access.
- UI-facing status overlays derived from signal snapshots.
- Compact active-telemetry hints derived from signal state.
- Registry diagnostics and terminal node pruning.

### Out of Scope

- Full trace reconstruction — covered by Chat Web trace code and specs.
- Durable persistence of signal state — not implemented in current code.
- Replacing the Pibo Session Store, Chat Event Log, or Raw Pibo Event Log as sources of truth.
- Workflow-specific project state machines — covered by the Projects area spec.

## Requirements

### Requirement: Signals use Pibo Session IDs as their public identity

The system MUST key public signal snapshots, patches, access checks, and tree membership by Pibo Session ID.

#### Current

`PiboSignalNode`, `PiboSessionSignalSnapshot`, and Chat Web signal routes all use `piboSessionId`. Snapshots may include `piSessionId` as metadata, but Pi Session ID is not the route identity.

#### Acceptance

A caller can request signals by Pibo Session ID. A Pi Session ID alone is not accepted by Chat Web signal routes.

#### Scenario: Request session snapshot

- GIVEN a routed Pibo Session `ps_root`
- WHEN an authenticated owner requests `GET /api/chat/signals/session/ps_root`
- THEN the response contains a snapshot keyed by `sessions.ps_root`
- AND the snapshot root is a Pibo Session ID.

### Requirement: Session trees aggregate descendant activity

The system MUST compute local activity and aggregate tree activity separately for each session snapshot.

#### Current

The registry computes `localStatus`, `aggregateStatus`, `isLocalActive`, `hasActiveDescendant`, `isTreeActive`, `hasError`, and descendant error/block flags from nodes and child session snapshots.

#### Acceptance

A running grandchild session marks its ancestors as tree-active without marking the ancestors as locally active.

#### Scenario: Deep child is running

- GIVEN `root` has child `child`, and `child` has child `grandchild`
- WHEN `grandchild` enters processing or starts a tool call
- THEN `grandchild.isLocalActive` is true
- AND `child.hasActiveDescendant` is true
- AND `root.isTreeActive` is true
- AND `root.localStatus` remains independent of the child status.

### Requirement: Signal producers project standard runtime events

The system MUST project known runtime and router events into stable signal nodes and snapshots.

#### Current

Default producers handle session lifecycle, queue changes, message start/finish, assistant and thinking streams, tool call execution, subagent delegation, compaction start/finish, session errors, yielded-run changes, run removals, recovery, interruption, disposal, and terminal node pruning.

#### Acceptance

Each supported event changes only the matching node(s) and affected session snapshots. Repeated semantically identical input does not emit a patch.

#### Scenario: Message and tool lifecycle

- GIVEN a session has an active message and active tool node
- WHEN a matching message finish or processing-false event arrives
- THEN orphan active tool nodes for that session settle to `done`
- AND the session returns to `idle` unless an error or queued state remains.

### Requirement: Queue state is represented explicitly

The system MUST represent queued messages as both a session queue count and a queue node.

#### Current

`queue_changed` and `message_queued` inputs update `queuedMessages` and create or patch queue/message signal nodes. A repeated count produces no patch.

#### Acceptance

Changing queued count from 0 to 1 makes the session locally queued. Changing it back to 0 returns the session to idle when no other active work exists.

#### Scenario: Queue count changes

- GIVEN a session has no active nodes
- WHEN the queued message count becomes 1
- THEN `localStatus` is `queued`
- AND `queuedMessages` is 1
- WHEN the queued message count becomes 0
- THEN `queuedMessages` is 0
- AND `localStatus` is `idle`.

### Requirement: Yielded runs keep the owning session active without becoming runtime failures

The system MUST show active yielded runs in the owning session while treating failed yielded runs as run-node errors, not automatic session errors.

#### Current

`run_changed` events create `yielded_run` nodes and active run summaries. Completed, failed, cancelled, and removed run events update or remove those nodes.

#### Acceptance

A running yielded run makes its owner tree active. A failed yielded run records an error on the run node but does not set `hasError` for the session unless a separate session error exists.

#### Scenario: Failed background command

- GIVEN a session owns yielded run `run_1`
- WHEN `run_1` changes from running to failed
- THEN the `run:run_1` node status is `error`
- AND the session has no active run summary
- AND the session is not marked as a runtime error solely because the yielded run failed.

### Requirement: Runtime errors are distinct from tool errors

The system MUST distinguish session-level runtime errors from tool-call and yielded-run node errors.

#### Current

`session_error` patches the session/message/turn as error and contributes to session errors. Tool execution failures and failed yielded runs mark their own nodes but do not by themselves set `hasError` on the session snapshot.

#### Acceptance

A failed tool call can remain visible as an error node after the turn settles, while the session can still return to `idle`.

#### Scenario: Tool fails but message finishes

- GIVEN a tool call node is running in a session
- WHEN the tool execution finishes with `isError: true`
- AND the message finishes
- THEN the tool node status is `error`
- AND the session aggregate status is `idle`
- AND `hasError` remains false unless a session error event was emitted.

### Requirement: Patches are monotonic per root and omit no-op updates

The system MUST publish signal patches with root-scoped monotonically increasing versions only when the semantic signal state changes.

#### Current

The registry keeps `versionByRootId`, emits `fromVersion` and `toVersion`, and compares nodes and snapshots before publishing. `updatedAt` on session snapshots advances only on semantic changes.

#### Acceptance

For one root, each emitted patch starts at the previous `toVersion`. Repeated identical input returns no patch.

#### Scenario: Repeated queue event

- GIVEN root version is 1 after a queue count becomes 1
- WHEN the same queue count is projected again
- THEN no patch is emitted
- AND the session snapshot `updatedAt` does not change.

### Requirement: Chat Web signal APIs are authenticated and shared-app

The system MUST require an authenticated web session and ownership of the requested root or session before returning signal snapshots or streams.

#### Current

Signal HTTP handlers call `requireSession` and resolve shared Pibo Sessions by resource existence. Unknown sessions return the same not-found style behavior used by other Chat Web session APIs.

#### Acceptance

An unauthenticated request cannot fetch or subscribe to session signals; allowed accounts see shared session signals.

#### Scenario: Cross-owner signal request

- GIVEN session `ps_other` belongs to `user:a`
- WHEN `user:b` requests `/api/chat/signals/session/ps_other`
- THEN the request is rejected
- AND no signal snapshot for `ps_other` is returned.

### Requirement: Signal SSE streams send snapshot before patches

The system MUST start every signal SSE stream with a complete tree snapshot and then send versioned patches for the same root.

#### Current

`/api/chat/signals/events?rootPiboSessionId=...` writes a `signal_snapshot` event from `snapshotSignalTree`, subscribes to the same root, and writes each patch as `signal_patch` with the patch version as SSE id.

#### Acceptance

A browser can initialize local signal state from the first SSE event and apply later patches when `current.version === patch.fromVersion`.

#### Scenario: Subscribe to root tree

- GIVEN root `ps_root` exists
- WHEN the browser opens the signal event stream for `ps_root`
- THEN the first event is `signal_snapshot`
- WHEN root signal state changes
- THEN the next event is `signal_patch`
- AND `patch.fromVersion + 1 === patch.toVersion` for a single change.

### Requirement: Navigation overlays derive coarse UI status from signals

The system MUST map signal snapshots to Chat Web's coarse session status without exposing every signal node in navigation lists.

#### Current

Chat Web maps `hasError`, `hasErrorDescendant`, or `aggregateStatus === "error"` to `error`; maps `isTreeActive` to `running`; otherwise maps to `idle`. Bootstrap and navigation responses overlay these values on stored session index rows.

#### Acceptance

A stale stored `running` status is cleared when the live signal snapshot is settled. A live descendant error can mark the root navigation node as error.

#### Scenario: Settled signal clears stale navigation

- GIVEN a session index row says `running`
- AND the signal snapshot for the session is settled with no active tree
- WHEN Chat Web returns bootstrap or navigation data
- THEN the session status is `idle`.

### Requirement: Active telemetry hints stay compact and payload-free

The system SHOULD expose enough active telemetry hint data for status surfaces to show stale or active work without duplicating runtime observability evidence.

#### Current

`PiboSessionSignalSnapshot.activeTelemetry` is populated when a session has active local signal nodes or queued messages. It includes `source: "signals"`, active turn id when inferable from the signal node id, active phase, `lastProgressAt`, `staleForMs`, `isStale`, queue depth, and the default stale threshold. Idle snapshots omit the hint.

#### Acceptance

Signals can show whether a session appears stale from live activity, but the hint does not include raw provider events, payload previews, headers, transcripts, normalized event payloads, tool arguments, or tool output.

#### Scenario: Active tool exposes a compact hint

- GIVEN a session has an active tool-call signal node
- WHEN a caller reads the session signal snapshot
- THEN `activeTelemetry.activePhase` is `tool_args` or `tool_execution`
- AND the hint includes stale age and threshold metadata
- AND no provider payload or tool argument content is present.

### Requirement: Terminal signal nodes are pruned without deleting sessions

The system SHOULD prune old terminal non-session nodes while preserving session nodes and active nodes.

#### Current

The registry supports `pruneTerminalNodes` with separate TTLs for successful and error terminal nodes. It emits remove patches for pruned nodes.

#### Acceptance

A terminal turn node older than the configured success TTL is removed from snapshots and subscribers receive a patch containing its node id in `removes`.

#### Scenario: Prune finished turn

- GIVEN a message turn has finished and is older than the success TTL
- WHEN terminal pruning runs
- THEN the turn node is removed
- AND the session snapshot remains available.

### Requirement: Signal performance benchmark exercises deep-tree propagation

The project SHOULD provide an operator-run benchmark that measures signal registry cost for deep session trees, repeated no-op queue updates, and repeated tool metadata updates without requiring a live gateway or browser.

#### Current

`scripts/bench-signal-registry.mjs` imports the compiled signal registry from `dist/signals/registry.js`. It creates a synthetic session tree with configurable depth, starts one leaf tool, projects repeated identical queue updates, projects repeated tool metadata changes, and prints elapsed milliseconds for each phase. Defaults are `PIBO_SIGNAL_BENCH_DEPTH=100` and `PIBO_SIGNAL_BENCH_TOOL_UPDATES=1000`.

#### Acceptance

- The benchmark runs against the compiled `dist/` artifact and does not import TypeScript source directly.
- `PIBO_SIGNAL_BENCH_DEPTH` changes the number of synthetic parent/child sessions.
- `PIBO_SIGNAL_BENCH_TOOL_UPDATES` changes both repeated queue-update and tool-metadata-update loop counts.
- Repeated identical queue updates are included so no-op projection behavior remains visible to operators.
- The benchmark prints one timing line for tree creation, one for leaf-tool propagation, one for identical queue updates, and one for tool metadata updates.

#### Scenario: Benchmark a deeper tree

- GIVEN the project has been built
- WHEN an operator runs `PIBO_SIGNAL_BENCH_DEPTH=250 PIBO_SIGNAL_BENCH_TOOL_UPDATES=2000 node scripts/bench-signal-registry.mjs`
- THEN the script creates a 250-deep synthetic session tree
- AND reports timing for propagating a leaf tool through that tree
- AND reports timing for 2000 repeated queue updates and 2000 tool metadata updates.

## Edge Cases

- Unknown future signal kinds and statuses MAY pass through as strings, but existing aggregate logic only treats known active and terminal statuses specially.
- `snapshotSession` returns the requested session's root tree context, not an isolated one-node object, so clients can evaluate parent or child effects when needed.
- If the signal registry is unavailable on a channel, Chat Web signal routes MUST return a service-unavailable error instead of fabricating state.
- If an SSE client falls behind and receives a patch whose `fromVersion` does not match its local version, it MUST refresh with a full snapshot.
- Recovery events mark sessions as `unknown` with a reason so operators can distinguish recovered-but-not-confirmed state from idle state.

## Constraints

- **Compatibility:** Public signal API fields use JSON-compatible records and Pibo Session IDs.
- **Security / Privacy:** Signal snapshots require authenticated access and must not leak provider secrets or unrelated private credentials.
- **Performance:** Navigation overlays should use compact snapshot summaries; full trace reconstruction must not be required for basic running/error indicators. The benchmark is diagnostic, not a fixed performance budget.
- **Durability:** Current signal state is in-memory and can be reconstructed only from currently known sessions, runs, and future events. Durable signals require a separate spec or extension.
- **Product boundary:** Signals summarize Product Boundary events. They do not replace Pi transcript files or Pibo-owned durable stores.

## Success Criteria

- [ ] SC-001: `test/signal-registry.test.mjs` verifies tree aggregation, queue changes, run signals, patch versions, pruning, and error semantics.
- [ ] SC-002: `test/chat-signals-api.test.mjs` verifies shared-app snapshots, tree snapshots, SSE snapshot-before-patch behavior, and navigation/bootstrap status overlays.
- [ ] SC-003: Chat Web can show running, idle, and error state for a selected session tree without reading the full trace.
- [ ] SC-004: A failed tool call or yielded run remains visible as a node error without incorrectly marking the whole session failed.
- [ ] SC-005: `scripts/bench-signal-registry.mjs` runs after build and prints timing for deep-tree propagation, no-op queue updates, and metadata-changing tool updates.
- [ ] SC-006: Active snapshots expose compact `activeTelemetry` hints for active or queued sessions and omit the hint for idle sessions.

## Assumptions and Open Questions

### Assumptions

- The in-memory registry is the intended current behavior; durability is not assumed until implemented.
- Pibo Session Store ownership remains the authority for signal access checks.
- Coarse UI status remains limited to `idle`, `running`, and `error` for current Chat Web navigation.

### Open Questions

- Should terminal signal pruning run on a schedule, on demand, or during router maintenance?
- Should durable signal persistence be added to the Reliable Event Core or to a separate signal store?
- Should clients receive a standard resync instruction when patch versions do not line up?

## Traceability

| Requirement | Scenario / Story | Code / Tests | Status |
|---|---|---|---|
| REQ-001 Signals use Pibo Session IDs | Request session snapshot | `src/signals/types.ts`, `src/apps/chat/web-app.ts`, `test/chat-signals-api.test.mjs` | Draft |
| REQ-002 Session trees aggregate descendant activity | Deep child is running | `src/signals/registry.ts`, `src/signals/aggregate.ts`, `test/signal-registry.test.mjs` | Draft |
| REQ-003 Standard runtime event projection | Message and tool lifecycle | `src/signals/projector.ts`, `src/core/session-router.ts`, `test/signal-registry.test.mjs` | Draft |
| REQ-004 Queue state | Queue count changes | `src/signals/projector.ts`, `test/signal-registry.test.mjs` | Draft |
| REQ-005 Yielded runs | Failed background command | `src/signals/projector.ts`, `src/runs/registry.ts`, `test/signal-registry.test.mjs` | Draft |
| REQ-006 Runtime errors distinct from tool errors | Tool fails but message finishes | `src/signals/projector.ts`, `test/signal-registry.test.mjs` | Draft |
| REQ-007 Monotonic patches | Repeated queue event | `src/signals/registry.ts`, `src/apps/chat-ui/src/App.tsx`, `test/signal-registry.test.mjs` | Draft |
| REQ-008 Owner-scoped APIs | Cross-owner signal request | `src/apps/chat/web-app.ts`, `test/chat-signals-api.test.mjs` | Draft |
| REQ-009 SSE snapshot before patches | Subscribe to root tree | `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/api.ts`, `test/chat-signals-api.test.mjs` | Draft |
| REQ-010 Navigation overlays | Settled signal clears stale navigation | `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/App.tsx`, `test/chat-signals-api.test.mjs` | Draft |
| REQ-011 Active telemetry hints stay compact | Active tool exposes a compact hint | `src/signals/types.ts`, `src/signals/registry.ts`, `test/signal-registry.test.mjs` | Draft |
| REQ-012 Terminal pruning | Prune finished turn | `src/signals/registry.ts`, `test/signal-registry.test.mjs` | Draft |
| REQ-013 Signal performance benchmark | Benchmark a deeper tree | `scripts/bench-signal-registry.mjs`, `src/signals/registry.ts` | Draft |

## Verification Basis

This spec was derived from the current workspace code in `src/signals/`, `src/core/session-router.ts`, `src/channels/types.ts`, `src/web/channel.ts`, `src/gateway/server.ts`, `src/apps/chat/web-app.ts`, `src/apps/chat-ui/src/api.ts`, `src/apps/chat-ui/src/App.tsx`, `scripts/bench-signal-registry.mjs`, `test/signal-registry.test.mjs`, `test/chat-signals-api.test.mjs`, and `test/telemetry-staleness.test.mjs`.
