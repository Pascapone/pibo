---
title: Desktop Browser Tabs for Pibo Chat
version: 1.0
date_created: 2026-08-30
last_updated: 2026-08-30
owner: Pibo
tags: [chat-web, desktop, navigation, tabs, accessibility]
---

# Introduction

This change converts the desktop Chat Web shell into a fixed session workspace with a resizable right browser-tab sidebar. The mobile shell keeps its existing route-owned layout and topbar navigation.

## 1. Purpose and scope

The desktop shell has three stable regions: the Rooms/Pibo Sessions navigation on the left, the selected Pibo Session terminal in the center, and tabbed tools and product areas on the right. Existing URLs remain the public navigation contract. The tab list augments the URL; it does not replace routes.

## 2. Definitions

- **Desktop**: viewport wider than 980 CSS pixels.
- **Mobile**: viewport at or below 980 CSS pixels.
- **Route tab**: a right-sidebar tab backed by an existing `ChatAppRoute`.
- **Session tool tab**: Preview, Raw Events, Web Annotations, Runtime Requests, or Session Inspector for the selected Pibo Session.
- **Singleton target**: one logical surface that focuses its existing tab when opened again.
- **Resource target**: a route whose distinct resource identity may produce distinct tabs, such as two workflow drafts.

## 3. Requirements, constraints, and guidelines

- **REQ-001**: Desktop shall keep the Rooms/Pibo Sessions navigation mounted on the left for every route.
- **REQ-002**: Desktop shall keep the selected Pibo Session terminal mounted in the center while right tabs change.
- **REQ-003**: The right sidebar shall support open, focus, close, pointer reorder, keyboard reorder, overflow scrolling, tooltips, collapse, reopen, and width resize.
- **REQ-004**: The catalog shall expose Sessions, Projects, VS Code, Workflows, Cron, Loops, Agents/Agent Designer, Context, Settings, Preview, Raw Events, Web Annotations, Runtime Requests, and Session Inspector. When VS Code is not configured, its existing actionable configuration state remains reachable instead of hiding the destination.
- **REQ-005**: Sessions in the catalog shall focus and reveal the fixed left navigation. It shall not create a duplicate right surface.
- **REQ-006**: Singleton targets shall focus and update their existing tab. Resource targets may coexist when their stable resource identities differ.
- **REQ-007**: Open tabs, order, active tab, sidebar width, and collapsed state shall persist in versioned local storage.
- **REQ-008**: Existing deep links, reload, and browser Back/Forward shall open or focus the matching right route tab on Desktop.
- **REQ-009**: Mobile shall retain the existing route-based shell, area menus, drawers, and content ownership.
- **REQ-010**: Switching tabs shall keep mounted right-tab content alive, including Preview and VS Code frames.
- **A11Y-001**: Tabs shall use `tablist`, `tab`, and `tabpanel` semantics with visible focus and accessible close labels.
- **A11Y-002**: Arrow keys shall focus tabs; Enter/Space shall activate them; Delete shall close; Alt+Shift+ArrowLeft/ArrowRight shall reorder.
- **A11Y-003**: Escape shall close the catalog and restore focus to its trigger.
- **A11Y-004**: The resize divider shall expose a separator role, value attributes, and keyboard resizing.
- **CON-001**: The Root checkout remains unchanged. Implementation and validation run only in the dedicated Docker compute worker.
- **CON-002**: “Movable sidebar” means width resize while remaining docked right.
- **CON-003**: No new broad UI framework or unrelated refactor is introduced.

## 4. Interfaces and data contracts

`DesktopTabState` is stored under `pibo.chat.desktopTabs.v1`:

```ts
type DesktopTabState = {
  version: 1;
  tabs: DesktopTab[];
  activeTabId: string | null;
  width: number;
  collapsed: boolean;
};
```

The active route remains canonical in the browser URL. Route reconciliation opens or focuses a tab for every non-Sessions route. Sessions routes update only the fixed session workspace.

History policy:

| Action | Browser history |
| --- | --- |
| Open/focus a route tab | Push its existing route |
| Internal navigation in active route tab | Preserve existing route behavior |
| Browser Back/Forward | Reconcile URL into the matching tab |
| Open/focus a session tool tab | Keep the current URL |
| Select a Room or Pibo Session | Push the existing Sessions route; retain the right tab |

## 5. Acceptance criteria

- **AC-001**: Given a 1440×900 or 1920×1080 viewport, when any catalog target opens, then left Rooms/Pibo Sessions and the center terminal remain visible.
- **AC-002**: Given an existing singleton tab, when the same surface opens again, then no duplicate is added.
- **AC-003**: Given multiple tabs, when the active tab closes, then the right neighbor becomes active, or the left neighbor if no right neighbor exists.
- **AC-004**: Given reordered, resized, or collapsed tabs, when the page reloads, then order, width, collapse, and active target restore.
- **AC-005**: Given a direct Projects, Workflow, Agent, Context, Settings, Cron, Loop, or VS Code URL, when Desktop loads it, then the matching right tab opens while the session workspace remains mounted.
- **AC-006**: Given browser Back/Forward, when route history changes, then the matching route tab opens or receives focus.
- **AC-007**: Given 390×844, when existing topbar navigation is used, then the prior route-owned mobile view and drawer behavior remain.
- **AC-008**: Given keyboard-only input, when users navigate, reorder, close, resize, collapse, and use the catalog, then every operation completes with visible focus.

## 6. Test automation strategy

- Pure model tests cover deduplication, close-neighbor focus, reorder, bounds, persistence recovery, and route reconciliation.
- component/source-contract tests cover ARIA, keyboard commands, catalog Escape, resize, and Desktop/Mobile gating.
- existing Chat Web route, storage, mobile navigation, sidebar, Preview, Raw Events, and fullscreen tests remain in the gate.
- headful Browser Use validates 1440×900, 1920×1080, and 390×844. CDP records console and failed-network evidence.

## 7. Rationale and context

The selected Pibo Session is the operator’s continuous work context. Product areas and session tools are supporting surfaces, so Desktop keeps them beside the terminal. Mobile lacks enough width for this relationship and retains the existing route-based model.

## 8. Dependencies

- Existing TanStack Router routes and navigation helpers.
- Existing React and Lucide packages.
- Existing Preview, annotation, trace, runtime-request, Projects, Workflow, Agent Designer, Context, Settings, Cron, Loop, and VS Code components.

## 9. Edge cases

- Corrupt or unavailable local storage falls back to an empty, expanded sidebar with a bounded default width.
- Closing the last tab leaves the catalog-ready empty sidebar and the Sessions route.
- A missing selected Pibo Session shows the existing empty states in session tool tabs.
- VS Code stays discoverable in the catalog when the gateway does not configure it and renders the existing configuration empty state.
- Width restoration clamps to current safe limits.

## 10. Validation criteria

All specified model/component tests, Chat UI typecheck/build, relevant existing tests, headful viewport flows, and CDP console/network checks must pass before the local commit.
