---
type: "Specification"
title: "Embedded VS Code Web Area"
description: "Defines the implemented Embedded VS Code Web Area contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
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
    - id: "WEB-VSCODE-NAVIGATION-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "App"
        - path: "src/apps/chat-ui/src/main.tsx"
          symbol: "vscodeRoute"
        - path: "src/apps/chat/web-app.ts"
          symbol: "resolveChatWebIntegrations"
      tests:
        - path: "test/chat-ui-main-navigation-current.test.mjs"
          name: "desktop and mobile main navigation identify the active area"
        - path: "test/chat-ui-main-navigation-current.test.mjs"
          name: "main navigation hides VS Code without changing the existing account-label breakpoint"
      public:
        - "/apps/chat/vscode"
        - "VscodeArea"
        - "bootstrap.integrations.vscodeWeb"
      failures:
        - "Missing integration hides navigation and direct use must fall back safely."
        - "Accessibility/responsive boundary: aria-current, mobile menu focus, and account-label breakpoints need headful confirmation."
        - "Compatibility boundary: The optional integration must not perturb existing navigation when absent."
      confidence: "high"
    - id: "WEB-VSCODE-FAILURE-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/VscodeArea.tsx"
          symbol: "vscodeWorkbenchReady"
        - path: "src/apps/chat-ui/src/VscodeArea.tsx"
          symbol: "VscodeArea"
      tests:
        - path: "test/chat-ui-vscode-area.test.mjs"
          name: "VS Code area provides a configured-state fallback and trusted IDE iframe controls"
      public:
        - "/apps/chat/vscode"
        - "VscodeArea"
        - "bootstrap.integrations.vscodeWeb"
      failures:
        - "Probe/load/readiness failure yields an alert/retry without exposing a false ready iframe."
        - "Accessibility/responsive boundary: Loading status, error alert, retry focus, iframe title, aria-hidden, and tabIndex are normative; headful evidence pending."
        - "Compatibility boundary: Workbench readiness recognizes current standard theme/body signals."
      confidence: "high"
    - id: "WEB-VSCODE-EMBED-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat/web-app.ts"
          symbol: "resolveVscodeWebUrl"
        - path: "src/apps/chat-ui/src/VscodeArea.tsx"
          symbol: "vscodeWebUrl"
        - path: "src/apps/chat-ui/src/VscodeArea.tsx"
          symbol: "VscodeArea"
      tests:
        - path: "test/chat-ui-vscode-area.test.mjs"
          name: "VS Code Web helpers validate URLs and standard workbench themes"
        - path: "test/chat-ui-vscode-area.test.mjs"
          name: "VS Code area provides a configured-state fallback and trusted IDE iframe controls"
      public:
        - "/apps/chat/vscode"
        - "VscodeArea"
        - "bootstrap.integrations.vscodeWeb"
      failures:
        - "Cross-origin, malformed, or unconfigured URLs fail closed; permissions cannot expand silently."
        - "Accessibility/responsive boundary: Iframe title and pre-ready focus exclusion require headful checks."
        - "Compatibility boundary: Configured base-path format is a gateway/Web compatibility contract."
      confidence: "high"
    - id: "WEB-VSCODE-BOUNDARY-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/VscodeArea.tsx"
          symbol: "VscodeArea"
        - path: "src/apps/chat/web-app.ts"
          symbol: "resolveChatWebIntegrations"
      source_inspected: true
      follow_up: "During implementation review, grep the resulting spec for extension/webview/sidecar requirements and cross-link any such behavior to its owning VS Code extension specification; headfully validate only the iframe area."
      public:
        - "/apps/chat/vscode"
        - "VscodeArea"
        - "bootstrap.integrations.vscodeWeb"
      failures:
        - "No browser message bridge or extension privilege may be inferred from iframe presence."
        - "Accessibility/responsive boundary: Only area/iframe accessibility is in scope; extension UI accessibility is not."
        - "Compatibility boundary: VS Code extension internals require a separate owner and evidence set."
      confidence: "medium"
---
# Embedded VS Code Web Area

## Why

Conditional VS Code navigation, configured/empty/error/ready states, and a constrained same-origin code-server iframe.

## Scope

This specification describes implemented behavior at upstream/dev refresh traceability commit `39090b8850758293e69380a52bb7498d7c955bc2`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

### In scope

- Owns only the Chat Web navigation area, integration readiness UI, same-origin iframe construction, and bounded empty/error behavior.

### Out of scope

- SPC-GW-003 owns route/proxy mount and code-server availability.
- SPC-SEC-001 owns authentication/origin policy.
- VS Code extension, sidecar, extension webview transport, and extension internals are explicitly excluded.

## Current behavior

### Routes and state

The /apps/chat/vscode route and main-navigation entry exist only when bootstrap exposes a configured integration. Folder/workbench query construction stays under the configured same-origin base path.

### Cache, stream, files, and media

No independent durable/cache/stream/file/media contract; the iframe consumes the configured code-server Web surface.

### Lifecycle and failure

Unconfigured state is bounded. Configured state probes readiness, waits up to the source-defined window for workbench DOM, exposes retry on error, and keeps the iframe hidden/non-tabbable until ready.

### Security

Only configured same-origin code-server URLs are accepted; iframe permissions are constrained to clipboard read/write. No extension transport is specified.

### Accessibility and responsive behavior

The area has a labeled main region, role=status loading, role=alert error, titled iframe, and hidden/tabIndex state before readiness. No headful iframe/focus/responsive validation ran.

### Compatibility and integration

Standard workbench themes and same-origin paths are recognized. Hiding the integration must not alter existing account-label breakpoint behavior.

## Requirements and invariants

### Requirement: WEB-VSCODE-NAVIGATION-001

The Chat main navigation MUST expose the VS Code area only when bootstrap contains a configured VS Code Web integration, and the route MUST retain current-area semantics without changing unrelated responsive labels.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/App.tsx` — `App`; `src/apps/chat-ui/src/main.tsx` — `vscodeRoute`; `src/apps/chat/web-app.ts` — `resolveChatWebIntegrations`
- Tests: `test/chat-ui-main-navigation-current.test.mjs` — “desktop and mobile main navigation identify the active area”; `test/chat-ui-main-navigation-current.test.mjs` — “main navigation hides VS Code without changing the existing account-label breakpoint”
- Public surfaces: `/apps/chat/vscode`; `VscodeArea`; `bootstrap.integrations.vscodeWeb`
- Failure/security boundary: Missing integration hides navigation and direct use must fall back safely.
- Accessibility/responsive boundary: aria-current, mobile menu focus, and account-label breakpoints need headful confirmation.
- Compatibility boundary: The optional integration must not perturb existing navigation when absent.
- Confidence: **high**
- Verification follow-up: Run navigation tests and headfully verify configured/unconfigured desktop/mobile menus, direct route, refresh, and focus.

### Requirement: WEB-VSCODE-FAILURE-002

The area MUST provide bounded unconfigured, loading, timeout/error, and retry states and MUST keep the iframe hidden and non-tabbable until a standard workbench-ready document is detected.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/VscodeArea.tsx` — `vscodeWorkbenchReady`; `src/apps/chat-ui/src/VscodeArea.tsx` — `VscodeArea`
- Tests: `test/chat-ui-vscode-area.test.mjs` — “VS Code area provides a configured-state fallback and trusted IDE iframe controls”
- Public surfaces: `/apps/chat/vscode`; `VscodeArea`; `bootstrap.integrations.vscodeWeb`
- Failure/security boundary: Probe/load/readiness failure yields an alert/retry without exposing a false ready iframe.
- Accessibility/responsive boundary: Loading status, error alert, retry focus, iframe title, aria-hidden, and tabIndex are normative; headful evidence pending.
- Compatibility boundary: Workbench readiness recognizes current standard theme/body signals.
- Confidence: **high**
- Verification follow-up: Run VS Code area tests with deterministic probe/iframe documents, then headfully test timeout, error, retry, slow load, focus, and ready transitions.

### Requirement: WEB-VSCODE-EMBED-003

Configured iframe URLs MUST resolve beneath the approved same-origin code-server base path, preserve an optional folder target, and grant only the declared clipboard permissions.

#### Current

upstream/dev refresh source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat/web-app.ts` — `resolveVscodeWebUrl`; `src/apps/chat-ui/src/VscodeArea.tsx` — `vscodeWebUrl`; `src/apps/chat-ui/src/VscodeArea.tsx` — `VscodeArea`
- Tests: `test/chat-ui-vscode-area.test.mjs` — “VS Code Web helpers validate URLs and standard workbench themes”; `test/chat-ui-vscode-area.test.mjs` — “VS Code area provides a configured-state fallback and trusted IDE iframe controls”
- Public surfaces: `/apps/chat/vscode`; `VscodeArea`; `bootstrap.integrations.vscodeWeb`
- Failure/security boundary: Cross-origin, malformed, or unconfigured URLs fail closed; permissions cannot expand silently.
- Accessibility/responsive boundary: Iframe title and pre-ready focus exclusion require headful checks.
- Compatibility boundary: Configured base-path format is a gateway/Web compatibility contract.
- Confidence: **high**
- Verification follow-up: Run URL/area tests and add origin/path/query/folder traversal cases; inspect final iframe URL and permissions through CDP in an isolated real path.

### Requirement: WEB-VSCODE-BOUNDARY-004

This specification MUST stop at the embedded same-origin code-server area and MUST NOT define VS Code extension webview messaging, sidecar transport, extension lifecycle, or extension-internal authentication.

#### Current

upstream/dev refresh source inspection defines the current contract. No named test exists in the evidence set, so this requirement remains an explicit source-only gap and makes no focused-test claim.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/VscodeArea.tsx` — `VscodeArea`; `src/apps/chat/web-app.ts` — `resolveChatWebIntegrations`
- Tests: No named test exists in the upstream/dev refresh evidence set; this requirement remains source-only.
- Public surfaces: `/apps/chat/vscode`; `VscodeArea`; `bootstrap.integrations.vscodeWeb`
- Failure/security boundary: No browser message bridge or extension privilege may be inferred from iframe presence.
- Accessibility/responsive boundary: Only area/iframe accessibility is in scope; extension UI accessibility is not.
- Compatibility boundary: VS Code extension internals require a separate owner and evidence set.
- Confidence: **medium**
- Verification follow-up: During implementation review, grep the resulting spec for extension/webview/sidecar requirements and cross-link any such behavior to its owning VS Code extension specification; headfully validate only the iframe area.

## Interfaces and ownership

**Capability IDs:** None; this concept projects capabilities owned by linked services.

**Public surfaces:**

- /apps/chat/vscode
- VscodeArea
- bootstrap.integrations.vscodeWeb

**Non-owned links:**

- SPC-GW-003 owns route/proxy mount and code-server availability.
- SPC-SEC-001 owns authentication/origin policy.
- VS Code extension, sidecar, extension webview transport, and extension internals are explicitly excluded.

## Failure and security behavior

- Unconfigured state is bounded. Configured state probes readiness, waits up to the source-defined window for workbench DOM, exposes retry on error, and keeps the iframe hidden/non-tabbable until ready.
- Only configured same-origin code-server URLs are accepted; iframe permissions are constrained to clipboard read/write. No extension transport is specified.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

The area has a labeled main region, role=status loading, role=alert error, titled iframe, and hidden/tabIndex state before readiness. No headful iframe/focus/responsive validation ran.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Standard workbench themes and same-origin paths are recognized. Hiding the integration must not alter existing account-label breakpoint behavior.

## Known limits

- Evidence gap: No headful configured/unconfigured/loading/error/retry/ready iframe path.
- Evidence gap: No real same-origin code-server integration or gateway proxy acceptance.

## Reconciled stale claims

- Reject: VS Code navigation is always shown.
- Reject: An arbitrary external code-server origin may be embedded.
- Reject: The Chat area specifies VS Code extension webview/sidecar internals.
- Reject: Source/unit tests prove iframe visual readiness.

## Verification and traceability

- Source and named-test locators resolve to regular files at upstream/dev refresh commit `39090b8850758293e69380a52bb7498d7c955bc2`.
- Imported or re-exported symbols use their canonical upstream/dev refresh definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/chat-ui-vscode-area.test.mjs test/chat-ui-main-navigation-current.test.mjs`

## Related concepts

- SPC-WEB-001
- SPC-GW-003
- SPC-SEC-001
