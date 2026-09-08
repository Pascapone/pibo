---
type: "Specification"
title: "Authenticated Web Host and Channel"
description: "Defines the implemented authenticated web host and channel contract and its current ownership boundaries."
tags: ["gateway", "web-host"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-08T19:00:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "d2b4a2106c8632b0cc43b24b558d291d2b245359"
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
    - id: "WP02-GW-WEB-007"
      status: "implemented"
      sources:
        - path: "src/web/http.ts"
          symbol: "sendWebResponse"
        - path: "src/web/channel.ts"
          symbol: "createWebHostChannel"
      tests:
        - path: "test/web-http.test.mjs"
          name: "sendWebResponse contains a body failure after writeHead without writing a second header block"
        - path: "test/web-http.test.mjs"
          name: "sendWebResponse refuses every terminal or already-started response state"
        - path: "test/web-http.test.mjs"
          name: "disconnect during a pending compressed-body read cancels and unlocks the reader before headers"
        - path: "test/web-http.test.mjs"
          name: "compressed-body buffering rechecks response state before writeHead"
        - path: "test/web-http.test.mjs"
          name: "regular streaming cancels and unlocks its reader when the response ends mid-chunk"
        - path: "test/web-channel-failure-containment.test.mjs"
          name: "partially-written node handlers stay request-scoped"
        - path: "test/web-channel-failure-containment.test.mjs"
          name: "client disconnect cancels a streaming body without an unhandled rejection"
        - path: "test/web-channel-failure-containment.test.mjs"
          name: "a defect in async upgrade error handling is contained at the socket entry point"
      failures:
        - "A response that has been destroyed, ended, finished, or had headers sent cannot start another status line or header block."
        - "Post-header body failures and client disconnects cancel the Web body reader and close only the affected response or socket."
        - "Request diagnostics omit headers, cookies, bodies, query strings, error messages, and credentials."
      confidence: "high"
    - id: "WP02-GW-STATUS-008"
      status: "implemented"
      sources:
        - path: "src/web/channel.ts"
          symbol: "createGatewayStatusResponse"
        - path: "src/gateway/cli.ts"
          symbol: "printSafetyStatus"
      tests:
        - path: "test/gateway-restart-safety.test.mjs"
          name: "reports degraded run-job reliability without counting orphan jobs as active runs"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "gateway doctor reports degraded run-job reliability without presenting it as active work"
      public: ["/gateway/status reliability", "pibo gateway web status", "pibo gateway web doctor"]
      failures:
        - "Orphan reliability state is degraded and observable but does not become active work or a replay trigger."
      confidence: "high"
    - id: "WP02-GW-STATUS-006"
      status: "implemented"
      sources:
        - path: "src/core/session-router.ts"
          symbol: "projectKnownSessionSignals"
        - path: "src/core/session-router.ts"
          symbol: "getSubagentDepth"
        - path: "src/web/channel.ts"
          symbol: "createGatewayRuntimeStatuses"
      tests:
        - path: "test/session-router-store.test.mjs"
          name: "signal snapshots order known parents without rereading each stored Session"
        - path: "test/session-router-store.test.mjs"
          name: "listed Session depth matches store traversal for roots, missing parents, and cycles"
        - path: "test/gateway-restart-safety.test.mjs"
          name: "blocks with processing sessions"
      public: ["/gateway/status", "pibo gateway web status", "PiboSessionRouter.snapshotSignalSession"]
      failures:
        - "Depth optimization does not omit active telemetry, queue state, or runtime activity and does not change restart-safety decisions."
        - "Missing-parent and cycle traversal retains the existing bounded depth behavior."
      confidence: "high"
---

# Scope

Generic Web channel/context contract, host route ordering and app mounting, Node-to-Web request/response limits, canonical redirect, socket-peer metadata, auth service selection/bind gates, and graceful shutdown.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: PiboChannelAuthMode; PiboChannel; PiboChannelContext; WebHostChannel; no host-owned product database.
- Routes and protocols: default 127.0.0.1:4788; public /health; public /gateway/status; /api/auth/* to auth service; Simple Agent API dispatch before apps; unique plugin mountPath/apiPrefix dispatch; root redirect to explicit landing app or first app; host-based Node request/upgrade handlers
- State transitions: Channel start requires context and binds one HTTP server. Canonical-origin redirect precedes public/auth/app dispatch. Response startup distinguishes destroyed, ended, finished, and headers-sent state. A post-header failure cancels the body reader and destroys only the affected response; request and upgrade fire-and-forget promises have terminal rejection boundaries. Stop aborts active event streams, closes idle connections, drains ordinary responses, then force-destroys remaining sockets after the configured timeout.
- Failure and security: Web channel declares auth mode required, and gateway startup rejects required-auth channels without an auth service. Generic Fetch request bodies are limited to 4 MiB; JSON bodies must be objects. Internal socket-peer header is injected from the TCP peer and stripped from responses. Local auth requires loopback except compute workers, where Docker networking is explicitly the security boundary. Host catch responses expose error.message to the affected client when no response has started; bounded server diagnostics omit message text, request headers, cookies, bodies, credentials, and query strings.
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

## Requirement: WP02-GW-WEB-007: HTTP failures remain inside their request or upgrade boundary

Before writing a status line, the host SHALL distinguish destroyed, ended, finished, and headers-sent responses. If response streaming fails after headers, it SHALL cancel the body reader and close the affected response without writing a second header block. A client disconnect SHALL cancel streaming without an unhandled rejection. Application Node handlers that partially write and then throw SHALL be contained, while failures before response startup SHALL retain the normal JSON error response. Every asynchronous request and upgrade entry point SHALL terminate rejected fire-and-forget promises at the request or socket boundary. Diagnostics SHALL identify the phase, method, bounded path, error class/code, and response state without recording bodies, header values, cookies, credentials, query strings, or error messages.

## Requirement: WP02-GW-STATUS-008: Gateway health separates degraded run-job reliability from active work

Gateway status and doctor SHALL report expired orphan run-job and `orphan_run_job` dead-letter counts. Those records SHALL NOT appear in `activeRuns` or block as active yielded execution. Doctor SHALL return a degraded exit when orphan reliability records remain, without replaying or otherwise executing them.

## Requirement: WP02-GW-STATUS-006: Signal projection reuses its complete listed view

When known-session signal projection has listed the stored Sessions, it SHALL derive ancestor depths from that same per-call view without rereading each Session or ancestor from storage. Parent-first projection, current queue/activity signals, and available active telemetry SHALL remain unchanged. A subsequent projection SHALL use a fresh listed view rather than a cross-request cache.

- GIVEN a reverse-ordered parent chain among 511 stored Sessions, WHEN the router snapshots a child, THEN the correct root/parent relationship remains visible with one list operation and no per-record ancestor reads.
- GIVEN a new stored child, WHEN another snapshot is requested, THEN the new child appears without a cache-expiry wait.
- GIVEN active tool execution and queued input, WHEN the gateway status is queried, THEN processing, queue depth, and available telemetry remain visible and the CLI's existing active-work restart guard remains blocking.
- Missing parents and cycles retain the existing depth behavior. Runtime-status enumeration still performs per-runtime projection; this requirement does not promise constant-time scaling or a universal latency deadline.

Exact-code Docker regression and Pibo2 status/load/safety/streaming evidence are in the [status scaling report](/reports/gateway-status-scaling-validation-2026-09-06.md). No timeout extension or restart attempt was used to satisfy acceptance.

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
- Host catch responses expose error.message only to the affected client when no response has started; request-scoped server diagnostics do not log message text, response bodies, headers, cookies, credentials, or query strings.

# Known limits

- Non-current claim excluded: claim the host resolves auth before every app handler; apps receive requireSession and invoke it per route.
- Non-current claim excluded: claim host errors are secret-safe normalized: the generic catch returns error.message.
- Non-current claim excluded: claim the host enforces same-origin mutation globally; individual apps do so where implemented.
- Non-current claim excluded: normatively absorb /api/health or /api/send-message into this spec.
- Current limit or evidence gap: Generic 500 response bodies may expose raw error messages to the requesting client; client-facing security-safe error normalization is not implemented.
- Current limit or evidence gap: Host-based handleNodeRequest and handleUpgrade paths bypass generic Fetch body-limit/auth flow and rely on each app.
- Current limit or evidence gap: Real Better Auth, canonical-origin, and platform behavior remains unperformed.

# Verification and traceability

Source symbols and named tests are bound to commit `806e1d2f0cb369c1d378b0c2e667e5ee5a229470`. Requirement confidence measures trace quality. WP02-GW-STATUS-006 additionally has 109 focused Docker passes, a full build and all typechecks, plus exact-candidate authenticated/headful Pibo2 acceptance. Its scoped evidence does not expand the older requirements into unrelated platform or authentication acceptance.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/channel-runtime.test.mjs test/web-channel.test.mjs test/plugin-registry.test.mjs test/web-http.test.mjs test/web-channel-failure-containment.test.mjs test/web-channel-shutdown.test.mjs test/web-gateway.test.mjs`

# Related concepts

- SPC-SEC-001 owns Better Auth/local-auth session semantics; the host supplies requireSession to apps but does not globally invoke it before every app handler.
- SPC-GW-004 owns /api/health and /api/send-message, although the host dispatches them.
- Each Web app owns its own route authentication, same-origin mutation checks, data access, and rendering.
- SPC-DATA-005 owns Chat signal route data contracts.
