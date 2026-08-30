---
type: "Specification"
title: "Chat Web Streaming, Cache, and Live Projection"
description: "Defines the implemented Chat Web Streaming, Cache, and Live Projection contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
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
    - id: "WEB-LIVE-PROJECTION-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat/stream.ts"
          symbol: "createChatStreamState"
        - path: "src/apps/chat/stream.ts"
          symbol: "nextTransientChatStreamFrameId"
        - path: "src/apps/chat/stream.ts"
          symbol: "chatStreamFramesFromOutputEvent"
        - path: "src/apps/chat-ui/src/cache.ts"
          symbol: "chatBootstrapQueryKey"
        - path: "src/apps/chat-ui/src/cache.ts"
          symbol: "chatSessionNavigationQueryKey"
        - path: "src/apps/chat-ui/src/cache.ts"
          symbol: "chatTracePageQueryKey"
      tests:
        - path: "test/chat-ui-live-overlay.test.mjs"
          name: "live overlay trimming preserves bounded-page omissions until exact confirmation"
      public:
        - "/api/chat/events"
        - "chatBootstrapQueryKey"
        - "chatSessionNavigationQueryKey"
        - "chatTracePageQueryKey"
        - "live trace overlay cache"
      failures:
        - "Unconfirmed/omitted events remain ephemeral; trimming requires exact durable confirmation."
        - "Accessibility/responsive boundary: Live status changes must not produce unstable duplicate announcements."
        - "Compatibility boundary: Durable page formats remain owned by data/trace producers."
      confidence: "high"
    - id: "WEB-LIVE-OVERLAY-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/tracing/live-overlay.ts"
          symbol: "restoreLiveTraceOverlayForSession"
        - path: "src/apps/chat-ui/src/tracing/live-overlay.ts"
          symbol: "reconcileLiveTraceOverlayCache"
        - path: "src/apps/chat-ui/src/tracing/live-overlay.ts"
          symbol: "trimLiveOverlayForBaseTrace"
        - path: "src/shared/trace-live-reducer.ts"
          symbol: "applyTraceLiveEvents"
      tests:
        - path: "test/chat-ui-live-overlay.test.mjs"
          name: "persisted reasoning, tools, and assistants keep live content identities"
        - path: "test/chat-ui-session-overlay-cache.test.mjs"
          name: "session overlay cache restores on navigation and trims confirmed events"
      public:
        - "/api/chat/events"
        - "chatBootstrapQueryKey"
        - "chatSessionNavigationQueryKey"
        - "chatTracePageQueryKey"
        - "live trace overlay cache"
      failures:
        - "Identity mismatch must not merge; cache restoration must never disclose another Session's overlay."
        - "Accessibility/responsive boundary: Restored pending/live states need deterministic semantic labels."
        - "Compatibility boundary: Identity rules must tolerate legacy/current event encodings without weakening isolation."
      confidence: "high"
    - id: "WEB-LIVE-RECONCILE-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/components/PendingUserMessageDelivery.tsx"
          symbol: "PendingUserMessageDelivery"
        - path: "src/apps/chat/web-app.ts"
          symbol: "createChatWebApp"
      tests:
        - path: "test/chat-ui-pending-message-delivery.test.mjs"
          name: "pending Queue and Steer feedback exposes stable live-region semantics"
        - path: "test/chat-signals-api.test.mjs"
          name: "chat signal SSE sends snapshot then monotonic patches"
        - path: "test/chat-signals-api.test.mjs"
          name: "chat message emit failure is projected into session error signals"
        - path: "test/chat-signals-api.test.mjs"
          name: "chat navigation clears stale indexed running status from settled signal state"
      public:
        - "/api/chat/events"
        - "chatBootstrapQueryKey"
        - "chatSessionNavigationQueryKey"
        - "chatTracePageQueryKey"
        - "live trace overlay cache"
      failures:
        - "Emit failure must become visible error state; settled snapshots clear stale running state; duplicates cannot double-commit."
        - "Accessibility/responsive boundary: Pending/error updates must remain bounded live-region output."
        - "Compatibility boundary: Signal authority and ordering remain SPC-DATA-005."
      confidence: "high"
    - id: "WEB-LIVE-NAVIGATION-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/cache.ts"
          symbol: "setChatNavigationCache"
        - path: "src/apps/chat-ui/src/cache.ts"
          symbol: "invalidateChatSessionNavigationCache"
        - path: "src/apps/chat-ui/src/cache.ts"
          symbol: "loadChatSessionNavigationQueryData"
        - path: "src/apps/chat-ui/src/cache.ts"
          symbol: "chatCacheInvalidationMatrix"
        - path: "src/apps/chat-ui/src/tracing/live-overlay.ts"
          symbol: "restoreLiveTraceOverlayForSession"
      tests:
        - path: "test/chat-ui-session-overlay-cache.test.mjs"
          name: "delivery selection closes before awaiting, rejects duplicates, and navigation restores before paint"
        - path: "test/chat-ui-terminal-status-refresh.test.mjs"
          name: "Terminal status refresh updates the existing card without posting a new action"
      public:
        - "/api/chat/events"
        - "chatBootstrapQueryKey"
        - "chatSessionNavigationQueryKey"
        - "chatTracePageQueryKey"
        - "live trace overlay cache"
      failures:
        - "Stale keys or failed fetches must preserve the correct prior destination state without crossing Session identity."
        - "Accessibility/responsive boundary: Dialog closure, focus return, and pre-paint behavior require headful evidence."
        - "Compatibility boundary: Cache invalidation must evolve with public route/query schemas."
      confidence: "high"
---
# Chat Web Streaming, Cache, and Live Projection

## Why

Durable page versus ephemeral stream separation, per-Session/request overlays, rejected-send/signal reconciliation, and navigation-safe cache behavior.

## Scope

This specification describes implemented behavior at Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

### In scope

- Owns the browser cache, ephemeral stream-frame/live-overlay projection, and reconciliation behavior.

### Out of scope

- SPC-DATA-001 owns durable pages/history records.
- SPC-DATA-005 owns signal semantics, snapshots, SSE ordering, and signal APIs.
- SPC-RUN-007 owns native runtime history.
- SPC-WEB-005 owns trace/terminal rendering of the reconciled projection.

## Current behavior

### Routes and state

Durable bootstrap/navigation/trace pages have stable query keys. Ephemeral event frames and optimistic delivery overlays are keyed by Pibo Session and request/content identity.

### Cache, stream, files, and media

Live frames overlay but do not rewrite durable pages; confirmed persisted content trims overlays. Signal snapshots/patches update indexed status. File/media state remains SPC-WEB-003.

### Lifecycle and failure

Navigation restores the destination overlay before paint and prevents source-Session contamination. Rejected sends, emit failures, stale settled signals, duplicate events, and bounded-page omissions reconcile explicitly.

### Security

Cache keys require exact Session/resource identity; cached browser projections cannot authorize mutations or disclose another selected Session.

### Accessibility and responsive behavior

Pending/rejected/running/error states must remain stable semantic statuses across trace and terminal projections. Visual timing remains unverified.

### Compatibility and integration

Legacy/current persisted traces and live events merge by stable content identity and assistant index; durable schema evolution remains the data/runtime owners.

## Requirements and invariants

### Requirement: WEB-LIVE-PROJECTION-001

The browser MUST keep durable bootstrap/navigation/trace pages separate from bounded ephemeral stream frames and MUST overlay live content without converting it into durable history.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/stream.ts` — `createChatStreamState`; `src/apps/chat/stream.ts` — `nextTransientChatStreamFrameId`; `src/apps/chat/stream.ts` — `chatStreamFramesFromOutputEvent`; `src/apps/chat-ui/src/cache.ts` — `chatBootstrapQueryKey`; `src/apps/chat-ui/src/cache.ts` — `chatSessionNavigationQueryKey`; `src/apps/chat-ui/src/cache.ts` — `chatTracePageQueryKey`
- Tests: `test/chat-ui-live-overlay.test.mjs` — “live overlay trimming preserves bounded-page omissions until exact confirmation”
- Public surfaces: `/api/chat/events`; `chatBootstrapQueryKey`; `chatSessionNavigationQueryKey`; `chatTracePageQueryKey`; `live trace overlay cache`
- Failure/security boundary: Unconfirmed/omitted events remain ephemeral; trimming requires exact durable confirmation.
- Accessibility/responsive boundary: Live status changes must not produce unstable duplicate announcements.
- Compatibility boundary: Durable page formats remain owned by data/trace producers.
- Confidence: **high**
- Verification follow-up: Run overlay/cache tests and add long-stream eviction plus reconnect coverage using deterministic event fixtures.

### Requirement: WEB-LIVE-OVERLAY-002

Live overlays MUST be keyed by Pibo Session and stable request/content identity, preserve reasoning/tool/assistant identities, and restore only the destination Session on navigation.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/tracing/live-overlay.ts` — `restoreLiveTraceOverlayForSession`; `src/apps/chat-ui/src/tracing/live-overlay.ts` — `reconcileLiveTraceOverlayCache`; `src/apps/chat-ui/src/tracing/live-overlay.ts` — `trimLiveOverlayForBaseTrace`; `src/shared/trace-live-reducer.ts` — `applyTraceLiveEvents`
- Tests: `test/chat-ui-live-overlay.test.mjs` — “persisted reasoning, tools, and assistants keep live content identities”; `test/chat-ui-session-overlay-cache.test.mjs` — “session overlay cache restores on navigation and trims confirmed events”
- Public surfaces: `/api/chat/events`; `chatBootstrapQueryKey`; `chatSessionNavigationQueryKey`; `chatTracePageQueryKey`; `live trace overlay cache`
- Failure/security boundary: Identity mismatch must not merge; cache restoration must never disclose another Session's overlay.
- Accessibility/responsive boundary: Restored pending/live states need deterministic semantic labels.
- Compatibility boundary: Identity rules must tolerate legacy/current event encodings without weakening isolation.
- Confidence: **high**
- Verification follow-up: Execute overlay tests and add two-Session interleaving with duplicate request IDs and browser back/forward.

### Requirement: WEB-LIVE-RECONCILE-003

Rejected sends, failed event emission, duplicate delivery, completed assistants, and monotonic signal snapshots/patches MUST reconcile to explicit pending, error, settled, or confirmed state.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/components/PendingUserMessageDelivery.tsx` — `PendingUserMessageDelivery`; `src/apps/chat/web-app.ts` — `createChatWebApp`
- Tests: `test/chat-ui-pending-message-delivery.test.mjs` — “pending Queue and Steer feedback exposes stable live-region semantics”; `test/chat-signals-api.test.mjs` — “chat signal SSE sends snapshot then monotonic patches”; `test/chat-signals-api.test.mjs` — “chat message emit failure is projected into session error signals”; `test/chat-signals-api.test.mjs` — “chat navigation clears stale indexed running status from settled signal state”
- Public surfaces: `/api/chat/events`; `chatBootstrapQueryKey`; `chatSessionNavigationQueryKey`; `chatTracePageQueryKey`; `live trace overlay cache`
- Failure/security boundary: Emit failure must become visible error state; settled snapshots clear stale running state; duplicates cannot double-commit.
- Accessibility/responsive boundary: Pending/error updates must remain bounded live-region output.
- Compatibility boundary: Signal authority and ordering remain SPC-DATA-005.
- Confidence: **high**
- Verification follow-up: Run pending and signal suites; add reconnect/drop/duplicate/out-of-order event tests at the UI reducer boundary.

### Requirement: WEB-LIVE-NAVIGATION-004

Navigation cache reads, writes, invalidation, and overlay restoration MUST use exact resource keys, close delivery selection before awaiting, and restore destination state before paint.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/cache.ts` — `setChatNavigationCache`; `src/apps/chat-ui/src/cache.ts` — `invalidateChatSessionNavigationCache`; `src/apps/chat-ui/src/cache.ts` — `loadChatSessionNavigationQueryData`; `src/apps/chat-ui/src/cache.ts` — `chatCacheInvalidationMatrix`; `src/apps/chat-ui/src/tracing/live-overlay.ts` — `restoreLiveTraceOverlayForSession`
- Tests: `test/chat-ui-session-overlay-cache.test.mjs` — “delivery selection closes before awaiting, rejects duplicates, and navigation restores before paint”; `test/chat-ui-terminal-status-refresh.test.mjs` — “Terminal status refresh updates the existing card without posting a new action”
- Public surfaces: `/api/chat/events`; `chatBootstrapQueryKey`; `chatSessionNavigationQueryKey`; `chatTracePageQueryKey`; `live trace overlay cache`
- Failure/security boundary: Stale keys or failed fetches must preserve the correct prior destination state without crossing Session identity.
- Accessibility/responsive boundary: Dialog closure, focus return, and pre-paint behavior require headful evidence.
- Compatibility boundary: Cache invalidation must evolve with public route/query schemas.
- Confidence: **high**
- Verification follow-up: Execute navigation/cache tests and headfully test rapid Session switching during send, refresh, and status updates.

## Interfaces and ownership

**Capability IDs:** None; this concept projects capabilities owned by linked services.

**Public surfaces:**

- /api/chat/events
- chatBootstrapQueryKey
- chatSessionNavigationQueryKey
- chatTracePageQueryKey
- live trace overlay cache

**Non-owned links:**

- SPC-DATA-001 owns durable pages/history records.
- SPC-DATA-005 owns signal semantics, snapshots, SSE ordering, and signal APIs.
- SPC-RUN-007 owns native runtime history.
- SPC-WEB-005 owns trace/terminal rendering of the reconciled projection.

## Failure and security behavior

- Navigation restores the destination overlay before paint and prevents source-Session contamination. Rejected sends, emit failures, stale settled signals, duplicate events, and bounded-page omissions reconcile explicitly.
- Cache keys require exact Session/resource identity; cached browser projections cannot authorize mutations or disclose another selected Session.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Pending/rejected/running/error states must remain stable semantic statuses across trace and terminal projections. Visual timing remains unverified.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Legacy/current persisted traces and live events merge by stable content identity and assistant index; durable schema evolution remains the data/runtime owners.

## Known limits

- Evidence gap: No executed high-rate/reconnect/navigation stress test.
- Evidence gap: No headful evidence for status announcement timing or pre-paint restoration.

## Reconciled stale claims

- Reject: Live overlays are durable history.
- Reject: Navigation may reuse an unkeyed overlay across Sessions.
- Reject: Signal browser state owns signal persistence semantics.
- Reject: A completed live event may rewrite older durable facts.

## Verification and traceability

- Source and named-test locators resolve to regular files at Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Imported or re-exported symbols use their canonical Foundation definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/chat-ui-live-overlay.test.mjs test/chat-ui-session-overlay-cache.test.mjs test/chat-ui-pending-message-delivery.test.mjs test/chat-signals-api.test.mjs test/chat-ui-terminal-status-refresh.test.mjs`

## Related concepts

- SPC-DATA-001
- SPC-DATA-005
- SPC-RUN-007
- SPC-WEB-001
- SPC-WEB-005
