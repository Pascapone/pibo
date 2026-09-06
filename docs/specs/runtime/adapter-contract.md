---
type: "Specification"
title: "Agent Runtime Adapter Contract"
description: "Defines the adapter, driver, live-session, capability, semantic-event, inspection, auth, history, and lifecycle SPI shared by runtimes."
tags: ["runtime", "adapter", "spi", "capabilities", "events"]
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
    - id: "RUN-SPI-005"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/types.ts"
          symbol: "AgentRuntimeAdapter"
        - path: "src/core/session-router.ts"
          symbol: "getSessionForkCandidates"
      tests:
        - path: "test/cold-fork-candidates.test.mjs"
          name: "cold persisted fork inspection does not open a runtime or change the binding"
        - path: "test/cold-fork-candidates.test.mjs"
          name: "unsupported persisted reads retain the live runtime fallback"
        - path: "test/cold-fork-candidates.test.mjs"
          name: "a runtime opened during persisted inspection wins over the stale candidate result"
      public: ["AgentRuntimeAdapter.readForkCandidates"]
      failures: ["Unsupported persisted reads retain the existing live-runtime path; concurrent runtime activation or binding/workspace changes invalidate the inspected result."]
      confidence: "high"
    - id: "RUN-SPI-001"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/types.ts"
          symbol: "AgentRuntimeAdapter"
        - path: "src/agent-runtime/types.ts"
          symbol: "AgentRuntimeSession"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "deterministic fake adapter passes the reusable lifecycle contract"
      failures:
        - "Unavailable diagnostics and missing required methods fail inspection/open explicitly."
        - "Generic auth results are sanitized before leaving the registry boundary."
      confidence: "high"
    - id: "RUN-SPI-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/capabilities.ts"
          symbol: "validateAgentRuntimeCapabilities"
        - path: "src/agent-runtime/contract.ts"
          symbol: "validateAgentRuntimeSessionContract"
        - path: "src/agent-runtime/contract.ts"
          symbol: "assertAgentRuntimeSessionContract"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "runtime registry validates descriptor and live-session capability claims"
        - path: "test/agent-runtime-registry.test.mjs"
          name: "runtime registry rejects partial sessions without masking contract errors during cleanup"
      failures:
        - "Unavailable diagnostics and missing required methods fail inspection/open explicitly."
        - "Generic auth results are sanitized before leaving the registry boundary."
      confidence: "high"
    - id: "RUN-SPI-003"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/events.ts"
          symbol: "AgentRuntimeSemanticEvent"
        - path: "src/agent-runtime/types.ts"
          symbol: "isAgentRuntimeSemanticEvent"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "fake adapter covers abort, failure, missing binding, and idempotent cleanup"
      failures:
        - "Unavailable diagnostics and missing required methods fail inspection/open explicitly."
        - "Generic auth results are sanitized before leaving the registry boundary."
      confidence: "medium"
    - id: "RUN-SPI-004"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/registry.ts"
          symbol: "AgentRuntimeAdapterRegistry"
      tests:
        - path: "test/agent-runtime-boundaries.test.mjs"
          name: "generic runtime and router modules do not import Pi, Codex, or adapter implementations"
      failures:
        - "Unavailable diagnostics and missing required methods fail inspection/open explicitly."
        - "Generic auth results are sanitized before leaving the registry boundary."
      confidence: "high"
---

# Scope

Own adapter-neutral TypeScript contracts, registry validation, reusable lifecycle assertions, and generic-module isolation from concrete adapters.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: A session opens against one configured instance, emits normalized events, supports advertised operations, and disposes idempotently.
- State: Descriptor, configured-instance, profile, and live-session capability claims must agree.
- Failure: Unavailable diagnostics and missing required methods fail inspection/open explicitly.
- Security: Generic auth results are sanitized before leaving the registry boundary.
- Compatibility: Generic runtime and router modules do not import Pi, Codex, or ORP implementations; compatibility facades contain no implementation logic.

# Requirements and invariants

## Requirement: RUN-SPI-001

Every runtime driver and adapter SHALL implement the exported AgentRuntimeDriver, AgentRuntimeAdapter, and AgentRuntimeSession contracts.

## Requirement: RUN-SPI-002

Declared capabilities SHALL be structurally valid and SHALL match the methods implemented by the adapter and live session.

## Requirement: RUN-SPI-003

Runtime output SHALL cross the generic boundary as AgentRuntimeSemanticEvent values with correlation and terminal lifecycle semantics.

## Requirement: RUN-SPI-004

Adapter-neutral runtime and router modules SHALL not import concrete runtime implementations.

## Requirement: RUN-SPI-005

An adapter MAY provide read-only persisted fork candidates without opening a Runtime Session. The router SHALL use this optional operation only for a matching, bound, fork-capable adapter without a live, pending, disposing, or quiescing runtime and outside router shutdown. It SHALL recheck runtime absence, workspace, and binding after inspection. A concurrent live runtime SHALL take precedence; `undefined` SHALL retain the existing runtime fallback. Concrete transcript parsing remains adapter-owned.

# Interfaces and ownership

Implemented public contracts:

- `AgentRuntimeAdapter`
- `AgentRuntimeDriver`
- `AgentRuntimeSession`
- `AgentRuntimeCapabilities`
- `AgentRuntimeSemanticEvent`
- `AgentRuntimeAdapterRegistry`
- `validateAgentRuntimeSessionContract`

Related ownership boundaries:

- `SPC-RUN-004`: Pi implementation.
- `SPC-RUN-005`: Codex Native implementation.
- `SPC-RUN-006`: ORP implementation.
- `SPC-RUN-003`: resource and tool-generation services.

# Failure and security behavior

- Unavailable diagnostics and missing required methods fail inspection/open explicitly.
- Generic auth results are sanitized before leaving the registry boundary.

# Known limits

- No open source-trace gap is recorded for this contract.
- Non-current claim excluded: RuntimeSession or RuntimeCapability are the exact exported contract names.
- Non-current claim excluded: Generic orchestration may inspect concrete adapter internals.
- Non-current claim excluded: A capability declaration alone proves delivery.

# Verification and traceability

Source symbols and named tests are bound to commit `bfb31e40143ea149cf77917d787adaf477539f51`. Cold fork inspection has [Docker and Pibo2 evidence](/reports/idle-session-history-latency-validation-2026-09-05.md); earlier lifecycle evidence retains its original execution scope. Runtime admission validates the complete live-session contract before use; a partial session is rejected, cleanup still runs, and cleanup errors cannot mask the contract failure. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/agent-runtime-boundaries.test.mjs test/agent-runtime-registry.test.mjs test/agent-runtime-adapter-skill.test.mjs`

# Related concepts

- `SPC-RUN-004` owns Pi implementation.
- `SPC-RUN-005` owns Codex Native implementation.
- `SPC-RUN-006` owns ORP implementation.
- `SPC-RUN-003` owns resource and tool-generation services.
