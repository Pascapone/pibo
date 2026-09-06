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
  at: "2026-09-05T21:26:00Z"
sources:
  - id: "integrated-source-and-tests"
    resource: "scope:Integrated implementation and tests at traceability.commit"
    title: "Integrated trace and Workflow projection source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "7ec71c2cca2108423002be0e7330d2a20c4c5b67"
  package: "WP-06+07-WEB"
  source_evidence: "performed"
  test_execution: "one added API test and 20 focused routed-runtime/UI/manual/header tests passed at final integration; historical root-suite counts remain at 14cbaf0f"
  build_typecheck_package_execution: "source checks and all typechecks passed after final integration; earlier clean full build passed"
  browser_execution: "headed completed and pending Workflow projections, desktop/mobile fit, and supported manual editor inspection passed"
traceability:
  commit: "bfb31e40143ea149cf77917d787adaf477539f51"
  requirements:
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
        - path: "src/agent-runtime/routed-session.ts"
          symbol: "RuntimeRoutedSession"
        - path: "src/data/ingest-service.ts"
          symbol: "ChatDataIngestService"
        - path: "src/apps/chat-ui/src/session-trace-header.tsx"
          symbol: "SessionTraceHeader"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalToolMetrics.tsx"
          symbol: "TerminalToolMetrics"
      tests:
        - path: "test/tool-call-metrics.test.mjs"
          name: "durable ingestion retains metrics outside large payloads through restart and timeline compaction"
        - path: "test/tool-call-metrics.test.mjs"
          name: "metrics survive persistence serialization, live frames, patches and all display modes"
        - path: "test/chat-ui-session-view-toggle-accessibility.test.mjs"
          name: "topbar exposes Debug without duplicate view navigation or Raw Events"
      public: ["SessionTraceHeader", "CompactTerminalSessionView", "PiboToolExecutionFinishedEvent.toolMetrics"]
      failures: ["Missing or unmeasurable payload metrics remain unavailable; estimates are never presented as provider usage or billing."]
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

This specification describes implemented behavior at traceability commit `bfb31e40143ea149cf77917d787adaf477539f51`. Earlier Workflow evidence remains scoped to its recorded integration baseline.

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

### Requirement: WEB-TRACE-DEBUG-006

Debug MUST default off and expose a stable accessible toggle name and pressed state beside Thinking on desktop and mobile. Chat Web persists the preference locally and ignores the former Raw Events topbar preference. Debug MUST NOT open the Raw Events inspector or initiate raw-event/payload fetches.

When enabled, Terminal MUST show a compact monospaced status line below each tool invocation: execution time, estimated argument tokens, and estimated result tokens. Output is visually emphasized. The line is independent of expanded details and works in Default and Slim. Intent uses the same metadata when the existing capability gate permits an intent row; this change does not enable unsupported Intent mode. Hide continues to hide tool rows. Debug ungroups exploration/image tools so each invocation retains its own metrics. Disabling Debug restores normal grouping and removes the status lines.

The runtime collector measures start-to-finish elapsed time with a monotonic clock, keeping only start time and estimated input count for active calls. It measures output once on completion, including failed calls, then releases the entry; turn cleanup clears abandoned entries. Finished-event metadata persists separately from large payloads and survives live frames, stored-history replay, timeline compaction, and row projection.

Token values MUST carry `≈`: they estimate tool payload size at four characters per token, not model-response usage, billable tokens, or tool-internal model usage. Result-envelope metadata is excluded when a harness supplies `content`. No tokenizer, extra provider request, text scan, or serialized copy is introduced. Structural traversal has a 10,000-visit budget and a depth limit of 64; large strings use their length. Missing starts, legacy calls, media, cyclic or over-budget payloads use `—` for unavailable values rather than zero. The browser formats already-recorded numbers; it does not measure or tokenize payloads while rendering or scrolling.

The status line follows the [Compact Terminal design](/project/design/compact-terminal.md): quiet hairline separation, square geometry, 11px monospaced/tabular metadata, no cards, shadows, polling, or per-row timers. It wraps at narrow widths. Debug in the embedded VS Code Terminal is session-local.

Verification for this addition: isolated build and all typechecks passed; 192 focused runtime/trace tests and a separate 296-test UI/metrics run passed (the selections overlap). Browser Use with headful Chromium and CDP passed Default/Slim at 1440×1000 and 390×844, toggle/reload/Hide checks, legacy/media placeholders, Raw Events workspace-tab access, keyboard Space activation, and absence of horizontal overflow or JavaScript exceptions. Enabling Debug caused no raw-event or payload fetch. The browser used deterministic persisted tool-event fixtures; a provider-backed Worker turn failed at authentication, so provider end-to-end and production deployment are not claimed.

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
