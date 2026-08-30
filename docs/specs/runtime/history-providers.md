---
type: "Specification"
title: "Adapter-Native History Providers and Reconciliation"
description: "Defines normalized adapter-native history inspection, pagination, source labeling, bounds, and trusted complete reconciliation proof."
tags: ["runtime", "history", "pagination", "reconciliation"]
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
    - id: "RUN-HIST-001"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/types.ts"
          symbol: "AgentRuntimeAdapter"
        - path: "src/agent-runtime/history.ts"
          symbol: "AgentRuntimeHistoryPage"
      tests:
        - path: "test/agent-runtime-registry.test.mjs"
          name: "runtime registry requires declared native history providers to implement inspection and reads"
      failures:
        - "Missing, partial, oversized, contradictory, ambiguous, or self-minted proof fails closed without collapsing distinct entries."
        - "Adapter history normalizers redact sensitive values and enforce byte/entry/page bounds."
      confidence: "high"
    - id: "RUN-HIST-002"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/pi/history.ts"
          symbol: "readPiAgentRuntimeHistory"
        - path: "src/agent-runtimes/codex-native/history.ts"
          symbol: "pageCodexThreadHistory"
        - path: "src/agent-runtimes/omp/history.ts"
          symbol: "readOmpHistory"
      tests:
        - path: "test/agent-runtime-history.test.mjs"
          name: "Pi history provider resolves, paginates, and normalizes native JSONL behind the adapter"
        - path: "test/agent-runtime-history.test.mjs"
          name: "OMP tool-only history remains visible with a stable structural correlation"
      failures:
        - "Missing, partial, oversized, contradictory, ambiguous, or self-minted proof fails closed without collapsing distinct entries."
        - "Adapter history normalizers redact sensitive values and enforce byte/entry/page bounds."
      confidence: "high"
    - id: "RUN-HIST-003"
      status: "implemented"
      sources:
        - path: "src/agent-runtime/history.ts"
          symbol: "createCompleteHistoryReconciliationProof"
        - path: "src/agent-runtimes/history-proof.ts"
          symbol: "isBuiltInHistoryReconciliationProof"
      tests:
        - path: "test/agent-runtime-history.test.mjs"
          name: "generic, direct, and runtime-injected history paths cannot mint complete proof authority"
        - path: "test/chat-trace-materialization.test.mjs"
          name: "complete proof is bound to exact normalized page content and provenance"
      failures:
        - "Missing, partial, oversized, contradictory, ambiguous, or self-minted proof fails closed without collapsing distinct entries."
        - "Adapter history normalizers redact sensitive values and enforce byte/entry/page bounds."
      confidence: "high"
    - id: "RUN-HIST-004"
      status: "implemented"
      sources:
        - path: "src/agent-runtimes/pi/history.ts"
          symbol: "PI_HISTORY_PAGE_MAX_BYTES"
        - path: "src/agent-runtimes/codex-native/history.ts"
          symbol: "pageCodexThreadHistory"
        - path: "src/agent-runtimes/omp/history.ts"
          symbol: "readOmpHistory"
      tests:
        - path: "test/agent-runtime-history.test.mjs"
          name: "Pi complete reconciliation proof accepts 500 entries and fails closed at 501"
        - path: "test/agent-runtime-history.test.mjs"
          name: "OMP explicitly rejects histories whose declared total exceeds the shared proof bound"
      failures:
        - "Missing, partial, oversized, contradictory, ambiguous, or self-minted proof fails closed without collapsing distinct entries."
        - "Adapter history normalizers redact sensitive values and enforce byte/entry/page bounds."
      confidence: "high"
---

# Scope

Own AgentRuntimeHistory* data contracts, adapter inspectHistory/readHistory implementations, opaque pagination, and built-in complete-proof authority.

This specification describes implemented behavior at the traceability commit. Planned changes and behavior owned by related concepts are outside its normative scope.

# Current behavior

- Lifecycle: Callers inspect availability before reading opaque-cursor pages; adapters return normalized native entries without creating missing transcripts.
- State: History source is product or native; complete proof is bound to exact normalized entries, full scope, provenance, and digest.
- Failure: Missing, partial, oversized, contradictory, ambiguous, or self-minted proof fails closed without collapsing distinct entries.
- Security: Adapter history normalizers redact sensitive values and enforce byte/entry/page bounds.
- Compatibility: Pi paginates bounded JSONL, Codex paginates thread items, and OMP paginates RPC messages; transport-specific cursors remain opaque.

# Requirements and invariants

## Requirement: RUN-HIST-001

Adapters declaring native history SHALL implement inspectHistory and readHistory using AgentRuntimeHistoryInspection and AgentRuntimeHistoryPage.

## Requirement: RUN-HIST-002

Native history pages SHALL normalize entries, use opaque advancing cursors, remain bounded, and preserve structurally distinct repeated or tool-only history.

## Requirement: RUN-HIST-003

Only built-in adapter-bound authority SHALL mint a complete reconciliation proof, and that proof SHALL be bound to exact page content, provenance, full scope, positions, and digest.

## Requirement: RUN-HIST-004

Pi, Codex Native, and ORP SHALL preserve their transport-specific bounds and cursor semantics while returning the common normalized history contract.

# Interfaces and ownership

Implemented public contracts:

- `AgentRuntimeHistoryInspection`
- `AgentRuntimeHistoryPage`
- `AgentRuntimeHistoryEntry`
- `AgentRuntimeHistoryReconciliationProof`
- `createCompleteHistoryReconciliationProof`
- `isBuiltInHistoryReconciliationProof`
- `inspectPiAgentRuntimeHistory`
- `pageCodexThreadHistory`
- `readOmpHistory`

Related ownership boundaries:

- `SPC-DATA-001`: product-history persistence and authority.
- `SPC-RUN-002`: portable product-history handoff between runtimes.
- `SPC-WEB-005`: Chat trace projection and product/native identity rendering.
- `SPC-RUN-004`: Pi transcript integrity and repair.

# Failure and security behavior

- Missing, partial, oversized, contradictory, ambiguous, or self-minted proof fails closed without collapsing distinct entries.
- Adapter history normalizers redact sensitive values and enforce byte/entry/page bounds.

# Known limits

- Evidence gap: The synthesis title and source list conflate product-history authority with adapter-native history; use the corrected title/boundary and cross-link SPC-DATA-001.
- Evidence gap: Chat trace materialization and transcript-integrity tests are adjacent consumers/adapter evidence, not direct proof that this spec owns those domains.
- Non-current claim excluded: AgentRuntimeHistoryProvider is an exported public interface.
- Non-current claim excluded: This runtime spec owns product-history persistence.
- Non-current claim excluded: A caller-created digest alone grants complete proof authority.
- Non-current claim excluded: Trace-rendering tests define adapter history persistence.

# Verification and traceability

Source symbols and named tests are bound to commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Requirement confidence measures trace quality, not whether a command ran.

Package verification commands:

- `npm run build`
- `node --test test/agent-runtime-history.test.mjs test/chat-trace-materialization.test.mjs test/transcript-integrity.test.mjs test/agent-runtime-registry.test.mjs`

# Related concepts

- `SPC-DATA-001` owns product-history persistence and authority.
- `SPC-RUN-002` owns portable product-history handoff between runtimes.
- `SPC-WEB-005` owns Chat trace projection and product/native identity rendering.
- `SPC-RUN-004` owns Pi transcript integrity and repair.
