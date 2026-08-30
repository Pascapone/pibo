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
  by: "openai/codex"
  at: "2026-08-30T12:56:45Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:Foundation 38bb6e57f118c1543e7263c68d27e5103d3b1262"
    title: "Foundation source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  package: "WP-06+07-WEB"
  package_parent: "ba3c2d6611ce8d234f887135af605837333bf751"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_typecheck_package_execution: "performed in owned Docker after authoring; see implementation report"
  visual_provider_gateway_pibo2_execution: "unperformed"
traceability:
  commit: "38bb6e57f118c1543e7263c68d27e5103d3b1262"
  requirements:
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
        - path: "test/workflow-session-kind.test.mjs"
          name: "project sidebar session nodes expose workflow session kind for real Pibo Sessions only"
        - path: "packages/workflows/src/testing/xstate-ui-model.test.ts"
          name: "exposes a compact Web UI model from the XState machine projection"
        - path: "packages/workflows/src/testing/xstate-ui-model.test.ts"
          name: "marks current wait, terminal, and retry-delay states from kernel snapshots or explicit active state ids"
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

This specification describes implemented behavior at Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

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

Summary/timeline are bounded by default; raw event tail and payload chunks/images are explicit opt-in routes. View selection uses a read-only registry.

### Cache, stream, files, and media

Historical pages and SPC-WEB-004 live overlays merge by stable identities without rewriting prior facts. Payload/image retrieval is bounded and delegated to safe rendering.

### Lifecycle and failure

Pagination preserves reading anchors; refresh replaces stale tails without losing older loaded windows; malformed identity/payload refs fail closed. Workflow views show current projections without becoming execution truth.

### Security

Private payloads/raw events are not default UI data. Diagnostic reports omit content fingerprints/operator identifiers; image/payload access uses exact refs.

### Accessibility and responsive behavior

Trace cards expose stable IDs/order metadata; sticky scrolling tracks user intent. Raw sidebar hides below 980px in source. Keyboard, screen-reader, and visual behavior need headful checks.

### Compatibility and integration

Legacy/current runtime turns use stable product identity; workflow UI models accept kernel/XState/UI snapshots while durable truth remains kernel.

## Requirements and invariants

### Requirement: WEB-TRACE-PROJECTION-001

Trace summary/timeline projection MUST be bounded, deterministic, omit raw events by default, and preserve stable product identity across supported legacy, current, and Terminal projections.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

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

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

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

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

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

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

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

The read-only Session view registry MAY expose workflow XState projections, but MUST identify workflow Session kinds and MUST keep workflow IR, private payloads, execution, and durable state under their orchestration owners.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/session-views/registry.tsx` — `inactiveChatSessionViews`; `src/apps/chat-ui/src/session-views/registry.tsx` — `listChatSessionViews`; `src/apps/chat-ui/src/session-views/registry.tsx` — `getChatSessionView`; `src/apps/chat-ui/src/session-views/WorkflowXStateSessionView.tsx` — `WorkflowXStateSessionView`; `packages/workflows/src/xstate/index.ts` — `createWorkflowXStateUiModel`; `packages/workflows/src/xstate/index.ts` — `WORKFLOW_XSTATE_UI_MODEL_KIND`
- Tests: `test/workflow-session-kind.test.mjs` — “project sidebar session nodes expose workflow session kind for real Pibo Sessions only”; `packages/workflows/src/testing/xstate-ui-model.test.ts` — “exposes a compact Web UI model from the XState machine projection”; `packages/workflows/src/testing/xstate-ui-model.test.ts` — “marks current wait, terminal, and retry-delay states from kernel snapshots or explicit active state ids”
- Public surfaces: `/api/chat/trace*`; `SessionTracePane`; `CompactTerminalSessionView`; `TraceTimeline`; `WorkflowXStateSessionView`; `listChatSessionViews`
- Failure/security boundary: Unknown view IDs or malformed snapshots fall back without granting edits or exposing private payloads.
- Accessibility/responsive boundary: Workflow states need textual names/status, not color-only meaning.
- Compatibility boundary: Kernel remains durable truth; registry additions are read-only Web compatibility extensions.
- Confidence: **high**
- Verification follow-up: Run workflow kind/UI-model tests and headfully inspect idle, waiting, retry, terminal, and malformed snapshots.

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

- Pagination preserves reading anchors; refresh replaces stale tails without losing older loaded windows; malformed identity/payload refs fail closed. Workflow views show current projections without becoming execution truth.
- Private payloads/raw events are not default UI data. Diagnostic reports omit content fingerprints/operator identifiers; image/payload access uses exact refs.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Trace cards expose stable IDs/order metadata; sticky scrolling tracks user intent. Raw sidebar hides below 980px in source. Keyboard, screen-reader, and visual behavior need headful checks.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Legacy/current runtime turns use stable product identity; workflow UI models accept kernel/XState/UI snapshots while durable truth remains kernel.

## Known limits

- Evidence gap: No headful virtual-scroll, prepend-anchor, raw-sidebar, fullscreen, or large-payload validation.
- Evidence gap: No executed trace suite or real event replay.

## Reconciled stale claims

- Reject: Web trace owns durable history or native transcript semantics.
- Reject: Raw events/private payloads are shown by default.
- Reject: Live merge rewrites established historical facts.
- Reject: The XState Web projection is workflow execution truth.
- Reject: Debug screenshots/reports are specification authority.

## Verification and traceability

- Source and named-test locators resolve to regular files at Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Imported or re-exported symbols use their canonical Foundation definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/chat-trace-materialization.test.mjs test/chat-ui-render-order-tooling.test.mjs test/trace-page-merge.test.mjs test/sticky-virtuoso-state.test.mjs test/workflow-session-kind.test.mjs test/workflow-v2-state-mapping-ui.test.mjs`
- `cd /root/code/pibo-okf-docs && npm test --workspace @pasko70/pibo-workflows`

## Related concepts

- SPC-DATA-001
- SPC-RUN-007
- SPC-OP-003
- SPC-ORCH-005
- SPC-WEB-004
- SPC-WEB-006
