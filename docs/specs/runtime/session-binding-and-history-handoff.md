---
type: "Specification"
title: "Runtime Session Binding and Portable History Handoff"
description: "Defines revisioned runtime binding transitions and bounded, retry-safe portable-history handoff during runtime rebind."
tags: ["runtime", "binding", "rebind", "portable-history"]
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
      tests:
        - path: "test/runtime-portability.test.mjs"
          name: "portable history is bounded, checkpointed, role-aware, and secret-redacted"
        - path: "test/runtime-portability.test.mjs"
          name: "portable history enforces its aggregate serialized handoff bound"
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
      failures:
        - "Target startup failure preserves the same persisted checkpoint for retry; conflicting revisions fail explicitly."
        - "Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted."
      confidence: "high"
---

# Scope

Own binding states and transitions, audited persistence capability minting, portable-history normalization/bounds/checkpoints, and rebind handoff sequencing.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: A rebind quiesces the source, persists one checkpointed handoff, opens the target, imports before first prompt, then clears or records the handoff retry-safely.
- State: Binding states are unbound, bound, missing, or error; writes are revision-checked and distinguish normal, repair, and rebind transitions.
- Failure: Target startup failure preserves the same persisted checkpoint for retry; conflicting revisions fail explicitly.
- Security: Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted.
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

# Interfaces and ownership

Implemented public contracts:

- `RuntimeSessionBinding`
- `AgentRuntimeBindingState`
- `createInitialRuntimeSessionBinding`
- `nextRuntimeSessionBinding`
- `createAgentRuntimeBindingPersistence`
- `AgentRuntimePortableHistoryProvider`
- `PiboDataPortableHistoryProvider`

Related ownership boundaries:

- `SPC-DATA-001`: session-store schema, migration, and product transcript authority.
- `SPC-RUN-007`: adapter-native history inspection and reconciliation proof.
- `SPC-GW-003`: gateway startup recovery.

# Failure and security behavior

- Target startup failure preserves the same persisted checkpoint for retry; conflicting revisions fail explicitly.
- Only exact built-in store capabilities minted by createAgentRuntimeBindingPersistence are accepted; structural lookalikes are rejected; portable history is secret-redacted.

# Known limits

- Evidence gap: The listed runtime-restart-recovery tests cover gateway recovery telemetry, not the binding/rebind contract directly; treat them as adjacent integration evidence only.
- Non-current claim excluded: Portable history is an unbounded lossless native transcript clone.
- Non-current claim excluded: Any structurally compatible persistence object may mutate bindings.
- Non-current claim excluded: runtime-restart-recovery tests directly prove binding handoff behavior.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/runtime-session-binding.test.mjs test/runtime-portability.test.mjs test/runtime-restart-recovery.test.mjs`

# Related concepts

- `SPC-DATA-001` owns session-store schema, migration, and product transcript authority.
- `SPC-RUN-007` owns adapter-native history inspection and reconciliation proof.
- `SPC-GW-003` owns gateway startup recovery.
