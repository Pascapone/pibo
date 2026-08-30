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
    - id: "WEB-CONFIG-CONTEXT-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/context/ContextBuildView.tsx"
          symbol: "ContextBuildView"
        - path: "src/apps/chat-ui/src/context/ContextBuildView.tsx"
          symbol: "renderNodeForCopy"
        - path: "src/apps/chat-ui/src/context/ContextBuildView.tsx"
          symbol: "readInspectorOrigin"
      tests:
        - path: "test/chat-ui-context-build-origin.test.mjs"
          name: "Context Build labels generated tool origins as inspector-only header metadata"
        - path: "test/chat-ui-context-build-origin.test.mjs"
          name: "Context Build copy output excludes inspector-only origin metadata"
      public:
        - "/api/chat/context-build*"
        - "/api/chat/agents*"
        - "/api/chat/agent-folders*"
        - "/api/chat/catalog*"
        - "/api/chat/settings*"
        - "ContextBuildView"
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
        - "ContextBuildView"
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
        - "ContextBuildView"
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
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "ChatSettingsRoute"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "chatSettingsRoute"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "chatSettingsRouteInvalidatesBootstrapCatalog"
        - path: "src/apps/chat/chat-settings-routes.ts"
          symbol: "handleChatSettingsRoute"
      source_inspected: true
      follow_up: "Add and run a route/panel matrix test covering all ten panel IDs, read/write methods, same-origin requirements, scopes, invalidation, failures, and narrow-view navigation."
      public:
        - "/api/chat/context-build*"
        - "/api/chat/agents*"
        - "/api/chat/agent-folders*"
        - "/api/chat/catalog*"
        - "/api/chat/settings*"
        - "ContextBuildView"
        - "ContextFilesView"
        - "AgentsView"
        - "SettingsView"
      failures:
        - "Unknown panels/methods fail explicitly; failed mutations cannot update optimistic settings or stale capability catalogs."
        - "Accessibility/responsive boundary: Sidebar current state, form labels/errors, focus return, and 640px padding need headful validation."
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
        - "ContextBuildView"
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

Context panes, responsive side panels, labeled forms, dialogs, errors, and 1180/640px context-file breakpoints are source-defined. No headful acceptance ran.

### Compatibility and integration

Runtime option schemas/catalogs drive UI; unknown capabilities must degrade without hard-coded global provider assumptions. Settings distinguish current Session effects from future-session defaults.

## Requirements and invariants

### Requirement: WEB-CONFIG-CONTEXT-001

Context Build MUST show the actual assembled context and resource origin metadata for inspection while excluding inspector-only origin headers from copied/delivered context.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/context/ContextBuildView.tsx` — `ContextBuildView`; `src/apps/chat-ui/src/context/ContextBuildView.tsx` — `renderNodeForCopy`; `src/apps/chat-ui/src/context/ContextBuildView.tsx` — `readInspectorOrigin`
- Tests: `test/chat-ui-context-build-origin.test.mjs` — “Context Build labels generated tool origins as inspector-only header metadata”; `test/chat-ui-context-build-origin.test.mjs` — “Context Build copy output excludes inspector-only origin metadata”
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `ContextBuildView`; `ContextFilesView`; `AgentsView`; `SettingsView`
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
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `ContextBuildView`; `ContextFilesView`; `AgentsView`; `SettingsView`
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
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `ContextBuildView`; `ContextFilesView`; `AgentsView`; `SettingsView`
- Failure/security boundary: Unsupported values must be removed explicitly; catalog failure cannot be treated as a valid empty catalog; secrets stay server-side.
- Accessibility/responsive boundary: Forms need labels/errors/focus and non-color-only dirty/unsupported state.
- Compatibility boundary: Runtime/catalog semantics remain SPC-RUN-008.
- Confidence: **high**
- Verification follow-up: Run designer tests with each registered runtime schema; headfully validate runtime switching, dirty state, errors, and mobile sidebar.

### Requirement: WEB-CONFIG-SETTINGS-004

Settings MUST expose the implemented panel set—general, concurrency, previews, transcription, speech, shortcuts, maintenance, Pi packages, skills, and providers—and preserve each route's declared scope and bootstrap invalidation behavior.

#### Current

Foundation source inspection defines the current contract. No named test exists in the evidence set, so this requirement remains an explicit source-only gap and makes no focused-test claim.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/settings/SettingsView.tsx` — `SettingsView`; `src/apps/chat-ui/src/settings/types.ts` — `SettingsPanel`; `src/apps/chat-ui/src/settings/SettingsSidebar.tsx` — `SettingsSidebar`; `src/apps/chat/chat-settings-routes.ts` — `ChatSettingsRoute`; `src/apps/chat/chat-settings-routes.ts` — `chatSettingsRoute`; `src/apps/chat/chat-settings-routes.ts` — `chatSettingsRouteInvalidatesBootstrapCatalog`; `src/apps/chat/chat-settings-routes.ts` — `handleChatSettingsRoute`
- Tests: No named test exists in the Foundation evidence set; this requirement remains source-only.
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `ContextBuildView`; `ContextFilesView`; `AgentsView`; `SettingsView`
- Failure/security boundary: Unknown panels/methods fail explicitly; failed mutations cannot update optimistic settings or stale capability catalogs.
- Accessibility/responsive boundary: Sidebar current state, form labels/errors, focus return, and 640px padding need headful validation.
- Compatibility boundary: Panel IDs/routes are compatibility surfaces; owner specs define each underlying setting.
- Confidence: **medium**
- Verification follow-up: Add and run a route/panel matrix test covering all ten panel IDs, read/write methods, same-origin requirements, scopes, invalidation, failures, and narrow-view navigation.

### Requirement: WEB-CONFIG-CREDENTIALS-005

Provider and media settings MUST expose capability/auth-method status without returning credentials, MUST distinguish provider-catalog failure from an empty catalog, and MUST state whether a change affects current or future Sessions.

#### Current

Foundation source and named-test inspection define the current contract. The named tests identify focused evidence and do not expand this requirement into visual, provider, platform, gateway, or Pibo2 acceptance.

#### Acceptance and boundaries

- Source: `src/apps/chat-ui/src/settings/ProviderSettingsView.tsx` — `ProviderSettingsView`; `src/apps/chat/chat-settings-routes.ts` — `chatSettingsRouteRequiresSameOrigin`; `src/apps/chat/chat-settings-routes.ts` — `handleChatSettingsRoute`
- Tests: `test/chat-ui-provider-auth-methods.test.mjs` — “provider settings and model surfaces are runtime-catalog driven instead of a hard-coded global provider list”
- Public surfaces: `/api/chat/context-build*`; `/api/chat/agents*`; `/api/chat/agent-folders*`; `/api/chat/catalog*`; `/api/chat/settings*`; `ContextBuildView`; `ContextFilesView`; `AgentsView`; `SettingsView`
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
- ContextBuildView
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

Context panes, responsive side panels, labeled forms, dialogs, errors, and 1180/640px context-file breakpoints are source-defined. No headful acceptance ran.

Source-defined DOM, CSS, and ARIA are implementation evidence only. They do not constitute headful focus, keyboard, pointer, zoom, responsive, screen-reader, PWA, iframe, annotation, or settings acceptance.

## Compatibility and integration behavior

Runtime option schemas/catalogs drive UI; unknown capabilities must degrade without hard-coded global provider assumptions. Settings distinguish current Session effects from future-session defaults.

## Known limits

- Evidence gap: No focused tests cover managed-context revision conflict UI or the full settings panel matrix.
- Evidence gap: No headful form, sidebar, diff, focus, narrow viewport, or credential-redaction validation.

## Reconciled stale claims

- Reject: Agent Designer uses one hard-coded global provider/model list.
- Reject: Context origin headers are delivered model content.
- Reject: Settings credentials may be returned to the browser.
- Reject: Every settings change retroactively affects active Sessions.
- Reject: Web owns provider/runtime credential semantics.

## Verification and traceability

- Source and named-test locators resolve to regular files at Foundation commit `38bb6e57f118c1543e7263c68d27e5103d3b1262`.
- Imported or re-exported symbols use their canonical Foundation definition files in traceability.
- Source inspection was performed for every requirement; five package requirements remain source-only exactly where no named test exists.
- Focused tests, the OKF validator suite, typecheck, build, package, diff, link/navigation, and archive-byte checks were run only after authoring and are reported outside this committed package.
- Headful visual/focus/keyboard/pointer/responsive/PWA/iframe/annotation/settings/VS Code acceptance was not performed.
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
