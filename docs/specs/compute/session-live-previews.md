---
type: "Specification"
title: "Session Live Previews and Safe Proxy"
description: "Defines the implemented session live previews and safe proxy contract and its current ownership, security, compatibility, and verification boundaries."
tags:
- compute
- resources
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-05T18:02:56Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:Foundation 38bb6e57f118c1543e7263c68d27e5103d3b1262"
    title: "Foundation source and named-test evidence"
  - id: "preview-production-setup"
    resource: "scope:Implementation 6df1b0d75453db86e667ddf52fb47088c1a2dc61"
    title: "Production setup, TLS authorization, and public diagnostics implementation"
  - id: "preview-desktop-auto-open"
    resource: "scope:Integrated implementation 165cae998cdb64e6bdbf8b2fb3d89be46faaa5eb"
    title: "Session-scoped creation events and Desktop Preview auto-open implementation"
  - id: "compute-worker-dev-auth-preview"
    resource: "scope:Implementation 0f2f0b107759592e360ad5ab8724cf56eca21560"
    title: "Compute worker Preview dev-auth bridge implementation and focused validation"
implementation:
  state: "current"
  baseline_commit: "af47292937cacdb294e71939ebf87701d22e383c"
  package: "WP-05+09-COMPUTE-OPERATOR"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_and_typecheck_execution: "performed in owned Docker after authoring; see implementation report"
traceability:
  commit: "af47292937cacdb294e71939ebf87701d22e383c"
  requirements:
    - id: "CMP-PREVIEW-001"
      status: "implemented"
      sources:
        - path: src/previews/store.ts
          symbol: PreviewStore
        - path: src/previews/store.ts
          symbol: PREVIEW_SCHEMA_VERSION
        - path: src/previews/types.ts
          symbol: PreviewExposure
      tests:
        - path: test/preview-manager.test.mjs
          name: "managed Preview capacity reservation is atomic across store connections"
        - path: test/preview-manager.test.mjs
          name: "ownerless error recovery rejects every partially persisted owner"
      public:
        - "preview_exposures"
        - "preview_tickets"
        - "preview_browser_sessions"
        - "pibo preview expose|show|list"
      failures:
        - "Capacity and ownership are durable; ownerless or partially persisted state is rejected rather than guessed clean."
      confidence: high
    - id: "CMP-PREVIEW-002"
      status: "implemented"
      sources:
        - path: src/previews/manager.ts
          symbol: startManagedPreview
        - path: src/previews/manager.ts
          symbol: stopManagedPreview
        - path: src/previews/manager.ts
          symbol: reconcileManagedPreviews
      tests:
        - path: test/preview-manager.test.mjs
          name: "managed Preview lifecycle uses a fixed lease and can stop and restart independently"
        - path: test/preview-manager.test.mjs
          name: "stale starting reservations are reaped after a gateway crash"
        - path: test/preview-manager.test.mjs
          name: "an old stop generation cannot overwrite a newer start reservation"
      public:
        - "pibo preview start|stop"
        - "POST /api/previews/:id/start|stop"
      failures:
        - "Generation and process identity prevent stale writers or failed termination from being reported as a clean replacement."
      confidence: high
    - id: "CMP-PREVIEW-003"
      status: "implemented"
      sources:
        - path: src/previews/proxy.ts
          symbol: proxyPreviewHttp
        - path: src/previews/proxy.ts
          symbol: proxyPreviewWebSocket
        - path: src/previews/network.ts
          symbol: validatePreviewPort
        - path: src/previews/web-app.ts
          symbol: createPreviewWebApp
      tests:
        - path: test/preview-proxy-security.test.mjs
          name: "preview proxy connection admission is bounded per preview and globally"
        - path: test/preview-proxy-security.test.mjs
          name: "preview redirect and cookie sanitizers reject response splitting and alternate loopback targets"
        - path: test/preview-web.test.mjs
          name: "in-flight HTTP, SSE, and WebSocket requests never cross a managed generation rotation"
      public:
        - "/apps/previews/:id/*"
        - "preview WebSocket upgrade"
      failures:
        - "Only authorized loopback generations are proxied; connection admission is bounded and held until downstream completion."
      confidence: high
    - id: "CMP-PREVIEW-004"
      status: "implemented"
      sources:
        - path: src/previews/cli.ts
          symbol: runPreviewCli
        - path: src/previews/web-app.ts
          symbol: createPreviewWebApp
        - path: src/core/preview-server-settings.ts
          symbol: sanitizePreviewServerSettings
      tests:
        - path: test/preview-web.test.mjs
          name: "Preview lifecycle API starts, stops, and removes managed servers without exposing commands"
        - path: test/preview-web.test.mjs
          name: "authenticated accounts bootstrap isolated HTTP, SSE, redirect, and WebSocket previews"
      public:
        - "pibo preview expose|list|show|start|stop|doctor|remove|close"
        - "/api/previews"
        - "Preview server settings"
      failures:
        - "Public controls omit commands, workspace paths, target ports, owner tokens, and ticket material; authenticated controls remain separate from proxy data."
      confidence: medium
    - id: "CMP-PREVIEW-005"
      status: "implemented"
      sources:
        - path: src/previews/public-setup.ts
          symbol: createPreviewProductionSetupPlan
        - path: src/previews/public-setup.ts
          symbol: inspectPreviewPublicRoute
        - path: src/previews/web-app.ts
          symbol: createPreviewWebApp
        - path: src/previews/cli.ts
          symbol: runPreviewCli
      tests:
        - path: test/preview-cli.test.mjs
          name: "preview setup prints exact DNS, Caddy, config, restart, and verification instructions"
        - path: test/preview-public-setup.test.mjs
          name: "public Preview inspection accepts only the anonymous Preview gateway response"
        - path: test/preview-web.test.mjs
          name: "authenticated accounts bootstrap isolated HTTP, SSE, redirect, and WebSocket previews"
      public:
        - "pibo preview setup"
        - "pibo preview doctor <preview-id> --public"
        - "GET /api/previews/tls-authorize?domain=<preview-host>"
      failures:
        - "TLS authorization denies malformed, unknown, expired, and closed Preview hostnames; public diagnostics fail on missing DNS, untrusted TLS, redirects, and non-Preview responses."
      confidence: high
    - id: "CMP-PREVIEW-006"
      status: "implemented"
      sources:
        - path: src/previews/web-app.ts
          symbol: createPreviewEventStream
        - path: src/apps/chat-ui/src/api-previews.ts
          symbol: subscribeSessionLivePreviewEvents
        - path: src/apps/chat-ui/src/session-trace-pane.tsx
          symbol: SessionTracePane
      tests:
        - path: test/preview-web.test.mjs
          name: "Preview event stream emits only previews created after subscription for its Pibo Session"
        - path: test/chat-ui-session-live-preview.test.mjs
          name: "live preview event subscriptions stay scoped to the selected Pibo Session"
      public:
        - "GET /api/previews/events?piboSessionId=ps_..."
        - "Desktop Preview workspace tab"
      failures:
        - "The authenticated event stream emits only newly created previews for its requested Session; Chat ignores mismatched Session events and subscribes only while the Desktop workspace is active."
      confidence: high
    - id: "CMP-PREVIEW-007"
      status: "implemented"
      sources:
        - path: src/previews/compute-worker.ts
          symbol: resolvePreviewComputeWorkerTarget
        - path: src/previews/cli.ts
          symbol: runPreviewCli
        - path: src/previews/proxy.ts
          symbol: proxyPreviewHttp
        - path: src/previews/proxy.ts
          symbol: proxyPreviewWebSocket
        - path: src/previews/store.ts
          symbol: PREVIEW_SCHEMA_VERSION
      tests:
        - path: test/preview-compute-worker.test.mjs
          name: "Preview worker selection resolves only a running labeled compute Web port"
        - path: test/preview-cli.test.mjs
          name: "preview CLI exposes only a running labeled Pibo compute worker in dev-auth mode"
        - path: test/preview-proxy-security.test.mjs
          name: "compute-worker dev-auth mode preserves credential stripping but omits public forwarding metadata"
        - path: test/preview-web.test.mjs
          name: "authenticated accounts bootstrap isolated HTTP, SSE, redirect, and WebSocket previews"
      public:
        - "pibo preview expose-worker <worker> --session <pibo-session-id>"
      failures:
        - "Worker Preview exposure rejects unknown, stopped, unlabeled, reserved-port, non-loopback-published, and non-Pibo compute targets; public forwarding and credential metadata remain absent from the dev-auth upstream request."
      confidence: high
---
# Session Live Previews and Safe Proxy

## Why

Session previews need a controlled way to expose loopback applications without turning previewing into arbitrary proxying or credential disclosure.

## Scope

This specification describes implemented behavior at the traceability commit. It owns the contracts listed below and does not turn adjacent implementation or future plans into current authority.

### In scope

- Preview definitions, managed child lifecycle, loopback target validation, owner/generation authority, ticket/session exchange, HTTP/SSE/WebSocket proxy, preview CLI/API, and preview settings.

### Out of scope

- Arbitrary external reverse proxying or yielded/control processes.
- General gateway lifecycle and product authentication semantics; preview routes consume authenticated app sessions.
- Generic Chat renderer semantics; preview session-card placement is a product/Web consumer boundary.

## Current behavior

### Commands

- `pibo preview setup` prints exact wildcard DNS, Caddy, configuration, restart, and verification instructions without mutating the host.
- `pibo preview expose|list|show|start|stop|doctor|remove|close`; `close` aliases `remove`. `expose` requires an owning session and either a reachable loopback port or a validated `--command`.
- `pibo preview expose-worker <worker> --session <pibo-session-id>` resolves a running Pibo-managed compute worker by name or id, requires its labeled Web port to be published on host loopback, and registers the dedicated compute dev-auth proxy mode.
- `pibo preview doctor <preview-id> --public` checks the exact public hostname, trusted TLS, and Preview gateway routing.

### APIs

- `/apps/previews`, `/api/previews`, the authenticated Session-scoped `/api/previews/events` stream, and `/apps/previews/:id/__pibo/session` exchange; API list/open/start/stop/remove routes never expose command, target, or workspace in the public exposure shape.
- `GET /api/previews/tls-authorize?domain=<preview-host>` is an unauthenticated, metadata-free certificate admission endpoint. It returns success only for an active exact Preview hostname.

### State

- `previews.sqlite` schema version 6 stores `preview_exposures`, `preview_tickets`, and `preview_browser_sessions`; exposure states are active|expired|closed; health is online|offline|starting|stopping|stopped|error|expired|closed; managed server states are stopped|starting|running|stopping|error; owner token and generation are authoritative. Each exposure persists an internal `standard|pibo-compute-dev-auth` proxy mode.

### Lifecycle

- Register external loopback target or reserve/start managed command; publish exact owner and generation; emit newly created Preview records to the matching authenticated Session event stream; reconcile crashes/stale starts; stop and restart by stop/start operations; auto-stop managed server at fixed lease; expire/remove definition and dependent tickets/sessions.

### Failure

- Capacity reservation is atomic; listener/process identity mismatch fails closed; ambiguous ownership remains durable; stale writers cannot overwrite newer generations; failed exact termination retains ownership for retry.

### Security

- One-time hashed tickets exchange for preview/generation-bound browser sessions; same-origin authenticated control API; loopback-only upstream; host/origin/referer/cookie/auth/redirect/CSP sanitization; bounded global/per-preview connections.
- The compute dev-auth mode still strips Pibo cookies, authorization, socket-peer, and proxy metadata and rewrites Host, Origin, and Referer to the selected loopback target. It differs only by not synthesizing public `X-Forwarded-Host` or `X-Forwarded-Proto`, so the target gateway can apply its existing local dev-auth checks to the actual local socket.
- On-demand TLS admission accepts only active exact Preview ids and denies malformed, unknown, expired, and closed hostnames.

### Compatibility

- Definition TTL defaults to eight hours and is capped at seven days; managed auto-stop defaults to ten minutes and max three running servers. There are no preview restart or open CLI commands; restart is stop then start and open is a Web/API flow.
- Chat auto-opens a newly created Preview only for the currently selected Pibo Session while the Desktop workspace is active; mobile and background Sessions do not open a workspace tab.
- Existing `expose` registrations remain in standard proxy mode. The dev-auth mode is selected only by `expose-worker` after Pibo compute labels, running state, labeled Web port, host-loopback publication, target reachability, and process identity all validate.

## Requirements and invariants

### Requirement: CMP-PREVIEW-001

Persist preview identity, owning session/project, definition TTL, management mode, server state, exact process owner, generation, tickets, and browser sessions with capacity bounds.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/previews/store.ts` — `PreviewStore`; `src/previews/store.ts` — `PREVIEW_SCHEMA_VERSION`; `src/previews/types.ts` — `PreviewExposure`
- Tests: `test/preview-manager.test.mjs` — “managed Preview capacity reservation is atomic across store connections”; `test/preview-manager.test.mjs` — “ownerless error recovery rejects every partially persisted owner”
- Failure/security boundary: Capacity and ownership are durable; ownerless or partially persisted state is rejected rather than guessed clean.
- Confidence: **high**

### Requirement: CMP-PREVIEW-002

Supervise managed start/stop and restart-as-stop/start with generation-safe publication, fixed auto-stop lease, stale-start settlement, and exact process-tree cleanup.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/previews/manager.ts` — `startManagedPreview`; `src/previews/manager.ts` — `stopManagedPreview`; `src/previews/manager.ts` — `reconcileManagedPreviews`
- Tests: `test/preview-manager.test.mjs` — “managed Preview lifecycle uses a fixed lease and can stop and restart independently”; `test/preview-manager.test.mjs` — “stale starting reservations are reaped after a gateway crash”; `test/preview-manager.test.mjs` — “an old stop generation cannot overwrite a newer start reservation”
- Failure/security boundary: Generation and process identity prevent stale writers or failed termination from being reported as a clean replacement.
- Confidence: **high**

### Requirement: CMP-PREVIEW-003

Proxy HTTP, SSE, and WebSocket only to the validated loopback target for the authorized preview generation and hold bounded admission until downstream completion.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/previews/proxy.ts` — `proxyPreviewHttp`; `src/previews/proxy.ts` — `proxyPreviewWebSocket`; `src/previews/network.ts` — `validatePreviewPort`; `src/previews/web-app.ts` — `createPreviewWebApp`
- Tests: `test/preview-proxy-security.test.mjs` — “preview proxy connection admission is bounded per preview and globally”; `test/preview-proxy-security.test.mjs` — “preview redirect and cookie sanitizers reject response splitting and alternate loopback targets”; `test/preview-web.test.mjs` — “in-flight HTTP, SSE, and WebSocket requests never cross a managed generation rotation”
- Failure/security boundary: Only authorized loopback generations are proxied; connection admission is bounded and held until downstream completion.
- Confidence: **high**

### Requirement: CMP-PREVIEW-004

Expose consistent CLI and authenticated Web/API controls while keeping commands, workspace paths, target ports, and ticket material out of public exposure payloads.

#### Current

The Foundation implementation and named tests provide the current source-grounded contract. The named tests were inspected and later executed only as recorded in the implementation report; they do not expand this requirement beyond the cited behavior.

#### Acceptance

- Source: `src/previews/cli.ts` — `runPreviewCli`; `src/previews/web-app.ts` — `createPreviewWebApp`; `src/core/preview-server-settings.ts` — `sanitizePreviewServerSettings`
- Tests: `test/preview-web.test.mjs` — “Preview lifecycle API starts, stops, and removes managed servers without exposing commands”; `test/preview-web.test.mjs` — “authenticated accounts bootstrap isolated HTTP, SSE, redirect, and WebSocket previews”
- Failure/security boundary: Public controls omit commands, workspace paths, target ports, owner tokens, and ticket material; authenticated controls remain separate from proxy data.
- Confidence: **medium**

### Requirement: CMP-PREVIEW-005

Provide a discoverable production-setup plan, bounded on-demand TLS admission, and an opt-in public diagnostic that distinguishes DNS, TLS, and routing failures.

#### Current

`pibo preview setup` emits the exact wildcard hostname, optional address record, Caddy authorization and site fragments, configuration command, safe gateway restart, and public verification command. The TLS authorization endpoint returns no metadata and succeeds only for active exact Preview hostnames. `doctor --public` expects anonymous HTTP 401 from the Preview origin; redirects and other responses fail the routing check.

#### Acceptance

- Source: `src/previews/public-setup.ts` — `createPreviewProductionSetupPlan`; `src/previews/public-setup.ts` — `inspectPreviewPublicRoute`; `src/previews/web-app.ts` — `createPreviewWebApp`; `src/previews/cli.ts` — `runPreviewCli`
- Tests: `test/preview-cli.test.mjs` — “preview setup prints exact DNS, Caddy, config, restart, and verification instructions”; `test/preview-public-setup.test.mjs` — “public Preview inspection accepts only the anonymous Preview gateway response”; `test/preview-web.test.mjs` — “authenticated accounts bootstrap isolated HTTP, SSE, redirect, and WebSocket previews”
- Failure/security boundary: Unknown or inactive hostnames cannot trigger certificate issuance; public diagnostics report DNS, certificate, redirect, and gateway-response failures separately.
- Confidence: **high**

### Requirement: CMP-PREVIEW-006

Notify Chat about newly created Previews for one requested Pibo Session and automatically select and open the deduplicated Preview workspace tab only when that Session is still selected in the Desktop workspace.

#### Current

The authenticated SSE route snapshots existing Preview ids when a client subscribes, then emits only later creations for the requested Pibo Session. Chat subscribes only when its Desktop tab opener is available, closes the subscription on Session or layout changes, rejects mismatched Session payloads, updates the Session-scoped Preview cache, selects the new Preview, and opens the existing deduplicating Preview tab.

#### Acceptance

- Source: `src/previews/web-app.ts` — `createPreviewEventStream`; `src/apps/chat-ui/src/api-previews.ts` — `subscribeSessionLivePreviewEvents`; `src/apps/chat-ui/src/session-trace-pane.tsx` — `SessionTracePane`
- Tests: `test/preview-web.test.mjs` — “Preview event stream emits only previews created after subscription for its Pibo Session”; `test/chat-ui-session-live-preview.test.mjs` — “live preview event subscriptions stay scoped to the selected Pibo Session”
- Failure/security boundary: Existing Previews are not replayed as new, events from another Pibo Session cannot open a tab, and mobile or otherwise non-Desktop layouts do not subscribe.
- Confidence: **high**

### Requirement: CMP-PREVIEW-007

Expose a running Pibo compute worker through Preview without weakening local dev-auth or forwarding production authentication material to the worker.

#### Current

`expose-worker` resolves only Pibo-managed running compute containers, requires a labeled Web port with an exact host-loopback publication, and records the internal `pibo-compute-dev-auth` mode. HTTP and WebSocket proxying keep the existing credential, cookie, redirect, CSP, Host, Origin, and Referer sanitation while omitting synthesized public forwarding host and protocol headers. Public Preview API payloads omit the internal mode.

#### Acceptance

- Source: `src/previews/compute-worker.ts` — `resolvePreviewComputeWorkerTarget`; `src/previews/cli.ts` — `runPreviewCli`; `src/previews/proxy.ts` — `proxyPreviewHttp`; `src/previews/proxy.ts` — `proxyPreviewWebSocket`; `src/previews/store.ts` — `PREVIEW_SCHEMA_VERSION`
- Tests: `test/preview-compute-worker.test.mjs` — “Preview worker selection resolves only a running labeled compute Web port”; `test/preview-cli.test.mjs` — “preview CLI exposes only a running labeled Pibo compute worker in dev-auth mode”; `test/preview-proxy-security.test.mjs` — “compute-worker dev-auth mode preserves credential stripping but omits public forwarding metadata”; `test/preview-web.test.mjs` — “authenticated accounts bootstrap isolated HTTP, SSE, redirect, and WebSocket previews”
- Failure/security boundary: Unknown, stopped, unlabeled, reserved-port, non-loopback-published, and non-Pibo targets fail before registration; public forwarding and production credential metadata remain absent from the worker request.
- Confidence: **high**

## Interfaces and ownership

**Capability IDs:** pibo.compute.previews

**Public surfaces:**

- preview_exposures
- preview_tickets
- preview_browser_sessions
- pibo preview expose|show|list
- pibo preview start|stop
- POST /api/previews/:id/start|stop
- /apps/previews/:id/*
- preview WebSocket upgrade
- pibo preview setup|expose|expose-worker|list|show|start|stop|doctor|remove|close
- pibo preview expose-worker <worker> --session <pibo-session-id>
- pibo preview doctor <preview-id> --public
- GET /api/previews/tls-authorize?domain=<preview-host>
- /api/previews
- GET /api/previews/events?piboSessionId=ps_...
- Desktop Preview workspace tab
- Preview server settings

Preview control uses authenticated product sessions and session identity but does not own generic gateway authentication, Chat rendering, or yielded processes.

Related concepts:

- [/specs/compute/workers-and-resource-lifecycle.md](/specs/compute/workers-and-resource-lifecycle.md)
- [/specs/security/web-machine-and-dev-auth.md](/specs/security/web-machine-and-dev-auth.md)
- [/specs/product/app-context.md](/specs/product/app-context.md)
- [/specs/data/sessions-and-runtime-bindings.md](/specs/data/sessions-and-runtime-bindings.md)

## Failure and security behavior

- Capacity reservation is atomic; listener/process identity mismatch fails closed; ambiguous ownership remains durable; stale writers cannot overwrite newer generations; failed exact termination retains ownership for retry.
- One-time hashed tickets exchange for preview/generation-bound browser sessions; same-origin authenticated control API; loopback-only upstream; host/origin/referer/cookie/auth/redirect/CSP sanitization; bounded global/per-preview connections.
- Compute worker exposure requires Pibo labels, running state, a labeled Web port published on host loopback, live target/process identity, and the dedicated internal mode; the public API omits that mode.
- Certificate admission denies malformed, unknown, expired, and closed Preview hostnames without returning Preview metadata.
- Public diagnostics treat missing DNS, TLS failures, redirects, and any anonymous response other than HTTP 401 as failures.

## Known limits

- The creation stream intentionally does not replay Previews that existed before subscription and does not treat a later start of an existing managed Preview as a new creation.
- Repository tests do not provision public DNS or trusted certificates. Host acceptance requires an active Preview and `pibo preview doctor <preview-id> --public`.
- Headed browser validation covered active-Session auto-open, background-Session isolation, Desktop restoration after a mobile-only creation, tab deduplication, and CDP exception/network checks. The local validation hostname did not share the Chat authentication cookie, so the isolated iframe displayed its unauthenticated fallback instead of the fixture body.

## Reconciled stale claims

- Reject pibo preview restart and pibo preview open as current CLI commands.
- Reject public API exposure of managed command, workspace, target port, owner token, or ticket material.
- Reject previewing arbitrary external hosts or Pibo control/yielded processes.
- Reject definition TTL and managed auto-stop lease as the same clock.

## Verification and traceability

The source and named-test references are bound to integrated traceability commit `af47292937cacdb294e71939ebf87701d22e383c`. The earlier Foundation, production-setup, Desktop auto-open, and compute-worker evidence remains identified in `sources`. Focused implementation tests, a real compute-worker CLI resolution, an HTTP ticket/session exchange against a local-auth Pibo gateway, and headed Desktop auto-open browser/CDP validation were performed in owned Docker workers. The traceability commit does not imply production deployment, gateway restart, real public-host TLS, external-provider, Windows, or Pibo2 validation.

Validation performed for Desktop auto-open in the isolated Docker worker:

- `npm run workflows:build`
- `npm run chat-ui:typecheck`
- root TypeScript typecheck
- `npm run build`
- `node --test test/preview-web.test.mjs test/chat-ui-session-live-preview.test.mjs test/chat-ui-desktop-tabs-model.test.mjs test/chat-ui-desktop-tabs-behavior.test.mjs`
- Headed Browser Use at 1440×723 with two Pibo Sessions plus an 800×900 mobile viewport
- CDP monitoring during auto-open found no browser exceptions or non-cancelled network failures; it reported the existing sandbox warning for Preview iframes that combine `allow-scripts` and `allow-same-origin`.

Compute worker and production-setup validation commands remain:

- `node --test test/preview-store.test.mjs test/preview-compute-worker.test.mjs test/preview-proxy-security.test.mjs test/preview-cli.test.mjs test/preview-public-setup.test.mjs test/preview-web.test.mjs test/dev-auth.test.mjs`
- `env -u PIBO_COMPUTE_WORKER node --test test/local-auth.test.mjs`
- `npm run workflows:build && node --max-old-space-size=1200 node_modules/typescript/bin/tsc -p tsconfig.json`
- `pibo preview setup --help`
- `pibo preview doctor --help`
