---
type: "Specification"
title: "Pi Coding Agent Adapter"
description: "Defines the built-in Pi adapter registration, package/protocol compatibility, direct tool delivery, lifecycle, event normalization, and Pi-owned transcript behavior."
tags: ["runtime", "pi", "adapter", "embedded"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-05T21:26:00Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "bfb31e40143ea149cf77917d787adaf477539f51"
  requirements:
    - id: "RUN-PI-005"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/pi/history.ts"
          symbol: "readPiAgentRuntimeForkCandidates"
        - path: "src/agent-runtimes/pi/adapter.ts"
          symbol: "PiAgentRuntimeAdapter"
      tests:
        - path: "test/cold-fork-candidates.test.mjs"
          name: "Pi persisted fork candidates preserve all user entries and text without rewriting native history"
      public: ["Pi persisted fork candidate inspection"]
      failures: ["Legacy or mismatched native headers return undefined for runtime fallback; cached results are invalidated by file identity or stat changes."]
      confidence: "high"
    - id: "RUN-PI-001"
      status: "implemented"
      sources:
        - path: "src/plugins/builtin.ts"
          symbol: "piboCorePlugin"
        - path: "src/agent-runtimes/pi/adapter.ts"
          symbol: "PI_AGENT_RUNTIME_DRIVER"
        - path: "src/agent-runtimes/pi/routed-session.ts"
          symbol: "forkSessionWhileRunning"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "Pi adapter opens the existing Pi runtime without rewriting the requested session id"
        - path: "test/session-actions.test.mjs"
          name: "Pi running-safe fork snapshots completed history without replacing the source manager"
      failures:
        - "Unsupported controls fail explicitly; external harness-native tools without an explicit host-tool capability cannot be wrapped, while Pi direct/native tools remain supported; transcript repair fails closed rather than rerunning durable tool effects."
        - "Pi Bash inherits only router-owned adapter environment without process-global mutation."
      confidence: "high"
    - id: "RUN-PI-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/pi/adapter.ts"
          symbol: "PI_PROTOCOL_VERSION"
        - path: "package.json"
          symbol: "@earendil-works/pi-agent-core"
        - path: "package-lock.json"
          symbol: "@earendil-works/pi-agent-core"
        - path: "package.json"
          symbol: "@earendil-works/pi-server"
      tests:
        - path: "test/pi-runtime-dependency-pin.test.mjs"
          name: "Pi runtime packages use one exact compatible version"
      failures:
        - "Unsupported controls fail explicitly; external harness-native tools without an explicit host-tool capability cannot be wrapped, while Pi direct/native tools remain supported; transcript repair fails closed rather than rerunning durable tool effects."
        - "Pi Bash inherits only router-owned adapter environment without process-global mutation."
      confidence: "high"
    - id: "RUN-PI-003"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/pi/tool-compiler.ts"
          symbol: "compilePiboToolForPi"
        - path: "src/agent-runtimes/pi/adapter.ts"
          symbol: "PI_AGENT_RUNTIME_CAPABILITIES"
        - path: "src/agent-runtimes/pi/adapter.ts"
          symbol: "PI_NATIVE_TOOL_YIELDING_LIMITATION"
      tests:
        - path: "test/pibo-tool-contract.test.mjs"
          name: "Pibo tool contract preserves JSON Schema types and compiles directly for Pi"
      source_inspected: true
      follow_up: "In a separate code/test change, add a focused Pi capability test asserting nativeToolYielding support is native and that the external harness-native tool limitation does not downgrade Pi direct/native tools; then trace that named test here."
      failures:
        - "Unsupported controls fail explicitly; external harness-native tools without an explicit host-tool capability cannot be wrapped, while Pi direct/native tools remain supported; transcript repair fails closed rather than rerunning durable tool effects."
        - "Pi Bash inherits only router-owned adapter environment without process-global mutation."
      confidence: "high"
    - id: "RUN-PI-004"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/pi/intent-tracing.ts"
          symbol: "installPiIntentTracing"
        - path: "src/agent-runtimes/pi/adapter.ts"
          symbol: "semanticEventFromPibo"
      tests:
        - path: "test/pi-intent-tracing.test.mjs"
          name: "Pi intent tracing is disabled by default and enabled only by a boolean profile option"
        - path: "test/pi-intent-tracing.test.mjs"
          name: "Pi semantic event conversion preserves tool call intent"
      failures:
        - "Unsupported controls fail explicitly; external harness-native tools without an explicit host-tool capability cannot be wrapped, while Pi direct/native tools remain supported; transcript repair fails closed rather than rerunning durable tool effects."
        - "Pi Bash inherits only router-owned adapter environment without process-global mutation."
      confidence: "high"
---

# Scope

Own the Pi driver/instance/adapter implementation, exact Pi package set, Pi session lifecycle, direct tool compiler, event normalization, native transcript/compaction, and optional intent tracing.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: The built-in Pi instance opens the existing Pi runtime, preserves the requested session id, normalizes output, and disposes idempotently. While a turn is active, it exposes only completed user-message fork candidates and creates the selected branch from a separate persisted SessionManager snapshot without replacing the active source manager.
- State: Built-in adapter, driver, and instance identity is pi; the direct Pi runtime package set and adapter protocol version are exactly 0.85.0; intent tracing is off unless a boolean runtime option enables it.
- Failure: Unsupported controls fail explicitly; external harness-native tools without an explicit host-tool capability cannot be wrapped, while Pi direct/native tools remain supported; transcript repair fails closed rather than rerunning durable tool effects.
- Security: Pi Bash inherits only router-owned adapter environment without process-global mutation.
- Compatibility: Pi-backed codex compatibility can be explicitly registered but is not a default profile; exact package pins are one compatible version.

# Requirements and invariants

## Requirement: RUN-PI-001

The core plugin SHALL register the Pi driver and configured instance with adapter, driver, and instance identity pi. Pi SHALL declare running-safe fork support and SHALL create such forks from persisted completed history without replacing the active source manager.

## Requirement: RUN-PI-002

The Pi runtime package set and adapter protocol version SHALL remain pinned to the exact compatible version 0.85.0. The direct package set SHALL include `@earendil-works/pi-server` because the published 0.85.0 coding-agent entrypoint imports that package.

## Requirement: RUN-PI-003

Pi SHALL receive portable Pibo tools through direct compilation, SHALL declare native tool yielding with support `native` for Pi direct/native tools, and SHALL limit external harness-native tool wrapping to tools with an explicit host-tool capability.

## Requirement: RUN-PI-004

Pi intent tracing SHALL be disabled by default and, when enabled, SHALL inject then strip only its collision-safe intent field while preserving tool arguments and semantic events.

## Requirement: RUN-PI-005

Pi SHALL inspect supported version-3 native histories for user-message fork candidates without initializing or rewriting the native session. It SHALL preserve native entry order and IDs, duplicate prompts, branch entries, and SDK text extraction semantics; image-only messages SHALL not become text candidates. Legacy or mismatched session headers SHALL use the generic runtime fallback.

Repeated reads MAY reuse one cache entry with at most 2 MiB of candidate text and ID payload. Cache reuse SHALL require unchanged native identity, path, device, inode, size, modification time, and change time. Returned candidates SHALL not expose shared mutable cached objects. The reader SHALL verify the file fingerprint again before caching a completed scan.

# Interfaces and ownership

Implemented public contracts:

- `PI_AGENT_RUNTIME_DRIVER`
- `PI_AGENT_RUNTIME_CAPABILITIES`
- `PI_PROTOCOL_VERSION`
- `createPiboRuntime`
- `compilePiboToolForPi`
- `semanticEventFromPibo`
- `PI_NATIVE_TOOL_YIELDING_LIMITATION`

Related ownership boundaries:

- `SPC-RUN-001`: generic adapter contract.
- `SPC-RUN-003`: portable tool/resource generation.
- `SPC-RUN-007`: generic native-history page/proof contract.

# Failure and security behavior

- Unsupported controls fail explicitly; external harness-native tools without an explicit host-tool capability cannot be wrapped, while Pi direct/native tools remain supported; transcript repair fails closed rather than rerunning durable tool effects.
- Pi Bash inherits only router-owned adapter environment without process-global mutation.

# Known limits

- Evidence gap: The package-listed runtime-routed-session test is mostly generic router coverage; adapter-specific lifecycle evidence comes from the adjacent agent-runtime-registry contract test.
- Non-current claim excluded: codex-compat-openai-web is a built-in default profile.
- Limitation: `PI_NATIVE_TOOL_YIELDING_LIMITATION` applies to external harness-native tools without an explicit host-tool capability; it does not downgrade Pi direct/native tool yielding from `support: "native"`.
- Non-current claim excluded: The generic router owns Pi transcript and compaction mechanics.

# Verification and traceability

Source symbols and named tests are bound to commit `bfb31e40143ea149cf77917d787adaf477539f51`. The persisted fork reader has [Docker and Pibo2 evidence](/reports/idle-session-history-latency-validation-2026-09-05.md); earlier package-upgrade verification remains scoped to that upgrade. Requirement confidence measures trace quality, not whether a command ran.

The 0.85.0 upgrade passed the complete TypeScript build and focused Pi/runtime routing tests. The explicit `@earendil-works/pi-server@0.85.0` pin closes the package entrypoint's published runtime import and is covered by the exact-version lockfile test.

Package verification commands:

- `npm run build`
- `node --test test/runtime-routed-session.test.mjs test/pi-runtime-dependency-pin.test.mjs test/pi-intent-tracing.test.mjs test/agent-runtime-registry.test.mjs test/pibo-tool-contract.test.mjs`

# Related concepts

- `SPC-RUN-001` owns generic adapter contract.
- `SPC-RUN-003` owns portable tool/resource generation.
- `SPC-RUN-007` owns generic native-history page/proof contract.
