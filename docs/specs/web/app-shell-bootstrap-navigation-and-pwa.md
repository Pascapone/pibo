---
type: "Specification"
title: "Chat Web App Shell, Bootstrap, Navigation, and PWA"
description: "Defines the implemented Chat Web App Shell, Bootstrap, Navigation, and PWA contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
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
    - id: "WEB-SHELL-MOUNT-001"
      status: "implemented"
      sources:
        - path: "src/plugins/chat-web.ts"
          symbol: "createPiboChatWebPlugin"
        - path: "src/apps/chat/web-app.ts"
          symbol: "createChatWebApp"
        - path: "src/apps/chat/web-app.ts"
          symbol: "CHAT_WEB_APP_NAME"
        - path: "src/apps/chat/web-app.ts"
          symbol: "CHAT_WEB_CHANNEL"
        - path: "src/apps/chat/chat-api-routes.ts"
          symbol: "CHAT_WEB_API_PREFIX"
        - path: "src/apps/chat/static-assets.ts"
          symbol: "CHAT_WEB_MOUNT_PATH"
        - path: "src/apps/chat/static-assets.ts"
          symbol: "responseChatAppShell"
      tests:
        - path: "test/chat-api-routes.test.mjs"
          name: "chat API route helpers parse session action resources"
      public:
        - "/apps/chat"
        - "/api/chat/auth-check"
        - "/api/chat/bootstrap"
        - "/api/chat/navigation"
        - "manifest.webmanifest"
        - "sw.js"
        - "Chat browser routes"
        - "detached PWA session window"
      failures:
        - "Unsupported methods and malformed resources fail in route parsing; auth enforcement remains SPC-SEC-001/SPC-GW-003."
        - "Accessibility/responsive boundary: The shell response supplies the application document; interactive accessibility requires later headful validation."
        - "Compatibility boundary: The mount and API prefix are public compatibility surfaces."
      confidence: "high"
    - id: "WEB-SHELL-BOOTSTRAP-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat/web-app.ts"
          symbol: "createChatWebApp"
        - path: "src/apps/chat-ui/src/app-navigation-merge.ts"
          symbol: "mergeNavigationIntoBootstrap"
        - path: "src/apps/chat-ui/src/app-navigation-merge.ts"
          symbol: "markSessionSubtreeReadInBootstrap"
        - path: "src/apps/chat-ui/src/app-navigation-merge.ts"
          symbol: "appendSessionRoots"
      tests:
        - path: "test/chat-ui-app-navigation-merge.test.mjs"
          name: "app navigation merge helpers preserve unread and append semantics"
      public:
        - "/apps/chat"
        - "/api/chat/auth-check"
        - "/api/chat/bootstrap"
        - "/api/chat/navigation"
        - "manifest.webmanifest"
        - "sw.js"
        - "Chat browser routes"
        - "detached PWA session window"
      failures:
        - "Malformed or stale navigation data must be rejected or reconciled rather than overwriting newer state."
        - "Accessibility/responsive boundary: Unread and current-state semantics must remain programmatically exposed."
        - "Compatibility boundary: New feature navigation is integrated through bootstrap/navigation composition."
      confidence: "high"
    - id: "WEB-SHELL-ROUTING-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "rootRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "sessionRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "roomRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "roomSessionRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "projectsRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "projectRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "projectSessionRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "vscodeRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "workflowsRoute"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "settingsRoute"
        - path: "src/apps/chat-ui/src/app-routes.ts"
          symbol: "chatRouteFromLocation"
        - path: "src/apps/chat-ui/src/app-routes.ts"
          symbol: "chatNavigationRequest"
        - path: "src/apps/chat-ui/src/app-routes.ts"
          symbol: "stringifyChatSearch"
        - path: "src/apps/chat-ui/src/app-routes.ts"
          symbol: "navigateToChatRoute"
        - path: "src/apps/chat-ui/src/app-storage.ts"
          symbol: "readStoredSelection"
        - path: "src/apps/chat-ui/src/app-storage.ts"
          symbol: "writeStoredSelection"
        - path: "src/apps/chat-ui/src/app-storage.ts"
          symbol: "readStoredComposerDraft"
        - path: "src/apps/chat-ui/src/app-storage.ts"
          symbol: "writeStoredComposerDraft"
      tests:
        - path: "test/chat-ui-sidebar-current-navigation.test.mjs"
          name: "Room and Session navigation buttons expose and update aria-current"
      public:
        - "/apps/chat"
        - "/api/chat/auth-check"
        - "/api/chat/bootstrap"
        - "/api/chat/navigation"
        - "manifest.webmanifest"
        - "sw.js"
        - "Chat browser routes"
        - "detached PWA session window"
      failures:
        - "Invalid route/search values must fall back without mutating server state; local storage failures are non-authoritative."
        - "Accessibility/responsive boundary: aria-current must track canonical route selection; focus behavior needs headful evidence."
        - "Compatibility boundary: Existing deep links and storage keys require migration-safe evolution."
      confidence: "high"
    - id: "WEB-SHELL-PWA-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat/static-assets.ts"
          symbol: "STATIC_ASSET_BROTLI_QUALITY"
        - path: "src/apps/chat/static-assets.ts"
          symbol: "responseBuiltChatIndex"
        - path: "src/apps/chat/static-assets.ts"
          symbol: "responseBuiltChatAsset"
        - path: "src/apps/chat/static-assets.ts"
          symbol: "responseBuiltChatPublicFile"
        - path: "src/apps/chat-ui/public/sw.js"
          symbol: "CACHE_NAME"
        - path: "src/apps/chat-ui/public/sw.js"
          symbol: "APP_SHELL_URL"
      tests:
        - path: "test/static-assets.test.mjs"
          name: "built Chat and VS Code assets use explicit deterministic compression with stable caching"
        - path: "test/chat-ui-service-worker.test.mjs"
          name: "successful Chat navigation refreshes the canonical cached shell with one network fetch"
        - path: "test/chat-ui-service-worker.test.mjs"
          name: "non-successful Chat navigation does not replace a known-good cached shell"
        - path: "test/chat-ui-service-worker.test.mjs"
          name: "failed Chat navigation falls back to the canonical cached shell"
        - path: "test/chat-ui-service-worker.test.mjs"
          name: "static Chat assets remain cache-first and cache successful misses"
        - path: "test/chat-ui-service-worker.test.mjs"
          name: "activation keeps the current Chat cache and removes older caches"
      public:
        - "/apps/chat"
        - "/api/chat/auth-check"
        - "/api/chat/bootstrap"
        - "/api/chat/navigation"
        - "manifest.webmanifest"
        - "sw.js"
        - "Chat browser routes"
        - "detached PWA session window"
      failures:
        - "Failed/non-success responses cannot replace the known-good shell; API/auth data is outside the cache contract."
        - "Accessibility/responsive boundary: Update messaging must not strand keyboard/focus state; visual update handling remains unverified."
        - "Compatibility boundary: Cache-name and shell URL changes need upgrade compatibility checks."
      confidence: "high"
    - id: "WEB-SHELL-RESPONSIVE-005"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "App"
        - path: "src/apps/chat-ui/src/pwa-session-window.ts"
          symbol: "isDesktopPwaWindow"
        - path: "src/apps/chat-ui/src/pwa-session-window.ts"
          symbol: "canOpenDesktopPwaSessionWindow"
        - path: "src/apps/chat-ui/src/pwa-session-window.ts"
          symbol: "createPwaSessionWindowTarget"
        - path: "src/apps/chat-ui/src/pwa-session-window.ts"
          symbol: "openCurrentPwaSessionWindow"
        - path: "src/apps/chat-ui/src/styles.css"
          symbol: ".session-signal-running (CSS selector)"
      tests:
        - path: "test/chat-ui-mobile-main-navigation.test.mjs"
          name: "mobile main-navigation menu has complete keyboard, focus, pointer, and desktop behavior"
        - path: "test/chat-ui-mobile-main-navigation.test.mjs"
          name: "App delegates mobile navigation focus ownership while preserving bootstrap recovery and the sidebar trigger ref"
        - path: "test/chat-ui-pwa-session-window.test.mjs"
          name: "selected-session windows are available only in desktop PWA display modes"
        - path: "test/chat-ui-pwa-session-window.test.mjs"
          name: "SessionTracePane passes the same selected-session window action to normal and fullscreen toolbars"
      public:
        - "/apps/chat"
        - "/api/chat/auth-check"
        - "/api/chat/bootstrap"
        - "/api/chat/navigation"
        - "manifest.webmanifest"
        - "sw.js"
        - "Chat browser routes"
        - "detached PWA session window"
      failures:
        - "Pop-up denial or unavailable display mode must leave the current session usable; detached targets must remain same application routes."
        - "Accessibility/responsive boundary: Source defines focus ownership and responsive sidebars; headful keyboard, pointer, zoom, and reduced-motion validation is mandatory."
        - "Compatibility boundary: Detached-window support is conditional and must degrade to in-shell navigation."
      confidence: "medium"
---
# Chat Web App Shell, Bootstrap, Navigation, and PWA

## Why

Chat API/static registration, bootstrap/navigation composition, route-addressable areas, browser-only preferences, deterministic assets and service-worker lifecycle, responsive navigation, and detached desktop-PWA session windows.

## Scope

This specification describes implemented behavior at Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

### In scope

- Owns the Chat Web mount, shell/bootstrap/navigation projection, browser route and preference behavior, built asset delivery, service-worker behavior, and detached-window UI contract.

### Out of scope

- SPC-GW-003 owns gateway mount lifecycle and request transport.
- SPC-SEC-001 owns Better Auth, machine/local/dev auth policy, and App Context authorization.
- SPC-DATA-001 owns durable records and transaction durability.
- Feature specs own each API resource; this spec only composes their navigation/bootstrap projections.

## Current behavior

### Routes and state

The plugin mounts /apps/chat and /api/chat. TanStack routes cover Sessions, Rooms, Projects, VS Code, Workflows, Agents, Cron, Loop/Ralph, Context, and Settings under /apps/chat; route parsing/canonicalization drives selection. Local storage holds only drafts, history, view preferences, and last selections.

### Cache, stream, files, and media

Static shell/assets use deterministic compression and caching. The service worker handles same-origin GET navigation under /apps/chat and Chat static assets only; it neither authorizes nor caches Chat API mutations. Live state is composed from feature services and SPC-WEB-004.

### Lifecycle and failure

Deep Chat links fall back to the SPA shell. Service-worker activation removes older Chat caches; failed navigation uses the last known-good shell. Bootstrap recovery and mobile focus ownership remain explicit. Detached windows are available only in desktop PWA display modes.

### Security

Authentication and mutation policy are consumed from SPC-SEC-001. Browser storage and caches cannot grant authority or create user-scoped product partitions.

### Accessibility and responsive behavior

Source defines aria-current navigation, keyboard/focus/pointer behavior for mobile navigation, h-dvh shell sizing, a 980px mobile sidebar transition, and reduced-motion suppression. These behaviors are not headfully verified here.

### Compatibility and integration

Deep routes, service-worker controller changes, desktop PWA display modes, and optional same-origin VS Code integration are compatibility seams. Reserved navigation-query-service claims are excluded because the current shell composes active services.

## Requirements and invariants

### Requirement: WEB-SHELL-MOUNT-001

The Chat Web plugin MUST mount the static application at /apps/chat and method-specific API routes at /api/chat; authentication and App Context decisions MUST remain delegated to the gateway/security owners.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/plugins/chat-web.ts` — `createPiboChatWebPlugin`; `src/apps/chat/web-app.ts` — `createChatWebApp`; `src/apps/chat/web-app.ts` — `CHAT_WEB_APP_NAME`; `src/apps/chat/web-app.ts` — `CHAT_WEB_CHANNEL`; `src/apps/chat/chat-api-routes.ts` — `CHAT_WEB_API_PREFIX`; `src/apps/chat/static-assets.ts` — `CHAT_WEB_MOUNT_PATH`; `src/apps/chat/static-assets.ts` — `responseChatAppShell`
- Tests: `test/chat-api-routes.test.mjs` — “chat API route helpers parse session action resources”
- Public surfaces: `/apps/chat`; `/api/chat/auth-check`; `/api/chat/bootstrap`; `/api/chat/navigation`; `manifest.webmanifest`; `sw.js`; `Chat browser routes`; `detached PWA session window`
- Failure/security boundary: Unsupported methods and malformed resources fail in route parsing; auth enforcement remains SPC-SEC-001/SPC-GW-003.
- Accessibility/responsive boundary: The shell response supplies the application document; interactive accessibility requires later headful validation.
- Compatibility boundary: The mount and API prefix are public compatibility surfaces.
- Confidence: **high**
- Verification follow-up: Run chat-api route and web-gateway tests, then verify unauthenticated and authenticated real paths without changing the auth policy in this spec.

### Requirement: WEB-SHELL-BOOTSTRAP-002

Bootstrap and navigation MUST be assembled from current registered services and live projections, preserve unread/append semantics, and MUST NOT treat a reserved navigation-query service as implemented authority.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/web-app.ts` — `createChatWebApp`; `src/apps/chat-ui/src/app-navigation-merge.ts` — `mergeNavigationIntoBootstrap`; `src/apps/chat-ui/src/app-navigation-merge.ts` — `markSessionSubtreeReadInBootstrap`; `src/apps/chat-ui/src/app-navigation-merge.ts` — `appendSessionRoots`
- Tests: `test/chat-ui-app-navigation-merge.test.mjs` — “app navigation merge helpers preserve unread and append semantics”
- Public surfaces: `/apps/chat`; `/api/chat/auth-check`; `/api/chat/bootstrap`; `/api/chat/navigation`; `manifest.webmanifest`; `sw.js`; `Chat browser routes`; `detached PWA session window`
- Failure/security boundary: Malformed or stale navigation data must be rejected or reconciled rather than overwriting newer state.
- Accessibility/responsive boundary: Unread and current-state semantics must remain programmatically exposed.
- Compatibility boundary: New feature navigation is integrated through bootstrap/navigation composition.
- Confidence: **high**
- Verification follow-up: Execute navigation merge plus Chat Web session/bootstrap tests and compare the API schemas with the rendered sidebar projection.

### Requirement: WEB-SHELL-ROUTING-003

The client MUST canonicalize URL-derived area, Room, Project, Session, workflow, and settings selection, expose current navigation semantics, and isolate local drafts/history/view preferences from canonical product state.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/main.tsx` — `rootRoute`; `src/apps/chat-ui/src/main.tsx` — `sessionRoute`; `src/apps/chat-ui/src/main.tsx` — `roomRoute`; `src/apps/chat-ui/src/main.tsx` — `roomSessionRoute`; `src/apps/chat-ui/src/main.tsx` — `projectsRoute`; `src/apps/chat-ui/src/main.tsx` — `projectRoute`; `src/apps/chat-ui/src/main.tsx` — `projectSessionRoute`; `src/apps/chat-ui/src/main.tsx` — `vscodeRoute`; `src/apps/chat-ui/src/main.tsx` — `workflowsRoute`; `src/apps/chat-ui/src/main.tsx` — `settingsRoute`; `src/apps/chat-ui/src/app-routes.ts` — `chatRouteFromLocation`; `src/apps/chat-ui/src/app-routes.ts` — `chatNavigationRequest`; `src/apps/chat-ui/src/app-routes.ts` — `stringifyChatSearch`; `src/apps/chat-ui/src/app-routes.ts` — `navigateToChatRoute`; `src/apps/chat-ui/src/app-storage.ts` — `readStoredSelection`; `src/apps/chat-ui/src/app-storage.ts` — `writeStoredSelection`; `src/apps/chat-ui/src/app-storage.ts` — `readStoredComposerDraft`; `src/apps/chat-ui/src/app-storage.ts` — `writeStoredComposerDraft`
- Tests: `test/chat-ui-sidebar-current-navigation.test.mjs` — “Room and Session navigation buttons expose and update aria-current”
- Public surfaces: `/apps/chat`; `/api/chat/auth-check`; `/api/chat/bootstrap`; `/api/chat/navigation`; `manifest.webmanifest`; `sw.js`; `Chat browser routes`; `detached PWA session window`
- Failure/security boundary: Invalid route/search values must fall back without mutating server state; local storage failures are non-authoritative.
- Accessibility/responsive boundary: aria-current must track canonical route selection; focus behavior needs headful evidence.
- Compatibility boundary: Existing deep links and storage keys require migration-safe evolution.
- Confidence: **high**
- Verification follow-up: Run route/storage unit tests and headfully exercise direct deep links, back/forward, refresh, and cross-area selection.

### Requirement: WEB-SHELL-PWA-004

Built Chat assets MUST use deterministic bounded compression/cache policy, and the service worker MUST keep a canonical known-good Chat shell, cache successful same-origin Chat static misses, and remove older Chat caches on activation.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/static-assets.ts` — `STATIC_ASSET_BROTLI_QUALITY`; `src/apps/chat/static-assets.ts` — `responseBuiltChatIndex`; `src/apps/chat/static-assets.ts` — `responseBuiltChatAsset`; `src/apps/chat/static-assets.ts` — `responseBuiltChatPublicFile`; `src/apps/chat-ui/public/sw.js` — `CACHE_NAME`; `src/apps/chat-ui/public/sw.js` — `APP_SHELL_URL`
- Tests: `test/static-assets.test.mjs` — “built Chat and VS Code assets use explicit deterministic compression with stable caching”; `test/chat-ui-service-worker.test.mjs` — “successful Chat navigation refreshes the canonical cached shell with one network fetch”; `test/chat-ui-service-worker.test.mjs` — “non-successful Chat navigation does not replace a known-good cached shell”; `test/chat-ui-service-worker.test.mjs` — “failed Chat navigation falls back to the canonical cached shell”; `test/chat-ui-service-worker.test.mjs` — “static Chat assets remain cache-first and cache successful misses”; `test/chat-ui-service-worker.test.mjs` — “activation keeps the current Chat cache and removes older caches”
- Public surfaces: `/apps/chat`; `/api/chat/auth-check`; `/api/chat/bootstrap`; `/api/chat/navigation`; `manifest.webmanifest`; `sw.js`; `Chat browser routes`; `detached PWA session window`
- Failure/security boundary: Failed/non-success responses cannot replace the known-good shell; API/auth data is outside the cache contract.
- Accessibility/responsive boundary: Update messaging must not strand keyboard/focus state; visual update handling remains unverified.
- Compatibility boundary: Cache-name and shell URL changes need upgrade compatibility checks.
- Confidence: **high**
- Verification follow-up: Execute static/service-worker tests, build Chat assets, and inspect network/cache behavior through CDP on install, refresh, failure, and upgrade.

### Requirement: WEB-SHELL-RESPONSIVE-005

The shell MUST provide desktop and mobile navigation behavior and MAY open the selected Session in a detached window only when a desktop PWA display mode is active.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/App.tsx` — `App`; `src/apps/chat-ui/src/pwa-session-window.ts` — `isDesktopPwaWindow`; `src/apps/chat-ui/src/pwa-session-window.ts` — `canOpenDesktopPwaSessionWindow`; `src/apps/chat-ui/src/pwa-session-window.ts` — `createPwaSessionWindowTarget`; `src/apps/chat-ui/src/pwa-session-window.ts` — `openCurrentPwaSessionWindow`; `src/apps/chat-ui/src/styles.css` — `.session-signal-running (CSS selector)`
- Tests: `test/chat-ui-mobile-main-navigation.test.mjs` — “mobile main-navigation menu has complete keyboard, focus, pointer, and desktop behavior”; `test/chat-ui-mobile-main-navigation.test.mjs` — “App delegates mobile navigation focus ownership while preserving bootstrap recovery and the sidebar trigger ref”; `test/chat-ui-pwa-session-window.test.mjs` — “selected-session windows are available only in desktop PWA display modes”; `test/chat-ui-pwa-session-window.test.mjs` — “SessionTracePane passes the same selected-session window action to normal and fullscreen toolbars”
- Public surfaces: `/apps/chat`; `/api/chat/auth-check`; `/api/chat/bootstrap`; `/api/chat/navigation`; `manifest.webmanifest`; `sw.js`; `Chat browser routes`; `detached PWA session window`
- Failure/security boundary: Pop-up denial or unavailable display mode must leave the current session usable; detached targets must remain same application routes.
- Accessibility/responsive boundary: Source defines focus ownership and responsive sidebars; headful keyboard, pointer, zoom, and reduced-motion validation is mandatory.
- Compatibility boundary: Detached-window support is conditional and must degrade to in-shell navigation.
- Confidence: **medium**
- Verification follow-up: Run the named tests, then use a headful authenticated browser at mobile/desktop widths and installed/standalone display modes.

## Interfaces and ownership

**Capability IDs:** pibo.chat-web.backend

**Public surfaces:**

- /apps/chat
- /api/chat/auth-check
- /api/chat/bootstrap
- /api/chat/navigation
- manifest.webmanifest
- sw.js
- Chat browser routes
- detached PWA session window

**Non-owned links:**

- SPC-GW-003 owns gateway mount lifecycle and request transport.
- SPC-SEC-001 owns Better Auth, machine/local/dev auth policy, and App Context authorization.
- SPC-DATA-001 owns durable records and transaction durability.
- Feature specs own each API resource; this spec only composes their navigation/bootstrap projections.

## Failure and security behavior

- Deep Chat links fall back to the SPA shell. Service-worker activation removes older Chat caches; failed navigation uses the last known-good shell. Bootstrap recovery and mobile focus ownership remain explicit. Detached windows are available only in desktop PWA display modes.
- Authentication and mutation policy are consumed from SPC-SEC-001. Browser storage and caches cannot grant authority or create user-scoped product partitions.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Source defines aria-current navigation, keyboard/focus/pointer behavior for mobile navigation, h-dvh shell sizing, a 980px mobile sidebar transition, and reduced-motion suppression. These behaviors are not headfully verified here.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Deep routes, service-worker controller changes, desktop PWA display modes, and optional same-origin VS Code integration are compatibility seams. Reserved navigation-query-service claims are excluded because the current shell composes active services.

## Known limits

- Evidence gap: No headful evidence for mobile focus, desktop PWA detached windows, controller updates, or deep-link fallback.
- Evidence gap: No executed build confirms current generated Chat assets match source.

## Reconciled stale claims

- Reject: Authenticated accounts receive separate Room/Project/read-state partitions.
- Reject: A reserved navigation-query service is current navigation authority.
- Reject: Browser preference storage is durable product state.
- Reject: The service worker caches API/auth traffic or cross-origin resources.
- Reject: Source inspection visually verifies responsive or PWA behavior.

## Verification and traceability

- Source and named-test locators resolve to regular files at Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Imported or re-exported symbols use their canonical Foundation definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/chat-api-routes.test.mjs test/web-gateway.test.mjs test/static-assets.test.mjs test/chat-ui-app-navigation-merge.test.mjs test/chat-ui-sidebar-current-navigation.test.mjs test/chat-ui-mobile-main-navigation.test.mjs test/chat-ui-service-worker.test.mjs test/chat-ui-pwa-session-window.test.mjs`

## Related concepts

- SPC-GW-003
- SPC-DATA-001
- SPC-SEC-001
- SPC-WEB-004
