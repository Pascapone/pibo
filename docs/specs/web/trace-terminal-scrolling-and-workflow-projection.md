---
type: "Specification"
title: "Chat Web Trace, Terminal, Scrolling, and Workflow Projection"
description: "Defines the implemented Chat Web Trace, Terminal, Scrolling, and Workflow Projection contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
tags:
- web
- chat-web
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-5.6-sol"
  at: "2026-09-08T08:12:30Z"
sources:
  - id: "integrated-source-and-tests"
    resource: "scope:Integrated implementation and tests at traceability.commit"
    title: "Integrated trace and Workflow projection source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "14403bcb91edc685ecb2f2255475f6229008691d"
  package: "WP-06+07-WEB"
  source_evidence: "performed"
  test_execution: "41 focused Debug, inference-usage, Tool-metric, Pi tracing, Goal-accounting, and shared Terminal tests passed"
  build_typecheck_package_execution: "full build and all package typechecks passed in the isolated Docker worker"
  browser_execution: "headful local Debug settings and Terminal model-usage rail passed at 800x457; CDP reload reported no console exceptions, log errors, or network failures"
traceability:
  commit: "6080be5c64205342091733bedde9596a6f9f6465"
  requirements:
    - id: "WEB-TRACE-PAYLOAD-010"
      status: "implemented"
      sources:
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "readTracePayloadChunk"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx"
          symbol: "PayloadRefDetail"
        - path: "src/apps/chat/web-app.ts"
          symbol: "writeChatEventFrames"
      tests:
        - path: "test/chat-large-payload-replay.test.mjs"
          name: "large live outputs retain full references across SSE replay and timeline"
        - path: "test/trace-v2-fast-path.test.mjs"
          name: "payload chunks reconstruct UTF-8 without full reads for identity and gzip"
        - path: "test/session-ui-terminal-rows.test.mjs"
          name: "referenced assistant messages expose expandable full content"
      public: ["GET /api/chat/trace/payload/:ref", "GET /api/chat/trace/payload/:ref?download=1", "Terminal full-content reader"]
      failures: ["Read failures retain the previous section for retry; reference changes invalidate pending loads; downloads require the same authenticated session resolution as chunk reads."]
      confidence: "high"
    - id: "WEB-TRACE-VIEWPORT-009"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/components/useStickyVirtuoso.ts"
          symbol: "useStickyVirtuoso"
      tests:
        - path: "test/use-sticky-virtuoso.test.mjs"
          name: "useStickyVirtuoso uses explicit anchor and Virtuoso prepend contracts"
        - path: "test/chat-ui-terminal-viewport-resize.test.mjs"
          name: "Terminal preserves follow and reading positions when its viewport shrinks"
      public: ["CompactTerminalSessionView", "useStickyVirtuoso"]
      failures: ["Viewport-only changes must not replay detached anchors; pending restoration must not undo new coarse wheel input."]
      confidence: "high"
    - id: "WEB-TRACE-COMPACTION-010"
      status: "implemented"
      sources:
        - path: "src/data/ingest-service.ts"
          symbol: "ChatDataIngestService"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalCompactionCard.tsx"
          symbol: "TerminalCompactionCard"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"
          symbol: "CompactTerminalSessionView"
      tests:
        - path: "test/data-v2-ingest-service.test.mjs"
          name: "chat data ingest snapshots tool metrics for each successful compaction segment"
        - path: "test/session-ui-terminal-rows.test.mjs"
          name: "completed compaction rows expose persisted segment statistics and Markdown"
        - path: "test/chat-ui-compaction-card.test.mjs"
          name: "completed compaction card renders segment metrics and Markdown disclosure"
        - path: "test/chat-ui-compaction-card.test.mjs"
          name: "Terminal topbar exposes compaction count navigation"
      public: ["PiboCompactionEndEvent.compactionStats", "TerminalCompactionCard", "CompactTerminalSessionView"]
      failures: ["Failed or aborted compactions do not reset the statistics boundary; unavailable token metrics render as an explicit dash rather than zero."]
      confidence: "high"
    - id: "WEB-TRACE-VISIBILITY-008"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"
          symbol: "CompactTerminalSessionView"
        - path: "src/apps/chat-ui/src/components/useStickyVirtuoso.ts"
          symbol: "useStickyVirtuoso"
      tests:
        - path: "test/chat-ui-terminal-initial-visibility.test.mjs"
          name: "Terminal reveals correctly positioned histories without a fixed hidden interval"
        - path: "test/use-sticky-virtuoso.test.mjs"
          name: "useStickyVirtuoso uses one bottom target without a competing last-index scroll"
      public: ["CompactTerminalSessionView"]
      failures: ["Missing data still loads normally; mounted hidden text is not visible readiness. Separate late viewport shrink remains tracked in issue 928."]
      confidence: "high"
    - id: "WEB-TRACE-PASSIVE-007"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/session-trace-pane.tsx"
          symbol: "SessionTracePane"
        - path: "src/apps/chat-ui/src/api-chat-sessions.ts"
          symbol: "getSessionStatus"
        - path: "src/apps/chat/web-app.ts"
          symbol: "createChatWebApp"
        - path: "src/core/session-router.ts"
          symbol: "getSessionStatusSnapshot"
      tests:
        - path: "test/cold-fork-candidates.test.mjs"
          name: "passive header status does not activate or retain idle runtimes"
        - path: "test/chat-ui-terminal-header-usage.test.mjs"
          name: "Terminal header status is passive and refreshes on session state transitions"
        - path: "test/web-channel.test.mjs"
          name: "chat web status refresh returns a snapshot without emitting a new execution result"
      public: ["GET /api/chat/status?activate=false", "Terminal header usage", "Terminal fork affordances"]
      failures: ["Inactive runtime usage remains unknown rather than synthesized; authentication and session access checks are unchanged."]
      confidence: "high"
    - id: "WEB-TRACE-DEBUG-006"
      status: "implemented"
      sources:
        - path: "src/shared/tool-call-metrics.ts"
          symbol: "ToolCallMetricsCollector"
        - path: "src/shared/tool-call-token-settings.ts"
          symbol: "sanitizeToolMetricTokenCalculation"
        - path: "src/shared/debug-features.ts"
          symbol: "DEFAULT_DEBUG_FEATURE_SETTINGS"
        - path: "src/shared/model-inference-metrics.ts"
          symbol: "modelInferenceUncachedInputTokens"
        - path: "src/shared/trace-event-projection.ts"
          symbol: "applySingleEventToNodes"
        - path: "src/core/user-settings.ts"
          symbol: "PiboUserSettings"
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "RuntimeRoutedSession"
        - path: "src/data/ingest-service.ts"
          symbol: "ChatDataIngestService"
        - path: "src/apps/chat-ui/src/session-trace-header.tsx"
          symbol: "SessionTraceHeader"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalToolMetrics.tsx"
          symbol: "TerminalToolMetrics"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalModelInferenceMetrics.tsx"
          symbol: "TerminalModelInferenceMetrics"
        - path: "src/apps/chat-ui/src/tool-metric-settings.ts"
          symbol: "readStoredToolMetricThresholds"
        - path: "src/apps/chat-ui/src/settings/DebugSettingsView.tsx"
          symbol: "DebugSettingsView"
      tests:
        - path: "test/tool-call-metrics.test.mjs"
          name: "durable ingestion retains metrics outside large payloads through restart and timeline compaction"
        - path: "test/tool-call-metrics.test.mjs"
          name: "metrics survive persistence serialization, live frames, patches and all display modes"
        - path: "test/chat-ui-session-view-toggle-accessibility.test.mjs"
          name: "topbar exposes Debug without duplicate view navigation or Raw Events"
        - path: "test/tool-call-metrics.test.mjs"
          name: "status strip renders estimated tokens, zero, missing values and subsecond duration"
        - path: "test/tool-call-metrics.test.mjs"
          name: "character and Tiktoken calculations are selectable, lazy, bounded and honest about unavailable payloads"
        - path: "test/chat-ui-debug-settings.test.mjs"
          name: "Debug settings persist validated thresholds and expose the Debug route"
        - path: "test/model-inference-metrics.test.mjs"
          name: "provider usage becomes a durable per-inference trace node across replay, patches, live frames and timeline compaction"
        - path: "test/model-inference-metrics.test.mjs"
          name: "model and Tool diagnostics can be enabled independently under the global Debug mode"
        - path: "test/model-inference-metrics.test.mjs"
          name: "inference metrics distinguish total input, cache hits, fresh input and output"
        - path: "test/base-prompt-web.test.mjs"
          name: "chat user-settings API validates same-origin mutations and persists sanitized values"
      public: ["SessionTraceHeader", "CompactTerminalSessionView", "TerminalModelInferenceMetrics", "/settings/debug", "pibo.chat.debugFeatures", "pibo.chat.toolMetricThresholds", "PiboAssistantUsageEvent", "PiboUserSettings.toolMetrics.tokenCalculation", "PiboToolExecutionFinishedEvent.toolMetrics"]
      failures: ["Missing provider usage remains unavailable rather than estimated; usage attaches only to the latest related Tool, reasoning, assistant-message, or turn node; malformed or duplicate records cannot create extra pagination rows; missing, media, cyclic, over-budget, or oversized Tiktoken Tool payload metrics remain unavailable; Tool calculations are never presented as provider usage or billing; Debug features and thresholds are browser-local, calculation preferences persist in app user settings, and invalid values fall back to defaults."]
      confidence: "high"
    - id: "WEB-TRACE-PROJECTION-001"
      status: "implemented"
      sources:
        - path: "src/shared/trace-engine.ts"
          symbol: "buildTraceViewFromEvents"
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "traceTimelinePageFromView"
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "traceRawEventsPageFromEvents"
      tests:
        - path: "test/chat-trace-materialization.test.mjs"
          name: "trace engine omits raw events by default"
        - path: "test/chat-trace-materialization.test.mjs"
          name: "exact identity and unique bounded endpoint evidence remain authoritative"
      public:
        - "/api/chat/trace*"
        - "SessionTracePane"
        - "CompactTerminalSessionView"
        - "TraceTimeline"
        - "WorkflowXStateSessionView"
        - "listChatSessionViews"
      failures:
        - "Malformed or ambiguous identity must fail closed rather than merge unrelated turns."
        - "Accessibility/responsive boundary: Stable card IDs/order metadata support inspection but do not substitute for assistive-technology testing."
        - "Compatibility boundary: Legacy/current event variants map to one stable product identity."
      confidence: "high"
    - id: "WEB-TRACE-DETAIL-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "parseTracePayloadRef"
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "tracePayloadRefForStoredPayload"
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "readTracePayloadChunk"
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "readTraceImagePayload"
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "imageMimeTypeFromBytes"
        - path: "src/apps/chat-ui/src/tracing/RawEventsSidebar.tsx"
          symbol: "RawEventsSidebar"
      tests:
        - path: "test/chat-trace-materialization.test.mjs"
          name: "raw event tail is opt-in and bounded"
      public:
        - "/api/chat/trace*"
        - "SessionTracePane"
        - "CompactTerminalSessionView"
        - "TraceTimeline"
        - "WorkflowXStateSessionView"
        - "listChatSessionViews"
      failures:
        - "Invalid refs, unsupported bytes, or bounds fail without exposing unrelated content; raw data is opt-in."
        - "Accessibility/responsive boundary: Collapsed details need names, states, focus, and bounded text alternatives."
        - "Compatibility boundary: Stored payload schema/durability remains SPC-DATA-001."
      confidence: "high"
    - id: "WEB-TRACE-MERGE-003"
      status: "implemented"
      sources:
        - path: "src/shared/trace-page-merge.ts"
          symbol: "mergeOlderTracePage"
        - path: "src/shared/trace-page-merge.ts"
          symbol: "mergeRefreshedTracePage"
        - path: "src/shared/trace-live-reducer.ts"
          symbol: "applyTraceLiveEvents"
        - path: "src/shared/trace-event-projection.ts"
          symbol: "markIncompletePersistedTurns"
      tests:
        - path: "test/trace-page-merge.test.mjs"
          name: "mergeOlderTracePage dedupes overlapping nested timeline nodes"
        - path: "test/trace-page-merge.test.mjs"
          name: "mergeRefreshedTracePage preserves the loaded history window while refreshing the tail"
        - path: "test/trace-page-merge.test.mjs"
          name: "mergeRefreshedTracePage retains a same-entry transcript part split from the refreshed tail"
        - path: "test/trace-page-merge.test.mjs"
          name: "mergeRefreshedTracePage replaces stale tail nodes without dropping loaded history"
        - path: "test/trace-page-merge.test.mjs"
          name: "mergeRefreshedTracePage drops event turn scaffolds superseded by transcript content"
        - path: "test/trace-page-merge.test.mjs"
          name: "mergeRefreshedTracePage refreshes the raw-event tail without dropping loaded history"
        - path: "test/trace-page-merge.test.mjs"
          name: "mergeOlderTracePage carries string cursors across transcript continuation pages"
        - path: "test/chat-ui-integration.test.mjs"
          name: "idle persisted turns without a terminal project an explicit incomplete error"
        - path: "test/stream-render-block-review.test.mjs"
          name: "mixed render-sequence ordering is transitive and permutation invariant"
      public:
        - "/api/chat/trace*"
        - "SessionTracePane"
        - "CompactTerminalSessionView"
        - "TraceTimeline"
        - "WorkflowXStateSessionView"
        - "listChatSessionViews"
      failures:
        - "Conflicting identities cannot be silently coalesced; canonical refreshed tails replace stale data only at the defined boundary."
        - "Accessibility/responsive boundary: Merged rows must preserve semantic order and reading position."
        - "Compatibility boundary: String cursors and split messages are explicit compatibility cases."
      confidence: "high"
    - id: "WEB-TRACE-SCROLL-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/components/stickyVirtuosoState.ts"
          symbol: "stickyScrollIntentDirection"
        - path: "src/apps/chat-ui/src/components/stickyVirtuosoState.ts"
          symbol: "shouldReattachStickyAtBottom"
        - path: "src/apps/chat-ui/src/components/stickyVirtuosoState.ts"
          symbol: "prependedItemCount"
        - path: "src/apps/chat-ui/src/components/stickyVirtuosoState.ts"
          symbol: "captureStickyVisibleAnchors"
        - path: "src/apps/chat-ui/src/components/stickyVirtuosoState.ts"
          symbol: "stickyAnchorLocation"
        - path: "src/apps/chat-ui/src/components/useStickyVirtuoso.ts"
          symbol: "useStickyVirtuoso"
        - path: "src/apps/chat-ui/src/tracing/TraceTimeline.tsx"
          symbol: "TraceTimeline"
      tests:
        - path: "test/sticky-virtuoso-state.test.mjs"
          name: "sticky Virtuoso state handles intent, prepend, and anchor transactions"
        - path: "test/use-sticky-virtuoso.test.mjs"
          name: "useStickyVirtuoso uses one bottom target without a competing last-index scroll"
        - path: "test/use-sticky-virtuoso.test.mjs"
          name: "useStickyVirtuoso no longer applies blind scrollHeight growth compensation"
        - path: "test/chat-ui-raw-events-responsive.test.mjs"
          name: "Raw Events stays reachable as a labelled inspector at narrow widths"
      public:
        - "/api/chat/trace*"
        - "SessionTracePane"
        - "CompactTerminalSessionView"
        - "TraceTimeline"
        - "WorkflowXStateSessionView"
        - "listChatSessionViews"
      failures:
        - "Failed/preempted pagination must not jump to an unrelated anchor or trap the reader at bottom."
        - "Accessibility/responsive boundary: This is interaction/visual behavior and remains unverified until headful evidence runs."
        - "Compatibility boundary: Virtualizer upgrades require anchor and measurement regression checks."
      confidence: "medium"
    - id: "WEB-TRACE-WORKFLOW-005"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/session-views/registry.tsx"
          symbol: "inactiveChatSessionViews"
        - path: "src/apps/chat-ui/src/session-views/registry.tsx"
          symbol: "listChatSessionViews"
        - path: "src/apps/chat-ui/src/session-views/registry.tsx"
          symbol: "getChatSessionView"
        - path: "src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx"
          symbol: "WorkflowXStateSessionView"
        - path: "packages/workflows/src/xstate/index.ts"
          symbol: "createWorkflowXStateUiModel"
        - path: "packages/workflows/src/xstate/index.ts"
          symbol: "WORKFLOW_XSTATE_UI_MODEL_KIND"
      tests:
        - path: "packages/workflows/src/testing/xstate-ui-model.test.ts"
          name: "exposes a compact Web UI model from the XState machine projection"
        - path: "packages/workflows/src/testing/xstate-ui-model.test.ts"
          name: "marks current wait, terminal, and retry-delay states from kernel snapshots or explicit active state ids"
        - path: "test/workflow-session-header.test.mjs"
          name: "Workflow headers report canonical run state independently of ordinary Session activity"
        - path: "test/workflow-v2-session-run-checklist.test.mjs"
          name: "Workflow view renders canonical run inspection facts and immutable links"
      public:
        - "/api/chat/trace*"
        - "SessionTracePane"
        - "CompactTerminalSessionView"
        - "TraceTimeline"
        - "WorkflowXStateSessionView"
        - "listChatSessionViews"
      failures:
        - "Unknown view IDs or malformed snapshots fall back without granting edits or exposing private payloads."
        - "Accessibility/responsive boundary: Workflow states need textual names/status, not color-only meaning."
        - "Compatibility boundary: Kernel remains durable truth; registry additions are read-only Web compatibility extensions."
      confidence: "high"
---
# Chat Web Trace, Terminal, Scrolling, and Workflow Projection

## Why

Bounded trace projection, opt-in payload/raw detail, deterministic historical/live merge, sticky virtualized scrolling, and read-only workflow projection views.

## Scope

This specification describes implemented behavior at traceability commit `6080be5c64205342091733bedde9596a6f9f6465`. Earlier Workflow evidence remains scoped to its recorded integration baseline.

### In scope

- Owns Web trace/Terminal projection, detail fetch/display, virtualized scroll interaction, render-order diagnostics anchors, and read-only workflow views.

### Out of scope

- SPC-DATA-001 owns durable events/pages/payload storage.
- SPC-RUN-007 owns native transcript/history semantics.
- SPC-OP-003 owns renderer-neutral terminal semantics.
- SPC-ORCH-005 owns workflow IR, execution, state, and recovery.
- SPC-OP-002 owns debug CLI/scenario tooling; this spec owns only source-defined render anchors.

## Current behavior

### Routes and state

Summary/timeline are bounded by default; raw event tail and payload chunks/images are explicit opt-in routes. View selection uses a read-only registry. Terminal, Workflow, Preview, and Raw Events remain available through workspace tabs; their duplicate topbar controls are removed. The topbar instead exposes Debug beside Thinking.

### Cache, stream, files, and media

Historical pages and SPC-WEB-004 live overlays merge by stable identities and a transitive chronology across durable event/stream sequence and render sequence without rewriting prior facts. Idle persisted turns missing a terminal project an explicit incomplete integrity marker; active and terminal turns do not. Payload/image retrieval is bounded and delegated to safe rendering.

### Lifecycle and failure

Pagination preserves reading anchors, uses one bottom target, and avoids blind scroll-height compensation; refresh replaces stale tails without losing older loaded windows. Raw Events remains a labelled inspector at narrow widths. Malformed identity/payload refs fail closed. Workflow views use stored Session-linked snapshots and Runs without fabricating progress or becoming execution truth. A persisted `pending` configured start continues to show its general-execution boundary after reload. A completed manual editor Run projects canonical attempts, transfers, immutable executable definition snapshot, and output independently of ordinary Session activity.

### Security

Private payloads/raw events are not default UI data. Diagnostic reports omit content fingerprints/operator identifiers; image/payload access uses exact refs.

### Accessibility and responsive behavior

Trace cards expose stable IDs/order metadata; sticky scrolling tracks user intent. The Raw Events inspector remains reachable at narrow widths. Keyboard, screen-reader, and visual behavior need headful checks.

### Compatibility and integration

Legacy/current runtime turns use stable product identity; workflow UI models accept kernel/XState/UI snapshots while durable truth remains kernel.

## Requirements and invariants

### Requirement: WEB-TRACE-VIEWPORT-009

The element-backed Terminal viewport and its rendered item list share resize observation. While following the bottom, an external header or composer geometry change must retain bottom-follow after layout settlement even when item-list height is unchanged. While detached, viewport-only resize must not replay a stored anchor over native wheel movement; list changes retain the existing content-anchor restoration path.

Coarse wheel input owns the resulting reading position. After its direct scroll, the hook captures the new visible target and refreshes pending prepend/restoration anchors when present. A later mutation or prepend must not restore an obsolete pre-wheel target. The observer disconnects with its owning effect; no CSS visibility override, vendor patch, polling timer, or history-format change is introduced.

The [viewport and wheel validation report](/reports/terminal-viewport-and-wheel-validation-2026-09-06.md) records Docker before/after and exact-candidate public Pibo2 evidence: natural header shrink, real Spark streaming, detached desktop/mobile input, reload, and in-flight older-page restoration. Resize settlement is not guaranteed in the same RAF sample. These focused checks do not replace full-suite or integrated-release acceptance; existing historical validation counts below retain their original scope.

### Requirement: WEB-TRACE-COMPACTION-010

Each successful Compaction Terminal row MUST replace the minimal completed line with a compact structured component. The component shows the number of completed Tool calls since Session creation or the previous successful compaction, the highest recorded Tool-result payload token count in that segment, and the compaction token count reported by the runtime result. Character-derived Tool counts retain `≈`; exact Tiktoken counts do not. Missing metrics render `—`, not zero.

The durable ingest boundary computes the segment snapshot from persisted `tool_execution_finished` events before writing `compaction_end`. A successful prior `compaction_end` starts the next segment. Failed or aborted compactions neither receive a completed snapshot nor reset that boundary. The Compaction's `tokensBefore` value is projected as the compaction token count when the runtime provides it; adapters that do not report this value remain explicitly unavailable.

The component includes an accessible `details` disclosure named `Compaction text`. It renders the runtime's summary as Markdown. Inline summaries render immediately; externalized output payloads load only when the disclosure opens. Missing or unreadable summaries show a bounded unavailable state without exposing unrelated payloads.

The Compact Terminal status bar shows a cyan Compaction count and icon whenever Compaction rows are present. Activating it uses the same previous-item cycling, scroll, focus, and `aria-current` behavior as User Message and error navigation.

Focused verification passed the durable ingest, event validation, trace-row projection, component-rendering, and topbar-navigation tests. Headful Docker browser validation passed at 1440×900 and 390×844: the three metric segments wrapped without horizontal overflow, the Markdown disclosure opened, and Compaction navigation focused the row. These local deterministic fixtures do not claim provider parity for adapters that omit summary or token fields.

### Requirement: WEB-TRACE-DEBUG-006

Debug MUST default off and expose a stable accessible toggle name and pressed state beside Thinking on desktop and mobile. Chat Web persists the global preference locally and ignores the former Raw Events topbar preference. `Settings > Debug` MUST persist independent Tool-call and model-inference metric selections; both feature selections default enabled, remain saved while global Debug is off, and cannot render diagnostics unless global Debug is on. Debug MUST NOT open the Raw Events inspector or initiate raw-event/payload fetches.

When global Debug and Tool-call metrics are enabled, Terminal MUST show a compact monospaced status line below each tool invocation: execution time, argument payload tokens, result payload tokens, and the calculation basis used for that invocation. Output is visually emphasized. The calculation segment displays `chars ÷ <factor>`, `tiktoken · <encoding>`, or `—`. The line is independent of expanded details and works in Default and Slim. Intent uses the same metadata when the existing capability gate permits an intent row; this change does not enable unsupported Intent mode. Hide continues to hide tool rows. Tool-call metrics ungroup exploration/image tools so each invocation retains its own metrics. Disabling Tool-call metrics or global Debug restores normal grouping and removes Tool status lines without changing the model-inference selection.

When global Debug and model-inference metrics are enabled, each normalized provider-response `assistant_usage` record MUST remain durable through stored replay, live updates, patching, and compact Timeline V2 projection. Projection attaches the record to the latest related Tool, reasoning, assistant-message, delegation, or turn node instead of creating a separate trace row. Terminal renders one flat `MODEL` rail below that owner with `IN`, `CACHED`, `UNCACHED`, and `OUT`. `IN` is total provider-reported model input, including cached input when total and output are available; `CACHED` is cache-read plus cache-write input; `UNCACHED` is non-negative `IN - CACHED`; and `OUT` is provider-reported output. Missing usage stays unavailable rather than estimated. Runtime adapters own normalization, including OpenAI-compatible endpoints; the browser performs no provider call, tokenization, or billing attribution.

The runtime collector measures start-to-finish elapsed time with a monotonic clock. At Tool start it captures the active calculation configuration and stores only that configuration, start time, and input count for the active call. It uses the same captured configuration for the result even if settings change while the Tool runs. It measures output once on completion, including failed calls, then releases the entry; turn cleanup clears abandoned entries. Finished-event metadata persists the method-specific basis separately from large payloads and survives live frames, stored-history replay, timeline compaction, and row projection. Legacy `chars/4` metrics remain readable as character-factor metrics.

Character mode uses the existing bounded structural traversal and divides its character count by a validated factor from 1 through 1,000, default `4`. Character-derived values MUST carry `≈` because they estimate tokens from JavaScript UTF-16 string lengths and lightweight structural overhead. Structural traversal has a 10,000-visit budget and a depth limit of 64; large strings use their length without scanning or copying them.

Tiktoken mode supports `o200k_base`, `cl100k_base`, `p50k_base`, `r50k_base`, `p50k_edit`, and `gpt2`. It lazily loads Tiktoken and its WASM tokenizer only after selection, serializes a measurable payload, and calls the selected encoding once at Tool start and once at Tool finish. Tiktoken mode rejects payloads above 4,000,000 measured or serialized characters before encoding; its counts do not carry `≈`, but they still describe the isolated serialized Tool payload rather than the provider's full request. Switching encodings frees the cached tokenizer before loading the next one.

Both modes exclude result-envelope metadata when a harness supplies `content`. Neither performs an extra provider request nor attributes model-response usage, billable tokens, or Tool-internal model usage. Missing starts, metrics without basis metadata, media, cyclic, over-depth, over-budget, or oversized Tiktoken payloads use `—` for unavailable values rather than zero. The browser formats already-recorded numbers and basis metadata; it does not measure or tokenize payloads while rendering or scrolling.

Debug rails follow the [Compact Terminal design](/project/design/compact-terminal.md): square geometry, 9px black-weight labels, 11px bold tabular values, no cards, shadows, polling, animation, or per-row timers. They wrap whole metric segments at narrow widths instead of truncating values or basis labels. Debug in the embedded VS Code Terminal is session-local.

Tool Debug is a high-contrast signal rail. Normal time uses neon violet, normal input uses electric cyan, normal output uses acid lime, and calculation basis uses cyan metadata so the four columns remain distinguishable from ordinary Terminal prose. Elevated values use neon yellow/amber, high values use fluorescent orange, critical values use hot pink, and unavailable values remain neutral gray. Model inference uses cyan for `MODEL` and `IN`, violet for `CACHED`, yellow for `UNCACHED`, and acid lime for `OUT`. Color supplements the visible number, basis, label, and `—` state; it is not the sole information channel.

`Settings > Debug` exposes the persisted global Debug toggle, independent Tool-call and model-inference metric toggles, and three strictly increasing visual thresholds for each Tool metric. Defaults are 1/5/15 seconds for duration, 8k/20k/50k input tokens, and 2k/10k/50k output tokens. Threshold values are validated as positive numbers, stored in browser-local storage, and applied immediately to Terminal rendering. Restoring defaults does not change collected metrics or either feature selection.

The same panel selects future Tool-call calculation independently: character count with a configurable factor or Tiktoken with a supported encoding. The calculation is sanitized and persisted in app user settings. Character mode is the default and keeps factor `4`; Tiktoken selection is explicit because its serialization, text scan, WASM tokenizer, CPU, and memory costs are higher. The panel states that both methods are payload diagnostics rather than provider usage or billing attribution.

Verification for this addition: isolated build and all typechecks passed; 192 focused runtime/trace tests and a separate 296-test UI/metrics run passed (the selections overlap). Browser Use with headful Chromium and CDP passed Default/Slim at 1440×1000 and 390×844, toggle/reload/Hide checks, legacy/media placeholders, Raw Events workspace-tab access, keyboard Space activation, and absence of horizontal overflow or JavaScript exceptions. Enabling Debug caused no raw-event or payload fetch. The browser used deterministic persisted tool-event fixtures; a provider-backed Worker turn failed at authentication, so provider end-to-end and production deployment are not claimed.

Verification for the selectable-calculation refinement: the full build and all package typechecks passed. The focused calculation/API/UI suite passed 11 tests, and the wider Chat UI, metrics, API, and routed-runtime selection passed 327 tests with 322 passed, 0 failed, and 5 skipped. Headful desktop checks saved and reloaded Tiktoken with `p50k_edit`; runtime collection then persisted `tiktoken/p50k_edit`. Headful/CDP checks at desktop and 390×844 rendered character factors, Tiktoken encodings, and legacy `—` bases without rail or document overflow or JavaScript exceptions. These deterministic fixtures and local runtime checks do not claim provider billing parity or production deployment.

Verification for model-inference diagnostics on September 8, 2026: the isolated Docker worker completed the full build, all package typechecks, and 41 focused Debug, inference-usage, Tool-metric, Pi tracing, Goal-accounting, and shared Terminal tests. A headful authenticated Chat Web target at 800×457 persisted global on, Tool metrics off, and model metrics on; reload preserved those selections. The deterministic persisted provider-usage fixture rendered `IN 94,173`, `CACHED 91,776`, `UNCACHED 2,397`, and `OUT 300` below its assistant response. Turning off model metrics hid that rail while global Debug stayed on; turning off global Debug hid it while the model selection stayed enabled. CDP reload observed the final rail with zero console errors, exceptions, log errors, or network failures. The fixture validates projection and rendering, not a live provider request, billing parity, production deployment, or wider desktop/mobile acceptance.

### Requirement: WEB-TRACE-PROJECTION-001

Trace summary/timeline projection MUST be bounded, deterministic, omit raw events by default, and preserve stable product identity across supported legacy, current, and Terminal projections.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/shared/trace-engine.ts` — `buildTraceViewFromEvents`; `src/apps/chat/trace-v2.ts` — `traceTimelinePageFromView`; `src/apps/chat/trace-v2.ts` — `traceRawEventsPageFromEvents`
- Tests: `test/chat-trace-materialization.test.mjs` — “trace engine omits raw events by default”; `test/chat-trace-materialization.test.mjs` — “exact identity and unique bounded endpoint evidence remain authoritative”
- Public surfaces: `/api/chat/trace*`; `SessionTracePane`; `CompactTerminalSessionView`; `TraceTimeline`; `WorkflowXStateSessionView`; `listChatSessionViews`
- Failure/security boundary: Malformed or ambiguous identity must fail closed rather than merge unrelated turns.
- Accessibility/responsive boundary: Stable card IDs/order metadata support inspection but do not substitute for assistive-technology testing.
- Compatibility boundary: Legacy/current event variants map to one stable product identity.
- Confidence: **high**
- Verification follow-up: Run trace materialization and render-order tests with legacy/current fixtures and large bounded pages.

### Requirement: WEB-TRACE-DETAIL-002

Raw event tails, payload chunks, and trace images MUST be explicit, bounded, exact-reference requests with accessible collapsed/default fallbacks.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/trace-v2.ts` — `parseTracePayloadRef`; `src/apps/chat/trace-v2.ts` — `tracePayloadRefForStoredPayload`; `src/apps/chat/trace-v2.ts` — `readTracePayloadChunk`; `src/apps/chat/trace-v2.ts` — `readTraceImagePayload`; `src/apps/chat/trace-v2.ts` — `imageMimeTypeFromBytes`; `src/apps/chat-ui/src/tracing/RawEventsSidebar.tsx` — `RawEventsSidebar`
- Tests: `test/chat-trace-materialization.test.mjs` — “raw event tail is opt-in and bounded”
- Public surfaces: `/api/chat/trace*`; `SessionTracePane`; `CompactTerminalSessionView`; `TraceTimeline`; `WorkflowXStateSessionView`; `listChatSessionViews`
- Failure/security boundary: Invalid refs, unsupported bytes, or bounds fail without exposing unrelated content; raw data is opt-in.
- Accessibility/responsive boundary: Collapsed details need names, states, focus, and bounded text alternatives.
- Compatibility boundary: Stored payload schema/durability remains SPC-DATA-001.
- Confidence: **high**
- Verification follow-up: Run trace/payload and safe-rendering suites; add invalid/truncated payload-ref and keyboard disclosure cases.

### Requirement: WEB-TRACE-MERGE-003

Refreshing or prepending trace pages MUST merge overlapping nodes, preserve loaded history and split parts, replace stale tails, and combine live overlays without rewriting confirmed historical identities.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/shared/trace-page-merge.ts` — `mergeOlderTracePage`; `src/shared/trace-page-merge.ts` — `mergeRefreshedTracePage`; `src/shared/trace-live-reducer.ts` — `applyTraceLiveEvents`
- Tests: `test/trace-page-merge.test.mjs` — “mergeOlderTracePage dedupes overlapping nested timeline nodes”; `test/trace-page-merge.test.mjs` — “mergeRefreshedTracePage preserves the loaded history window while refreshing the tail”; `test/trace-page-merge.test.mjs` — “mergeRefreshedTracePage retains a same-entry transcript part split from the refreshed tail”; `test/trace-page-merge.test.mjs` — “mergeRefreshedTracePage replaces stale tail nodes without dropping loaded history”; `test/trace-page-merge.test.mjs` — “mergeRefreshedTracePage drops event turn scaffolds superseded by transcript content”; `test/trace-page-merge.test.mjs` — “mergeRefreshedTracePage refreshes the raw-event tail without dropping loaded history”; `test/trace-page-merge.test.mjs` — “mergeOlderTracePage carries string cursors across transcript continuation pages”
- Public surfaces: `/api/chat/trace*`; `SessionTracePane`; `CompactTerminalSessionView`; `TraceTimeline`; `WorkflowXStateSessionView`; `listChatSessionViews`
- Failure/security boundary: Conflicting identities cannot be silently coalesced; canonical refreshed tails replace stale data only at the defined boundary.
- Accessibility/responsive boundary: Merged rows must preserve semantic order and reading position.
- Compatibility boundary: String cursors and split messages are explicit compatibility cases.
- Confidence: **high**
- Verification follow-up: Execute merge/overlay suites and add interleaved pagination plus reconnect fixtures.

### Requirement: WEB-TRACE-SCROLL-004

Virtualized trace scrolling MUST distinguish user intent from append/prepend transactions, preserve visible anchors when older pages load, and reattach to bottom only under defined sticky conditions.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/components/stickyVirtuosoState.ts` — `stickyScrollIntentDirection`; `src/apps/chat-ui/src/components/stickyVirtuosoState.ts` — `shouldReattachStickyAtBottom`; `src/apps/chat-ui/src/components/stickyVirtuosoState.ts` — `prependedItemCount`; `src/apps/chat-ui/src/components/stickyVirtuosoState.ts` — `captureStickyVisibleAnchors`; `src/apps/chat-ui/src/components/stickyVirtuosoState.ts` — `stickyAnchorLocation`; `src/apps/chat-ui/src/components/useStickyVirtuoso.ts` — `useStickyVirtuoso`; `src/apps/chat-ui/src/tracing/TraceTimeline.tsx` — `TraceTimeline`
- Tests: `test/sticky-virtuoso-state.test.mjs` — “sticky Virtuoso state handles intent, prepend, and anchor transactions”
- Public surfaces: `/api/chat/trace*`; `SessionTracePane`; `CompactTerminalSessionView`; `TraceTimeline`; `WorkflowXStateSessionView`; `listChatSessionViews`
- Failure/security boundary: Failed/preempted pagination must not jump to an unrelated anchor or trap the reader at bottom.
- Accessibility/responsive boundary: This is interaction/visual behavior and remains unverified until headful evidence runs.
- Compatibility boundary: Virtualizer upgrades require anchor and measurement regression checks.
- Confidence: **medium**
- Verification follow-up: Run sticky-state tests, then headfully validate mouse, touch, keyboard, zoom, resize, rapid append, and edge pagination.

### Requirement: WEB-TRACE-WORKFLOW-005

The normal Session view registry MAY expose Workflow inspection and XState projections, but MUST identify Workflow-linked Session kinds and MUST keep workflow IR, private payloads, execution, and durable state under their orchestration owners. A pending configured Run MUST retain its explicit execution-boundary explanation after reload, and completed state MUST derive from canonical Workflow inspection rather than ordinary Session activity.

#### Current

Integrated source, focused tests, and scoped headful acceptance verify pending and completed inspection projections without making the browser execution authority.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/session-views/registry.tsx` — `inactiveChatSessionViews`; `src/apps/chat-ui/src/session-views/registry.tsx` — `listChatSessionViews`; `src/apps/chat-ui/src/session-views/registry.tsx` — `getChatSessionView`; `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` — `WorkflowXStateSessionView`; `packages/workflows/src/xstate/index.ts` — `createWorkflowXStateUiModel`; `packages/workflows/src/xstate/index.ts` — `WORKFLOW_XSTATE_UI_MODEL_KIND`
- Tests: `packages/workflows/src/testing/xstate-ui-model.test.ts` — “exposes a compact Web UI model from the XState machine projection”; `packages/workflows/src/testing/xstate-ui-model.test.ts` — “marks current wait, terminal, and retry-delay states from kernel snapshots or explicit active state ids”; `test/workflow-session-header.test.mjs` — “Workflow headers report canonical run state independently of ordinary Session activity”; `test/workflow-v2-session-run-checklist.test.mjs` — “Workflow view renders canonical run inspection facts and immutable links”
- Public surfaces: `/api/chat/trace*`; `SessionTracePane`; `CompactTerminalSessionView`; `TraceTimeline`; `WorkflowXStateSessionView`; `listChatSessionViews`
- Failure/security boundary: Unknown view IDs or malformed snapshots fall back without granting edits or exposing private payloads.
- Accessibility/responsive boundary: Workflow states need textual names/status, not color-only meaning.
- Compatibility boundary: Kernel remains durable truth; registry additions are read-only Web compatibility extensions.
- Confidence: **high**
- Verification follow-up: Headfully inspect waiting, retry, failed, malformed, and human-action states.

### Requirement: WEB-TRACE-VISIBILITY-008: Single initial positioning owner

Terminal initialization uses the sticky-scroll controller's bottom or saved reading position without an independent initial-index scroll-settlement delay. It does not force CSS visibility or replace settlement with an arbitrary timer. Missing history still waits for its data.

Acceptance measures the correct Session's viewport-intersecting visible rows, not merely route selection, mounted DOM, or textContent. The opt-in headful worker regression covers short and long completed histories at desktop/mobile widths; [exact-candidate Pibo2 evidence](/reports/terminal-initial-visibility-validation-2026-09-05.md) also covers the 16,005-event history, wheel detachment and reload anchors, actual Spark streaming, and Queue contention. This is scoped initial-visibility evidence, not a new execution claim for every historical requirement in this specification. A pre-existing mobile viewport-shrink gap remains tracked separately in issue 928.

### Requirement: WEB-TRACE-PASSIVE-007

Terminal background usage reads SHALL request passive status. `GET /api/chat/status?activate=false` SHALL retain authentication and session access checks, but SHALL neither activate an absent runtime nor extend an idle runtime's eviction timer. When no runtime is present, it SHALL return `{ piboSessionId, runtimeActive: false }`; usage values SHALL remain unavailable. A present runtime SHALL supply its live snapshot. Explicit status requests without this option, including `/status`, SHALL retain their activation behavior.

The header query SHALL refresh on selected Session status transitions as well as its normal polling cadence. The Terminal SHALL defer fork-candidate requests until the loaded trace contains user messages, so opening an empty Session does not start a runtime merely to discover that no fork is available. Persisted fork inspection belongs to [the adapter contract](/specs/runtime/adapter-contract.md).

[Docker tests and headful Pibo2 validation](/reports/idle-session-history-latency-validation-2026-09-05.md) cover passive navigation, exact candidate parity, and real queued turns. This evidence does not claim that all streaming or optimistic-update problems are resolved.

## Interfaces and ownership

**Capability IDs:** pibo.chat-web.trace

**Public surfaces:**

- /api/chat/trace*
- SessionTracePane
- CompactTerminalSessionView
- TraceTimeline
- WorkflowXStateSessionView
- listChatSessionViews

**Non-owned links:**

- SPC-DATA-001 owns durable events/pages/payload storage.
- SPC-RUN-007 owns native transcript/history semantics.
- SPC-OP-003 owns renderer-neutral terminal semantics.
- SPC-ORCH-005 owns workflow IR, execution, state, and recovery.
- SPC-OP-002 owns debug CLI/scenario tooling; this spec owns only source-defined render anchors.

## Failure and security behavior

- Pagination preserves reading anchors; refresh replaces stale tails without losing older loaded windows; malformed identity/payload refs fail closed. Workflow views use stored Session-linked snapshots and Runs without fabricating progress or becoming execution truth; pending-state explanations and completed status survive reload because they derive from canonical inspection.
- Private payloads/raw events are not default UI data. Diagnostic reports omit content fingerprints/operator identifiers; image/payload access uses exact refs.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Trace cards expose stable IDs/order metadata; sticky scrolling tracks user intent. Raw sidebar hides below 980px in source. Keyboard, screen-reader, and visual behavior need headful checks.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Legacy/current runtime turns use stable product identity; workflow UI models accept kernel/XState/UI snapshots while durable truth remains kernel.

## Known limits

- Evidence gap: No headful virtual-scroll, prepend-anchor, raw-sidebar, fullscreen, or large-payload validation.
- Evidence gap: No general arbitrary-graph restart acceptance is claimed. Headful raw-IR editing, publish, human-action submission, and job controls remain unperformed.

## Reconciled stale claims

- Reject: Web trace owns durable history or native transcript semantics.
- Reject: Raw events/private payloads are shown by default.
- Reject: Live merge rewrites established historical facts.
- Reject: The XState Web projection is workflow execution truth.
- Reject: Debug screenshots/reports are specification authority.

## Verification and traceability

- Changed current source contracts and named test locators resolve at final integrated commit `7ec71c2cca2108423002be0e7330d2a20c4c5b67`.
- After final integration, source checks and all typechecks passed; the added manual editor API test passed alone, and the focused routed-runtime/UI/manual/header matrix passed 20 tests. The final-code complete root suite also passed; see the [validation report](/reports/session-native-workflow-transition-validation-2026-09-05.md).
- The earlier complete isolated root suite at `14cbaf0fd04cfa321674b570baeb40e543d957cb` reported 2,744 tests: 2,739 passed, 0 failed, 5 skipped, exit 0. All 144 Workflow package tests passed previously, and package source is unchanged.
- Headful acceptance reopened Run `wfr_ac3db39f-229f-4082-9485-4f6e6663a8b5` and ordinary agent Session `ps_04559a0b-fac4-4636-979a-addb1ff91fb0` with completed canonical inspection showing two node attempts, one edge transfer, immutable executable snapshot, and actual output. The Session Workflow view remained completed independently of ordinary Session activity. The pending-start explanation also persisted after reload.
- Desktop 1440x1000 and mobile 390x844 document widths matched their viewports. External gateway deployment, Pibo2, raw-IR editing, publish, human-action submission, and job-control acceptance are not claimed.

## Related concepts

- SPC-DATA-001
- SPC-RUN-007
- SPC-OP-003
- SPC-ORCH-005
- SPC-WEB-004
- SPC-WEB-006

## Requirement: WEB-TRACE-PAYLOAD-010 Complete large content with bounded rendering

Large assistant, reasoning, and tool content retains its stored reference through durable live output, historical SSE replay, client projection, and timeline reads. A small preview does not replace the reference to the full content.

Terminal rows with referenced content expose an explicit full-content reader. It displays one 4-KiB section at a time, with forward and backward navigation; a UTF-8 boundary may include up to three additional bytes. The reader retains section offsets rather than an ever-growing text buffer. The full content can also be downloaded through a streaming attachment response. Conversation-level lazy history paging and Infinite Scrolling remain independent of this single-content reader.

Chunk reads use bounded file ranges for identity payloads and streaming decompression for gzip payloads. Byte cursors preserve complete UTF-8 code points. The download pipeline closes its input on cancellation and does not build the complete response in application memory.
