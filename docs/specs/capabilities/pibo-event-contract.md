# Spec: Pibo Input and Output Event Contract

**Status:** Draft
**Created:** 2026-05-10
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** [Pibo Session Routing](./pibo-session-routing.md), [Local Gateway Protocol and Lifecycle](./local-gateway-protocol-and-lifecycle.md), [Chat Web Output Compaction and Stream Projection](./chat-web-output-compaction-and-stream-projection.md), [Pibo Session Signals](./pibo-session-signals.md)

## Why

Pibo routes work through normalized product events. Channels, the gateway, Chat Web, signals, reliability streams, debug tools, and subagents must not depend on raw Pi Coding Agent events. A stable event contract lets those boundaries evolve independently while preserving session identity, correlation, live streaming, persistence, and diagnostics.

Without this contract, new channels or UI projections can accidentally mix Pibo Session IDs with Pi Session IDs, persist noisy live deltas, lose message correlation, or treat execution actions like chat messages.

## Goal

Pibo MUST accept a small normalized input-event surface and emit normalized output events that identify one Pibo Session, preserve caller correlation when available, and separate durable semantic events from raw Pi implementation details.

## Background / Current State

The current contract is defined in `src/core/events.ts`. `PiboSessionRouter.emit()` in `src/core/session-router.ts` accepts message and execution input events, creates or reuses the routed session, and returns the first correlated output for that input. `RoutedSession` in `src/core/routed-session.ts` queues messages, executes gateway actions, normalizes Pi stream events, and emits lifecycle, assistant, thinking, tool, compaction, execution, and error events.

Downstream code consumes the same event union: the local gateway serializes it, Chat Web compacts and stores selected events, the signal registry projects session activity, and the reliability store mirrors normalized output on the `pibo.output` topic.

## Scope

### In Scope

- Product-level input events sent into the session router.
- Product-level output events emitted by routed sessions and router-managed actions.
- Message correlation through optional input ids and output `eventId` values.
- Normalization of Pi Coding Agent stream events into Pibo output events.
- Execution action result and failure behavior.
- Durable versus live-only event expectations for consumers.

### Out of Scope

- Gateway wire framing and backpressure — covered by the gateway protocol spec.
- Chat Web frame names and stream compaction — covered by the Chat Web output compaction spec.
- Signal aggregation state — covered by the Pibo Session Signals spec.
- Pi Coding Agent's internal event schema except where Pibo currently normalizes it.
- Long-term schema evolution or external API versioning beyond the current local event contract.

## Requirements

### Requirement: Input events target exactly one Pibo Session

The system MUST require every input event to carry a `piboSessionId` and MUST route that input through the product session router.

#### Current

`PiboInputEvent` is either a message event or an execution event. Both include `piboSessionId`. `PiboSessionRouter.emit()` calls `getOrCreateSession()` for that id before handling the input.

#### Target

Channels and APIs address Pibo Sessions, not Pi session files or Chat Web room ids, when they submit runtime work.

#### Acceptance

- A message input without a Pibo Session ID is rejected before runtime work begins.
- An execution input without a Pibo Session ID is rejected before action dispatch.
- Routing uses the stored Pibo Session to choose profile, workspace, and Pi session binding.

#### Scenario: Chat Web sends a message

- GIVEN Chat Web has selected Pibo Session `ps_1`
- WHEN it submits a message input with `piboSessionId=ps_1`
- THEN the router creates or reuses the runtime for `ps_1`
- AND no Chat Web room id is used as the runtime identity.

### Requirement: Message inputs are queued and acknowledged before processing

The system MUST enqueue user-facing message inputs and immediately emit a `message_queued` output before the runtime begins processing that message.

#### Current

`RoutedSession.enqueueMessage()` appends the message to the session queue, emits `message_queued` with queue count, text, source, and optional `eventId`, then drains the queue asynchronously.

#### Target

Callers can observe that a message was accepted even when another message or compaction is already running.

#### Acceptance

- A message input returns a `message_queued` output.
- The queued output includes the same Pibo Session ID as the input.
- If the input has an id, the queued output uses that id as `eventId`.
- Queue length changes are visible through runtime status and signal projections.

#### Scenario: Message behind active work

- GIVEN session `ps_1` is already processing a message
- WHEN a second message with id `m2` is emitted
- THEN Pibo emits `message_queued` with `eventId=m2`
- AND processes the second message only after earlier queued work finishes.

### Requirement: Message lifecycle events preserve correlation

The system MUST emit a lifecycle sequence for processed messages and MUST attach the input id to lifecycle, assistant, thinking, tool, and error events that belong to the active message.

#### Current

`RoutedSession.processQueuedMessage()` emits `message_started`, prompts the runtime, then emits `message_finished` or `session_error`. Normalized Pi events pass through `withActiveMessage()` while a message is active.

#### Target

Consumers can group deltas, tool calls, final assistant text, and failures by the submitted message id.

#### Acceptance

- `message_started` includes the input id as `eventId` when present.
- Assistant deltas and final assistant messages emitted during the active message share that `eventId`.
- Thinking and tool events emitted during the active message share that `eventId`.
- Runtime prompt failures emit `session_error` with that `eventId`.
- The active correlation is cleared after the message finishes or fails.

#### Scenario: Runtime returns a tool result and final text

- GIVEN a message input has id `m1`
- WHEN the runtime emits a tool execution event and then final assistant text
- THEN Pibo emits tool and assistant output events with `eventId=m1`
- AND emits `message_finished` with `eventId=m1` after prompting completes.

### Requirement: Execution inputs return action results, not chat messages

The system MUST dispatch execution inputs through registered gateway actions and emit `execution_result` outputs for successful actions.

#### Current

`RoutedSession.executeAction()` runs `runAction()`, invokes registered gateway actions through the plugin registry, emits `execution_result`, and returns that output. Manual compaction is queued and returns an execution result indicating it was queued.

#### Target

Wrapper-level controls such as status, abort, dispose, tree navigation, thinking, and custom gateway actions remain separate from user chat turns.

#### Acceptance

- A known execution action emits `execution_result` with action name and result.
- The result includes the input id as `eventId` when supplied.
- Unknown execution actions fail instead of becoming user messages.
- Queued compaction reports queued state immediately and emits its later result after queued work reaches it.

#### Scenario: Status action

- GIVEN a channel emits execution action `status` for `ps_1`
- WHEN the action succeeds
- THEN Pibo emits `execution_result` for action `status`
- AND no `message_started` event is emitted for that action.

### Requirement: Normalized assistant and thinking events hide raw provider shape

The system MUST convert supported Pi stream events into Pibo assistant and thinking output events with product-managed fields.

#### Current

`normalizePiEvent()` maps text deltas to `assistant_delta`, thinking start/delta/end to thinking events, and assistant message endings to `assistant_message` or `session_error`.

#### Target

Consumers can render assistant and reasoning output without knowing the Pi or provider event schema.

#### Acceptance

- Text deltas become `assistant_delta` events with text and content index when known.
- Thinking start, delta, and finish events use Pibo thinking event types.
- Assistant message endings with final text become `assistant_message`.
- Assistant message endings with error state become `session_error`.
- Raw Pi events are forwarded only when a runtime/profile explicitly enables `pi_event` forwarding.

#### Scenario: Thinking stream

- GIVEN Pi emits thinking start, thinking delta, and thinking end events
- WHEN Pibo normalizes them
- THEN consumers receive `thinking_started`, `thinking_delta`, and `thinking_finished`
- AND do not need to parse the raw Pi event payload.

### Requirement: Tool events distinguish call construction from execution

The system MUST represent tool-call argument streaming separately from tool execution start, update, and finish events.

#### Current

`normalizeToolCallEvent()` maps assistant tool-call argument events to `tool_call`. `normalizeToolExecutionEvent()` maps execution start, update, and end to `tool_execution_started`, `tool_execution_updated`, and `tool_execution_finished` with `isError` on completion.

#### Target

UIs and logs can show tool arguments as they are formed, running progress while execution is active, and terminal success or failure.

#### Acceptance

- Tool-call events include `toolCallId`, `toolName`, args, and whether args are complete.
- Tool execution start and update events include the same call id and tool name when Pi supplies them.
- Tool execution finish includes the result and an explicit `isError` boolean.
- Missing required tool identifiers prevent a normalized tool event from being emitted.

#### Scenario: Tool failure

- GIVEN a tool execution ends with `isError=true`
- WHEN Pibo emits the terminal tool event
- THEN consumers receive `tool_execution_finished` with the tool call id, tool name, result, and `isError=true`.

### Requirement: Output events are session-scoped and consumer-safe

The system MUST attach `piboSessionId` to every output event and MUST keep event payloads suitable for local JSON transport and projection consumers.

#### Current

All `PiboOutputEvent` variants include `piboSessionId`. Gateway frames, Chat Web mappers, signal projection, and reliability mirroring consume the same output union. Custom execution params are constrained to `PiboJsonValue`, while tool and Pi payloads can carry unknown values inside product event envelopes.

#### Target

Every downstream consumer can filter or project events by Pibo Session ID without inspecting nested provider data.

#### Acceptance

- Every emitted output event has exactly one Pibo Session ID.
- Consumers can ignore unknown event variants without losing session routing identity.
- Chat Web can classify `assistant_delta`, `thinking_delta`, and `tool_execution_updated` as live-only without affecting terminal events.
- Reliability and debug consumers can store or display normalized output without needing Pi Session IDs.

#### Scenario: Room stream filters by selected session

- GIVEN a room has sessions `ps_1` and `ps_2`
- WHEN output arrives for both sessions
- THEN the session stream for `ps_1` can forward only events whose `piboSessionId` is `ps_1`.

## Edge Cases

- An execution action can throw; callers must receive a correlated error through the gateway or API boundary rather than a fake assistant message.
- A Pi message end can contain no final text; Pibo may have already emitted deltas, and Chat Web compaction handles fallback persistence.
- A raw Pi event can be unrecognized; it is ignored unless raw forwarding is enabled, in which case `pi_event` carries the original payload.
- Tool execution updates are live-oriented and can be dropped by slow gateway clients, but terminal tool events must not be treated as droppable.
- Disposing or killing a session clears queued work and projects signal state; it does not change the Pibo Session ID contract.

## Constraints

- **Compatibility:** Event names in `PiboOutputEvent` are consumed by gateway, Chat Web, signals, reliability, and debug tooling; renames require coordinated migration.
- **Security / Privacy:** Event payloads may contain user text, tool arguments, tool results, and provider output. Consumers must apply their own access checks before exposing events.
- **Performance:** High-frequency deltas must remain streamable and droppable where documented; durable consumers should prefer terminal or compacted events.
- **Dependencies:** The contract depends on Pi Coding Agent event shapes only inside the normalization boundary.

## Success Criteria

- [ ] SC-001: Router tests verify that message and execution inputs require Pibo Session IDs and produce the expected first output type.
- [ ] SC-002: Routed-session tests verify queued message lifecycle order and event-id propagation to assistant, thinking, tool, finish, and error events.
- [ ] SC-003: Normalization tests verify assistant, thinking, tool-call, tool-execution, assistant-message, and session-error mappings from representative Pi events.
- [ ] SC-004: Gateway or API tests verify execution actions return `execution_result` and unknown actions surface errors without creating chat turns.
- [ ] SC-005: Consumer tests verify live-only event classification does not mark final assistant, thinking, or tool events as droppable.

## Assumptions and Open Questions

### Assumptions

- `PiboOutputEvent` remains the product boundary for routed runtime output.
- Consumers may add projections, but they should not introduce alternate raw Pi event contracts for normal operation.
- Current local transports can serialize normalized events with their existing JSON frame handling.

### Open Questions

- Should Pibo introduce explicit event schema versioning before exposing this contract to non-local clients?
- Should unknown execution params be validated by action-specific schemas before reaching gateway actions?

## Traceability

| Requirement | Scenario / Story | Plan / Task | Status |
|---|---|---|---|
| REQ-001 Input events target exactly one Pibo Session | Chat Web sends a message | `src/core/events.ts`, `src/core/session-router.ts` | Draft |
| REQ-002 Message inputs are queued and acknowledged before processing | Message behind active work | `src/core/routed-session.ts` | Draft |
| REQ-003 Message lifecycle events preserve correlation | Runtime returns a tool result and final text | `src/core/routed-session.ts` | Draft |
| REQ-004 Execution inputs return action results, not chat messages | Status action | `src/core/routed-session.ts`, `src/plugins/builtin.ts` | Draft |
| REQ-005 Normalized assistant and thinking events hide raw provider shape | Thinking stream | `src/core/routed-session.ts`, `src/core/events.ts` | Draft |
| REQ-006 Tool events distinguish call construction from execution | Tool failure | `src/core/routed-session.ts` | Draft |
| REQ-007 Output events are session-scoped and consumer-safe | Room stream filters by selected session | `src/apps/chat/stream.ts`, `src/gateway/server.ts`, `src/signals/projector.ts` | Draft |

## Verification Basis

- `src/core/events.ts`
- `src/core/session-router.ts`
- `src/core/routed-session.ts`
- `src/gateway/server.ts`
- `src/apps/chat/output-event-policy.ts`
- `src/apps/chat/data/chat-data-mappers.ts`
- `src/signals/projector.ts`
