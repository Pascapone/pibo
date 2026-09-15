---
type: "Specification"
title: "Chat Web Context, Settings, and Agent Designer"
description: "Defines the implemented Chat Web Context, Settings, and Agent Designer contract, including its ownership, source/test/public/failure/accessibility/compatibility boundaries, and explicit evidence limits."
tags:
- web
- chat-web
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-15T21:05:00Z"
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
  visual_provider_gateway_pibo2_execution: "Settings scrolling was validated headfully at desktop 1440×900 and mobile 390×844 in an isolated worker; provider, production gateway, and Pibo2 execution remain unperformed."
traceability:
  commit: "c6e3943096bd45158393d59519b525b4365679c7"
  requirements:
    - id: "WEB-CONFIG-CONTEXT-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/plugins/build-context-view.tsx"
          symbol: "BuildContextView"
        - path: "src/apps/chat-ui/src/plugins/build-context-view.tsx"
          symbol: "recordedBuildNodes"
        - path: "src/apps/chat-ui/src/plugins/build-context-view.tsx"
          symbol: "renderPluginNodeModelContentForCopy"
      tests:
        - path: "test/chat-ui-context-build-origin.test.mjs"
          name: "plugin Build Context distinguishes inspector metadata from model content"
        - path: "test/chat-ui-context-build-origin.test.mjs"
          name: "plugin Build Context copy output includes only visible unredacted model text"
      public:
        - "/api/chat/context-build*"
        - "/api/chat/agents*"
        - "/api/chat/agent-folders*"
        - "/api/chat/catalog*"
        - "/api/chat/settings*"
        - "BuildContextView"
        - "ContextFilesView"
        - "AgentsView"
        - "SettingsView"
      failures:
        - "Missing/malformed origin metadata must not become delivered content or break copy output."
        - "Accessibility/responsive boundary: Tree/detail labels, copy feedback, and long preformatted content need headful checks."
        - "Compatibility boundary: Actual context assembly semantics remain its resource/runtime owners."
      confidence: "high"
    - id: "WEB-CONFIG-EDIT-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/context/ContextFilesView.tsx"
          symbol: "ContextFilesView"
      source_inspected: true
      follow_up: "Add and run focused tests for clean save, stale revision conflict, diff, reload, selection preservation, and same-origin rejection; then validate the responsive editor headfully."
      public:
        - "/api/chat/context-build*"
        - "/api/chat/agents*"
        - "/api/chat/agent-folders*"
        - "/api/chat/catalog*"
        - "/api/chat/settings*"
        - "BuildContextView"
        - "ContextFilesView"
        - "AgentsView"
        - "SettingsView"
      failures:
        - "Stale revisions must fail visibly; failed saves cannot advance local revision or discard the user's buffer."
        - "Accessibility/responsive boundary: Editor/panel labels, conflict focus, keyboard editing, and 1180/640px layouts require headful evidence."
        - "Compatibility boundary: Managed storage/revision durability remains SPC-RES-003/SPC-DATA-001."
      confidence: "medium"
    - id: "WEB-CONFIG-AGENTS-003"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/agents/AgentsView.tsx"
          symbol: "AgentsView"
        - path: "src/apps/chat-ui/src/agents/agent-designer-model.ts"
          symbol: "agentDraftToSaveInput"
        - path: "src/apps/chat-ui/src/agents/agent-designer-model.ts"
          symbol: "selectExistingAgentDraft"
        - path: "src/apps/chat-ui/src/agents/agent-designer-model.ts"
          symbol: "createBlankAgentDraft"
        - path: "src/apps/chat-ui/src/agents/designer-ui.tsx"
          symbol: "AgentRuntimeSelector"
        - path: "src/apps/chat-ui/src/agents/designer-ui.tsx"
          symbol: "SchemaRuntimeOptionsFields"
        - path: "src/apps/chat-ui/src/agents/designer-ui.tsx"
          symbol: "AgentRuntimeOptions"
      tests:
        - path: "test/chat-ui-agent-designer-runtime-switch.test.mjs"
          name: "Agent Designer drops only model selections unsupported by the selected runtime"
        - path: "test/chat-ui-agent-designer-runtime-switch.test.mjs"
          name: "Agent Designer serializes cleared model selections so PATCH removes persisted overrides"
        - path: "test/chat-ui-agent-designer-runtime-switch.test.mjs"
          name: "agent PATCH normalization preserves explicit null model clears"
      public:
        - "/api/chat/context-build*"
        - "/api/chat/agents*"
        - "/api/chat/agent-folders*"
        - "/api/chat/catalog*"
        - "/api/chat/settings*"
        - "BuildContextView"
        - "ContextFilesView"
        - "AgentsView"
        - "SettingsView"
      failures:
        - "Unsupported values must be removed explicitly; catalog failure cannot be treated as a valid empty catalog; secrets stay server-side."
        - "Accessibility/responsive boundary: Forms need labels/errors/focus and non-color-only dirty/unsupported state."
        - "Compatibility boundary: Runtime/catalog semantics remain SPC-RUN-008."
      confidence: "high"
    - id: "WEB-CONFIG-SETTINGS-004"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/settings/SettingsView.tsx"
          symbol: "SettingsView"
        - path: "src/apps/chat-ui/src/settings/types.ts"
          symbol: "SettingsPanel"
        - path: "src/apps/chat-ui/src/settings/SettingsSidebar.tsx"
          symbol: "SettingsSidebar"
        - path: "src/apps/chat-ui/src/plugins/builtin-browser-entry.tsx"
          symbol: "FirstPartySubviewNavigation"
        - path: "src/apps/chat-ui/src/responsive-pane-sidebar.tsx"
          symbol: "ResponsiveTabSidebarPanel"
        - path: "src/apps/chat-ui/src/context/ContextFilesView.tsx"
          symbol: "ContextFilesView"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "ChatSettingsRoute"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "chatSettingsRoute"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "chatSettingsRouteInvalidatesBootstrapCatalog"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "handleChatSettingsRoute"
      tests:
        - path: "test/chat-ui-responsive-tab-modules.test.mjs"
          name: "desktop module tabs use pane-width sidebars and container-responsive content flows"
        - path: "test/chat-ui-settings-room-regressions.test.mjs"
          name: "Settings owns a viewport-bounded scroll panel instead of clipping long content"
      source_inspected: true
      follow_up: "Add and run a route/panel matrix test covering all eleven panel IDs, read/write methods, same-origin requirements, scopes, invalidation, and failures; retain focused headful navigation evidence for wide, narrow, and mobile tab containers."
      public:
        - "/api/chat/context-build*"
        - "/api/chat/agents*"
        - "/api/chat/agent-folders*"
        - "/api/chat/catalog*"
        - "/api/chat/settings*"
        - "BuildContextView"
        - "ContextFilesView"
        - "AgentsView"
        - "SettingsView"
      failures:
        - "Unknown panels/methods fail explicitly; failed mutations cannot update optimistic settings or stale capability catalogs."
        - "Accessibility/responsive boundary: Sidebar current state, form labels/errors, drawer focus return, and container-width transitions require focused headful validation."
        - "Compatibility boundary: Panel IDs/routes are compatibility surfaces; owner specs define each underlying setting."
      confidence: "medium"
    - id: "WEB-CONFIG-CREDENTIALS-005"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/settings/ProviderSettingsView.tsx"
          symbol: "ProviderSettingsView"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "chatSettingsRouteRequiresSameOrigin"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "handleChatSettingsRoute"
      tests:
        - path: "test/chat-ui-provider-auth-methods.test.mjs"
          name: "provider settings and model surfaces are runtime-catalog driven instead of a hard-coded global provider list"
      public:
        - "/api/chat/context-build*"
        - "/api/chat/agents*"
        - "/api/chat/agent-folders*"
        - "/api/chat/catalog*"
        - "/api/chat/settings*"
        - "BuildContextView"
        - "ContextFilesView"
        - "AgentsView"
        - "SettingsView"
      failures:
        - "Credentials never round-trip; failed catalog/auth status remains a visible failure, not empty authority."
        - "Accessibility/responsive boundary: Auth-method and effect status must be textual and keyboard reachable."
        - "Compatibility boundary: Credentials/providers are SPC-RES-005/SPC-RUN-008/SPC-SEC-001; Web owns only safe configuration UX."
      confidence: "high"
---
# Chat Web Context, Settings, and Agent Designer

## Why

Actual context-build inspection, revision-safe managed context editing, runtime-aware Agent Designer, complete settings panels/scopes, and credential/effect boundaries.

## Scope

This specification describes implemented behavior at Foundation traceability commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`. Its package parent is accepted base `ba3c2d6611ce8d234f887135af605837333bf751`; the stale brief baseline is not authority.

### In scope

- Owns Web inspection/editing UX, runtime-aware Agent Designer behavior, settings information architecture/scopes, and visible current-versus-future effect language.

### Out of scope

- SPC-RUN-008 owns runtime/provider/model/auth resolution and capability semantics.
- SPC-RES-003 owns managed resource/context storage semantics.
- SPC-RES-005 owns provider adapters, catalogs, and credentials.
- SPC-SEC-001 owns auth policy and secret handling.
- SPC-DATA-001 owns durable revision persistence.

## Current behavior

### Routes and state

Context build is read-only inspection; managed files use revision/diff/conflict APIs; Agents use runtime-derived schemas; Settings routes identify panel and scope.

### Cache, stream, files, and media

Catalog/settings invalidation refreshes affected bootstrap capability data. Media provider settings link to SPC-WEB-003/RES owners.

### Lifecycle and failure

Revision conflicts surface diff/reload choices. Runtime switch removes only unsupported model values; explicit null clears persisted overrides. Catalog failure is not an authoritative empty catalog.

### Security

Origin metadata is inspector-only and excluded from copied context. Credentials are never echoed; same-origin mutation checks apply.

### Accessibility and responsive behavior

First-party plugin tabs with stable sections or selectable entities use tab-container width, not browser viewport width, to keep a left sidebar or switch to a tab-local drawer. The drawer keeps a visible reopen control, traps and restores focus, closes on Escape or backdrop activation, and preserves the active subview. Context Files applies the same container rule to its nested file panel. Focused wide, narrow, and mobile browser checks are recorded outside this specification; physical-device and assistive-technology acceptance remain open.

### Compatibility and integration

Runtime option schemas/catalogs drive UI; unknown capabilities must degrade without hard-coded global provider assumptions. Settings distinguish current Session effects from future-session defaults. First-party self-navigation suppresses only the duplicate host subview row for an explicit built-in view list; third-party renderers retain their own layout and the generic host fallback.

### First-party tab navigation inventory

| First-party view | Implemented navigation |
|---|---|
| Settings | Responsive left section sidebar or local drawer; all eleven declared panel IDs retain their subview IDs. |
| User Resources / Context | Responsive left section sidebar or local drawer for Context Files, Skills, Base Prompt, and Compaction Prompt; Context Files keeps its own container-responsive file panel. |
| Agent Designer | Existing responsive left agent/folder sidebar or local drawer. |
| Cron and Loops | Existing responsive left job sidebar or local drawer. |
| Web Annotations | Responsive left section sidebar or local drawer for Annotations, Settings, and Context. |
| First-party tool-family compatibility views | Responsive left section sidebar or local drawer for Settings and Context. |
| Workflows | Intentionally navigation-free at the tab shell: one authoring surface owns its workflow picker, canvas, and inspectors. |
| Build Context | Intentionally navigation-free: one read-only inspector owns its recorded-build selector and node disclosures. |
| Standard Shell | Not a tab view; it provides composition only. |

## Requirements and invariants

### Requirement: WEB-CONFIG-CONTEXT-001

Build Context MUST show recorded or preview plugin context nodes and their origin metadata for inspection while excluding inspector-only metadata from copied model content.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/plugins/build-context-view.tsx` — `BuildContextView`; `src/apps/chat-ui/src/plugins/build-context-view.tsx` — `recordedBuildNodes`; `src/apps/chat-ui/src/plugins/build-context-view.tsx` — `renderPluginNodeModelContentForCopy`
- Tests: `test/chat-ui-context-build-origin.test.mjs` — “plugin Build Context distinguishes inspector metadata from model content”; `test/chat-ui-context-build-origin.test.mjs` — “plugin Build Context copy output includes only visible unredacted model text”
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `BuildContextView`; `ContextFilesView`; `AgentsView`; `SettingsView`
- Failure/security boundary: Missing/malformed origin metadata must not become delivered content or break copy output.
- Accessibility/responsive boundary: Tree/detail labels, copy feedback, and long preformatted content need headful checks.
- Compatibility boundary: Actual context assembly semantics remain its resource/runtime owners.
- Confidence: **high**
- Verification follow-up: Run context-origin tests and compare inspected/copied output against a deterministic server context-build fixture.

### Requirement: WEB-CONFIG-EDIT-002

Managed context editing MUST use revision-aware read/save/diff APIs, surface conflicts, preserve selected files, and require explicit reload or conflict resolution rather than silently overwriting newer content.

#### Current

Foundation source inspection defines the current contract. No named test exists in the evidence set, so this requirement remains an explicit source-only gap and makes no focused-test claim.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/context/ContextFilesView.tsx` — `ContextFilesView`
- Tests: No named test exists in the Foundation evidence set; this requirement remains source-only.
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `BuildContextView`; `ContextFilesView`; `AgentsView`; `SettingsView`
- Failure/security boundary: Stale revisions must fail visibly; failed saves cannot advance local revision or discard the user's buffer.
- Accessibility/responsive boundary: Editor/panel labels, conflict focus, keyboard editing, and 1180/640px layouts require headful evidence.
- Compatibility boundary: Managed storage/revision durability remains SPC-RES-003/SPC-DATA-001.
- Confidence: **medium**
- Verification follow-up: Add and run focused tests for clean save, stale revision conflict, diff, reload, selection preservation, and same-origin rejection; then validate the responsive editor headfully.

### Requirement: WEB-CONFIG-AGENTS-003

Agent Designer MUST derive runtime/model/options fields from the runtime catalog, drop only values unsupported by a runtime switch, and serialize explicit null model clears so persisted overrides are removed.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/agents/AgentsView.tsx` — `AgentsView`; `src/apps/chat-ui/src/agents/agent-designer-model.ts` — `agentDraftToSaveInput`; `src/apps/chat-ui/src/agents/agent-designer-model.ts` — `selectExistingAgentDraft`; `src/apps/chat-ui/src/agents/agent-designer-model.ts` — `createBlankAgentDraft`; `src/apps/chat-ui/src/agents/designer-ui.tsx` — `AgentRuntimeSelector`; `src/apps/chat-ui/src/agents/designer-ui.tsx` — `SchemaRuntimeOptionsFields`; `src/apps/chat-ui/src/agents/designer-ui.tsx` — `AgentRuntimeOptions`
- Tests: `test/chat-ui-agent-designer-runtime-switch.test.mjs` — “Agent Designer drops only model selections unsupported by the selected runtime”; `test/chat-ui-agent-designer-runtime-switch.test.mjs` — “Agent Designer serializes cleared model selections so PATCH removes persisted overrides”; `test/chat-ui-agent-designer-runtime-switch.test.mjs` — “agent PATCH normalization preserves explicit null model clears”
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `BuildContextView`; `ContextFilesView`; `AgentsView`; `SettingsView`
- Failure/security boundary: Unsupported values must be removed explicitly; catalog failure cannot be treated as a valid empty catalog; secrets stay server-side.
- Accessibility/responsive boundary: Forms need labels/errors/focus and non-color-only dirty/unsupported state.
- Compatibility boundary: Runtime/catalog semantics remain SPC-RUN-008.
- Confidence: **high**
- Verification follow-up: Run designer tests with each registered runtime schema; headfully validate runtime switching, dirty state, errors, and mobile sidebar.

### Requirement: WEB-CONFIG-SETTINGS-004

Settings MUST expose the implemented panel set—general, plugins, debug, concurrency, previews, transcription, speech, shortcuts, maintenance, skills, and providers—and preserve each subview's declared scope and bootstrap invalidation behavior. Settings and every other first-party tab with stable sections or selectable entities MUST use container-responsive left navigation with a local narrow drawer rather than viewport-only or duplicate top navigation. The selected Settings panel MUST own a viewport-bounded `h-full min-h-0` scroll region so long content remains reachable without enabling document-level scrolling.

#### Current

Current source and focused regressions define the built-in navigation and scroll-ownership contract. Authenticated headful desktop and mobile checks confirmed that the selected Settings content, not the page shell, owns vertical scrolling. The existing panel, route, scope, and invalidation owners remain unchanged.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/settings/SettingsView.tsx` — `SettingsView`; `src/apps/chat-ui/src/settings/types.ts` — `SettingsPanel`; `src/apps/chat-ui/src/settings/SettingsSidebar.tsx` — `SettingsSidebar`; `src/apps/chat-ui/src/plugins/builtin-browser-entry.tsx` — `FirstPartySubviewNavigation`; `src/apps/chat-ui/src/responsive-pane-sidebar.tsx` — `ResponsiveTabSidebarPanel`; `src/apps/chat-ui/src/context/ContextFilesView.tsx` — `ContextFilesView`; `src/apps/chat/chat-settings-routes.ts` — `ChatSettingsRoute`; `src/apps/chat/chat-settings-routes.ts` — `chatSettingsRoute`; `src/apps/chat/chat-settings-routes.ts` — `chatSettingsRouteInvalidatesBootstrapCatalog`; `src/apps/chat/chat-settings-routes.ts` — `handleChatSettingsRoute`
- Tests: `test/chat-ui-responsive-tab-modules.test.mjs` — “desktop module tabs use pane-width sidebars and container-responsive content flows”; `test/chat-ui-settings-room-regressions.test.mjs` — “Settings owns a viewport-bounded scroll panel instead of clipping long content”
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `BuildContextView`; `ContextFilesView`; `AgentsView`; `SettingsView`
- Failure/security boundary: Unknown panels/methods fail explicitly; failed mutations cannot update optimistic settings or stale capability catalogs.
- Accessibility/responsive boundary: Desktop 1440×900 and mobile 390×844 headful checks confirmed that the inner selected panel scrolls to its end while the outer shell remains bounded. Sidebar focus return and screen-reader behavior remain separate acceptance work.
- Compatibility boundary: Panel IDs/routes are compatibility surfaces; owner specs define each underlying setting. Third-party plugin layout remains renderer-owned.
- Confidence: **high**
- Verification follow-up: Add and run a route/panel matrix covering all eleven panel IDs, read/write methods, same-origin requirements, scopes, invalidation, and failures; retain focused wide/narrow/mobile drawer evidence and rerun scroll ownership after layout changes.

### Requirement: WEB-CONFIG-CREDENTIALS-005

Provider and media settings MUST expose capability/auth-method status without returning credentials, MUST distinguish provider-catalog failure from an empty catalog, and MUST state whether a change affects current or future Sessions.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/settings/ProviderSettingsView.tsx` — `ProviderSettingsView`; `src/apps/chat/chat-settings-routes.ts` — `chatSettingsRouteRequiresSameOrigin`; `src/apps/chat/chat-settings-routes.ts` — `handleChatSettingsRoute`
- Tests: `test/chat-ui-provider-auth-methods.test.mjs` — “provider settings and model surfaces are runtime-catalog driven instead of a hard-coded global provider list”
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `BuildContextView`; `ContextFilesView`; `AgentsView`; `SettingsView`
- Failure/security boundary: Credentials never round-trip; failed catalog/auth status remains a visible failure, not empty authority.
- Accessibility/responsive boundary: Auth-method and effect status must be textual and keyboard reachable.
- Compatibility boundary: Credentials/providers are SPC-RES-005/SPC-RUN-008/SPC-SEC-001; Web owns only safe configuration UX.
- Confidence: **high**
- Verification follow-up: Run provider settings tests and add credential-redaction, catalog-failure, current-versus-future effect, and same-origin mutation assertions; inspect browser payloads through CDP later.

## Interfaces and ownership

**Capability IDs:** pibo.chat-web.context-agents-settings

**Public surfaces:**

- /api/chat/context-build*
- /api/chat/agents*
- /api/chat/agent-folders*
- /api/chat/catalog*
- /api/chat/settings*
- BuildContextView
- ContextFilesView
- AgentsView
- SettingsView

**Non-owned links:**

- SPC-RUN-008 owns runtime/provider/model/auth resolution and capability semantics.
- SPC-RES-003 owns managed resource/context storage semantics.
- SPC-RES-005 owns provider adapters, catalogs, and credentials.
- SPC-SEC-001 owns auth policy and secret handling.
- SPC-DATA-001 owns durable revision persistence.

## Failure and security behavior

- Revision conflicts surface diff/reload choices. Runtime switch removes only unsupported model values; explicit null clears persisted overrides. Catalog failure is not an authoritative empty catalog.
- Origin metadata is inspector-only and excluded from copied context. Credentials are never echoed; same-origin mutation checks apply.

Web browser state, caches, projections, overlays, annotations, and iframe presence do not grant authorization or become durable product authority.

## Accessibility and responsive behavior

Built-in Settings, User Resources/Context, Agent Designer, Cron, Loops, Web Annotations, and tool-family section navigation responds to each tab container. Wide tabs show the left navigation; narrow tabs keep a labeled reopen button and modal drawer behavior. Context Files observes its nested editor container for the file panel. Workflows and Build Context intentionally remain single-surface views without decorative navigation. Focused Chromium evidence covers wide, narrow, and mobile dimensions; physical-device, screen-reader, zoom, and full keyboard acceptance remain open.

Source-defined DOM, CSS, ARIA, and focused Chromium checks do not constitute complete assistive-technology, physical-device, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Runtime option schemas/catalogs drive UI; unknown capabilities must degrade without hard-coded global provider assumptions. Settings distinguish current Session effects from future-session defaults.

## Known limits

- Evidence gap: No focused tests cover managed-context revision conflict UI or the full settings panel matrix.
- Evidence gap: Focused tab-navigation layout and drawer interaction have headful Chromium evidence, but full form, diff, credential-redaction, screen-reader, zoom, physical-device, and exhaustive keyboard validation remain open.

## Reconciled stale claims

- Reject: Agent Designer uses one hard-coded global provider/model list.
- Reject: Context origin headers are delivered model content.
- Reject: Settings credentials may be returned to the browser.
- Reject: Every settings change retroactively affects active Sessions.
- Reject: Web owns provider/runtime credential semantics.

## Verification and traceability

- Source and named-test locators resolve to regular files at Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Imported or re-exported symbols use their canonical Foundation definition files in traceability.
- Source inspection was performed for every requirement; two package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Focused wide/narrow/mobile Chromium tab-navigation and drawer checks were performed; full visual, assistive-technology, PWA, iframe, annotation, settings, and VS Code acceptance was not performed.
- External provider, gateway restart/deployment, Pibo2, and real same-origin code-server acceptance was not performed.
- Confidence measures trace quality, not execution of an unclaimed evidence class.

Package verification commands:

- `cd /root/code/pibo-okf-docs && node --test test/chat-ui-agent-designer-runtime-switch.test.mjs test/chat-ui-context-build-origin.test.mjs test/chat-ui-provider-auth-methods.test.mjs`

## Related concepts

- SPC-RUN-008
- SPC-RES-003
- SPC-RES-005
- SPC-SEC-001
- SPC-DATA-001
