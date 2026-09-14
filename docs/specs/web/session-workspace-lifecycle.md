---
type: "Specification"
title: "Chat Web Session creation and workspace lifecycle"
description: "Defines immediate optimistic Session creation, inline title handoff, selection ownership, and Session-owned desktop workspace tab lifecycle."
tags: ["web", "chat-web", "sessions", "workspace", "plugins"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-14T08:10:00Z"
sources:
  - id: "plugin-ux-plan"
    resource: "/plans/unified-plugin-system-rebuild.md"
    title: "PLG-UX-002 intended contract"
  - id: "integrated-source-and-tests"
    resource: "scope:Integrated implementation and focused tests at traceability.commit"
    title: "Session creation and workspace lifecycle source and named-test evidence"
implementation:
  state: "current"
  source_commit: "e901ebcc3b40fc886e42746d5b02d167a0daaebd"
  source_evidence: "performed"
  test_execution: "The route-ownership regression failed before the fix and passed after it; 58 focused Chat UI and plugin browser tests passed in Docker"
  build_execution: "Chat UI typecheck and production build passed in Docker"
  browser_execution: "Authenticated headful desktop and mobile switching kept ready-empty and delayed-loading target Sessions empty, restored Session A's three tabs with tab two active, emitted no cross-Session tabset write, and retained one document"
  evidence_limits: "The current fix was validated only in the isolated worker with automated headful Chromium viewports, not on physical mobile hardware or a packaged/deployed Pibo2 candidate. The earlier Agent Designer creation evidence and optimistic rename checks remain applicable. No full suite, model turn, controller-gateway change, push, PR, release, or publication is claimed."
traceability:
  commit: "e901ebcc3b40fc886e42746d5b02d167a0daaebd"
  requirements:
    - id: "WEB-SESSION-CREATE-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "createSession"
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "createSessionMutation"
        - path: "src/apps/chat-ui/src/optimistic-session-title.ts"
          symbol: "createOptimisticSessionTitleIntent"
        - path: "src/apps/chat-ui/src/session-node.tsx"
          symbol: "SessionNode"
        - path: "src/apps/chat-ui/src/session-sidebar.tsx"
          symbol: "SessionSidebar"
      tests:
        - path: "test/chat-ui-optimistic-session-title.test.mjs"
          name: "pending creation opens a local empty title editor before any persisted ID exists"
        - path: "test/chat-ui-optimistic-session-title.test.mjs"
          name: "delayed title persistence cannot launch hydration after a newer session or room selection"
        - path: "test/chat-ui-optimistic-session-selection.test.mjs"
          name: "post-create hydration is nonblocking and cannot navigate or report stale errors"
        - path: "test/chat-ui-session-create-room-scope.test.mjs"
          name: "every Room Session create entrypoint uses the App router and inline-rename handoff"
      public:
        - "Chat Web Room Sessions sidebar New Session action"
        - "Agent Designer shared New Session callback"
        - "Session sidebar inline title editor"
      failures:
        - "A create failure removes only its pending row, preserves a newer Room or Session selection, reports recovery text, and never sends a title request to a temporary ID."
        - "A title-save failure keeps the real Session, reopens the confirmed draft for retry, and does not reuse a stale request."
        - "Pending rows cannot archive, pin, delete, open a context menu, drag, or invoke other backend mutations."
        - "Compatibility boundary: normal Session creation remains client-routed in the current document and does not perform a document, PWA, or service-worker reload."
      confidence: "high"
    - id: "WEB-SESSION-WORKSPACE-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "renderDesktopPanel"
        - path: "src/apps/chat-ui/src/desktop-tabs.tsx"
          symbol: "useDesktopTabWorkspace"
        - path: "src/apps/chat-ui/src/desktop-tabs.tsx"
          symbol: "DesktopTabSidebar"
        - path: "src/apps/chat-ui/src/desktop-tabs-model.ts"
          symbol: "desktopTabStateFromSessionTabset"
        - path: "src/apps/chat-ui/src/plugins/plugin-workspace.tsx"
          symbol: "PluginWorkspaceProvider"
        - path: "src/apps/chat-ui/src/plugins/session-tab-controller.ts"
          symbol: "SessionTabController"
      tests:
        - path: "test/chat-ui-desktop-tabs-behavior.test.mjs"
          name: "desktop tab React flows preserve every mounted panel, refresh one tab, dispose on close, and focus deterministically"
        - path: "test/chat-ui-desktop-tabs-model.test.mjs"
          name: "desktop tabs model covers dedupe, close focus, reorder, persistence, and route reconciliation"
        - path: "test/plugin-system-browser.test.mjs"
          name: "failed-save and in-flight Session controllers survive bounded cache pruning"
        - path: "test/plugin-system-browser.test.mjs"
          name: "plugin Refresh waits for leave guards and tabset saves, and blocks on failure"
      public:
        - "Chat Web desktop Session workspace"
        - "Workspace tab Refresh and Close actions"
        - "Per-Session PluginStore tabsets"
      failures:
        - "Inactive tabs remain mounted but inactive; Refresh preserves the current mount if leave guards, autosave, tabset persistence, or CAS fails."
        - "Close is the explicit panel cleanup boundary, while changing Sessions disposes the departed Session's live panels and browser hosts without discarding unsaved controller state."
        - "Late reads, writes, refreshes, and view starts remain bound to their owning Session and cannot project another Session's tabs or selection."
        - "A route observed by an older Session-selection generation cannot initialize or mutate the newly selected Session while client routing catches up."
        - "Compatibility boundary: the global browser-v1 key is migration input only and is not a runtime workspace fallback."
      confidence: "high"
---

# Scope

This specification owns the current Chat Web contract for ordinary Session creation and the Session-owned desktop workspace. It covers the Room Sessions-sidebar action and consumers of the shared App callback, including Agent Designer. Workflow-native Session creation and backend migration are separate contracts.

## Requirement: WEB-SESSION-CREATE-001 Immediate optimistic creation preserves title and navigation ownership

Starting an ordinary Session creation synchronously inserts and selects a temporary row in the origin Room, exposes an empty focused inline title editor, and makes the relevant desktop or mobile Sessions sidebar visible before `POST /api/chat/sessions` settles. This operation does not replace or reload the document.

The creation operation owns a stable client identity independent of its temporary or persisted Session ID. Draft text, focus, editor state, confirmation, and cancellation survive replacement of the temporary row by the real `ps_` row. Confirmation updates the visible title immediately. It queues at most one title persistence request and sends that request only after the real ID exists. Cancellation closes the editor and suppresses title persistence.

The origin Room remains the owner of insertion, replacement, rollback, and cache hydration. If the user selects another Session or Room while create or title persistence is pending, that newer selection wins. Completion may hydrate the origin bootstrap query cache, but it may not retarget active navigation, canonicalize an obsolete route, report a stale hydration error, or reopen a completed editor. Deferred hydration requires matching create operation, bootstrap request, Room-switch generation, and Session-selection generation ownership.

Until the real Session exists, the optimistic row is UI-only. Archive, pin, delete, context-menu, drag/reorder, and every backend mutation other than the eventual real-ID title request are unavailable. Create failure removes only the pending row and restores the pre-create selection only when the failed operation still owns it. Title-save failure leaves the real Session in place, reports the failure, and reopens the confirmed draft for an explicit retry with a fresh one-shot request.

## Requirement: WEB-SESSION-WORKSPACE-001 Each real Session owns one guarded desktop workspace lifecycle

A real Session owns its `PluginSessionTabset`, tab order, active tab, layout, and persisted plugin view state. A newly created Session with no stored tabset begins with an empty workspace; no global or previous-Session tabs are synthesized while its controller loads. The browser-v1 key is an import source, not a live fallback.

Within one Session, every open real tab has stable mount identity. Selecting another tab marks the prior view inactive and hides its panel without removing its React subtree. Refresh first completes that tab's registered leave/autosave guards and pending tabset saves. Success remounts only the selected panel; failure leaves the existing mount intact. Close runs the applicable guards, removes the tab, and releases its panel resources.

Changing Sessions disposes the departed Session's live panels and browser hosts. The bounded controller cache may remove only clean, idle controllers; it retains local drafts, CAS conflicts, failed saves, and in-flight reads or writes until they become safely reloadable or receive explicit recovery. Every asynchronous read, save, refresh, and view start remains bound to its Session owner, so late completion cannot replace another Session's tabset, active tab, view state, or selection.

Route reconciliation has the same ownership boundary. A route key is bound to the Session-selection generation that observed it after bootstrap readiness. If Session A's active route is still visible during an A→B render, that older route cannot initialize or edit B's controller, whether B is already ready or completes a delayed load. Once routing changes under the current selection generation, the explicit current route may reconcile normally. Returning to A restores A's stored tab order and active tab rather than deriving them from B or the transient URL.

# Evidence boundary

The source commit, focused before/after regression, 58-test focused Docker set, Chat UI typecheck/build, and authenticated headful switching run support the implemented claims above. In the actual flow, Session A owned Workflows, Settings, and Preview with Settings active; ready-empty B, delayed-loading C, and mobile-switched D remained empty immediately and after 2.5 seconds, while returning to A restored all three tabs and Settings. The browser retained one document/navigation entry with no `pagehide` or `beforeunload`, and no foreign plugin-tab `PUT` occurred.

Earlier delayed-POST desktop/mobile and deterministic delayed-PATCH evidence continues to support immediate optimistic rename and selection ownership. An earlier bounded Agent Designer run confirmed that its action reached the shared App callback, returned `201`, retained the document, client-routed to the real Session, focused the title editor, and opened an empty workspace. The exact `a32b3466` delayed-POST timing was not repeated through that button because that worker state exposed the designer renderer as unavailable; its callback wiring is covered by focused source tests.

The route-carryover fix was validated against the isolated worker candidate only. This specification does not claim a full repository suite, a package or Pibo2 deployment of `e901ebcc`, release acceptance, a physical-device mobile browser, a model turn, or provider execution.
