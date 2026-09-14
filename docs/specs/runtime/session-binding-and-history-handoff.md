---
type: "Specification"
title: "Runtime Session Binding and Portable History Handoff"
description: "Defines native-first binding recovery and revisioned, retry-safe portable-history handoff for same- or cross-runtime reconstruction."
tags: ["runtime", "binding", "rebind", "portable-history"]
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
    - id: "RUN-BIND-001"
      status: "implemented"
      sources:
        - path: "src/sessions/runtime-binding.ts"
          symbol: "AgentRuntimeBindingState"
        - path: "src/sessions/runtime-binding.ts"
          symbol: "assertRuntimeSessionBindingTransition"
      tests:
        - path: "test/runtime-session-binding.test.mjs"
          name: "session creation freezes an unbound runtime selection and keeps Pi compatibility additive"
      failures:
        - "Target startup failure preserves the same persisted checkpoint for retry; conflicting revisions fail explicitly."
        - "Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted."
      confidence: "high"
    - id: "RUN-BIND-002"
      status: "implemented"
      sources:
        - path: "src/sessions/runtime-binding-persistence.ts"
          symbol: "createAgentRuntimeBindingPersistence"
      tests:
        - path: "test/runtime-session-binding.test.mjs"
          name: "legacy sqlite migration backfills bound Pi rows and makes the compatibility Pi column nullable"
      failures:
        - "Target startup failure preserves the same persisted checkpoint for retry; conflicting revisions fail explicitly."
        - "Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted."
      confidence: "medium"
    - id: "RUN-BIND-003"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/portable-history.ts"
          symbol: "PiboDataPortableHistoryProvider"
        - path: "src/agent-runtime/portable-history.ts"
          symbol: "withPortableHistoryHandoffMetadata"
      tests:
        - path: "test/runtime-portability.test.mjs"
          name: "portable history is bounded, checkpointed, role-aware, and secret-redacted"
        - path: "test/runtime-portability.test.mjs"
          name: "portable history enforces its aggregate serialized handoff bound"
        - path: "test/runtime-portability.test.mjs"
          name: "portable history scopes provider-local tool ids by turn across SQLite restart"
      failures:
        - "Target startup failure preserves the same persisted checkpoint for retry; conflicting revisions fail explicitly."
        - "Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted."
      confidence: "high"
    - id: "RUN-BIND-004"
      status: "implemented"
      sources:
        - path: "src/core/session-router.ts"
          symbol: "PiboSessionRouter"
        - path: "src/agent-runtime/portable-history.ts"
          symbol: "withPortableHistoryHandoffMetadata"
      tests:
        - path: "test/runtime-portability.test.mjs"
          name: "runtime rebind quiesces the source before taking its portable-history checkpoint"
        - path: "test/runtime-portability.test.mjs"
          name: "runtime rebind retries the same persisted handoff checkpoint after target startup failure"
        - path: "test/runtime-portability.test.mjs"
          name: "cross-runtime rebind clears source model selection across restart while same-runtime rebind preserves it"
      failures:
        - "Target startup failure preserves the same persisted checkpoint for retry; conflicting revisions fail explicitly."
        - "Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted."
      confidence: "high"
    - id: "RUN-BIND-005"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/types.ts"
          symbol: "AgentRuntimeAdapter.resolveBinding"
        - path: "src/core/session-router.ts"
          symbol: "PiboSessionRouter.prepareNativeSessionRecovery"
        - path: "src/agent-runtime/portable-history.ts"
          symbol: "PersistedPortableHistoryHandoff"
      tests:
        - path: "test/runtime-portability.test.mjs"
          name: "authoritative native absence reconstructs once in the same runtime from checkpointed Pibo history"
        - path: "test/runtime-portability.test.mjs"
          name: "native reconstruction retries the same durable checkpoint after target startup failure"
        - path: "test/runtime-portability.test.mjs"
          name: "auth and transient native inspection failures never trigger reconstruction"
        - path: "test/runtime-portability.test.mjs"
          name: "native recovery fails closed for insufficient history, unsupported adapters, and concurrent binding changes"
      failures:
        - "Only an adapter-owned authoritative missing result admits reconstruction; every other inspection failure preserves the original binding and stops."
        - "Insufficient durable conversation context and unsupported history import refuse an empty replacement."
      confidence: "high"
---

# Scope

Own binding states and transitions, audited persistence capability minting, portable-history normalization/bounds/checkpoints, and rebind handoff sequencing.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: Normal continuation first asks the selected adapter to recheck bound or missing native identity. A repaired original opens unchanged. Only authoritative absence may create a same-runtime portable-history handoff; explicit cross-runtime rebind and `startFresh` remain separate operations.
- State: Binding states are unbound, bound, missing, or error; writes are revision-checked and distinguish normal, repair, and rebind transitions. Native-recovery handoffs retain source native identity, state, revision, locator, diagnostic code, and checkpoint provenance.
- Failure: Auth, permission, corruption, ambiguity, runtime/provider unavailability, transient inspection failure, unsupported recovery, insufficient Pibo history, and CAS conflict never trigger reconstruction or runtime switching. Target startup failure preserves the same persisted checkpoint for retry.
- Security: Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted and scopes provider-local reused tool IDs by turn, including after SQLite restart and truncation.
- Compatibility: Legacy Pi rows migrate to a bound Pi runtime while the compatibility Pi column becomes nullable.

# Requirements and invariants

## Requirement: RUN-BIND-001

A session binding SHALL use the implemented unbound, bound, missing, or error state and revision-checked transition rules.

## Requirement: RUN-BIND-002

Binding persistence SHALL accept only the exact audited built-in persistence capability and SHALL enforce compare-and-swap revisions.

## Requirement: RUN-BIND-003

Portable history SHALL be role-aware, secret-redacted, checkpointed, and bounded to 4000 source rows, 1000 entries, 1 MiB aggregate serialized data, and 256 KiB per entry.

## Requirement: RUN-BIND-004

Runtime rebind SHALL quiesce the source and import the persisted portable-history checkpoint before the target session receives its first prompt, preserving that checkpoint across retryable startup failure.

## Requirement: RUN-BIND-005

Normal continuation SHALL prefer the existing adapter-native session. The adapter SHALL return `missing` only after authoritative absence; every non-absence failure SHALL throw. A confirmed missing native session MAY reconstruct only into the same runtime when durable Pibo conversation context and history import are available. Reconstruction SHALL persist one CAS-protected checkpoint and source-binding provenance, import before any prompt, preserve Session/Room/profile/model/workspace-tab ownership, never replay tools or synthesize turns, and remain retry-safe. Unsupported adapters and insufficient history SHALL fail explicitly without an empty replacement.

# Interfaces and ownership

Implemented public contracts:

- `RuntimeSessionBinding`
- `AgentRuntimeBindingState`
- `createInitialRuntimeSessionBinding`
- `nextRuntimeSessionBinding`
- `createAgentRuntimeBindingPersistence`
- `AgentRuntimePortableHistoryProvider`
- `PiboDataPortableHistoryProvider`
- `AgentRuntimeAdapter.resolveBinding`
- `PersistedPortableHistoryHandoff`

Related ownership boundaries:

- `SPC-DATA-001`: session-store schema, migration, and product transcript authority.
- `SPC-RUN-007`: adapter-native history inspection and reconciliation proof.
- `SPC-GW-003`: gateway startup recovery.

# Failure and security behavior

- Target startup failure preserves the same persisted checkpoint for retry; conflicting revisions fail explicitly.
- Native reconstruction is same-runtime only, begins only after authoritative adapter-owned absence, and refuses insufficient history or unsupported import.
- Auth, permissions, corruption, ambiguity, provider/runtime unavailability, and transient failures preserve the original binding and never select another runtime.
- Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted.

# Known limits

- Evidence gap: The listed runtime-restart-recovery tests cover gateway recovery telemetry, not the binding/rebind contract directly; treat them as adjacent integration evidence only.
- Non-current claim excluded: Portable history is an unbounded lossless native transcript clone.
- Non-current claim excluded: Any structurally compatible persistence object may mutate bindings.
- Non-current claim excluded: runtime-restart-recovery tests directly prove binding handoff behavior.

# Verification and traceability

Source symbols and named tests are bound to commit `bcb36ccd17ec45a11f4a568441037b94b1f6e0cd`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/runtime-session-binding.test.mjs test/runtime-portability.test.mjs test/runtime-restart-recovery.test.mjs`

# Related concepts

- `SPC-DATA-001` owns session-store schema, migration, and product transcript authority.
- `SPC-RUN-007` owns adapter-native history inspection and reconciliation proof.
- `SPC-GW-003` owns gateway startup recovery.
