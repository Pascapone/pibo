---
type: "Specification"
title: "Live Pibo Session Signals"
description: "Defines the implemented live pibo session signals contract and its current ownership boundaries."
tags: ["data", "signals"]
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
    - id: "WP02-DATA-SIG-001"
      status: "implemented"
      sources:
        - path: "src/signals/types.ts"
          symbol: "PiboSignalInput"
        - path: "src/signals/types.ts"
          symbol: "PiboSignalNode"
        - path: "src/signals/types.ts"
          symbol: "PiboSignalPatch"
        - path: "src/signals/projector.ts"
          symbol: "sessionLifecycleSignalProducer"
        - path: "src/signals/projector.ts"
          symbol: "outputSignalProducer"
        - path: "src/signals/projector.ts"
          symbol: "runSignalProducer"
        - path: "src/signals/projector.ts"
          symbol: "createDefaultSignalProducers"
        - path: "src/signals/registry.ts"
          symbol: "InMemoryPiboSignalRegistry"
        - path: "src/signals/registry.ts"
          symbol: "project"
      tests:
        - path: "test/signal-registry.test.mjs"
          name: "patch versions are monotonic per root"
        - path: "test/signal-registry.test.mjs"
          name: "accepted messages start the first local turn before runtime initialization finishes"
        - path: "test/signal-registry.test.mjs"
          name: "turn signal remains active between model, tool, and reasoning phases until a terminal event"
      failures:
        - "All Chat signal routes call requireSession; session/tree routes also require a shared session."
        - "Missing registry capability returns 503; missing root query returns 400."
        - "Snapshots expose compact status/telemetry hints without payload bodies."
      confidence: "high"
    - id: "WP02-DATA-SIG-002"
      status: "implemented"
      sources:
        - path: "src/signals/aggregate.ts"
          symbol: "isActiveSignalStatus"
        - path: "src/signals/aggregate.ts"
          symbol: "strongestStatus"
        - path: "src/signals/aggregate.ts"
          symbol: "phaseForStatus"
        - path: "src/signals/status.ts"
          symbol: "resolveSessionSignalStatus"
        - path: "src/signals/status.ts"
          symbol: "summarizeSessionSignalStatus"
      tests:
        - path: "test/signal-registry.test.mjs"
          name: "parent status stays running during work and settles idle despite a child error"
        - path: "test/signal-registry.test.mjs"
          name: "signal registry aggregates a three-level active descendant"
        - path: "test/signal-registry.test.mjs"
          name: "failed yielded run does not mark session as runtime error"
        - path: "test/signal-registry.test.mjs"
          name: "tool call errors do not mark the session signal as failed"
      failures:
        - "All Chat signal routes call requireSession; session/tree routes also require a shared session."
        - "Missing registry capability returns 503; missing root query returns 400."
        - "Snapshots expose compact status/telemetry hints without payload bodies."
      confidence: "high"
    - id: "WP02-DATA-SIG-003"
      status: "implemented"
      sources:
        - path: "src/signals/projector.ts"
          symbol: "sessionLifecycleSignalProducer"
        - path: "src/signals/projector.ts"
          symbol: "outputSignalProducer"
        - path: "src/signals/registry.ts"
          symbol: "InMemoryPiboSignalRegistry"
        - path: "src/signals/registry.ts"
          symbol: "project"
      tests:
        - path: "test/signal-registry.test.mjs"
          name: "a stale session error cannot terminalize a newly accepted turn"
        - path: "test/signal-registry.test.mjs"
          name: "rejected accepted messages clear synthetic activity when the runtime is idle"
        - path: "test/signal-registry.test.mjs"
          name: "rejected steering removes only its accepted message while another turn remains active"
        - path: "test/signal-registry.test.mjs"
          name: "snapshot updatedAt only advances on semantic change"
      failures:
        - "All Chat signal routes call requireSession; session/tree routes also require a shared session."
        - "Missing registry capability returns 503; missing root query returns 400."
        - "Snapshots expose compact status/telemetry hints without payload bodies."
      confidence: "high"
    - id: "WP02-DATA-SIG-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/chat-api-routes.ts"
          symbol: "signalResource"
        - path: "src/apps/chat/web-app.ts"
          symbol: "createChatWebApp"
        - path: "src/apps/chat/web-app.ts"
          symbol: "compactSignalStatusPatch"
      tests:
        - path: "test/chat-signals-api.test.mjs"
          name: "chat global signal status routes require authentication"
        - path: "test/chat-signals-api.test.mjs"
          name: "chat global signal SSE sends all-session snapshot then cross-root patches"
        - path: "test/chat-signals-api.test.mjs"
          name: "chat signal SSE sends snapshot then monotonic patches"
        - path: "test/chat-signals-api.test.mjs"
          name: "chat signal SSE rejects missing root session id"
        - path: "test/chat-signals-api.test.mjs"
          name: "chat signal routes return 503 when registry functions are unavailable"
      failures:
        - "All Chat signal routes call requireSession; session/tree routes also require a shared session."
        - "Missing registry capability returns 503; missing root query returns 400."
        - "Snapshots expose compact status/telemetry hints without payload bodies."
      confidence: "high"
    - id: "WP02-DATA-SIG-005"
      status: "implemented"
      sources:
        - path: "src/signals/registry.ts"
          symbol: "InMemoryPiboSignalRegistry"
        - path: "src/signals/registry.ts"
          symbol: "pruneTerminalNodes"
        - path: "src/signals/store.ts"
          symbol: "PiboSignalStore"
      tests:
        - path: "test/signal-registry.test.mjs"
          name: "prune terminal node sends remove patch"
      failures:
        - "All Chat signal routes call requireSession; session/tree routes also require a shared session."
        - "Missing registry capability returns 503; missing root query returns 400."
        - "Snapshots expose compact status/telemetry hints without payload bodies."
      confidence: "medium"
---

# Scope

Signal node/status/snapshot/patch models, in-memory projection and aggregation, versioning/pruning semantics, and authenticated Chat signal data endpoints.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: PiboSignalKind; PiboSignalStatus; PiboSignalNode; PiboSignalSnapshot; PiboSignalPatch; PiboSignalStatusSnapshot; PiboSignalStore=never; per-root in-memory versions.
- Routes and protocols: GET /api/chat/signals/statuses; GET /api/chat/signals/status-events (SSE snapshot then cross-root patches); GET /api/chat/signals/session/:piboSessionId; GET /api/chat/signals/tree/:piboSessionId; GET /api/chat/signals/events?rootPiboSessionId=... (SSE snapshot then patches); 25-second SSE heartbeat comments
- State transitions: Session lifecycle, accepted/rejected message, normalized output, queue, run, and recovery inputs project semantic node mutations. No semantic change emits no patch and does not advance updatedAt/version. Rejected accepted messages remove synthetic activity without disturbing unrelated active turns. Terminal node pruning emits remove patches after success/error TTLs.
- Failure and security: All Chat signal routes call requireSession; session/tree routes also require a shared session. Missing registry capability returns 503; missing root query returns 400. Snapshots expose compact status/telemetry hints without payload bodies.
- Compatibility: Version gaps require consumers to refresh a full snapshot. Tool and yielded-run errors remain child/local error facts and do not automatically promote the session to runtime error. Signals are reconstructable and non-durable.

# Requirements and invariants

## Requirement: WP02-DATA-SIG-001

The registry SHALL project lifecycle, output, run, queue, and recovery inputs into typed in-memory signal nodes and per-root versioned patches.

## Requirement: WP02-DATA-SIG-002

Tree aggregation SHALL propagate active descendants but SHALL not promote unrelated child tool/run failures to a session runtime error.

## Requirement: WP02-DATA-SIG-003

Rejected or stale inputs SHALL reconcile synthetic activity without terminalizing an unrelated active turn; semantic no-ops SHALL not advance state.

## Requirement: WP02-DATA-SIG-004

Authenticated signal endpoints SHALL return status/session/tree snapshots or snapshot-first SSE patches with monotonic IDs, bounded errors, and registry-unavailable failures.

## Requirement: WP02-DATA-SIG-005

Signal pruning SHALL remove terminal in-memory nodes by TTL and emit remove patches without deleting durable history.

# Interfaces and ownership

Capability IDs: `pibo.data.signals`.

Implemented public contracts:

- `PiboSignalInput`
- `PiboSignalNode`
- `PiboSignalPatch`
- `sessionLifecycleSignalProducer`
- `outputSignalProducer`
- `runSignalProducer`
- `createDefaultSignalProducers`
- `InMemoryPiboSignalRegistry.project`
- `isActiveSignalStatus`
- `strongestStatus`
- `phaseForStatus`
- `resolveSessionSignalStatus`
- `summarizeSessionSignalStatus`
- `signalResource`
- `createChatWebApp`
- `compactSignalStatusPatch`
- `InMemoryPiboSignalRegistry.pruneTerminalNodes`
- `PiboSignalStore`

Related ownership boundaries:

- SPC-GW-001 owns the routed events projected into signals.
- SPC-WEB-004 owns browser cache/optimistic overlay/reconnect behavior and presentation.
- SPC-OP-002 owns debug signal formatting.
- SPC-DATA-001 remains durable history/unread authority; signal pruning never deletes it.

# Failure and security behavior

- All Chat signal routes call requireSession; session/tree routes also require a shared session.
- Missing registry capability returns 503; missing root query returns 400.
- Snapshots expose compact status/telemetry hints without payload bodies.

# Known limits

- Non-current claim excluded: describe a durable signal store; PiboSignalStore is never.
- Non-current claim excluded: assign browser optimistic overlays, cache replacement, reconnect policy, or sidebar rendering to this data spec.
- Non-current claim excluded: claim every tool/run error makes the parent session error.
- Current limit or evidence gap: Headful Web snapshot/patch gap recovery and optimistic cache behavior remains unperformed.
- Current limit or evidence gap: No durable restart restoration exists by design; drafts must say reconstructable, not persisted.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality; it does not claim that an external, browser, real-provider, or Pibo2 check ran.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/signal-registry.test.mjs test/chat-signals-api.test.mjs`

# Related concepts

- SPC-GW-001 owns the routed events projected into signals.
- SPC-WEB-004 owns browser cache/optimistic overlay/reconnect behavior and presentation.
- SPC-OP-002 owns debug signal formatting.
- SPC-DATA-001 remains durable history/unread authority; signal pruning never deletes it.
