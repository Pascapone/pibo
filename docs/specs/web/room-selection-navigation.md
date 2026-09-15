---
type: "Specification"
title: "Chat Web Room Selection and Navigation"
description: "Defines cache-backed Room switching, canonical route and stored-selection ownership, and stale-request protection in Chat Web."
tags: ["web", "chat-web", "rooms", "navigation", "cache"]
status: "stable"
authority: "normative"
generated:
  by: "openai-codex/gpt-6"
  at: "2026-09-15T21:05:00Z"
sources:
  - id: "integrated-source-tests-browser"
    resource: "scope:Integrated implementation, focused tests, and isolated headful browser evidence at traceability.commit"
    title: "Room selection source, race regressions, and A-B-A browser evidence"
implementation:
  state: "current"
  source_commit: "c6e3943096bd45158393d59519b525b4365679c7"
  source_evidence: "performed"
  test_execution: "Focused Room snapshot, empty-room, route-ownership, Settings, and race regressions passed in the isolated Docker worker."
  build_execution: "Root build, root typecheck, workflow build, and Chat UI production build passed in the isolated Docker worker."
  browser_execution: "Authenticated headful delayed and reordered A-to-B-to-A switching immediately restored the cached target Session with matching URL and stored selection, then retained the latest selection after authoritative responses settled."
  evidence_limits: "Browser evidence used controlled isolated-worker request delays. No packaged Pibo2 deployment, production gateway change, physical mobile device, push, PR, or release is claimed."
traceability:
  commit: "c6e3943096bd45158393d59519b525b4365679c7"
  requirements:
    - id: "WEB-ROOM-SELECT-001"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "selectRoom"
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "loadNavigation"
        - path: "src/apps/chat-ui/src/app-navigation-merge.ts"
          symbol: "applyBootstrapUpdateForRoom"
        - path: "src/apps/chat-ui/src/app-navigation-merge.ts"
          symbol: "selectBootstrapRoomSnapshot"
      tests:
        - path: "test/chat-ui-settings-room-regressions.test.mjs"
          name: "Room selection restores a cached Session snapshot before forced validation"
        - path: "test/chat-ui-settings-room-regressions.test.mjs"
          name: "Room selection can restore a cached empty Room"
      public:
        - "Chat Web Room sidebar"
        - "Room and Session browser routes"
        - "pibo.chat.lastSelection local storage"
      failures:
        - "Selecting a cached Room must not blank or replace its committed Session content while validation is pending."
        - "A cached empty Room remains intentionally empty rather than borrowing another Room's Session."
      confidence: "high"
    - id: "WEB-ROOM-OWNER-002"
      status: "implemented"
      sources:
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "fetchNavigation"
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "loadBootstrap"
        - path: "src/apps/chat-ui/src/App.tsx"
          symbol: "selectRoom"
      tests:
        - path: "test/chat-ui-settings-room-regressions.test.mjs"
          name: "Room switching keeps URL and stored selection owned by the latest click"
        - path: "test/chat-ui-settings-room-regressions.test.mjs"
          name: "stale Room navigation responses cannot replace the latest selection"
      public:
        - "history.pushState and history.replaceState Room routes"
        - "pibo.chat.lastSelection local storage"
      failures:
        - "An older navigation or bootstrap request cannot retarget the route, stored selection, active Room, or visible Session after a newer selection."
        - "An aborted or failed background validation may report current-owner failure but cannot erase a valid cached target snapshot."
      confidence: "high"
---

# Scope

This specification owns Chat Web client behavior when a user changes Rooms. It covers immediate cache-backed rendering, canonical Room and Session routes, stored selection, background validation, and request ownership. Room persistence, Room mutations, and Session workspace internals remain with their domain specifications.

## Requirement: WEB-ROOM-SELECT-001 A selected Room restores its last committed snapshot immediately

Chat Web retains the last committed selected Session for each visited Room. Selecting Room B from Room A synchronously projects B's cached Session, or B's cached empty state, before forced navigation validation completes. Returning B→A does the same for A. Pending validation may mark the target Room as loading, but it must not unmount or replace the cached Session subtree.

A successful authoritative response refreshes only the selected Room snapshot and may choose a different valid Session when server state changed. An empty authoritative Room remains empty. Snapshot restoration never copies a Session from another Room.

## Requirement: WEB-ROOM-OWNER-002 The latest Room selection owns route, storage, and response application

Each Room selection advances a generation and aborts the preceding Room request. The latest click immediately owns the browser route and `pibo.chat.lastSelection`, including the per-Room Session map. Browser Back and route bootstrap use the same ownership rule.

Every navigation and bootstrap response is checked against its request generation and current selection before application. A delayed response for A cannot overwrite B after A→B, and a delayed response for B cannot overwrite A after A→B→A. Failures from an obsolete request are ignored. A current validation failure may be reported, but valid cached target content and canonical navigation remain intact.

# Evidence boundary

The focused source regressions cover cached Session restoration, cached empty Rooms, immediate route ownership, and both response orders. In authenticated headful worker validation, the canonical Pibo → Personal Chat → Pibo flow updated URL, history, and local storage immediately; cached content remained visible during delayed revalidation; and reordered responses did not replace the final Pibo selection. Desktop and emulated-mobile flows used the same client contract. No Pibo2 runtime was modified.
