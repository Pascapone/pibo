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
  at: "2026-09-05T11:26:00Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:Foundation 38bb6e57f118c1543e7263c68d27e5103d3b1262"
    title: "Foundation source and named-test evidence"
  - id: "preview-production-setup"
    resource: "scope:Implementation 6df1b0d75453db86e667ddf52fb47088c1a2dc61"
    title: "Production setup, TLS authorization, and public diagnostics implementation"
implementation:
  state: "current"
  baseline_commit: "6df1b0d75453db86e667ddf52fb47088c1a2dc61"
  package: "WP-05+09-COMPUTE-OPERATOR"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_and_typecheck_execution: "performed in owned Docker after authoring; see implementation report"
traceability:
  commit: "6df1b0d75453db86e667ddf52fb47088c1a2dc61"
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
- `pibo preview doctor <preview-id> --public` checks the exact public hostname, trusted TLS, and Preview gateway routing.

### APIs

- `/apps/previews`, `/api/previews`, and `/apps/previews/:id/__pibo/session` exchange; API list/open/start/stop/remove routes never expose command, target, or workspace in the public exposure shape.
- `GET /api/previews/tls-authorize?domain=<preview-host>` is an unauthenticated, metadata-free certificate admission endpoint. It returns success only for an active exact Preview hostname.

### State

- previews.sqlite schema 4 tables preview_exposures, preview_tickets, preview_browser_sessions; exposure states active|expired|closed; health online|offline|starting|stopping|stopped|error|expired|closed; managed server states stopped|starting|running|stopping|error; owner token and generation are authoritative.

### Lifecycle

- Register external loopback target or reserve/start managed command; publish exact owner and generation; reconcile crashes/stale starts; stop and restart by stop/start operations; auto-stop managed server at fixed lease; expire/remove definition and dependent tickets/sessions.

### Failure

- Capacity reservation is atomic; listener/process identity mismatch fails closed; ambiguous ownership remains durable; stale writers cannot overwrite newer generations; failed exact termination retains ownership for retry.

### Security

- One-time hashed tickets exchange for preview/generation-bound browser sessions; same-origin authenticated control API; loopback-only upstream; host/origin/referer/cookie/auth/redirect/CSP sanitization; bounded global/per-preview connections.
- On-demand TLS admission accepts only active exact Preview ids and denies malformed, unknown, expired, and closed hostnames.

### Compatibility

- Definition TTL defaults to eight hours and is capped at seven days; managed auto-stop defaults to ten minutes and max three running servers. There are no preview restart or open CLI commands; restart is stop then start and open is a Web/API flow.

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
- pibo preview setup|expose|list|show|start|stop|doctor|remove|close
- pibo preview doctor <preview-id> --public
- GET /api/previews/tls-authorize?domain=<preview-host>
- /api/previews
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
- Certificate admission denies malformed, unknown, expired, and closed Preview hostnames without returning Preview metadata.
- Public diagnostics treat missing DNS, TLS failures, redirects, and any anonymous response other than HTTP 401 as failures.

## Known limits

- The synthesis claims Chat cards/settings, but its source/test list does not identify the consuming Chat UI adapter; requirement confidence is medium until traced.
- Repository tests do not provision public DNS or trusted certificates. Host acceptance requires an active Preview and `pibo preview doctor <preview-id> --public`.

## Reconciled stale claims

- Reject pibo preview restart and pibo preview open as current CLI commands.
- Reject public API exposure of managed command, workspace, target port, owner token, or ticket material.
- Reject previewing arbitrary external hosts or Pibo control/yielded processes.
- Reject definition TTL and managed auto-stop lease as the same clock.

## Verification and traceability

The source and named-test references are bound to traceability commit `6df1b0d75453db86e667ddf52fb47088c1a2dc61`. The earlier Foundation evidence remains identified in `sources`. The traceability commit does not imply deployment, browser, gateway-restart, real-host/provider, Windows, or Pibo2 validation.

Validation commands:

- `node --test test/preview-cli.test.mjs test/preview-public-setup.test.mjs test/preview-web.test.mjs`
- `npm run build`
- `pibo preview setup --help`
- `pibo preview doctor --help`
