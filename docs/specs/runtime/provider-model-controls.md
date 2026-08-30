---
type: "Specification"
title: "Runtime Provider, Model, Auth, Thinking, and Fast-Mode Controls"
description: "Defines adapter-neutral auth, model catalog/default selection, active-model truth, provider fallback, thinking levels, and fast-mode capability gates."
tags: ["runtime", "providers", "models", "auth", "thinking", "fast-mode"]
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
    - id: "RUN-CTRL-001"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/auth.ts"
          symbol: "AGENT_RUNTIME_AUTH_METHOD_IDS"
        - path: "src/agent-runtime/registry.ts"
          symbol: "AgentRuntimeAdapterRegistry"
      tests:
        - path: "test/agent-runtime-auth.test.mjs"
          name: "runtime auth dispatch targets the selected configured instance and strips adapter-private fields"
      failures:
        - "Fallback retries only retryable provider failures and restores the primary model; context/runtime failures are not retried; unsupported controls fail explicitly."
        - "Registry auth dispatch targets the selected configured instance and strips adapter-private fields; auth text redaction bounds and removes secrets, email, and path-like data."
      confidence: "high"
    - id: "RUN-CTRL-002"
      status: "implemented"
      sources:
        - path: "src/core/model-defaults.ts"
          symbol: "selectRequestedModelProfile"
        - path: "src/core/session-router.ts"
          symbol: "PiboSessionRouter"
      tests:
        - path: "test/model-defaults.test.mjs"
          name: "model selection prefers hard pin, then role override, then defaults"
        - path: "test/session-model-source-of-truth.test.mjs"
          name: "existing session activeModel wins over changed defaults"
      failures:
        - "Fallback retries only retryable provider failures and restores the primary model; context/runtime failures are not retried; unsupported controls fail explicitly."
        - "Registry auth dispatch targets the selected configured instance and strips adapter-private fields; auth text redaction bounds and removes secrets, email, and path-like data."
      confidence: "high"
    - id: "RUN-CTRL-003"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/types.ts"
          symbol: "AgentRuntimeModelCatalog"
        - path: "src/agent-runtimes/pi/model-catalog.ts"
          symbol: "loadModelCatalogWithServices"
      tests:
        - path: "test/model-catalog.test.mjs"
          name: "model catalog groups models by provider and carries auth state"
        - path: "test/model-catalog.test.mjs"
          name: "load model catalog returns empty providers when service creation fails"
      failures:
        - "Fallback retries only retryable provider failures and restores the primary model; context/runtime failures are not retried; unsupported controls fail explicitly."
        - "Registry auth dispatch targets the selected configured instance and strips adapter-private fields; auth text redaction bounds and removes secrets, email, and path-like data."
      confidence: "high"
    - id: "RUN-CTRL-004"
      status: "implemented"
      sources:
        - path: "src/core/provider-recovery.ts"
          symbol: "isRetryablePiboProviderError"
        - path: "src/core/session-router.ts"
          symbol: "PiboSessionRouter"
      tests:
        - path: "test/runtime-routed-session.test.mjs"
          name: "generic routed orchestration tries ordered provider fallbacks and restores the primary model"
        - path: "test/runtime-routed-session.test.mjs"
          name: "provider fallback does not retry context or runtime failures"
      failures:
        - "Fallback retries only retryable provider failures and restores the primary model; context/runtime failures are not retried; unsupported controls fail explicitly."
        - "Registry auth dispatch targets the selected configured instance and strips adapter-private fields; auth text redaction bounds and removes secrets, email, and path-like data."
      confidence: "high"
    - id: "RUN-CTRL-005"
      status: "implemented"
      sources:
        - path: "src/core/thinking.ts"
          symbol: "PIBO_THINKING_LEVELS"
        - path: "src/core/model-defaults.ts"
          symbol: "selectRequestedFastMode"
      tests:
        - path: "test/model-defaults.test.mjs"
          name: "thinking selection prefers role override, profile override, then defaults"
        - path: "test/model-defaults.test.mjs"
          name: "fast mode selection preserves explicit false and role-specific priority"
        - path: "test/runtime-routed-session.test.mjs"
          name: "generic routed controls reject unadvertised adapter capabilities explicitly"
      failures:
        - "Fallback retries only retryable provider failures and restores the primary model; context/runtime failures are not retried; unsupported controls fail explicitly."
        - "Registry auth dispatch targets the selected configured instance and strips adapter-private fields; auth text redaction bounds and removes secrets, email, and path-like data."
      confidence: "high"
---

# Scope

Own runtime auth contracts/dispatch, model catalogs and defaults, active model/fallback freezing, retryable provider recovery, thinking-level values/precedence, and fast-mode capability gates.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: New sessions freeze resolved active model and ordered fallback metadata; adapter-shared auth mutation recycles affected runtime sessions.
- State: Auth methods are device_code, browser_oauth, or api_key; credential scope is runtime-instance or adapter-shared; thinking levels are off, minimal, low, medium, high, xhigh, max.
- Failure: Fallback retries only retryable provider failures and restores the primary model; context/runtime failures are not retried; unsupported controls fail explicitly.
- Security: Registry auth dispatch targets the selected configured instance and strips adapter-private fields; auth text redaction bounds and removes secrets, email, and path-like data.
- Compatibility: Selection precedence is hard profile pin, role override, then persisted defaults; explicit false fast mode is preserved; existing session activeModel wins over changed defaults.

# Requirements and invariants

## Requirement: RUN-CTRL-001

Runtime auth SHALL expose only the implemented method, completion, state, and credential-scope contracts and SHALL dispatch against the selected configured instance with sanitized results.

## Requirement: RUN-CTRL-002

Model selection SHALL prefer a hard profile pin, then role override, then persisted defaults, and new sessions SHALL freeze the result as activeModel while existing sessions retain their frozen value.

## Requirement: RUN-CTRL-003

Model catalogs SHALL group models by provider, include auth state, and fail to an empty provider list when catalog service creation fails.

## Requirement: RUN-CTRL-004

Provider fallback SHALL try only frozen ordered fallbacks for retryable provider failures, restore the primary model, and SHALL not retry context or runtime failures.

## Requirement: RUN-CTRL-005

Thinking and fast-mode selection SHALL use implemented precedence, preserve explicit false, accept only off/minimal/low/medium/high/xhigh/max thinking values, and reject controls not advertised by the active adapter.

# Interfaces and ownership

Implemented public contracts:

- `AgentRuntimeAuthCatalog`
- `AgentRuntimeAuthState`
- `AgentRuntimeAdapterRegistry auth dispatch`
- `AgentRuntimeModelCatalog`
- `PiboModelDefaults`
- `selectRequestedModelProfile`
- `PIBO_THINKING_LEVELS`
- `selectRequestedFastMode`
- `isRetryablePiboProviderError`

Related ownership boundaries:

- `SPC-SEC-001`: product authentication, credential storage policy, and access control.
- `SPC-RES-005`: media provider behavior.
- `SPC-WEB-003`: web menus and control rendering.
- `SPC-RUN-004/SPC-RUN-005/SPC-RUN-006`: adapter-specific wire operations and provider integrations.

# Failure and security behavior

- Fallback retries only retryable provider failures and restores the primary model; context/runtime failures are not retried; unsupported controls fail explicitly.
- Registry auth dispatch targets the selected configured instance and strips adapter-private fields; auth text redaction bounds and removes secrets, email, and path-like data.

# Known limits

- Evidence gap: The canonical capability map has no owner id for this target; assign one before bundle integration without inventing a code registration.
- Non-current claim excluded: Pibo Home/workspace spec owns model-default precedence.
- Non-current claim excluded: Provider fallback retries context or runtime failures.
- Non-current claim excluded: Fast mode is truthy-only and cannot persist explicit false.
- Non-current claim excluded: src/providers defines media-provider behavior.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/agent-runtime-auth.test.mjs test/model-catalog.test.mjs test/model-defaults.test.mjs test/runtime-routed-session.test.mjs test/session-model-source-of-truth.test.mjs`

# Related concepts

- `SPC-SEC-001` owns product authentication, credential storage policy, and access control.
- `SPC-RES-005` owns media provider behavior.
- `SPC-WEB-003` owns web menus and control rendering.
- `SPC-RUN-004/SPC-RUN-005/SPC-RUN-006` owns adapter-specific wire operations and provider integrations.
