---
type: "Specification"
title: "Local Gateway Protocol, Server, Client, and Send Tool"
description: "Defines the implemented local gateway protocol, server, client, and send tool contract and its current ownership boundaries."
tags: ["gateway", "transport"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T06:15:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "WP02-GW-LOC-001"
      status: "implemented"
      sources:
        - path: "src/gateway/protocol.ts"
          symbol: "DEFAULT_GATEWAY_HOST"
        - path: "src/gateway/protocol.ts"
          symbol: "DEFAULT_GATEWAY_PORT"
        - path: "src/gateway/protocol.ts"
          symbol: "GatewayFrame"
        - path: "src/gateway/protocol.ts"
          symbol: "isGatewayRequestFrame"
        - path: "src/gateway/protocol.ts"
          symbol: "isGatewaySubscribeFrame"
        - path: "src/gateway/protocol.ts"
          symbol: "encodeFrame"
      tests:
        - path: "test/gateway-client.test.mjs"
          name: "gateway client frames preserve Pibo Session and event identity"
        - path: "test/gateway-client.test.mjs"
          name: "global gateway request validation remains compatible while the CLI validates locally"
        - path: "test/gateway-request.test.mjs"
          name: "sendGatewayEvent buffers fragmented gateway responses"
      failures:
        - "Default backpressure bounds are 1000 frames and 4 MiB."
        - "Droppable live deltas are discarded first; non-droppable overflow closes the slow socket."
        - "TCP is unauthenticated and unencrypted; loopback is only a default bind, and configurable non-loopback use requires an external trust/tunnel boundary."
        - "legacy-all can receive cross-session events by design."
      confidence: "high"
    - id: "WP02-GW-LOC-002"
      status: "implemented"
      sources:
        - path: "src/gateway/server.ts"
          symbol: "PiboGatewayServer"
        - path: "src/gateway/request.ts"
          symbol: "sendGatewayEvent"
        - path: "src/gateway/request.ts"
          symbol: "sendGatewayMessageAndWaitForReply"
      tests:
        - path: "test/gateway-request.test.mjs"
          name: "sendGatewayEvent ignores responses with a different request id"
        - path: "test/gateway-request.test.mjs"
          name: "sendGatewayMessageAndWaitForReply resolves only the correlated assistant reply"
        - path: "test/gateway-request.test.mjs"
          name: "sendGatewayMessageAndWaitForReply preserves an existing event id for reply correlation"
        - path: "test/gateway-backpressure-subscriptions.test.mjs"
          name: "legacy clients receive all router events and session subscriptions filter events"
      failures:
        - "Default backpressure bounds are 1000 frames and 4 MiB."
        - "Droppable live deltas are discarded first; non-droppable overflow closes the slow socket."
        - "TCP is unauthenticated and unencrypted; loopback is only a default bind, and configurable non-loopback use requires an external trust/tunnel boundary."
        - "legacy-all can receive cross-session events by design."
      confidence: "high"
    - id: "WP02-GW-LOC-003"
      status: "implemented"
      sources:
        - path: "src/gateway/server.ts"
          symbol: "GatewayConnectionDiagnostics"
        - path: "src/gateway/server.ts"
          symbol: "PiboGatewayServer"
        - path: "src/gateway/server.ts"
          symbol: "getDiagnostics"
      tests:
        - path: "test/gateway-backpressure-subscriptions.test.mjs"
          name: "droppable router events are bounded and counted while a socket is slow"
        - path: "test/gateway-backpressure-subscriptions.test.mjs"
          name: "non-droppable frames are not dropped when backpressure limits are exceeded"
      failures:
        - "Default backpressure bounds are 1000 frames and 4 MiB."
        - "Droppable live deltas are discarded first; non-droppable overflow closes the slow socket."
        - "TCP is unauthenticated and unencrypted; loopback is only a default bind, and configurable non-loopback use requires an external trust/tunnel boundary."
        - "legacy-all can receive cross-session events by design."
      confidence: "high"
    - id: "WP02-GW-LOC-004"
      status: "implemented"
      sources:
        - path: "src/gateway/client.ts"
          symbol: "parseGatewayClientMessage"
        - path: "src/gateway/client.ts"
          symbol: "createGatewayClientRequestFrame"
        - path: "src/gateway/client.ts"
          symbol: "createGatewayClientSubscriptionFrame"
        - path: "src/gateway/request.ts"
          symbol: "sendGatewayMessageAndWaitForReply"
      tests:
        - path: "test/gateway-client.test.mjs"
          name: "gateway client messages queue by default"
        - path: "test/gateway-client.test.mjs"
          name: "gateway client supports explicit queue and steering delivery with whitespace separators"
        - path: "test/gateway-client.test.mjs"
          name: "piped client waits beyond acknowledgements for correlated streaming and terminal events"
        - path: "test/gateway-client.test.mjs"
          name: "client reports gateway close before terminal completion without a Node stack trace"
        - path: "test/gateway-request.test.mjs"
          name: "sendGatewayMessageAndWaitForReply waits through intermediate assistant messages"
        - path: "test/gateway-request.test.mjs"
          name: "sendGatewayMessageAndWaitForReply rejects on the correlated session error"
      failures:
        - "Default backpressure bounds are 1000 frames and 4 MiB."
        - "Droppable live deltas are discarded first; non-droppable overflow closes the slow socket."
        - "TCP is unauthenticated and unencrypted; loopback is only a default bind, and configurable non-loopback use requires an external trust/tunnel boundary."
        - "legacy-all can receive cross-session events by design."
      confidence: "high"
    - id: "WP02-GW-LOC-005"
      status: "implemented"
      sources:
        - path: "src/gateway/tool.ts"
          symbol: "createPiboGatewaySendTool"
        - path: "src/gateway/tool.ts"
          symbol: "createPiboGatewayToolProfiles"
        - path: "src/plugins/builtin.ts"
          symbol: "piboGatewayProducerPlugin"
        - path: "src/plugins/builtin.ts"
          symbol: "createGatewayProducerPiboProfile"
      tests:
        - path: "test/plugin-registry.test.mjs"
          name: "gateway producer profile is available only through its parked registry"
        - path: "test/gateway-client.test.mjs"
          name: "root discovery and client help expose queue, steering, streaming EOF, and TCP security"
      failures:
        - "Default backpressure bounds are 1000 frames and 4 MiB."
        - "Droppable live deltas are discarded first; non-droppable overflow closes the slow socket."
        - "TCP is unauthenticated and unencrypted; loopback is only a default bind, and configurable non-loopback use requires an external trust/tunnel boundary."
        - "legacy-all can receive cross-session events by design."
      confidence: "high"
---

# Scope

Newline-delimited local TCP frames, frame validation, request/subscription correlation, server fanout/backpressure, client terminal waiting, and opt-in gateway-send tool registration.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: No conversation store; PID/port metadata is operational only..
- Routes and protocols: TCP default 127.0.0.1:4789; newline JSON req{id,event}; subscribe{id,subscription}; res{id,ok,payload?,error?}; event{event:'router',payload}; subscriptions legacy-all or session{piboSessionId}
- State transitions: A new connection starts in legacy-all compatibility mode until it subscribes. Request replies correlate by frame id; assistant waiting additionally correlates Pibo Session and event ID. Piped client waits for both acknowledgment and terminal message_finished/session_error. Disconnect and timeout settle pending waiters and subscriptions.
- Failure and security: Default backpressure bounds are 1000 frames and 4 MiB. Droppable live deltas are discarded first; non-droppable overflow closes the slow socket. TCP is unauthenticated and unencrypted; loopback is only a default bind, and configurable non-loopback use requires an external trust/tunnel boundary. legacy-all can receive cross-session events by design.
- Compatibility: Queue is the client default; /queue and /steer are explicit. pibo_gateway_send is registered only in the pibo-gateway-producer profile; the default profile omits it.

# Requirements and invariants

## Requirement: WP02-GW-LOC-001

The local protocol SHALL encode and validate newline JSON request, subscription, response, and router-event frames with default host 127.0.0.1 and port 4789.

## Requirement: WP02-GW-LOC-002

Requests SHALL correlate by request ID and reply waits by request ID, Pibo Session ID, and event ID; session subscriptions SHALL filter fanout while legacy-all remains explicit compatibility behavior.

## Requirement: WP02-GW-LOC-003

Server fanout SHALL bound each connection queue, drop droppable deltas before durable terminal frames, and close sockets that cannot accept non-droppable frames.

## Requirement: WP02-GW-LOC-004

The CLI/request clients SHALL default messages to queue, preserve explicit steer, wait through intermediate assistant messages, and fail cleanly on rejection, correlated error, timeout, or close.

## Requirement: WP02-GW-LOC-005

The pibo_gateway_send tool SHALL be available only through the explicit pibo-gateway-producer profile, and documentation SHALL state the unauthenticated/unencrypted trusted-network boundary.

# Interfaces and ownership

Capability IDs: `pibo.gateway.transport`.

Implemented public contracts:

- `DEFAULT_GATEWAY_HOST`
- `DEFAULT_GATEWAY_PORT`
- `GatewayFrame`
- `isGatewayRequestFrame`
- `isGatewaySubscribeFrame`
- `encodeFrame`
- `PiboGatewayServer`
- `sendGatewayEvent`
- `sendGatewayMessageAndWaitForReply`
- `GatewayConnectionDiagnostics`
- `PiboGatewayServer.getDiagnostics`
- `parseGatewayClientMessage`
- `createGatewayClientRequestFrame`
- `createGatewayClientSubscriptionFrame`
- `createPiboGatewaySendTool`
- `createPiboGatewayToolProfiles`
- `piboGatewayProducerPlugin`
- `createGatewayProducerPiboProfile`

Related ownership boundaries:

- SPC-GW-001 owns event/action meanings transported by these frames.
- SPC-SEC-003 owns operator hardening guidance; this transport has no authentication or encryption.
- CLI process/PID lifecycle is operational documentation, not protocol semantics.
- SPC-GW-004 owns the HTTP facade and in-process local TUI client.

# Failure and security behavior

- Default backpressure bounds are 1000 frames and 4 MiB.
- Droppable live deltas are discarded first; non-droppable overflow closes the slow socket.
- TCP is unauthenticated and unencrypted; loopback is only a default bind, and configurable non-loopback use requires an external trust/tunnel boundary.
- legacy-all can receive cross-session events by design.

# Known limits

- Non-current claim excluded: claim session filters prevent all cross-session exposure: every connection starts in legacy-all mode.
- Non-current claim excluded: call loopback a complete authentication boundary or imply TLS/authentication exists.
- Non-current claim excluded: assign message/action semantics to the transport spec.
- Current limit or evidence gap: A configurable non-loopback host is possible without protocol authentication; deployment guidance must keep this explicit.
- Current evidence retained: test/gateway-backpressure-subscriptions.test.mjs covers bounded backpressure and subscription behavior.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality; it does not claim that an external, browser, real-provider, or Pibo2 check ran.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/gateway-client.test.mjs test/gateway-request.test.mjs test/gateway-backpressure-subscriptions.test.mjs test/plugin-registry.test.mjs`

# Related concepts

- SPC-GW-001 owns event/action meanings transported by these frames.
- SPC-SEC-003 owns operator hardening guidance; this transport has no authentication or encryption.
- CLI process/PID lifecycle is operational documentation, not protocol semantics.
- SPC-GW-004 owns the HTTP facade and in-process local TUI client.
