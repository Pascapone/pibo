---
type: "Specification"
title: "Codex Native App Server Adapter"
description: "Defines the native Codex App Server runtime registration, process/protocol boundary, thread and turn lifecycle, resources, controls, and normalized events."
tags: ["runtime", "codex-native", "adapter", "app-server"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-14T12:52:33Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "bcb36ccd17ec45a11f4a568441037b94b1f6e0cd"
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
        - path: "src/agent-runtimes/codex-native/thread.ts"
          symbol: "forkWhileRunning"
      tests:
        - path: "test/codex-native-turn.test.mjs"
          name: "Codex native imports portable history with thread/inject_items before the first prompt"
        - path: "test/codex-native-turn.test.mjs"
          name: "Codex native normalizes assistant, reasoning, usage, terminal ordering, and durable restart resume"
        - path: "test/codex-native-thread.test.mjs"
          name: "Codex native thread controls list and fork through stable App Server methods"
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
    - id: "RUN-CNX-005"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/codex-native/adapter.ts"
          symbol: "CodexNativeAgentRuntimeAdapter.resolveBinding"
      tests:
        - path: "test/codex-native-thread.test.mjs"
          name: "Codex native binding inspection marks a missing thread without creating a replacement"
        - path: "test/codex-native-thread.test.mjs"
          name: "Codex native binding inspection repairs a stale missing binding when the original thread still exists"
      failures:
        - "Only CodexNativeThreadMissingError authorizes missing; auth, protocol, startup, permission, and transient failures propagate without reconstruction."
      confidence: "high"
---

# Scope

Own codex-native plugin/driver/profile registration, private App Server process and protocol client, thread/turn operations, native resources, approvals, compaction, history import, and cleanup.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: Initialize/initialized completes before other RPC; binding inspection rechecks both bound and stale-missing thread ids before open; portable history injects before first prompt; active turns support steer/interrupt and detached forks from completed turns; a running-safe fork does not adopt the derived thread or change the source binding; shutdown is bounded and idempotent.
- State: Profile and instance are codex-native; the validated App Server is 0.153.2 and compatible stable 0.153.x releases from patch 2 are accepted with protocol codex-app-server-v2; native thread identity is persisted for resume.
- Failure: Only the App Server's normalized thread-missing result is authoritative absence. Auth, startup, protocol, permission, corruption, and transient inspection failures remain unavailable errors and never authorize reconstruction. Pending requests, retries, timeouts, frame sizes, backpressure, stderr, crashes, malformed JSON, and shutdown are bounded.
- Security: The child uses a private Codex home and environment allowlist; credentials and sensitive diagnostics are redacted; tool leases are scoped and revoked on failure/disposal.
- Compatibility: Generated protocol schemas are pinned to the supported App Server version; foreign and duplicate notifications do not duplicate terminal output.

# Requirements and invariants

## Requirement: RUN-CNX-001

The Codex Native plugin SHALL register driver, configured instance, and profile under codex-native without registering a codex alias.

## Requirement: RUN-CNX-002

The App Server client SHALL complete initialize/initialized before other requests and bound pending requests, retries, timeouts, frame sizes, backpressure, stderr diagnostics, crashes, and shutdown.

## Requirement: RUN-CNX-003

Codex Native SHALL import portable history with thread/inject_items before the first prompt, preserve restart-resumable native thread identity, and support detached forks from completed turns without adopting the derived thread while the source turn is active.

## Requirement: RUN-CNX-004

Codex Native resource delivery SHALL materialize selected skills/context and verified HTTP MCP access, honor native-subagent overrides, renew bounded leases, and clean or revoke failed generations.

## Requirement: RUN-CNX-005

Codex Native binding inspection SHALL re-read bound and missing thread ids through the configured App Server, repair a stale missing binding when the original thread exists, and return missing only for the normalized authoritative thread-not-found outcome. Every other inspection failure SHALL propagate without creating or selecting a replacement runtime.

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

- Validation boundary: Exact Codex 0.153.2 schema generation and live `initialize`, `account/read`, `model/list`, and `thread/start` calls passed; authenticated model-turn parity was not rerun as part of this dependency-only upgrade.
- Non-current claim excluded: codex is an alias registered by the native plugin.
- Non-current claim excluded: Codex Native uses Pi prompt injection or Pi tool compilation.
- Non-current claim excluded: Protocol compatibility is unconstrained across App Server versions.

# Verification and traceability

Source symbols and named tests are bound to commit `bcb36ccd17ec45a11f4a568441037b94b1f6e0cd`. Requirement confidence measures trace quality, not whether a command ran.

The exact Codex 0.153.2 binary regenerated 83 full and 622 stable-v2 schema definitions. The committed SHA-256 values are `e8284c5cb8157554a3dd1e035aadbd4325aea501af56887e9c2e12eb1b9b9448` for the full schema and `d3eace08be5dca386bfd1f1e8df650058b4113f1e10870a284d775d75517576a` for stable v2. Schema comparison found no removed Pibo-required methods or definitions; the observed changes were additive.

Package verification commands:

- `npm run build`
- `node --test test/codex-native-client.test.mjs test/codex-native-turn.test.mjs test/codex-native-resources.test.mjs test/agent-runtime-registry.test.mjs`

# Related concepts

- `SPC-RUN-001` owns generic adapter contract.
- `SPC-RUN-003` owns portable resource/tool selection and credentials.
- `SPC-RUN-008` owns cross-runtime control precedence.
