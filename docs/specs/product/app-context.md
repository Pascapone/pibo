---
type: "Specification"
title: "App Context Composition"
description: "Defines the static App Context identity and web plugin composition for one authenticated Pibo product data space."
tags: ["product", "app-context", "composition", "web"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-08-30T04:15:54Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
    - id: "PROD-CTX-001"
      status: "implemented"
      sources:
        - path: "src/app-context.ts"
          symbol: "PIBO_APP_CONTEXT"
      tests:
        - path: "test/app-context-fresh-schema.test.mjs"
          name: "fresh app-context schemas omit retired access-control structures"
      failures:
        - "Unauthenticated app requests fail closed before entering App Context routes."
        - "Dev-auth selection is an explicit gateway mode and must not be described as normal production authentication."
      confidence: "medium"
    - id: "PROD-CTX-002"
      status: "implemented"
      sources:
        - path: "src/gateway/web.ts"
          symbol: "createWebPiboPluginRegistry"
        - path: "src/plugins/chat-web.ts"
          symbol: "createPiboChatWebPlugin"
      tests:
        - path: "test/web-auth-app-context.test.mjs"
          name: "web auth maps different identities to the same app context context"
      failures:
        - "Unauthenticated app requests fail closed before entering App Context routes."
        - "Dev-auth selection is an explicit gateway mode and must not be described as normal production authentication."
      confidence: "medium"
    - id: "PROD-CTX-003"
      status: "implemented"
      sources:
        - path: "src/web/auth.ts"
          symbol: "requireWebSession"
      tests:
        - path: "test/web-auth-app-context.test.mjs"
          name: "web auth still gates unauthenticated app requests"
      failures:
        - "Unauthenticated app requests fail closed before entering App Context routes."
        - "Dev-auth selection is an explicit gateway mode and must not be described as normal production authentication."
      confidence: "high"
---

# Scope

Own PIBO_APP_CONTEXT and composition of the default registry with the Chat Web plugin for one product data space.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: The App Context object is static and frozen; the web registry is composed before gateway start.
- State: Authentication gates access to one shared product context; it does not select a tenant or per-user datastore.
- Failure: Unauthenticated app requests fail closed before entering App Context routes.
- Security: Dev-auth selection is an explicit gateway mode and must not be described as normal production authentication.
- Compatibility: Fresh schemas omit retired access-control structures.

# Requirements and invariants

## Requirement: PROD-CTX-001

The product SHALL expose the frozen PIBO_APP_CONTEXT identity for exactly one shared product data space.

## Requirement: PROD-CTX-002

The web gateway SHALL compose the default Pibo registry and Chat Web plugin before serving app routes.

## Requirement: PROD-CTX-003

App Context routes SHALL reject unauthenticated requests without changing the selected product context by identity.

# Interfaces and ownership

Implemented public contracts:

- `PiboAppContext`
- `PIBO_APP_CONTEXT`
- `createWebPiboPluginRegistry`
- `createPiboChatWebPlugin`
- `requireWebSession`

Related ownership boundaries:

- `SPC-PROD-002`: plugin/profile registry contents.
- `SPC-DATA-001`: stores, databases, persistence, and product-history authority.
- `SPC-SEC-001`: identity, authentication, authorization, and credential policy.
- `SPC-GW-003`: gateway route mounting and lifecycle.

# Failure and security behavior

- Unauthenticated app requests fail closed before entering App Context routes.
- Dev-auth selection is an explicit gateway mode and must not be described as normal production authentication.

# Known limits

- Evidence gap: No dedicated integration test names duplicate app-mount rejection; keep that behavior outside normative text unless traced separately.
- Non-current claim excluded: createPiboAppContext is a public composition-root symbol.
- Non-current claim excluded: Authentication chooses a tenant or per-user database.
- Non-current claim excluded: This spec owns datastore schemas or authentication policy.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/app-context-fresh-schema.test.mjs test/web-auth-app-context.test.mjs`

# Related concepts

- `SPC-PROD-002` owns plugin/profile registry contents.
- `SPC-DATA-001` owns stores, databases, persistence, and product-history authority.
- `SPC-SEC-001` owns identity, authentication, authorization, and credential policy.
- `SPC-GW-003` owns gateway route mounting and lifecycle.
