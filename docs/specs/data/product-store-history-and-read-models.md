---
type: "Specification"
title: "Product Store, History, Payloads, and Read Models"
description: "Defines the implemented product store, history, payloads, and read models contract and its current ownership boundaries."
tags: ["data", "product-store", "history"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-05T10:02:49Z"
sources:
  - resource: "scope:Current implementation and tests at traceability.commit"
implementation:
  state: "current"
  baseline_commit: "14cbaf0fd04cfa321674b570baeb40e543d957cb"
  source_evidence: "performed"
  test_execution: "complete isolated root suite passed: 2744 tests, 2739 passed, 0 failed, 5 skipped"
  build_and_typecheck_execution: "clean full build and all typechecks passed"
traceability:
  commit: "14cbaf0fd04cfa321674b570baeb40e543d957cb"
  requirements:
    - id: "WP02-DATA-STORE-001"
      status: "implemented"
      sources:
        - path: "src/data/schema.ts"
          symbol: "PIBO_DATA_SCHEMA_VERSION"
        - path: "src/data/schema.ts"
          symbol: "applyPiboDataSchema"
        - path: "src/data/pibo-store.ts"
          symbol: "PiboDataStore"
        - path: "src/data/pibo-store.ts"
          symbol: "createDefaultPiboDataStore"
        - path: "src/data/schema.ts"
          symbol: "assertSupportedPiboDataSchemaVersion"
      tests:
        - path: "test/data-v2-store.test.mjs"
          name: "v2 schema migration is idempotent"
        - path: "test/data-v2-store.test.mjs"
          name: "schema migration from v5 installs the exact tool lifecycle index"
        - path: "test/data-v2-store.test.mjs"
          name: "fresh pibo chat schema omits retired room partition structures"
        - path: "test/app-context-fresh-schema.test.mjs"
          name: "fresh app-context schemas omit retired access-control structures"
        - path: "test/data-schema-retired-scope-migration.test.mjs"
          name: "an already-stamped schema v6 is repaired idempotently and preserves runtime bindings"
        - path: "test/data-v2-store.test.mjs"
          name: "pibo data store rejects future schemas without mutating them"
        - path: "test/data-v2-store.test.mjs"
          name: "schema v8 migrates payload identity without rewriting existing payload files"
        - path: "test/stream-render-final-review.test.mjs"
          name: "current schema migration rolls every injected phase back and retries completely"
        - path: "test/stream-render-final-review.test.mjs"
          name: "current schema resumes an interrupted legacy negative sequence repair"
      failures:
        - "Bounded payload reads verify size and SHA-256."
        - "Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow."
        - "Missing or corrupt external payload content falls back to the durable preview where the history service supports it."
      confidence: "high"
    - id: "WP02-DATA-STORE-002"
      status: "implemented"
      sources:
        - path: "src/data/ingest-service.ts"
          symbol: "ChatDataIngestService"
        - path: "src/data/ingest-service.ts"
          symbol: "ingestUserMessageAccepted"
        - path: "src/data/ingest-service.ts"
          symbol: "ingestOutputEvent"
        - path: "src/data/ingest-service.ts"
          symbol: "PiboOutputIdentityCollisionError"
        - path: "src/data/event-log.ts"
          symbol: "PiboEventLogStore"
        - path: "src/data/event-log.ts"
          symbol: "appendEvent"
        - path: "src/data/event-log.ts"
          symbol: "findByIdempotencyKey"
        - path: "src/data/message-store.ts"
          symbol: "MessageStore"
        - path: "src/data/message-store.ts"
          symbol: "insertMessage"
        - path: "src/data/message-store.ts"
          symbol: "completeAssistantMessagesForTurn"
        - path: "src/core/output-render-sequence.ts"
          symbol: "OutputRenderSequencer"
        - path: "src/sessions/pibo-data-store.ts"
          symbol: "claimOutputRenderSequence"
      tests:
        - path: "test/data-v2-ingest-service.test.mjs"
          name: "chat data ingest writes user messages idempotently"
        - path: "test/data-v2-ingest-service.test.mjs"
          name: "chat data ingest records repeated user messages without client transaction id"
        - path: "test/data-v2-ingest-service.test.mjs"
          name: "chat data ingest records output identity collisions instead of silently dropping them"
        - path: "test/data-v2-ingest-service.test.mjs"
          name: "product history reconstructs full routed messages without native transcript data"
        - path: "test/data-v2-ingest-service.test.mjs"
          name: "chat data ingest round-trips immutable render sequence metadata"
        - path: "test/output-render-sequence.test.mjs"
          name: "output render sequencer preserves supplied canonical output part indices"
        - path: "test/stream-render-block-review.test.mjs"
          name: "render sequence survives a durable store restart and wall-clock rollback"
      failures:
        - "Bounded payload reads verify size and SHA-256."
        - "Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow."
        - "Missing or corrupt external payload content falls back to the durable preview where the history service supports it."
      confidence: "high"
    - id: "WP02-DATA-STORE-003"
      status: "implemented"
      sources:
        - path: "src/data/payload-store.ts"
          symbol: "PayloadStore"
        - path: "src/data/payload-store.ts"
          symbol: "writePayload"
        - path: "src/data/payload-store.ts"
          symbol: "readPayloadBytesBounded"
        - path: "src/data/payload-store.ts"
          symbol: "readPayloadJsonBounded"
        - path: "src/data/payload-store.ts"
          symbol: "findBySha256"
        - path: "src/data/schema.ts"
          symbol: "idx_payloads_identity"
        - path: "src/tools/mcp-bridge.ts"
          symbol: "piboResultToMcp"
        - path: "src/apps/chat/data/history-query-service.ts"
          symbol: "ChatHistoryQueryService"
        - path: "src/apps/chat/data/history-query-service.ts"
          symbol: "listProductHistoryEntries"
      tests:
        - path: "test/data-v2-store.test.mjs"
          name: "payload store writes, reads, and dedupes payloads"
        - path: "test/data-v2-store.test.mjs"
          name: "payload deduplication keeps incompatible interpretation metadata isolated"
        - path: "test/data-v2-store.test.mjs"
          name: "application/json payloads serialize primitive strings as valid JSON"
        - path: "test/trace-v2-fast-path.test.mjs"
          name: "trace materialization isolates text that matches existing JSON bytes"
        - path: "test/pibo-tool-mcp-bridge.test.mjs"
          name: "session-scoped MCP bridge enforces tool isolation and preserves progress, content, errors, correlation, and large results"
        - path: "test/data-v2-ingest-service.test.mjs"
          name: "chat data ingest externalizes large user message payloads"
      failures:
        - "Bounded payload reads verify size and SHA-256."
        - "Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow."
        - "Missing or corrupt external payload content falls back to the durable preview where the history service supports it."
      confidence: "medium"
    - id: "WP02-DATA-STORE-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/history-query-service.ts"
          symbol: "ChatHistoryQueryService"
        - path: "src/apps/chat/data/history-query-service.ts"
          symbol: "getProductHistoryCoverage"
        - path: "src/apps/chat/data/timeline-query-service.ts"
          symbol: "ChatTimelineQueryService"
        - path: "src/apps/chat/data/timeline-query-service.ts"
          symbol: "listTraceEvents"
        - path: "src/apps/chat/data/room-service.ts"
          symbol: "ChatRoomService"
        - path: "src/apps/chat/data/read-state-service.ts"
          symbol: "ChatReadStateService"
        - path: "src/apps/chat/data/event-command-service.ts"
          symbol: "ChatEventCommandService"
        - path: "src/shared/trace-event-projection.ts"
          symbol: "markIncompletePersistedTurns"
      tests:
        - path: "test/chat-v2-native-services.test.mjs"
          name: "session and navigation activity remain monotonic after stale compatibility projection"
        - path: "test/chat-v2-native-services.test.mjs"
          name: "timeline query retains full-history steering message identity metadata"
        - path: "test/chat-ui-integration.test.mjs"
          name: "idle persisted turns without a terminal project an explicit incomplete error"
      failures:
        - "Bounded payload reads verify size and SHA-256."
        - "Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow."
        - "Missing or corrupt external payload content falls back to the durable preview where the history service supports it."
      confidence: "high"
    - id: "WP02-DATA-STORE-005"
      status: "implemented"
      sources:
        - path: "src/apps/chat/data/timeline-query-service.ts"
          symbol: "ChatTimelineQueryService"
        - path: "src/apps/chat/data/timeline-query-service.ts"
          symbol: "listTraceEvents"
      tests:
        - path: "test/chat-v2-native-services.test.mjs"
          name: "deferred payload authorization fails closed when its SQL evidence exceeds the bound"
        - path: "test/chat-v2-native-services.test.mjs"
          name: "deferred payload authorization validates the complete exact lifecycle before granting"
        - path: "test/chat-v2-native-services.test.mjs"
          name: "ordinary tool identity requires exactly one unambiguous invocation"
      failures:
        - "Bounded payload reads verify size and SHA-256."
        - "Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow."
        - "Missing or corrupt external payload content falls back to the durable preview where the history service supports it."
      confidence: "high"
---

# Scope

Canonical non-session and non-telemetry product facts in pibo.sqlite; normalized history ingestion; external payload bytes and metadata; room, history, timeline, read-state, and event-command projections.

This specification describes implemented behavior at the traceability commit. Planned behavior and contracts assigned to related concepts are outside its normative scope.

# Current behavior

- Persistence and models: `PIBO_DATA_SCHEMA_VERSION=8`; rooms; payloads; event log; chat messages; observations; session stats; app read state; navigation; indexer offsets; migration import map; durable render high-water, output-part, and tool-invocation counters; external payload root with SHA-256 metadata, refcounting, and gzip/identity encoding. Payload deduplication uses SHA-256, content type, and retention class as one indexed semantic identity, while different metadata variants retain isolated rows and files. Opening a supported legacy schema transactionally repairs retired required partition columns and migrates the former SHA-only payload uniqueness without rewriting existing payload files; future schemas fail before mutation.
- Routes and protocols: No HTTP route is owned; Chat query services are consumed by Web routes.
- State transitions: User acceptance and output ingestion append idempotent event facts, then project normalized messages and observations. Client transaction IDs deduplicate retries; repeated text without a transaction ID remains distinct. Output identity collisions fail visibly. Canonical render sequence, output-part index, and tool-invocation ordinal survive restart and clock rollback. Read cursors advance monotonically, and an idle started turn without a terminal projects an explicit bounded incomplete-integrity marker rather than a false running state.
- Failure and security: Bounded payload reads verify size and SHA-256. Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow. Missing or corrupt external payload content falls back to the durable preview where the history service supports it.
- Compatibility: Legacy Pi binding columns are backfilled and old-writer Pi updates are synchronized by migration triggers. Live deltas are excluded from durable timeline facts by default. Projections are rebuildable and do not replace event_log facts.
- Product-data boundary: App Context identifies one authenticated product data space; it is not a tenant or per-user datastore boundary.
- Workflow-store boundary: Fresh product storage does not create retired container storage. Upgrade migration removes old catalog tables from `pibo.sqlite` after transferring catalog facts to `pibo-workflows.sqlite`; catalog-only upgrades do not require retired container storage. Canonical Sessions and history remain in `pibo.sqlite`.

# Requirements and invariants

## Requirement: WP02-DATA-STORE-001

The specification SHALL define schema version 8, repair supported legacy physical tables transactionally, migrate SHA-only payload identity without rewriting existing payload files, reject unsupported future versions without mutation, and assign only the listed non-Session, non-telemetry, non-Workflow product tables to this owner.

## Requirement: WP02-DATA-STORE-002

Accepted user messages and normalized output SHALL be ingested idempotently; unkeyed repeated text remains distinct; identity collisions fail visibly; and durable render, part, and invocation identities remain monotonic across retries and restarts.

## Requirement: WP02-DATA-STORE-003

Over-budget values SHALL use content-addressed external payload storage with indexed deduplication by SHA-256, content type, and retention class. Equal bytes with different metadata SHALL remain isolated, JSON values including primitive strings SHALL use valid JSON serialization, and bounded reads SHALL verify integrity.

## Requirement: WP02-DATA-STORE-004

History, timeline, room, session, event-command, and read-state services SHALL query product facts with explicit bounds and monotonic cursors.

## Requirement: WP02-DATA-STORE-005

Deferred tool payload access SHALL fail closed unless one complete, exact, bounded lifecycle proves session and tool ownership.

# Interfaces and ownership

Capability IDs: `pibo.data.product-store`, `pibo.data.history-projections`.

Implemented public contracts:

- `PIBO_DATA_SCHEMA_VERSION`
- `applyPiboDataSchema`
- `PiboDataStore`
- `createDefaultPiboDataStore`
- `ChatDataIngestService.ingestUserMessageAccepted`
- `ChatDataIngestService.ingestOutputEvent`
- `PiboOutputIdentityCollisionError`
- `PiboEventLogStore.appendEvent`
- `PiboEventLogStore.findByIdempotencyKey`
- `MessageStore.insertMessage`
- `MessageStore.completeAssistantMessagesForTurn`
- `PayloadStore.writePayload`
- `PayloadStore.readPayloadBytesBounded`
- `PayloadStore.readPayloadJsonBounded`
- `PayloadStore.findBySha256`
- `ChatHistoryQueryService.listProductHistoryEntries`
- `ChatHistoryQueryService`
- `ChatHistoryQueryService.getProductHistoryCoverage`
- `ChatTimelineQueryService.listTraceEvents`
- `ChatRoomService`
- `ChatReadStateService`
- `ChatEventCommandService`

Related ownership boundaries:

- SPC-DATA-002 owns sessions and session_runtime_bindings even though those tables share pibo.sqlite.
- SPC-DATA-003 owns telemetry tables in the same database.
- SPC-RUN-007 owns native runtime transcript compatibility; product history is primary.
- SPC-WEB-004 and SPC-WEB-005 own browser overlays and trace rendering, not durable facts.
- Workflow catalog and execution facts use `pibo-workflows.sqlite` and belong to SPC-ORCH-005/SPC-ORCH-006.

# Failure and security behavior

- Bounded payload reads verify size and SHA-256.
- Equal payload bytes with different content types or retention classes use separate metadata identities and storage paths instead of failing or inheriting incompatible metadata.
- Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow.
- Missing or corrupt external payload content falls back to the durable preview where the history service supports it.

# Known limits

- Non-current claim excluded: assign Sessions, runtime bindings, telemetry, or Workflow-store facts to this owner merely because composition code is nearby.
- Non-current claim excluded: describe ChatNavigationQueryService as a complete native navigation implementation; its source marks it reserved and current call sites compose navigation elsewhere.
- Non-current claim excluded: claim product store code authenticates payload reads; route authentication belongs to Web/security owners.
- Current limit or evidence gap: No focused corruption test was found for bounded payload SHA/length validation and durable-preview fallback.
- Current evidence boundary: Completed scoped manual editor acceptance used ordinary Session history and Workflow-owned execution facts; it does not move either authority into this store.

# Verification and traceability

Source symbols and named tests remain bound to commit `14cbaf0fd04cfa321674b570baeb40e543d957cb`, where the clean full build, all typechecks, and complete isolated root suite passed with 2,744 tests: 2,739 passed, 0 failed, 5 skipped, exit 0. At final integration `7ec71c2cca2108423002be0e7330d2a20c4c5b67`, source checks and all typechecks passed; its whole-root rerun remains underway and is not claimed. Headed Room workspace inheritance and actual normal and manual `openai-codex` Sessions succeeded. This specification does not claim Pibo2 or deployment evidence.

# Related concepts

- SPC-DATA-002 owns sessions and session_runtime_bindings even though those tables share pibo.sqlite.
- SPC-DATA-003 owns telemetry tables in the same database.
- SPC-RUN-007 owns native runtime transcript compatibility; product history is primary.
- SPC-WEB-004 and SPC-WEB-005 own browser overlays and trace rendering, not durable facts.
- Workflow catalog and execution facts use `pibo-workflows.sqlite` and belong to SPC-ORCH-005/SPC-ORCH-006.
