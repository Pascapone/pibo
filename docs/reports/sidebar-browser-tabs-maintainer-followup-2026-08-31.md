# Sidebar browser tabs: maintainer screenshot follow-up

Date: 2026-08-31

## Candidate and scope

- Starting feature head: `cc370fdf72b8043ddac66226a4764363aa9fee69`
- Local backup ref: `backup-sidebar-browser-tabs-pibo2-followup-20260831`
- Isolated branch/worktree: `sidebar-browser-tabs-pibo2-followup`
- Docker worker: `pibo-dev-sidebar-browser-tabs-pibo2-followup`

This follow-up addresses only the four screenshot findings: the existing populated Desktop Sessions sidebar, Chrome-style New Tabs, pointer insertion feedback, and the fixed Desktop Terminal header. Mobile layout and navigation remain route-owned.

## Implementation

The left-pane regression came from a missing column flex container around the unchanged `SessionSidebar`. Its children rely on the existing flex-height contract; without it, Rooms, profile selection, and Sessions overflowed below the fixed pane. Restoring that container makes the existing live data, selection, unread indicators, scrolling, room/session actions, and creation/archive controls visible again without duplicating or hard-coding navigation data.

`+` now appends a persisted, distinct `New Tab` target. Its active panel owns the labelled module catalog. A unique selection replaces the temporary tab in place; selecting an existing singleton closes the temporary tab and focuses the existing module. Multiple New Tabs may coexist and survive serialization. The old popover, outside-click, menu, and Escape-dismiss state was removed.

Pointer drag tracks the hovered tab half and renders an animated cyan gap at the exact normalized insertion index. Drop, drag end, and strip leave clear the marker. Keyboard reorder and deterministic close focus remain unchanged; reduced-motion disables the gap animation.

The fixed Desktop center now always supplies the Terminal session view and hides only its Terminal/Workflow selector, Raw Events, and Web Annotations controls. Tool View Mode, Terminal Fullscreen, Thinking controls, and unrelated actions remain. Mobile continues to receive the ordinary header and all prior controls.

## Automated gates

All final commands ran sequentially in the isolated Docker worker with their direct exit status propagated.

- `npm run typecheck`: exit 0. The standard repository heap (`--max-old-space-size=1200`) was sufficient.
- `npm run build`: exit 0. Chat UI transformed 2,948 modules; only the existing large-chunk advisory appeared. Context Files UI and VS Code webview also built.
- Focused command: `node --test --test-concurrency=1 test/chat-ui-desktop-tabs-model.test.mjs test/chat-ui-desktop-tabs-behavior.test.mjs test/chat-ui-desktop-tabs-accessibility.test.mjs test/chat-ui-desktop-session-sidebar.test.mjs test/chat-ui-session-view-toggle-accessibility.test.mjs`: 6 passed, 0 failed, exit 0.
- Full current Chat UI/Terminal command: sorted `test/chat-ui-*.test.mjs`, `sticky-virtuoso-state.test.mjs`, `use-sticky-virtuoso.test.mjs`, and `session-ui-terminal-rows.test.mjs`: 122 files, 291 passed, 0 failed, exit 0. This includes the current upstream terminal identity, infinite-scroll, sticky-anchor, prepend, drag-deferral, and streaming regressions.
- `git diff --check`: exit 0 after the report and artifacts were staged.

## Headed Browser Use and CDP

Chromium ran headed under the worker display. Every screenshot followed a visible ready-state assertion. Three seeded Rooms with three Sessions each exercised the real navigation projection; no browser fixture hard-coded sidebar content.

### Desktop 1440×900

- Shared Chat, all three Rooms, room controls, profile selector, and all selected-room Sessions remained visible while right-side content changed.
- Repeated `+` created two simultaneous New Tabs. Projects replaced the active temporary tab. Opening Projects again from another New Tab removed that temporary tab and focused the singleton.
- A headed HTML5 drag sequence displayed the prospective gap and produced `Projects, Project · prj_default, New Tab`; the gap count returned to zero after drop. `Alt+Shift+ArrowLeft` then moved New Tab left while retaining focus; Delete closed it and focused the deterministic Project neighbor.
- Keyboard resize reached 568 px. Collapse plus reload restored a 44 px DOM pane and retained `width: 568, collapsed: true`; explicit reopen restored the workspace.
- Projects reached `Project Manager`; the screenshot is not a loading placeholder.

Artifacts: [New Tab](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1440-new-tab.png), [drag gap and ready Project](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1440-drag-gap.png), and [geometry audit](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1440-audit.json).

### Desktop 1920×1080

- Agent Designer reached the visible `Identity` surface while the fixed Rooms/Sessions and Terminal panes remained mounted.
- `/apps/chat/workflows/view/simple-chat/1.0.0` rendered `Workflow · simple-chat` and `Selected workflow`; Back and Forward restored the Agents route and exact version URL respectively.
- VS Code rendered its deterministic `VS Code Web unavailable` fallback.
- Terminal fullscreen hid both side panes, measured 0/1920/0 px for left/center/right, and restored the three-pane shell on exit.
- Preview was unconfigured in this worker and correctly rendered its existing unconfigured state with no fullscreen control. Deterministic Preview tests in the full suite cover iframe identity and selected-Preview loss recovery.

Artifacts: [Agent Designer](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1920-agent-designer.png), [workflow version](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1920-workflow-version.png), [VS Code fallback](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1920-vscode-fallback.png), [Terminal fullscreen](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1920-terminal-fullscreen.png), [Preview fallback](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1920-preview-unconfigured.png), and [geometry audit](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-1920-audit.json).

### Mobile 390×844

- The normal Session route rendered the existing mobile `route-shell`, composer, navigation trigger, Terminal/Workflow selector, Raw Events, and Web Annotations. No Desktop shell or workspace tablist existed.
- The workflow-version deep link rendered the existing viewer at the exact URL, again without Desktop shell/tablist.

Artifacts: [mobile Session](artifacts/sidebar-browser-tabs-followup-2026-08-31/mobile-390-session.png), [mobile workflow version](artifacts/sidebar-browser-tabs-followup-2026-08-31/mobile-390-workflow-version.png), and [mobile audit](artifacts/sidebar-browser-tabs-followup-2026-08-31/mobile-390-audit.json).

### Stable idle monitor

With Projects and VS Code mounted but inactive and Preview active, the 12-second CDP monitor recorded 4 requests, 0 Project requests, 0 EventSource requests, 0 aborted requests, and 0 console/HTTP errors. Artifacts: [idle monitor](artifacts/sidebar-browser-tabs-followup-2026-08-31/desktop-idle-monitor.json) and [flow summary](artifacts/sidebar-browser-tabs-followup-2026-08-31/browser-flow-results.json).

## Remaining integration risk

The isolated worker had no configured live Preview URL, so this batch adds no fresh real-iframe screenshot beyond the deterministic lifecycle tests and prior historical evidence. No Pibo2 deployment or acceptance run was performed, as required; PR #804 should receive its normal external acceptance on the new local candidate before merge.
