---
type: "Specification"
title: "Codex Native App Server Adapter"
description: "Defines the native Codex App Server runtime registration, process/protocol boundary, thread and turn lifecycle, resources, controls, and normalized events."
tags: ["runtime", "codex-native", "adapter", "app-server"]
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
    - id: "RUN-CNX-001"
      status: "implemented"
      sources:
        - path: "src/plugins/codex-native.ts"
          symbol: "piboCodexNativePlugin"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "default profiles expose configured Pi and distinct native Codex runtimes"
      failures:
        - "Pending requests, retries, timeouts, frame sizes, backpressure, stderr, crashes, malformed JSON, and shutdown are bounded; one redacted terminal failure is emitted."
        - "The child uses a private Codex home and environment allowlist; credentials and sensitive diagnostics are redacted; tool leases are scoped and revoked on failure/disposal."
      confidence: "high"
    - id: "RUN-CNX-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/codex-native/client.ts"
          symbol: "CodexAppServerClient"
      tests:
        - path: "test/codex-native-client.test.mjs"
          name: "Codex App Server client performs initialize/initialized before other requests"
        - path: "test/codex-native-client.test.mjs"
          name: "Codex App Server client bounds pending requests, timeouts, and aborts"
        - path: "test/codex-native-client.test.mjs"
          name: "Codex App Server client shutdown is idempotent and bounded"
      failures:
        - "Pending requests, retries, timeouts, frame sizes, backpressure, stderr, crashes, malformed JSON, and shutdown are bounded; one redacted terminal failure is emitted."
        - "The child uses a private Codex home and environment allowlist; credentials and sensitive diagnostics are redacted; tool leases are scoped and revoked on failure/disposal."
      confidence: "high"
    - id: "RUN-CNX-003"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/codex-native/portable-history.ts"
          symbol: "injectPortableHistoryIntoCodex"
        - path: "src/agent-runtimes/codex-native/adapter.ts"
          symbol: "CodexNativeThreadSession"
      tests:
        - path: "test/codex-native-turn.test.mjs"
          name: "Codex native imports portable history with thread/inject_items before the first prompt"
        - path: "test/codex-native-turn.test.mjs"
          name: "Codex native normalizes assistant, reasoning, usage, terminal ordering, and durable restart resume"
      failures:
        - "Pending requests, retries, timeouts, frame sizes, backpressure, stderr, crashes, malformed JSON, and shutdown are bounded; one redacted terminal failure is emitted."
        - "The child uses a private Codex home and environment allowlist; credentials and sensitive diagnostics are redacted; tool leases are scoped and revoked on failure/disposal."
      confidence: "high"
    - id: "RUN-CNX-004"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/codex-native/resource-delivery.ts"
          symbol: "CodexNativeResourceDelivery"
      tests:
        - path: "test/codex-native-resources.test.mjs"
          name: "Codex native delivers selected Pibo tools, HTTP MCP, skills, and context without Pi prompt injection"
        - path: "test/codex-native-resources.test.mjs"
          name: "Codex native rejects unverified MCP delivery, revokes the scoped credential, and cleans its process generation"
      failures:
        - "Pending requests, retries, timeouts, frame sizes, backpressure, stderr, crashes, malformed JSON, and shutdown are bounded; one redacted terminal failure is emitted."
        - "The child uses a private Codex home and environment allowlist; credentials and sensitive diagnostics are redacted; tool leases are scoped and revoked on failure/disposal."
      confidence: "high"
---

# Scope

Own codex-native plugin/driver/profile registration, private App Server process and protocol client, thread/turn operations, native resources, approvals, compaction, history import, and cleanup.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: Initialize/initialized completes before other RPC; portable history injects before first prompt; active turns support steer/interrupt; shutdown is bounded and idempotent.
- State: Profile and instance are codex-native; the supported App Server line is 0.147.x with protocol codex-app-server-v2; native thread identity is persisted for resume.
- Failure: Pending requests, retries, timeouts, frame sizes, backpressure, stderr, crashes, malformed JSON, and shutdown are bounded; one redacted terminal failure is emitted.
- Security: The child uses a private Codex home and environment allowlist; credentials and sensitive diagnostics are redacted; tool leases are scoped and revoked on failure/disposal.
- Compatibility: Generated protocol schemas are pinned to the supported App Server version; foreign and duplicate notifications do not duplicate terminal output.

# Requirements and invariants

## Requirement: RUN-CNX-001

The Codex Native plugin SHALL register driver, configured instance, and profile under codex-native without registering a codex alias.

## Requirement: RUN-CNX-002

The App Server client SHALL complete initialize/initialized before other requests and bound pending requests, retries, timeouts, frame sizes, backpressure, stderr diagnostics, crashes, and shutdown.

## Requirement: RUN-CNX-003

Codex Native SHALL import portable history with thread/inject_items before the first prompt and preserve restart-resumable native thread identity.

## Requirement: RUN-CNX-004

Codex Native resource delivery SHALL materialize selected skills/context and verified HTTP MCP access, honor native-subagent overrides, renew bounded leases, and clean or revoke failed generations.

# Interfaces and ownership

Implemented public contracts:

- `piboCodexNativePlugin`
- `CODEX_NATIVE_AGENT_RUNTIME_DRIVER`
- `CodexNativeThreadSession`
- `CodexAppServerClient`
- `CodexNativeResourceDelivery`
- `injectPortableHistoryIntoCodex`

Related ownership boundaries:

- `SPC-RUN-001`: generic adapter contract.
- `SPC-RUN-003`: portable resource/tool selection and credentials.
- `SPC-RUN-008`: cross-runtime control precedence.

# Failure and security behavior

- Pending requests, retries, timeouts, frame sizes, backpressure, stderr, crashes, malformed JSON, and shutdown are bounded; one redacted terminal failure is emitted.
- The child uses a private Codex home and environment allowlist; credentials and sensitive diagnostics are redacted; tool leases are scoped and revoked on failure/disposal.

# Known limits

- Evidence gap: Generated App Server schema hashes were inspected against pinned constants, but no upstream schema-regeneration or live protocol compatibility command was run.
- Non-current claim excluded: codex is an alias registered by the native plugin.
- Non-current claim excluded: Codex Native uses Pi prompt injection or Pi tool compilation.
- Non-current claim excluded: Protocol compatibility is unconstrained across App Server versions.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/codex-native-client.test.mjs test/codex-native-turn.test.mjs test/codex-native-resources.test.mjs test/agent-runtime-registry.test.mjs`

# Related concepts

- `SPC-RUN-001` owns generic adapter contract.
- `SPC-RUN-003` owns portable resource/tool selection and credentials.
- `SPC-RUN-008` owns cross-runtime control precedence.
