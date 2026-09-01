---
type: "Specification"
title: "Chat Web Safe Content Rendering"
description: "Defines the implemented Chat Web Safe Content Rendering contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
tags:
- web
- chat-web
status: "stable"
authority: "normative"
generated:
  by: "openai/codex"
  at: "2026-09-01T20:42:35Z"
sources:
  - id: "foundation-source-and-tests"
    resource: "scope:upstream/dev refresh 39090b8850758293e69380a52bb7498d7c955bc2"
    title: "upstream/dev refresh source and named-test evidence"
implementation:
  state: "current"
  baseline_commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  package: "WP-06+07-WEB"
  package_parent: "ba3c2d6611ce8d234f887135af605837333bf751"
  source_evidence: "performed"
  focused_test_execution: "performed in owned Docker after authoring; see implementation report"
  build_typecheck_package_execution: "performed in owned Docker after authoring; see implementation report"
  visual_provider_gateway_pibo2_execution: "unperformed"
traceability:
  commit: "39090b8850758293e69380a52bb7498d7c955bc2"
  requirements:
    - id: "WEB-RENDER-MARKDOWN-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx"
          symbol: "allowedElements"
        - path: "src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx"
          symbol: "isPlainMarkdownText"
        - path: "src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx"
          symbol: "stabilizeStreamingInlineCodeMarkdown"
        - path: "src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx"
          symbol: "requiresGfmMarkdown"
        - path: "src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx"
          symbol: "normalizeSimpleMarkdownLinkHref"
        - path: "src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx"
          symbol: "safeUrlTransform"
        - path: "src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx"
          symbol: "MarkdownRenderer"
      tests:
        - path: "test/markdown-renderer-streaming.test.mjs"
          name: "streaming markdown stabilizes unfinished inline code spans"
        - path: "test/markdown-renderer-streaming.test.mjs"
          name: "streaming inline-code stabilization preserves completed and escaped backticks"
      public:
        - "MarkdownRenderer"
        - "TerminalInlineJson"
        - "TerminalDetails"
        - "trace image dialog"
        - "file download/preview controls"
      failures:
        - "Unsafe schemes/content must render inert text or safe fallback; streaming repair cannot alter completed Markdown."
        - "Accessibility/responsive boundary: Semantic headings/lists/code/links must retain order, names, focus, and wrapping."
        - "Compatibility boundary: Plain/GFM/streaming paths must share the same URL and escaping policy."
      confidence: "high"
    - id: "WEB-RENDER-JSON-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx"
          symbol: "InlineJsonValue"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx"
          symbol: "TerminalFunctionCall"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx"
          symbol: "boundedAccessiblePath"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx"
          symbol: "TerminalDetails"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx"
          symbol: "DetailPayload"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx"
          symbol: "DetailText"
      tests:
        - path: "test/chat-ui-terminal-inline-json.test.mjs"
          name: "compact Terminal inline JSON renders synchronized disclosure semantics without eager collapsed content"
        - path: "test/chat-ui-terminal-inline-json.test.mjs"
          name: "compact Terminal inline JSON keeps one stable collection button across disclosure states"
        - path: "test/chat-ui-terminal-inline-json-string-a11y.test.mjs"
          name: "expandable Terminal strings keep stable path-specific disclosure bindings"
        - path: "test/chat-ui-terminal-inline-json-string-a11y.test.mjs"
          name: "expandable Terminal strings preserve the 140-character JSON preview"
      public:
        - "MarkdownRenderer"
        - "TerminalInlineJson"
        - "TerminalDetails"
        - "trace image dialog"
        - "file download/preview controls"
      failures:
        - "Malformed/oversize values must remain bounded and cannot crash or eagerly disclose hidden payloads."
        - "Accessibility/responsive boundary: Disclosure name, expanded state, path, focus, and readable fallback are normative."
        - "Compatibility boundary: Renderer behavior must not depend on provider-specific payload classes."
      confidence: "high"
    - id: "WEB-RENDER-FILES-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "readTraceImagePayload"
        - path: "src/apps/chat/trace-v2.ts"
          symbol: "imageMimeTypeFromBytes"
        - path: "src/apps/chat-ui/src/api-chat-files.ts"
          symbol: "chatImagePreviewUrls"
        - path: "src/apps/chat-ui/src/api-chat-files.ts"
          symbol: "downloadChatFile"
        - path: "src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx"
          symbol: "TerminalImageDialog"
      tests:
        - path: "test/chat-ui-terminal-image-preview.test.mjs"
          name: "terminal image URL authority is exact-only when a payload reference exists"
        - path: "test/chat-ui-terminal-image-preview.test.mjs"
          name: "terminal image dialog keeps accessible lazy navigation outside the virtualized rows"
        - path: "test/chat-ui-download-files.test.mjs"
          name: "downloadChatFile reports delayed download progress before triggering the browser download"
      public:
        - "MarkdownRenderer"
        - "TerminalInlineJson"
        - "TerminalDetails"
        - "trace image dialog"
        - "file download/preview controls"
      failures:
        - "No exact ref means no image authority; invalid bytes/path/download fail without broadening access."
        - "Accessibility/responsive boundary: Dialog navigation must stay reachable outside virtualized rows and include alternatives/status."
        - "Compatibility boundary: Transport/path security remains SPC-SEC-002; file UX remains SPC-WEB-003."
      confidence: "high"
    - id: "WEB-RENDER-ORDER-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/tracing/TraceTimeline.tsx"
          symbol: "TraceTimeline"
        - path: "src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx"
          symbol: "MarkdownRenderer"
        - path: "src/apps/chat-ui/src/session-trace-layout.tsx"
          symbol: "SessionTraceLayout"
      tests:
        - path: "test/chat-ui-render-order-tooling.test.mjs"
          name: "trace cards expose stable ids and order metadata to CDP"
        - path: "test/chat-ui-render-order-tooling.test.mjs"
          name: "diagnosis report omits content fingerprints and operator-specific identifiers"
      public:
        - "MarkdownRenderer"
        - "TerminalInlineJson"
        - "TerminalDetails"
        - "trace image dialog"
        - "file download/preview controls"
      failures:
        - "Diagnostics must omit content fingerprints/operator identifiers; malformed content cannot reorder unrelated nodes."
        - "Accessibility/responsive boundary: DOM order, heading/list semantics, focus order, and responsive overflow require headful acceptance."
        - "Compatibility boundary: Debug tooling remains SPC-OP-002 and is evidence, not normative authority."
      confidence: "medium"
---
# Chat Web Safe Content Rendering

## Why

Safe Markdown/link rendering, bounded JSON/detail disclosure, image/file boundaries, and semantic content order.

## Scope

This specification describes implemented behavior at upstream/dev refresh traceability commit `39090b8850758293e69380a52bb7498d7c955bc2`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

### In scope

- Owns browser rendering, escaping/sanitization, bounded disclosure UI, semantic order, and safe file/image presentation.

### Out of scope

- SPC-SEC-002 owns file route/path/same-origin primitives.
- SPC-WEB-003 owns product file/media routes and interaction lifecycle.
- SPC-WEB-005 owns trace projection/order before rendering.
- Data/runtime owners define payload meaning.

## Current behavior

### Routes and state

Rendering is pure/projection-local except explicit detail, payload, image, preview, or download requests.

### Cache, stream, files, and media

Streaming Markdown stabilizes unfinished inline code. JSON/detail strings and paths are bounded. Images use exact payload/preview authority and lazy accessible dialogs.

### Lifecycle and failure

Unsafe/unsupported links are neutralized; malformed JSON/details fall back to bounded text; unavailable images/files retain explicit failure states.

### Security

No raw HTML execution, unsafe URL schemes, arbitrary file authority, secrets in fixtures, or eager collapsed payload exposure.

### Accessibility and responsive behavior

Semantic element order, synchronized disclosure labels/states, bounded accessible paths, image alternatives/navigation, wrapping and overflow rules are source-defined. No visual claim is verified.

### Compatibility and integration

Markdown GFM/plain fast paths and legacy/current trace payloads must produce the same safe boundary.

## Requirements and invariants

### Requirement: WEB-RENDER-MARKDOWN-001

Markdown rendering MUST escape/sanitize content, allow only the declared semantic elements, transform links through a safe URL policy, and stabilize incomplete streaming inline-code spans without executing raw HTML.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx` — `allowedElements`; `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx` — `isPlainMarkdownText`; `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx` — `stabilizeStreamingInlineCodeMarkdown`; `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx` — `requiresGfmMarkdown`; `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx` — `normalizeSimpleMarkdownLinkHref`; `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx` — `safeUrlTransform`; `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx` — `MarkdownRenderer`
- Tests: `test/markdown-renderer-streaming.test.mjs` — “streaming markdown stabilizes unfinished inline code spans”; `test/markdown-renderer-streaming.test.mjs` — “streaming inline-code stabilization preserves completed and escaped backticks”
- Public surfaces: `MarkdownRenderer`; `TerminalInlineJson`; `TerminalDetails`; `trace image dialog`; `file download/preview controls`
- Failure/security boundary: Unsafe schemes/content must render inert text or safe fallback; streaming repair cannot alter completed Markdown.
- Accessibility/responsive boundary: Semantic headings/lists/code/links must retain order, names, focus, and wrapping.
- Compatibility boundary: Plain/GFM/streaming paths must share the same URL and escaping policy.
- Confidence: **high**
- Verification follow-up: Run Markdown tests and add unsafe-scheme/raw-HTML/nested-GFM/property fixtures before headful link/selection checks.

### Requirement: WEB-RENDER-JSON-002

Inline JSON and detail disclosure MUST bound preview text and accessible paths, synchronize button expanded/label state, avoid eager collapsed content, and provide a readable fallback for non-JSON values.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx` — `InlineJsonValue`; `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx` — `TerminalFunctionCall`; `src/apps/chat-ui/src/session-views/compact-terminal/TerminalInlineJson.tsx` — `boundedAccessiblePath`; `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx` — `TerminalDetails`; `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx` — `DetailPayload`; `src/apps/chat-ui/src/session-views/compact-terminal/TerminalDetails.tsx` — `DetailText`
- Tests: `test/chat-ui-terminal-inline-json.test.mjs` — “compact Terminal inline JSON renders synchronized disclosure semantics without eager collapsed content”; `test/chat-ui-terminal-inline-json.test.mjs` — “compact Terminal inline JSON keeps one stable collection button across disclosure states”; `test/chat-ui-terminal-inline-json-string-a11y.test.mjs` — “expandable Terminal strings keep stable path-specific disclosure bindings”; `test/chat-ui-terminal-inline-json-string-a11y.test.mjs` — “expandable Terminal strings preserve the 140-character JSON preview”
- Public surfaces: `MarkdownRenderer`; `TerminalInlineJson`; `TerminalDetails`; `trace image dialog`; `file download/preview controls`
- Failure/security boundary: Malformed/oversize values must remain bounded and cannot crash or eagerly disclose hidden payloads.
- Accessibility/responsive boundary: Disclosure name, expanded state, path, focus, and readable fallback are normative.
- Compatibility boundary: Renderer behavior must not depend on provider-specific payload classes.
- Confidence: **high**
- Verification follow-up: Execute JSON/detail suites; add deep/cyclic/large-string fixtures and headful keyboard/screen-reader disclosure validation.

### Requirement: WEB-RENDER-FILES-003

Image and file rendering MUST use exact authorized payload/preview/download references, validate image bytes/types, lazy-load dialog content, and retain an accessible nonvisual fallback.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/trace-v2.ts` — `readTraceImagePayload`; `src/apps/chat/trace-v2.ts` — `imageMimeTypeFromBytes`; `src/apps/chat-ui/src/api-chat-files.ts` — `chatImagePreviewUrls`; `src/apps/chat-ui/src/api-chat-files.ts` — `downloadChatFile`; `src/apps/chat-ui/src/session-views/compact-terminal/CompactTerminalSessionView.tsx` — `TerminalImageDialog`
- Tests: `test/chat-ui-terminal-image-preview.test.mjs` — “terminal image URL authority is exact-only when a payload reference exists”; `test/chat-ui-terminal-image-preview.test.mjs` — “terminal image dialog keeps accessible lazy navigation outside the virtualized rows”; `test/chat-ui-download-files.test.mjs` — “downloadChatFile reports delayed download progress before triggering the browser download”
- Public surfaces: `MarkdownRenderer`; `TerminalInlineJson`; `TerminalDetails`; `trace image dialog`; `file download/preview controls`
- Failure/security boundary: No exact ref means no image authority; invalid bytes/path/download fail without broadening access.
- Accessibility/responsive boundary: Dialog navigation must stay reachable outside virtualized rows and include alternatives/status.
- Compatibility boundary: Transport/path security remains SPC-SEC-002; file UX remains SPC-WEB-003.
- Confidence: **high**
- Verification follow-up: Run image/file tests with SPC-SEC-002 route tests; headfully validate lazy dialog, alt/fallback, focus, progress, and failed media.

### Requirement: WEB-RENDER-ORDER-004

Rendered trace content MUST preserve the semantic order supplied by the projection, expose stable source-defined diagnostic anchors, and MUST NOT include real secrets or operator-specific identifiers in tests or reports.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/tracing/TraceTimeline.tsx` — `TraceTimeline`; `src/apps/chat-ui/src/tracing/MarkdownRenderer.tsx` — `MarkdownRenderer`; `src/apps/chat-ui/src/session-trace-layout.tsx` — `SessionTraceLayout`
- Tests: `test/chat-ui-render-order-tooling.test.mjs` — “trace cards expose stable ids and order metadata to CDP”; `test/chat-ui-render-order-tooling.test.mjs` — “diagnosis report omits content fingerprints and operator-specific identifiers”
- Public surfaces: `MarkdownRenderer`; `TerminalInlineJson`; `TerminalDetails`; `trace image dialog`; `file download/preview controls`
- Failure/security boundary: Diagnostics must omit content fingerprints/operator identifiers; malformed content cannot reorder unrelated nodes.
- Accessibility/responsive boundary: DOM order, heading/list semantics, focus order, and responsive overflow require headful acceptance.
- Compatibility boundary: Debug tooling remains SPC-OP-002 and is evidence, not normative authority.
- Confidence: **medium**
- Verification follow-up: Run render-order tooling tests and add semantic DOM-order assertions across trace card kinds; perform headful screen-reader-order validation with synthetic fixtures.

## Interfaces and ownership

**Capability IDs:** None; this concept projects capabilities owned by linked services.

**Public surfaces:**

- MarkdownRenderer
- TerminalInlineJson
- TerminalDetails
- trace image dialog
- file download/preview controls

**Non-owned links:**

- SPC-SEC-002 owns file route/path/same-origin primitives.
- SPC-WEB-003 owns product file/media routes and interaction lifecycle.
- SPC-WEB-005 owns trace projection/order before rendering.
- Data/runtime owners define payload meaning.

## Failure and security behavior

- Unsafe/unsupported links are neutralized; malformed JSON/details fall back to bounded text; unavailable images/files retain explicit failure states.
- No raw HTML execution, unsafe URL schemes, arbitrary file authority, secrets in fixtures, or eager collapsed payload exposure.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Semantic element order, synchronized disclosure labels/states, bounded accessible paths, image alternatives/navigation, wrapping and overflow rules are source-defined. No visual claim is verified.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Markdown GFM/plain fast paths and legacy/current trace payloads must produce the same safe boundary.

## Known limits

- Evidence gap: No headful keyboard/screen-reader/zoom/overflow/image-dialog validation.
- Evidence gap: No executed fuzz/property testing for Markdown URLs or deeply nested JSON.

## Reconciled stale claims

- Reject: React escaping alone defines the complete Markdown safety contract.
- Reject: Collapsed JSON/details may eagerly expose full hidden content.
- Reject: An image URL is authoritative without an exact payload/file reference.
- Reject: Screenshot appearance proves renderer safety.
- Reject: Nonexistent aggregate rendering test files are current evidence.

## Verification and traceability

- Source and named-test locators resolve to regular files at upstream/dev refresh commit `39090b8850758293e69380a52bb7498d7c955bc2`.
- Imported or re-exported symbols use their canonical upstream/dev refresh definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/markdown-renderer-streaming.test.mjs test/chat-ui-terminal-inline-json.test.mjs test/chat-ui-terminal-inline-json-string-a11y.test.mjs test/chat-ui-terminal-image-preview.test.mjs`

## Related concepts

- SPC-SEC-002
- SPC-WEB-003
- SPC-WEB-005
