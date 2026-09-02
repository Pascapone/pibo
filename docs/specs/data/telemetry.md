---
type: "Specification"
title: "Runtime, Provider, and Tool Telemetry"
description: "Defines the implemented runtime, provider, and tool telemetry contract and its current ownership boundaries."
tags: ["data", "telemetry"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "WP02-DATA-TEL-001"
      status: "implemented"
      sources:
        - path: "src/data/schema.ts"
          symbol: "applyPiboDataSchema"
        - path: "src/data/telemetry.ts"
          symbol: "TelemetryStore"
        - path: "src/data/telemetry.ts"
          symbol: "upsertTurn"
        - path: "src/data/telemetry.ts"
          symbol: "upsertPhase"
        - path: "src/data/telemetry.ts"
          symbol: "upsertProviderRequest"
        - path: "src/data/telemetry.ts"
          symbol: "upsertToolCall"
      tests:
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry schema migration is idempotent and additive"
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry store upserts correlated turns and phases"
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry store records provider request counters and provider event metadata"
      failures:
        - "BestEffortTelemetryService swallows store failures through onError so runtime work continues."
        - "Provider detailed events are opt-in; default capture is aggregate/metadata."
        - "Tool argument progress is stored without argument bodies; runtime/provider snapshots allow-list metadata and omit result/partial/output bodies."
        - "getPayloadPreview is unavailable; prune mutates only when apply is explicit."
      confidence: "high"
    - id: "WP02-DATA-TEL-002"
      status: "implemented"
      sources:
        - path: "src/core/runtime-telemetry.ts"
          symbol: "ProviderEventTelemetryMode"
        - path: "src/core/runtime-telemetry.ts"
          symbol: "PiboRuntimeTelemetryRecorder"
        - path: "src/core/provider-telemetry.ts"
          symbol: "PiboProviderTelemetryRecorder"
        - path: "src/data/telemetry-preview.ts"
          symbol: "telemetrySafeJsonObject"
        - path: "src/data/telemetry-preview.ts"
          symbol: "telemetrySafeTopLevelKeys"
        - path: "src/data/telemetry-preview.ts"
          symbol: "createTelemetryBoundedPreview"
        - path: "src/data/telemetry.ts"
          symbol: "TelemetryStore"
        - path: "src/data/telemetry.ts"
          symbol: "getPayloadPreview"
      tests:
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry tool-call rows track argument progress without storing argument bodies"
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry preview reads are disabled by default"
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry volume-control helpers bound payload-like values"
      failures:
        - "BestEffortTelemetryService swallows store failures through onError so runtime work continues."
        - "Provider detailed events are opt-in; default capture is aggregate/metadata."
        - "Tool argument progress is stored without argument bodies; runtime/provider snapshots allow-list metadata and omit result/partial/output bodies."
        - "getPayloadPreview is unavailable; prune mutates only when apply is explicit."
      confidence: "high"
    - id: "WP02-DATA-TEL-003"
      status: "implemented"
      sources:
        - path: "src/data/telemetry.ts"
          symbol: "BestEffortTelemetryService"
        - path: "src/data/telemetry-writer.ts"
          symbol: "AsyncTelemetryWriter"
        - path: "src/data/telemetry-writer.ts"
          symbol: "enqueue"
        - path: "src/data/telemetry-writer.ts"
          symbol: "flush"
        - path: "src/data/telemetry-writer.ts"
          symbol: "dispose"
      tests:
        - path: "test/telemetry-store.test.mjs"
          name: "best-effort telemetry service swallows unavailable-store write failures"
        - path: "test/telemetry-writer.test.mjs"
          name: "async telemetry writer preserves cross-recorder order in one transaction"
        - path: "test/telemetry-writer.test.mjs"
          name: "async telemetry writer bounds its queue without dropping ordered work"
        - path: "test/telemetry-writer.test.mjs"
          name: "async telemetry writer batches concurrent session lifecycle load globally"
      failures:
        - "BestEffortTelemetryService swallows store failures through onError so runtime work continues."
        - "Provider detailed events are opt-in; default capture is aggregate/metadata."
        - "Tool argument progress is stored without argument bodies; runtime/provider snapshots allow-list metadata and omit result/partial/output bodies."
        - "getPayloadPreview is unavailable; prune mutates only when apply is explicit."
      confidence: "high"
    - id: "WP02-DATA-TEL-004"
      status: "implemented"
      sources:
        - path: "src/data/telemetry.ts"
          symbol: "TelemetryStore"
        - path: "src/data/telemetry.ts"
          symbol: "recoverInterruptedTurns"
        - path: "src/data/telemetry.ts"
          symbol: "listStaleWork"
        - path: "src/core/telemetry-staleness.ts"
          symbol: "TelemetryStaleDetector"
        - path: "src/core/telemetry-staleness.ts"
          symbol: "resolveTelemetryStaleThreshold"
      tests:
        - path: "test/telemetry-staleness.test.mjs"
          name: "telemetry stale detector reports provider/profile-aware stale active work without mutating sessions"
        - path: "test/telemetry-staleness.test.mjs"
          name: "telemetry stale detector handles missing progress times and ignores completed turns"
      failures:
        - "BestEffortTelemetryService swallows store failures through onError so runtime work continues."
        - "Provider detailed events are opt-in; default capture is aggregate/metadata."
        - "Tool argument progress is stored without argument bodies; runtime/provider snapshots allow-list metadata and omit result/partial/output bodies."
        - "getPayloadPreview is unavailable; prune mutates only when apply is explicit."
      confidence: "high"
    - id: "WP02-DATA-TEL-005"
      status: "implemented"
      sources:
        - path: "src/data/telemetry-queries.ts"
          symbol: "listTelemetrySessions"
        - path: "src/data/telemetry-queries.ts"
          symbol: "getTelemetryTurnTimeline"
        - path: "src/data/telemetry-queries.ts"
          symbol: "listTelemetryProviderEventsPage"
        - path: "src/data/telemetry-retention.ts"
          symbol: "getTelemetryRetentionStats"
        - path: "src/data/telemetry-retention.ts"
          symbol: "pruneTelemetryRetention"
      tests:
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry read APIs return bounded correlated summaries"
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry provider event page enforces limits and cursors"
        - path: "test/telemetry-store.test.mjs"
          name: "telemetry stale, stats, and prune are read-oriented by default"
      failures:
        - "BestEffortTelemetryService swallows store failures through onError so runtime work continues."
        - "Provider detailed events are opt-in; default capture is aggregate/metadata."
        - "Tool argument progress is stored without argument bodies; runtime/provider snapshots allow-list metadata and omit result/partial/output bodies."
        - "getPayloadPreview is unavailable; prune mutates only when apply is explicit."
      confidence: "high"
---

# Scope

Telemetry tables, lifecycle upserts, bounded query/read contracts, ordered best-effort writing, restart settlement, staleness observation, and explicit retention mutation.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: telemetry_turns; telemetry_phases; telemetry_provider_requests; telemetry_provider_events; telemetry_tool_calls; turn/phase/provider/tool status unions; metadata_only, bounded_preview, disabled capture modes.
- Routes and protocols: No product HTTP route is owned; debug formatters are a consumer boundary.
- State transitions: Correlated turns, phases, provider requests/events, and tool calls upsert through lifecycle statuses. recoverInterruptedTurns settles active work after restart. AsyncTelemetryWriter preserves global enqueue order and flushes synchronously at the hard queue bound. Staleness reads active records and never cancels sessions.
- Failure and security: BestEffortTelemetryService swallows store failures through onError so runtime work continues. Provider detailed events are opt-in; default capture is aggregate/metadata. Tool argument progress is stored without argument bodies; runtime/provider snapshots allow-list metadata and omit result/partial/output bodies. getPayloadPreview is unavailable; prune mutates only when apply is explicit.
- Compatibility: Detailed provider event mode remains optional. Unsupported archive isolation is not part of current behavior.

# Requirements and invariants

## Requirement: WP02-DATA-TEL-001

The five telemetry tables SHALL persist correlated bounded turn, phase, provider-request/event, and tool-call lifecycle records.

## Requirement: WP02-DATA-TEL-002

Default capture SHALL minimize content: aggregate provider metadata, no tool argument bodies, allow-listed snapshots, and unavailable payload-preview reads.

## Requirement: WP02-DATA-TEL-003

Telemetry writes SHALL be best-effort and globally ordered; queue pressure SHALL force a flush rather than drop lifecycle work.

## Requirement: WP02-DATA-TEL-004

Restart recovery may settle interrupted telemetry records; stale-work detection SHALL remain read-only and provider/profile threshold aware.

## Requirement: WP02-DATA-TEL-005

Telemetry reads SHALL enforce limits/cursors, and retention SHALL default to inspection/dry-run unless mutation is explicitly applied.

# Interfaces and ownership

Capability IDs: `pibo.data.telemetry`.

Implemented public contracts:

- `applyPiboDataSchema`
- `TelemetryStore`
- `TelemetryStore.upsertTurn`
- `TelemetryStore.upsertPhase`
- `TelemetryStore.upsertProviderRequest`
- `TelemetryStore.upsertToolCall`
- `ProviderEventTelemetryMode`
- `PiboRuntimeTelemetryRecorder`
- `PiboProviderTelemetryRecorder`
- `telemetrySafeJsonObject`
- `telemetrySafeTopLevelKeys`
- `createTelemetryBoundedPreview`
- `TelemetryStore.getPayloadPreview`
- `BestEffortTelemetryService`
- `AsyncTelemetryWriter.enqueue`
- `AsyncTelemetryWriter.flush`
- `AsyncTelemetryWriter.dispose`
- `TelemetryStore.recoverInterruptedTurns`
- `TelemetryStore.listStaleWork`
- `TelemetryStaleDetector`
- `resolveTelemetryStaleThreshold`
- `listTelemetrySessions`
- `getTelemetryTurnTimeline`
- `listTelemetryProviderEventsPage`
- `getTelemetryRetentionStats`
- `pruneTelemetryRetention`

Related ownership boundaries:

- SPC-OP-002 owns pibo debug telemetry command presentation.
- SPC-SEC-003 owns general secret/redaction policy; this spec may claim only concrete telemetry minimization implemented in code.
- SPC-GW-001 supplies runtime events; telemetry failure must not alter routed work.

# Failure and security behavior

- BestEffortTelemetryService swallows store failures through onError so runtime work continues.
- Provider detailed events are opt-in; default capture is aggregate/metadata.
- Tool argument progress is stored without argument bodies; runtime/provider snapshots allow-list metadata and omit result/partial/output bodies.
- getPayloadPreview is unavailable; prune mutates only when apply is explicit.

# Known limits

- Non-current claim excluded: claim generic secret-like redaction: createTelemetryBoundedPreview truncates but does not redact arbitrary secrets.
- Non-current claim excluded: claim raw provider payload retrieval is available; getPayloadPreview returns unavailable.
- Non-current claim excluded: claim telemetry staleness cancels work or that archive isolation exists.
- Current limit or evidence gap: If bounded_preview capture is enabled later, generic secret redaction is not implemented by createTelemetryBoundedPreview.
- Current limit or evidence gap: Real-provider and credential capture remains unperformed in this read-only audit.

# Verification and traceability

Source symbols and named tests are bound to commit `39090b8850758293e69380a52bb7498d7c955bc2`. Requirement confidence measures trace quality; it does not claim that an external, browser, real-provider, or Pibo2 check ran.

Package verification commands:

- `npm run build`
- `npm run typecheck`
- `node scripts/run-test-suite.mjs test/telemetry-store.test.mjs test/telemetry-writer.test.mjs test/telemetry-staleness.test.mjs`

# Related concepts

- SPC-OP-002 owns pibo debug telemetry command presentation.
- SPC-SEC-003 owns general secret/redaction policy; this spec may claim only concrete telemetry minimization implemented in code.
- SPC-GW-001 supplies runtime events; telemetry failure must not alter routed work.
