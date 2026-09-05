---
type: "Specification"
title: "Routing, Events, Steering, and Session Actions"
description: "Defines the implemented routing, events, steering, and session actions contract and its current ownership boundaries."
tags: ["gateway", "router", "actions"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-05T12:20:39Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "9ce53817fec5919c00e130dd794c391c497882a1"
  requirements:
    - id: "WP02-GW-ROUTE-001"
      status: "implemented"
      sources:
        - path: "src/core/events.ts"
          symbol: "PiboMessageEvent"
        - path: "src/core/events.ts"
          symbol: "PiboExecutionEvent"
        - path: "src/core/events.ts"
          symbol: "PiboInputEvent"
        - path: "src/core/events.ts"
          symbol: "PiboOutputEvent"
        - path: "src/core/events.ts"
          symbol: "PiboSessionStatus"
      tests:
        - path: "test/session-actions.test.mjs"
          name: "routed session normalizes assistant thinking events"
        - path: "test/session-actions.test.mjs"
          name: "routed session normalizes tool call events"
        - path: "test/session-actions.test.mjs"
          name: "routed session surfaces assistant provider errors with the active event id"
      failures:
        - "Profile/runtime capability checks and preflight occur before unsupported work executes."
        - "Approval and structured-input responses are correlated by request ID and resolved/cleared/aborted/expired."
        - "Context/runtime failures are not retried as provider fallback."
        - "Bounded reminder guards stop repeated identical tool loops."
      confidence: "high"
    - id: "WP02-GW-ROUTE-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "RuntimeRoutedSession"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "enqueueMessage"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "steerMessage"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "executeAction"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "compact"
        - path: "src/core/session-router.ts"
          symbol: "PiboSessionRouter"
        - path: "src/core/session-router.ts"
          symbol: "emit"
      tests:
        - path: "test/routed-steering.test.mjs"
          name: "routed sessions support steering and queued follow-up turns at the same time"
        - path: "test/routed-steering.test.mjs"
          name: "steering rejects idle sessions instead of silently queueing"
        - path: "test/session-actions.test.mjs"
          name: "compact action is serialized between queued messages"
        - path: "test/session-actions.test.mjs"
          name: "non-compact actions still execute immediately while a message is active"
        - path: "test/session-switch-active.test.mjs"
          name: "session.switch cannot split active and queued turns across native bindings"
      failures:
        - "Profile/runtime capability checks and preflight occur before unsupported work executes."
        - "Approval and structured-input responses are correlated by request ID and resolved/cleared/aborted/expired."
        - "Context/runtime failures are not retried as provider fallback."
        - "Bounded reminder guards stop repeated identical tool loops."
      confidence: "high"
    - id: "WP02-GW-ROUTE-003"
      status: "implemented"
      sources:
        - path: "src/plugins/builtin.ts"
          symbol: "piboCorePlugin"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "RuntimeRoutedSession"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "executeAction"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "getForkCandidates"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "forkSession"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "cloneSession"
        - path: "src/agent-runtime/capabilities.ts"
          symbol: "AgentRuntimeCapabilities"
        - path: "src/core/session-router.ts"
          symbol: "handleSessionOperation"
      tests:
        - path: "test/runtime-routed-session.test.mjs"
          name: "generic routed controls reject unadvertised adapter capabilities explicitly"
        - path: "test/runtime-routed-session.test.mjs"
          name: "fork identity reads and transitions reject queued or active routed work"
        - path: "test/runtime-routed-session.test.mjs"
          name: "running-safe fork controls snapshot completed history without interrupting the source turn"
        - path: "test/session-router-store.test.mjs"
          name: "snapshot fork persistence keeps the active source runtime attached"
      failures:
        - "Profile/runtime capability checks and preflight occur before unsupported work executes."
        - "Approval and structured-input responses are correlated by request ID and resolved/cleared/aborted/expired."
        - "Context/runtime failures are not retried as provider fallback."
        - "Bounded reminder guards stop repeated identical tool loops."
      confidence: "high"
    - id: "WP02-GW-ROUTE-004"
      status: "implemented"
      sources:
        - path: "src/core/events.ts"
          symbol: "PiboApprovalRequest"
        - path: "src/core/events.ts"
          symbol: "PiboUserInputRequest"
        - path: "src/core/events.ts"
          symbol: "PiboRuntimeRequestResolution"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "RuntimeRoutedSession"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "respondToApproval"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "respondToUserInput"
      tests:
        - path: "test/web-channel.test.mjs"
          name: "chat web forwards runtime approval and structured-input response actions generically"
      failures:
        - "Profile/runtime capability checks and preflight occur before unsupported work executes."
        - "Approval and structured-input responses are correlated by request ID and resolved/cleared/aborted/expired."
        - "Context/runtime failures are not retried as provider fallback."
        - "Bounded reminder guards stop repeated identical tool loops."
      confidence: "medium"
    - id: "WP02-GW-ROUTE-005"
      status: "implemented"
      sources:
        - path: "src/core/provider-recovery.ts"
          symbol: "isPiboProviderFallbackError"
        - path: "src/core/provider-recovery.ts"
          symbol: "isRetryablePiboProviderError"
        - path: "src/core/provider-recovery.ts"
          symbol: "resolvePiboProviderRecoverySettings"
        - path: "src/core/session-router.ts"
          symbol: "PiboSessionRouter"
        - path: "src/core/session-router.ts"
          symbol: "killSession"
        - path: "src/core/session-router.ts"
          symbol: "disposeSession"
        - path: "src/core/session-router.ts"
          symbol: "disposeAll"
      tests:
        - path: "test/runtime-routed-session.test.mjs"
          name: "generic routed orchestration tries ordered provider fallbacks and restores the primary model"
        - path: "test/runtime-routed-session.test.mjs"
          name: "provider fallback does not retry context or runtime failures"
        - path: "test/session-router-store.test.mjs"
          name: "kill action disposes cached runtimes without cancelling yielded runs"
        - path: "test/session-router-store.test.mjs"
          name: "kill_all action disposes the runtime and cancels its yielded runs"
        - path: "test/session-router-store.test.mjs"
          name: "kill_all cancels child sessions and yielded runs recursively"
        - path: "test/session-router-store.test.mjs"
          name: "restart signal reconstruction roots nested sessions independently of store order"
      failures:
        - "Profile/runtime capability checks and preflight occur before unsupported work executes."
        - "Approval and structured-input responses are correlated by request ID and resolved/cleared/aborted/expired."
        - "Context/runtime failures are not retried as provider fallback."
        - "Bounded reminder guards stop repeated identical tool loops."
      confidence: "high"
---

# Scope

Normalized input/output event unions, message admission/queue/steer behavior, routed-session drain/action semantics, runtime request correlation, provider fallback, and registered gateway action contracts.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: PiboMessageEvent with queue/steer delivery; PiboExecutionEvent including custom string actions; PiboOutputEvent normalized lifecycle union; PiboSessionStatus; in-memory routed session cache backed by session/binding/history stores.
- Routes and protocols: No transport framing or HTTP route is owned.
- Registered actions: `status`, `compact`, `runtime.approval.respond`, `runtime.user_input.respond`, `session_id`, `clear_queue`, `abort`, `kill`, `kill_all`, `dispose`, `thinking`, `fast_mode`, `session.current`, `session.list`, `session.fork_candidates`, `session.fork`, `session.clone`, `session.tree`, `session.tree_navigate`, `session.switch`, `login`, `model`, `login.start`, `login.complete`, `login.apikey`, `login.cancel`, `login.status`, `logout`.
- State transitions: Accepted queued messages enter one serialized drain; steer is distinct and rejects idle sessions. compact serializes with queued messages; non-compact actions may execute while a turn is active. `session.switch` refuses active or queued routed work so one logical turn cannot split across native bindings. A runtime that declares `lifecycle.forkWhileRunning` may list completed fork candidates and create a detached snapshot fork during an active turn; the active candidate is excluded, the source binding stays attached, and runtimes without the capability retain the idle requirement. Provider fallbacks are tried in order only for eligible provider failures and the primary model is restored. Restart reconstruction resolves each nested Session root independently of store iteration order. abort targets active turn; kill recursively disposes child sessions but not yielded runs; kill_all also cancels yielded runs. Teardown rejects new work and awaits disposal.
- Failure and security: Profile/runtime capability checks and preflight occur before unsupported work executes. Approval and structured-input responses are correlated by request ID and resolved/cleared/aborted/expired. Context/runtime failures are not retried as provider fallback. Bounded reminder guards stop repeated identical tool loops.
- Compatibility: Runtime action registration, not the narrower BuiltinPiboExecutionAction type alias, is exhaustive authority. Model defaults apply to new sessions and do not mutate frozen existing bindings.

# Requirements and invariants

## Requirement: WP02-GW-ROUTE-001

The specification SHALL enumerate the current PiboInputEvent/PiboOutputEvent unions, correlation fields, provenance, delivery modes, and terminal/error variants from source.

## Requirement: WP02-GW-ROUTE-002

Each routed session SHALL maintain one serialized message drain, keep queue and steer distinct, serialize compact, and permit immediate non-compact actions where implemented.

## Requirement: WP02-GW-ROUTE-003

The runtime action registry SHALL be the exhaustive current action list. Adapter capabilities and idle-state constraints SHALL gate action execution, except that `lifecycle.forkWhileRunning` SHALL permit completed-history candidate reads and detached snapshot forks without replacing, aborting, or rebinding the active source runtime.

## Requirement: WP02-GW-ROUTE-004

Approval and structured-input requests and responses SHALL correlate by request ID and preserve single target-session/runtime intent.

## Requirement: WP02-GW-ROUTE-005

Failure, fallback, cancellation, and disposal SHALL settle normalized event state without retrying non-provider failures; kill and kill_all SHALL retain their distinct run-cancellation scopes.

# Interfaces and ownership

Capability IDs: `pibo.gateway.router`, `pibo.gateway.actions`.

Implemented public contracts:

- `PiboMessageEvent`
- `PiboExecutionEvent`
- `PiboInputEvent`
- `PiboOutputEvent`
- `PiboSessionStatus`
- `RuntimeRoutedSession.enqueueMessage`
- `RuntimeRoutedSession.steerMessage`
- `RuntimeRoutedSession.executeAction`
- `RuntimeRoutedSession.compact`
- `PiboSessionRouter.emit`
- `piboCorePlugin`
- `RuntimeRoutedSession.getForkCandidates`
- `RuntimeRoutedSession.forkSession`
- `RuntimeRoutedSession.cloneSession`
- `PiboApprovalRequest`
- `PiboUserInputRequest`
- `PiboRuntimeRequestResolution`
- `RuntimeRoutedSession.respondToApproval`
- `RuntimeRoutedSession.respondToUserInput`
- `isPiboProviderFallbackError`
- `isRetryablePiboProviderError`
- `resolvePiboProviderRecoverySettings`
- `PiboSessionRouter.killSession`
- `PiboSessionRouter.disposeSession`
- `PiboSessionRouter.disposeAll`

Related ownership boundaries:

- SPC-DATA-002 owns persisted sessions/bindings.
- SPC-DATA-004 owns durable yielded-run state; this spec owns kill versus kill_all routing semantics.
- Runtime adapter/native transcript behavior belongs to runtime specs.
- SPC-WEB-004 and SPC-OP-003 own slash-command UX and rendering, not action semantics.

# Failure and security behavior

- Profile/runtime capability checks and preflight occur before unsupported work executes.
- Approval and structured-input responses are correlated by request ID and resolved/cleared/aborted/expired.
- Context/runtime failures are not retried as provider fallback.
- Bounded reminder guards stop repeated identical tool loops.

# Known limits

- Non-current claim excluded: use BuiltinPiboExecutionAction as the exhaustive runtime action registry.
- Non-current claim excluded: say kill cancels yielded runs; only kill_all includes them.
- Non-current claim excluded: assign slash-command parsing/rendering or native history to this spec.
- Non-current claim excluded: cite src/core/routed-session.ts as primary generic routing authority; it is a deprecated Pi compatibility re-export.
- Current limit or evidence gap: Approval/user-input single-use behavior lacks a focused requirement-named test in the canonical GW-001 test set; the closest integration test is Web action forwarding.

# Verification and traceability

Source symbols and named tests are bound to commit `9ce53817fec5919c00e130dd794c391c497882a1`. Requirement confidence measures trace quality; it does not claim that an external, browser, real-provider, or Pibo2 check ran.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/session-actions.test.mjs test/routed-steering.test.mjs test/runtime-routed-session.test.mjs test/web-channel.test.mjs test/session-router-store.test.mjs`

# Related concepts

- SPC-DATA-002 owns persisted sessions/bindings.
- SPC-DATA-004 owns durable yielded-run state; this spec owns kill versus kill_all routing semantics.
- Runtime adapter/native transcript behavior belongs to runtime specs.
- SPC-WEB-004 and SPC-OP-003 own slash-command UX and rendering, not action semantics.
