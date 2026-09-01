---
type: "Specification"
title: "Local Routed Clients and Simple Agent HTTP API"
description: "Defines the implemented local routed clients and simple agent http api contract and its current ownership boundaries."
tags: ["gateway", "local-api"]
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
    - id: "WP02-GW-API-001"
      status: "implemented"
      sources:
        - path: "src/local/client.ts"
          symbol: "LocalRoutedTuiClient"
        - path: "src/local/client.ts"
          symbol: "createLocalRoutedTuiClient"
        - path: "src/local/client.ts"
          symbol: "LOCAL_TUI_CHANNEL_NAME"
      tests:
        - path: "test/local-routed-tui.test.mjs"
          name: "local routed TUI extension routes input through the local client"
        - path: "test/local-routed-tui.test.mjs"
          name: "local routed TUI client creates a default local Pibo session"
      failures:
        - "Missing configured API key returns 503; mismatch returns 401 using length-check plus timingSafeEqual."
        - "Blank/non-string fields return 400; unknown session returns 404."
        - "Public /api/health has no API key."
        - "Client disconnect or host shutdown is not wired into awaitAgentMessage cancellation."
      confidence: "high"
    - id: "WP02-GW-API-002"
      status: "implemented"
      sources:
        - path: "src/local/extension.ts"
          symbol: "createLocalRoutedTuiExtension"
        - path: "src/local/tui.ts"
          symbol: "runLocalRoutedTui"
      tests:
        - path: "test/local-routed-tui.test.mjs"
          name: "local routed TUI forwards Goal objectives and control commands"
        - path: "test/local-routed-tui.test.mjs"
          name: "local routed TUI forwards compact instructions additively"
        - path: "test/local-routed-tui.test.mjs"
          name: "local routed TUI reports rejected routed requests and keeps input handled"
      failures:
        - "Missing configured API key returns 503; mismatch returns 401 using length-check plus timingSafeEqual."
        - "Blank/non-string fields return 400; unknown session returns 404."
        - "Public /api/health has no API key."
        - "Client disconnect or host shutdown is not wired into awaitAgentMessage cancellation."
      confidence: "high"
    - id: "WP02-GW-API-003"
      status: "implemented"
      sources:
        - path: "src/api/simple-agent-api.ts"
          symbol: "handleSimpleAgentApiRequest"
        - path: "src/api/simple-agent-api.ts"
          symbol: "SimpleAgentApiOptions"
        - path: "src/web/channel.ts"
          symbol: "createWebHostChannel"
        - path: "src/web/http.ts"
          symbol: "readJsonBody"
      source_inspected: true
      follow_up: "Add test/simple-agent-api.test.mjs cases for health methods, API-key candidates, invalid bodies, unknown sessions, and no-emission failures; run: node scripts/run-test-suite.mjs test/simple-agent-api.test.mjs"
      failures:
        - "Missing configured API key returns 503; mismatch returns 401 using length-check plus timingSafeEqual."
        - "Blank/non-string fields return 400; unknown session returns 404."
        - "Public /api/health has no API key."
        - "Client disconnect or host shutdown is not wired into awaitAgentMessage cancellation."
      confidence: "medium"
    - id: "WP02-GW-API-004"
      status: "implemented"
      sources:
        - path: "src/api/simple-agent-api.ts"
          symbol: "handleSimpleAgentApiRequest"
      source_inspected: true
      follow_up: "Add test/simple-agent-api.test.mjs cases for concurrent sends, mismatched session/event IDs, latest assistant text, and correlated message_finished settlement; run: node scripts/run-test-suite.mjs test/simple-agent-api.test.mjs"
      failures:
        - "Missing configured API key returns 503; mismatch returns 401 using length-check plus timingSafeEqual."
        - "Blank/non-string fields return 400; unknown session returns 404."
        - "Public /api/health has no API key."
        - "Client disconnect or host shutdown is not wired into awaitAgentMessage cancellation."
      confidence: "medium"
    - id: "WP02-GW-API-005"
      status: "implemented"
      sources:
        - path: "src/api/simple-agent-api.ts"
          symbol: "handleSimpleAgentApiRequest"
      source_inspected: true
      follow_up: "Add test/simple-agent-api.test.mjs cases for correlated session_error, timeout, subscription release, and the absent disconnect/shutdown cancellation path; run: node scripts/run-test-suite.mjs test/simple-agent-api.test.mjs"
      failures:
        - "Missing configured API key returns 503; mismatch returns 401 using length-check plus timingSafeEqual."
        - "Blank/non-string fields return 400; unknown session returns 404."
        - "Public /api/health has no API key."
        - "Client disconnect or host shutdown is not wired into awaitAgentMessage cancellation."
      confidence: "medium"
---

# Scope

In-process LocalRoutedTuiClient message/action/event transport and the Simple Agent API's two HTTP routes, API-key gate, existing-session check, event correlation, and timeout cleanup.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: LocalRoutedTuiClientLike; LocalRoutedTuiCapabilities from runtime registry; one in-memory local Pibo Session with channel local-tui; SimpleAgentApiOptions; no separate conversation store.
- Routes and protocols: GET or HEAD /api/health -> {status:'ok'}; other methods 405 with Allow; POST /api/send-message; other methods 405 with Allow; unknown paths fall through; API key from explicit option or PIBO_SIMPLE_API_KEY; accepted key candidates: x-api-key, api-key, raw/Bearer/Token Authorization, Basic credential parts
- State transitions: Local client emits source ui message events and execution events with generated IDs, filters output subscription by its Pibo Session, and disposeAll on close. Simple API validates key/body/existing session, installs a correlated listener, emits one source service message with generated event ID, records the latest correlated assistant_message, and resolves on message_finished. Correlated session_error returns 500; timeout returns 504; success/error/timeout clear timer and unsubscribe.
- Failure and security: Missing configured API key returns 503; mismatch returns 401 using length-check plus timingSafeEqual. Blank/non-string fields return 400; unknown session returns 404. Public /api/health has no API key. Client disconnect or host shutdown is not wired into awaitAgentMessage cancellation.
- Compatibility: Simple API is mounted before plugin app routes and reserves only /api/health and /api/send-message. The response is one non-streaming object {message,eventId,sessionId}; latest assistant_message wins; no assistant message yields an empty string. Local slash commands are generated from registered action capabilities, while blocked conflicting Pi TUI commands remain presentation behavior outside normative gateway ownership.

# Requirements and invariants

## Requirement: WP02-GW-API-001

The in-process local client SHALL create one ps_ local-tui session, expose registry action capabilities, emit normal ui message/execution events, filter output by session, and dispose its router on close.

## Requirement: WP02-GW-API-002

The local routed adapter SHALL derive slash actions from registered capabilities and transport messages/actions and normalized outputs without redefining action semantics or terminal rendering ownership.

## Requirement: WP02-GW-API-003

The Simple Agent API SHALL expose only public method-limited /api/health and API-key-protected POST /api/send-message, validate object fields, and reject unknown sessions before emission.

## Requirement: WP02-GW-API-004

Each accepted HTTP send SHALL generate one event ID, emit one source service message, ignore mismatched sessions/events, retain the latest correlated assistant message, and resolve only on correlated message_finished.

## Requirement: WP02-GW-API-005

Correlated session_error and the bounded response timeout SHALL return 500 and 504 and release the subscription; the spec SHALL not claim disconnect/shutdown cancellation until implemented.

# Interfaces and ownership

Capability IDs: `pibo.gateway.local-api`.

Implemented public contracts:

- `LocalRoutedTuiClient`
- `createLocalRoutedTuiClient`
- `LOCAL_TUI_CHANNEL_NAME`
- `createLocalRoutedTuiExtension`
- `runLocalRoutedTui`
- `handleSimpleAgentApiRequest`
- `SimpleAgentApiOptions`
- `createWebHostChannel`
- `readJsonBody`

Related ownership boundaries:

- SPC-GW-001 owns event/action meanings and router state.
- SPC-GW-003 owns host mounting, 4 MiB generic body limit, response sending, and server shutdown.
- SPC-OP-003 owns renderer-neutral terminal views and Ink rendering; local extension presentation is supporting evidence only.
- SPC-DATA-002 owns Pibo Session persistence; this target creates no conversation database.
- SPC-GW-002 owns TCP local protocol and pibo_gateway_send, not this in-process client or HTTP facade.

# Failure and security behavior

- Missing configured API key returns 503; mismatch returns 401 using length-check plus timingSafeEqual.
- Blank/non-string fields return 400; unknown session returns 404.
- Public /api/health has no API key.
- Client disconnect or host shutdown is not wired into awaitAgentMessage cancellation.

# Known limits

- Non-current claim excluded: claim client disconnect or Web host shutdown unsubscribes the Simple API listener; only success, correlated error, and timeout do.
- Non-current claim excluded: assign cli-session row/view models or Ink rendering to this gateway spec.
- Non-current claim excluded: describe the HTTP facade as browser-session authenticated; /api/send-message uses its own API key.
- Non-current claim excluded: omit src/api/simple-agent-api.ts from source authority.
- Current limit or evidence gap: No dedicated tests cover Simple Agent API health, methods, key candidates, body validation, unknown session, correlation, error, timeout, or cleanup.
- Current limit or evidence gap: awaitAgentMessage is not connected to Request.signal, client disconnect, or Web host shutdown and can remain subscribed until event or the default 10-minute timeout.
- Current limit or evidence gap: The API accepts raw Authorization and either Basic credential part as key candidates; retain only as current compatibility unless intentionally narrowed.
- Current limit: client disconnect and Web host shutdown do not cancel awaitAgentMessage; only success, correlated error, and timeout release its subscription.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality; it does not claim that an external, browser, real-provider, or Pibo2 check ran.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/local-routed-tui.test.mjs`

No `test/simple-agent-api.test.mjs` file exists at the traceability commit. Requirements WP02-GW-API-003 through WP02-GW-API-005 therefore use source inspection and concrete future-test follow-ups, not invented test proof.

# Related concepts

- SPC-GW-001 owns event/action meanings and router state.
- SPC-GW-003 owns host mounting, 4 MiB generic body limit, response sending, and server shutdown.
- SPC-OP-003 owns renderer-neutral terminal views and Ink rendering; local extension presentation is supporting evidence only.
- SPC-DATA-002 owns Pibo Session persistence; this target creates no conversation database.
- SPC-GW-002 owns TCP local protocol and pibo_gateway_send, not this in-process client or HTTP facade.
