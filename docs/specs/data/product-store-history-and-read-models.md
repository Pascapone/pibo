---
type: "Specification"
title: "Product Store, History, Payloads, and Read Models"
description: "Defines the implemented product store, history, payloads, and read models contract and its current ownership boundaries."
tags: ["data", "product-store", "history"]
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-22T19:37:33Z"
sources:
  - resource: "scope:Current source at traceability.commit; media grants and structured history verified by cutover-k07-media-admission-focused-06"
  - resource: "scope:Historical schema/history authoring checkpoints e5dada192a650482d7783540854090943fc5454c and d30e0250fdce4017920c7f9c41c1e2067124d23b; earlier Docker/full-typecheck evidence is not current candidate acceptance"
implementation:
  state: "current"
  baseline_commit: "8cefa246f0f7e7a4bb921e98b4349eddfd330e0b"
  source_evidence: "performed for media grants, structured attachment history and schema version; other named evidence retains its historical scope"
  test_execution: "164 focused module/provider/storage/draft tests and 11 selected HTTP tests passed; not a full data or Web suite"
  build_and_typecheck_execution: "narrow resource-store/payload/protocol/provider/draft types and 22 plugin artifacts passed; full worker/web-app/root compilation remains unpassed; installation user-skipped"
traceability:
  commit: "8cefa246f0f7e7a4bb921e98b4349eddfd330e0b"
  requirements:
    - id: "WP02-DATA-STORE-007"
      status: "implemented"
      sources:
        - path: "src/attachments/resource-schema.ts"
          symbol: "ATTACHMENT_RESOURCE_SCHEMA"
        - path: "src/attachments/resource-store.ts"
          symbol: "AttachmentResourceStore"
        - path: "src/data/payload-store.ts"
          symbol: "PayloadStore"
        - path: "src/data/chat-storage-worker.ts"
          symbol: "execute"
        - path: "src/apps/chat/data/session-query-service.ts"
          symbol: "ChatSessionQueryService.deleteSessions"
      tests:
        - path: "test/attachment-resource-store.test.mjs"
          name: "Core media handles bind verified private bytes to Session/transaction/resource and survive restart"
        - path: "test/attachment-resource-store.test.mjs"
          name: "shared bytes retain one reference per grant; duplicate discard is harmless and last discard deletes bytes"
        - path: "test/attachment-resource-store.test.mjs"
          name: "payload cleanup cannot unlink a freshly committed owner reusing the same content file"
        - path: "test/attachment-resource-store.test.mjs"
          name: "standalone payload release locks the count decision and reuses an outer rollback"
        - path: "test/attachment-resource-store.test.mjs"
          name: "schema 16 adds grants without modifying schema-15 Session, history or payload content"
        - path: "test/attachment-message-storage.test.mjs"
          name: "worker media admission promotes one grant atomically, retains it on retry, and deletes it with product history"
      failures:
        - "Missing, corrupt, foreign-scope or changed resources cannot authorize admission; matching metadata alone does not prove bytes."
        - "Preparation publishes files before SQL; rejected or interrupted preparation can leave unowned files. No sweeper or physical-loss durability acceptance is claimed."
        - "Cleanup attempts every released file and aggregates errors after ownership removal has committed; failed unlinks can remain orphaned."
        - "Only the traced product-history deletion path releases grants; arbitrary direct Session-identity deletion is not claimed to destroy product history."
      confidence: "high"
    - id: "WP02-DATA-STORE-006"
      status: "implemented"
      sources:
        - path: "src/data/chat-storage-worker.ts"
          symbol: "execute"
        - path: "src/data/ingest-service.ts"
          symbol: "ChatDataIngestService.ingestUserMessageAccepted"
        - path: "src/data/message-command-store.ts"
          symbol: "MessageCommandStore"
        - path: "src/apps/chat/data/session-query-service.ts"
          symbol: "ChatSessionQueryService.deleteSessions"
      tests:
        - path: "test/attachment-message-storage.test.mjs"
          name: "structured attachment history survives restart and optional event loss without receipt file reads"
        - path: "test/attachment-message-storage.test.mjs"
          name: "attachment snapshot references are acquired once per message and released by product-history deletion"
        - path: "test/attachment-message-storage.test.mjs"
          name: "structured snapshot bytes participate in existing per-command and session admission budgets"
        - path: "test/attachment-message-storage.test.mjs"
          name: "canonical attachment snapshots deduplicate key-order variants and never turn raw paths into resources"
      failures:
        - "Optional event retention and provider availability do not own structured product history or receipt identity."
        - "Raw paths are not media authority; media requires authorized immutable grants whose snapshot metadata omits filesystem paths."
        - "Prepared file publication precedes the database transaction; no global staged-file garbage collection is claimed."
      confidence: "high"
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
        - path: "src/debug/output-integrity.ts"
          symbol: "inspectOutputIntegrity"
        - path: "src/debug/output-collision-repair.ts"
          symbol: "repairOutputCollision"
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
        - path: "test/output-identity-regression.test.mjs"
          name: "different assistant finals in one turn receive distinct durable identities while exact replay reattaches"
        - path: "test/output-identity-regression.test.mjs"
          name: "equivalent assistant aliases fingerprint identically and compact queued/completed results do not collide"
        - path: "test/output-identity-regression.test.mjs"
          name: "collision diagnostics are redacted and dead-letter reconciliation is explicit, audited, and idempotent"
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

- Persistence and models: `PIBO_DATA_SCHEMA_VERSION=16`; rooms; payloads; attachment resource grants; event log; chat messages; observations; session stats; app read state; navigation; indexer offsets; migration import map; durable render high-water, output-part, and tool-invocation counters; external payload root with SHA-256 metadata, refcounting, and gzip/identity encoding. Schema version 9 introduced the Session-owned `session_agent_observation_auto_cursors` table defined by SPC-DATA-002; that shared physical migration does not transfer semantic ownership to this specification. Payload deduplication uses SHA-256, content type, and retention class as one indexed semantic identity, while different metadata variants retain isolated rows and files. Opening a supported legacy schema transactionally repairs retired required partition columns and migrates the former SHA-only payload uniqueness without rewriting existing payload files; future schemas fail before mutation.
- Routes and protocols: No HTTP route is owned; Chat query services are consumed by Web routes.
- State transitions: User acceptance and output ingestion append idempotent event facts, then project normalized messages and observations. Client transaction IDs deduplicate retries; repeated text without a transaction ID remains distinct. Equivalent output aliases canonicalize to one versioned fingerprint, while versionless persisted fingerprints are compared with the exact legacy algorithm. Later assistant finals within a turn receive a new output-part identity, and queued versus completed execution results have distinct phase identities with legacy final-key lookup compatibility. Conflicting reuse remains a permanent collision. Canonical render sequence, output-part index, and tool-invocation ordinal survive restart and clock rollback. Read cursors advance monotonically, and an idle started turn without a terminal projects an explicit bounded incomplete-integrity marker rather than a false running state.
- Failure and security: Bounded payload reads verify size and SHA-256. Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow. Missing or corrupt external payload content falls back to the durable preview where the history service supports it.
- Compatibility: Legacy Pi binding columns are backfilled and old-writer Pi updates are synchronized by migration triggers. Live deltas are excluded from durable timeline facts by default. Read projections do not replace durable facts; the structured attachment snapshot owned by a product message is itself durable user content and cannot be rebuilt from an optional accepted-event marker.
- Product-data boundary: App Context identifies one authenticated product data space; it is not a tenant or per-user datastore boundary.
- Workflow-store boundary: Fresh product storage does not create retired container storage. Upgrade migration removes old catalog tables from `pibo.sqlite` after transferring catalog facts to `pibo-workflows.sqlite`; catalog-only upgrades do not require retired container storage. Canonical Sessions and history remain in `pibo.sqlite`.

# Requirements and invariants

## Requirement: WP02-DATA-STORE-001

The specification SHALL identify the current shared schema version 16, retain the Session-owned automatic observation cursor table introduced by version 9 without claiming its semantics, repair supported legacy physical tables transactionally, migrate SHA-only payload identity without rewriting existing payload files, reject unsupported future versions without mutation, and assign only the listed non-Session, non-telemetry, non-Workflow product tables to this owner.

## Requirement: WP02-DATA-STORE-002

Accepted user messages and normalized output SHALL be ingested idempotently; unkeyed repeated text remains distinct; equivalent delivery aliases SHALL fingerprint identically; versionless historic fingerprints and execution-result delivery keys SHALL remain replay-compatible without weakening conflict checks; semantically different assistant parts and execution-result phases SHALL use distinct identities; identity collisions SHALL remain non-retryable; and durable render, part, and invocation identities SHALL remain monotonic across retries and restarts. Collision diagnostics SHALL contain only bounded field names/change classes and redacted producer, projection, and phase provenance. Repair SHALL require an explicit keep-existing decision, report transcript/trace/navigation/command projection state, write an idempotent audit event, and never compare bodies or replay side effects.

## Requirement: WP02-DATA-STORE-003

Over-budget values SHALL use content-addressed external payload storage with indexed deduplication by SHA-256, content type, and retention class. Equal bytes with different metadata SHALL remain isolated, JSON values including primitive strings SHALL use valid JSON serialization, and bounded reads SHALL verify integrity.

## Requirement: WP02-DATA-STORE-004

History, timeline, room, session, event-command, and read-state services SHALL query product facts with explicit bounds and monotonic cursors.

## Requirement: WP02-DATA-STORE-005

Deferred tool payload access SHALL fail closed unless one complete, exact, bounded lifecycle proves session and tool ownership.

## Requirement: WP02-DATA-STORE-006

Typed attachment admission SHALL retain one canonical structured snapshot as product user history, independently of optional event projections and provider availability. The worker derives `{formatVersion: 1, attachments, providerPins, resources}` from captured request data, not mutable extension metadata. For authorized media, `resources` contains server-derived opaque resource/draft identities, MIME, byte count, SHA-256 and name, never filesystem paths. Empty media still produces an empty resource list. The separate grant authority below owns the bytes.

Canonical UTF-8 JSON bytes use the existing PayloadStore with content type `application/json` and retention class `chat_attachment`. The product message's `attributes.attachmentSnapshotRef` owns one logical reference. Message insertion, reference acquisition and durable command insertion share the existing transaction; a duplicate receipt does not acquire another reference. Optional events carry bounded version/count markers, not a duplicate snapshot envelope. The plain-text command claim format is unchanged.

The command fingerprint additionally binds the snapshot SHA-256 and byte count. Admission charges materialized text plus structured snapshot bytes against the existing per-command and queue byte budgets; snapshot storage is not an uncharged sidecar. Existing unflagged fingerprints remain exact legacy values. Equal snapshots may share a physical payload while each owning message retains a separate logical reference and byte charge. No table or schema migration is added for this representation.

Session history deletion releases the message-owned snapshot reference through the existing refcount mechanism and removes a released file after the transaction. PayloadStore still publishes prepared files before SQL commitment; staged/orphan-file collection is not added here. Receipt queries never read snapshot files: a content-bound receipt proves admission, not current availability or integrity of external bytes.

The [Composer/admission contract](/specs/web/composer-delivery-files-and-media.md) owns the opt-in HTTP envelope, provider selection and local receipt reconciliation. This store contract does not establish rich history rendering, clone/fork transport, copy-buffer integration or full K07 completion.

## Requirement: WP02-DATA-STORE-007

Schema 16 SHALL add `attachment_resource_grants` with an opaque ID, unique `(session_id, client_txn_id, draft_resource_id)`, payload reference, display name, creation time and optional accepted `message_id`. The payload reference is a foreign key. Session/message identity is checked by Core rather than cascading foreign keys: traced Web destruction removes Session identity before the separate product-history transaction. This table is the resource authority; receipt fingerprints, filenames, retention labels, plugin registries and optional events are not substitute authorization stores.

Core preparation computes SHA-256 from the actual bytes and uses PayloadStore with dedicated `chat_attachment_media_v1` retention, identity encoding, private temporary-file mode and file-content flushing. Existing compression/dedup defaults and persisted legacy file paths remain unchanged; new image/PDF files use Core-selected suffixes for native readers. Scope, MIME/size, canonical file identity, nonsymlink leaf, length and full-byte checksum checks fail closed. A preparation owns exactly one payload reference. Identical preparation-key retries reuse the handle/reference; changed bytes, MIME or name conflict rather than replacing it.

Fresh admission verifies each distinct payload before the transaction, then rechecks grants and promotes them to the matching accepted user message in the same transaction as message/snapshot/receipt commitment. Promotion changes ownership, not the reference count, and cannot reassign a grant to a different message. Rollback retains the prepared owner; model failure or interrupted execution does not revoke accepted media. Snapshot bytes, not the referenced binary-file sizes, participate in the command text-plus-snapshot charge; media's own byte/transport bounds remain separate and do not imply a total stored-data quota.

Pending-resource discard and `ChatSessionQueryService.deleteSessions` release matching owners transactionally. History deletion computes its payload-reference counts inside that transaction. Optional event loss and provider removal do not release grants. Direct `PiboDataSessionStore.delete` is an identity operation, not an automatically extended product-history destructor; no universal deletion-hook or fork/copy ownership claim is made here.

Payload publication and last-owner cleanup coordinate through SQLite writer transactions. `commitPreparedPayload` checks file availability/size before publishing metadata ownership; `releaseReferences` protects its count decision even without an outer transaction; and file cleanup rechecks for a newly committed owner before unlinking. Full-byte hashing remains outside admission transactions, but file stat/unlink operations do occur under writer locking: this is not a filesystem-latency or metadata-only-operation guarantee, and `busy_timeout` bounds lock waiting rather than filesystem duration.

After the ownership/history transaction commits, cleanup attempts every released file before raising an aggregate error. Such an error reports incomplete cleanup, not database rollback; orphan bytes may remain, and retries cannot reconstruct the removed file list from deleted rows. Prepared-file publication can also leave orphan files on rejection or crash. No orphan sweeper, expiration policy, chunk transport, whole-system retention closure, cross-process load acceptance or directory-fsync/physical-loss guarantee is established by these fixtures. Schema changes were tested only on disposable databases, not valuable/live data.

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
- `PayloadStore.releaseReferences`
- `PayloadStore.removeReleasedFiles`
- `AttachmentResourceStore`
- `ATTACHMENT_RESOURCE_SCHEMA`
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

# Producer-path diagnosis

The compact `execution_result` reproduction is source-derived: `RoutedSession.enqueueCompactAction` emits a queued result and `processQueuedCompact` later emits completion for the same execution event. Phase-qualified identities now keep those semantically different outputs separate, while a literal pre-version legacy final key/fingerprint remains idempotent and conflicting legacy content remains guarded. The assistant reproduction is also source-derived: a runtime may emit multiple terminal assistant records in one turn while reusing producer index zero; `OutputRenderSequencer` now reattaches an exact closed-part replay but allocates a new index when the closed part fingerprint differs. Chat Web and Local CLI persistence attach their own live/replay provenance, so future diagnostics identify an existing/incoming pair. The issue's historical 3.5.0 evidence does not contain this new provenance, so the precise production producer pair for those old assistant dead letters remains unverified rather than inferred from message bodies.

# Failure and security behavior

- Bounded payload reads verify size and SHA-256.
- Equal payload bytes with different content types or retention classes use separate metadata identities and storage paths instead of failing or inheriting incompatible metadata.
- Deferred payload authorization requires exact bounded session/tool/event evidence and fails closed on ambiguity or SQL cap overflow.
- Missing or corrupt external payload content falls back to the durable preview where the history service supports it.

# Known limits

- Non-current claim excluded: assign Sessions, runtime bindings, telemetry, or Workflow-store facts to this owner merely because composition code is nearby.
- Non-current claim excluded: describe ChatNavigationQueryService as a complete native navigation implementation; its source marks it reserved and current call sites compose navigation elsewhere.
- Non-current claim excluded: claim product store code authenticates payload reads; route authentication belongs to Web/security owners.
- Bounded media SHA/length, missing-file and symlink rejection have focused coverage; durable-preview fallback and whole-system retention still retain their separate evidence gaps.
- Historical evidence boundary: Completed scoped manual editor acceptance used ordinary Session history and Workflow-owned execution facts; it does not move either authority into this store or establish the current candidate's attachment UI acceptance.
- Typed JSON/media snapshots and resource grants have transaction/refcount coverage; fake-auth HTTP fixtures cover scoped retrieval and raster preview. Actual Composer/copy/GC, real-login, multi-tab and rich history/fork integration are not established.

# Verification and traceability

Current traceability is bound to `8cefa246f0f7e7a4bb921e98b4349eddfd330e0b`. `cutover-k07-media-admission-focused-06` passed 164 focused module/provider/storage/draft tests and eleven selected HTTP tests, with no failures/skips. Coverage includes private immutable bytes, restart/idempotency, scope/metadata rejection, corruption/missing files, promotion rollback, shared ownership, cleanup/recommit ordering, post-commit cleanup failure, unchanged deadline guards, and disposable schema-15→16 preservation. Narrow resource-store/payload/protocol/provider/draft types passed, followed by a 581-file test-only behavioral emit and 22 plugin artifacts. This did not typecheck the full worker/web-app/root graph; the earlier broader backend target exhausted its 384 MiB heap, and root compilation remains unpassed.

Media attempts 02–04 remain failed evidence: an obsolete assertion about model-visible paths and cold-worker fixture queue deadlines. Explicit startup preconditions and a new deterministic 500 ms cold-start rejection test corrected test setup without weakening production budgets. Run 05 passed 105 module and eleven HTTP tests without rebuilding artifacts. Earlier JSON-only evidence at `72d60f5b` passed 98 plus seven tests. These batches overlap and are not unique-test totals. Tracked diff and untracked-file hashes were checked against run 06 before source commitment.

The older full-typecheck and isolated Docker schema/session/query/debug evidence belongs to the `e5dada192a650482d7783540854090943fc5454c` / `d30e0250fdce4017920c7f9c41c1e2067124d23b` authoring history. Its broader 66-test selection passed 65 and hit one systemd-environment failure. Those are historical claims, not reruns for this candidate. The [bounded evidence collection](/reports/artifacts/beta4-phase2/direct-cutover-2026-09-22/evidence.json) preserves current commands, failures and overlapping test groups. Installation is explicitly user-skipped. No full root/data suite, headful browser, real-provider, deployment or data migration acceptance is claimed.

# Related concepts

- SPC-DATA-002 owns sessions and session_runtime_bindings even though those tables share pibo.sqlite.
- SPC-DATA-003 owns telemetry tables in the same database.
- SPC-RUN-007 owns native runtime transcript compatibility; product history is primary.
- SPC-WEB-004 and SPC-WEB-005 own browser overlays and trace rendering, not durable facts.
- Workflow catalog and execution facts use `pibo-workflows.sqlite` and belong to SPC-ORCH-005/SPC-ORCH-006.
