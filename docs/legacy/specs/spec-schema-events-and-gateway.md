---
title: Pibo Event And Gateway Schema Specification
version: 1.0
date_created: 2026-04-28
last_updated: 2026-05-02
owner: Pibo maintainers
tags: [schema, events, gateway, sessions]
---

# Introduction

This specification defines the event and gateway data contracts currently implemented by Pibo. These contracts are used between channels, tools, the session router, routed sessions, and newline-delimited gateway clients.

## 1. Purpose & Scope

This specification covers:

- Pibo input events.
- Pibo output events.
- Session execution action parameters and results.
- Local TCP gateway frame validation and encoding.

This specification does not define HTTP chat API payloads; those are covered by the web specification.

## 2. Definitions

- **Input event**: A `PiboInputEvent` accepted by the session router.
- **Output event**: A `PiboOutputEvent` emitted by routed sessions and the router.
- **Execution action**: A command-like event that invokes a registered gateway action rather than sending text to the model.
- **Gateway frame**: A newline-delimited JSON object exchanged over the local TCP gateway.
- **JSON value**: `null`, boolean, finite number, string, array of JSON values, or object whose values are JSON values.
- **Pibo Session ID**: The `PiboSession.id` value used for product routing and event correlation.
- **Subagent Session Event**: A router output event that links a parent tool call to a routed child Pibo Session.
- **Chat Stream Event**: A compact web UI frame derived from `PiboOutputEvent`. `AGENT_DELEGATION` is a Chat Stream Event name, not a `PiboOutputEvent` type.
- **Content Index**: A provider-supplied assistant message content-part index when Pi exposes one.
- **Assistant Index**: A Pibo-assigned turn-local index for one visible assistant text segment. It is distinct from Content Index because providers may reuse the same content index for separate visible assistant messages in one turn.
- **Thinking Index**: A Pibo-assigned turn-local index for one reasoning/thinking segment. It is distinct from Content Index for the same reason as Assistant Index.

## 3. Requirements, Constraints & Guidelines

- **REQ-001**: Every input event MUST include a non-empty `piboSessionId`.
- **REQ-002**: Message input events MUST have `type: "message"` and string `text`.
- **REQ-003**: Execution input events MUST have `type: "execution"` and string `action`.
- **REQ-004**: Execution `params`, when present in a gateway request frame, MUST be JSON serializable.
- **REQ-005**: Message ids and execution ids are optional, but when provided they MUST be propagated into correlated output events as `eventId`.
- **REQ-006**: The router MUST return the immediate queued or execution result event from `emit`.
- **REQ-007**: Routed sessions MUST emit `message_queued` when a message is accepted.
- **REQ-008**: Routed sessions MUST emit `message_started` before prompting Pi for a queued message.
- **REQ-009**: Routed sessions MUST emit `message_finished` after Pi prompt completion.
- **REQ-010**: Routed sessions MUST emit `session_error` when Pi prompt or action execution fails.
- **REQ-011**: Assistant visible text deltas MUST be emitted as `assistant_delta`.
- **REQ-012**: Final visible assistant text MUST be emitted as `assistant_message` when Pi provides non-empty final assistant text.
- **REQ-012A**: Assistant visible text events SHOULD preserve provider `contentIndex` when available and MUST include a stable `assistantIndex` when multiple visible assistant text segments can occur in one routed turn.
- **REQ-012B**: Consumers that need live identity for visible assistant text MUST prefer `assistantIndex` over `contentIndex`, and MAY fall back to `contentIndex` for older stored events.
- **REQ-013**: Thinking traces MUST use `thinking_started`, `thinking_delta`, and `thinking_finished`, separate from visible assistant text.
- **REQ-013A**: `thinking_finished` MUST be interpreted as the end of the thinking block only. It MUST NOT be interpreted as the end of the full agent turn or the end of visible assistant text streaming.
- **REQ-013B**: Thinking events SHOULD preserve provider `contentIndex` when available and MUST include a stable `thinkingIndex` when multiple thinking segments can occur in one routed turn.
- **REQ-013C**: Consumers that need live identity for thinking text MUST prefer `thinkingIndex` over `contentIndex`, and MAY fall back to `contentIndex` for older stored events.
- **REQ-014**: Tool call argument streaming MUST use `tool_call` with `argsComplete` indicating whether the tool call arguments are complete.
- **REQ-015**: Tool execution lifecycle MUST use `tool_execution_started`, `tool_execution_updated`, and `tool_execution_finished`.
- **REQ-016**: Optional raw Pi events MUST be forwarded only when the router is configured with `forwardPiEvents`.
- **REQ-017**: Gateway frames MUST be encoded as exactly one JSON object followed by `\n`.
- **REQ-018**: Invalid gateway lines MUST receive an error response with id `"invalid"`.
- **REQ-019**: Gateway request responses MUST preserve the request frame `id`.
- **REQ-020**: Gateway router output broadcasts MUST use event frames with `type: "event"` and `event: "router"`.
- **REQ-021**: Direct generated subagent calls MUST emit a `subagent_session` output event before waiting for the child reply.
- **REQ-022**: `subagent_session` MUST include parent `piboSessionId`, optional parent `toolCallId`, generated `toolName`, configured `subagentName`, `childPiboSessionId`, and optional `threadKey`.
- **REQ-023**: Tool execution results for `pibo_run_start` MUST preserve the wrapped yielded tool name and run metadata sufficiently for trace reconstruction.
- **REQ-024**: When `pibo_run_start` wraps a generated `pibo_subagent_*` tool, stored event payloads or tool result details MUST retain the wrapped tool name and original arguments.
- **CON-001**: Gateway default host is `127.0.0.1`.
- **CON-002**: Gateway default port is `4789`.

## 4. Interfaces & Data Contracts

### Input Events

```ts
type PiboMessageEvent = {
  type: "message";
  piboSessionId: string;
  text: string;
  source?: "user" | "ui" | "service" | "actor";
  id?: string;
};

type PiboExecutionEvent = {
  type: "execution";
  piboSessionId: string;
  action: string;
  id?: string;
  params?: PiboJsonValue;
};
```

### Built-In Execution Actions

| Action | Params | Result |
| --- | --- | --- |
| `status` | none | `PiboSessionStatus` |
| `session_id` | none | `{ piboSessionId }` |
| `clear_queue` | none | `{ cleared }` |
| `abort` | none | `{ aborted: true }` |
| `dispose` | none | `{ disposed: true }` |
| `thinking` | optional `{ level }` | `PiboThinkingResult` |
| `session.current` | none | `PiboPiSessionSnapshot` |
| `session.list` | none | `PiboSessionListItem[]` |
| `session.fork_candidates` | none | `{ messages }` |
| `session.fork` | `{ entryId: string }` | `PiboSessionOperationResult` |
| `session.clone` | none | `PiboSessionOperationResult` |
| `session.tree` | none | `PiboSessionTreeResult` |
| `session.tree_navigate` | `{ entryId, summarize?, customInstructions?, replaceInstructions?, label? }` | `PiboSessionOperationResult` |
| `session.switch` | `{ sessionFile, cwdOverride? }` | `PiboSessionOperationResult` |

### Output Events

```ts
type PiboOutputEvent =
  | { type: "message_queued"; piboSessionId: string; eventId?: string; queuedMessages: number; text: string; source?: PiboEventSource }
  | { type: "message_started"; piboSessionId: string; eventId?: string; text: string; source?: PiboEventSource }
  | { type: "assistant_delta"; piboSessionId: string; eventId?: string; assistantIndex?: number; contentIndex?: number; text: string }
  | { type: "assistant_message"; piboSessionId: string; eventId?: string; assistantIndex?: number; contentIndex?: number; text: string }
  | { type: "thinking_started"; piboSessionId: string; eventId?: string; thinkingIndex?: number; contentIndex?: number }
  | { type: "thinking_delta"; piboSessionId: string; eventId?: string; thinkingIndex?: number; contentIndex?: number; text: string }
  | { type: "thinking_finished"; piboSessionId: string; eventId?: string; thinkingIndex?: number; contentIndex?: number; text?: string }
  | { type: "tool_call"; piboSessionId: string; eventId?: string; toolCallId: string; toolName: string; args: unknown; argsComplete: boolean }
  | { type: "tool_execution_started"; piboSessionId: string; eventId?: string; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_execution_updated"; piboSessionId: string; eventId?: string; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
  | { type: "tool_execution_finished"; piboSessionId: string; eventId?: string; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "subagent_session"; piboSessionId: string; toolCallId?: string; toolName: string; subagentName: string; childPiboSessionId: string; threadKey?: string }
  | { type: "message_finished"; piboSessionId: string; eventId?: string; source?: PiboEventSource }
  | { type: "execution_result"; piboSessionId: string; eventId?: string; action: string; result: unknown }
  | { type: "session_error"; piboSessionId: string; eventId?: string; error: string }
  | { type: "pi_event"; piboSessionId: string; event: unknown };
```

### Gateway Frames

```ts
type GatewayRequestFrame = {
  type: "req";
  id: string;
  event: PiboInputEvent;
};

type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message: string };
};

type GatewayEventFrame = {
  type: "event";
  event: "router";
  payload: PiboOutputEvent;
};
```

## 5. Acceptance Criteria

- **AC-001**: Given a gateway request frame with a missing `piboSessionId`, When validated, Then it is rejected.
- **AC-002**: Given a message request frame with string `text`, When validated, Then it is accepted.
- **AC-003**: Given an execution request frame with non-JSON `params`, When validated, Then it is rejected.
- **AC-004**: Given a valid request frame, When the router emits successfully, Then the gateway returns `{ type: "res", id, ok: true, payload }`.
- **AC-005**: Given router output, When gateway clients are connected, Then each connection receives a router event frame.
- **AC-006**: Given a Pi thinking delta, When normalized, Then it is emitted as `thinking_delta` and not as assistant visible text.
- **AC-007**: Given Pi emits `thinking_finished` followed by visible text deltas for the same message, When normalized, Then the router emits `thinking_finished` followed by `assistant_delta` events and does not emit `message_finished` until Pi prompt completion.
- **AC-008**: Given a generated subagent tool is called with a tool call id, When the child Pibo Session is resolved, Then a `subagent_session` event is emitted with the same tool call id and the child Pibo Session ID before the parent awaits the child reply.
- **AC-009**: Given `pibo_run_start` starts `pibo_subagent_explorer`, When the tool result is stored, Then the payload retains `toolName: "pibo_subagent_explorer"` and enough arguments to reconstruct the async subagent trace node.
- **AC-010**: Given Pi emits two separate visible assistant text segments with the same provider `contentIndex` during one routed turn, When normalized, Then the first segment's `assistant_delta` and `assistant_message` share one `assistantIndex`, and the second segment's `assistant_delta` and `assistant_message` share a different `assistantIndex`.
- **AC-011**: Given Pi emits two separate thinking segments with the same provider `contentIndex` during one routed turn, When normalized, Then the segments are distinguishable by `thinkingIndex`.

## 6. Test Automation Strategy

- **Test Levels**: Unit and integration tests.
- **Frameworks**: Node.js built-in test runner and TypeScript compiler.
- **Focused Commands**: `node --test test/gateway-request.test.mjs`, `node --test test/session-actions.test.mjs`, `node --test test/chat-trace.test.mjs`, `node --test test/web-channel.test.mjs`, `node --test test/channel-runtime.test.mjs`.
- **Primary Command**: `npm test`.

## 7. Rationale & Context

Pibo normalizes Pi runtime events so transports can consume stable event types without coupling to Pi internals. The local gateway uses newline-delimited JSON because it is simple for agents and shell clients to generate and parse.

## 8. Dependencies & External Integrations

### External Systems

- **EXT-001**: Local TCP clients for gateway frames.
- **EXT-002**: Pi Coding Agent session event stream.

### Technology Platform Dependencies

- **PLT-001**: Node.js networking APIs.

## 9. Examples & Edge Cases

### Message Request

```json
{"type":"req","id":"1","event":{"type":"message","piboSessionId":"demo","text":"Hello","source":"user"}}
```

### Execution Request

```json
{"type":"req","id":"2","event":{"type":"execution","piboSessionId":"demo","action":"status"}}
```

### Invalid Request

```json
{"type":"req","id":"3","event":{"type":"execution","piboSessionId":"","action":"status"}}
```

The invalid request fails gateway frame validation because `piboSessionId` is empty.

## 10. Validation Criteria

- `npm run typecheck` passes.
- Gateway frame tests pass.
- Session action normalization tests pass.

## 11. Related Specifications / Further Reading

- [spec-architecture-runtime-boundary.md](./spec-architecture-runtime-boundary.md)
- [docs/architecture.md](../docs/architecture.md)
- [examples/gateway/README.md](../examples/gateway/README.md)
