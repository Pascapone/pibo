---
type: "Specification"
title: "Web Annotations"
description: "Defines the implemented Web Annotations contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
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
    - id: "WEB-ANNOTATION-BINDING-001"
      status: "implemented"
      sources:
        - path: "src/web-annotations/cdp.ts"
          symbol: "WebAnnotationCdpService"
        - path: "src/web-annotations/cdp.ts"
          symbol: "createWebAnnotationCdpService"
        - path: "src/web-annotations/cdp.ts"
          symbol: "buildWebAnnotationOverlayScript"
        - path: "src/web-annotations/api.ts"
          symbol: "WEB_ANNOTATIONS_API_PREFIX"
        - path: "src/web-annotations/api.ts"
          symbol: "WEB_ANNOTATIONS_APP_MOUNT"
        - path: "src/web-annotations/api.ts"
          symbol: "createWebAnnotationsWebApp"
        - path: "src/web-annotations/api.ts"
          symbol: "createSameOriginBinding"
        - path: "src/web-annotations/api.ts"
          symbol: "handleOverlaySubmission"
        - path: "src/web-annotations/api.ts"
          symbol: "requireSameOriginJsonRequest"
      tests:
        - path: "test/web-annotations-cdp-api.test.mjs"
          name: "Web Annotation API creates same-origin bindings and serves standalone overlay script"
        - path: "test/web-annotations-cdp-api.test.mjs"
          name: "Web Annotation CDP service creates selected bindings and marks missing targets closed"
        - path: "test/web-annotations-cdp-api.test.mjs"
          name: "Web Annotation overlay submissions use binding token and derive session scope"
      public:
        - "/apps/web-annotations"
        - "/api/web-annotations/**"
        - "web_annotation_* tools"
        - "WebAnnotationsEntryPoints"
        - "WebAnnotationsSessionPanel"
      failures:
        - "Wrong origin/Session/target, detached page, malformed payload, or failed injection must not create an annotation."
        - "Accessibility/responsive boundary: Injected controls, overlay hit targets, focus, zoom, and page interference require headful validation."
        - "Compatibility boundary: External page DOM is not owned; binding/API schemas are stable integration surfaces."
      confidence: "high"
    - id: "WEB-ANNOTATION-STORE-002"
      status: "implemented"
      sources:
        - path: "src/web-annotations/store.ts"
          symbol: "WebAnnotationStore"
        - path: "src/web-annotations/store.ts"
          symbol: "createDefaultWebAnnotationStore"
        - path: "src/web-annotations/validation.ts"
          symbol: "WEB_ANNOTATION_LIMITS"
        - path: "src/web-annotations/validation.ts"
          symbol: "redactWebAnnotationSecrets"
        - path: "src/web-annotations/validation.ts"
          symbol: "sanitizeWebAnnotationText"
        - path: "src/web-annotations/validation.ts"
          symbol: "assertWebAnnotationStatusTransition"
      tests:
        - path: "test/web-annotations-store.test.mjs"
          name: "web annotations list newest first with status and bounded limits"
        - path: "test/web-annotations-store.test.mjs"
          name: "web annotations normalize oversized and secret-like payloads"
      public:
        - "/apps/web-annotations"
        - "/api/web-annotations/**"
        - "web_annotation_* tools"
        - "WebAnnotationsEntryPoints"
        - "WebAnnotationsSessionPanel"
      failures:
        - "Oversize, secret-bearing, malformed, or invalid-transition data fails or is redacted before persistence."
        - "Accessibility/responsive boundary: Bounded summaries/statuses need readable text in UI."
        - "Compatibility boundary: Physical schema, durability, and migration stay SPC-DATA-001."
      confidence: "high"
    - id: "WEB-ANNOTATION-TOOLS-003"
      status: "implemented"
      sources:
        - path: "src/web-annotations/tools.ts"
          symbol: "WEB_ANNOTATION_TOOL_NAMES"
        - path: "src/web-annotations/tools.ts"
          symbol: "createWebAnnotationToolProfiles"
      tests:
        - path: "test/web-annotations-tools.test.mjs"
          name: "default registry catalogs Web Annotation tools without selecting them in a built-in profile"
        - path: "test/web-annotations-tools.test.mjs"
          name: "annotation watch returns new annotations or timeout without error"
      public:
        - "/apps/web-annotations"
        - "/api/web-annotations/**"
        - "web_annotation_* tools"
        - "WebAnnotationsEntryPoints"
        - "WebAnnotationsSessionPanel"
      failures:
        - "Unknown tools, cross-Session IDs, invalid transitions, and unbounded waits are rejected."
        - "Accessibility/responsive boundary: Tool outputs need concise bounded error/status text."
        - "Compatibility boundary: Browser/debug operator APIs remain SPC-OP-002."
      confidence: "high"
    - id: "WEB-ANNOTATION-SELECTION-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/web-annotation-storage.ts"
          symbol: "readStoredSelectedWebAnnotationIds"
        - path: "src/apps/chat-ui/src/web-annotation-storage.ts"
          symbol: "writeStoredSelectedWebAnnotationIds"
        - path: "src/apps/chat-ui/src/web-annotation-storage.ts"
          symbol: "readStoredWebAnnotationOverlayState"
        - path: "src/apps/chat-ui/src/web-annotation-storage.ts"
          symbol: "DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT"
        - path: "src/apps/chat-ui/src/use-session-web-annotations.ts"
          symbol: "useSessionWebAnnotations"
        - path: "src/apps/chat-ui/src/web-annotations.tsx"
          symbol: "WebAnnotationsSessionPanel"
        - path: "src/apps/chat-ui/src/web-annotations.tsx"
          symbol: "WebAnnotationsEntryPoints"
      source_inspected: true
      follow_up: "Add and run storage/UI tests for app-global selection, one-time legacy migration, malformed storage, shortcut changes, panel state, and cross-Session rendering; then validate headfully."
      public:
        - "/apps/web-annotations"
        - "/api/web-annotations/**"
        - "web_annotation_* tools"
        - "WebAnnotationsEntryPoints"
        - "WebAnnotationsSessionPanel"
      failures:
        - "Malformed local storage falls back safely; selection cannot grant API authority or cross-bind a target."
        - "Accessibility/responsive boundary: Dialog label, expanded/pressed state, initial focus, mobile sizing, scroll, escape/outside close, and shortcut need headful evidence."
        - "Compatibility boundary: Legacy per-Session keys are migration inputs only; current selection is app-global."
      confidence: "medium"
---
# Web Annotations

## Why

Browser target binding, injected overlay lifecycle, bounded annotation storage/artifacts, controlled agent tools, and app-global UI selection with legacy migration.

## Scope

This specification describes implemented behavior at Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

### In scope

- Owns the Web Annotation product API/app, CDP binding/injected overlay, bounded product semantics, controlled tool profiles, and Chat UI annotation selection/overlay controls.

### Out of scope

- SPC-DATA-001 owns physical annotation tables/durability/migrations.
- SPC-SEC-001 owns App Context authorization and general origin policy.
- SPC-OP-002 owns browser/debug operator tooling.
- Target browser page behavior outside the injected overlay is external.

## Current behavior

### Routes and state

Same-origin app/API routes bind a Pibo Session to an exact browser target and serve overlay submissions. Selection is app-global local storage; legacy per-Session keys migrate once. Overlay/panel preferences remain browser-local.

### Cache, stream, files, and media

Annotations and bounded artifact refs persist through the annotation store; screenshots/reports are evidence artifacts, not authority.

### Lifecycle and failure

Target detach/navigation, malformed submissions, invalid status transitions, bounds, redaction, stale bindings, and bounded watch timeouts fail explicitly.

### Security

Same-origin JSON mutations, exact Session/target binding, secret redaction, text/artifact limits, and controlled tool profiles prevent arbitrary CDP/tool access.

### Accessibility and responsive behavior

Source defines dialog/expanded/pressed labels, initial focus, status/error/empty states, 44px-class mobile controls, bounded scrolling, and responsive cards. No headful browser ran.

### Compatibility and integration

Legacy session-scoped selection keys migrate to the app-global key; annotation status transitions and API schemas are public compatibility surfaces.

## Requirements and invariants

### Requirement: WEB-ANNOTATION-BINDING-001

The service MUST bind an exact browser target to a Pibo Session, inject the controlled overlay, accept submissions only through the same-origin bound API, and detach or fail visibly when the target is unavailable.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/web-annotations/cdp.ts` — `WebAnnotationCdpService`; `src/web-annotations/cdp.ts` — `createWebAnnotationCdpService`; `src/web-annotations/cdp.ts` — `buildWebAnnotationOverlayScript`; `src/web-annotations/api.ts` — `WEB_ANNOTATIONS_API_PREFIX`; `src/web-annotations/api.ts` — `WEB_ANNOTATIONS_APP_MOUNT`; `src/web-annotations/api.ts` — `createWebAnnotationsWebApp`; `src/web-annotations/api.ts` — `createSameOriginBinding`; `src/web-annotations/api.ts` — `handleOverlaySubmission`; `src/web-annotations/api.ts` — `requireSameOriginJsonRequest`
- Tests: `test/web-annotations-cdp-api.test.mjs` — “Web Annotation API creates same-origin bindings and serves standalone overlay script”; `test/web-annotations-cdp-api.test.mjs` — “Web Annotation CDP service creates selected bindings and marks missing targets closed”; `test/web-annotations-cdp-api.test.mjs` — “Web Annotation overlay submissions use binding token and derive session scope”
- Public surfaces: `/apps/web-annotations`; `/api/web-annotations/**`; `web_annotation_* tools`; `WebAnnotationsEntryPoints`; `WebAnnotationsSessionPanel`
- Failure/security boundary: Wrong origin/Session/target, detached page, malformed payload, or failed injection must not create an annotation.
- Accessibility/responsive boundary: Injected controls, overlay hit targets, focus, zoom, and page interference require headful validation.
- Compatibility boundary: External page DOM is not owned; binding/API schemas are stable integration surfaces.
- Confidence: **high**
- Verification follow-up: Run the CDP/API suite, then use an approved headful real page to test bind, annotate, navigate, detach, reconnect, and origin rejection.

### Requirement: WEB-ANNOTATION-STORE-002

Annotation creation/update MUST enforce text, locator, artifact, and collection bounds, redact likely secrets, validate status transitions, and persist only normalized product records and bounded artifact references.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/web-annotations/store.ts` — `WebAnnotationStore`; `src/web-annotations/store.ts` — `createDefaultWebAnnotationStore`; `src/web-annotations/validation.ts` — `WEB_ANNOTATION_LIMITS`; `src/web-annotations/validation.ts` — `redactWebAnnotationSecrets`; `src/web-annotations/validation.ts` — `sanitizeWebAnnotationText`; `src/web-annotations/validation.ts` — `assertWebAnnotationStatusTransition`
- Tests: `test/web-annotations-store.test.mjs` — “web annotations list newest first with status and bounded limits”; `test/web-annotations-store.test.mjs` — “web annotations normalize oversized and secret-like payloads”
- Public surfaces: `/apps/web-annotations`; `/api/web-annotations/**`; `web_annotation_* tools`; `WebAnnotationsEntryPoints`; `WebAnnotationsSessionPanel`
- Failure/security boundary: Oversize, secret-bearing, malformed, or invalid-transition data fails or is redacted before persistence.
- Accessibility/responsive boundary: Bounded summaries/statuses need readable text in UI.
- Compatibility boundary: Physical schema, durability, and migration stay SPC-DATA-001.
- Confidence: **high**
- Verification follow-up: Run store tests against an isolated data store and add boundary-value, redaction, artifact-count, transition, and migration cases.

### Requirement: WEB-ANNOTATION-TOOLS-003

Agent-facing annotation tools MUST expose only the declared controlled create/list/update/delete/watch profiles, enforce Session scoping and bounded watch behavior, and MUST NOT provide unrestricted CDP or page-script execution.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/web-annotations/tools.ts` — `WEB_ANNOTATION_TOOL_NAMES`; `src/web-annotations/tools.ts` — `createWebAnnotationToolProfiles`
- Tests: `test/web-annotations-tools.test.mjs` — “default registry catalogs Web Annotation tools without selecting them in a built-in profile”; `test/web-annotations-tools.test.mjs` — “annotation watch returns new annotations or timeout without error”
- Public surfaces: `/apps/web-annotations`; `/api/web-annotations/**`; `web_annotation_* tools`; `WebAnnotationsEntryPoints`; `WebAnnotationsSessionPanel`
- Failure/security boundary: Unknown tools, cross-Session IDs, invalid transitions, and unbounded waits are rejected.
- Accessibility/responsive boundary: Tool outputs need concise bounded error/status text.
- Compatibility boundary: Browser/debug operator APIs remain SPC-OP-002.
- Confidence: **high**
- Verification follow-up: Run tool tests and add cross-Session, invalid target, timeout, cancellation, and oversized-result assertions.

### Requirement: WEB-ANNOTATION-SELECTION-004

Chat Web annotation selection MUST be app-global, migrate a legacy per-Session selection key to the global key, keep overlay/panel preferences browser-local, and expose labeled responsive dialog/panel controls.

#### Current

Foundation source inspection defines the current contract. No named test exists in the evidence set, so this requirement remains an explicit source-only gap and makes no focused-test claim.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/web-annotation-storage.ts` — `readStoredSelectedWebAnnotationIds`; `src/apps/chat-ui/src/web-annotation-storage.ts` — `writeStoredSelectedWebAnnotationIds`; `src/apps/chat-ui/src/web-annotation-storage.ts` — `readStoredWebAnnotationOverlayState`; `src/apps/chat-ui/src/web-annotation-storage.ts` — `DEFAULT_WEB_ANNOTATIONS_TOGGLE_SHORTCUT`; `src/apps/chat-ui/src/use-session-web-annotations.ts` — `useSessionWebAnnotations`; `src/apps/chat-ui/src/web-annotations.tsx` — `WebAnnotationsSessionPanel`; `src/apps/chat-ui/src/web-annotations.tsx` — `WebAnnotationsEntryPoints`
- Tests: No named test exists in the Foundation evidence set; this requirement remains source-only.
- Public surfaces: `/apps/web-annotations`; `/api/web-annotations/**`; `web_annotation_* tools`; `WebAnnotationsEntryPoints`; `WebAnnotationsSessionPanel`
- Failure/security boundary: Malformed local storage falls back safely; selection cannot grant API authority or cross-bind a target.
- Accessibility/responsive boundary: Dialog label, expanded/pressed state, initial focus, mobile sizing, scroll, escape/outside close, and shortcut need headful evidence.
- Compatibility boundary: Legacy per-Session keys are migration inputs only; current selection is app-global.
- Confidence: **medium**
- Verification follow-up: Add and run storage/UI tests for app-global selection, one-time legacy migration, malformed storage, shortcut changes, panel state, and cross-Session rendering; then validate headfully.

## Interfaces and ownership

**Capability IDs:** pibo.web-annotations

**Public surfaces:**

- /apps/web-annotations
- /api/web-annotations/**
- web_annotation_* tools
- WebAnnotationsEntryPoints
- WebAnnotationsSessionPanel

**Non-owned links:**

- SPC-DATA-001 owns physical annotation tables/durability/migrations.
- SPC-SEC-001 owns App Context authorization and general origin policy.
- SPC-OP-002 owns browser/debug operator tooling.
- Target browser page behavior outside the injected overlay is external.

## Failure and security behavior

- Target detach/navigation, malformed submissions, invalid status transitions, bounds, redaction, stale bindings, and bounded watch timeouts fail explicitly.
- Same-origin JSON mutations, exact Session/target binding, secret redaction, text/artifact limits, and controlled tool profiles prevent arbitrary CDP/tool access.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Source defines dialog/expanded/pressed labels, initial focus, status/error/empty states, 44px-class mobile controls, bounded scrolling, and responsive cards. No headful browser ran.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Legacy session-scoped selection keys migrate to the app-global key; annotation status transitions and API schemas are public compatibility surfaces.

## Known limits

- Evidence gap: No headful target binding, overlay injection, responsive dialog, keyboard/focus, navigation-detach, or real-page path.
- Evidence gap: No executed CDP/store/tool tests.

## Reconciled stale claims

- Reject: Web Annotation selection is currently Session-scoped.
- Reject: Any CDP target may submit without an exact Session binding.
- Reject: Agent tools expose unrestricted browser/CDP operations.
- Reject: Screenshots or reports are normative source truth.
- Reject: Data durability is owned by the Web spec.

## Verification and traceability

- Source and named-test locators resolve to regular files at Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Imported or re-exported symbols use their canonical Foundation definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/web-annotations-store.test.mjs test/web-annotations-tools.test.mjs test/web-annotations-cdp-api.test.mjs`

## Related concepts

- SPC-DATA-001
- SPC-SEC-001
- SPC-OP-002
- SPC-WEB-001
