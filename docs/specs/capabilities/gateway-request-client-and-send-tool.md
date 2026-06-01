# Spec: Gateway Request Client and Send Tool

**Status:** Draft
**Created:** 2026-05-11
**Controller / Source:** Scheduled Pibo Source Specs Coverage, based on current workspace code
**Related docs:** [Local Gateway Protocol and Lifecycle](./local-gateway-protocol-and-lifecycle.md), [Core Plugin Profiles and Built-In Harness Skill](./core-plugin-profiles-and-built-in-skill.md), [Pibo Input and Output Event Contract](./pibo-event-contract.md)

## Why

Pibo has a local gateway protocol for routed sessions, but several callers should not need to implement raw socket framing themselves. Local tools, compatibility profiles, and service-style callers need a small request client that sends one input event, correlates the gateway response, and, when requested, waits for the final assistant reply from the target Pibo Session.

The parked `pibo_gateway_send` tool builds on that helper. It is intentionally narrower than the full gateway protocol: it sends a message to an existing Pibo Session and returns the assistant reply to the caller.

## Goal

Pibo MUST provide gateway request helpers and the `pibo_gateway_send` tool that preserve frame correlation, event correlation, bounded waiting, and explicit error reporting without broadening normal default profiles.

## Background / Current State

`src/gateway/request.ts` implements two socket helpers:

- `sendGatewayEvent()` sends one gateway request frame and resolves the matching response frame.
- `sendGatewayMessageAndWaitForReply()` sends one message event and resolves only after both the matching response frame and the correlated `assistant_message` router event are observed.

`src/gateway/tool.ts` exposes `pibo_gateway_send`, which calls `sendGatewayMessageAndWaitForReply()` with message source `actor`. The tool is available through the parked gateway-producer profile path, not through the default profile registry.

## Scope

### In Scope

- Gateway request-helper connection defaults, request ids, and input event ids.
- Response-frame correlation for one-shot event sends.
- Assistant-reply correlation for message-and-wait sends.
- Timeout, connection-close, gateway rejection, and session-error behavior.
- `pibo_gateway_send` parameters, output text, details payload, and profile exposure boundary.

### Out of Scope

- Gateway server frame validation and broadcast rules — covered by Local Gateway Protocol and Lifecycle.
- Session Router queueing and output-event generation — covered by Pibo Session Routing and Pibo Event Contract.
- General interactive gateway client rendering in `src/gateway/client.ts`.
- Web Chat HTTP APIs and SSE streams.

## Requirements

### Requirement: One-shot gateway requests are response-correlated

`sendGatewayEvent()` MUST open a local gateway socket, send exactly one `req` frame, and resolve only the response whose frame id matches the generated request id.

#### Current

The helper defaults to `127.0.0.1:4789`, generates a UUID frame id, fills `event.id` only when the caller did not provide one, writes a newline-delimited JSON frame, ignores unrelated frames, and resolves on the matching `res` frame.

#### Target

Callers can submit a routed input event without manually managing protocol ids or socket parsing.

#### Acceptance

- If the caller omits `event.id`, the sent event includes a generated string id.
- If the caller supplies `event.id`, the helper preserves it.
- The returned value is the matching gateway response frame, including `ok`, `payload`, and `error` fields.
- Unrelated event or response frames do not settle the request.
- The helper rejects when the configured timeout expires, the socket errors, or the socket closes before the matching response.

#### Scenario: Message request resolves queue response

- GIVEN a mock gateway echoes a `res` frame with the received request id
- WHEN `sendGatewayEvent()` sends a message event
- THEN it resolves that response
- AND the gateway received one `req` frame with a message event id.

### Requirement: Message-and-wait resolves only a correlated assistant reply

`sendGatewayMessageAndWaitForReply()` MUST wait for both the gateway acceptance response and the assistant message whose `piboSessionId` and `eventId` match the submitted message event.

#### Current

The helper sends a message request and tracks the matching response by frame id. It tracks a reply only from `event: "router"` frames whose payload is `assistant_message`, has the target Pibo Session id, and has the message event id. It tolerates either the response or reply arriving first.

#### Target

A caller receives the final reply for its own message and cannot accidentally consume another session's or another event's assistant output.

#### Acceptance

- An `assistant_message` for the same session but a different event id is ignored.
- An `assistant_message` for a different session is ignored.
- If the correlated assistant reply arrives before the response, the helper still resolves after the matching successful response arrives.
- If the response arrives first, the helper resolves after the correlated assistant reply arrives.
- A gateway rejection response rejects with the gateway error message.

#### Scenario: Reply arrives before response

- GIVEN the gateway emits the correlated `assistant_message` before the matching `res` frame
- WHEN `sendGatewayMessageAndWaitForReply()` observes both frames
- THEN it resolves with the successful response and that assistant reply.

### Requirement: Session errors and transport failures are explicit

The message-and-wait helper MUST reject when the correlated session reports an error or when the transport cannot deliver a complete result within the bounded wait.

#### Current

The helper rejects on a `session_error` payload with the submitted Pibo Session id and event id, on socket errors, on socket close before completion, and after a timeout that defaults to 120 seconds. `sendGatewayEvent()` has a shorter default timeout of 5 seconds.

#### Target

Callers distinguish gateway rejection, target session failure, unreachable gateway, premature close, and timeout instead of receiving an empty reply.

#### Acceptance

- A correlated `session_error` rejects with the session error text.
- Socket error rejects the helper promise.
- Socket close before the expected response/reply rejects with a close-before-result message.
- Timeout messages name the gateway endpoint for one-shot requests and the target session for message-and-wait requests.
- Custom timeout, host, and port options override defaults.

#### Scenario: Target session errors

- GIVEN the gateway accepts a message request
- WHEN it emits a `session_error` with the same Pibo Session id and event id
- THEN `sendGatewayMessageAndWaitForReply()` rejects with that session error.

### Requirement: Gateway send tool exposes a minimal actor-message interface

`pibo_gateway_send` MUST accept only a target Pibo Session id and message text, send the message as actor input through the local gateway, and return the correlated assistant reply or an explicit gateway error.

#### Current

The tool parameters are `{ piboSessionId, message }`. Execution calls `sendGatewayMessageAndWaitForReply()` with `{ type: "message", source: "actor" }`. On failure it returns text beginning with `Gateway error:` and `details.ok: false`. On success it returns the assistant reply text and details including `ok`, `piboSessionId`, `gatewayPayload`, and `reply`.

#### Target

Agents using the parked gateway-producer capability can delegate to a target Pibo Session without learning gateway frame syntax or receiving unrelated stream events.

#### Acceptance

- Tool schema requires `piboSessionId` and `message` as strings.
- The submitted input event uses source `actor`.
- A failed gateway request returns a tool result rather than throwing an uncaught error into the runtime.
- Successful results include the assistant reply in both user-visible content and structured details.
- If a gateway accepted the request but no reply is available, the visible result names the queued target session.

#### Scenario: Gateway rejects target session

- GIVEN the gateway response for the send is `ok: false` with error `Unknown session`
- WHEN the tool runs
- THEN the tool returns visible text `Gateway error: Unknown session`
- AND its details include `ok: false`, the target Pibo Session id, and the error string.

### Requirement: Gateway send capability remains parked behind explicit profiles

The `pibo_gateway_send` tool MUST NOT appear in normal default profiles. It MAY appear only when the gateway-producer profile path is explicitly selected.

#### Current

`createPiboGatewayToolProfiles()` returns the tool profile, and the gateway-producer plugin includes it. The default plugin registry omits the gateway-producer plugin; CLI compatibility aliases explicitly construct the parked gateway-producer profile.

#### Target

The send tool remains available for intentional local routing workflows without granting every default coding profile cross-session message-sending ability.

#### Acceptance

- Default registry profile inspection for `codex` or `codex-compat-openai-web` does not list `pibo_gateway_send`.
- Explicit `gateway-producer` / `pibo-gateway-producer` profile inspection lists `pibo_gateway_send`.
- The tool's presence is governed by profile selection, not by importing `src/gateway/tool.ts` elsewhere.

#### Scenario: Default profile cannot gateway-send

- GIVEN an operator inspects the default Codex-compatible profile
- WHEN tool names are listed
- THEN `pibo_gateway_send` is absent.

## Edge Cases

- The helpers parse incoming socket lines defensively; invalid JSON lines are ignored by the client helpers rather than treated as correlated results.
- The message-and-wait helper does not subscribe explicitly; it relies on the gateway's default legacy event stream for compatibility with current server behavior.
- A caller-provided event id is the assistant-reply correlation key even though the request frame id remains separately generated.
- Gateway response payload shape is not interpreted by the helpers except for response success/failure.

## Constraints

- **Compatibility:** Defaults remain `127.0.0.1:4789`, matching the local gateway protocol defaults.
- **Security / Privacy:** `pibo_gateway_send` is profile-gated and must stay out of the default registry.
- **Reliability:** All waits are bounded by caller-provided or default timeouts.
- **Product Boundary:** Helpers speak Pibo gateway frames and Pibo input/output events; they do not call Pi Coding Agent directly.

## Success Criteria

- [ ] SC-001: One-shot request tests verify generated event ids and response-id correlation.
- [ ] SC-002: Message-and-wait tests verify unrelated replies are ignored and reply-before-response ordering is accepted.
- [ ] SC-003: Error-path tests cover gateway rejection, session error, timeout, and premature close.
- [ ] SC-004: Tool tests verify success and failure result details for `pibo_gateway_send`.
- [ ] SC-005: Profile inspection tests verify the send tool is absent from default profiles and present in the parked gateway-producer profile.

## Verification Coverage

### Directly Tested

- `test/gateway-request.test.mjs` covers one-shot request response handling, generated message event ids, correlated assistant replies, ignored unrelated replies, and reply-before-response ordering.
- `test/plugin-registry.test.mjs` and `test/codex-compat.test.mjs` indirectly verify default profile composition and absence of gateway-producer tools from normal profiles.

### Source-Inspected Only

- Tool result shaping and failure wrapping in `src/gateway/tool.ts`.
- Socket timeout, socket close, socket error, and correlated `session_error` behavior in `src/gateway/request.ts`.
- Parked gateway-producer profile wiring in `src/plugins/builtin.ts`, `src/cli.ts`, and `src/gateway/tool.ts`.

### Test Gaps

- Add focused tests for `pibo_gateway_send` success and gateway-error details.
- Add request-helper tests for timeout, premature socket close, gateway rejection, and correlated session error.
- Add a profile-level assertion that `gateway-producer` exposes `pibo_gateway_send` while `codex` does not.

## Assumptions and Open Questions

### Assumptions

- The gateway's legacy all-session stream remains enabled for clients that do not send a subscribe frame.
- A single assistant reply event is the terminal reply contract for the send tool.
- The parked gateway-producer profile is still needed for compatibility workflows.

### Open Questions

- Should `sendGatewayMessageAndWaitForReply()` send an explicit session subscription before the request to reduce unrelated gateway traffic?
- Should the send tool expose host, port, or timeout parameters, or should it stay tied to the local default gateway?
- Should future output-event contracts include a distinct final-reply event for service callers instead of relying on `assistant_message`?

## Traceability

| Requirement | Scenario / Story | Verification | Status |
|---|---|---|---|
| REQ-001: One-shot gateway requests are response-correlated | Message request resolves queue response | `test/gateway-request.test.mjs`; `src/gateway/request.ts` | Draft |
| REQ-002: Message-and-wait resolves only a correlated assistant reply | Reply arrives before response | `test/gateway-request.test.mjs`; `src/gateway/request.ts` | Draft |
| REQ-003: Session errors and transport failures are explicit | Target session errors | Source-inspected; add error-path tests | Draft |
| REQ-004: Gateway send tool exposes a minimal actor-message interface | Gateway rejects target session | Source-inspected; add tool tests | Draft |
| REQ-005: Gateway send capability remains parked behind explicit profiles | Default profile cannot gateway-send | Existing profile tests plus source inspection; add explicit parked-profile assertion | Draft |

## Verification Basis

Source files inspected for this spec:

- `src/gateway/request.ts`
- `src/gateway/tool.ts`
- `src/gateway/protocol.ts`
- `src/gateway/client.ts`
- `src/plugins/builtin.ts`
- `src/cli.ts`
- `test/gateway-request.test.mjs`
- `test/plugin-registry.test.mjs`
- `test/codex-compat.test.mjs`
