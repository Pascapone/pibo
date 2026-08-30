---
type: "Specification"
title: "Authenticated Web Host and Channel"
description: "Defines the implemented authenticated web host and channel contract and its current ownership boundaries."
tags: ["gateway", "web-host"]
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
    - id: "WP02-GW-WEB-001"
      status: "implemented"
      sources:
        - path: "src/channels/types.ts"
          symbol: "PiboChannelContext"
        - path: "src/channels/types.ts"
          symbol: "PiboChannel"
        - path: "src/web/channel.ts"
          symbol: "createWebHostChannel"
        - path: "src/web/channel.ts"
          symbol: "WEB_CHANNEL_NAME"
      tests:
        - path: "test/channel-runtime.test.mjs"
          name: "gateway starts plugin channels with router and session session context"
        - path: "test/channel-runtime.test.mjs"
          name: "gateway rejects required-auth channels without an auth service"
      failures:
        - "Web channel declares auth mode required, and gateway startup rejects required-auth channels without an auth service."
        - "Generic Fetch request bodies are limited to 4 MiB; JSON bodies must be objects."
        - "Internal socket-peer header is injected from the TCP peer and stripped from responses."
        - "Local auth requires loopback except compute workers, where Docker networking is explicitly the security boundary."
        - "Host catch responses expose error.message; generic secret-safe redaction is not implemented."
      confidence: "high"
    - id: "WP02-GW-WEB-002"
      status: "implemented"
      sources:
        - path: "src/web/channel.ts"
          symbol: "createWebHostChannel"
        - path: "src/plugins/registry.ts"
          symbol: "PiboPluginRegistry"
        - path: "src/plugins/registry.ts"
          symbol: "validateWebAppRoutes"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "web host redirects app links to the canonical auth origin"
        - path: "test/web-channel.test.mjs"
          name: "web host resolves an explicit landing app independently of registration order and preserves the raw query"
        - path: "test/web-channel.test.mjs"
          name: "generic web host without an explicit landing app keeps the first-app fallback"
        - path: "test/plugin-registry.test.mjs"
          name: "plugin registry rejects duplicate registrations"
      failures:
        - "Web channel declares auth mode required, and gateway startup rejects required-auth channels without an auth service."
        - "Generic Fetch request bodies are limited to 4 MiB; JSON bodies must be objects."
        - "Internal socket-peer header is injected from the TCP peer and stripped from responses."
        - "Local auth requires loopback except compute workers, where Docker networking is explicitly the security boundary."
        - "Host catch responses expose error.message; generic secret-safe redaction is not implemented."
      confidence: "high"
    - id: "WP02-GW-WEB-003"
      status: "implemented"
      sources:
        - path: "src/web/http.ts"
          symbol: "MAX_WEB_REQUEST_BODY_BYTES"
        - path: "src/web/http.ts"
          symbol: "nodeRequestToWebRequest"
        - path: "src/web/http.ts"
          symbol: "readJsonBody"
        - path: "src/web/http.ts"
          symbol: "sendWebResponse"
        - path: "src/web/channel.ts"
          symbol: "SOCKET_PEER_HEADER"
        - path: "src/web/channel.ts"
          symbol: "stripSocketPeerHeaderFromResponse"
      tests:
        - path: "test/web-http.test.mjs"
          name: "nodeRequestToWebRequest preserves POST JSON bodies"
        - path: "test/web-http.test.mjs"
          name: "nodeRequestToWebRequest rejects oversized request bodies"
        - path: "test/web-http.test.mjs"
          name: "readJsonBody rejects empty, invalid, and primitive JSON bodies"
        - path: "test/web-channel.test.mjs"
          name: "web host rejects oversized request bodies"
      failures:
        - "Web channel declares auth mode required, and gateway startup rejects required-auth channels without an auth service."
        - "Generic Fetch request bodies are limited to 4 MiB; JSON bodies must be objects."
        - "Internal socket-peer header is injected from the TCP peer and stripped from responses."
        - "Local auth requires loopback except compute workers, where Docker networking is explicitly the security boundary."
        - "Host catch responses expose error.message; generic secret-safe redaction is not implemented."
      confidence: "high"
    - id: "WP02-GW-WEB-004"
      status: "implemented"
      sources:
        - path: "src/web/http.ts"
          symbol: "sendWebResponse"
        - path: "src/web/channel.ts"
          symbol: "createWebHostChannel"
      tests:
        - path: "test/web-http.test.mjs"
          name: "sendWebResponse compresses large JSON responses with gzip"
        - path: "test/web-http.test.mjs"
          name: "sendWebResponse skips sync gzip for over-budget JSON responses"
        - path: "test/web-channel-shutdown.test.mjs"
          name: "web host stop closes an active SSE connection without waiting for the client"
        - path: "test/web-channel-shutdown.test.mjs"
          name: "web host stop lets an ordinary in-flight response drain"
        - path: "test/web-channel-shutdown.test.mjs"
          name: "web host stop force-closes an ordinary response after the drain timeout"
      failures:
        - "Web channel declares auth mode required, and gateway startup rejects required-auth channels without an auth service."
        - "Generic Fetch request bodies are limited to 4 MiB; JSON bodies must be objects."
        - "Internal socket-peer header is injected from the TCP peer and stripped from responses."
        - "Local auth requires loopback except compute workers, where Docker networking is explicitly the security boundary."
        - "Host catch responses expose error.message; generic secret-safe redaction is not implemented."
      confidence: "high"
    - id: "WP02-GW-WEB-005"
      status: "implemented"
      sources:
        - path: "src/gateway/web.ts"
          symbol: "resolveWebGatewayAuthMode"
        - path: "src/gateway/web.ts"
          symbol: "resolveWebGatewayServerOptions"
        - path: "src/gateway/web.ts"
          symbol: "createWebPiboPluginRegistry"
        - path: "src/gateway/web.ts"
          symbol: "isLoopbackHost"
        - path: "src/web/auth.ts"
          symbol: "getWebAuthSession"
        - path: "src/web/auth.ts"
          symbol: "requireWebSession"
      tests:
        - path: "test/web-gateway.test.mjs"
          name: "gateway web fails closed when legacy dev auth env is set"
        - path: "test/web-gateway.test.mjs"
          name: "gateway web does not enable dev auth by default"
        - path: "test/web-gateway.test.mjs"
          name: "gateway web rejects authMode=local on a non-loopback host bind"
        - path: "test/web-gateway.test.mjs"
          name: "gateway web accepts authMode=local on the default loopback bind"
      failures:
        - "Web channel declares auth mode required, and gateway startup rejects required-auth channels without an auth service."
        - "Generic Fetch request bodies are limited to 4 MiB; JSON bodies must be objects."
        - "Internal socket-peer header is injected from the TCP peer and stripped from responses."
        - "Local auth requires loopback except compute workers, where Docker networking is explicitly the security boundary."
        - "Host catch responses expose error.message; generic secret-safe redaction is not implemented."
      confidence: "high"
---

# Scope

Generic Web channel/context contract, host route ordering and app mounting, Node-to-Web request/response limits, canonical redirect, socket-peer metadata, auth service selection/bind gates, and graceful shutdown.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: PiboChannelAuthMode; PiboChannel; PiboChannelContext; WebHostChannel; no host-owned product database.
- Routes and protocols: default 127.0.0.1:4788; public /health; public /gateway/status; /api/auth/* to auth service; Simple Agent API dispatch before apps; unique plugin mountPath/apiPrefix dispatch; root redirect to explicit landing app or first app; host-based Node request/upgrade handlers
- State transitions: Channel start requires context and binds one HTTP server. Canonical-origin redirect precedes public/auth/app dispatch. Stop aborts active event streams, closes idle connections, drains ordinary responses, then force-destroys remaining sockets after the configured timeout.
- Failure and security: Web channel declares auth mode required, and gateway startup rejects required-auth channels without an auth service. Generic Fetch request bodies are limited to 4 MiB; JSON bodies must be objects. Internal socket-peer header is injected from the TCP peer and stripped from responses. Local auth requires loopback except compute workers, where Docker networking is explicitly the security boundary. Host catch responses expose error.message; generic secret-safe redaction is not implemented.
- Compatibility: Better Auth is default; legacy devAuth aliases local mode for one release. PIBO_DEV_AUTH=1 fails closed. Host-based Node handlers/upgrades remain app-owned bypass paths and must enforce their own auth/body rules.

# Requirements and invariants

## Requirement: WP02-GW-WEB-001

Channel startup SHALL expose one required-auth Web channel and a PiboChannelContext; startup SHALL reject required-auth channels when no auth service is registered.

## Requirement: WP02-GW-WEB-002

The host SHALL dispatch canonical redirects, public health/status, auth routes, Simple Agent API routes, unique app prefixes, landing redirect, and not-found in the implemented order.

## Requirement: WP02-GW-WEB-003

Generic Node-to-Fetch request conversion SHALL preserve method/headers/body, cap bodies at 4 MiB, inject trusted socket-peer metadata, and strip that internal header from responses.

## Requirement: WP02-GW-WEB-004

Web response handling SHALL preserve streaming cancellation and bounded gzip behavior; shutdown SHALL abort SSE, drain ordinary responses, and force-close after timeout.

## Requirement: WP02-GW-WEB-005

Gateway auth-mode selection SHALL default to Better Auth, reject legacy PIBO_DEV_AUTH, and permit local auth only on loopback or an explicitly warned compute-worker network boundary.

# Interfaces and ownership

Capability IDs: `pibo.gateway.web-host`.

Implemented public contracts:

- `PiboChannelContext`
- `PiboChannel`
- `createWebHostChannel`
- `WEB_CHANNEL_NAME`
- `PiboPluginRegistry.validateWebAppRoutes`
- `MAX_WEB_REQUEST_BODY_BYTES`
- `nodeRequestToWebRequest`
- `readJsonBody`
- `sendWebResponse`
- `SOCKET_PEER_HEADER`
- `stripSocketPeerHeaderFromResponse`
- `resolveWebGatewayAuthMode`
- `resolveWebGatewayServerOptions`
- `createWebPiboPluginRegistry`
- `isLoopbackHost`
- `getWebAuthSession`
- `requireWebSession`

Related ownership boundaries:

- SPC-SEC-001 owns Better Auth/local-auth session semantics; the host supplies requireSession to apps but does not globally invoke it before every app handler.
- SPC-GW-004 owns /api/health and /api/send-message, although the host dispatches them.
- Each Web app owns its own route authentication, same-origin mutation checks, data access, and rendering.
- SPC-DATA-005 owns Chat signal route data contracts.

# Failure and security behavior

- Web channel declares auth mode required, and gateway startup rejects required-auth channels without an auth service.
- Generic Fetch request bodies are limited to 4 MiB; JSON bodies must be objects.
- Internal socket-peer header is injected from the TCP peer and stripped from responses.
- Local auth requires loopback except compute workers, where Docker networking is explicitly the security boundary.
- Host catch responses expose error.message; generic secret-safe redaction is not implemented.

# Known limits

- Non-current claim excluded: claim the host resolves auth before every app handler; apps receive requireSession and invoke it per route.
- Non-current claim excluded: claim host errors are secret-safe normalized: the generic catch returns error.message.
- Non-current claim excluded: claim the host enforces same-origin mutation globally; individual apps do so where implemented.
- Non-current claim excluded: normatively absorb /api/health or /api/send-message into this spec.
- Current limit or evidence gap: Generic 500 responses may expose raw error messages; security-safe error normalization is not implemented.
- Current limit or evidence gap: Host-based handleNodeRequest and handleUpgrade paths bypass generic Fetch body-limit/auth flow and rely on each app.
- Current limit or evidence gap: Real Better Auth, canonical-origin, and platform behavior remains unperformed.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality; it does not claim that an external, browser, real-provider, or Pibo2 check ran.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/channel-runtime.test.mjs test/web-channel.test.mjs test/plugin-registry.test.mjs test/web-http.test.mjs test/web-channel-shutdown.test.mjs test/web-gateway.test.mjs`

# Related concepts

- SPC-SEC-001 owns Better Auth/local-auth session semantics; the host supplies requireSession to apps but does not globally invoke it before every app handler.
- SPC-GW-004 owns /api/health and /api/send-message, although the host dispatches them.
- Each Web app owns its own route authentication, same-origin mutation checks, data access, and rendering.
- SPC-DATA-005 owns Chat signal route data contracts.
